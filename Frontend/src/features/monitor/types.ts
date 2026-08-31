export type ChannelStatusType = 'unposted' | 'warning' | 'healthy'

export type ChannelDailyStatus = {
  channel_id: string
  channel_name: string
  platform: 'youtube' | 'tiktok' | 'facebook'
  account_email?: string | null
  avatar_url?: string | null
  status: ChannelStatusType
  today_count: number
  tomorrow_count: number
  upcoming_total: number
  latest_published_at?: string | null
  next_publish_at?: string | null
  buffer_days: number
}

export type PublisherDailySummary = {
  date: string
  total_channels: number
  unposted_count: number
  warning_count: number
  healthy_count: number
  channels: ChannelDailyStatus[]
}

export type CalendarEvent = {
  id: string
  title: string
  platform: 'youtube' | 'tiktok' | 'facebook' | 'studio'
  channel_name: string
  channel_id?: string | null
  account_email?: string | null
  avatar_url?: string | null
  publish_at?: string | null
  date: string // YYYY-MM-DD
  time: string // HH:MM
  status: 'scheduled' | 'published' | 'failed' | 'draft'
  post_url?: string | null
  thumbnail_url?: string | null
  failed_reason?: string | null
  file_name?: string | null
  raw_time_ms?: number | null
}

export type CalendarEventsResponse = {
  month: string
  total_events: number
  scheduled_count: number
  published_count: number
  failed_count: number
  channels_list: {
    key: string
    platform: string
    name: string
    id?: string
  }[]
  events: CalendarEvent[]
}
