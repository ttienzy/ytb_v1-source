/**
 * Node ảnh vào của Muse Canvas — đúng 1 ảnh/node: "Trang phục" (nối vào "Tách áo quần"),
 * "Nhân vật tham chiếu" (nối vào "Bảng thiết kế nhân vật" hoặc "Tách áo quần") và "Tham chiếu bối cảnh" (đưa ảnh địa điểm vào
 * cổng "Tham chiếu" của các node kịch bản). Loại node quyết định tiêu đề / chữ (INPUT_SPECS).
 */
import { memo, useRef, useState } from 'react'
import { Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import { MuseMediaIcon, MuseMediaPort } from './MuseMediaPort'
import { Download, ImagePlus, Library, Loader2, RefreshCw, X } from 'lucide-react'
import {
  INPUT_SPECS,
  MUSE_HANDLE,
  MUSE_NODE,
  OUTFIT_ACCEPT,
  normalizeInputData,
  validateOutfitFile,
  type MuseImageRef,
} from '../../services/museCanvasNodes.ts'
import { museMediaUrl, uploadMuseImage } from '../../services/museCanvasApi.ts'
import { NodeDeleteButton } from './NodeDeleteButton'
import { useMuseCanvas } from '../../components/museCanvasContext'

type InputNode = Node<Record<string, unknown>, string>

function MuseInputNodeImpl({ id, type, data: raw, selected }: NodeProps<InputNode>) {
  const { updateNodeData } = useReactFlow()
  const { pickLibraryImage } = useMuseCanvas()
  const spec = INPUT_SPECS[type] ?? INPUT_SPECS[MUSE_NODE.outfit]
  const isCharacter = type === MUSE_NODE.character
  const isScene = type === MUSE_NODE.scene
  const data = normalizeInputData(raw, spec.type)
  const inputRef = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [dragOver, setDragOver] = useState(false)

  async function setFile(file: File | undefined) {
    if (!file) return
    const err = validateOutfitFile(file)
    if (err) {
      setError(err)
      return
    }
    setError('')
    setUploading(true)
    try {
      const up = await uploadMuseImage(file)
      const image: MuseImageRef = { id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, ...up }
      // `images: undefined` bỏ trường cũ (bản lưu trước dùng mảng nhiều ảnh)
      updateNodeData(id, { image, images: undefined })
    } catch (e: any) {
      setError(e?.message || 'Tải ảnh lên thất bại')
    } finally {
      setUploading(false)
    }
  }

  async function pickFromLibrary() {
    const it = await pickLibraryImage(`Chọn ảnh cho “${data.label.trim() || data.title}”`)
    if (!it) return
    setError('')
    const image: MuseImageRef = { id: it.id, name: it.file_name, path: it.path, previewUrl: it.preview_url, size: it.size }
    updateNodeData(id, { image, images: undefined, ...(data.label.trim() ? {} : { label: it.label }) })
  }

  async function downloadImage() {
    const image = data.image
    if (!image || downloading) return
    setDownloading(true)
    setError('')
    try {
      const response = await fetch(museMediaUrl(image.previewUrl))
      if (!response.ok) throw new Error(`Tải ảnh về máy thất bại (HTTP ${response.status}).`)
      const url = URL.createObjectURL(await response.blob())
      const link = document.createElement('a')
      link.href = url
      link.download = image.name
      document.body.appendChild(link)
      link.click()
      link.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Tải ảnh về máy thất bại.')
    } finally {
      setDownloading(false)
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
    <div className={`mc-node mc-node-outfit ${isCharacter ? 'mc-node-character' : ''} ${isScene ? 'mc-node-scene' : ''} ${selected ? 'selected' : ''}`}>
      <div className="mc-node-head">
        <MuseMediaIcon kind="Image" />
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small>{spec.subtitle}</small>
        </div>
        <NodeDeleteButton nodeId={id} confirmText={data.image ? `Xóa node “${data.label.trim() || data.title}”? Dây nối với nó cũng bị xóa.` : undefined} />
      </div>

      <div className="mc-node-body">
        <input
          className="mc-node-input nodrag"
          value={data.label}
          maxLength={60}
          placeholder={spec.labelPlaceholder}
          onChange={(e) => updateNodeData(id, { label: e.target.value })}
        />

        {data.image ? (
          <div className={`mc-outfit-preview nodrag ${dragOver ? 'over' : ''}`} {...dropProps} title={data.image.name}>
            <img src={museMediaUrl(data.image.previewUrl)} alt={data.image.name} draggable={false} />
            {uploading && (
              <div className="mc-outfit-busy">
                <Loader2 size={18} className="animate-spin" />
              </div>
            )}
            <div className="mc-outfit-tools">
              <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} title="Đổi sang ảnh khác trên máy">
                <RefreshCw size={12} /> Đổi ảnh
              </button>
              <button type="button" onClick={pickFromLibrary} disabled={uploading} title="Lấy ảnh từ Thư Viện Ảnh">
                <Library size={12} />
              </button>
              {isCharacter && (
                <button type="button" onClick={downloadImage} disabled={uploading || downloading} title="Tải ảnh về máy" aria-label="Tải ảnh về máy">
                  {downloading ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                </button>
              )}
              <button type="button" onClick={() => updateNodeData(id, { image: null, images: undefined })} disabled={uploading} title="Bỏ ảnh">
                <X size={12} />
              </button>
            </div>
            <span className="mc-outfit-name">{data.image.name}</span>
          </div>
        ) : (
          <div
            className={`mc-drop nodrag ${dragOver ? 'over' : ''}`}
            onClick={() => !uploading && inputRef.current?.click()}
            {...dropProps}
            role="button"
            tabIndex={0}
          >
            {uploading ? <Loader2 size={18} className="animate-spin" /> : <ImagePlus size={18} />}
            <span>{uploading ? 'Đang tải ảnh…' : 'Kéo thả hoặc bấm để chọn 1 ảnh'}</span>
            <small>PNG, JPG, WebP · tối đa 25 MB</small>
          </div>
        )}
        <input
          ref={inputRef}
          type="file"
          accept={OUTFIT_ACCEPT.join(',')}
          hidden
          onChange={(e) => {
            setFile(e.target.files?.[0])
            e.target.value = ''
          }}
        />
        {!data.image && (
          <button type="button" className="mc-mini-btn nodrag mc-lib-btn" onClick={pickFromLibrary} disabled={uploading}>
            <Library size={12} /> Chọn từ Thư Viện Ảnh
          </button>
        )}
        {error && <div className="mc-node-error">{error}</div>}
      </div>

      <MuseMediaPort
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.imagesOut}
        kind="Image"
        label={spec.rowLabel}
        title={
          isCharacter
            ? 'Nối vào node Bảng thiết kế nhân vật hoặc Tách áo quần'
            : isScene
              ? 'Nối vào cổng “Tham chiếu” của Kịch bản video / Kịch bản / Kịch bản tạo video'
              : 'Nối vào node Tách áo quần'
        }
      />
    </div>
  )
}

export const MuseInputNode = memo(MuseInputNodeImpl)
