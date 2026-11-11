import { useEffect, useRef, useState } from 'react'
import { Loader2, Plus, Search, X } from 'lucide-react'
import { PLATFORM_LABEL, campaignInitial, shortDate } from '../services/campaignView.ts'
import type { CampaignSummary } from '../types.ts'
import { ErrorBanner } from './Common.tsx'

interface Props {
  campaigns: CampaignSummary[]
  selectedId: string | null
  loading: boolean
  error: string
  onClearError: () => void
  onSelect: (id: string) => void
  onCreate: (name: string) => Promise<boolean>
}

const SEARCH_FROM = 6           // ô tìm chỉ hiện khi danh sách đủ dài

/** Cột trái: danh sách chiến dịch. Tạo mới bằng nút "+" (ô tên chỉ hiện khi cần), tìm khi danh sách dài. */
export function CampaignRail({ campaigns, selectedId, loading, error, onClearError, onSelect, onCreate }: Props) {
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { if (creating) inputRef.current?.focus() }, [creating])
  useEffect(() => { if (!loading && campaigns.length === 0) setCreating(true) }, [loading, campaigns.length])

  const submit = async () => {
    const n = name.trim()
    if (!n || saving) return
    setSaving(true)
    const ok = await onCreate(n)
    setSaving(false)
    if (ok) { setName(''); setCreating(false) }
  }
  const cancel = () => { setName(''); setCreating(false) }

  const q = query.trim().toLowerCase()
  const shown = q ? campaigns.filter(c => c.name.toLowerCase().includes(q)) : campaigns

  return (
    <aside className="cp-rail" aria-label="Danh sách chiến dịch">
      <div className="cp-rail-head">
        <h2>Chiến dịch</h2>
        {campaigns.length > 0 && <span className="cp-count">{campaigns.length}</span>}
        <button type="button" className="cp-rail-add" onClick={() => setCreating(c => !c)} aria-expanded={creating}
                aria-label="Tạo chiến dịch mới" title="Tạo chiến dịch mới">
          {creating ? <X size={16} /> : <Plus size={16} />}
        </button>
      </div>

      {creating && (
        <form className="cp-rail-new" onSubmit={e => { e.preventDefault(); void submit() }}>
          <input ref={inputRef} className="cp-input" value={name} onChange={e => setName(e.target.value)} placeholder="Tên chiến dịch (vd: Áo Haim)"
                 aria-label="Tên chiến dịch mới" onKeyDown={e => { if (e.key === 'Escape') cancel() }} />
          <div className="cp-rail-new-actions">
            <button type="submit" className="btn-p cp-small" disabled={!name.trim() || saving}>
              {saving ? <Loader2 size={13} className="spinning" /> : <Plus size={13} />} Tạo
            </button>
            {campaigns.length > 0 && <button type="button" className="btn-g cp-small" onClick={cancel}>Hủy</button>}
          </div>
        </form>
      )}

      <ErrorBanner message={error} onClose={onClearError} />

      {campaigns.length >= SEARCH_FROM && (
        <label className="cp-rail-search">
          <Search size={14} aria-hidden />
          <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Tìm chiến dịch" aria-label="Tìm chiến dịch" />
        </label>
      )}

      {loading && <p className="cp-note"><Loader2 size={13} className="spinning" /> Đang tải…</p>}
      <ul className="cp-rail-list">
        {shown.map(c => {
          const active = c.id === selectedId
          return (
            <li key={c.id}>
              <button type="button" className={`cp-rail-item ${active ? 'is-active' : ''}`} aria-current={active ? 'page' : undefined}
                      onClick={() => onSelect(c.id)} title={c.name}>
                <span className="cp-rail-avatar" aria-hidden>{campaignInitial(c.name)}</span>
                <span className="cp-rail-text">
                  <span className="cp-rail-name">{c.name}</span>
                  <span className="cp-rail-meta">{PLATFORM_LABEL[c.platform] ?? c.platform}{c.created_at ? ` · tạo ${shortDate(c.created_at)}` : ''}</span>
                </span>
              </button>
            </li>
          )
        })}
      </ul>
      {q && shown.length === 0 && <p className="cp-note">Không có chiến dịch nào khớp “{query}”.</p>}
      {!loading && campaigns.length === 0 && <p className="cp-note">Chưa có chiến dịch. Đặt tên ở trên rồi bấm Tạo.</p>}
    </aside>
  )
}
