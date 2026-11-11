import { useEffect, useState } from 'react'
import { AlertTriangle, ChevronLeft, ChevronRight, Plus, Trash2 } from 'lucide-react'
import { setParams } from '../services/campaignApi.ts'
import {
  BOARD_LABEL, HOOK_TYPE_LABEL, MOTION_LABEL, ROLE_LABEL, countWords, describeElement, errorMessage, fillEmpty, linesToList, listToLines, maxWords, shotPanels,
} from '../services/campaignView.ts'
import type {
  AngleDoc, ArtifactView, BoardType, CameraMove, CampaignState, Framing, HookDoc, Motion, ScriptDoc, ShotItem, ShotPanel, ShotPlanDoc, SuggestResult,
} from '../types.ts'
import { AutoText, SaveBar } from './Common.tsx'
import { PlanStepShell } from './PlanStepShell.tsx'
import { SuggestButton } from './SuggestButton.tsx'

interface Common {
  campaignId: string
  state: CampaignState
  artifacts: ArtifactView[]
  busy: boolean
  onChanged: () => Promise<void>
  onRun: (target: string) => Promise<void>
  onError: (message: string) => void
}

const words = (text: string, max: number) => {
  const n = countWords(text)
  return <span className={n > max ? 'cp-over' : 'cp-muted'}>{n}/{max} từ</span>
}

// ── Khối 3: thanh con 5 bước, mỗi lần mở một bước ────────────────────────────
const PLAN_TABS: { key: 'brief' | 'angle' | 'hook' | 'shot_plan' | 'script'; label: string }[] = [
  { key: 'brief', label: 'Brief' }, { key: 'angle', label: 'Góc kể' }, { key: 'hook', label: 'Hook' },
  { key: 'shot_plan', label: 'Kịch bản shot' }, { key: 'script', label: 'Lời thoại & caption' },
]
type PlanTab = typeof PLAN_TABS[number]['key']
const tabStoreKey = (cid: string) => `campaign:planTab:${cid}`

export function PlanBlock(props: Common) {
  const steps = props.state.blocks.flatMap(b => b.steps)
  const el = (key: string) => steps.find(s => s.key === key)?.elements[0]
  const firstOpen = (): PlanTab => {
    const todo = PLAN_TABS.find(t => t.key !== 'brief' && ['missing', 'stale'].includes(el(t.key)?.state ?? ''))
    return todo?.key ?? 'shot_plan'
  }
  const [tab, setTab] = useState<PlanTab>(() => {
    try {
      const v = localStorage.getItem(tabStoreKey(props.campaignId)) as PlanTab | null
      if (v && PLAN_TABS.some(t => t.key === v)) return v
    } catch { /* bỏ qua */ }
    return firstOpen()
  })
  const choose = (t: PlanTab) => { setTab(t); try { localStorage.setItem(tabStoreKey(props.campaignId), t) } catch { /* bỏ qua */ } }

  return (
    <div className="cp-plan-block">
      <nav className="cp-subtabs" aria-label="Các bước kế hoạch">
        {PLAN_TABS.map((t, i) => {
          const badge = t.key === 'brief' ? null : describeElement(el(t.key))
          return (
            <button key={t.key} type="button" className={`cp-subtab ${tab === t.key ? 'is-active' : ''}`} aria-current={tab === t.key ? 'step' : undefined}
                    onClick={() => choose(t.key)}>
              <span className="cp-subtab-num">{i + 1}</span>
              <span>{t.label}</span>
              {badge && <span className={`cp-dot cp-dot-${badge.tone}`} title={badge.label} aria-label={badge.label} />}
            </button>
          )
        })}
      </nav>
      {tab === 'brief' && <BriefPanel campaignId={props.campaignId} state={props.state} onChanged={props.onChanged} onError={props.onError} />}
      {tab === 'angle' && <AnglePanel {...props} />}
      {tab === 'hook' && <HookPanel {...props} />}
      {tab === 'shot_plan' && <ShotPlanPanel {...props} />}
      {tab === 'script' && <ScriptPanel {...props} />}
    </div>
  )
}

