import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Clapperboard, Loader2, RefreshCw, Square, ThumbsDown, Undo2 } from 'lucide-react'
import {
  artifactUrl, cancelRun, decideGate, fetchArtifactJson, planRun, previewStepPrompt, reroll, resolveRun, selectArtifact, setParams,
} from '../services/campaignApi.ts'
import {
  ROLE_LABEL, describeElement, describeGate, elementLabel, errorMessage, planBlocker, planSummary, progressText, reasonText, sceneItems, sceneName,
  type Badge as BadgeData,
} from '../services/campaignView.ts'
import type { ArtifactView, CampaignState, ClipPreview, ElementState, Plan, ScriptDoc, Tier } from '../types.ts'
import { Badge, Fold, RunError } from './Common.tsx'
import { PromptEditor } from './PromptEditor.tsx'
import { HelpHint } from '../../help/components/HelpHint'

interface Props {
  campaignId: string
  state: CampaignState
  artifacts: ArtifactView[]
  busy: boolean
  tier: Tier
  onTier: (tier: Tier) => void
  onChanged: () => Promise<void>
  onRun: (target: string, elements?: string[]) => Promise<void>
  onError: (message: string) => void
  onPreview: (src: string) => void
}

const TIER_INFO: Record<Tier, { title: string; res: string; hint: string }> = {
  draft: { title: '360p (rẻ)', res: '360p', hint: '1 credit/giây tới 10 giây, 2 credit/giây sau đó (dự kiến; 15 s = 20 đã đo). Rẻ, hợp để thử chuyển động.' },
  final: { title: '720p (nét)', res: '720p', hint: '3 credit/giây tới 10 giây (6 s = 18, 8 s = 24, 10 s = 30 đã đo), 6 credit/giây sau đó. Tạo thẳng được, không cần bản 360p trước.' },
}
const REF_TITLE: Record<string, string> = { sheet: 'Cast sheet', photo: 'Ảnh áo thật', anchor: 'Khung chốt cảnh' }

