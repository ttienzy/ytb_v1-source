/**
 * Node "Kịch bản video" của Muse Canvas — độc lập, 1 node = 1 lần Muse ra CHỮ (không ra ảnh).
 * Cổng vào "Tham chiếu" (nhiều dây): mọi node có ảnh — Ảnh kết quả (bảng thiết kế / ảnh sản phẩm),
 * Nhân vật tham chiếu, Trang phục. Tất cả ảnh gửi CHUNG một tin theo thứ tự người dùng xếp; không ép
 * "1 ảnh = 1 bộ đồ" — Muse tự gom ảnh cùng bộ, tự đếm số bộ.
 * Gửi: prompt của node + đoạn tự sinh (danh sách ảnh kèm vai trò, ghi chú). Kết quả: kịch bản (backend lưu .md).
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Handle, Position, useNodeConnections, useNodesData, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import {
  AlertTriangle,
  ArrowUpRight,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Copy,
  Download,
  FileText,
  ImageOff,
  Link2Off,
  Loader2,
  LocateFixed,
  Maximize2,
  Minimize2,
  RotateCcw,
  Save,
} from 'lucide-react'
import {
  MUSE_HANDLE,
  SCRIPT_MAX_REFS,
  SCRIPT_REF_KINDS,
  SCRIPT_SPEC,
  buildScriptContext,
  buildScriptRequest,
  findScriptTextNodeFor,
  interruptScript,
  planScriptTextNode,
  moveScriptRef,
  normalizeScriptData,
  scriptFingerprint,
  scriptRefsFromSources,
  scriptState,
  type MuseNodeLike,
  type MuseScriptResult,
} from '../../services/museCanvasNodes.ts'
import { fetchMusePrompt, generateMuseText, museMediaUrl, saveMusePromptDefault } from '../../services/museCanvasApi.ts'
import { useMuseCanvas } from '../../components/museCanvasContext'
import { NodeDeleteButton } from './NodeDeleteButton'
import { useMuseRuns } from './useMuseRuns'
import { runKey } from '../../services/museRunRegistry.ts'

type ScriptNode = Node<Record<string, unknown>, string>

// Lượt viết đang chờ Muse nằm ở `museRuns` (đổi tab / đổi project / HMR không làm mất; node hiện lại thì nhận tiếp).

function MuseScriptNodeImpl({ id, data: raw, selected }: NodeProps<ScriptNode>) {
  const { updateNodeData, getNode, getNodes, addNodes, addEdges, setCenter } = useReactFlow()
  const { config, blockers } = useMuseCanvas()
  const data = normalizeScriptData(raw)
  const [showPrompt, setShowPrompt] = useState(false)
  const [showContext, setShowContext] = useState(false)
  const [showRefs, setShowRefs] = useState(true)
  const [showResult, setShowResult] = useState(true)
  const [expanded, setExpanded] = useState(false)
  const [busy, setBusy] = useState<'' | 'reset' | 'save'>('')
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const [now, setNow] = useState(Date.now())

  // Mọi ảnh tham chiếu nối vào cổng "Tham chiếu", theo thứ tự người dùng xếp
  const conns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.refsIn })
  const srcIds = useMemo(() => conns.map((c) => c.source), [conns])
  const srcNodes = useNodesData(srcIds)
  const orderKey = data.order.join(',')
  const refs = useMemo(
    () =>
      scriptRefsFromSources(
        srcNodes.filter(Boolean).map((n) => ({ id: n!.id, type: n!.type, data: n!.data as Record<string, unknown> })),
        orderKey ? orderKey.split(',') : [],
      ),
    [srcNodes, orderKey],
  )

  const result = data.result
  const state = scriptState(refs, result)

  // Node "Kịch bản" đã tách từ lần viết hiện tại (nối ở cổng ra script)?
  const outConns = useNodeConnections({ handleType: 'source', handleId: MUSE_HANDLE.scriptOut })
  const outIds = useMemo(() => outConns.map((c) => c.target), [outConns])
  const outNodes = useNodesData(outIds)
  const textNode = useMemo(
    () =>
      result?.status === 'done'
        ? findScriptTextNodeFor(
            outNodes.filter(Boolean).map((n) => ({ id: n!.id, type: n!.type, position: { x: 0, y: 0 }, data: n!.data as Record<string, unknown> })),
            id,
            result.updatedAt,
          )
        : undefined,
    [id, outNodes, result],
  )

  /** Tách kịch bản hiện tại ra node "Kịch bản" riêng (nối dây từ cổng ra). */
  const spawnTextNode = useCallback(() => {
    const self = getNode(id)
    if (!self) return
    const plan = planScriptTextNode(
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
      setCenter(n.position.x + (n.measured?.width ?? 420) / 2, n.position.y + (n.measured?.height ?? 400) / 2, { zoom: 1, duration: 400 })
    },
    [getNode, setCenter],
  )
  const setResult = useCallback((r: MuseScriptResult) => updateNodeData(id, { result: r }), [id, updateNodeData])
  const runs = useMuseRuns<MuseScriptResult>((_key, r) => setResult(r))
  const flight = runKey.script(id)

  // Mở lại canvas: còn "running" mà không còn request chờ -> gián đoạn; còn request -> gắn tiếp.
  useEffect(() => {
    const r = normalizeScriptData(raw).result
    if (r?.status !== 'running') return
    if (!runs.resume(flight)) {
      const fixed = interruptScript(r)
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
    if (runs.isRunning(flight)) return // đang có lượt chờ Muse: không gửi thêm
    if (result && state !== 'pending') {
      const ok = window.confirm(
        state === 'error' || state === 'interrupted'
          ? 'Lần trước có thể ĐÃ gửi tới Muse (xem chat trên Muse trước). Vẫn gửi lại? Tốn thêm 1 lượt.'
          : 'Viết lại kịch bản? Tốn thêm 1 lượt Muse, kịch bản hiện tại sẽ bị thay (file .md cũ vẫn còn).',
      )
      if (!ok) return
    }
    const inputPath = scriptFingerprint(refs)
    let body: Record<string, unknown>
    try {
      body = buildScriptRequest(config, data.prompt, refs, data.notes)
    } catch (e: any) {
      setResult({ inputPath, status: 'error', error: e?.message, updatedAt: Date.now() })
      return
    }
    setResult({ inputPath, status: 'running', updatedAt: Date.now() })
    const job: Promise<MuseScriptResult> = generateMuseText(body)
      .then((r) => ({
        inputPath,
        status: 'done' as const,
        text: r.text,
        path: r.path,
        warning: r.warning ?? undefined,
        sessionId: r.sessionId,
        updatedAt: Date.now(),
      }))
      .catch((e: any) => ({ inputPath, status: 'error' as const, error: e?.message || 'Muse lỗi', updatedAt: Date.now() }))
    await runs.start(flight, job)
  }, [config, data.notes, data.prompt, flight, refs, result, runs, setResult, state])

  async function resetToDefault() {
    setBusy('reset')
    setNote(null)
    try {
      const p = await fetchMusePrompt(SCRIPT_SPEC.promptName)
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
      await saveMusePromptDefault(SCRIPT_SPEC.promptName, data.prompt)
      updateNodeData(id, { promptSource: 'default' })
      setNote({ kind: 'ok', text: 'Đã lưu làm prompt mặc định cho các node Kịch bản mới.' })
    } catch (e: any) {
      setNote({ kind: 'err', text: e?.message || 'Không lưu được' })
    } finally {
      setBusy('')
    }
  }

  async function copyText() {
    if (!result?.text) return
    try {
      await navigator.clipboard.writeText(result.text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setNote({ kind: 'err', text: 'Không chép được vào clipboard.' })
    }
  }

  function downloadText() {
    if (!result?.text) return
    const name = result.path?.split(/[\\/]/).pop() || `kich_ban_${new Date().toISOString().slice(0, 10)}.md`
    const url = URL.createObjectURL(new Blob([result.text], { type: 'text/markdown;charset=utf-8' }))
    const a = document.createElement('a')
    a.href = url
    a.download = name
    a.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const promptEmpty = !data.prompt.trim()
  const blocked = blockers.length > 0 || promptEmpty
  const canRun = !blocked && ['pending', 'done', 'stale', 'error', 'interrupted'].includes(state)
  const context = useMemo(() => buildScriptContext(refs, data.notes), [refs, data.notes])
  const elapsed = running ? Math.max(0, Math.round((now - (result?.updatedAt || now)) / 1000)) : 0
  const collapsed = data.collapsed
  const runButton = (
    <button
      type="button"
      className="mc-run-btn mc-run-script nodrag"
      disabled={!canRun}
      onClick={run}
      title="Gửi mọi ảnh tham chiếu trong 1 lần Muse, nhận về 1 kịch bản. Đã gửi thì không tự gửi lại."
    >
      {running ? <Loader2 size={13} className="animate-spin" /> : <FileText size={13} />}
      {running
        ? `Muse đang viết… ${elapsed}s`
        : state === 'done' || state === 'stale' || state === 'error' || state === 'interrupted'
          ? 'Viết lại kịch bản'
          : `Viết kịch bản${refs.length ? ` từ ${refs.length} ảnh` : ''}`}
    </button>
  )
  const spawnButton =
    state === 'done' && result?.text ? (
      textNode ? (
        <button type="button" className="mc-mini-btn nodrag" onClick={() => focusNode(textNode.id)} title="Đến node Kịch bản của bản này">
          <LocateFixed size={11} /> Xem node
        </button>
      ) : (
        <button type="button" className="mc-mini-btn mc-mini-accent nodrag" onClick={spawnTextNode} title="Tách kịch bản này ra node “Kịch bản” riêng (sửa được)">
          <ArrowUpRight size={11} /> Ra node
        </button>
      )
    ) : null
  const statusText =
    state === 'done'
      ? `Đã viết · ${new Date(result!.updatedAt).toLocaleTimeString('vi-VN')}`
      : state === 'stale'
        ? 'Kịch bản cũ (ảnh / thứ tự đã đổi)'
        : state === 'error' || state === 'interrupted'
          ? 'Lỗi — mở node để xem'
          : running
            ? `Đang viết… ${elapsed}s`
            : 'Chưa viết'

  return (
    <div className={`mc-node mc-node-script ${collapsed ? 'mc-collapsed' : ''} ${selected ? 'selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.refsIn}
        className="mc-handle mc-handle-output"
        style={{ top: 40 }}
        title="Tham chiếu: nối mọi node có ảnh — Ảnh kết quả, Nhân vật tham chiếu, Trang phục (nhiều dây, gửi chung 1 lần)"
      />
      <span className="mc-port-label mc-port-secondary" style={{ top: 30 }}>Tham chiếu</span>

      <div className="mc-node-head">
        <span className="mc-node-icon mc-icon-script"><FileText size={14} /></span>
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small>{SCRIPT_SPEC.subtitle}</small>
        </div>
        <span className="mc-node-count" title="Số ảnh tham chiếu gửi kèm">{refs.length} ảnh</span>
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
          confirmText={result?.text ? 'Xóa node Kịch bản video? Kịch bản trên canvas sẽ mất (file .md vẫn còn trong Data/media/muse_texts).' : undefined}
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
              {refs.length} ảnh tham chiếu
              <small className={`mc-vstat mc-vstat-${state}`}>{statusText}</small>
            </span>
            <span className="mc-script-tools">
              {spawnButton}
              {result?.text && (
                <button type="button" className="mc-mini-btn nodrag" onClick={copyText} title="Chép toàn bộ kịch bản">
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                </button>
              )}
            </span>
          </div>
          {runButton}
        </div>
      ) : (
      <div className="mc-node-body">
        {/* Ảnh gửi Muse, đúng thứ tự đính kèm */}
        <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowRefs((v) => !v)}>
          {showRefs ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Ảnh tham chiếu gửi chung 1 lần
          <span className="mc-node-badge">{refs.length}</span>
          <small className="mc-xtoggle-hint">theo thứ tự</small>
        </button>
        {showRefs && (
        <div className="mc-script-list">
          {refs.length === 0 ? (
            <div className="mc-inputs-empty">
              <Link2Off size={12} /> Chưa có ảnh — nối dây từ node “Ảnh kết quả”, “Nhân vật tham chiếu” hoặc “Trang phục” vào chấm “Tham chiếu”.
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
        </div>
        )}

        {/* Ghi chú */}
        <label className="mc-script-notes">
          <span>Ghi chú thêm (tùy chọn, gửi kèm)</span>
          <textarea
            className="mc-prompt mc-prompt-sm nodrag nowheel"
            rows={2}
            value={data.notes}
            spellCheck={false}
            disabled={running}
            placeholder="Vd. ảnh 2 và 4 cùng một bộ; bộ váy xanh để cuối; giải thích bằng tiếng Việt…"
            onChange={(e) => updateNodeData(id, { notes: e.target.value })}
          />
        </label>

        {/* Prompt */}
        <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowPrompt((v) => !v)}>
          {showPrompt ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Prompt
          <span className={`mc-node-badge ${data.promptSource === 'custom' ? 'custom' : ''}`}>
            {data.promptSource === 'custom' ? 'Đã sửa' : 'Mặc định'}
          </span>
          <small className="mc-xtoggle-hint">{data.prompt.length.toLocaleString('vi-VN')} ký tự</small>
        </button>
        {showPrompt && (
          <>
            <textarea
              className="mc-prompt nodrag nowheel"
              value={data.prompt}
              rows={12}
              spellCheck={false}
              onChange={(e) => updateNodeData(id, { prompt: e.target.value, promptSource: 'custom' })}
              placeholder="Prompt yêu cầu Muse viết kịch bản…"
            />
            <div className="mc-node-actions">
              <span className="mc-node-meta">File gốc: muse_video_script_prompt.txt</span>
              <button type="button" className="mc-mini-btn nodrag" onClick={resetToDefault} disabled={!!busy}>
                {busy === 'reset' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Mặc định
              </button>
              <button type="button" className="mc-mini-btn nodrag" onClick={saveAsDefault} disabled={!!busy || promptEmpty}>
                {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Lưu làm mặc định
              </button>
            </div>
          </>
        )}

        {/* Đoạn tự sinh gửi kèm */}
        <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowContext((v) => !v)}>
          {showContext ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Đoạn tự gửi kèm sau prompt
          <small className="mc-xtoggle-hint">danh sách ảnh · ghi chú</small>
        </button>
        {showContext && <pre className="mc-script-context nodrag nowheel">{context}</pre>}
        {note && <div className={note.kind === 'ok' ? 'mc-node-ok' : 'mc-node-error'}>{note.text}</div>}

        {/* Chạy */}
        {blockers.length > 0 && <div className="mc-node-error">{blockers[0]}</div>}
        {state === 'too_many' && <div className="mc-node-error">Tối đa {SCRIPT_MAX_REFS} ảnh mỗi lần gửi — gỡ bớt dây.</div>}
        {state === 'no_image' && <div className="mc-node-error">Có node nối vào chưa có ảnh.</div>}
        {runButton}

        {/* Kết quả */}
        {result && !running && (
          <div className={`mc-script-result mc-x-${state}`}>
            <div className="mc-script-status">
              {state === 'done' && <><Check size={12} /> Đã viết · {new Date(result.updatedAt).toLocaleTimeString('vi-VN')}</>}
              {state === 'stale' && <><AlertTriangle size={12} /> Ảnh / thứ tự tham chiếu đã đổi — kịch bản dưới đây là bản cũ</>}
              {(state === 'error' || state === 'interrupted') && <><AlertTriangle size={12} /> {result.error || 'Lỗi'}</>}
              {result.text && (
                <span className="mc-script-tools">
                  {spawnButton}
                  <button type="button" className="mc-mini-btn nodrag" onClick={() => setShowResult((v) => !v)} title={showResult ? 'Ẩn bài' : 'Hiện bài'}>
                    {showResult ? <ChevronDown size={11} /> : <ChevronRight size={11} />} {showResult ? 'Ẩn' : 'Hiện'}
                  </button>
                  <button type="button" className="mc-mini-btn nodrag" onClick={copyText} title="Chép toàn bộ kịch bản">
                    {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Đã chép' : 'Chép'}
                  </button>
                  <button type="button" className="mc-mini-btn nodrag" onClick={downloadText} title="Tải kịch bản về (.md)">
                    <Download size={11} /> .md
                  </button>
                  <button type="button" className="mc-mini-btn nodrag" onClick={() => setExpanded((v) => !v)} title={expanded ? 'Thu gọn' : 'Mở rộng'}>
                    {expanded ? <Minimize2 size={11} /> : <Maximize2 size={11} />}
                  </button>
                </span>
              )}
            </div>
            {result.warning && <div className="mc-node-error">{result.warning}</div>}
            {result.text && showResult && (
              <pre className={`mc-script-text nodrag nowheel ${expanded ? 'expanded' : ''} ${state === 'stale' ? 'dim' : ''}`}>{result.text}</pre>
            )}
            {result.path && <div className="mc-node-meta mc-script-path" title={result.path}>{result.path}</div>}
          </div>
        )}
        <p className="mc-hint">
          Mọi ảnh gửi chung trong 1 lần Muse (tốn 1 lượt, ra chữ) — không cần 1 ảnh = 1 bộ: Muse tự gom ảnh cùng bộ và đếm số bộ.
          Dùng ↑ ↓ đổi thứ tự. Kịch bản cũng được lưu thành file .md; “Ra node” tách bản kịch bản ra node riêng để sửa / chép.
        </p>
      </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.scriptOut}
        className="mc-handle mc-handle-script"
        title="Kịch bản — nối tới node “Kịch bản” (hoặc bấm “Ra node”)"
      />
    </div>
  )
}

export const MuseScriptNode = memo(MuseScriptNodeImpl)
