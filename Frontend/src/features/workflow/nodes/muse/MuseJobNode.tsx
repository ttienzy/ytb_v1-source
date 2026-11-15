/**
 * Node chạy Muse của Muse Canvas: "Tách áo quần" và "Bảng thiết kế nhân vật" (JOB_SPECS quyết định chữ / prompt).
 * Nhận dây từ nhiều node ảnh vào cùng họ. Với MỖI ảnh vào: gửi Muse (prompt của node + ảnh đó) → 1 ảnh.
 * Kết quả lưu theo id node nguồn; từng dòng đã xong có thể tách ra node "Ảnh kết quả" (nối dây từ cổng ra).
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import {
  Handle,
  Position,
  useNodeConnections,
  useNodesData,
  useReactFlow,
  type Edge,
  type Node,
  type NodeProps,
} from '@xyflow/react'
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  ImageOff,
  LayoutPanelLeft,
  Link2Off,
  Loader2,
  LocateFixed,
  Play,
  RotateCcw,
  Save,
  Scissors,
} from 'lucide-react'
import {
  IMAGE_PROVIDERS,
  INPUT_SPECS,
  JOB_SPECS,
  MUSE_HANDLE,
  MUSE_NODE,
  PROVIDER_LABEL,
  activePrompt,
  buildGptJobRequest,
  buildJobRequest,
  buildJobRows,
  extractInputsFromSources,
  extractOutputs,
  extractRowState,
  findOutputNodeFor,
  inputsToRun,
  markInterrupted,
  normalizeJobData,
  planOutputNodes,
  rowFingerprint,
  secondaryInputsFromSources,
  type ExtractInput,
  type MuseExtractResult,
  type MuseImageProvider,
  type MuseNodeLike,
} from '../../services/museCanvasNodes.ts'
import { fetchMusePrompt, generateGptImage, generateMuseImage, museMediaUrl, saveMusePromptDefault } from '../../services/museCanvasApi.ts'
import { notifyImageLibraryChanged } from '../../services/imageLibraryApi'
import { useMuseCanvas } from '../../components/museCanvasContext'
import { NodeDeleteButton } from './NodeDeleteButton'

type JobNode = Node<Record<string, unknown>, string>

/**
 * Lượt chạy đang chờ Muse, giữ ở cấp module: đổi tab làm node bị gỡ khỏi màn hình nhưng request vẫn chạy;
 * khi node hiện lại, nó gắn tiếp vào promise thay vì báo "gián đoạn" (tránh người dùng chạy lại → tốn lượt).
 */
const inflight = new Map<string, Promise<MuseExtractResult>>()
const flightKey = (nodeId: string, sourceId: string) => `${nodeId}::${sourceId}`

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

