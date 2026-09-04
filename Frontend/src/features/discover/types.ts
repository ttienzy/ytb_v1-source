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
  videos: ChannelVideo[]
}

export interface QuickCategory {
  id: string
  label: string
  query: string
}

export interface ScoutedVideoItem {
  title: string
  url: string
  video_id?: string
  channel_name?: string
  channel_url?: string
  thumbnail_url?: string
  duration_approx?: string
  niche_topic?: string
  reason?: string
  custom_name?: string
}

export interface DriveUploadTask {
  task_id: string
  url: string
  title: string
  custom_name: string
  status: 'pending' | 'downloading' | 'uploading' | 'done' | 'error'
  progress_percent: number
  error?: string | null
  file_id?: string | null
  web_view_link?: string | null
  size_bytes?: number | null
  created_at: string
}

