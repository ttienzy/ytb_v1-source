import { useRef, useState } from 'react'
import { Film, Link2, Loader2, Trash2, UploadCloud } from 'lucide-react'
import { API_URL } from '../../shared/constants'
import { formatDuration, formatSize } from './videoModel'
import type { VideoWorkspace } from './useVideoWorkspace'

type SourceProps = Pick<VideoWorkspace, 'videos' | 'selected' | 'toggleSelected' | 'toggleAll' | 'upload' | 'importYoutube' | 'remove' | 'busy' | 'youtubeBusy'>

/** Kho video nguồn: thêm (máy / YouTube) gọn một hàng, danh sách tự cuộn, bấm cả dòng để chọn. Video chọn đầu tiên là video xem trước. */
export function SourceLibrary({ videos, selected, toggleSelected, toggleAll, upload, importYoutube, remove, busy, youtubeBusy }: SourceProps) {
  const [mode, setMode] = useState<'local' | 'youtube'>('local')
  const [url, setUrl] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const allSelected = videos.length > 0 && selected.length === videos.length

  async function submitYoutube() {
    if (await importYoutube(url)) setUrl('')
  }

  return (
    <section
      className={`vp-card vp-lib ${dragging ? 'dragging' : ''}`}
      onDragOver={event => { if (mode === 'local') { event.preventDefault(); setDragging(true) } }}
      onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragging(false) }}
      onDrop={event => { if (mode !== 'local') return; event.preventDefault(); setDragging(false); upload(event.dataTransfer.files) }}
    >
      <div className="vp-card-head">
        <strong>Kho video</strong>
        <span className="vp-count">{videos.length}</span>
        <div className="vp-seg small" role="tablist" aria-label="Nguồn video">
          <button type="button" role="tab" aria-selected={mode === 'local'} className={mode === 'local' ? 'active' : ''} onClick={() => setMode('local')}><UploadCloud size={13} /> Từ máy</button>
          <button type="button" role="tab" aria-selected={mode === 'youtube'} className={mode === 'youtube' ? 'active' : ''} onClick={() => setMode('youtube')}><Link2 size={13} /> YouTube</button>
        </div>
      </div>

      <div className="vp-add">
        {mode === 'local' ? (
          <>
            <button type="button" className="vp-drop" onClick={() => fileInput.current?.click()} disabled={busy}>
              {busy ? <Loader2 size={18} className="spin" /> : <UploadCloud size={18} />}
              <span><strong>Thả video vào đây hoặc bấm để chọn</strong><small>MP4, MOV, WEBM, MKV · chọn được nhiều file</small></span>
            </button>
            <input ref={fileInput} hidden type="file" multiple accept="video/*" onChange={event => { upload(event.target.files); event.currentTarget.value = '' }} />
          </>
        ) : (
          <div className="vp-youtube">
            <input value={url} onChange={event => setUrl(event.target.value)} placeholder="Dán link YouTube (https://www.youtube.com/watch?v=…)" onKeyDown={event => { if (event.key === 'Enter') submitYoutube() }} disabled={youtubeBusy} aria-label="Link YouTube" />
            <button type="button" className="vp-primary small" onClick={submitYoutube} disabled={busy || youtubeBusy || !url.trim()}>
              {youtubeBusy ? <Loader2 size={14} className="spin" /> : <Film size={14} />} {youtubeBusy ? 'Đang tải…' : 'Tải về'}
            </button>
          </div>
        )}
      </div>

      {videos.length > 0 && (
        <div className="vp-list-tools">
          <label><input type="checkbox" checked={allSelected} onChange={toggleAll} /> Chọn tất cả</label>
          <span>{selected.length} đã chọn</span>
        </div>
      )}

      <div className="vp-list">
        {videos.length === 0 ? (
          <div className="vp-empty">Kho đang trống. Thêm video để bắt đầu.</div>
        ) : videos.map(video => {
          const isSelected = selected.includes(video.video_id)
          return (
            <div key={video.video_id} className={`vp-row ${isSelected ? 'selected' : ''}`} onClick={() => toggleSelected(video.video_id)} role="option" aria-selected={isSelected}>
              <input type="checkbox" checked={isSelected} onChange={() => toggleSelected(video.video_id)} onClick={event => event.stopPropagation()} aria-label={`Chọn ${video.name}`} />
              <video className="vp-thumb" src={`${API_URL}/api/video/library/${video.video_id}/file#t=0.5`} muted preload="metadata" />
              <div className="vp-row-copy">
                <strong title={video.name}>{video.name}</strong>
                <small>{formatDuration(video.duration_sec)} · {formatSize(video.size_bytes)}{selected[0] === video.video_id && <em> · đang xem trước</em>}</small>
              </div>
              <button type="button" className="vp-icon" title="Xóa khỏi kho" aria-label={`Xóa ${video.name}`} onClick={event => { event.stopPropagation(); remove(video.video_id) }}><Trash2 size={14} /></button>
            </div>
          )
        })}
      </div>
    </section>
  )
}
