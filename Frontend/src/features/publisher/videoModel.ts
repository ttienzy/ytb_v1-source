// Mô hình video thống nhất cho trang Lên lịch Pippit (thuần, test được).
import { cleanTitleFromName } from './captionUtils.ts'
import type { DriveVideo, PublishableVideo, ScheduleSlot } from './types.ts'

export const SOURCE_LABEL: Record<string, string> = {
  campaign: 'Chiến dịch AI',
  ai_library: 'Thư viện AI',
  recap: 'Recap & Audio',
  local: 'Từ máy',
  drive: 'Google Drive',
}

export function driveToPublishable(v: DriveVideo): PublishableVideo {
  return {
    uid: `drive:${v.id}`,
    source_type: 'drive',
    group: 'drive',
    source_id: `drive:${v.id}`,
    label: 'Google Drive',
    title: cleanTitleFromName(v.name) || v.name,
    file_name: v.name,
    file_path: '',
    preview_url: '',
    size_bytes: v.size_bytes,
    duration_seconds: v.duration_seconds ?? null,
    width: v.width,
    height: v.height,
    created_at: v.created_time || '',
    context_text: '',
    default_title: '',
    default_caption: '',
    default_hashtags: [],
    default_cta: '',
    published_channels: v.published_channels || [],
    drive_file_id: v.id,
    web_view_link: v.web_view_link,
  }
}

/** Phần cố định của một slot (chưa có giờ / kênh / caption). */
export function slotBase(v: PublishableVideo): Pick<
  ScheduleSlot,
  'uid' | 'source_type' | 'source_id' | 'drive_file_id' | 'file_path' | 'preview_url' | 'web_view_link' | 'source_label' | 'file_name' | 'size_bytes' | 'duration_seconds'
> {
  return {
    uid: v.uid,
    source_type: v.source_type,
    source_id: v.source_id,
    drive_file_id: v.drive_file_id || '',
    file_path: v.file_path,
    preview_url: v.preview_url,
    web_view_link: v.web_view_link || '',
    source_label: v.label || SOURCE_LABEL[v.source_type] || '',
    file_name: v.file_name,
    size_bytes: v.size_bytes,
    duration_seconds: v.duration_seconds,
  }
}

export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return '--:--'
  const rounded = Math.round(seconds)
  return `${String(Math.floor(rounded / 60)).padStart(2, '0')}:${String(rounded % 60).padStart(2, '0')}`
}

/** Hiển thị ngày giờ gọn cho bài đăng, vd. 25/11 19:45. */
export function fmtSlotTime(ms: number): string {
  return new Date(ms).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

export function toLocalDatetimeInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}
