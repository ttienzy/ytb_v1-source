import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Loader2, Sparkles, Square } from 'lucide-react'
import { cancelRun, editArtifact, fetchArtifactJson, planRun, previewStepPrompt } from '../services/campaignApi.ts'
import { describeElement, errorMessage, planSummary, reasonText } from '../services/campaignView.ts'
import type { ArtifactView, CampaignState, Plan, PlanWarning, PromptPreview } from '../types.ts'
import { Badge, Fold, SaveBar } from './Common.tsx'
import { PromptEditor } from './PromptEditor.tsx'

export interface ShellApi<T> {
  draft: T
  update: (fn: (draft: T) => T) => void
  disabled: boolean
  /** Cảnh báo của bản đã lưu (để bước tự gắn vào đúng phần tử, vd. từng shot). */
  warnings: PlanWarning[]
}

interface Props<T extends { warnings?: PlanWarning[] }> {
  campaignId: string
  state: CampaignState
  artifacts: ArtifactView[]
  busy: boolean
  onChanged: () => Promise<void>
  onRun: (target: string) => Promise<void>
  onError: (message: string) => void
  stepKey: string
  /** Loại mẫu prompt và mẫu mặc định (mặc định: kind = stepKey, system:<stepKey>). */
  kind?: string
  defaultTemplateId?: string
  title: string
  hint: string
  runLabel: string
  /** Điều khiển tham số riêng của bước (vd. số shot), hiện trên thanh công cụ. */
  extra?: ReactNode
  /** Bước tự hiện cảnh báo theo phần tử: chỉ hiện ở đầu thẻ những cảnh báo không thuộc phần tử nào. */
  ownWarnings?: (w: PlanWarning) => boolean
  /** Chuẩn hóa kết quả đọc từ artifact; trả null = dạng không dùng được (vd. tạo ở phiên bản cũ) → hiện
   *  `incompatibleNote` thay vì đưa dữ liệu lạ vào form (trước đây làm vỡ cả trang). */
  adapt?: (raw: unknown) => T | null
  incompatibleNote?: string
  children: (api: ShellApi<T>) => ReactNode
}

const withoutWarnings = (v: unknown) => JSON.stringify({ ...(v as object), warnings: undefined })

