import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Check, Loader2, RefreshCw, Sparkles, Square, ThumbsDown } from 'lucide-react'
import {
  artifactUrl, cancelRun, decideGate, planRun, previewStepPrompt, reroll, selectArtifact, setParams,
} from '../services/campaignApi.ts'
import { describeElement, describeGate, elementLabel, errorMessage, planSummary, progressText, reasonText, sceneItems, sceneName } from '../services/campaignView.ts'
import type { ArtifactView, CampaignState, ElementState, Plan, ScenePreview } from '../types.ts'
import { Badge, Fold, RunError } from './Common.tsx'
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

const REF_TITLE: Record<string, string> = { sheet: 'Cast sheet', photo: 'Ảnh áo thật', plate: 'Ảnh bối cảnh' }

/** Khối 4: mỗi CẢNH một khung chốt (người mặc đúng áo đứng trong bối cảnh). Duyệt một lần mỗi cảnh; mọi clip của cảnh dùng ảnh này. */
export function SceneAnchorPanel({ campaignId, state, artifacts, busy, onChanged, onRun, onError, onPreview }: Props) {
  const steps = useMemo(() => state.blocks.flatMap(b => b.steps), [state])
  const step = steps.find(s => s.key === 'scene_anchor')
  const sheetEl = steps.find(s => s.key === 'cast_sheet')?.elements[0]
  const scenes = sceneItems(steps.find(s => s.key === 'scene_set')?.params)
  const params = step?.params ?? {}
  const elements: ElementState[] = (step?.elements ?? []).filter(e => e.element_key)
  const running = !!state.active_exec || elements.some(e => e.active_run)

  const [plan, setPlan] = useState<Plan | null>(null)
  const [selected, setSelected] = useState('')
  const [preview, setPreview] = useState<ScenePreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [rejecting, setRejecting] = useState('')
  const [note, setNote] = useState('')

  const defaultKey = (elements.find(e => e.gate === 'need_approval') ?? elements[0])?.element_key ?? ''
  useEffect(() => { if (!selected || !elements.some(e => e.element_key === selected)) setSelected(defaultKey) }, [defaultKey, elements, selected])

  const blockers = elements.find(e => e.element_key === selected)?.blockers ?? []
  const refreshKey = JSON.stringify([params, selected, sheetEl?.selected_artifact_id, sheetEl?.gate, elements.map(e => e.state + e.gate + e.selected_artifact_id)])
  useEffect(() => {
    let alive = true
    planRun(campaignId, 'scene_anchor').then(p => { if (alive) setPlan(p) }).catch(() => { if (alive) setPlan(null) })
    if (!selected || blockers.length) {
      setPreview(null)
      setPreviewError(blockers.length ? 'Chưa đủ đầu vào: ' + blockers.map(b => `${b.dep}: ${b.reason}`).join('; ') : '')
      return () => { alive = false }
    }
    previewStepPrompt<ScenePreview>(campaignId, 'scene_anchor', selected)
      .then(p => { if (alive) { setPreview(p); setPreviewError('') } })
      .catch(e => { if (alive) { setPreview(null); setPreviewError(errorMessage(e)) } })
    return () => { alive = false }
  }, [campaignId, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const guard = useCallback(async (fn: () => Promise<unknown>) => {
    try { await fn(); await onChanged() } catch (e) { onError(errorMessage(e)) }
  }, [onChanged, onError])

  const historyOf = (key: string) => artifacts.filter(a => a.step_key === 'scene_anchor' && a.element_key === key && a.kind === 'image')
    .sort((a, b) => b.created_at.localeCompare(a.created_at))
  const sheetNotApproved = sheetEl?.gate !== 'approved'
  const needApproval = elements.filter(e => e.selected_artifact_id && e.gate !== 'approved')
  const needRun = elements.filter(e => e.state === 'missing' || e.state === 'stale')
  const approvedCount = elements.filter(e => e.gate === 'approved').length

  const regenerate = (key: string) => void guard(async () => { await reroll(campaignId, 'scene_anchor', key); await onRun('scene_anchor', [key]) })
  const reject = (key: string) => void guard(async () => {
    await decideGate(campaignId, 'scene_anchor', 'reject', { elementKey: key, note: note.trim() })
    setRejecting('')
    setNote('')
  })
  const setAspect = (aspect: string) => void guard(async () => {
    await setParams(campaignId, 'scene_anchor', { aspect })
    await setParams(campaignId, 'scene_plate', { aspect })
    await setParams(campaignId, 'clip', { aspect })
  })

  const el = elements.find(e => e.element_key === selected)
  const imageId = el?.selected_artifact_id ?? null
  const history = el ? historyOf(el.element_key) : []
  const idx = elements.findIndex(e => e.element_key === selected)
  const scene = scenes.find(s => s.key === selected)

  return (
    <section className="cp-card" data-testid="scene-anchor-panel">
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>Khung chốt từng cảnh</h3>
          <span className="cp-head-sub">Cast sheet + ảnh áo thật + ảnh bối cảnh → một ảnh người-trong-cảnh. Duyệt một lần mỗi cảnh; bản duyệt là ảnh tham chiếu bối cảnh của mọi clip trong cảnh đó.</span>
        </div>
        <div className="cp-head-actions">
          {running ? (
            <>
              <span className="cp-running"><Loader2 size={15} className="spinning" /> Đang tạo… (mỗi cảnh khoảng 1 phút)</span>
              <button type="button" className="btn-g cp-small" onClick={() => void guard(() => cancelRun(campaignId))}><Square size={13} /> Hủy</button>
            </>
          ) : (
            <>
              {needApproval.length > 1 && (
                <button type="button" className="btn-g cp-small" disabled={busy}
                        onClick={() => void guard(async () => { for (const e of needApproval) await decideGate(campaignId, 'scene_anchor', 'approve', { elementKey: e.element_key }) })}>
                  <Check size={13} /> Duyệt tất cả ({needApproval.length})
                </button>
              )}
              <button type="button" className="btn-p cp-small" disabled={busy || sheetNotApproved || needRun.length === 0}
                      onClick={() => void onRun('scene_anchor')} title={planSummary(plan) || undefined}>
                <Sparkles size={13} /> Tạo {needRun.length} khung chốt
              </button>
            </>
          )}
        </div>
      </header>

      <div className="cp-toolbar">
        <label className="cp-label" htmlFor="anchor-aspect">Tỉ lệ video</label>
        <select id="anchor-aspect" value={String(params.aspect || '9:16')} disabled={running} onChange={e => setAspect(e.target.value)}>
          <option value="9:16">9:16 (dọc, TikTok/Reels)</option>
          <option value="16:9">16:9 (ngang)</option>
        </select>
        <span className="cp-note">Dùng chung cho ảnh bối cảnh, khung chốt và clip · {approvedCount}/{elements.length} cảnh đã duyệt · mỗi cảnh 1 lượt ảnh ChatGPT, 0 credit Flow</span>
      </div>
      {sheetNotApproved && <p className="cp-warn"><AlertTriangle size={13} /> Cast sheet ở khối 2 chưa được duyệt.</p>}
      {elements.length === 0 && <p className="cp-warn"><AlertTriangle size={13} /> Chưa có cảnh nào (khối 2).</p>}

      {elements.length > 0 && (
        <div className="cp-md">
          <ul className="cp-md-list" aria-label="Các cảnh">
            {elements.map(e => {
              const key = e.element_key
              const g = describeGate(e.gate)
              const badge = g ?? describeElement(e)
              return (
                <li key={key}>
                  <button type="button" className={`cp-md-item ${selected === key ? 'is-active' : ''}`} onClick={() => setSelected(key)} data-testid={`anchor-${key}`}>
                    <span className="cp-md-thumb cp-md-thumb-tall">
                      {e.selected_artifact_id ? <img src={artifactUrl(e.selected_artifact_id)} alt="" loading="lazy" /> : e.active_run ? <Loader2 size={14} className="spinning" /> : null}
                    </span>
                    <span className="cp-md-text">
                      <strong>{elementLabel(key)}</strong>
                      <small>{sceneName(scenes, key)}</small>
                      <span className={`cp-md-status cp-tone-text-${badge.tone}`}>{e.active_run ? 'Đang tạo…' : badge.label}</span>
                    </span>
                  </button>
                </li>
              )
            })}
          </ul>

          {el && (
            <div className="cp-md-detail" data-testid="anchor-detail">
              <div className="cp-row">
                <strong className="cp-shot-key">{elementLabel(el.element_key)}</strong>
                {scene && <span className="cp-tag">{sceneName(scenes, el.element_key)}</span>}
                <Badge badge={describeElement(el)} />
                {describeGate(el.gate) && <Badge badge={describeGate(el.gate)!} />}
                <span className="cp-row cp-push">
                  <button type="button" className="btn-g cp-small cp-icon" disabled={idx <= 0} onClick={() => setSelected(elements[idx - 1].element_key)} aria-label="Cảnh trước"><Sparkles size={0} />‹</button>
                  <button type="button" className="btn-g cp-small cp-icon" disabled={idx >= elements.length - 1} onClick={() => setSelected(elements[idx + 1].element_key)} aria-label="Cảnh sau">›</button>
                </span>
              </div>

              {el.active_run && <p className="cp-running-note"><Loader2 size={13} className="spinning" /> {progressText(el.progress) || 'Đang chạy…'}</p>}
              {el.last_run?.state === 'error' && <RunError prefix="Tạo khung chốt lỗi" text={el.last_run.error ?? ''} />}
              {el.state === 'stale' && el.reasons.length > 0 && <p className="cp-note">Đổi: {el.reasons.map(reasonText).join(', ')}. Bản cũ vẫn giữ cho tới khi tạo lại.</p>}
              {el.blockers.length > 0 && !imageId && <p className="cp-note">Chưa đủ đầu vào: {el.blockers.map(b => `${b.dep}: ${b.reason}`).join('; ')}</p>}

              <div className="cp-anchor">
                {imageId
                  ? <button type="button" className="cp-anchor-img" onClick={() => onPreview(artifactUrl(imageId))} title="Xem lớn"><img src={artifactUrl(imageId)} alt={`Khung chốt ${el.element_key}`} loading="lazy" /></button>
                  : <div className="cp-placeholder cp-anchor-img">{el.active_run ? <Loader2 size={18} className="spinning" /> : 'Chưa có khung chốt cho cảnh này'}</div>}
              </div>

              <div className="cp-row">
                {!imageId ? (
                  <button type="button" className="btn-p cp-small" disabled={busy || running || sheetNotApproved || el.blockers.length > 0} onClick={() => void onRun('scene_anchor', [el.element_key])}>
                    <Sparkles size={13} /> Tạo khung chốt cảnh này
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn-p cp-small" disabled={busy || running || el.gate === 'approved'}
                            onClick={() => void guard(() => decideGate(campaignId, 'scene_anchor', 'approve', { elementKey: el.element_key }))}>
                      <Check size={13} /> {el.gate === 'approved' ? 'Đã duyệt' : 'Duyệt'}
                    </button>
                    <button type="button" className="btn-g cp-small" disabled={busy || running} onClick={() => setRejecting(rejecting === el.element_key ? '' : el.element_key)}>
                      <ThumbsDown size={13} /> Từ chối
                    </button>
                    <button type="button" className="btn-g cp-small" disabled={busy || running || sheetNotApproved} onClick={() => regenerate(el.element_key)}>
                      <RefreshCw size={13} /> Tạo lại
                    </button>
                  </>
                )}
                {history.length > 1 && (
                  <span className="cp-row cp-push">
                    <span className="cp-note">Bản đã tạo:</span>
                    {history.map((h, i) => (
                      <button key={h.id} type="button" className={`cp-chip ${h.id === imageId ? 'is-active' : ''}`} disabled={busy || running}
                              onClick={() => void guard(() => selectArtifact(campaignId, 'scene_anchor', h.id, el.element_key))}>
                        {history.length - i}
                      </button>
                    ))}
                  </span>
                )}
              </div>
              {rejecting === el.element_key && (
                <div className="cp-reject-inline">
                  <input className="cp-input" value={note} onChange={e => setNote(e.target.value)} aria-label="Lý do từ chối"
                         placeholder="Lý do (vd: mặt khác cast sheet, sai bối cảnh). Ghi chú sẽ gắn vào prompt lần tạo lại." />
                  <button type="button" className="btn-p cp-small" onClick={() => reject(el.element_key)}>Xác nhận từ chối</button>
                </div>
              )}
              {el.gate === 'need_approval' && <p className="cp-note">Soi: mặt giống cast sheet, áo đúng logo, đứng đúng trong bối cảnh và cùng ánh sáng. Duyệt rồi mọi clip của cảnh này mới chạy được.</p>}

              <Fold title="Prompt và ảnh tham chiếu sẽ gửi" className="cp-fold-quiet" testId="anchor-prompt"
                    meta={preview ? `${preview.ref_order.length} ảnh · tỉ lệ ${preview.aspect}${preview.warnings.length ? ` · ${preview.warnings.length} cảnh báo` : ''}` : previewError}>
                {previewError && <p className="cp-empty">{previewError}</p>}
                {preview && (
                  <>
                    <div className="cp-refs">
                      {preview.ref_order.map(r => (
                        <figure key={r.role}>
                          {r.artifact_id && <button type="button" onClick={() => onPreview(artifactUrl(r.artifact_id!))}><img src={artifactUrl(r.artifact_id)} alt={r.role} loading="lazy" /></button>}
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

      <Fold title="Nâng cao: mẫu prompt khung chốt" className="cp-fold-quiet"
            meta={params.prompt?.template_id && params.prompt.template_id !== 'system:scene_anchor' ? 'đang dùng mẫu riêng' : 'mặc định'}>
        <PromptEditor campaignId={campaignId} stepKey="scene_anchor" kind="scene_anchor" defaultTemplateId="system:scene_anchor"
                      prompt={params.prompt} onChanged={onChanged} onError={onError} />
      </Fold>
    </section>
  )
}
