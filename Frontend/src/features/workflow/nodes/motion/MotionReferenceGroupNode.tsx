import React, { useRef, useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Sparkles,
  Film,
  Upload,
  FolderOpen,
  Play,
  Trash2,
  RefreshCw,
  User,
  Image as ImageIcon,
  CheckCircle2,
  Video as VideoIcon,
  Clock,
  Maximize2,
} from 'lucide-react'
import type { MotionReferenceAsset } from '../../types'

export interface MotionReferenceGroupNodeData {
  character: MotionReferenceAsset
  motion: MotionReferenceAsset
  scene: MotionReferenceAsset
  selectedRole?: 'character' | 'motion' | 'scene' | null
  isRunning?: boolean
  onSelectRole?: (role: 'character' | 'motion' | 'scene') => void
  onUploadFile?: (role: 'character' | 'motion' | 'scene', file: File) => void
  onOpenLibrary?: (role: 'character' | 'motion' | 'scene') => void
  onRemoveAsset?: (role: 'character' | 'motion' | 'scene') => void
  onPreviewMedia?: (url: string, title?: string, isVideo?: boolean) => void
}

export function MotionReferenceGroupNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as MotionReferenceGroupNodeData
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeRoleRef = useRef<'character' | 'motion' | 'scene'>('motion')
  const [fileInputAccept, setFileInputAccept] = useState<string>('video/mp4,video/quicktime,video/webm')
  const [dragOverRole, setDragOverRole] = useState<'character' | 'motion' | 'scene' | null>(null)

  const handleTriggerUpload = (role: 'character' | 'motion' | 'scene', e?: React.MouseEvent) => {
    e?.stopPropagation()
    activeRoleRef.current = role
    setFileInputAccept(role === 'motion' ? 'video/mp4,video/quicktime,video/webm' : 'image/png,image/jpeg,image/webp')
    setTimeout(() => {
      fileInputRef.current?.click()
    }, 10)
  }

  const handleDropFile = (role: 'character' | 'motion' | 'scene', e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragOverRole(null)
    const file = e.dataTransfer.files?.[0]
    if (file) {
      nodeData.onUploadFile?.(role, file)
    }
  }

  const motion = nodeData.motion || {}
  const character = nodeData.character || {}
  const scene = nodeData.scene || {}

  const isMotionSelected = nodeData.selectedRole === 'motion'
  const isCharSelected = nodeData.selectedRole === 'character'
  const isSceneSelected = nodeData.selectedRole === 'scene'

  return (
    <div
      className={`mf-node mf-group-node mf-ref-node ${selected ? 'selected' : ''} ${nodeData.isRunning ? 'running' : ''}`}
      style={{ width: 400, padding: 0 }}
    >
      {/* Header */}
      <header className="mf-node-h" style={{ borderBottom: '1px solid #E2E8F0', padding: '0 16px' }}>
        <span className="mf-chip" style={{ background: '#EEF2FF', color: '#4F46E5', borderRadius: '8px' }}>
          <Sparkles size={15} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
          <h2 style={{ fontSize: '13.5px', margin: 0, fontWeight: 700, color: '#1E293B' }}>
            Nguyên Liệu Tham Chiếu
          </h2>
          <small style={{ fontSize: '11px', color: '#64748B' }}>Reference Inputs (Ingredients)</small>
        </div>
        <span className="mf-tag" style={{ background: '#F1F5F9', color: '#475569', fontWeight: 600 }}>
          3 Slots
        </span>
      </header>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept={fileInputAccept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            nodeData.onUploadFile?.(activeRoleRef.current, file)
          }
          e.target.value = ''
        }}
      />

      {/* Main Container */}
      <div className="mf-ref-body">
        {/* ========================================================================= */}
        {/* 1. HERO SLOT: VIDEO CHUYỂN ĐỘNG (BẮT BUỘC) */}
        {/* ========================================================================= */}
        <div
          className={`mf-hero-slot ${isMotionSelected ? 'selected' : ''} ${dragOverRole === 'motion' ? 'drag-over' : ''}`}
          onClick={() => nodeData.onSelectRole?.('motion')}
          onDragOver={(e) => {
            e.preventDefault()
            setDragOverRole('motion')
          }}
          onDragLeave={() => setDragOverRole(null)}
          onDrop={(e) => handleDropFile('motion', e)}
        >
          {/* Slot Header */}
          <div className="mf-hero-header">
            <div className="mf-hero-title-group">
              <div className="mf-hero-icon">
                <VideoIcon size={16} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span className="mf-hero-title">
                  Video Chuyển Động
                  {motion.filled && <CheckCircle2 size={15} color="#10B981" />}
                </span>
                <span style={{ fontSize: '11px', color: '#64748B' }}>Động tác mẫu & nhịp máy</span>
              </div>
            </div>
            <span className="mf-hero-badge">Bắt buộc</span>
          </div>

          {/* Video Preview / Dropzone Card */}
          <div className={`mf-hero-preview-box ${!motion.filled ? 'empty' : ''}`}>
            {motion.filled && motion.previewUrl ? (
              <>
                <video
                  src={motion.previewUrl}
                  className="mf-hero-preview-media"
                  muted
                  loop
                  autoPlay
                  playsInline
                />

                {/* Overlay Action Bar on Hover */}
                <div className="mf-hero-overlay">
                  <div className="mf-hero-overlay-top">
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#FFFFFF',
                        background: 'rgba(0,0,0,0.6)',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        maxWidth: '220px',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                      title={motion.fileName}
                    >
                      {motion.fileName || 'video_reference.mp4'}
                    </span>
                    <span
                      style={{
                        fontSize: '11px',
                        color: '#FED7AA',
                        background: 'rgba(234, 88, 12, 0.7)',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                      }}
                    >
                      <Clock size={11} />
                      {motion.trimEndSec ? `${motion.trimEndSec}s` : '10s'}
                    </span>
                  </div>

                  <div className="mf-hero-overlay-bottom">
                    {nodeData.onPreviewMedia && (
                      <button
                        type="button"
                        className="mf-btn-glass"
                        onClick={(e) => {
                          e.stopPropagation()
                          nodeData.onPreviewMedia?.(motion.previewUrl!, motion.fileName, true)
                        }}
                        title="Xem toàn cảnh video"
                      >
                        <Play size={13} fill="currentColor" />
                        <span>Xem thử</span>
                      </button>
                    )}

                    <button
                      type="button"
                      className="mf-btn-glass"
                      onClick={(e) => {
                        e.stopPropagation()
                        nodeData.onOpenLibrary?.('motion')
                      }}
                      title="Chọn video khác từ Thư viện"
                    >
                      <RefreshCw size={12} />
                      <span>Đổi</span>
                    </button>

                    {nodeData.onRemoveAsset && (
                      <button
                        type="button"
                        className="mf-btn-glass-danger"
                        onClick={(e) => {
                          e.stopPropagation()
                          nodeData.onRemoveAsset?.('motion')
                        }}
                        title="Gỡ bỏ video này"
                      >
                        <Trash2 size={13} />
                        <span>Xóa</span>
                      </button>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '6px',
                  color: '#94A3B8',
                  padding: '12px',
                  textAlign: 'center',
                  width: '100%',
                }}
              >
                <div
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: '50%',
                    background: '#FFE8CC',
                    color: '#D9480F',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Film size={20} />
                </div>
                <span style={{ fontSize: '12.5px', fontWeight: 600, color: '#334155' }}>
                  Kéo & thả video vào đây
                </span>
                <span style={{ fontSize: '11px', color: '#94A3B8' }}>
                  Hỗ trợ MP4, MOV, WebM (tối đa 1 GB)
                </span>
              </div>
            )}
          </div>

          {/* Action Buttons for Motion Video */}
          <div style={{ display: 'flex', gap: '8px', marginTop: '10px' }}>
            <button
              type="button"
              className="mf-btn-primary-hero"
              onClick={(e) => {
                e.stopPropagation()
                nodeData.onOpenLibrary?.('motion')
              }}
              title="Chọn video có sẵn từ Thư viện Veo"
            >
              <FolderOpen size={15} />
              <span>{motion.filled ? 'Đổi từ Thư Viện' : 'Thư Viện Veo'}</span>
            </button>

            <button
              type="button"
              className="mf-btn-secondary-hero"
              onClick={(e) => handleTriggerUpload('motion', e)}
              title="Tải tệp video từ máy tính của bạn"
            >
              <Upload size={14} />
              <span>{motion.filled ? 'Đổi Tệp Máy' : 'Tải Từ Máy'}</span>
            </button>
          </div>

          {/* Connection Handle for Motion Reference */}
          <Handle
            type="source"
            position={Position.Right}
            id="out-motion"
            className={`mf-ref-handle vid ${motion.filled ? 'on' : ''}`}
            style={{
              right: -7,
              top: 24,
            }}
          />
        </div>

        {/* ========================================================================= */}
        {/* 2. SECONDARY SLOTS: ẢNH NHÂN VẬT & ẢNH BỐI CẢNH (GRID 2 CỘT) */}
        {/* ========================================================================= */}
        <div className="mf-secondary-grid">
          {/* --- SLOT A: ẢNH NHÂN VẬT --- */}
          <div
            className={`mf-sub-slot ${isCharSelected ? 'selected' : ''} ${dragOverRole === 'character' ? 'drag-over' : ''}`}
            onClick={() => nodeData.onSelectRole?.('character')}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverRole('character')
            }}
            onDragLeave={() => setDragOverRole(null)}
            onDrop={(e) => handleDropFile('character', e)}
          >
            <div className="mf-sub-header">
              <span className="mf-sub-title">
                <User size={13} color="#10B981" />
                <span>Nhân Vật</span>
              </span>
              <span style={{ fontSize: '10px', color: '#64748B' }}>Tùy chọn</span>
            </div>

            {/* Preview Box */}
            <div className="mf-sub-preview-box">
              {character.filled && character.previewUrl ? (
                <>
                  <img
                    src={character.previewUrl}
                    alt={character.fileName || 'Character'}
                    style={{
                      width: '100%',
                      height: '100%',
                      // Ảnh sheet (chân dung + áo nhiều góc) là 16:9: hiện đủ, không cắt mất mặt hoặc áo.
                      objectFit: character.source === 'character_sheet' ? 'contain' : 'cover',
                      background: character.source === 'character_sheet' ? '#1F2937' : undefined,
                    }}
                  />
                  {nodeData.onRemoveAsset && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        nodeData.onRemoveAsset?.('character')
                      }}
                      title="Xóa ảnh nhân vật"
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 22,
                        height: 22,
                        borderRadius: '4px',
                        border: 'none',
                        background: 'rgba(220, 38, 38, 0.85)',
                        color: '#FFFFFF',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', color: '#94A3B8' }}>
                  <ImageIcon size={18} />
                  <span style={{ fontSize: '10px' }}>Thả ảnh vào đây</span>
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="mf-sub-btn-group">
              <button
                type="button"
                className="mf-sub-btn primary"
                onClick={(e) => {
                  e.stopPropagation()
                  nodeData.onOpenLibrary?.('character')
                }}
                title="Chọn ảnh từ Thư viện Veo"
              >
                <FolderOpen size={12} />
                <span>Thư viện</span>
              </button>

              <button
                type="button"
                className="mf-sub-btn"
                onClick={(e) => handleTriggerUpload('character', e)}
                title="Tải ảnh từ máy tính"
              >
                <Upload size={12} />
                <span>Tải lên</span>
              </button>
            </div>

            {/* Cổng nhận từ node tùy chọn "Tạo Ảnh Nhân Vật Mới" (chỉ để hiển thị nguồn ảnh) */}
            <Handle
              type="target"
              position={Position.Left}
              id="in-sheet"
              className={`mf-ref-handle img ${character.source === 'character_sheet' ? 'on' : ''}`}
              style={{ left: -7, top: '50%', transform: 'translateY(-50%)' }}
            />

            {/* Connection Handle for Character */}
            <Handle
              type="source"
              position={Position.Right}
              id="out-character"
              className={`mf-ref-handle img ${character.filled ? 'on' : ''}`}
              style={{
                right: -7,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            />
          </div>

          {/* --- SLOT B: ẢNH BỐI CẢNH --- */}
          <div
            className={`mf-sub-slot ${isSceneSelected ? 'selected' : ''} ${dragOverRole === 'scene' ? 'drag-over' : ''}`}
            onClick={() => nodeData.onSelectRole?.('scene')}
            onDragOver={(e) => {
              e.preventDefault()
              setDragOverRole('scene')
            }}
            onDragLeave={() => setDragOverRole(null)}
            onDrop={(e) => handleDropFile('scene', e)}
          >
            <div className="mf-sub-header">
              <span className="mf-sub-title">
                <ImageIcon size={13} color="#10B981" />
                <span>Bối Cảnh</span>
              </span>
              <span style={{ fontSize: '10px', color: '#64748B' }}>Tùy chọn</span>
            </div>

            {/* Preview Box */}
            <div className="mf-sub-preview-box">
              {scene.filled && scene.previewUrl ? (
                <>
                  <img
                    src={scene.previewUrl}
                    alt={scene.fileName || 'Scene'}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                  {nodeData.onRemoveAsset && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        nodeData.onRemoveAsset?.('scene')
                      }}
                      title="Xóa ảnh bối cảnh"
                      style={{
                        position: 'absolute',
                        top: 4,
                        right: 4,
                        width: 22,
                        height: 22,
                        borderRadius: '4px',
                        border: 'none',
                        background: 'rgba(220, 38, 38, 0.85)',
                        color: '#FFFFFF',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  )}
                </>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '3px', color: '#94A3B8' }}>
                  <ImageIcon size={18} />
                  <span style={{ fontSize: '10px' }}>Thả ảnh vào đây</span>
                </div>
              )}
            </div>

            {/* Buttons */}
            <div className="mf-sub-btn-group">
              <button
                type="button"
                className="mf-sub-btn primary"
                onClick={(e) => {
                  e.stopPropagation()
                  nodeData.onOpenLibrary?.('scene')
                }}
                title="Chọn ảnh từ Thư viện Veo"
              >
                <FolderOpen size={12} />
                <span>Thư viện</span>
              </button>

              <button
                type="button"
                className="mf-sub-btn"
                onClick={(e) => handleTriggerUpload('scene', e)}
                title="Tải ảnh từ máy tính"
              >
                <Upload size={12} />
                <span>Tải lên</span>
              </button>
            </div>

            {/* Connection Handle for Scene */}
            <Handle
              type="source"
              position={Position.Right}
              id="out-scene"
              className={`mf-ref-handle img ${scene.filled ? 'on' : ''}`}
              style={{
                right: -7,
                top: '50%',
                transform: 'translateY(-50%)',
              }}
            />
          </div>
        </div>
      </div>

      {/* Footer hint */}
      <div
        style={{
          padding: '8px 14px 10px',
          borderTop: '1px solid #F1F5F9',
          fontSize: '11px',
          color: '#94A3B8',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
        }}
      >
        <span style={{ color: '#4F46E5' }}>💡</span>
        <span>Kéo thả tệp trực tiếp vào ô hoặc nhấp để mở bảng chỉnh sửa</span>
      </div>
    </div>
  )
}
