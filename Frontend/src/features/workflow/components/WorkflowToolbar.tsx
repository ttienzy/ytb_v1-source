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
  ShoppingBag,
  User,
  Video,
} from 'lucide-react'

interface WorkflowToolbarProps {
  onAddNode: (
    type:
      | 'productAssets'
      | 'characterScene'
      | 'geminiAnalysis'
      | 'gptScript'
      | 'veoFlowStudio'
      | 'sceneVideo'
      | 'exportTimeline'
  ) => void
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
            onClick={() => onAddNode('productAssets')}
            title="Thêm khối ảnh sản phẩm (tối đa 3 ảnh)"
          >
            <ShoppingBag size={13} color="#2563eb" />
            + Ảnh SP
          </button>

          <button
            type="button"
            className="wf-btn"
            onClick={() => onAddNode('characterScene')}
            title="Thêm khối người mẫu & bối cảnh không gian"
          >
            <User size={13} color="#7c3aed" />
            + Mẫu & Bối Cảnh
          </button>

          <button
            type="button"
            className="wf-btn"
            onClick={() => onAddNode('geminiAnalysis')}
            title="Thêm khối Gemini Vision phân tích hình ảnh"
          >
            <Sparkles size={13} color="#059669" />
            + Gemini Soi Ảnh
          </button>

          <button
            type="button"
            className="wf-btn"
            onClick={() => onAddNode('gptScript')}
            title="Thêm khối kịch bản ChatGPT / 9Router"
          >
            <Bot size={13} color="#9333ea" />
            + Kịch Bản GPT
          </button>

          <button
            type="button"
            className="wf-btn"
            onClick={() => onAddNode('veoFlowStudio')}
            title="Thêm Google Veo 3.0 Flow Studio"
          >
            <Video size={13} color="#e11d48" />
            + Flow Studio
          </button>
        </div>
      </div>

      {/* Right: Actions */}
      <div className="workflow-toolbar-actions">
        <button
          type="button"
          className="wf-btn"
          onClick={onResetLayout}
          title="Khôi phục bố cục chuẩn theo bản phác thảo"
        >
          <RotateCcw size={13} />
          Mặc định (Sketch)
        </button>

        <button
          type="button"
          className={`wf-btn ${isRunning ? 'wf-btn-accent' : 'wf-btn-primary'}`}
          onClick={onSimulateRun}
          title="Chạy mô phỏng toàn bộ luồng tạo video từ ảnh đến xuất MP4"
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
