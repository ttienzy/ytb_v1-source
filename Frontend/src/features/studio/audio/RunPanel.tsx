import { AlertTriangle, Film, Headphones, HardDriveUpload, Loader2, Music, Trash2, X } from 'lucide-react'
import { HelpHint } from '../../help/components/HelpHint'
import type { Voice } from '../../voices/types'
import { formatRanges, queueTotals, type AudioStory, type BgFit, type BgSummary, type QueueItem } from './audioModel'

export type Aspect = '9:16' | '16:9'

interface RunPanelProps {
  stories: AudioStory[]
  queue: QueueItem[]
  onQueueChange: (queue: QueueItem[]) => void
  onFocus: (slug: string) => void
  voice: string
  onVoice: (voice: string) => void
  cloned: Voice[]
  presets: Array<{ name: string; description?: string }>
  aspect: Aspect
  onAspect: (aspect: Aspect) => void
  bgm: boolean
  onBgm: (value: boolean) => void
  drive: boolean
  onDrive: (value: boolean) => void
  outputDir: string
  /** Thư viện video nền: tóm tắt theo khổ đang chọn; bgLoaded=false khi chưa tải xong. */
  bg: BgSummary
  bgLoaded: boolean
  /** Cách khớp video nền vào khung. */
  bgFit: BgFit
  onBgFit: (fit: BgFit) => void
  /** library: video trong thư viện; cover: ảnh bìa truyện zoom chậm (không cần video nền). */
  bgMode: 'library' | 'cover'
  /** Mở khối "Video nền" (trang Video) bên dưới. */
  onManageBg: () => void
  running: boolean
  busy: boolean
  errors: string[]
  onRun: () => void
}

function Switch({ checked, onChange, disabled, icon, label, hint }: { checked: boolean; onChange: (value: boolean) => void; disabled?: boolean; icon: React.ReactNode; label: string; hint?: string }) {
  return (
    <label className={`aw-switch ${disabled ? 'disabled' : ''}`} title={hint}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={event => onChange(event.target.checked)} />
      <span className="aw-switch-track" />
      {icon}
      <span>{label}</span>
    </label>
  )
}

