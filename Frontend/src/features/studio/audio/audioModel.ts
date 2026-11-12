// Logic thuần (không React/DOM) của Workflow Audio — để test bằng node:test.

export interface AudioChapter {
  chapter_number: number
  title: string
  completed?: boolean
  drive_uploaded?: boolean
}

/** Một dòng trong danh sách truyện (nhẹ): chỉ số đếm. Chương chi tiết tải theo từng truyện khi chọn (xem AudioChapter). */
export interface AudioStory {
  story_slug: string
  name: string
  thumbnail_name?: string | null
  total_chapters: number
  done_chapters: number
  /** Đã có bản tóm tắt cốt truyện do Gemini viết. */
  has_summary?: boolean
}

export interface QueueItem {
  story_slug: string
  chapter_numbers: number[]
}

export type StoryFilter = 'all' | 'pending' | 'partial' | 'done' | 'queued'
export type StoryStatus = 'new' | 'partial' | 'done' | 'empty'

export const MAX_QUEUE_STORIES = 10

/** Bỏ dấu + hạ chữ thường để tìm "ta la ta uyen" ra "TA LÀ TẠ UYỂN". */
export function normalizeText(value: string): string {
  return value.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[đĐ]/g, 'd').toLowerCase().trim()
}

export interface StoryView {
  story: AudioStory
  total: number
  doneCount: number
  status: StoryStatus
  key: string
}

/** Dựng sẵn thông tin hiển thị cho từng truyện (làm một lần, không tính lại mỗi lần render). */
export function buildStoryViews(stories: AudioStory[]): StoryView[] {
  const views = stories.map<StoryView>(story => {
    const total = story.total_chapters
    const doneCount = Math.min(story.done_chapters, total)
    const status: StoryStatus = total === 0 ? 'empty' : doneCount === 0 ? 'new' : doneCount === total ? 'done' : 'partial'
    return { story, total, doneCount, status, key: normalizeText(story.name) }
  })
  // Truyện đã xong xuống cuối, còn lại theo tên.
  return views.sort((a, b) => {
    const aDone = a.status === 'done'
    const bDone = b.status === 'done'
    if (aDone !== bDone) return aDone ? 1 : -1
    return a.story.name.localeCompare(b.story.name, 'vi')
  })
}

/** Số chương đã làm của một truyện (từ danh sách chương đã tải). */
export function doneSet(chapters: AudioChapter[] | null | undefined): Set<number> {
  return new Set((chapters ?? []).filter(chapter => chapter.completed).map(chapter => chapter.chapter_number))
}

export function filterStoryViews(views: StoryView[], opts: { query: string; filter: StoryFilter; queue: QueueItem[] }): StoryView[] {
  const tokens = normalizeText(opts.query).split(/\s+/).filter(Boolean)
  const queued = new Set(opts.queue.map(item => item.story_slug))
  return views.filter(view => {
    if (opts.filter === 'pending' && view.status === 'done') return false
    if (opts.filter === 'partial' && view.status !== 'partial') return false
    if (opts.filter === 'done' && view.status !== 'done') return false
    if (opts.filter === 'queued' && !queued.has(view.story.story_slug)) return false
    return tokens.every(token => view.key.includes(token))
  })
}

// ── Hàng đợi (bất biến) ──────────────────────────────────────────────────────

export function queueTotals(queue: QueueItem[]): { stories: number; chapters: number } {
  return { stories: queue.length, chapters: queue.reduce((n, item) => n + item.chapter_numbers.length, 0) }
}

export function canAddStory(queue: QueueItem[], slug: string, max = MAX_QUEUE_STORIES): boolean {
  return queue.some(item => item.story_slug === slug) || queue.length < max
}

/** Đặt toàn bộ chương đã chọn của một truyện (rỗng = bỏ truyện khỏi hàng đợi). Truyện mới thêm vào cuối. */
export function setStoryChapters(queue: QueueItem[], slug: string, numbers: number[], max = MAX_QUEUE_STORIES): QueueItem[] {
  const unique = [...new Set(numbers)].sort((a, b) => a - b)
  const exists = queue.some(item => item.story_slug === slug)
  if (!unique.length) return exists ? queue.filter(item => item.story_slug !== slug) : queue
  if (exists) return queue.map(item => (item.story_slug === slug ? { ...item, chapter_numbers: unique } : item))
  if (queue.length >= max) return queue
  return [...queue, { story_slug: slug, chapter_numbers: unique }]
}

