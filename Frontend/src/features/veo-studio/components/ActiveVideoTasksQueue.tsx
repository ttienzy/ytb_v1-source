import { Loader2, CheckCircle2, AlertCircle, X, Play } from 'lucide-react'
import type { VideoTask, VeoJobOut } from '../types'

interface Props {
  tasks: VideoTask[]
  onRemoveTask: (taskId: string) => void
  onPreviewJob?: (job: VeoJobOut) => void
}

export function ActiveVideoTasksQueue({ tasks, onRemoveTask, onPreviewJob }: Props) {
  if (tasks.length === 0) return null

  return (
    <div className="veo-image-tasks-container veo-video-tasks-container">
      {tasks.map((task) => {
        const isCompleted = task.status === 'completed'
        const isError = task.status === 'error'

        return (
          <div
            key={task.id}
            className={`veo-image-task-card ${isCompleted ? 'completed' : isError ? 'error' : ''}`}
          >
            <div className="veo-image-task-header">
              <div className="veo-image-task-info">
                <span className="veo-image-task-prompt" title={task.prompt}>
                  "{task.prompt}"
                </span>
                <div className="veo-image-task-meta">
                  {task.modeLabel && (
                    <span className="veo-image-task-badge" style={{ background: '#e0f2fe', color: '#0369a1' }}>
                      {task.modeLabel}
                    </span>
                  )}
                  <span className="veo-image-task-badge model">{task.modelName}</span>
                  <span className="veo-image-task-badge">{task.aspectRatio}</span>
                  <span className="veo-image-task-badge">{task.duration}s</span>
                </div>
              </div>
              <button
                type="button"
                className="veo-image-task-close"
                onClick={() => onRemoveTask(task.id)}
                title="Đóng tiến trình này"
              >
                <X size={14} />
              </button>
            </div>

            <div className="veo-image-task-body">
              <div className={`veo-image-task-status ${task.status}`}>
                {!isCompleted && !isError && <Loader2 size={13} className="veo-spin" />}
                {isCompleted && <CheckCircle2 size={13} />}
                {isError && <AlertCircle size={13} />}
                <span>{task.statusText}</span>
                {task.error && <span style={{ color: '#ef4444', marginLeft: 4 }}>({task.error})</span>}
              </div>

              {isCompleted && task.jobOut && onPreviewJob && (
                <button
                  type="button"
                  className="veo-task-preview-btn"
                  onClick={() => onPreviewJob(task.jobOut!)}
                >
                  <Play size={11} fill="currentColor" />
                  <span>Xem video</span>
                </button>
              )}
            </div>

            <div className="veo-image-task-bar-wrap">
              <div
                className={`veo-image-task-bar ${
                  isCompleted ? 'completed' : isError ? 'error' : 'indeterminate'
                }`}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}
