import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Calendar,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Facebook,
  FileText,
  HelpCircle,
  Loader2,
  RefreshCw,
  Search,
  Share2,
  Sparkles,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'

function FacebookIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

export interface PippitTaskItem {
  task_id?: string
  status?: number
  published?: boolean
  post_id?: string
  post_url?: string
  page_id?: string
  page_name?: string
  schedule_time_ms?: number
  title?: string
  description?: string
  failed_reason?: string
  account_id?: string
  account_email?: string
}

export function PippitHistoryTab() {
  const [tasks, setTasks] = useState<PippitTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'scheduled' | 'failed'>('all')

  async function loadTasks() {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/pippit/all-tasks`)
      if (!res.ok) throw new Error('Không thể tải lịch sử đăng bài Pippit')
      const data: PippitTaskItem[] = await res.json()
      setTasks(Array.isArray(data) ? data : [])
    } catch {
      setTasks([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadTasks()
  }, [])

  function formatScheduleTime(ms?: number): string {
    if (!ms) return 'Chưa xác định'
    const d = new Date(ms)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const year = d.getFullYear()
    return `${hh}:${mm} - ${day}/${month}/${year}`
  }

  function getRelativeTimeStr(ms?: number): string {
    if (!ms) return ''
    const diffMs = ms - Date.now()
    if (diffMs > 0) {
      const diffMins = Math.round(diffMs / (60 * 1000))
      if (diffMins < 60) return `(sau ~${diffMins} phút)`
      const hours = Math.floor(diffMins / 60)
      const mins = diffMins % 60
      return `(sau ~${hours}h${mins > 0 ? ` ${mins}p` : ''})`
    } else {
      const agoMins = Math.round(Math.abs(diffMs) / (60 * 1000))
      if (agoMins < 60) return `(~${agoMins} phút trước)`
      const hours = Math.floor(agoMins / 60)
      const mins = agoMins % 60
      return `(~${hours}h${mins > 0 ? ` ${mins}p` : ''} trước)`
    }
  }

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      // Status filter
      if (statusFilter === 'published') {
        if (!t.published && t.status !== 3) return false
      } else if (statusFilter === 'scheduled') {
        if (t.published || t.status === 3 || t.failed_reason) return false
      } else if (statusFilter === 'failed') {
        if (!t.failed_reason && t.status !== 2) return false
      }

      // Search
      const q = search.toLowerCase().trim()
      if (!q) return true
      const title = (t.title || '').toLowerCase()
      const desc = (t.description || '').toLowerCase()
      const page = (t.page_name || '').toLowerCase()
      const email = (t.account_email || '').toLowerCase()
      const taskId = (t.task_id || '').toLowerCase()
      return (
        title.includes(q) ||
        desc.includes(q) ||
        page.includes(q) ||
        email.includes(q) ||
        taskId.includes(q)
      )
    })
  }, [tasks, statusFilter, search])

  const publishedCount = tasks.filter(t => t.published || t.status === 3).length
  const failedCount = tasks.filter(t => t.failed_reason || t.status === 2).length
  const scheduledCount = tasks.length - publishedCount - failedCount

  return (
    <div style={{ padding: '4px 0 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Top Filter & Search Bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 10,
          background: '#fff',
          padding: '12px 16px',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
          <button
            type="button"
            className={`scene-chip ${statusFilter === 'all' ? 'active' : ''}`}
            onClick={() => setStatusFilter('all')}
          >
            Tất cả ({tasks.length})
          </button>
          <button
            type="button"
            className={`scene-chip ${statusFilter === 'scheduled' ? 'active' : ''}`}
            onClick={() => setStatusFilter('scheduled')}
          >
            Đang hẹn giờ ({scheduledCount})
          </button>
          <button
            type="button"
            className={`scene-chip ${statusFilter === 'published' ? 'active' : ''}`}
            onClick={() => setStatusFilter('published')}
          >
            Đã đăng ({publishedCount})
          </button>
          {failedCount > 0 && (
            <button
              type="button"
              className={`scene-chip ${statusFilter === 'failed' ? 'active' : ''}`}
              onClick={() => setStatusFilter('failed')}
            >
              Lỗi ({failedCount})
            </button>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ position: 'relative', width: 220 }}>
            <Search
              size={13}
              style={{
                position: 'absolute',
                left: 9,
                top: '50%',
                transform: 'translateY(-50%)',
                color: '#94a3b8',
              }}
            />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tìm theo tiêu đề, page..."
              style={{
                width: '100%',
                height: 32,
                paddingLeft: 28,
                fontSize: 12,
                borderRadius: 8,
                border: '1px solid #e2e8f0',
              }}
            />
          </div>
          <button
            type="button"
            className="icon-button"
            onClick={loadTasks}
            disabled={loading}
            title="Làm mới danh sách"
            style={{ width: 32, height: 32 }}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
          </button>
        </div>
      </div>

      {/* Task List Content */}
      {loading && tasks.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '40px 20px', color: '#64748b' }}>
          <Loader2 size={24} className="spin" style={{ margin: '0 auto 10px' }} />
          <p style={{ fontSize: 13, margin: 0 }}>Đang tải lịch sử xuất bản từ Pippit Cloud...</p>
        </div>
      ) : filteredTasks.length === 0 ? (
        <div
          style={{
            textAlign: 'center',
            padding: '50px 20px',
            background: '#fff',
            borderRadius: 14,
            border: '1px dashed #cbd5e1',
            color: '#64748b',
          }}
        >
          <div
            style={{
              display: 'grid',
              width: 52,
              height: 52,
              placeItems: 'center',
              background: '#f1f5f9',
              color: '#94a3b8',
              borderRadius: '50%',
              margin: '0 auto 12px',
            }}
          >
            <FacebookIcon size={24} />
          </div>
          <h4 style={{ margin: '0 0 6px', fontSize: 15, fontWeight: 700, color: '#334155' }}>
            {search ? 'Không tìm thấy bài đăng phù hợp' : 'Chưa có bài đăng nào qua Pippit'}
          </h4>
          <p style={{ margin: 0, fontSize: 12.5, color: '#64748b' }}>
            Khi bạn xuất bản hoặc lên lịch video từ Studio hoặc Lịch sử, danh sách task sẽ xuất hiện tại đây.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 12 }}>
          {filteredTasks.map((t, idx) => {
            const isPublished = t.published || t.status === 3
            const isFailed = Boolean(t.failed_reason || t.status === 2)

            return (
              <div
                key={t.task_id || idx}
                style={{
                  background: '#fff',
                  borderRadius: 14,
                  border: '1px solid #e2e8f0',
                  padding: 16,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10,
                  transition: 'border-color .15s',
                }}
              >
                {/* Header Row */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <div
                      style={{
                        display: 'grid',
                        width: 32,
                        height: 32,
                        placeItems: 'center',
                        background: '#1877f2',
                        color: '#fff',
                        borderRadius: 8,
                        flexShrink: 0,
                      }}
                    >
                      <FacebookIcon size={16} />
                    </div>
                    <div>
                      <strong style={{ fontSize: 13, color: '#0f172a' }}>
                        {t.page_name || `Page ${t.page_id || ''}`}
                      </strong>
                      <div style={{ fontSize: 11, color: '#64748b' }}>
                        {t.account_email ? `${t.account_email} · ` : ''}
                        Task ID: <code>{t.task_id || 'N/A'}</code>
                      </div>
                    </div>
                  </div>

                  {/* Status Badge */}
                  <div>
                    {isPublished ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 9px',
                          background: '#dcfce7',
                          color: '#15803d',
                          borderRadius: 999,
                          fontSize: 11.5,
                          fontWeight: 700,
                        }}
                      >
                        <CheckCircle2 size={12} /> Đã phát sóng
                      </span>
                    ) : isFailed ? (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 9px',
                          background: '#fee2e2',
                          color: '#dc2626',
                          borderRadius: 999,
                          fontSize: 11.5,
                          fontWeight: 700,
                        }}
                      >
                        <AlertCircle size={12} /> Thất bại
                      </span>
                    ) : (
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '3px 9px',
                          background: '#eff6ff',
                          color: '#1d4ed8',
                          borderRadius: 999,
                          fontSize: 11.5,
                          fontWeight: 700,
                        }}
                      >
                        <Clock3 size={12} /> Đang lên lịch
                      </span>
                    )}
                  </div>
                </div>

                {/* Title & Description */}
                <div>
                  {t.title && (
                    <h4
                      style={{
                        margin: '0 0 6px',
                        fontSize: 13.5,
                        fontWeight: 700,
                        color: '#1e293b',
                        lineHeight: 1.4,
                      }}
                    >
                      {t.title}
                    </h4>
                  )}
                  {t.description && (
                    <p
                      style={{
                        margin: 0,
                        fontSize: 12,
                        color: '#475569',
                        lineHeight: 1.5,
                        whiteSpace: 'pre-line',
                      }}
                    >
                      {t.description}
                    </p>
                  )}
                </div>

                {/* Error message if any */}
                {isFailed && t.failed_reason && (
                  <div
                    style={{
                      background: '#fef2f2',
                      border: '1px solid #fecaca',
                      borderRadius: 8,
                      padding: '8px 12px',
                      fontSize: 11.5,
                      color: '#991b1b',
                    }}
                  >
                    <strong>Lỗi:</strong> {t.failed_reason}
                  </div>
                )}

                {/* Footer Info & Actions */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: 8,
                    paddingTop: 8,
                    borderTop: '1px solid #f1f5f9',
                    fontSize: 11.5,
                    color: '#64748b',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <Calendar size={13} />
                    <span>
                      Thời gian phát sóng:{' '}
                      <strong>{formatScheduleTime(t.schedule_time_ms)}</strong>{' '}
                      <span style={{ color: '#0284c7', fontWeight: 600 }}>
                        {getRelativeTimeStr(t.schedule_time_ms)}
                      </span>
                    </span>
                  </div>

                  {t.post_url ? (
                    <a
                      href={t.post_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        color: '#1877f2',
                        fontWeight: 600,
                        textDecoration: 'none',
                        fontSize: 11.5,
                      }}
                    >
                      Xem bài viết trên Facebook <ExternalLink size={12} />
                    </a>
                  ) : null}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
