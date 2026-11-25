export type DriveFolder = {
  id: string
  name: string
  url?: string
  modified_time?: string
}

export type PublishedChannel = {
  platform: string
  channel_name: string
  channel_id?: string
  published_at?: string
  status?: string
  task_id?: string | null
  post_url?: string
}

export type DriveVideo = {
  id: string
  name: string
  size_bytes: number
  mime_type: string
  web_view_link: string
  thumbnail_link?: string
  created_time?: string
  duration_seconds?: number
  width?: number
  height?: number
  published_channels?: PublishedChannel[]
}

export type DriveVideoList = {
  folder_id: string
  folder_name: string
  folders: DriveFolder[]
  videos: DriveVideo[]
  total: number
}

/** Nguồn video có thể đăng. `drive` lấy từ Google Drive; 4 nguồn còn lại là file có sẵn trên máy (không qua Drive). */
export type SourceType = 'campaign' | 'ai_library' | 'recap' | 'local' | 'drive'

/** Một video có thể đăng, thống nhất cho mọi nguồn. */
export type PublishableVideo = {
  uid: string
  source_type: SourceType
  group: string
  source_id: string
  label: string
  title: string
  file_name: string
  /** Đường dẫn file trên máy (rỗng với video Drive). */
  file_path: string
  /** Đường dẫn tương đối `/api/pippit/sources/preview?...` (rỗng với video Drive). */
  preview_url: string
  size_bytes: number
  duration_seconds?: number | null
  width?: number
  height?: number
  created_at: string
  context_text: string
  default_title: string
  default_caption: string
  default_hashtags: string[]
  default_cta: string
  published_channels: PublishedChannel[]
  drive_file_id?: string
  web_view_link?: string
}

export type SourceListResponse = {
  source: SourceType
  items: PublishableVideo[]
  total: number
  counts: Record<string, number>
  groups: Record<string, number>
}

export type PippitFacebookPage = {
  page_id: string
  page_name: string
  avatar_url: string
  status: string
  un_expired: boolean
}

export type PippitTikTokChannel = {
  channel_id: string
  nickname: string
  handle?: string
  avatar_url: string
  status: string
  un_expired: boolean
}

export type ActiveFacebookPage = {
  page_id: string
  page_name: string
  avatar_url: string
  status: string
  account_id: string
  account_email: string
  un_expired: boolean
  platform?: 'facebook' | 'tiktok'
  handle?: string
}

export type PippitAccount = {
  id: string
  email: string
  user_id?: string
  status: string
  facebook_pages: PippitFacebookPage[]
  tiktok_channels?: PippitTikTokChannel[]
}

export type TikTokOptions = {
  privacy_level: 1 | 2 | 3
  allow_comment: boolean
  allow_duet: boolean
  allow_stitch: boolean
}

export type ScheduleSlot = {
  uid: string
  source_type: SourceType
  source_id: string
  drive_file_id: string
  file_path: string
  preview_url: string
  web_view_link: string
  source_label: string
  file_name: string
  size_bytes: number
  duration_seconds?: number | null
  title: string
  caption: string
  schedule_time_ms: number
  page_id: string
  page_name: string
}

export type CaptionOverride = { title?: string; caption?: string }

export type GeneratedCaption = {
  uid: string
  title: string
  caption: string
  hashtags: string[]
  full_text: string
}

export type CaptionGenerateResponse = { items: GeneratedCaption[]; missing: string[] }

export type PippitScheduleTask = {
  task_id?: string | null
  status?: number | null
  published: boolean
  post_id: string
  post_url: string
  page_id: string
  page_name: string
  schedule_time_ms: number
  title: string
  description: string
  failed_reason: string
}

export type BulkScheduleResultItem = {
  file_name: string
  page_id: string
  page_name: string
  task_id: string
  asset_id: string
  schedule_time_ms: number
  ok: boolean
  error?: string
}

export type BulkScheduleResponse = {
  ok: boolean
  total: number
  success_count: number
  failed_count: number
  results: BulkScheduleResultItem[]
  message: string
}