function MuseJobNodeImpl({ id, type, data: raw, selected }: NodeProps<JobNode>) {
  const { updateNodeData, getNodes, getNode, addNodes, addEdges, setCenter } = useReactFlow()
  const { config, blockers } = useMuseCanvas()
  const spec = JOB_SPECS[type] ?? JOB_SPECS[MUSE_NODE.extract]
  const rowLabel = INPUT_SPECS[spec.inputType].rowLabel
  const isCharacter = type === MUSE_NODE.characterSheet
  const data = normalizeJobData(raw, spec.type)
  const [busy, setBusy] = useState<'' | 'reset' | 'save'>('')
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [showPrompt, setShowPrompt] = useState(true)
  const [showSecondary, setShowSecondary] = useState(false)
  const sec = spec.secondary
  const [now, setNow] = useState(Date.now())

  // Đầu vào = các node ảnh vào đang nối vào cổng (theo thứ tự dây).
  const connections = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.imagesIn })
  const sourceIds = useMemo(() => connections.map((c) => c.source), [connections])
  const sources = useNodesData(sourceIds)
  const primary = useMemo(
    () =>
      extractInputsFromSources(
        sources.filter(Boolean).map((s) => ({ id: s!.id, type: s!.type, data: s!.data as Record<string, unknown> })),
        rowLabel,
        spec.inputType,
      ),
    [sources, rowLabel, spec.inputType],
  )

  // Cổng phụ (vd. trang phục đã tách → Bảng thiết kế nhân vật): mỗi cặp chính × phụ là 1 dòng.
  const secConnections = useNodeConnections({ handleType: 'target', handleId: sec?.handle ?? MUSE_HANDLE.outfitsIn })
  const secIds = useMemo(() => (sec ? secConnections.map((c) => c.source) : []), [sec, secConnections])
  const secSources = useNodesData(secIds)
  const secondary = useMemo(
    () =>
      secondaryInputsFromSources(
        secSources.filter(Boolean).map((s) => ({ id: s!.id, type: s!.type, data: s!.data as Record<string, unknown> })),
        sec?.rowLabel,
      ),
    [secSources, sec],
  )
  const inputs = useMemo(() => buildJobRows(primary, secondary), [primary, secondary])

  // Các node Ảnh kết quả đang nối từ cổng ra -> biết dòng nào đã "ra node".
  const outConnections = useNodeConnections({ handleType: 'source', handleId: MUSE_HANDLE.jobOut })
  const outIds = useMemo(() => outConnections.map((c) => c.target), [outConnections])
  const outNodes = useNodesData(outIds)
  const outputNodeOf = useCallback(
    (sourceId: string) =>
      findOutputNodeFor(
        outNodes.filter(Boolean).map((n) => ({ id: n!.id, type: n!.type, position: { x: 0, y: 0 }, data: n!.data as Record<string, unknown> })),
        id,
        sourceId,
      ),
    [id, outNodes],
  )

  const setResult = useCallback(
    (r: MuseExtractResult) =>
      updateNodeData(id, (node) => ({
        results: { ...normalizeJobData(node.data as Record<string, unknown>, spec.type).results, [r.sourceNodeId]: r },
      })),
    [id, spec.type, updateNodeData],
  )

  // Mở lại canvas: lượt còn "running" mà không còn request nào chờ -> gián đoạn; còn request -> gắn tiếp.
  useEffect(() => {
    const results = normalizeJobData(raw, spec.type).results
    const orphaned: Record<string, MuseExtractResult> = {}
    for (const [src, r] of Object.entries(results)) {
      if (r.status !== 'running') continue
      const p = inflight.get(flightKey(id, src))
      if (p) p.then(setResult)
      else orphaned[src] = r
    }
    const fixed = markInterrupted(orphaned)
    if (fixed) updateNodeData(id, { results: { ...results, ...fixed } })
    // Node tạo trước khi có cổng phụ: nạp prompt kết hợp mặc định từ file
    if (spec.secondary && typeof (raw as Record<string, unknown>).secondaryPrompt !== 'string') {
      fetchMusePrompt(spec.secondary.promptName)
        .then((p) => updateNodeData(id, { secondaryPrompt: p.prompt, secondaryPromptSource: 'default' }))
        .catch(() => {})
    }
    // Node chưa có prompt GPT riêng (node mới, hoặc tạo trước khi có công tắc): nạp prompt GPT mặc định
    const rawGpt = (raw as Record<string, unknown>).gptPrompt
    if (spec.gptPromptName && (typeof rawGpt !== 'string' || !rawGpt.trim()) && (raw as Record<string, unknown>).gptPromptSource !== 'custom') {
      fetchMusePrompt(spec.gptPromptName)
        .then((p) => updateNodeData(id, { gptPrompt: p.prompt, gptPromptSource: 'default' }))
        .catch(() => {})
    }
    // chỉ chạy khi node gắn lên màn hình
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const anyRunning = Object.values(data.results).some((r) => r.status === 'running')
  useEffect(() => {
    if (!anyRunning) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [anyRunning])

  const runOne = useCallback(
    async (input: ExtractInput) => {
      const key = flightKey(id, input.sourceNodeId)
      if (inflight.has(key) || !input.image) return
      const provider: MuseImageProvider = data.provider
      const ap = activePrompt(spec, data)
      const extraPrompt = ap.useSecondary ? data.secondaryPrompt : ''
      let body: Record<string, unknown>
      try {
        body = provider === 'gpt'
          ? buildGptJobRequest(spec, config, ap.text, input, extraPrompt)
          : buildJobRequest(spec, config, ap.text, input, extraPrompt)
      } catch (e: any) {
        setResult({ sourceNodeId: input.sourceNodeId, inputPath: rowFingerprint(input), status: 'error', error: e?.message, provider, updatedAt: Date.now() })
        return
      }
      const inputPath = rowFingerprint(input)
      setResult({ sourceNodeId: input.sourceNodeId, inputPath, status: 'running', provider, updatedAt: Date.now() })
      const job: Promise<MuseExtractResult> = (provider === 'gpt' ? generateGptImage(body) : generateMuseImage(body))
        .then((r) => ({
          sourceNodeId: input.sourceNodeId,
          inputPath,
          status: 'done' as const,
          output: { id: `${Date.now().toString(36)}`, name: basename(r.path), path: r.path, previewUrl: r.previewUrl, size: r.size },
          sessionId: r.sessionId,
          provider,
          updatedAt: Date.now(),
        }))
        .catch((e: any) => ({
          sourceNodeId: input.sourceNodeId,
          inputPath,
          status: 'error' as const,
          error: e?.message || `${PROVIDER_LABEL[provider]} lỗi`,
          provider,
          updatedAt: Date.now(),
        }))
        .finally(() => inflight.delete(key))
      inflight.set(key, job)
      const done = await job
      setResult(done)
      if (done.status === 'done') notifyImageLibraryChanged()
    },
    [config, data.prompt, data.gptPrompt, data.provider, data.secondaryPrompt, id, setResult, spec],
  )

  /** Chạy nhiều ảnh vào, tối đa `maxParallel` lượt cùng lúc (mỗi tài khoản Muse/ChatGPT chạy 1 lượt một lúc). */
  const runMany = useCallback(
    async (list: ExtractInput[]) => {
      const queue = [...list]
      const workers = Array.from({ length: Math.max(1, Math.min(config.maxParallel, queue.length)) }, async () => {
        while (queue.length) await runOne(queue.shift()!)
      })
      await Promise.all(workers)
    },
    [config.maxParallel, runOne],
  )

  /** Tách dòng đã xong ra node "Ảnh kết quả" (only = 1 dòng; bỏ trống = mọi dòng chưa ra node). */
  const spawnOutputs = useCallback(
    (only?: string) => {
      const self = getNode(id)
      if (!self) return
      const job: MuseNodeLike & { width?: number } = {
        id,
        type,
        position: self.position,
        data: self.data as Record<string, unknown>,
        width: self.measured?.width ?? self.width,
      }
      const plan = planOutputNodes(job, inputs, data.results, getNodes() as unknown as MuseNodeLike[], only)
      if (!plan.nodes.length) return
      addNodes(plan.nodes as Node[])
      addEdges(plan.edges as Edge[])
    },
    [addEdges, addNodes, data.results, getNode, getNodes, id, inputs, type],
  )

  const focusNode = useCallback(
    (nodeId: string) => {
      const n = getNode(nodeId)
      if (!n) return
      const w = n.measured?.width ?? 280
      const h = n.measured?.height ?? 300
      setCenter(n.position.x + w / 2, n.position.y + h / 2, { zoom: 1, duration: 400 })
    },
    [getNode, setCenter],
  )

  async function resetToDefault(which: 'main' | 'secondary' = 'main') {
    setBusy('reset')
    setNote(null)
    try {
      if (which === 'secondary' && spec.secondary) {
        const p = await fetchMusePrompt(spec.secondary.promptName)
        updateNodeData(id, { secondaryPrompt: p.prompt, secondaryPromptSource: 'default' })
        setNote({ kind: 'ok', text: 'Đã nạp prompt kết hợp mặc định.' })
        return
      }
      const ap = activePrompt(spec, data)
      const p = await fetchMusePrompt(ap.promptName)
      updateNodeData(id, { [ap.field]: p.prompt, [ap.sourceField]: 'default' })
      const gptTag = ap.gptOwn ? ' GPT' : ''
      setNote({ kind: 'ok', text: p.is_custom ? `Đã nạp prompt${gptTag} mặc định bạn đã lưu.` : `Đã nạp prompt${gptTag} mặc định gốc.` })
    } catch (e: any) {
      setNote({ kind: 'err', text: e?.message || 'Không tải được prompt mặc định' })
    } finally {
      setBusy('')
    }
  }

  async function saveAsDefault(which: 'main' | 'secondary' = 'main') {
    setBusy('save')
    setNote(null)
    try {
      if (which === 'secondary' && spec.secondary) {
        await saveMusePromptDefault(spec.secondary.promptName, data.secondaryPrompt)
        updateNodeData(id, { secondaryPromptSource: 'default' })
        setNote({ kind: 'ok', text: 'Đã lưu prompt kết hợp làm mặc định.' })
        return
      }
      const ap = activePrompt(spec, data)
      await saveMusePromptDefault(ap.promptName, ap.text)
      updateNodeData(id, { [ap.sourceField]: 'default' })
      setNote({ kind: 'ok', text: `Đã lưu làm prompt${ap.gptOwn ? ' GPT' : ''} mặc định cho các node mới.` })
    } catch (e: any) {
      setNote({ kind: 'err', text: e?.message || 'Không lưu được' })
    } finally {
      setBusy('')
    }
  }

  const toRun = inputsToRun(inputs, data.results)
  const outputs = extractOutputs(inputs, data.results)
  const notSpawned = inputs.filter((i) => extractRowState(i, data.results) === 'done' && !outputNodeOf(i.sourceNodeId))
  const ap = activePrompt(spec, data)
  const promptEmpty = !ap.text.trim()
  const isGpt = data.provider === 'gpt'
  // Prompt GPT riêng gọi tên "Image 2" = trang phục: dòng không có trang phục thì thiếu ảnh 2
  const gptNeedsOutfit = ap.gptOwn && !!sec && inputs.length > 0 && secondary.length === 0
  // Chặn do tài khoản Muse chỉ áp cho chế độ Muse; chế độ GPT báo lỗi tài khoản ChatGPT ngay ở dòng chạy.
  const runBlockers = isGpt ? [] : blockers
  const blocked = runBlockers.length > 0 || promptEmpty
  const unitCost = isGpt ? 'lượt tạo ảnh ChatGPT' : 'lượt Muse'
  const hasResults = Object.keys(data.results).length > 0
  const Icon = isCharacter ? LayoutPanelLeft : Scissors

  return (
    <div className={`mc-node mc-node-extract ${isCharacter ? 'mc-node-charsheet' : ''} ${selected ? 'selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.imagesIn}
        className={`mc-handle ${isCharacter ? 'mc-handle-character' : 'mc-handle-image'}`}
        style={sec ? { top: 40 } : undefined}
        title={`Nối từ node ${INPUT_SPECS[spec.inputType].title} (nhiều dây được)`}
      />
      {sec && (
        <>
          <span className="mc-port-label" style={{ top: 30 }}>{INPUT_SPECS[spec.inputType].rowLabel}</span>
          <Handle
            type="target"
            position={Position.Left}
            id={sec.handle}
            className="mc-handle mc-handle-prompt"
            style={{ top: 120 }}
            title={`${sec.title}: nối từ node “Ảnh kết quả” của Tách áo quần — mỗi cặp nhân vật × trang phục ra 1 bảng`}
          />
          <span className="mc-port-label mc-port-secondary" style={{ top: 110 }}>{sec.rowLabel}</span>
        </>
      )}

      <div className="mc-node-head">
        <span className={`mc-node-icon ${isCharacter ? 'mc-icon-charsheet' : 'mc-icon-prompt'}`}><Icon size={14} /></span>
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small>{spec.subtitle}</small>
        </div>
        {notSpawned.length > 0 && (
          <button
            type="button"
            className="mc-mini-btn nodrag"
            onClick={() => spawnOutputs()}
            title="Tách mọi ảnh đã xong (chưa có node) ra node “Ảnh kết quả”"
          >
            <ArrowUpRight size={12} /> Tất cả ra node
          </button>
        )}
        <span className="mc-node-count" title="Ảnh đã tạo / ảnh vào">{outputs.length}/{inputs.length}</span>
        <NodeDeleteButton
          nodeId={id}
          confirmText={hasResults ? `Xóa node ${data.title}? Kết quả trên canvas sẽ mất (ảnh vẫn còn trong Thư Viện Ảnh).` : undefined}
        />
      </div>

      <div className="mc-node-body">
        {/* Công tắc tạo ảnh: Muse | GPT (áp cho lần chạy sau; kết quả cũ giữ nguyên) */}
        <div className="mc-provider nodrag" role="radiogroup" aria-label="Tạo ảnh bằng">
          <span className="mc-provider-label">Tạo ảnh bằng</span>
          <div className="mc-provider-seg">
            {IMAGE_PROVIDERS.map((p) => (
              <button
                key={p.id}
                type="button"
                role="radio"
                aria-checked={data.provider === p.id}
                className={`mc-provider-opt ${data.provider === p.id ? 'active' : ''} mc-provider-${p.id}`}
                onClick={() => data.provider !== p.id && updateNodeData(id, { provider: p.id })}
                title={p.title}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Đầu vào → đầu ra */}
        {inputs.length === 0 ? (
          <div className="mc-inputs-empty">
            <Link2Off size={12} /> {spec.emptyText}
          </div>
        ) : (
          <div className="mc-xrows">
            {inputs.map((input) => {
              const state = extractRowState(input, data.results)
              const r = data.results[input.sourceNodeId]
              const canRun = !blocked && !!input.image && state !== 'running'
              const outNode = state === 'done' ? outputNodeOf(input.sourceNodeId) : undefined
              return (
                <div key={input.sourceNodeId} className={`mc-xrow mc-x-${state}`}>
                  <div className="mc-xcell">
                    <span className="mc-xstack">
                      {input.image ? (
                        <img src={museMediaUrl(input.image.previewUrl)} alt={input.label} title={input.image.name} draggable={false} />
                      ) : (
                        <span className="mc-xph"><ImageOff size={14} /></span>
                      )}
                      {(input.extra ?? []).map((x) =>
                        x.image ? (
                          <img key={x.sourceNodeId} className="mc-xextra" src={museMediaUrl(x.image.previewUrl)} alt={x.label} title={x.label} draggable={false} />
                        ) : (
                          <span key={x.sourceNodeId} className="mc-xph mc-xextra"><ImageOff size={11} /></span>
                        ),
                      )}
                    </span>
                    <span className="mc-xlabel" title={input.label}>{input.label}</span>
                  </div>
                  <ArrowRight size={13} className="mc-xarrow" />
                  <div className="mc-xcell">
                    {state === 'running' ? (
                      <span className="mc-xph mc-xrun">
                        <Loader2 size={14} className="animate-spin" />
                      </span>
                    ) : r?.output && (state === 'done' || state === 'stale') ? (
                      <a href={museMediaUrl(r.output.previewUrl)} target="_blank" rel="noreferrer" className="nodrag" title="Mở ảnh">
                        <img src={museMediaUrl(r.output.previewUrl)} alt="Ảnh kết quả" draggable={false} className={state === 'stale' ? 'dim' : ''} />
                      </a>
                    ) : (
                      <span className="mc-xph">{state === 'error' || state === 'interrupted' ? <AlertTriangle size={14} /> : '—'}</span>
                    )}
                    <span className="mc-xstatus" title={r?.error || undefined}>
                      {state === 'running'
                        ? `Đang chạy… ${Math.max(0, Math.round((now - (r?.updatedAt || now)) / 1000))}s`
                        : state === 'done'
                          ? `${spec.doneText} · ${PROVIDER_LABEL[r?.provider ?? 'muse']}`
                          : state === 'error' || state === 'interrupted'
                            ? r?.error || 'Lỗi'
                            : state === 'no_image'
                              ? 'Node nguồn chưa có ảnh'
                              : state === 'stale'
                                ? 'Ảnh vào đã đổi — cần chạy lại'
                                : 'Chưa chạy'}
                    </span>
                  </div>
                  <div className="mc-xbtns">
                    {state === 'done' &&
                      (outNode ? (
                        <button type="button" className="mc-mini-btn nodrag" onClick={() => focusNode(outNode.id)} title="Đến node Ảnh kết quả của dòng này">
                          <LocateFixed size={11} /> Xem node
                        </button>
                      ) : (
                        <button type="button" className="mc-mini-btn mc-mini-accent nodrag" onClick={() => spawnOutputs(input.sourceNodeId)} title="Tách ảnh này ra node “Ảnh kết quả” riêng">
                          <ArrowUpRight size={11} /> Ra node
                        </button>
                      ))}
                    <button
                      type="button"
                      className="mc-mini-btn nodrag"
                      disabled={!canRun}
                      onClick={() => runOne(input)}
                      title={state === 'pending' ? `Chạy dòng này (tốn 1 ${unitCost})` : `Chạy lại (tốn thêm 1 ${unitCost})`}
                    >
                      {state === 'pending' ? <Play size={11} /> : <RotateCcw size={11} />}
                      {state === 'pending' ? 'Chạy' : 'Chạy lại'}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Prompt */}
        <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowPrompt((v) => !v)}>
          {showPrompt ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Prompt
          {spec.gptPromptName && (
            <span className={`mc-node-badge mc-badge-${data.provider}`} title={ap.gptOwn ? 'Prompt riêng của chế độ GPT' : 'Prompt của chế độ Muse'}>
              {PROVIDER_LABEL[data.provider]}
            </span>
          )}
          <span className={`mc-node-badge ${ap.source === 'custom' ? 'custom' : ''}`}>
            {ap.source === 'custom' ? 'Đã sửa' : 'Mặc định'}
          </span>
        </button>
        {showPrompt && (
          <>
            <textarea
              className="mc-prompt nodrag nowheel"
              value={ap.text}
              rows={10}
              spellCheck={false}
              onChange={(e) => updateNodeData(id, { [ap.field]: e.target.value, [ap.sourceField]: 'custom' })}
              placeholder={ap.gptOwn ? 'Đang nạp prompt GPT mặc định… (hoặc gõ prompt cho ChatGPT)' : `Prompt gửi kèm từng ảnh cho ${PROVIDER_LABEL[data.provider]}…`}
            />
            {ap.gptOwn && (
              <div className={gptNeedsOutfit ? 'mc-node-error' : 'mc-node-meta'}>
                {gptNeedsOutfit
                  ? 'Prompt GPT dùng ảnh 1 = nhân vật, ảnh 2 = trang phục — hãy nối trang phục vào cổng “Trang phục”.'
                  : 'Chế độ GPT dùng prompt riêng (ảnh 1 = nhân vật, ảnh 2 = trang phục), không ghép prompt kết hợp.'}
              </div>
            )}
            <div className="mc-node-actions">
              <span className="mc-node-meta">{ap.text.length.toLocaleString('vi-VN')} ký tự</span>
              <button type="button" className="mc-mini-btn nodrag" onClick={() => resetToDefault()} disabled={!!busy} title="Thay nội dung bằng prompt mặc định">
                {busy === 'reset' ? <Loader2 size={12} className="animate-spin" /> : <RotateCcw size={12} />} Mặc định
              </button>
              <button type="button" className="mc-mini-btn nodrag" onClick={() => saveAsDefault()} disabled={!!busy || promptEmpty} title="Dùng nội dung này làm prompt mặc định cho node mới">
                {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : <Save size={12} />} Lưu làm mặc định
              </button>
            </div>
          </>
        )}

        {/* Prompt ghép thêm khi dòng có ảnh phụ (trang phục) — chế độ GPT có prompt riêng thì không dùng */}
        {sec && ap.useSecondary && (
          <>
            <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowSecondary((v) => !v)}>
              {showSecondary ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Prompt kết hợp {sec.rowLabel.toLowerCase()}
              <span className={`mc-node-badge ${data.secondaryPromptSource === 'custom' ? 'custom' : ''}`}>
                {data.secondaryPromptSource === 'custom' ? 'Đã sửa' : 'Mặc định'}
              </span>
              <small className="mc-xtoggle-hint">{secondary.length ? `ghép vào ${inputs.length} dòng` : 'dùng khi nối trang phục'}</small>
            </button>
            {showSecondary && (
              <>
                <textarea
                  className="mc-prompt mc-prompt-sm nodrag nowheel"
                  value={data.secondaryPrompt}
                  rows={6}
                  spellCheck={false}
                  onChange={(e) => updateNodeData(id, { secondaryPrompt: e.target.value, secondaryPromptSource: 'custom' })}
                  placeholder="Câu dặn Muse cho nhân vật mặc đúng trang phục ở ảnh thứ hai…"
                />
                <div className="mc-node-actions">
                  <span className="mc-node-meta">Ghép sau prompt chính khi dòng có ảnh {sec.rowLabel.toLowerCase()}</span>
                  <button type="button" className="mc-mini-btn nodrag" onClick={() => resetToDefault('secondary')} disabled={!!busy}>
                    <RotateCcw size={12} /> Mặc định
                  </button>
                  <button type="button" className="mc-mini-btn nodrag" onClick={() => saveAsDefault('secondary')} disabled={!!busy || !data.secondaryPrompt.trim()}>
                    <Save size={12} /> Lưu làm mặc định
                  </button>
                </div>
              </>
            )}
          </>
        )}
        {note && <div className={note.kind === 'ok' ? 'mc-node-ok' : 'mc-node-error'}>{note.text}</div>}

        {/* Chạy */}
        {runBlockers.length > 0 && <div className="mc-node-error">{runBlockers[0]}</div>}
        <button
          type="button"
          className={`mc-run-btn nodrag ${isCharacter ? 'mc-run-character' : ''}`}
          disabled={blocked || toRun.length === 0}
          onClick={() => runMany(toRun)}
          title="Chỉ chạy dòng chưa chạy hoặc đã đổi ảnh. Dòng lỗi bấm “Chạy lại” riêng."
        >
          {anyRunning ? <Loader2 size={13} className="animate-spin" /> : <Icon size={13} />}
          {toRun.length > 0
            ? `${spec.runVerb} ${toRun.length} ${spec.unitNoun}`
            : anyRunning
              ? 'Đang chạy…'
              : `Không còn ${spec.unitNoun} cần chạy`}
        </button>
        <p className="mc-hint">
          Mỗi {spec.unitNoun} tốn 1 {unitCost}{isGpt ? ' (tài khoản ở Cài đặt → Tài khoản ChatGPT)' : ''}.{sec ? ` Nối ${sec.rowLabel.toLowerCase()} vào cổng phụ: mỗi cặp ${rowLabel.toLowerCase()} × ${sec.rowLabel.toLowerCase()} ra 1 ${spec.unitNoun}.` : ''} Đã gửi thì không tự gửi lại; song song tối đa {config.maxParallel} (panel cấu hình). Ảnh
          ra tự lưu vào Thư Viện Ảnh; “Ra node” tách ảnh thành node riêng.
        </p>
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.jobOut}
        className="mc-handle mc-handle-prompt"
        title={`Ảnh kết quả (${outputs.length}) — nối tới node “Ảnh kết quả”`}
      />
    </div>
  )
}

export const MuseJobNode = memo(MuseJobNodeImpl)
