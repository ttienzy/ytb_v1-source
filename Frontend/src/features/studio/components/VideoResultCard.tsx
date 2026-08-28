import {
  AlertCircle,
  CheckCircle2,
  Download,
  Film,
  Music,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'

export function VideoResultCard({
  jobId,
  variant,
  segments,
  scenes,
  overspeedCount,
  credits,
  onReset,
  compact,
}: {
  jobId: string
  variant: 'polished' | 'merged'
  segments: number
  scenes: number
  overspeedCount?: number | null
  credits?: string | null
  onReset?: () => void
  compact?: boolean
}) {
  const polished = variant === 'polished'
  const endpoint = polished ? 'studio' : 'final'
  const filename = polished ? 'final_studio.mp4' : 'final_recap.mp4'
  const Icon = polished ? Music : Film
  const subtitle = polished
    ? `${segments} đoạn · ${scenes} cảnh · 1080p · VO Việt + BGM`
    : `${segments} đoạn · ${scenes} cảnh · 1080p · VO Việt`
  const src = `${API_URL}/api/recap/jobs/${jobId}/${endpoint}`

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
