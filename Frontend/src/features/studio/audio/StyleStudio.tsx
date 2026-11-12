import { useEffect, useRef, useState, type ReactNode } from 'react'
import { AudioLines, ChevronDown, ChevronUp, Eye, ImagePlus, Layers, Loader2, Trash2, Volume2 } from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import { describeStyle, type AudioStyle, type BgFit, type DuckMode, type LogoPosition, type TitleCard } from './audioModel'

type Tab = 'sound' | 'overlay' | 'background'

export interface BgmTrack {
  track_id: string
  name: string
}

interface StyleStudioProps {
  style: AudioStyle
  onChange: (patch: Partial<AudioStyle>) => void
  onReset: () => void
  /** Khóa chỉnh sửa khi đang chạy workflow. */
  locked: boolean
  tracks: BgmTrack[]
  bgm: boolean
  aspect: '9:16' | '16:9'
  bgFit: BgFit
  /** Truyện đang xem: dùng tên + ảnh bìa của truyện này cho video xem thử. */
  previewSlug: string | null
  onError: (message: string) => void
}

function Slider({ label, value, min, max, step, format, onChange, disabled, hint }: { label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; onChange: (value: number) => void; disabled?: boolean; hint?: string }) {
  return (
    <label className={`aw-slider ${disabled ? 'disabled' : ''}`} title={hint}>
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} onChange={event => onChange(Number(event.target.value))} />
      <em>{format(value)}</em>
    </label>
  )
}

function Segmented<T extends string>({ value, options, onChange, label, disabled }: { value: T; options: Array<{ value: T; label: string; hint?: string }>; onChange: (value: T) => void; label: string; disabled?: boolean }) {
  return (
    <div className="aw-segmented" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)} disabled={disabled} title={option.hint}>{option.label}</button>
      ))}
    </div>
  )
}

function Switch({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (value: boolean) => void; label: ReactNode; hint?: string; disabled?: boolean }) {
  return (
    <label className={`aw-switch ${disabled ? 'disabled' : ''}`} title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span className="aw-switch-track" />
      <span>{label}</span>
    </label>
  )
}

const CORNERS: Array<{ value: LogoPosition; label: string }> = [
  { value: 'tl', label: '↖' }, { value: 'tr', label: '↗' }, { value: 'bl', label: '↙' }, { value: 'br', label: '↘' },
]

