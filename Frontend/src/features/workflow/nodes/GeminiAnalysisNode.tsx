import React, { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import {
  Sparkles,
  Eye,
  Trash2,
  CheckCircle2,
  Wand2,
  Lightbulb,
  Camera,
  Tag,
  Link2,
  Link2Off,
  Image as ImageIcon,
  FileText,
  RotateCcw,
  AlertCircle,
  RefreshCw,
  Key,
  Bot,
  Star,
  Save,
} from 'lucide-react'
import type { GeminiAnalysisNodeData } from '../types'

interface GeminiAnalysisNodeProps {
  data: GeminiAnalysisNodeData
  selected?: boolean
}

export function GeminiAnalysisNode({ data, selected }: GeminiAnalysisNodeProps) {
  const isAnalyzing = data.isAnalyzing ?? false
  const isStartNode = data.isStartNode ?? false
  const isOrphan = data.isOrphan ?? false
  const isConnected = data.isConnectedToImages ?? false
  const connectedImages = data.connectedImages || []
  const validImages = connectedImages.filter(Boolean) as string[]

  const promptText = data.prompt ?? ''
  const res = data.analysisResult

  const [isSavingPrompt, setIsSavingPrompt] = useState(false)
  const [saveNotification, setSaveNotification] = useState<string | null>(null)

  const handleResetPrompt = () => {
    data.onResetPrompt?.()
  }

  const handleSaveDefaultPrompt = async () => {
    if (!promptText.trim()) return
    setIsSavingPrompt(true)
    try {
      await data.onSaveDefaultPrompt?.(promptText.trim())
      setSaveNotification('✓ Đã lưu làm prompt mặc định!')
      setTimeout(() => setSaveNotification(null), 2500)
    } catch (err: any) {
      alert(err?.message || 'Lỗi khi lưu prompt mặc định')
    } finally {
      setIsSavingPrompt(false)
    }
  }

  return (
    <div
      className={`wf-node-card wf-node-gemini ${selected ? 'selected' : ''} ${isStartNode ? 'is-start-node' : ''} ${isOrphan ? 'is-orphan' : ''}`}
      style={{ width: 380 }}
    >
      {/* Start Node Top Banner */}
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
      <div className="wf-node-header">
        <div className="wf-node-title-group">
          <div className="wf-node-icon">
            <Sparkles size={15} />
          </div>
          <div>
            <div className="wf-node-title" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {data.title || 'Gemini • Phân Tích'}
            </div>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>
              {data.provider || 'Trích xuất chi tiết & bao bì'}
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
              background: data.providerUsed === '9router' ? '#f5f3ff' : res ? '#ecfdf5' : '#eef2ff',
              color: data.providerUsed === '9router' ? '#6d28d9' : res ? '#065f46' : '#4338ca',
              border: data.providerUsed === '9router' ? '1px solid #ddd6fe' : res ? '1px solid #d1fae5' : '1px solid #c7d2fe',
            }}
          >
            {data.providerUsed === '9router' ? 'GPT-5.5' : res ? 'Gemini' : isConnected ? 'Đã nối dây' : 'Vision AI'}
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
      <div className="wf-node-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {/* Cookie Refreshing State Banner */}
        {data.isRefreshingCookie && (
          <div
            style={{
              background: '#eff6ff',
              border: '1px solid #bfdbfe',
              borderRadius: 6,
              padding: '6px 8px',
              color: '#1d4ed8',
              fontSize: 10.5,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <RefreshCw size={13} className="animate-spin" />
            <div style={{ flex: 1, fontWeight: 500 }}>
              Đang tự động làm mới cookie Gemini ngầm qua Chrome (3-5s)...
            </div>
          </div>
        )}

        {/* Actionable Error Card */}
        {data.analysisError && !data.isRefreshingCookie && (
          <div
            style={{
              background: '#fff1f2',
              border: '1px solid #fecdd3',
              borderRadius: 8,
              padding: '8px 10px',
              color: '#9f1239',
              fontSize: 10.5,
              display: 'flex',
              flexDirection: 'column',
              gap: 6,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <AlertCircle size={14} style={{ flexShrink: 0, marginTop: 1, color: '#e11d48' }} />
              <div style={{ flex: 1, fontWeight: 500, lineHeight: 1.35 }}>
                {data.analysisError}
              </div>
            </div>

            {/* Action buttons toolbar */}
            <div style={{ display: 'flex', gap: 5, marginTop: 2, flexWrap: 'wrap' }}>
              <button
                type="button"
                className="wf-btn"
                onClick={() => data.onAnalyze?.()}
                disabled={isAnalyzing || data.isRefreshingCookie}
                style={{
                  fontSize: 9.5,
                  padding: '3px 8px',
                  background: '#e11d48',
                  color: '#ffffff',
                  border: 'none',
                  borderRadius: 4,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                }}
                title="Thử lại lệnh phân tích"
              >
                <RefreshCw size={10} className={isAnalyzing ? 'animate-spin' : ''} />
                Thử lại ngay
              </button>

              <button
                type="button"
                className="wf-btn"
                onClick={() => data.onRefreshCookie?.()}
                disabled={data.isRefreshingCookie}
                style={{
                  fontSize: 9.5,
                  padding: '3px 8px',
                  background: '#f1f5f9',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  borderRadius: 4,
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                }}
                title="Mở Chrome ngầm 3s để cập nhật cookie mới nhất"
              >
                <Key size={10} color="#0284c7" />
                Làm mới Cookie (Fast)
              </button>

              {data.onAnalyze9Router && (
                <button
                  type="button"
                  className="wf-btn"
                  onClick={() => data.onAnalyze9Router?.()}
                  disabled={isAnalyzing}
                  style={{
                    fontSize: 9.5,
                    padding: '3px 8px',
                    background: '#f0fdf4',
                    color: '#166534',
                    border: '1px solid #bbf7d0',
                    borderRadius: 4,
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    cursor: 'pointer',
                  }}
                  title="Dùng 9Router Vision (GPT-5.5) thay thế mà không cần cookie Gemini"
                >
                  <Bot size={10} color="#16a34a" />
                  Dùng 9Router AI
                </button>
              )}
            </div>
          </div>
        )}

        {/* Conditional rendering based on whether wire is connected into Gemini */}
        {isConnected ? (
          <>
            {/* 1. Connected Input Images Strip */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 8,
                padding: '8px 10px',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 6,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    color: '#334155',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Link2 size={12} color="#2563eb" />
                  Ảnh nhận từ dây nối ({validImages.length}/3 ảnh):
                </span>
                <span
                  style={{
                    fontSize: 9,
                    color: validImages.length > 0 ? '#059669' : '#d97706',
                    fontWeight: 600,
                  }}
                >
                  {validImages.length > 0 ? '✓ Đã đồng bộ' : 'Chờ nạp ảnh ở khối trên'}
                </span>
              </div>

              {validImages.length > 0 ? (
                <div style={{ display: 'flex', gap: 6 }}>
                  {validImages.map((imgUrl, idx) => (
                    <div
                      key={idx}
                      style={{
                        position: 'relative',
                        width: 58,
                        height: 58,
                        borderRadius: 6,
                        overflow: 'hidden',
                        border: '1px solid #cbd5e1',
                        background: '#0f172a',
                        flexShrink: 0,
                      }}
                    >
                      <img
                        src={imgUrl}
                        alt={`Ảnh ${idx + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                      <span
                        style={{
                          position: 'absolute',
                          bottom: 2,
                          left: 2,
                          background: 'rgba(0,0,0,0.65)',
                          color: '#fff',
                          fontSize: 8,
                          padding: '1px 3px',
                          borderRadius: 3,
                          fontWeight: 700,
                        }}
                      >
                        #{idx + 1}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <div
                  style={{
                    fontSize: 10,
                    color: '#94a3b8',
                    fontStyle: 'italic',
                    padding: '4px 0',
                  }}
                >
                  Dây đã nối thành công. Hãy tải ảnh vào khối [Ảnh Sản Phẩm] phía trên để soi ảnh.
                </div>
              )}
            </div>

            {/* 2. Prompt Box on Node Card */}
            <div>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginBottom: 4,
                }}
              >
                <label
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#334155',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <FileText size={12} color="#10b981" />
                  Prompt chỉ thị Gemini Vision:
                </label>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <button
                    type="button"
                    onClick={handleSaveDefaultPrompt}
                    disabled={isSavingPrompt || !promptText.trim()}
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
                    title="Lưu nội dung prompt hiện tại làm mặc định lâu dài cho Gemini"
                  >
                    <Save size={10} />
                    {isSavingPrompt ? 'Đang lưu...' : 'Lưu mặc định'}
                  </button>
                  <button
                    type="button"
                    onClick={handleResetPrompt}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: '#64748b',
                      fontSize: 10,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 3,
                      cursor: 'pointer',
                    }}
                    title="Khôi phục prompt mặc định đã lưu từ Backend"
                  >
                    <RotateCcw size={10} /> Mặc định
                  </button>
                </div>
              </div>

              <textarea
                className="wf-input-textarea"
                rows={4}
                value={promptText}
                onChange={(e) => data.onChangePrompt?.(e.target.value)}
                placeholder="Nhập prompt tra cứu và phân tích sản phẩm..."
                style={{
                  fontSize: 11,
                  lineHeight: 1.45,
                  background: '#f8fafc',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  resize: 'vertical',
                }}
              />

              {saveNotification && (
                <div style={{ marginTop: 4, fontSize: 9.5, color: '#059669', fontWeight: 600 }}>
                  {saveNotification}
                </div>
              )}
            </div>

            {/* 3. Analyze Action Button */}
            <button
              type="button"
              className="wf-btn wf-btn-primary"
              style={{
                width: '100%',
                justifyContent: 'center',
                padding: '7px 12px',
              }}
              onClick={() => data.onAnalyze?.()}
              disabled={isAnalyzing}
            >
              <Wand2 size={13} className={isAnalyzing ? 'animate-spin' : ''} />
              {isAnalyzing
                ? 'Đang soi ảnh & tra cứu theo prompt...'
                : isStartNode
                  ? 'Bắt Đầu Phân Tích (Node Chính)'
                  : 'Phân Tích Với Gemini'}
            </button>
          </>
        ) : (
          /* Wire not connected state */
          <div
            style={{
              padding: '14px 12px',
              background: '#f8fafc',
              border: '1px dashed #cbd5e1',
              borderRadius: 8,
              textAlign: 'center',
              color: '#64748b',
              fontSize: 11,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: '50%',
                background: '#eef2ff',
                border: '1px solid #c7d2fe',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Link2Off size={16} color="#6366f1" />
            </div>
            <div>
              <strong style={{ color: '#0f172a' }}>Chưa có dây nối nạp ảnh</strong>
              <div style={{ color: '#64748b', fontSize: 10, marginTop: 2 }}>
                Nối dây từ khối <strong>[Ảnh Sản Phẩm]</strong> để bắt đầu phân tích.
              </div>
            </div>
          </div>
        )}

        {/* 4. Analysis Results Display */}
        {res && (
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
            {/* Điểm 'ăn tiền' và yếu tố thu hút chung */}
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
              <Tag size={13} color="#2563eb" style={{ flexShrink: 0, marginTop: 2 }} />
              <div>
                <strong style={{ color: '#0f172a' }}>Điểm 'ăn tiền' & Yếu tố thu hút chung:</strong>
                <div style={{ color: '#475569', marginTop: 1, lineHeight: 1.4 }}>
                  {res.productFeatures || (res as any).features?.join('; ') || (res as any).rawText}
                </div>
              </div>
            </div>

            {/* Phân loại chi tiết từng sản phẩm */}
            {res.classifications && res.classifications.length > 0 && (
              <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 6 }}>
                <strong style={{ color: '#0f172a', display: 'block', marginBottom: 4 }}>
                  Phân loại chi tiết từng sản phẩm ({res.classifications.length}):
                </strong>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {res.classifications.map((item, i) => (
                    <div
                      key={i}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        padding: '6px 8px',
                        fontSize: 10,
                      }}
                    >
                      <div style={{ fontWeight: 700, color: '#1e3a8a' }}>
                        • {item.name} {item.colorVariant ? `(${item.colorVariant})` : ''}
                      </div>
                      {item.mainIngredients && (
                        <div style={{ color: '#475569', marginTop: 1 }}>
                          - Thành phần chính: {item.mainIngredients}
                        </div>
                      )}
                      {item.coreBenefits && (
                        <div style={{ color: '#475569' }}>
                          - Công dụng cốt lõi: {item.coreBenefits}
                        </div>
                      )}
                      {item.experienceScent && (
                        <div style={{ color: '#475569' }}>
                          - Trải nghiệm/Mùi hương: {item.experienceScent}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* USPs / Điểm nhấn kịch bản */}
            {(((res.keySellingPoints && res.keySellingPoints.length > 0) ? res.keySellingPoints : (res as any).sellingPoints) || []).length > 0 && (
              <div style={{ display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                <Lightbulb size={13} color="#d97706" style={{ flexShrink: 0, marginTop: 2 }} />
                <div>
                  <strong style={{ color: '#0f172a' }}>USPs nổi bật:</strong>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginTop: 3 }}>
                    {(((res.keySellingPoints && res.keySellingPoints.length > 0) ? res.keySellingPoints : (res as any).sellingPoints) || []).map((usp: string, i: number) => (
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

            {/* Collapsible raw text for transparency */}
            {(res as any).rawText && (
              <details style={{ marginTop: 2, fontSize: 10, color: '#64748b' }}>
                <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#2563eb' }}>
                  📄 Xem toàn bộ phản hồi Gemini (Markdown)
                </summary>
                <div
                  style={{
                    marginTop: 4,
                    padding: 6,
                    background: '#ffffff',
                    borderRadius: 4,
                    border: '1px solid #e2e8f0',
                    whiteSpace: 'pre-wrap',
                    maxHeight: 180,
                    overflowY: 'auto',
                    fontSize: 9.5,
                    fontFamily: 'monospace',
                  }}
                >
                  {(res as any).rawText}
                </div>
              </details>
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
