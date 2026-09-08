import React, { useState } from 'react'
import {
  X,
  Clapperboard,
  FolderPlus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Sparkles,
  Layers,
  Film,
} from 'lucide-react'
import type { GptSalesScriptItem, VeoVideoConfig } from '../types'
import type { VeoCapabilities, VeoProject } from '../../veo-studio/types'

interface VeoSetupModalProps {
  isOpen: boolean
  onClose: () => void
  projects: VeoProject[]
  activeProject: VeoProject | null
  capabilities: VeoCapabilities | null
  currentConfig: VeoVideoConfig
  availableScripts?: GptSalesScriptItem[]
  selectedScriptIndex?: number
  onSelectProject: (projectId: string) => Promise<void> | void
  onCreateProject: (name: string) => Promise<void> | void
  onDeleteProject: (projectId: string) => Promise<void> | void
  onSaveConfig: (config: VeoVideoConfig, scriptIndex?: number) => void
}

export function VeoSetupModal({
  isOpen,
  onClose,
  projects,
  activeProject,
  capabilities,
  currentConfig,
  availableScripts = [],
  selectedScriptIndex = 0,
  onSelectProject,
  onCreateProject,
  onDeleteProject,
  onSaveConfig,
}: VeoSetupModalProps) {
  if (!isOpen) return null

  // Local state for video configurations
  const [model, setModel] = useState<string>(currentConfig.model || 'Omni 1.1 Flash')
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>(currentConfig.aspectRatio || '9:16')
  const [duration, setDuration] = useState<number>(currentConfig.duration || 4)
  const [resolution, setResolution] = useState<string>(currentConfig.resolution || '720p')
  const [variations, setVariations] = useState<number>(currentConfig.variations || 1)
  const [scriptIndex, setScriptIndex] = useState<number>(selectedScriptIndex)

  // Project creation state
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [newProjectName, setNewProjectName] = useState('')
  const [isSubmittingProject, setIsSubmittingProject] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // Profiles from capabilities
  const profiles = (capabilities?.profiles || []).filter((p) => p.input_mode === 'text_to_video')
  const modelNames = [...new Set(profiles.map((p) => p.model_display_name))]
  const fallbackModels = modelNames.length > 0 ? modelNames : ['Omni 1.1 Flash', 'Veo 3.0 Fast', 'Veo 3.0 Quality']

  // Credit cost calculation
  const selectedProfile = profiles.find((p) => p.model_display_name === model)
  const creditCost = selectedProfile?.credit_cost ?? 7

  const handleCreateNewProject = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!newProjectName.trim()) return
    setIsSubmittingProject(true)
    setErrorMsg('')
    try {
      await onCreateProject(newProjectName.trim())
      setNewProjectName('')
      setIsCreatingProject(false)
    } catch (err: any) {
      setErrorMsg(err.message || 'Không thể tạo project')
    } finally {
      setIsSubmittingProject(false)
    }
  }

  const handleSave = () => {
    onSaveConfig(
      {
        model,
        aspectRatio,
        duration,
        resolution,
        variations,
        creditCost,
      },
      availableScripts.length > 0 ? scriptIndex : undefined,
    )
    onClose()
  }

  const selectedScript = availableScripts[scriptIndex]

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(6px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 620,
          maxHeight: '90vh',
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 20px 40px rgba(0, 0, 0, 0.25)',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'wfModalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div
          style={{
            padding: '16px 20px',
            background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 9,
                background: 'linear-gradient(135deg, #f43f5e, #e11d48)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                boxShadow: '0 3px 8px rgba(244, 63, 94, 0.3)',
              }}
            >
              <Clapperboard size={18} />
            </div>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                Thiết Lập Google Veo & Flow Project
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                Cấu hình dự án lưu trữ, thông số render và kịch bản nguồn
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#64748b',
              cursor: 'pointer',
              padding: 4,
              borderRadius: 6,
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Modal Body */}
        <div style={{ padding: '20px', overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: 18 }}>
          {errorMsg && (
            <div style={{ padding: '8px 12px', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, color: '#b91c1c', fontSize: 12 }}>
              {errorMsg}
            </div>
          )}

          {/* 1. Project Management Section */}
          <div style={{ padding: 14, background: '#f8fafc', borderRadius: 10, border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <label style={{ fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                Dự án Google Flow (Project)
              </label>
              {activeProject ? (
                <span style={{ fontSize: 10, color: '#059669', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <CheckCircle2 size={12} /> Đang chọn: {activeProject.name}
                </span>
              ) : (
                <span style={{ fontSize: 10, color: '#d97706', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 3 }}>
                  <AlertCircle size={12} /> Chưa có project
                </span>
              )}
            </div>

            {/* Project Selector Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <select
                style={{
                  flex: 1,
                  padding: '8px 12px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#1e293b',
                  cursor: 'pointer',
                }}
                value={activeProject?.id || ''}
                onChange={(e) => onSelectProject(e.target.value)}
              >
                {projects.length === 0 && <option value="">Chưa có project nào (Vui lòng tạo mới)</option>}
                {projects.map((p) => (
                  <option key={p.id} value={p.id}>
                    📁 {p.name} {p.clip_count != null ? `(${p.clip_count} clips)` : ''}
                  </option>
                ))}
              </select>

              {activeProject && (
                <button
                  type="button"
                  onClick={() => onDeleteProject(activeProject.id)}
                  title="Xóa project này"
                  style={{
                    padding: '8px 10px',
                    borderRadius: 8,
                    border: '1px solid #e2e8f0',
                    background: '#ffffff',
                    color: '#ef4444',
                    cursor: 'pointer',
                  }}
                >
                  <Trash2 size={14} />
                </button>
              )}

              <button
                type="button"
                onClick={() => setIsCreatingProject(!isCreatingProject)}
                style={{
                  padding: '8px 14px',
                  borderRadius: 8,
                  border: 'none',
                  background: 'linear-gradient(135deg, #4f46e5, #4338ca)',
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 5,
                  cursor: 'pointer',
                  boxShadow: '0 2px 4px rgba(79, 70, 229, 0.25)',
                  whiteSpace: 'nowrap',
                }}
              >
                <FolderPlus size={14} />
                + Tạo Project
              </button>
            </div>

            {/* Inline New Project Form */}
            {isCreatingProject && (
              <form onSubmit={handleCreateNewProject} style={{ marginTop: 10, display: 'flex', gap: 6, paddingTop: 10, borderTop: '1px dashed #cbd5e1' }}>
                <input
                  type="text"
                  placeholder="Nhập tên project mới (ví dụ: Video TikTok Weilaiya)..."
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  style={{
                    flex: 1,
                    padding: '7px 10px',
                    borderRadius: 6,
                    border: '1px solid #818cf8',
                    fontSize: 12,
                    outline: 'none',
                  }}
                  autoFocus
                />
                <button
                  type="submit"
                  disabled={isSubmittingProject || !newProjectName.trim()}
                  style={{
                    padding: '7px 12px',
                    borderRadius: 6,
                    border: 'none',
                    background: '#4f46e5',
                    color: '#ffffff',
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  {isSubmittingProject ? 'Đang tạo...' : 'Tạo ngay'}
                </button>
                <button
                  type="button"
                  onClick={() => setIsCreatingProject(false)}
                  style={{
                    padding: '7px 10px',
                    borderRadius: 6,
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    fontSize: 11,
                    color: '#64748b',
                    cursor: 'pointer',
                  }}
                >
                  Hủy
                </button>
              </form>
            )}
          </div>

          {/* 2. Video Generation Configuration (Exact match to User Screenshot) */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            {/* MODEL VIDEO */}
            <div>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                  Model Video
                </label>
                <span
                  style={{
                    fontSize: 10.5,
                    fontWeight: 700,
                    color: '#4f46e5',
                    background: '#eef2ff',
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid #c7d2fe',
                  }}
                >
                  {creditCost} credits / lần tạo
                </span>
              </div>
              <select
                value={model}
                onChange={(e) => setModel(e.target.value)}
                style={{
                  width: '100%',
                  padding: '9px 12px',
                  borderRadius: 8,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  fontSize: 12.5,
                  fontWeight: 600,
                  color: '#0f172a',
                  cursor: 'pointer',
                }}
              >
                {fallbackModels.map((m) => (
                  <option key={m} value={m}>
                    {m} ({creditCost} credits)
                  </option>
                ))}
              </select>
            </div>

            {/* TỈ LỆ KHUNG HÌNH */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Tỉ lệ khung hình
              </label>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => setAspectRatio('16:9')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '9px 14px',
                    borderRadius: 8,
                    border: aspectRatio === '16:9' ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                    background: aspectRatio === '16:9' ? '#eef2ff' : '#ffffff',
                    color: aspectRatio === '16:9' ? '#4338ca' : '#475569',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span
                    style={{
                      width: 16,
                      height: 10,
                      border: `1.5px solid ${aspectRatio === '16:9' ? '#4338ca' : '#64748b'}`,
                      borderRadius: 2,
                    }}
                  />
                  16:9
                </button>

                <button
                  type="button"
                  onClick={() => setAspectRatio('9:16')}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '9px 14px',
                    borderRadius: 8,
                    border: aspectRatio === '9:16' ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                    background: aspectRatio === '9:16' ? '#eef2ff' : '#ffffff',
                    color: aspectRatio === '9:16' ? '#4338ca' : '#475569',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <span
                    style={{
                      width: 10,
                      height: 16,
                      border: `1.5px solid ${aspectRatio === '9:16' ? '#4338ca' : '#64748b'}`,
                      borderRadius: 2,
                    }}
                  />
                  9:16 (TikTok / Reels)
                </button>
              </div>
            </div>

            {/* THỜI LƯỢNG */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Thời lượng mỗi cảnh
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {[4, 6, 8, 10].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setDuration(d)}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      borderRadius: 8,
                      border: duration === d ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                      background: duration === d ? '#eef2ff' : '#ffffff',
                      color: duration === d ? '#4338ca' : '#475569',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {d}s
                  </button>
                ))}
              </div>
            </div>

            {/* ĐỘ PHÂN GIẢI */}
            <div>
              <label style={{ display: 'block', fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                Độ phân giải
              </label>
              <div style={{ display: 'flex', gap: 8 }}>
                {['720p', '360p Draft', '1080p'].map((res) => (
                  <button
                    key={res}
                    type="button"
                    onClick={() => setResolution(res)}
                    style={{
                      flex: 1,
                      padding: '8px 0',
                      borderRadius: 8,
                      border: resolution === res ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                      background: resolution === res ? '#eef2ff' : '#ffffff',
                      color: resolution === res ? '#4338ca' : '#475569',
                      fontSize: 12,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    {res}
                  </button>
                ))}
              </div>
            </div>

            {/* BIẾN THỂ (VARIATIONS) */}
            <div style={{ padding: '8px 12px', background: '#f8fafc', borderRadius: 8, border: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 11, fontWeight: 800, color: '#334155', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
                <Layers size={13} style={{ color: '#4f46e5' }} />
                Biến thể:
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                {[1, 2, 3, 4].map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setVariations(v)}
                    style={{
                      padding: '4px 10px',
                      borderRadius: 6,
                      border: variations === v ? '1.5px solid #4f46e5' : '1px solid #cbd5e1',
                      background: variations === v ? '#4f46e5' : '#ffffff',
                      color: variations === v ? '#ffffff' : '#64748b',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                    }}
                  >
                    x{v}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* 3. GPT Script Mapping Section */}
          {availableScripts.length > 0 && (
            <div style={{ padding: 14, background: '#faf5ff', borderRadius: 10, border: '1px solid #e9d5ff' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                <label style={{ fontSize: 11, fontWeight: 800, color: '#6b21a8', textTransform: 'uppercase', letterSpacing: '0.04em', display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Sparkles size={13} style={{ color: '#9333ea' }} />
                  Đồng bộ kịch bản từ ChatGPT sang 3 cảnh Veo
                </label>
                <span style={{ fontSize: 10, color: '#9333ea', fontWeight: 600 }}>
                  3 kịch bản khả dụng
                </span>
              </div>

              {/* Angle Tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {availableScripts.map((s, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setScriptIndex(idx)}
                    style={{
                      flex: 1,
                      padding: '6px 4px',
                      borderRadius: 6,
                      fontSize: 10.5,
                      fontWeight: 700,
                      border: scriptIndex === idx ? '1.5px solid #9333ea' : '1px solid #e9d5ff',
                      background: scriptIndex === idx ? '#9333ea' : '#ffffff',
                      color: scriptIndex === idx ? '#ffffff' : '#7e22ce',
                      cursor: 'pointer',
                      textAlign: 'center',
                    }}
                  >
                    {s.angle.includes('1') ? 'Góc 1: Vấn đề' : s.angle.includes('2') ? 'Góc 2: USP' : 'Góc 3: Trải nghiệm'}
                  </button>
                ))}
              </div>

              {/* Preview Mapping into 3 Scenes */}
              {selectedScript && (
                <div style={{ fontSize: 11, color: '#475569', background: '#ffffff', padding: 8, borderRadius: 6, border: '1px solid #f3e8ff' }}>
                  <div style={{ marginBottom: 4 }}>
                    <strong style={{ color: '#7e22ce' }}>🎬 Cảnh #1 (Mở đầu):</strong> {selectedScript.hook || selectedScript.problem || 'Cận cảnh vấn đề & thu hút người xem'}
                  </div>
                  <div style={{ marginBottom: 4 }}>
                    <strong style={{ color: '#7e22ce' }}>💎 Cảnh #2 (Sản phẩm & USP):</strong> {selectedScript.product || selectedScript.benefits || 'Trình diễn sản phẩm & tính năng nổi bật'}
                  </div>
                  <div>
                    <strong style={{ color: '#7e22ce' }}>✨ Cảnh #3 (Chốt đơn & CTA):</strong> {selectedScript.cta || 'Kêu gọi hành động & ưu đãi'}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div
          style={{
            padding: '12px 20px',
            background: '#f8fafc',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-end',
            gap: 10,
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#475569',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Đóng
          </button>

          <button
            type="button"
            onClick={handleSave}
            style={{
              padding: '8px 20px',
              borderRadius: 8,
              border: 'none',
              background: 'linear-gradient(135deg, #f43f5e, #e11d48)',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 3px 8px rgba(244, 63, 94, 0.3)',
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <Film size={14} />
            Lưu Cấu Hình & Áp Dụng Cho Flow Studio
          </button>
        </div>
      </div>
    </div>
  )
}
