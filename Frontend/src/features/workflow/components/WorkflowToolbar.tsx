import React from 'react'
import {
  Sparkles,
  Layers,
  Bot,
  Film,
  Download,
  Plus,
  RotateCcw,
  Play,
  LayoutGrid,
  Zap,
} from 'lucide-react'

interface WorkflowToolbarProps {
  onAddNode: (type: 'assetInput' | 'geminiAnalysis' | 'gptScript' | 'sceneVideo' | 'exportTimeline') => void
  onResetLayout: () => void
  onSimulateRun: () => void
  isRunning?: boolean
}

export function WorkflowToolbar({
  onAddNode,
  onResetLayout,
  onSimulateRun,
  isRunning = false,
}: WorkflowToolbarProps) {
  return (
    <header className="workflow-toolbar">
      {/* Left: Brand Badge & Node addition buttons */}
      <div className="workflow-toolbar-left">
        <div className="workflow-title-badge">
          <Sparkles size={16} color="#6366f1" />
          <span>AI Visual Flow Studio</span>
        </div>

        <div style={{ height: 20, width: 1, background: '#e2e8f0' }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            type="button"
            className="wf-btn"
            onClick={() => onAddNode('assetInput')}
            title="Thêm khối nguyên liệu ảnh đầu vào"
          >
            <Layers size={13} color="#2563eb" />
            + Nguyên liệu
          </button>

          <button
            type="button"
            className="wf-btn"
            onClick={() => onAddNode('geminiAnalysis')}
            title="Thêm khối Gemini Vision phân tích hình ảnh"
          >
            <Sparkles size={13} color="#2563eb" />
            + Gemini Soi Ảnh
          </button>

          <button
            type="button"
            className="wf-btn"
            onClick={() => onAddNode('gptScript')}
            title="Thêm khối kịch bản ChatGPT / 9Router"
          >
            <Bot size={13} color="#7c3aed" />
            + Kịch bản GPT
          </button>

          <button
            type="button"
            className="wf-btn"
            onClick={() => onAddNode('sceneVideo')}
            title="Thêm phân cảnh Google Veo 3.0"
          >
            <Film size={13} color="#fb7185" />
            + Phân cảnh Veo
          </button>

          <button
            type="button"
            className="wf-btn"
            onClick={() => onAddNode('exportTimeline')}
            title="Thêm khối xuất video hoàn chỉnh"
          >
            <Download size={13} color="#34d399" />
            + Xuất video
          </button>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="workflow-toolbar-actions">
        <button
          type="button"
          className="wf-btn"
          onClick={onResetLayout}
          title="Khôi phục bố cục chuẩn"
        >
          <RotateCcw size={13} />
          Mặc định
        </button>

        <button
          type="button"
          className={`wf-btn ${isRunning ? 'wf-btn-accent' : 'wf-btn-primary'}`}
          onClick={onSimulateRun}
          title="Chạy mô phỏng toàn bộ luồng tạo video"
        >
          {isRunning ? (
            <>
              <Sparkles size={14} className="animate-spin" />
              Đang thực thi luồng...
            </>
          ) : (
            <>
              <Zap size={14} />
              ⚡ Chạy Thử Quy Trình
            </>
          )}
        </button>
      </div>
    </header>
  )
}
