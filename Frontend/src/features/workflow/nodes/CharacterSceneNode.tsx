import React, { useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { User, Image as ImageIcon, Upload, X, CheckCircle2, Trash2, ImageDown } from 'lucide-react'
import type { CharacterSceneNodeData } from '../types'
import type { AssetRef } from '../contracts'
import { uploadWorkflowAsset } from '../services/workflowApi'
import { VeoImagePickerModal } from '../components/VeoImagePickerModal'

interface CharacterSceneNodeProps {
  data: CharacterSceneNodeData
  selected?: boolean
}

export function CharacterSceneNode({ data, selected }: CharacterSceneNodeProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const currentSlotRef = useRef<'modelImage' | 'sceneImage'>('modelImage')
  const [veoPickerOpen, setVeoPickerOpen] = useState(false)
  const [activeSlot, setActiveSlot] = useState<'modelImage' | 'sceneImage'>('modelImage')

  const handleSlotClick = (slot: 'modelImage' | 'sceneImage') => {
    currentSlotRef.current = slot
    fileInputRef.current?.click()
  }

  const handleOpenVeoModal = (slot: 'modelImage' | 'sceneImage') => {
    setActiveSlot(slot)
    setVeoPickerOpen(true)
  }

  const handleSelectVeoImage = (dataUrl: string, assetRef: AssetRef) => {
    data.onChange?.(activeSlot, dataUrl, assetRef)
  }


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const slot = currentSlotRef.current
    const kind = slot === 'modelImage' ? 'model' : 'scene'
    const reader = new FileReader()
    reader.onload = (event) => {
      const url = event.target?.result as string
      data.onChange?.(slot, url)

      // Upload lên Backend trong nền
      uploadWorkflowAsset(file, kind)
        .then((assetRef) => {
          data.onChange?.(slot, url, assetRef)
        })
        .catch((err) => {
          console.warn('Lỗi khi upload asset lên backend:', err)
        })
    }
    reader.readAsDataURL(file)
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent, slot: 'modelImage' | 'sceneImage') => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    const kind = slot === 'modelImage' ? 'model' : 'scene'
    const reader = new FileReader()
    reader.onload = (event) => {
      const url = event.target?.result as string
      data.onChange?.(slot, url)

      // Upload lên Backend trong nền
      uploadWorkflowAsset(file, kind)
        .then((assetRef) => {
          data.onChange?.(slot, url, assetRef)
        })
        .catch((err) => {
          console.warn('Lỗi khi upload asset lên backend:', err)
        })
    }
    reader.readAsDataURL(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleRemove = (e: React.MouseEvent, slot: 'modelImage' | 'sceneImage') => {
    e.stopPropagation()
    data.onChange?.(slot, null)
  }

  const count = [data.modelImage, data.sceneImage].filter(Boolean).length

  const isStartNode = data.isStartNode ?? false
  const isOrphan = data.isOrphan ?? false

  return (
    <div
      className={`wf-node-card ${selected ? 'selected' : ''} ${isStartNode ? 'is-start-node' : ''} ${isOrphan ? 'is-orphan' : ''}`}
      style={{ width: 350 }}
    >
      {isStartNode && (
        <div className="wf-start-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="wf-start-dot" />
            <span>⭐ NODE CHÍNH (ĐIỂM KHỞI ĐẦU)</span>
          </div>
          <span style={{ fontSize: 9, opacity: 0.9 }}>Root Trigger</span>
        </div>
      )}

      {/* Header */}
      <div className="wf-node-header" style={{ background: '#f5f3ff', borderBottom: '1px solid #ede9fe' }}>
        <div className="wf-node-title-group">
          <div
            className="wf-node-icon"
            style={{
              background: 'linear-gradient(135deg, #8b5cf6, #7c3aed)',
              color: '#ffffff',
              boxShadow: '0 2px 6px rgba(124, 58, 237, 0.3)',
            }}
          >
            <User size={15} />
          </div>
          <div>
            <div className="wf-node-title" style={{ color: '#4c1d95' }}>
              {data.title || 'Nhân Vật & Bối Cảnh'}
            </div>
            <div style={{ fontSize: 10, color: '#7c3aed', fontWeight: 600 }}>
              Người mẫu / MC & Không gian quay
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
            <span style={{ fontSize: 13 }}>{isStartNode ? '⭐' : '☆'}</span>
          </button>

          <span
            className="wf-node-badge"
            style={{
              background: count > 0 ? '#f5f3ff' : '#f8fafc',
              color: count > 0 ? '#7c3aed' : '#64748b',
              border: count > 0 ? '1px solid #ddd6fe' : '1px solid #e2e8f0',
            }}
          >
            {count}/2 Ảnh
          </span>
          <button
            type="button"
            className="wf-node-del-btn"
            onClick={(e) => {
              e.stopPropagation()
              data.onDelete?.()
            }}
            title="Xóa khối nhân vật & bối cảnh này"
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

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10, marginTop: 4 }}>
          {/* Slot 1: Model / Actor */}
          <div
            className="wf-asset-slot"
            onClick={() => handleSlotClick('modelImage')}
            onDrop={(e) => handleDrop(e, 'modelImage')}
            onDragOver={handleDragOver}
            title="Nhấp hoặc kéo thả ảnh người mẫu / KOL / MC"
            style={{
              background: data.modelImage ? '#0f172a' : '#f8fafc',
              border: data.modelImage ? '1px solid #cbd5e1' : '1px dashed #cbd5e1',
            }}
          >
            {data.modelImage ? (
              <>
                <img src={data.modelImage} alt="Model" className="wf-asset-preview-img" />
                <button
                  type="button"
                  className="wf-btn-veo-replace"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleOpenVeoModal('modelImage')
                  }}
                  title="Đổi ảnh từ Thư viện Veo"
                >
                  <ImageDown size={10} />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleRemove(e, 'modelImage')}
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
                  title="Xóa ảnh người mẫu"
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
                  Người mẫu / MC
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: '#f5f3ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 4,
                  }}
                >
                  <User size={13} color="#7c3aed" />
                </div>
                <div className="wf-asset-slot-label">Người mẫu / KOL</div>
                <div className="wf-asset-slot-sub">Kéo thả / Chọn</div>
                <button
                  type="button"
                  className="wf-btn-veo-library"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleOpenVeoModal('modelImage')
                  }}
                  title="Chọn ảnh từ Thư viện Veo Studio"
                >
                  <ImageDown size={11} />
                  <span>Thư viện Veo</span>
                </button>
              </>
            )}
          </div>

          {/* Slot 2: Scene / Background */}
          <div
            className="wf-asset-slot"
            onClick={() => handleSlotClick('sceneImage')}
            onDrop={(e) => handleDrop(e, 'sceneImage')}
            onDragOver={handleDragOver}
            title="Nhấp hoặc kéo thả ảnh bối cảnh quay"
            style={{
              background: data.sceneImage ? '#0f172a' : '#f8fafc',
              border: data.sceneImage ? '1px solid #cbd5e1' : '1px dashed #cbd5e1',
            }}
          >
            {data.sceneImage ? (
              <>
                <img src={data.sceneImage} alt="Scene" className="wf-asset-preview-img" />
                <button
                  type="button"
                  className="wf-btn-veo-replace"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleOpenVeoModal('sceneImage')
                  }}
                  title="Đổi ảnh từ Thư viện Veo"
                >
                  <ImageDown size={10} />
                </button>
                <button
                  type="button"
                  onClick={(e) => handleRemove(e, 'sceneImage')}
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
                  title="Xóa ảnh bối cảnh"
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
                  Bối cảnh quay
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: '50%',
                    background: '#f5f3ff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 4,
                  }}
                >
                  <ImageIcon size={13} color="#7c3aed" />
                </div>
                <div className="wf-asset-slot-label">Bối cảnh / Nền</div>
                <div className="wf-asset-slot-sub">Kéo thả / Chọn</div>
                <button
                  type="button"
                  className="wf-btn-veo-library"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleOpenVeoModal('sceneImage')
                  }}
                  title="Chọn ảnh từ Thư viện Veo Studio"
                >
                  <ImageDown size={11} />
                  <span>Thư viện Veo</span>
                </button>
              </>
            )}
          </div>
        </div>

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 11, color: '#64748b' }}>
            Tham chiếu hình thể & môi trường
          </span>
          <span
            style={{
              fontSize: 11,
              color: count > 0 ? '#059669' : '#94a3b8',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontWeight: 600,
            }}
          >
            <CheckCircle2 size={12} /> {count > 0 ? `Đã nạp ${count}/2` : 'Tùy chọn'}
          </span>
        </div>
      </div>

      {/* Output Handle to GPT Script Node (points down) */}
      <Handle
        type="source"
        position={Position.Bottom}
        id="to-gpt"
        style={{ left: '50%' }}
        className="wf-handle wf-handle-source"
        title="Dòng tham chiếu sang ChatGPT"
      />

      {/* Output Handle directly to Flow Studio (points right) */}
      <Handle
        type="source"
        position={Position.Right}
        id="to-flow"
        style={{ top: '50%' }}
        className="wf-handle wf-handle-source"
        title="Dòng tham chiếu nhân vật sang Flow Studio"
      />

      <VeoImagePickerModal
        isOpen={veoPickerOpen}
        onClose={() => setVeoPickerOpen(false)}
        onSelect={handleSelectVeoImage}
        targetLabel={activeSlot === 'modelImage' ? 'Nhân vật: Người mẫu / KOL' : 'Nhân vật: Bối cảnh / Nền'}
        kind={activeSlot === 'modelImage' ? 'model' : 'scene'}
      />
    </div>
  )
}
