// Trạng thái & hiển thị bài đăng Pippit (Facebook / TikTok) dùng chung.
// Module thuần TS (không React/DOM) để node:test nạp được.

export type PippitPlatform = 'facebook' | 'tiktok'

/**
 * - published: Pippit xác nhận đã đăng (status 3)
 * - failed: status 4/6 hoặc có failed_reason
 * - missing: tài khoản đồng bộ được nhưng Pippit không còn task này (bị xóa / chưa từng tạo)
 * - overdue: đã quá giờ hẹn mà chưa có xác nhận (thường do chưa đồng bộ)
 * - scheduled: còn đang chờ tới giờ đăng
 */
export type PippitTaskState = 'published' | 'failed' | 'missing' | 'overdue' | 'scheduled'

export interface PippitTask {
  task_id?: string | null
  status?: number | null
  published?: boolean
  platform?: string | null
  post_id?: string
  post_url?: string
  page_id?: string
  page_name?: string
  handle?: string
  cover_url?: string
  schedule_time_ms?: number
  title?: string
  description?: string
  failed_reason?: string
  account_id?: string
  account_email?: string
  job_id?: string | null
  source?: string | null
  created_at?: string
  synced_at?: string
  missing_on_pippit?: boolean
}

export const PIPPIT_STATUS_PUBLISHED = 3
export const PIPPIT_STATUS_FAILED = 4
export const PIPPIT_STATUS_CANCELLED = 6
/** Quá giờ hẹn bao lâu mà chưa xác nhận thì coi là "quá giờ". */
export const OVERDUE_GRACE_MS = 30 * 60 * 1000

export const STATE_ORDER: PippitTaskState[] = ['scheduled', 'overdue', 'published', 'failed', 'missing']

export const STATE_LABEL: Record<PippitTaskState, string> = {
  scheduled: 'Đang hẹn giờ',
  overdue: 'Quá giờ, chưa xác nhận',
  published: 'Đã đăng',
  failed: 'Lỗi',
  missing: 'Không thấy trên Pippit',
}

export function platformOf(t: PippitTask): PippitPlatform {
  return t.platform === 'tiktok' ? 'tiktok' : 'facebook'
}

export const PLATFORM_LABEL: Record<PippitPlatform, string> = {
  facebook: 'Facebook',
  tiktok: 'TikTok',
}

export function pippitTaskState(t: PippitTask, now: number): PippitTaskState {
  if (t.published || t.status === PIPPIT_STATUS_PUBLISHED) return 'published'
  if (t.status === PIPPIT_STATUS_FAILED || t.status === PIPPIT_STATUS_CANCELLED || t.failed_reason) {
    return 'failed'
  }
  if (t.missing_on_pippit) return 'missing'
  const at = t.schedule_time_ms || 0
  if (at && now - at > OVERDUE_GRACE_MS) return 'overdue'
  return 'scheduled'
}

const KNOWN_REASONS: Record<string, string> = {
  cc_ecom_publisher_publish_error_tech_issue: 'Lỗi kỹ thuật khi Pippit đăng lên nền tảng',
}

/** Lý do lỗi dễ đọc; giữ mã gốc để tra cứu. */
export function failedReasonLabel(t: PippitTask): string {
  const raw = (t.failed_reason || '').trim()
  if (!raw) return t.status === PIPPIT_STATUS_CANCELLED ? 'Task đã bị hủy trên Pippit' : 'Pippit báo đăng lỗi'
  const known = KNOWN_REASONS[raw]
  return known ? `${known} (${raw})` : raw
}

