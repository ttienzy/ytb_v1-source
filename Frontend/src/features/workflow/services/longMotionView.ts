/**
 * Motion Control cho video mẫu dài: kiểu dữ liệu và hàm thuần để hiển thị (không React/DOM, test bằng node:test).
 * Backend: Backend/app/motion_long. Mỗi đoạn là một lượt tạo tính phí; hàng đợi chạy tuần tự và dừng khi có đoạn lỗi.
 */

export type SegmentState = 'idle' | 'queued' | 'cutting' | 'uploading' | 'submitting' | 'generating' | 'done' | 'error'
export type LongAudioMode = 'original' | 'bgm' | 'none'

export interface LongSegment {
  index: number
  start: number
  end: number
  length: number
  state: SegmentState
  attempts: number
  veo_job_id: string | null
  error: string | null
  note: string | null
  output: string | null
  out_duration: number | null
}

export interface LongMotionOptions {
  overlap: boolean
  overlap_seconds: number
  audio: LongAudioMode
  bgm_track_id: string | null
  bgm_volume: number
  crossfade: number
  project_mode: 'new' | 'active'
}

export interface LongMergeStatus {
  state: 'idle' | 'running' | 'done' | 'error'
  message?: string
  error?: string
  duration?: number
  duration_drift?: number[]
}

export interface LongExportStatus {
  state: 'idle' | 'running' | 'done' | 'error'
  message?: string
  error?: string
  method?: 'merged' | 'segments' | null
}

export interface LongMotionJob {
  id: string
  filename: string
  source: { duration: number; width: number; height: number; fps: number; has_audio: boolean }
  prompt: string
  aspect_ratio: '9:16' | '16:9'
  options: LongMotionOptions
  segments: LongSegment[]
  merge: LongMergeStatus
  exports: { clean?: LongExportStatus }
  queue_running: boolean
  worker_alive: boolean
  credits: number
  credits_remaining: number
  overlaps: number[]
  final_ready: boolean
  clean_ready: boolean
}

export interface LongPlan {
  segments: { index: number; start: number; end: number; length: number }[]
  overlaps: number[]
  credits: number
}

/** Video dài hơn mức này mới cần chia đoạn (Flow nhận tối đa 10 giây mỗi lượt). */
export const LONG_MOTION_THRESHOLD_SECONDS = 10.05

export const SEGMENT_STATE_LABEL: Record<SegmentState, string> = {
  idle: 'Chưa chạy',
  queued: 'Chờ đến lượt',
  cutting: 'Đang cắt đoạn',
  uploading: 'Đang tải lên Flow',
  submitting: 'Đang gửi lệnh',
  generating: 'Flow đang tạo',
  done: 'Xong',
  error: 'Lỗi',
}

const BUSY: SegmentState[] = ['cutting', 'uploading', 'submitting', 'generating']

export function isSegmentBusy(state: SegmentState): boolean {
  return BUSY.includes(state)
}

export function needsLongMotion(durationSec: number | undefined | null): boolean {
  return Number.isFinite(durationSec) && (durationSec as number) > LONG_MOTION_THRESHOLD_SECONDS
}

/** "6,8–14,7 giây" (dấu phẩy thập phân kiểu Việt). */
export function formatRange(seg: { start: number; end: number }): string {
  const f = (n: number) => n.toFixed(1).replace('.', ',')
  return `${f(seg.start)}–${f(seg.end)} giây`
}

export function formatSeconds(n: number): string {
  return `${n.toFixed(1).replace('.', ',')} giây`
}

export function creditText(credits: number, measured = false): string {
  return `${measured ? '' : 'khoảng '}${credits} credits`
}

export interface TimelineBlock {
  index: number
  leftPct: number
  widthPct: number
  /** Phần đầu đoạn gối lên đoạn trước (tính theo % của khối), 0 nếu không gối. */
  overlapPct: number
}

/** Vị trí từng đoạn trên thanh thời gian của video gốc (để vẽ). */
export function timelineBlocks(
  segments: { index: number; start: number; end: number }[],
  total: number,
): TimelineBlock[] {
  if (!(total > 0)) return []
  return segments.map((seg, i) => {
    const prev = segments[i - 1]
    const overlap = prev ? Math.max(0, prev.end - seg.start) : 0
    const length = seg.end - seg.start
    return {
      index: seg.index,
      leftPct: (seg.start / total) * 100,
      widthPct: (length / total) * 100,
      overlapPct: length > 0 ? Math.min(100, (overlap / length) * 100) : 0,
    }
  })
}

export function doneCount(segments: { state: SegmentState }[]): number {
  return segments.filter((s) => s.state === 'done').length
}

export function allDone(segments: { state: SegmentState }[]): boolean {
  return segments.length > 0 && segments.every((s) => s.state === 'done')
}

export interface LongActions {
  canRunAll: boolean
  canStop: boolean
  canMerge: boolean
  canCleanExport: boolean
  /** Lý do không cho chạy (hiện cho người dùng), rỗng nếu được. */
  runBlockedReason: string
}

export function longActions(job: Pick<LongMotionJob, 'segments' | 'merge' | 'exports' | 'worker_alive'>): LongActions {
  const busy = job.segments.some((s) => isSegmentBusy(s.state))
  const running = job.worker_alive || busy
  const pending = job.segments.filter((s) => s.state !== 'done').length
  const merging = job.merge.state === 'running'
  const cleaning = job.exports.clean?.state === 'running'
  return {
    canRunAll: !running && pending > 0,
    canStop: running,
    canMerge: !running && allDone(job.segments) && !merging,
    canCleanExport: job.merge.state === 'done' && !merging && !cleaning,
    runBlockedReason: running ? 'Đang có đoạn chạy. Đợi xong hoặc bấm Dừng.' : pending === 0 ? 'Mọi đoạn đã xong. Bấm Ghép video.' : '',
  }
}

/** Dòng tóm tắt tiến độ dưới tiêu đề. */
export function progressSummary(job: Pick<LongMotionJob, 'segments' | 'merge'>): string {
  const total = job.segments.length
  const done = doneCount(job.segments)
  const failed = job.segments.find((s) => s.state === 'error')
  if (failed) return `Đoạn ${failed.index + 1} lỗi. Hàng đợi đã dừng, chưa tạo thêm đoạn nào.`
  if (job.merge.state === 'running') return 'Đang ghép video…'
  if (job.merge.state === 'done') return `Đã ghép xong ${total} đoạn.`
  const current = job.segments.find((s) => isSegmentBusy(s.state))
  if (current) return `Đang tạo đoạn ${current.index + 1}/${total} (${done} đoạn xong).`
  return `${done}/${total} đoạn xong.`
}

/** Kết quả Flow ngắn/dài hơn đoạn đã gửi quá 0,3 giây: mốc ghép có thể lệch, cần báo. */
export function driftWarning(segments: LongSegment[]): string {
  const bad = segments.filter((s) => s.out_duration != null && Math.abs(s.out_duration - s.length) > 0.3)
  if (!bad.length) return ''
  const list = bad.map((s) => `đoạn ${s.index + 1}: ${formatSeconds(s.out_duration as number)} thay vì ${formatSeconds(s.length)}`).join('; ')
  return `Độ dài video Flow trả về lệch so với đoạn đã gửi (${list}). Điểm ghép có thể không khớp chuyển động.`
}

export function jobStorageKey(file: { name: string; size: number }): string {
  return `motionLong:${file.name}:${file.size}`
}