/** Cột phải: hàng đợi đã chọn + cấu hình chạy + nút bắt đầu. Cố định chiều cao, danh sách hàng đợi tự cuộn bên trong. */
export function RunPanel(props: RunPanelProps) {
  const { stories, queue, onQueueChange, onFocus, voice, onVoice, cloned, presets, aspect, onAspect, bgm, onBgm, drive, onDrive, outputDir, bg, bgLoaded, bgFit, onBgFit, bgMode, onManageBg, running, busy, errors, onRun } = props
  const totals = queueTotals(queue)
  const bySlug = new Map(stories.map(story => [story.story_slug, story]))
  const locked = running || busy

  return (
    <aside className="aw-card aw-run">
      <div className="aw-run-head">
        <strong>Hàng đợi</strong>
        <span className="aw-run-total">{totals.chapters ? `${totals.stories} truyện · ${totals.chapters} chương` : 'Trống'}</span>
        {queue.length > 0 && (
          <button type="button" className="aw-link" onClick={() => onQueueChange([])} title="Xóa toàn bộ hàng đợi">
            <Trash2 size={13} /> Xóa hết
          </button>
        )}
      </div>

      <div className="aw-queue">
        {queue.length === 0 ? (
          <div className="aw-empty small">Chọn chương ở bên trái — mỗi lần chạy tối đa 10 truyện, không giới hạn số chương.</div>
        ) : (
          queue.map(item => {
            const story = bySlug.get(item.story_slug)
            return (
              <div key={item.story_slug} className="aw-queue-row">
                <button type="button" className="aw-queue-main" onClick={() => onFocus(item.story_slug)} title="Xem truyện này ở danh sách bên trái">
                  <strong>{story?.name ?? item.story_slug}</strong>
                  <small>
                    {item.chapter_numbers.length} chương · {formatRanges(item.chapter_numbers)}
                    {story && !story.thumbnail_name && <em className="aw-warn"> · thiếu thumbnail</em>}
                  </small>
                </button>
                <button type="button" className="aw-icon-btn" onClick={() => onQueueChange(queue.filter(entry => entry.story_slug !== item.story_slug))} aria-label="Bỏ khỏi hàng đợi" title="Bỏ khỏi hàng đợi">
                  <X size={14} />
                </button>
              </div>
            )
          })
        )}
      </div>

      <div className="aw-settings">
        <label className="aw-field">
          <span>Giọng đọc</span>
          <select value={voice} onChange={event => onVoice(event.target.value)} disabled={locked}>
            <option value="">-- Chọn giọng --</option>
            {cloned.length > 0 && (
              <optgroup label="Giọng đã clone">
                {cloned.map(item => <option key={item.voice_id} value={item.voice_id}>{item.name}</option>)}
              </optgroup>
            )}
            {presets.length > 0 && (
              <optgroup label="Preset VieNeu">
                {presets.map(item => <option key={item.name} value={item.name}>{item.name}</option>)}
              </optgroup>
            )}
          </select>
        </label>

        <div className="aw-field">
          <span>Khổ video</span>
          <div className="aw-segmented" role="radiogroup" aria-label="Khổ video">
            {(['9:16', '16:9'] as const).map(value => (
              <button key={value} type="button" role="radio" aria-checked={aspect === value} className={aspect === value ? 'active' : ''} onClick={() => onAspect(value)} disabled={locked}>
                <i className={`aw-ratio r${value === '9:16' ? 'v' : 'h'}`} /> {value === '9:16' ? 'Dọc 9:16' : 'Ngang 16:9'}
              </button>
            ))}
          </div>
        </div>

        <div className="aw-field">
          <span>Nền video<HelpHint hint="audio.queue" /></span>
          <button type="button" className={`aw-bg-summary ${bgMode === 'library' && bgLoaded && bg.total === 0 ? 'empty' : ''}`} onClick={onManageBg} title="Mở khối Video nền để thêm / xóa video">
            <Film size={15} />
            <span>
              {bgMode === 'cover' ? 'Ảnh bìa truyện · zoom chậm (không cần video nền)' : !bgLoaded ? 'Đang tải…' : bg.total === 0 ? 'Chưa có video nền — thêm để chạy' : `${bg.total} video · ${bg.ready} sẵn sàng ${aspect}${bg.busy ? ` · ${bg.busy} đang chuẩn bị` : ''}${bg.failed ? ` · ${bg.failed} lỗi` : ''}`}
            </span>
            <em>{bgMode === 'cover' ? 'Video nền' : 'Quản lý nền'}</em>
          </button>
          {bgMode === 'library' && <div className="aw-segmented aw-fit-mini" role="radiogroup" aria-label="Cách khớp video nền vào khung">
            {([['fill', 'Lấp đầy', 'Phóng to và cắt giữa cho vừa khung — gọn, không viền.'], ['blur', 'Nền mờ', 'Giữ trọn hình, phần thừa của khung được lấp bằng nền mờ.']] as const).map(([key, label, hint]) => (
              <button key={key} type="button" role="radio" aria-checked={bgFit === key} className={bgFit === key ? 'active' : ''} onClick={() => onBgFit(key)} disabled={locked} title={hint}>{label}</button>
            ))}
          </div>}
        </div>

        <Switch checked={bgm} onChange={onBgm} disabled={locked} icon={<Music size={14} />} label="Nhạc nền" hint="Chọn ngẫu nhiên 1 bài trong Thư viện nhạc, mix nhỏ dưới giọng đọc" />
        <Switch checked={drive} onChange={onDrive} disabled={locked} icon={<HardDriveUpload size={14} />} label="Tự upload Drive rồi xóa file local" />
      </div>

      <div className="aw-run-foot">
        {errors.length > 0 && queue.length > 0 && (
          <div className="aw-hint warn"><AlertTriangle size={13} /> {errors[0]}</div>
        )}
        <button type="button" className="aw-primary" onClick={onRun} disabled={locked || errors.length > 0} title={errors[0]}>
          {busy ? <Loader2 size={16} className="spin" /> : <Headphones size={16} />}
          {busy ? 'Đang khởi động…' : running ? 'Đang chạy…' : totals.chapters ? `Bắt đầu · ${totals.chapters} chương` : 'Bắt đầu'}
        </button>
        {outputDir && <div className="aw-outdir" title={`Video hoàn tất lưu tại ${outputDir}`}>Lưu tại {outputDir}</div>}
      </div>
    </aside>
  )
}
