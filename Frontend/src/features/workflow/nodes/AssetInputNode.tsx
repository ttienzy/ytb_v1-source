import React, { useRef } from 'react'
import { Handle, Position } from '@xyflow/react'
import { Image as ImageIcon, Upload, X, CheckCircle2, Layers, Trash2 } from 'lucide-react'
import type { AssetInputNodeData } from '../types'

interface AssetInputNodeProps {
  data: AssetInputNodeData
  selected?: boolean
}

export function AssetInputNode({ data, selected }: AssetInputNodeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentSlotRef = useRef<'product' | 'model' | 'scene'>('product')

  const handleSlotClick = (slot: 'product' | 'model' | 'scene') => {
    currentSlotRef.current = slot
    fileInputRef.current?.click()
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const reader = new FileReader()
    reader.onload = (event) => {
      const url = event.target?.result as string
      const slot = currentSlotRef.current
      if (slot === 'product') data.onChange?.('productImage', url)
      else if (slot === 'model') data.onChange?.('modelImage', url)
      else if (slot === 'scene') data.onChange?.('sceneImage', url)
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleRemove = (e: React.MouseEvent, slot: 'product' | 'model' | 'scene') => {
    e.stopPropagation()
    if (slot === 'product') data.onChange?.('productImage', null)
    else if (slot === 'model') data.onChange?.('modelImage', null)
    else if (slot === 'scene') data.onChange?.('sceneImage', null)
  }

  const assetCount = [data.productImage, data.modelImage, data.sceneImage].filter(Boolean).length

  return (
    <div className={`wf-node-card ${selected ? 'selected' : ''}`} style={{ width: 340 }}>
      {/* Target handle if linked from library */}
      <Handle type="target" position={Position.Left} className="wf-handle wf-handle-target" />

      {/* Header */}
      <div className="wf-node-header">
        <div className="wf-node-title-group">
          <div className="wf-node-icon wf-icon-blue">
            <Layers size={15} />
          </div>
          <div>
            <div className="wf-node-title">Nguyên Liệu Đầu Vào</div>
            <div style={{ fontSize: 10, color: '#94a3b8' }}>Ảnh tham chiếu (Tối đa 3 ảnh)</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="wf-node-badge wf-badge-assets">
            {assetCount}/3 Ảnh
          </span>
          <button
            type="button"
            className="wf-node-del-btn"
            onClick={(e) => {
              e.stopPropagation()
              data.onDelete?.()
            }}
            title="Xóa khối nguyên liệu này"
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
          {/* Slot 1: Product */}
          <div
            className="wf-asset-slot"
            onClick={() => handleSlotClick('product')}
            title="Nhấp để tải ảnh sản phẩm chính"
          >
            {data.productImage ? (
              <>
                <img src={data.productImage} alt="Product" className="wf-asset-preview-img" />
                <button
                  type="button"
                  onClick={(e) => handleRemove(e, 'product')}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    borderRadius: '50%',
                    width: 18,
                    height: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  title="Xóa ảnh"
                >
                  <X size={10} />
                </button>
              </>
            ) : (
              <>
                <Upload size={18} color="#94a3b8" />
                <div className="wf-asset-slot-label">Sản phẩm</div>
                <div className="wf-asset-slot-sub">Bắt buộc</div>
              </>
            )}
          </div>

          {/* Slot 2: Model */}
          <div
            className="wf-asset-slot"
            onClick={() => handleSlotClick('model')}
            title="Nhấp để tải ảnh người mẫu / diễn viên"
          >
            {data.modelImage ? (
              <>
                <img src={data.modelImage} alt="Model" className="wf-asset-preview-img" />
                <button
                  type="button"
                  onClick={(e) => handleRemove(e, 'model')}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    borderRadius: '50%',
                    width: 18,
                    height: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  title="Xóa ảnh"
                >
                  <X size={10} />
                </button>
              </>
            ) : (
              <>
                <Upload size={18} color="#94a3b8" />
                <div className="wf-asset-slot-label">Người mẫu</div>
                <div className="wf-asset-slot-sub">Tùy chọn</div>
              </>
            )}
          </div>

          {/* Slot 3: Scene */}
          <div
            className="wf-asset-slot"
            onClick={() => handleSlotClick('scene')}
            title="Nhấp để tải ảnh bối cảnh / môi trường"
          >
            {data.sceneImage ? (
              <>
                <img src={data.sceneImage} alt="Scene" className="wf-asset-preview-img" />
                <button
                  type="button"
                  onClick={(e) => handleRemove(e, 'scene')}
                  style={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    background: 'rgba(0,0,0,0.7)',
                    color: '#fff',
                    borderRadius: '50%',
                    width: 18,
                    height: 18,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                  title="Xóa ảnh"
                >
                  <X size={10} />
                </button>
              </>
            ) : (
              <>
                <Upload size={18} color="#94a3b8" />
                <div className="wf-asset-slot-label">Bối cảnh</div>
                <div className="wf-asset-slot-sub">Tùy chọn</div>
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#94a3b8' }}>
            Tự động truyền sang Veo Clip
          </span>
          <span style={{ fontSize: 11, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4 }}>
            <CheckCircle2 size={12} /> Sẵn sàng
          </span>
        </div>
      </div>

      {/* Source Output Handles */}
      {/* 1. To GPT script node */}
      <Handle
        type="source"
        position={Position.Right}
        id="to-gpt"
        style={{ top: '40%' }}
        className="wf-handle wf-handle-source"
      />
      {/* 2. Direct to Veo Video nodes */}
      <Handle
        type="source"
        position={Position.Right}
        id="to-veo"
        style={{ top: '75%' }}
        className="wf-handle wf-handle-source"
      />
    </div>
  )
}
