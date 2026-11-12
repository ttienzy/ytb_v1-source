// Kiểu dữ liệu + logic thuần (không React/DOM) của trang Video — để test bằng node:test.

export type Aspect = '9:16' | '16:9'
export type CropMode = 'fit' | 'square' | 'custom'
export type LabelPosition = 'top' | 'center' | 'bottom' | 'custom'

export type VideoItem = { video_id: string; name: string; size_bytes: number; duration_sec: number }
export type DoneItem = { done_id: string; name: string; source_name: string; aspect: string; created_at: string }
export type MergedItem = { file_name: string; name: string; duration_sec: number; aspect: Aspect; created_at: string }
export type ProcessProgress = { percent: number; status: 'processing' | 'done' | 'error'; phase?: string; error?: string }

export type BlurOptions = { enabled: boolean; x: number; y: number; w: number; h: number; amount: number }
export type Options = {
  aspect: Aspect
  crop: CropMode
  background: string
  background_image: string
  label: string
  label_background: string
  crop_x: number
  crop_y: number
  crop_w: number
  crop_h: number
  remove_audio: boolean
  label_position: LabelPosition
  label_x: number
  label_y: number
  blur: BlurOptions
}
export type SavedState = { preset_id: string; name: string; options: Options; created_at: string }

export const defaults: Options = {
  aspect: '9:16', crop: 'fit', background: '#111827', background_image: '', label: '', label_background: '#000000',
  crop_x: 0, crop_y: 0, crop_w: 1, crop_h: 1, remove_audio: false, label_position: 'bottom', label_x: 0.5, label_y: 0.88,
  blur: { enabled: false, x: 0.25, y: 0.25, w: 0.5, h: 0.25, amount: 60 },
}

/** Gộp cấu hình đã lưu (có thể thiếu trường do bản cũ) với mặc định. */
export function normalizeOptions(raw: unknown): Options {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Partial<Options>
  return { ...defaults, ...saved, blur: { ...defaults.blur, ...(saved.blur || {}) } }
}

export function mergeTotalSeconds(minutes: number, seconds: number): number {
  return Math.max(0, Math.round(Number(minutes) || 0) * 60 + Math.round(Number(seconds) || 0))
}

/** 22.4 -> "0:22"; 3725 -> "1:02:05"; không có thời lượng -> "—". */
export function formatDuration(seconds: number | null | undefined): string {
  if (!seconds || seconds <= 0) return '—'
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`
}

export function formatSize(bytes: number): string {
  const mb = bytes / 1024 / 1024
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb.toFixed(1)} MB`
}

const pct = (value: number) => `${Math.round(value * 1000) / 10}%`

/** Khung cắt hiển thị trên preview (null = không cắt, giữ nguyên khung hình). */
export function cropFrame(options: Pick<Options, 'crop' | 'crop_x' | 'crop_y' | 'crop_w' | 'crop_h'>): { left: string; top: string; width: string; height: string } | null {
  if (options.crop === 'custom') {
    return { left: pct(options.crop_x), top: pct(options.crop_y), width: pct(options.crop_w), height: pct(options.crop_h) }
  }
  if (options.crop === 'square') return { left: '15%', top: '15%', width: '70%', height: '70%' }
  return null
}

/** clip-path để chỉ hiện phần làm mờ trên bản sao của video. */
export function blurClipPath(blur: Pick<BlurOptions, 'x' | 'y' | 'w' | 'h'>): string {
  const top = blur.y * 100
  const right = 100 - (blur.x + blur.w) * 100
  const bottom = 100 - (blur.y + blur.h) * 100
  const left = blur.x * 100
  return `inset(${top}% ${Math.max(0, right)}% ${Math.max(0, bottom)}% ${left}%)`
}

export function groupMergedByAspect(items: MergedItem[]): Record<Aspect, MergedItem[]> {
  return { '9:16': items.filter(item => item.aspect === '9:16'), '16:9': items.filter(item => item.aspect === '16:9') }
}

/** Tổng hợp tiến trình nhiều video: số video xong / lỗi / phần trăm trung bình. */
export function progressSummary(ids: string[], progress: Record<string, ProcessProgress>): { done: number; failed: number; percent: number } {
  if (!ids.length) return { done: 0, failed: 0, percent: 0 }
  let done = 0
  let failed = 0
  let sum = 0
  for (const id of ids) {
    const item = progress[id]
    if (!item) continue
    if (item.status === 'done') done++
    else if (item.status === 'error') failed++
    sum += item.status === 'done' ? 100 : item.percent
  }
  return { done, failed, percent: Math.round(sum / ids.length) }
}
