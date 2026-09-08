import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { Bot, Sparkles, Wand2, Layers, Trash2, CheckCircle2 } from 'lucide-react'
import type { GptScriptNodeData } from '../types'

interface GptScriptNodeProps {
  data: GptScriptNodeData
  selected?: boolean
}

export function GptScriptNode({ data, selected }: GptScriptNodeProps) {
  const isGenerating = data.isGenerating ?? false
  const scenes = data.scenes || []

  const styleChips = [
    'TikTok Viral 15s',
    'Review KOL chân thực',
    'Điện ảnh Premium',
    'Flash Sale chốt đơn',
  ]

  const handleChipClick = (chip: string) => {
    data.onChangePrompt?.(`Tạo kịch bản video quảng cáo sản phẩm phong cách ${chip}, 3 phân cảnh mượt mà, ánh sáng tự nhiên.`)
  }

  return (
    <div className={`wf-node-card ${selected ? 'selected' : ''}`} style={{ width: 370 }}>
      {/* Top Handle from CharacterSceneNode */}
      <Handle
        type="target"
        position={Position.Top}
        id="from-charscene"
        style={{ left: '50%' }}
        className="wf-handle wf-handle-target"
        title="Nhận ảnh nhân vật từ trên xuống"
      />

      {/* Left Handle from GeminiAnalysisNode */}
      <Handle
        type="target"
        position={Position.Left}
        id="from-gemini"
        style={{ top: '50%' }}
        className="wf-handle wf-handle-target"
        title="Nhận phân tích từ Gemini"
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
              {data.title || 'ChatGPT • Kịch Bản Phân Cảnh'}
            </div>
            <div style={{ fontSize: 10, color: '#9333ea', fontWeight: 600 }}>
              {data.model || 'cx/gpt-5.5'} • 9Router Gateway
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span
            className="wf-node-badge"
            style={{
              background: scenes.length > 0 ? '#f5f3ff' : '#f8fafc',
              color: scenes.length > 0 ? '#7c3aed' : '#64748b',
              border: scenes.length > 0 ? '1px solid #ddd6fe' : '1px solid #e2e8f0',
            }}
          >
            {scenes.length} Phân cảnh
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
        <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
          Yêu cầu & Định hướng kịch bản:
        </label>
        <textarea
          className="wf-input-textarea"
          rows={3}
          value={data.prompt}
          onChange={(e) => data.onChangePrompt?.(e.target.value)}
          placeholder="Nhập yêu cầu kịch bản (ví dụ: Video 15s cận cảnh sợi dệt vải, người mẫu sải bước tự tin và chốt ưu đãi giảm 30%)..."
          style={{ minHeight: 60 }}
        />

        {/* Style chips */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, margin: '6px 0 10px 0' }}>
          {styleChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => handleChipClick(chip)}
              style={{
                fontSize: 10,
                padding: '2px 7px',
                borderRadius: 4,
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                color: '#475569',
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.borderColor = '#c084fc'
                e.currentTarget.style.color = '#7c3aed'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.borderColor = '#e2e8f0'
                e.currentTarget.style.color = '#475569'
              }}
            >
              + {chip}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 11, color: '#64748b' }}>
            Thời lượng mục tiêu: <strong>{data.targetDuration || 15}s</strong>
          </div>

          <button
            type="button"
            className="wf-btn wf-btn-primary"
            onClick={() => data.onGenerate?.()}
            disabled={isGenerating}
            style={{ padding: '6px 14px' }}
          >
            <Sparkles size={13} className={isGenerating ? 'animate-spin' : ''} />
            {isGenerating ? 'Đang soạn kịch bản...' : 'Sinh Kịch Bản Phân Cảnh'}
          </button>
        </div>

        {/* Breakdown Scenes list preview */}
        {scenes.length > 0 ? (
          <div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
            <div
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: '#64748b',
                marginBottom: 6,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span>Phân Cảnh Xuất Ra ({scenes.length}):</span>
              <span style={{ fontSize: 10, color: '#7c3aed', fontWeight: 600, textTransform: 'none' }}>
                kịch bản 1, 2, 3 ➔ Flow
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {scenes.map((scene, idx) => (
                <div
                  key={scene.sceneNumber || idx}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '6px 10px',
                    background: '#f8fafc',
                    borderRadius: 6,
                    border: '1px solid #e2e8f0',
                    fontSize: 11,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                    <span
                      style={{
                        background: '#f5f3ff',
                        color: '#7c3aed',
                        fontWeight: 700,
                        padding: '1px 6px',
                        borderRadius: 4,
                        fontSize: 10,
                        flexShrink: 0,
                        border: '1px solid #ddd6fe',
                      }}
                    >
                      #{idx + 1}
                    </span>
                    <span
                      style={{
                        color: '#1e293b',
                        fontWeight: 500,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                    >
                      {scene.title}
                    </span>
                  </div>
                  <span style={{ color: '#64748b', fontSize: 10, flexShrink: 0 }}>
                    {scene.durationSec || 4}s • {scene.aspectRatio || '9:16'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div
            style={{
              marginTop: 10,
              padding: '12px 8px',
              textAlign: 'center',
              background: '#f8fafc',
              borderRadius: 6,
              border: '1px dashed #cbd5e1',
              color: '#94a3b8',
              fontSize: 11,
            }}
          >
            Chưa tạo phân cảnh. Nhấp 'Sinh Kịch Bản' để tạo 3 cảnh.
          </div>
        )}
      </div>

      {/* Output Handles for Scenes branching to Flow */}
      <Handle
        type="source"
        position={Position.Right}
        id="to-flow"
        style={{ top: '40%' }}
        className="wf-handle wf-handle-source"
        title="Dòng kịch bản toàn phần sang Flow"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="scene-1"
        style={{ top: '65%' }}
        className="wf-handle wf-handle-source"
        title="Cảnh #1 sang Flow"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="scene-2"
        style={{ top: '75%' }}
        className="wf-handle wf-handle-source"
        title="Cảnh #2 sang Flow"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="scene-3"
        style={{ top: '85%' }}
        className="wf-handle wf-handle-source"
        title="Cảnh #3 sang Flow"
      />
    </div>
  )
}
