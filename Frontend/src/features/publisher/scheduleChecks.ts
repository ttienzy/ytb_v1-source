// Kiểm tra trước khi đặt lịch hàng loạt + tóm tắt kết quả. Module thuần (node:test nạp được).

export interface PublishedChannelRef {
  platform: string
  channel_name: string
  channel_id?: string
  status?: string
}

export interface TargetChannelRef {
  page_id: string
  page_name: string
  platform?: string
  handle?: string
}

export type ChannelPlatform = 'facebook' | 'tiktok'

export function targetPlatform(t: TargetChannelRef): ChannelPlatform {
  return t.platform === 'tiktok' ? 'tiktok' : 'facebook'
}

function norm(s: string | undefined | null): string {
  return (s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .replace(/\s*\(@[^)]*\)\s*$/, '')
    .replace(/^\[(tiktok|facebook)\]\s*/i, '')
    .trim()
    .toLowerCase()
}

/** Video đã được đăng / lên lịch lên đúng kênh đích chưa (khớp id, hoặc cùng nền tảng + cùng tên). */
export function isPostedToTarget(channels: PublishedChannelRef[] | undefined, target: TargetChannelRef): boolean {
  if (!channels?.length) return false
  const plat = targetPlatform(target)
  const name = norm(target.page_name)
  return channels.some(c => {
    if (c.channel_id && String(c.channel_id) === String(target.page_id)) return true
    return (c.platform || 'facebook') === plat && !!name && norm(c.channel_name) === name
  })
}

export function channelLabel(t: TargetChannelRef): string {
  const plat = targetPlatform(t) === 'tiktok' ? 'TikTok' : 'Facebook'
  return `${plat} · ${t.page_name}${t.handle ? ` (@${t.handle})` : ''}`
}

export interface SlotLike {
  uid: string
  schedule_time_ms: number
  page_id: string
}

export function scheduleRange(slots: SlotLike[]): { first: number; last: number } | null {
  if (!slots.length) return null
  let first = Infinity
  let last = -Infinity
  for (const s of slots) {
    first = Math.min(first, s.schedule_time_ms)
    last = Math.max(last, s.schedule_time_ms)
  }
  return { first, last }
}

/** Số video lên lịch theo từng kênh đích, theo thứ tự xuất hiện. */
export function countByTarget(slots: SlotLike[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const s of slots) out.set(s.page_id, (out.get(s.page_id) || 0) + 1)
  return out
}

/**
 * Đẩy giờ hẹn đã trôi về quá khứ (người dùng để trang mở lâu) lên tối thiểu `minLeadMs` nữa,
 * giãn mỗi video bị đẩy thêm `stepMs` để không trùng giờ.
 */
export function ensureFutureTimes<T extends SlotLike>(slots: T[], now: number, minLeadMs = 3 * 60_000, stepMs = 5 * 60_000): T[] {
  const minAllowed = now + minLeadMs
  let shifted = 0
  return slots.map(s => {
    if (s.schedule_time_ms >= minAllowed) return s
    const next = { ...s, schedule_time_ms: minAllowed + shifted * stepMs }
    shifted++
    return next
  })
}

export interface BulkRunItem {
  uid: string
  file_name: string
  title: string
  page_name: string
  schedule_time_ms: number
  ok: boolean
  error?: string
  task_id?: string
}

export function summarizeRun(items: BulkRunItem[]): { ok: number; failed: number; text: string } {
  const ok = items.filter(i => i.ok).length
  const failed = items.length - ok
  const text =
    failed === 0
      ? `Đã lên lịch ${ok}/${items.length} video qua Pippit.`
      : `Đã lên lịch ${ok}/${items.length} video, ${failed} video lỗi.`
  return { ok, failed, text }
}
