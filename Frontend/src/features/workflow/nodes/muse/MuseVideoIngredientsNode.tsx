/**
 * Node "Ingredients (video + ảnh)" của Muse Canvas — Omni 1.2 "chỉnh video" trên Google Flow (cùng đường với Motion
 * Control): cổng "Video" nhận 1 node Video tham chiếu (cắt 3–15 s), cổng "Ảnh" nhận 1–3 node có ảnh (thứ tự = ảnh 1, 2, 3
 * trong prompt). "Tạo video": tải video tham chiếu lên project Flow (backend tự dùng lại media id nếu đã tải) → gửi MỘT job
 * video_edit (720p / 360p theo cấu hình) ra N video (Biến thể 1–4 = như chọn x1–x4 trên Flow) → theo dõi job (job chạy ở
 * backend: đóng / mở lại canvas vẫn theo dõi tiếp). Không bao giờ tự gửi lại; job 1 video lỗi sau khi Flow có thể đã nhận
 * lệnh thì "Tìm lại video" (recover-current).
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Position, useNodeConnections, useNodesData, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import { MuseMediaIcon, MuseMediaPort } from './MuseMediaPort'
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clapperboard,
  Columns2,
  ArrowUpRight,
  ExternalLink,
  ImageOff,
  LocateFixed,
  Link2Off,
  Loader2,
  Maximize2,
  Pause,
  Play,
  RotateCcw,
  Save,
  Search,
  Video,
  Volume2,
  VolumeX,
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
  videoIngrDuration,
  videoIngrFingerprint,
  videoIngrFromJob,
  videoIngrIsBatchTile,
  videoIngrMaxRefs,
  videoIngrMode,
  videoIngrModeCredits,
  videoIngrState,
  videoIngrSupportsBatch,
  videoIngrTileToRef,
  createVideoRefNode,
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
import {
  canCompareWithReference,
  compareFinished,
  compareLength,
  compareNeedsResync,
  compareRefTime,
  formatCompareTime,
  type CompareSpan,
} from '../../services/museVideoCompare.ts'
import { runKey } from '../../services/museRunRegistry.ts'
import { useMuseCanvas } from '../../components/museCanvasContext'
import { NodeDeleteButton } from './NodeDeleteButton'
import { MusePromptPort, useLinkedPrompt } from './MusePromptPort'
import { museInputPortTops } from '../../services/museCanvasNodes.ts'
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

/** Kết quả tải video + gửi MỘT job (chờ ở frontend, qua museRuns): job đã tạo, hoặc lỗi trước khi Flow nhận lệnh. */
type SubmitOutcome = { job: VeoJobLite } | { error: string }
/** Một lần bấm: các ô (0 = biến thể 1) cùng nhận kết quả của MỘT job (ô thứ k = video thứ k của job). */
type BatchOutcome = { index: number; outcome: SubmitOutcome }[]

const videoFromJob = (v: MuseClipVideo, job: VeoJobLite) => videoIngrFromJob(v, job)

/** File video tham chiếu từ URL phát của backend (node chỉ giữ đường dẫn; upload-video cần nội dung file). */
async function fetchVideoFile(previewUrl: string, name: string): Promise<File> {
  const res = await fetch(museMediaUrl(previewUrl))
  if (!res.ok) throw new Error(`Không đọc được video tham chiếu (HTTP ${res.status}) — file đã bị xóa / di chuyển?`)
  const blob = await res.blob()
  return new File([blob], name || 'reference_video.mp4', { type: blob.type || 'video/mp4' })
}

/** Đoạn video mẫu đã gửi lên Flow (để đối chiếu với kết quả). */
type CompareReference = CompareSpan & { url: string; name: string }

/**
 * Đối chiếu: video mẫu (đúng đoạn đã gửi) cạnh video kết quả, phát đồng bộ. Video kết quả là đồng hồ chính; video mẫu
 * được kéo theo (giây t của kết quả = start + t của mẫu) và chỉ bị kéo lại khi lệch quá ngưỡng để không giật.
 */
