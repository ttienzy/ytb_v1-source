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

export function VideoResultCard({
  jobId,
  variant,
  segments,
  scenes,
  overspeedCount,
  credits,
  caption,
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
  onReset?: () => void
  compact?: boolean
}) {
  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedTitle, setCopiedTitle] = useState(false)

  const polished = variant === 'polished'
  const endpoint = polished ? 'studio' : 'final'
  const filename = polished ? 'final_studio.mp4' : 'final_recap.mp4'
  const Icon = polished ? Music : Film
  const subtitle = polished
    ? `${segments} đoạn · ${scenes} cảnh · 1080p · VO Việt + BGM`
    : `${segments} đoạn · ${scenes} cảnh · 1080p · VO Việt`
  const src = `${API_URL}/api/recap/jobs/${jobId}/${endpoint}`

  const hasCaption = Boolean(
    caption && (caption.title || caption.description || caption.hashtags?.length)
  )

  function getFullCaptionText(): string {
    if (!caption) return ''
    const parts: string[] = []
    if (caption.title) parts.push(caption.title.trim())
    if (caption.description) parts.push(caption.description.trim())
    if (caption.hashtags && caption.hashtags.length > 0) {
      parts.push(
        caption.hashtags
          .map(h => (h.startsWith('#') ? h : `#${h}`))
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
            để nghe thử
          </p>
        )}
        <div className="vrc-actions">
          <a className="btn-p vrc-dl" href={src} download={filename}>
            <Download size={14} /> Tải về
          </a>
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
    </div>
  )
}
