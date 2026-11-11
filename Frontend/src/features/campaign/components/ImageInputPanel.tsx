import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, Loader2, Save, Trash2, Undo2, UploadCloud } from 'lucide-react'
import { artifactUrl, setInputFiles, uploadImage } from '../services/campaignApi.ts'
import { bundleMembers, describeElement, errorMessage } from '../services/campaignView.ts'
import type { ArtifactView, BundleMember, CampaignState } from '../types.ts'
import { Badge } from './Common.tsx'

interface Props {
  campaignId: string
  stepKey: 'garment_source' | 'cast'
  title: string
  hint: string
  roles: { value: string; label: string }[]
  maxImages: number
  state: CampaignState
  artifacts: ArtifactView[]
  onChanged: () => Promise<void>
  onError: (message: string) => void
  onPreview: (src: string) => void
}

const sameList = (a: BundleMember[], b: BundleMember[]) =>
  a.length === b.length && a.every((m, i) => m.artifact_id === b[i].artifact_id && m.role === b[i].role)

const ACCEPT = 'image/png,image/jpeg,image/webp'

/** Nhập ảnh cho bước input_files: lưới ô ảnh gọn (kéo thả để thêm), vai trò ngay trên ảnh, thanh Lưu chỉ hiện khi có thay đổi. */
export function ImageInputPanel({ campaignId, stepKey, title, hint, roles, maxImages, state, artifacts, onChanged, onError, onPreview }: Props) {
  const step = state.blocks.flatMap(b => b.steps).find(s => s.key === stepKey)
  const element = step?.elements[0]
  const saved = useMemo(() => {
    const bundle = artifacts.find(a => a.id === element?.selected_artifact_id)
    return bundleMembers(bundle)
  }, [artifacts, element?.selected_artifact_id])

  const [draft, setDraft] = useState<BundleMember[]>(saved)
  const [busy, setBusy] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const lastSaved = useRef<BundleMember[]>(saved)

  // Khi bản đã lưu đổi (tải lại trang, lưu xong) mà người dùng chưa sửa gì -> đồng bộ lại.
  useEffect(() => {
    if (sameList(draft, lastSaved.current)) setDraft(saved)
    lastSaved.current = saved
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved])

  const dirty = !sameList(draft, saved)
  const filenameOf = (id: string) => artifacts.find(a => a.id === id)?.meta?.filename || id.slice(0, 6)
  const single = maxImages === 1
  const canAdd = draft.length < maxImages
  const fileInput = (
    <input ref={fileRef} type="file" accept={ACCEPT} multiple={!single} onChange={e => void addFiles(e.target.files)} hidden disabled={busy} />
  )

  const addFiles = async (files: FileList | File[] | null) => {
    const list = Array.from(files ?? []).filter(f => ACCEPT.split(',').includes(f.type))
    if (list.length === 0) return
    setBusy(true)
    try {
      let next = [...draft]
      for (const file of list) {
        if (next.length >= maxImages) {
          if (single) next = []                 // một ảnh: ảnh mới thay ảnh cũ
          else { onError(`Tối đa ${maxImages} ảnh.`); break }
        }
        const art = await uploadImage(campaignId, file)
        const used = new Set(next.map(m => m.role))
        const role = roles.find(r => !used.has(r.value))?.value ?? roles[roles.length - 1].value
        next.push({ artifact_id: art.id, role })
      }
      setDraft(next)
      await onChanged()
    } catch (e) {
      onError(errorMessage(e))
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const move = (i: number, delta: number) => {
    const j = i + delta
    if (j < 0 || j >= draft.length) return
    const next = [...draft]
    ;[next[i], next[j]] = [next[j], next[i]]
    setDraft(next)
  }

  const save = async () => {
    setBusy(true)
    try {
      await setInputFiles(campaignId, stepKey, draft)
      await onChanged()
    } catch (e) {
      onError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="cp-card" data-testid={`images-${stepKey}`}>
      <header className="cp-card-head">
        <h3>{title}</h3>
        {!single && <span className="cp-count">{draft.length}/{maxImages}</span>}
        <Badge badge={describeElement(element)} />
      </header>
      <p className="cp-hint cp-hint-tight">{hint}</p>

      <ul className={`cp-tiles ${single ? 'cp-tiles-single' : ''}`}>
        {draft.map((m, i) => (
          <li key={m.artifact_id} className="cp-tile">
            <button type="button" className="cp-tile-img" onClick={() => onPreview(artifactUrl(m.artifact_id))} title={`${filenameOf(m.artifact_id)} · bấm để xem lớn`}>
              <img src={artifactUrl(m.artifact_id)} alt={filenameOf(m.artifact_id)} />
            </button>
            <div className="cp-tile-tools">
              {!single && <button type="button" onClick={() => move(i, -1)} disabled={i === 0} aria-label="Đưa lên trước" title="Đưa lên trước"><ArrowLeft size={13} /></button>}
              {!single && <button type="button" onClick={() => move(i, 1)} disabled={i === draft.length - 1} aria-label="Đưa ra sau" title="Đưa ra sau"><ArrowRight size={13} /></button>}
              <button type="button" onClick={() => setDraft(draft.filter((_, k) => k !== i))} aria-label="Bỏ ảnh" title="Bỏ ảnh"><Trash2 size={13} /></button>
            </div>
            {roles.length > 1 ? (
              <select className="cp-tile-role" value={m.role} aria-label="Vai trò ảnh"
                      onChange={e => setDraft(draft.map((x, k) => (k === i ? { ...x, role: e.target.value } : x)))}>
                {roles.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
              </select>
            ) : (
              <span className="cp-tile-role cp-tile-role-static">{roles[0]?.label}</span>
            )}
          </li>
        ))}
        {canAdd && (
          <li>
            <label className={`cp-tile cp-tile-add ${dragOver ? 'is-over' : ''} ${busy ? 'is-busy' : ''}`}
                   onDragOver={e => { e.preventDefault(); setDragOver(true) }} onDragLeave={() => setDragOver(false)}
                   onDrop={e => { e.preventDefault(); setDragOver(false); void addFiles(e.dataTransfer.files) }}>
              {busy ? <Loader2 size={20} className="spinning" /> : <UploadCloud size={20} />}
              <strong>{single ? 'Chọn ảnh' : 'Thêm ảnh'}</strong>
              <small>Kéo thả hoặc bấm để chọn</small>
              {fileInput}
            </label>
          </li>
        )}
      </ul>
      {!canAdd && single && (
        <label className="btn-g cp-small cp-replace" onDragOver={e => e.preventDefault()}
               onDrop={e => { e.preventDefault(); void addFiles(e.dataTransfer.files) }}>
          {busy ? <Loader2 size={13} className="spinning" /> : <UploadCloud size={13} />} Đổi ảnh
          {fileInput}
        </label>
      )}

      {dirty ? (
        <div className="cp-savebar" role="status">
          <span className="cp-dirty">Có thay đổi chưa lưu</span>
          <button type="button" className="btn-g cp-small" disabled={busy} onClick={() => setDraft(saved)}><Undo2 size={13} /> Hoàn tác</button>
          <button type="button" className="btn-p cp-small" onClick={() => void save()} disabled={busy || draft.length === 0}>
            <Save size={13} /> Lưu ảnh
          </button>
        </div>
      ) : saved.length > 0 && (
        <p className="cp-note">Đổi ảnh đã lưu sẽ làm các bước sau thành “Cũ”; kết quả cũ không bị xóa.</p>
      )}
    </section>
  )
}