export function toggleChapter(queue: QueueItem[], slug: string, chapter: number, max = MAX_QUEUE_STORIES): QueueItem[] {
  const current = queue.find(item => item.story_slug === slug)?.chapter_numbers ?? []
  const next = current.includes(chapter) ? current.filter(n => n !== chapter) : [...current, chapter]
  return setStoryChapters(queue, slug, next, max)
}

export function removeStory(queue: QueueItem[], slug: string): QueueItem[] {
  return queue.filter(item => item.story_slug !== slug)
}

/** Các số chương nằm giữa hai chương (bao gồm cả hai) theo thứ tự đang hiển thị — dùng cho Shift+click. */
export function chapterRange(displayed: number[], from: number, to: number): number[] {
  const a = displayed.indexOf(from)
  const b = displayed.indexOf(to)
  if (a < 0 || b < 0) return [to]
  return displayed.slice(Math.min(a, b), Math.max(a, b) + 1)
}

/** Sau khi chạy xong: bỏ các chương đã hoàn thành khỏi hàng đợi, chỉ giữ chương còn lại (vd chương lỗi) để chạy lại nhanh.
 *  `chaptersBySlug` là danh sách chương MỚI tải lại; truyện không có trong đó thì giữ nguyên. */
export function pruneCompleted(queue: QueueItem[], chaptersBySlug: Record<string, AudioChapter[] | undefined>): QueueItem[] {
  return queue
    .map(item => {
      const chapters = chaptersBySlug[item.story_slug]
      if (!chapters) return item
      const done = doneSet(chapters)
      return { ...item, chapter_numbers: item.chapter_numbers.filter(n => !done.has(n)) }
    })
    .filter(item => item.chapter_numbers.length > 0)
}

// ── Kiểm tra + payload ───────────────────────────────────────────────────────

export interface QueueValidation {
  errors: string[]
  /** Truyện trong hàng đợi chưa có thumbnail (bắt buộc). */
  missingThumbnail: AudioStory[]
}

export function validateQueue(queue: QueueItem[], stories: AudioStory[], voice: string): QueueValidation {
  const errors: string[] = []
  const bySlug = new Map(stories.map(story => [story.story_slug, story]))
  const missingThumbnail = queue.map(item => bySlug.get(item.story_slug)).filter((story): story is AudioStory => !!story && !story.thumbnail_name)
  if (!queue.length) errors.push('Chọn ít nhất 1 chương ở danh sách bên trái.')
  if (!voice) errors.push('Chọn giọng đọc.')
  if (missingThumbnail.length) errors.push(`${missingThumbnail.length === 1 ? `Truyện "${missingThumbnail[0].name}"` : `${missingThumbnail.length} truyện`} chưa có thumbnail.`)
  return { errors, missingThumbnail }
}

export type BgFit = 'fill' | 'blur'

export interface RunOptions {
  /** Âm thanh & hiệu ứng (tốc độ đọc, nhạc nền, lớp phủ, kiểu nền…). */
  style: AudioStyle
  voice: string
  aspect: '9:16' | '16:9'
  bgm: boolean
  drive: boolean
  /** Cách khớp video nền vào khung: lấp đầy (cắt giữa) hoặc giữ nguyên + nền mờ. */
  bgFit: BgFit
}

/** Đúng 1 chương -> đường chạy đơn; còn lại -> batch_items (backend không giới hạn số chương mỗi truyện ở đường này). */
export function buildRunBody(queue: QueueItem[], opts: RunOptions): Record<string, unknown> {
  const common = {
    voice_id: opts.voice,
    aspect: opts.aspect,
    bg_fit: opts.bgFit,
    options: opts.style,
    bgm_random: true,
    bgm_enabled: opts.bgm,
    auto_upload_drive: opts.drive,
    delete_local_after_upload: opts.drive,
  }
  const { chapters } = queueTotals(queue)
  if (chapters === 1) return { story_slug: queue[0].story_slug, chapter_number: queue[0].chapter_numbers[0], ...common }
  return { story_slug: queue[0].story_slug, batch_items: queue, ...common }
}

// ── Các bước tiến trình ──────────────────────────────────────────────────────

export type StepKey = 'image' | 'voice' | 'duration' | 'merge' | 'overlay' | 'mux' | 'bgm' | 'drive' | 'done'
export type StepState = 'pending' | 'running' | 'done' | 'error' | 'skipped'

const STEP_TITLES: Record<StepKey, string> = {
  image: 'Thumbnail',
  voice: 'Giọng đọc',
  duration: 'Thời lượng',
  merge: 'Ghép video nền',
  overlay: 'Lớp phủ',
  mux: 'Ghép voice',
  bgm: 'Nhạc nền',
  drive: 'Upload Drive',
  done: 'Hoàn tất',
}

