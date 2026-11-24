import { useEffect, useRef, useState } from 'react'
import { Download, Edit3, Film, ImageDown, Loader2, Play, Send, Trash2 } from 'lucide-react'
import { LibraryPagination } from '../../../shared/LibraryPagination'
import { useLibraryPage } from '../../../shared/useLibraryPage'
import type { VeoHistoryItem } from '../types'
import { getHistoryPage, getVideoStreamUrl } from '../services/veoApi'
import './videoGallery.css'

interface Props {
  refreshKey: number
  selectedVideoId?: string
  onSelect: (item: VeoHistoryItem) => void
  onDelete: (videoId: string) => void
  onSendToEditor?: (item: VeoHistoryItem) => void
  onSendToSchedule?: (item: VeoHistoryItem) => void
  onSaveLastFrameToLibrary?: (item: VeoHistoryItem) => void
  extractingVideoId?: string | null
}

const count = new Intl.NumberFormat('vi-VN')
const seconds = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 3 })

function VideoThumbnail({ url }: { url: string }) {
  const container = useRef<HTMLSpanElement>(null)
  const [requested, setRequested] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    if (!container.current) return
    if (typeof IntersectionObserver === 'undefined') {
      setRequested(true)
      return
    }
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry.isIntersecting) return
      setRequested(true)
      observer.disconnect()
    }, { rootMargin: '160px' })
    observer.observe(container.current)
    return () => observer.disconnect()
  }, [])

  return (
    <span ref={container} className="veo-history-thumb-media" aria-hidden="true">
      {!loaded && <Film size={24} strokeWidth={1.5} />}
      {requested && !failed && <video src={url} muted playsInline preload="metadata" onLoadedData={() => setLoaded(true)} onError={() => { setFailed(true); setLoaded(false) }} />}
    </span>
  )
}

export function VideoGallery({
  refreshKey, selectedVideoId, onSelect, onDelete, onSendToEditor, onSendToSchedule,
  onSaveLastFrameToLibrary, extractingVideoId,
}: Props) {
  const { data: history, loading, error, load } = useLibraryPage(getHistoryPage, { refreshKey })
  const header = useRef<HTMLElement>(null)
  const first = history ? (history.page - 1) * history.page_size : 0

  return (
    <section className="veo-history" aria-label="Video đã tạo" aria-busy={loading}>
      <header ref={header} className="veo-history-header">
        <div className="veo-history-heading">
          <h3>Video đã tạo</h3>
          {history && <span className="veo-history-count">{count.format(history.total)}</span>}
        </div>
        <LibraryPagination data={history} loading={loading} label="Phân trang video" onPage={(next) => void load(next)} />
      </header>
      {error && <div className="veo-history-message" role="alert"><span>{error}</span><button type="button" onClick={() => void load()}>Thử lại</button></div>}
      {!history && loading && <p className="veo-history-message" role="status">Đang tải video…</p>}
      {history?.total === 0 && !loading && !error && <div className="veo-history-empty"><Film size={26} strokeWidth={1.5} aria-hidden="true" />Chưa có video nào.</div>}
      {history && history.items.length > 0 && (
        <>
          <p className="veo-history-range" aria-live="polite">Hiển thị {count.format(first + 1)}–{count.format(first + history.items.length)}</p>
          <ul className="veo-history-grid">
            {history.items.map((item) => {
              const url = getVideoStreamUrl(item.video_id)
              const name = item.prompt || item.file_name
              const meta = [item.model_display_name, item.aspect_ratio, item.file_size_bytes > 0 ? `${(item.file_size_bytes / 1024 / 1024).toFixed(1)} MB` : ''].filter(Boolean).join(' · ')
              return (
                <li className="veo-history-card" key={item.file_name} data-selected={selectedVideoId === item.video_id || selectedVideoId === item.file_name}>
                  <button type="button" className="veo-history-thumbnail" title={name} aria-label={`Xem video ${item.file_name}`} onClick={() => onSelect(item)}>
                    <VideoThumbnail url={url} />
                    <span className="veo-history-play" aria-hidden="true"><Play size={14} /></span>
                    {item.duration_seconds > 0 && <span className="veo-history-duration">{seconds.format(item.duration_seconds)}s</span>}
                  </button>
                  <div className="veo-history-details">
                    <strong title={name}>{name}</strong>
                    <small title={meta}>{meta}</small>
                  </div>
                  <div className="veo-history-actions">
                    <a className="veo-history-icon" href={url} download={item.file_name} title="Tải video" aria-label="Tải video"><Download size={15} /></a>
                    {onSaveLastFrameToLibrary && (
                      <button type="button" className="veo-history-icon" title="Lưu khung hình cuối vào Thư viện Ảnh Veo" aria-label="Lưu khung hình cuối" disabled={extractingVideoId === item.video_id} onClick={() => onSaveLastFrameToLibrary(item)}>
                        {extractingVideoId === item.video_id ? <Loader2 size={15} className="spinning" /> : <ImageDown size={15} />}
                      </button>
                    )}
                    {onSendToEditor && <button type="button" className="veo-history-icon" title="Chuyển sang Video Editor" aria-label="Chuyển sang Video Editor" onClick={() => onSendToEditor(item)}><Edit3 size={15} /></button>}
                    {onSendToSchedule && <button type="button" className="veo-history-icon" title="Lên lịch đăng" aria-label="Lên lịch đăng" onClick={() => onSendToSchedule(item)}><Send size={15} /></button>}
                    <button type="button" className="veo-history-icon" title="Xóa video" aria-label="Xóa video" onClick={() => onDelete(item.video_id)}><Trash2 size={15} /></button>
                  </div>
                </li>
              )
            })}
          </ul>
          {history.items.length > 6 && <LibraryPagination data={history} loading={loading} label="Phân trang video ở cuối danh sách" onPage={(next) => {
            void load(next)
            header.current?.scrollIntoView({ block: 'start' })
          }} />}
        </>
      )}
    </section>
  )
}
