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
  Broom,
  Trash2,
  CheckCircle2,
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
  onCleanOrphans: () => void
  orphanCount: number
  startNodeTitle?: string
  isRunning?: boolean
}

export function WorkflowToolbar({
  onAddNode,
  onResetLayout,
  onSimulateRun,
  onCleanOrphans,
  orphanCount = 0,
  startNodeTitle = 'Gemini 2.5',
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

      {/* Right: Node Chính indicator & Execution Actions */}
      <div className="workflow-toolbar-actions">
        {/* Start Node Badge Indicator */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: '#ecfdf5',
            border: '1px solid #a7f3d0',
            borderRadius: 8,
            padding: '4px 10px',
            fontSize: 11,
            color: '#065f46',
            fontWeight: 600,
          }}
          title="Node chính là điểm bắt đầu khi bấm chạy toàn bộ quy trình"
        >
          <span style={{ fontSize: 12 }}>⭐</span>
          <span>Node chính: <strong>{startNodeTitle}</strong></span>
        </div>

        {/* Clean Orphan Nodes button (shows when there are disconnected nodes) */}
        {orphanCount > 0 && (
          <button
            type="button"
            className="wf-btn"
            onClick={onCleanOrphans}
            style={{
              background: '#fffbeb',
              borderColor: '#fde68a',
              color: '#b45309',
            }}
            title={`Xóa ${orphanCount} node rời rạc chưa nối dây`}
          >
            <Trash2 size={13} />
            Dọn {orphanCount} node thừa
          </button>
        )}

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
          title="Chạy quy trình bắt đầu từ Node chính (Gemini 2.5)"
          style={{
            boxShadow: '0 2px 10px rgba(16, 185, 129, 0.35)',
            background: isRunning
              ? 'linear-gradient(135deg, #ec4899, #e11d48)'
              : 'linear-gradient(135deg, #059669, #10b981)',
            borderColor: isRunning ? '#e11d48' : '#059669',
          }}
        >
          {isRunning ? (
            <>
              <Sparkles size={14} className="animate-spin" />
              Đang chạy từ Gemini...
            </>
          ) : (
            <>
              <Zap size={14} />
              ⚡ Chạy Từ Node Chính (Gemini)
            </>
          )}
        </button>
      </div>
    </header>
  )
}
