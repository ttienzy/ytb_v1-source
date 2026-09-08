import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { Sparkles, Bot, Zap, Plus, Layers, ArrowRight, Trash2 } from 'lucide-react'
import type { GptScriptNodeData } from '../types'

interface GptScriptNodeProps {
  data: GptScriptNodeData
  selected?: boolean
}

export function GptScriptNode({ data, selected }: GptScriptNodeProps) {
  const isGenerating = data.isGenerating ?? false

  return (
    <div className={`wf-node-card ${selected ? 'selected' : ''}`} style={{ width: 380 }}>
      {/* Target input handle from GeminiAnalysisNode or AssetInputNode */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="wf-handle wf-handle-target"
      />

      {/* Header */}
      <div className="wf-node-header">
        <div className="wf-node-title-group">
          <div className="wf-node-icon wf-icon-purple">
            <Bot size={16} />
          </div>
          <div>
            <div className="wf-node-title">{data.title || 'AI Phân Tích & Kịch Bản'}</div>
            <div style={{ fontSize: 10, color: '#a855f7', fontWeight: 600 }}>
              {data.model || 'cx/gpt-5.5'} • 9Router Gateway
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="wf-node-badge wf-badge-gpt">
            {data.scenes?.length || 3} Phân cảnh
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
        <label style={{ fontSize: 11, fontWeight: 600, color: '#cbd5e1', display: 'block', marginBottom: 4 }}>
          Mô tả sản phẩm & Yêu cầu kịch bản:
        </label>
        <textarea
          className="wf-input-textarea"
          rows={3}
          value={data.prompt}
          onChange={(e) => data.onChangePrompt?.(e.target.value)}
          placeholder="Ví dụ: Tạo kịch bản video quảng cáo sản phẩm áo polo 3 cảnh quay chuyển động mượt, ánh sáng tự nhiên, phong cách TikTok Viral..."
        />

        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
          <div style={{ display: 'flex', gap: 6, fontSize: 11, color: '#94a3b8' }}>
            <span>Thời lượng: <strong>{data.targetDuration || 15}s</strong></span>
            <span>•</span>
            <span>Tỷ lệ: <strong>9:16</strong></span>
          </div>

          <button
            type="button"
            className="wf-btn wf-btn-primary"
            onClick={() => data.onGenerate?.()}
            disabled={isGenerating}
          >
            <Sparkles size={13} />
            {isGenerating ? 'Đang tạo...' : 'Sinh Kịch Bản'}
          </button>
        </div>

        {/* Breakdown Scenes list preview */}
        <div style={{ marginTop: 12, borderTop: '1px solid #f1f5f9', paddingTop: 10 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#64748b', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Phân Cảnh Xuất Ra ({data.scenes?.length || 0}):
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {data.scenes?.map((scene, idx) => (
              <div
                key={scene.sceneNumber}
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
                  <span style={{ color: '#1e293b', fontWeight: 500, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {scene.title}
                  </span>
                </div>
                <span style={{ color: '#64748b', fontSize: 10, flexShrink: 0 }}>
                  {scene.durationSec}s • {scene.aspectRatio}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Output Handles for Scenes */}
      {/* 1. Global output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="all-scenes"
        style={{ top: '50%' }}
        className="wf-handle wf-handle-source"
      />
      {/* Individual Scene Output Handles */}
      <Handle
        type="source"
        position={Position.Right}
        id="scene-1"
        style={{ top: '72%' }}
        className="wf-handle wf-handle-source"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="scene-2"
        style={{ top: '82%' }}
        className="wf-handle wf-handle-source"
      />
      <Handle
        type="source"
        position={Position.Right}
        id="scene-3"
        style={{ top: '92%' }}
        className="wf-handle wf-handle-source"
      />
    </div>
  )
}
