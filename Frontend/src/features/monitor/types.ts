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
