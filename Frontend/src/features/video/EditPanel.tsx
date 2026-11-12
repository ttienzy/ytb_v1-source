import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Crop, Droplets, FolderOpen, Loader2, Monitor, Palette, Play, Save, Smartphone, Type } from 'lucide-react'
import { API_URL } from '../../shared/constants'
import { PreviewStage } from './PreviewStage'
import { progressSummary, type Aspect, type CropMode, type LabelPosition } from './videoModel'
import type { VideoWorkspace } from './useVideoWorkspace'

type Tab = 'frame' | 'background' | 'label' | 'blur'

const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'frame', label: 'Khung', icon: <Crop size={14} /> },
  { key: 'background', label: 'Nền', icon: <Palette size={14} /> },
  { key: 'label', label: 'Nhãn', icon: <Type size={14} /> },
  { key: 'blur', label: 'Làm mờ', icon: <Droplets size={14} /> },
]

function Slider({ label, value, onChange, min = 0, max = 1, step = 0.01, unit }: { label: string; value: number; onChange: (value: number) => void; min?: number; max?: number; step?: number; unit?: 'percent' | 'raw' }) {
  return (
    <label className="vp-slider">
      <span>{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} />
      <em>{unit === 'raw' ? `${value}%` : `${Math.round(value * 100)}%`}</em>
    </label>
  )
}

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (value: T) => void; label: string }) {
  return (
    <div className="vp-seg" role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)}>{option.label}</button>
      ))}
    </div>
  )
}

function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <label className="vp-switch">
      <input type="checkbox" checked={checked} onChange={event => onChange(event.target.checked)} />
      <span className="vp-switch-track" />
      <span>{label}</span>
    </label>
  )
}

type EditProps = Pick<VideoWorkspace, 'options' | 'setOption' | 'setBlur' | 'uploadBackground' | 'chooseFolder' | 'outputFolder' | 'process' | 'progress' | 'savedStates' | 'savePreset' | 'applyPreset' | 'selected' | 'videos' | 'busy' | 'youtubeBusy' | 'message'>

