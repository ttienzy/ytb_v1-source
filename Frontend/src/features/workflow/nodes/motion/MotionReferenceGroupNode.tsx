import React, { useRef } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import {
  Image as ImageIcon,
  Video as VideoIcon,
  Upload,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  FolderOpen,
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
}

export function MotionReferenceGroupNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as MotionReferenceGroupNodeData
  const fileInputRef = useRef<HTMLInputElement>(null)
  const activeRoleRef = useRef<'character' | 'motion' | 'scene'>('motion')

  const handleTriggerUpload = (role: 'character' | 'motion' | 'scene', e: React.MouseEvent) => {
    e.stopPropagation()
    activeRoleRef.current = role
    fileInputRef.current?.click()
  }

  const items = [
    {
      role: 'character' as const,
      title: 'Ảnh Nhân Vật',
      subtitle: 'Khuôn mặt & vóc dáng',
      icon: <ImageIcon size={15} />,
      asset: nodeData.character,
      required: false,
      handleId: 'out-character',
      color: 'var(--img, #10B981)',
      colorSoft: 'var(--img-soft, #ECFDF5)',
    },
    {
      role: 'motion' as const,
      title: 'Video Chuyển Động',
      subtitle: 'Động tác mẫu & nhịp máy',
      icon: <VideoIcon size={15} />,
      asset: nodeData.motion,
      required: true,
      handleId: 'out-motion',
      color: 'var(--vid, #FF7A00)',
      colorSoft: 'var(--vid-soft, #FFF7ED)',
    },
    {
      role: 'scene' as const,
      title: 'Ảnh Bối Cảnh',
      subtitle: 'Không gian & ánh sáng',
      icon: <ImageIcon size={15} />,
      asset: nodeData.scene,
      required: false,
      handleId: 'out-scene',
      color: 'var(--img, #10B981)',
      colorSoft: 'var(--img-soft, #ECFDF5)',
    },
  ]

  return (
    <div
      className={`mf-node mf-group-node ${selected ? 'selected' : ''} ${nodeData.isRunning ? 'running' : ''}`}
      style={{ width: 340, padding: 0 }}
    >
      {/* Header */}
      <header className="mf-node-h" style={{ borderBottom: '1px solid #E2E8F0' }}>
        <span className="mf-chip" style={{ background: '#EEF2FF', color: '#4F46E5' }}>
          <Sparkles size={14} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <h2 style={{ fontSize: '13px', margin: 0, fontWeight: 700 }}>Nguyên Liệu Tham Chiếu</h2>
          <small style={{ fontSize: '11px', color: '#64748B' }}>Reference Inputs (Ingredients)</small>
        </div>
        <span className="mf-tag" style={{ background: '#F1F5F9', color: '#475569' }}>
          3 Slots
        </span>
      </header>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/mp4,video/quicktime,video/webm"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            nodeData.onUploadFile?.(activeRoleRef.current, file)
          }
          e.target.value = ''
        }}
      />

      {/* Items List */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', padding: '10px' }}>
        {items.map((item) => {
          const isSelected = nodeData.selectedRole === item.role
          const isFilled = item.asset?.filled

          return (
            <div
              key={item.role}
              onClick={() => nodeData.onSelectRole?.(item.role)}
              style={{
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                padding: '8px 10px',
                borderRadius: '8px',
                border: isSelected ? '1.5px solid #4F46E5' : '1px solid #E2E8F0',
                background: isSelected ? '#F8FAFC' : '#FFFFFF',
                boxShadow: isSelected ? '0 0 0 2px rgba(79, 70, 229, 0.15)' : 'none',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {/* Media Thumbnail or Icon */}
              <div
                style={{
                  width: 44,
                  height: 44,
                  borderRadius: '6px',
                  background: item.colorSoft,
                  color: item.color,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                  flexShrink: 0,
                  border: '1px solid #E2E8F0',
                }}
              >
                {item.asset?.previewUrl ? (
                  item.role === 'motion' ? (
                    <video
                      src={item.asset.previewUrl}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      muted
                      loop
                    />
                  ) : (
                    <img
                      src={item.asset.previewUrl}
                      alt={item.title}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  )
                ) : (
                  item.icon
                )}
              </div>

              {/* Info Column */}
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '2px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                  <span style={{ fontSize: '12px', fontWeight: 600, color: '#1E293B' }}>{item.title}</span>
                  {item.required ? (
                    <span style={{ fontSize: '10px', background: '#FEE2E2', color: '#DC2626', padding: '1px 5px', borderRadius: '4px', fontWeight: 600 }}>
                      Bắt buộc
                    </span>
                  ) : (
                    <span style={{ fontSize: '10px', background: '#F1F5F9', color: '#64748B', padding: '1px 4px', borderRadius: '4px' }}>
                      Tùy chọn
                    </span>
                  )}
                </div>

                <span
                  style={{
                    fontSize: '11px',
                    color: isFilled ? '#334155' : '#94A3B8',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                  title={item.asset?.fileName || item.subtitle}
                >
                  {item.asset?.fileName || item.subtitle}
                </span>
              </div>

              {/* Status Indicator / Quick Action Buttons */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
                {/* Nút Chọn từ Thư Viện Veo */}
                {nodeData.onOpenLibrary && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      nodeData.onOpenLibrary?.(item.role)
                    }}
                    title={`Chọn ${item.role === 'motion' ? 'video' : 'ảnh'} từ Thư viện Veo`}
                    style={{
                      border: '1px solid #C7D2FE',
                      background: '#EEF2FF',
                      color: '#4F46E5',
                      padding: '5px 7px',
                      borderRadius: '5px',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '3px',
                      fontSize: '11px',
                      fontWeight: 600,
                      transition: 'all 0.15s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#4F46E5'
                      e.currentTarget.style.color = '#FFFFFF'
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = '#EEF2FF'
                      e.currentTarget.style.color = '#4F46E5'
                    }}
                  >
                    <FolderOpen size={12} />
                  </button>
                )}

                {/* Nút Upload từ máy tính */}
                <button
                  type="button"
                  onClick={(e) => handleTriggerUpload(item.role, e)}
                  title={`Tải file ${item.title} từ máy tính`}
                  style={{
                    border: '1px solid #E2E8F0',
                    background: '#F8FAFC',
                    color: '#475569',
                    padding: '5px 7px',
                    borderRadius: '5px',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = '#E2E8F0'
                    e.currentTarget.style.color = '#1E293B'
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = '#F8FAFC'
                    e.currentTarget.style.color = '#475569'
                  }}
                >
                  <Upload size={12} />
                </button>

                {/* Biểu tượng Check nếu đã nạp */}
                {isFilled && (
                  <CheckCircle2 size={16} color="#10B981" style={{ marginLeft: 2 }} />
                )}
              </div>

              {/* React Flow Source Handle for this asset */}
              <Handle
                type="source"
                position={Position.Right}
                id={item.handleId}
                className={`mf-rf-handle ${item.role === 'motion' ? 'vid' : 'img'} ${isFilled ? 'on' : ''}`}
                style={{
                  right: -7,
                  top: '50%',
                  transform: 'translateY(-50%)',
                }}
              />
            </div>
          )
        })}

      </div>

      {/* Footer hint */}
      <div style={{ padding: '6px 12px 10px', borderTop: '1px solid #F1F5F9', fontSize: '10.5px', color: '#94A3B8' }}>
        Nhấp vào từng mục để mở bảng tùy chỉnh chi tiết bên phải
      </div>
    </div>
  )
}
