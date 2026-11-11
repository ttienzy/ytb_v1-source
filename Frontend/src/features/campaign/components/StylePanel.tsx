import { useEffect, useState } from 'react'
import { setParams } from '../services/campaignApi.ts'
import { errorMessage, fillEmpty } from '../services/campaignView.ts'
import type { CampaignState, SuggestResult } from '../types.ts'
import { AutoText, Fold, SaveBar } from './Common.tsx'
import { SuggestButton } from './SuggestButton.tsx'

interface Props {
  campaignId: string
  state: CampaignState
  onChanged: () => Promise<void>
  onError: (message: string) => void
}

const SHORT_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'lighting', label: 'Ánh sáng', placeholder: 'vd: soft natural window light, golden hour' },
  { key: 'background', label: 'Nền', placeholder: 'vd: minimal studio, grey seamless backdrop' },
  { key: 'palette', label: 'Bảng màu', placeholder: 'vd: warm neutrals, off-white, navy accent' },
]
const KEYS = ['master_scene', ...SHORT_FIELDS.map(f => f.key), 'dont']

/** Mẫu nhanh: nền có chiều sâu + sáng viền để áo trắng không bệt vào tường xám. Chỉ điền vào ô, bạn vẫn sửa và bấm Lưu. */
const PRESETS: { label: string; desc: string; lighting: string; background: string; master_scene: string }[] = [
  { label: 'Đường phố hoàng hôn', desc: 'nắng chiều, phố mờ phía sau', lighting: 'warm golden-hour sun with a soft rim light on hair and shoulders', background: 'a real city street with blurred shopfronts and warm bokeh, clearly separated from the subject', master_scene: 'late afternoon on one quiet city sidewalk, blurred shopfronts, warm golden-hour sun from the left' },
  { label: 'Quán cà phê cửa sổ', desc: 'sáng cửa sổ, cây xanh mờ', lighting: 'soft side window light with gentle contrast', background: 'a cafe interior beside a window, out-of-focus plants and tables', master_scene: 'inside one bright cafe beside a large window, soft side light from the right, plants out of focus' },
  { label: 'Studio nền màu', desc: 'nền xanh xám/be, sáng viền', lighting: 'clean soft key light with a subtle colored rim light', background: 'a seamless sage-green or warm-beige backdrop that contrasts with the white outfit', master_scene: 'one studio with a seamless sage-green backdrop, soft key light from the front left, subtle rim light' },
  { label: 'Ban công chạng vạng', desc: 'trời xanh tím, đèn ấm', lighting: 'blue-hour dusk light with a warm window glow', background: 'a balcony or rooftop with a softly blurred city skyline', master_scene: 'one rooftop at blue-hour dusk, softly blurred city skyline, warm window glow from behind' },
]

/** Phong cách chung của chiến dịch. Là tham số (Gemini chỉ gợi ý điền, không tự lưu); dùng ở kế hoạch/storyboard/clip. */
export function StylePanel({ campaignId, state, onChanged, onError }: Props) {
  const step = state.blocks.flatMap(b => b.steps).find(s => s.key === 'style')
  const saved: Record<string, string> = step?.params ?? {}
  const [draft, setDraft] = useState<Record<string, string>>(saved)
  const [saving, setSaving] = useState(false)
  const [suggested, setSuggested] = useState<string[]>([])
  const [suggestNote, setSuggestNote] = useState('')
  const savedJson = JSON.stringify(saved)
  useEffect(() => { setDraft(JSON.parse(savedJson)); setSuggested([]) }, [savedJson])

  const onSuggest = (r: SuggestResult) => {
    const { next, filled } = fillEmpty(draft, r.suggestion, KEYS)
    setDraft(next)
    setSuggested(filled)
    setSuggestNote([r.note, filled.length ? `Đã điền ${filled.length} ô, hãy kiểm tra rồi bấm Lưu.` : 'Không có ô trống nào được điền thêm.'].filter(Boolean).join(' '))
  }
  const edit = (key: string, value: string) => { setDraft(d => ({ ...d, [key]: value })); setSuggested(s => s.filter(k => k !== key)) }
  const cls = (key: string) => (suggested.includes(key) ? 'cp-suggested' : '')

  const dirty = KEYS.some(k => (draft[k] ?? '') !== (saved[k] ?? ''))
  const save = async () => {
    setSaving(true)
    try {
      await setParams(campaignId, 'style', Object.fromEntries(KEYS.map(k => [k, (draft[k] ?? '').trim() || null])))
      await onChanged()
    } catch (e) { onError(errorMessage(e)) } finally { setSaving(false) }
  }
  const dontCount = (draft.dont ?? '').split(/\n|,/).map(x => x.trim()).filter(Boolean).length
  const activePreset = PRESETS.find(p => p.master_scene === draft.master_scene)?.label

  return (
    <section className="cp-card" data-testid="style-panel">
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>Phong cách chung</h3>
          <span className="cp-head-sub">Một nơi quay, một kiểu ánh sáng cho mọi storyboard và clip</span>
        </div>
        <SuggestButton campaignId={campaignId} step="style" state={state} onResult={onSuggest} onError={onError} />
      </header>

      <div className="cp-presets" data-testid="style-presets" role="group" aria-label="Mẫu nhanh">
        {PRESETS.map(p => (
          <button key={p.label} type="button" className={`cp-preset ${activePreset === p.label ? 'is-active' : ''}`}
                  onClick={() => { setDraft(d => ({ ...d, lighting: p.lighting, background: p.background, master_scene: p.master_scene })); setSuggested([]) }}>
            <strong>{p.label}</strong><small>{p.desc}</small>
          </button>
        ))}
      </div>
      <p className="cp-note">Áo trắng trên tường xám phẳng dễ bị bệt: nên chọn nền có chiều sâu. Mẫu chỉ điền vào ô, bạn vẫn sửa được.</p>

      <label className="cp-field">
        <span>Bối cảnh chung của cả video (tiếng Anh)</span>
        <AutoText label="Bối cảnh chung" className={cls('master_scene')} value={draft.master_scene ?? ''} onChange={v => edit('master_scene', v)}
                  placeholder="vd: sunny late afternoon outside a concrete cafe, warm light, 85mm" />
      </label>
      <div className="cp-form cp-form-3">
        {SHORT_FIELDS.map(f => (
          <label key={f.key} className="cp-field">
            <span>{f.label}</span>
            <input className={`cp-input ${cls(f.key)}`} value={draft[f.key] ?? ''} placeholder={f.placeholder} onChange={e => edit(f.key, e.target.value)} />
          </label>
        ))}
      </div>
      <div className="cp-folds">
        <Fold title="Luôn tránh" meta={dontCount ? `${dontCount} ý · ${(draft.dont ?? '').split('\n')[0]}` : 'chưa có'} defaultOpen={suggested.includes('dont')}>
          <AutoText label="Luôn tránh" className={cls('dont')} value={draft.dont ?? ''} onChange={v => edit('dont', v)} minRows={3}
                    placeholder="vd: no extra text, no brand logos other than the product, no heavy filters" />
        </Fold>
      </div>
      {suggestNote && <p className="cp-note">{suggestNote}</p>}
      {dirty && <SaveBar saving={saving} onSave={() => void save()} onUndo={() => { setDraft(JSON.parse(savedJson)); setSuggested([]) }} />}
    </section>
  )
}
