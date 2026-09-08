import React, { useRef } from 'react'
import { Handle, Position } from '@xyflow/react'
import { ShoppingBag, Upload, X, CheckCircle2, Trash2, Plus, Sparkles } from 'lucide-react'
import type { ProductAssetsNodeData } from '../types'

interface ProductAssetsNodeProps {
  data: ProductAssetsNodeData
  selected?: boolean
}

export function ProductAssetsNode({ data, selected }: ProductAssetsNodeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeSlotIndexRef = useRef<number>(0)

  const images = data.images || [null, null, null]
  const imageCount = images.filter(Boolean).length

  const handleSlotClick = (index: number) => {
    activeSlotIndexRef.current = index
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const url = event.target?.result as string
      data.onChangeImage?.(activeSlotIndexRef.current, url)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const url = event.target?.result as string
      data.onChangeImage?.(index, url)
    }
    reader.readAsDataURL(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleRemove = (e: React.MouseEvent, index: number) => {
    e.stopPropagation()
    data.onChangeImage?.(index, null)
  }

  const slotLabels = ['Ảnh chính', 'Góc nghiêng', 'Chi tiết / Tem']

  return (
    <div className={`wf-node-card ${selected ? 'selected' : ''}`} style={{ width: 350 }}>
      {/* Target handle if connected from asset library */}
      <Handle type="target" position={Position.Left} className="wf-handle wf-handle-target" />

      {/* Header */}
      <div className="wf-node-header" style={{ background: '#eff6ff', borderBottom: '1px solid #dbeafe' }}>
        <div className="wf-node-title-group">
          <div
            className="wf-node-icon"
            style={{
              background: 'linear-gradient(135deg, #3b82f6, #2563eb)',
              color: '#ffffff',
              boxShadow: '0 2px 6px rgba(37, 99, 235, 0.3)',
            }}
          >
            <ShoppingBag size={15} />
          </div>
          <div>
            <div className="wf-node-title" style={{ color: '#1e3a8a' }}>
              {data.title || 'Ảnh Sản Phẩm (Products)'}
            </div>
            <div style={{ fontSize: 10, color: '#2563eb', fontWeight: 600 }}>
              Đầu vào hình ảnh gốc (Tối đa 3 ảnh)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            className="wf-node-badge"
            style={{
              background: imageCount > 0 ? '#ecfdf5' : '#f8fafc',
              color: imageCount > 0 ? '#059669' : '#64748b',
              border: imageCount > 0 ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
            }}
          >
            {imageCount}/3 Ảnh
          </span>
          <button
            type="button"
            className="wf-node-del-btn"
            onClick={(e) => {
              e.stopPropagation()
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
                        background: '#eff6ff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        marginBottom: 4,
                      }}
                    >
                      <Upload size={13} color="#2563eb" />
                    </div>
                    <div className="wf-asset-slot-label">{slotLabels[idx]}</div>
                    <div className="wf-asset-slot-sub">Kéo thả / Chọn</div>
                  </>
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
    </div>
  )
}
