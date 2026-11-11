export type GeminiState = {
  has_cookie: boolean
  cookie_count: number
  saved_at?: string
  client_context_token: string
  app_url: string
}

export type YtState = {
  logged_in: boolean
  cookie_count: number
  saved_at?: string | null
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
  is_connected: boolean
  last_checked_at?: string | null
  app_url: string
  cdp_port: number
  auto_download: boolean
  download_dir: string
  timeout_seconds: number
  default_prompt_prefix: string
  profile_dir: string
}

export type MuseStatus = {
  is_connected: boolean
  is_running: boolean
  cdp_port: number
  tab_title?: string | null
  tab_url?: string | null
  last_checked_at: string
  message: string
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


