import { Component, useEffect, type ErrorInfo, type ReactNode } from 'react'
import { ChevronRight, Loader2, Save, Undo2, X } from 'lucide-react'

/** Lỗi của lần chạy gần nhất: hộp dễ đọc trên toàn bề rộng; lỗi dài (vd. nguyên văn lời ChatGPT) thu gọn, bấm để xem đủ. */
export function RunError({ text, prefix = 'Lỗi' }: { text: string; prefix?: string }) {
  const full = (text ?? '').trim()
  if (!full) return null
  const short = full.length > 200 ? `${full.slice(0, 200).trimEnd()}…` : ''
  return short
    ? <details className="cp-error-box" data-testid="run-error"><summary>{prefix}: {short}</summary><p>{full}</p></details>
    : <p className="cp-error-box" data-testid="run-error">{prefix}: {full}</p>
}

/**
 * Chặn lỗi hiển thị trong MỘT khối: lỗi render (vd. dữ liệu dạng cũ) chỉ làm khối đó báo lỗi, không gỡ cả ứng dụng
 * thành màn hình trắng như trước. Đổi khối hoặc bấm "Thử hiển thị lại" là thử lại.
 */
export class PanelBoundary extends Component<{ label: string; children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Chiến dịch AI] Lỗi hiển thị khối "${this.props.label}"`, error, info.componentStack)
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <section className="cp-card" role="alert" data-testid="panel-crash">
        <p className="cp-error-inline">
          Khối “{this.props.label}” gặp lỗi hiển thị nên tạm ẩn; các khối khác vẫn dùng được. Chi tiết: {this.state.error.message}
        </p>
        <button type="button" className="btn-g cp-small" onClick={() => this.setState({ error: null })}>Thử hiển thị lại</button>
      </section>
    )
  }
}

/** Ô văn bản tự giãn theo nội dung (không phải kéo tay, không thừa dòng trống). */
export function AutoText({ value, onChange, label, minRows = 2, disabled, placeholder, className = '' }: {
  value: string; onChange: (v: string) => void; label: string; minRows?: number; disabled?: boolean; placeholder?: string; className?: string
}) {
  value = value ?? ''
  const rows = Math.max(minRows, Math.min(10, value.split('\n').length + Math.floor(value.length / 90)))
  return <textarea className={`cp-textarea ${className}`} rows={rows} aria-label={label} value={value} disabled={disabled}
                   placeholder={placeholder} onChange={e => onChange(e.target.value)} />
}

/** Thanh lưu chỉ hiện khi có thay đổi, dính đáy khi cuộn. */
export function SaveBar({ onSave, onUndo, saving, disabled, label = 'Lưu', note }: {
  onSave: () => void; onUndo: () => void; saving?: boolean; disabled?: boolean; label?: string; note?: ReactNode
}) {
  return (
    <div className="cp-savebar" role="status">
      <span className="cp-dirty">Có thay đổi chưa lưu</span>
      {note && <span className="cp-note">{note}</span>}
      <button type="button" className="btn-g cp-small" disabled={saving} onClick={onUndo}><Undo2 size={13} /> Hoàn tác</button>
      <button type="button" className="btn-p cp-small" disabled={saving || disabled} onClick={onSave}>
        {saving ? <Loader2 size={13} className="spinning" /> : <Save size={13} />} {label}
      </button>
    </div>
  )
}
import type { Badge as BadgeData } from '../services/campaignView.ts'

export function Badge({ badge }: { badge: BadgeData }) {
  return (
    <span className={`cp-badge cp-tone-${badge.tone}`} title={badge.hint || undefined}>
      {badge.label}
    </span>
  )
}

/** Mục gập được: tiêu đề + tóm tắt ngắn (meta) luôn hiện, nội dung chỉ mở khi cần. */
export function Fold({ title, meta, defaultOpen = false, className = '', testId, children }: {
  title: ReactNode; meta?: ReactNode; defaultOpen?: boolean; className?: string; testId?: string; children: ReactNode
}) {
  return (
    <details className={`cp-fold ${className}`} open={defaultOpen} data-testid={testId}>
      <summary>
        <ChevronRight size={15} className="cp-fold-icon" aria-hidden />
        <span className="cp-fold-title">{title}</span>
        {meta != null && meta !== '' && <span className="cp-fold-meta">{meta}</span>}
      </summary>
      <div className="cp-fold-body">{children}</div>
    </details>
  )
}

export function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
  useEffect(() => {
    if (!src) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [src, onClose])
  if (!src) return null
  return (
    <div className="cp-lightbox" onClick={onClose} role="dialog" aria-modal="true">
      <button type="button" className="cp-lightbox-close" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
      <img src={src} alt="Xem ảnh lớn" onClick={e => e.stopPropagation()} />
    </div>
  )
}

export function ErrorBanner({ message, onClose }: { message: string; onClose: () => void }) {
  if (!message) return null
  return (
    <div className="cp-error" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onClose} aria-label="Đóng thông báo"><X size={14} /></button>
    </div>
  )
}
