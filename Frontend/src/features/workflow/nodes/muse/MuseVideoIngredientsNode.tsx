/**
 * Node "Ingredients (video + ảnh)" của Muse Canvas — Omni 1.2 "chỉnh video" trên Google Flow (cùng đường với Motion
 * Control): cổng "Video" nhận 1 node Video tham chiếu (cắt 3–10 s), cổng "Ảnh" nhận 1–3 node có ảnh (thứ tự = ảnh 1, 2, 3
 * trong prompt). "Tạo video": tải video tham chiếu lên project Flow (backend tự dùng lại media id nếu đã tải) → gửi job
 * video_edit 720p → theo dõi job (job chạy ở backend: đóng / mở lại canvas vẫn theo dõi tiếp). Không bao giờ tự gửi lại;
 * lỗi sau khi Flow có thể đã nhận lệnh thì "Tìm lại video" (recover-current).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, useNodeConnections, useNodesData, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clapperboard,
  ExternalLink,
  ImageOff,
  Link2Off,
  Loader2,
  Maximize2,
  Play,
  RotateCcw,
  Save,
  Search,
  Video,
} from 'lucide-react'
import {
  MUSE_HANDLE,
  SCRIPT_REF_KINDS,
  VIDEO_INGR_MAX_REFS,
  VIDEO_INGR_MAX_SECONDS,
  VIDEO_INGR_MIN_SECONDS,
  videoIngrNextAttempt,
  videoIngrOverallState,
  videoIngrSlotCount,
  videoIngrTotalCredits,
  VIDEO_INGR_RESOLUTION,
  VIDEO_INGR_SPEC,
  buildVideoIngrRequest,
  clipVideoStalled,
  isProjectHomeError,
  isSafeFlowError,
  moveScriptRef,
  normalizeVideoIngrData,
  normalizeVideoRefData,
  scriptRefsFromSources,
  stopWaitingVideo,
  videoIngrBlockers,
  videoIngrCredits,
  videoIngrFingerprint,
  videoIngrState,
  videoIngrTrim,
  type ClipVideoState,
  type MuseClipVideo,
  type VideoIngrFlow,
} from '../../services/museCanvasNodes.ts'
import {
  fetchMusePrompt,
  getVeoJob,
  museMediaUrl,
  notifyVideoLibraryChanged,
  recoverVeoJob,
  saveMusePromptDefault,
  submitVeoJob,
  veoVideoUrl,
  type VeoJobLite,
} from '../../services/museCanvasApi.ts'
import { uploadVideoReference } from '../../../veo-studio/services/veoApi'
import { runKey } from '../../services/museRunRegistry.ts'
import { useMuseCanvas } from '../../components/museCanvasContext'
import { NodeDeleteButton } from './NodeDeleteButton'
import { useMuseRuns } from './useMuseRuns'

type VIngrNode = Node<Record<string, unknown>, string>

/** Vòng hỏi job Flow: job -> token của vòng đang giữ quyền (vòng mới — vd. node vừa hiện lại — giành quyền). */
const G = globalThis as unknown as { __videoIngrPollOwners?: Map<string, object> }
const pollers: Map<string, object> = (G.__videoIngrPollOwners ??= new Map())
const POLL_MS = 4000
const STEP_LABEL: Record<string, string> = {
  uploading: 'Đang tải video tham chiếu lên Flow',
  pending: 'Đang xếp hàng (một việc Flow mỗi lúc)',
  captcha: 'Đang giải reCAPTCHA',
  submitting: 'Đang gửi tới Flow',
  generating: 'Flow đang tạo video',
  downloading: 'Đang tải video về',
}

/** Kết quả gửi MỘT biến thể (chờ ở frontend, qua museRuns): job đã tạo, hoặc lỗi trước khi Flow nhận lệnh. */
type SubmitOutcome = { job: VeoJobLite } | { error: string }
/** Một lần bấm gửi nhiều biến thể: kết quả từng biến thể theo chỉ số (0 = biến thể 1). */
type BatchOutcome = { index: number; outcome: SubmitOutcome }[]

