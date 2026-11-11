import React, { useRef } from 'react'
import {
  X,
  Sliders,
  Sparkles,
  Upload,
  Trash2,
  Film,
  Image as ImageIcon,
  Video as VideoIcon,
  Copy,
  Check,
  RotateCcw,
  RotateCw,
  CheckCircle2,
  AlertCircle,
  FolderPlus,
  FolderOpen,
  Columns2,
} from 'lucide-react'
import type {
  MotionReferenceAsset,
  MotionCreativeDirection,
  MotionOutputConfig,
  MotionRunError,
  MotionPresetItem,
  MotionVariantSlot,
} from '../types'
import type { StructuredPromptResult } from '../services/motionPromptBuilder'
import {
  MOTION_DURATION_OPTIONS,
  getAvailableAspectRatios,
  getAvailableResolutions,
  getAvailableDurations,
} from '../services/motionProfiles'
import type { VeoCapabilityProfile, VeoProject } from '../../veo-studio/types'

interface MotionInspectorPanelProps {
  isOpen: boolean
  onClose: () => void
  selectedNodeType: 'reference' | 'creative' | 'preview' | 'output' | null
  activeRole: 'character' | 'motion' | 'scene'
  setActiveRole: (role: 'character' | 'motion' | 'scene') => void
  presets?: MotionPresetItem[]
  activePresetId?: string
  onSelectPreset?: (presetId: string) => void
  // Reference Assets
  character: MotionReferenceAsset
  motion: MotionReferenceAsset
  scene: MotionReferenceAsset
  onUploadFile: (role: 'character' | 'motion' | 'scene', file: File) => void
  onClearAsset: (role: 'character' | 'motion' | 'scene') => void
  onUpdateAssetMeta: (role: 'character' | 'motion' | 'scene', updates: Partial<MotionReferenceAsset>) => void
  onOpenLibrary?: (role: 'character' | 'motion' | 'scene') => void
  // Creative Direction
  creative: MotionCreativeDirection
  onUpdateCreative: (updates: Partial<MotionCreativeDirection>) => void
  onResetDefaultPrompt?: () => void
  // Prompt Preview
  structuredPrompt: StructuredPromptResult
  isCustomPrompt: boolean
  customPromptText: string
  onUpdateCustomPromptText: (text: string) => void
  onResetToAutoPrompt: () => void
  // Output
  outputConfig: MotionOutputConfig
  projects: VeoProject[]
  activeProject: VeoProject | null
  lastRunProject?: VeoProject | null
  isCreatingProject: boolean
  onUpdateProjectConfig: (updates: Partial<MotionOutputConfig>) => void
  onSelectProject?: (projectId: string) => Promise<void> | void
  onCreateProject: (name: string) => Promise<VeoProject>
  profiles: VeoCapabilityProfile[]
  selectedProfileId: string
  onSelectAspectRatio: (aspectRatio: MotionOutputConfig['aspectRatio']) => void
  onSelectResolution: (resolution: MotionOutputConfig['resolution']) => void
  onSelectDuration: (durationSeconds: number) => void
  profileError?: string | null
  missingReasons: string[]
  isReadyToRun: boolean
  isRunning: boolean
  runError?: MotionRunError | null
  variants?: MotionVariantSlot[]
  activeVariantIndex?: number
  onSelectVariantIndex?: (idx: number) => void
  onRetryVariant?: (variantIndex: number) => void
  onRunWorkflow: () => void
}

