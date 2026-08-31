import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Calendar as CalendarIcon,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  ExternalLink,
  Eye,
  Filter,
  Layers,
  List,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  X,
} from 'lucide-react'
import { fetchCalendarEvents } from '../../monitor/services/monitorApi'
import type { CalendarEvent, CalendarEventsResponse } from '../../monitor/types'

// Platform Icon Components
function TikTokIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.88 2.89 2.89 0 0 1-2.89-2.88 2.89 2.89 0 0 1 2.89-2.88c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3 15.67a6.34 6.34 0 0 0 6.34 6.33 6.34 6.34 0 0 0 6.34-6.33V8.89a8.28 8.28 0 0 0 4.91 1.6V7.04a4.85 4.85 0 0 1-1-.35z" />
    </svg>
  )
}

function FacebookIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function YouTubeIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

const WEEKDAY_NAMES = ['Thứ Hai', 'Thứ Ba', 'Thứ Tư', 'Thứ Năm', 'Thứ Sáu', 'Thứ Bảy', 'Chủ Nhật']

export function PublishingCalendarTab() {
  const [currentDate, setCurrentDate] = useState<Date>(() => new Date())
  const [viewMode, setViewMode] = useState<'month' | 'list'>('month')
  const [selectedChannel, setSelectedChannel] = useState<string>('all')
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'published' | 'scheduled' | 'failed'>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [data, setData] = useState<CalendarEventsResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [selectedDayEvents, setSelectedDayEvents] = useState<{ date: string; events: CalendarEvent[] } | null>(null)

  const monthStr = useMemo(() => {
    const y = currentDate.getFullYear()
    const m = String(currentDate.getMonth() + 1).padStart(2, '0')
    return `${y}-${m}`
  }, [currentDate])

  const todayStr = useMemo(() => {
    const now = new Date()
    const y = now.getFullYear()
    const m = String(now.getMonth() + 1).padStart(2, '0')
    const d = String(now.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }, [])

  const loadData = useCallback(
    async (forceSync = false) => {
      if (forceSync) setIsSyncing(true)
      else setLoading(true)
      try {
        const res = await fetchCalendarEvents(monthStr, forceSync)
        setData(res)
      } catch (err) {
        console.error('Error fetching calendar events:', err)
      } finally {
        setLoading(false)
        setIsSyncing(false)
      }
    },
    [monthStr]
  )

  useEffect(() => {
    loadData(false)
  }, [loadData])

  // Navigate Month
  const handlePrevMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() - 1, 1))
  }

  const handleNextMonth = () => {
    setCurrentDate(prev => new Date(prev.getFullYear(), prev.getMonth() + 1, 1))
  }

  const handleToday = () => {
    setCurrentDate(new Date())
  }

  // Filtered Events
  const filteredEvents = useMemo(() => {
    if (!data?.events) return []
    return data.events.filter(e => {
      // 1. Channel Filter
      if (selectedChannel !== 'all') {
        const key = `${e.platform}_${e.channel_name}`
        if (key !== selectedChannel && e.channel_name !== selectedChannel) return false
      }
      // 2. Status Filter
      if (selectedStatus !== 'all' && e.status !== selectedStatus) {
        return false
      }
      // 3. Search Query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchTitle = e.title.toLowerCase().includes(q)
        const matchCh = e.channel_name.toLowerCase().includes(q)
        if (!matchTitle && !matchCh) return false
      }
      return true
    })
  }, [data, selectedChannel, selectedStatus, searchQuery])

  // Events grouped by date string (YYYY-MM-DD)
  const eventsByDate = useMemo(() => {
    const map = new Map<string, CalendarEvent[]>()
    for (const e of filteredEvents) {
      if (!map.has(e.date)) {
        map.set(e.date, [])
      }
      map.get(e.date)!.push(e)
    }
    return map
  }, [filteredEvents])

  // Calendar Month Grid Matrix Calculation
  const calendarGridDays = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()

    const firstDayOfMonth = new Date(year, month, 1)
    const lastDayOfMonth = new Date(year, month + 1, 0)

    // Monday = 0, Sunday = 6
    let startDayOfWeek = firstDayOfMonth.getDay() - 1
    if (startDayOfWeek === -1) startDayOfWeek = 6

    const days: { dateStr: string; dayNum: number; isCurrentMonth: boolean }[] = []

    // 1. Previous month trailing days
    const prevMonthLastDay = new Date(year, month, 0).getDate()
    for (let i = startDayOfWeek - 1; i >= 0; i--) {
      const d = prevMonthLastDay - i
      const prevDate = new Date(year, month - 1, d)
      const dateStr = `${prevDate.getFullYear()}-${String(prevDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({ dateStr, dayNum: d, isCurrentMonth: false })
    }

    // 2. Current month days
    const totalDaysInMonth = lastDayOfMonth.getDate()
    for (let d = 1; d <= totalDaysInMonth; d++) {
      const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({ dateStr, dayNum: d, isCurrentMonth: true })
    }

    // 3. Next month leading days (fill up to complete weeks)
    const remainingDays = (7 - (days.length % 7)) % 7
    for (let d = 1; d <= remainingDays; d++) {
      const nextDate = new Date(year, month + 1, d)
      const dateStr = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push({ dateStr, dayNum: d, isCurrentMonth: false })
    }

    return days
  }, [currentDate])

  // Month Display Name
  const monthDisplayTitle = useMemo(() => {
    return `Tháng ${currentDate.getMonth() + 1} / ${currentDate.getFullYear()}`
  }, [currentDate])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* ── KPI Stats Strip ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: 12,
        }}
      >
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: '#eef2ff',
              color: '#4f46e5',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <CalendarIcon size={18} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Tổng bài tháng này
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#0f172a', marginTop: 2 }}>
              {data?.total_events ?? 0} <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>video</span>
            </div>
          </div>
        </div>

        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: '#ecfdf5',
              color: '#059669',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <CheckCircle2 size={18} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Đã xuất bản
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#059669', marginTop: 2 }}>
              {data?.published_count ?? 0} <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>bài</span>
            </div>
          </div>
        </div>

        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: '#fffbeb',
              color: '#d97706',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Clock size={18} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Đang trong lịch hẹn
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#d97706', marginTop: 2 }}>
              {data?.scheduled_count ?? 0} <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>bài</span>
            </div>
          </div>
        </div>

        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: '14px 16px',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
          }}
        >
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 10,
              background: '#eff6ff',
              color: '#2563eb',
              display: 'grid',
              placeItems: 'center',
              flexShrink: 0,
            }}
          >
            <Layers size={18} />
          </div>
          <div>
            <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Kênh kết nối
            </div>
            <div style={{ fontSize: 20, fontWeight: 800, color: '#2563eb', marginTop: 2 }}>
              {data?.channels_list.length ?? 0} <span style={{ fontSize: 12, fontWeight: 500, color: '#64748b' }}>kênh</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Master Control Bar ── */}
      <div
        style={{
          background: '#fff',
          border: '1px solid #e2e8f0',
          borderRadius: 12,
          padding: '10px 14px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        {/* Left: Month Navigator & View Switcher */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Month Stepper */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f8fafc', padding: '3px 4px', borderRadius: 8, border: '1px solid #e2e8f0' }}>
            <button
              type="button"
              onClick={handlePrevMonth}
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: '#fff',
                border: '1px solid #cbd5e1',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                color: '#475569',
              }}
              title="Tháng trước"
            >
              <ChevronLeft size={16} />
            </button>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', minWidth: 120, textAlign: 'center' }}>
              {monthDisplayTitle}
            </span>
            <button
              type="button"
              onClick={handleNextMonth}
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                background: '#fff',
                border: '1px solid #cbd5e1',
                display: 'grid',
                placeItems: 'center',
                cursor: 'pointer',
                color: '#475569',
              }}
              title="Tháng sau"
            >
              <ChevronRight size={16} />
            </button>
          </div>

          <button
            type="button"
            onClick={handleToday}
            style={{
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#fff',
              fontSize: 12,
              fontWeight: 600,
              color: '#334155',
              cursor: 'pointer',
            }}
          >
            Hôm nay
          </button>

          {/* View Mode Toggle */}
          <div style={{ display: 'flex', background: '#f1f5f9', padding: 2, borderRadius: 8 }}>
            <button
              type="button"
              onClick={() => setViewMode('month')}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                background: viewMode === 'month' ? '#fff' : 'transparent',
                color: viewMode === 'month' ? '#0f172a' : '#64748b',
                boxShadow: viewMode === 'month' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                cursor: 'pointer',
              }}
            >
              Tháng
            </button>
            <button
              type="button"
              onClick={() => setViewMode('list')}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                fontSize: 12,
                fontWeight: 600,
                border: 'none',
                background: viewMode === 'list' ? '#fff' : 'transparent',
                color: viewMode === 'list' ? '#0f172a' : '#64748b',
                boxShadow: viewMode === 'list' ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                cursor: 'pointer',
              }}
            >
              Danh sách
            </button>
          </div>
        </div>

        {/* Right: Filters & Live Sync */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Search Box */}
          <div style={{ position: 'relative' }}>
            <Search size={13} style={{ position: 'absolute', left: 9, top: 10, color: '#94a3b8' }} />
            <input
              type="text"
              placeholder="Tìm video..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              style={{
                height: 32,
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                paddingLeft: 28,
                paddingRight: 10,
                fontSize: 12,
                width: 150,
              }}
            />
          </div>

          {/* Channel Filter */}
          <select
            value={selectedChannel}
            onChange={e => setSelectedChannel(e.target.value)}
            style={{
              height: 32,
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              padding: '0 8px',
              fontSize: 12,
              fontWeight: 600,
              color: '#334155',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            <option value="all">Tất cả kênh</option>
            {data?.channels_list.map(ch => (
              <option key={ch.key} value={ch.key}>
                {ch.platform === 'tiktok' ? '🎵 TikTok' : ch.platform === 'facebook' ? '📘 FB' : '▶️ YT'}: {ch.name}
              </option>
            ))}
          </select>

          {/* Status Filter */}
          <select
            value={selectedStatus}
            onChange={e => setSelectedStatus(e.target.value as any)}
            style={{
              height: 32,
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              padding: '0 8px',
              fontSize: 12,
              fontWeight: 600,
              color: '#334155',
              background: '#fff',
              cursor: 'pointer',
            }}
          >
            <option value="all">Tất cả trạng thái</option>
            <option value="published">🟢 Đã đăng</option>
            <option value="scheduled">⏳ Đang lên lịch</option>
            <option value="failed">🔴 Lỗi</option>
          </select>

          {/* Live Sync Button */}
          <button
            type="button"
            onClick={() => loadData(true)}
            disabled={isSyncing}
            style={{
              height: 32,
              padding: '0 12px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: isSyncing ? '#f1f5f9' : '#fff',
              fontSize: 12,
              fontWeight: 600,
              color: isSyncing ? '#94a3b8' : '#334155',
              cursor: isSyncing ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
            }}
            title="Đồng bộ trực tiếp dữ liệu tươi từ máy chủ Pippit & YouTube"
          >
            <RefreshCw size={13} className={isSyncing ? 'spin' : ''} />
            <span>{isSyncing ? 'Đang đồng bộ...' : 'Làm mới'}</span>
          </button>
        </div>
      </div>

      {/* ── Main View: Month Grid ── */}
      {viewMode === 'month' ? (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            overflow: 'hidden',
            boxShadow: '0 2px 6px rgba(0,0,0,0.02)',
          }}
        >
          {/* Weekday Header */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              borderBottom: '1px solid #e2e8f0',
              background: '#f8fafc',
            }}
          >
            {WEEKDAY_NAMES.map((name, idx) => (
              <div
                key={name}
                style={{
                  padding: '10px 8px',
                  textAlign: 'center',
                  fontSize: 12,
                  fontWeight: 700,
                  color: idx >= 5 ? '#e11d48' : '#475569',
                  borderRight: idx < 6 ? '1px solid #f1f5f9' : 'none',
                }}
              >
                {name}
              </div>
            ))}
          </div>

          {/* Calendar Days Matrix */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
              gridAutoRows: 'minmax(120px, auto)',
            }}
          >
            {calendarGridDays.map((day, idx) => {
              const dayEvents = eventsByDate.get(day.dateStr) || []
              const isToday = day.dateStr === todayStr
              const isRightEdge = (idx + 1) % 7 === 0

              return (
                <div
                  key={day.dateStr}
                  onClick={() => dayEvents.length > 0 && setSelectedDayEvents({ date: day.dateStr, events: dayEvents })}
                  style={{
                    borderRight: isRightEdge ? 'none' : '1px solid #f1f5f9',
                    borderBottom: '1px solid #f1f5f9',
                    padding: '8px 6px',
                    background: !day.isCurrentMonth ? '#fafafa' : isToday ? '#f5f7ff' : '#fff',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    minHeight: 125,
                    cursor: dayEvents.length > 0 ? 'pointer' : 'default',
                    transition: 'background 0.15s ease',
                  }}
                  onMouseEnter={e => {
                    if (dayEvents.length > 0) e.currentTarget.style.background = isToday ? '#eef2ff' : '#f8fafc'
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.background = !day.isCurrentMonth ? '#fafafa' : isToday ? '#f5f7ff' : '#fff'
                  }}
                >
                  {/* Day Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span
                      style={{
                        width: 22,
                        height: 22,
                        borderRadius: 6,
                        display: 'grid',
                        placeItems: 'center',
                        fontSize: 12,
                        fontWeight: isToday ? 800 : day.isCurrentMonth ? 700 : 400,
                        color: isToday ? '#fff' : day.isCurrentMonth ? '#1e293b' : '#94a3b8',
                        background: isToday ? '#4f46e5' : 'transparent',
                      }}
                    >
                      {day.dayNum}
                    </span>

                    {dayEvents.length > 0 && (
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          color: '#4f46e5',
                          background: '#eef2ff',
                          padding: '1px 6px',
                          borderRadius: 10,
                        }}
                      >
                        {dayEvents.length} bài
                      </span>
                    )}
                  </div>

                  {/* Day Event Pills */}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flex: 1 }}>
                    {dayEvents.slice(0, 3).map(ev => {
                      const isFB = ev.platform === 'facebook'
                      const isTT = ev.platform === 'tiktok'
                      const isYT = ev.platform === 'youtube'

                      return (
                        <div
                          key={ev.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 5px',
                            borderRadius: 5,
                            fontSize: 10.5,
                            fontWeight: 600,
                            background: isFB ? '#eff6ff' : isTT ? '#f1f5f9' : '#fff1f2',
                            color: isFB ? '#1d4ed8' : isTT ? '#0f172a' : '#be123c',
                            border: isFB ? '1px solid #dbeafe' : isTT ? '1px solid #e2e8f0' : '1px solid #ffe4e6',
                            overflow: 'hidden',
                            whiteSpace: 'nowrap',
                            textOverflow: 'ellipsis',
                          }}
                          title={`[${ev.time}] ${ev.channel_name}: ${ev.title} (${ev.status === 'published' ? 'Đã đăng' : 'Đang hẹn giờ'})`}
                        >
                          <span style={{ flexShrink: 0, display: 'grid', placeItems: 'center' }}>
                            {isFB ? <FacebookIcon size={10} /> : isTT ? <TikTokIcon size={10} /> : <YouTubeIcon size={10} />}
                          </span>
                          <span style={{ fontSize: 9.5, fontWeight: 700, opacity: 0.85, flexShrink: 0 }}>
                            {ev.time}
                          </span>
                          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                            {ev.title}
                          </span>
                        </div>
                      )
                    })}

                    {dayEvents.length > 3 && (
                      <div
                        style={{
                          fontSize: 10,
                          fontWeight: 700,
                          color: '#475569',
                          background: '#f1f5f9',
                          padding: '2px 6px',
                          borderRadius: 4,
                          textAlign: 'center',
                          marginTop: 'auto',
                        }}
                      >
                        +{dayEvents.length - 3} mục khác
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        /* ── Main View: Agenda / List View ── */
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {Array.from(eventsByDate.entries()).length === 0 ? (
            <div style={{ background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 40, textAlign: 'center', color: '#64748b' }}>
              Không có sự kiện lịch phát sóng nào trong tháng này.
            </div>
          ) : (
            Array.from(eventsByDate.entries()).map(([dateStr, dEvents]) => (
              <div
                key={dateStr}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 12,
                  overflow: 'hidden',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                }}
              >
                <div
                  style={{
                    background: dateStr === todayStr ? '#eef2ff' : '#f8fafc',
                    padding: '8px 14px',
                    borderBottom: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <CalendarIcon size={14} color="#4f46e5" />
                    <strong style={{ fontSize: 13, color: '#1e293b' }}>{dateStr}</strong>
                    {dateStr === todayStr && (
                      <span style={{ fontSize: 10, fontWeight: 700, background: '#4f46e5', color: '#fff', padding: '1px 6px', borderRadius: 4 }}>
                        Hôm nay
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>{dEvents.length} bài đăng</span>
                </div>

                <div style={{ padding: '8px 14px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {dEvents.map(ev => {
                    const isFB = ev.platform === 'facebook'
                    const isTT = ev.platform === 'tiktok'
                    const isYT = ev.platform === 'youtube'

                    return (
                      <div
                        key={ev.id}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          padding: '8px 10px',
                          background: '#f8fafc',
                          borderRadius: 8,
                          border: '1px solid #f1f5f9',
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          <span
                            style={{
                              padding: '2px 6px',
                              borderRadius: 4,
                              fontSize: 10.5,
                              fontWeight: 700,
                              background: isFB ? '#eff6ff' : isTT ? '#f1f5f9' : '#fff1f2',
                              color: isFB ? '#1d4ed8' : isTT ? '#0f172a' : '#be123c',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            {isFB ? <FacebookIcon size={10} /> : isTT ? <TikTokIcon size={10} /> : <YouTubeIcon size={10} />}
                            <span>{ev.platform.toUpperCase()}</span>
                          </span>

                          <span style={{ fontSize: 12, fontWeight: 700, color: '#334155' }}>{ev.time}</span>
                          <span style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>{ev.title}</span>
                          <span style={{ fontSize: 11, color: '#64748b' }}>• {ev.channel_name}</span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 600,
                              color: ev.status === 'published' ? '#059669' : ev.status === 'failed' ? '#e11d48' : '#d97706',
                              background: ev.status === 'published' ? '#ecfdf5' : ev.status === 'failed' ? '#fff1f2' : '#fffbeb',
                              padding: '2px 7px',
                              borderRadius: 4,
                            }}
                          >
                            {ev.status === 'published' ? 'Đã đăng' : ev.status === 'failed' ? 'Lỗi' : 'Đang hẹn giờ'}
                          </span>

                          {ev.post_url && (
                            <a
                              href={ev.post_url}
                              target="_blank"
                              rel="noreferrer"
                              style={{ color: '#4f46e5', display: 'flex', alignItems: 'center', gap: 2, fontSize: 11, textDecoration: 'none' }}
                            >
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* ── Day Detail Drawer / Modal ── */}
      {selectedDayEvents && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => setSelectedDayEvents(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 16,
              width: '100%',
              maxWidth: 680,
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Modal Header */}
            <div
              style={{
                padding: '16px 20px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                background: '#f8fafc',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CalendarIcon size={18} color="#4f46e5" />
                <div>
                  <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                    Chi tiết lịch phát sóng ngày {selectedDayEvents.date}
                  </h3>
                  <span style={{ fontSize: 12, color: '#64748b' }}>
                    Tổng cộng {selectedDayEvents.events.length} video được lên lịch trong ngày này
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setSelectedDayEvents(null)}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  cursor: 'pointer',
                  padding: 6,
                  borderRadius: 6,
                }}
              >
                <X size={20} />
              </button>
            </div>

            {/* Modal Body: Timeline */}
            <div style={{ padding: 20, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
              {selectedDayEvents.events.map(ev => {
                const isFB = ev.platform === 'facebook'
                const isTT = ev.platform === 'tiktok'
                const isYT = ev.platform === 'youtube'

                return (
                  <div
                    key={ev.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '12px 14px',
                      borderRadius: 10,
                      border: '1px solid #e2e8f0',
                      background: '#fff',
                      boxShadow: '0 1px 2px rgba(0,0,0,0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <div
                        style={{
                          width: 48,
                          height: 48,
                          borderRadius: 8,
                          background: isFB ? '#eff6ff' : isTT ? '#f1f5f9' : '#fff1f2',
                          color: isFB ? '#1d4ed8' : isTT ? '#0f172a' : '#be123c',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 2,
                          flexShrink: 0,
                          fontWeight: 800,
                          fontSize: 11,
                        }}
                      >
                        {isFB ? <FacebookIcon size={14} /> : isTT ? <TikTokIcon size={14} /> : <YouTubeIcon size={14} />}
                        <span>{ev.time}</span>
                      </div>

                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <strong style={{ fontSize: 13, color: '#0f172a' }}>{ev.title}</strong>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11.5, color: '#64748b' }}>
                          <span>Kênh: <strong>{ev.channel_name}</strong></span>
                          {ev.file_name && <span>• File: {ev.file_name}</span>}
                        </div>
                      </div>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span
                        style={{
                          fontSize: 11.5,
                          fontWeight: 700,
                          color: ev.status === 'published' ? '#059669' : ev.status === 'failed' ? '#e11d48' : '#d97706',
                          background: ev.status === 'published' ? '#ecfdf5' : ev.status === 'failed' ? '#fff1f2' : '#fffbeb',
                          padding: '3px 8px',
                          borderRadius: 6,
                          border:
                            ev.status === 'published'
                              ? '1px solid #bbf7d0'
                              : ev.status === 'failed'
                              ? '1px solid #fecdd3'
                              : '1px solid #fde68a',
                        }}
                      >
                        {ev.status === 'published' ? 'Đã đăng' : ev.status === 'failed' ? 'Lỗi' : 'Đang hẹn giờ'}
                      </span>

                      {ev.post_url && (
                        <a
                          href={ev.post_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '4px 8px',
                            borderRadius: 6,
                            border: '1px solid #cbd5e1',
                            background: '#fff',
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#334155',
                            textDecoration: 'none',
                          }}
                        >
                          <span>Xem bài</span>
                          <ExternalLink size={12} />
                        </a>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
