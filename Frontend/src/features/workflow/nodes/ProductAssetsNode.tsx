import React, { useLayoutEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { ShoppingBag, Upload, X, CheckCircle2, Trash2, Plus, Sparkles, ImageDown, Star } from 'lucide-react'
import type { ProductAssetsNodeData } from '../types'
import type { AssetRef } from '../contracts'
import { uploadWorkflowAsset } from '../services/workflowApi'
import { createAssetUploadManager } from '../services/assetUpload'
import { VeoImagePickerModal } from '../components/VeoImagePickerModal'

interface ProductAssetsNodeProps {
  data: ProductAssetsNodeData
  selected?: boolean
}

export function ProductAssetsNode({ data, selected }: ProductAssetsNodeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeSlotIndexRef = useRef<number>(0)
  const [veoPickerOpen, setVeoPickerOpen] = useState(false)
  const [activePickerSlot, setActivePickerSlot] = useState<number>(0)
  const onChangeRef = useRef(data.onChangeImage)
  onChangeRef.current = data.onChangeImage
  const uploads = useRef<ReturnType<typeof createAssetUploadManager<number>> | null>(null)
  useLayoutEffect(() => {
    const manager = createAssetUploadManager<number>({
      upload: uploadWorkflowAsset,
      onChange: (slot, url, asset) => onChangeRef.current?.(slot, url, asset),
    })
    uploads.current = manager
    return () => {
      manager.dispose()
      uploads.current = null
    }
  }, [])

  const images = data.images || [null, null, null]
  const imageCount = images.filter(Boolean).length

  const handleSlotClick = (index: number) => {
    activeSlotIndexRef.current = index
    fileInputRef.current?.click()
  }

  const handleOpenVeoModal = (index: number) => {
    setActivePickerSlot(index)
    setVeoPickerOpen(true)
  }


  const handleSelectVeoImage = (dataUrl: string, assetRef: AssetRef) => {
    uploads.current?.replace(activePickerSlot, dataUrl, assetRef)
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    void uploads.current?.start(activeSlotIndexRef.current, file, 'product')
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    void uploads.current?.start(index, file, 'product')
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleRemove = (e: React.MouseEvent, index: number) => {
    e.stopPropagation()
    uploads.current?.remove(index)
  }

  const slotLabels = ['Ảnh chính', 'Góc nghiêng', 'Chi tiết / Tem']

  const isStartNode = data.isStartNode ?? false
  const isOrphan = data.isOrphan ?? false

  return (
    <div
      className={`wf-node-card wf-node-products ${selected ? 'selected' : ''} ${isStartNode ? 'is-start-node' : ''} ${isOrphan ? 'is-orphan' : ''}`}
      style={{ width: 350 }}
    >
      {isStartNode && (
        <div className="wf-start-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="wf-start-dot" />
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Star size={11} fill="#ffffff" color="#ffffff" /> NODE CHÍNH (ĐIỂM KHỞI ĐẦU)
            </span>
          </div>
          <span style={{ fontSize: 9, opacity: 0.9 }}>Root Trigger</span>
        </div>
      )}

      {/* Target handle if connected from asset library */}
      <Handle type="target" position={Position.Left} className="wf-handle wf-handle-target" />

      {/* Header */}
      <div className="wf-node-header">
        <div className="wf-node-title-group">
          <div className="wf-node-icon">
            <ShoppingBag size={15} />
          </div>
          <div>
            <div className="wf-node-title">
              {data.title || 'Ảnh Sản Phẩm (Products)'}
            </div>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>
              Đầu vào hình ảnh gốc (Tối đa 3 ảnh)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {isOrphan && (
            <span className="wf-orphan-badge" title="Node này chưa được nối dây với quy trình">
              Chưa nối
            </span>
          )}

          <button
            type="button"
            className={`wf-node-star-btn ${isStartNode ? 'is-active' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              data.onSetStartNode?.()
            }}
            title={isStartNode ? 'Node chính bắt đầu quy trình' : 'Nhấp để đặt làm Node chính'}
          >
            <Star
              size={12}
              fill={isStartNode ? '#d97706' : 'none'}
              color={isStartNode ? '#d97706' : '#94a3b8'}
            />
          </button>

          <span
            className="wf-node-badge"
            style={{
              background: imageCount > 0 ? '#ecfdf5' : '#f0fdfa',
              color: imageCount > 0 ? '#065f46' : '#0d9488',
              border: imageCount > 0 ? '1px solid #d1fae5' : '1px solid #99f6e4',
            }}
          >
            {imageCount}/3 Ảnh
          </span>
          <button
            type="button"
            className="wf-node-del-btn"
            onClick={(e) => {
              e.stopPropagation()
              uploads.current?.dispose()
              data.onDelete?.()
            }}
            title="Xóa khối sản phẩm này"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="wf-node-body">
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          accept="image/*"
          onChange={handleFileChange}
        />

        <div className="wf-asset-slot-grid">
          {[0, 1, 2].map((idx) => {
            const imgUrl = images[idx]
            const asset = data.assets?.[idx]
            return (
              <div
                key={idx}
                className="wf-asset-slot"
                onClick={() => handleSlotClick(idx)}
                onDrop={(e) => handleDrop(e, idx)}
                onDragOver={handleDragOver}
                title={`Nhấp hoặc kéo thả để tải ${slotLabels[idx]}`}
                style={{
                  background: imgUrl ? '#0f172a' : '#f8fafc',
                  border: imgUrl ? '1px solid #cbd5e1' : '1px dashed #cbd5e1',
                }}
              >
                {imgUrl ? (
                  <>
                    <img src={imgUrl} alt={`Product ${idx + 1}`} className="wf-asset-preview-img" />
                    <button
                      type="button"
                      className="wf-btn-veo-replace"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenVeoModal(idx)
                      }}
                      title="Đổi ảnh từ Thư viện Veo"
                    >
                      <ImageDown size={10} />
                    </button>
                    <button
                      type="button"
                      onClick={(e) => handleRemove(e, idx)}
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        background: 'rgba(0,0,0,0.75)',
                        color: '#fff',
                        borderRadius: '50%',
                        width: 18,
                        height: 18,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        border: 'none',
                        cursor: 'pointer',
                        zIndex: 2,
                      }}
                      title="Xóa ảnh này"
                    >
                      <X size={10} />
                    </button>
                    <div
                      style={{
                        position: 'absolute',
                        bottom: 0,
                        insetInline: 0,
                        background: 'rgba(0,0,0,0.6)',
                        color: '#fff',
                        fontSize: 9,
                        padding: '2px 0',
                        textAlign: 'center',
                        fontWeight: 600,
                      }}
                    >
                      {slotLabels[idx]}
                    </div>
                  </>
                ) : (
                  <>
                    <div
                      style={{
                        width: 26,
                        height: 26,
                        borderRadius: '50%',
                        background: '#f0fdfa',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 4,
                      }}
                    >
                      <Upload size={13} color="#0d9488" />
                    </div>
                    <div className="wf-asset-slot-label">{slotLabels[idx]}</div>
                    <div className="wf-asset-slot-sub">Kéo thả / Chọn</div>
                    <button
                      type="button"
                      className="wf-btn-veo-library"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenVeoModal(idx)
                      }}
                      title="Chọn ảnh từ Thư viện Veo Studio"
                    >
                      <ImageDown size={11} />
                      <span>Thư viện Veo</span>
                    </button>
                  </>
                )}
                {(asset?.uploadStatus === 'uploading' || asset?.uploadStatus === 'error') && (
                  <div
                    role={asset.uploadStatus === 'error' ? 'alert' : 'status'}
                    style={{ position: 'absolute', bottom: 18, insetInline: 2, padding: 3, background: '#fff', color: asset.uploadStatus === 'error' ? '#b91c1c' : '#1d4ed8', fontSize: 10, zIndex: 1, maxHeight: '60%', overflowY: 'auto' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {asset.uploadStatus === 'uploading' ? 'Đang tải ảnh…' : `Tải ảnh thất bại: ${asset.error || 'Vui lòng chọn lại ảnh.'}`}
                    {asset.uploadStatus === 'error' && uploads.current?.canRetry(idx) && (
                      <button type="button" className="nodrag" onClick={() => { void uploads.current?.retry(idx) }}>Thử lại</button>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            Nguồn ảnh sản phẩm chính
          </span>
          <span
            style={{
              fontSize: 11,
              color: imageCount > 0 ? '#059669' : '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={12} /> {imageCount > 0 ? `Đã nạp ${imageCount} ảnh` : 'Chờ tải ảnh'}
          </span>
        </div>
      </div>

      {/* Downward source handle: points straight down to Gemini Vision */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="to-gemini"
        style={{ left: '50%' }}
        className="wf-handle wf-handle-source"
        title="Dòng phân tích sang Gemini Vision"
      />

      {/* Rightward source handle: points across to Flow Studio */}
      <Handle
        type="source"
        position={Position.Right}
        id="to-flow"
        style={{ top: '45%' }}
        className="wf-handle wf-handle-source"
        title="Dòng ảnh tham chiếu sang Flow Studio"
      />

      {/* Rightward source handle: points to GPT Script */}
      <Handle
        type="source"
        position={Position.Right}
        id="to-gpt"
        style={{ top: '75%' }}
        className="wf-handle wf-handle-source"
        title="Dòng thông tin sản phẩm sang ChatGPT"
      />

      <VeoImagePickerModal
        isOpen={veoPickerOpen}
        onClose={() => setVeoPickerOpen(false)}
        onSelect={handleSelectVeoImage}
        targetLabel={`Sản phẩm: ${slotLabels[activePickerSlot]}`}
        kind="product"
      />
    </div>
  )
}
