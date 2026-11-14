import { useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import {
  GARMENT_REF_LABEL, HOOK_TYPE_LABEL, LEGACY_SCRIPT_MSG, MOTION_LABEL, ROLE_LABEL, adaptScriptDoc, beatsFor, countSyllables, linesToList, listToLines,
  maxSyllables, sceneItems, sceneName,
} from '../services/campaignView.ts'
import type { ArtifactView, CampaignState, GarmentRef, Motion, ScriptDoc, ScriptShot } from '../types.ts'
import { AutoText } from './Common.tsx'
import { PlanStepShell } from './PlanStepShell.tsx'

interface Props {
  campaignId: string
  state: CampaignState
  artifacts: ArtifactView[]
  busy: boolean
  onChanged: () => Promise<void>
  onRun: (target: string) => Promise<void>
  onError: (message: string) => void
}

const DURATIONS = Array.from({ length: 13 }, (_, i) => i + 3)
const MOTIONS: Motion[] = ['minimal', 'gentle', 'free']
const MOTION_RANK: Record<Motion, number> = { minimal: 0, gentle: 1, free: 2 }

const syl = (text: string, max: number, unit: string) => {
  const n = countSyllables(text)
  return <span className={n > max ? 'cp-over' : 'cp-muted'}>{n}/{max} {unit}</span>
}

/** Khối 3 (dưới): kịch bản một lượt Gemini theo khung format: hook, beat từng shot, lời thoại, chữ, caption. Sửa tay từng shot. */
export function ScriptPanel(props: Props) {
  const steps = props.state.blocks.flatMap(b => b.steps)
  const scenes = sceneItems(steps.find(s => s.key === 'scene_set')?.params)
  const language = String(steps.find(s => s.key === 'brief')?.params.language ?? 'vi')
  const unit = language === 'vi' ? 'âm tiết' : 'từ'
  const [selected, setSelected] = useState('')

  return (
    <PlanStepShell<ScriptDoc> {...props} stepKey="script" kind="script" defaultTemplateId="system:script_v3" title="Kịch bản" runLabel="Viết kịch bản"
      adapt={adaptScriptDoc} incompatibleNote={LEGACY_SCRIPT_MSG}
      ownWarnings={w => w.where.startsWith('shot:')}
      hint="Gemini xem cast sheet đã duyệt rồi điền hook, beat (hành động từng nhịp), lời thoại và chữ vào khung format. Số shot, thời lượng, máy quay do format đặt; bạn sửa từng shot được.">
      {({ draft, update, disabled, warnings }) => {
        const items = draft.items
        const idx = Math.max(0, items.findIndex(s => s.key === selected))
        const s = items[idx]
        const patch = (key: string, fields: Partial<ScriptShot>) => update(d => ({ ...d, items: d.items.map(x => (x.key === key ? { ...x, ...fields } : x)) }))
        const shotWarn = (key: string) => warnings.filter(w => w.where === key || w.where.startsWith(`${key} `))
        const cap = (draft.motion_limit ?? 'free') as Motion
        return (
          <>
            <div className="cp-form cp-form-2">
              <label className="cp-field"><span>Ý tưởng (một câu)</span>
                <input className="cp-input" disabled={disabled} value={draft.angle_vi ?? ''} onChange={e => update(d => ({ ...d, angle_vi: e.target.value }))} /></label>
              <div className="cp-form cp-form-2">
                <label className="cp-field"><span>Kiểu hook</span>
                  <select disabled={disabled} value={draft.hook?.type ?? 'direct'} onChange={e => update(d => ({ ...d, hook: { ...d.hook, type: e.target.value } }))}>
                    {Object.entries(HOOK_TYPE_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                  </select></label>
                <label className="cp-field"><span>Chữ mở màn (giây 0–1)</span>
                  <input className="cp-input" disabled={disabled} value={draft.hook?.on_screen_text ?? ''} onChange={e => update(d => ({ ...d, hook: { ...d.hook, on_screen_text: e.target.value } }))} /></label>
              </div>
            </div>

            {s ? (
              <>
                <div className="cp-timeline-wrap">
                  <div className="cp-timeline" role="tablist" aria-label="Các shot">
                    {items.map((x, i) => {
                      const n = shotWarn(x.key).length
                      return (
                        <button key={x.key} type="button" role="tab" aria-selected={i === idx} data-testid={`tl-${x.key}`}
                                className={`cp-tl cp-tl-${x.role} ${i === idx ? 'is-active' : ''}`} style={{ flexGrow: Math.max(3, Number(x.duration) || 3) }}
                                onClick={() => setSelected(x.key)} title={`${x.key} · ${ROLE_LABEL[x.role] ?? x.role} · ${x.duration}s · ${sceneName(scenes, x.scene)}`}>
                          <span className="cp-tl-top"><strong>{i + 1}</strong> {x.duration}s {n > 0 && <span className="cp-tl-warn" aria-label={`${n} cảnh báo`}><AlertTriangle size={11} /> {n}</span>}</span>
                          <span className="cp-tl-sub">{ROLE_LABEL[x.role] ?? x.role} · {sceneName(scenes, x.scene)}</span>
                        </button>
                      )
                    })}
                  </div>
                  <p className="cp-note">Tổng {items.reduce((n, x) => n + Number(x.duration || 0), 0)} giây · {items.length} shot · chuyển động tối đa theo áo: {MOTION_LABEL[cap]}</p>
                </div>

                <div className="cp-shot-editor" data-testid={`plan-${s.key}`}>
                  <div className="cp-row">
                    <strong className="cp-shot-key">{s.key}</strong>
                    <span className="cp-tag">{ROLE_LABEL[s.role] ?? s.role}</span>
                    {!s.needs_face && <span className="cp-tag">không có mặt</span>}
                    <span className="cp-row cp-push">
                      <button type="button" className="btn-g cp-small cp-icon" disabled={idx === 0} onClick={() => setSelected(items[idx - 1].key)} aria-label="Shot trước"><ChevronLeft size={14} /></button>
                      <button type="button" className="btn-g cp-small cp-icon" disabled={idx === items.length - 1} onClick={() => setSelected(items[idx + 1].key)} aria-label="Shot sau"><ChevronRight size={14} /></button>
                    </span>
                  </div>
                  {shotWarn(s.key).length > 0 && <div className="cp-riskline">{shotWarn(s.key).map((w, i) => <span key={i} className="cp-warn-chip"><AlertTriangle size={12} /> {w.message.replace(/^shot:\d+:\s*/, '')}</span>)}</div>}

                  <div className="cp-form cp-form-4">
                    <label className="cp-field"><span>Cảnh</span>
                      <select disabled={disabled} value={s.scene} onChange={e => patch(s.key, { scene: e.target.value })}>
                        {(scenes.length ? scenes : [{ key: s.scene, name: '', place: '' } as any]).map(sc => <option key={sc.key} value={sc.key}>{sceneName(scenes, sc.key)}</option>)}
                      </select></label>
                    <label className="cp-field"><span>Thời lượng</span>
                      <select className="shot-seconds" disabled={disabled} value={s.duration} onChange={e => patch(s.key, { duration: Number(e.target.value) })}>
                        {DURATIONS.map(n => <option key={n} value={n}>{n} giây{n > 10 ? ' (đắt hơn)' : ''}</option>)}
                      </select></label>
                    <label className="cp-field"><span>Chuyển động (tối đa {MOTION_LABEL[cap]})</span>
                      <select disabled={disabled} value={s.motion} onChange={e => patch(s.key, { motion: e.target.value as Motion })}>
                        {MOTIONS.filter(m => MOTION_RANK[m] <= MOTION_RANK[cap]).map(m => <option key={m} value={m}>{MOTION_LABEL[m]}</option>)}
                      </select></label>
                    <label className="cp-field"><span>Ảnh áo dùng cho clip</span>
                      <select disabled={disabled} value={s.garment_ref} onChange={e => patch(s.key, { garment_ref: e.target.value as GarmentRef })}>
                        {Object.entries(GARMENT_REF_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                      </select></label>
                  </div>
                  <div className="cp-form cp-form-4">
                    <label className="cp-field"><span>Góc máy</span>
                      <input className="cp-input" disabled={disabled} value={s.camera?.angle ?? ''} onChange={e => patch(s.key, { camera: { ...s.camera, angle: e.target.value } })} /></label>
                    <label className="cp-field"><span>Ống kính</span>
                      <input className="cp-input" disabled={disabled} value={s.camera?.lens ?? ''} onChange={e => patch(s.key, { camera: { ...s.camera, lens: e.target.value } })} /></label>
                    <label className="cp-field"><span>Chuyển động máy</span>
                      <input className="cp-input" disabled={disabled} value={s.camera?.move ?? ''} onChange={e => patch(s.key, { camera: { ...s.camera, move: e.target.value } })} /></label>
                    <label className="cp-switch cp-field"><span>&nbsp;</span>
                      <span><input type="checkbox" disabled={disabled} checked={s.needs_face} onChange={e => patch(s.key, { needs_face: e.target.checked })} /> thấy mặt</span></label>
                  </div>
                  {s.needs_face && (
                    <label className="cp-field"><span>Biểu cảm người mẫu (tiếng Anh)</span>
                      <input className="cp-input" disabled={disabled} value={s.expression ?? ''} placeholder="vd: warm confident half-smile, glancing at the camera"
                             onChange={e => patch(s.key, { expression: e.target.value })} /></label>
                  )}

                  <div className="cp-field">
                    <span className="cp-field-row">Beat (tiếng Anh, hành động theo thời gian, mỗi beat một thay đổi)
                      <span className={s.beats.length === beatsFor(s.duration) ? 'cp-muted' : 'cp-over'}>{s.beats.length}/{beatsFor(s.duration)} beat nên có</span></span>
                    <ol className="cp-beats-edit cp-beats-plain">
                      {s.beats.map((b, i) => (
                        <li key={i}>
                          <span className="cp-beat-num">{i + 1}</span>
                          <input className="cp-input" aria-label={`Beat ${i + 1}`} disabled={disabled} value={b} onChange={e => patch(s.key, { beats: s.beats.map((x, k) => (k === i ? e.target.value : x)) })} />
                          <button type="button" className="cp-icon-btn is-danger" disabled={disabled || s.beats.length <= 1} onClick={() => patch(s.key, { beats: s.beats.filter((_, k) => k !== i) })} aria-label={`Xóa beat ${i + 1}`} title="Xóa beat"><Trash2 size={13} /></button>
                        </li>
                      ))}
                    </ol>
                    {s.beats.length < 4 && <button type="button" className="cp-link-btn" disabled={disabled} onClick={() => patch(s.key, { beats: [...s.beats, ''] })}><Plus size={13} /> Thêm beat</button>}
                  </div>

                  <div className="cp-form cp-form-2">
                    <label className="cp-field"><span className="cp-field-row">Lời thoại {syl(s.voiceover, maxSyllables(s.duration), unit)}</span>
                      <AutoText label="Lời thoại shot" disabled={disabled} value={s.voiceover} onChange={v => patch(s.key, { voiceover: v })} /></label>
                    <label className="cp-field"><span>Chữ trên màn hình (2–6 từ)</span>
                      <AutoText label="Chữ trên màn hình" disabled={disabled} value={s.on_screen_text} onChange={v => patch(s.key, { on_screen_text: v })} /></label>
                  </div>
                  <p className="cp-note">Sửa lời thoại và chữ không làm “Cũ” clip; sửa cảnh, thời lượng, máy quay, beat, chuyển động hay ảnh áo thì có.</p>
                </div>
              </>
            ) : <p className="cp-empty">Kịch bản chưa có shot nào.</p>}

            <div className="cp-form cp-form-caption">
              <label className="cp-field"><span>Caption bài đăng</span>
                <AutoText label="Caption" minRows={3} disabled={disabled} value={draft.caption ?? ''} onChange={v => update(d => ({ ...d, caption: v }))} /></label>
              <label className="cp-field"><span>Hashtag (mỗi dòng một cái)</span>
                <AutoText label="Hashtag" minRows={3} disabled={disabled} value={listToLines(draft.hashtags)} onChange={v => update(d => ({ ...d, hashtags: linesToList(v) }))} /></label>
              <label className="cp-field cp-wide"><span>Kêu gọi hành động (in lên thẻ kết)</span>
                <input className="cp-input" disabled={disabled} value={draft.cta ?? ''} onChange={e => update(d => ({ ...d, cta: e.target.value }))} /></label>
            </div>
          </>
        )
      }}
    </PlanStepShell>
  )
}
