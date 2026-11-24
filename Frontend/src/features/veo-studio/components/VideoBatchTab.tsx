import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowDown, ArrowUp, ClipboardPaste, ImagePlus, Loader2, Plus, Trash2, X } from 'lucide-react'
import type { VeoCapabilities, VeoJobOut } from '../types'
import * as api from '../services/veoApi'
import type { VideoBatch, VideoBatchImage, VideoBatchRequest, VideoBatchSettings } from '../services/videoBatchTypes'
import { parseVideoBatchPrompts, VIDEO_PROMPT_MAX_LENGTH, type BatchPromptSeparator } from '../services/batchPrompts'
import './videoBatchTab.css'

interface DraftRow {
  id: string
  image?: VideoBatchImage
  prompt: string
  references: VideoBatchImage[]
}

export interface ForwardedBatchImage {
  image: VideoBatchImage
  prompt: string
}

interface Props {
  projectId: string
  capabilities: VeoCapabilities | null
  forwarded: ForwardedBatchImage | null
  onConsumeForwarded: () => void
  onVideoDone: () => void
  onPreviewJob: (job: VeoJobOut) => void
}

const DEFAULT_SETTINGS: VideoBatchSettings = { aspect_ratio: '16:9', resolution: '720p', duration_seconds: 10 }
const BATCH_LABELS = { queued: 'Đang chờ', running: 'Đang chạy', paused: 'Đã tạm dừng', done: 'Đã kết thúc' }
const ROW_LABELS = { queued: 'Đang chờ', running: 'Đang gửi', done: 'Hoàn tất', error: 'Lỗi' }
const PROMPT_PLACEHOLDERS: Record<BatchPromptSeparator, string> = {
  line: 'Dán một prompt trên mỗi dòng…',
  paragraph: 'Dán prompt nhiều dòng, chừa một dòng trống giữa hai prompt…',
  numbered: '1. Prompt cho ảnh thứ nhất\n2. Prompt cho ảnh thứ hai\n3. Prompt cho ảnh thứ ba',
}

function pendingRequest(key: string): VideoBatchRequest | null {
  try {
    const saved = JSON.parse(window.localStorage.getItem(key) ?? 'null') as VideoBatchRequest | null
    return saved && typeof saved.batch_id === 'string' && Array.isArray(saved.items) && saved.items.length ? saved : null
  }
  catch { return null }
}

function FilePicker({ children, disabled, multiple, onFiles }: {
  children: ReactNode
  disabled?: boolean
  multiple?: boolean
  onFiles: (files: File[]) => void
}) {
  const input = useRef<HTMLInputElement>(null)
  return (
    <>
      <button type="button" className="veo-batch-secondary" disabled={disabled} onClick={() => input.current?.click()}>{children}</button>
      <input ref={input} hidden type="file" accept=".png,.jpg,.jpeg,.webp" multiple={multiple} onChange={(event) => {
        const files = Array.from(event.currentTarget.files ?? [])
        event.currentTarget.value = ''
        if (files.length) onFiles(files)
      }} />
    </>
  )
}

async function uploadAsset(file: File): Promise<VideoBatchImage> {
  const result = await api.uploadImage(file)
  return { source: 'upload', id: result.file_id, name: file.name }
}

const newRow = (prompt = ''): DraftRow => ({ id: crypto.randomUUID(), prompt, references: [] })

