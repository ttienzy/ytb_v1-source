import { AlertTriangle, Film, Headphones, HardDriveUpload, Loader2, Music, Trash2, X } from 'lucide-react'
import { HelpHint } from '../../help/components/HelpHint'
import type { Voice } from '../../voices/types'
import { estimateSeconds, formatDuration, formatRanges, PART_MAX_MINUTES, queueTotals, type AudioStory, type BgFit, type BgSummary, type Layout, type QueueItem, type QueuePlan, type VideoUnit } from './audioModel'

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
  unit: VideoUnit
  onUnit: (unit: VideoUnit) => void
  aspect: Aspect
  onAspect: (aspect: Aspect) => void
  layout: Layout
  onLayout: (layout: Layout) => void
  bgm: boolean
  onBgm: (value: boolean) => void
  drive: boolean
  onDrive: (value: boolean) => void
  outputDir: string
  /** Ký tự mỗi truyện (ước thời lượng) + tốc độ đọc dùng để quy đổi. */
  lengths: Record<string, number>
  cps: number
  plan: QueuePlan
  /** Truyện trong hàng đợi không có ảnh nào → video dùng ảnh thay thế. */
  noImage: AudioStory[]
  /** Thư viện video nền: tóm tắt theo khổ đang chọn; bgLoaded=false khi chưa tải xong. */
  bg: BgSummary
  bgLoaded: boolean
  bgFit: BgFit
  onBgFit: (fit: BgFit) => void
  /** library: video trong thư viện; cover: ảnh bìa truyện zoom chậm (chỉ với bố cục Nền video). */
  bgMode: 'library' | 'cover'
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

