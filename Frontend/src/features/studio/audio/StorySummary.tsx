import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import { parseSummary } from './audioModel'

interface SummaryState {
  status: 'none' | 'queued' | 'running' | 'done' | 'error'
  summary?: string
  message?: string
  error?: string
  chapters_count?: number
  current_chapters?: number
  stale?: boolean
  truncated?: boolean
  updated_at?: string | null
}

interface StorySummaryProps {
  slug: string
  totalChapters: number
  /** Gọi khi một bản tóm tắt vừa được lưu xong (để danh sách truyện hiện dấu "đã có tóm tắt"). */
  onSaved: (slug: string) => void
}

function formatDate(iso?: string | null): string {
  if (!iso) return ''
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleDateString('vi-VN')
}

/** Tóm tắt cốt truyện bằng Gemini: tạo MỘT lần, lưu lại, lần sau chỉ đọc. Chỉ để người dùng hiểu truyện nói về gì. */
export function StorySummary({ slug, totalChapters, onSaved }: StorySummaryProps) {
  const [state, setState] = useState<SummaryState | null>(null)
  const [requestError, setRequestError] = useState('')
  const wasRunning = useRef(false)

  const load = useCallback(async () => {
    const response = await fetch(`${API_URL}/api/stories/${encodeURIComponent(slug)}/summary`)
    if (!response.ok) throw new Error(String(response.status))
    const data: SummaryState = await response.json()
    setState(data)
    return data
  }, [slug])

  useEffect(() => {
    let alive = true
    load().catch(() => alive && setRequestError('Không tải được bản tóm tắt.'))
    return () => { alive = false }
  }, [load])

  // Đang tạo → hỏi lại mỗi 2 giây cho tới khi xong/lỗi.
  const active = state?.status === 'queued' || state?.status === 'running'
  useEffect(() => {
    if (!active) return
    wasRunning.current = true
    const timer = window.setInterval(() => { load().catch(() => {}) }, 2000)
    return () => window.clearInterval(timer)
  }, [active, load])

  useEffect(() => {
    if (state?.status === 'done' && wasRunning.current) { wasRunning.current = false; onSaved(slug) }
  }, [state?.status, slug, onSaved])

  async function generate(force: boolean) {
    setRequestError('')
    try {
      const response = await fetch(`${API_URL}/api/stories/${encodeURIComponent(slug)}/summary`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force }),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || `Lỗi ${response.status}`)
      setState(data)
    } catch (error) {
      setRequestError(error instanceof Error ? error.message : 'Không thể bắt đầu tóm tắt.')
    }
  }

  if (!state) return <div className="aw-empty">{requestError ? <span className="aw-warn">{requestError}</span> : <><Loader2 size={16} className="spin" /> Đang tải…</>}</div>

  if (active) {
    return (
      <div className="aw-empty aw-summary-wait">
        <Loader2 size={18} className="spin" />
        <div>
          <strong>Gemini đang đọc truyện…</strong>
          <p>{state.message || 'Đang xử lý.'} Bạn có thể xem chương khác trong lúc chờ.</p>
        </div>
      </div>
    )
  }

  if (state.status === 'done' && state.summary) {
    const blocks = parseSummary(state.summary)
    return (
      <div className="aw-summary">
        <div className="aw-summary-text">
          {blocks.map((block, index) =>
            block.type === 'heading' ? <h4 key={index}>{block.text}</h4>
              : block.type === 'bullet' ? <p key={index} className="bullet">{block.text}</p>
                : <p key={index}>{block.text}</p>)}
        </div>
        <div className="aw-summary-foot">
          <span>
            Gemini tóm tắt từ {state.chapters_count} chương{state.updated_at ? ` · ${formatDate(state.updated_at)}` : ''}
            {state.truncated && ' · đã cắt bớt phần cuối mỗi chương vì quá dài'}
          </span>
          {state.stale && <em className="aw-warn"><AlertTriangle size={12} /> Truyện đã có {state.current_chapters} chương — tạo lại để cập nhật</em>}
          <button type="button" className="aw-link" onClick={() => { if (window.confirm('Gửi lại toàn bộ truyện cho Gemini để viết bản tóm tắt mới? Bản cũ sẽ bị thay thế.')) generate(true) }}>
            <RefreshCw size={12} /> Tạo lại
          </button>
        </div>
        {requestError && <div className="aw-warn">{requestError}</div>}
      </div>
    )
  }

  return (
    <div className="aw-empty aw-summary-start">
      <Sparkles size={20} />
      <div>
        <strong>{state.status === 'error' ? 'Tạo tóm tắt không thành công' : 'Chưa có tóm tắt cốt truyện'}</strong>
        {state.status === 'error'
          ? <p className="aw-warn">{state.error}</p>
          : <p>Gemini sẽ đọc toàn bộ {totalChapters} chương của truyện này và viết lại cốt truyện để bạn nắm nội dung. Mất khoảng 1–3 phút, chỉ làm một lần và được lưu lại.</p>}
        {requestError && <p className="aw-warn">{requestError}</p>}
        <button type="button" className="aw-ghost" onClick={() => generate(false)} disabled={totalChapters === 0}>
          <Sparkles size={14} /> {state.status === 'error' ? 'Thử lại' : 'Tóm tắt bằng Gemini'}
        </button>
      </div>
    </div>
  )
}
