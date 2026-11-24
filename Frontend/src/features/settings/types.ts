/** Tài khoản Gemini trong kho (API không bao giờ trả cookie). */
export type GeminiAccountView = {
  id: string
  email?: string | null
  hasSession?: boolean
  partition?: string
  hasProfile?: boolean
  status: 'active' | 'exhausted' | 'error' | string
  message?: string | null
  addedAt?: number
  lastUsed?: number
  exhaustedAt?: number
}

export type GeminiState = {
  accounts: GeminiAccountView[]
  active_accounts_count: number
  total_accounts_count: number
  /** Có ít nhất một tài khoản sẵn sàng. */
  has_cookie: boolean
  /** Khung request Gemini: "bundled" = bản đóng gói theo app, "captured" = bản bắt trên máy này. */
  template_source?: 'bundled' | 'captured'
  template_saved_at?: string | null
}

export type MailDomain = {
  id: string
  domain: string
  is_active: boolean
}

export type MailAccount = {
  id: string
  address: string
  password: string
  token?: string
  created_at: string
  status: string
}

export type MailMessage = {
  id: string
  from_addr: string
  from_name: string
  subject: string
  intro: string
  seen: boolean
  created_at: string
  otp_code?: string | null
}

export type MailMessageDetail = {
  id: string
  from_addr: string
  from_name: string
  subject: string
  intro: string
  text: string
  html: string | string[]
  created_at: string
  otp_code?: string | null
}

export type FacebookPageSlot = {
  page_id: string
  page_name: string
  avatar_url?: string
  status: string
  un_expired?: boolean
}

export type TikTokChannelSlot = {
  channel_id: string
  nickname: string
  handle?: string
  avatar_url?: string
  status: string
  un_expired?: boolean
}

export type PippitAccount = {
  id: string
  mailtm_id?: string
  email: string
  password: string
  user_id?: string
  workspace_id?: string
  proxy?: string
  status: string
  created_at: string
  facebook_pages: FacebookPageSlot[]
  tiktok_channels?: TikTokChannelSlot[]
}

export type PippitTask = {
  task_id?: string
  status?: number
  published: boolean
  platform?: 'facebook' | 'tiktok'
  post_id: string
  post_url: string
  page_id: string
  page_name: string
  schedule_time_ms: number
  title: string
  description: string
  failed_reason: string
}

export type MuseSettings = {
  ok: boolean
  download_dir: string
  /** giây, backend ép tối thiểu 600 */
  timeout_seconds: number
  default_prompt_prefix: string
}

export type MuseStatus = {
  is_connected: boolean
  last_checked_at: string
  message: string
  account_id?: string | null
  account_label?: string | null
}

export type MuseAccount = {
  id: string
  label: string
  viewerId: string
  hasSession: boolean
  partition: string
  cdpPort: number
  status: 'active' | 'exhausted' | 'error' | string
  message: string
  addedAt: number
  lastUsed: number
  lastCheckedAt: number
  exhaustedAt: number
  running: boolean
  busy: boolean
}

export type MuseAccountsState = {
  accounts: MuseAccount[]
  active_accounts_count: number
  total_accounts_count: number
}

export type MuseGenerateResult = {
  ok: boolean
  prompt: string
  video_url?: string | null
  local_path?: string | null
  file_size?: number | null
  error?: string | null
  duration_seconds?: number | null
  created_at: string
}

export type ChatgptAccount = {
  id: string
  email?: string
  hasSession: boolean
  partition?: string
  hasProfile: boolean
  status: 'active' | 'exhausted' | 'error'
  message?: string
  addedAt?: number
  lastUsed?: number
  exhaustedAt?: number
}

export type ImageGenState = {
  provider: 'chatgpt'
  saved_at?: string | null
  accounts: ChatgptAccount[]
  active_accounts_count: number
  total_accounts_count: number
}


