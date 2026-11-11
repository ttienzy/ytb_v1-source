import { useCallback } from 'react'
import { AlertTriangle, Check, Loader2, RefreshCw, Sparkles } from 'lucide-react'
import { artifactUrl, decideGate, reroll } from '../services/campaignApi.ts'
import { describeElement, describeGate, errorMessage, progressText, reasonText } from '../services/campaignView.ts'
import type { CampaignState } from '../types.ts'
import { Badge } from './Common.tsx'

interface Props {
  campaignId: string
  state: CampaignState
  busy: boolean
  onChanged: () => Promise<void>
  onRun: (target: string, elements?: string[]) => Promise<void>
  onError: (message: string) => void
  onPreview: (src: string) => void
}

/** Khung mẫu: một ảnh chốt khuôn mặt, áo, bối cảnh và ánh sáng. Mọi storyboard và clip tham chiếu ảnh này nên các shot trông như cùng một buổi quay. */
export function AnchorPanel({ campaignId, state, busy, onChanged, onRun, onError, onPreview }: Props) {
  const steps = state.blocks.flatMap(b => b.steps)
  const el = steps.find(s => s.key === 'anchor_frame')?.elements[0]
  const lookApproved = steps.find(s => s.key === 'look')?.elements[0]?.gate === 'approved'
  const running = !!state.active_exec || !!el?.active_run
  const guard = useCallback(async (fn: () => Promise<unknown>) => {
    try { await fn(); await onChanged() } catch (e) { onError(errorMessage(e)) }
  }, [onChanged, onError])
  const imageId = el?.selected_artifact_id ?? null
  const gate = describeGate(el?.gate ?? null)
  const blocked = (el?.blockers.length ?? 0) > 0
  const approved = el?.gate === 'approved'

  return (
    <section className="cp-card" data-testid="anchor-panel">
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>Khung mẫu bối cảnh</h3>
          <span className="cp-head-sub">Chốt mặt, áo, nơi quay, ánh sáng · ảnh tham chiếu số 1 của clip</span>
        </div>
      </header>
      <div className="cp-row">
        {el && <Badge badge={describeElement(el)} />}
        {gate && <Badge badge={gate} />}
      </div>

      {blocked && <p className="cp-warn"><AlertTriangle size={13} /> {lookApproved ? '' : 'Duyệt ảnh mẫu bên trái trước. '}Chưa đủ đầu vào: {el!.blockers.map(b => `${b.dep}: ${b.reason}`).join('; ')}</p>}
      {el?.last_run?.state === 'error' && <p className="cp-error-inline">Lỗi: {el.last_run.error}</p>}
      {el?.state === 'stale' && el.reasons.length > 0 && <p className="cp-note">Đổi: {el.reasons.map(reasonText).join(', ')}.</p>}

      <div className="cp-anchor">
        {imageId
          ? <button type="button" className="cp-anchor-img" onClick={() => onPreview(artifactUrl(imageId))} title="Xem lớn"><img src={artifactUrl(imageId)} alt="Khung mẫu" loading="lazy" /></button>
          : <div className="cp-placeholder cp-anchor-img">{el?.active_run ? <><Loader2 size={18} className="spinning" /> {progressText(el.progress)}</> : 'Chưa có khung mẫu'}</div>}
      </div>

      <div className="cp-row">
        {!imageId ? (
          <button type="button" className="btn-p cp-small" disabled={busy || running || blocked} onClick={() => void onRun('anchor_frame')}><Sparkles size={13} /> Tạo khung mẫu</button>
        ) : (
          <>
            <button type="button" className="btn-p cp-small" disabled={busy || running || approved}
                    onClick={() => void guard(() => decideGate(campaignId, 'anchor_frame', 'approve', {}))}>
              <Check size={13} /> {approved ? 'Đã duyệt' : 'Duyệt'}
            </button>
            <button type="button" className="btn-g cp-small" disabled={busy || running || blocked}
                    onClick={() => void guard(async () => { await reroll(campaignId, 'anchor_frame'); await onRun('anchor_frame') })}>
              <RefreshCw size={13} /> Tạo lại
            </button>
          </>
        )}
      </div>
      <p className="cp-note">1 lượt ảnh ChatGPT, 0 credit Flow. Nơi quay lấy từ “Bối cảnh chung” ở khối 2.</p>
    </section>
  )
}