function videoFromJob(v: MuseClipVideo, job: VeoJobLite): MuseClipVideo {
  const status = job.status === 'done' ? 'done' : job.status === 'error' ? 'error' : 'running'
  return {
    ...v,
    jobId: job.job_id,
    status,
    step: job.status,
    detail: job.current_step || v.detail,
    backendUpdatedAt: job.updated_at ? Date.parse(job.updated_at) || v.backendUpdatedAt : v.backendUpdatedAt,
    files: job.output_files?.length ? job.output_files : v.files,
    error: status === 'error' ? job.error_message || 'Flow báo lỗi' : undefined,
    errorCode: status === 'error' ? job.error_code || undefined : undefined,
    updatedAt: Date.now(),
  }
}

/** File video tham chiếu từ URL phát của backend (node chỉ giữ đường dẫn; upload-video cần nội dung file). */
async function fetchVideoFile(previewUrl: string, name: string): Promise<File> {
  const res = await fetch(museMediaUrl(previewUrl))
  if (!res.ok) throw new Error(`Không đọc được video tham chiếu (HTTP ${res.status}) — file đã bị xóa / di chuyển?`)
  const blob = await res.blob()
  return new File([blob], name || 'reference_video.mp4', { type: blob.type || 'video/mp4' })
}

/** Một ô biến thể: trạng thái, video đã tạo và các nút của riêng biến thể đó. */
function VariantTile(props: {
  index: number
  total: number
  video: MuseClipVideo | undefined
  state: ClipVideoState
  now: number
  /** Đang có biến thể chạy / đang tìm lại: khóa nút Tạo lại / Tìm lại */
  busy: boolean
  credits: number | null
  /** Lý do chặn gửi (rỗng = gửi được) */
  disabledReason: string
  onStop: () => void
  onRecover: () => void
  onRetry: () => void
}) {
  const { index, total, video, state, now, busy, credits, disabledReason } = props
  const file = video?.files?.[video.files.length - 1]
  const elapsed = state === 'running' && video ? Math.max(0, Math.round((now - video.startedAt) / 1000)) : 0
  const stalled = clipVideoStalled(video, now)
  const safeErr = state === 'error' && (isSafeFlowError(video?.errorCode) || isProjectHomeError(video?.error))
  const label = total > 1 ? `Biến thể ${index + 1}` : 'Video'
  return (
    <div className={`mc-vingr-var mc-cv-${state}`}>
      <div className="mc-vingr-var-head">
        <strong>{label}</strong>
        <span className={`mc-vingr-var-chip chip-${state}`}>
          {state === 'running' ? 'Đang tạo' : state === 'done' ? 'Xong' : state === 'stale' ? 'Bản cũ' : state === 'error' ? 'Lỗi' : 'Chưa tạo'}
        </span>
      </div>
      {state === 'none' && <div className="mc-vingr-var-empty">Chưa tạo — bấm “Tạo” bên dưới.</div>}
      {state === 'running' && (
        <>
          <div className="mc-node-meta">
            <Loader2 size={12} className="animate-spin" /> {STEP_LABEL[video?.step || ''] || video?.step || 'Đang chạy'} · {elapsed}s
          </div>
          {video?.detail && <div className="mc-node-meta" title={video.detail}>{video.detail}</div>}
          {stalled && (
            <div className="mc-clip-warn">
              <AlertTriangle size={11} /> Backend không báo gì thêm về job này đã lâu — có thể job đã chết. Bấm “Dừng chờ”.
            </div>
          )}
        </>
      )}
      {(state === 'done' || state === 'stale') && file && (
        <>
          <video className={`mc-clipvideo-player nodrag ${state === 'stale' ? 'dim' : ''}`} src={veoVideoUrl(file)} controls preload="metadata" />
          {state === 'stale' && (
            <div className="mc-clip-warn"><AlertTriangle size={11} /> Video / đoạn cắt / ảnh / prompt / cấu hình đã đổi — bản cũ.</div>
          )}
        </>
      )}
      {state === 'error' && video?.error && (
        <div className="mc-node-error">
          {video.error}
          <div className="mc-clipvideo-hint">
            {isProjectHomeError(video.error)
              ? 'Tab Flow bị đẩy về trang chủ: project này không mở được với tài khoản Google đang đăng nhập. Chưa mất credit — vào Cấu hình → Google Flow → “Tạo project mới”, rồi tạo lại.'
              : isSafeFlowError(video.errorCode)
                ? 'Lỗi xảy ra trước khi gửi lên Flow — chưa mất credit, có thể tạo lại.'
                : 'Flow có thể đã nhận lệnh (và trừ credit). Bấm “Tìm lại video” trước khi tạo lại.'}
          </div>
        </div>
      )}
      <div className="mc-vingr-var-btns">
        {state === 'running' && video?.jobId && (
          <button type="button" className="mc-mini-btn nodrag" onClick={props.onStop} title="Thôi theo dõi job này (job vẫn có thể chạy ở backend)">
            Dừng chờ
          </button>
        )}
        {state === 'error' && video?.jobId && !safeErr && (
          <button type="button" className="mc-mini-btn nodrag" onClick={props.onRecover} disabled={busy} title="Đọc video đã tạo trong project Flow (khớp mediaId) — không gửi lại">
            <Search size={11} /> Tìm lại video
          </button>
        )}
        {(state === 'done' || state === 'stale') && file && (
          <a className="mc-mini-btn nodrag" href={veoVideoUrl(file)} target="_blank" rel="noreferrer" title="Mở video trong tab mới">
            <ExternalLink size={11} /> Mở
          </a>
        )}
        {total > 1 && state !== 'running' && state !== 'none' && (
          <button
            type="button"
            className="mc-mini-btn nodrag"
            onClick={props.onRetry}
            disabled={busy || !!disabledReason}
            title={disabledReason || `Gửi lại riêng ${label.toLowerCase()} (1 job Flow, tốn credit)`}
          >
            <RotateCcw size={11} /> Tạo lại{credits != null ? ` · ≈${credits}` : ''}
          </button>
        )}
      </div>
    </div>
  )
}

