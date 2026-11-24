/**
 * Node "Kịch bản": 1 bản kịch bản tách từ node Kịch bản video (nút "Ra node").
 * - Giữ chữ riêng, sửa được ("Bản gốc" quay về bản Muse trả); nguồn viết lại thì báo + "Dùng bản mới".
 * - Cổng "Tham chiếu" nhận ảnh (Ảnh kết quả / Nhân vật tham chiếu / Trang phục), xếp thứ tự được.
 * - "Tạo video": gửi kịch bản + mọi ảnh tham chiếu trong 1 lần Muse, tải mọi clip Muse trả (cuối = bản chính).
 * - Thu gọn được (chỉ còn đầu + 1 dòng tóm tắt).
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Position, useNodeConnections, useNodesData, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { MuseMediaIcon, MuseMediaPort } from './MuseMediaPort'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUpRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clapperboard,
  Copy,
  Download,
  FolderOpen,
  ImageOff,
  Link2,
  Loader2,
  LocateFixed,
  Maximize2,
  Minimize2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  SCRIPT_MAX_REFS,
  SCRIPT_REF_KINDS,
  buildScriptVideoRequest,
  findVideoNodeFor,
  interruptScriptVideo,
  planVideoOutputNode,
  isValidMuseConnection,
  moveScriptRef,
  museEdge,
  museVideoStreamPath,
  newerScriptFor,
  normalizeScriptData,
  normalizeScriptTextData,
  scriptRefsFromSources,
  scriptTextEdited,
  scriptVideoFingerprint,
  scriptVideoState,
  type MuseNodeLike,
  type MuseScriptVideo,
} from '../../services/museCanvasNodes.ts'
import { generateMuseVideo, museMediaUrl, openMuseVideoFolder } from '../../services/museCanvasApi.ts'
import { useMuseCanvas } from '../../components/museCanvasContext'
import { NodeDeleteButton } from './NodeDeleteButton'
import { MusePromptPort, useLinkedPrompt } from './MusePromptPort'
import { museInputPortTops } from '../../services/museCanvasNodes.ts'
import { useMuseRuns } from './useMuseRuns'
import { runKey } from '../../services/museRunRegistry.ts'

type ScriptTextNode = Node<Record<string, unknown>, string>

// Lượt "Tạo video" đang chờ Muse nằm ở `museRuns` (đổi tab / đổi project / HMR không làm mất).

const basename = (p: string) => p.split(/[\\/]/).pop() || p

function MuseScriptTextNodeImpl({ id, data: raw, selected }: NodeProps<ScriptTextNode>) {
  const { updateNodeData, getEdges, getNodes, getNode, addEdges, addNodes, setCenter } = useReactFlow()
  const { config, blockers } = useMuseCanvas()
  const data = normalizeScriptTextData(raw)
  const linked = useLinkedPrompt()
  const portTops = museInputPortTops(['Text', 'Text', 'Image'])
  const text = linked?.text ?? data.text
  const edited = !linked && scriptTextEdited(data)
  const [copied, setCopied] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showText, setShowText] = useState(true)
  const [showRefs, setShowRefs] = useState(true)
  const [now, setNow] = useState(Date.now())

  // Nguồn kịch bản (cổng script) — để biết có bản mới hơn không.
  const conns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.scriptIn })
  const parentId = conns[0]?.source ?? ''
  const parent = useNodesData(parentId)
  const newer = useMemo(
    () => (parent && parent.type === MUSE_NODE.script ? newerScriptFor(data, normalizeScriptData(parent.data as Record<string, unknown>)) : null),
    [data, parent],
  )
  const when = data.origin ? new Date(data.origin.updatedAt).toLocaleString('vi-VN') : ''

  // Ảnh tham chiếu (cổng boards), theo thứ tự người dùng xếp
  const refConns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.refsIn })
  const refIds = useMemo(() => refConns.map((c) => c.source), [refConns])
  const refNodes = useNodesData(refIds)
  const orderKey = data.order.join(',')
  const refs = useMemo(
    () =>
      scriptRefsFromSources(
        refNodes.filter(Boolean).map((n) => ({ id: n!.id, type: n!.type, data: n!.data as Record<string, unknown> })),
        orderKey ? orderKey.split(',') : [],
      ),
    [refNodes, orderKey],
  )

  const video = data.video
  const vState = scriptVideoState(text, refs, video)
  const vRunning = vState === 'running'
  const setVideo = useCallback((v: MuseScriptVideo) => updateNodeData(id, { video: v }), [id, updateNodeData])
  const runs = useMuseRuns<MuseScriptVideo>((_key, v) => setVideo(v))
  const flight = runKey.scriptVideo(id)

  // Node "Video kết quả" đã tách từ lần tạo hiện tại (nối ở cổng ra video)?
  const vOutConns = useNodeConnections({ handleType: 'source', handleId: MUSE_HANDLE.videoOut })
  const vOutIds = useMemo(() => vOutConns.map((c) => c.target), [vOutConns])
  const vOutNodes = useNodesData(vOutIds)
  const videoNode = useMemo(
    () =>
      video?.status === 'done'
        ? findVideoNodeFor(
            vOutNodes.filter(Boolean).map((n) => ({ id: n!.id, type: n!.type, position: { x: 0, y: 0 }, data: n!.data as Record<string, unknown> })),
            id,
            video.updatedAt,
          )
        : undefined,
    [id, vOutNodes, video],
  )

  /** Tách video hiện tại ra node "Video kết quả" riêng (nối dây từ cổng ra video). */
  const spawnVideoNode = useCallback(() => {
    const self = getNode(id)
    if (!self) return
    const plan = planVideoOutputNode(
      { id, type: self.type, position: self.position, data: self.data as Record<string, unknown>, width: self.measured?.width ?? self.width },
      getNodes() as unknown as MuseNodeLike[],
    )
    if (!plan) return
    addNodes([plan.node as Node])
    addEdges([plan.edge as Edge])
  }, [addEdges, addNodes, getNode, getNodes, id])

  const focusNode = useCallback(
    (nodeId: string) => {
      const n = getNode(nodeId)
      if (!n) return
      setCenter(n.position.x + (n.measured?.width ?? 340) / 2, n.position.y + (n.measured?.height ?? 600) / 2, { zoom: 1, duration: 400 })
    },
    [getNode, setCenter],
  )

  // Mở lại canvas: video còn "running" mà không còn request chờ -> gián đoạn; còn -> gắn tiếp.
  useEffect(() => {
    const v = normalizeScriptTextData(raw).video
    if (v?.status !== 'running') return
    if (!runs.resume(flight)) {
      const fixed = interruptScriptVideo(v)
      if (fixed) setVideo(fixed)
    }
    // chỉ chạy khi node gắn lên màn hình
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!vRunning) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [vRunning])

  const makeVideo = useCallback(async () => {
    if (runs.isRunning(flight)) return // đang có lượt chờ Muse: không gửi thêm
    if (!refs.length && !window.confirm('Chưa nối ảnh tham chiếu nào — Muse sẽ không giữ được mặt / bộ đồ. Vẫn tạo video?')) return
    if (video && vState !== 'pending') {
      const ok = window.confirm(
        vState === 'error' || vState === 'interrupted'
          ? 'Lần trước có thể ĐÃ gửi tới Muse (xem chat trên Muse trước). Vẫn gửi lại? Tốn thêm lượt Muse.'
          : 'Tạo lại video? Tốn thêm lượt Muse (video cũ vẫn còn trong thư mục tải về).',
      )
      if (!ok) return
    }
    const inputPath = scriptVideoFingerprint(text, refs)
    let body: Record<string, unknown>
    try {
      body = buildScriptVideoRequest(config, text, refs, data.label)
    } catch (e: any) {
      setVideo({ inputPath, status: 'error', error: e?.message, updatedAt: Date.now() })
      return
    }
    setVideo({ inputPath, status: 'running', updatedAt: Date.now() })
    const job: Promise<MuseScriptVideo> = generateMuseVideo(body)
      .then((r) => ({
        inputPath,
        status: 'done' as const,
        paths: r.paths,
        reply: r.reply ?? undefined,
        sessionId: r.sessionId,
        updatedAt: Date.now(),
      }))
      .catch((e: any) => ({ inputPath, status: 'error' as const, error: e?.message || 'Muse lỗi', updatedAt: Date.now() }))
    await runs.start(flight, job)
  }, [config, data.label, text, flight, refs, runs, setVideo, vState, video])

  /** Nối lại các ảnh tham chiếu đang nối vào node Kịch bản video nguồn (giữ thứ tự của nó). */
  const copyParentRefs = useCallback(() => {
    if (!parentId) return
    const nodes = getNodes() as any[]
    const current = getEdges()
    const add: Edge[] = []
    for (const e of current) {
      if (e.target !== parentId || (e.targetHandle ?? '') !== MUSE_HANDLE.refsIn) continue
      const c = { source: e.source, target: id, sourceHandle: e.sourceHandle ?? null, targetHandle: MUSE_HANDLE.refsIn }
      if (isValidMuseConnection(c, nodes, [...current, ...add] as any)) {
        add.push(museEdge(e.source, id, e.sourceHandle ?? undefined, MUSE_HANDLE.refsIn) as Edge)
      }
    }
    if (add.length) addEdges(add)
    const parentOrder = normalizeScriptData(parent?.data as Record<string, unknown>).order
    if (parentOrder.length) updateNodeData(id, { order: parentOrder })
  }, [addEdges, getEdges, getNodes, id, parent, parentId, updateNodeData])
  const parentRefCount = useMemo(
    () => (parentId ? getEdges().filter((e) => e.target === parentId && e.targetHandle === MUSE_HANDLE.refsIn).length : 0),
    // tính lại khi số dây vào node này đổi / đổi nguồn
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [parentId, refIds.length, parent],
  )

  function applyNewer() {
    if (!newer?.text) return
    if (edited && !window.confirm('Thay bằng bản mới? Phần bạn đã sửa trong node này sẽ mất.')) return
    updateNodeData(id, {
      text: newer.text,
      originalText: newer.text,
      path: newer.path ?? '',
      origin: { scriptNodeId: parentId, updatedAt: newer.updatedAt },
    })
  }

  async function copyText() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard bị chặn: bỏ qua */
    }
  }

  function downloadText() {
    const base = (data.label.trim() || data.path.split(/[\\/]/).pop()?.replace(/\.md$/i, '') || 'kich_ban').replace(/[\\/:*?"<>|]/g, '_')
    const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `${base}${edited ? '_da_sua' : ''}.md`
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const collapsed = data.collapsed
  const videoPaths = video?.status === 'done' ? video.paths ?? [] : []
  const mainVideo = videoPaths[videoPaths.length - 1]
  const elapsed = vRunning ? Math.max(0, Math.round((now - (video?.updatedAt || now)) / 1000)) : 0
  const canMake = blockers.length === 0 && ['pending', 'done', 'stale', 'error', 'interrupted'].includes(vState)
  const runLabel = vRunning
    ? `Muse đang làm video… ${elapsed}s`
    : vState === 'pending' || vState === 'no_text' || vState === 'too_many' || vState === 'no_image'
      ? `Tạo video${refs.length ? ` (${refs.length} ảnh tham chiếu)` : ''}`
      : 'Tạo lại video'
  const videoStatus =
    vState === 'done'
      ? `Video xong${videoPaths.length > 1 ? ` · ${videoPaths.length} clip` : ''}`
      : vState === 'stale'
        ? 'Video cũ (kịch bản / ảnh đã đổi)'
        : vState === 'error' || vState === 'interrupted'
          ? 'Video lỗi'
          : vRunning
            ? `Đang làm video… ${elapsed}s`
            : 'Chưa có video'

  const videoNodeButton =
    vState === 'done' && mainVideo ? (
      videoNode ? (
        <button type="button" className="mc-mini-btn nodrag" onClick={() => focusNode(videoNode.id)} title="Đến node Video kết quả của lần tạo này">
          <LocateFixed size={11} /> Xem node
        </button>
      ) : (
        <button type="button" className="mc-mini-btn mc-mini-accent nodrag" onClick={spawnVideoNode} title="Tách video này ra node “Video kết quả” riêng">
          <ArrowUpRight size={11} /> Ra node
        </button>
      )
    ) : null

  const runButton = (
    <button
      type="button"
      className="mc-run-btn mc-run-video nodrag"
      disabled={!canMake}
      onClick={makeVideo}
      title="Gửi kịch bản + mọi ảnh tham chiếu trong 1 lần Muse; tải về mọi clip Muse trả. Đã gửi thì không tự gửi lại."
    >
      {vRunning ? <Loader2 size={13} className="animate-spin" /> : <Clapperboard size={13} />} {runLabel}
    </button>
  )

  return (
    <div className={`mc-node mc-node-scripttext ${collapsed ? 'mc-collapsed' : ''} ${selected ? 'selected' : ''}`}>
      <MusePromptPort linked={linked} label="Kịch bản thay thế" top={portTops[0]} />
      <MuseMediaPort type="target" position={Position.Left} id={MUSE_HANDLE.scriptIn} kind="Text" label="Kịch bản" style={{ top: portTops[1] }} title="Từ node Kịch bản video" />
      <MuseMediaPort
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.refsIn}
        kind="Image"
        label="Tham chiếu"
        style={{ top: portTops[2] }}
        title="Tham chiếu cho video: nối Ảnh kết quả, Nhân vật tham chiếu, Trang phục (nhiều dây)"
      />

      <div className="mc-node-head">
        <MuseMediaIcon kind="Video" />
        <div className="mc-node-titles">
          <strong>{data.label.trim() || data.title}</strong>
          <small title={when}>{parentId ? `Từ Kịch bản video · ${when}` : `Kịch bản video · ${when} (đã gỡ dây nguồn)`}</small>
        </div>
        <button
          type="button"
          className="mc-collapse-btn nodrag"
          onClick={() => updateNodeData(id, { collapsed: !collapsed })}
          title={collapsed ? 'Mở rộng node' : 'Thu gọn node'}
        >
          {collapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
        </button>
        <NodeDeleteButton
          nodeId={id}
          confirmText={edited ? 'Xóa node Kịch bản? Phần bạn đã sửa sẽ mất (bản gốc vẫn còn ở file .md).' : undefined}
        />
      </div>

      {collapsed ? (
        <div className="mc-node-body mc-collapsed-body">
          <div className="mc-collapsed-row">
            <span className="mc-thumbs">
              {refs.slice(0, 6).map((r) =>
                r.image ? (
                  <img key={r.sourceNodeId} src={museMediaUrl(r.image.previewUrl)} alt={r.label} title={r.label} draggable={false} />
                ) : (
                  <span key={r.sourceNodeId} className="mc-xph"><ImageOff size={10} /></span>
                ),
              )}
              {refs.length > 6 && <small>+{refs.length - 6}</small>}
            </span>
            <span className="mc-collapsed-meta">
              {text.length.toLocaleString('vi-VN')} ký tự{edited ? ' · đã sửa' : ''} · {refs.length} ảnh
              <small className={`mc-vstat mc-vstat-${vState}`}>{videoStatus}</small>
            </span>
            {videoNodeButton && <span className="mc-script-tools">{videoNodeButton}</span>}
          </div>
          {runButton}
        </div>
      ) : (
        <div className="mc-node-body">
          <input
            className="mc-node-input nodrag"
            value={data.label}
            maxLength={80}
            placeholder="Tên kịch bản (tùy chọn), vd. 3 bộ xanh – bản 1"
            onChange={(e) => updateNodeData(id, { label: e.target.value })}
          />

          {newer && (
            <div className="mc-output-newer">
              <span>Kịch bản video vừa viết lại, có bản mới hơn.</span>
              <button type="button" className="mc-mini-btn mc-mini-accent nodrag" onClick={applyNewer}>
                <RefreshCw size={11} /> Dùng bản mới
              </button>
            </div>
          )}

          {/* Kịch bản */}
          <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowText((v) => !v)}>
            {showText ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Kịch bản
            <span className={`mc-node-badge ${edited ? 'custom' : ''}`}>{linked ? 'Từ Ô prompt' : edited ? 'Đã sửa' : 'Bản Muse'}</span>
            <small className="mc-xtoggle-hint">{text.length.toLocaleString('vi-VN')} ký tự</small>
          </button>
          {showText && (
            <>
              <div className="mc-script-status">
                <span className="mc-script-tools">
                  {edited && (
                    <button
                      type="button"
                      className="mc-mini-btn nodrag"
                      onClick={() => window.confirm('Bỏ phần đã sửa, quay về bản Muse trả?') && updateNodeData(id, { text: data.originalText })}
                      title="Quay về bản Muse trả"
                    >
                      <RotateCcw size={11} /> Bản gốc
                    </button>
                  )}
                  <button type="button" className="mc-mini-btn nodrag" onClick={copyText} disabled={!text} title="Chép toàn bộ kịch bản">
                    {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Đã chép' : 'Chép'}
                  </button>
                  <button type="button" className="mc-mini-btn nodrag" onClick={downloadText} disabled={!text} title="Tải về (.md)">
                    <Download size={11} /> .md
                  </button>
                  <button type="button" className="mc-mini-btn nodrag" onClick={() => setExpanded((v) => !v)} title={expanded ? 'Thu gọn ô chữ' : 'Mở rộng ô chữ'}>
                    {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                  </button>
                </span>
              </div>
              <textarea
                className={`mc-prompt mc-script-edit nodrag nowheel ${expanded ? 'expanded' : ''}`}
                value={text}
                readOnly={!!linked}
                spellCheck={false}
                disabled={vRunning}
                onChange={(e) => updateNodeData(id, { text: e.target.value })}
                placeholder="Kịch bản trống."
              />
              {!linked && data.path && <div className="mc-node-meta mc-script-path" title={data.path}>{data.path}</div>}
            </>
          )}

          {/* Ảnh tham chiếu cho video */}
          <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowRefs((v) => !v)}>
            {showRefs ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Ảnh tham chiếu cho video
            <span className="mc-node-badge">{refs.length}</span>
            <small className="mc-xtoggle-hint">gửi theo thứ tự</small>
          </button>
          {showRefs && (
            <div className="mc-script-list">
              {refs.length === 0 ? (
                <div className="mc-script-none">
                  Chưa nối ảnh — kéo dây từ “Ảnh kết quả”, “Nhân vật tham chiếu” hoặc “Trang phục” vào cổng “Tham chiếu”.
                  {parentRefCount > 0 && (
                    <button type="button" className="mc-mini-btn mc-mini-accent nodrag mc-copy-refs" onClick={copyParentRefs}>
                      <Link2 size={11} /> Nối {parentRefCount} ảnh như Kịch bản video
                    </button>
                  )}
                </div>
              ) : (
                refs.map((r, i) => (
                  <div key={r.sourceNodeId} className="mc-script-item">
                    <span className="mc-script-no">#{i + 1}</span>
                    {r.image ? (
                      <a href={museMediaUrl(r.image.previewUrl)} target="_blank" rel="noreferrer" className="nodrag" title="Mở ảnh">
                        <img src={museMediaUrl(r.image.previewUrl)} alt={r.label} draggable={false} />
                      </a>
                    ) : (
                      <span className="mc-xph"><ImageOff size={13} /></span>
                    )}
                    <span className="mc-script-label" title={r.label}>
                      {r.label}
                      <small><span className={`mc-ref-kind mc-ref-${r.kind}`}>{SCRIPT_REF_KINDS[r.kind].vi}</span></small>
                    </span>
                    <span className="mc-script-move">
                      <button
                        type="button"
                        className="mc-mini-btn nodrag"
                        disabled={i === 0 || vRunning}
                        onClick={() => updateNodeData(id, { order: moveScriptRef(refs, r.sourceNodeId, -1) })}
                        title="Đưa lên trước"
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        type="button"
                        className="mc-mini-btn nodrag"
                        disabled={i === refs.length - 1 || vRunning}
                        onClick={() => updateNodeData(id, { order: moveScriptRef(refs, r.sourceNodeId, 1) })}
                        title="Đưa xuống sau"
                      >
                        <ArrowDown size={11} />
                      </button>
                    </span>
                  </div>
                ))
              )}
            </div>
          )}

          {/* Video */}
          {blockers.length > 0 && <div className="mc-node-error">{blockers[0]}</div>}
          {vState === 'too_many' && <div className="mc-node-error">Tối đa {SCRIPT_MAX_REFS} ảnh tham chiếu mỗi lần gửi — gỡ bớt dây.</div>}
          {vState === 'no_image' && <div className="mc-node-error">Có node tham chiếu chưa có ảnh.</div>}
          {vState === 'no_text' && <div className="mc-node-error">Kịch bản đang trống.</div>}
          {runButton}

          {video && !vRunning && (
            <div className={`mc-script-result mc-x-${vState}`}>
              <div className="mc-script-status">
                {vState === 'done' && <><Check size={12} /> {videoStatus} · {new Date(video.updatedAt).toLocaleTimeString('vi-VN')}</>}
                {vState === 'stale' && <><AlertTriangle size={12} /> Kịch bản / ảnh tham chiếu đã đổi — video dưới đây là bản cũ</>}
                {(vState === 'error' || vState === 'interrupted') && <><AlertTriangle size={12} /> {video.error || 'Lỗi'}</>}
                {videoPaths.length > 0 && (
                  <span className="mc-script-tools">
                    {videoNodeButton}
                    <button type="button" className="mc-mini-btn nodrag" onClick={() => openMuseVideoFolder()} title="Mở thư mục video Muse">
                      <FolderOpen size={11} /> Thư mục
                    </button>
                  </span>
                )}
              </div>
              {mainVideo && (
                <video
                  key={mainVideo}
                  className={`mc-video nodrag ${vState === 'stale' ? 'dim' : ''}`}
                  src={museMediaUrl(museVideoStreamPath(mainVideo))}
                  controls
                  preload="metadata"
                />
              )}
              {videoPaths.length > 1 && (
                <div className="mc-clip-list">
                  {videoPaths.map((p, i) => (
                    <a key={p} className="mc-mini-btn nodrag" href={museMediaUrl(museVideoStreamPath(p))} target="_blank" rel="noreferrer" title={p}>
                      {i === videoPaths.length - 1 ? 'Bản chính' : `Clip ${i + 1}`}
                    </a>
                  ))}
                </div>
              )}
              {mainVideo && <div className="mc-node-meta mc-script-path" title={mainVideo}>{basename(mainVideo)}</div>}
              {video.reply && <div className="mc-video-reply" title="Muse trả lời kèm video">{video.reply.slice(0, 400)}</div>}
            </div>
          )}
          <p className="mc-hint">
            “Tạo video” gửi kịch bản (bản đang sửa) + mọi ảnh tham chiếu trong 1 lần Muse; Muse làm từng đoạn rồi ghép, app tải về mọi clip
            (cuối = bản chính). Đã gửi thì không tự gửi lại.
          </p>
        </div>
      )}

      <MuseMediaPort
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.videoOut}
        kind="Video"
        label="Video kết quả"
        title="Video — nối tới node “Video kết quả” (hoặc bấm “Ra node” ở phần video)"
      />
    </div>
  )
}

export const MuseScriptTextNode = memo(MuseScriptTextNodeImpl)
