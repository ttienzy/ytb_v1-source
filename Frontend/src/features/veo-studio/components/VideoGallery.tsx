import { Download, Edit3, Send, Trash2 } from 'lucide-react'
import type { VeoHistoryItem } from '../types'
import { getVideoStreamUrl } from '../services/veoApi'

interface Props {
  items: VeoHistoryItem[]
  onSelect: (item: VeoHistoryItem) => void
  onDelete: (videoId: string) => void
  onSendToEditor?: (item: VeoHistoryItem) => void
  onSendToSchedule?: (item: VeoHistoryItem) => void
}

export function VideoGallery({ items, onSelect, onDelete, onSendToEditor, onSendToSchedule }: Props) {
  if (items.length === 0) {
    return (
      <div className="veo-gallery-empty">
        <span>📭</span>
        <p>Chưa có video nào. Tạo video đầu tiên ở sidebar bên trái.</p>
      </div>
    )
  }

  return (
    <div className="veo-gallery">
      <h3 className="veo-gallery-title">Video đã tạo ({items.length})</h3>
      <div className="veo-gallery-grid">
        {items.map((item) => (
          <div className="veo-gallery-card" key={item.video_id}>
            <div
              className="veo-gallery-thumb"
              onClick={() => onSelect(item)}
            >
              <video
                src={getVideoStreamUrl(item.video_id)}
                muted
                preload="metadata"
              />
              <div className="veo-gallery-overlay">
                <span className="veo-gallery-duration">
                  {item.duration_seconds > 0 ? `${item.duration_seconds}s` : '—'}
                </span>
              </div>
            </div>
            <div className="veo-gallery-info">
              <strong title={item.prompt}>{item.prompt || item.file_name}</strong>
              <small>
                {item.model_display_name} · {item.aspect_ratio}
                {item.file_size_bytes > 0 && ` · ${(item.file_size_bytes / 1024 / 1024).toFixed(1)}MB`}
              </small>
            </div>
            <div className="veo-gallery-actions">
              <a
                href={getVideoStreamUrl(item.video_id)}
                download={item.file_name}
                className="veo-icon-btn"
                title="Tải về"
              >
                <Download size={14} />
              </a>
              {onSendToEditor && (
                <button
                  className="veo-icon-btn"
                  title="Chuyển sang Video Editor"
                  onClick={() => onSendToEditor(item)}
                >
                  <Edit3 size={14} />
                </button>
              )}
              {onSendToSchedule && (
                <button
                  className="veo-icon-btn"
                  title="Lên lịch đăng"
                  onClick={() => onSendToSchedule(item)}
                >
                  <Send size={14} />
                </button>
              )}
              <button
                className="veo-icon-btn danger"
                title="Xóa"
                onClick={() => onDelete(item.video_id)}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
