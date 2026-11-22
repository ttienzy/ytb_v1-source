/**
 * Node "Video tham chiếu" của Muse Canvas — độc lập, đúng 1 video/node: tải từ máy (qua /api/ai/muse/upload,
 * lưu Data/media/muse_uploads) hoặc chọn trong Thư Viện Video (giữ đường dẫn file sẵn có, không chép).
 * Node chỉ giữ đường dẫn + URL phát. Cổng ra "refvideo" nối vào cổng "Video" của node Ingredients (video + ảnh).
 */
import { memo, useRef, useState } from 'react'
import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import { Clapperboard, Film, Library, Loader2, RefreshCw, Video, X } from 'lucide-react'
import {
  MUSE_HANDLE,
  VIDEO_REF_ACCEPT,
  VIDEO_REF_MAX_BYTES,
  normalizeVideoRefData,
  validateVideoRefFile,
  videoRefMeta,
  type MuseVideoRef,
} from '../../services/museCanvasNodes.ts'
import { museMediaUrl, uploadMuseImage } from '../../services/museCanvasApi.ts'
import { useMuseCanvas } from '../../components/museCanvasContext'
import { NodeDeleteButton } from './NodeDeleteButton'

type VideoRefNode = Node<Record<string, unknown>, string>

function MuseVideoRefNodeImpl({ id, data: raw, selected }: NodeProps<VideoRefNode>) {
  const { updateNodeData } = useReactFlow()
  const { pickLibraryVideo } = useMuseCanvas()
  const data = normalizeVideoRefData(raw)
  const video = data.video
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)

  async function setFile(file: File | undefined) {
    if (!file) return
    const err = validateVideoRefFile(file)
    if (err) {
      setError(err)
      return
    }
    setError('')
    setUploading(true)
    try {
      // /api/ai/muse/upload nhận cả ảnh lẫn video (mp4 / webm / mov)
      const up = await uploadMuseImage(file)
      const v: MuseVideoRef = {
        id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
        name: up.name,
        path: up.path,
        previewUrl: up.previewUrl,
        size: up.size,
        durationSec: 0,
        source: 'upload',
      }
      updateNodeData(id, { video: v })
    } catch (e: any) {
      setError(e?.message || 'Tải video lên thất bại')
    } finally {
      setUploading(false)
    }
  }

  async function pickFromLibrary() {
    const clip = await pickLibraryVideo(`Chọn video cho “${data.label.trim() || data.title}”`)
    if (!clip) return
    if (!clip.filePath) {
      setError('Video này không có đường dẫn file trên máy — chọn video khác hoặc tải lên.')
      return
    }
    setError('')
    const v: MuseVideoRef = {
      id: clip.id,
      name: clip.filename,
      path: clip.filePath,
      previewUrl: clip.videoUrl,
      size: clip.sizeBytes || 0,
      durationSec: clip.durationSec || 0,
      source: 'library',
    }
    updateNodeData(id, { video: v, ...(data.label.trim() || !clip.title ? {} : { label: clip.title.slice(0, 60) }) })
  }

  /** Đọc thời lượng thật từ video (khi chưa biết, vd. video vừa tải lên). */
  function onMeta(e: React.SyntheticEvent<HTMLVideoElement>) {
    const d = e.currentTarget.duration
    if (video && Number.isFinite(d) && d > 0 && Math.abs(d - video.durationSec) > 0.05) {
      updateNodeData(id, { video: { ...video, durationSec: Math.round(d * 10) / 10 } })
    }
  }

  const dropProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(true)
    },
    onDragLeave: () => setDragOver(false),
    onDrop: (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(false)
      setFile(e.dataTransfer.files?.[0])
    },
  }

  return (
    <div className={`mc-node mc-node-outfit mc-node-videoref ${selected ? 'selected' : ''}`}>
      <div className="mc-node-head">
        <span className="mc-node-icon mc-icon-videoref">
          <Clapperboard size={14} />
        </span>
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small>1 video mẫu → node Ingredients</small>
        </div>
        <NodeDeleteButton nodeId={id} confirmText={video ? `Xóa node “${data.label.trim() || data.title}”? File video vẫn còn trên máy.` : undefined} />
      </div>

      <div className="mc-node-body">
        <input
          className="mc-node-input nodrag"
          value={data.label}
          maxLength={60}
          placeholder="Tên video (tùy chọn), vd. Mẫu catwalk xoay váy"
          onChange={(e) => updateNodeData(id, { label: e.target.value })}
        />

        {video ? (
          <div className={`mc-videoref-preview nodrag ${dragOver ? 'over' : ''}`} {...dropProps} title={video.path}>
            <video
              key={video.path}
              src={museMediaUrl(video.previewUrl)}
              controls
              muted
              playsInline
              preload="metadata"
              onLoadedMetadata={onMeta}
              className="nowheel"
            />
            {uploading && (
              <div className="mc-outfit-busy">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
            <div className="mc-outfit-tools">
              <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} title="Đổi sang video khác trên máy">
                <RefreshCw size={12} /> Đổi video
              </button>
              <button type="button" onClick={pickFromLibrary} disabled={uploading} title="Lấy video từ Thư Viện Video">
                <Library size={12} />
              </button>
              <button type="button" onClick={() => updateNodeData(id, { video: null })} disabled={uploading} title="Bỏ video (file vẫn còn trên máy)">
                <X size={12} />
              </button>
            </div>
            <span className="mc-outfit-name">
              {video.name}
              {videoRefMeta(video) ? ` · ${videoRefMeta(video)}` : ''}
              {video.source === 'library' ? ' · Thư Viện Video' : ''}
            </span>
          </div>
        ) : (
          <div
            className={`mc-drop nodrag ${dragOver ? 'over' : ''}`}
            onClick={() => !uploading && inputRef.current?.click()}
            {...dropProps}
            role="button"
            tabIndex={0}
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <Video size={18} />}
            <span>{uploading ? 'Đang tải video…' : 'Kéo thả hoặc bấm để chọn 1 video'}</span>
            <small>MP4, WebM, MOV · tối đa {VIDEO_REF_MAX_BYTES / 1024 / 1024} MB</small>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={VIDEO_REF_ACCEPT.join(',')}
          hidden
          onChange={(e) => {
            setFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {!video && (
          <button type="button" className="mc-mini-btn nodrag mc-lib-btn" onClick={pickFromLibrary} disabled={uploading}>
            <Film size={12} /> Chọn từ Thư Viện Video
          </button>
        )}
        {error && <div className="mc-node-error">{error}</div>}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.refVideoOut}
        className="mc-handle mc-handle-videoref"
        title="Nối vào cổng “Video” của node Ingredients (video + ảnh)"
      />
    </div>
  )
}

export const MuseVideoRefNode = memo(MuseVideoRefNodeImpl)
