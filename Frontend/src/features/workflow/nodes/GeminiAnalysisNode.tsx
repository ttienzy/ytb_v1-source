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
  const isStartNode = data.isStartNode ?? false
  const isOrphan = data.isOrphan ?? false
  const res = data.analysisResult

  return (
    <div
      className={`wf-node-card ${selected ? 'selected' : ''} ${isStartNode ? 'is-start-node' : ''} ${isOrphan ? 'is-orphan' : ''}`}
      style={{ width: 350 }}
    >
      {/* Start Node Top Banner */}
      {isStartNode && (
        <div className="wf-start-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="wf-start-dot" />
            <span>⭐ NODE CHÍNH (ĐIỂM KHỞI ĐẦU)</span>
          </div>
          <span style={{ fontSize: 9, opacity: 0.9 }}>Root Trigger</span>
        </div>
      )}

      {/* Top Handle receiving downward wire from ProductAssetsNode */}
      <Handle
        type="target"
        position={Position.Top}
        id="from-products"
        style={{ left: '50%' }}
        className="wf-handle wf-handle-target"
        title="Nhận ảnh sản phẩm từ trên xuống"
      />

      {/* Left Handle fallback */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        style={{ top: '50%' }}
        className="wf-handle wf-handle-target"
      />

      {/* Header */}
      <div className="wf-node-header" style={{ background: isStartNode ? '#ecfdf5' : '#f0fdf4', borderBottom: '1px solid #dcfce7' }}>
        <div className="wf-node-title-group">
          <div
            className="wf-node-icon"
            style={{
              background: 'linear-gradient(135deg, #10b981, #059669)',
              color: '#ffffff',
              boxShadow: '0 2px 6px rgba(16, 185, 129, 0.3)',
            }}
          >
            <Sparkles size={15} />
          </div>
          <div>
            <div className="wf-node-title" style={{ color: '#064e3b', display: 'flex', alignItems: 'center', gap: 6 }}>
              {data.title || 'Gemini 2.5 • Vision Phân Tích'}
            </div>
            <div style={{ fontSize: 10, color: '#059669', fontWeight: 600 }}>
              {data.model || 'gemini-2.5-flash'} • Google DeepMind
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
              background: res ? '#ecfdf5' : '#f8fafc',
              color: res ? '#059669' : '#64748b',
              border: res ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
            }}
          >
            {res ? 'Đã phân tích' : 'Vision AI'}
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
          Tự động trích xuất chất liệu, form dáng, tính năng nổi bật & đề xuất góc quay cho video.
        </div>

        <button
          type="button"
          className="wf-btn wf-btn-primary"
          style={{ width: '100%', justifyContent: 'center', marginBottom: 10, padding: '7px 12px' }}
          onClick={() => data.onAnalyze?.()}
          disabled={isAnalyzing}
        >
          <Wand2 size={13} className={isAnalyzing ? 'animate-spin' : ''} />
          {isAnalyzing
            ? 'Đang soi ảnh & trích xuất USPs...'
            : isStartNode
            ? '⚡ Bắt Đầu Phân Tích (Node Chính)'
            : 'Phân Tích Với Gemini'}
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

            {res.keySellingPoints && res.keySellingPoints.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <Lightbulb size={13} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ color: '#0f172a' }}>Điểm nhấn bán hàng (USPs):</strong>
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

            <div
              style={{
                borderTop: '1px solid #e2e8f0',
                paddingTop: 6,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span
                style={{
                  fontSize: 10,
                  color: '#059669',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  fontWeight: 600,
                }}
              >
                <CheckCircle2 size={12} /> Sẵn sàng chuyển giao sang GPT
              </span>
            </div>
          </div>
        ) : (
          <div
            style={{
              padding: '16px 12px',
              textAlign: 'center',
              background: '#f8fafc',
              borderRadius: 8,
              border: '1px dashed #cbd5e1',
              color: '#94a3b8',
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 4,
            }}
          >
            <Sparkles size={18} color="#cbd5e1" />
            <span>Chưa có dữ liệu phân tích.</span>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>
              Nạp ảnh sản phẩm và nhấp nút trên để phân tích.
            </span>
          </div>
        )}
      </div>

      {/* Output handle to ChatGPT Script Node */}
      <Handle
        type="source"
        position={Position.Right}
        id="to-gpt"
        style={{ top: '50%' }}
        className="wf-handle wf-handle-source"
        title="Dòng phân tích sang ChatGPT"
      />
    </div>
  )
}
