export interface DiscoveredChannel {
  id?: string
  name: string
  handle: string
  channel_url: string
  avatar_url?: string
  subscribers?: string
  category?: string
  category_label?: string
  description?: string
  tags?: string[]
  is_saved?: boolean
}

export interface ChannelVideo {
  id: string
  title: string
  url: string
  duration_sec?: number
  duration_formatted: string
  is_golden_duration?: boolean
  view_count?: number
  view_count_formatted: string
  thumbnail_url: string
  upload_date?: string
  /** ISO. Chính xác nếu published_exact, ngược lại chỉ xấp xỉ (theo ngày/tháng). */
  published_at?: string
  published_exact?: boolean
  published_label?: string
  /** Lần đầu xuất hiện sau mốc quét đầu tiên của kênh (≤ 7 ngày). */
  is_new?: boolean
  processed_status?: 'completed' | 'processing' | 'error' | null
  processed_date?: string | null
  processed_job_id?: string | null
  is_disk_cleaned?: boolean
}

export interface ChannelVideosResponse {
  channel_name: string
  channel_id: string
  channel_url: string
  avatar_url?: string
  video_count: number
  offset?: number
  next_offset?: number
  has_more?: boolean
  /** Số video lần đầu thấy trong lần quét này (so với lần quét trước). */
  new_in_scan?: number
  /** Lần quét đầu tiên của kênh: chỉ lập mốc, chưa có video nào được coi là mới. */
  first_scan?: boolean
  previous_scan_at?: number | null
  scanned_at?: number
  videos: ChannelVideo[]
}

export interface QuickCategory {
  id: string
  label: string
  query: string
}