function MuseVideoIngredientsNodeImpl({ id, data: raw, selected }: NodeProps<VIngrNode>) {
  const { updateNodeData, getNode } = useReactFlow()
  const { config, flowProject } = useMuseCanvas()
  // thời lượng trong cấu hình Flow (0 = Tự động) quyết định đoạn cắt mặc định
  const data = { ...normalizeVideoIngrData(raw), targetSeconds: config.flowSeconds }
  const [busy, setBusy] = useState<'' | 'reset' | 'save' | 'recover'>('')
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  const [now, setNow] = useState(Date.now())
  /** Khung xem video tham chiếu (kéo thanh cắt -> nhảy tới giây đó; "Xem đoạn" phát đúng đoạn gửi) */
  const previewRef = useRef<HTMLVideoElement>(null)

  // Cổng "Video": 1 node Video tham chiếu
  const vConns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.refVideoIn })
  const vSrc = useNodesData(vConns[0]?.source ? [vConns[0].source] : [])[0]
  const refVideo = vSrc ? normalizeVideoRefData(vSrc.data as Record<string, unknown>).video : null
  const refVideoLabel = vSrc ? normalizeVideoRefData(vSrc.data as Record<string, unknown>).label.trim() : ''

  // Cổng "Ảnh": 1–3 node có ảnh, theo data.order rồi theo dây
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

  const flow: VideoIngrFlow | null = flowProject
    ? { projectId: flowProject.id, flowProjectId: flowProject.flow_project_id, aspect: config.flowAspect }
    : null
  const trim = videoIngrTrim(data, refVideo?.durationSec ?? 0)
  const blockers = useMemo(
    () => {
      const b = videoIngrBlockers(data, refVideo, refs, flow)
      if (config.flowProjectId && !flowProject) b.unshift('Project Flow đã chọn không còn trong app — chọn hoặc tạo project ở Cấu hình → Google Flow.')
      return b
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data.prompt, data.trimStart, data.trimEnd, data.targetSeconds, refVideo, refs, flowProject, config.flowProjectId, config.flowAspect],
  )
  const videos = data.videos
  const variants = config.flowVariants
  const slotCount = videoIngrSlotCount(variants, videos.length)
  const fingerprint = videoIngrFingerprint(data, refVideo, refs, flow)
  const stateAt = (i: number) => videoIngrState(videos[i], data, refVideo, refs, flow)
  const states = Array.from({ length: slotCount }, (_, i) => stateAt(i))
  const vstate = videoIngrOverallState(states)
  const running = states.includes('running')

  // ---------------------------------------------------------------- theo dõi job Flow (chạy ở backend)
  const poll = useCallback(
    async (jobId: string) => {
      const me = {}
      pollers.set(jobId, me)
      try {
        for (;;) {
          await new Promise((r) => setTimeout(r, POLL_MS))
          if (pollers.get(jobId) !== me) return // vòng mới đã giành quyền
          let job: VeoJobLite | null
          try {
            job = await getVeoJob(jobId)
          } catch {
            continue // backend đang khởi động lại: hỏi tiếp
          }
          const cur = normalizeVideoIngrData(getNode(id)?.data as Record<string, unknown> | undefined).videos.find((v) => v.jobId === jobId)
          if (!cur || cur.status !== 'running') break
          const missing = job === null
          updateNodeData(id, (node) => {
            const list = normalizeVideoIngrData(node.data as Record<string, unknown>).videos
            const i = list.findIndex((v) => v.jobId === jobId && v.status === 'running')
            if (i < 0) return {}
            const next = [...list]
            next[i] = missing
              ? { ...list[i], status: 'error', error: 'Backend không còn job này — xem Thư Viện Video / Veo Studio.', updatedAt: Date.now() }
              : videoFromJob(list[i], job!)
            return { videos: next }
          })
          if (missing || job!.status === 'done' || job!.status === 'error') {
            if (job?.status === 'done') notifyVideoLibraryChanged()
            break
          }
        }
      } finally {
        if (pollers.get(jobId) === me) pollers.delete(jobId)
      }
    },
    [getNode, id, updateNodeData],
  )

  // Bước tải video + gửi job chờ ở frontend: qua museRuns để đổi tab / đổi project không mất kết quả
  const applyBatch = useCallback(
    (batch: BatchOutcome) => {
      updateNodeData(id, (node) => {
        const next = [...normalizeVideoIngrData(node.data as Record<string, unknown>).videos]
        for (const { index, outcome } of batch) {
          const v = next[index]
          if (!v || v.status !== 'running' || v.jobId) continue
          next[index] =
            'error' in outcome
              ? { ...v, status: 'error', error: outcome.error, errorCode: 'NOT_SUBMITTED', updatedAt: Date.now() }
              : videoFromJob(v, outcome.job)
        }
        return { videos: next }
      })
      for (const { outcome } of batch) {
        if (!('job' in outcome)) continue
        if (outcome.job.status === 'done') notifyVideoLibraryChanged()
        else if (outcome.job.status !== 'error') poll(outcome.job.job_id)
      }
    },
    [id, poll, updateNodeData],
  )
  const runs = useMuseRuns<BatchOutcome>((_key, batch) => applyBatch(batch))
  const flight = runKey.videoIngr(id)

  // Node gắn lên: job đang chạy -> theo dõi tiếp; đang tải / gửi -> nhận kết quả (hoặc báo gián đoạn)
  useEffect(() => {
    const list = normalizeVideoIngrData(raw).videos
    for (const v of list) if (v.status === 'running' && v.jobId) poll(v.jobId)
    const pending = list.filter((v) => v.status === 'running' && !v.jobId)
    if (pending.length && !runs.resume(flight)) {
      const several = pending.length > 1
      updateNodeData(id, (node) => ({
        videos: normalizeVideoIngrData(node.data as Record<string, unknown>).videos.map((v) =>
          v.status === 'running' && !v.jobId
            ? {
                ...v,
                status: 'error' as const,
                // nhiều biến thể: có thể một số job đã được tạo trước khi bị ngắt -> không khẳng định "chưa mất credit"
                errorCode: several ? 'SUBMIT_INTERRUPTED' : 'NOT_SUBMITTED',
                error: several
                  ? 'Bị gián đoạn khi đang tải video / gửi các biến thể (đóng app / tải lại trang): có thể một số biến thể ĐÃ được gửi — xem Thư Viện Video / Veo Studio trước khi tạo lại.'
                  : 'Bị gián đoạn khi đang tải video / gửi job (đóng app / tải lại trang) — chưa có job, chưa mất credit.',
                updatedAt: Date.now(),
              }
            : v,
        ),
      }))
    }
    // chỉ khi node gắn lên màn hình
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  /**
   * Gửi các biến thể `indices` (0 = biến thể 1). Bấm là gửi ngay (giống node Clip): tổng credit ghi sẵn trên nút, mỗi biến thể
   * là 1 job Flow riêng với khóa chống trùng riêng, video tham chiếu chỉ tải lên 1 lần, không bao giờ tự gửi lại.
   */
  function createVideos(indices: number[]) {
    if (running || blockers.length || runs.isRunning(flight) || !refVideo || !flow || !indices.length) return
    const attempt = videoIngrNextAttempt(videos)
    const started = Date.now()
    const fresh = (): MuseClipVideo => ({
      status: 'running',
      fingerprint,
      attempt,
      step: 'uploading',
      detail: `Đang tải “${refVideo.name}” lên project Flow (lần sau dùng lại)…`,
      startedAt: started,
      updatedAt: started,
    })
    const next = [...videos]
    for (const i of indices) next[i] = fresh()
    updateNodeData(id, { videos: next })
    const snapshot = { prompt: data.prompt, trimStart: data.trimStart, trimEnd: data.trimEnd, targetSeconds: data.targetSeconds }
    const batch: Promise<BatchOutcome> = (async () => {
      let mediaId: string
      try {
        const file = await fetchVideoFile(refVideo.previewUrl, refVideo.name)
        mediaId = (await uploadVideoReference(file, flow.flowProjectId, { forceFresh: false, nativeUi: false })).media_id
      } catch (e: any) {
        const outcome: SubmitOutcome = { error: e?.message || 'Không tải được video tham chiếu lên Flow' }
        return indices.map((index) => ({ index, outcome }))
      }
      const done: BatchOutcome = []
      for (const index of indices) {
        try {
          const body = buildVideoIngrRequest(id, snapshot, refVideo, refs, flow, mediaId, attempt, index + 1)
          done.push({ index, outcome: { job: await submitVeoJob(body) } })
        } catch (e: any) {
          done.push({ index, outcome: { error: e?.message || 'Không gửi được job' } })
        }
      }
      return done
    })()
    runs.start(flight, batch)
  }
  const createAll = () => createVideos(Array.from({ length: variants }, (_, i) => i))

  async function recoverVideo(index: number) {
    const v = videos[index]
    if (!v?.jobId || busy) return
    setBusy('recover')
    try {
      const job = await recoverVeoJob(v.jobId)
      updateNodeData(id, (node) => {
        const list = [...normalizeVideoIngrData(node.data as Record<string, unknown>).videos]
        if (list[index]?.jobId === v.jobId) list[index] = videoFromJob(list[index], job)
        return { videos: list }
      })
      if (job.status !== 'done' && job.status !== 'error') poll(job.job_id)
      else if (job.status === 'done') notifyVideoLibraryChanged()
    } catch (e: any) {
      updateNodeData(id, (node) => {
        const list = [...normalizeVideoIngrData(node.data as Record<string, unknown>).videos]
        if (list[index]?.jobId === v.jobId) list[index] = { ...list[index], error: `Chưa tìm lại được: ${e?.message || 'lỗi'}`, updatedAt: Date.now() }
        return { videos: list }
      })
    } finally {
      setBusy('')
    }
  }

  function stopWaiting(index: number) {
    const v = videos[index]
    if (v?.status !== 'running' || !v.jobId) return
    updateNodeData(id, (node) => {
      const list = [...normalizeVideoIngrData(node.data as Record<string, unknown>).videos]
      if (list[index]?.jobId === v.jobId) list[index] = stopWaitingVideo(list[index])
      return { videos: list }
    })
  }

  async function resetPrompt() {
    setBusy('reset')
    setNote(null)
    try {
      const p = await fetchMusePrompt(VIDEO_INGR_SPEC.promptName)
      updateNodeData(id, { prompt: p.prompt, promptSource: 'default' })
      setNote({ kind: 'ok', text: p.is_custom ? 'Đã nạp prompt mặc định bạn đã lưu.' : 'Đã nạp prompt mặc định gốc.' })
    } catch (e: any) {
      setNote({ kind: 'err', text: e?.message || 'Không tải được prompt mặc định' })
    } finally {
      setBusy('')
    }
  }

  async function savePrompt() {
    setBusy('save')
    setNote(null)
    try {
      await saveMusePromptDefault(VIDEO_INGR_SPEC.promptName, data.prompt)
      updateNodeData(id, { promptSource: 'default' })
      setNote({ kind: 'ok', text: 'Đã lưu làm prompt mặc định cho node Ingredients mới.' })
    } catch (e: any) {
      setNote({ kind: 'err', text: e?.message || 'Không lưu được' })
    } finally {
      setBusy('')
    }
  }

  /** Đặt đầu / cuối đoạn cắt (giây, làm tròn 0,1); kéo đầu nào thì khung xem nhảy tới giây đó. */
  const setTrimValue = (key: 'trimStart' | 'trimEnd', value: number | null) => {
    const v = value == null || !Number.isFinite(value) ? null : Math.max(0, Math.round(value * 10) / 10)
    updateNodeData(id, { [key]: v })
    if (v != null && previewRef.current) {
      previewRef.current.pause()
      previewRef.current.currentTime = v
    }
  }
  const setTrimText = (key: 'trimStart' | 'trimEnd', raw: string) => setTrimValue(key, raw.trim() === '' ? null : Number(raw))

  /** Phát đúng đoạn sẽ gửi (dừng ở giây kết thúc). */
  function playSegment() {
    const el = previewRef.current
    if (!el) return
    el.currentTime = trim.start
    el.muted = true
    void el.play()
  }
  function onPreviewTime(e: React.SyntheticEvent<HTMLVideoElement>) {
    const el = e.currentTarget
    if (!el.paused && el.currentTime >= trim.end) el.pause()
  }

  const trimOk = trim.length >= VIDEO_INGR_MIN_SECONDS && trim.length <= VIDEO_INGR_MAX_SECONDS && trim.end > trim.start
  const credits = trimOk ? videoIngrCredits(trim.length) : null
  const totalCredits = trimOk ? videoIngrTotalCredits(trim.length, variants) : null
  const collapsed = data.collapsed
  const dur = refVideo?.durationSec || Math.max(trim.end, VIDEO_INGR_MAX_SECONDS)
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / dur) * 100))}%`
  const fmt = (t: number) => `${(Math.round(t * 10) / 10).toFixed(1)}s`
  const slots = Array.from({ length: VIDEO_INGR_MAX_REFS }, (_, i) => refs[i] ?? null)

  return (
    <div className={`mc-node mc-node-vingr ${selected ? 'selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.refVideoIn}
        className="mc-handle mc-handle-videoref"
        style={{ top: 92 }}
        title="Video: nối từ node “Video tham chiếu” (1 video)"
      />
      <span className="mc-port-label" style={{ top: 82 }}>Video</span>
      <Handle
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.refsIn}
        className="mc-handle mc-handle-prompt"
        style={{ top: collapsed ? 120 : 400 }}
        title={`Ảnh: nối từ Ảnh kết quả / Nhân vật / Trang phục / Bối cảnh — tối đa ${VIDEO_INGR_MAX_REFS} ảnh, theo thứ tự`}
      />
      <span className="mc-port-label mc-port-secondary" style={{ top: collapsed ? 110 : 390 }}>Ảnh</span>

      <div className="mc-node-head">
        <span className="mc-node-icon mc-icon-videoref"><Clapperboard size={14} /></span>
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small>Omni 1.2 · chỉnh video theo video mẫu · {VIDEO_INGR_RESOLUTION}</small>
        </div>
        <span className="mc-node-count" title="Ảnh tham chiếu đã nối / tối đa">{refs.length}/{VIDEO_INGR_MAX_REFS} ảnh</span>
        <button
          type="button"
          className="mc-icon-btn nodrag"
          onClick={() => updateNodeData(id, { collapsed: !collapsed })}
          title={collapsed ? 'Mở rộng' : 'Thu gọn'}
        >
          {collapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
        </button>
        <NodeDeleteButton nodeId={id} confirmText={videos.length ? 'Xóa node Ingredients? Video đã tạo vẫn còn trong Thư Viện Video.' : undefined} />
      </div>

      <div className="mc-node-body">
        {collapsed ? (
          <div className="mc-vingr-mini">
            <span className="mc-node-meta">
              <Video size={11} /> {refVideo ? `${refVideo.name} · ${fmt(trim.start)}–${fmt(trim.end)}` : 'chưa có video'}
            </span>
            <span className="mc-thumbs">
              {refs.map((r) =>
                r.image ? <img key={r.sourceNodeId} src={museMediaUrl(r.image.previewUrl)} alt={r.label} title={r.label} draggable={false} /> : null,
              )}
            </span>
          </div>
        ) : (
          <>
            {/* ===== Video tham chiếu: xem + cắt đoạn ===== */}
            <section className="mc-vingr-card">
              <div className="mc-vingr-title">
                <Video size={12} /> Video tham chiếu
                {refVideo && <small className="mc-xtoggle-hint">{refVideo.durationSec ? `${refVideo.durationSec}s` : ''}</small>}
              </div>
              {refVideo ? (
                <div className="mc-vingr-video">
                  <video
                    ref={previewRef}
                    key={refVideo.path}
                    className="mc-vingr-player nodrag nowheel"
                    src={museMediaUrl(refVideo.previewUrl)}
                    muted
                    playsInline
                    controls
                    preload="metadata"
                    onTimeUpdate={onPreviewTime}
                  />
                  <div className="mc-vingr-side">
                    <div className="mc-vingr-name" title={refVideo.path}>
                      {refVideoLabel || refVideo.name}
                      {refVideoLabel && <small>{refVideo.name}</small>}
                    </div>

                    <div className="mc-vingr-label">Đoạn gửi lên Flow</div>
                    <div className={`mc-trim nodrag ${trimOk ? '' : 'bad'}`}>
                      <div className="mc-trim-track" />
                      <div className="mc-trim-sel" style={{ left: pct(trim.start), width: `calc(${pct(trim.end)} - ${pct(trim.start)})` }} />
                      <input
                        type="range"
                        min={0}
                        max={dur}
                        step={0.1}
                        value={trim.start}
                        aria-label="Giây bắt đầu"
                        onChange={(e) => setTrimValue('trimStart', Math.min(Number(e.target.value), trim.end - 0.1))}
                      />
                      <input
                        type="range"
                        min={0}
                        max={dur}
                        step={0.1}
                        value={trim.end}
                        aria-label="Giây kết thúc"
                        onChange={(e) => setTrimValue('trimEnd', Math.max(Number(e.target.value), trim.start + 0.1))}
                      />
                    </div>
                    <div className="mc-trim-scale">
                      <span>0s</span>
                      <span>{fmt(dur)}</span>
                    </div>

                    <div className="mc-vingr-times nodrag">
                      <label>
                        Từ
                        <input className="mc-input" type="number" min={0} step={0.1} value={data.trimStart ?? ''} placeholder="0" onChange={(e) => setTrimText('trimStart', e.target.value)} />
                      </label>
                      <label>
                        Đến
                        <input className="mc-input" type="number" min={0} step={0.1} value={data.trimEnd ?? ''} placeholder={String(trim.end)} onChange={(e) => setTrimText('trimEnd', e.target.value)} />
                      </label>
                    </div>

                    <div className={`mc-vingr-len ${trimOk ? '' : 'bad'}`}>
                      <strong>{fmt(trim.length)}</strong>
                      <span>{credits != null ? `≈${credits} credit` : `cần ${VIDEO_INGR_MIN_SECONDS}–${VIDEO_INGR_MAX_SECONDS}s`}</span>
                    </div>

                    <div className="mc-vingr-btns">
                      <button type="button" className="mc-mini-btn nodrag" onClick={playSegment} title="Phát đúng đoạn sẽ gửi lên Flow">
                        <Play size={11} /> Xem đoạn
                      </button>
                      <button
                        type="button"
                        className="mc-mini-btn nodrag"
                        onClick={() => updateNodeData(id, { trimStart: null, trimEnd: null })}
                        title={`Dùng cả video (tối đa ${VIDEO_INGR_MAX_SECONDS} giây đầu)`}
                      >
                        <Maximize2 size={11} /> Cả video
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mc-vingr-empty">
                  <Video size={18} />
                  <span>Nối node “Video tham chiếu” vào chấm đỏ bên trái</span>
                  <small>Flow nhận đoạn {VIDEO_INGR_MIN_SECONDS}–{VIDEO_INGR_MAX_SECONDS} giây</small>
                </div>
              )}
            </section>

            {/* ===== Ảnh tham chiếu: 3 ô theo thứ tự ===== */}
            <section className="mc-vingr-card">
              <div className="mc-vingr-title">
                Ảnh tham chiếu <span className="mc-node-badge">{refs.length}/{VIDEO_INGR_MAX_REFS}</span>
                <small className="mc-xtoggle-hint">theo thứ tự · ảnh 1 = bộ mở đầu</small>
              </div>
              <div className="mc-vingr-refs">
                {slots.map((r, i) =>
                  r ? (
                    <div key={r.sourceNodeId} className="mc-vingr-ref" title={r.label}>
                      <span className="mc-vingr-no">#{i + 1}{i === 0 ? ' · Mở đầu' : ''}</span>
                      {r.image ? (
                        <a href={museMediaUrl(r.image.previewUrl)} target="_blank" rel="noreferrer" className="nodrag" title="Mở ảnh">
                          <img src={museMediaUrl(r.image.previewUrl)} alt={r.label} draggable={false} />
                        </a>
                      ) : (
                        <span className="mc-vingr-noimg"><ImageOff size={16} /></span>
                      )}
                      <span className="mc-vingr-ref-label">{r.label}</span>
                      <span className={`mc-ref-kind mc-ref-${r.kind}`}>{SCRIPT_REF_KINDS[r.kind].vi}</span>
                      <span className="mc-vingr-move">
                        <button
                          type="button"
                          className="mc-mini-btn nodrag"
                          disabled={i === 0 || vstate === 'running'}
                          onClick={() => updateNodeData(id, { order: moveScriptRef(refs, r.sourceNodeId, -1) })}
                          title="Lên trước"
                        >
                          <ChevronLeft size={12} />
                        </button>
                        <button
                          type="button"
                          className="mc-mini-btn nodrag"
                          disabled={i === refs.length - 1 || vstate === 'running'}
                          onClick={() => updateNodeData(id, { order: moveScriptRef(refs, r.sourceNodeId, 1) })}
                          title="Xuống sau"
                        >
                          <ChevronRight size={12} />
                        </button>
                      </span>
                    </div>
                  ) : (
                    <div key={`empty-${i}`} className="mc-vingr-ref empty">
                      <span className="mc-vingr-no">#{i + 1}</span>
                      <span className="mc-vingr-noimg"><Link2Off size={14} /></span>
                      <span className="mc-vingr-ref-label">Nối ảnh vào chấm “Ảnh”</span>
                    </div>
                  ),
                )}
              </div>
            </section>

            {/* ===== Prompt ===== */}
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
                />
                <div className="mc-node-actions">
                  <button type="button" className="mc-mini-btn nodrag" onClick={resetPrompt} disabled={!!busy}>
                    <RotateCcw size={12} /> Mặc định
                  </button>
                  <button type="button" className="mc-mini-btn nodrag" onClick={savePrompt} disabled={!!busy || !data.prompt.trim()}>
                    <Save size={12} /> Lưu làm mặc định
                  </button>
                </div>
              </>
            )}
            {note && <div className={note.kind === 'ok' ? 'mc-node-ok' : 'mc-node-error'}>{note.text}</div>}
          </>
        )}

        {/* ===== Video Flow: mỗi biến thể 1 ô ===== */}
        <div className={`mc-clipvideo mc-cv-${vstate}`}>
          <div className="mc-clipvideo-head">
            <Clapperboard size={13} /> Video Flow
            <small>
              {config.flowAspect} · {VIDEO_INGR_RESOLUTION} · {variants} biến thể · {flowProject ? flowProject.name : 'chưa chọn project'}
              {flowProject?.account_email ? ` · ${flowProject.account_email}` : ''}
            </small>
          </div>

          {videos.length > 0 && (
            <div className={`mc-vingr-variants cols-${slotCount > 1 ? 2 : 1}`}>
              {Array.from({ length: slotCount }, (_, i) => (
                <VariantTile
                  key={i}
                  index={i}
                  total={slotCount}
                  video={videos[i]}
                  state={states[i]}
                  now={now}
                  busy={!!busy || running}
                  credits={credits}
                  disabledReason={blockers[0] ?? ''}
                  onStop={() => stopWaiting(i)}
                  onRecover={() => recoverVideo(i)}
                  onRetry={() => createVideos([i])}
                />
              ))}
            </div>
          )}

          {!running && blockers.map((b) => <div key={b} className="mc-clip-warn"><AlertTriangle size={11} /> {b}</div>)}
          <div className="mc-node-actions">
            <button
              type="button"
              className="mc-run-btn mc-run-clipscript mc-clipvideo-run nodrag"
              disabled={running || blockers.length > 0}
              onClick={createAll}
              title={
                variants > 1
                  ? `Gửi ${variants} job Flow riêng (mỗi biến thể 1 lượt, tốn credit riêng; video tham chiếu chỉ tải lên 1 lần) — tốn credit, bấm là gửi ngay; không bao giờ tự gửi lại`
                  : 'Tải video tham chiếu lên Flow (nếu chưa) rồi gửi Omni 1.2 chỉnh video — tốn credit, bấm là gửi ngay; không bao giờ tự gửi lại'
              }
            >
              {running ? <Loader2 size={12} className="animate-spin" /> : <Clapperboard size={12} />}
              {videos.length === 0 ? 'Tạo' : 'Tạo lại'} {variants > 1 ? `${variants} biến thể` : 'video'}
              {totalCredits != null ? ` · ≈${totalCredits} credit` : ''}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

export const MuseVideoIngredientsNode = memo(MuseVideoIngredientsNodeImpl)
