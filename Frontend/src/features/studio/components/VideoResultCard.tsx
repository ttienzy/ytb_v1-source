import { useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Film,
  Music,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { BackendCaption } from '../types'
import { FacebookPublishModal } from './FacebookPublishModal'
import { YouTubePublishModal } from './YouTubePublishModal'

function FacebookIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function TikTokIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.5 6.31 6.31 0 0 0 1.86-4.49V8.62a8.16 8.16 0 0 0 4.91 1.63v-3.56z"/>
    </svg>
  )
}

function YouTubeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/>
    </svg>
  )
}



export function VideoResultCard({
  jobId,
  variant,
  segments,
  scenes,
  overspeedCount,
  credits,
  caption,
  pippitTasks,
  youtubeTasks,
  onReset,
  compact,
}: {
  jobId: string
  variant: 'polished' | 'merged'
  segments: number
  scenes: number
  overspeedCount?: number | null
  credits?: string | null
  caption?: BackendCaption | null
  pippitTasks?: any[]
  youtubeTasks?: any[]
  onReset?: () => void
  compact?: boolean
}) {

  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedTitle, setCopiedTitle] = useState(false)
  const [showPublishModal, setShowPublishModal] = useState(false)
  const [showYouTubeModal, setShowYouTubeModal] = useState(false)


  const polished = variant === 'polished'
  const endpoint = polished ? 'studio' : 'final'
  const filename = polished ? 'final_studio.mp4' : 'final_recap.mp4'
  const Icon = polished ? Music : Film
  const subtitle = polished
    ? `${segments} đoạn · ${scenes} cảnh · 1080p · VO Việt + BGM`
    : `${segments} đoạn · ${scenes} cảnh · 1080p · VO Việt`
  const src = `${API_URL}/api/recap/jobs/${jobId}/${endpoint}`

  const fbTasks = (pippitTasks || []).filter((t: any) => t.platform !== 'tiktok')
  const ttTasks = (pippitTasks || []).filter((t: any) => t.platform === 'tiktok')
  const ytTasks = youtubeTasks || []

  const hasCaption = Boolean(
    caption &&
      (caption.title ||
        caption.description ||
        (Array.isArray(caption.hashtags) && caption.hashtags.length > 0))
  )

  function getFullCaptionText(): string {
    if (!caption) return ''
    const parts: string[] = []
    if (caption.title) parts.push(String(caption.title).trim())
    if (caption.description) parts.push(String(caption.description).trim())
    if (Array.isArray(caption.hashtags) && caption.hashtags.length > 0) {
      parts.push(
        caption.hashtags
          .map(h => (String(h).startsWith('#') ? String(h) : `#${String(h)}`))
          .join(' ')
      )
    }
    return parts.join('\n\n')
  }


  async function copyAllCaption() {
    const text = getFullCaptionText()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopiedAll(true)
      setTimeout(() => setCopiedAll(false), 2000)
    } catch {
      /* fallback */
    }
  }

  async function copyTitleOnly() {
    if (!caption?.title) return
    try {
      await navigator.clipboard.writeText(caption.title.trim())
      setCopiedTitle(true)
      setTimeout(() => setCopiedTitle(false), 2000)
    } catch {
      /* fallback */
    }
  }

  return (
    <div className={`vrc${compact ? ' vrc-compact' : ''}`}>
      <div className="vrc-player">
        <video
          className="vrc-video"
          src={src}
          controls
          preload="metadata"
          playsInline
        />
        <div className="vrc-badge">
          <Icon size={13} /> {filename}
        </div>
      </div>
      <div className="vrc-side">
        <div className="vrc-status">
          <CheckCircle2 size={18} />
          <div>
            <strong>{filename} ✓</strong>
            <span className="meta">{subtitle}</span>
          </div>
        </div>
        {overspeedCount && overspeedCount > 0 && (
          <p className="vrc-warn">
            <AlertCircle size={13} /> {overspeedCount} đoạn VO ngắn — xem lịch sử
            dể nghe thử
          </p>
        )}

        {/* ── Status Banners for Multi-Platform Publishing ── */}
        {fbTasks.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: '#e0f2fe',
              color: '#0369a1',
              border: '1px solid #bae6fd',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <FacebookIcon size={14} />
            <span>
              Đã đăng Facebook ({fbTasks.length} lần): <strong>{fbTasks.map(t => t.page_name || t.page_id).join(', ')}</strong>
            </span>
          </div>
        )}

        {ttTasks.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: '#f8fafc',
              color: '#0f172a',
              border: '1px solid #cbd5e1',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <TikTokIcon size={14} />
            <span>
              Đã đăng TikTok ({ttTasks.length} lần): <strong>{ttTasks.map(t => t.page_name || t.page_id).join(', ')}</strong>
            </span>
          </div>
        )}

        {ytTasks.length > 0 && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 12px',
              background: '#fee2e2',
              color: '#dc2626',
              border: '1px solid #fecaca',
              borderRadius: 8,
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            <YouTubeIcon size={14} />
            <span>
              Đã đăng YouTube ({ytTasks.length} lần): <strong>{ytTasks.map(t => t.channel_title || t.title || t.video_id).join(', ')}</strong>
            </span>
          </div>
        )}

        <div className="vrc-actions" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <a className="btn-p vrc-dl" href={src} download={filename}>
            <Download size={14} /> Tải về
          </a>

          {/* Đăng Facebook */}
          <button
            type="button"
            className="btn-fb-publish"
            onClick={() => setShowPublishModal(true)}
            style={{
              background: '#1877f2',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '0 12px',
              minHeight: 34,
              fontSize: 12,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
            title="Đăng video lên Facebook Fanpage qua Pippit"
          >
            <FacebookIcon size={14} /> {fbTasks.length > 0 ? `Đã đăng FB (${fbTasks.length})` : 'Đăng Facebook'}
          </button>

          {/* Đăng TikTok */}
          <button
            type="button"
            className="btn-tiktok-publish"
            onClick={() => setShowPublishModal(true)}
            style={{
              background: '#0f172a',
              color: '#fff',
              border: '1px solid #334155',
              borderRadius: 8,
              padding: '0 12px',
              minHeight: 34,
              fontSize: 12,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
            title="Đăng video lên kênh TikTok qua Pippit"
          >
            <TikTokIcon size={14} /> {ttTasks.length > 0 ? `Đã đăng TikTok (${ttTasks.length})` : 'Đăng TikTok'}
          </button>

          {/* Đăng YouTube */}
          <button
            type="button"
            className="btn-yt-publish"
            onClick={() => setShowYouTubeModal(true)}
            style={{
              background: '#dc2626',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '0 12px',
              minHeight: 34,
              fontSize: 12,
              fontWeight: 600,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              cursor: 'pointer',
            }}
            title="Tải video lên kênh YouTube (Google OAuth)"
          >
            <YouTubeIcon size={14} /> {ytTasks.length > 0 ? `Đã đăng YT (${ytTasks.length})` : 'Đăng YouTube'}
          </button>

          {onReset && (
            <button type="button" className="btn-g" onClick={onReset}>
              <Trash2 size={14} /> Bắt đầu lại
            </button>
          )}
        </div>

        {/* ── AI Caption Box ── */}
        {hasCaption && caption && (
          <div className="vrc-caption">
            <div className="vrc-caption-hdr">
              <div className="vrc-caption-title-wrap">
                <FileText size={14} /> Caption &amp; Tiêu đề đăng bài
              </div>
              {caption.title && (
                <button
                  type="button"
                  className={`caption-btn-sm${copiedTitle ? ' copied' : ''}`}
                  onClick={copyTitleOnly}
                  title="Sao chép tiêu đề"
                >
                  {copiedTitle ? <Check size={11} /> : <Copy size={11} />}
                  {copiedTitle ? 'Đã chép title' : 'Chép title'}
                </button>
              )}
            </div>

            {caption.title && (
              <p className="caption-title-text">{caption.title}</p>
            )}

            {caption.description && (
              <p className="caption-desc-text">{caption.description}</p>
            )}

            {caption.hashtags && caption.hashtags.length > 0 && (
              <div className="caption-tags">
                {caption.hashtags.map((tag, idx) => (
                  <span key={idx} className="caption-tag">
                    {tag.startsWith('#') ? tag : `#${tag}`}
                  </span>
                ))}
              </div>
            )}

            <button
              type="button"
              className={`caption-copy-all${copiedAll ? ' copied' : ''}`}
              onClick={copyAllCaption}
            >
              {copiedAll ? <Check size={14} /> : <Copy size={14} />}
              {copiedAll ? 'Đã sao chép toàn bộ Caption!' : 'Sao chép toàn bộ Caption'}
            </button>
          </div>
        )}

        {/* ── BGM Credit Box (nếu có) ── */}
        {credits && (
          <div className="vrc-credit">
            <div className="vrc-credit-hdr">
              <Sparkles size={14} /> Credit nhạc — dán vào mô tả YouTube
            </div>
            <textarea
              readOnly
              value={credits}
              rows={4}
              onClick={e => (e.target as HTMLTextAreaElement).select()}
            />
          </div>
        )}
      </div>

      {/* ── Facebook / TikTok Publish Modal (Pippit) ── */}
      {showPublishModal && (
        <FacebookPublishModal
          jobId={jobId}
          caption={caption}
          pippitTasks={pippitTasks}
          onClose={() => setShowPublishModal(false)}
        />
      )}

      {/* ── YouTube Publish Modal ── */}
      {showYouTubeModal && (
        <YouTubePublishModal
          jobId={jobId}
          caption={caption}
          onClose={() => setShowYouTubeModal(false)}
        />
      )}
    </div>
  )
}
