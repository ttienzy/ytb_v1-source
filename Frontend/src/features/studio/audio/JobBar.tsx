import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, MinusCircle, X } from 'lucide-react'
import { DEFAULT_STEPS, stepState, type JobStep } from './audioModel'

export interface AudioJob {
  job_id: string
  status: string
  step?: string
  progress?: number
  message?: string
  error?: string
  /** Danh sách bước do backend gửi (khớp pipeline đang chạy). */
  steps?: JobStep[]
  current_story?: string
  /** "FULL", "Tập 2", "Chương 3"… của video đang làm. */
  current_label?: string
  video_index?: number
  total_videos?: number
  completed_videos?: number
  failed_chapters?: Array<{ story_name: string; chapter_number?: number | null; label?: string; error: string }>
  warnings?: string[]
  skipped_steps?: string[]
}

interface JobBarProps {
  job: AudioJob
  onDismiss: () => void
}

/** Thanh tiến trình một hàng: video đang làm, các bước của video đó, lỗi từng video. */
export function JobBar({ job, onDismiss }: JobBarProps) {
  const steps = job.steps?.length ? job.steps : DEFAULT_STEPS
  const running = job.status === 'queued' || job.status === 'running'
  const total = job.total_videos ?? 0
  const failed = job.failed_chapters ?? []
  const warnings = job.warnings ?? []
  const tone = job.status === 'error' ? 'error' : job.status === 'completed' ? (failed.length ? 'warn' : 'ok') : 'run'
  const current = [job.current_story, job.current_label].filter(Boolean).join(' · ')

  return (
    <div className={`aw-card aw-job ${tone}`} role="status">
      <div className="aw-job-top">
        <div className="aw-job-title">
          {running ? <Loader2 size={16} className="spin" /> : job.status === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <strong>
            {running ? (current ? `Đang làm ${current}` : 'Đang xử lý') : job.status === 'error' ? 'Workflow gặp lỗi' : 'Workflow hoàn tất'}
          </strong>
          {total > 1 && (
            <span className="aw-job-count">
              {running && job.video_index ? `video ${job.video_index}/${total} · ` : ''}xong {job.completed_videos ?? 0}/{total}{failed.length ? ` · ${failed.length} lỗi` : ''}
            </span>
          )}
        </div>
        {!running && (
          <button type="button" className="aw-icon-btn" onClick={onDismiss} aria-label="Ẩn thông báo" title="Ẩn">
            <X size={15} />
          </button>
        )}
      </div>

      <ol className="aw-steps">
        {steps.map(step => {
          const state = stepState(job, step.key, steps)
          return (
            <li key={step.key} className={state}>
              {state === 'done' ? <CheckCircle2 size={13} /> : state === 'error' ? <AlertCircle size={13} /> : state === 'running' ? <Loader2 size={13} className="spin" /> : state === 'skipped' ? <MinusCircle size={13} /> : <i />}
              {step.title}
            </li>
          )
        })}
      </ol>

      <div className="aw-progress" aria-hidden><i style={{ width: `${Math.max(0, Math.min(100, job.progress ?? 0))}%` }} /></div>

      {job.status === 'error' && job.error ? <p className="aw-job-msg error">{job.error}</p> : job.message ? <p className="aw-job-msg">{job.message}</p> : null}

      {warnings.length > 0 && (
        <ul className="aw-job-warnings">
          {warnings.map(text => <li key={text}><AlertTriangle size={12} /> {text}</li>)}
        </ul>
      )}

      {failed.length > 0 && (
        <details className="aw-job-failed" open={!running}>
          <summary>{failed.length} video lỗi — chương của chúng vẫn nằm trong hàng đợi, bấm Bắt đầu để làm lại (giọng đã đọc xong được dùng lại)</summary>
          <ul>
            {failed.map(item => {
              const label = item.label ?? (item.chapter_number ? `chương ${item.chapter_number}` : '')
              return <li key={`${item.story_name}-${label}`}><strong>{item.story_name}{label ? ` · ${label}` : ''}:</strong> {item.error}</li>
            })}
          </ul>
        </details>
      )}
    </div>
  )
}
