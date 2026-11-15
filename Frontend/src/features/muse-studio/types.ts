export interface MuseStatus {
  is_connected: boolean
  last_checked_at: string
  message: string
  account_id?: string | null
  account_label?: string | null
}

/** Rút gọn từ /api/settings/muse/accounts — đủ để hiện ô chọn tài khoản. */
export interface MuseAccountOption {
  id: string
  label: string
  status: string
  busy: boolean
}

export interface MuseUploadResponse {
  ok: boolean
  file_name: string
  file_path: string
  file_type: 'image' | 'video'
  file_size: number
  preview_url: string
}

export interface MuseReferenceMedia {
  id: string
  name: string
  path: string
  type: 'image' | 'video'
  size: number
  previewUrl: string
}

export interface MuseGenerateRequest {
  prompt: string
  reference_image?: string
  reference_images?: string[]
  reference_video?: string
  reference_videos?: string[]
  reference_media?: string[]
  use_side_chat?: boolean
  continuation?: boolean
  timeout_seconds?: number
  /** bỏ trống = tự xoay vòng các tài khoản sẵn sàng */
  account_id?: string
}

export interface MuseGenerateResult {
  ok: boolean
  prompt: string
  account_id?: string | null
  account_label?: string | null
  video_url?: string | null
  local_path?: string | null
  file_size?: number | null
  error?: string | null
  duration_seconds?: number | null
  created_at: string
}

export interface MuseHistoryItem {
  id: string
  filename: string
  local_path: string
  file_size: number
  created_at: string
  preview_url: string
}

export interface MuseHistoryResponse {
  ok: boolean
  items: MuseHistoryItem[]
}
