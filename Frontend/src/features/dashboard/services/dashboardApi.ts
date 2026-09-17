import { API_URL } from '../../../shared/constants'
import { fetchCalendarEvents, getDailyPublishingSummary } from '../../monitor/services/monitorApi'
import type { PublisherDailySummary } from '../../monitor/types'
import type {
  DashboardStats,
  DayPipelineItem,
  DayVelocityItem,
  PlatformShare,
  RecentExportVideo,
  SystemServiceStatus,
} from '../types'

const WEEKDAY_NAMES = ['Chủ Nhật', 'Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy']

function formatLocalDateString(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export async function fetchDashboardData(forceSync = false): Promise<{
  stats: DashboardStats
  monitor: PublisherDailySummary | null
  recentVideos: RecentExportVideo[]
  services: SystemServiceStatus[]
  pipeline7Days: DayPipelineItem[]
  velocityExports7Days: DayVelocityItem[]
  velocityAll7Days: DayVelocityItem[]
  platformShares: PlatformShare[]
}> {
  // 1. Health Ping
  let serverStatus: 'online' | 'offline' = 'offline'
  let dbStatus: 'connected' | 'disconnected' = 'disconnected'
  let pingLatency = 0

  try {
    const pingStart = Date.now()
    const res = await fetch(`${API_URL}/api/ping`, { signal: AbortSignal.timeout(4000) })
    pingLatency = Date.now() - pingStart
    if (res.ok) {
      const data = await res.json()
      serverStatus = 'online'
      dbStatus = data.database === 'connected' ? 'connected' : 'disconnected'
    }
  } catch {
    serverStatus = 'offline'
  }

  // 2. Monitor Daily Summary & Calendar Events
  let monitor: PublisherDailySummary | null = null
  let calendarEventsList: any[] = []
  try {
    const [summaryRes, calRes] = await Promise.allSettled([
      getDailyPublishingSummary(forceSync),
      fetchCalendarEvents('all', forceSync),
    ])
    if (summaryRes.status === 'fulfilled') monitor = summaryRes.value
    if (calRes.status === 'fulfilled') calendarEventsList = calRes.value.events || []
  } catch (err) {
    console.warn('[Dashboard] Lỗi khi tải dữ liệu publisher monitor:', err)
  }

  // 3. Workflow Exports (Recent Videos)
  let recentVideos: RecentExportVideo[] = []
  let allExportItems: any[] = []
  let totalFinalExports = 0

  try {
    const res = await fetch(`${API_URL}/api/workflow/exports`, { signal: AbortSignal.timeout(5000) })
    if (res.ok) {
      const data = await res.json()
      allExportItems = Array.isArray(data?.items) ? data.items : []

      // Lọc các video hoàn chỉnh (source_type == 'export')
      const finalExports = allExportItems.filter((i: any) => i.source_type === 'export')
      totalFinalExports = finalExports.length

      // Ưu tiên hiển thị video hoàn chỉnh trước, nếu thiếu thì lấy thêm các clip gần nhất
      const displayPool = finalExports.length > 0 ? finalExports : allExportItems

      recentVideos = displayPool.slice(0, 6).map((item: any) => ({
        filename: item.filename || '',
        sizeBytes: item.size_bytes || 0,
        createdAt: item.created_at || '',
        downloadUrl: item.download_url
          ? `${API_URL}${item.download_url}`
          : `${API_URL}/api/workflow/exports/${encodeURIComponent(item.filename)}`,
        localPath: item.file_path || item.local_path || '',
        sourceType: item.source_type || 'export',
      }))
    }
  } catch (err) {
    console.warn('[Dashboard] Không thể tải danh sách workflow exports:', err)
  }

  // 4. Veo Assets Count
  let totalVeoVideos = 0
  let totalVeoImages = 0
  try {
    const [vidRes, imgRes] = await Promise.allSettled([
      fetch(`${API_URL}/api/veo/videos`, { signal: AbortSignal.timeout(4000) }),
      fetch(`${API_URL}/api/veo/images`, { signal: AbortSignal.timeout(4000) }),
    ])
    if (vidRes.status === 'fulfilled' && vidRes.value.ok) {
      const vids = await vidRes.value.json()
      totalVeoVideos = Array.isArray(vids) ? vids.length : 0
    }
    if (imgRes.status === 'fulfilled' && imgRes.value.ok) {
      const imgs = await imgRes.value.json()
      totalVeoImages = Array.isArray(imgs) ? imgs.length : 0
    }
  } catch (err) {
    console.warn('[Dashboard] Không thể tải số liệu Veo:', err)
  }

  // 5. Compute 7-Day Upcoming Broadcast Pipeline (Today -> +6 days)
  const today = new Date()
  const pipeline7Days: DayPipelineItem[] = []

  for (let i = 0; i < 7; i++) {
    const targetDate = new Date(today)
    targetDate.setDate(today.getDate() + i)
    const dateStr = formatLocalDateString(targetDate)

    const dayLabel =
      i === 0
        ? 'Hôm nay'
        : i === 1
        ? 'Ngày mai'
        : WEEKDAY_NAMES[targetDate.getDay()]

    // Lọc sự kiện trong ngày này
    const dayEvents = calendarEventsList.filter((e) => e.date === dateStr)
    const count = dayEvents.length
    const platforms: { [key: string]: number } = {}
    dayEvents.forEach((e) => {
      platforms[e.platform] = (platforms[e.platform] || 0) + 1
    })

    const status: 'empty' | 'low' | 'good' = count === 0 ? 'empty' : count <= 2 ? 'low' : 'good'

    pipeline7Days.push({
      date: dateStr,
      dayLabel,
      count,
      status,
      platforms,
      events: dayEvents,
    })
  }

  // 6. Helper function to compute velocity for past 7 days (-6 days -> Today)
  const computeVelocity = (itemList: any[]): DayVelocityItem[] => {
    const result: DayVelocityItem[] = []
    for (let i = 6; i >= 0; i--) {
      const targetDate = new Date(today)
      targetDate.setDate(today.getDate() - i)
      const dateStr = formatLocalDateString(targetDate)

      const dayLabel =
        i === 0
          ? 'Hôm nay'
          : i === 1
          ? 'Hôm qua'
          : `${WEEKDAY_NAMES[targetDate.getDay()]}, ${targetDate.getDate()}/${targetDate.getMonth() + 1}`

      const dayItems = itemList.filter((item) => {
        if (!item.created_at) return false
        try {
          const itemDate = new Date(item.created_at)
          return formatLocalDateString(itemDate) === dateStr
        } catch {
          return false
        }
      })

      result.push({
        date: dateStr,
        dayLabel,
        videoCount: dayItems.length,
        sizeBytes: dayItems.reduce((acc, v) => acc + (v.size_bytes || 0), 0),
      })
    }
    return result
  }

  // Chế độ 1: Chỉ tính Video Thành Phẩm Hoàn Chỉnh (Exports)
  const velocityExports7Days = computeVelocity(allExportItems.filter((i: any) => i.source_type === 'export'))
  // Chế độ 2: Tính Toàn Bộ Clip AI (bao gồm phân cảnh Veo)
  const velocityAll7Days = computeVelocity(allExportItems)

  // 7. Compute Platform Distribution
  const platformCounts: Record<string, number> = { youtube: 0, tiktok: 0, facebook: 0 }
  if (monitor?.channels) {
    monitor.channels.forEach((ch) => {
      const plat = ch.platform || 'youtube'
      platformCounts[plat] = (platformCounts[plat] || 0) + 1
    })
  }
  const totalChannelsCount = monitor?.total_channels || 1
  const platformShares: PlatformShare[] = [
    {
      platform: 'youtube',
      label: 'YouTube Shorts',
      count: platformCounts.youtube || 0,
      percent: Math.round(((platformCounts.youtube || 0) / totalChannelsCount) * 100),
      color: '#ef4444',
    },
    {
      platform: 'tiktok',
      label: 'TikTok',
      count: platformCounts.tiktok || 0,
      percent: Math.round(((platformCounts.tiktok || 0) / totalChannelsCount) * 100),
      color: '#0284c7',
    },
    {
      platform: 'facebook',
      label: 'Facebook / Pippit',
      count: platformCounts.facebook || 0,
      percent: Math.round(((platformCounts.facebook || 0) / totalChannelsCount) * 100),
      color: '#8b5cf6',
    },
  ]

  const stats: DashboardStats = {
    totalChannels: monitor?.total_channels || 0,
    unpostedChannels: monitor?.unposted_count || 0,
    warningChannels: monitor?.warning_count || 0,
    healthyChannels: monitor?.healthy_count || 0,
    totalExportedVideos: totalFinalExports || allExportItems.length,
    totalVeoVideos,
    totalVeoImages,
    serverStatus,
    dbStatus,
  }

  const services: SystemServiceStatus[] = [
    {
      name: 'Backend API Service',
      key: 'fastapi',
      status: serverStatus === 'online' ? 'healthy' : 'offline',
      latencyMs: pingLatency,
      detail: serverStatus === 'online' ? `Cổng 8000 • ${pingLatency}ms` : 'Không kết nối',
    },
    {
      name: 'Cơ Sở Dữ Liệu SQLite',
      key: 'database',
      status: dbStatus === 'connected' ? 'healthy' : 'offline',
      detail: dbStatus === 'connected' ? 'Connected' : 'Mất kết nối',
    },
  ]

  return {
    stats,
    monitor,
    recentVideos,
    services,
    pipeline7Days,
    velocityExports7Days,
    velocityAll7Days,
    platformShares,
  }
}

export async function openExportFolder(filename: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/workflow/exports/${encodeURIComponent(filename)}/open-folder`, {
      method: 'POST',
    })
    return res.ok
  } catch {
    return false
  }
}
