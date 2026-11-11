import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, RefreshCw, Sparkles, Square, ThumbsDown } from 'lucide-react'
import {
  artifactUrl, cancelRun, decideGate, fetchArtifactJson, planRun, previewStepPrompt, reroll, selectArtifact, setParams,
} from '../services/campaignApi.ts'
import { BOARD_LABEL, describeElement, describeGate, errorMessage, planSummary, progressText, reasonText, ROLE_LABEL, shotPanels } from '../services/campaignView.ts'
import type { ArtifactView, CampaignState, ElementState, Plan, ShotPlanDoc, StoryboardPreview } from '../types.ts'
import { Badge, Fold } from './Common.tsx'
import { PromptEditor } from './PromptEditor.tsx'

interface Props {
  campaignId: string
  state: CampaignState
  artifacts: ArtifactView[]
  busy: boolean
  onChanged: () => Promise<void>
  onRun: (target: string, elements?: string[]) => Promise<void>
  onError: (message: string) => void
  onPreview: (src: string) => void
}

const FRAMING_SHORT: Record<string, string> = { wide: 'Toàn', medium: 'Trung', closeup: 'Cận' }

/** Khối 5: mỗi shot một ảnh storyboard 2–4 khung. Danh sách shot bên trái, chi tiết shot đang chọn bên phải. */
export function StoryboardPanel({ campaignId, state, artifacts, busy, onChanged, onRun, onError, onPreview }: Props) {
  const steps = useMemo(() => state.blocks.flatMap(b => b.steps), [state])
  const step = steps.find(s => s.key === 'storyboard')
  const anchorEl = steps.find(s => s.key === 'anchor_frame')?.elements[0]
  const shotPlanEl = steps.find(s => s.key === 'shot_plan')?.elements[0]
  const params = step?.params ?? {}
  const elements: ElementState[] = (step?.elements ?? []).filter(e => e.element_key)
  const running = !!state.active_exec || elements.some(e => e.active_run)

  const [shots, setShots] = useState<ShotPlanDoc | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [selectedShot, setSelectedShot] = useState('')
  const [preview, setPreview] = useState<StoryboardPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [rejecting, setRejecting] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    const id = shotPlanEl?.selected_artifact_id
    if (!id) { setShots(null); return }
    fetchArtifactJson<ShotPlanDoc>(id).then(d => { if (alive) setShots(d) }).catch(() => { if (alive) setShots(null) })
    return () => { alive = false }
  }, [shotPlanEl?.selected_artifact_id])

  // Mặc định mở shot đầu tiên đang chờ duyệt, nếu không có thì shot đầu.
  const defaultKey = (elements.find(e => e.gate === 'need_approval') ?? elements[0])?.element_key ?? ''
  useEffect(() => { if (!selectedShot || !elements.some(e => e.element_key === selectedShot)) setSelectedShot(defaultKey) }, [defaultKey, elements, selectedShot])

  const blockers = elements.find(e => e.element_key === selectedShot)?.blockers ?? []
  const refreshKey = JSON.stringify([params, selectedShot, anchorEl?.selected_artifact_id, anchorEl?.gate, elements.map(e => e.state + e.gate), shotPlanEl?.selected_artifact_id])
  useEffect(() => {
    let alive = true
    planRun(campaignId, 'storyboard').then(p => { if (alive) setPlan(p) }).catch(() => { if (alive) setPlan(null) })
    if (!selectedShot || blockers.length) {
      setPreview(null)
      setPreviewError(blockers.length ? 'Chưa đủ đầu vào: ' + blockers.map(b => `${b.dep}: ${b.reason}`).join('; ') : '')
      return () => { alive = false }
    }
    previewStepPrompt<StoryboardPreview>(campaignId, 'storyboard', selectedShot)
      .then(p => { if (alive) { setPreview(p); setPreviewError('') } })
      .catch(e => { if (alive) { setPreview(null); setPreviewError(errorMessage(e)) } })
    return () => { alive = false }
  }, [campaignId, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const guard = useCallback(async (fn: () => Promise<unknown>) => {
    try { await fn(); await onChanged() } catch (e) { onError(errorMessage(e)) }
  }, [onChanged, onError])

  const historyOf = (key: string) => artifacts.filter(a => a.step_key === 'storyboard' && a.element_key === key && a.kind === 'image')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const anchorNotApproved = anchorEl?.gate !== 'approved'
  const needApproval = elements.filter(e => e.selected_artifact_id && e.gate !== 'approved')
  const needRun = elements.filter(e => e.state === 'missing' || e.state === 'stale')
  const approvedCount = elements.filter(e => e.gate === 'approved').length
  const firstKey = elements[0]?.element_key ?? ''
  // Vẽ thử một shot trước khi tốn lượt ảnh cho cả chiến dịch.
  const probeFirst = needRun.length > 1 && elements.every(e => !e.selected_artifact_id) && !!firstKey

  const regenerate = (key: string) => void guard(async () => { await reroll(campaignId, 'storyboard', key); await onRun('storyboard', [key]) })
  const reject = (key: string) => void guard(async () => {
    await decideGate(campaignId, 'storyboard', 'reject', { elementKey: key, note: note.trim() })
    setRejecting('')
    setNote('')
  })

  const el = elements.find(e => e.element_key === selectedShot)
  const info = shots?.items.find(s => s.key === selectedShot)
  const imageId = el?.selected_artifact_id ?? null
  const history = el ? historyOf(el.element_key) : []
  const idx = elements.findIndex(e => e.element_key === selectedShot)

  return (
    <section className="cp-card" data-testid="storyboard-panel">
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>Storyboard của từng shot</h3>
          <span className="cp-head-sub">Nhịp ở khối 3 vẽ thành một ảnh nhiều khung, giữ người và nơi quay theo khung mẫu khối 4. Bản duyệt là ảnh tham chiếu số 2 của clip.</span>
        </div>
        <div className="cp-head-actions">
          {running ? (
            <>
              <span className="cp-running"><Loader2 size={15} className="spinning" /> Đang vẽ… (mỗi shot khoảng 1 phút)</span>
              <button type="button" className="btn-g cp-small" onClick={() => void guard(() => cancelRun(campaignId))}><Square size={13} /> Hủy</button>
            </>
          ) : (
            <>
              {needApproval.length > 0 && (
                <button type="button" className="btn-g cp-small" disabled={busy}
                        onClick={() => void guard(async () => { for (const e of needApproval) await decideGate(campaignId, 'storyboard', 'approve', { elementKey: e.element_key }) })}>
                  <Check size={13} /> Duyệt tất cả ({needApproval.length})
                </button>
              )}
              {probeFirst && (
                <button type="button" className="btn-p cp-small" data-testid="sb-probe" disabled={busy || anchorNotApproved} onClick={() => void onRun('storyboard', [firstKey])}>
                  <Sparkles size={13} /> Vẽ thử {firstKey}
                </button>
              )}
              <button type="button" className={`${probeFirst ? 'btn-g' : 'btn-p'} cp-small`} disabled={busy || anchorNotApproved || needRun.length === 0}
                      onClick={() => void onRun('storyboard')} title={planSummary(plan) || undefined}>
                <Sparkles size={13} /> Vẽ {needRun.length} shot
              </button>
            </>
          )}
        </div>
      </header>

      <div className="cp-toolbar">
        <label className="cp-label" htmlFor="sb-aspect">Tỉ lệ video</label>
        <select id="sb-aspect" value={String(params.aspect || '9:16')} disabled={running}
                onChange={e => void guard(() => setParams(campaignId, 'storyboard', { aspect: e.target.value }))}>
          <option value="9:16">9:16 (dọc, TikTok/Reels)</option>
          <option value="16:9">16:9 (ngang)</option>
        </select>
        <span className="cp-note">Phải trùng tỉ lệ clip ở khối 6 · {approvedCount}/{elements.length} shot đã duyệt · mỗi shot 1 lượt ảnh ChatGPT, 0 credit Flow</span>
      </div>
      {anchorNotApproved && <p className="cp-warn"><AlertTriangle size={13} /> Khung mẫu ở khối 4 chưa được duyệt.</p>}
      {elements.length === 0 && <p className="cp-warn"><AlertTriangle size={13} /> Chưa có danh sách shot (khối 3).</p>}

      {elements.length > 0 && (
        <div className="cp-md">
          <ul className="cp-md-list" aria-label="Các shot">
            {elements.map(e => {
              const key = e.element_key
              const it = shots?.items.find(s => s.key === key)
              const g = describeGate(e.gate)
              const badge = g ?? describeElement(e)
              return (
                <li key={key}>
                  <button type="button" className={`cp-md-item ${selectedShot === key ? 'is-active' : ''}`} onClick={() => setSelectedShot(key)} data-testid={`board-${key}`}>
                    <span className="cp-md-thumb">
                      {e.selected_artifact_id ? <img src={artifactUrl(e.selected_artifact_id)} alt="" loading="lazy" /> : e.active_run ? <Loader2 size={14} className="spinning" /> : null}
                    </span>
                    <span className="cp-md-text">
                      <strong>{key}</strong>
                      <small>{it ? `${ROLE_LABEL[it.role] ?? it.role} · ${it.duration}s · ${BOARD_LABEL[it.board_type] ?? ''}` : ''}</small>
                      <span className={`cp-md-status cp-tone-text-${badge.tone}`}>{e.active_run ? 'Đang vẽ…' : badge.label}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {el && (
            <div className="cp-md-detail" data-testid="board-detail">
              <div className="cp-row">
                <strong className="cp-shot-key">{el.element_key}</strong>
                {info && <span className="cp-tag">{ROLE_LABEL[info.role] ?? info.role} · {info.duration}s</span>}
                {info?.board_type && <span className="cp-tag">{BOARD_LABEL[info.board_type] ?? info.board_type}</span>}
                <Badge badge={describeElement(el)} />
                {describeGate(el.gate) && <Badge badge={describeGate(el.gate)!} />}
                <span className="cp-row cp-push">
                  <button type="button" className="btn-g cp-small cp-icon" disabled={idx <= 0} onClick={() => setSelectedShot(elements[idx - 1].element_key)} aria-label="Shot trước"><ChevronLeft size={14} /></button>
                  <button type="button" className="btn-g cp-small cp-icon" disabled={idx >= elements.length - 1} onClick={() => setSelectedShot(elements[idx + 1].element_key)} aria-label="Shot sau"><ChevronRight size={14} /></button>
                </span>
              </div>

              {el.active_run && <p className="cp-running-note"><Loader2 size={13} className="spinning" /> {progressText(el.progress) || 'Đang chạy…'}</p>}
              {el.last_run?.state === 'error' && <p className="cp-error-inline">Lỗi: {el.last_run.error}</p>}
              {el.state === 'stale' && el.reasons.length > 0 && <p className="cp-note">Đổi: {el.reasons.map(reasonText).join(', ')}. Bản cũ vẫn giữ cho tới khi vẽ lại.</p>}

              <div className="cp-board-view">
                {imageId
                  ? <button type="button" onClick={() => onPreview(artifactUrl(imageId))} title="Xem lớn"><img src={artifactUrl(imageId)} alt={`Storyboard ${el.element_key}`} /></button>
                  : <div className="cp-placeholder">{el.active_run ? <Loader2 size={18} className="spinning" /> : 'Chưa vẽ storyboard cho shot này'}</div>}
              </div>

              <div className="cp-row">
                {!imageId ? (
                  <button type="button" className="btn-p cp-small" disabled={busy || running || anchorNotApproved} onClick={() => void onRun('storyboard', [el.element_key])}>
                    <Sparkles size={13} /> Vẽ shot này
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn-p cp-small" disabled={busy || running || el.gate === 'approved'}
                            onClick={() => void guard(() => decideGate(campaignId, 'storyboard', 'approve', { elementKey: el.element_key }))}>
                      <Check size={13} /> {el.gate === 'approved' ? 'Đã duyệt' : 'Duyệt'}
                    </button>
                    <button type="button" className="btn-g cp-small" disabled={busy || running} onClick={() => setRejecting(rejecting === el.element_key ? '' : el.element_key)}>
                      <ThumbsDown size={13} /> Từ chối
                    </button>
                    <button type="button" className="btn-g cp-small" disabled={busy || running || anchorNotApproved} onClick={() => regenerate(el.element_key)}>
                      <RefreshCw size={13} /> Vẽ lại
                    </button>
                  </>
                )}
                {history.length > 1 && (
                  <span className="cp-row cp-push">
                    <span className="cp-note">Bản đã vẽ:</span>
                    {history.map((h, i) => (
                      <button key={h.id} type="button" className={`cp-chip ${h.id === imageId ? 'is-active' : ''}`} disabled={busy || running}
                              onClick={() => void guard(() => selectArtifact(campaignId, 'storyboard', h.id, el.element_key))}>
                        {history.length - i}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              {rejecting === el.element_key && (
                <div className="cp-reject-inline">
                  <input className="cp-input" value={note} onChange={e => setNote(e.target.value)} aria-label="Lý do từ chối"
                         placeholder="Lý do (vd: logo méo ở khung 2). Ghi chú sẽ gắn vào prompt lần vẽ lại." />
                  <button type="button" className="btn-p cp-small" onClick={() => reject(el.element_key)}>Xác nhận từ chối</button>
                </div>
              )}

              {info && (
                <ol className="cp-beat-list" aria-label="Các nhịp">
                  {shotPanels(info).map((p, i) => (
                    <li key={i}><span className="cp-beat-num">{i + 1}</span><span className="cp-tag">{FRAMING_SHORT[p.framing] ?? p.framing}</span><span>{p.action}</span></li>
                  ))}
                </ol>
              )}

              <Fold title="Prompt sẽ gửi cho shot này" className="cp-fold-quiet" testId="board-prompt"
                    meta={preview ? `${preview.panels} khung · tỉ lệ ${preview.aspect}${preview.warnings.length ? ` · ${preview.warnings.length} cảnh báo` : ''}` : previewError}>
                {previewError && <p className="cp-empty">{previewError}</p>}
                {preview && (
                  <>
                    {preview.warnings.map(w => <p key={w.code} className="cp-warn"><AlertTriangle size={13} /> {w.message}</p>)}
                    <pre className="cp-pre">{preview.prompt}</pre>
                  </>
                )}
              </Fold>
            </div>
          )}
        </div>
      )}

      <Fold title="Nâng cao: mẫu prompt storyboard" className="cp-fold-quiet"
            meta={params.prompt?.template_id && params.prompt.template_id !== 'system:storyboard' ? 'đang dùng mẫu riêng' : 'mặc định'}>
        <PromptEditor campaignId={campaignId} stepKey="storyboard" kind="storyboard" defaultTemplateId="system:storyboard"
                      prompt={params.prompt} onChanged={onChanged} onError={onError} />
      </Fold>
    </section>
  )
}
