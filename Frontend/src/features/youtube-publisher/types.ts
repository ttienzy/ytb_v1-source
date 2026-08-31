export interface YouTubeStatus {
  connected: boolean
  auth_type: string
  email: string
  name: string
  avatar_url: string
  channel_id: string
  channel_title: string
  channel_custom_url: string
  channel_avatar_url: string
  subscriber_count: number
  video_count: number
  default_privacy: string
  default_tags: string
  auto_upload: boolean
  has_credentials: boolean
  client_id: string
  message: string
}

export interface YouTubeCategory {
  id: string
  title: string
}

export interface DriveFolder {
  id: string
  name: string
  url?: string
}

export interface DriveVideo {
  id: string
  name: string
  size_bytes: number
  mime_type: string
  web_view_link: string
  thumbnail_link: string
  created_time: string
  duration_seconds: number
  published_channels?: {
    platform: string
    channel_name: string
    channel_id?: string
    published_at?: string
    status?: string
  }[]
  width?: number
  height?: number
}

export interface YouTubeScheduleSlot {
  id: string
  source_type: 'gdrive' | 'local'
  file_path?: string
  drive_file_id?: string
  file_name: string
  title: string
  description: string
  tags: string
  category_id: string
  privacy_status: 'public' | 'unlisted' | 'private' | 'scheduled'
  publish_at?: string
  thumbnail_url?: string
  size_bytes?: number
  duration_seconds?: number
  file?: File
}

export interface YouTubeTask {
  task_id: string
  video_id?: string
  youtube_url?: string
  file_name: string
  title: string
  description: string
  tags: string
  category_id: string
  privacy_status: string
  publish_at?: string
  status: 'published' | 'scheduled' | 'failed' | 'uploading'
  error_message?: string
  thumbnail_url?: string
  created_at: string
}

export interface GoldenSlot {
  id: string
  time: string // "07:15"
  label: string
}
