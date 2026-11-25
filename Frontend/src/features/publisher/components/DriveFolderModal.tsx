import { useCallback, useEffect, useState } from 'react'
import { Check, ChevronRight, Folder, FolderOpen, HardDrive, Link2, Loader2, Search, X } from 'lucide-react'
import * as api from '../services/publisherApi'
import type { DriveFolder } from '../types'

function formatDriveDate(dateStr?: string): string {
  if (!dateStr) return '—'
  const d = new Date(dateStr)
  if (Number.isNaN(d.getTime())) return dateStr
  const now = new Date()
  if (d.toDateString() === now.toDateString()) return `Hôm nay ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  return d.getFullYear() === now.getFullYear() ? `${d.getDate()} thg ${d.getMonth() + 1}` : `${d.getDate()} thg ${d.getMonth() + 1}, ${d.getFullYear()}`
}

export function DriveFolderModal({
  open,
  onClose,
  onPick,
}: {
  open: boolean
  onClose: () => void
  onPick: (folder: { id: string; name: string }) => void
}) {
  const [crumbs, setCrumbs] = useState<{ id: string; name: string }[]>([{ id: 'root', name: 'Drive của tôi' }])
  const [folders, setFolders] = useState<DriveFolder[]>([])
  const [selected, setSelected] = useState<DriveFolder | null>(null)
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [link, setLink] = useState('')
  const [error, setError] = useState('')

  const load = useCallback(async (parentId: string, q = '') => {
    setLoading(true)
    setSelected(null)
    setError('')
    try {
      setFolders((await api.fetchDriveFolders(parentId, q)) || [])
    } catch (err: any) {
      setFolders([])
      setError(err?.message || 'Không tải được danh sách thư mục.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    setCrumbs([{ id: 'root', name: 'Drive của tôi' }])
    setSearch('')
    setLink('')
    void load('root')
  }, [open, load])

  if (!open) return null
  const current = crumbs[crumbs.length - 1]
  const target = selected ? { id: selected.id, name: selected.name } : current.id !== 'root' ? current : null

  const enter = (f: DriveFolder) => {
    setCrumbs(prev => [...prev, { id: f.id, name: f.name }])
    setSearch('')
    void load(f.id)
  }
  const goTo = (index: number) => {
    const next = crumbs.slice(0, index + 1)
    setCrumbs(next)
    setSearch('')
    void load(next[next.length - 1].id)
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-dialog pub-folder-modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header pub-modal-header">
          <div className="pub-modal-title">
            <div className="pub-modal-icon-badge"><HardDrive size={18} /></div>
            <div>
              <h3>Chọn thư mục Google Drive</h3>
              <span className="pub-modal-subtitle">Duyệt các thư mục trên Google Drive của bạn</span>
            </div>
          </div>
          <button type="button" className="icon-button pub-modal-close" onClick={onClose} title="Đóng"><X size={18} /></button>
        </div>

        <div className="pub-modal-breadcrumbs">
          <div className="pub-crumbs-wrap">
            {crumbs.map((c, i) => (
              <div key={c.id} className="pub-breadcrumb-step">
                {i > 0 && <ChevronRight size={13} className="pub-crumb-arrow" />}
                <button type="button" className={`pub-crumb-btn ${i === crumbs.length - 1 ? 'pub-crumb-current' : ''}`} onClick={() => goTo(i)}>
                  {i === 0 ? <HardDrive size={13} /> : <Folder size={13} />}
                  <span>{c.name}</span>
                </button>
              </div>
            ))}
          </div>
          <span className="pub-folder-count-badge">{folders.length} thư mục</span>
        </div>

        <div className="pub-modal-search-row">
          <Search size={14} className="pub-search-icon" />
          <input
            type="text"
            placeholder="Lọc nhanh thư mục theo tên..."
            value={search}
            onChange={e => {
              setSearch(e.target.value)
              void load(current.id, e.target.value)
            }}
            className="pub-modal-search-input"
          />
        </div>

        <div className="pub-modal-folder-list">
          {loading ? (
            <div className="pub-empty-box"><Loader2 size={26} className="spin" /><p>Đang quét thư mục Google Drive...</p></div>
          ) : error ? (
            <div className="pub-empty-box"><p>{error}</p></div>
          ) : folders.length === 0 ? (
            <div className="pub-empty-box"><FolderOpen size={32} /><p>Không có thư mục con nào ở cấp này.</p></div>
          ) : (
            <div className="pub-folder-table">
              <div className="pub-folder-thead">
                <div className="pub-th-col pub-th-name">Tên thư mục</div>
                <div className="pub-th-col pub-th-owner">Chủ sở hữu</div>
                <div className="pub-th-col pub-th-date">Ngày sửa đổi</div>
                <div className="pub-th-col pub-th-act">Mở</div>
              </div>
              <div className="pub-folder-tbody">
                {folders.map(f => (
                  <div
                    key={f.id}
                    className={`pub-folder-trow ${selected?.id === f.id ? 'pub-folder-trow-active' : ''}`}
                    onClick={() => setSelected(f)}
                    onDoubleClick={() => enter(f)}
                    title="Click để chọn, bấm đúp để mở thư mục"
                  >
                    <div className="pub-td-col pub-td-name">
                      <div className="pub-gdrive-folder-icon"><Folder size={17} /></div>
                      <span className="pub-trow-folder-name">{f.name}</span>
                    </div>
                    <div className="pub-td-col pub-td-owner"><span className="pub-owner-badge">tôi</span></div>
                    <div className="pub-td-col pub-td-date"><span className="pub-trow-date">{formatDriveDate(f.modified_time)}</span></div>
                    <div className="pub-td-col pub-td-act">
                      <button type="button" className="pub-btn-open-dir" onClick={e => { e.stopPropagation(); enter(f) }} title="Mở thư mục này">
                        <ChevronRight size={15} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="pub-modal-footer">
          <div className="pub-custom-link-box">
            <Link2 size={15} />
            <input type="text" placeholder="Hoặc dán link / ID Google Drive..." value={link} onChange={e => setLink(e.target.value)} className="pub-custom-link-input" />
            <button type="button" className="chrome-button pub-btn-browse-link" disabled={!link.trim()} onClick={() => onPick({ id: link.trim(), name: 'Thư mục Drive liên kết' })}>
              Duyệt link
            </button>
          </div>
          <div className="pub-modal-footer-btns">
            <button type="button" className="chrome-button" onClick={onClose}>Hủy</button>
            <button type="button" className="primary-button pub-btn-confirm-select" disabled={!target} onClick={() => target && onPick(target)}>
              <Check size={15} /> {target ? `Chọn "${target.name}"` : 'Chọn thư mục'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
