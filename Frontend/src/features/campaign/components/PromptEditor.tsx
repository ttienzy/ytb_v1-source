import { useCallback, useEffect, useRef, useState } from 'react'
import { Copy, Lock, RotateCcw, Save, Trash2 } from 'lucide-react'
import { createPrompt, deletePrompt, listPrompts, setParams, updatePrompt } from '../services/campaignApi.ts'
import { errorMessage } from '../services/campaignView.ts'
import type { PromptTemplate } from '../types.ts'

interface Props {
  campaignId: string
  stepKey: string
  kind: string
  defaultTemplateId: string
  /** params.prompt hiện tại của bước: { template_id?, version?, changes? } */
  prompt: { template_id?: string; version?: number; changes?: string } | undefined
  onChanged: () => Promise<void>
  onError: (message: string) => void
}

/** Chọn / nhân bản / sửa mẫu prompt của một bước + ô "thay đổi tùy chọn". Sửa mẫu = tạo phiên bản mới. */
export function PromptEditor({ campaignId, stepKey, kind, defaultTemplateId, prompt, onChanged, onError }: Props) {
  const [templates, setTemplates] = useState<PromptTemplate[]>([])
  const [bodyDraft, setBodyDraft] = useState('')
  const [nameDraft, setNameDraft] = useState('')
  const [changes, setChanges] = useState(prompt?.changes ?? '')
  const [busy, setBusy] = useState(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const currentId = prompt?.template_id || defaultTemplateId
  const current = templates.find(t => t.template_id === currentId)

  const reload = useCallback(async () => {
    try { setTemplates(await listPrompts(kind)) } catch (e) { onError(errorMessage(e)) }
  }, [kind, onError])
  useEffect(() => { void reload() }, [reload])

  // Đổi mẫu hoặc phiên bản -> nạp lại bản nháp để sửa
  useEffect(() => {
    setBodyDraft(current?.body ?? '')
    setNameDraft(current?.name ?? '')
  }, [current?.template_id, current?.version, current?.body, current?.name])

  // Đổi bước/chiến dịch -> đồng bộ ô thay đổi
  useEffect(() => { setChanges(prompt?.changes ?? '') }, [campaignId, prompt?.changes])

  const saveParams = useCallback(async (next: { template_id: string; changes: string }) => {
    try {
      await setParams(campaignId, stepKey, { prompt: next })
      await onChanged()
    } catch (e) { onError(errorMessage(e)) }
  }, [campaignId, stepKey, onChanged, onError])

  const onChangesInput = (value: string) => {
    setChanges(value)
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => { void saveParams({ template_id: currentId, changes: value }) }, 700)
  }
  useEffect(() => () => clearTimeout(saveTimer.current), [])

  const select = (id: string) => saveParams({ template_id: id, changes })

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { onError(errorMessage(e)) } finally { setBusy(false) }
  }

  const clone = () => run(async () => {
    if (!current) return
    const t = await createPrompt({ name: `${current.name} (của tôi)`, kind, base_id: current.template_id })
    await reload()
    await select(t.template_id)
  })

  const saveVersion = () => run(async () => {
    if (!current || current.read_only) return
    await updatePrompt(current.template_id, { name: nameDraft.trim() || current.name, body: bodyDraft })
    await reload()
    await onChanged()                       // phiên bản mới => bước thành "Cũ" nếu bản trước đã chạy
  })

  const remove = () => run(async () => {
    if (!current || current.read_only) return
    if (!window.confirm(`Xóa mẫu “${current.name}”? (Ảnh đã tạo bằng mẫu này vẫn được giữ.)`)) return
    await deletePrompt(current.template_id)
    await reload()
    await select(defaultTemplateId)
  })

  const bodyChanged = !!current && !current.read_only && bodyDraft !== current.body
  const nameChanged = !!current && !current.read_only && nameDraft.trim() !== current.name

  return (
    <div className="cp-prompt">
      <div className="cp-row">
        <label className="cp-label" htmlFor={`tpl-${stepKey}`}>Mẫu prompt</label>
        <select id={`tpl-${stepKey}`} value={currentId} onChange={e => void select(e.target.value)} disabled={busy}>
          {templates.map(t => (
            <option key={t.template_id} value={t.template_id}>
              {t.name}{t.read_only ? ' (mặc định)' : ''} · v{t.version}
            </option>
          ))}
        </select>
        <button type="button" className="btn-g cp-small" onClick={() => void clone()} disabled={busy || !current}>
          <Copy size={13} /> Nhân bản để sửa
        </button>
        {currentId !== defaultTemplateId && (
          <button type="button" className="btn-g cp-small" onClick={() => void select(defaultTemplateId)} disabled={busy}>
            <RotateCcw size={13} /> Về mặc định
          </button>
        )}
      </div>

      {current?.read_only ? (
        <details className="cp-details">
          <summary><Lock size={12} /> Xem nội dung mẫu mặc định (chỉ đọc)</summary>
          <pre className="cp-pre">{current.body}</pre>
        </details>
      ) : current ? (
        <div className="cp-editor">
          <input className="cp-input" value={nameDraft} onChange={e => setNameDraft(e.target.value)} aria-label="Tên mẫu" />
          <textarea className="cp-textarea cp-mono" value={bodyDraft} rows={14} spellCheck={false}
                    onChange={e => setBodyDraft(e.target.value)} aria-label="Nội dung mẫu prompt" />
          <div className="cp-row">
            <button type="button" className="btn-p cp-small" onClick={() => void saveVersion()} disabled={busy || (!bodyChanged && !nameChanged)}>
              <Save size={13} /> Lưu phiên bản mới
            </button>
            <button type="button" className="btn-g cp-small" onClick={() => void remove()} disabled={busy}>
              <Trash2 size={13} /> Xóa mẫu
            </button>
            <span className="cp-note">Mỗi lần lưu tạo phiên bản mới; bản cũ vẫn giữ. Dùng {'{{changes}}'} / {'{{#changes}}…{{/changes}}'} cho ô thay đổi tùy chọn.</span>
          </div>
        </div>
      ) : null}

      <label className="cp-label" htmlFor={`chg-${stepKey}`}>Thay đổi tùy chọn</label>
      <textarea id={`chg-${stepKey}`} className="cp-textarea" rows={2} value={changes}
                placeholder="Chỉ ghi điều bạn muốn KHÁC ảnh tham chiếu, ví dụ: change hairstyle to short black layered hair. Để trống nếu không đổi gì."
                onChange={e => onChangesInput(e.target.value)} />
    </div>
  )
}