/** Khối gập "Âm thanh & hiệu ứng": chỉnh tốc độ đọc/nhạc nền/chuẩn hóa âm lượng, lớp phủ (tối nền, thẻ tiêu đề, waveform, logo), kiểu nền — kèm xem thử vài giây. */
export function StyleStudio({ style, onChange, onReset, locked, tracks, bgm, aspect, bgFit, previewSlug, onError }: StyleStudioProps) {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('sound')
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewBusy, setPreviewBusy] = useState(false)
  const [previewStale, setPreviewStale] = useState(false)
  const [logoBusy, setLogoBusy] = useState(false)
  const logoInput = useRef<HTMLInputElement>(null)
  const tags = describeStyle(style)

  // Đổi cấu hình/khổ sau khi đã xem thử → nhắc xem thử lại (kết quả cũ không còn khớp).
  const signature = JSON.stringify([style, aspect, bgFit, previewSlug])
  const lastSignature = useRef(signature)
  useEffect(() => {
    if (signature !== lastSignature.current) { lastSignature.current = signature; if (previewUrl) setPreviewStale(true) }
  }, [signature, previewUrl])

  async function runPreview() {
    setPreviewBusy(true)
    onError('')
    try {
      const response = await fetch(`${API_URL}/api/audio/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ story_slug: previewSlug, aspect, bg_fit: bgFit, seconds: 6, options: style }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Lỗi ${response.status}`)
      setPreviewUrl(`${API_URL}/api/audio/preview/${encodeURIComponent(data.file_name)}`)
      setPreviewStale(false)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Không dựng được video xem thử.')
    } finally {
      setPreviewBusy(false)
    }
  }

  async function uploadLogo(file: File | undefined) {
    if (!file) return
    setLogoBusy(true)
    onError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(`${API_URL}/api/audio/logo`, { method: 'POST', body: form })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(typeof data.detail === 'string' ? data.detail : `Lỗi ${response.status}`)
      onChange({ logo_id: data.logo_id })
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Không tải được logo.')
    } finally {
      setLogoBusy(false)
    }
  }

  const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
    { key: 'sound', label: 'Âm thanh', icon: <Volume2 size={14} /> },
    { key: 'overlay', label: 'Lớp phủ', icon: <Layers size={14} /> },
    { key: 'background', label: 'Nền', icon: <ImagePlus size={14} /> },
  ]

  return (
    <section className="aw-card aw-outputs aw-style">
      <div className="aw-outputs-head">
        <button type="button" className="aw-outputs-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <strong>Âm thanh &amp; hiệu ứng</strong>
          {tags.length > 0 && <span className="aw-pill neutral">{tags.length} tùy chỉnh</span>}
        </button>
        {!open && tags.length > 0 && <small className="aw-video-hint">{tags.join(' · ')}</small>}
        {open && <button type="button" className="aw-link" onClick={onReset} disabled={locked || tags.length === 0}>Đặt lại mặc định</button>}
      </div>

      {open && (
        <div className="aw-style-body">
          <div className="aw-style-main">
            <div className="aw-tabs" role="tablist" aria-label="Nhóm tùy chỉnh">
              {TABS.map(item => (
                <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>{item.icon} {item.label}</button>
              ))}
            </div>

            <div className="aw-style-pane">
              {tab === 'sound' && (
                <>
                  <Slider label="Tốc độ đọc" value={style.voice_speed} min={0.7} max={1.5} step={0.05} format={v => `×${v.toFixed(2)}`} onChange={v => onChange({ voice_speed: v })} disabled={locked} hint="Đổi tốc độ nhưng giữ nguyên cao độ giọng" />
                  <Switch checked={style.loudnorm} onChange={v => onChange({ loudnorm: v })} disabled={locked} label="Chuẩn hóa âm lượng (≈ −16 LUFS)" hint="Các video có độ lớn đồng đều, gần mức YouTube khuyến nghị (−14 LUFS), không bị nhỏ/to thất thường" />
                  <Slider label="Nhạc nền" value={style.bgm_volume} min={0} max={1} step={0.01} format={v => `${Math.round(v * 100)}%`} onChange={v => onChange({ bgm_volume: v })} disabled={locked || !bgm} hint={bgm ? 'Âm lượng nhạc trước khi tự hạ theo giọng đọc' : 'Bật "Nhạc nền" ở cột bên phải để chỉnh'} />
                  <div className="aw-field">
                    <span>Tự hạ nhạc khi giọng đang đọc</span>
                    <Segmented<DuckMode> label="Mức hạ nhạc" value={style.bgm_duck} onChange={v => onChange({ bgm_duck: v })} disabled={locked || !bgm}
                      options={[{ value: 'off', label: 'Tắt' }, { value: 'normal', label: 'Vừa', hint: 'Mức mặc định' }, { value: 'strong', label: 'Mạnh', hint: 'Giọng nổi hẳn lên, nhạc chỉ còn thoảng' }]} />
                  </div>
                  <label className="aw-field">
                    <span>Bài nhạc nền</span>
                    <select value={style.bgm_track_id ?? ''} onChange={event => onChange({ bgm_track_id: event.target.value || null })} disabled={locked || !bgm}>
                      <option value="">Ngẫu nhiên trong Thư viện nhạc</option>
                      {tracks.map(track => <option key={track.track_id} value={track.track_id}>{track.name}</option>)}
                    </select>
                  </label>
                  <Slider label="Nhỏ dần cuối video" value={style.fade_out_sec} min={0} max={6} step={0.5} format={v => (v === 0 ? 'Tắt' : `${v.toFixed(1)}s`)} onChange={v => onChange({ fade_out_sec: v })} disabled={locked} />
                </>
              )}

              {tab === 'overlay' && (
                <>
                  <p className="aw-note">Bật bất kỳ lớp phủ nào thì video được mã hóa lại một lượt (chậm hơn đường nối nhanh, nhưng chỉ khoảng một phút cho chương 9 phút).</p>
                  <Slider label="Làm tối nền" value={style.dim} min={0} max={0.7} step={0.05} format={v => (v === 0 ? 'Tắt' : `${Math.round(v * 100)}%`)} onChange={v => onChange({ dim: v })} disabled={locked} hint="Giúp chữ, waveform và logo dễ đọc trên nền sáng" />
                  <div className="aw-field">
                    <span>Thẻ tiêu đề chương</span>
                    <Segmented<TitleCard> label="Thẻ tiêu đề" value={style.title_card} onChange={v => onChange({ title_card: v })} disabled={locked}
                      options={[{ value: 'off', label: 'Tắt' }, { value: 'intro', label: 'Đầu video', hint: 'Tên truyện + chương hiện lớn ở giữa rồi mờ dần' }, { value: 'always', label: 'Luôn hiện', hint: 'Dòng nhỏ cố định phía trên' }]} />
                  </div>
                  {style.title_card === 'intro' && <Slider label="Hiện trong" value={style.title_seconds} min={2} max={20} step={1} format={v => `${v}s`} onChange={v => onChange({ title_seconds: v })} disabled={locked} />}
                  <Switch checked={style.waveform} onChange={v => onChange({ waveform: v })} disabled={locked} label="Waveform theo giọng đọc" hint="Sóng âm chạy theo lời đọc ở phần dưới video — kiểu thường thấy ở video sách nói" />
                  <div className="aw-field">
                    <span>Logo kênh</span>
                    <div className="aw-logo-row">
                      {style.logo_id ? <img src={`${API_URL}/api/audio/logo/${style.logo_id}`} alt="Logo" /> : <div className="aw-logo-empty">Chưa có</div>}
                      <button type="button" className="aw-ghost" onClick={() => logoInput.current?.click()} disabled={locked || logoBusy}>
                        {logoBusy ? <Loader2 size={13} className="spin" /> : <ImagePlus size={13} />} {style.logo_id ? 'Đổi logo' : 'Chọn logo'}
                      </button>
                      {style.logo_id && <button type="button" className="aw-icon-btn" onClick={() => onChange({ logo_id: null })} disabled={locked} aria-label="Bỏ logo" title="Bỏ logo"><Trash2 size={14} /></button>}
                      <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={event => { uploadLogo(event.target.files?.[0]); event.currentTarget.value = '' }} />
                    </div>
                  </div>
                  {style.logo_id && (
                    <>
                      <div className="aw-field inline">
                        <span>Vị trí</span>
                        <div className="aw-segmented corners" role="radiogroup" aria-label="Vị trí logo">
                          {CORNERS.map(corner => <button key={corner.value} type="button" role="radio" aria-checked={style.logo_position === corner.value} className={style.logo_position === corner.value ? 'active' : ''} onClick={() => onChange({ logo_position: corner.value })} disabled={locked}>{corner.label}</button>)}
                        </div>
                      </div>
                      <Slider label="Cỡ logo" value={style.logo_size} min={0.05} max={0.4} step={0.01} format={v => `${Math.round(v * 100)}%`} onChange={v => onChange({ logo_size: v })} disabled={locked} />
                      <Slider label="Độ đậm" value={style.logo_opacity} min={0.1} max={1} step={0.05} format={v => `${Math.round(v * 100)}%`} onChange={v => onChange({ logo_opacity: v })} disabled={locked} />
                    </>
                  )}
                </>
              )}

              {tab === 'background' && (
                <>
                  <div className="aw-field">
                    <span>Nguồn hình nền</span>
                    <Segmented<AudioStyle['bg_mode']> label="Nguồn hình nền" value={style.bg_mode} onChange={v => onChange({ bg_mode: v })} disabled={locked}
                      options={[{ value: 'library', label: 'Video trong thư viện' }, { value: 'cover', label: 'Ảnh bìa truyện' }]} />
                  </div>
                  <p className="aw-note">
                    {style.bg_mode === 'library'
                      ? 'Ghép ngẫu nhiên các video ở khối "Video nền" (xáo trộn, không lặp liền kề). Cách khớp khung (lấp đầy / nền mờ) chọn ở cột bên phải.'
                      : 'Dùng chính ảnh bìa (thumbnail) của truyện làm nền, phóng to – thu nhỏ rất chậm theo chu kỳ 40 giây. Không cần video nền; mỗi truyện chỉ tạo một lần rồi dùng lại cho mọi chương.'}
                  </p>
                </>
              )}
            </div>
          </div>

          <aside className="aw-preview">
            <div className="aw-preview-head">
              <strong>Xem thử</strong>
              <small>{previewSlug ? 'dùng truyện đang xem' : 'tên truyện mẫu'}</small>
            </div>
            <div className={`aw-preview-stage ${aspect === '9:16' ? 'portrait' : 'landscape'}`}>
              {previewUrl ? <video key={previewUrl} src={previewUrl} controls loop autoPlay muted playsInline /> : <div className="aw-preview-empty"><Eye size={20} /><span>Bấm &ldquo;Xem thử&rdquo; để thấy hình nền + lớp phủ đang chọn (6 giây, không cần đọc giọng).</span></div>}
              {previewBusy && <div className="aw-preview-busy"><Loader2 size={20} className="spin" /> Đang dựng…</div>}
            </div>
            {previewStale && !previewBusy && <small className="aw-warn">Cấu hình đã đổi — xem thử lại để cập nhật.</small>}
            <button type="button" className="aw-primary small" onClick={runPreview} disabled={previewBusy || locked}>
              {previewBusy ? <Loader2 size={14} className="spin" /> : <AudioLines size={14} />} {previewUrl ? 'Xem thử lại' : 'Xem thử 6 giây'}
            </button>
          </aside>
        </div>
      )}
    </section>
  )
}

