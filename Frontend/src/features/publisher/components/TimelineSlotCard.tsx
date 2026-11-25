import { useState } from 'react'
import { AlertTriangle, Clock, Edit3, Eye, Loader2, RotateCcw, Share2, Sparkles } from 'lucide-react'
import { fmtBytes } from '../../../shared/utils/formatters'
import { FACEBOOK_CAPTION_SOFT_MAX, TIKTOK_CAPTION_MAX, getCaptionWarnings } from '../captionUtils'
import { channelLabel, targetPlatform } from '../scheduleChecks'
import { getSlotPeriodName, type ScheduleMode } from '../scheduleSlots'
import type { ActiveFacebookPage, CaptionOverride, ScheduleSlot } from '../types'
import { formatDuration, toLocalDatetimeInput } from '../videoModel'

interface Props {
  slot: ScheduleSlot
  index: number
  scheduleMode: ScheduleMode
  activePages: ActiveFacebookPage[]
  selectedPageIds: Set<string>
  isCustomTime: boolean
  isDuplicate: boolean
  override?: CaptionOverride
  isGeneratingOne: boolean
  onUpdatePage: (pageId: string) => void
  onUpdateTime: (iso: string) => void
  onAdjustTime: (deltaMinutes: number) => void
  onUpdateCaption: (patch: CaptionOverride) => void
  onResetCaption: () => void
  onRegenerateOne: () => void
  onPreview: () => void
}

