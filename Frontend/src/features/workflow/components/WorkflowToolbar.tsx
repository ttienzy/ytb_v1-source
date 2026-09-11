import {
  Sparkles,
  Film,
  RotateCcw,
  Zap,
  Trash2,
} from 'lucide-react'

interface WorkflowToolbarProps {
  onResetLayout: () => void
  onSimulateRun: () => void
  onCleanOrphans: () => void
  onOpenLibrary?: () => void
  exportedCount?: number
  orphanCount: number
  startNodeTitle?: string
  isRunning?: boolean
}

export function WorkflowToolbar({
  onResetLayout,
  onSimulateRun,
  onCleanOrphans,
  onOpenLibrary,
  exportedCount = 0,
  orphanCount = 0,
  startNodeTitle = 'Gemini 2.5',
  isRunning = false,
}: WorkflowToolbarProps) {
  return (
    <header className="workflow-toolbar">
      {/* Left: Video Library & Node addition buttons */}
      <div className="workflow-toolbar-left">
        <button
          type="button"
          className="wf-btn"
          onClick={onOpenLibrary}
          style={{
            background: 'linear-gradient(135deg, #eef2ff, #e0e7ff)',
            borderColor: '#c7d2fe',
            color: '#4338ca',
            fontWeight: 700,
            padding: '5px 12px',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
          }}
          title="Mở Thư Viện quản lý video đã xuất"
        >
          <Film size={14} color="#4f46e5" />
          <span>Thư Viện Video</span>
          {typeof exportedCount === 'number' && exportedCount > 0 && (
            <span
              style={{
                background: '#4f46e5',
                color: '#ffffff',
                fontSize: 10,
                fontWeight: 800,
                padding: '1px 6px',
                borderRadius: 10,
                marginLeft: 2,
              }}
            >
              {exportedCount}
            </span>
          )}
        </button>
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
          title={`Chạy quy trình bắt đầu từ Node chính (${startNodeTitle})`}
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
              Đang chạy từ {startNodeTitle}...
            </>
          ) : (
            <>
              <Zap size={14} />
              ⚡ Chạy Từ Node Chính ({startNodeTitle})
            </>
          )}
        </button>
      </div>
    </header>
  )
}
