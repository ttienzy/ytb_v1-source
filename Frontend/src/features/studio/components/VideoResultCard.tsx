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

function FacebookIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
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
  onReset?: () => void
  compact?: boolean
}) {

  const [copiedAll, setCopiedAll] = useState(false)
  const [copiedTitle, setCopiedTitle] = useState(false)
  const [showPublishModal, setShowPublishModal] = useState(false)


  const polished = variant === 'polished'
  const endpoint = polished ? 'studio' : 'final'
  const filename = polished ? 'final_studio.mp4' : 'final_recap.mp4'
  const Icon = polished ? Music : Film
  const subtitle = polished
    ? `${segments} đoạn · ${scenes} cảnh · 1080p · VO Việt + BGM`
    : `${segments} đoạn · ${scenes} cảnh · 1080p · VO Việt`
  const src = `${API_URL}/api/recap/jobs/${jobId}/${endpoint}`

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
        {pippitTasks && pippitTasks.length > 0 && (
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
              Đã đăng FB ({pippitTasks.length} lần): <strong>{pippitTasks.map(t => t.page_name || t.page_id).join(', ')}</strong>
            </span>
          </div>
        )}
        <div className="vrc-actions">
          <a className="btn-p vrc-dl" href={src} download={filename}>
            <Download size={14} /> Tải về
          </a>
          <button
            type="button"
            className="btn-fb-publish"
            onClick={() => setShowPublishModal(true)}
            style={
              pippitTasks && pippitTasks.length > 0
                ? { background: '#f8fafc', color: '#1877f2', border: '1px solid #94a3b8' }
                : undefined
            }
            title={
              pippitTasks && pippitTasks.length > 0
                ? `Video này đã được đăng lên: ${pippitTasks.map(t => t.page_name || t.page_id).join(', ')}. Bấm nếu muốn đăng tiếp lên Page khác.`
                : 'Đăng video trực tiếp lên Facebook Fanpage qua Pippit'
            }
          >
            <FacebookIcon size={14} /> {pippitTasks && pippitTasks.length > 0 ? 'Đã đăng FB (Đăng thêm)' : 'Đăng Facebook'}
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

      {/* ── Facebook Publish Modal ── */}
      {showPublishModal && (
        <FacebookPublishModal
          jobId={jobId}
          caption={caption}
          pippitTasks={pippitTasks}
          onClose={() => setShowPublishModal(false)}
        />
      )}
    </div>
  )
}
