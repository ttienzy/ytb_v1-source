import React from 'react'
import {
  Sparkles,
  Film,
  RotateCcw,
  Zap,
  Trash2,
  Video,
} from 'lucide-react'
import { WorkflowTabs } from './WorkflowTabs'
import type { WorkflowTabId } from '../types'

interface WorkflowToolbarProps {
  activeTab: WorkflowTabId
  onTabChange: (tabId: WorkflowTabId) => void
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
  activeTab,
  onTabChange,
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
      {/* Left: Workflow Mode Tabs & Video Library */}
      <div className="workflow-toolbar-left">
        {/* Navigation Tabs */}
        <WorkflowTabs activeTab={activeTab} onTabChange={onTabChange} />

        <div className="wf-toolbar-divider" />

        {/* Global Video Library button */}
        <button
          type="button"
          className="wf-btn wf-btn-library"
          onClick={onOpenLibrary}
          title="Mở Thư Viện quản lý video đã xuất"
        >
          <Film size={14} color="#4f46e5" />
          <span>Thư Viện Video</span>
          {typeof exportedCount === 'number' && exportedCount > 0 && (
            <span className="wf-library-count-pill">
              {exportedCount}
            </span>
          )}
        </button>
      </div>

      {/* Right: Actions specific to active workflow tab */}
      <div className="workflow-toolbar-actions">
        {activeTab === 'chaining' ? (
          <>
            {/* Start Node Badge Indicator */}
            <div
              className="wf-start-node-badge"
              title="Node chính là điểm bắt đầu khi bấm chạy toàn bộ quy trình"
            >
              <span style={{ fontSize: 12 }}>⭐</span>
              <span>Node chính: <strong>{startNodeTitle}</strong></span>
            </div>

            {/* Clean Orphan Nodes button */}
            {orphanCount > 0 && (
              <button
                type="button"
                className="wf-btn wf-btn-clean"
                onClick={onCleanOrphans}
                title={`Xóa ${orphanCount} node rời rạc chưa nối dây`}
              >
                <Trash2 size={13} />
                <span>Dọn {orphanCount} node thừa</span>
              </button>
            )}

            <button
              type="button"
              className="wf-btn"
              onClick={onResetLayout}
              title="Khôi phục bố cục chuẩn theo bản phác thảo"
            >
              <RotateCcw size={13} />
              <span>Mặc định (Sketch)</span>
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
                  <span>Đang chạy từ {startNodeTitle}...</span>
                </>
              ) : (
                <>
                  <Zap size={14} />
                  <span>⚡ Chạy Từ Node Chính ({startNodeTitle})</span>
                </>
              )}
            </button>
          </>
        ) : (
          <div className="wf-motion-active-indicator">
            <span className="wf-motion-pulse-dot" />
            <span>Studio: <strong>Video Reference & Motion Transfer</strong></span>
          </div>
        )}
      </div>
    </header>
  )
}
