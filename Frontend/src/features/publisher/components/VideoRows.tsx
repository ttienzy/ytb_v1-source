import { useState } from 'react'
import { ExternalLink, FileVideo, Play, Sparkles } from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import { fmtBytes } from '../../../shared/utils/formatters'
import { displayTitle } from '../captionUtils'
import { isPostedToTarget, type TargetChannelRef } from '../scheduleChecks'
import type { PublishableVideo } from '../types'
import { formatDuration } from '../videoModel'
import { PlatformIcon } from './PlatformIcons'

export function isPostedToAny(video: PublishableVideo, targets: TargetChannelRef[]): boolean {
  if (targets.length === 0) return video.published_channels.length > 0
  return targets.some(t => isPostedToTarget(video.published_channels, t))
}

export function PublishedBadges({ video, targets }: { video: PublishableVideo; targets: TargetChannelRef[] }) {
  if (video.published_channels.length === 0) return <span className="pub2-badge pub2-badge-new">🆕 Chưa đăng</span>
  return (
    <>
      {video.published_channels.map((c, i) => {
        const hit = targets.some(t => isPostedToTarget([c], t))
        return (
          <span key={i} className={`pub2-badge pub2-badge-${c.platform} ${hit ? 'pub2-badge-hit' : ''}`} title={`Đã lên lịch ${c.platform}: ${c.channel_name}`}>
            <PlatformIcon platform={c.platform} size={10} />
            {c.channel_name}
          </span>
        )
      })}
    </>
  )
}

export function VideoRow({
  video,
  selected,
  targets,
  onToggle,
}: {
  video: PublishableVideo
  selected: boolean
  targets: TargetChannelRef[]
  onToggle: () => void
}) {
  const [playing, setPlaying] = useState(false)
  const posted = isPostedToAny(video, targets)
  const name = displayTitle(video) || video.title || video.file_name
  return (
    <div className={`pub-video-card-item ${selected ? 'pub-video-card-selected' : ''}`} onClick={onToggle}>
      <input type="checkbox" checked={selected} onChange={() => undefined} className="pub-video-custom-checkbox" aria-label={`Chọn ${name}`} />
      <div className="pub-video-thumb-icon">
        <FileVideo size={18} />
        <span className="pub-video-dur-tag">{formatDuration(video.duration_seconds)}</span>
      </div>
      <div className="pub-video-details">
        <div className="pub2-row-top">
          <strong className="pub-video-clean-title" title={name}>{name}</strong>
          {posted && video.published_channels.length > 0 && (
            <span className="pub2-badge pub2-badge-warn" title="Video này đã được đăng / lên lịch lên kênh đang chọn">⚠️ Đã có trên kênh</span>
          )}
        </div>
        <div className="pub-video-sub-line">
          {video.label && <span className="pub2-badge pub2-badge-src">{video.label}</span>}
          <span className="pub-video-raw-filename">{video.file_name}</span>
          <span className="pub-dot-sep">•</span>
          <span className="pub-video-size-txt">{fmtBytes(video.size_bytes)}</span>
        </div>
        <div className="pub2-row-badges">
          <PublishedBadges video={video} targets={targets} />
          {video.default_caption && (
            <span className="pub2-badge pub2-badge-cap" title="Nguồn đã có sẵn caption, sẽ tự điền khi chọn chế độ “Tự kéo từ nguồn”">
              <Sparkles size={9} /> Có caption
            </span>
          )}
        </div>
        {playing && video.preview_url && (
          <video className="pub2-inline-player" controls autoPlay preload="metadata" src={`${API_URL}${video.preview_url}`} onClick={e => e.stopPropagation()} />
        )}
      </div>
      {video.preview_url && (
        <button
          type="button"
          className="pub-video-link-btn"
          title={playing ? 'Ẩn video' : 'Xem nhanh video'}
          onClick={e => {
            e.stopPropagation()
            setPlaying(p => !p)
          }}
        >
          <Play size={13} />
        </button>
      )}
      {video.web_view_link && (
        <a href={video.web_view_link} target="_blank" rel="noreferrer" className="pub-video-link-btn" onClick={e => e.stopPropagation()} title="Xem trên Google Drive ↗">
          <ExternalLink size={13} />
        </a>
      )}
    </div>
  )
}

export type PostedFilter = 'all' | 'unposted'

export function SelectionBar({
  total,
  selectedInList,
  selectedTotal,
  onToggleAll,
  onSelectUnposted,
}: {
  total: number
  selectedInList: number
  selectedTotal: number
  onToggleAll: () => void
  onSelectUnposted: () => void
}) {
  return (
    <div className="pub2-selection-bar">
      <label className="pub-checkbox-label">
        <input type="checkbox" checked={total > 0 && selectedInList === total} onChange={onToggleAll} disabled={total === 0} />
        <span>Chọn tất cả ({total})</span>
      </label>
      <div className="pub2-selection-actions">
        <button type="button" className="pub2-mini-btn" onClick={onSelectUnposted} title="Chỉ chọn video chưa đăng lên kênh đang chọn ở Bước 2">
          <Sparkles size={11} color="#6366f1" /> Chọn video chưa đăng
        </button>
        <span className="pub-selected-pill">
          Đã chọn: <strong>{selectedTotal}</strong>
        </span>
      </div>
    </div>
  )
}

export function FilterPills<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: { id: T; label: string }[]
  onChange: (v: T) => void
}) {
  return (
    <div className="pub2-pills">
      {options.map(o => (
        <button key={o.id} type="button" className={`pub2-pill ${value === o.id ? 'pub2-pill-active' : ''}`} onClick={() => onChange(o.id)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}