/** Thứ tự khớp backend (thumbnail trước voice để lỗi rẻ báo sớm). */
export function audioSteps(opts: { bgm: boolean; drive: boolean; overlay?: boolean }): Array<{ key: StepKey; title: string }> {
  const keys: StepKey[] = ['image', 'voice', 'duration', 'merge', ...(opts.overlay ? (['overlay'] as StepKey[]) : []), 'mux', ...(opts.bgm ? (['bgm'] as StepKey[]) : []), ...(opts.drive ? (['drive'] as StepKey[]) : []), 'done']
  return keys.map(key => ({ key, title: STEP_TITLES[key] }))
}

export interface JobLike {
  status?: string
  step?: string
  skipped_steps?: string[]
}

export function stepState(job: JobLike | null, key: StepKey, steps: Array<{ key: StepKey }>): StepState {
  if (!job) return 'pending'
  if (Array.isArray(job.skipped_steps) && job.skipped_steps.includes(key)) return 'skipped'
  const order = steps.map(step => step.key)
  const current = order.indexOf(job.step as StepKey)
  const index = order.indexOf(key)
  if (job.status === 'error' && index === current) return 'error'
  if (job.status === 'completed') return 'done'
  if (index < current || (job.step === 'done' && index === current)) return 'done'
  if (index === current) return 'running'
  return 'pending'
}

/** [1,2,3,5,7,8] -> "1–3, 5, 7–8" (gọn khi hiển thị nhiều chương). */
export function formatRanges(numbers: number[]): string {
  const sorted = [...new Set(numbers)].sort((a, b) => a - b)
  const parts: string[] = []
  for (let i = 0; i < sorted.length; ) {
    let j = i
    while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j++
    parts.push(j > i ? `${sorted[i]}–${sorted[j]}` : String(sorted[i]))
    i = j + 1
  }
  return parts.join(', ')
}

// ── Văn bản tóm tắt cốt truyện ───────────────────────────────────────────────

export type SummaryBlock = { type: 'heading' | 'bullet' | 'para'; text: string }

/** Tách bản tóm tắt (văn bản thuần) thành tiêu đề (dòng viết hoa), gạch đầu dòng và đoạn văn để hiển thị gọn. */
export function parseSummary(text: string): SummaryBlock[] {
  const blocks: SummaryBlock[] = []
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const bullet = line.match(/^[-•*]\s+(.*)$/)
    if (bullet) blocks.push({ type: 'bullet', text: bullet[1] })
    else if (/\p{L}/u.test(line) && line === line.toUpperCase() && line.length <= 60) blocks.push({ type: 'heading', text: line.replace(/[:：\s]+$/, '') })
    else blocks.push({ type: 'para', text: line })
  }
  return blocks
}

// ── Thư viện video nền ───────────────────────────────────────────────────────

export type BgStatus = 'ready' | 'queued' | 'running' | 'missing' | 'error'

export interface BgClipState {
  status: BgStatus
  error?: string | null
}

/** Một video nguồn trong thư viện nền (không gắn khổ); mỗi khổ có trạng thái chuẩn hóa riêng. */
export interface BgItem {
  video_id: string
  name: string
  duration_sec: number
  size_bytes: number
  states: Record<'9:16' | '16:9', BgClipState>
}

export interface BgSummary {
  total: number
  /** Đã chuẩn hóa xong cho khổ đang chọn. */
  ready: number
  /** Đang chờ / đang chuẩn hóa (cần theo dõi tiếp). */
  busy: number
  failed: number
}

export function backgroundSummary(items: BgItem[], aspect: '9:16' | '16:9'): BgSummary {
  const summary: BgSummary = { total: items.length, ready: 0, busy: 0, failed: 0 }
  for (const item of items) {
    const status = item.states[aspect]?.status
    if (status === 'ready') summary.ready++
    else if (status === 'queued' || status === 'running') summary.busy++
    else if (status === 'error') summary.failed++
  }
  return summary
}

/** Còn clip đang chuẩn hóa ở BẤT KỲ khổ nào → giao diện cần hỏi lại tiến độ. */
export function hasBackgroundWork(items: BgItem[]): boolean {
  return items.some(item => Object.values(item.states).some(state => state.status === 'queued' || state.status === 'running'))
}

// ── Âm thanh & hiệu ứng ──────────────────────────────────────────────────────

export type DuckMode = 'off' | 'normal' | 'strong'
export type TitleCard = 'off' | 'intro' | 'always'
export type LogoPosition = 'tl' | 'tr' | 'bl' | 'br'
export type BgMode = 'library' | 'cover'