function CompareView({ reference, resultUrl }: { reference: CompareReference; resultUrl: string }) {
  const refEl = useRef<HTMLVideoElement>(null)
  const resEl = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [t, setT] = useState(0)
  const [duration, setDuration] = useState(0)
  const [soundOn, setSoundOn] = useState(true)
  const span: CompareSpan = { start: reference.start, end: reference.end }
  const length = compareLength(span, duration)

  function seek(next: number) {
    const result = resEl.current
    const sample = refEl.current
    if (!result || !sample) return
    result.currentTime = next
    sample.currentTime = compareRefTime(span, next)
    setT(next)
  }

  async function toggle() {
    const result = resEl.current
    const sample = refEl.current
    if (!result || !sample) return
    if (playing) {
      result.pause()
      sample.pause()
      return
    }
    if (compareFinished(span, result.currentTime, result.duration)) seek(0)
    sample.currentTime = compareRefTime(span, result.currentTime)
    await Promise.allSettled([result.play(), sample.play()])
  }

  function onResultTime() {
    const result = resEl.current
    const sample = refEl.current
    if (!result || !sample) return
    setT(result.currentTime)
    if (compareFinished(span, result.currentTime, result.duration)) {
      result.pause()
      sample.pause()
      seek(0)
    } else if (compareNeedsResync(span, sample.currentTime, result.currentTime)) {
      sample.currentTime = compareRefTime(span, result.currentTime)
    }
  }

  return (
    <div className="mc-vcompare nodrag nowheel">
      <div className="mc-vcompare-panes">
        <figure>
          <figcaption title={reference.name}>Video mẫu · {formatCompareTime(reference.start)}–{formatCompareTime(reference.end)}</figcaption>
          <video
            ref={refEl}
            key={`${reference.url}#${reference.start}`}
            src={reference.url}
            muted
            playsInline
            preload="auto"
            onLoadedMetadata={(e) => {
              e.currentTarget.currentTime = compareRefTime(span, t)
            }}
          />
        </figure>
        <figure>
          <figcaption>Kết quả</figcaption>
          <video
            ref={resEl}
            key={resultUrl}
            src={resultUrl}
            muted={!soundOn}
            playsInline
            preload="metadata"
            onLoadedMetadata={(e) => setDuration(e.currentTarget.duration || 0)}
            onTimeUpdate={onResultTime}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        </figure>
      </div>
      <div className="mc-vcompare-bar">
        <button type="button" className="mc-mini-btn nodrag" onClick={toggle} title="Phát / dừng cả hai video cùng lúc">
          {playing ? <Pause size={11} /> : <Play size={11} />} {playing ? 'Dừng' : 'Phát cùng lúc'}
        </button>
        <input
          type="range"
          className="mc-vcompare-seek nodrag"
          min={0}
          max={Math.max(length, 0.1)}
          step={0.05}
          value={Math.min(t, Math.max(length, 0.1))}
          aria-label="Tua cả hai video"
          onChange={(e) => seek(Number(e.target.value))}
        />
        <span className="mc-vcompare-time">{formatCompareTime(t)} / {formatCompareTime(length)}</span>
        <button
          type="button"
          className="mc-icon-btn nodrag"
          onClick={() => setSoundOn((v) => !v)}
          title={soundOn ? 'Tắt tiếng video kết quả (video mẫu luôn tắt tiếng)' : 'Bật tiếng video kết quả'}
        >
          {soundOn ? <Volume2 size={12} /> : <VolumeX size={12} />}
        </button>
      </div>
    </div>
  )
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
  /** Ô thuộc job nhiều video: "Tìm lại video" của backend chỉ lấy được 1 video bất kỳ -> ẩn, chỉ dẫn xem trong Flow */
  batchTile: boolean
  /** Đã có node Video tham chiếu tách từ video này (còn trên canvas) */
  hasNode: boolean
  /** Đoạn video mẫu để đối chiếu — chỉ có khi đang bật "Đối chiếu" (null = hiện video kết quả như thường) */
  reference: CompareReference | null
  onStop: () => void
  onRecover: () => void
  onRetry: () => void
  onToNode: () => void
}) {
  const { index, total, video, state, now, busy, credits, disabledReason } = props
  const file = video?.files?.[video.files.length - 1]
  const elapsed = state === 'running' && video ? Math.max(0, Math.round((now - video.startedAt) / 1000)) : 0
  const stalled = clipVideoStalled(video, now)
  const safeErr = state === 'error' && (isSafeFlowError(video?.errorCode) || isProjectHomeError(video?.error))
  const label = total > 1 ? `Biến thể ${index + 1}` : 'Video'
  // chỉ ô "Xong" so được: "Bản cũ" nghĩa là video mẫu / đoạn cắt đã đổi so với lúc tạo
  const comparing = canCompareWithReference(state, !!file, !!props.reference)
  return (
    <div className={`mc-vingr-var mc-cv-${state}`}>
      <div className="mc-vingr-var-head">
        <strong>{label}</strong>
        <span
          className={`mc-vingr-var-chip chip-${state}`}
          title={state === 'stale' ? 'Video mẫu / đoạn cắt / ảnh / prompt / cấu hình đã đổi so với lúc tạo video này' : undefined}
        >
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
        comparing && props.reference
          ? <CompareView reference={props.reference} resultUrl={veoVideoUrl(file)} />
          : <video className="mc-clipvideo-player nodrag" src={veoVideoUrl(file)} controls preload="metadata" />
      )}
      {state === 'error' && video?.error && (
        <div className="mc-node-error">
          {video.error}
          <div className="mc-clipvideo-hint">
            {isProjectHomeError(video.error)
              ? 'Tab Flow bị đẩy về trang chủ: project này không mở được với tài khoản Google đang đăng nhập. Chưa mất credit — vào Cấu hình → Google Flow → “Tạo project mới”, rồi tạo lại.'
              : isSafeFlowError(video.errorCode)
                ? 'Lỗi xảy ra trước khi gửi lên Flow — chưa mất credit, có thể tạo lại.'
                : props.batchTile
                  ? 'Flow đã nhận lệnh cho video này (đã tính credit). Xem trong project Flow trước khi tạo lại.'
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
        {state === 'error' && video?.jobId && !safeErr && !props.batchTile && (
          <button type="button" className="mc-mini-btn nodrag" onClick={props.onRecover} disabled={busy} title="Đọc video đã tạo trong project Flow (khớp mediaId) — không gửi lại">
            <Search size={11} /> Tìm lại video
          </button>
        )}
        {(state === 'done' || state === 'stale') && file && (
          <a className="mc-mini-btn nodrag" href={veoVideoUrl(file)} target="_blank" rel="noreferrer" title="Mở video trong tab mới">
            <ExternalLink size={11} /> Mở
          </a>
        )}
        {(state === 'done' || state === 'stale') && file && (
          <button
            type="button"
            className="mc-mini-btn nodrag"
            onClick={props.onToNode}
            title={props.hasNode ? 'Đến node Video tham chiếu đã tách từ video này' : 'Tách video này thành node “Video tham chiếu” — nối tiếp vào node Cắt video / Ingredients khác'}
          >
            {props.hasNode ? <><LocateFixed size={11} /> Xem node</> : <><ArrowUpRight size={11} /> Ra node</>}
          </button>
        )}
        {total > 1 && state !== 'running' && state !== 'none' && (
          <button
            type="button"
            className="mc-mini-btn nodrag"
            onClick={props.onRetry}
            disabled={busy || !!disabledReason}
            title={disabledReason || `Gửi lại riêng ${label.toLowerCase()} (1 video, tốn credit)`}
          >
            <RotateCcw size={11} /> Tạo lại{credits != null ? ` · ≈${credits}` : ''}
          </button>
        )}
      </div>
    </div>
  )
}

function MuseVideoIngredientsNodeImpl({ id, data: raw, selected }: NodeProps<VIngrNode>) {
  const { updateNodeData, getNode, addNodes, setCenter } = useReactFlow()
  const { config, flowProject } = useMuseCanvas()
  // thời lượng trong cấu hình Flow (0 = Tự động) quyết định đoạn cắt mặc định / thời lượng ingredients
  const data = { ...normalizeVideoIngrData(raw), targetSeconds: config.flowSeconds }
  const linked = useLinkedPrompt()
  const portTops = museInputPortTops(['Text', 'Video', 'Image'])
  const prompt = linked?.text ?? data.prompt
  const runData = { ...data, prompt }
  const [busy, setBusy] = useState<'' | 'reset' | 'save' | 'recover'>('')
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [showPrompt, setShowPrompt] = useState(false)
  /** Chế độ đối chiếu video kết quả với đoạn video mẫu (chỉ giao diện, không lưu vào project) */
  const [compare, setCompare] = useState(false)
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
    ? { projectId: flowProject.id, flowProjectId: flowProject.flow_project_id, aspect: config.flowAspect, resolution: config.flowResolution }
    : null
  const trim = videoIngrTrim(data, refVideo?.durationSec ?? 0)
  const blockers = useMemo(
    () => {
      const b = videoIngrBlockers(runData, refVideo, refs, flow)
      if (config.flowProjectId && !flowProject) b.unshift('Project Flow đã chọn không còn trong app — chọn hoặc tạo project ở Cấu hình → Google Flow.')
      return b
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [prompt, data.trimStart, data.trimEnd, data.targetSeconds, refVideo, refs, flowProject, config.flowProjectId, config.flowAspect, config.flowResolution],
  )
  const videos = data.videos
  const variants = config.flowVariants
  const slotCount = videoIngrSlotCount(variants, videos.length)
  const fingerprint = videoIngrFingerprint(runData, refVideo, refs, flow)
  const stateAt = (i: number) => videoIngrState(videos[i], runData, refVideo, refs, flow)
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
          // job nhiều video: mọi ô của job cùng được cập nhật (ô đã "Dừng chờ" thì thôi)
          const cur = normalizeVideoIngrData(getNode(id)?.data as Record<string, unknown> | undefined).videos
          if (!cur.some((v) => v.jobId === jobId && v.status === 'running')) break
          const missing = job === null
          updateNodeData(id, (node) => {
            const list = normalizeVideoIngrData(node.data as Record<string, unknown>).videos
            if (!list.some((v) => v.jobId === jobId && v.status === 'running')) return {}
            return {
              videos: list.map((v) =>
                v.jobId !== jobId || v.status !== 'running'
                  ? v
                  : missing
                    ? { ...v, status: 'error' as const, error: 'Backend không còn job này — xem Thư Viện Video / Veo Studio.', updatedAt: Date.now() }
                    : videoFromJob(v, job!),
              ),
            }
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
      const jobs = new Map<string, VeoJobLite>()
      for (const { outcome } of batch) if ('job' in outcome) jobs.set(outcome.job.job_id, outcome.job)
      for (const job of jobs.values()) {
        if (job.status === 'done') notifyVideoLibraryChanged()
        else if (job.status !== 'error') poll(job.job_id)
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
   * Tạo video cho các ô `indices` (0 = biến thể 1). Video và ảnh đều tùy chọn:
   * - Có video + ảnh: gửi MỘT job Flow `video_edit` ra `indices.length` video (x1–x4).
   * - Chỉ video / chỉ ảnh (`ingredients`) / chỉ prompt (`text_to_video`): mỗi biến thể gửi 1 job độc lập (`num_outputs: 1`).
   */
  function createVideos(indices: number[]) {
    if (running || blockers.length || runs.isRunning(flight) || !flow || !indices.length) return
    const attempt = videoIngrNextAttempt(videos)
    const started = Date.now()
    const batchMode = videoIngrSupportsBatch(refVideo, refs) && indices.length > 1
    const fresh = (k: number): MuseClipVideo => ({
      status: 'running',
      fingerprint,
      attempt,
      ...(batchMode ? { outputIndex: k } : {}),
      step: refVideo ? 'uploading' : 'submitting',
      detail: refVideo ? `Đang tải “${refVideo.name}” lên project Flow (lần sau dùng lại)…` : 'Đang gửi lệnh tạo video lên Flow…',
      startedAt: started,
      updatedAt: started,
    })
    const next = [...videos]
    indices.forEach((i, k) => { next[i] = fresh(k) })
    updateNodeData(id, { videos: next })
    const snapshot = { prompt, trimStart: data.trimStart, trimEnd: data.trimEnd, targetSeconds: data.targetSeconds }
    const batch: Promise<BatchOutcome> = (async () => {
      let mediaId = ''
      if (refVideo) {
        try {
          const file = await fetchVideoFile(refVideo.previewUrl, refVideo.name)
          mediaId = (await uploadVideoReference(file, flow.flowProjectId, { forceFresh: false, nativeUi: false })).media_id
        } catch (e: any) {
          const outcome: SubmitOutcome = { error: e?.message || 'Không tải được video tham chiếu lên Flow' }
          return indices.map((index) => ({ index, outcome }))
        }
      }
      if (batchMode) {
        let outcome: SubmitOutcome
        try {
          const body = buildVideoIngrRequest(id, snapshot, refVideo, refs, flow, mediaId, attempt, indices[0] + 1, indices.length)
          outcome = { job: await submitVeoJob(body) }
        } catch (e: any) {
          outcome = { error: e?.message || 'Không gửi được job' }
        }
        return indices.map((index) => ({ index, outcome }))
      }
      const out: BatchOutcome = []
      for (const index of indices) {
        let outcome: SubmitOutcome
        try {
          const body = buildVideoIngrRequest(id, snapshot, refVideo, refs, flow, mediaId, attempt, index + 1, 1)
          outcome = { job: await submitVeoJob(body) }
        } catch (e: any) {
          outcome = { error: e?.message || 'Không gửi được job' }
        }
        out.push({ index, outcome })
      }
      return out
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

  /** Đưa khung nhìn tới một node. */
  function focusNode(nodeId: string) {
    const n = getNode(nodeId)
    if (!n) return
    setCenter(n.position.x + (n.measured?.width ?? 280) / 2, n.position.y + (n.measured?.height ?? 300) / 2, { zoom: 1, duration: 400 })
  }

  /** "Ra node": tách video của các ô thành node Video tham chiếu bên phải node này (đã có node thì chỉ đến node đó). */
  function toNodes(indices: number[]) {
    const me = getNode(id)
    if (!me) return
    const x = me.position.x + (me.measured?.width ?? 460) + 90
    const made: { index: number; nodeId: string }[] = []
    const fresh = indices.filter((i) => !(videos[i]?.outNodeId && getNode(videos[i]!.outNodeId!)))
    if (indices.length === 1 && !fresh.length) {
      focusNode(videos[indices[0]]!.outNodeId!)
      return
    }
    fresh.forEach((i, k) => {
      const ref = videoIngrTileToRef(videos[i], veoVideoUrl)
      if (!ref) return
      const node = createVideoRefNode({ x, y: me.position.y + k * 430 })
      const label = `${data.title} · ${slotCount > 1 ? `biến thể ${i + 1}` : 'video'}`.slice(0, 60)
      addNodes({ ...node, data: { ...node.data, label, video: ref } } as Node)
      made.push({ index: i, nodeId: node.id })
    })
    if (!made.length) return
    updateNodeData(id, (n) => {
      const list = [...normalizeVideoIngrData(n.data as Record<string, unknown>).videos]
      for (const m of made) if (list[m.index]) list[m.index] = { ...list[m.index], outNodeId: m.nodeId }
      return { videos: list }
    })
    if (made.length === 1) setTimeout(() => focusNode(made[0].nodeId), 60)
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

  const mode = videoIngrMode(refVideo, refs)
  const maxRefs = videoIngrMaxRefs(refVideo)
  const duration = videoIngrDuration(runData, refVideo, refs)
  const trimOk = !refVideo || (trim.length >= VIDEO_INGR_MIN_SECONDS && trim.length <= VIDEO_INGR_MAX_SECONDS && trim.end > trim.start)
  const credits = trimOk ? videoIngrModeCredits(runData, refVideo, refs, config.flowResolution) : null
  const totalCredits = credits != null ? credits * Math.max(1, variants) : null
  const modeSummary =
    mode === 'video_edit'
      ? refs.length > 0
        ? 'chỉnh video + ảnh'
        : 'chỉnh video theo prompt'
      : mode === 'ingredients'
        ? `tạo video từ ảnh (${Math.round(duration)}s)`
        : `tạo video từ chữ (${Math.round(duration)}s)`
  const collapsed = data.collapsed
  const dur = refVideo?.durationSec || Math.max(trim.end, VIDEO_INGR_MAX_SECONDS)
  const pct = (t: number) => `${Math.min(100, Math.max(0, (t / dur) * 100))}%`
  const fmt = (t: number) => `${(Math.round(t * 10) / 10).toFixed(1)}s`
  const slots = Array.from({ length: Math.max(maxRefs, refs.length) }, (_, i) => refs[i] ?? null)
  // các ô đã có video mà chưa tách thành node (cho nút "Tất cả ra node")
  // có ít nhất một video "Xong" + có video mẫu → hiện nút "Đối chiếu video mẫu"
  const canCompare = !!refVideo && states.some((st, i) => canCompareWithReference(st, !!videos[i]?.files?.length, true))
  const toNodeAll = videos.flatMap((v, i) => (videoIngrTileToRef(v, veoVideoUrl) && !(v.outNodeId && getNode(v.outNodeId)) ? [i] : []))

  return (
    <div className={`mc-node mc-node-vingr ${selected ? 'selected' : ''}`}>
      <MusePromptPort linked={linked} top={portTops[0]} />
      <MuseMediaPort
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.refVideoIn}
        kind="Video"
        label="Video mẫu"
        style={{ top: portTops[1] }}
        title="Video (tùy chọn): nối từ node “Video tham chiếu” hoặc “Cắt video” (1 video)"
      />
      <MuseMediaPort
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.refsIn}
        kind="Image"
        label="Tham chiếu"
        style={{ top: portTops[2] }}
        title={`Ảnh (tùy chọn): nối từ Ảnh kết quả / Nhân vật / Trang phục / Bối cảnh — tối đa ${maxRefs} ảnh (${VIDEO_INGR_MAX_REFS} khi có video)`}
      />

      <div className="mc-node-head">
        <MuseMediaIcon kind="Video" />
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small>Omni 1.2 · {modeSummary} · {config.flowResolution}</small>
        </div>
        <span className="mc-node-count" title="Ảnh tham chiếu đã nối / tối đa">{refs.length}/{maxRefs} ảnh</span>
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
              <Video size={11} /> {refVideo ? `${refVideo.name} · ${fmt(trim.start)}–${fmt(trim.end)}` : modeSummary}
            </span>
            <span className="mc-thumbs">
              {refs.map((r) =>
                r.image ? <img key={r.sourceNodeId} src={museMediaUrl(r.image.previewUrl)} alt={r.label} title={r.label} draggable={false} /> : null,
              )}
            </span>
          </div>
        ) : (
          <>
            {/* ===== Video tham chiếu: xem + cắt đoạn (tùy chọn) ===== */}
            <section className="mc-vingr-card">
              <div className="mc-vingr-title">
                <Video size={12} /> Video tham chiếu <span className="mc-node-badge">Tùy chọn</span>
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
                  <span>Không bắt buộc — nối “Video tham chiếu” vào cổng Video nếu muốn chỉnh theo video mẫu</span>
                  <small>Flow nhận đoạn {VIDEO_INGR_MIN_SECONDS}–{VIDEO_INGR_MAX_SECONDS} giây (bỏ trống để tạo video từ ảnh hoặc chữ)</small>
                </div>
              )}
            </section>

            {/* ===== Ảnh tham chiếu (tùy chọn) ===== */}
            <section className="mc-vingr-card">
              <div className="mc-vingr-title">
                Ảnh tham chiếu <span className="mc-node-badge">{refs.length}/{maxRefs}</span> <span className="mc-node-badge">Tùy chọn</span>
                <small className="mc-xtoggle-hint">{refVideo ? 'theo thứ tự · tối đa 5 ảnh' : 'không có video · tối đa 3 ảnh'}</small>
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
                      <span className="mc-vingr-ref-label">Nối ảnh vào cổng “Ảnh”</span>
                    </div>
                  ),
                )}
              </div>
            </section>

            {/* ===== Prompt ===== */}
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
                />
                <div className="mc-node-actions">
                  <button type="button" className="mc-mini-btn nodrag" onClick={resetPrompt} disabled={!!linked || !!busy}>
                    <RotateCcw size={12} /> Mặc định
                  </button>
                  <button type="button" className="mc-mini-btn nodrag" onClick={savePrompt} disabled={!!linked || !!busy || !prompt.trim()}>
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
            {canCompare && (
              <button
                type="button"
                className={`mc-mini-btn nodrag mc-vingr-compare ${compare ? 'on' : ''}`}
                aria-pressed={compare}
                onClick={() => setCompare((v) => !v)}
                title="Xem video kết quả cạnh đúng đoạn video mẫu đã gửi, phát đồng bộ để so chuyển động"
              >
                <Columns2 size={11} /> Đối chiếu video mẫu
              </button>
            )}
            {toNodeAll.length > 1 && (
              <button type="button" className="mc-mini-btn nodrag mc-vingr-allnode" onClick={() => toNodes(toNodeAll)} title="Tách mọi video đã tạo (chưa có node) thành node Video tham chiếu">
                <ArrowUpRight size={11} /> Tất cả ra node
              </button>
            )}
            <small>
              {config.flowAspect} · {config.flowResolution} · {variants} biến thể · {flowProject ? flowProject.name : 'chưa chọn project'}
              {flowProject?.account_email ? ` · ${flowProject.account_email}` : ''}
            </small>
          </div>

          {videos.length > 0 && (
            <div className={`mc-vingr-variants cols-${compare || slotCount < 2 ? 1 : 2}`}>
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
                  batchTile={videoIngrIsBatchTile(videos[i], videos)}
                  onRecover={() => recoverVideo(i)}
                  onRetry={() => createVideos([i])}
                  hasNode={!!(videos[i]?.outNodeId && getNode(videos[i]!.outNodeId!))}
                  reference={compare && refVideo ? { url: museMediaUrl(refVideo.previewUrl), start: trim.start, end: trim.end, name: refVideoLabel || refVideo.name } : null}
                  onToNode={() => toNodes([i])}
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
                  ? `Gửi MỘT lệnh Flow ra ${variants} video (như chọn x${variants} trên Flow; video tham chiếu chỉ tải lên 1 lần, Flow tính credit từng video) — bấm là gửi ngay; không bao giờ tự gửi lại`
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
