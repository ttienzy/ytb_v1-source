import { useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, Copy, ExternalLink, Eye, FileVideo, MessageCircle, Play, Share2, ThumbsUp, X } from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import { fmtBytes } from '../../../shared/utils/formatters'
import { targetPlatform } from '../scheduleChecks'
import type { ActiveFacebookPage, CaptionOverride, ScheduleSlot } from '../types'
import { formatDuration } from '../videoModel'

interface Props {
  open: boolean
  slots: ScheduleSlot[]
  index: number
  activePages: ActiveFacebookPage[]
  onIndexChange: (i: number) => void
  onUpdateCaption: (uid: string, patch: CaptionOverride) => void
  onClose: () => void
}

function renderHashtagText(text: string) {
  return text.split('\n').map((line, lIdx) => (
    <p key={lIdx} style={{ margin: '0 0 6px 0' }}>
      {line.split(' ').map((word, wIdx) =>
        word.startsWith('#') ? (
          <span key={wIdx} className="fb-mock-hashtag">
            {word}{' '}
          </span>
        ) : (
          `${word} `
        ),
      )}
    </p>
  ))
}

export function PostPreviewModal({ open, slots, index, activePages, onIndexChange, onUpdateCaption, onClose }: Props) {
  const [copied, setCopied] = useState(false)
  const [editing, setEditing] = useState(false)

  if (!open || slots.length === 0) return null
  const safeIdx = Math.min(index, slots.length - 1)
  const slot = slots[safeIdx]
  if (!slot) return null

  const page = activePages.find(p => p.page_id === slot.page_id) || activePages[0]
  const plat = page ? targetPlatform(page) : 'facebook'
  const formattedDate = new Date(slot.schedule_time_ms).toLocaleString('vi-VN', {
    weekday: 'long',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })

  const copyCaption = () => {
    void navigator.clipboard.writeText(slot.caption)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const mediaBlock = slot.preview_url ? (
    <video key={slot.uid} className="pub2-preview-video" controls preload="metadata" src={`${API_URL}${slot.preview_url}`} />
  ) : (
    <div className="fb-mock-video-player">
      <div className="fb-mock-video-inner">
        <div className="fb-mock-play-circle"><Play size={24} fill="#ffffff" /></div>
        <div className="fb-mock-video-title-bar">
          <FileVideo size={13} />
          <span>{slot.title || slot.file_name}</span>
        </div>
        <div className="fb-mock-video-bottom-badges">
          <span className="fb-mock-dur-pill">⏱ {formatDuration(slot.duration_seconds)}</span>
          <span className="fb-mock-size-pill">{fmtBytes(slot.size_bytes)}</span>
          {slot.web_view_link && (
            <a href={slot.web_view_link} target="_blank" rel="noreferrer" className="fb-mock-hd-pill" style={{ color: '#fff', textDecoration: 'none' }}>
              Mở Drive <ExternalLink size={10} />
            </a>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <div className="modal-backdrop pub-preview-modal-backdrop" onClick={onClose}>
      <div className="pub-preview-modal" onClick={e => e.stopPropagation()}>
        <div className="pub-modal-header">
          <div className="pub-modal-title">
            <div className="pub-preview-icon-badge"><Eye size={18} /></div>
            <div>
              <h3>Xem trước bài đăng {plat === 'tiktok' ? 'TikTok' : 'Facebook'}</h3>
              <span className="pub-modal-subtitle">
                Hiển thị chính xác caption sẽ gửi lên Pippit · Nguồn: {slot.source_label || slot.source_type}
              </span>
            </div>
          </div>
          <button type="button" className="chrome-button pub-modal-close" onClick={onClose} title="Đóng"><X size={18} /></button>
        </div>

        <div className="pub-preview-nav-bar">
          <div className="pub-preview-nav-left">
            <button type="button" className="pub-preview-nav-btn" disabled={safeIdx === 0} onClick={() => onIndexChange(Math.max(0, safeIdx - 1))}>
              <ChevronLeft size={15} /> Video trước
            </button>
            <span className="pub-preview-slot-counter">
              Video <strong>{safeIdx + 1}</strong> / {slots.length}
            </span>
            <button type="button" className="pub-preview-nav-btn" disabled={safeIdx >= slots.length - 1} onClick={() => onIndexChange(Math.min(slots.length - 1, safeIdx + 1))}>
              Video sau <ChevronRight size={15} />
            </button>
          </div>
          <div className="pub-preview-slot-pills">
            {slots.map((s, idx) => (
              <button key={s.uid} type="button" className={`pub-preview-pill-btn ${idx === safeIdx ? 'pub-preview-pill-active' : ''}`} onClick={() => onIndexChange(idx)} title={s.title}>
                #{idx + 1}
              </button>
            ))}
          </div>
        </div>

        <div className="pub-preview-body">
          {plat === 'tiktok' ? (
            <div className="pub2-tt-mock">
              <div className="pub2-tt-video-wrap">{mediaBlock}</div>
              <div className="pub2-tt-overlay-info">
                <div className="pub2-tt-handle">
                  <strong>{page?.handle ? `@${page.handle}` : page?.page_name || 'TikTok'}</strong>
                  <span><Clock size={11} /> {formattedDate}</span>
                </div>
                {editing ? (
                  <textarea
                    rows={4}
                    className="pub-textarea"
                    value={slot.caption}
                    onChange={e => onUpdateCaption(slot.uid, { caption: e.target.value })}
                  />
                ) : (
                  <div className="pub2-tt-caption">{slot.caption.trim() ? renderHashtagText(slot.caption) : <em>(Caption trống)</em>}</div>
                )}
              </div>
            </div>
          ) : (
            <div className="fb-mock-card">
              <div className="fb-mock-header">
                <div className="fb-mock-author">
                  {page?.avatar_url ? (
                    <img src={page.avatar_url} alt="" className="fb-mock-avatar" />
                  ) : (
                    <div className="fb-mock-avatar-placeholder">{page?.page_name?.charAt(0) || 'F'}</div>
                  )}
                  <div className="fb-mock-author-info">
                    <div className="fb-mock-page-name-row">
                      <strong className="fb-mock-page-name">{page?.page_name || 'Facebook Page'}</strong>
                      <span className="fb-mock-dot">•</span>
                      <span className="fb-mock-follow">Theo dõi</span>
                    </div>
                    <div className="fb-mock-schedule-time">
                      <Clock size={11} />
                      <span>Lên lịch phát: {formattedDate}</span>
                    </div>
                  </div>
                </div>
              </div>

              <div className="fb-mock-caption-content">
                {editing ? (
                  <textarea
                    rows={4}
                    className="pub-textarea"
                    value={slot.caption}
                    onChange={e => onUpdateCaption(slot.uid, { caption: e.target.value })}
                  />
                ) : (
                  <div className="fb-mock-text">{slot.caption.trim() ? renderHashtagText(slot.caption) : <em>(Caption trống)</em>}</div>
                )}
              </div>

              <div className="fb-mock-media-wrap">{mediaBlock}</div>

              <div className="fb-mock-actions-bar">
                <button type="button" className="fb-mock-act-btn"><ThumbsUp size={14} /> Thích</button>
                <button type="button" className="fb-mock-act-btn"><MessageCircle size={14} /> Bình luận</button>
                <button type="button" className="fb-mock-act-btn"><Share2 size={14} /> Chia sẻ</button>
              </div>
            </div>
          )}
        </div>

        <div className="pub-modal-footer">
          <div className="pub-preview-footer-left" style={{ display: 'flex', gap: 8 }}>
            <button type="button" className="chrome-button pub-btn-copy-caption" onClick={copyCaption}>
              {copied ? <><Check size={13} style={{ color: '#16a34a' }} /> Đã sao chép!</> : <><Copy size={13} /> Sao chép Caption</>}
            </button>
            <button type="button" className="chrome-button" onClick={() => setEditing(v => !v)}>
              {editing ? 'Xong sửa' : 'Sửa caption ngay'}
            </button>
          </div>
          <div className="pub-modal-footer-btns">
            <button type="button" className="chrome-button" onClick={onClose}>Đóng xem trước</button>
          </div>
        </div>
      </div>
    </div>
  )
}
