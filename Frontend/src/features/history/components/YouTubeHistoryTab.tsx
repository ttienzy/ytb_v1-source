import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock3,
  Copy,
  ExternalLink,
  Eye,
  Globe,
  Loader2,
  Lock,
  RefreshCw,
  Search,
  Tag,
  Trash2,
  Tv,
  Video,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import { YouTubeBrandIcon } from '../../settings/components/YouTubeSection'

export interface YouTubeTaskItem {
  task_id: string
  video_id?: string
  youtube_url?: string
  title?: string
  description?: string
  tags?: string
  privacy_status?: string
  category_id?: string
  status?: string // 'published' | 'scheduled' | 'failed'
  error?: string
  channel_title?: string
  channel_id?: string
  created_at?: string
  schedule_time_iso?: string
}

export function YouTubeHistoryTab() {
  const [tasks, setTasks] = useState<YouTubeTaskItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'published' | 'scheduled' | 'failed'>('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  async function loadTasks() {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/youtube/tasks`)
      if (!res.ok) throw new Error('Không thể tải lịch sử YouTube')
      const data = await res.json()
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

  async function handleDelete(taskId: string) {
    if (!confirm('Bạn có chắc muốn xóa bản ghi lịch sử đăng YouTube này?')) return
    setDeletingId(taskId)
    try {
      await fetch(`${API_URL}/api/youtube/tasks/${taskId}`, { method: 'DELETE' })
      setTasks(prev => prev.filter(t => t.task_id !== taskId))
    } catch {
      // ignore
    } finally {
      setDeletingId(null)
    }
  }

  async function copyLink(url: string, id: string) {
    try {
      await navigator.clipboard.writeText(url)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      // fallback
    }
  }

  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      const matchSearch =
        !search ||
        (t.title || '').toLowerCase().includes(search.toLowerCase()) ||
        (t.channel_title || '').toLowerCase().includes(search.toLowerCase()) ||
        (t.video_id || '').toLowerCase().includes(search.toLowerCase())

      if (!matchSearch) return false

      if (statusFilter === 'published') return t.status === 'published' || Boolean(t.youtube_url)
      if (statusFilter === 'scheduled') return t.status === 'scheduled'
      if (statusFilter === 'failed') return t.status === 'failed' || Boolean(t.error)
      return true
    })
  }, [tasks, search, statusFilter])

  return (
    <div style={{ padding: '0 4px' }}>
      {/* Header controls */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 16,
          flexWrap: 'wrap',
          gap: 10,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flex: 1, minWidth: 260 }}>
          <div className="swrap" style={{ flex: 1, margin: 0 }}>
            <Search size={14} />
            <input
              className="hsearch"
              placeholder="Tìm tiêu đề, kênh YouTube, video ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', gap: 4 }}>
            {(['all', 'published', 'scheduled', 'failed'] as const).map(st => (
              <button
                key={st}
                type="button"
                className={`scene-chip ${statusFilter === st ? 'active' : ''}`}
                onClick={() => setStatusFilter(st)}
                style={{ fontSize: 11, padding: '4px 10px' }}
              >
                {st === 'all' && `Tất cả (${tasks.length})`}
                {st === 'published' && `Đã đăng (${tasks.filter(t => t.status === 'published' || t.youtube_url).length})`}
                {st === 'scheduled' && `Hẹn giờ (${tasks.filter(t => t.status === 'scheduled').length})`}
                {st === 'failed' && `Lỗi (${tasks.filter(t => t.status === 'failed' || t.error).length})`}
              </button>
            ))}
          </div>
        </div>

        <button
          type="button"
          className="chrome-button"
          onClick={loadTasks}
          disabled={loading}
          style={{ minHeight: 34, height: 34, padding: '0 12px', fontSize: 12 }}
        >
          <RefreshCw size={13} className={loading ? 'spin' : ''} />
          {loading ? 'Đang tải...' : 'Làm mới'}
        </button>
      </div>

      {/* Task List */}
      {loading && tasks.length === 0 ? (
        <div style={{ padding: '30px 0', textAlign: 'center', color: '#64748b', fontSize: 13 }}>
          <Loader2 size={20} className="spin" style={{ margin: '0 auto 8px', display: 'block' }} />
          Đang tải lịch sử xuất bản YouTube...
        </div>
      ) : filteredTasks.length === 0 ? (
        <div
          style={{
            padding: '40px 20px',
            textAlign: 'center',
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            color: '#64748b',
          }}
        >
          <YouTubeBrandIcon size={32} />
          <strong style={{ display: 'block', fontSize: 14, color: '#334155', marginBottom: 4 }}>
            Chưa có bài đăng YouTube nào
          </strong>
          <span style={{ fontSize: 12 }}>
            Khi bạn bấm <strong>“Đăng YouTube”</strong> trên video Studio hoặc Lịch sử, tiến trình tải lên sẽ xuất hiện tại đây.
          </span>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {filteredTasks.map(t => {
            const isDone = t.status === 'published' || Boolean(t.youtube_url)
            const isFailed = t.status === 'failed' || Boolean(t.error)
            const isScheduled = t.status === 'scheduled'

            return (
              <div
                key={t.task_id}
                style={{
                  background: '#fff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 10,
                  padding: '14px 16px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 14,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 8,
                      background: isDone ? '#fee2e2' : isFailed ? '#fef2f2' : '#f1f5f9',
                      color: isDone ? '#dc2626' : isFailed ? '#ef4444' : '#64748b',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <YouTubeBrandIcon size={22} />
                  </div>

                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                      <strong
                        style={{
                          fontSize: 13.5,
                          color: '#0f172a',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          maxWidth: '70%',
                        }}
                        title={t.title}
                      >
                        {t.title || 'Video YouTube không tên'}
                      </strong>

                      {/* Status badge */}
                      {isDone ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: '#16a34a',
                            background: '#dcfce7',
                            padding: '2px 7px',
                            borderRadius: 6,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          <CheckCircle2 size={11} /> Đã đăng
                        </span>
                      ) : isScheduled ? (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: '#0284c7',
                            background: '#e0f2fe',
                            padding: '2px 7px',
                            borderRadius: 6,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          <Clock3 size={11} /> Hẹn giờ
                        </span>
                      ) : (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 700,
                            color: '#dc2626',
                            background: '#fee2e2',
                            padding: '2px 7px',
                            borderRadius: 6,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 3,
                          }}
                        >
                          <AlertCircle size={11} /> Thất bại
                        </span>
                      )}

                      {/* Privacy Badge */}
                      {t.privacy_status && (
                        <span
                          style={{
                            fontSize: 10,
                            fontWeight: 600,
                            color: '#475569',
                            background: '#f1f5f9',
                            padding: '2px 6px',
                            borderRadius: 6,
                          }}
                        >
                          {t.privacy_status === 'public' ? 'Công khai' : t.privacy_status === 'unlisted' ? 'Không công khai' : 'Riêng tư'}
                        </span>
                      )}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 11, color: '#64748b' }}>
                      {t.channel_title && <span>Kênh: <strong>{t.channel_title}</strong></span>}
                      {t.created_at && (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                          <Calendar size={11} /> {t.created_at.split('T')[0]}
                        </span>
                      )}
                      {t.video_id && <span>Video ID: <code>{t.video_id}</code></span>}
                    </div>

                    {t.error && (
                      <p style={{ margin: '4px 0 0', fontSize: 11, color: '#dc2626' }}>
                        Lỗi: {t.error}
                      </p>
                    )}
                  </div>
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  {t.youtube_url && (
                    <>
                      <a
                        href={t.youtube_url}
                        target="_blank"
                        rel="noreferrer"
                        className="chrome-button"
                        style={{ minHeight: 28, height: 28, padding: '0 8px', fontSize: 11, gap: 4 }}
                        title="Mở xem trên YouTube"
                      >
                        <ExternalLink size={12} /> Xem video
                      </a>
                      <button
                        type="button"
                        className="chrome-button"
                        onClick={() => copyLink(t.youtube_url!, t.task_id)}
                        style={{ minHeight: 28, height: 28, padding: '0 8px', fontSize: 11, gap: 4 }}
                        title="Sao chép link YouTube"
                      >
                        {copiedId === t.task_id ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                        {copiedId === t.task_id ? 'Đã chép' : 'Chép link'}
                      </button>
                    </>
                  )}

                  <button
                    type="button"
                    className="mtm-btn-del"
                    onClick={() => handleDelete(t.task_id)}
                    disabled={deletingId === t.task_id}
                    title="Xóa bản ghi lịch sử này"
                    style={{ padding: '6px 8px' }}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
