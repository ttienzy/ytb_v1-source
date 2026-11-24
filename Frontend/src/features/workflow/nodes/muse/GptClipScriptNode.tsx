/**
 * Node "Kịch bản tạo video" của Muse Canvas — độc lập với node "Kịch bản video" (Muse), dùng tài khoản ChatGPT.
 * Cổng "Tham chiếu" (nhiều dây, thứ tự xếp được): mỗi ảnh = 1 clip. 1 lượt ChatGPT viết N kịch bản clip ≤ 15 s
 * (Omni 1.2 trên Flow), tự chọn độ dài từng clip và thiết kế mối nối giữa clip k và k+1 (prompt mặc định
 * Backend/prompts/workflow/gpt_clip_script_prompt.txt). App tách bài theo dòng "=== SCRIPT k/N …" và kiểm tra
 * số clip, số giây, mốc thời gian; mỗi clip có prompt video để chép sang Flow.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Position, useNodeConnections, useNodesData, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { MuseMediaIcon, MuseMediaPort } from './MuseMediaPort'
import {
  AlertTriangle,
  ArrowUpRight,
  LocateFixed,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clapperboard,
  Copy,
  Film,
  Download,
  ImageOff,
  Link2Off,
  Loader2,
  MapPin,
  RotateCcw,
  Save,
} from 'lucide-react'
import {
  CLIP_SCRIPT_MAX_REFS,
  CLIP_SCRIPT_SPEC,
  MUSE_HANDLE,
  MUSE_NODE,
  SCRIPT_REF_KINDS,
  buildClipScriptContext,
  buildClipScriptRequest,
  linkedPromptKey,
  clipCredits720p,
  clipsCredits,
  fixedClipSeconds,
  clipScriptFingerprint,
  clipScriptState,
  clipSentPaths,
  findClipPromptNodeFor,
  interruptClipScript,
  planClipPromptNodes,
  planMergeNode,
  type MuseNodeLike,
  moveScriptRef,
  normalizeClipMergeData,
  normalizeClipScriptData,
  parseClipScript,
  scriptRefsFromSources,
  splitClipRefs,
  type MuseScriptResult,
} from '../../services/museCanvasNodes.ts'
import { fetchMusePrompt, generateGptClipScript, museMediaUrl, saveMusePromptDefault } from '../../services/museCanvasApi.ts'
import { useMuseCanvas } from '../../components/museCanvasContext'
import { NodeDeleteButton } from './NodeDeleteButton'
import { MusePromptPort, useLinkedPrompt } from './MusePromptPort'
import { museInputPortTops } from '../../services/museCanvasNodes.ts'
import { useMuseRuns } from './useMuseRuns'
import { runKey } from '../../services/museRunRegistry.ts'

type ClipScriptNode = Node<Record<string, unknown>, string>

// Lượt ChatGPT đang chờ nằm ở `museRuns` (đổi tab / đổi project / HMR không làm mất; node hiện lại thì nhận tiếp).

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

function GptClipScriptNodeImpl({ id, data: raw, selected }: NodeProps<ClipScriptNode>) {
  const { updateNodeData, getNode, getNodes, addNodes, addEdges, setCenter } = useReactFlow()
  const { config } = useMuseCanvas()
  const data = normalizeClipScriptData(raw)
  const linked = useLinkedPrompt()
  const portTops = museInputPortTops(['Text', 'Image'])
  const prompt = linked?.text ?? data.prompt
  const promptKey = linkedPromptKey(linked?.text)
  const [showPrompt, setShowPrompt] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [showRefs, setShowRefs] = useState(true)
  const [showIntro, setShowIntro] = useState(false)
  const [showOutro, setShowOutro] = useState(false)
  const [showFull, setShowFull] = useState(false)
  const [openClip, setOpenClip] = useState<Record<number, boolean>>({})
  const [busy, setBusy] = useState<'' | 'reset' | 'save'>('')
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [copied, setCopied] = useState<string>('')
  const [now, setNow] = useState(Date.now())

  const conns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.refsIn })
  const srcIds = useMemo(() => conns.map((c) => c.source), [conns])
  const srcNodes = useNodesData(srcIds)
  const orderKey = data.order.join(',')
  // Mọi ảnh nối vào; `refs` = ảnh clip (#k = clip k), `scenes` = ảnh Tham chiếu bối cảnh (dùng chung, không thành clip)
  const allRefs = useMemo(
    () =>
      scriptRefsFromSources(
        srcNodes.filter(Boolean).map((n) => ({ id: n!.id, type: n!.type, data: n!.data as Record<string, unknown> })),
        orderKey ? orderKey.split(',') : [],
      ),
    [srcNodes, orderKey],
  )
  const { clips: refs, scenes } = useMemo(() => splitClipRefs(allRefs), [allRefs])

  const result = data.result
  const state = clipScriptState(allRefs, result, promptKey)
  const parsed = useMemo(
    () => (result?.text ? parseClipScript(result.text, clipSentPaths(result.inputPath).length || refs.length) : null),
    [result?.text, result?.inputPath, refs.length],
  )
  const setResult = useCallback((r: MuseScriptResult) => updateNodeData(id, { result: r }), [id, updateNodeData])
  const runs = useMuseRuns<MuseScriptResult>((_key, r) => setResult(r))
  const flight = runKey.clipScript(id)

  // Node Clip đã tách từ lần viết hiện tại (nối ở cổng ra "clips")
  const outConns = useNodeConnections({ handleType: 'source', handleId: MUSE_HANDLE.clipOut })
  const outIds = useMemo(() => outConns.map((c) => c.target), [outConns])
  const outNodes = useNodesData(outIds)
  const clipNodeOf = useCallback(
    (k: number) =>
      result?.status === 'done'
        ? findClipPromptNodeFor(
            outNodes.filter(Boolean).map((n) => ({ id: n!.id, type: n!.type, position: { x: 0, y: 0 }, data: n!.data as Record<string, unknown> })),
            id,
            result.updatedAt,
            k,
          )
        : undefined,
    [id, outNodes, result],
  )

  /** Tách clip ra node "Clip" riêng (only = 1 clip; bỏ trống = mọi clip chưa có node). */
  const spawnClips = useCallback(
    (only?: number) => {
      const self = getNode(id)
      if (!self) return
      const plan = planClipPromptNodes(
        { id, type: self.type, position: self.position, data: self.data as Record<string, unknown>, width: self.measured?.width ?? self.width },
        refs,
        getNodes() as unknown as MuseNodeLike[],
        only,
      )
      if (!plan.nodes.length) return
      addNodes(plan.nodes as Node[])
      addEdges(plan.edges as Edge[])
    },
    [addEdges, addNodes, getNode, getNodes, id, refs],
  )

  /** Tạo node "Ghép video" nối sẵn từ mọi node Clip của node này (đã có thì không tạo thêm). */
  const spawnMerge = useCallback(() => {
    const self = getNode(id)
    if (!self) return
    const plan = planMergeNode(
      { id, type: self.type, position: self.position, data: self.data as Record<string, unknown>, width: self.measured?.width ?? self.width },
      getNodes() as unknown as MuseNodeLike[],
    )
    if (!plan) {
      // đã có node Ghép video của node này (hoặc chưa có node Clip nào): dẫn tới node đã có
      const existing = getNodes().find((n) => n.type === MUSE_NODE.clipMerge && normalizeClipMergeData(n.data as Record<string, unknown>).origin?.clipScriptNodeId === id)
      if (existing) setCenter(existing.position.x + (existing.measured?.width ?? 520) / 2, existing.position.y + 300, { zoom: 0.8, duration: 400 })
      return
    }
    addNodes([plan.node as Node])
    addEdges(plan.edges as Edge[])
  }, [addEdges, addNodes, getNode, getNodes, id, setCenter])

  const focusNode = useCallback(
    (nodeId: string) => {
      const n = getNode(nodeId)
      if (!n) return
      setCenter(n.position.x + (n.measured?.width ?? 440) / 2, n.position.y + (n.measured?.height ?? 400) / 2, { zoom: 1, duration: 400 })
    },
    [getNode, setCenter],
  )

  // Mở lại canvas: còn "running" mà không còn request chờ -> gián đoạn; còn request -> gắn tiếp.
  useEffect(() => {
    const r = normalizeClipScriptData(raw).result
    if (r?.status !== 'running') return
    if (!runs.resume(flight)) {
      const fixed = interruptClipScript(r)
      if (fixed) setResult(fixed)
    }
    // chỉ chạy khi node gắn lên màn hình
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const running = state === 'running'
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  const run = useCallback(async () => {
    if (runs.isRunning(flight)) return
    if (result && state !== 'pending') {
      const ok = window.confirm(
        state === 'error' || state === 'interrupted'
          ? 'Lần trước có thể ĐÃ gửi tới ChatGPT (xem lịch sử chat trên ChatGPT trước). Vẫn gửi lại? Tốn thêm 1 lượt.'
          : 'Viết lại kịch bản? Tốn thêm 1 lượt ChatGPT, bản hiện tại sẽ bị thay (file .md cũ vẫn còn).',
      )
      if (!ok) return
    }
    const inputPath = clipScriptFingerprint(allRefs)
    let body: Record<string, unknown>
    try {
      body = buildClipScriptRequest(config, prompt, allRefs, data.notes, config.flowSeconds)
    } catch (e: any) {
      setResult({ inputPath, status: 'error', error: e?.message, updatedAt: Date.now() })
      return
    }
    setResult({ inputPath, promptKey, status: 'running', updatedAt: Date.now() })
    const job: Promise<MuseScriptResult> = generateGptClipScript(body)
      .then((r) => ({ inputPath, promptKey, status: 'done' as const, text: r.text, path: r.path, accountLabel: r.accountLabel, updatedAt: Date.now() }))
      .catch((e: any) => ({ inputPath, status: 'error' as const, error: e?.message || 'ChatGPT lỗi', updatedAt: Date.now() }))
    setOpenClip({})
    await runs.start(flight, job)
  }, [allRefs, config, data.notes, flight, prompt, promptKey, result, runs, setResult, state])

  async function resetToDefault() {
    setBusy('reset')
    setNote(null)
    try {
      const p = await fetchMusePrompt(CLIP_SCRIPT_SPEC.promptName)
      updateNodeData(id, { prompt: p.prompt, promptSource: 'default' })
      setNote({ kind: 'ok', text: p.is_custom ? 'Đã nạp prompt mặc định bạn đã lưu.' : 'Đã nạp prompt mặc định gốc.' })
    } catch (e: any) {
      setNote({ kind: 'err', text: e?.message || 'Không tải được prompt mặc định' })
    } finally {
      setBusy('')
    }
  }

  async function saveAsDefault() {
    setBusy('save')
    setNote(null)
    try {
      await saveMusePromptDefault(CLIP_SCRIPT_SPEC.promptName, data.prompt)
      updateNodeData(id, { promptSource: 'default' })
      setNote({ kind: 'ok', text: 'Đã lưu làm prompt mặc định cho các node Kịch bản tạo video mới.' })
    } catch (e: any) {
      setNote({ kind: 'err', text: e?.message || 'Không lưu được' })
    } finally {
      setBusy('')
    }
  }

  async function copy(key: string, text: string) {
    if (await copyToClipboard(text)) {
      setCopied(key)
      setTimeout(() => setCopied((k) => (k === key ? '' : k)), 1500)
    } else setNote({ kind: 'err', text: 'Không chép được vào clipboard.' })
  }

  function downloadText() {
    if (!result?.text) return
    const name = result.path?.split(/[\\/]/).pop() || `kich_ban_clip_${new Date().toISOString().slice(0, 10)}.md`
    const url = URL.createObjectURL(new Blob([result.text], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const promptEmpty = !prompt.trim()
  const canRun = !promptEmpty && ['pending', 'done', 'stale', 'error', 'interrupted'].includes(state)
  const context = useMemo(() => buildClipScriptContext(allRefs, data.notes, config.flowSeconds), [allRefs, data.notes, config.flowSeconds])
  const fixedSec = fixedClipSeconds(config.flowSeconds)
  const elapsed = running ? Math.max(0, Math.round((now - (result?.updatedAt || now)) / 1000)) : 0
  const collapsed = data.collapsed
  const allPrompts = parsed?.clips.map((c) => `# Clip ${c.k}/${c.n} — ${c.name} — ${c.seconds ?? '?'}s\n${c.videoPrompt}`).join('\n\n') ?? ''
  // Chỉ tách ra node khi bài khớp ảnh hiện tại (bản cũ thì ảnh #k có thể đã đổi)
  const canSpawn = state === 'done' && !!parsed?.clips.length
  const notSpawned = canSpawn ? parsed!.clips.filter((c) => !clipNodeOf(c.k)) : []

  const runButton = (
    <button
      type="button"
      className="mc-run-btn mc-run-clipscript nodrag"
      disabled={!canRun}
      onClick={run}
      title="Gửi mọi ảnh tham chiếu trong 1 lượt ChatGPT, nhận về 1 kịch bản cho mỗi ảnh. Đã gửi thì không tự gửi lại."
    >
      {running ? <Loader2 size={13} className="animate-spin" /> : <Clapperboard size={13} />}
      {running
        ? `ChatGPT đang viết… ${elapsed}s`
        : state === 'done' || state === 'stale' || state === 'error' || state === 'interrupted'
          ? 'Viết lại kịch bản'
          : `Viết ${refs.length || ''} kịch bản clip`.replace('  ', ' ')}
    </button>
  )
  const statusText =
    state === 'done'
      ? `${parsed?.clips.length ?? 0} clip · ${parsed?.totalSeconds ?? 0}s`
      : state === 'stale'
        ? 'Kịch bản cũ (prompt hoặc ảnh đã đổi)'
        : state === 'error' || state === 'interrupted'
          ? 'Lỗi — mở node để xem'
          : running
            ? `Đang viết… ${elapsed}s`
            : 'Chưa viết'

  return (
    <div className={`mc-node mc-node-script mc-node-clipscript ${collapsed ? 'mc-collapsed' : ''} ${selected ? 'selected' : ''}`}>
      <MusePromptPort linked={linked} top={portTops[0]} />
      <MuseMediaPort
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.refsIn}
        kind="Image"
        label="Tham chiếu"
        style={{ top: portTops[1] }}
        title="Tham chiếu: mỗi ảnh nối vào = 1 clip (thường là Ảnh kết quả của Bảng thiết kế nhân vật). Xếp thứ tự trong node."
      />

      <div className="mc-node-head">
        <MuseMediaIcon kind="Text" />
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small>{CLIP_SCRIPT_SPEC.subtitle}</small>
        </div>
        {notSpawned.length > 0 && (
          <button type="button" className="mc-mini-btn nodrag" onClick={() => spawnClips()} title="Tách mọi clip chưa có node ra node “Clip” riêng">
            <ArrowUpRight size={12} /> Tất cả ra node
          </button>
        )}
        {outNodes.length > 0 && (
          <button type="button" className="mc-mini-btn mc-mini-accent nodrag" onClick={spawnMerge} title="Tạo node “Ghép video” nối sẵn từ các node Clip (ghép các video đã tạo, xóa watermark, thêm nhạc)">
            <Film size={12} /> Ghép video
          </button>
        )}
        <span className="mc-node-count" title="Số ảnh tham chiếu = số clip">{refs.length} clip</span>
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
          confirmText={result?.text ? 'Xóa node Kịch bản tạo video? Kịch bản trên canvas sẽ mất (file .md vẫn còn trong Data/media/muse_texts).' : undefined}
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
              {refs.length} ảnh tham chiếu{scenes.length ? ` + ${scenes.length} bối cảnh` : ''}
              <small className={`mc-vstat mc-vstat-${state}`}>{statusText}</small>
            </span>
          </div>
          {runButton}
        </div>
      ) : (
        <div className="mc-node-body">
          {/* Ảnh tham chiếu: mỗi ảnh 1 clip, đúng thứ tự */}
          <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowRefs((v) => !v)}>
            {showRefs ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Tham chiếu → clip
            <span className="mc-node-badge">{refs.length}</span>
            <small className="mc-xtoggle-hint">ảnh #k = clip k</small>
          </button>
          {showRefs && (
            <div className="mc-script-list">
              {refs.length === 0 ? (
                <div className="mc-inputs-empty">
                  <Link2Off size={12} /> Chưa có ảnh — nối dây từ node “Ảnh kết quả” (bảng thiết kế) vào cổng “Tham chiếu”. Mỗi ảnh là 1 clip; ảnh từ node “Tham chiếu bối cảnh” dùng chung cho mọi clip.
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
                      <small>
                        <span className={`mc-ref-kind mc-ref-${r.kind}`}>{SCRIPT_REF_KINDS[r.kind].vi}</span>
                      </small>
                    </span>
                    <span className="mc-script-move">
                      <button
                        type="button"
                        className="mc-mini-btn nodrag"
                        disabled={i === 0 || running}
                        onClick={() => updateNodeData(id, { order: moveScriptRef(refs, r.sourceNodeId, -1) })}
                        title="Đưa lên trước"
                      >
                        <ArrowUp size={11} />
                      </button>
                      <button
                        type="button"
                        className="mc-mini-btn nodrag"
                        disabled={i === refs.length - 1 || running}
                        onClick={() => updateNodeData(id, { order: moveScriptRef(refs, r.sourceNodeId, 1) })}
                        title="Đưa xuống sau"
                      >
                        <ArrowDown size={11} />
                      </button>
                    </span>
                  </div>
                ))
              )}
              {scenes.map((r) => (
                <div key={r.sourceNodeId} className="mc-script-item mc-script-scene" title="Ảnh bối cảnh dùng chung cho mọi clip — không thành clip riêng">
                  <span className="mc-script-no">
                    <MapPin size={11} />
                  </span>
                  {r.image ? (
                    <a href={museMediaUrl(r.image.previewUrl)} target="_blank" rel="noreferrer" className="nodrag" title="Mở ảnh">
                      <img src={museMediaUrl(r.image.previewUrl)} alt={r.label} draggable={false} />
                    </a>
                  ) : (
                    <span className="mc-xph"><ImageOff size={13} /></span>
                  )}
                  <span className="mc-script-label" title={r.label}>
                    {r.label}
                    <small>
                      <span className="mc-ref-kind mc-ref-scene">{SCRIPT_REF_KINDS.scene.vi}</span> dùng chung mọi clip
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}

          <label className="mc-script-notes">
            <span>Ghi chú (tùy chọn, gửi kèm)</span>
            <textarea
              className="mc-prompt mc-prompt-sm nodrag nowheel"
              rows={2}
              value={data.notes}
              spellCheck={false}
              disabled={running}
              placeholder="Vd. chỉ dùng 6/8/10s; ảnh 2 và 3 cùng một bộ; muốn vòng lặp (clip cuối nối về clip đầu); tông vui tươi…"
              onChange={(e) => updateNodeData(id, { notes: e.target.value })}
            />
          </label>

          <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowPrompt((v) => !v)}>
            {showPrompt ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Prompt
            <span className={`mc-node-badge ${data.promptSource === 'custom' ? 'custom' : ''}`}>
              {linked ? 'Từ Ô prompt' : data.promptSource === 'custom' ? 'Đã sửa' : 'Mặc định'}
            </span>
            <small className="mc-xtoggle-hint">{prompt.length.toLocaleString('vi-VN')} ký tự</small>
          </button>
          {showPrompt && (
            <>
              <textarea
                className="mc-prompt nodrag nowheel"
                value={prompt}
                readOnly={!!linked}
                rows={12}
                spellCheck={false}
                onChange={(e) => updateNodeData(id, { prompt: e.target.value, promptSource: 'custom' })}
                placeholder="Prompt yêu cầu ChatGPT viết kịch bản từng clip…"
              />
              <div className="mc-node-actions">
                <span className="mc-node-meta">File gốc: gpt_clip_script_prompt.txt</span>
                <button type="button" className="mc-mini-btn nodrag" onClick={resetToDefault} disabled={!!linked || !!busy}>
                  {busy === 'reset' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Mặc định
                </button>
                  <button type="button" className="mc-mini-btn nodrag" onClick={saveAsDefault} disabled={!!linked || !!busy || promptEmpty}>
                  {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Lưu làm mặc định
                </button>
              </div>
            </>
          )}

          <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowContext((v) => !v)}>
            {showContext ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Đoạn tự gửi kèm sau prompt
            <small className="mc-xtoggle-hint">danh sách ảnh #k · số kịch bản · ghi chú</small>
          </button>
          {showContext && <pre className="mc-script-context nodrag nowheel">{context}</pre>}
          {note && <div className={note.kind === 'ok' ? 'mc-node-ok' : 'mc-node-error'}>{note.text}</div>}

          {fixedSec > 0 && (
            <div className="mc-node-meta" title="Đổi ở Cấu hình → Google Flow → Thời lượng (Tự động = ChatGPT tự chọn 3–15 giây)">
              Thời lượng cố định: mỗi clip đúng {fixedSec}s · ≈{clipCredits720p(fixedSec)} credit/clip (720p)
            </div>
          )}
          {state === 'too_many' && <div className="mc-node-error">Tối đa {CLIP_SCRIPT_MAX_REFS} ảnh mỗi lượt ChatGPT (tính cả ảnh bối cảnh) — gỡ bớt dây.</div>}
          {state === 'no_refs' && scenes.length > 0 && (
            <div className="mc-node-error">Mới có ảnh bối cảnh — nối thêm ảnh cho từng clip (vd. Ảnh kết quả bảng thiết kế).</div>
          )}
          {state === 'no_image' && <div className="mc-node-error">Có node nối vào chưa có ảnh.</div>}
          {runButton}

          {/* Kết quả */}
          {result && !running && (
            <div className={`mc-script-result mc-x-${state}`}>
              <div className="mc-script-status">
                {state === 'done' && (
                  <>
                    <Check size={12} /> Đã viết · {new Date(result.updatedAt).toLocaleTimeString('vi-VN')}
                    {result.accountLabel ? ` · ${result.accountLabel}` : ''}
                  </>
                )}
                {state === 'stale' && <><AlertTriangle size={12} /> Prompt hoặc ảnh tham chiếu đã đổi. Hãy viết lại kịch bản.</>}
                {(state === 'error' || state === 'interrupted') && <><AlertTriangle size={12} /> {result.error || 'Lỗi'}</>}
                {result.text && (
                  <span className="mc-script-tools">
                    {!!parsed?.clips.length && (
                      <button type="button" className="mc-mini-btn nodrag" onClick={() => copy('all-prompts', allPrompts)} title="Chép prompt video của mọi clip">
                        {copied === 'all-prompts' ? <Check size={11} /> : <Copy size={11} />} Mọi prompt
                      </button>
                    )}
                    <button type="button" className="mc-mini-btn nodrag" onClick={() => copy('all', result.text!)} title="Chép toàn bộ bài">
                      {copied === 'all' ? <Check size={11} /> : <Copy size={11} />} Bài
                    </button>
                    <button type="button" className="mc-mini-btn nodrag" onClick={downloadText} title="Tải bài về (.md)">
                      <Download size={11} /> .md
                    </button>
                  </span>
                )}
              </div>

              {parsed && (
                <>
                  {!!parsed.clips.length && (
                    <div className="mc-clip-summary">
                      <strong>{parsed.clips.length} clip</strong> · tổng {parsed.totalSeconds}s · ≈ {clipsCredits(parsed.clips.map((c) => c.seconds))} credit Flow (720p, ước tính)
                    </div>
                  )}
                  {parsed.warnings.map((w) => (
                    <div key={w} className="mc-node-error">{w}</div>
                  ))}

                  {parsed.intro && (
                    <>
                      <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowIntro((v) => !v)}>
                        {showIntro ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Tổng quan · nhân vật · kế hoạch chuyển cảnh
                      </button>
                      {showIntro && <pre className={`mc-script-text nodrag nowheel ${state === 'stale' ? 'dim' : ''}`}>{parsed.intro}</pre>}
                    </>
                  )}

                  {parsed.clips.map((c) => {
                    const open = !!openClip[c.k]
                    const total = c.seconds || c.beats[c.beats.length - 1]?.to || 1
                    return (
                      <div key={`${c.k}-${c.name}`} className={`mc-clip-card ${c.warnings.length ? 'warn' : ''} ${state === 'stale' ? 'dim' : ''}`}>
                        <div className="mc-clip-head">
                          <span className="mc-clip-no">Clip {c.k}/{c.n}</span>
                          <span className="mc-clip-name" title={c.name}>{c.name || `REF #${c.ref ?? c.k}`}</span>
                          <span className="mc-clip-sec" title="Độ dài clip / credit Flow ước tính (720p)">
                            {c.seconds ?? '?'}s{c.seconds ? ` · ≈${clipCredits720p(c.seconds)}cr` : ''}
                          </span>
                        </div>
                        {c.beats.length > 0 && (
                          <div className="mc-clip-timeline" title={c.beats.map((b) => `${b.from}–${b.to}s`).join(' · ')}>
                            {c.beats.map((b, i) => (
                              <span
                                key={i}
                                className={`mc-clip-seg ${i === 0 ? 'in' : i === c.beats.length - 1 ? 'out' : ''}`}
                                style={{ flexGrow: Math.max(0.1, b.to - b.from) }}
                              >
                                {b.from}–{b.to}s
                              </span>
                            ))}
                          </div>
                        )}
                        {total > 0 && c.beats.length === 0 && <div className="mc-node-meta">Chưa có mốc thời gian trong prompt.</div>}
                        {c.warnings.map((w) => (
                          <div key={w} className="mc-clip-warn"><AlertTriangle size={11} /> {w}</div>
                        ))}
                        {c.videoPrompt && <pre className="mc-clip-prompt nodrag nowheel">{c.videoPrompt}</pre>}
                        <div className="mc-node-actions">
                          <button
                            type="button"
                            className="mc-mini-btn nodrag"
                            onClick={() => setOpenClip((o) => ({ ...o, [c.k]: !o[c.k] }))}
                            title="Hiện timeline, lý do độ dài, chi tiết phải thấy"
                          >
                            {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />} Chi tiết
                          </button>
                          <button
                            type="button"
                            className="mc-mini-btn nodrag"
                            disabled={!c.videoPrompt}
                            onClick={() => copy(`clip-${c.k}`, c.videoPrompt)}
                            title="Chép prompt video của clip này (dán vào Flow kèm ảnh tham chiếu #k)"
                          >
                            {copied === `clip-${c.k}` ? <Check size={11} /> : <Copy size={11} />} Chép prompt
                          </button>
                          {canSpawn &&
                            (clipNodeOf(c.k) ? (
                              <button type="button" className="mc-mini-btn nodrag" onClick={() => focusNode(clipNodeOf(c.k)!.id)} title="Đến node Clip của clip này">
                                <LocateFixed size={11} /> Xem node
                              </button>
                            ) : (
                              <button type="button" className="mc-mini-btn mc-mini-accent nodrag" onClick={() => spawnClips(c.k)} title="Tách clip này ra node “Clip” riêng (sửa prompt / số giây được)">
                                <ArrowUpRight size={11} /> Ra node
                              </button>
                            ))}
                        </div>
                        {open && <pre className="mc-script-text nodrag nowheel">{c.body}</pre>}
                      </div>
                    )
                  })}

                  {parsed.outro && (
                    <>
                      <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowOutro((v) => !v)}>
                        {showOutro ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Ghép video
                      </button>
                      {showOutro && <pre className="mc-script-text nodrag nowheel">{parsed.outro}</pre>}
                    </>
                  )}
                </>
              )}

              {result.text && (
                <>
                  <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowFull((v) => !v)}>
                    {showFull ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Bài đầy đủ ChatGPT trả
                  </button>
                  {showFull && <pre className={`mc-script-text nodrag nowheel ${state === 'stale' ? 'dim' : ''}`}>{result.text}</pre>}
                </>
              )}
              {result.path && <div className="mc-node-meta mc-script-path" title={result.path}>{result.path}</div>}
            </div>
          )}
          <p className="mc-hint">
            1 lượt ChatGPT (tài khoản ở Cài đặt → Tài khoản ChatGPT), không cần tài khoản Muse. Mỗi ảnh tham chiếu ra 1 kịch bản clip
            ≤ 15 s cho Omni 1.2 trên Flow; ChatGPT tự chọn độ dài và thiết kế mối nối giữa các clip. App kiểm tra số clip, số giây và
            mốc thời gian; credit chỉ là ước tính ở 720p. Đã gửi thì không tự gửi lại. Bài cũng được lưu thành file .md.
          </p>
        </div>
      )}

      <MuseMediaPort
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.clipOut}
        kind="Text"
        label="Kịch bản từng clip"
        title="Clip — nối tới node “Clip” (hoặc bấm “Ra node” ở từng clip)"
      />
    </div>
  )
}

export const GptClipScriptNode = memo(GptClipScriptNodeImpl)
