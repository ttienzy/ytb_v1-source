import { useMemo, useState } from 'react'
import { ArrowRight, Check, ChevronDown, ChevronUp, Copy, HardDriveUpload, Loader2, Play, Trash2, X } from 'lucide-react'
import { API_URL } from '../../../shared/constants'

export interface AudioOutput {
  file_name: string
  name: string
  duration_sec: number
  created_at: string
  story_name?: string
  chapter_number?: number
  chapter_title?: string
  thumbnail_name?: string | null
  /** Video v2: tiêu đề/mô tả gợi ý để đăng (mô tả có mốc chương của video cả truyện). */
  video_title?: string
  video_description?: string
  unit?: 'story' | 'chapter'
  part?: number | null
  chapters?: number[]
  aspect?: '9:16' | '16:9'
}

function videoLabel(item: AudioOutput): string {
  if (item.unit === 'story') return item.part ? `Tập ${item.part}` : 'FULL'
  return item.chapter_number ? `Chương ${item.chapter_number}` : item.name
}

function formatClock(seconds: number): string {
  const s = Math.round(seconds)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const sec = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`
}

/** Nút sao chép nhỏ: đổi thành dấu tích 1,5 giây sau khi chép. */
function CopyButton({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  return (
    <button type="button" className="aw-ghost small" onClick={() => {
      navigator.clipboard.writeText(text).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500) }).catch(() => {})
    }}>
      {done ? <Check size={13} /> : <Copy size={13} />} {done ? 'Đã chép' : label}
    </button>
  )
}

interface DriveProgress {
  file_name: string
  status: string
  percent: number
  error?: string
}

interface AudioOutputsProps {
  outputs: AudioOutput[]
  onChanged: () => void
  onError: (message: string) => void
}

/** Kho video Audio đã hoàn tất: gọn một hàng khi trống, lưới thẻ theo truyện (tự cuộn) khi có; xem video / đẩy Drive / xóa local trong modal. */
export function AudioOutputs({ outputs, onChanged, onError }: AudioOutputsProps) {
  const [open, setOpen] = useState(true)
  const [selectedStory, setSelectedStory] = useState<string | null>(null)
  const [driveOpen, setDriveOpen] = useState(false)
  const [driveMode, setDriveMode] = useState<'upload' | 'delete'>('upload')
  const [driveSelected, setDriveSelected] = useState<string[]>([])
  const [driveAutoDelete, setDriveAutoDelete] = useState(true)
  const [driveProgress, setDriveProgress] = useState<DriveProgress[]>([])
  const [driveBusy, setDriveBusy] = useState(false)

  const groups = useMemo(() => {
    const map = new Map<string, AudioOutput[]>()
    outputs.forEach(item => {
      const story = item.story_name || 'Video Audio khác'
      map.set(story, [...(map.get(story) || []), item])
    })
    return Array.from(map, ([story_name, videos]) => ({ story_name, videos }))
  }, [outputs])

  function openDrive(mode: 'upload' | 'delete') {
    setDriveMode(mode)
    setDriveAutoDelete(true)
    const files = groups.flatMap(group => group.videos.map(video => video.file_name))
    setDriveSelected(files)
    setDriveProgress(files.map(file_name => ({ file_name, status: 'queued', percent: 0 })))
    setDriveOpen(true)
  }

  async function submitDrive() {
    if (!driveSelected.length) return
    setDriveBusy(true)
    try {
      const endpoint = driveMode === 'upload' ? '/api/audio/outputs/upload-drive' : '/api/audio/outputs/delete-local'
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_names: driveSelected, ...(driveMode === 'upload' ? { auto_delete_local: driveAutoDelete } : {}) }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Không thể xử lý video.')
      if (driveMode === 'upload') {
        let status = data
        setDriveProgress(status.items || [])
        while (status.status !== 'completed') {
          await new Promise(resolve => setTimeout(resolve, 500))
          const statusResponse = await fetch(`${API_URL}/api/audio/outputs/upload-drive/${data.job_id}`)
          if (!statusResponse.ok) throw new Error('Không thể đọc tiến độ upload.')
          status = await statusResponse.json()
          setDriveProgress(status.items || [])
        }
        const failed = (status.items || []).filter((item: DriveProgress) => item.status === 'error')
        onError(failed.length ? `${failed.length} video upload lỗi: ${failed[0].error}` : '')
      } else {
        onError('')
      }
      onChanged()
      setDriveOpen(false)
    } catch (error) {
      onError(error instanceof Error ? error.message : 'Không thể xử lý video Audio.')
    } finally {
      setDriveBusy(false)
    }
  }

  const detail = groups.find(group => group.story_name === selectedStory)

  return (
    <section className="aw-card aw-outputs">
      <div className="aw-outputs-head">
        <button type="button" className="aw-outputs-toggle" onClick={() => setOpen(value => !value)} aria-expanded={open}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <strong>Video đã hoàn tất</strong>
          <span className="aw-pill neutral">{outputs.length}</span>
        </button>
        <div className="aw-outputs-actions">
          <button type="button" className="aw-ghost" onClick={() => openDrive('upload')} disabled={!outputs.length}><HardDriveUpload size={14} /> Đẩy lên Drive</button>
          <button type="button" className="aw-ghost danger" onClick={() => openDrive('delete')} disabled={!outputs.length}><Trash2 size={14} /> Xóa ở local</button>
        </div>
      </div>

      {open && (outputs.length === 0 ? (
        <p className="aw-empty small">Chưa có video Audio hoàn tất.</p>
      ) : (
        <div className="aw-outputs-grid">
          {groups.map(group => (
            <button type="button" key={group.story_name} className="aw-output-card" onClick={() => setSelectedStory(group.story_name)}>
              <span className="aw-output-icon"><Play size={15} fill="currentColor" /></span>
              <span className="aw-output-copy">
                <strong title={group.story_name}>{group.story_name}</strong>
                <small>{group.videos.length} video · {group.videos.map(videoLabel).join(', ')}</small>
              </span>
              <ArrowRight size={14} />
            </button>
          ))}
        </div>
      ))}

      {selectedStory && detail && (
        <div className="video-modal-backdrop" onClick={() => setSelectedStory(null)}>
          <div className="video-modal audio-story-output-modal" onClick={event => event.stopPropagation()}>
            <div className="video-modal-head">
              <strong>{selectedStory}</strong>
              <button type="button" className="icon-button" onClick={() => setSelectedStory(null)} aria-label="Đóng"><X size={18} /></button>
            </div>
            <div className="audio-story-video-list">
              {detail.videos.map(item => (
                <div className="audio-story-video-item" key={item.file_name}>
                  <video controls preload="metadata" poster={item.thumbnail_name ? `${API_URL}/api/audio/thumbnails/${encodeURIComponent(item.thumbnail_name)}` : undefined} src={`${API_URL}/api/audio/outputs/${encodeURIComponent(item.file_name)}`} />
                  <div className="audio-story-video-meta">
                    <strong>{videoLabel(item)}{item.aspect ? ` · ${item.aspect}` : ''}</strong>
                    <small>{item.unit === 'story' && item.chapters?.length ? `Chương ${item.chapters[0]}–${item.chapters[item.chapters.length - 1]} · ` : ''}{formatClock(item.duration_sec)}</small>
                    {item.video_title && (
                      <>
                        <p className="audio-story-video-title" title="Tiêu đề gợi ý">{item.video_title}</p>
                        {item.video_description && <pre className="audio-story-video-desc">{item.video_description}</pre>}
                        <div className="audio-story-video-actions">
                          <CopyButton text={item.video_title} label="Chép tiêu đề" />
                          {item.video_description && <CopyButton text={item.video_description} label="Chép mô tả" />}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {driveOpen && (
        <div className="video-modal-backdrop" onClick={() => !driveBusy && setDriveOpen(false)}>
          <div className="video-modal audio-drive-modal" onClick={event => event.stopPropagation()}>
            <div className="video-modal-head">
              <strong>{driveMode === 'upload' ? 'Đẩy video Audio lên Google Drive' : 'Xóa video Audio ở local'}</strong>
              <button type="button" className="icon-button" onClick={() => setDriveOpen(false)} disabled={driveBusy} aria-label="Đóng"><X size={18} /></button>
            </div>
            <div className="audio-drive-body">
              {driveMode === 'upload' && <p className="audio-drive-note">Chọn video của một hoặc nhiều truyện. Video sẽ được lưu trực tiếp theo cấu trúc <strong>Audio / Tên truyện / video.mp4</strong>; số chương đã nằm trong tên file.</p>}
              <div className="audio-drive-selection-actions">
                <button type="button" onClick={() => setDriveSelected(groups.flatMap(group => group.videos.map(video => video.file_name)))} disabled={driveBusy}>Chọn tất cả</button>
                <button type="button" onClick={() => setDriveSelected([])} disabled={driveBusy}>Bỏ chọn</button>
              </div>
              <div className="audio-drive-video-list">
                {groups.map(group => (
                  <div className="audio-drive-story-group" key={group.story_name}>
                    <div className="audio-drive-story-heading">
                      <strong>{group.story_name}</strong>
                      <span>{group.videos.filter(video => driveSelected.includes(video.file_name)).length}/{group.videos.length} video</span>
                    </div>
                    {group.videos.map(video => {
                      const progress = driveProgress.find(item => item.file_name === video.file_name)
                      return (
                        <label key={video.file_name} className="audio-drive-video">
                          <input type="checkbox" checked={driveSelected.includes(video.file_name)} onChange={() => setDriveSelected(current => (current.includes(video.file_name) ? current.filter(name => name !== video.file_name) : [...current, video.file_name]))} />
                          <div className="audio-drive-video-copy">
                            <strong>{videoLabel(video)}</strong>
                            <small>{progress?.status === 'uploading' ? `Đang upload… ${progress.percent}%` : progress?.status === 'done' ? 'Upload thành công' : progress?.status === 'error' ? `Upload lỗi: ${progress.error || 'Không xác định'}` : (video.chapter_title || video.name)}</small>
                            {driveMode === 'upload' && progress && <div className="audio-drive-progress"><div style={{ width: `${progress.percent}%` }} /></div>}
                          </div>
                        </label>
                      )
                    })}
                  </div>
                ))}
              </div>
              <div className="audio-drive-footer">
                <div className="audio-drive-footer-left">
                  <span>Đã chọn {driveSelected.length}/{outputs.length} video</span>
                  {driveMode === 'upload' && <label className="audio-drive-auto-delete"><input type="checkbox" checked={driveAutoDelete} onChange={event => setDriveAutoDelete(event.target.checked)} /> Xóa local sau khi upload thành công</label>}
                </div>
                <button type="button" className={driveMode === 'upload' ? 'primary-button' : 'danger-button'} onClick={submitDrive} disabled={driveBusy || !driveSelected.length}>
                  {driveBusy ? <Loader2 size={14} className="spin" /> : driveMode === 'upload' ? <HardDriveUpload size={14} /> : <Trash2 size={14} />}
                  {driveMode === 'upload' ? 'Đẩy lên Drive' : 'Xóa ở local'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
