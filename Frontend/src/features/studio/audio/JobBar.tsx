import { AlertCircle, CheckCircle2, Loader2, MinusCircle, X } from 'lucide-react'
import { audioSteps, stepState } from './audioModel'

export interface AudioJob {
  job_id: string
  status: string
  step?: string
  progress?: number
  message?: string
  error?: string
  current_story?: string
  current_chapter?: number
  total_chapters?: number
  completed_chapters?: number
  failed_chapters?: Array<{ story_name: string; chapter_number: number; error: string }>
  skipped_steps?: string[]
}

interface JobBarProps {
  job: AudioJob
  bgm: boolean
  drive: boolean
  /** Có lớp phủ nào bật không (thêm bước "Lớp phủ"). */
  overlay?: boolean
  onDismiss: () => void
}

/** Thanh tiến trình một hàng: thay cho sơ đồ dọc 7–8 khối chiếm cả màn hình. */
export function JobBar({ job, bgm, drive, overlay, onDismiss }: JobBarProps) {
  const steps = audioSteps({ bgm, drive, overlay })
  const running = job.status === 'queued' || job.status === 'running'
  const total = job.total_chapters ?? 0
  const failed = job.failed_chapters ?? []
  const tone = job.status === 'error' ? 'error' : job.status === 'completed' ? (failed.length ? 'warn' : 'ok') : 'run'

  return (
    <div className={`aw-card aw-job ${tone}`} role="status">
      <div className="aw-job-top">
        <div className="aw-job-title">
          {running ? <Loader2 size={16} className="spin" /> : job.status === 'error' ? <AlertCircle size={16} /> : <CheckCircle2 size={16} />}
          <strong>
            {running
              ? total > 1
                ? `Đang xử lý ${job.current_story ? `${job.current_story} · ` : ''}chương ${job.current_chapter ?? ''}`
                : 'Đang xử lý'
              : job.status === 'error'
                ? 'Workflow gặp lỗi'
                : 'Workflow hoàn tất'}
          </strong>
          {total > 1 && (
            <span className="aw-job-count">
              {job.completed_chapters ?? 0}/{total} chương{failed.length ? ` · ${failed.length} lỗi` : ''}
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

      {failed.length > 0 && (
        <details className="aw-job-failed" open={!running}>
          <summary>{failed.length} chương lỗi — chạy lại sẽ làm tiếp các chương này</summary>
          <ul>
            {failed.map(item => (
              <li key={`${item.story_name}-${item.chapter_number}`}><strong>{item.story_name} · chương {item.chapter_number}:</strong> {item.error}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  )
}
