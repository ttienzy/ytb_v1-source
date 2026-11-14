import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Loader2, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { artifactUrl, reroll, setParams } from '../services/campaignApi.ts'
import { describeElement, errorMessage, progressText, reasonText, sceneItems } from '../services/campaignView.ts'
import type { CampaignState, ElementState, FormatSummary, SceneItem, SuggestResult } from '../types.ts'
import { AutoText, Badge, Fold, RunError, SaveBar } from './Common.tsx'
import { SuggestButton } from './SuggestButton.tsx'

interface Props {
  campaignId: string
  state: CampaignState
  formats: FormatSummary[]
  busy: boolean
  onChanged: () => Promise<void>
  onRun: (target: string, elements?: string[]) => Promise<void>
  onError: (message: string) => void
  onPreview: (src: string) => void
}

const MAX_SCENES = 3
const STYLE_KEYS = ['lighting', 'palette', 'dont']
const SCENE_FIELDS: { key: keyof Omit<SceneItem, 'key'>; label: string; placeholder: string; wide?: boolean }[] = [
  { key: 'name', label: 'Tên cảnh (tiếng Việt)', placeholder: 'vd: Phố buổi chiều' },
  { key: 'place', label: 'Nơi quay (tiếng Anh, một nơi)', placeholder: 'vd: a quiet city sidewalk with blurred shopfronts', wide: true },
  { key: 'time', label: 'Thời điểm', placeholder: 'vd: late afternoon' },
  { key: 'light', label: 'Ánh sáng (hướng, chất)', placeholder: 'vd: warm sun from the left, soft shadows' },
  { key: 'mood', label: 'Không khí', placeholder: 'vd: easy, urban, relaxed' },
  { key: 'action', label: 'Người mẫu làm gì ở đây', placeholder: 'vd: walking slowly toward the camera', wide: true },
]

/** Mẫu cảnh nhanh: nền có chiều sâu + sáng viền để áo trắng không bệt vào tường. Chỉ điền vào ô, bạn vẫn sửa và bấm Lưu. */
const PRESETS: Omit<SceneItem, 'key'>[] = [
  { name: 'Phố hoàng hôn', place: 'a quiet city sidewalk with blurred shopfronts and warm bokeh', time: 'late afternoon, golden hour', light: 'warm low sun from the left, soft rim light on hair and shoulders', mood: 'easy, urban, warm', action: 'walking slowly toward the camera' },
  { name: 'Quán cà phê', place: 'a bright cafe beside a large window, plants and tables out of focus', time: 'morning', light: 'soft side window light from the right', mood: 'calm, cozy', action: 'sitting at the window table, turning toward the camera' },
  { name: 'Studio nền màu', place: 'a studio with a seamless sage-green backdrop and real depth', time: 'any', light: 'soft key light from the front left with a subtle rim light', mood: 'clean, modern', action: 'standing relaxed, shifting weight, looking to camera' },
  { name: 'Ban công chạng vạng', place: 'a rooftop balcony with a softly blurred city skyline', time: 'blue-hour dusk', light: 'cool dusk light with a warm window glow from behind', mood: 'quiet, cinematic', action: 'leaning on the railing, then turning to the camera' },
]

const emptyScene = (i: number): SceneItem => ({ key: `scene:${i + 1}`, name: '', place: '', time: '', light: '', mood: '', action: '' })
const rekey = (list: SceneItem[]): SceneItem[] => list.map((s, i) => ({ ...s, key: `scene:${i + 1}` }))
const same = (a: SceneItem[], b: SceneItem[]) => JSON.stringify(a) === JSON.stringify(b)

