import React, { useState } from 'react'
import { createPortal } from 'react-dom'
import { Handle, Position } from '@xyflow/react'
import {
  Bot,
  Sparkles,
  Trash2,
  CheckCircle2,
  AlertCircle,
  Copy,
  Check,
  RotateCcw,
  Camera,
  FileText,
  Film,
  Plus,
  Save,
  Bookmark,
  X,
  Star,
  Mic,
  Eye,
} from 'lucide-react'
import type { GptScriptNodeData, PromptPresetItem } from '../types'
import { estimateVoiceoverWordRange, normalizeClipDuration } from '../services/buildScenePlan'

const CONTENT_MODE_OPTIONS = [
  { value: 'sales', label: 'Bán hàng' },
  { value: 'review', label: 'Review' },
  { value: 'ugc', label: 'UGC' },
  { value: 'lifestyle', label: 'Lifestyle' },
  { value: 'tutorial', label: 'Hướng dẫn' },
  { value: 'comparison', label: 'So sánh' },
  { value: 'unboxing', label: 'Unboxing' },
] as const

function getPhaseStyle(phase?: string) {
  const p = (phase || '').toLowerCase()
  if (p.includes('hook')) {
    return { bg: '#ffe4e6', color: '#be123c', border: '#fecdd3' }
  }
  if (p.includes('reveal')) {
    return { bg: '#fef3c7', color: '#b45309', border: '#fde68a' }
  }
  if (p.includes('demo')) {
    return { bg: '#e0e7ff', color: '#3730a3', border: '#c7d2fe' }
  }
  if (p.includes('cta')) {
    return { bg: '#d1fae5', color: '#065f46', border: '#a7f3d0' }
  }
  return { bg: '#f3e8ff', color: '#6b21a8', border: '#e9d5ff' }
}

interface GptScriptNodeProps {
  data: GptScriptNodeData
  selected?: boolean
}

