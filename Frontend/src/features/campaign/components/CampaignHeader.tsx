import { useEffect, useRef, useState } from 'react'
import { Check, MoreHorizontal, Pencil, Trash2, Wallet, X } from 'lucide-react'
import { PLATFORM_LABEL, budgetView, shortDate } from '../services/campaignView.ts'
import type { CampaignSummary } from '../types.ts'
import { HelpHint } from '../../help/components/HelpHint'

interface Props {
  campaign: CampaignSummary
  spent: number
  onRename: (name: string) => Promise<boolean>
  onSetCap: (cap: number | null) => Promise<boolean>
  onDelete: () => void
}

/** Đầu trang chiến dịch: tên sửa tại chỗ, thanh ngân sách credit (bấm để đặt trần), menu ⋯ cho lệnh hiếm dùng (xóa). */
export function CampaignHeader({ campaign, spent, onRename, onSetCap, onDelete }: Props) {
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(campaign.name)
  const [editingCap, setEditingCap] = useState(false)
  const [cap, setCap] = useState('')
  const [capError, setCapError] = useState('')
  const [menu, setMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  useEffect(() => { if (!renaming) setName(campaign.name) }, [campaign.name, renaming])
  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [menu])

  const budget = budgetView(spent, campaign.credit_cap)

  const saveName = async () => {
    const n = name.trim()
    if (!n || n === campaign.name) { setRenaming(false); return }
    if (await onRename(n)) setRenaming(false)
  }
  const openCap = () => { setCap(campaign.credit_cap?.toString() ?? ''); setCapError(''); setEditingCap(true) }
  const saveCap = async () => {
    const v = cap.trim() === '' ? null : Number(cap)
    if (v !== null && (!Number.isFinite(v) || v < 0 || !Number.isInteger(v))) { setCapError('Nhập số nguyên không âm, hoặc để trống = không giới hạn.'); return }
    if (await onSetCap(v)) setEditingCap(false)
  }

  return (
    <header className="cp-header">
      <div className="cp-title">
        {renaming ? (
          <form className="cp-title-edit" onSubmit={e => { e.preventDefault(); void saveName() }}>
            <input className="cp-input" value={name} onChange={e => setName(e.target.value)} aria-label="Tên chiến dịch" autoFocus
                   onKeyDown={e => { if (e.key === 'Escape') setRenaming(false) }} />
            <button type="submit" className="cp-icon-btn is-ok" aria-label="Lưu tên" title="Lưu (Enter)" disabled={!name.trim()}><Check size={16} /></button>
            <button type="button" className="cp-icon-btn" aria-label="Hủy đổi tên" title="Hủy (Esc)" onClick={() => setRenaming(false)}><X size={16} /></button>
          </form>
        ) : (
          <h2>
            <span>{campaign.name}</span>
            <button type="button" className="cp-icon-btn cp-title-pen" aria-label="Đổi tên chiến dịch" title="Đổi tên" onClick={() => setRenaming(true)}><Pencil size={14} /></button>
          </h2>
        )}
        <p className="cp-title-meta">
          <span className="cp-pill">{PLATFORM_LABEL[campaign.platform] ?? campaign.platform}</span>
          {campaign.created_at && <span>Tạo ngày {shortDate(campaign.created_at)}</span>}
        </p>
      </div>

      <div className="cp-header-side">
        {editingCap ? (
          <form className="cp-budget cp-budget-edit" onSubmit={e => { e.preventDefault(); void saveCap() }}>
            <label htmlFor="cap" className="cp-budget-label">Trần credit Flow<HelpHint hint="campaign.credit" /></label>
            <div className="cp-row">
              <input id="cap" className="cp-input cp-narrow" inputMode="numeric" value={cap} placeholder="không giới hạn" autoFocus
                     onChange={e => setCap(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setEditingCap(false) }} />
              <button type="submit" className="cp-icon-btn is-ok" aria-label="Lưu trần credit"><Check size={16} /></button>
              <button type="button" className="cp-icon-btn" aria-label="Hủy" onClick={() => setEditingCap(false)}><X size={16} /></button>
            </div>
            {capError && <span className="cp-budget-error">{capError}</span>}
          </form>
        ) : (
          <button type="button" className={`cp-budget cp-budget-${budget.tone}`} onClick={openCap} data-testid="budget"
                  title="Bấm để đặt trần credit cho chiến dịch (lần chạy vượt trần sẽ bị chặn)">
            <span className="cp-budget-label"><Wallet size={13} /> Credit Flow đã dùng</span>
            <span className="cp-budget-value">{budget.label}</span>
            {budget.pct !== null && <span className="cp-budget-bar" aria-hidden><span style={{ width: `${budget.pct}%` }} /></span>}
          </button>
        )}

        <div className="cp-menu" ref={menuRef}>
          <button type="button" className="cp-icon-btn cp-menu-btn" aria-haspopup="menu" aria-expanded={menu} aria-label="Thêm thao tác"
                  onClick={() => setMenu(m => !m)}><MoreHorizontal size={18} /></button>
          {menu && (
            <div className="cp-menu-pop" role="menu">
              <button type="button" role="menuitem" onClick={() => { setMenu(false); setRenaming(true) }}><Pencil size={14} /> Đổi tên</button>
              <button type="button" role="menuitem" onClick={() => { setMenu(false); openCap() }}><Wallet size={14} /> Đặt trần credit</button>
              <hr />
              <button type="button" role="menuitem" className="is-danger" onClick={() => { setMenu(false); onDelete() }}><Trash2 size={14} /> Xóa chiến dịch</button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
