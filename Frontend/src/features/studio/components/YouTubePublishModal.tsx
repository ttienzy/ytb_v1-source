import React, { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Calendar,
  Check,
  CheckCircle2,
  Clock,
  ExternalLink,
  Globe,
  Lock,
  Radio,
  Sparkles,
  Tag,
  Tv,
  Video,
  X,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import { YouTubeBrandIcon } from '../../settings/components/YouTubeSection'
import type { BackendCaption } from '../types'

interface YouTubePublishModalProps {
  jobId: string
  caption?: BackendCaption | null
  onClose: () => void
  onSuccess?: () => void
}

interface YouTubeStatus {
  connected: boolean
  channel_id?: string
  channel_title?: string
  channel_custom_url?: string
  channel_avatar_url?: string
  subscriber_count?: number
  default_privacy?: string
  default_tags?: string
}

interface CategoryItem {
  id: string
  title: string
}

export function YouTubePublishModal({
  jobId,
  caption,
  onClose,
  onSuccess,
}: YouTubePublishModalProps) {
  const [ytStatus, setYtStatus] = useState<YouTubeStatus | null>(null)
  const [loadingStatus, setLoadingStatus] = useState(true)
  const [categories, setCategories] = useState<CategoryItem[]>([])

  // Form Inputs
  const titlePart = caption?.title ? String(caption.title).trim() : ''
  const descPart = caption?.description ? String(caption.description).trim() : ''
  const [title, setTitle] = useState(titlePart || `Video Recap ${jobId}`)

  const hashtagsArray = Array.isArray(caption?.hashtags)
    ? caption.hashtags.map(t => (String(t).startsWith('#') ? String(t) : `#${String(t)}`))
    : []

  const hashtagsStr = hashtagsArray.join(' ')
  const initialDesc = [descPart, hashtagsStr].filter(Boolean).join('\n\n')
  const [description, setDescription] = useState(initialDesc)

  const defaultTagsStr = hashtagsArray
    .map(h => h.replace(/^#/, ''))
    .filter(Boolean)
    .join(', ')
  const [tags, setTags] = useState(defaultTagsStr)

  const [privacy, setPrivacy] = useState<'public' | 'unlisted' | 'private'>('public')
  const [categoryId, setCategoryId] = useState<string>('22') // 22: People & Blogs

  // Scheduling
  const [timing, setTiming] = useState<'now' | 'custom'>('now')
  const [scheduleMinutes, setScheduleMinutes] = useState<number>(15)

  // State
  const [publishing, setPublishing] = useState(false)
  const [successData, setSuccessData] = useState<{
    task_id?: string
    video_id?: string
    youtube_url?: string
    message?: string
  } | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function loadInfo() {
      setLoadingStatus(true)
      try {
        const [statusRes, catRes] = await Promise.all([
          fetch(`${API_URL}/api/youtube/status`),
          fetch(`${API_URL}/api/youtube/categories`).catch(() => null),
        ])
        if (statusRes.ok) {
          const s = await statusRes.json()
          setYtStatus(s)
          if (s.default_privacy) {
            setPrivacy(s.default_privacy)
          }
        }
        if (catRes && catRes.ok) {
          const c = await catRes.json()
          if (Array.isArray(c) && c.length > 0) {
            setCategories(c)
          }
        }
      } catch (err: any) {
        setError('Không thể kết nối đến YouTube API service.')
      } finally {
        setLoadingStatus(false)
      }
    }
    loadInfo()
  }, [])

  async function handlePublish(e: React.FormEvent) {
    e.preventDefault()
    if (!ytStatus?.connected) {
      setError('Vui lòng vào Cài đặt → Kênh YouTube để kết nối tài khoản Google trước khi đăng video.')
      return
    }
    if (!title.trim()) {
      setError('Tiêu đề video YouTube không được để trống.')
      return
    }

    setPublishing(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/recap/jobs/${jobId}/publish-youtube`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: description.trim(),
          tags: tags.trim(),
          privacy_status: privacy,
          category_id: categoryId,
          when_minutes_ahead: timing === 'custom' ? scheduleMinutes : 0,
        }),
      })

      const data = await res.json()
      if (!res.ok) {
        throw new Error(data?.detail || 'Đăng video lên YouTube thất bại.')
      }

      setSuccessData(data)
      if (onSuccess) onSuccess()
    } catch (err: any) {
      setError(err?.message || 'Lỗi khi tải video lên YouTube.')
    } finally {
      setPublishing(false)
    }
  }

  return (
    <div className="mtm-modal-backdrop" onClick={onClose}>
      <div
        className="mtm-modal-card"
        style={{ maxWidth: 580, padding: '20px 24px' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 16,
            borderBottom: '1px solid #f1f5f9',
            paddingBottom: 14,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: '#fee2e2',
                color: '#dc2626',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <YouTubeBrandIcon size={20} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
                Đăng Video Lên YouTube
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                Tải trực tiếp video hoàn thiện lên kênh YouTube của bạn
              </p>
            </div>
          </div>
          <button
            type="button"
            className="mtm-btn-close"
            onClick={onClose}
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#94a3b8' }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Channel Status Banner */}
        <div
          style={{
            background: ytStatus?.connected ? '#f0fdf4' : '#fffbeb',
            border: `1px solid ${ytStatus?.connected ? '#bbf7d0' : '#fde68a'}`,
            borderRadius: 10,
            padding: '10px 14px',
            marginBottom: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {loadingStatus ? (
            <span style={{ fontSize: 12, color: '#64748b' }}>Đang kiểm tra kết nối kênh YouTube...</span>
          ) : ytStatus?.connected ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {ytStatus.channel_avatar_url ? (
                <img
                  src={ytStatus.channel_avatar_url}
                  alt=""
                  style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover' }}
                />
              ) : (
                <Tv size={18} style={{ color: '#16a34a' }} />
              )}
              <div>
                <strong style={{ fontSize: 13, color: '#14532d', display: 'block' }}>
                  {ytStatus.channel_title || 'Kênh YouTube'}
                </strong>
                <span style={{ fontSize: 11, color: '#16a34a' }}>
                  Đã kết nối Google OAuth • {ytStatus.subscriber_count ?? 0} người đăng ký
                </span>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <AlertCircle size={16} style={{ color: '#b45309', flexShrink: 0 }} />
              <span style={{ fontSize: 12, color: '#b45309' }}>
                Chưa kết nối tài khoản YouTube. Vui lòng vào <strong>Cài đặt → Kênh YouTube</strong> để đăng nhập.
              </span>
            </div>
          )}
        </div>

        {/* Success Screen */}
        {successData ? (
          <div style={{ textAlign: 'center', padding: '16px 8px' }}>
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: '50%',
                background: '#dcfce7',
                color: '#16a34a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
              }}
            >
              <CheckCircle2 size={30} />
            </div>
            <h4 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              Tải Lên YouTube Thành Công!
            </h4>
            <p style={{ margin: '0 0 16px', fontSize: 12.5, color: '#64748b', lineHeight: 1.5 }}>
              {successData.message || 'Video đã được gửi tới YouTube Data API.'}
            </p>

            {successData.youtube_url && (
              <a
                href={successData.youtube_url}
                target="_blank"
                rel="noreferrer"
                className="chrome-button"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  background: '#dc2626',
                  color: '#fff',
                  padding: '8px 16px',
                  borderRadius: 8,
                  textDecoration: 'none',
                  fontSize: 13,
                  fontWeight: 600,
                  marginBottom: 16,
                }}
              >
                <ExternalLink size={14} /> Mở xem video trên YouTube
              </a>
            )}

            <div style={{ marginTop: 12 }}>
              <button
                type="button"
                className="chrome-button"
                style={{ minHeight: 36, padding: '0 20px', fontSize: 12 }}
                onClick={onClose}
              >
                Hoàn tất & Đóng
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handlePublish}>
            {error && (
              <div
                style={{
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 8,
                  padding: '10px 12px',
                  fontSize: 12,
                  color: '#991b1b',
                  marginBottom: 14,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <AlertCircle size={14} style={{ flexShrink: 0 }} />
                <span>{error}</span>
              </div>
            )}

            {/* Tiêu đề */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 5, color: '#334155' }}>
                Tiêu đề video YouTube <span style={{ color: '#dc2626' }}>*</span>
              </label>
              <input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Nhập tiêu đề video (tối đa 100 ký tự)..."
                maxLength={100}
                style={{
                  width: '100%',
                  height: 38,
                  padding: '0 10px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: 12.5,
                  outline: 'none',
                }}
              />
            </div>

            {/* Mô tả */}
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 5, color: '#334155' }}>
                Mô tả video (Description)
              </label>
              <textarea
                value={description}
                onChange={e => setDescription(e.target.value)}
                placeholder="Nhập mô tả, lời cảm ơn, hashtag..."
                rows={4}
                style={{
                  width: '100%',
                  padding: '8px 10px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  fontSize: 12,
                  lineHeight: 1.5,
                  outline: 'none',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* Tags & Danh mục */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14 }}>
              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 5, color: '#334155' }}>
                  Thẻ Tags (cách nhau bằng dấu phẩy)
                </label>
                <input
                  value={tags}
                  onChange={e => setTags(e.target.value)}
                  placeholder="review am thuc, food review, ẩm thực..."
                  style={{
                    width: '100%',
                    height: 36,
                    padding: '0 10px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 12,
                    outline: 'none',
                  }}
                />
              </div>

              <div>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 5, color: '#334155' }}>
                  Chế độ hiển thị
                </label>
                <select
                  value={privacy}
                  onChange={e => setPrivacy(e.target.value as any)}
                  style={{
                    width: '100%',
                    height: 36,
                    padding: '0 10px',
                    borderRadius: 8,
                    border: '1px solid #cbd5e1',
                    fontSize: 12,
                    fontWeight: 600,
                    outline: 'none',
                    background: '#fff',
                  }}
                >
                  <option value="public">🌐 Công khai (Public)</option>
                  <option value="unlisted">🔗 Không công khai (Unlisted)</option>
                  <option value="private">🔒 Riêng tư (Private)</option>
                </select>
              </div>
            </div>

            {/* Lịch phát hành */}
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 700, marginBottom: 6, color: '#334155' }}>
                Thời điểm xuất bản
              </label>
              <div style={{ display: 'flex', gap: 10 }}>
                <button
                  type="button"
                  onClick={() => setTiming('now')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: timing === 'now' ? '2px solid #dc2626' : '1px solid #e2e8f0',
                    background: timing === 'now' ? '#fef2f2' : '#fff',
                    color: timing === 'now' ? '#dc2626' : '#64748b',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <Radio size={13} /> Tải lên &amp; Đăng ngay
                </button>
                <button
                  type="button"
                  onClick={() => setTiming('custom')}
                  style={{
                    flex: 1,
                    padding: '8px 12px',
                    borderRadius: 8,
                    border: timing === 'custom' ? '2px solid #dc2626' : '1px solid #e2e8f0',
                    background: timing === 'custom' ? '#fef2f2' : '#fff',
                    color: timing === 'custom' ? '#dc2626' : '#64748b',
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                  }}
                >
                  <Clock size={13} /> Hẹn giờ đăng (+{scheduleMinutes}p)
                </button>
              </div>
            </div>

            {/* Actions */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: 10,
                borderTop: '1px solid #f1f5f9',
                paddingTop: 14,
              }}
            >
              <button
                type="button"
                onClick={onClose}
                className="chrome-button"
                style={{ minHeight: 36, padding: '0 14px', fontSize: 12 }}
                disabled={publishing}
              >
                Hủy
              </button>
              <button
                type="submit"
                disabled={publishing || !ytStatus?.connected}
                style={{
                  minHeight: 36,
                  padding: '0 18px',
                  fontSize: 12.5,
                  fontWeight: 600,
                  borderRadius: 8,
                  border: 'none',
                  background: ytStatus?.connected ? '#dc2626' : '#94a3b8',
                  color: '#fff',
                  cursor: ytStatus?.connected && !publishing ? 'pointer' : 'not-allowed',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <YouTubeBrandIcon size={15} />
                {publishing ? 'Đang tải lên YouTube...' : 'Đăng Lên YouTube'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
