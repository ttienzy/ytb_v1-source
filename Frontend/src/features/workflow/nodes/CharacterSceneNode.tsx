import React, { useLayoutEffect, useRef, useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import { User, Image as ImageIcon, Upload, X, CheckCircle2, Trash2, ImageDown, Sparkles, ChevronDown, ChevronUp, Star } from 'lucide-react'
import type { CharacterSceneNodeData } from '../types'
import type { AssetRef } from '../contracts'
import { uploadWorkflowAsset } from '../services/workflowApi'
import { createAssetUploadManager } from '../services/assetUpload'
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
  const [isProfilesOpen, setIsProfilesOpen] = useState(false)
  const onChangeRef = useRef(data.onChange)
  onChangeRef.current = data.onChange
  const uploads = useRef<ReturnType<typeof createAssetUploadManager<'modelImage' | 'sceneImage'>> | null>(null)
  useLayoutEffect(() => {
    const manager = createAssetUploadManager<'modelImage' | 'sceneImage'>({
      upload: uploadWorkflowAsset,
      onChange: (slot, url, asset) => onChangeRef.current?.(slot, url, asset),
    })
    uploads.current = manager
    return () => {
      manager.dispose()
      uploads.current = null
    }
  }, [])

  const handleSlotClick = (slot: 'modelImage' | 'sceneImage') => {
    currentSlotRef.current = slot
    fileInputRef.current?.click()
  }

  const handleOpenVeoModal = (slot: 'modelImage' | 'sceneImage') => {
    setActiveSlot(slot)
    setVeoPickerOpen(true)
  }

  const handleSelectVeoImage = (dataUrl: string, assetRef: AssetRef) => {
    uploads.current?.replace(activeSlot, dataUrl, assetRef)
  }


  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const slot = currentSlotRef.current
    void uploads.current?.start(slot, file, slot === 'modelImage' ? 'model' : 'scene')
    e.target.value = ''
  }

  const handleDrop = (e: React.DragEvent, slot: 'modelImage' | 'sceneImage') => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files?.[0]
    if (!file || !file.type.startsWith('image/')) return

    void uploads.current?.start(slot, file, slot === 'modelImage' ? 'model' : 'scene')
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
  }

  const handleRemove = (e: React.MouseEvent, slot: 'modelImage' | 'sceneImage') => {
    e.stopPropagation()
    uploads.current?.remove(slot)
  }

  const renderUploadStatus = (slot: 'modelImage' | 'sceneImage') => {
    const asset = slot === 'modelImage' ? data.modelAsset : data.sceneAsset
    if (asset?.uploadStatus !== 'uploading' && asset?.uploadStatus !== 'error') return null
    return (
      <div
        role={asset.uploadStatus === 'error' ? 'alert' : 'status'}
        style={{ position: 'absolute', bottom: 18, insetInline: 2, padding: 3, background: '#fff', color: asset.uploadStatus === 'error' ? '#b91c1c' : '#1d4ed8', fontSize: 10, zIndex: 1, maxHeight: '60%', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        {asset.uploadStatus === 'uploading' ? 'Đang tải ảnh…' : `Tải ảnh thất bại: ${asset.error || 'Vui lòng chọn lại ảnh.'}`}
        {asset.uploadStatus === 'error' && uploads.current?.canRetry(slot) && (
          <button type="button" className="nodrag" onClick={() => { void uploads.current?.retry(slot) }}>Thử lại</button>
        )}
      </div>
    )
  }

  const count = [data.modelImage, data.sceneImage].filter(Boolean).length

  const isStartNode = data.isStartNode ?? false
  const isOrphan = data.isOrphan ?? false

  return (
    <div
      className={`wf-node-card wf-node-charscene ${selected ? 'selected' : ''} ${isStartNode ? 'is-start-node' : ''} ${isOrphan ? 'is-orphan' : ''}`}
      style={{ width: 360 }}
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

      {/* Header */}
      <div className="wf-node-header">
        <div className="wf-node-title-group">
          <div className="wf-node-icon">
            <User size={15} />
          </div>
          <div>
            <div className="wf-node-title">
              {data.title || 'Nhân Vật & Bối Cảnh'}
            </div>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>
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
            <Star
              size={12}
              fill={isStartNode ? '#d97706' : 'none'}
              color={isStartNode ? '#d97706' : '#94a3b8'}
            />
          </button>

          <span
            className="wf-node-badge"
            style={{
              background: count > 0 ? '#ecfdf5' : '#faf5ff',
              color: count > 0 ? '#065f46' : '#7c3aed',
              border: count > 0 ? '1px solid #d1fae5' : '1px solid #ddd6fe',
            }}
          >
            {count}/2 Ảnh
          </span>
          <button
            type="button"
            className="wf-node-del-btn"
            onClick={(e) => {
              e.stopPropagation()
              uploads.current?.dispose()
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
            {renderUploadStatus('modelImage')}
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
                    background: '#fdf2f8',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginBottom: 4,
                  }}
                >
                  <ImageIcon size={13} color="#db2777" />
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
            {renderUploadStatus('sceneImage')}
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

        {/* Canonical AI Profiles for English Veo Prompts */}
        <div
          style={{
            marginTop: 10,
            padding: '8px 10px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 7,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              userSelect: 'none',
            }}
            onClick={() => setIsProfilesOpen((prev) => !prev)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 700, color: '#0f172a' }}>
              <Sparkles size={12} color="#64748b" />
              <span>AI Canonical Profiles (Veo EN)</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                className="wf-btn"
                onClick={(e) => {
                  e.stopPropagation()
                  data.onAutoExtractProfile?.()
                }}
                disabled={data.isExtractingProfile || (!data.modelImage && !data.sceneImage)}
                style={{
                  padding: '2px 7px',
                  fontSize: 10,
                  fontWeight: 600,
                  background: '#0f172a',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 4,
                  cursor: (data.isExtractingProfile || (!data.modelImage && !data.sceneImage)) ? 'not-allowed' : 'pointer',
                  opacity: (!data.modelImage && !data.sceneImage) ? 0.5 : 1,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
                title={
                  !data.modelImage && !data.sceneImage
                    ? 'Tải ảnh người mẫu hoặc bối cảnh trước khi trích xuất'
                    : 'AI quan sát ảnh và tự viết Canonical Profile tiếng Anh chuẩn cho Veo'
                }
              >
                <Sparkles size={10} className={data.isExtractingProfile ? 'animate-spin' : ''} />
                {data.isExtractingProfile ? 'Đang trích xuất...' : 'Trích xuất AI'}
              </button>
              {isProfilesOpen ? <ChevronUp size={12} color="#64748b" /> : <ChevronDown size={12} color="#64748b" />}
            </div>
          </div>

          {isProfilesOpen && (
            <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
              {/* Character Profile */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#334155', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>👤 Nhân vật (Character Profile - EN):</span>
                  {data.characterProfile && (
                    <span style={{ fontSize: 9, color: '#059669', fontWeight: 700 }}>✓ Sẵn sàng</span>
                  )}
                </div>
                <textarea
                  className="nodrag"
                  rows={2}
                  value={data.characterProfile || ''}
                  onChange={(e) => data.onChangeProfile?.('characterProfile', e.target.value)}
                  placeholder="e.g. Young 24yo Asian female influencer, glowing skin, minimalist linen blazer, natural bright smile..."
                  style={{
                    width: '100%',
                    fontSize: 10.5,
                    fontFamily: 'inherit',
                    padding: '4px 6px',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#1e293b',
                    resize: 'vertical',
                    lineHeight: 1.35,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              {/* Scene Profile */}
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: '#334155', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span>🌄 Bối cảnh & Ánh sáng (Scene Profile - EN):</span>
                  {data.sceneProfile && (
                    <span style={{ fontSize: 9, color: '#059669', fontWeight: 700 }}>✓ Sẵn sàng</span>
                  )}
                </div>
                <textarea
                  className="nodrag"
                  rows={2}
                  value={data.sceneProfile || ''}
                  onChange={(e) => data.onChangeProfile?.('sceneProfile', e.target.value)}
                  placeholder="e.g. Modern minimalist aesthetics room, soft natural sunlight streaming through window, pastel tones..."
                  style={{
                    width: '100%',
                    fontSize: 10.5,
                    fontFamily: 'inherit',
                    padding: '4px 6px',
                    borderRadius: 4,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    color: '#1e293b',
                    resize: 'vertical',
                    lineHeight: 1.35,
                    boxSizing: 'border-box',
                  }}
                />
              </div>

              <div style={{ fontSize: 9.5, color: '#64748b', opacity: 0.85, fontStyle: 'italic' }}>
                💡 Tự động gắn vào visual_direction tiếng Anh của mỗi clip Veo để giữ tính nhất quán.
              </div>
            </div>
          )}
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
