import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Save, ScanSearch, Square, Undo2 } from 'lucide-react'
import { cancelRun, editArtifact, fetchArtifactJson, planRun, previewStepPrompt } from '../services/campaignApi.ts'
import {
  MOTION_TEXT, PATTERN_LABEL, describeElement, errorMessage, linesToList, listToLines, planSummary, reasonText, riskBadge,
} from '../services/campaignView.ts'
import type { ArtifactView, CampaignState, FactSheet, Plan, PromptPreview } from '../types.ts'
import { AutoText, Badge, Fold } from './Common.tsx'
import { PromptEditor } from './PromptEditor.tsx'

interface Props {
  campaignId: string
  state: CampaignState
  artifacts: ArtifactView[]
  busy: boolean
  onChanged: () => Promise<void>
  onRun: (target: string) => Promise<void>
  onError: (message: string) => void
}

const TEXT_FIELDS: { key: keyof FactSheet; label: string }[] = [
  { key: 'category', label: 'Loại sản phẩm' }, { key: 'color', label: 'Màu' }, { key: 'material', label: 'Chất liệu (nhìn thấy)' },
  { key: 'fit', label: 'Form' }, { key: 'length', label: 'Độ dài' }, { key: 'neckline', label: 'Cổ áo' },
  { key: 'sleeves', label: 'Tay áo' }, { key: 'sizes', label: 'Size' },
]

const EMPTY: FactSheet = {
  category: '', color: '', material: '', fit: '', length: '', neckline: '', sleeves: '', pattern: 'other',
  logo_present: false, logo_text: '', details: [], sizes: '', summary: '', summary_vi: '', do_not_say: [],
}

const firstLine = (items: string[]) => (items[0] ? `${items[0]}${items.length > 1 ? ' …' : ''}` : '')

