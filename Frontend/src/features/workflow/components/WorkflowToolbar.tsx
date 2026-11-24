import React from 'react'
import {
  Sparkles,
  Film,
  RotateCcw,
  Zap,
  Trash2,
  Star,
  ImageIcon,
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
  onOpenImageLibrary?: () => void
  imageCount?: number
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
  onOpenImageLibrary,
  imageCount = 0,
  orphanCount = 0,
  startNodeTitle = 'Gemini 2.5',
  isRunning = false,
}: WorkflowToolbarProps) {
  return (
    <header className="workflow-toolbar">
      {/* Left: Workflow Mode Tabs & Asset Libraries */}
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
          <Film size={14} className="wf-icon-library-video" />
          <span>Thư Viện Video</span>
          {typeof exportedCount === 'number' && exportedCount > 0 && (
            <span className="wf-library-count-pill">
              {exportedCount}
            </span>
          )}
        </button>

        {/* Thư viện ảnh: ảnh Muse tạo + ảnh tải lên, dùng lại trong các node */}
        {onOpenImageLibrary && (
          <button
            type="button"
            className="wf-btn wf-btn-library"
            onClick={onOpenImageLibrary}
            title="Mở Thư Viện Ảnh (ảnh Muse tạo, ảnh bạn tải lên)"
          >
            <ImageIcon size={14} className="wf-icon-library-image" />
            <span>Thư Viện Ảnh</span>
            {imageCount > 0 && <span className="wf-library-count-pill">{imageCount}</span>}
          </button>
        )}
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
              <Star size={12} className="wf-star-icon" />
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
              className="wf-btn wf-btn-reset"
              onClick={onResetLayout}
              title="Khôi phục bố cục chuẩn theo bản phác thảo"
            >
              <RotateCcw size={13} />
              <span>Mặc định (Sketch)</span>
            </button>

            <button
              type="button"
              className={`wf-btn ${isRunning ? 'wf-btn-running' : 'wf-btn-run'}`}
              onClick={onSimulateRun}
              title={`Chạy quy trình bắt đầu từ Node chính (${startNodeTitle})`}
            >
              {isRunning ? (
                <>
                  <Sparkles size={14} className="animate-spin" />
                  <span>Đang chạy từ {startNodeTitle}...</span>
                </>
              ) : (
                <>
                  <Zap size={14} className="wf-zap-icon" />
                  <span>Chạy Từ Node Chính ({startNodeTitle})</span>
                </>
              )}
            </button>
          </>
        ) : activeTab === 'muse' ? (
          <div className="wf-motion-active-indicator wf-studio-muse">
            <span className="wf-motion-pulse-dot" />
            <span>Studio: <strong>Meta Muse Canvas</strong></span>
          </div>
        ) : (
          <div className="wf-motion-active-indicator wf-studio-motion">
            <span className="wf-motion-pulse-dot" />
            <span>Studio: <strong>Video Reference & Motion Transfer</strong></span>
          </div>
        )}
      </div>
    </header>
  )
}
