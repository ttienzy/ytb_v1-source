import { resolveRun } from '../services/campaignApi.ts'
import { errorMessage, formatTime, runStateBadge } from '../services/campaignView.ts'
import type { RunView } from '../types.ts'
import { Badge } from './Common.tsx'

interface Props {
  runs: RunView[]
  onChanged: () => Promise<void>
  onError: (message: string) => void
}

/** Sổ chạy: mỗi lần engine thật sự gọi AI/Flow. "Dùng lại" = lấy kết quả có sẵn, không tốn gì. */
export function RunsPanel({ runs, onChanged, onError }: Props) {
  if (runs.length === 0) return null
  const resolve = async (id: string) => {
    if (!window.confirm('Xác nhận lần chạy này CHƯA gửi lên Flow? Sau đó bạn có thể chạy lại.')) return
    try { await resolveRun(id); await onChanged() } catch (e) { onError(errorMessage(e)) }
  }
  return (
    <section className="cp-card">
      <header className="cp-card-head"><h3>Sổ chạy</h3></header>
      <table className="cp-table">
        <thead>
          <tr><th>Giờ</th><th>Bước</th><th>Trạng thái</th><th>Credit</th><th>Ghi chú</th></tr>
        </thead>
        <tbody>
          {runs.slice(0, 15).map(r => (
            <tr key={r.id}>
              <td>{formatTime(r.finished_at || r.created_at)}</td>
              <td>{r.step_key}{r.element_key ? ` · ${r.element_key}` : ''}{r.attempt > 1 ? ` (lần ${r.attempt})` : ''}</td>
              <td><Badge badge={runStateBadge(r.state)} /></td>
              <td>{r.credit_actual ?? r.credit_est ?? 0}</td>
              <td className="cp-run-note">
                {r.error}
                {r.state === 'unknown' && (
                  <button type="button" className="btn-g cp-small" onClick={() => void resolve(r.id)}>Xác nhận chưa gửi</button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  )
}