export function GptScriptNode({ data, selected }: GptScriptNodeProps) {
  const isGenerating = data.isGenerating ?? false
  const isStartNode = data.isStartNode ?? false
  const isOrphan = data.isOrphan ?? false
  const connectedImages = data.connectedImages || []
  const validImages = connectedImages.filter(Boolean) as string[]
  const hasProductData = data.hasProductData ?? false
  const salesScripts = data.salesScripts || []
  const scriptCollection = data.scriptCollection
  const isScriptOutputStale = data.isScriptOutputStale ?? false
  const [activeTab, setActiveTab] = useState<number>(0)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  const requestedCount = data.requestedCount ?? 3
  const contentMode = data.contentMode ?? ''
  const storyMode = data.storyMode ?? 'sequential'
  const clipDurationSeconds = normalizeClipDuration(data.clipDurationSeconds)
  const voiceoverWords = estimateVoiceoverWordRange(clipDurationSeconds)

  const availablePresets = data.availablePresets || []
  const defaultPreset = availablePresets.find((p) => p.is_default) || availablePresets[0]
  const selectedPresetId =
    data.selectedPresetId ||
    (contentMode ? availablePresets.find((p) => p.content_mode === contentMode)?.id : null) ||
    defaultPreset?.id ||
    ''
  const currentPreset = availablePresets.find((p) => p.id === selectedPresetId) || defaultPreset
  const isPromptDirty = Boolean(
    currentPreset && (data.prompt || '').trim() !== (currentPreset.prompt || '').trim()
  )

  const [isCreatingPreset, setIsCreatingPreset] = useState(false)
  const [newPresetTitle, setNewPresetTitle] = useState('')
  const [isSavingPreset, setIsSavingPreset] = useState(false)
  const [presetNotification, setPresetNotification] = useState<string | null>(null)
  const [promptPreview, setPromptPreview] = useState<{ userPrompt: string; systemPrompt: string } | null>(null)
  const [isPreviewingPrompt, setIsPreviewingPrompt] = useState(false)
  const [promptPreviewError, setPromptPreviewError] = useState<string | null>(null)

  const handlePreviewPrompt = async () => {
    if (!data.onPreviewPrompt || isPreviewingPrompt) return
    setIsPreviewingPrompt(true)
    setPromptPreviewError(null)
    try {
      setPromptPreview(await data.onPreviewPrompt())
    } catch (err: any) {
      setPromptPreviewError(err?.message || 'Không thể dựng prompt hoàn chỉnh.')
    } finally {
      setIsPreviewingPrompt(false)
    }
  }

  const handleSelectPreset = (presetId: string) => {
    const preset = availablePresets.find((p) => p.id === presetId)
    if (preset) {
      data.onSelectPreset?.(presetId)
      data.onChangeScriptConfig?.({ contentMode: preset.content_mode })
      if (preset.prompt) {
        data.onChangePrompt?.(preset.prompt)
      }
    }
  }

  const handleConfirmCreatePreset = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()
    if (!newPresetTitle.trim()) return
    setIsSavingPreset(true)
    try {
      await data.onSaveAsNewPreset?.(newPresetTitle.trim(), contentMode || 'custom', data.prompt || '')
      setNewPresetTitle('')
      setIsCreatingPreset(false)
      setPresetNotification('✓ Đã lưu mẫu kịch bản mới!')
      setTimeout(() => setPresetNotification(null), 2500)
    } catch (err: any) {
      alert(err?.message || 'Lỗi khi lưu preset mới')
    } finally {
      setIsSavingPreset(false)
    }
  }

  const handleUpdateCurrentPreset = async () => {
    if (!selectedPresetId) return
    setIsSavingPreset(true)
    try {
      await data.onUpdatePreset?.(selectedPresetId, data.prompt || '')
      setPresetNotification(currentPreset?.is_system
        ? '✓ Mẫu gốc được giữ nguyên, đã lưu thành bản sao!'
        : '✓ Đã cập nhật mẫu!')
      setTimeout(() => setPresetNotification(null), 2500)
    } catch (err: any) {
      alert(err?.message || 'Lỗi khi cập nhật preset')
    } finally {
      setIsSavingPreset(false)
    }
  }

  const handleSetDefaultCurrentPreset = async () => {
    if (!selectedPresetId) return
    setIsSavingPreset(true)
    try {
      await data.onSetDefaultPreset?.(selectedPresetId)
      setPresetNotification('✓ Đã đặt làm thể loại mặc định!')
      setTimeout(() => setPresetNotification(null), 2500)
    } catch (err: any) {
      alert(err?.message || 'Lỗi khi đặt thể loại mặc định')
    } finally {
      setIsSavingPreset(false)
    }
  }

  const handleDeleteCurrentPreset = async () => {
    if (!selectedPresetId) return
    if (confirm(`Bạn có chắc chắn muốn xóa mẫu "${currentPreset?.name}"?`)) {
      try {
        await data.onDeletePreset?.(selectedPresetId)
        setPresetNotification('✓ Đã xóa mẫu kịch bản!')
        setTimeout(() => setPresetNotification(null), 2500)
      } catch (err: any) {
        alert(err?.message || 'Lỗi khi xóa preset')
      }
    }
  }



  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIndex(idx)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  const handleCountChange = (count: number) => {
    data.onChangeScriptConfig?.({ count: Math.min(200, Math.max(1, Math.round(count))) })
  }

  const safeTab = Math.min(Math.max(0, activeTab), Math.max(0, salesScripts.length - 1))
  const currentScript = salesScripts[safeTab]

  return (
    <div
      className={`wf-node-card ${selected ? 'selected' : ''} ${isStartNode ? 'is-start-node' : ''} ${isOrphan ? 'is-orphan' : ''}`}
      style={{ width: 420 }}
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

      {/* Top Handle from ProductAssetsNode */}
      <Handle
        type="target"
        position={Position.Top}
        id="from-products"
        style={{ left: '30%' }}
        className="wf-handle wf-handle-target"
        title="Nhận ảnh sản phẩm từ node Products"
      />

      {/* Top-Left Handle from CharacterSceneNode */}
      <Handle
        type="target"
        position={Position.Top}
        id="from-charscene"
        style={{ left: '70%' }}
        className="wf-handle wf-handle-target"
        title="Nhận bối cảnh/nhân vật từ node Character & Scene"
      />

      {/* Left Handle from GeminiAnalysisNode */}
      <Handle
        type="target"
        position={Position.Left}
        id="from-gemini"
        style={{ top: '45%' }}
        className="wf-handle wf-handle-target"
        title="Nhận phân tích USP từ Gemini"
      />

      {/* Header */}
      <div className="wf-node-header">
        <div className="wf-node-title-group">
          <div className="wf-node-icon">
            <Bot size={15} />
          </div>
          <div>
            <div className="wf-node-title">
              {data.title || 'ChatGPT • Kịch Bản'}
            </div>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>
              {data.provider || 'Viết phân cảnh & lời thoại'}
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
              background: salesScripts.length > 0 ? '#ecfdf5' : '#f1f5f9',
              color: salesScripts.length > 0 ? '#065f46' : '#64748b',
              border: salesScripts.length > 0 ? '1px solid #d1fae5' : '1px solid #e2e8f0',
            }}
          >
            {salesScripts.length > 0 ? `${salesScripts.length} Kịch bản` : 'Chưa có'}
          </span>
          <button
            type="button"
            className="wf-node-del-btn"
            onClick={(e) => {
              e.stopPropagation()
              data.onDelete?.()
            }}
            title="Xóa khối kịch bản này"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="wf-node-body">
        {/* Error Banner */}
        {data.scriptError && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              borderRadius: 6,
              padding: '6px 8px',
              color: '#b91c1c',
              fontSize: 10.5,
              marginBottom: 8,
              display: 'flex',
              alignItems: 'flex-start',
              gap: 6,
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <div style={{ flex: 1 }}>{data.scriptError}</div>
          </div>
        )}

        {isScriptOutputStale && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', borderRadius: 6, padding: '6px 8px', color: '#92400e', fontSize: 10.5, marginBottom: 8, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
            <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1 }} />
            <div>Kết quả hiện tại được sinh bằng cấu hình cũ. Hãy sinh lại trước khi đồng bộ sang Flow.</div>
          </div>
        )}

        {/* 1. Status Bar: Product Images & Gemini Connection */}
        <div
          style={{
            marginBottom: 8,
            padding: '5px 8px',
            background: '#f8fafc',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          {/* Left: Images */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {validImages.length > 0 ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                {validImages.map((imgUrl, i) => (
                  <img
                    key={i}
                    src={imgUrl}
                    alt={`SP ${i + 1}`}
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 4,
                      objectFit: 'cover',
                      border: '1px solid #cbd5e1',
                    }}
                  />
                ))}
                <span style={{ fontSize: 9.5, color: '#64748b', fontWeight: 500, marginLeft: 2 }}>
                  {validImages.length} ảnh
                </span>
              </div>
            ) : (
              <span style={{ fontSize: 9.5, color: '#94a3b8' }}>Chưa nạp ảnh sản phẩm</span>
            )}
          </div>

          {/* Right: Gemini status */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: hasProductData ? '#10b981' : '#f59e0b',
                display: 'inline-block',
              }}
            />
            <span
              style={{
                fontSize: 9.5,
                fontWeight: 600,
                color: hasProductData ? '#059669' : '#d97706',
              }}
            >
              {hasProductData ? 'Gemini: Đã phân tích' : 'Chờ Gemini'}
            </span>
          </div>
        </div>

        {/* 2. Configuration Grid: Count and Story Mode */}
        <div
          style={{
            marginBottom: 8,
            padding: '8px 10px',
            background: '#ffffff',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, fontWeight: 600, color: '#64748b' }}>
              Số kịch bản
              <input
                type="number"
                min={1}
                max={200}
                value={requestedCount}
                onChange={(event) => handleCountChange(Number(event.target.value) || 1)}
                style={{
                  height: 28,
                  padding: '2px 6px',
                  fontSize: 11,
                  fontWeight: 500,
                  borderRadius: 5,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#1e293b',
                  boxSizing: 'border-box',
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, fontWeight: 600, color: '#64748b' }}>
              Chế độ kịch bản
              <select
                value={storyMode}
                onChange={(event) => data.onChangeScriptConfig?.({ storyMode: event.target.value as 'sequential' | 'independent' })}
                style={{
                  height: 28,
                  padding: '2px 6px',
                  fontSize: 11,
                  fontWeight: 500,
                  borderRadius: 5,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#1e293b',
                  boxSizing: 'border-box',
                }}
              >
                <option value="sequential">Phim liên hoàn</option>
                <option value="independent">Clip độc lập</option>
              </select>
            </label>
          </div>
        </div>

        {/* 3. Preset Selector */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 600, color: '#64748b' }}>
              Thể loại kịch bản:
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              {currentPreset && (
                <>
                  {currentPreset.is_default ? (
                    <span
                      style={{
                        background: '#fef3c7',
                        border: '1px solid #fde68a',
                        color: '#b45309',
                        fontSize: 9,
                        fontWeight: 600,
                        padding: '2px 5px',
                        borderRadius: 4,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                      }}
                      title="Đây là thể loại kịch bản mặc định"
                    >
                      <Star size={9} fill="#b45309" />
                      Mặc định
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={handleSetDefaultCurrentPreset}
                      disabled={isSavingPreset}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        color: '#475569',
                        fontSize: 9.5,
                        fontWeight: 600,
                        padding: '2px 6px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 3,
                      }}
                      title="Đặt thể loại này làm mặc định cho workflow"
                    >
                      <Star size={10} />
                      Đặt mặc định
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleUpdateCurrentPreset}
                    disabled={isSavingPreset || !isPromptDirty}
                    style={{
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      color: '#0f172a',
                      fontSize: 9.5,
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 4,
                      cursor: isPromptDirty ? 'pointer' : 'not-allowed',
                      opacity: isPromptDirty ? 1 : 0.55,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                    title={currentPreset.is_system
                      ? 'Mẫu hệ thống được bảo vệ; nội dung sẽ được lưu thành bản sao'
                      : 'Cập nhật mẫu tùy chỉnh hiện tại'}
                  >
                    <Save size={10} />
                    {currentPreset.is_system ? 'Lưu bản sao' : 'Cập nhật mẫu'}
                  </button>

                  {!currentPreset.is_system && (
                    <button
                      type="button"
                      onClick={handleDeleteCurrentPreset}
                      style={{
                        background: '#fff1f2',
                        border: '1px solid #fecdd3',
                        color: '#e11d48',
                        fontSize: 9.5,
                        fontWeight: 600,
                        padding: '2px 5px',
                        borderRadius: 4,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                      }}
                      title="Xóa mẫu tùy chỉnh này"
                    >
                      <Trash2 size={10} />
                    </button>
                  )}
                </>
              )}

              <button
                type="button"
                onClick={() => setIsCreatingPreset(!isCreatingPreset)}
                style={{
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  color: '#475569',
                  fontSize: 9.5,
                  fontWeight: 600,
                  padding: '2px 6px',
                  borderRadius: 4,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 3,
                }}
                title="Lưu nội dung prompt hiện tại thành thể loại kịch bản mới"
              >
                <Plus size={10} />
                Lưu mẫu mới
              </button>
            </div>
          </div>

          <select
            value={selectedPresetId}
            onChange={(e) => handleSelectPreset(e.target.value)}
            style={{
              width: '100%',
              height: 29,
              padding: '3px 8px',
              fontSize: 11,
              fontWeight: 600,
              borderRadius: 5,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#1e293b',
              boxSizing: 'border-box',
              cursor: 'pointer',
            }}
          >
            {availablePresets.length > 0 ? (
              <>
                <optgroup label="Mẫu chuẩn hệ thống">
                  {availablePresets
                    .filter((p) => p.is_system)
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}{p.is_default ? ' ★ (Mặc định)' : ''}
                      </option>
                    ))}
                </optgroup>
                {availablePresets.some((p) => !p.is_system) && (
                  <optgroup label="Mẫu tùy chỉnh">
                    {availablePresets
                      .filter((p) => !p.is_system)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          ★ {p.name}{p.is_default ? ' (Mặc định)' : ''}
                        </option>
                      ))}
                  </optgroup>
                )}
              </>
            ) : (
              CONTENT_MODE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))
            )}
          </select>

          {/* Inline Form for Creating New Preset */}
          {isCreatingPreset && (
            <form
              onSubmit={handleConfirmCreatePreset}
              style={{
                marginTop: 6,
                padding: '6px 8px',
                background: '#ffffff',
                border: '1px solid #cbd5e1',
                borderRadius: 6,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.05)',
              }}
            >
              <input
                type="text"
                placeholder="Tên thể loại mới (vd: Kịch bản hài, Gen Z)..."
                value={newPresetTitle}
                onChange={(e) => setNewPresetTitle(e.target.value)}
                autoFocus
                style={{
                  flex: 1,
                  padding: '4px 7px',
                  fontSize: 10.5,
                  borderRadius: 4,
                  border: '1px solid #cbd5e1',
                  outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={isSavingPreset || !newPresetTitle.trim()}
                style={{
                  padding: '4px 9px',
                  fontSize: 10,
                  fontWeight: 600,
                  borderRadius: 4,
                  border: 'none',
                  background: '#1e293b',
                  color: '#ffffff',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                {isSavingPreset ? 'Đang lưu...' : 'Lưu'}
              </button>
              <button
                type="button"
                onClick={() => setIsCreatingPreset(false)}
                style={{
                  padding: '4px 6px',
                  fontSize: 10,
                  borderRadius: 4,
                  border: '1px solid #cbd5e1',
                  background: '#ffffff',
                  color: '#64748b',
                  cursor: 'pointer',
                }}
              >
                <X size={11} />
              </button>
            </form>
          )}

          {presetNotification && (
            <div style={{ marginTop: 4, fontSize: 9.5, color: '#059669', fontWeight: 600 }}>
              {presetNotification}
            </div>
          )}
        </div>

        {/* 4. Prompt Editor */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
            <label style={{ fontSize: 10.5, fontWeight: 600, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
              Chỉ thị kịch bản:
              {currentPreset && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 500,
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: isPromptDirty ? '#fff7ed' : (currentPreset.is_default ? '#fef3c7' : '#f1f5f9'),
                    color: isPromptDirty ? '#c2410c' : (currentPreset.is_default ? '#b45309' : '#475569'),
                    border: isPromptDirty ? '1px solid #fdba74' : (currentPreset.is_default ? '1px solid #fde68a' : '1px solid #e2e8f0'),
                  }}
                >
                  {isPromptDirty
                    ? 'Bản nháp chưa lưu'
                    : (currentPreset.is_default ? '★ Thể loại mặc định' : (currentPreset.is_system ? 'Mẫu chuẩn' : 'Tùy chỉnh'))}
                </span>
              )}
            </label>
            <button
              type="button"
              onClick={() => data.onResetPrompt?.()}
              disabled={!isPromptDirty}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                fontSize: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                cursor: isPromptDirty ? 'pointer' : 'not-allowed',
                fontWeight: 500,
                opacity: isPromptDirty ? 1 : 0.45,
              }}
              title="Bỏ thay đổi và quay lại nội dung của mẫu đang chọn"
            >
              <RotateCcw size={10} />
              Hoàn tác
            </button>
          </div>

          <textarea
            className="wf-input-textarea"
            rows={5}
            value={data.prompt}
            onChange={(e) => data.onChangePrompt?.(e.target.value)}
            placeholder="Nhập chỉ thị kịch bản... (Hệ thống tự động đồng bộ dữ liệu sản phẩm & toàn bộ phân tích từ Gemini)"
            style={{
              minHeight: 90,
              fontSize: 10.5,
              fontFamily: 'monospace',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: '6px 8px',
              width: '100%',
              boxSizing: 'border-box',
              resize: 'vertical',
            }}
          />
          <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 9, lineHeight: 1.35, color: '#64748b' }}>
              Dữ liệu sản phẩm, Gemini và cấu hình clip được tự động đính kèm.
            </span>
            <button
              type="button"
              className="nodrag"
              onClick={handlePreviewPrompt}
              disabled={isPreviewingPrompt || !data.onPreviewPrompt}
              style={{
                flexShrink: 0,
                border: '1px solid #cbd5e1',
                borderRadius: 4,
                background: '#ffffff',
                color: '#475569',
                padding: '3px 6px',
                fontSize: 9.5,
                fontWeight: 600,
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                cursor: isPreviewingPrompt ? 'wait' : 'pointer',
              }}
              title="Dựng chính xác prompt sẽ gửi AI, không tốn lượt GPT"
            >
              <Eye size={10} />
              {isPreviewingPrompt ? 'Đang dựng...' : 'Xem prompt hoàn chỉnh'}
            </button>
          </div>
          {promptPreviewError && (
            <div style={{ marginTop: 4, fontSize: 9.5, color: '#b91c1c' }}>{promptPreviewError}</div>
          )}
        </div>

        {promptPreview && createPortal((
          <div
            className="nodrag"
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => event.stopPropagation()}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10000,
              background: 'rgba(15, 23, 42, 0.55)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 24,
            }}
          >
            <div style={{ width: 'min(900px, 92vw)', maxHeight: '86vh', background: '#ffffff', borderRadius: 10, boxShadow: '0 20px 60px rgba(15,23,42,.3)', display: 'flex', flexDirection: 'column' }}>
              <div style={{ padding: '12px 14px', borderBottom: '1px solid #e2e8f0', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Prompt hoàn chỉnh gửi AI</div>
                  <div style={{ marginTop: 2, fontSize: 10, color: '#64748b' }}>Preview batch đầu tiên · không gọi model, không tốn credit</div>
                </div>
                <button type="button" onClick={() => setPromptPreview(null)} style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b', padding: 4 }} title="Đóng">
                  <X size={16} />
                </button>
              </div>
              <div style={{ padding: 14, overflow: 'auto', display: 'grid', gap: 12 }}>
                <section>
                  <div style={{ marginBottom: 5, fontSize: 10.5, fontWeight: 700, color: '#334155' }}>SYSTEM CONTRACT</div>
                  <pre style={{ margin: 0, padding: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, color: '#334155', fontSize: 10.5, lineHeight: 1.5 }}>{promptPreview.systemPrompt}</pre>
                </section>
                <section>
                  <div style={{ marginBottom: 5, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 10.5, fontWeight: 700, color: '#334155' }}>USER PROMPT + SOURCE CONTEXT</span>
                    <button type="button" onClick={() => navigator.clipboard.writeText(promptPreview.userPrompt)} style={{ border: '1px solid #cbd5e1', background: '#ffffff', borderRadius: 4, padding: '3px 7px', cursor: 'pointer', fontSize: 9.5, color: '#475569', display: 'flex', alignItems: 'center', gap: 3 }}>
                      <Copy size={10} /> Sao chép
                    </button>
                  </div>
                  <pre style={{ margin: 0, padding: 10, whiteSpace: 'pre-wrap', wordBreak: 'break-word', background: '#0f172a', borderRadius: 6, color: '#e2e8f0', fontSize: 10.5, lineHeight: 1.5 }}>{promptPreview.userPrompt}</pre>
                </section>
              </div>
            </div>
          </div>
        ), document.body)}

        {/* 5. Footer Bar: Summary & Action */}
        <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 10, color: '#64748b' }}>
            {requestedCount} clip × {clipDurationSeconds}s · ~{voiceoverWords.min}–{voiceoverWords.max} từ/clip
          </div>

          <button
            type="button"
            className="wf-btn wf-btn-primary"
            onClick={() => data.onGenerate?.()}
            disabled={isGenerating}
            style={{
              padding: '6px 14px',
              fontWeight: 600,
              fontSize: 11,
            }}
          >
            <Sparkles size={13} className={isGenerating ? 'animate-spin' : ''} />
            {isGenerating ? 'Đang viết kịch bản...' : `Sinh ${requestedCount} Kịch Bản`}
          </button>
        </div>

        {/* 5. Output Scripts: Dynamic Tabs & Cards */}
        {salesScripts.length > 0 ? (
          <div style={{ marginTop: 10, borderTop: '1px solid #e2e8f0', paddingTop: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: '#475569' }}>
                Đã tạo ({salesScripts.length}/{requestedCount} kịch bản):
              </span>
              {scriptCollection?.repaired && (
                <span style={{ fontSize: 9, color: '#0369a1', background: '#e0f2fe', border: '1px solid #bae6fd', borderRadius: 4, padding: '1px 5px' }}>
                  Đã tự sửa định dạng
                </span>
              )}
            </div>

            {/* Dynamic Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, overflowX: 'auto', paddingBottom: 2 }}>
              {salesScripts.map((s, idx) => {
                const phaseStyle = getPhaseStyle(s.phase)
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => setActiveTab(idx)}
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '4px 8px',
                      borderRadius: 5,
                      border: safeTab === idx ? '1px solid #4f46e5' : '1px solid #e2e8f0',
                      background: safeTab === idx ? '#4f46e5' : '#ffffff',
                      color: safeTab === idx ? '#ffffff' : '#64748b',
                      cursor: 'pointer',
                      whiteSpace: 'nowrap',
                      transition: 'all 0.15s ease',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <span>#{idx + 1}</span>
                    {s.phase && (
                      <span
                        style={{
                          fontSize: 8.5,
                          fontWeight: 800,
                          padding: '1px 4px',
                          borderRadius: 3,
                          background: phaseStyle.bg,
                          color: phaseStyle.color,
                          textTransform: 'uppercase',
                        }}
                      >
                        {s.phase}
                      </span>
                    )}
                    <span>{s.angle || s.title || `Cảnh ${idx + 1}`}</span>
                  </button>
                )
              })}
            </div>

            {/* Active Script Card */}
            {currentScript && (
              <div
                style={{
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  padding: '9px',
                  fontSize: 11,
                  color: '#334155',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, borderBottom: '1px solid #e2e8f0', paddingBottom: 4 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    {currentScript.phase && (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 800,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: getPhaseStyle(currentScript.phase).bg,
                          color: getPhaseStyle(currentScript.phase).color,
                          border: `1px solid ${getPhaseStyle(currentScript.phase).border}`,
                          textTransform: 'uppercase',
                        }}
                      >
                        {currentScript.phase}
                      </span>
                    )}
                    <span style={{ fontWeight: 700, color: '#0f172a' }}>
                      {currentScript.angle || `Kịch bản #${safeTab + 1}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 9, background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
                      ~{currentScript.wordCount || currentScript.word_count || 0} từ
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(currentScript.content, safeTab)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: copiedIndex === safeTab ? '#16a34a' : '#64748b',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                      title="Sao chép kịch bản này"
                    >
                      {copiedIndex === safeTab ? <Check size={12} /> : <Copy size={12} />}
                      {copiedIndex === safeTab ? 'Đã chép' : 'Chép'}
                    </button>
                  </div>
                </div>

                {/* Visual Direction for Veo (English Cinematic Format) */}
                {(currentScript.visualDirection || currentScript.visual_direction) && (
                  <div style={{ marginBottom: 6, padding: '6px 8px', background: '#ffffff', borderRadius: 5, border: '1px solid #e2e8f0' }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                      <Camera size={11} />
                      <span>Chỉ dẫn hình ảnh • English Veo Prompt (Cinematic):</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: '#1e293b', lineHeight: 1.45 }}>
                      {currentScript.visualDirection || currentScript.visual_direction}
                    </div>
                  </div>
                )}

                {/* Voiceover / Script Content (Vietnamese 100%) */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <FileText size={11} />
                      <span>Lời thoại • Voiceover (Tiếng Việt 100%):</span>
                    </div>
                    {data.voiceId && (
                      <span style={{ fontSize: 9, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '1px 5px', borderRadius: 3, fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 3 }}>
                        <Mic size={10} color="#64748b" /> {data.voiceId}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #e2e8f0',
                      borderRadius: 4,
                      padding: '7px 8px',
                      fontSize: 11,
                      lineHeight: '1.5',
                      color: '#1e293b',
                      whiteSpace: 'pre-line',
                      maxHeight: 140,
                      overflowY: 'auto',
                    }}
                  >
                    {currentScript.voiceover || currentScript.content}
                  </div>
                </div>

                {/* On-screen text & CTA if parsed */}
                {(currentScript.onScreenText || currentScript.on_screen_text) && (
                  <div style={{ marginBottom: 3, fontSize: 10, color: '#475569' }}>
                    <strong style={{ color: '#334155' }}>Chữ màn hình:</strong> {currentScript.onScreenText || currentScript.on_screen_text}
                  </div>
                )}
                {currentScript.cta && (
                  <div style={{ marginBottom: 6, fontSize: 10, color: '#475569' }}>
                    <strong style={{ color: '#334155' }}>CTA:</strong> {currentScript.cta}
                  </div>
                )}

                {/* Đồng bộ tất cả kịch bản vào các clip Flow tương ứng */}
                <button
                  type="button"
                  onClick={() => {
                    if (data.onPushAllToVeo) {
                      data.onPushAllToVeo()
                    } else {
                      data.onPushToVeo?.(safeTab)
                    }
                  }}
                  disabled={isScriptOutputStale}
                  style={{
                    marginTop: 6,
                    width: '100%',
                    padding: '7px 12px',
                    borderRadius: 6,
                    border: '1px solid #4338ca',
                    background: '#4f46e5',
                    color: '#ffffff',
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    cursor: isScriptOutputStale ? 'not-allowed' : 'pointer',
                    opacity: isScriptOutputStale ? 0.55 : 1,
                    transition: 'all 0.15s ease',
                  }}
                  title={`Đẩy ${salesScripts.length} kịch bản vào ${salesScripts.length} clip Google Flow độc lập`}
                >
                  <Sparkles size={13} />
                  Đồng bộ {salesScripts.length} Kịch Bản → {salesScripts.length} Clip Flow
                </button>

                {/* Nạp thủ công kịch bản đang chọn vào clip đang mở */}
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => data.onPushSingleToVeo?.(safeTab)}
                    disabled={isScriptOutputStale}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      borderRadius: 5,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#475569',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: isScriptOutputStale ? 'not-allowed' : 'pointer',
                      opacity: isScriptOutputStale ? 0.55 : 1,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      whiteSpace: 'nowrap',
                    }}
                    title="Đẩy toàn bộ kịch bản đang chọn vào clip đang mở trong Google Flow"
                  >
                    Nạp riêng vào Clip đang mở
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div
            style={{
              marginTop: 10,
              padding: '10px 8px',
              textAlign: 'center',
              background: '#f8fafc',
              borderRadius: 6,
              border: '1px dashed #cbd5e1',
              color: '#94a3b8',
              fontSize: 10.5,
            }}
          >
            Chưa có kịch bản. Nhấn <strong>Sinh {requestedCount} Kịch Bản</strong> để tạo.
          </div>
        )}
      </div>

      {/* Output Handle to Veo / Flow Studio */}
      <Handle
        type="source"
        position={Position.Right}
        id="to-flow"
        style={{ top: '50%' }}
        className="wf-handle wf-handle-source"
        title="Dòng kịch bản sang Veo / Flow Studio"
      />
    </div>
  )
}
