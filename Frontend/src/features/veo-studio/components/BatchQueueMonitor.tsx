import React from 'react'
import { Play, Pause, Square, Sparkles, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import type { BatchSceneItem, VeoProject } from '../types'

interface Props {
  scenes: BatchSceneItem[]
  concurrency: number
  isRunning: boolean
  isPaused: boolean
  creditPerScene: number
  activeWorkers: { workerId: number; sceneNumber?: number; step?: string }[]
  activeProject?: VeoProject | null
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onStop: () => void
  disabled?: boolean
}

export function BatchQueueMonitor({
  scenes,
  concurrency,
  isRunning,
  isPaused,
  creditPerScene,
  activeWorkers,
  activeProject,
  onStart,
  onPause,
  onResume,
  onStop,
  disabled,
}: Props) {
  const total = scenes.length
  const completed = scenes.filter((s) => s.status === 'done').length
  const errors = scenes.filter((s) => s.status === 'error').length
  const running = scenes.filter((s) => s.status === 'running').length
  const percent = total > 0 ? Math.round((completed / total) * 100) : 0

  const totalCredits = total * creditPerScene

  return (
    <div className="veo-batch-monitor">
      {/* Thanh tiến trình tổng quan */}
      <div className="veo-monitor-header">
        <div className="veo-monitor-stats">
          <div className="veo-stat-item">
            <span className="veo-stat-label">Tổng số</span>
            <strong className="veo-stat-val">{total}</strong>
          </div>
          <div className="veo-stat-item text-success">
            <span className="veo-stat-label">Đã xong</span>
            <strong className="veo-stat-val">{completed}</strong>
          </div>
          <div className="veo-stat-item text-primary">
            <span className="veo-stat-label">Đang chạy</span>
            <strong className="veo-stat-val">{running}</strong>
          </div>
          {errors > 0 && (
            <div className="veo-stat-item text-danger">
              <span className="veo-stat-label">Lỗi</span>
              <strong className="veo-stat-val">{errors}</strong>
            </div>
          )}
          <div className="veo-stat-item text-muted">
            <span className="veo-stat-label">Ước tính Credit</span>
            <strong className="veo-stat-val">{totalCredits} credits</strong>
          </div>
        </div>

        {/* Nút điều khiển */}
        <div className="veo-monitor-controls">
          {!isRunning ? (
            <button
              type="button"
              className="veo-start-batch-btn"
              onClick={onStart}
              disabled={disabled || total === 0 || !activeProject}
            >
              <Play size={15} />
              <span>
                {!activeProject
                  ? '⚠️ Chưa chọn Project'
                  : `Chạy kịch bản (${total} mục · ${concurrency} luồng)`}
              </span>
            </button>
          ) : (
            <div className="veo-running-actions">
              {isPaused ? (
                <button
                  type="button"
                  className="veo-ctrl-btn resume"
                  onClick={onResume}
                  title="Tiếp tục chạy hàng đợi"
                >
                  <Play size={15} /> Tiếp tục
                </button>
              ) : (
                <button
                  type="button"
                  className="veo-ctrl-btn pause"
                  onClick={onPause}
                  title="Tạm dừng lấy cảnh mới"
                >
                  <Pause size={15} /> Tạm dừng
                </button>
              )}
              <button
                type="button"
                className="veo-ctrl-btn stop"
                onClick={onStop}
                title="Hủy hàng đợi"
              >
                <Square size={15} /> Dừng lại
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Progress Bar */}
      <div className="veo-progress-wrapper">
        <div className="veo-progress-bar-bg">
          <div
            className="veo-progress-bar-fill"
            style={{ width: `${percent}%` }}
          />
        </div>
        <div className="veo-progress-info">
          <span>{percent}% hoàn tất ({completed}/{total} cảnh)</span>
          {isRunning && (
            <span className="veo-running-badge">
              <Loader2 size={12} className="spin" /> Đang chạy song song {concurrency} luồng
            </span>
          )}
        </div>
      </div>

      {/* Hiển thị các Worker Slot (Trực quan hóa luồng song song) */}
      {isRunning && (
        <div className="veo-workers-grid">
          {Array.from({ length: concurrency }).map((_, idx) => {
            const workerId = idx + 1
            const worker = activeWorkers.find((w) => w.workerId === workerId)
            const isBusy = !!worker?.sceneNumber

            return (
              <div
                key={workerId}
                className={`veo-worker-slot ${isBusy ? 'busy' : 'idle'}`}
              >
                <div className="veo-worker-slot-head">
                  <span className="veo-worker-tag">Luồng #{workerId}</span>
                  <span className={`veo-worker-dot ${isBusy ? 'active' : ''}`} />
                </div>
                <div className="veo-worker-slot-body">
                  {isBusy ? (
                    <>
                      <strong>Cảnh #{worker.sceneNumber}</strong>
                      <small>{worker.step || 'Đang xử lý...'}</small>
                    </>
                  ) : (
                    <small className="text-muted">Đang chờ việc...</small>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Hiển thị các cảnh đang chờ trong hàng đợi */}
      {isRunning && scenes.some((s) => s.status === 'queued') && (
        <div style={{ marginTop: '10px', fontSize: '11.5px', color: '#b45309', background: '#fffbeb', padding: '8px 12px', borderRadius: '6px', border: '1px solid #fde68a', display: 'flex', alignItems: 'center', gap: '6px' }}>
          <span>⏳ <strong>Hàng đợi tiếp theo:</strong></span>
          <span>
            {scenes.filter((s) => s.status === 'queued').map((s) => `Cảnh #${s.sceneNumber}`).join(', ')} (sẽ tự động được cấp luồng ngay khi có cảnh hoàn tất)
          </span>
        </div>
      )}
    </div>
  )
}
