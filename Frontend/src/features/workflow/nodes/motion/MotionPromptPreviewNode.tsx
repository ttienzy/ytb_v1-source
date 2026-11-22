import React, { useState } from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { GitMerge, Copy, Check, Edit3, ExternalLink, Lock, AlertTriangle } from 'lucide-react'
import type { PromptSectionItem } from '../../services/motionPromptBuilder'

export interface MotionPromptPreviewNodeData {
  fullPrompt: string
  sections: PromptSectionItem[]
  charCount: number
  /** Đang dùng bản sửa tay. */
  isCustom?: boolean
  /** Ảnh tham chiếu đã đổi sau khi sửa tay (prompt có thể gọi sai Image N). */
  isStale?: boolean
  blockers?: string[]
  warnings?: string[]
  isRunning?: boolean
  onPromptChange?: (val: string) => void
  onRebuild?: () => void
  onKeepCustom?: () => void
  onOpenInspector?: () => void
}

export function MotionPromptPreviewNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as MotionPromptPreviewNodeData
  const [copied, setCopied] = useState(false)
  const [isEditingInline, setIsEditingInline] = useState(false)

  const handleCopy = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!nodeData.fullPrompt) return
    navigator.clipboard.writeText(nodeData.fullPrompt)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const sections = nodeData.sections || []

  return (
    <div
      className={`mf-node ${selected ? 'selected' : ''} ${nodeData.isRunning ? 'running' : ''}`}
      data-type="txt"
      style={{ width: 340, padding: 0 }}
    >
      {/* Input Handle on the Left */}
      <Handle
        type="target"
        position={Position.Left}
        id="in-creative"
        className="mf-rf-handle txt on"
        style={{ left: -7, top: '50%', transform: 'translateY(-50%)' }}
      />

      {/* Output Handle on the Right */}
      <Handle
        type="source"
        position={Position.Right}
        id="out-prompt"
        className="mf-rf-handle txt on"
        style={{ right: -7, top: '50%', transform: 'translateY(-50%)' }}
      />

      {/* Header */}
      <header className="mf-node-h" style={{ borderBottom: '1px solid #E2E8F0' }}>
        <span className="mf-chip" style={{ background: '#FFF7ED', color: '#EA580C' }}>
          <GitMerge size={15} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <h2 style={{ fontSize: '13px', margin: 0, fontWeight: 700 }}>Prompt Cấu Trúc</h2>
          <small style={{ fontSize: '11px', color: '#64748B' }}>
            {nodeData.isCustom ? 'Bản sửa tay — gửi nguyên văn' : 'Thay đổi → Chỉ đạo → Giữ nguyên'}
          </small>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
          <button
            type="button"
            onClick={handleCopy}
            title="Sao chép prompt tổng"
            style={{
              border: 'none',
              background: '#F1F5F9',
              color: copied ? '#10B981' : '#475569',
              padding: '4px 6px',
              borderRadius: '4px',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '3px',
              fontSize: '11px',
            }}
          >
            {copied ? <Check size={12} /> : <Copy size={12} />}
            <span>{copied ? 'Đã chép' : 'Chép'}</span>
          </button>
        </div>
      </header>

      {/* Body Content */}
      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {nodeData.isStale && (
          <div className="mf-node-alert danger nodrag">
            <AlertTriangle size={12} style={{ flex: '0 0 auto', marginTop: 1 }} />
            <span>
              Ảnh đã đổi sau khi bạn sửa tay prompt.{' '}
              <button type="button" onClick={() => nodeData.onRebuild?.()}>Dựng lại</button>
              {' · '}
              <button type="button" onClick={() => nodeData.onKeepCustom?.()}>Giữ bản sửa tay</button>
            </span>
          </div>
        )}
        {(nodeData.blockers || []).map((b) => (
          <div key={b} className="mf-node-alert danger"><AlertTriangle size={12} style={{ flex: '0 0 auto', marginTop: 1 }} /><span>{b}</span></div>
        ))}
        {(nodeData.warnings || []).map((w) => (
          <div key={w} className="mf-node-alert warn"><AlertTriangle size={12} style={{ flex: '0 0 auto', marginTop: 1 }} /><span>{w}</span></div>
        ))}

        {/* Toggle between Structured Badges and Inline Textarea */}
        {!isEditingInline && !nodeData.isCustom ? (
          <div
            style={{
              maxHeight: '140px',
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: '6px',
              padding: '6px',
              background: '#F8FAFC',
              border: '1px solid #E2E8F0',
              borderRadius: '6px',
            }}
          >
            {sections.length > 0 ? (
              sections.map((sec) => (
                <div key={sec.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span
                      style={{
                        fontSize: '9.5px',
                        fontWeight: 700,
                        padding: '1px 5px',
                        borderRadius: '3px',
                        background: '#EEF2FF',
                        color: sec.colorVar || '#4F46E5',
                        border: '1px solid #E0E7FF',
                        textTransform: 'uppercase',
                      }}
                    >
                      {sec.tag}
                    </span>
                    <span style={{ fontSize: '10.5px', color: '#64748B', fontWeight: 500 }}>{sec.label}</span>
                    {sec.auto && (
                      <span title="Tự sinh theo ảnh tham chiếu" style={{ marginLeft: 'auto', color: '#94A3B8', display: 'flex' }}>
                        <Lock size={10} />
                      </span>
                    )}
                  </div>
                  <p style={{ margin: 0, fontSize: '11.5px', color: '#1E293B', lineHeight: 1.4, paddingLeft: '4px' }}>
                    {sec.content}
                  </p>
                </div>
              ))
            ) : (
              <p style={{ margin: 0, fontSize: '11.5px', color: '#94A3B8', fontStyle: 'italic', textAlign: 'center', padding: '12px 0' }}>
                Chưa có prompt: nạp ảnh nhân vật/bối cảnh, hoặc viết điều muốn thay đổi ở node Chỉ Dẫn Sáng Tạo.
              </p>
            )}
          </div>
        ) : (
          <textarea
            value={nodeData.fullPrompt}
            onChange={(e) => nodeData.onPromptChange?.(e.target.value)}
            className="nodrag"
            rows={6}
            style={{
              width: '100%',
              boxSizing: 'border-box',
              padding: '8px',
              fontSize: '11.5px',
              lineHeight: 1.4,
              borderRadius: '6px',
              border: '1px solid #CBD5E1',
              resize: 'none',
              outline: 'none',
              fontFamily: 'inherit',
            }}
          />
        )}

        {/* Footer Meta Row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: '10.5px', color: '#64748B' }}>
          <span>Độ dài: <b style={{ color: '#1E293B' }}>{nodeData.charCount || 0}</b> ký tự</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            {!nodeData.isCustom && (
              <button
                type="button"
                onClick={() => setIsEditingInline(!isEditingInline)}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#2563EB',
                  cursor: 'pointer',
                  fontSize: '10.5px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '3px',
                  padding: 0,
                }}
              >
                <Edit3 size={11} />
                <span>{isEditingInline ? 'Xem nhãn nguồn' : 'Sửa trực tiếp'}</span>
              </button>
            )}
            {nodeData.isCustom && (
              <button
                type="button"
                onClick={() => {
                  setIsEditingInline(false)
                  nodeData.onRebuild?.()
                }}
                style={{ border: 'none', background: 'transparent', color: '#DC2626', cursor: 'pointer', fontSize: '10.5px', padding: 0 }}
                title="Bỏ bản sửa tay, quay lại prompt tự dựng"
              >
                Về tự động
              </button>
            )}
            <button
              type="button"
              onClick={() => nodeData.onOpenInspector?.()}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#475569',
                cursor: 'pointer',
                fontSize: '10.5px',
                display: 'flex',
                alignItems: 'center',
                gap: '2px',
                padding: 0,
              }}
            >
              <span>Inspector</span>
              <ExternalLink size={10} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