// ── Brief ─────────────────────────────────────────────────────────────────────
const BRIEF_FIELDS: { key: string; label: string; placeholder: string }[] = [
  { key: 'audience', label: 'Đối tượng', placeholder: 'vd: nữ 18–25, sinh viên, thích phong cách Hàn' },
  { key: 'occasion', label: 'Dịp mặc', placeholder: 'vd: đi học, cafe cuối tuần' },
  { key: 'price', label: 'Giá', placeholder: 'vd: 199k (chỉ nhắc nếu bạn điền)' },
  { key: 'promo', label: 'Khuyến mãi', placeholder: 'vd: mua 2 giảm 20k' },
]

export function BriefPanel({ campaignId, state, onChanged, onError }: Pick<Common, 'campaignId' | 'state' | 'onChanged' | 'onError'>) {
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
    const { next, filled } = fillEmpty(draft, r.suggestion, BRIEF_FIELDS.map(f => f.key))
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
        ? <SaveBar saving={saving} onSave={() => void save()} onUndo={() => { setDraft(JSON.parse(savedJson)); setSuggested([]) }} note="Đổi brief làm góc kể, shot và lời thoại thành “Cũ”." />
        : <p className="cp-note">Đổi brief sẽ làm góc kể, shot và lời thoại thành “Cũ”; kết quả cũ không bị xóa.</p>}
    </section>
  )
}

// ── Góc kể ────────────────────────────────────────────────────────────────────
export function AnglePanel(props: Common) {
  return (
    <PlanStepShell<AngleDoc> {...props} stepKey="angle" title="Góc kể" runLabel="Đề xuất góc kể"
      hint="4 góc kể xếp theo rủi ro của áo (áo khó thì góc cần xoay người bị hạ điểm). Hook và kịch bản shot dùng góc bạn chọn.">
      {({ draft, update, disabled }) => (
        <ul className="cp-cards" role="radiogroup" aria-label="Góc kể">
          {draft.items.map((a, i) => (
            <li key={a.key}>
              <label className={`cp-choice ${draft.chosen === a.key ? 'is-selected' : ''}`}>
                <input type="radio" name="angle" disabled={disabled} checked={draft.chosen === a.key}
                       onChange={() => update(d => ({ ...d, chosen: a.key }))} />
                <span className="cp-choice-head">
                  <span className="cp-rank">#{i + 1}</span>
                  <strong>{a.title_vi || a.id}</strong>
                </span>
                <span className="cp-choice-body">{a.pitch_vi}</span>
                <span className="cp-row">
                  <span className="cp-tag">chuyển động: {MOTION_LABEL[a.needs_motion] ?? a.needs_motion}</span>
                </span>
                {a.risk_note && <span className="cp-note">{a.risk_note}</span>}
              </label>
            </li>
          ))}
        </ul>
      )}
    </PlanStepShell>
  )
}