export function VideoBatchTab({ projectId, capabilities, forwarded, onConsumeForwarded, onVideoDone, onPreviewJob }: Props) {
  const storageKey = `veo-studio-pending:${projectId}`
  const [pending, setPending] = useState(() => pendingRequest(storageKey))
  const [rows, setRows] = useState<DraftRow[]>(() => pending?.items.map(({ image, prompt, references }) => ({ ...newRow(prompt), image, references })) ?? [])
  const [pasteOpen, setPasteOpen] = useState(false)
  const [pasteText, setPasteText] = useState('')
  const [separator, setSeparator] = useState<BatchPromptSeparator>('line')
  const [replacePrompts, setReplacePrompts] = useState(false)
  const [settings, setSettings] = useState<VideoBatchSettings>(() => pending?.items[0]?.settings ?? DEFAULT_SETTINGS)
  const [batches, setBatches] = useState<VideoBatch[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [uploads, setUploads] = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [batchAction, setBatchAction] = useState(false)
  const [error, setError] = useState('')
  const [listError, setListError] = useState('')
  const revision = useRef(0)
  const requestInFlight = useRef(false)

  const selected = batches.find((batch) => batch.batch_id === selectedId) ?? batches[0]
  const profile = capabilities?.profiles.find((item) => item.model_display_name === 'Omni 1.2 Flash'
    && item.input_mode === 'ingredients' && item.duration_seconds === settings.duration_seconds
    && item.resolution === settings.resolution && item.aspect_ratio === settings.aspect_ratio)
  const complete = rows.length > 0 && rows.every((row) => row.image && row.prompt.trim())
  const editingDisabled = Boolean(pending) || submitting
  const unappliedPaste = pasteOpen && Boolean(pasteText.trim())
  const emptyRows = rows.filter((row) => !row.prompt.trim())
  const pasteTargets = replacePrompts ? rows : emptyRows
  const pasted = parseVideoBatchPrompts(pasteText, separator)
  const tooLong = pasted.findIndex((prompt) => prompt.length > VIDEO_PROMPT_MAX_LENGTH)
  const invalidNumberedList = separator === 'numbered' && Boolean(pasteText.trim()) && pasted.length === 0
  const canApply = !editingDisabled && uploads === 0 && pasted.length > 0 && pasted.length === pasteTargets.length && tooLong === -1
  let pasteStatus = `${pasted.length} prompt / ${pasteTargets.length} mục${replacePrompts ? '' : ' chưa có prompt'}. Ghép theo thứ tự bên dưới.`
  if (invalidNumberedList) pasteStatus = 'Bắt đầu mỗi mục bằng số và dấu chấm, ví dụ “1. Mô tả cảnh”. Mỗi mục cần có prompt.'
  if (tooLong >= 0) pasteStatus = `Prompt ${tooLong + 1} vượt quá ${VIDEO_PROMPT_MAX_LENGTH} ký tự.`

  useEffect(() => {
    if (!forwarded || pending) return
    setRows((previous) => [...previous, { ...newRow(forwarded.prompt.slice(0, VIDEO_PROMPT_MAX_LENGTH)), image: forwarded.image }])
    onConsumeForwarded()
  }, [forwarded, onConsumeForwarded, pending])

  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    const finished = new Set<string>()
    async function poll() {
      const version = revision.current
      try {
        const list = await api.listVideoBatches(projectId, controller.signal)
        if (controller.signal.aborted || version !== revision.current) return
        setBatches(list)
        setListError('')
        let newVideo = false
        for (const batch of list) {
          for (const { job, status } of batch.items) {
            if (status === 'done' && job && !finished.has(job.job_id)) {
              finished.add(job.job_id)
              newVideo = true
            }
          }
        }
        if (newVideo) onVideoDone()
      } catch (e) {
        if (!controller.signal.aborted) setListError(e instanceof Error ? e.message : 'Không tải được hàng đợi video.')
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, 2500)
      }
    }
    void poll()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [projectId, onVideoDone])

  function patchRow(id: string, patch: Partial<DraftRow>) {
    setRows((previous) => previous.map((row) => row.id === id ? { ...row, ...patch } : row))
  }

  function applyPastedPrompts() {
    if (!canApply) return
    const promptsByRow = new Map(pasteTargets.map((row, index) => [row.id, pasted[index]]))
    setRows((previous) => previous.map((row) => {
      const prompt = promptsByRow.get(row.id)
      return prompt === undefined ? row : { ...row, prompt }
    }))
    setPasteText('')
    setPasteOpen(false)
  }

  function moveRow(index: number, direction: -1 | 1) {
    setRows((previous) => {
      const ordered = [...previous]
      const [row] = ordered.splice(index, 1)
      ordered.splice(index + direction, 0, row)
      return ordered
    })
  }

  async function uploadImages(files: File[], apply: (images: VideoBatchImage[]) => void) {
    setError('')
    setUploads((value) => value + 1)
    try {
      const settled = await Promise.allSettled(files.map(uploadAsset))
      apply(settled.flatMap((result) => result.status === 'fulfilled' ? [result.value] : []))
      const failed = settled.flatMap((result, index) => result.status === 'rejected' ? [files[index].name] : [])
      if (failed.length) setError(`Không tải được ảnh: ${failed.join(', ')}.`)
    } finally {
      setUploads((value) => value - 1)
    }
  }

  function trackBatch(batch: VideoBatch) {
    revision.current++
    setBatches((previous) => [batch, ...previous.filter((item) => item.batch_id !== batch.batch_id)])
    setSelectedId(batch.batch_id)
  }

  function rememberRequest(request: VideoBatchRequest | null) {
    setPending(request)
    try {
      if (request) window.localStorage.setItem(storageKey, JSON.stringify(request))
      else window.localStorage.removeItem(storageKey)
    } catch { /* In-memory request still retains the batch ID for this session. */ }
  }

  async function submit() {
    if (requestInFlight.current || uploads || unappliedPaste || (!pending && !complete)) return
    const request = pending ?? {
      batch_id: crypto.randomUUID(), project_id: projectId,
      items: rows.flatMap((row) => row.image ? [{ image: row.image, prompt: row.prompt.trim(), references: row.references, settings }] : []),
    }
    requestInFlight.current = true
    setSubmitting(true)
    setError('')
    rememberRequest(request)
    try {
      const batch = await api.submitVideoBatch(request)
      trackBatch(batch)
      rememberRequest(null)
      setRows([])
      setPasteOpen(false)
      setPasteText('')
    } catch (e) {
      if (e instanceof Error && 'requestRejected' in e && e.requestRejected) {
        rememberRequest(null)
        setError(e.message)
      } else {
        setError('Chưa xác nhận được lô đã vào hàng đợi. Bấm “Kiểm tra lại lô” để dùng lại mã lô hiện tại.')
      }
    } finally {
      requestInFlight.current = false
      setSubmitting(false)
    }
  }

  async function changeBatch(action: 'pause' | 'resume') {
    if (!selected || batchAction) return
    setBatchAction(true)
    setError('')
    try { trackBatch(await api.changeVideoBatch(selected.batch_id, action)) }
    catch (e) { setError(e instanceof Error ? e.message : 'Không cập nhật được lô video.') }
    finally { setBatchAction(false) }
  }

  return (
    <div className="veo-video-batch">
      <section className="veo-batch-settings" aria-label="Cấu hình chung">
        <div className="veo-batch-settings-head"><h3>Cấu hình chung</h3><span>Omni 1.2 Flash</span></div>
        <div className="veo-batch-settings-fields">
          <label>Tỷ lệ<select value={settings.aspect_ratio} disabled={editingDisabled} onChange={(event) => setSettings({ ...settings, aspect_ratio: event.target.value as VideoBatchSettings['aspect_ratio'] })}><option>16:9</option><option>9:16</option></select></label>
          <label>Độ phân giải<select value={settings.resolution} disabled={editingDisabled} onChange={(event) => setSettings({ ...settings, resolution: event.target.value as VideoBatchSettings['resolution'] })}><option value="720p">720p</option><option value="360p">360p Draft</option></select></label>
          <label className="veo-batch-duration"><span>Độ dài <output>{settings.duration_seconds} giây</output></span><input aria-label="Độ dài video" type="range" min={3} max={15} step={1} value={settings.duration_seconds} disabled={editingDisabled} onChange={(event) => setSettings({ ...settings, duration_seconds: event.target.valueAsNumber })} /></label>
        </div>
      </section>

      <section aria-label="Danh sách ảnh và prompt">
        <div className="veo-batch-toolbar">
          <h3>Ảnh và prompt</h3>
          <div className="veo-batch-actions">
            <FilePicker multiple disabled={editingDisabled || uploads > 0} onFiles={(files) => void uploadImages(files, (images) => setRows((previous) => [...previous, ...images.map((image) => ({ ...newRow(), image }))]))}><ImagePlus size={15} /> Thêm ảnh</FilePicker>
            <button type="button" className="veo-batch-secondary" aria-expanded={pasteOpen} disabled={editingDisabled || uploads > 0 || rows.length === 0} onClick={() => {
              if (!pasteOpen) setReplacePrompts(emptyRows.length === 0)
              setPasteOpen(!pasteOpen)
            }}><ClipboardPaste size={15} /> Dán nhiều prompt</button>
            <button type="button" className="veo-batch-secondary" disabled={editingDisabled} onClick={() => setRows((previous) => [...previous, newRow()])}><Plus size={15} /> Thêm mục</button>
          </div>
        </div>
        {rows.length === 0 && !pending && <p className="veo-batch-empty">Thêm ảnh chính, sau đó dán danh sách prompt theo thứ tự ảnh.</p>}
        {pasteOpen && (
          <div className="veo-batch-paste">
            <div className="veo-batch-toolbar">
              <label>Định dạng <select value={separator} onChange={(event) => setSeparator(event.target.value as BatchPromptSeparator)}>
                <option value="line">Mỗi dòng một prompt</option>
                <option value="paragraph">Mỗi đoạn một prompt</option>
                <option value="numbered">Danh sách đánh số</option>
              </select></label>
              {emptyRows.length < rows.length && <label className="veo-batch-paste-replace"><input type="checkbox" checked={replacePrompts} onChange={(event) => setReplacePrompts(event.target.checked)} /> Thay cả prompt đã có</label>}
            </div>
            <textarea autoFocus aria-label="Danh sách prompt" rows={5} value={pasteText} onChange={(event) => setPasteText(event.target.value)} placeholder={PROMPT_PLACEHOLDERS[separator]} />
            <div className="veo-batch-toolbar">
              <p className={invalidNumberedList || (pasted.length > 0 && !canApply) ? 'veo-batch-error' : 'veo-batch-paste-count'} aria-live="polite">{pasteStatus}</p>
              <div className="veo-batch-actions">
                <button type="button" className="veo-batch-secondary" onClick={() => setPasteOpen(false)}>Đóng</button>
                <button type="button" className="veo-batch-primary" disabled={!canApply} onClick={applyPastedPrompts}>{replacePrompts && emptyRows.length < rows.length ? 'Thay prompt' : 'Điền prompt'}</button>
              </div>
            </div>
          </div>
        )}
        <ol className="veo-batch-draft-list">
          {rows.map((row, index) => (
            <li key={row.id} className="veo-batch-draft-row">
              <div className="veo-batch-row-head">
                <strong>Mục {index + 1}</strong>
                <div className="veo-batch-actions">
                  <button className="veo-batch-icon" type="button" aria-label={`Đưa mục ${index + 1} lên`} title="Đưa lên" disabled={editingDisabled || index === 0} onClick={() => moveRow(index, -1)}><ArrowUp size={15} /></button>
                  <button className="veo-batch-icon" type="button" aria-label={`Đưa mục ${index + 1} xuống`} title="Đưa xuống" disabled={editingDisabled || index === rows.length - 1} onClick={() => moveRow(index, 1)}><ArrowDown size={15} /></button>
                  <button className="veo-batch-icon" type="button" aria-label={`Xóa mục ${index + 1}`} title="Xóa mục" disabled={editingDisabled} onClick={() => setRows((previous) => previous.filter((item) => item.id !== row.id))}><Trash2 size={15} /></button>
                </div>
              </div>
              <div className="veo-batch-row-content">
                <div className="veo-batch-main-image">
                  {row.image && <img src={api.videoBatchImageUrl(row.image)} alt={row.image.name || 'Ảnh chính'} />}
                  <FilePicker disabled={editingDisabled || uploads > 0} onFiles={(files) => void uploadImages(files, ([image]) => { if (image) patchRow(row.id, { image }) })}>{row.image ? 'Đổi ảnh chính' : 'Chọn ảnh chính'}</FilePicker>
                </div>
                <textarea aria-label={`Prompt mục ${index + 1}`} placeholder="Mô tả chuyển động và cảnh quay…" maxLength={VIDEO_PROMPT_MAX_LENGTH} rows={3} value={row.prompt} disabled={editingDisabled} onChange={(event) => patchRow(row.id, { prompt: event.target.value })} />
              </div>
              <div className="veo-batch-references">
                <span>Ảnh tham chiếu ({row.references.length}/2)</span>
                {row.references.map((image, refIndex) => (
                  <div className="veo-batch-reference" key={`${image.id}:${refIndex}`}>
                    <img src={api.videoBatchImageUrl(image)} alt={image.name || 'Ảnh tham chiếu'} />
                    <button type="button" className="veo-batch-icon" aria-label={`Bỏ ảnh tham chiếu ${refIndex + 1} của mục ${index + 1}`} disabled={editingDisabled || uploads > 0} onClick={() => patchRow(row.id, { references: row.references.filter((_, i) => i !== refIndex) })}><X size={12} /></button>
                  </div>
                ))}
                {row.references.length < 2 && <FilePicker disabled={editingDisabled || uploads > 0} multiple={row.references.length === 0} onFiles={(files) => {
                  if (files.length > 2 - row.references.length) {
                    setError('Mỗi mục chỉ nhận tối đa hai ảnh tham chiếu thêm.')
                    return
                  }
                  void uploadImages(files, (images) => patchRow(row.id, { references: [...row.references, ...images] }))
                }}><Plus size={14} /> Thêm ảnh tham chiếu</FilePicker>}
              </div>
            </li>
          ))}
        </ol>
        {error && <p className="veo-batch-error" role="alert">{error}</p>}
        <div className="veo-batch-submit">
          <span>{uploads ? 'Đang tải ảnh…' : pending ? `${pending.items.length} mục chờ xác nhận` : profile?.credit_cost != null && rows.length > 0 ? `Ước tính ${rows.length * profile.credit_cost} credit` : `${rows.length} mục`}</span>
          <button type="button" className="veo-batch-primary" disabled={submitting || uploads > 0 || unappliedPaste || (!pending && !complete)} onClick={() => void submit()}>
            {submitting ? <Loader2 className="spin" size={15} /> : null}
            {submitting ? 'Đang gửi lô…' : pending ? 'Kiểm tra lại lô' : 'Đưa vào hàng đợi'}
          </button>
        </div>
      </section>

      <section className="veo-batch-queue" aria-label="Hàng đợi video">
        <div className="veo-batch-toolbar">
          <h3>Hàng đợi video</h3>
          {selected && batches.length > 1 && <select aria-label="Lô video" value={selected.batch_id} onChange={(event) => setSelectedId(event.target.value)}>{batches.map((batch) => <option key={batch.batch_id} value={batch.batch_id}>{new Date(batch.created_at).toLocaleString('vi-VN')} · {batch.items.length} mục · {BATCH_LABELS[batch.status]}</option>)}</select>}
        </div>
        {listError && <p className="veo-batch-error" role="alert">{listError}</p>}
        {selected ? (
          <>
            <div className="veo-batch-toolbar veo-batch-progress">
              <span>{BATCH_LABELS[selected.status]} · {selected.items.filter((item) => item.status === 'done').length}/{selected.items.length} video</span>
              {selected.status !== 'done' && selected.items.some((item) => item.status === 'queued') && <button type="button" className="veo-batch-secondary" disabled={batchAction} onClick={() => void changeBatch(selected.status === 'paused' ? 'resume' : 'pause')}>{selected.status === 'paused' ? 'Tiếp tục mục chờ' : 'Tạm dừng mục chờ'}</button>}
            </div>
            <ol className="veo-batch-run-list">
              {selected.items.map(({ unit, status, error: rowError, job }, index) => (
                <li key={index}>
                  <img src={api.videoBatchImageUrl(unit.image)} alt="" />
                  <div className="veo-batch-run-info">
                    <strong title={unit.prompt}>{index + 1}. {unit.prompt}</strong>
                    <small>{unit.settings.duration_seconds}s · {unit.settings.aspect_ratio} · {unit.settings.resolution} · {status === 'running' ? job?.current_step || ROW_LABELS[status] : ROW_LABELS[status]}</small>
                    {rowError && <p className="veo-batch-error">{rowError}</p>}
                  </div>
                  {status === 'done' && job && <button className="veo-batch-secondary" type="button" onClick={() => onPreviewJob(job)}>Xem video</button>}
                </li>
              ))}
            </ol>
          </>
        ) : <p className="veo-batch-empty">Lô đã gửi sẽ hiện ở đây.</p>}
      </section>
    </div>
  )
}
