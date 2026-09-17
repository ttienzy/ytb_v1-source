import type { CalendarEvent } from '../monitor/types'

export interface DashboardStats {
  totalChannels: number
  unpostedChannels: number
  warningChannels: number
  healthyChannels: number
  totalExportedVideos: number
  totalVeoVideos: number
  totalVeoImages: number
  serverStatus: 'online' | 'offline' | 'checking'
  dbStatus: 'connected' | 'disconnected'
}

export interface RecentExportVideo {
  filename: string
  sizeBytes: number
  createdAt: string
  downloadUrl: string
  localPath: string
  sourceType?: 'export' | 'veo_scene'
}

export interface SystemServiceStatus {
  name: string
  key: string
  status: 'healthy' | 'warning' | 'offline' | 'checking'
  latencyMs?: number
  detail: string
}

export interface DayPipelineItem {
  date: string // YYYY-MM-DD
  dayLabel: string // 'Hôm nay', 'Thứ Sáu', 'Thứ Bảy'...
  count: number
  status: 'empty' | 'low' | 'good'
  platforms: { [key: string]: number }
  events: CalendarEvent[]
}

export interface DayVelocityItem {
  date: string
  dayLabel: string
  videoCount: number
  sizeBytes: number
}

export interface PlatformShare {
  platform: 'youtube' | 'tiktok' | 'facebook'
  label: string
  count: number
  percent: number
  color: string
}