/** Cùng cấu trúc với AudioOptions ở backend (app/media/audio_options.py). */
export interface AudioStyle {
  voice_speed: number
  bgm_volume: number
  bgm_duck: DuckMode
  bgm_track_id: string | null
  fade_out_sec: number
  loudnorm: boolean
  bg_mode: BgMode
  dim: number
  title_card: TitleCard
  title_seconds: number
  waveform: boolean
  logo_id: string | null
  logo_position: LogoPosition
  logo_size: number
  logo_opacity: number
}

export const DEFAULT_STYLE: AudioStyle = {
  voice_speed: 1, bgm_volume: 0.22, bgm_duck: 'normal', bgm_track_id: null, fade_out_sec: 1.5, loudnorm: true,
  bg_mode: 'library', dim: 0, title_card: 'off', title_seconds: 6, waveform: false,
  logo_id: null, logo_position: 'tr', logo_size: 0.14, logo_opacity: 0.9,
}

const RANGES = {
  voice_speed: [0.7, 1.5], bgm_volume: [0, 1], fade_out_sec: [0, 6], dim: [0, 0.7], title_seconds: [2, 20], logo_size: [0.05, 0.4], logo_opacity: [0.1, 1],
} as const

function pick<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback
}

/** Khôi phục cấu hình đã lưu (có thể thiếu trường / sai kiểu / ngoài khoảng) về dạng hợp lệ — backend sẽ từ chối giá trị ngoài khoảng. */
export function mergeStyle(raw: unknown): AudioStyle {
  const saved = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (key: keyof typeof RANGES): number => {
    const [min, max] = RANGES[key]
    const value = saved[key]
    return typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : (DEFAULT_STYLE[key] as number)
  }
  const logo = saved.logo_id
  return {
    voice_speed: num('voice_speed'),
    bgm_volume: num('bgm_volume'),
    bgm_duck: pick(saved.bgm_duck, ['off', 'normal', 'strong'], DEFAULT_STYLE.bgm_duck),
    bgm_track_id: typeof saved.bgm_track_id === 'string' && saved.bgm_track_id ? saved.bgm_track_id : null,
    fade_out_sec: num('fade_out_sec'),
    loudnorm: typeof saved.loudnorm === 'boolean' ? saved.loudnorm : DEFAULT_STYLE.loudnorm,
    bg_mode: pick(saved.bg_mode, ['library', 'cover'], DEFAULT_STYLE.bg_mode),
    dim: num('dim'),
    title_card: pick(saved.title_card, ['off', 'intro', 'always'], DEFAULT_STYLE.title_card),
    title_seconds: num('title_seconds'),
    waveform: typeof saved.waveform === 'boolean' ? saved.waveform : DEFAULT_STYLE.waveform,
    logo_id: typeof logo === 'string' && /^[a-f0-9]{12}$/.test(logo) ? logo : null,
    logo_position: pick(saved.logo_position, ['tl', 'tr', 'bl', 'br'], DEFAULT_STYLE.logo_position),
    logo_size: num('logo_size'),
    logo_opacity: num('logo_opacity'),
  }
}

/** Có lớp phủ nào bật không (khi đó video phải mã hóa lại một lượt nên chậm hơn đường stream copy). */
export function styleNeedsOverlay(style: AudioStyle): boolean {
  return style.dim > 0 || style.title_card !== 'off' || style.waveform || !!style.logo_id
}

/** Các nhãn ngắn mô tả những gì khác mặc định — hiện trên đầu khối khi đang gập. */
export function describeStyle(style: AudioStyle): string[] {
  const tags: string[] = []
  if (Math.abs(style.voice_speed - 1) >= 0.01) tags.push(`Đọc ×${style.voice_speed.toFixed(2)}`)
  if (Math.abs(style.bgm_volume - DEFAULT_STYLE.bgm_volume) >= 0.005) tags.push(`Nhạc ${Math.round(style.bgm_volume * 100)}%`)
  if (!style.loudnorm) tags.push('Không chuẩn hóa âm lượng')
  if (style.bg_mode === 'cover') tags.push('Nền ảnh bìa')
  if (style.dim > 0) tags.push(`Tối ${Math.round(style.dim * 100)}%`)
  if (style.title_card !== 'off') tags.push(style.title_card === 'intro' ? 'Tiêu đề đầu video' : 'Tiêu đề luôn hiện')
  if (style.waveform) tags.push('Waveform')
  if (style.logo_id) tags.push('Logo')
  return tags
}