const HASHTAG_RE = /#[\p{L}\p{N}_]+/gu
const HASHTAG_LINE_RE = /^(\s*#[\p{L}\p{N}_]+)+\s*$/u

export interface TaskText {
  title: string
  /** Phần thân caption, đã bỏ tiêu đề lặp ở đầu và các dòng chỉ chứa hashtag. */
  body: string
  hashtags: string[]
}

/**
 * Backend ghép caption = tiêu đề + "\n\n" + mô tả, nên mô tả thường lặp lại tiêu đề.
 * Tách thành tiêu đề / thân / hashtag để hiển thị gọn.
 */
export function taskText(t: PippitTask): TaskText {
  const title = (t.title || '').trim()
  let desc = (t.description || '').replace(/\r\n/g, '\n').trim()
  if (title && desc.startsWith(title)) desc = desc.slice(title.length).trim()

  const hashtags: string[] = []
  const bodyLines: string[] = []
  for (const line of desc.split('\n')) {
    if (HASHTAG_LINE_RE.test(line)) {
      for (const m of line.match(HASHTAG_RE) || []) hashtags.push(m)
    } else {
      bodyLines.push(line)
    }
  }
  let body = bodyLines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
  const tags = Array.from(new Set(hashtags))
  if (!title) {
    // Không có tiêu đề riêng (vd. task đăng từ web Pippit): dòng đầu caption làm tiêu đề.
    const [first = '', ...rest] = body.split('\n')
    return { title: first.trim(), body: rest.join('\n').trim(), hashtags: tags }
  }
  if (body === title) body = ''
  return { title, body, hashtags: tags }
}

const pad = (n: number) => String(n).padStart(2, '0')

export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function formatDate(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`
}

/** "3 phút nữa", "2 giờ trước", "55 ngày trước", "4 tháng trước". */
export function relativeTime(ms: number, now: number): string {
  if (!ms) return ''
  const diff = ms - now
  const abs = Math.abs(diff)
  const min = 60 * 1000
  const hour = 60 * min
  const day = 24 * hour
  let text: string
  if (abs < min) return 'vừa xong'
  if (abs < hour) text = `${Math.round(abs / min)} phút`
  else if (abs < day) text = `${Math.round(abs / hour)} giờ`
  else if (abs < 60 * day) text = `${Math.round(abs / day)} ngày`
  else text = `${Math.round(abs / (30 * day))} tháng`
  return diff > 0 ? `${text} nữa` : `${text} trước`
}

export function dayKey(ms: number): string {
  if (!ms) return 'unknown'
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const WEEKDAYS = ['Chủ nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']

export function dayLabel(ms: number, now: number): string {
  if (!ms) return 'Chưa có giờ đăng'
  const key = dayKey(ms)
  const oneDay = 24 * 60 * 60 * 1000
  if (key === dayKey(now)) return 'Hôm nay'
  if (key === dayKey(now - oneDay)) return 'Hôm qua'
  if (key === dayKey(now + oneDay)) return 'Ngày mai'
  return `${WEEKDAYS[new Date(ms).getDay()]}, ${formatDate(ms)}`
}

/** Bỏ dấu tiếng Việt + chữ thường để tìm kiếm không phân biệt dấu. */
export function fold(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'd')
    .toLowerCase()
}

export function channelKey(t: PippitTask): string {
  return `${platformOf(t)}:${t.page_id || t.page_name || ''}`
}

export function channelName(t: PippitTask): string {
  return t.page_name || (t.handle ? `@${t.handle}` : '') || `${PLATFORM_LABEL[platformOf(t)]} ${t.page_id || ''}`.trim()
}

export interface ChannelOption {
  key: string
  platform: PippitPlatform
  name: string
  count: number
}

export function listChannels(tasks: PippitTask[]): ChannelOption[] {
  const map = new Map<string, ChannelOption>()
  for (const t of tasks) {
    const key = channelKey(t)
    const cur = map.get(key)
    if (cur) cur.count++
    else map.set(key, { key, platform: platformOf(t), name: channelName(t), count: 1 })
  }
  return Array.from(map.values()).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

export interface TaskFilter {
  state: PippitTaskState | 'all'
  platform: PippitPlatform | 'all'
  channel: string | 'all'
  query: string
}

export function matchesQuery(t: PippitTask, query: string): boolean {
  const q = fold(query.trim())
  if (!q) return true
  const hay = fold(
    [t.title, t.description, t.page_name, t.handle, t.account_email, t.task_id, t.job_id]
      .filter(Boolean)
      .join(' ')
  )
  return q.split(/\s+/).every(w => hay.includes(w))
}

/** Lọc theo nền tảng/kênh/từ khóa (chưa lọc trạng thái) — dùng để đếm cho các chip trạng thái. */
export function filterScope(tasks: PippitTask[], f: Omit<TaskFilter, 'state'>): PippitTask[] {
  return tasks.filter(
    t =>
      (f.platform === 'all' || platformOf(t) === f.platform) &&
      (f.channel === 'all' || channelKey(t) === f.channel) &&
      matchesQuery(t, f.query)
  )
}

export function filterTasks(tasks: PippitTask[], f: TaskFilter, now: number): PippitTask[] {
  const scoped = filterScope(tasks, f)
  return f.state === 'all' ? scoped : scoped.filter(t => pippitTaskState(t, now) === f.state)
}

export function countByState(tasks: PippitTask[], now: number): Record<PippitTaskState | 'all', number> {
  const out: Record<PippitTaskState | 'all', number> = {
    all: tasks.length,
    scheduled: 0,
    overdue: 0,
    published: 0,
    failed: 0,
    missing: 0,
  }
  for (const t of tasks) out[pippitTaskState(t, now)]++
  return out
}

export interface DayGroup<T> {
  key: string
  label: string
  items: T[]
}

/**
 * Nhóm theo ngày giờ đăng. Bài sắp đăng xếp tăng dần (gần nhất trước) và nằm trên;
 * bài đã qua giờ xếp giảm dần (mới nhất trước).
 */
export function groupByDay<T extends PippitTask>(tasks: T[], now: number): DayGroup<T>[] {
  const upcoming = tasks
    .filter(t => (t.schedule_time_ms || 0) > now)
    .sort((a, b) => (a.schedule_time_ms || 0) - (b.schedule_time_ms || 0))
  const past = tasks
    .filter(t => (t.schedule_time_ms || 0) <= now)
    .sort((a, b) => (b.schedule_time_ms || 0) - (a.schedule_time_ms || 0))
  const groups: DayGroup<T>[] = []
  for (const t of [...upcoming, ...past]) {
    const ms = t.schedule_time_ms || 0
    const key = `${ms > now ? 'u' : 'p'}:${dayKey(ms)}`
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.items.push(t)
    else groups.push({ key, label: dayLabel(ms, now), items: [t] })
  }
  return groups
}

export function postLinkLabel(t: PippitTask): string {
  return platformOf(t) === 'tiktok' ? 'Xem trên TikTok' : 'Xem trên Facebook'
}
