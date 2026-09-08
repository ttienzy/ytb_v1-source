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
  Lightbulb,
} from 'lucide-react'
import type { GptScriptNodeData } from '../types'

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
  const [activeTab, setActiveTab] = useState<number>(0)
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null)

  const handleCopy = (text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIndex(idx)
    setTimeout(() => setCopiedIndex(null), 2000)
  }

  const currentScript = salesScripts[activeTab]

  return (
    <div
      className={`wf-node-card ${selected ? 'selected' : ''} ${isStartNode ? 'is-start-node' : ''} ${isOrphan ? 'is-orphan' : ''}`}
      style={{ width: 400 }}
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
              {data.title || 'ChatGPT • Kịch Bản Bán Hàng'}
            </div>
            <div style={{ fontSize: 10, color: '#9333ea', fontWeight: 600 }}>
              {data.model || 'cx/gpt-5.5'} • 9Router Gateway
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
        {/* 1. Connected Product Images Display */}
        <div style={{ marginBottom: 8, padding: '6px 8px', background: '#f8fafc', borderRadius: 6, border: '1px solid #e2e8f0' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, fontWeight: 700, color: '#475569', marginBottom: 4 }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <Camera size={12} style={{ color: '#7c3aed' }} />
              Ảnh sản phẩm nhận từ dây nối ({validImages.length}/3 ảnh):
            </span>
            <span style={{ color: validImages.length > 0 ? '#10b981' : '#94a3b8', fontSize: 9 }}>
              {validImages.length > 0 ? '✓ Đã đồng bộ' : 'Chờ nạp ảnh'}
            </span>
          </div>

          {validImages.length > 0 ? (
            <div style={{ display: 'flex', gap: 6 }}>
              {validImages.map((imgUrl, i) => (
                <div
                  key={i}
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: 5,
                    overflow: 'hidden',
                    border: '1px solid #cbd5e1',
                    background: '#ffffff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <img src={imgUrl} alt={`SP ${i + 1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                </div>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: 10, color: '#94a3b8', fontStyle: 'italic' }}>
              Dây nối từ khối [Ảnh Sản Phẩm] phía trên để GPT quan sát bao bì thực tế.
            </div>
          )}
        </div>

        {/* 2. Connected Gemini Data Status */}
        <div style={{ marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '5px 8px', borderRadius: 6, background: hasProductData ? '#ecfdf5' : '#fffbeb', border: hasProductData ? '1px solid #a7f3d0' : '1px solid #fde68a' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
            {hasProductData ? (
              <>
                <CheckCircle2 size={13} style={{ color: '#059669' }} />
                <span style={{ color: '#065f46', fontWeight: 600 }}>Dữ liệu Gemini: Đã nạp USP & Phân loại</span>
              </>
            ) : (
              <>
                <AlertCircle size={13} style={{ color: '#d97706' }} />
                <span style={{ color: '#92400e', fontWeight: 500 }}>Chờ Gemini phân tích sản phẩm</span>
              </>
            )}
          </div>
          <span style={{ fontSize: 9, color: hasProductData ? '#059669' : '#b45309', fontWeight: 600 }}>
            {hasProductData ? 'Sẵn sàng' : 'Chưa có'}
          </span>
        </div>

        {/* 3. Prompt Template input */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
            <FileText size={12} style={{ color: '#7c3aed' }} />
            Prompt chỉ thị ChatGPT (3 kịch bản bán hàng):
          </label>
          <button
            type="button"
            onClick={() => data.onResetPrompt?.()}
            style={{
              background: 'transparent',
              border: 'none',
              color: '#7c3aed',
              fontSize: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 3,
              cursor: 'pointer',
              fontWeight: 600,
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
          placeholder="Dán prompt tạo kịch bản tại đây. Sử dụng biến {{PRODUCT_DATA}} để tự động nạp kết quả từ Gemini..."
          style={{ minHeight: 90, fontSize: 11, fontFamily: 'monospace' }}
        />

        {/* Action button */}
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontSize: 10, color: '#64748b' }}>
            Mục tiêu: <strong>3 kịch bản (80-130 từ)</strong>
          </div>

          <button
            type="button"
            className="wf-btn wf-btn-primary"
            onClick={() => data.onGenerate?.()}
            disabled={isGenerating}
            style={{
              padding: '6px 14px',
              background: 'linear-gradient(135deg, #9333ea, #7c3aed)',
              borderColor: '#7c3aed',
            }}
          >
            <Sparkles size={13} className={isGenerating ? 'animate-spin' : ''} />
            {isGenerating ? 'Đang viết kịch bản...' : 'Sinh 3 Kịch Bản Bán Hàng'}
          </button>
        </div>

        {/* 4. Output Scripts: 3 Tabs / Cards */}
        {salesScripts.length > 0 ? (
          <div style={{ marginTop: 12, borderTop: '1px solid #ede9fe', paddingTop: 10 }}>
            {/* Tabs */}
            <div style={{ display: 'flex', gap: 4, marginBottom: 8, overflowX: 'auto', paddingBottom: 2 }}>
              {salesScripts.map((s, idx) => (
                <button
                  key={idx}
                  type="button"
                  onClick={() => setActiveTab(idx)}
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '4px 8px',
                    borderRadius: 5,
                    border: activeTab === idx ? '1px solid #7c3aed' : '1px solid #e2e8f0',
                    background: activeTab === idx ? '#f5f3ff' : '#f8fafc',
                    color: activeTab === idx ? '#7c3aed' : '#64748b',
                    cursor: 'pointer',
                    whiteSpace: 'nowrap',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {s.angle.includes('1') ? '🎬 Góc 1: Vấn đề' : s.angle.includes('2') ? '💎 Góc 2: USP' : '✨ Góc 3: Trải nghiệm'}
                </button>
              ))}
            </div>

            {/* Active Script Card */}
            {currentScript && (
              <div
                style={{
                  background: '#faf5ff',
                  border: '1px solid #e9d5ff',
                  borderRadius: 6,
                  padding: '10px',
                  fontSize: 11,
                  color: '#334155',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6, borderBottom: '1px dashed #d8b4fe', paddingBottom: 4 }}>
                  <span style={{ fontWeight: 700, color: '#6b21a8' }}>
                    {currentScript.angle}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 9, background: '#f3e8ff', color: '#7e22ce', padding: '1px 5px', borderRadius: 3, fontWeight: 600 }}>
                      ~{currentScript.word_count || currentScript.wordCount || 0} từ
                    </span>
                    <button
                      type="button"
                      onClick={() => handleCopy(currentScript.content, activeTab)}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        cursor: 'pointer',
                        color: copiedIndex === activeTab ? '#16a34a' : '#7c3aed',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 2,
                        fontSize: 10,
                        fontWeight: 600,
                      }}
                      title="Sao chép kịch bản này"
                    >
                      {copiedIndex === activeTab ? <Check size={12} /> : <Copy size={12} />}
                      {copiedIndex === activeTab ? 'Đã chép' : 'Chép'}
                    </button>
                  </div>
                </div>

                {/* Breakdown items if parsed */}
                {currentScript.hook && (
                  <div style={{ marginBottom: 3, fontSize: 10.5 }}>
                    <strong style={{ color: '#7e22ce' }}>Hook:</strong> {currentScript.hook}
                  </div>
                )}
                {currentScript.problem && (
                  <div style={{ marginBottom: 3, fontSize: 10.5 }}>
                    <strong style={{ color: '#7e22ce' }}>Vấn đề:</strong> {currentScript.problem}
                  </div>
                )}
                {currentScript.product && (
                  <div style={{ marginBottom: 3, fontSize: 10.5 }}>
                    <strong style={{ color: '#7e22ce' }}>Sản phẩm:</strong> {currentScript.product}
                  </div>
                )}
                {currentScript.benefits && (
                  <div style={{ marginBottom: 3, fontSize: 10.5 }}>
                    <strong style={{ color: '#7e22ce' }}>Lợi ích:</strong> {currentScript.benefits}
                  </div>
                )}
                {currentScript.cta && (
                  <div style={{ marginBottom: 6, fontSize: 10.5 }}>
                    <strong style={{ color: '#7e22ce' }}>CTA:</strong> {currentScript.cta}
                  </div>
                )}

                {/* Full script text */}
                <div
                  style={{
                    background: '#ffffff',
                    border: '1px solid #f3e8ff',
                    borderRadius: 4,
                    padding: '8px',
                    fontSize: 11,
                    lineHeight: '1.5',
                    color: '#1e293b',
                    whiteSpace: 'pre-line',
                    maxHeight: 180,
                    overflowY: 'auto',
                  }}
                >
                  {currentScript.content}
                </div>

                {/* Button Đẩy CẢ 3 Kịch Bản sang 3 Cảnh Veo */}
                <button
                  type="button"
                  onClick={() => {
                    if (data.onPushAllToVeo) {
                      data.onPushAllToVeo()
                    } else {
                      data.onPushToVeo?.(activeTab)
                    }
                  }}
                  style={{
                    marginTop: 8,
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
                    cursor: 'pointer',
                    boxShadow: '0 2px 6px rgba(244, 63, 94, 0.25)',
                    transition: 'all 0.15s ease',
                  }}
                  title="Đẩy cả 3 kịch bản đầy đủ vào 3 cảnh của Google Veo Flow Studio: Cảnh 1 = Kịch bản 1, Cảnh 2 = Kịch bản 2, Cảnh 3 = Kịch bản 3 (toàn bộ text, không cắt bớt)"
                >
                  <Sparkles size={13} />
                  🚀 Đẩy 3 Kịch Bản Vào 3 Phân Cảnh (Đầy Đủ Text)
                </button>

                {/* Secondary quick action buttons */}
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button
                    type="button"
                    onClick={() => data.onPushSingleToVeo?.(activeTab)}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      borderRadius: 5,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#475569',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      whiteSpace: 'nowrap',
                    }}
                    title="Đẩy toàn bộ text kịch bản đang chọn vào Cảnh đang mở trong Veo Flow Studio"
                  >
                    📌 Nạp riêng vào Cảnh đang mở
                  </button>

                  <button
                    type="button"
                    onClick={() => data.onSplitScriptToVeo?.(activeTab)}
                    style={{
                      flex: 1,
                      padding: '5px 8px',
                      borderRadius: 5,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#475569',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: 4,
                      whiteSpace: 'nowrap',
                    }}
                    title="Phân rã kịch bản này ra 3 cảnh: Cảnh 1: Hook+Vấn đề, Cảnh 2: Sản phẩm+Lợi ích, Cảnh 3: CTA (đầy đủ text)"
                  >
                    ✂️ Phân bổ kịch bản này ra 3 cảnh
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
            Chưa có kịch bản. Nhấn <strong>Sinh 3 Kịch Bản Bán Hàng</strong> để tạo.
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