/** Khối 2 (dưới): 1–3 cảnh (nơi quay) + phong cách chung; mỗi cảnh một ảnh bối cảnh KHÔNG người (ChatGPT, 0 credit). */
export function ScenesPanel({ campaignId, state, formats, busy, onChanged, onRun, onError, onPreview }: Props) {
  const steps = useMemo(() => state.blocks.flatMap(b => b.steps), [state])
  const sceneStep = steps.find(s => s.key === 'scene_set')
  const styleStep = steps.find(s => s.key === 'style')
  const plateStep = steps.find(s => s.key === 'scene_plate')
  const formatId = String(steps.find(s => s.key === 'format')?.params.format_id ?? '')
  const fmt = formats.find(f => f.id === formatId)
  const savedScenes = useMemo(() => sceneItems(sceneStep?.params), [sceneStep?.params])
  const savedStyle: Record<string, string> = useMemo(() => Object.fromEntries(STYLE_KEYS.map(k => [k, String(styleStep?.params[k] ?? '')])), [styleStep?.params])
  const savedKey = JSON.stringify([savedScenes, savedStyle])

  const [scenes, setScenes] = useState<SceneItem[]>(savedScenes)
  const [style, setStyle] = useState<Record<string, string>>(savedStyle)
  const [saving, setSaving] = useState(false)
  const [suggestNote, setSuggestNote] = useState('')
  useEffect(() => { const [sc, st] = JSON.parse(savedKey); setScenes(sc); setStyle(st) }, [savedKey])

  const running = !!state.active_exec || (plateStep?.elements ?? []).some(e => e.active_run)
  const dirty = !same(scenes, savedScenes) || STYLE_KEYS.some(k => (style[k] ?? '') !== (savedStyle[k] ?? ''))
  const plateOf = (key: string): ElementState | undefined => plateStep?.elements.find(e => e.element_key === key)

  const save = async () => {
    setSaving(true)
    try {
      await setParams(campaignId, 'scene_set', { items: rekey(scenes).map(s => ({ ...s, name: s.name.trim(), place: s.place.trim(), time: s.time.trim(), light: s.light.trim(), mood: s.mood.trim(), action: s.action.trim() })) })
      await setParams(campaignId, 'style', Object.fromEntries(STYLE_KEYS.map(k => [k, (style[k] ?? '').trim() || null])))
      await onChanged()
    } catch (e) { onError(errorMessage(e)) } finally { setSaving(false) }
  }
  const patch = (i: number, fields: Partial<SceneItem>) => setScenes(list => list.map((s, k) => (k === i ? { ...s, ...fields } : s)))
  const add = (preset?: Omit<SceneItem, 'key'>) => setScenes(list => (list.length >= MAX_SCENES ? list : rekey([...list, { ...(preset ?? emptyScene(list.length)), key: '' }])))
  const remove = (i: number) => setScenes(list => rekey(list.filter((_, k) => k !== i)))

  const onSuggest = (r: SuggestResult) => {
    const items: any[] = Array.isArray(r.suggestion.items) ? r.suggestion.items : []
    setScenes(list => {
      const next = [...list]
      items.forEach((it, i) => {
        const cur = next[i] ?? emptyScene(i)
        next[i] = { ...cur, ...Object.fromEntries(SCENE_FIELDS.map(f => [f.key, (cur[f.key] ?? '').trim() || String(it[f.key] ?? '')])) }
      })
      return rekey(next.slice(0, MAX_SCENES))
    })
    setStyle(st => ({ ...st, ...Object.fromEntries(STYLE_KEYS.map(k => [k, (st[k] ?? '').trim() || String(r.suggestion[k] ?? '')])) }))
    setSuggestNote([r.note, 'Đã điền các ô trống; kiểm tra rồi bấm Lưu.'].filter(Boolean).join(' '))
  }

  const needPlates = savedScenes.filter(s => { const el = plateOf(s.key); return el && (el.state === 'missing' || el.state === 'stale') })
  const sceneHint = fmt ? `Format “${fmt.name_vi}” cần ${fmt.scenes} cảnh` : 'Chọn format ở khối 3 để biết cần mấy cảnh'

  return (
    <section className="cp-card" data-testid="scenes-panel">
      <header className="cp-card-head">
        <div className="cp-head-title">
          <h3>Các cảnh (nơi quay) và phong cách</h3>
          <span className="cp-head-sub">{sceneHint} · mỗi cảnh một nơi, một ánh sáng. Ảnh bối cảnh không có người là tham chiếu bối cảnh của khung chốt và clip.</span>
        </div>
        <div className="cp-head-actions">
          <SuggestButton campaignId={campaignId} step="scene_set" state={state} onResult={onSuggest} onError={onError} />
          {!running && needPlates.length > 0 && !dirty && (
            <button type="button" className="btn-p cp-small" disabled={busy} onClick={() => void onRun('scene_plate')}>
              <Sparkles size={13} /> Tạo {needPlates.length} ảnh bối cảnh
            </button>
          )}
        </div>
      </header>

      {scenes.length < MAX_SCENES && (
        <div className="cp-presets" data-testid="scene-presets" role="group" aria-label="Mẫu cảnh nhanh">
          {PRESETS.map(p => (
            <button key={p.name} type="button" className="cp-preset" onClick={() => add(p)} title="Thêm cảnh này">
              <strong><Plus size={11} /> {p.name}</strong><small>{p.time} · {p.mood}</small>
            </button>
          ))}
          <button type="button" className="cp-preset" onClick={() => add()}><strong><Plus size={11} /> Cảnh trống</strong><small>tự điền</small></button>
        </div>
      )}
      {fmt && savedScenes.length < fmt.scenes && <p className="cp-warn"><AlertTriangle size={13} /> Mới có {savedScenes.length}/{fmt.scenes} cảnh; shot thiếu cảnh sẽ dùng cảnh 1.</p>}

      <ul className="cp-stack" aria-label="Danh sách cảnh">
        {scenes.map((s, i) => {
          const el = plateOf(s.key)
          const saved = savedScenes[i] && same([savedScenes[i]], [s])
          const img = el?.selected_artifact_id
          return (
            <li key={s.key} className="cp-scene" data-testid={`scene-${s.key}`}>
              <div className="cp-scene-plate">
                {img
                  ? <button type="button" className="cp-scene-img" onClick={() => onPreview(artifactUrl(img))} title="Xem lớn"><img src={artifactUrl(img)} alt={`Bối cảnh ${s.key}`} loading="lazy" /></button>
                  : <div className="cp-placeholder cp-scene-img">{el?.active_run ? <><Loader2 size={16} className="spinning" /> {progressText(el.progress)}</> : 'Chưa có ảnh bối cảnh'}</div>}
                <div className="cp-row">
                  {el && <Badge badge={describeElement(el)} />}
                  {saved && el && !el.active_run && (
                    <button type="button" className="btn-g cp-small" disabled={busy || running || dirty}
                            onClick={() => void (img ? reroll(campaignId, 'scene_plate', s.key).then(() => onRun('scene_plate', [s.key])).catch(e => onError(errorMessage(e))) : onRun('scene_plate', [s.key]))}>
                      {img ? <><RefreshCw size={12} /> Tạo lại</> : <><Sparkles size={12} /> Tạo ảnh</>}
                    </button>
                  )}
                </div>
              </div>
              <div className="cp-scene-form">
                <div className="cp-row">
                  <strong className="cp-shot-key">Cảnh {i + 1}</strong>
                  <button type="button" className="cp-icon-btn is-danger cp-push" disabled={running} onClick={() => remove(i)} aria-label={`Xóa cảnh ${i + 1}`} title="Xóa cảnh"><Trash2 size={14} /></button>
                </div>
                <div className="cp-form cp-form-3">
                  {SCENE_FIELDS.map(f => (
                    <label key={f.key} className={`cp-field ${f.wide ? 'cp-span2' : ''}`}>
                      <span>{f.label}</span>
                      <input className="cp-input" value={s[f.key]} placeholder={f.placeholder} disabled={running} onChange={e => patch(i, { [f.key]: e.target.value })} />
                    </label>
                  ))}
                </div>
              </div>
              {/* Ghi chú/lỗi trải hết bề rộng thẻ cảnh: trước đây nằm trong cột ảnh 150px thành một cột chữ dọc khó đọc. */}
              {(el?.state === 'stale' || el?.last_run?.state === 'error') && !el?.active_run && (
                <div className="cp-scene-msgs">
                  {el?.state === 'stale' && <p className="cp-note">Đổi: {el.reasons.map(reasonText).join(', ')}.</p>}
                  {el?.last_run?.state === 'error' && <RunError prefix="Tạo ảnh bối cảnh lỗi" text={el.last_run.error ?? ''} />}
                </div>
              )}
            </li>
          )
        })}
      </ul>
      {scenes.length === 0 && <p className="cp-empty">Chưa có cảnh nào. Bấm một mẫu ở trên hoặc “Gợi ý bằng Gemini”.</p>}

      <Fold title="Phong cách chung (ánh sáng, bảng màu, luôn tránh)" className="cp-fold-quiet"
            meta={[style.lighting, style.palette].filter(Boolean).join(' · ') || 'mặc định trung tính'}>
        <div className="cp-form cp-form-2">
          <label className="cp-field"><span>Ánh sáng (tiếng Anh)</span>
            <input className="cp-input" value={style.lighting ?? ''} placeholder="vd: soft natural daylight with a gentle rim light" onChange={e => setStyle({ ...style, lighting: e.target.value })} /></label>
          <label className="cp-field"><span>Bảng màu</span>
            <input className="cp-input" value={style.palette ?? ''} placeholder="vd: keep the garment's real white and black" onChange={e => setStyle({ ...style, palette: e.target.value })} /></label>
          <label className="cp-field cp-wide"><span>Luôn tránh</span>
            <AutoText label="Luôn tránh" value={style.dont ?? ''} minRows={2} onChange={v => setStyle({ ...style, dont: v })}
                      placeholder="vd: extra text, other brand logos, heavy filters, altering the garment's logo" /></label>
        </div>
      </Fold>
      {suggestNote && <p className="cp-note">{suggestNote}</p>}
      {dirty
        ? <SaveBar saving={saving} disabled={running} onSave={() => void save()} onUndo={() => { const [sc, st] = JSON.parse(savedKey); setScenes(sc); setStyle(st) }}
                   note="Đổi cảnh chỉ làm cũ ảnh bối cảnh, khung chốt và clip của cảnh đó." />
        : savedScenes.length > 0 && <p className="cp-note">Sửa một cảnh chỉ làm cũ ảnh bối cảnh, khung chốt và clip của cảnh đó; cảnh khác không đổi.</p>}
    </section>
  )
}