/** Khối 1: hồ sơ áo do Gemini trích từ ảnh thật, sửa tay được; điểm rủi ro tính lại ở backend khi lưu. */
export function FactSheetPanel({ campaignId, state, artifacts, busy, onChanged, onRun, onError }: Props) {
  const step = state.blocks.flatMap(b => b.steps).find(s => s.key === 'fact_sheet')
  const element = step?.elements[0]
  const params = step?.params ?? {}
  const selectedId = element?.selected_artifact_id ?? null
  const selectedArt = artifacts.find(a => a.id === selectedId)
  const running = !!state.active_exec || !!element?.active_run

  const [saved, setSaved] = useState<FactSheet | null>(null)
  const [draft, setDraft] = useState<FactSheet>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [plan, setPlan] = useState<Plan | null>(null)
  const [preview, setPreview] = useState<PromptPreview | null>(null)
  const [previewError, setPreviewError] = useState('')

  useEffect(() => {
    let alive = true
    if (!selectedId) { setSaved(null); setDraft(EMPTY); return }
    fetchArtifactJson<FactSheet>(selectedId)
      .then(d => { if (alive) { setSaved(d); setDraft({ ...EMPTY, ...d }) } })
      .catch(e => onError(errorMessage(e)))
    return () => { alive = false }
  }, [selectedId, onError])

  const inputKey = state.blocks.flatMap(b => b.steps).find(s => s.key === 'garment_source')?.elements[0]?.selected_artifact_id
  const refreshKey = JSON.stringify([params, inputKey, selectedId, element?.state])
  useEffect(() => {
    let alive = true
    if (element?.blockers.length) {            // thiếu đầu vào: không gọi mạng, báo luôn lý do
      setPreview(null)
      setPreviewError('Chưa đủ đầu vào: ' + element.blockers.map(b => `${b.dep}: ${b.reason}`).join('; '))
      setPlan(null)
      return
    }
    previewStepPrompt(campaignId, 'fact_sheet')
      .then(p => { if (alive) { setPreview(p); setPreviewError('') } })
      .catch(e => { if (alive) { setPreview(null); setPreviewError(errorMessage(e)) } })
    planRun(campaignId, 'fact_sheet').then(p => { if (alive) setPlan(p) }).catch(() => { if (alive) setPlan(null) })
    return () => { alive = false }
  }, [campaignId, refreshKey])

  const dirty = useMemo(() => !!saved && JSON.stringify({ ...EMPTY, ...saved, risk: undefined }) !== JSON.stringify({ ...draft, risk: undefined }), [saved, draft])
  const set = <K extends keyof FactSheet>(key: K, value: FactSheet[K]) => setDraft(d => ({ ...d, [key]: value }))

  const save = async () => {
    setSaving(true)
    try {
      const { risk: _risk, ...content } = draft
      await editArtifact(campaignId, 'fact_sheet', content)
      await onChanged()
    } catch (e) { onError(errorMessage(e)) } finally { setSaving(false) }
  }

  const blocked = element?.state === 'blocked' && !selectedId
  const stale = element?.state === 'stale'
  const needsRun = !selectedId || stale
  const lastError = element?.last_run?.state === 'error' ? element.last_run.error : ''
  const risk = saved?.risk
  const versions = artifacts.filter(a => a.step_key === 'fact_sheet').length

  return (
    <section className="cp-card" data-testid="fact-sheet">
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>Hồ sơ áo</h3>
          <span className="cp-head-sub">Gemini đọc từ ảnh thật · nguồn sự thật cho mọi bước sau</span>
        </div>
        <div className="cp-head-actions">
        <Badge badge={describeElement(element)} />
        {selectedId && <Badge badge={{ label: selectedArt?.meta?.manual ? 'Đã sửa tay' : 'Bản Gemini', tone: 'info' }} />}
        {running ? (
          <>
            <span className="cp-running"><Loader2 size={15} className="spinning" /> Gemini đang phân tích…</span>
            <button type="button" className="btn-g cp-small" onClick={() => void cancelRun(campaignId).then(onChanged).catch(e => onError(errorMessage(e)))}>
              <Square size={13} /> Hủy
            </button>
          </>
        ) : (
          <button type="button" className={`${needsRun ? 'btn-p' : 'btn-g'} cp-small`} disabled={busy || blocked} onClick={() => void onRun('fact_sheet')}
                  title={planSummary(plan) || undefined}>
            <ScanSearch size={14} /> {!selectedId ? 'Phân tích bằng Gemini' : stale ? 'Phân tích lại (đầu vào đã đổi)' : 'Phân tích lại'}
          </button>
        )}
        </div>
      </header>

      {blocked && <p className="cp-empty">Tải và lưu ảnh sản phẩm ở bên trái, rồi bấm “Phân tích bằng Gemini”.</p>}
      {!blocked && !selectedId && !running && <p className="cp-empty">Chưa có hồ sơ. {planSummary(plan) ? `Phân tích sẽ chạy: ${planSummary(plan)}.` : ''}</p>}
      {lastError && <p className="cp-error-inline">Lần chạy gần nhất lỗi: {lastError}</p>}
      {stale && <p className="cp-note">Đổi: {element!.reasons.map(reasonText).join(', ')}. Hồ sơ hiện tại vẫn giữ cho tới khi bạn phân tích lại hoặc sửa tay.</p>}

      {saved && (
        <>
          <div className="cp-riskline">
            <Badge badge={riskBadge(risk?.level)} />
            {risk && <span className="cp-plan">{MOTION_TEXT[risk.motion_limit]}{risk.logo_rule === 'reference_only' ? ' · logo chỉ lấy từ ảnh thật' : ''}</span>}
            {risk?.reasons.map(r => <span key={r} className="cp-warn-chip"><AlertTriangle size={12} /> {r}</span>)}
          </div>

          <div className="cp-form cp-form-dense">
            {TEXT_FIELDS.map(f => (
              <label key={f.key} className="cp-field">
                <span>{f.label}</span>
                <input className="cp-input" value={String(draft[f.key] ?? '')} onChange={e => set(f.key, e.target.value as never)} />
              </label>
            ))}
            <label className="cp-field">
              <span>Họa tiết</span>
              <select value={draft.pattern} onChange={e => set('pattern', e.target.value)}>
                {Object.entries(PATTERN_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </label>
            <label className="cp-field cp-span2">
              <span className="cp-field-row">
                Chữ/logo đúng như in (và vị trí)
                <span className="cp-inline-check">
                  <input type="checkbox" checked={draft.logo_present} onChange={e => set('logo_present', e.target.checked)} aria-label="Có logo / chữ in" /> có logo
                </span>
              </span>
              <input className="cp-input" value={draft.logo_text} disabled={!draft.logo_present} onChange={e => set('logo_text', e.target.value)} />
            </label>
          </div>

          <div className="cp-folds">
            <Fold title="Quảng cáo KHÔNG được nói" meta={draft.do_not_say.length ? `${draft.do_not_say.length} ý · ${firstLine(draft.do_not_say)}` : 'chưa có'} testId="fold-dont-say">
              <AutoText label="Quảng cáo không được nói, mỗi dòng một ý" value={listToLines(draft.do_not_say)} onChange={v => set('do_not_say', linesToList(v))} minRows={3} />
              <p className="cp-note">Mỗi dòng một ý. Kịch bản, lời thoại và chữ trên video sẽ tránh các ý này.</p>
            </Fold>
            <Fold title="Chi tiết sản phẩm" meta={draft.details.length ? `${draft.details.length} chi tiết · ${firstLine(draft.details)}` : 'chưa có'} testId="fold-details">
              <AutoText label="Chi tiết, mỗi dòng một ý" value={listToLines(draft.details)} onChange={v => set('details', linesToList(v))} minRows={3} />
            </Fold>
            <Fold title="Mô tả" meta={draft.summary_vi || draft.summary} testId="fold-summary">
              <div className="cp-form cp-form-2">
                <label className="cp-field">
                  <span>Tiếng Việt</span>
                  <AutoText label="Mô tả tiếng Việt" value={draft.summary_vi} onChange={v => set('summary_vi', v)} />
                </label>
                <label className="cp-field">
                  <span>Tiếng Anh (dùng trong prompt ảnh/video)</span>
                  <AutoText label="Mô tả tiếng Anh" value={draft.summary} onChange={v => set('summary', v)} />
                </label>
              </div>
            </Fold>
          </div>
        </>
      )}

      <Fold title="Nâng cao: prompt gửi Gemini" meta={params.prompt?.template_id && params.prompt.template_id !== 'system:fact_sheet' ? 'đang dùng mẫu riêng' : 'mặc định'} className="cp-fold-quiet">
        <PromptEditor campaignId={campaignId} stepKey="fact_sheet" kind="fact_sheet" defaultTemplateId="system:fact_sheet"
                      prompt={params.prompt} onChanged={onChanged} onError={onError} />
        {previewError && <p className="cp-empty">{previewError}</p>}
        {preview && <pre className="cp-pre">{preview.prompt}</pre>}
      </Fold>

      {dirty ? (
        <div className="cp-savebar" role="status">
          <span className="cp-dirty">Có thay đổi chưa lưu</span>
          <span className="cp-note">Điểm rủi ro tính lại sau khi lưu.</span>
          <button type="button" className="btn-g cp-small" disabled={saving} onClick={() => saved && setDraft({ ...EMPTY, ...saved })}><Undo2 size={13} /> Hoàn tác</button>
          <button type="button" className="btn-p cp-small" disabled={saving || running} onClick={() => void save()}>
            {saving ? <Loader2 size={13} className="spinning" /> : <Save size={13} />} Lưu chỉnh sửa
          </button>
        </div>
      ) : saved && (
        <p className="cp-note">Mỗi lần lưu tạo một phiên bản mới; bản cũ vẫn giữ ({versions} phiên bản).</p>
      )}
    </section>
  )
}
