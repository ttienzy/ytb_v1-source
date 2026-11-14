import { useEffect, useState } from 'react'
import { Check } from 'lucide-react'
import { setParams } from '../services/campaignApi.ts'
import { HOOK_TYPE_LABEL, ROLE_LABEL, errorMessage, fillEmpty } from '../services/campaignView.ts'
import type { CampaignState, FormatSummary, SuggestResult } from '../types.ts'
import { SaveBar } from './Common.tsx'
import { SuggestButton } from './SuggestButton.tsx'

interface Common {
  campaignId: string
  state: CampaignState
  onChanged: () => Promise<void>
  onError: (message: string) => void
}

// ── Brief ─────────────────────────────────────────────────────────────────────
const BRIEF_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'audience', label: 'Đối tượng', placeholder: 'vd: nữ 18–25, sinh viên, thích phong cách Hàn' },
  { key: 'occasion', label: 'Dịp mặc', placeholder: 'vd: đi học, cafe cuối tuần' },
  { key: 'price', label: 'Giá', placeholder: 'vd: 199k (chỉ nhắc nếu bạn điền)' },
  { key: 'promo', label: 'Khuyến mãi', placeholder: 'vd: mua 2 giảm 20k' },
]

export function BriefPanel({ campaignId, state, onChanged, onError }: Common) {
  const step = state.blocks.flatMap(b => b.steps).find(s => s.key === 'brief')
  const saved: Record<string, string> = step?.params ?? {}
  const savedJson = JSON.stringify(saved)
  const [draft, setDraft] = useState<Record<string, string>>(saved)
  const [saving, setSaving] = useState(false)
  const [suggested, setSuggested] = useState<string[]>([])
  const [suggestNote, setSuggestNote] = useState('')
  useEffect(() => { setDraft(JSON.parse(savedJson)); setSuggested([]) }, [savedJson])

  const keys = [...BRIEF_FIELDS.map(f => f.key), 'language', 'platform']
  const onSuggest = (r: SuggestResult) => {
    const { next, filled } = fillEmpty(draft, r.suggestion as Record<string, string>, BRIEF_FIELDS.map(f => f.key))
    setDraft(next)
    setSuggested(filled)
    const left = BRIEF_FIELDS.filter(f => !(next[f.key] ?? '').trim()).map(f => f.label)
    setSuggestNote([r.note, filled.length ? `Đã điền ${filled.length} ô, hãy kiểm tra rồi bấm Lưu.` : 'Không có ô trống nào được điền thêm.',
      left.length ? `Còn trống: ${left.join(', ')}.` : ''].filter(Boolean).join(' '))
  }
  const dirty = keys.some(k => (draft[k] ?? '') !== (saved[k] ?? ''))
  const save = async () => {
    setSaving(true)
    try {
      await setParams(campaignId, 'brief', Object.fromEntries(keys.map(k => [k, (draft[k] ?? '').trim() || null])))
      await onChanged()
    } catch (e) { onError(errorMessage(e)) } finally { setSaving(false) }
  }

  return (
    <section className="cp-card" data-testid="step-brief">
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>Brief</h3>
          <span className="cp-head-sub">Thông tin bán hàng. Giá và khuyến mãi chỉ được nhắc khi bạn điền; Gemini không tự đoán.</span>
        </div>
        <SuggestButton campaignId={campaignId} step="brief" state={state} onResult={onSuggest} onError={onError} />
      </header>
      <div className="cp-form cp-form-3">
        {BRIEF_FIELDS.map(f => (
          <label key={f.key} className="cp-field">
            <span>{f.label}</span>
            <input className={`cp-input ${suggested.includes(f.key) ? 'cp-suggested' : ''}`} value={draft[f.key] ?? ''} placeholder={f.placeholder}
                   onChange={e => { setDraft({ ...draft, [f.key]: e.target.value }); setSuggested(s => s.filter(k => k !== f.key)) }} />
          </label>
        ))}
        <label className="cp-field">
          <span>Ngôn ngữ lời thoại</span>
          <select value={draft.language ?? 'vi'} onChange={e => setDraft({ ...draft, language: e.target.value })}>
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="cp-field">
          <span>Nền tảng đăng</span>
          <select value={draft.platform ?? 'tiktok'} onChange={e => setDraft({ ...draft, platform: e.target.value })}>
            <option value="tiktok">TikTok</option>
            <option value="reels">Facebook / Instagram Reels</option>
            <option value="shopee">Shopee Video</option>
          </select>
        </label>
      </div>
      {suggestNote && <p className="cp-note">{suggestNote}</p>}
      {dirty
        ? <SaveBar saving={saving} onSave={() => void save()} onUndo={() => { setDraft(JSON.parse(savedJson)); setSuggested([]) }} note="Đổi brief làm kịch bản thành “Cũ”." />
        : <p className="cp-note">Đổi brief sẽ làm kịch bản thành “Cũ”; kết quả cũ không bị xóa.</p>}
    </section>
  )
}

