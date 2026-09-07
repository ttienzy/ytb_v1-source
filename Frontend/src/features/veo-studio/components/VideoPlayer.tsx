import { CheckCircle2, Circle, Loader2, XCircle } from 'lucide-react'
import type { VeoJobOut } from '../types'
import { getVideoStreamUrl } from '../services/veoApi'

interface Props {
  activeJob: VeoJobOut | null
  onClose: () => void
}

const STEP_LABELS: Record<string, string> = {
  pending: 'Đang chờ',
  captcha: 'Giải reCAPTCHA',
  submitting: 'Gửi lệnh Flow',
  generating: 'Đang render',
  downloading: 'Tải MP4',
  done: 'Hoàn tất',
  error: 'Lỗi',
}

const STEP_ORDER = ['pending', 'captcha', 'submitting', 'generating', 'downloading', 'done']

export function VideoPlayer({ activeJob, onClose }: Props) {
  if (!activeJob) {
    return (
      <div className="veo-player-empty">
        <div className="veo-player-placeholder">
          <span>🎬</span>
          <p>Chọn một video từ gallery hoặc tạo video mới để xem trước tại đây</p>
        </div>
      </div>
    )
  }

  const isDone = activeJob.status === 'done'
  const isError = activeJob.status === 'error'
  const isProcessing = !isDone && !isError
  const currentIdx = STEP_ORDER.indexOf(activeJob.status)

  return (
    <div className="veo-player">
      {/* Video preview */}
      <div className={`veo-player-screen ${activeJob.aspect_ratio === '9:16' ? 'portrait' : ''}`}>
        {isDone && ((activeJob.output_files && activeJob.output_files.length > 0) || activeJob.job_id) ? (
          <video
            controls
            autoPlay
            src={getVideoStreamUrl(activeJob.output_files?.[0] || activeJob.job_id)}
            className="veo-player-video"
          />
        ) : (
          <div className="veo-player-generating">
            {isProcessing && <Loader2 size={40} className="spinning" />}
            {isError && <XCircle size={40} className="veo-red" />}
            <p>{activeJob.current_step}</p>
          </div>
        )}
      </div>

      {/* Step tracker */}
      <div className="veo-step-tracker">
        {STEP_ORDER.slice(0, -1).map((step, i) => {
          const isComplete = currentIdx > i
          const isCurrent = currentIdx === i
          const isErr = isError && isCurrent
          return (
            <div
              key={step}
              className={`veo-step ${isComplete ? 'complete' : ''} ${isCurrent ? 'current' : ''} ${isErr ? 'error' : ''}`}
            >
              {isComplete ? (
                <CheckCircle2 size={16} />
              ) : isCurrent ? (
                isErr ? <XCircle size={16} /> : <Loader2 size={16} className="spinning" />
              ) : (
                <Circle size={16} />
              )}
              <span>{STEP_LABELS[step]}</span>
            </div>
          )
        })}
      </div>

      {/* Error message */}
      {isError && activeJob.error_message && (
        <div className="veo-error-box">
          <XCircle size={14} />
          <span>{activeJob.error_message}</span>
        </div>
      )}

      {/* Job info */}
      <div className="veo-job-info">
        <span>Job: {activeJob.job_id}</span>
        <span>Model: {activeJob.model_display_name}</span>
        <span>{activeJob.aspect_ratio} · {activeJob.duration_seconds}s · {activeJob.resolution}</span>
      </div>
    </div>
  )
}