/** Khối 5: mỗi shot một clip Ingredients từ cast sheet, ảnh áo thật và khung chốt của cảnh shot dùng. TỐN CREDIT FLOW: luôn xem ước tính. */
export function ClipPanel({ campaignId, state, artifacts, busy, tier, onTier, onChanged, onRun, onError, onPreview }: Props) {
  const steps = useMemo(() => state.blocks.flatMap(b => b.steps), [state])
  const step = steps.find(s => s.key === 'clip')
  const anchorEls = steps.find(s => s.key === 'scene_anchor')?.elements ?? []
  const scriptEl = steps.find(s => s.key === 'script')?.elements[0]
  const scenes = sceneItems(steps.find(s => s.key === 'scene_set')?.params)
  const params = step?.params ?? {}
  const elements: ElementState[] = (step?.elements ?? []).filter(e => e.element_key)
  const running = !!state.active_exec || elements.some(e => e.active_run)

  const [doc, setDoc] = useState<ScriptDoc | null>(null)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [selectedShot, setSelectedShot] = useState('')
  const [preview, setPreview] = useState<ClipPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [rejecting, setRejecting] = useState('')
  const [note, setNote] = useState('')

  useEffect(() => {
    let alive = true
    const id = scriptEl?.selected_artifact_id
    if (!id) { setDoc(null); return }
    fetchArtifactJson<ScriptDoc>(id).then(d => { if (alive) setDoc(d) }).catch(() => { if (alive) setDoc(null) })
    return () => { alive = false }
  }, [scriptEl?.selected_artifact_id])

  const defaultKey = (elements.find(e => e.last_run?.state === 'unknown') ?? elements.find(e => e.gate === 'need_approval') ?? elements[0])?.element_key ?? ''
  useEffect(() => { if (!selectedShot || !elements.some(e => e.element_key === selectedShot)) setSelectedShot(defaultKey) }, [defaultKey, elements, selectedShot])

  const selected = elements.find(e => e.element_key === selectedShot)
  const refreshKey = JSON.stringify([params, tier, selectedShot, elements.map(e => e.state + e.gate + (e.blockers.length ? 'b' : '')), anchorEls.map(e => e.gate + e.selected_artifact_id), elements.map(e => JSON.stringify(e.params ?? {}))])
  useEffect(() => {
    let alive = true
    planRun(campaignId, 'clip', tier).then(p => { if (alive) setPlan(p) }).catch(() => { if (alive) setPlan(null) })
    if (!selectedShot) return () => { alive = false }
    if (selected?.blockers.length && !selected.selected_artifact_id) {
      setPreview(null)
      setPreviewError('Chưa đủ đầu vào: ' + selected.blockers.map(b => `${b.dep}: ${b.reason}`).join('; '))
      return () => { alive = false }
    }
    previewStepPrompt<ClipPreview>(campaignId, 'clip', selectedShot, tier)
      .then(p => { if (alive) { setPreview(p); setPreviewError('') } })
      .catch(e => { if (alive) { setPreview(null); setPreviewError(errorMessage(e)) } })
    return () => { alive = false }
  }, [campaignId, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const guard = useCallback(async (fn: () => Promise<unknown>) => {
    try { await fn(); await onChanged() } catch (e) { onError(errorMessage(e)) }
  }, [onChanged, onError])

  const info = (key: string) => doc?.items.find(s => s.key === key)
  const videoOf = (el: ElementState) => artifacts.find(a => a.id === el.selected_artifact_id && a.kind === 'video')
  const anchorOf = (key: string) => anchorEls.find(e => e.element_key === (info(key)?.scene ?? ''))?.selected_artifact_id ?? null
  const history = (key: string) => artifacts.filter(a => a.step_key === 'clip' && a.element_key === key && a.kind === 'video')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const otherResOnly = (el: ElementState) => el.state === 'stale' && el.reasons.length === 1 && el.reasons[0] === 'tier'
  const statusOf = (el: ElementState): BadgeData => {
    if (el.active_run) return { label: 'Đang tạo…', tone: 'info' }
    if (el.last_run?.state === 'unknown') return { label: 'Chưa rõ kết quả', tone: 'bad' }
    if (otherResOnly(el)) return { label: `Chưa có bản ${TIER_INFO[tier].res}`, tone: 'info' }
    return describeGate(el.gate) ?? describeElement(el)
  }

  const regenerate = (key: string) => void guard(async () => { await reroll(campaignId, 'clip', key); await onRun('clip', [key]) })
  const reject = (key: string) => void guard(async () => {
    await decideGate(campaignId, 'clip', 'reject', { elementKey: key, note: note.trim() })
    setRejecting('')
    setNote('')
  })
  const confirmNotSent = (el: ElementState) => {
    if (window.confirm('Bạn đã kiểm tra Flow và chắc chắn lệnh này CHƯA được gửi/không tạo ra video? Sau khi xác nhận có thể chạy lại và tốn credit lần nữa.')) {
      void guard(() => resolveRun(el.last_run!.id))
    }
  }
  const runnable = plan?.items.filter(i => i.step_key === 'clip' && i.action === 'run').length ?? 0
  const waitingCount = plan?.items.filter(i => i.step_key === 'clip' && i.action === 'waiting').length ?? 0
  const approvedCount = elements.filter(e => e.gate === 'approved').length
  const unknownEls = elements.filter(e => e.last_run?.state === 'unknown')

  const el = selected
  const key = el?.element_key ?? ''
  const shot = el ? info(key) : undefined
  const video = el ? videoOf(el) : undefined
  const anchorId = key ? anchorOf(key) : null
  const seconds = Number(el?.params?.duration ?? shot?.duration ?? 5)
  const hist = key ? history(key) : []
  const unknown = el?.last_run?.state === 'unknown'
  const blocker = key ? planBlocker(plan, 'clip', key) : null
  const waitingAnchor = !!el && (blocker?.action === 'waiting' || (!video && el.blockers.some(b => b.dep === 'scene_anchor')))
  const idx = elements.findIndex(e => e.element_key === key)

  return (
    <section className="cp-card" data-testid="clip-panel">
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>Clip Ingredients của từng shot <span className="cp-tag cp-tag-warn">Tốn credit Flow</span><HelpHint hint="campaign.clip" /></h3>
          <span className="cp-head-sub">Omni 1.2 nhận 3 ảnh theo vai: cast sheet, ảnh áo thật, khung chốt của cảnh shot dùng. Không bao giờ tự gửi lại lệnh tạo video.</span>
        </div>
        <div className="cp-head-actions">
          <div className="cp-seg" role="group" aria-label="Độ phân giải">
            {(['draft', 'final'] as Tier[]).map(t => (
              <button key={t} type="button" className={tier === t ? 'is-active' : ''} aria-pressed={tier === t} disabled={running} onClick={() => onTier(t)}>
                {TIER_INFO[t].title}
              </button>
            ))}
          </div>
          {running ? (
            <button type="button" className="btn-g cp-small" onClick={() => void guard(() => cancelRun(campaignId))}><Square size={13} /> Dừng shot chưa gửi</button>
          ) : (
            <button type="button" className="btn-p cp-small" data-testid="run-clips" disabled={busy || runnable === 0} onClick={() => void onRun('clip')}>
              <Clapperboard size={14} /> {`Tạo clip ${TIER_INFO[tier].res} cho ${runnable} shot`}
            </button>
          )}
        </div>
      </header>

      <div className="cp-toolbar">
        <span className="cp-note">{TIER_INFO[tier].hint}</span>
        <span className="cp-note cp-push">{[planSummary(plan), `${approvedCount}/${elements.length} clip đã duyệt`, waitingCount ? `${waitingCount} shot chờ duyệt khung chốt` : ''].filter(Boolean).join(' · ')}</span>
      </div>
      {running && <p className="cp-running-note"><Loader2 size={13} className="spinning" /> Đang tạo clip… khoảng 1–3 phút mỗi clip; lệnh đã gửi thì không hủy được.</p>}
      {plan && plan.unknown_cost_items > 0 && (
        <p className="cp-warn"><AlertTriangle size={13} /> {plan.unknown_cost_items} việc chưa đo được giá thật; số credit đang hiện là dự kiến theo công thức.</p>
      )}
      {unknownEls.length > 0 && (
        <div className="cp-alert" role="alert" data-testid="clip-unknown">
          <AlertTriangle size={16} />
          <div>
            <strong>{unknownEls.length} shot chưa rõ kết quả — KHÔNG gửi lại.</strong> Lệnh có thể đã tới Flow. Mở Flow kiểm tra trước, rồi mới xác nhận chưa gửi.
            <div className="cp-row">
              {unknownEls.map(u => (
                <button key={u.element_key} type="button" className="cp-chip" onClick={() => setSelectedShot(u.element_key)}>{u.element_key}</button>
              ))}
            </div>
          </div>
        </div>
      )}
      {elements.length === 0 && <p className="cp-warn"><AlertTriangle size={13} /> Chưa có kịch bản (khối 3).</p>}

      {elements.length > 0 && (
        <div className="cp-md">
          <ul className="cp-md-list" aria-label="Các shot">
            {elements.map(e => {
              const k = e.element_key
              const it = info(k)
              const v = videoOf(e)
              const a = anchorOf(k)
              const st = statusOf(e)
              return (
                <li key={k}>
                  <button type="button" className={`cp-md-item ${selectedShot === k ? 'is-active' : ''}`} onClick={() => setSelectedShot(k)} data-testid={`clip-${k}`}>
                    <span className="cp-md-thumb cp-md-thumb-tall">
                      {a ? <img src={artifactUrl(a)} alt="" loading="lazy" /> : null}
                      {v && <span className="cp-md-res">{String(v.meta?.resolution ?? '')}</span>}
                    </span>
                    <span className="cp-md-text">
                      <strong>{elementLabel(k)}</strong>
                      <small>{it ? `${ROLE_LABEL[it.role] ?? it.role} · ${Number(e.params?.duration ?? it.duration)}s · ${sceneName(scenes, it.scene)}` : ''}</small>
                      <span className={`cp-md-status cp-tone-text-${st.tone}`}>{st.label}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {el && (
            <div className="cp-md-detail" data-testid="clip-detail">
              <div className="cp-row">
                <strong className="cp-shot-key">{elementLabel(key)}</strong>
                {shot && <span className="cp-tag">{ROLE_LABEL[shot.role] ?? shot.role}</span>}
                {shot && <span className="cp-tag">{sceneName(scenes, shot.scene)}</span>}
                {video && <span className="cp-tag">{String(video.meta?.resolution ?? '') || 'clip'}</span>}
                <Badge badge={statusOf(el)} />
                <span className="cp-row cp-push">
                  <button type="button" className="btn-g cp-small cp-icon" disabled={idx <= 0} onClick={() => setSelectedShot(elements[idx - 1].element_key)} aria-label="Shot trước"><ChevronLeft size={14} /></button>
                  <button type="button" className="btn-g cp-small cp-icon" disabled={idx >= elements.length - 1} onClick={() => setSelectedShot(elements[idx + 1].element_key)} aria-label="Shot sau"><ChevronRight size={14} /></button>
                </span>
              </div>

              {unknown && (
                <div className="cp-alert" role="alert">
                  <AlertTriangle size={16} />
                  <div>
                    <strong>Chưa rõ kết quả — KHÔNG gửi lại.</strong> {el.last_run?.error}
                    {el.last_run?.external_ref && <> Mã job Veo: <code>{el.last_run.external_ref}</code>.</>}
                    <div className="cp-row">
                      <button type="button" className="btn-g cp-small" disabled={busy} onClick={() => confirmNotSent(el)}><Undo2 size={13} /> Xác nhận chưa gửi</button>
                    </div>
                  </div>
                </div>
              )}

              <div className="cp-clip-stage">
                <div className="cp-clip-video">
                  {video
                    ? <video key={video.id} src={artifactUrl(video.id)} controls preload="metadata" playsInline />
                    : <div className="cp-placeholder cp-clip-empty">{el.active_run ? <><Loader2 size={18} className="spinning" /> {progressText(el.progress)}</> : 'Chưa có clip'}</div>}
                </div>
                <div className="cp-clip-side">
                  <label className="cp-field" data-testid={`duration-${key}`}>
                    <span>Thời lượng</span>
                    <select id={`duration-${key}`} value={seconds} disabled={busy || running}
                            onChange={e => { const n = Number(e.target.value); void guard(() => setParams(campaignId, 'clip', { duration: n === shot?.duration ? null : n }, key)) }}>
                      {Array.from({ length: 13 }, (_, i) => i + 3).map(n => <option key={n} value={n}>{n} giây{n > 10 ? ' (đắt hơn)' : ''}</option>)}
                    </select>
                  </label>
                  {shot && shot.beats.length > 0 && (
                    <ol className="cp-beat-list" aria-label="Beat của shot">
                      {shot.beats.map((b, i) => <li key={i}><span className="cp-beat-num">{i + 1}</span><span>{b}</span></li>)}
                    </ol>
                  )}
                  {el.active_run && <p className="cp-running-note"><Loader2 size={13} className="spinning" /> {progressText(el.progress) || 'Đang chạy…'}</p>}
                  {waitingAnchor && <p className="cp-warn"><AlertTriangle size={13} /> Khung chốt của cảnh này chưa được duyệt. Sang khối 4 duyệt rồi quay lại.</p>}
                  {blocker && !waitingAnchor && !unknown && <p className="cp-note">{blocker.reason}</p>}
                  {el.stale && el.reasons.length > 0 && !otherResOnly(el) && <p className="cp-note">Đổi: {el.reasons.map(reasonText).join(', ')}</p>}
                  {el.last_run?.state === 'error' && <RunError prefix="Tạo clip lỗi" text={el.last_run.error ?? ''} />}

                  <div className="cp-btn-col">
                    {!video ? (
                      <button type="button" className="btn-p cp-small" disabled={busy || running || el.blockers.length > 0 || !!blocker || unknown}
                              onClick={() => void onRun('clip', [key])}>
                        <Clapperboard size={13} /> {`Tạo clip ${TIER_INFO[tier].res} shot này`}
                      </button>
                    ) : (
                      <>
                        <button type="button" className="btn-p cp-small" disabled={busy || running || el.gate === 'approved'}
                                onClick={() => void guard(() => decideGate(campaignId, 'clip', 'approve', { elementKey: key }))}>
                          <Check size={13} /> {el.gate === 'approved' ? 'Đã duyệt' : 'Duyệt clip này'}
                        </button>
                        {otherResOnly(el) && (
                          <button type="button" className="btn-p cp-small" disabled={busy || running || !!blocker || unknown} onClick={() => void onRun('clip', [key])}>
                            <Clapperboard size={13} /> Tạo bản {TIER_INFO[tier].res} shot này
                          </button>
                        )}
                        <button type="button" className="btn-g cp-small" disabled={busy || running} onClick={() => setRejecting(rejecting === key ? '' : key)}>
                          <ThumbsDown size={13} /> Từ chối
                        </button>
                        <button type="button" className="btn-g cp-small" disabled={busy || running || !!blocker || unknown} onClick={() => regenerate(key)}
                                title="Tạo clip mới cho shot này (tốn credit)">
                          <RefreshCw size={13} /> Tạo lại (tốn credit)
                        </button>
                      </>
                    )}
                  </div>
                  {rejecting === key && (
                    <div className="cp-reject-inline cp-reject-col">
                      <input className="cp-input" value={note} onChange={e => setNote(e.target.value)} aria-label="Lý do từ chối"
                             placeholder="Lý do (vd: áo méo khi xoay). Gắn vào prompt lần tạo lại." />
                      <button type="button" className="btn-p cp-small" onClick={() => reject(key)}>Xác nhận từ chối</button>
                    </div>
                  )}

                  {anchorId && (
                    <button type="button" className="cp-clip-board" onClick={() => onPreview(artifactUrl(anchorId))} title="Xem khung chốt lớn">
                      <img src={artifactUrl(anchorId)} alt={`Khung chốt của ${key}`} loading="lazy" />
                      <span>Khung chốt cảnh đã dùng</span>
                    </button>
                  )}
                </div>
              </div>

              {hist.length > 1 && (
                <div className="cp-row">
                  <span className="cp-note">Các clip đã tạo:</span>
                  {hist.map((h, i) => (
                    <button key={h.id} type="button" className={`cp-chip ${h.id === el.selected_artifact_id ? 'is-active' : ''}`} disabled={busy || running}
                            onClick={() => void guard(() => selectArtifact(campaignId, 'clip', h.id, key))}>
                      Bản {hist.length - i} · {String(h.meta?.resolution ?? '')}
                    </button>
                  ))}
                </div>
              )}

              <Fold title="Prompt sẽ gửi cho shot này" className="cp-fold-quiet" testId="clip-prompt"
                    meta={preview
                      ? `${preview.duration}s · ${preview.aspect} · ${preview.credit_known ? `${preview.credit} credit` : `dự kiến ${preview.credit_estimate} credit`} · ${preview.ref_order.length} ảnh tham chiếu${preview.warnings.length ? ` · ${preview.warnings.length} cảnh báo` : ''}`
                      : previewError}>
                {previewError && <p className="cp-empty">{previewError}</p>}
                {preview && (
                  <>
                    <p className="cp-note">
                      Model <code>{preview.model}</code> · {preview.duration}s · {preview.aspect} · chuyển động “{preview.motion}” ·{' '}
                      {preview.credit_known ? <strong>{preview.credit} credit (đã đo)</strong> : <strong>dự kiến {preview.credit_estimate} credit (chưa đo được giá)</strong>}
                    </p>
                    <div className="cp-refs" data-testid="clip-refs">
                      {preview.ref_order.map(r => (
                        <figure key={r.role}>
                          <button type="button" onClick={() => onPreview(artifactUrl(r.artifact_id))}><img src={artifactUrl(r.artifact_id)} alt={r.label ?? r.role} loading="lazy" /></button>
                          <figcaption>{REF_TITLE[r.role] ?? r.label ?? r.role}</figcaption>
                        </figure>
                      ))}
                    </div>
                    {preview.warnings.map(w => <p key={w.code} className="cp-warn"><AlertTriangle size={13} /> {w.message}</p>)}
                    <pre className="cp-pre">{preview.prompt}</pre>
                  </>
                )}
              </Fold>
            </div>
          )}
        </div>
      )}

      <Fold title="Nâng cao: mẫu prompt video" className="cp-fold-quiet"
            meta={params.prompt?.template_id && params.prompt.template_id !== 'system:clip_v3' ? 'đang dùng mẫu riêng' : 'mặc định v3'}>
        <PromptEditor campaignId={campaignId} stepKey="clip" kind="clip" defaultTemplateId="system:clip_v3"
                      prompt={params.prompt} onChanged={onChanged} onError={onError} />
      </Fold>
    </section>
  )
}
