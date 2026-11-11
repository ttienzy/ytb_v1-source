import { useCallback, useEffect, useMemo, useState } from 'react'
import { BookmarkPlus, Check, Trash2, UserCheck } from 'lucide-react'
import { addCast, castFileUrl, deleteCast, listCast, useCast } from '../services/campaignApi.ts'
import { bundleMembers, errorMessage } from '../services/campaignView.ts'
import type { ArtifactView, CampaignState, CastItem } from '../types.ts'

interface Props {
  campaignId: string
  state: CampaignState
  artifacts: ArtifactView[]
  onChanged: () => Promise<void>
  onError: (message: string) => void
  onPreview: (src: string) => void
}

/** Thư viện nhân vật dùng lại giữa các chiến dịch: lưới ảnh nhỏ, rê chuột để dùng/xóa, nhân vật đang dùng được đánh dấu. */
export function CastLibrary({ campaignId, state, artifacts, onChanged, onError, onPreview }: Props) {
  const [items, setItems] = useState<CastItem[]>([])
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)

  const reload = useCallback(async () => {
    try { setItems(await listCast()) } catch (e) { onError(errorMessage(e)) }
  }, [onError])
  useEffect(() => { void reload() }, [reload])

  const current = useMemo(() => {
    const step = state.blocks.flatMap(b => b.steps).find(s => s.key === 'cast')
    const bundle = artifacts.find(a => a.id === step?.elements[0]?.selected_artifact_id)
    const id = bundleMembers(bundle)[0]?.artifact_id ?? null
    return { id, hash: artifacts.find(a => a.id === id)?.content_hash ?? null }
  }, [state, artifacts])
  const inLibrary = !!current.hash && items.some(i => i.content_hash === current.hash)

  const run = async (fn: () => Promise<void>) => {
    setBusy(true)
    try { await fn() } catch (e) { onError(errorMessage(e)) } finally { setBusy(false) }
  }

  const save = () => run(async () => {
    if (!current.id || !name.trim()) return
    await addCast(campaignId, current.id, name.trim())
    setName('')
    await reload()
  })
  const use = (id: string) => run(async () => { await useCast(campaignId, id); await onChanged() })
  const remove = (item: CastItem) => run(async () => {
    if (!window.confirm(`Xóa “${item.name}” khỏi thư viện? (Chiến dịch đang dùng ảnh này không bị ảnh hưởng.)`)) return
    await deleteCast(item.id)
    await reload()
  })

  return (
    <section className="cp-card" data-testid="cast-library">
      <header className="cp-card-head">
        <h3>Thư viện nhân vật</h3>
        <span className="cp-count">{items.length}</span>
      </header>
      <p className="cp-hint cp-hint-tight">Dùng lại nhân vật giữa các chiến dịch. Rê chuột vào ảnh để dùng hoặc xóa.</p>

      {items.length === 0 ? <p className="cp-empty">Thư viện đang trống.</p> : (
        <ul className="cp-tiles cp-tiles-mini">
          {items.map(item => {
            const active = item.content_hash === current.hash
            return (
              <li key={item.id} className={`cp-tile ${active ? 'is-current' : ''}`}>
                <button type="button" className="cp-tile-img" onClick={() => onPreview(castFileUrl(item.id))} title={`${item.name} · bấm để xem lớn`}>
                  <img src={castFileUrl(item.id)} alt={item.name} loading="lazy" />
                </button>
                {active && <span className="cp-tile-flag"><Check size={11} strokeWidth={3} /> Đang dùng</span>}
                <div className="cp-tile-tools">
                  {!active && <button type="button" onClick={() => void use(item.id)} disabled={busy} aria-label={`Dùng ${item.name}`} title="Dùng cho chiến dịch này"><UserCheck size={13} /></button>}
                  <button type="button" onClick={() => void remove(item)} disabled={busy} aria-label={`Xóa ${item.name}`} title="Xóa khỏi thư viện"><Trash2 size={13} /></button>
                </div>
                <span className="cp-tile-name" title={item.name}>{item.name}</span>
              </li>
            )
          })}
        </ul>
      )}

      {current.id && !inLibrary && (
        <form className="cp-inline-form" onSubmit={e => { e.preventDefault(); void save() }}>
          <input className="cp-input" value={name} onChange={e => setName(e.target.value)} placeholder="Đặt tên để lưu nhân vật hiện tại" aria-label="Tên nhân vật" />
          <button type="submit" className="btn-g cp-small" disabled={busy || !name.trim()}><BookmarkPlus size={13} /> Lưu vào thư viện</button>
        </form>
      )}
      {!current.id && <p className="cp-note">Chọn ảnh nhân vật ở trên rồi lưu để thêm vào thư viện.</p>}
    </section>
  )
}
