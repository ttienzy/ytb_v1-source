import React, { useEffect, useMemo, useState, useTransition } from 'react'
import {
  AlertCircle,
  ArrowRight,
  ArrowUpRight,
  BarChart3,
  Calendar,
  CheckCircle2,
  Clapperboard,
  Film,
  FolderOpen,
  Loader2,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Tv,
  Workflow,
  Zap,
} from 'lucide-react'
import { fmtBytes } from '../../shared/utils/formatters'
import { VideoPlayerModal } from '../workflow/components/VideoPlayerModal'
import { fetchDashboardData, openExportFolder } from './services/dashboardApi'
import type {
  DashboardStats,
  DayPipelineItem,
  DayVelocityItem,
  PlatformShare,
  RecentExportVideo,
} from './types'
import type { PublisherDailySummary } from '../monitor/types'
import './DashboardPage.css'

interface DashboardPageProps {
  setActivePage: (page: string) => void
  onOpenChannelHealth?: () => void
}

export function DashboardPage({ setActivePage, onOpenChannelHealth }: DashboardPageProps) {
  const [stats, setStats] = useState<DashboardStats | null>(null)
  const [monitor, setMonitor] = useState<PublisherDailySummary | null>(null)
  const [recentVideos, setRecentVideos] = useState<RecentExportVideo[]>([])
  const [pipeline7Days, setPipeline7Days] = useState<DayPipelineItem[]>([])
  const [velocityExports7Days, setVelocityExports7Days] = useState<DayVelocityItem[]>([])
  const [velocityAll7Days, setVelocityAll7Days] = useState<DayVelocityItem[]>([])
  const [platformShares, setPlatformShares] = useState<PlatformShare[]>([])
  const [velocityMode, setVelocityMode] = useState<'exports' | 'all'>('exports')
  const [hoveredVelocityIdx, setHoveredVelocityIdx] = useState<number | null>(null)
  const [avatarErrors, setAvatarErrors] = useState<Record<string, boolean>>({})
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [activePreviewVideo, setActivePreviewVideo] = useState<{ url: string; title: string } | null>(null)
  const [, startTransition] = useTransition()

  const loadData = async (force = false) => {
    try {
      if (force) setRefreshing(true)
      const res = await fetchDashboardData(force)
      startTransition(() => {
        setStats(res.stats)
        setMonitor(res.monitor)
        setRecentVideos(res.recentVideos)
        setPipeline7Days(res.pipeline7Days)
        setVelocityExports7Days(res.velocityExports7Days)
        setVelocityAll7Days(res.velocityAll7Days)
        setPlatformShares(res.platformShares)
      })
    } catch (err) {
      console.error('[Dashboard] Lỗi khi nạp dữ liệu Studio Dashboard:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadData(false)
  }, [])

  // Average buffer days
  const avgBufferDays = useMemo(() => {
    if (!monitor?.channels?.length) return '0.0'
    const total = monitor.channels.reduce((acc, ch) => acc + (ch.buffer_days || 0), 0)
    return (total / monitor.channels.length).toFixed(1)
  }, [monitor])

  // Formatted date string
  const dateStr = useMemo(() => {
    return new Date().toLocaleDateString('vi-VN', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    })
  }, [])

  // Total scheduled in next 7 days
  const next7DaysScheduledTotal = useMemo(() => {
    return pipeline7Days.reduce((acc, d) => acc + d.count, 0)
  }, [pipeline7Days])

  // Active velocity dataset based on mode
  const activeVelocityList = useMemo(() => {
    return velocityMode === 'exports' ? velocityExports7Days : velocityAll7Days
  }, [velocityMode, velocityExports7Days, velocityAll7Days])

  // Total velocity past 7 days
  const past7DaysTotalCount = useMemo(() => {
    return activeVelocityList.reduce((acc, d) => acc + d.videoCount, 0)
  }, [activeVelocityList])


  // Max velocity count for scaling chart
  const maxVelocityCount = useMemo(() => {
    const counts = activeVelocityList.map((d) => d.videoCount)
    return Math.max(...counts, 6)
  }, [activeVelocityList])

  // Helper for channel avatar initials fallback
  const getInitials = (name: string) => {
    if (!name) return 'CH'
    const words = name.trim().split(/\s+/)
    if (words.length >= 2) return (words[0][0] + words[1][0]).toUpperCase()
    return name.slice(0, 2).toUpperCase()
  }

  // Generate SVG Spline Path for Area Chart
  const svgChartGeometry = useMemo(() => {
    if (!activeVelocityList || activeVelocityList.length < 2) {
      return { linePath: '', areaPath: '', points: [], yGridValues: [0, 5, 10] }
    }

    const width = 500
    const height = 150
    const padX = 42
    const padYTop = 22
    const padYBottom = 26
    const chartW = width - padX - 16
    const chartH = height - padYTop - padYBottom

    const ceiling = Math.max(Math.ceil(maxVelocityCount / 3) * 3, 3)
    const yGridValues = [ceiling, Math.round((ceiling * 2) / 3), Math.round(ceiling / 3), 0]

    const stepX = chartW / (activeVelocityList.length - 1)
    const points = activeVelocityList.map((item, idx) => {
      const x = padX + idx * stepX
      const ratio = Math.min(item.videoCount / ceiling, 1)
      const y = height - padYBottom - ratio * chartH
      return { x, y, item, idx }
    })

    // Compute smooth cubic bezier path
    let linePath = `M ${points[0].x} ${points[0].y}`
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i]
      const p1 = points[i + 1]
      const cpX = (p0.x + p1.x) / 2
      linePath += ` C ${cpX} ${p0.y}, ${cpX} ${p1.y}, ${p1.x} ${p1.y}`
    }

    const lastP = points[points.length - 1]
    const firstP = points[0]
    const baselineY = height - padYBottom
    const areaPath = `${linePath} L ${lastP.x} ${baselineY} L ${firstP.x} ${baselineY} Z`

    return { linePath, areaPath, points, yGridValues, baselineY }
  }, [activeVelocityList, maxVelocityCount])

  return (
    <div className="studio-dashboard">
      {/* --------------------------------------------------------------------
          1. Studio Hero Creation Hub
          -------------------------------------------------------------------- */}
      <section className="studio-hero-banner">
        <div className="studio-hero-top">
          <div className="studio-hero-brand">
            <div className="studio-badge-pill">
              <Sparkles size={11} />
              <span>Studio Automation Suite</span>
            </div>
            <h1 className="studio-hero-title">Trung Tâm Điều Hành Video AI</h1>
            <p className="studio-hero-desc">
              {dateStr} • Giám sát lịch phát sóng đa kênh và tự động hóa sản xuất video thương mại từ ảnh sản phẩm.
            </p>
          </div>

          <button
            type="button"
            className="studio-hero-sync-btn"
            onClick={() => loadData(true)}
            disabled={refreshing}
            title="Đồng bộ dữ liệu thời gian thực từ máy chủ"
          >
            <RefreshCw size={13} className={refreshing ? 'spinning' : ''} />
            <span>{refreshing ? 'Đang đồng bộ...' : 'Làm mới'}</span>
          </button>
        </div>

        {/* 3 Quick Creation Cards inside Hero */}
        <div className="studio-creation-grid">
          <div
            className="studio-create-card"
            onClick={() => setActivePage('AI Workflow')}
            title="Mở Node Graph Workflow tạo video từ ảnh sản phẩm"
          >
            <div className="studio-create-left">
              <div className="studio-create-icon">
                <Workflow size={20} />
              </div>
              <div className="studio-create-info">
                <h4>AI Product-to-Video</h4>
                <p>Ảnh sản phẩm → Gemini → GPT kịch bản → Veo</p>
              </div>
            </div>
            <ArrowRight size={16} className="studio-create-arrow" />
          </div>

          <div
            className="studio-create-card"
            onClick={() => setActivePage('Veo Studio')}
            title="Mở Veo Studio để sinh video & ảnh AI"
          >
            <div className="studio-create-left">
              <div className="studio-create-icon">
                <Clapperboard size={20} />
              </div>
              <div className="studio-create-info">
                <h4>Veo Generative Studio</h4>
                <p>Sinh clip từ prompt & tạo ảnh Nano Banana Pro</p>
              </div>
            </div>
            <ArrowRight size={16} className="studio-create-arrow" />
          </div>

          <div
            className="studio-create-card"
            onClick={() => setActivePage('Lên lịch Youtube')}
            title="Mở quản lý lịch đăng YouTube Shorts & Video"
          >
            <div className="studio-create-left">
              <div className="studio-create-icon">
                <Calendar size={20} />
              </div>
              <div className="studio-create-info">
                <h4>Lên Lịch Đa Kênh</h4>
                <p>Hẹn giờ phát sóng YouTube Shorts & TikTok</p>
              </div>
            </div>
            <ArrowRight size={16} className="studio-create-arrow" />
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------
          2. Production KPI Strip
          -------------------------------------------------------------------- */}
      <section className="studio-kpi-row">
        {/* KPI 1: Cần đăng hôm nay */}
        <div
          className={`studio-kpi-card ${stats?.unpostedChannels ? 'alert' : 'success'}`}
          onClick={onOpenChannelHealth}
          style={{ cursor: 'pointer' }}
          title="Bấm để xem danh sách chi tiết các kênh"
        >
          <div className="studio-kpi-header">
            <span>CẦN XUẤT BẢN HÔM NAY</span>
            {stats?.unpostedChannels ? (
              <span className="channel-status-pill unposted">Thiếu bài</span>
            ) : (
              <span className="channel-status-pill healthy">Đã đủ bài</span>
            )}
          </div>
          <div className="studio-kpi-value">
            {stats ? `${stats.unpostedChannels} kênh` : '—'}
          </div>
          <div className={`studio-kpi-meta ${stats?.unpostedChannels ? 'alert' : 'success'}`}>
            {stats?.unpostedChannels ? (
              <>
                <AlertCircle size={13} /> Cần bổ sung video phát sóng gấp hôm nay
              </>
            ) : (
              <>
                <CheckCircle2 size={13} /> Tất cả các kênh đã đủ video hôm nay
              </>
            )}
          </div>
        </div>

        {/* KPI 2: Kênh ổn định */}
        <div className="studio-kpi-card">
          <div className="studio-kpi-header">
            <span>TIẾN ĐỘ PHÁT SÓNG</span>
          </div>
          <div className="studio-kpi-value">
            {stats ? `${stats.healthyChannels} / ${stats.totalChannels} kênh` : '—'}
          </div>
          <div className="studio-kpi-meta">
            <span>Kênh đã hoàn thành mục tiêu phát sóng</span>
          </div>
        </div>

        {/* KPI 3: Video đã xuất xưởng */}
        <div
          className="studio-kpi-card"
          onClick={() => setActivePage('AI Workflow')}
          style={{ cursor: 'pointer' }}
          title="Xem thư viện xuất xưởng trong AI Workflow"
        >
          <div className="studio-kpi-header">
            <span>VIDEO HOÀN CHỈNH</span>
          </div>
          <div className="studio-kpi-value">
            {stats ? `${stats.totalExportedVideos} video` : '—'}
          </div>
          <div className="studio-kpi-meta">
            <span>Thành phẩm sẵn sàng xuất bản</span>
          </div>
        </div>

        {/* KPI 4: Mức đệm an toàn */}
        <div className="studio-kpi-card">
          <div className="studio-kpi-header">
            <span>LỊCH DỰ TRỮ PHÁT SÓNG</span>
          </div>
          <div className="studio-kpi-value">
            ~{avgBufferDays} ngày
          </div>
          <div className="studio-kpi-meta">
            <span>Mức đệm lịch đăng trung bình</span>
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------
          3. Business SaaS Charts Grid (Publishing Horizon & Production Velocity)
          -------------------------------------------------------------------- */}
      <section className="studio-charts-grid">
        {/* Chart 1: 7-Day Broadcast Horizon (Buffer & Sprout Social SaaS Matrix) */}
        <div className="studio-chart-panel">
          <div className="studio-chart-header">
            <div>
              <h3 className="studio-chart-title">
                <Calendar size={15} color="#3b82f6" />
                <span>Lịch Phát Sóng 7 Ngày Tới</span>
              </h3>
              <p className="studio-chart-sub">
                {next7DaysScheduledTotal} video đã lên lịch • Phân bổ theo múi giờ GMT+7
              </p>
            </div>
            <div className="chart-header-actions">
              <button
                type="button"
                className="chart-action-link"
                onClick={() => setActivePage('Lên lịch Youtube')}
                title="Mở trang quản lý lịch phát sóng chi tiết"
              >
                <span>Xem chi tiết</span>
                <ArrowUpRight size={13} />
              </button>
            </div>
          </div>

          {/* Weekly Editorial Horizon Strip - Clean & Minimalist */}
          <div className="weekly-horizon-strip">
            {pipeline7Days.map((item, idx) => {
              const isToday = idx === 0
              const [mPart, dPart] = item.date.slice(5).split('-')
              const dateShort = `${parseInt(dPart, 10)}/${parseInt(mPart, 10)}`
              const sortedEvents = (item.events || [])
                .slice()
                .sort((a, b) => (a.time || '').localeCompare(b.time || ''))
              const displayEvents = sortedEvents.slice(0, 3)
              const remainingCount = Math.max(0, item.count - displayEvents.length)

              return (
                <div
                  key={item.date}
                  className={`horizon-day-col ${isToday ? 'today' : ''}`}
                >
                  <div className="horizon-day-header">
                    <span className="horizon-day-name">{item.dayLabel}</span>
                    <span className="horizon-day-date">{dateShort}</span>
                    <span
                      className={`horizon-day-badge ${item.count > 0 ? 'active' : 'empty'}`}
                    >
                      {item.count > 0 ? `${item.count} bài` : 'Trống'}
                    </span>
                  </div>

                  <div className="horizon-day-body">
                    {item.count > 0 ? (
                      <>
                        <div className="horizon-slots-group">
                          {displayEvents.map((ev) => {
                            const platformKey = ev.platform || 'youtube'
                            const platformClass =
                              platformKey === 'youtube' ? 'yt' : platformKey === 'tiktok' ? 'tt' : 'fb'
                            const platformBadge =
                              platformKey === 'youtube' ? 'YT' : platformKey === 'tiktok' ? 'TT' : 'FB'

                            return (
                              <div
                                key={ev.id}
                                className={`horizon-slot-pill ${platformClass}`}
                                title={`[${platformKey.toUpperCase()}] Kênh: ${ev.channel_name || 'Chưa rõ'}\nGiờ đăng: ${ev.time || '--:--'}\nTiêu đề: ${ev.title || 'Video đã lên lịch'}`}
                              >
                                <span className={`horizon-pill-tag ${platformClass}`}>
                                  {platformBadge}
                                </span>
                                <span className="horizon-pill-time">
                                  {ev.time || 'Hẹn giờ'}
                                </span>
                              </div>
                            )
                          })}
                        </div>

                        {remainingCount > 0 && (
                          <div
                            className="horizon-more-chip"
                            title={sortedEvents
                              .slice(3)
                              .map(
                                (e) =>
                                  `• [${(e.platform || '').toUpperCase()}] ${e.time || '--:--'} - ${e.channel_name || e.title}`
                              )
                              .join('\n')}
                          >
                            +{remainingCount} bài khác
                          </div>
                        )}
                      </>
                    ) : (
                      <div
                        className="horizon-empty-slot"
                        onClick={() => setActivePage('Lên lịch Youtube')}
                        title="Nhấn để lên lịch phát sóng mới"
                      >
                        <div className="horizon-empty-icon-btn">
                          <Plus size={13} />
                        </div>
                        <span className="horizon-empty-text">Lên lịch</span>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Platform Distribution Strip */}
          <div className="platform-share-container">
            <div className="platform-share-bar">
              {platformShares.map((p) =>
                p.percent > 0 ? (
                  <div
                    key={p.platform}
                    className="platform-segment"
                    style={{ width: `${p.percent}%`, background: p.color }}
                    title={`${p.label}: ${p.percent}% (${p.count} kênh)`}
                  />
                ) : null
              )}
            </div>

            <div className="platform-share-labels">
              {platformShares.map((p) => (
                <div key={p.platform} className="platform-share-item">
                  <span className="platform-color-chip" style={{ background: p.color }} />
                  <span>
                    {p.label}: <strong>{p.count} kênh</strong> ({p.percent}%)
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Chart 2: Production Velocity (Stripe / Vercel Smooth Spline Area Chart) */}
        <div className="studio-chart-panel">
          <div className="studio-chart-header">
            <div>
              <h3 className="studio-chart-title">
                <BarChart3 size={15} color="#6366f1" />
                <span>Sản Lượng Video 7 Ngày Qua</span>
              </h3>
              <p className="studio-chart-sub">
                {past7DaysTotalCount} video trong 7 ngày qua • Dữ liệu thực từ ổ đĩa
              </p>
            </div>

            {/* Mode Switcher Tabs */}
            <div className="chart-mode-tabs">
              <button
                type="button"
                className={`chart-tab-btn ${velocityMode === 'exports' ? 'active' : ''}`}
                onClick={() => setVelocityMode('exports')}
                title="Chỉ tính video ghép hoàn chỉnh trong Data/workflow_exports"
              >
                Video Hoàn Chỉnh (12)
              </button>
              <button
                type="button"
                className={`chart-tab-btn ${velocityMode === 'all' ? 'active' : ''}`}
                onClick={() => setVelocityMode('all')}
                title="Tính toàn bộ video bao gồm cả phân đoạn Veo"
              >
                Tất Cả Clip AI (80)
              </button>
            </div>
          </div>

          {/* SVG Smooth Spline Area Chart */}
          <div className="stripe-chart-wrap">
            <svg
              className="stripe-svg-chart"
              viewBox="0 0 500 150"
              preserveAspectRatio="none"
            >
              <defs>
                <linearGradient id="velocityAreaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#6366f1" stopOpacity="0.3" />
                  <stop offset="100%" stopColor="#6366f1" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Faint Horizontal Grid Lines */}
              {svgChartGeometry.yGridValues.map((val, i) => {
                const y = 22 + (i * (150 - 22 - 26)) / (svgChartGeometry.yGridValues.length - 1)
                return (
                  <g key={`grid-${val}-${i}`}>
                    <line x1="42" y1={y} x2="484" y2={y} className="stripe-grid-line" />
                    <text x="36" y={y + 3} textAnchor="end" className="stripe-axis-label">
                      {val}
                    </text>
                  </g>
                )
              })}

              {/* Area Fill */}
              {svgChartGeometry.areaPath && (
                <path
                  d={svgChartGeometry.areaPath}
                  fill="url(#velocityAreaGrad)"
                  className="stripe-area-fill"
                />
              )}

              {/* Smooth Bezier Stroke Line */}
              {svgChartGeometry.linePath && (
                <path d={svgChartGeometry.linePath} className="stripe-line-path" />
              )}

              {/* Data Points */}
              {svgChartGeometry.points.map((pt) => {
                const isHovered = hoveredVelocityIdx === pt.idx
                return (
                  <g key={`pt-${pt.item.date}`}>
                    <circle
                      cx={pt.x}
                      cy={pt.y}
                      r={isHovered ? 5.5 : 3.5}
                      fill="#ffffff"
                      stroke="#6366f1"
                      strokeWidth={isHovered ? 3 : 2}
                      className="stripe-dot"
                      onMouseEnter={() => setHoveredVelocityIdx(pt.idx)}
                      onMouseLeave={() => setHoveredVelocityIdx(null)}
                    >
                      <title>
                        {`${pt.item.dayLabel} (${pt.item.date}): ${pt.item.videoCount} video (${fmtBytes(pt.item.sizeBytes)})`}
                      </title>
                    </circle>

                    {/* Date label at bottom */}
                    <text
                      x={pt.x}
                      y={142}
                      textAnchor="middle"
                      className="stripe-axis-label"
                      style={{ fontWeight: pt.item.dayLabel === 'Hôm nay' ? 700 : 500 }}
                    >
                      {pt.item.dayLabel.includes(',') ? pt.item.dayLabel.split(',')[1].trim() : pt.item.dayLabel}
                    </text>
                  </g>
                )
              })}
            </svg>
          </div>

          {/* Interactive Hover Tooltip Bar */}
          <div className="stripe-tooltip-info">
            {hoveredVelocityIdx !== null && svgChartGeometry.points[hoveredVelocityIdx] ? (
              <>
                <span>
                  <strong>{svgChartGeometry.points[hoveredVelocityIdx].item.dayLabel}</strong> (
                  {svgChartGeometry.points[hoveredVelocityIdx].item.date}):{' '}
                  <span style={{ color: '#4f46e5', fontWeight: 600 }}>
                    {svgChartGeometry.points[hoveredVelocityIdx].item.videoCount} video đã xuất
                  </span>
                </span>
                <span>
                  Dung lượng: {fmtBytes(svgChartGeometry.points[hoveredVelocityIdx].item.sizeBytes)}
                </span>
              </>
            ) : (
              <>
                <span>
                  Chế độ:{' '}
                  <strong>{velocityMode === 'exports' ? 'Video Hoàn Chỉnh (Exports)' : 'Toàn Bộ Media AI'}</strong>
                </span>
                <span>Di chuột qua các điểm để xem chi tiết từng ngày</span>
              </>
            )}
          </div>
        </div>
      </section>

      {/* --------------------------------------------------------------------
          4. Main Studio Workspace: Channels Broadcast Matrix & Recent Projects
          -------------------------------------------------------------------- */}
      <div className="studio-main-grid">
        {/* Left: Channel Broadcast Matrix WITH REAL AVATAR IMAGES */}
        <section className="studio-section">
          <div className="studio-section-header">
            <h2 className="studio-section-title">
              <Tv size={16} color="#3b82f6" />
              <span>Ma Trận Phát Sóng Đa Kênh Hôm Nay</span>
            </h2>
            {onOpenChannelHealth && (
              <button
                type="button"
                className="studio-section-action"
                onClick={onOpenChannelHealth}
              >
                <span>Xem chi tiết lịch</span>
                <ArrowUpRight size={13} />
              </button>
            )}
          </div>

          <div className="studio-section-body">
            {loading ? (
              <div className="studio-empty-state">
                <Loader2 size={20} className="spinning" style={{ margin: '0 auto 8px' }} />
                <p>Đang đồng bộ tình trạng lịch đăng các kênh...</p>
              </div>
            ) : !monitor?.channels?.length ? (
              <div className="studio-empty-state">
                <Tv size={30} style={{ margin: '0 auto 8px', opacity: 0.4 }} />
                <p>Chưa có kênh nào được cấu hình giám sát.</p>
              </div>
            ) : (
              <div className="channel-matrix-list">
                {monitor.channels.map((ch, idx) => {
                  const channelKey = ch.channel_id || ch.channel_name
                  const isUnposted = ch.status === 'unposted'
                  const platformClass =
                    ch.platform === 'youtube'
                      ? 'youtube'
                      : ch.platform === 'tiktok'
                      ? 'tiktok'
                      : 'facebook'
                  const hasAvatarError = avatarErrors[channelKey]

                  return (
                    <div key={`${channelKey}-${idx}`} className="channel-matrix-item">
                      <div className="channel-matrix-left">
                        {/* REAL Channel Avatar with fallback */}
                        <div className="channel-avatar-wrapper">
                          {ch.avatar_url && !hasAvatarError ? (
                            <img
                              src={ch.avatar_url}
                              alt={ch.channel_name}
                              className="channel-avatar-img"
                              onError={() => {
                                setAvatarErrors((prev) => ({ ...prev, [channelKey]: true }))
                              }}
                            />
                          ) : (
                            <div className={`channel-avatar-fallback ${platformClass}`}>
                              {getInitials(ch.channel_name)}
                            </div>
                          )}

                          <span
                            className={`channel-avatar-dot ${isUnposted ? 'unposted' : 'healthy'}`}
                            title={isUnposted ? 'Chưa đăng hôm nay' : 'Đã đủ bài'}
                          />
                        </div>

                        <div className="channel-info-col">
                          <div className="channel-title-row">
                            <span className="channel-name" title={ch.channel_name}>
                              {ch.channel_name}
                            </span>
                            <span className={`channel-badge-platform ${platformClass}`}>
                              {ch.platform}
                            </span>
                          </div>

                          <div className="channel-progress-text">
                            {isUnposted ? (
                              <span style={{ color: '#dc2626', fontWeight: 500 }}>
                                ⚠️ Chưa đăng video hôm nay
                              </span>
                            ) : (
                              <span>Đã đăng {ch.today_count} video hôm nay</span>
                            )}
                            {ch.buffer_days > 0 && <span>• Đệm {ch.buffer_days} ngày</span>}
                          </div>
                        </div>
                      </div>

                      <div className="channel-matrix-right">
                        <span className={`channel-status-pill ${isUnposted ? 'unposted' : 'healthy'}`}>
                          {isUnposted ? 'Cần nạp bài' : 'Đã đủ bài'}
                        </span>

                        <button
                          type="button"
                          className={`channel-schedule-btn ${isUnposted ? '' : 'secondary'}`}
                          onClick={() =>
                            setActivePage(ch.platform === 'youtube' ? 'Lên lịch Youtube' : 'Lên lịch Pippit')
                          }
                        >
                          <span>{isUnposted ? 'Lên lịch ngay' : 'Xem lịch'}</span>
                          <ArrowUpRight size={11} />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </section>

        {/* Right: Visual Media Project Cards */}
        <section className="studio-section">
          <div className="studio-section-header">
            <h2 className="studio-section-title">
              <Film size={16} color="#8b5cf6" />
              <span>Dự Án Video Xuất Xưởng Gần Nhất</span>
            </h2>
            <button
              type="button"
              className="studio-section-action"
              onClick={() => setActivePage('AI Workflow')}
            >
              <span>Vào Workflow</span>
              <ArrowUpRight size={13} />
            </button>
          </div>

          <div className="studio-section-body">
            {recentVideos.length === 0 ? (
              <div className="studio-empty-state">
                <Film size={32} style={{ margin: '0 auto 8px', opacity: 0.35 }} />
                <p>Chưa có video nào trong thư viện thành phẩm.</p>
                <button
                  type="button"
                  className="channel-schedule-btn"
                  onClick={() => setActivePage('AI Workflow')}
                  style={{ margin: '0 auto' }}
                >
                  <Plus size={13} />
                  <span>Tạo video đầu tiên với AI Workflow</span>
                </button>
              </div>
            ) : (
              <div className="video-project-grid">
                {recentVideos.slice(0, 4).map((vid) => (
                  <div key={vid.filename} className="video-project-card">
                    {/* Video Visual Poster / Thumbnail */}
                    <div className="video-card-thumb">
                      <video
                        src={vid.downloadUrl}
                        preload="metadata"
                        muted
                        playsInline
                        onError={(e) => {
                          e.currentTarget.style.display = 'none'
                        }}
                      />
                      <div className="video-card-thumb-placeholder">
                        <Film size={26} />
                      </div>

                      {/* Play button overlay on hover */}
                      <div
                        className="video-card-play-overlay"
                        onClick={() =>
                          setActivePreviewVideo({
                            url: vid.downloadUrl,
                            title: vid.filename,
                          })
                        }
                        title="Phát video toàn cảnh"
                      >
                        <div className="video-card-play-btn">
                          <Play size={15} fill="currentColor" />
                        </div>
                      </div>

                      <span className="video-card-badge-ratio">9:16 Shorts</span>
                      <span className="video-card-badge-size">{fmtBytes(vid.sizeBytes)}</span>
                    </div>

                    {/* Video Meta Info */}
                    <div className="video-card-body">
                      <div className="video-card-name" title={vid.filename}>
                        {vid.filename}
                      </div>

                      <div className="video-card-footer">
                        <span className="video-card-date">
                          {vid.createdAt ? vid.createdAt.slice(0, 10) : 'Gần đây'}
                        </span>

                        <button
                          type="button"
                          className="video-card-folder-btn"
                          onClick={() => openExportFolder(vid.filename)}
                          title="Mở thư mục chứa file trong Windows Explorer"
                        >
                          <FolderOpen size={11} />
                          <span>Thư mục</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Video Player Modal */}
      {activePreviewVideo && (
        <VideoPlayerModal
          isOpen={Boolean(activePreviewVideo)}
          onClose={() => setActivePreviewVideo(null)}
          videoUrl={activePreviewVideo.url}
          title={activePreviewVideo.title}
        />
      )}
    </div>
  )
}