/** Khung chung cho các bước LLM trả JSON: chạy ở đầu thẻ, xem/sửa kết quả, prompt ở mục Nâng cao, lưu thành phiên bản mới. */
export function PlanStepShell<T extends { warnings?: PlanWarning[] }>(props: Props<T>) {
  const { campaignId, state, artifacts, busy, onChanged, onRun, onError, stepKey, title, hint, runLabel, extra, ownWarnings, children, adapt } = props
  const kind = props.kind ?? stepKey
  const defaultTemplateId = props.defaultTemplateId ?? `system:${stepKey}`
  const step = state.blocks.flatMap(b => b.steps).find(s => s.key === stepKey)
  const element = step?.elements[0]
  const params = step?.params ?? {}
  const selectedId = element?.selected_artifact_id ?? null
  const selectedArt = artifacts.find(a => a.id === selectedId)
  const running = !!state.active_exec || !!element?.active_run

  const [saved, setSaved] = useState<T | null>(null)
  const [incompatible, setIncompatible] = useState(false)
  const [draft, setDraft] = useState<T | null>(null)
  const [saving, setSaving] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [preview, setPreview] = useState<PromptPreview | null>(null)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    let alive = true
    if (!selectedId) { setSaved(null); setDraft(null); setIncompatible(false); return }
    fetchArtifactJson<unknown>(selectedId)
      .then(raw => {
        if (!alive) return
        const d = adapt ? adapt(raw) : (raw as T)
        setIncompatible(d === null)
        setSaved(d)
        setDraft(d)
      })
      .catch(e => onError(errorMessage(e)))
    return () => { alive = false }
  }, [selectedId, onError, adapt])

  const refreshKey = JSON.stringify([params, selectedId, element?.state, element?.blockers.length])
  useEffect(() => {
    let alive = true
    if (element?.blockers.length) {            // thiếu đầu vào: báo lý do, không gọi mạng
      setPreview(null)
      setPreviewError('Chưa đủ đầu vào: ' + element.blockers.map(b => `${b.dep}: ${b.reason}`).join('; '))
      setPlan(null)
      return
    }
    previewStepPrompt(campaignId, stepKey)
      .then(p => { if (alive) { setPreview(p); setPreviewError('') } })
      .catch(e => { if (alive) { setPreview(null); setPreviewError(errorMessage(e)) } })
    planRun(campaignId, stepKey).then(p => { if (alive) setPlan(p) }).catch(() => { if (alive) setPlan(null) })
    return () => { alive = false }
  }, [campaignId, stepKey, refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = useMemo(() => !!saved && !!draft && withoutWarnings(saved) !== withoutWarnings(draft), [saved, draft])
  const blocked = !!element?.blockers.length && !selectedId
  const stale = element?.state === 'stale'
  const needsRun = !selectedId || stale || incompatible
  const lastError = element?.last_run?.state === 'error' ? element.last_run.error : ''
  const warnings = saved?.warnings ?? []
  const general = ownWarnings ? warnings.filter(w => !ownWarnings(w)) : warnings
  const versions = artifacts.filter(a => a.step_key === stepKey).length

  const save = async () => {
    if (!draft) return
    setSaving(true)
    try {
      const { warnings: _w, ...content } = draft as T & { warnings?: unknown }
      await editArtifact(campaignId, stepKey, content)
      await onChanged()
    } catch (e) { onError(errorMessage(e)) } finally { setSaving(false) }
  }

  const warnList = general.map((w, i) => <span key={`${w.code}-${i}`} className="cp-warn-chip"><AlertTriangle size={12} /> {w.message}</span>)

  return (
    <section className="cp-card" data-testid={`step-${stepKey}`}>
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>{title}</h3>
          <span className="cp-head-sub">{hint}</span>
        </div>
        <div className="cp-head-actions">
        <Badge badge={describeElement(element)} />
        {selectedId && <Badge badge={{ label: selectedArt?.meta?.manual ? 'Đã sửa tay' : 'Bản Gemini', tone: 'info' }} />}
        {running ? (
          <>
            <span className="cp-running"><Loader2 size={15} className="spinning" /> Gemini đang viết…</span>
            <button type="button" className="btn-g cp-small" onClick={() => void cancelRun(campaignId).then(onChanged).catch(e => onError(errorMessage(e)))}>
              <Square size={13} /> Hủy
            </button>
          </>
        ) : (
          <button type="button" className={`${needsRun ? 'btn-p' : 'btn-g'} cp-small`} disabled={busy || blocked} onClick={() => void onRun(stepKey)}
                  title={planSummary(plan) || undefined}>
            <Sparkles size={14} /> {needsRun ? runLabel : 'Viết lại'}
          </button>
        )}
        </div>
      </header>

      {extra && <div className="cp-toolbar">{extra}</div>}

      {blocked && <p className="cp-empty">{previewError || 'Chưa đủ đầu vào.'}</p>}
      {!blocked && !selectedId && !running && <p className="cp-empty">Chưa có kết quả.{planSummary(plan) ? ` Lần chạy: ${planSummary(plan)}.` : ''}</p>}
      {incompatible && <p className="cp-note" data-testid={`incompatible-${stepKey}`}>{props.incompatibleNote ?? 'Kết quả này không đọc được trong giao diện hiện tại.'}</p>}
      {lastError && <p className="cp-error-inline">Lần chạy gần nhất lỗi: {lastError}</p>}
      {stale && <p className="cp-note">Đổi: {element!.reasons.map(reasonText).join(', ')}. Kết quả cũ vẫn giữ cho tới khi bạn viết lại hoặc sửa tay.</p>}

      {general.length > 0 && (general.length <= 2
        ? <div className="cp-riskline">{warnList}</div>
        : <div className="cp-folds"><Fold title={`${general.length} cảnh báo`} meta={general[0].message} testId={`warnings-${stepKey}`}><div className="cp-riskline">{warnList}</div></Fold></div>)}

      {draft && children({ draft, update: fn => setDraft(d => (d ? fn(d) : d)), disabled: running || saving, warnings })}

      <Fold title="Nâng cao: prompt gửi Gemini" className="cp-fold-quiet"
            meta={params.prompt?.template_id && params.prompt.template_id !== defaultTemplateId ? 'đang dùng mẫu riêng' : 'mặc định'}>
        <PromptEditor campaignId={campaignId} stepKey={stepKey} kind={kind} defaultTemplateId={defaultTemplateId}
                      prompt={params.prompt} onChanged={onChanged} onError={onError} />
        {previewError && <p className="cp-empty">{previewError}</p>}
        {preview && <pre className="cp-pre">{preview.prompt}</pre>}
      </Fold>

      {dirty
        ? <SaveBar label="Lưu chỉnh sửa" saving={saving} disabled={running} onSave={() => void save()} onUndo={() => setDraft(saved)}
                   note={warnings.length ? 'Cảnh báo tính lại sau khi lưu.' : undefined} />
        : saved && <p className="cp-note">Mỗi lần lưu tạo một phiên bản mới; bản cũ vẫn giữ ({versions} phiên bản).</p>}
    </section>
  )
}
