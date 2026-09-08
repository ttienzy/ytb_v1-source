import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { Sparkles, Eye, Trash2, CheckCircle2, Wand2, Lightbulb, Camera, Tag } from 'lucide-react'
import type { GeminiAnalysisNodeData } from '../types'

interface GeminiAnalysisNodeProps {
  data: GeminiAnalysisNodeData
  selected?: boolean
}

export function GeminiAnalysisNode({ data, selected }: GeminiAnalysisNodeProps) {
  const isAnalyzing = data.isAnalyzing ?? false
  const res = data.analysisResult

  return (
    <div className={`wf-node-card ${selected ? 'selected' : ''}`} style={{ width: 360 }}>
      {/* Target handle receiving from Asset Input Node */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="wf-handle wf-handle-target"
      />

      {/* Header */}
      <div className="wf-node-header">
        <div className="wf-node-title-group">
          <div className="wf-node-icon wf-icon-blue" style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>
            <Sparkles size={15} />
          </div>
          <div>
            <div className="wf-node-title">{data.title || 'Gemini 2.5 • Vision Phân Tích'}</div>
            <div style={{ fontSize: 10, color: '#2563eb', fontWeight: 600 }}>
              {data.model || 'gemini-2.5-flash'} • Google DeepMind
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="wf-node-badge wf-badge-gpt" style={{ background: '#eff6ff', color: '#2563eb', border: '1px solid #bfdbfe' }}>
            Vision AI
          </span>
          <button
            type="button"
            className="wf-node-del-btn"
            onClick={(e) => {
              e.stopPropagation()
              data.onDelete?.()
            }}
            title="Xóa khối phân tích này"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="wf-node-body">
        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, lineHeight: 1.4 }}>
          Tự động soi chi tiết chất liệu sản phẩm, dáng người mẫu, không gian bối cảnh & điểm bán hàng độc nhất (USPs).
        </div>

        <button
          type="button"
          className="wf-btn wf-btn-primary"
          style={{ width: '100%', justifyContent: 'center', marginBottom: 10 }}
          onClick={() => data.onAnalyze?.()}
          disabled={isAnalyzing}
        >
          <Wand2 size={13} />
          {isAnalyzing ? 'Đang phân tích hình ảnh...' : 'Phân Tích Với Gemini'}
        </button>

        {/* Analysis Results Display */}
        {res ? (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: 10,
              fontSize: 11,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <Tag size={13} color="#2563eb" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: '#0f172a' }}>Đặc tính sản phẩm:</strong>
                <div style={{ color: '#475569', marginTop: 1 }}>{res.productFeatures}</div>
              </div>
            </div>

            {res.modelAttributes && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <Eye size={13} color="#7c3aed" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ color: '#0f172a' }}>Người mẫu & Phong thái:</strong>
                  <div style={{ color: '#475569', marginTop: 1 }}>{res.modelAttributes}</div>
                </div>
              </div>
            )}

            {res.sceneVibe && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <Camera size={13} color="#e11d48" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ color: '#0f172a' }}>Không gian & Ánh sáng:</strong>
                  <div style={{ color: '#475569', marginTop: 1 }}>{res.sceneVibe}</div>
                </div>
              </div>
            )}

            {res.keySellingPoints && res.keySellingPoints.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <Lightbulb size={13} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ color: '#0f172a' }}>Điểm nhấn tạo kịch bản (USPs):</strong>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                    {res.keySellingPoints.map((usp, i) => (
                      <span
                        key={i}
                        style={{
                          background: '#fef3c7',
                          color: '#92400e',
                          padding: '2px 6px',
                          borderRadius: 4,
                          fontSize: 10,
                          fontWeight: 600,
                        }}
                      >
                        {usp}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontSize: 10, color: '#10b981', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                <CheckCircle2 size={12} /> Sẵn sàng chuyển sang GPT
              </span>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '12px 10px',
              textAlign: 'center',
              background: '#f8fafc',
              borderRadius: 8,
              border: '1px dashed #cbd5e1',
              color: '#94a3b8',
              fontSize: 11,
            }}
          >
            Chưa có dữ liệu phân tích. Bấm nút trên để Gemini soi ảnh.
          </div>
        )}
      </div>

      {/* Output handle to ChatGPT Script Node */}
      <Handle
        type="source"
        position={Position.Right}
        id="to-gpt"
        className="wf-handle wf-handle-source"
      />
    </div>
  )
}
