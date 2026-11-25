/**
 * Node "Tạo ảnh tự do" của Muse Canvas (Muse | GPT): Text-to-Image (0 ảnh) hoặc Image-to-Image (1–4 ảnh).
 * - Nhận prompt từ Ô prompt (cổng Text) hoặc gõ trực tiếp; 0–4 ảnh tham chiếu (cổng Ảnh).
 * - Đầu ra nối thẳng sang Tạo video Flow (Thành phần / Khung đầu–cuối), Kịch bản, Tạo ảnh tự do khác hoặc Ra node Ảnh kết quả.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Position, useNodeConnections, useNodesData, useReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import {
  AlertTriangle,
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  ExternalLink,
  Image as ImageIcon,
  ImageOff,
  Loader2,
  LocateFixed,
  Sparkles,
} from 'lucide-react'
import { MuseMediaIcon, MuseMediaPort } from './MuseMediaPort'
import { MusePromptPort, useLinkedPrompt } from './MusePromptPort'
import { NodeDeleteButton } from './NodeDeleteButton'
import { useMuseRuns } from './useMuseRuns'
import { useMuseCanvas } from '../../components/museCanvasContext'
import { runKey } from '../../services/museRunRegistry.ts'
import { notifyImageLibraryChanged } from '../../services/imageLibraryApi'
import { generateGptImage, generateMuseImage, museMediaUrl } from '../../services/museCanvasApi.ts'
import {
  FREE_IMAGE_MAX_REFS,
  IMAGE_PROVIDERS,
  MUSE_HANDLE,
  MUSE_NODE,
  PROVIDER_LABEL,
  SCRIPT_REF_KINDS,
  buildFreeImageGptRequest,
  buildFreeImageMuseRequest,
  createOutputNode,
  freeImageFingerprint,
  freeImageState,
  moveScriptRef,
  museEdge,
  museInputPortTops,
  normalizeFreeImageData,
  normalizeOutputData,
  outputNodePosition,
  scriptRefsFromSources,
  type FreeImageAspect,
  type MuseExtractResult,
  type MuseImageProvider,
  type MuseNodeLike,
} from '../../services/museCanvasNodes.ts'

type FreeImgNode = Node<Record<string, unknown>, string>

const ASPECTS: FreeImageAspect[] = ['9:16', '16:9', '1:1']

function basename(p: string): string {
  return p.split(/[\\/]/).pop() || p
}

function MuseFreeImageNodeImpl({ id, data: raw, selected }: NodeProps<FreeImgNode>) {
  const { updateNodeData, getNode, getNodes, addNodes, addEdges, setCenter } = useReactFlow()
  const { config, blockers } = useMuseCanvas()
  const data = normalizeFreeImageData(raw)
  const linked = useLinkedPrompt()
  const prompt = linked?.text ?? data.prompt
  const portTops = museInputPortTops(['Text', 'Image'])
  const [now, setNow] = useState(Date.now())

  const iConns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.refsIn })
  const iIds = useMemo(() => iConns.map((c) => c.source), [iConns])
  const iNodes = useNodesData(iIds)
  const orderKey = data.order.join(',')
  const refs = useMemo(
    () =>
      scriptRefsFromSources(
        iNodes.filter(Boolean).map((n) => ({ id: n!.id, type: n!.type, data: n!.data as Record<string, unknown> })),
        orderKey ? orderKey.split(',') : [],
      ),
    [iNodes, orderKey],
  )

  const outConns = useNodeConnections({ handleType: 'source', handleId: MUSE_HANDLE.imageOut })
  const outIds = useMemo(() => outConns.map((c) => c.target), [outConns])
  const outNodes = useNodesData(outIds)
  const existingOutputNode = useMemo(() => {
    for (const n of outNodes) {
      if (!n || n.type !== MUSE_NODE.output) continue
      const o = normalizeOutputData(n.data as Record<string, unknown>).origin
      if (o?.jobNodeId === id) return n
    }
    return null
  }, [id, outNodes])

  const setResult = useCallback(
    (result: MuseExtractResult) => updateNodeData(id, { result }),
    [id, updateNodeData],
  )
  const runs = useMuseRuns<MuseExtractResult>((_k, r) => setResult(r))
  const flight = runKey.freeImage(id)

  useEffect(() => {
    if (data.result?.status === 'running' && !runs.resume(flight)) {
      const where = data.result.provider === 'gpt' ? 'xem lịch sử chat trên ChatGPT' : 'xem chat trên Muse'
      setResult({
        ...data.result,
        status: 'interrupted',
        error: `Lần chạy bị gián đoạn (đóng app / tải lại trang). Prompt có thể ĐÃ gửi — ${where} trước khi chạy lại.`,
        updatedAt: Date.now(),
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const state = freeImageState(prompt, data.aspect, refs, data.result)
  const running = state === 'running'

  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  const isGpt = data.provider === 'gpt'
  const runBlockers = isGpt ? [] : blockers
  const tooManyRefs = refs.length > FREE_IMAGE_MAX_REFS
  const canRun = !running && !runBlockers.length && !tooManyRefs && !!prompt.trim() && !refs.some((r) => !r.image)

  async function run() {
    if (!canRun || runs.isRunning(flight)) return
    const provider: MuseImageProvider = data.provider
    let body: Record<string, unknown>
    try {
      body =
        provider === 'gpt'
          ? buildFreeImageGptRequest(config, prompt, data.aspect, refs)
          : buildFreeImageMuseRequest(config, prompt, data.aspect, refs)
    } catch (e: any) {
      setResult({
        sourceNodeId: 'free',
        inputPath: freeImageFingerprint(prompt, data.aspect, refs),
        status: 'error',
        error: e?.message || 'Đầu vào không hợp lệ',
        provider,
        updatedAt: Date.now(),
      })
      return
    }
    const inputPath = freeImageFingerprint(prompt, data.aspect, refs)
    setResult({ sourceNodeId: 'free', inputPath, status: 'running', provider, updatedAt: Date.now() })
    const job: Promise<MuseExtractResult> = (provider === 'gpt' ? generateGptImage(body) : generateMuseImage(body))
      .then((r) => ({
        sourceNodeId: 'free',
        inputPath,
        status: 'done' as const,
        output: { id: `${Date.now().toString(36)}`, name: basename(r.path), path: r.path, previewUrl: r.previewUrl, size: r.size },
        sessionId: r.sessionId,
        provider,
        updatedAt: Date.now(),
      }))
      .catch((e: any) => ({
        sourceNodeId: 'free',
        inputPath,
        status: 'error' as const,
        error: e?.message || `${PROVIDER_LABEL[provider]} lỗi`,
        provider,
        updatedAt: Date.now(),
      }))
    const done = await runs.start(flight, job)
    if (done.status === 'done') notifyImageLibraryChanged()
  }

  function spawnOrFocusOutput() {
    if (existingOutputNode) {
      const n = getNode(existingOutputNode.id)
      if (n) setCenter(n.position.x + (n.measured?.width ?? 280) / 2, n.position.y + (n.measured?.height ?? 300) / 2, { zoom: 1, duration: 400 })
      return
    }
    const out = data.result?.output
    const self = getNode(id)
    if (!out || !self) return
    const all = getNodes() as unknown as MuseNodeLike[]
    const existing = all.find((n) => n.type === MUSE_NODE.output && normalizeOutputData(n.data).origin?.jobNodeId === id)
    if (existing) {
      setCenter(existing.position.x + 140, existing.position.y + 150, { zoom: 1, duration: 400 })
      return
    }
    const pos = outputNodePosition({ position: self.position, width: self.measured?.width ?? self.width }, 0)
    const node = createOutputNode(pos, out, { jobNodeId: id, jobType: MUSE_NODE.freeImage, sourceNodeId: 'free', rowLabel: 'Ảnh tự do' }, 'Ảnh tự do')
    addNodes(node as Node)
    addEdges(museEdge(id, node.id, MUSE_HANDLE.imageOut, MUSE_HANDLE.imageIn) as Edge)
  }

  const outImage = data.result?.status === 'done' ? data.result.output : undefined
  const elapsed = running && data.result ? Math.max(0, Math.round((now - data.result.updatedAt) / 1000)) : 0

  return (
    <div className={`mc-node mc-node-freeimg ${selected ? 'selected' : ''}`}>
      <MusePromptPort linked={linked} top={portTops[0]} />
      <MuseMediaPort
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.refsIn}
        kind="Image"
        label="Ảnh tham chiếu"
        style={{ top: portTops[1] }}
        title={`Ảnh (tùy chọn, tối đa ${FREE_IMAGE_MAX_REFS} ảnh) — để trống nếu muốn tạo ảnh chỉ từ prompt`}
      />
      <MuseMediaPort
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.imageOut}
        kind="Image"
        label="Ảnh tạo ra"
        title="Nối sang Tạo video Flow, Tạo ảnh tự do khác hoặc Kịch bản"
      />

      <div className="mc-node-head">
        <MuseMediaIcon kind="Image" />
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small>{refs.length ? `Biến đổi từ ${refs.length} ảnh` : 'Text → Image'} · {data.aspect}</small>
        </div>
        <button
          type="button"
          className="mc-icon-btn nodrag"
          onClick={() => updateNodeData(id, { collapsed: !data.collapsed })}
          title={data.collapsed ? 'Mở rộng' : 'Thu gọn'}
        >
          {data.collapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
        </button>
        <NodeDeleteButton nodeId={id} />
      </div>

      <div className="mc-node-body">
        {!data.collapsed && (
          <>
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

            <div className="mc-seg mc-seg-sm nodrag" role="group" aria-label="Tỉ lệ khung ảnh">
              {ASPECTS.map((r) => (
                <button key={r} type="button" className={data.aspect === r ? 'on' : ''} onClick={() => updateNodeData(id, { aspect: r })}>
                  {r}
                </button>
              ))}
            </div>

            {refs.length > 0 && (
              <div className="mc-freeimg-refs nodrag">
                {refs.map((r, i) => (
                  <div key={r.sourceNodeId} className="mc-freeimg-ref" title={r.label}>
                    <span className="mc-freeimg-no">#{i + 1}</span>
                    {r.image ? (
                      <img src={museMediaUrl(r.image.previewUrl)} alt={r.label} draggable={false} />
                    ) : (
                      <span className="mc-xph"><ImageOff size={13} /></span>
                    )}
                    <span className="mc-ref-kind">{SCRIPT_REF_KINDS[r.kind].vi}</span>
                    {refs.length > 1 && (
                      <div className="mc-vingr-move">
                        <button type="button" className="mc-mini-btn" disabled={i === 0 || running} onClick={() => updateNodeData(id, { order: moveScriptRef(refs, r.sourceNodeId, -1) })}>
                          <ChevronLeft size={11} />
                        </button>
                        <button type="button" className="mc-mini-btn" disabled={i === refs.length - 1 || running} onClick={() => updateNodeData(id, { order: moveScriptRef(refs, r.sourceNodeId, 1) })}>
                          <ChevronRight size={11} />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            <textarea
              className="mc-prompt nodrag nowheel"
              value={prompt}
              readOnly={!!linked}
              rows={5}
              spellCheck={false}
              placeholder={linked ? '' : 'Mô tả ảnh muốn tạo (hoặc nối Ô prompt vào cổng Text bên trái)…'}
              onChange={(e) => updateNodeData(id, { prompt: e.target.value, promptSource: 'custom' })}
            />
          </>
        )}

        {tooManyRefs && (
          <div className="mc-clip-warn">
            <AlertTriangle size={11} /> Tối đa {FREE_IMAGE_MAX_REFS} ảnh tham chiếu (đang nối {refs.length} ảnh).
          </div>
        )}
        {runBlockers.map((b) => (
          <div key={b} className="mc-clip-warn">
            <AlertTriangle size={11} /> {b}
          </div>
        ))}
        {(state === 'error' || state === 'interrupted') && data.result?.error && (
          <div className="mc-node-error">{data.result.error}</div>
        )}

        <button
          type="button"
          className={`mc-run-btn nodrag ${isGpt ? 'mc-run-clipscript' : ''}`}
          disabled={!canRun}
          onClick={run}
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {running
            ? `Đang tạo (${PROVIDER_LABEL[data.provider]}) · ${elapsed}s`
            : outImage
              ? `Tạo lại ảnh · 1 lượt ${PROVIDER_LABEL[data.provider]}`
              : `Tạo ảnh · 1 lượt ${PROVIDER_LABEL[data.provider]}`}
        </button>

        {outImage && (
          <div className="mc-freeimg-out nodrag">
            <div className="mc-freeimg-out-head">
              <span className={`mc-node-badge ${state === 'stale' ? 'custom' : ''}`}>
                {state === 'stale' ? 'Bản cũ' : `Xong · ${PROVIDER_LABEL[data.result?.provider ?? data.provider]}`}
              </span>
              <div className="mc-node-actions">
                <a className="mc-mini-btn" href={museMediaUrl(outImage.previewUrl)} target="_blank" rel="noreferrer" title="Mở ảnh">
                  <ExternalLink size={11} /> Mở
                </a>
                <button type="button" className="mc-mini-btn" onClick={spawnOrFocusOutput} title="Tách thành node Ảnh kết quả">
                  {existingOutputNode ? <><LocateFixed size={11} /> Xem node</> : <><ArrowUpRight size={11} /> Ra node</>}
                </button>
              </div>
            </div>
            <a href={museMediaUrl(outImage.previewUrl)} target="_blank" rel="noreferrer" className="mc-output-preview">
              <img src={museMediaUrl(outImage.previewUrl)} alt={data.title} draggable={false} />
            </a>
          </div>
        )}
        {!outImage && state === 'pending' && (
          <div className="mc-node-meta">
            <ImageIcon size={11} /> {refs.length ? 'Nối sẵn ảnh tham chiếu · bấm Tạo ảnh.' : 'Chỉ cần nhập prompt · ảnh là tùy chọn.'}
          </div>
        )}
      </div>
    </div>
  )
}

export const MuseFreeImageNode = memo(MuseFreeImageNodeImpl)