export function TimelineSlotCard({
  slot,
  index,
  scheduleMode,
  activePages,
  selectedPageIds,
  isCustomTime,
  isDuplicate,
  override,
  isGeneratingOne,
  onUpdatePage,
  onUpdateTime,
  onAdjustTime,
  onUpdateCaption,
  onResetCaption,
  onRegenerateOne,
  onPreview,
}: Props) {
  const [editing, setEditing] = useState(false)
  const targetPage = activePages.find(p => p.page_id === slot.page_id)
  const plat = targetPage ? targetPlatform(targetPage) : 'facebook'
  const slotDate = new Date(slot.schedule_time_ms)
  const timeStr = `${String(slotDate.getHours()).padStart(2, '0')}:${String(slotDate.getMinutes()).padStart(2, '0')}`
  const periodInfo = getSlotPeriodName(timeStr)
  const warnings = getCaptionWarnings(slot.caption, plat, slot.size_bytes, slot.file_name)
  const hasOverride = override?.caption !== undefined || override?.title !== undefined
  const limit = plat === 'tiktok' ? TIKTOK_CAPTION_MAX : FACEBOOK_CAPTION_SOFT_MAX

  return (
    <div
      className={`pub-slot-card-detailed ${isCustomTime ? 'pub-slot-card-customized' : ''}${isDuplicate ? ' pub-slot-card-duplicate' : ''}`}
      data-slot-uid={slot.uid}
    >
      <div className="pub-slot-card-top-row">
        <div className="pub-slot-title-left">
          <span className="pub-slot-num-badge">#{index + 1}</span>
          {slot.source_label && <span className="pub2-badge pub2-badge-src">{slot.source_label}</span>}
          <strong className="pub-slot-detailed-title" title={slot.title || slot.file_name}>
            {slot.title || slot.file_name}
          </strong>
        </div>
        <div className="pub-slot-meta-right">
          {scheduleMode === 'golden_hours' && <span className="pub-slot-period-badge">{periodInfo}</span>}
          <span className="pub-slot-dur-chip">
            <Clock size={11} /> {formatDuration(slot.duration_seconds)}
          </span>
          <span className="pub-slot-size-txt">{fmtBytes(slot.size_bytes)}</span>
          {isDuplicate && (
            <span className="pub-slot-dup-tag" title="Video này đã được đăng hoặc lên lịch lên đúng kênh đích">
              <AlertTriangle size={11} /> Đã đăng lên kênh này
            </span>
          )}
          {isCustomTime && <span className="pub-slot-custom-tag">Đã chỉnh giờ</span>}
          {hasOverride && <span className="pub2-badge pub2-badge-cap">Caption riêng</span>}
          <button type="button" className="pub-btn-preview-slot" onClick={onPreview} title="Xem trước bài đăng này">
            <Eye size={12} /> Xem trước
          </button>
        </div>
      </div>

      <div className="pub-slot-grid-controls">
        <div className="pub-slot-ctrl-item pub-slot-page-ctrl">
          <span className="pub-slot-ctrl-lbl">
            <Share2 size={12} /> Đăng lên:
          </span>
          <select value={slot.page_id} onChange={e => onUpdatePage(e.target.value)} className="pub-slot-page-select">
            {activePages
              .filter(p => selectedPageIds.has(p.page_id) || p.page_id === slot.page_id)
              .map(p => (
                <option key={p.page_id} value={p.page_id}>
                  {channelLabel(p)}
                </option>
              ))}
          </select>
        </div>

        <div className="pub-slot-ctrl-item pub-slot-time-ctrl">
          <span className="pub-slot-ctrl-lbl">
            <Clock size={12} /> Giờ phát:
          </span>
          <div className="pub-slot-time-inputs-wrap">
            <input
              type="datetime-local"
              value={toLocalDatetimeInput(slot.schedule_time_ms)}
              onChange={e => onUpdateTime(e.target.value)}
              className="pub-slot-datetime-input"
            />
            <div className="pub-slot-quick-btns">
              {[15, 30, 60].map(m => (
                <button key={m} type="button" className="pub-quick-adj-btn" onClick={() => onAdjustTime(m)} title={`Lùi thêm ${m} phút`}>
                  {m === 60 ? '+1h' : `+${m}p`}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Xem / Sửa trực tiếp Caption riêng của video này */}
      <div className="pub2-slot-caption">
        <div className="pub2-slot-caption-bar">
          <span className="pub2-slot-cap-count">
            Caption ({slot.caption.length}/{limit})
          </span>
          <div className="pub2-slot-cap-actions">
            <button type="button" className="pub2-mini-btn" onClick={() => setEditing(v => !v)}>
              <Edit3 size={11} /> {editing ? 'Thu gọn' : 'Sửa caption'}
            </button>
            <button type="button" className="pub2-mini-btn" onClick={onRegenerateOne} disabled={isGeneratingOne} title="Dùng Gemini viết lại caption riêng cho video này">
              {isGeneratingOne ? <Loader2 size={11} className="spin" /> : <Sparkles size={11} color="#6366f1" />} AI viết lại
            </button>
            {hasOverride && (
              <button type="button" className="pub2-mini-btn" onClick={onResetCaption} title="Quay về caption mặc định từ nguồn / mẫu">
                <RotateCcw size={11} /> Đặt lại
              </button>
            )}
          </div>
        </div>

        {editing ? (
          <div className="pub2-slot-editor">
            {plat === 'tiktok' && (
              <input
                type="text"
                className="pub-input"
                value={override?.title ?? slot.title}
                onChange={e => onUpdateCaption({ title: e.target.value })}
                placeholder="Tiêu đề ngắn TikTok (tối đa 90 ký tự, tùy chọn)..."
              />
            )}
            <textarea
              rows={3}
              className="pub-textarea"
              value={override?.caption ?? slot.caption}
              onChange={e => onUpdateCaption({ caption: e.target.value })}
              placeholder="Nhập caption riêng cho bài đăng này..."
            />
          </div>
        ) : (
          <p className={`pub2-slot-cap-preview ${!slot.caption.trim() ? 'is-empty' : ''}`} onClick={() => setEditing(true)} title="Bấm để sửa caption bài này">
            {slot.caption.trim() || '(Caption đang trống — bấm để nhập hoặc dùng AI viết)'}
          </p>
        )}

        {warnings.length > 0 && (
          <div className="pub2-slot-warnings">
            {warnings.map((w, i) => (
              <span key={i} className="pub2-slot-warn-item">
                <AlertTriangle size={11} /> {w}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
