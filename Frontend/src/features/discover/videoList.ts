// Logic thuần (không React/DOM) cho danh sách video của trang Khám Phá Kênh — để test bằng node:test.
import type { ChannelVideo, ChannelVideosResponse } from './types'

export type VideoFilter = 'all' | 'new' | 'unprocessed' | 'completed' | 'golden' | 'views'

/** Video chưa làm và không đang chạy. */
export function isPending(v: ChannelVideo): boolean {
  return v.processed_status !== 'completed' && v.processed_status !== 'processing'
}

/** Video mới (chưa từng thấy ở lần quét trước) mà bạn chưa làm. */
export function isNewPending(v: ChannelVideo): boolean {
  return !!v.is_new && isPending(v)
}

export function filterVideos(videos: ChannelVideo[], filter: VideoFilter): ChannelVideo[] {
  switch (filter) {
    case 'new':
      return videos.filter(isNewPending)
    case 'unprocessed':
      return videos.filter(isPending)
    case 'completed':
      return videos.filter(v => v.processed_status === 'completed')
    case 'golden':
      return videos.filter(v => v.is_golden_duration || (!!v.duration_sec && v.duration_sec >= 300 && v.duration_sec <= 1080))
    case 'views':
      return [...videos].sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
    default:
      return [...videos]
  }
}

/** Nối thêm trang video cũ hơn, bỏ trùng id (giữ thứ tự: mới nhất trước). */
export function mergeVideos(existing: ChannelVideo[], incoming: ChannelVideo[]): ChannelVideo[] {
  const seen = new Set(existing.map(v => v.id))
  const out = [...existing]
  for (const v of incoming) {
    if (!seen.has(v.id)) {
      seen.add(v.id)
      out.push(v)
    }
  }
  return out
}

/** Chỉ giữ các URL đã chọn mà vẫn còn trong danh sách (dùng khi làm mới mà không muốn mất lựa chọn). */
export function keepExistingSelection(selected: string[], videos: ChannelVideo[]): string[] {
  const urls = new Set(videos.map(v => v.url))
  return selected.filter(u => urls.has(u))
}

function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** epoch giây -> "HH:MM dd/MM". */
export function formatScanTime(epochSec: number | null | undefined): string {
  if (!epochSec) return ''
  const d = new Date(epochSec * 1000)
  return `${pad(d.getHours())}:${pad(d.getMinutes())} ${pad(d.getDate())}/${pad(d.getMonth() + 1)}`
}

/** Thông báo sau một lần quét; null = không cần báo. `manual` = người dùng bấm làm mới. */
export function scanToast(res: Pick<ChannelVideosResponse, 'new_in_scan' | 'first_scan' | 'previous_scan_at'>, manual: boolean): string | null {
  const n = res.new_in_scan || 0
  if (res.first_scan) return manual ? 'Đã lập mốc theo dõi kênh. Từ lần quét sau, video đăng mới sẽ được gắn nhãn MỚI.' : null
  if (n > 0) return `Có ${n} video mới kể từ lần quét trước${res.previous_scan_at ? ` (${formatScanTime(res.previous_scan_at)})` : ''}.`
  if (manual) return `Kênh chưa đăng video mới${res.previous_scan_at ? ` kể từ lần quét trước (${formatScanTime(res.previous_scan_at)})` : ''}.`
  return null
}