// ── Format ────────────────────────────────────────────────────────────────────
interface FormatProps extends Common {
  formats: FormatSummary[]
  busy: boolean
}

/** Chọn format quảng cáo: bản thiết kế có sẵn (số cảnh, shot, giây, máy quay). Kịch bản chỉ điền nội dung vào khung này. */
export function FormatPanel({ campaignId, state, formats, busy, onChanged, onError }: FormatProps) {
  const step = state.blocks.flatMap(b => b.steps).find(s => s.key === 'format')
  const current = String(step?.params.format_id ?? '')
  const running = !!state.active_exec
  const choose = (id: string) => void setParams(campaignId, 'format', { format_id: id }).then(onChanged).catch(e => onError(errorMessage(e)))
  const chosen = formats.find(f => f.id === current)

  return (
    <section className="cp-card" data-testid="format-panel">
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>Format quảng cáo</h3>
          <span className="cp-head-sub">Chọn kiểu video người xem đang quen; số shot, thời lượng và máy quay đi theo format. Đổi format làm kịch bản thành “Cũ”.</span>
        </div>
      </header>
      {formats.length === 0 && <p className="cp-empty">Không tải được danh sách format (backend cũ?).</p>}
      <ul className="cp-cards" role="radiogroup" aria-label="Format quảng cáo">
        {formats.map(f => {
          const on = f.id === current
          return (
            <li key={f.id}>
              <label className={`cp-choice ${on ? 'is-selected' : ''}`} data-testid={`format-${f.id}`}>
                <input type="radio" name="format" disabled={busy || running} checked={on} onChange={() => choose(f.id)} />
                <span className="cp-choice-head">
                  {on && <Check size={14} strokeWidth={3} />}
                  <strong>{f.name_vi}</strong>
                </span>
                <span className="cp-choice-body">{f.desc_vi}</span>
                <span className="cp-row">
                  <span className="cp-tag">{f.scenes} cảnh</span><span className="cp-tag">{f.shots} shot</span><span className="cp-tag">≈{f.total_seconds} giây</span>
                </span>
                {f.best_for_vi && <span className="cp-note">Hợp: {f.best_for_vi}</span>}
              </label>
            </li>
          )
        })}
      </ul>
      {chosen && (
        <div className="cp-folds">
          <details className="cp-fold cp-fold-quiet">
            <summary><span className="cp-fold-title">Khung shot của “{chosen.name_vi}”</span><span className="cp-fold-meta">hook {chosen.hook_types.map(t => HOOK_TYPE_LABEL[t] ?? t).join(' / ')}</span></summary>
            <div className="cp-fold-body">
              <ol className="cp-beat-list" aria-label="Khung shot">
                {chosen.shot_list.map((s, i) => (
                  <li key={i}><span className="cp-beat-num">{i + 1}</span><span className="cp-tag">{ROLE_LABEL[s.role] ?? s.role}</span>
                    <span>cảnh {s.scene} · {s.duration}s · {s.camera.angle}, {s.camera.lens}, {s.camera.move}{s.needs_face ? '' : ' · không có mặt'}</span></li>
                ))}
              </ol>
            </div>
          </details>
        </div>
      )}
      {!current && formats.length > 0 && <p className="cp-note">Chưa chọn thì kịch bản dùng “{formats[0].name_vi}”.</p>}
    </section>
  )
}