// ── Hook ──────────────────────────────────────────────────────────────────────
export function HookPanel(props: Common) {
  const step = props.state.blocks.flatMap(b => b.steps).find(s => s.key === 'hook')
  const count = Number(step?.params.count || 5)
  const extra = (
    <>
      <label className="cp-label" htmlFor="hook-count">Số hook</label>
      <select id="hook-count" value={count} onChange={e => void setParams(props.campaignId, 'hook', { count: Number(e.target.value) }).then(props.onChanged).catch(err => props.onError(errorMessage(err)))}>
        {[1, 2, 3, 4, 5].map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <span className="cp-note">Mỗi hook 3–6 giây, mỗi cái một kiểu.</span>
    </>
  )
  return (
    <PlanStepShell<HookDoc> {...props} stepKey="hook" title="Hook (3–6 giây đầu)" runLabel="Viết hook" extra={extra}
      hint="Shot 1 sẽ thể hiện đúng hook bạn chọn; đổi hook làm kịch bản shot thành “Cũ”. Chỉ hook đang chọn mở ô sửa.">
      {({ draft, update, disabled }) => {
        const chosen = draft.chosen ?? draft.items[0]?.key
        const patch = (key: string, fields: Partial<HookDoc['items'][number]>) =>
          update(d => ({ ...d, items: d.items.map(x => (x.key === key ? { ...x, ...fields } : x)) }))
        return (
          <ul className="cp-stack" role="radiogroup" aria-label="Hook">
            {draft.items.map(h => {
              const on = chosen === h.key
              return (
                <li key={h.key} className={`cp-choice ${on ? 'is-selected' : ''}`} data-testid={`hook-${h.key}`}>
                  <label className="cp-choice-head">
                    <input type="radio" name="hook" disabled={disabled} checked={on} onChange={() => update(d => ({ ...d, chosen: h.key }))} />
                    <strong>{h.key}</strong>
                    <span className="cp-tag">{HOOK_TYPE_LABEL[h.type] ?? h.type}</span><span className="cp-tag">{h.seconds}s</span>
                    {h.needs_unavailable_visual && <span className="cp-tag cp-tag-warn" title="Chỉ có một bộ đồ trong ảnh nên hình sẽ không khớp lời.">hứa biến hình: hình không thể hiện được</span>}
                    {!on && <span className="cp-choice-quote">“{h.voiceover}”</span>}
                  </label>
                  {on && (
                    <div className="cp-form cp-form-2">
                      <label className="cp-field cp-wide"><span className="cp-field-row">Lời thoại {words(h.voiceover, maxWords(h.seconds))}</span>
                        <AutoText label="Lời thoại hook" disabled={disabled} value={h.voiceover} onChange={v => patch(h.key, { voiceover: v })} /></label>
                      <label className="cp-field"><span>Chữ trên màn hình</span>
                        <input className="cp-input" disabled={disabled} value={h.on_screen_text} onChange={e => patch(h.key, { on_screen_text: e.target.value })} /></label>
                      <label className="cp-field"><span>Hình ảnh (tiếng Anh)</span>
                        <input className="cp-input" disabled={disabled} value={h.visual} onChange={e => patch(h.key, { visual: e.target.value })} /></label>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )
      }}
    </PlanStepShell>
  )
}

// ── Kịch bản shot ─────────────────────────────────────────────────────────────
const BOARD_HELP: Record<BoardType, string> = {
  hero_walk: 'người mẫu đi về phía máy', turn_reveal: 'xoay để thấy trước, hông, sau', pose_sequence: 'nhiều dáng, cắt cảnh trong clip',
  detail_macro: 'cận một chi tiết, không có mặt', fabric_touch: 'tay hoặc gió làm vải chuyển động, không có mặt', still_life: 'chỉ có áo, không người', closer_cta: 'toàn bộ trang phục, chờ chữ kêu gọi',
}
const FRAMING_LABEL: Record<Framing, string> = { wide: 'Toàn cảnh', medium: 'Trung cảnh', closeup: 'Cận cảnh' }
const CAMERA_MOVE_LABEL: Record<CameraMove, string> = {
  static: 'Đứng yên', push_in: 'Đẩy vào', pull_out: 'Kéo ra', pan: 'Lia ngang', orbit: 'Xoay quanh',
}
const DURATIONS = Array.from({ length: 13 }, (_, i) => i + 3)
const NO_FACE_BOARDS: string[] = ['detail_macro', 'fabric_touch', 'still_life']
const panelTarget = (seconds: number) => (seconds <= 5 ? 2 : seconds <= 10 ? 3 : 4)

export function ShotPlanPanel(props: Common) {
  const step = props.state.blocks.flatMap(b => b.steps).find(s => s.key === 'shot_plan')
  const shots = Number(step?.params.shots || 0)
  const total = Number(step?.params.total_seconds || 20)
  const [selected, setSelected] = useState('')
  const set = (params: Record<string, unknown>) =>
    void setParams(props.campaignId, 'shot_plan', params).then(props.onChanged).catch(err => props.onError(errorMessage(err)))
  const extra = (
    <>
      <label className="cp-label" htmlFor="shot-total">Tổng thời lượng</label>
      <select id="shot-total" value={total} onChange={e => set({ total_seconds: Number(e.target.value) })}>
        {[15, 20, 30, 45, 60].map(n => <option key={n} value={n}>{n} giây</option>)}
      </select>
      <label className="cp-label" htmlFor="shot-count">Số shot</label>
      <select id="shot-count" value={shots} onChange={e => set({ shots: Number(e.target.value) || null })}>
        <option value={0}>Tự đề xuất (khoảng {Math.max(2, Math.min(8, Math.round(total / 5)))})</option>
        {[1, 2, 3, 4, 5, 6, 7, 8].map(n => <option key={n} value={n}>{n}</option>)}
      </select>
      <label className="cp-label" htmlFor="shot-motion-limit">Chuyển động</label>
      <select id="shot-motion-limit" value={String(step?.params.motion_limit ?? '')} onChange={e => set({ motion_limit: e.target.value || null })}>
        <option value="">Theo hồ sơ áo</option>
        <option value="minimal">Tối thiểu</option>
        <option value="gentle">Nhẹ nhàng</option>
        <option value="free">Tự do (bước đi, xoay người)</option>
      </select>
    </>
  )
  const patch = (update: (fn: (d: ShotPlanDoc) => ShotPlanDoc) => void, key: string, fields: Partial<ShotItem>) =>
    update(d => ({ ...d, items: d.items.map(x => (x.key === key ? { ...x, ...fields } : x)) }))

  return (
    <PlanStepShell<ShotPlanDoc> {...props} stepKey="shot_plan" title="Kịch bản shot và storyboard" runLabel="Đề xuất kịch bản" extra={extra}
      ownWarnings={w => w.where.startsWith('shot:')}
      hint="Gemini xem ảnh mẫu rồi chia shot. Mỗi nhịp là một khung storyboard (khối 5) và một mốc thời gian trong prompt clip (khối 6). Shot 3–10 giây rẻ nhất; từ giây 11 giá gấp đôi.">
      {({ draft, update, disabled, warnings }) => {
        const items = draft.items
        const sum = items.reduce((n, s) => n + Number(s.duration || 0), 0)
        const idx = Math.max(0, items.findIndex(s => s.key === selected))
        const s = items[idx]
        if (!s) return <p className="cp-empty">Kế hoạch chưa có shot nào.</p>
        const shotWarn = (key: string) => warnings.filter(w => w.where === key || w.where.startsWith(`${key}.`))
        const panels = shotPanels(s) as ShotPanel[]
        const setPanels = (next: ShotPanel[]) => patch(update, s.key, { panels: next })
        const myWarn = shotWarn(s.key)
        return (
          <>
            <div className="cp-timeline-wrap">
              <div className="cp-timeline" role="tablist" aria-label="Các shot">
                {items.map((x, i) => {
                  const n = shotWarn(x.key).length
                  return (
                    <button key={x.key} type="button" role="tab" aria-selected={i === idx} data-testid={`tl-${x.key}`}
                            className={`cp-tl cp-tl-${x.role} ${i === idx ? 'is-active' : ''}`} style={{ flexGrow: Math.max(3, Number(x.duration) || 3) }}
                            onClick={() => setSelected(x.key)} title={`${x.key} · ${ROLE_LABEL[x.role] ?? x.role} · ${x.duration}s`}>
                      <span className="cp-tl-top"><strong>{i + 1}</strong> {x.duration}s {n > 0 && <span className="cp-tl-warn" aria-label={`${n} cảnh báo`}><AlertTriangle size={11} /> {n}</span>}</span>
                      <span className="cp-tl-sub">{BOARD_LABEL[x.board_type] ?? ROLE_LABEL[x.role]}</span>
                    </button>
                  )
                })}
              </div>
              <p className={`cp-note ${Math.abs(sum - total) > 3 ? 'cp-over' : ''}`}>Tổng {sum} giây / mục tiêu {total} giây · {items.length} shot</p>
            </div>

            <div className="cp-shot-editor" data-testid={`plan-${s.key}`}>
              <div className="cp-row">
                <strong className="cp-shot-key">{s.key}</strong>
                <span className="cp-tag">{ROLE_LABEL[s.role] ?? s.role}</span>
                {s.face_policy === 'none' && <span className="cp-tag">không có mặt</span>}
                {s.motion_adjusted && <span className="cp-tag cp-tag-warn">chuyển động đã hạ</span>}
                <span className="cp-row cp-push">
                  <button type="button" className="btn-g cp-small cp-icon" disabled={idx === 0} onClick={() => setSelected(items[idx - 1].key)} aria-label="Shot trước"><ChevronLeft size={14} /></button>
                  <button type="button" className="btn-g cp-small cp-icon" disabled={idx === items.length - 1} onClick={() => setSelected(items[idx + 1].key)} aria-label="Shot sau"><ChevronRight size={14} /></button>
                </span>
              </div>
              {myWarn.length > 0 && <div className="cp-riskline">{myWarn.map((w, i) => <span key={i} className="cp-warn-chip"><AlertTriangle size={12} /> {w.message.replace(/^shot:\d+:\s*/, '')}</span>)}</div>}

              <div className="cp-form cp-form-4">
                <label className="cp-field"><span>Kiểu storyboard</span>
                  <select disabled={disabled} value={s.board_type ?? 'hero_walk'} onChange={e => patch(update, s.key, { board_type: e.target.value as BoardType })}>
                    {(Object.keys(BOARD_HELP) as BoardType[]).map(b => <option key={b} value={b}>{BOARD_LABEL[b]}</option>)}
                  </select></label>
                <label className="cp-field"><span>Thời lượng</span>
                  <select className="shot-seconds" disabled={disabled} value={s.duration} onChange={e => patch(update, s.key, { duration: Number(e.target.value) })}>
                    {DURATIONS.map(n => <option key={n} value={n}>{n} giây{n > 10 ? ' (đắt hơn)' : ''}</option>)}
                  </select></label>
                <label className="cp-field"><span>Máy quay</span>
                  <select disabled={disabled} value={s.camera_move ?? 'static'} onChange={e => patch(update, s.key, { camera_move: e.target.value as CameraMove })}>
                    {(Object.keys(CAMERA_MOVE_LABEL) as CameraMove[]).map(c => <option key={c} value={c}>{CAMERA_MOVE_LABEL[c]}</option>)}
                  </select></label>
                <label className="cp-field"><span>Chuyển động (tối đa {MOTION_LABEL[draft.motion_limit] ?? draft.motion_limit})</span>
                  <select disabled={disabled} value={s.motion} onChange={e => patch(update, s.key, { motion: e.target.value as Motion })}>
                    {(['minimal', 'gentle', 'free'] as Motion[]).map(m => <option key={m} value={m}>{MOTION_LABEL[m]}</option>)}
                  </select></label>
              </div>
              <p className="cp-note">{BOARD_LABEL[s.board_type]}: {BOARD_HELP[s.board_type] ?? ''}.</p>
              {!NO_FACE_BOARDS.includes(s.board_type) && (
                <label className="cp-field"><span>Biểu cảm người mẫu (tiếng Anh)</span>
                  <input className="cp-input" disabled={disabled} value={s.expression ?? ''} placeholder="vd: warm confident half-smile, glancing at the camera"
                         onChange={e => patch(update, s.key, { expression: e.target.value })} /></label>
              )}

              <div className="cp-field">
                <span className="cp-field-row">Các nhịp storyboard (tiếng Anh, mỗi nhịp một thay đổi)
                  <span className={panels.length === panelTarget(s.duration) ? 'cp-muted' : 'cp-over'}>{panels.length}/{panelTarget(s.duration)} nhịp nên có</span></span>
                <ol className="cp-beats-edit">
                  {panels.map((p, i) => (
                    <li key={i}>
                      <span className="cp-beat-num">{i + 1}</span>
                      <select aria-label={`Cỡ cảnh nhịp ${i + 1}`} disabled={disabled} value={p.framing} onChange={e => setPanels(panels.map((x, k) => (k === i ? { ...x, framing: e.target.value as Framing } : x)))}>
                        {(Object.keys(FRAMING_LABEL) as Framing[]).map(f => <option key={f} value={f}>{FRAMING_LABEL[f]}</option>)}
                      </select>
                      <input className="cp-input" aria-label={`Nhịp ${i + 1}`} disabled={disabled} value={p.action} onChange={e => setPanels(panels.map((x, k) => (k === i ? { ...x, action: e.target.value } : x)))} />
                      <button type="button" className="cp-icon-btn is-danger" disabled={disabled || panels.length <= 1} onClick={() => setPanels(panels.filter((_, k) => k !== i))} aria-label={`Xóa nhịp ${i + 1}`} title="Xóa nhịp"><Trash2 size={13} /></button>
                    </li>
                  ))}
                </ol>
                {panels.length < 4 && <button type="button" className="cp-link-btn" disabled={disabled} onClick={() => setPanels([...panels, { framing: 'medium', action: '' }])}><Plus size={13} /> Thêm nhịp</button>}
              </div>

              <div className="cp-form cp-form-2">
                <label className="cp-field"><span className="cp-field-row">Lời thoại {words(s.voiceover, maxWords(s.duration))}</span>
                  <AutoText label="Lời thoại shot" disabled={disabled} value={s.voiceover} onChange={v => patch(update, s.key, { voiceover: v })} /></label>
                <label className="cp-field"><span>Chữ trên màn hình</span>
                  <AutoText label="Chữ trên màn hình" disabled={disabled} value={s.on_screen_text} onChange={v => patch(update, s.key, { on_screen_text: v })} /></label>
              </div>
              <p className="cp-note">Sửa lời thoại không làm “Cũ” ảnh và clip; sửa nhịp, kiểu storyboard hay thời lượng thì có.</p>
            </div>
          </>
        )
      }}
    </PlanStepShell>
  )
}

// ── Lời thoại & caption ───────────────────────────────────────────────────────
export function ScriptPanel(props: Common) {
  return (
    <PlanStepShell<ScriptDoc> {...props} stepKey="script" title="Lời thoại, caption, hashtag" runLabel="Viết lời thoại"
      hint="Bản chữ cuối của từng shot cùng caption và hashtag. Có cảnh báo lời chứng giả, điều “không được nói” và khẳng định chính hãng khi áo có logo của bên khác.">
      {({ draft, update, disabled }) => (
        <>
          <div className="cp-script" role="table" aria-label="Lời thoại từng shot">
            <div className="cp-script-row cp-script-head" role="row">
              <span role="columnheader">Shot</span><span role="columnheader">Lời thoại</span><span role="columnheader">Chữ trên màn hình</span>
            </div>
            {draft.items.map((it, i) => (
              <div key={`${it.shot}-${i}`} className="cp-script-row" role="row">
                <strong role="cell">{it.shot || 'shot'}</strong>
                <span role="cell"><AutoText label={`Lời thoại ${it.shot}`} minRows={1} disabled={disabled} value={it.voiceover}
                  onChange={v => update(d => ({ ...d, items: d.items.map((x, k) => (k === i ? { ...x, voiceover: v } : x)) }))} /></span>
                <span role="cell"><AutoText label={`Chữ trên màn hình ${it.shot}`} minRows={1} disabled={disabled} value={it.on_screen_text}
                  onChange={v => update(d => ({ ...d, items: d.items.map((x, k) => (k === i ? { ...x, on_screen_text: v } : x)) }))} /></span>
              </div>
            ))}
          </div>
          <div className="cp-form cp-form-caption">
            <label className="cp-field"><span>Caption bài đăng</span>
              <AutoText label="Caption" minRows={3} disabled={disabled} value={draft.caption} onChange={v => update(d => ({ ...d, caption: v }))} /></label>
            <label className="cp-field"><span>Hashtag (mỗi dòng một cái)</span>
              <AutoText label="Hashtag" minRows={3} disabled={disabled} value={listToLines(draft.hashtags)} onChange={v => update(d => ({ ...d, hashtags: linesToList(v) }))} /></label>
            <label className="cp-field cp-wide"><span>Kêu gọi hành động</span>
              <input className="cp-input" disabled={disabled} value={draft.cta} onChange={e => update(d => ({ ...d, cta: e.target.value }))} /></label>
          </div>
        </>
      )}
    </PlanStepShell>
  )
}
