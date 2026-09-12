import React, { useState } from 'react'
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

const PLATFORM_OPTIONS = [
  { value: 'auto', label: 'Tự động' },
  { value: 'tiktok', label: 'TikTok' },
  { value: 'reels', label: 'Reels' },
  { value: 'shorts', label: 'Shorts' },
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
  const contentMode = data.contentMode ?? 'sales'
  const platform = data.platform ?? 'auto'
  const storyMode = data.storyMode ?? 'sequential'
  const clipDurationSeconds = normalizeClipDuration(data.clipDurationSeconds)
  const voiceoverWords = estimateVoiceoverWordRange(clipDurationSeconds)

  const availablePresets = data.availablePresets || []
  const selectedPresetId =
    data.selectedPresetId ||
    availablePresets.find((p) => p.content_mode === contentMode)?.id ||
    availablePresets[0]?.id ||
    'sales'
  const currentPreset = availablePresets.find((p) => p.id === selectedPresetId)

  const [isCreatingPreset, setIsCreatingPreset] = useState(false)
  const [newPresetTitle, setNewPresetTitle] = useState('')
  const [isSavingPreset, setIsSavingPreset] = useState(false)
  const [presetNotification, setPresetNotification] = useState<string | null>(null)

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
      await data.onSaveAsNewPreset?.(newPresetTitle.trim(), contentMode, data.prompt || '')
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
      setPresetNotification('✓ Đã cập nhật mẫu!')
      setTimeout(() => setPresetNotification(null), 2500)
    } catch (err: any) {
      alert(err?.message || 'Lỗi khi cập nhật preset')
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
    data.onChangeScriptConfig?.({ count: Math.min(10, Math.max(1, Math.round(count))) })
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
            <span>⭐ NODE CHÍNH (ĐIỂM KHỞI ĐẦU)</span>
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
      <div className="wf-node-header" style={{ background: '#f5f3ff', borderBottom: '1px solid #ede9fe' }}>
        <div className="wf-node-title-group">
          <div
            className="wf-node-icon"
            style={{
              background: 'linear-gradient(135deg, #a855f7, #9333ea)',
              color: '#ffffff',
              boxShadow: '0 2px 6px rgba(168, 85, 247, 0.3)',
            }}
          >
            <Bot size={15} />
          </div>
          <div>
            <div className="wf-node-title" style={{ color: '#581c87' }}>
              {data.title || 'ChatGPT • Kịch Bản'}
            </div>
            <div style={{ fontSize: 10, color: '#9333ea', fontWeight: 600 }}>
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
            <span style={{ fontSize: 13 }}>{isStartNode ? '⭐' : '☆'}</span>
          </button>

          <span
            className="wf-node-badge"
            style={{
              background: salesScripts.length > 0 ? '#f5f3ff' : '#f8fafc',
              color: salesScripts.length > 0 ? '#7c3aed' : '#64748b',
              border: salesScripts.length > 0 ? '1px solid #ddd6fe' : '1px solid #e2e8f0',
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

        {/* 2. Configuration Grid: Count, Platform, Story Mode */}
        <div
          style={{
            marginBottom: 8,
            padding: '8px 10px',
            background: '#ffffff',
            borderRadius: 6,
            border: '1px solid #e2e8f0',
          }}
        >
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, fontWeight: 600, color: '#64748b' }}>
              Số kịch bản
              <select
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
              >
                {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((num) => (
                  <option key={num} value={num}>
                    {num} clip
                  </option>
                ))}
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 3, fontSize: 10, fontWeight: 600, color: '#64748b' }}>
              Nền tảng
              <select
                value={platform}
                onChange={(event) => data.onChangeScriptConfig?.({ platform: event.target.value as typeof platform })}
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
                {PLATFORM_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
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
              {currentPreset && !currentPreset.is_system && (
                <>
                  <button
                    type="button"
                    onClick={handleUpdateCurrentPreset}
                    disabled={isSavingPreset}
                    style={{
                      background: '#f1f5f9',
                      border: '1px solid #cbd5e1',
                      color: '#0f172a',
                      fontSize: 9.5,
                      fontWeight: 600,
                      padding: '2px 6px',
                      borderRadius: 4,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                    }}
                    title="Lưu các chỉnh sửa prompt hiện tại vào mẫu này"
                  >
                    <Save size={10} />
                    Cập nhật
                  </button>
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
                        {p.name}
                      </option>
                    ))}
                </optgroup>
                {availablePresets.some((p) => !p.is_system) && (
                  <optgroup label="Mẫu tùy chỉnh">
                    {availablePresets
                      .filter((p) => !p.is_system)
                      .map((p) => (
                        <option key={p.id} value={p.id}>
                          ★ {p.name}
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
                    background: '#f1f5f9',
                    color: '#475569',
                    border: '1px solid #e2e8f0',
                  }}
                >
                  {currentPreset.is_system ? 'Mẫu chuẩn' : 'Tùy chỉnh'}
                </span>
              )}
            </label>
            <button
              type="button"
              onClick={() => data.onResetPrompt?.()}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                fontSize: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 3,
                cursor: 'pointer',
                fontWeight: 500,
              }}
              title="Khôi phục prompt kịch bản gốc từ Backend"
            >
              <RotateCcw size={10} />
              Mặc định
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
        </div>

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
              background: '#7c3aed',
              borderColor: '#6d28d9',
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
          <div style={{ marginTop: 10, borderTop: '1px solid #ede9fe', paddingTop: 8 }}>
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
                      border: safeTab === idx ? '1px solid #7c3aed' : '1px solid #e2e8f0',
                      background: safeTab === idx ? '#f5f3ff' : '#f8fafc',
                      color: safeTab === idx ? '#7c3aed' : '#64748b',
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
                  background: '#faf5ff',
                  border: '1px solid #e9d5ff',
                  borderRadius: 6,
                  padding: '9px',
                  fontSize: 11,
                  color: '#334155',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, borderBottom: '1px dashed #d8b4fe', paddingBottom: 4 }}>
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
                    <span style={{ fontWeight: 700, color: '#6b21a8' }}>
                      {currentScript.angle || `Kịch bản #${safeTab + 1}`}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 9, background: '#f3e8ff', color: '#7e22ce', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
                      ~{currentScript.wordCount || currentScript.word_count || 0} từ
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(currentScript.content, safeTab)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: copiedIndex === safeTab ? '#16a34a' : '#7c3aed',
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
                  <div style={{ marginBottom: 6, padding: '6px 8px', background: '#eff6ff', borderRadius: 5, border: '1px solid #bfdbfe' }}>
                    <div style={{ fontSize: 9.5, fontWeight: 700, color: '#1d4ed8', display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                      <Camera size={11} />
                      <span>Chỉ dẫn hình ảnh • English Veo Prompt (Cinematic):</span>
                    </div>
                    <div style={{ fontSize: 10.5, color: '#1e3a8a', lineHeight: 1.45 }}>
                      {currentScript.visualDirection || currentScript.visual_direction}
                    </div>
                  </div>
                )}

                {/* Voiceover / Script Content (Vietnamese 100%) */}
                <div style={{ marginBottom: 6 }}>
                  <div style={{ fontSize: 9.5, fontWeight: 700, color: '#6b21a8', display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <FileText size={11} />
                      <span>Lời thoại • Voiceover (Tiếng Việt 100%):</span>
                    </div>
                    {data.voiceId && (
                      <span style={{ fontSize: 9, color: '#9333ea', background: '#f5f3ff', border: '1px solid #e9d5ff', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
                        🎙️ {data.voiceId}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      background: '#ffffff',
                      border: '1px solid #f3e8ff',
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
                    <strong style={{ color: '#7e22ce' }}>Chữ màn hình:</strong> {currentScript.onScreenText || currentScript.on_screen_text}
                  </div>
                )}
                {currentScript.cta && (
                  <div style={{ marginBottom: 6, fontSize: 10, color: '#475569' }}>
                    <strong style={{ color: '#7e22ce' }}>CTA:</strong> {currentScript.cta}
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
                    border: 'none',
                    background: 'linear-gradient(135deg, #f43f5e, #e11d48)',
                    color: '#ffffff',
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 6,
                    cursor: isScriptOutputStale ? 'not-allowed' : 'pointer',
                    opacity: isScriptOutputStale ? 0.55 : 1,
                    boxShadow: '0 2px 6px rgba(244, 63, 94, 0.25)',
                    transition: 'all 0.15s ease',
                  }}
                  title={`Đẩy ${salesScripts.length} kịch bản vào ${salesScripts.length} clip Google Flow độc lập`}
                >
                  <Sparkles size={13} />
                  🚀 Đồng bộ {salesScripts.length} Kịch Bản → {salesScripts.length} Clip Flow
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
                    📌 Nạp riêng vào Clip đang mở
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