/** Chỉnh sửa: xem trước cố định bên trái, cấu hình chia thành 4 tab nhỏ bên phải (không còn một form dài phải cuộn). */
export function EditPanel(props: EditProps) {
  const { options, setOption, setBlur, uploadBackground, chooseFolder, outputFolder, process, progress, savedStates, savePreset, applyPreset, selected, videos, busy, youtubeBusy, message } = props
  const [tab, setTab] = useState<Tab>('frame')
  const [backgroundMode, setBackgroundMode] = useState<'color' | 'image'>(options.background_image ? 'image' : 'color')
  const [stateName, setStateName] = useState('')
  const imageInput = useRef<HTMLInputElement>(null)

  // Áp dụng state có ảnh nền → tự chuyển sang chế độ "Ảnh".
  useEffect(() => { if (options.background_image) setBackgroundMode('image') }, [options.background_image])

  const previewVideo = videos.find(video => video.video_id === selected[0])
  const summary = progressSummary(selected, progress)
  const hasProgress = selected.some(id => progress[id])

  async function save() {
    if (await savePreset(stateName)) setStateName('')
  }

  return (
    <section className="vp-card vp-edit">
      <div className="vp-card-head">
        <strong>Chỉnh sửa</strong>
        <div className="vp-presets">
          {savedStates.length > 0 && (
            <select value="" onChange={event => { const state = savedStates.find(item => item.preset_id === event.target.value); if (state) applyPreset(state) }} aria-label="Áp dụng state đã lưu">
              <option value="">State đã lưu ({savedStates.length})</option>
              {savedStates.map(state => <option key={state.preset_id} value={state.preset_id}>{state.name}</option>)}
            </select>
          )}
          <input value={stateName} onChange={event => setStateName(event.target.value)} placeholder="Tên state mới…" onKeyDown={event => { if (event.key === 'Enter') save() }} aria-label="Tên state mới" />
          <button type="button" className="vp-ghost" onClick={save} title="Lưu cấu hình hiện tại thành state"><Save size={13} /> Lưu</button>
        </div>
      </div>

      <div className="vp-edit-body">
        <PreviewStage options={options} src={previewVideo ? `${API_URL}/api/video/library/${previewVideo.video_id}/file` : undefined} name={previewVideo?.name} />

        <div className="vp-settings">
          <div className="vp-tabs" role="tablist" aria-label="Cấu hình video">
            {TABS.map(item => (
              <button key={item.key} type="button" role="tab" aria-selected={tab === item.key} className={tab === item.key ? 'active' : ''} onClick={() => setTab(item.key)}>{item.icon} {item.label}</button>
            ))}
          </div>

          <div className="vp-tab-body">
            {tab === 'frame' && (
              <>
                <div className="vp-field">
                  <span>Khổ đầu ra</span>
                  <div className="vp-aspects">
                    {([['9:16', 'Reels · TikTok · Facebook', <Smartphone key="p" size={16} />], ['16:9', 'YouTube · video ngang', <Monitor key="m" size={16} />]] as Array<[Aspect, string, ReactNode]>).map(([value, hint, icon]) => (
                      <button key={value} type="button" className={options.aspect === value ? 'active' : ''} onClick={() => setOption('aspect', value)}>{icon}<b>{value}</b><small>{hint}</small></button>
                    ))}
                  </div>
                </div>
                <div className="vp-field">
                  <span>Cắt khung hình</span>
                  <Segmented<CropMode> label="Cắt khung hình" value={options.crop} onChange={value => setOption('crop', value)} options={[{ value: 'fit', label: 'Giữ nguyên' }, { value: 'square', label: 'Vuông giữa' }, { value: 'custom', label: 'Tự chỉnh' }]} />
                </div>
                {options.crop === 'custom' && (
                  <div className="vp-sliders">
                    <Slider label="Ngang" value={options.crop_x} onChange={value => setOption('crop_x', value)} />
                    <Slider label="Dọc" value={options.crop_y} onChange={value => setOption('crop_y', value)} />
                    <Slider label="Rộng" value={options.crop_w} onChange={value => setOption('crop_w', value)} />
                    <Slider label="Cao" value={options.crop_h} onChange={value => setOption('crop_h', value)} />
                  </div>
                )}
                <Switch checked={options.remove_audio} onChange={value => setOption('remove_audio', value)} label="Xóa âm thanh khỏi video" />
              </>
            )}

            {tab === 'background' && (
              <>
                <div className="vp-field">
                  <span>Nền phía sau video</span>
                  <Segmented<'color' | 'image'> label="Kiểu nền" value={backgroundMode} onChange={value => { setBackgroundMode(value); if (value === 'color') setOption('background_image', '') }} options={[{ value: 'color', label: 'Màu nền' }, { value: 'image', label: 'Ảnh nền' }]} />
                </div>
                {backgroundMode === 'color' ? (
                  <div className="vp-color"><input type="color" value={options.background} onChange={event => { setOption('background', event.target.value); setOption('background_image', '') }} aria-label="Màu nền" /><code>{options.background}</code></div>
                ) : (
                  <div className="vp-image-pick">
                    <button type="button" className="vp-ghost" onClick={() => imageInput.current?.click()} disabled={busy}>Chọn ảnh nền</button>
                    <input ref={imageInput} hidden type="file" accept="image/png,image/jpeg,image/webp" onChange={event => { uploadBackground(event.target.files?.[0]); event.currentTarget.value = '' }} />
                    {options.background_image
                      ? <><span className="vp-ok"><Check size={13} /> Đã chọn ảnh nền</span><button type="button" className="vp-link" onClick={() => setOption('background_image', '')}>Bỏ ảnh</button></>
                      : <small>PNG, JPG hoặc WEBP</small>}
                  </div>
                )}
              </>
            )}

            {tab === 'label' && (
              <>
                <div className="vp-field">
                  <span>Nhãn trên video <small>(tùy chọn)</small></span>
                  <input className="vp-input" value={options.label} placeholder="Ví dụ: Kênh của tôi" onChange={event => setOption('label', event.target.value)} />
                </div>
                <div className="vp-field inline">
                  <span>Màu nền nhãn</span>
                  <div className="vp-color"><input type="color" value={options.label_background} onChange={event => setOption('label_background', event.target.value)} aria-label="Màu nền nhãn" /><code>{options.label_background}</code></div>
                </div>
                <div className="vp-field">
                  <span>Vị trí nhãn</span>
                  <Segmented<LabelPosition> label="Vị trí nhãn" value={options.label_position} onChange={value => setOption('label_position', value)} options={[{ value: 'top', label: 'Trên' }, { value: 'center', label: 'Giữa' }, { value: 'bottom', label: 'Dưới' }, { value: 'custom', label: 'Tùy chỉnh' }]} />
                </div>
                {options.label_position === 'custom' && (
                  <div className="vp-sliders">
                    <Slider label="Ngang" value={options.label_x} onChange={value => setOption('label_x', value)} />
                    <Slider label="Dọc" value={options.label_y} onChange={value => setOption('label_y', value)} />
                  </div>
                )}
              </>
            )}

            {tab === 'blur' && (
              <>
                <Switch checked={options.blur.enabled} onChange={value => setBlur('enabled', value)} label="Làm mờ một vùng (che logo, chữ…)" />
                {options.blur.enabled ? (
                  <div className="vp-sliders">
                    <Slider label="Ngang" value={options.blur.x} onChange={value => setBlur('x', value)} />
                    <Slider label="Dọc" value={options.blur.y} onChange={value => setBlur('y', value)} />
                    <Slider label="Rộng" value={options.blur.w} onChange={value => setBlur('w', value)} />
                    <Slider label="Cao" value={options.blur.h} onChange={value => setBlur('h', value)} />
                    <Slider label="Độ mờ" value={options.blur.amount} min={1} max={100} step={1} unit="raw" onChange={value => setBlur('amount', value)} />
                  </div>
                ) : <small className="vp-hint">Bật lên để kéo khung làm mờ trên bản xem trước.</small>}
              </>
            )}
          </div>
        </div>
      </div>

      <div className="vp-edit-foot">
        <div className="vp-foot-main">
          <button type="button" className="vp-primary" onClick={process} disabled={busy || youtubeBusy || !selected.length}>
            {busy ? <Loader2 size={15} className="spin" /> : <Play size={14} fill="currentColor" />}
            {busy ? 'Đang xử lý…' : `Xử lý ${selected.length || ''} video`}
          </button>
          {message && <span className="vp-message" title={message}><Check size={13} /> {message}</span>}
        </div>
        {hasProgress && (
          <div className="vp-progress" aria-label="Tiến trình xử lý">
            <div className="vp-progress-bar"><i style={{ width: `${summary.percent}%` }} /></div>
            <small>{summary.done}/{selected.length} xong{summary.failed ? ` · ${summary.failed} lỗi` : ''} · {summary.percent}%</small>
            {summary.failed > 0 && (
              <ul>
                {selected.filter(id => progress[id]?.status === 'error').map(id => <li key={id}><strong>{videos.find(video => video.video_id === id)?.name || id}:</strong> {progress[id]?.error}</li>)}
              </ul>
            )}
          </div>
        )}
        <div className="vp-output">
          <FolderOpen size={13} />
          <span title={`Mặc định: Data/media/videos/processed${outputFolder ? ` · Thêm: ${outputFolder}` : ''}`}>Lưu tại <code>Data/media/videos/processed</code>{outputFolder && <> + <code>{outputFolder}</code></>}</span>
          <button type="button" className="vp-link" onClick={chooseFolder}>Thêm nơi lưu…</button>
        </div>
      </div>
    </section>
  )
}
