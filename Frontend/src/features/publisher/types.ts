export type DriveFolder = {
  id: string
  name: string
  url?: string
  modified_time?: string
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
  published_channels?: {
    platform: string
    channel_name: string
    channel_id?: string
    published_at?: string
    status?: string
  }[]
}

export type DriveVideoList = {
  folder_id: string
  folder_name: string
  folders: DriveFolder[]
  videos: DriveVideo[]
  total: number
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
}

export type PippitAccount = {
  id: string
  email: string
  user_id?: string
  status: string
  facebook_pages: PippitFacebookPage[]
  tiktok_channels?: PippitTikTokChannel[]
}

export type ScheduleSlot = {
  file_id: string
  file_name: string
  size_bytes: number
  duration_seconds?: number
  title: string
  caption: string
  schedule_time_ms: number
  page_id: string
  page_name: string
}

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
