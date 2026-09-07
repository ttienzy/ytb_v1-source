import { useState } from 'react'
import {
  Loader2,
  CheckCircle2,
  AlertCircle,
  X,
  Play,
  Sparkles,
  Video,
  ChevronDown,
  ChevronUp,
  Image as ImageIcon,
  Check,
} from 'lucide-react'
import type { StudioTask, VeoJobOut, VeoImageItem } from '../types'

interface Props {
  tasks: StudioTask[]
  onRemoveTask: (taskId: string) => void
  onPreviewJob?: (job: VeoJobOut) => void
  onPreviewImage?: (image: VeoImageItem) => void
}

export function StudioTaskToastDock({
  tasks,
  onRemoveTask,
  onPreviewJob,
  onPreviewImage,
}: Props) {
  const [minimized, setMinimized] = useState(false)

  if (tasks.length === 0) return null

  const activeCount = tasks.filter(
    (t) => t.status !== 'completed' && t.status !== 'error',
  ).length
  const completedCount = tasks.filter((t) => t.status === 'completed').length

  const handleClearCompleted = () => {
    tasks
      .filter((t) => t.status === 'completed' || t.status === 'error')
      .forEach((t) => onRemoveTask(t.id))
  }

  return (
    <aside className="veo-toast-dock" aria-label="Bảng tiến trình tác vụ chạy ngầm">
      {/* Dock Control Bar */}
      <div className="veo-toast-dock-header">
        <div className="veo-toast-dock-status">
          {activeCount > 0 ? (
            <span className="veo-dock-pulse-dot" />
          ) : (
            <Check size={14} color="#10b981" />
          )}
          <span className="veo-toast-dock-title">
            {activeCount > 0
              ? `${activeCount} tác vụ đang chạy...`
              : 'Tất cả tác vụ đã hoàn tất'}
          </span>
          {completedCount > 0 && (
            <span className="veo-dock-done-tag">+{completedCount} xong</span>
          )}
        </div>

        <div className="veo-toast-dock-actions">
          {completedCount > 0 && (
            <button
              type="button"
              className="veo-dock-clear-btn"
              onClick={handleClearCompleted}
              title="Xóa các tác vụ đã hoàn tất"
            >
              Xóa đã xong
            </button>
          )}
          <button
            type="button"
            className="veo-dock-min-btn"
            onClick={() => setMinimized((prev) => !prev)}
            title={minimized ? 'Mở rộng' : 'Thu gọn'}
          >
            {minimized ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
          </button>
        </div>
      </div>

      {/* Toasts List (hidden when minimized) */}
      {!minimized && (
        <div className="veo-toast-dock-body">
          {tasks.map((task) => {
            const isCompleted = task.status === 'completed'
            const isError = task.status === 'error'
            const isVideo = task.type === 'video'

            let progressPct: number | null = null
            if (task.total && task.total > 0) {
              progressPct = Math.round(((task.completedCount || 0) / task.total) * 100)
            }

            return (
              <div
                key={task.id}
                className={`veo-task-toast ${isVideo ? 'type-video' : 'type-image'} ${
                  isCompleted ? 'completed' : isError ? 'error' : 'running'
                }`}
              >
                {/* Header row */}
                <div className="veo-toast-top">
                  <div className="veo-toast-tags">
                    <span className={`veo-toast-type-tag ${isVideo ? 'video' : 'image'}`}>
                      {isVideo ? <Video size={11} /> : <Sparkles size={11} />}
                      <span>{isVideo ? 'Video' : 'Ảnh'}</span>
                    </span>

                    {task.modeLabel && (
                      <span className="veo-toast-meta-tag mode">{task.modeLabel}</span>
                    )}
                    <span className="veo-toast-meta-tag model">{task.modelName}</span>
                    <span className="veo-toast-meta-tag">{task.aspectRatio}</span>
                    {task.duration && (
                      <span className="veo-toast-meta-tag">{task.duration}s</span>
                    )}
                  </div>

                  <button
                    type="button"
                    className="veo-toast-close"
                    onClick={() => onRemoveTask(task.id)}
                    title="Đóng thông báo"
                  >
                    <X size={13} />
                  </button>
                </div>

                {/* Prompt preview */}
                <p className="veo-toast-prompt" title={task.prompt}>
                  "{task.prompt}"
                </p>

                {/* Status message and Action */}
                <div className="veo-toast-status-row">
                  <div className={`veo-toast-status-msg ${task.status}`}>
                    {!isCompleted && !isError && (
                      <Loader2 size={13} className="veo-spin" />
                    )}
                    {isCompleted && <CheckCircle2 size={13} color="#10b981" />}
                    {isError && <AlertCircle size={13} color="#ef4444" />}
                    <span>{task.statusText}</span>
                    {task.error && (
                      <span className="veo-toast-error-detail">
                        ({task.error})
                      </span>
                    )}
                  </div>

                  {isCompleted && isVideo && task.jobOut && onPreviewJob && (
                    <button
                      type="button"
                      className="veo-toast-action-btn video"
                      onClick={() => onPreviewJob(task.jobOut!)}
                    >
                      <Play size={11} fill="currentColor" />
                      <span>Xem video</span>
                    </button>
                  )}

                  {isCompleted && !isVideo && task.imageItems && task.imageItems.length > 0 && onPreviewImage && (
                    <button
                      type="button"
                      className="veo-toast-action-btn image"
                      onClick={() => onPreviewImage(task.imageItems![0])}
                    >
                      <ImageIcon size={11} />
                      <span>Xem ảnh</span>
                    </button>
                  )}
                </div>

                {/* Progress bar */}
                <div className="veo-toast-bar-track">
                  <div
                    className={`veo-toast-bar-fill ${
                      isCompleted
                        ? 'completed'
                        : isError
                          ? 'error'
                          : progressPct != null
                            ? 'determinate'
                            : 'indeterminate'
                    }`}
                    style={progressPct != null ? { width: `${progressPct}%` } : undefined}
                  />
                </div>
              </div>
            )
          })}
        </div>
      )}
    </aside>
  )
}