export function MotionInspectorPanel({
  isOpen,
  onClose,
  selectedNodeType,
  activeRole,
  setActiveRole,
  character,
  motion,
  scene,
  onUploadFile,
  onClearAsset,
  onUpdateAssetMeta,
  onOpenLibrary,
  creative,
  onUpdateCreative,
  onResetDefaultPrompt,
  structuredPrompt,
  isCustomPrompt,
  customPromptText,
  onUpdateCustomPromptText,
  onResetToAutoPrompt,
  outputConfig,
  projects,
  activeProject,
  lastRunProject,
  isCreatingProject,
  onUpdateProjectConfig,
  onSelectProject,
  onCreateProject,
  profiles,
  selectedProfileId,
  onSelectAspectRatio,
  onSelectResolution,
  onSelectDuration,
  profileError,
  missingReasons,
  isReadyToRun,
  isRunning,
  runError,
  variants,
  activeVariantIndex,
  onSelectVariantIndex,
  onRetryVariant,
  onRunWorkflow,
  presets,
  activePresetId,
  onSelectPreset,
}: MotionInspectorPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [copied, setCopied] = React.useState(false)
  const [newProjectName, setNewProjectName] = React.useState('Motion Control')
  const [projectActionError, setProjectActionError] = React.useState<string | null>(null)

  const availableAspectRatios = React.useMemo(() => getAvailableAspectRatios(profiles), [profiles])
  const availableResolutions = React.useMemo(
    () => getAvailableResolutions(profiles, outputConfig.aspectRatio),
    [profiles, outputConfig.aspectRatio]
  )
  const availableDurations = React.useMemo(() => getAvailableDurations(profiles), [profiles])

  if (!isOpen) return null

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) || null

  const handleCopyPrompt = () => {
    const textToCopy = isCustomPrompt ? customPromptText : (structuredPrompt?.fullPrompt || '')
    navigator.clipboard.writeText(textToCopy)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCreateProject = async () => {
    setProjectActionError(null)
    try {
      await onCreateProject(newProjectName)
    } catch (error) {
      setProjectActionError(error instanceof Error ? error.message : 'Không thể tạo Flow project.')
    }
  }

  return (
    <aside
      className="mf-inspector-drawer"
      style={{
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        width: 360,
        maxWidth: '100vw',
        background: '#FFFFFF',
        borderLeft: '1px solid #E2E8F0',
        boxShadow: '-4px 0 20px rgba(0, 0, 0, 0.07)',
        zIndex: 50,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        animation: 'slideInRight 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '14px 16px',
          borderBottom: '1px solid #E2E8F0',
          background: '#F8FAFC',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Sliders size={16} color="#4F46E5" />
          <h3 style={{ margin: 0, fontSize: '13.5px', fontWeight: 700, color: '#1E293B' }}>
            {selectedNodeType === 'reference' && 'Tùy Chỉnh Nguyên Liệu (References)'}
            {selectedNodeType === 'creative' && 'Chỉ Dẫn Sáng Tạo (Creative Direction)'}
            {selectedNodeType === 'preview' && 'Kiểm Tra Prompt Cấu Trúc (Preview)'}
            {selectedNodeType === 'output' && 'Cấu Hình Xuất Video (Output)'}
            {!selectedNodeType && 'Bảng Điều Khiển Chi Tiết'}
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          style={{
            border: 'none',
            background: 'transparent',
            color: '#64748B',
            cursor: 'pointer',
            padding: '4px',
            borderRadius: '4px',
            display: 'flex',
          }}
          title="Đóng bảng"
        >
          <X size={18} />
        </button>
      </div>

      {/* Hidden File Input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/mp4,video/quicktime,video/webm"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) {
            onUploadFile(activeRole, file)
          }
          e.target.value = ''
        }}
      />

      {/* Content Body (Scrollable) */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
        {/* ============================================================== */}
        {/* TAB 1: REFERENCE ASSETS INSPECTOR */}
        {/* ============================================================== */}
        {selectedNodeType === 'reference' && (
          <>
            {/* Asset Role Switcher Tabs */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 1fr 1fr',
                gap: '4px',
                background: '#F1F5F9',
                padding: '3px',
                borderRadius: '8px',
              }}
            >
              <button
                type="button"
                onClick={() => setActiveRole('character')}
                style={{
                  padding: '6px 4px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: activeRole === 'character' ? '#FFFFFF' : 'transparent',
                  color: activeRole === 'character' ? '#1E293B' : '#64748B',
                  boxShadow: activeRole === 'character' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <ImageIcon size={12} />
                <span>Nhân vật</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveRole('motion')}
                style={{
                  padding: '6px 4px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: activeRole === 'motion' ? '#FFFFFF' : 'transparent',
                  color: activeRole === 'motion' ? '#1E293B' : '#64748B',
                  boxShadow: activeRole === 'motion' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <VideoIcon size={12} />
                <span>Chuyển động</span>
              </button>

              <button
                type="button"
                onClick={() => setActiveRole('scene')}
                style={{
                  padding: '6px 4px',
                  borderRadius: '6px',
                  border: 'none',
                  fontSize: '11px',
                  fontWeight: 600,
                  cursor: 'pointer',
                  background: activeRole === 'scene' ? '#FFFFFF' : 'transparent',
                  color: activeRole === 'scene' ? '#1E293B' : '#64748B',
                  boxShadow: activeRole === 'scene' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '4px',
                }}
              >
                <ImageIcon size={12} />
                <span>Bối cảnh</span>
              </button>
            </div>

            {/* Content for ACTIVE ROLE */}
            {activeRole === 'motion' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>Video Mẫu (Bắt buộc)</span>
                  <span style={{ fontSize: '11px', background: '#FEE2E2', color: '#DC2626', padding: '1px 6px', borderRadius: '4px', fontWeight: 600 }}>
                    Required
                  </span>
                </div>

                {/* Preview Box */}
                <div
                  style={{
                    width: '100%',
                    height: 180,
                    borderRadius: '8px',
                    background: '#0F172A',
                    overflow: 'hidden',
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #CBD5E1',
                  }}
                >
                  {motion.previewUrl ? (
                    <video
                      src={motion.previewUrl}
                      style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      controls
                      loop
                    />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: '#94A3B8' }}>
                      <Film size={32} />
                      <span style={{ fontSize: '11.5px' }}>Chưa có video tham chiếu</span>
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {onOpenLibrary && (
                      <button
                        type="button"
                        onClick={() => onOpenLibrary('motion')}
                        style={{
                          flex: 1,
                          padding: '8px 10px',
                          borderRadius: '6px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #4F46E5, #7C3AED)',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          color: '#FFFFFF',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: '0 2px 4px rgba(79, 70, 229, 0.25)',
                        }}
                      >
                        <FolderOpen size={14} />
                        <span>Chọn từ Thư viện Veo</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        flex: onOpenLibrary ? '0 0 auto' : 1,
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#334155',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                      }}
                      title="Tải video từ máy tính"
                    >
                      <Upload size={13} />
                      <span>{motion.filled ? 'Đổi tệp máy' : 'Tải từ máy'}</span>
                    </button>

                    {motion.filled && (
                      <button
                        type="button"
                        onClick={() => onClearAsset('motion')}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '6px',
                          border: '1px solid #FCA5A5',
                          background: '#FEF2F2',
                          color: '#DC2626',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                        title="Xóa video"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                {/* Trim Settings */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#334155' }}>
                    Đoạn cắt thời gian (Trim)
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px' }}>
                    <div>
                      <span style={{ fontSize: '10.5px', color: '#64748B' }}>Bắt đầu (giây)</span>
                      <input
                        type="number"
                        min={0}
                        max={50}
                        step={1}
                        value={motion.trimStartSec ?? 0}
                        onChange={(e) => onUpdateAssetMeta('motion', { trimStartSec: Number(e.target.value) })}
                        style={{
                          width: '100%',
                          padding: '6px',
                          borderRadius: '6px',
                          border: '1px solid #CBD5E1',
                          fontSize: '12px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                    <div>
                      <span style={{ fontSize: '10.5px', color: '#64748B' }}>Kết thúc (giây)</span>
                      <input
                        type="number"
                        min={3}
                        max={60}
                        step={1}
                        value={motion.trimEndSec ?? 10}
                        onChange={(e) => onUpdateAssetMeta('motion', { trimEndSec: Number(e.target.value) })}
                        style={{
                          width: '100%',
                          padding: '6px',
                          borderRadius: '6px',
                          border: '1px solid #CBD5E1',
                          fontSize: '12px',
                          boxSizing: 'border-box',
                        }}
                      />
                    </div>
                  </div>
                  <small style={{ fontSize: '10.5px', color: '#64748B' }}>
                    Flow dùng đoạn nguồn từ 3 đến tối đa 10 giây. Thời lượng đầu ra được tính từ đoạn trim này.
                  </small>
                </div>
              </div>
            )}

            {/* Character & Scene Roles */}
            {activeRole === 'character' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>Ảnh Nhân Vật (Tùy chọn)</span>
                  <span style={{ fontSize: '11px', background: '#F1F5F9', color: '#64748B', padding: '1px 6px', borderRadius: '4px' }}>
                    Optional
                  </span>
                </div>

                <div
                  style={{
                    width: '100%',
                    height: 180,
                    borderRadius: '8px',
                    background: '#F8FAFC',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #CBD5E1',
                  }}
                >
                  {character.previewUrl ? (
                    <img src={character.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: '#94A3B8' }}>
                      <ImageIcon size={32} />
                      <span style={{ fontSize: '11.5px' }}>Chưa chọn ảnh nhân vật</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {onOpenLibrary && (
                      <button
                        type="button"
                        onClick={() => onOpenLibrary('character')}
                        style={{
                          flex: 1,
                          padding: '8px 10px',
                          borderRadius: '6px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #4F46E5, #6366F1)',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          color: '#FFFFFF',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)',
                        }}
                      >
                        <FolderOpen size={14} />
                        <span>Chọn từ Thư viện Veo</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        flex: onOpenLibrary ? '0 0 auto' : 1,
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#334155',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                      }}
                      title="Tải ảnh từ máy tính"
                    >
                      <Upload size={13} />
                      <span>{character.filled ? 'Đổi ảnh' : 'Tải từ máy'}</span>
                    </button>

                    {character.filled && (
                      <button
                        type="button"
                        onClick={() => onClearAsset('character')}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '6px',
                          border: '1px solid #FCA5A5',
                          background: '#FEF2F2',
                          color: '#DC2626',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>

                <small style={{ fontSize: '10.5px', color: '#64748B' }}>
                  Ảnh chân dung góc thẳng, sáng rõ khuôn mặt giúp Veo tái tạo tốt nhất.
                </small>
              </div>
            )}

            {activeRole === 'scene' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>Ảnh Bối Cảnh (Tùy chọn)</span>
                  <span style={{ fontSize: '11px', background: '#F1F5F9', color: '#64748B', padding: '1px 6px', borderRadius: '4px' }}>
                    Optional
                  </span>
                </div>

                <div
                  style={{
                    width: '100%',
                    height: 180,
                    borderRadius: '8px',
                    background: '#F8FAFC',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    border: '1px solid #CBD5E1',
                  }}
                >
                  {scene.previewUrl ? (
                    <img src={scene.previewUrl} alt="" style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', color: '#94A3B8' }}>
                      <ImageIcon size={32} />
                      <span style={{ fontSize: '11.5px' }}>Chưa chọn ảnh bối cảnh</span>
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                  <div style={{ display: 'flex', gap: '8px' }}>
                    {onOpenLibrary && (
                      <button
                        type="button"
                        onClick={() => onOpenLibrary('scene')}
                        style={{
                          flex: 1,
                          padding: '8px 10px',
                          borderRadius: '6px',
                          border: 'none',
                          background: 'linear-gradient(135deg, #4F46E5, #6366F1)',
                          fontSize: '11.5px',
                          fontWeight: 700,
                          color: '#FFFFFF',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                          boxShadow: '0 2px 4px rgba(79, 70, 229, 0.2)',
                        }}
                      >
                        <FolderOpen size={14} />
                        <span>Chọn từ Thư viện Veo</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      style={{
                        flex: onOpenLibrary ? '0 0 auto' : 1,
                        padding: '8px 12px',
                        borderRadius: '6px',
                        border: '1px solid #CBD5E1',
                        background: '#FFFFFF',
                        fontSize: '11.5px',
                        fontWeight: 600,
                        color: '#334155',
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                      }}
                      title="Tải ảnh từ máy tính"
                    >
                      <Upload size={13} />
                      <span>{scene.filled ? 'Đổi ảnh' : 'Tải từ máy'}</span>
                    </button>

                    {scene.filled && (
                      <button
                        type="button"
                        onClick={() => onClearAsset('scene')}
                        style={{
                          padding: '8px 12px',
                          borderRadius: '6px',
                          border: '1px solid #FCA5A5',
                          background: '#FEF2F2',
                          color: '#DC2626',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ============================================================== */}
        {/* TAB 2: CREATIVE DIRECTION INSPECTOR */}
        {/* ============================================================== */}
        {selectedNodeType === 'creative' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            {/* Quick Action: Reset to Default Safe Prompt */}
            {onResetDefaultPrompt && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '8px 10px',
                  background: '#F0FDF4',
                  border: '1px solid #BBF7D0',
                  borderRadius: '6px',
                }}
              >
                <span style={{ fontSize: '11px', color: '#166534', fontWeight: 600 }}>
                  Prompt chuẩn an toàn từ file
                </span>
                <button
                  type="button"
                  onClick={onResetDefaultPrompt}
                  style={{
                    padding: '4px 8px',
                    borderRadius: '4px',
                    border: '1px solid #86EFAC',
                    background: '#FFFFFF',
                    color: '#15803D',
                    fontSize: '11px',
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                  }}
                  title="Khôi phục toàn bộ nội dung prompt mẫu chuẩn"
                >
                  <RotateCcw size={12} />
                  <span>Khôi phục mẫu</span>
                </button>
              </div>
            )}

            {/* Bộ Mẫu Phong Cách Chuyển Động (Motion Presets) */}
            {presets && presets.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '7px', padding: '10px', borderRadius: '8px', background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#1E293B', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <Sparkles size={13} color="#4F46E5" />
                    <span>Mẫu phong cách chuyển động</span>
                  </label>
                  <span style={{ fontSize: '9.5px', color: '#059669', fontWeight: 700 }}>✓ Tự động lưu</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                  {presets.map((preset) => {
                    const active = (activePresetId || outputConfig.activePresetId || 'choreography') === preset.id
                    return (
                      <button
                        key={preset.id}
                        type="button"
                        onClick={() => onSelectPreset?.(preset.id)}
                        style={{
                          padding: '7px 8px',
                          borderRadius: '7px',
                          border: active ? '2px solid #4F46E5' : '1px solid #CBD5E1',
                          background: active ? '#EEF2FF' : '#FFFFFF',
                          color: active ? '#3730A3' : '#334155',
                          textAlign: 'left',
                          cursor: 'pointer',
                          display: 'flex',
                          flexDirection: 'column',
                          gap: '2px',
                        }}
                      >
                        <div style={{ fontSize: '10.5px', fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {preset.name}
                        </div>
                        <div style={{ fontSize: '9px', color: '#64748B', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                          {preset.description}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {/* 1. Creative Brief */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>
                  Ý tưởng chính / Creative Brief
                </label>
                <span style={{ fontSize: '10.5px', color: '#DC2626', fontWeight: 600 }}>* Bắt buộc</span>
              </div>
              <textarea
                value={creative.creativeBrief}
                onChange={(e) => onUpdateCreative({ creativeBrief: e.target.value })}
                rows={3}
                placeholder="Mô tả ý đồ phân cảnh: nhân vật biểu diễn, tương tác, năng lượng..."
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  fontSize: '12px',
                  lineHeight: 1.4,
                  boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* 2. Subject Action & Motion */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>
                Hành động & chuyển động chủ thể
              </label>
              <textarea
                value={creative.subjectAction}
                onChange={(e) => onUpdateCreative({ subjectAction: e.target.value })}
                rows={2}
                placeholder="Ví dụ: Động tác nhảy nhịp nhàng theo nhạc, tay vung dứt khoát..."
                style={{
                  width: '100%',
                  padding: '8px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  fontSize: '12px',
                  lineHeight: 1.4,
                  boxSizing: 'border-box',
                  resize: 'vertical',
                }}
              />
            </div>

            {/* 3. Camera Movement */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>
                Góc máy & chuyển động camera
              </label>
              <input
                type="text"
                value={creative.cameraMovement}
                onChange={(e) => onUpdateCreative({ cameraMovement: e.target.value })}
                placeholder="Mô tả góc máy hoặc chuyển động camera mong muốn..."
                style={{
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  fontSize: '12px',
                }}
              />
            </div>

            {/* 4. Look & Style */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>
                Phong cách & Thẩm mỹ
              </label>
              <input
                type="text"
                value={creative.styleDirection}
                onChange={(e) => onUpdateCreative({ styleDirection: e.target.value })}
                placeholder="Mô tả phong cách hình ảnh mong muốn..."
                style={{
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  fontSize: '12px',
                }}
              />
            </div>

            {/* 5. Negative Prompt */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
              <label style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>
                Điều cần tránh (Negative Prompt)
              </label>
              <input
                type="text"
                value={creative.negativePrompt}
                onChange={(e) => onUpdateCreative({ negativePrompt: e.target.value })}
                placeholder="Ví dụ: mờ nhòe, méo mặt, chữ lạ, giật hình..."
                style={{
                  padding: '7px 10px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  fontSize: '12px',
                }}
              />
            </div>

          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 3: PROMPT PREVIEW INSPECTOR */}
        {/* ============================================================== */}
        {selectedNodeType === 'preview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>
                Prompt Chuẩn Bị Gửi Veo Flow
              </span>
              <button
                type="button"
                onClick={handleCopyPrompt}
                style={{
                  border: 'none',
                  background: '#F1F5F9',
                  color: copied ? '#10B981' : '#475569',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                <span>{copied ? 'Đã chép' : 'Sao chép'}</span>
              </button>
            </div>

            <textarea
              value={isCustomPrompt ? customPromptText : structuredPrompt.fullPrompt}
              onChange={(e) => onUpdateCustomPromptText(e.target.value)}
              rows={8}
              style={{
                width: '100%',
                padding: '10px',
                borderRadius: '6px',
                border: '1px solid #CBD5E1',
                fontSize: '12px',
                lineHeight: 1.45,
                boxSizing: 'border-box',
                fontFamily: 'inherit',
              }}
            />

            {isCustomPrompt && (
              <button
                type="button"
                onClick={onResetToAutoPrompt}
                style={{
                  padding: '6px 10px',
                  borderRadius: '6px',
                  border: '1px solid #CBD5E1',
                  background: '#F8FAFC',
                  color: '#475569',
                  fontSize: '11.5px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '5px',
                }}
              >
                <RotateCcw size={12} />
                <span>Khôi phục theo mẫu tự động</span>
              </button>
            )}

            {/* Sections Breakdown */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '8px' }}>
              <span style={{ fontSize: '11px', fontWeight: 700, color: '#64748B', textTransform: 'uppercase' }}>
                Phân tích cấu trúc:
              </span>
              {(structuredPrompt?.sections || []).map((sec) => (
                <div
                  key={sec.id}
                  style={{
                    padding: '8px',
                    borderRadius: '6px',
                    background: '#F8FAFC',
                    border: '1px solid #E2E8F0',
                    fontSize: '11.5px',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginBottom: '2px' }}>
                    <span style={{ fontSize: '9px', fontWeight: 700, color: sec.colorVar }}>{sec.tag}</span>
                    <span style={{ color: '#64748B', fontSize: '10px' }}>({sec.label})</span>
                  </div>
                  <div style={{ color: '#1E293B' }}>{sec.content}</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ============================================================== */}
        {/* TAB 4: OUTPUT CONFIG INSPECTOR */}
        {/* ============================================================== */}
        {selectedNodeType === 'output' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>Cấu hình xuất Motion Control</div>
              <div style={{ marginTop: '3px', fontSize: '10.5px', color: '#64748B' }}>
                Các lựa chọn được ánh xạ sang profile video_edit do Backend công bố.
              </div>
            </div>

            <div style={{ padding: '11px', borderRadius: '9px', border: '1px solid #C7D2FE', background: '#F8FAFF', display: 'flex', flexDirection: 'column', gap: '10px' }}>
              <div>
                <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#312E81' }}>Flow project cho lượt tạo</div>
                <div style={{ marginTop: '3px', fontSize: '10px', lineHeight: 1.4, color: '#64748B' }}>
                  Project mới giúp cô lập media ID và tránh lỗi khi bấm tạo lại cùng nguyên liệu.
                </div>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '7px' }}>
                {([
                  { value: 'new_per_run', title: 'Project mới / lượt', icon: <FolderPlus size={14} /> },
                  { value: 'selected', title: 'Project đã chọn', icon: <FolderOpen size={14} /> },
                ] as const).map((option) => {
                  const active = (outputConfig.projectMode || 'new_per_run') === option.value
                  return (
                    <button
                      key={option.value}
                      type="button"
                      disabled={isRunning}
                      onClick={() => onUpdateProjectConfig({ projectMode: option.value })}
                      style={{
                        padding: '8px 6px',
                        borderRadius: '7px',
                        border: active ? '2px solid #4F46E5' : '1px solid #CBD5E1',
                        background: active ? '#EEF2FF' : '#FFFFFF',
                        color: active ? '#3730A3' : '#475569',
                        cursor: isRunning ? 'not-allowed' : 'pointer',
                        fontSize: '10.5px',
                        fontWeight: 700,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '5px',
                      }}
                    >
                      {option.icon}{option.title}
                    </button>
                  )
                })}
              </div>

              {(outputConfig.projectMode || 'new_per_run') === 'new_per_run' ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
                  <label style={{ fontSize: '10.5px', fontWeight: 700, color: '#475569' }}>Tiền tố tên project</label>
                  <input
                    type="text"
                    value={outputConfig.projectNamePrefix || ''}
                    disabled={isRunning}
                    onChange={(event) => onUpdateProjectConfig({ projectNamePrefix: event.target.value })}
                    placeholder="Motion Control"
                    maxLength={180}
                    style={{ padding: '7px 9px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '11px' }}
                  />
                  {lastRunProject && (
                    <small style={{ fontSize: '9.5px', color: '#047857' }}>Project gần nhất: {lastRunProject.name}</small>
                  )}
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
                  <select
                    value={activeProject?.id || ''}
                    disabled={isRunning || projects.length === 0}
                    onChange={(event) => void onSelectProject?.(event.target.value)}
                    style={{ padding: '7px 8px', borderRadius: '6px', border: '1px solid #CBD5E1', background: '#FFFFFF', fontSize: '11px' }}
                  >
                    <option value="">{projects.length ? 'Chọn Flow project' : 'Chưa có Flow project'}</option>
                    {projects.map((project) => (
                      <option key={project.id} value={project.id}>{project.name}</option>
                    ))}
                  </select>
                  <div style={{ display: 'flex', gap: '6px' }}>
                    <input
                      type="text"
                      value={newProjectName}
                      disabled={isCreatingProject || isRunning}
                      onChange={(event) => setNewProjectName(event.target.value)}
                      placeholder="Tên project mới"
                      maxLength={255}
                      style={{ minWidth: 0, flex: 1, padding: '7px 8px', borderRadius: '6px', border: '1px solid #CBD5E1', fontSize: '11px' }}
                    />
                    <button
                      type="button"
                      disabled={isCreatingProject || isRunning || !newProjectName.trim()}
                      onClick={() => void handleCreateProject()}
                      style={{ border: 'none', borderRadius: '6px', padding: '7px 9px', background: '#4F46E5', color: '#FFFFFF', fontSize: '10.5px', fontWeight: 700, cursor: isCreatingProject ? 'wait' : 'pointer' }}
                    >
                      {isCreatingProject ? 'Đang tạo...' : 'Tạo mới'}
                    </button>
                  </div>
                </div>
              )}

              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: isRunning ? 'not-allowed' : 'pointer' }}>
                <input
                  type="checkbox"
                  checked={outputConfig.freshAssets !== false}
                  disabled={isRunning}
                  onChange={(event) => onUpdateProjectConfig({ freshAssets: event.target.checked })}
                  style={{ marginTop: '2px' }}
                />
                <span style={{ fontSize: '10px', lineHeight: 1.4, color: '#475569' }}>
                  <strong>Upload mới nguyên liệu mỗi lượt</strong><br />Không tái sử dụng media ID của lần render trước.
                </span>
              </label>

              {projectActionError && (
                <div role="alert" style={{ fontSize: '10px', lineHeight: 1.4, color: '#B91C1C' }}>{projectActionError}</div>
              )}
            </div>

            {profileError && (
              <div style={{ padding: '8px 10px', borderRadius: '6px', background: '#FEF2F2', border: '1px solid #FECACA', color: '#991B1B', fontSize: '11px' }}>
                {profileError}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>Chất lượng tạo</label>
                <span style={{ fontSize: '9.5px', color: '#059669', fontWeight: 700 }}>✓ Tự động lưu</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${availableResolutions.length}, 1fr)`, gap: '8px' }}>
                {availableResolutions.map((option) => {
                  const active = outputConfig.resolution === option.resolution
                  return (
                    <button
                      key={option.resolution}
                      type="button"
                      onClick={() => onSelectResolution(option.resolution)}
                      style={{
                        padding: '9px',
                        borderRadius: '7px',
                        border: active ? '2px solid #4F46E5' : '1px solid #CBD5E1',
                        background: active ? '#EEF2FF' : '#FFFFFF',
                        color: active ? '#3730A3' : '#334155',
                        textAlign: 'left',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <span style={{ fontSize: '11.5px', fontWeight: 700 }}>{option.title}</span>
                        <span style={{ fontSize: '9px', fontWeight: 800, padding: '2px 4px', borderRadius: '4px', background: active ? '#C7D2FE' : '#F1F5F9', color: active ? '#312E81' : '#64748B' }}>
                          {option.creditCost}c
                        </span>
                      </div>
                      <div style={{ marginTop: '2px', fontSize: '9.5px', color: '#64748B' }}>{option.detail}</div>
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>Tỉ lệ khung hình</label>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${availableAspectRatios.length}, 1fr)`, gap: '8px' }}>
                {availableAspectRatios.map((ratio) => {
                  const active = outputConfig.aspectRatio === ratio
                  return (
                    <button
                      key={ratio}
                      type="button"
                      onClick={() => onSelectAspectRatio(ratio)}
                      style={{
                        padding: '8px',
                        borderRadius: '7px',
                        border: active ? '2px solid #4F46E5' : '1px solid #CBD5E1',
                        background: active ? '#EEF2FF' : '#FFFFFF',
                        color: active ? '#3730A3' : '#334155',
                        fontSize: '11.5px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {ratio === '9:16' ? '9:16 · Dọc' : '16:9 · Ngang'}
                    </button>
                  )
                })}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <label style={{ fontSize: '11.5px', fontWeight: 700, color: '#334155' }}>Thời lượng đoạn chuyển động</label>
              <div style={{ display: 'grid', gridTemplateColumns: `repeat(${availableDurations.length}, 1fr)`, gap: '6px' }}>
                {availableDurations.map((duration) => {
                  const active = outputConfig.durationSeconds === duration
                  return (
                    <button
                      key={duration}
                      type="button"
                      onClick={() => onSelectDuration(duration)}
                      style={{
                        padding: '7px 4px',
                        borderRadius: '6px',
                        border: active ? '2px solid #4F46E5' : '1px solid #CBD5E1',
                        background: active ? '#EEF2FF' : '#FFFFFF',
                        color: active ? '#3730A3' : '#334155',
                        fontSize: '11px',
                        fontWeight: 700,
                        cursor: 'pointer',
                      }}
                    >
                      {duration}s
                    </button>
                  )
                })}
              </div>
              <small style={{ fontSize: '10px', color: '#64748B' }}>
                Chọn thời lượng sẽ cập nhật điểm kết thúc trim từ mốc bắt đầu hiện tại.
              </small>
            </div>

            {/* SỐ LƯỢNG BIẾN THỂ (VARIANTS) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '12px', fontWeight: 700, color: '#1E293B' }}>Số lượng biến thể video</span>
                <span style={{ fontSize: '11px', color: '#4F46E5', fontWeight: 700 }}>
                  {outputConfig.numOutputs || 1} biến thể
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '6px' }}>
                {[1, 2, 3, 4].map((count) => {
                  const isActive = (outputConfig.numOutputs || 1) === count
                  return (
                    <button
                      key={count}
                      type="button"
                      onClick={() => onUpdateProjectConfig({ numOutputs: count })}
                      disabled={isRunning}
                      style={{
                        padding: '7px 4px',
                        borderRadius: '6px',
                        border: isActive ? '1.5px solid #4F46E5' : '1px solid #CBD5E1',
                        background: isActive ? '#EEF2FF' : '#FFFFFF',
                        color: isActive ? '#4F46E5' : '#334155',
                        fontWeight: isActive ? 700 : 600,
                        fontSize: '12px',
                        cursor: isRunning ? 'not-allowed' : 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        gap: '2px',
                        boxShadow: isActive ? '0 1px 3px rgba(79, 70, 229, 0.2)' : 'none',
                        transition: 'all 0.15s ease',
                      }}
                    >
                      <span style={{ fontSize: '13px', fontWeight: 700 }}>{count}</span>
                      <small style={{ fontSize: '9.5px', color: isActive ? '#4338CA' : '#64748B' }}>
                        {count === 1 ? '1 bản' : `${count} bản`}
                      </small>
                    </button>
                  )
                })}
              </div>
              <small style={{ fontSize: '10px', color: '#64748B', lineHeight: 1.4 }}>
                Mỗi biến thể sinh ra một phiên bản biểu cảm & chi tiết chuyển động độc lập từ cùng video mẫu.
              </small>
            </div>

            <div style={{ padding: '10px', borderRadius: '8px', border: '1px solid #E2E8F0', background: '#F8FAFC' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', color: '#64748B' }}>
                  Chi phí: {outputConfig.creditCost ?? selectedProfile?.credit_cost ?? 40}c × {outputConfig.numOutputs || 1}
                </span>
                <strong style={{ fontSize: '14px', color: '#C2410C' }}>
                  {((outputConfig.creditCost ?? selectedProfile?.credit_cost ?? 40) * (outputConfig.numOutputs || 1))} credits
                </strong>
              </div>
              <div style={{ marginTop: '6px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span style={{ fontSize: '11px', color: '#64748B' }}>Số video kết quả</span>
                <strong style={{ fontSize: '11.5px', color: '#0F172A' }}>
                  {outputConfig.numOutputs || 1} video hoàn chỉnh
                </strong>
              </div>
              <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px solid #E2E8F0', fontSize: '10px', color: selectedProfile?.runtime_verified && outputConfig.durationSeconds === selectedProfile.duration_seconds ? '#047857' : '#B45309' }}>
                {selectedProfile?.runtime_verified && outputConfig.durationSeconds === selectedProfile.duration_seconds
                  ? '✓ Tổ hợp này đã được kiểm thử runtime trong project.'
                  : 'Tổ hợp này được Flow hỗ trợ nhưng chưa được kiểm thử E2E trong project.'}
              </div>
            </div>

            <div style={{ padding: '10px', borderRadius: '8px', border: '1px solid #C7D2FE', background: '#F8FAFF' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '7px', minWidth: 0 }}>
                  <Columns2 size={16} color="#4F46E5" style={{ marginTop: '1px', flexShrink: 0 }} />
                  <div>
                    <div style={{ fontSize: '11.5px', fontWeight: 800, color: '#312E81' }}>Đối chiếu video</div>
                    <div style={{ marginTop: '3px', fontSize: '10px', lineHeight: 1.4, color: '#64748B' }}>
                      Hiển thị kết quả và video tham chiếu cạnh nhau sau khi render xong.
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={outputConfig.showReferenceComparison !== false}
                  disabled={isRunning || !motion.previewUrl}
                  onClick={() => onUpdateProjectConfig({ showReferenceComparison: outputConfig.showReferenceComparison === false })}
                  style={{
                    flexShrink: 0,
                    minWidth: 92,
                    padding: '7px 9px',
                    borderRadius: '7px',
                    border: outputConfig.showReferenceComparison !== false ? '1px solid #4F46E5' : '1px solid #CBD5E1',
                    background: outputConfig.showReferenceComparison !== false ? '#4F46E5' : '#FFFFFF',
                    color: outputConfig.showReferenceComparison !== false ? '#FFFFFF' : '#64748B',
                    fontSize: '10.5px',
                    fontWeight: 800,
                    cursor: isRunning || !motion.previewUrl ? 'not-allowed' : 'pointer',
                    opacity: motion.previewUrl ? 1 : 0.55,
                  }}
                >
                  {outputConfig.showReferenceComparison !== false ? 'Đang bật' : 'Đang tắt'}
                </button>
              </div>
              {!motion.previewUrl && (
                <div style={{ marginTop: '7px', fontSize: '9.5px', color: '#B45309' }}>Nạp video tham chiếu để bật chế độ đối chiếu.</div>
              )}
            </div>

            <div style={{ padding: '9px 10px', borderRadius: '8px', border: '1px solid #BFDBFE', background: '#EFF6FF', color: '#1E40AF', fontSize: '10.5px', lineHeight: 1.45 }}>
              <strong>1080p là bước upscale riêng.</strong> Bản hiện tại tạo tối đa 720p; adapter upscale sẽ được nối sau khi có trace runtime, nên UI chưa cho chọn 1080p như độ phân giải tạo.
            </div>

            {/* Thanh chọn biến thể trong Inspector nếu có nhiều biến thể */}
            {variants && variants.length > 1 && (
              <div style={{ padding: '8px 10px', borderRadius: '8px', background: '#F8FAFC', border: '1px solid #E2E8F0' }}>
                <div style={{ fontSize: '11px', fontWeight: 700, color: '#475569', marginBottom: '6px' }}>
                  Biến thể kiểm tra ({variants.length} bản):
                </div>
                <div style={{ display: 'flex', gap: '5px', overflowX: 'auto', paddingBottom: '2px' }}>
                  {variants.map((v, idx) => {
                    const isActive = (activeVariantIndex ?? 0) === idx
                    let statusIcon = <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#94A3B8' }} />
                    if (v.status === 'done') statusIcon = <CheckCircle2 size={11} color="#10B981" />
                    else if (v.status === 'submitting' || v.status === 'generating') statusIcon = <RotateCw size={11} className="animate-spin" color="#4F46E5" />
                    else if (v.status === 'error') statusIcon = <AlertCircle size={11} color="#EF4444" />
                    return (
                      <button
                        key={v.index || idx}
                        type="button"
                        onClick={() => onSelectVariantIndex?.(idx)}
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '4px 8px',
                          borderRadius: '5px',
                          border: isActive ? '1.5px solid #4F46E5' : '1px solid #CBD5E1',
                          background: isActive ? '#EEF2FF' : '#FFFFFF',
                          color: isActive ? '#4F46E5' : '#475569',
                          fontSize: '10.5px',
                          fontWeight: isActive ? 700 : 500,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {statusIcon}
                        <span>Biến thể #{v.index}</span>
                      </button>
                    )
                  })}
                </div>
              </div>
            )}

            {(() => {
              const activeSlot = (variants && variants.length > 0)
                ? variants[Math.min(activeVariantIndex ?? 0, variants.length - 1)]
                : null
              const activeSlotError = activeSlot?.error
              const displayError = activeSlotError || (!variants || variants.length === 0 ? runError : null)

              if (displayError) {
                return (
                  <div role="alert" style={{ padding: '11px', borderRadius: '8px', border: '1px solid #FCA5A5', background: '#FFF7F7', color: '#7F1D1D' }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                      <AlertCircle size={17} color="#DC2626" style={{ marginTop: '1px', flexShrink: 0 }} />
                      <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: '12px', fontWeight: 800 }}>
                          {activeSlotError ? `Biến thể #${activeSlot?.index}: ${displayError.title}` : displayError.title}
                        </div>
                        <div style={{ marginTop: '3px', fontSize: '10px', fontWeight: 700, color: '#B91C1C' }}>
                          Công đoạn: {displayError.stageLabel}
                        </div>
                        <div style={{ marginTop: '7px', fontSize: '10.5px', lineHeight: 1.45, overflowWrap: 'anywhere' }}>
                          {displayError.message}
                        </div>
                        <div style={{ marginTop: '8px', padding: '7px', borderRadius: '6px', background: '#FEE2E2', fontSize: '10px', lineHeight: 1.45 }}>
                          <strong>Cách xử lý:</strong> {displayError.hint}
                        </div>
                        <div style={{ marginTop: '6px', fontSize: '9px', color: '#B91C1C' }}>
                          Mã lỗi: {displayError.code}{displayError.jobId ? ` · Job: ${displayError.jobId}` : ''}
                        </div>
                      </div>
                    </div>
                    {activeSlot && activeSlotError && onRetryVariant && (
                      <button
                        type="button"
                        onClick={() => onRetryVariant(activeSlot.index)}
                        disabled={isRunning}
                        style={{
                          marginTop: '10px',
                          width: '100%',
                          padding: '7px 12px',
                          borderRadius: '6px',
                          border: '1px solid #DC2626',
                          background: '#FEF2F2',
                          color: '#DC2626',
                          fontSize: '11px',
                          fontWeight: 700,
                          cursor: isRunning ? 'not-allowed' : 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px',
                        }}
                      >
                        <RotateCw size={13} />
                        <span>Thử lại riêng Biến thể #{activeSlot.index}</span>
                      </button>
                    )}
                  </div>
                )
              }

              if (activeSlot && (activeSlot.status === 'submitting' || activeSlot.status === 'generating')) {
                return (
                  <div style={{ padding: '10px', borderRadius: '8px', border: '1px solid #C7D2FE', background: '#EEF2FF', color: '#3730A3', display: 'flex', alignItems: 'center', gap: '8px', fontSize: '11px' }}>
                    <RotateCw size={15} className="animate-spin" color="#4F46E5" />
                    <div>
                      <b>Biến thể #{activeSlot.index}:</b> {activeSlot.progressText || 'Đang tạo video...'}
                    </div>
                  </div>
                )
              }

              if (activeSlot && activeSlot.status === 'done') {
                return (
                  <div style={{ padding: '8px 10px', borderRadius: '8px', border: '1px solid #A7F3D0', background: '#ECFDF5', color: '#065F46', display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px' }}>
                    <CheckCircle2 size={14} color="#10B981" />
                    <span>Biến thể #{activeSlot.index} đã tạo thành công!</span>
                  </div>
                )
              }

              if (!isReadyToRun && missingReasons.length > 0) {
                return (
                  <div style={{ padding: '10px', borderRadius: '8px', border: '1px solid #FCD34D', background: '#FFFBEB', color: '#92400E' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', fontWeight: 800 }}>
                      <AlertCircle size={15} /> Chưa thể tạo video
                    </div>
                    <ul style={{ margin: '6px 0 0', paddingLeft: '18px', fontSize: '10.5px', lineHeight: 1.5 }}>
                      {missingReasons.map((reason) => <li key={reason}>{reason}</li>)}
                    </ul>
                  </div>
                )
              }

              return null
            })()}

            {/* Big Trigger Run Button */}
            <button
              type="button"
              disabled={!isReadyToRun || isRunning}
              onClick={onRunWorkflow}
              style={{
                marginTop: '12px',
                padding: '11px',
                borderRadius: '8px',
                border: 'none',
                background: !isReadyToRun || isRunning ? '#94A3B8' : 'linear-gradient(135deg, #4F46E5 0%, #7C3AED 100%)',
                color: '#FFFFFF',
                fontSize: '13px',
                fontWeight: 700,
                cursor: !isReadyToRun || isRunning ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '8px',
                boxShadow: !isReadyToRun || isRunning ? 'none' : '0 4px 12px rgba(79, 70, 229, 0.35)',
              }}
            >
              <Sparkles size={16} />
              <span>{isRunning ? 'Đang tạo video...' : runError ? 'Thử Lại Sau Khi Kiểm Tra' : 'Tạo Video Ngay'}</span>
            </button>
          </div>
        )}
      </div>
    </aside>
  )
}
