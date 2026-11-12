import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Copy, Loader2, RefreshCw, Sparkles, Square, ThumbsDown } from 'lucide-react'
import {
  artifactUrl, cancelRun, decideGate, planRun, previewStepPrompt, reroll, selectArtifact, setParams,
} from '../services/campaignApi.ts'
import { describeElement, describeGate, errorMessage, planSummary, progressText, reasonText } from '../services/campaignView.ts'
import type { ArtifactView, CampaignState, Plan, PromptPreview } from '../types.ts'
import { Badge, Fold } from './Common.tsx'
import { PromptEditor } from './PromptEditor.tsx'
import { HelpHint } from '../../help/components/HelpHint'

interface Props {
  campaignId: string
  state: CampaignState
  artifacts: ArtifactView[]
  busy: boolean
  onChanged: () => Promise<void>
  onRun: (target: string) => Promise<void>
  onError: (message: string) => void
  onPreview: (src: string) => void
}

const SLOT_TITLE: Record<string, string> = { identity: 'Nhân dạng (ảnh nhân vật)', outfit: 'Trang phục (ảnh áo)' }

/** Khối 4: look sheet từ ảnh nhân vật + ảnh áo. Xem lớn một ứng viên, so bằng dải ảnh nhỏ, duyệt/từ chối ngay cạnh ảnh. */
export function LookPanel({ campaignId, state, artifacts, busy, onChanged, onRun, onError, onPreview }: Props) {
  const steps = useMemo(() => state.blocks.flatMap(b => b.steps), [state])
  const step = steps.find(s => s.key === 'look')
  const element = step?.elements[0]
  const params = step?.params ?? {}
  const running = !!state.active_exec || !!element?.active_run

  const [preview, setPreview] = useState<PromptPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [note, setNote] = useState('')
  const [copied, setCopied] = useState(false)
  const [viewId, setViewId] = useState<string | null>(null)

  const inputKey = [
    steps.find(s => s.key === 'garment_source')?.elements[0]?.selected_artifact_id,
    steps.find(s => s.key === 'cast')?.elements[0]?.selected_artifact_id,
  ].join('|')
  const refreshKey = JSON.stringify([params, inputKey, element?.selected_artifact_id, element?.gate, element?.state])
  useEffect(() => {
    let alive = true
    if (element?.blockers.length) {            // thiếu đầu vào: không gọi mạng, báo luôn lý do
      setPreview(null)
      setPreviewError('Chưa đủ đầu vào: ' + element.blockers.map(b => `${b.dep}: ${b.reason}`).join('; '))
      setPlan(null)
      return
    }
    previewStepPrompt(campaignId, 'look')
      .then(p => { if (alive) { setPreview(p); setPreviewError('') } })
      .catch(e => { if (alive) { setPreview(null); setPreviewError(errorMessage(e)) } })
    planRun(campaignId, 'look')
      .then(p => { if (alive) setPlan(p) })
      .catch(() => { if (alive) setPlan(null) })
    return () => { alive = false }
  }, [campaignId, refreshKey])

  const candidates = useMemo(
    () => artifacts.filter(a => a.step_key === 'look' && a.kind === 'image')
      .sort((a, b) => b.created_at.localeCompare(a.created_at)),
    [artifacts],
  )
  const selectedId = element?.selected_artifact_id ?? null
  const shown = candidates.find(a => a.id === viewId) ?? candidates.find(a => a.id === selectedId) ?? candidates[0]
  const shownSelected = !!shown && shown.id === selectedId
  const shownApproved = shownSelected && element?.gate === 'approved'

  const guard = useCallback(async (fn: () => Promise<unknown>) => {
    try { await fn(); await onChanged() } catch (e) { onError(errorMessage(e)) }
  }, [onChanged, onError])

  const blocked = element?.state === 'blocked' && !selectedId
  const hasResult = !!selectedId
  const stale = element?.state === 'stale'
  const needsRun = element?.state === 'missing' || stale || (element?.state === 'blocked' && !!plan && plan.runnable > 0)
  const gateBadge = describeGate(element?.gate ?? null)
  const lastError = element?.last_run?.state === 'error' ? element.last_run.error : ''

  const generateNew = () => void guard(async () => {         // ảnh mới với cùng đầu vào = tăng nonce rồi chạy
    await reroll(campaignId, 'look')
    await onRun('look')
  })
  const copyPrompt = async () => {
    if (!preview) return
    try { await navigator.clipboard.writeText(preview.prompt); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* bỏ qua */ }
  }
  const reject = (artifactId: string) => void guard(async () => {
    await decideGate(campaignId, 'look', 'reject', { artifactId, note: note.trim() })
    setRejecting(false)
    setNote('')
  })

  return (
    <section className="cp-card" data-testid="look-panel">
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>Ảnh mẫu mặc áo (look sheet)<HelpHint hint="campaign.look" /></h3>
          <span className="cp-head-sub">Chân dung bên trái, áo xoay 3 góc bên phải. Mọi khối sau chỉ dùng ảnh đã duyệt.</span>
        </div>
        <div className="cp-head-actions">
          <Badge badge={describeElement(element)} />
          {gateBadge && <Badge badge={gateBadge} />}
          {running ? (
            <>
              <span className="cp-running"><Loader2 size={15} className="spinning" /> {progressText(element?.progress) || 'Đang tạo ảnh…'}</span>
              <button type="button" className="btn-g cp-small" onClick={() => void guard(() => cancelRun(campaignId))}><Square size={13} /> Hủy</button>
            </>
          ) : needsRun || !hasResult ? (
            <button type="button" className="btn-p cp-small" disabled={busy || blocked} onClick={() => void onRun('look')} title={planSummary(plan) || undefined}>
              <Sparkles size={14} /> {stale ? 'Tạo lại (đầu vào đã đổi)' : 'Tạo ảnh mẫu'}
            </button>
          ) : (
            <button type="button" className="btn-g cp-small" disabled={busy} onClick={generateNew} title={planSummary(plan) || undefined}>
              <RefreshCw size={14} /> Tạo ảnh khác
            </button>
          )}
        </div>
      </header>

      <div className="cp-toolbar">
        <label className="cp-label" htmlFor="look-count">Số ảnh mỗi lần tạo</label>
        <select id="look-count" value={Number(params.count || 1)} disabled={running}
                onChange={e => void guard(() => setParams(campaignId, 'look', { count: Number(e.target.value) }))}>
          {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
        </select>
        <span className="cp-note">Tỉ lệ {preview?.aspect ?? '16:9'} · mỗi ảnh khoảng 40–60 giây · {planSummary(plan) || 'đã có kết quả cho đầu vào hiện tại'}</span>
      </div>

      {blocked && <p className="cp-empty">Cần ảnh sản phẩm (khối 1) và ảnh nhân vật (khối 2) trước.</p>}
      {lastError && <p className="cp-error-inline">Lần chạy gần nhất lỗi: {lastError}</p>}
      {stale && <p className="cp-note">Đổi: {element!.reasons.map(reasonText).join(', ')}. Các khối sau vẫn dùng ảnh đã duyệt cho tới khi bạn duyệt ảnh mới.</p>}
      {preview && preview.warnings.length > 0 && (
        <div className="cp-riskline">{preview.warnings.map(w => <span key={w.code} className="cp-warn-chip"><AlertTriangle size={12} /> {w.message}</span>)}</div>
      )}

      {shown ? (
        <div className="cp-viewer">
          <div className="cp-viewer-stage">
            <button type="button" className="cp-viewer-img" onClick={() => onPreview(artifactUrl(shown.id))} title="Xem lớn">
              <img src={artifactUrl(shown.id)} alt="Look sheet đang xem" />
            </button>
            <div className="cp-viewer-bar">
              <span className="cp-viewer-label">
                {shownApproved ? <><Check size={13} /> Đã duyệt</> : shownSelected ? 'Đang chọn, chưa duyệt' : 'Ứng viên khác'}
                {shown.meta?.template?.name && <small> · {shown.meta.template.name} v{shown.meta.template.version}{shown.meta?.seconds ? ` · ${shown.meta.seconds}s` : ''}</small>}
              </span>
              {!shownSelected && (
                <button type="button" className="btn-g cp-small" disabled={busy || running} onClick={() => void guard(() => selectArtifact(campaignId, 'look', shown.id))}>Chọn ảnh này</button>
              )}
              <button type="button" className="btn-p cp-small" disabled={busy || running || shownApproved}
                      onClick={() => void guard(() => decideGate(campaignId, 'look', 'approve', { artifactId: shown.id }))}>
                <Check size={13} /> {shownApproved ? 'Đã duyệt' : 'Duyệt ảnh này'}
              </button>
              {shownSelected && (
                <button type="button" className="btn-g cp-small" disabled={busy || running} onClick={() => setRejecting(r => !r)}>
                  <ThumbsDown size={13} /> Từ chối
                </button>
              )}
            </div>
            {shown.meta?.warning && <p className="cp-warn"><AlertTriangle size={13} /> {shown.meta.warning}</p>}
            {rejecting && shownSelected && (
              <div className="cp-reject-inline">
                <input className="cp-input" value={note} onChange={e => setNote(e.target.value)} aria-label="Lý do từ chối"
                       placeholder="Lý do (vd: logo bị méo). Ghi chú sẽ gắn vào prompt lần tạo lại." />
                <button type="button" className="btn-p cp-small" onClick={() => reject(shown.id)}>Xác nhận từ chối</button>
              </div>
            )}
            {element?.gate === 'need_approval' && <p className="cp-note">Soi logo, chữ, tay áo và độ dài trước khi duyệt.</p>}
          </div>
          {candidates.length > 1 && (
            <ul className="cp-strip" aria-label={`Các ảnh đã tạo (${candidates.length})`}>
              {candidates.map(a => (
                <li key={a.id}>
                  <button type="button" className={`cp-strip-item ${a.id === shown.id ? 'is-viewing' : ''} ${a.id === selectedId ? 'is-chosen' : ''}`}
                          onClick={() => setViewId(a.id)} title={a.id === selectedId ? 'Ảnh đang chọn' : 'Xem ứng viên này'}>
                    <img src={artifactUrl(a.id)} alt="Ứng viên look sheet" loading="lazy" />
                    {a.id === selectedId && <span className="cp-strip-flag"><Check size={10} strokeWidth={3} /></span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : !blocked && (
        <div className="cp-placeholder cp-placeholder-wide">{running ? <Loader2 size={20} className="spinning" /> : 'Chưa có ảnh mẫu. Bấm “Tạo ảnh mẫu”.'}</div>
      )}

      <Fold title="Nâng cao: prompt và ảnh tham chiếu" className="cp-fold-quiet" testId="look-advanced"
            meta={preview ? `${preview.ref_order.length} ảnh tham chiếu · mẫu ${params.prompt?.template_id && params.prompt.template_id !== 'system:look_sheet' ? 'riêng' : 'mặc định'}` : previewError}>
        <PromptEditor campaignId={campaignId} stepKey="look" kind="look_sheet" defaultTemplateId="system:look_sheet"
                      prompt={params.prompt} onChanged={onChanged} onError={onError} />
        {previewError && <p className="cp-empty">{previewError}</p>}
        {preview && (
          <div className="cp-preview">
            <div className="cp-card-head">
              <h4>Prompt cuối cùng sẽ gửi</h4>
              <button type="button" className="btn-g cp-small" onClick={() => void copyPrompt()}>
                {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Đã chép' : 'Chép'}
              </button>
            </div>
            <div className="cp-refs">
              {preview.ref_order.map((r, i) => (
                <figure key={`${r.role}-${i}`}>
                  {r.artifact_id && (
                    <button type="button" onClick={() => onPreview(artifactUrl(r.artifact_id!))}><img src={artifactUrl(r.artifact_id)} alt={r.role} /></button>
                  )}
                  <figcaption><strong>{r.label || `Image ${i + 1}`}</strong> · {SLOT_TITLE[r.role] ?? r.role}</figcaption>
                </figure>
              ))}
            </div>
            <pre className="cp-pre">{preview.prompt}</pre>
            {preview.note && <p className="cp-note">Đã gắn ghi chú từ lần từ chối trước: “{preview.note}”.</p>}
          </div>
        )}
      </Fold>
    </section>
  )
}
