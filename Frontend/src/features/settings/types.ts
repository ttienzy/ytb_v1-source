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
