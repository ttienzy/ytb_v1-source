/**
 * Node "Video tham chiếu" của Muse Canvas — độc lập, đúng 1 video/node: tải từ máy (qua /api/ai/muse/upload,
 * lưu Data/media/muse_uploads) hoặc chọn trong Thư Viện Video (giữ đường dẫn file sẵn có, không chép).
 * Cổng ra "refvideo" nối vào Ingredients, Cắt video hoặc Ghép video.
 */
import { memo, useRef, useState } from 'react'
import { Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import { MuseMediaIcon, MuseMediaPort } from './MuseMediaPort'
import { Camera, Film, Library, Loader2, RefreshCw, Video, X } from 'lucide-react'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  VIDEO_REF_ACCEPT,
  VIDEO_REF_MAX_BYTES,
  createInputNode,
  museNodeId,
  normalizeVideoRefData,
  validateVideoRefFile,
  videoRefMeta,
  type MuseVideoRef,
} from '../../services/museCanvasNodes.ts'
import { museMediaUrl, uploadMuseImage } from '../../services/museCanvasApi.ts'
import { useMuseCanvas } from '../../components/museCanvasContext'
import { NodeDeleteButton } from './NodeDeleteButton'

type VideoRefNode = Node<Record<string, unknown>, string>

const CAPTURE_FRAME_LABEL = 'Tách khung hình thành node Nhân vật tham chiếu'

function MuseVideoRefNodeImpl({ id, data: raw, selected }: NodeProps<VideoRefNode>) {
  const { addNodes, getNode, getNodes, getIntersectingNodes, getNodesBounds, updateNodeData } = useReactFlow()
  const { pickLibraryVideo } = useMuseCanvas()
  const data = normalizeVideoRefData(raw)
  const video = data.video
  const inputRef = useRef<HTMLInputElement>(null)
  const playerRef = useRef<HTMLVideoElement>(null)
  const [uploading, setUploading] = useState(false)
  const [capturing, setCapturing] = useState(false)
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

  async function captureFrame() {
    const player = playerRef.current
    if (capturing || uploading || !player) return
    if (player.seeking || player.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || !player.videoWidth || !player.videoHeight) {
      setError('Khung hình chưa sẵn sàng. Đợi video hiển thị rồi thử lại.')
      return
    }

    setError('')
    setCapturing(true)
    try {
      const timeMs = Math.round(player.currentTime * 1000)
      const canvas = document.createElement('canvas')
      canvas.width = player.videoWidth
      canvas.height = player.videoHeight
      const context = canvas.getContext('2d')
      if (!context) throw new Error('Không thể đọc khung hình video.')
      context.drawImage(player, 0, 0)
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
      if (!blob) throw new Error('Không thể lưu khung hình video.')

      const image = await uploadMuseImage(new File([blob], `frame-${timeMs}ms.jpg`, { type: blob.type }))
      const source = getNode(id)
      if (!source) return
      const gap = 32
      const area = { x: source.position.x, y: source.position.y + (source.measured?.height ?? 420) + gap, width: 260, height: 360 }
      const measuredNodes = getNodes().filter((node) => node.measured?.width && node.measured.height)
      let overlapping = getIntersectingNodes(area, true, measuredNodes)
      while (overlapping.length) {
        const bounds = getNodesBounds(overlapping)
        area.y = bounds.y + bounds.height + gap
        overlapping = getIntersectingNodes(area, true, measuredNodes)
      }
      const node = createInputNode(MUSE_NODE.character, { x: area.x, y: area.y })
      addNodes({ ...node, data: { ...node.data, image: { id: museNodeId('frame'), ...image } } })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Không thể tách khung hình video.')
    } finally {
      setCapturing(false)
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
        <MuseMediaIcon kind="Video" />
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small>1 video mẫu · Ingredients, Cắt, Ghép</small>
        </div>
        <NodeDeleteButton nodeId={id} confirmText={video ? `Xóa node “${data.label.trim() || data.title}”? File video vẫn còn trên máy.` : undefined} />
      </div>

      <div className="mc-node-body">
        <div className="mc-videoref-label">
          <input
            className="mc-node-input nodrag"
            value={data.label}
            maxLength={60}
            placeholder="Tên video (tùy chọn), vd. Mẫu catwalk xoay váy"
            onChange={(e) => updateNodeData(id, { label: e.target.value })}
          />
          <button
            type="button"
            className="mc-mini-btn nodrag"
            title={CAPTURE_FRAME_LABEL}
            aria-label={CAPTURE_FRAME_LABEL}
            aria-busy={capturing}
            disabled={!video || uploading || capturing}
            onClick={captureFrame}
          >
            {capturing ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
          </button>
        </div>

        {video ? (
          <div className={`mc-videoref-preview nodrag ${dragOver ? 'over' : ''}`} {...dropProps} title={video.path}>
            <video
              key={video.path}
              ref={playerRef}
              crossOrigin="anonymous"
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

      <MuseMediaPort
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.refVideoOut}
        kind="Video"
        label="Video tham chiếu"
        title="Nối vào cổng “Video” của Ingredients hoặc Cắt video, hoặc cổng “Clip” của Ghép video"
      />
    </div>
  )
}

export const MuseVideoRefNode = memo(MuseVideoRefNodeImpl)