function Segmented<T extends string>({ value, options, onChange, label, disabled, className = '' }: { value: T; options: Array<{ value: T; label: React.ReactNode; hint?: string }>; onChange: (value: T) => void; label: string; disabled?: boolean; className?: string }) {
  return (
    <div className={`aw-segmented ${className}`} role="radiogroup" aria-label={label}>
      {options.map(option => (
        <button key={option.value} type="button" role="radio" aria-checked={value === option.value} className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)} disabled={disabled} title={option.hint}>
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Cột phải: hàng đợi + cấu hình chạy + nút bắt đầu. Cố định chiều cao, danh sách hàng đợi tự cuộn bên trong. */
export function RunPanel(props: RunPanelProps) {
  const { stories, queue, onQueueChange, onFocus, voice, onVoice, cloned, presets, unit, onUnit, aspect, onAspect, layout, onLayout, bgm, onBgm, drive, onDrive, outputDir, lengths, cps, plan, noImage, bg, bgLoaded, bgFit, onBgFit, bgMode, onManageBg, running, busy, errors, onRun } = props
  const totals = queueTotals(queue)
  const bySlug = new Map(stories.map(story => [story.story_slug, story]))
  const locked = running || busy
  const duration = formatDuration(plan.seconds)

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
            const seconds = story ? estimateSeconds(lengths[item.story_slug], story.total_chapters, item.chapter_numbers.length, cps) : null
            const output = unit === 'chapter' ? `${item.chapter_numbers.length} video` : seconds !== null && seconds > PART_MAX_MINUTES * 60 ? `${Math.ceil(seconds / (PART_MAX_MINUTES * 60))} tập` : '1 video FULL'
            return (
              <div key={item.story_slug} className="aw-queue-row">
                <button type="button" className="aw-queue-main" onClick={() => onFocus(item.story_slug)} title="Xem truyện này ở danh sách bên trái">
                  <strong>{story?.name ?? item.story_slug}</strong>
                  <small>
                    Chương {formatRanges(item.chapter_numbers)} → {output}{seconds !== null ? ` · ${formatDuration(seconds)}` : ''}
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
        <div className="aw-field">
          <span>Kiểu video<HelpHint hint="audio.queue" /></span>
          <Segmented<VideoUnit> label="Kiểu video" value={unit} onChange={onUnit} disabled={locked} options={[
            { value: 'story', label: 'Cả truyện', hint: `Mỗi truyện một video FULL có mốc chương (truyện dài hơn ${PART_MAX_MINUTES} phút tự chia tập) — kiểu "[Truyện Audio Full]" trên YouTube` },
            { value: 'chapter', label: 'Từng chương', hint: 'Mỗi chương một video — hợp với Shorts/TikTok hoặc đăng theo tập' },
          ]} />
        </div>

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
          <Segmented<Aspect> label="Khổ video" value={aspect} onChange={onAspect} disabled={locked} options={[
            { value: '16:9', label: <><i className="aw-ratio rh" /> Ngang 16:9</>, hint: 'YouTube video dài' },
            { value: '9:16', label: <><i className="aw-ratio rv" /> Dọc 9:16</>, hint: 'Shorts / TikTok / Reels' },
          ]} />
        </div>

        <div className="aw-field">
          <span>Bố cục</span>
          <Segmented<Layout> label="Bố cục" value={layout} onChange={onLayout} disabled={locked} options={[
            { value: 'cover_center', label: 'Ảnh bìa + phụ đề', hint: 'Nền mờ + ảnh bìa truyện ở giữa + tên truyện + phụ đề theo lời đọc. Không cần video nền.' },
            { value: 'classic', label: 'Nền video', hint: 'Video trong thư viện nền (hoặc ảnh bìa zoom chậm) phủ kín khung + phụ đề/lớp phủ' },
          ]} />
          {layout === 'classic' && (
            <>
              <button type="button" className={`aw-bg-summary ${bgMode === 'library' && bgLoaded && bg.total === 0 ? 'empty' : ''}`} onClick={onManageBg} title="Mở khối Video nền để thêm / xóa video">
                <Film size={15} />
                <span>
                  {bgMode === 'cover' ? 'Ảnh bìa truyện · zoom chậm (không cần video nền)' : !bgLoaded ? 'Đang tải…' : bg.total === 0 ? 'Chưa có video nền — thêm để chạy' : `${bg.total} video · ${bg.ready} sẵn sàng ${aspect}${bg.busy ? ` · ${bg.busy} đang chuẩn bị` : ''}${bg.failed ? ` · ${bg.failed} lỗi` : ''}`}
                </span>
                <em>{bgMode === 'cover' ? 'Video nền' : 'Quản lý nền'}</em>
              </button>
              {bgMode === 'library' && (
                <Segmented<BgFit> label="Cách khớp video nền vào khung" className="aw-fit-mini" value={bgFit} onChange={onBgFit} disabled={locked} options={[
                  { value: 'fill', label: 'Lấp đầy', hint: 'Phóng to và cắt giữa cho vừa khung — gọn, không viền.' },
                  { value: 'blur', label: 'Nền mờ', hint: 'Giữ trọn hình, phần thừa của khung được lấp bằng nền mờ.' },
                ]} />
              )}
            </>
          )}
        </div>

        <Switch checked={bgm} onChange={onBgm} disabled={locked} icon={<Music size={14} />} label="Nhạc nền" hint="Một bài trong Thư viện nhạc (ngẫu nhiên hoặc bài đã chọn ở khối Âm thanh & hiệu ứng), tự hạ khi giọng đang đọc" />
        <Switch checked={drive} onChange={onDrive} disabled={locked} icon={<HardDriveUpload size={14} />} label="Tự upload Drive rồi xóa file local" />
      </div>

      <div className="aw-run-foot">
        {errors.length > 0 && queue.length > 0 ? (
          <div className="aw-hint warn"><AlertTriangle size={13} /> {errors[0]}</div>
        ) : noImage.length > 0 ? (
          <div className="aw-hint" title={noImage.map(story => story.name).join(', ')}><AlertTriangle size={13} /> {noImage.length === 1 ? `"${noImage[0].name}"` : `${noImage.length} truyện`} không có ảnh bìa — video dùng ảnh thay thế (bấm "Thêm ảnh" để đổi).</div>
        ) : null}
        <button type="button" className="aw-primary" onClick={onRun} disabled={locked || errors.length > 0} title={errors[0]}>
          {busy ? <Loader2 size={16} className="spin" /> : <Headphones size={16} />}
          {busy ? 'Đang khởi động…' : running ? 'Đang chạy…' : totals.chapters ? `Bắt đầu · ${plan.videos} video${duration ? ` · ${duration}` : ''}` : 'Bắt đầu'}
        </button>
        {outputDir && <div className="aw-outdir" title={`Video hoàn tất lưu tại ${outputDir}`}>Lưu tại {outputDir}</div>}
      </div>
    </aside>
  )
}
