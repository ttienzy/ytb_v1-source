/**
 * Muse Canvas — ô trạng thái góc trên trái kiêm nút chọn project:
 *   [▣ Áo sơ mi xanh ▾] · 22 node · 33 dây · Đã lưu
 * Mở ra: danh sách project (mới sửa nhất trước) + tạo mới / nhân bản / làm mẫu / đổi tên / xóa project đang mở.
 */
import { useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronDown,
  Cloud,
  CloudOff,
  Copy,
  FolderKanban,
  LayoutTemplate,
  Loader2,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { sortProjects, type CopyMode, type MuseProjectMeta } from '../services/museProjects.ts'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

interface MuseProjectBarProps {
  projects: MuseProjectMeta[]
  activeId: string
  nodeCount: number
  edgeCount: number
  saveState: SaveState
  saveError: string
  busy: boolean
  onSwitch: (id: string) => void
  onCreate: (mode: 'empty' | CopyMode) => void
  onRename: () => void
  onDelete: () => void
}

function ago(ms: number): string {
  if (!ms) return ''
  const s = Math.max(0, (Date.now() - ms) / 1000)
  if (s < 60) return 'vừa xong'
  if (s < 3600) return `${Math.round(s / 60)} phút trước`
  if (s < 86400) return `${Math.round(s / 3600)} giờ trước`
  if (s < 30 * 86400) return `${Math.round(s / 86400)} ngày trước`
  return new Date(ms).toLocaleDateString('vi-VN')
}

export function MuseProjectBar(p: MuseProjectBarProps) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  const active = p.projects.find((x) => x.id === p.activeId)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const act = (fn: () => void) => () => {
    setOpen(false)
    fn()
  }

  return (
    <div className="mc-canvas-status mc-project-bar" ref={box}>
      <button
        type="button"
        className="mc-project-btn"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={p.busy}
        title="Chọn / tạo project Muse Canvas"
      >
        {p.busy ? <Loader2 size={13} className="animate-spin" /> : <FolderKanban size={13} />}
        <span className="mc-project-name">{active?.name ?? 'Muse Canvas'}</span>
        <ChevronDown size={12} />
      </button>
      <span className="mc-dot" />
      <span>
        {p.nodeCount} node · {p.edgeCount} dây
      </span>
      <span className={`mc-save mc-save-${p.saveState}`} title={p.saveError || undefined}>
        {p.saveState === 'saving' && <Loader2 size={12} className="animate-spin" />}
        {p.saveState === 'saved' && <Cloud size={12} />}
        {p.saveState === 'error' && <CloudOff size={12} />}
        {p.saveState === 'saving' ? 'Đang lưu…' : p.saveState === 'saved' ? 'Đã lưu' : p.saveState === 'error' ? 'Lỗi lưu' : ''}
      </span>

      {open && (
        <div className="mc-addmenu mc-project-menu" role="menu">
          <div className="mc-addmenu-group">Project ({p.projects.length})</div>
          <div className="mc-project-list">
            {sortProjects(p.projects).map((x) => (
              <button
                key={x.id}
                type="button"
                role="menuitemradio"
                aria-checked={x.id === p.activeId}
                className={x.id === p.activeId ? 'on' : ''}
                onClick={act(() => p.onSwitch(x.id))}
                title={x.name}
              >
                <span className="mc-project-check">{x.id === p.activeId && <Check size={13} />}</span>
                <span className="mc-project-row">
                  <span className="mc-project-row-name">{x.name}</span>
                  <small>
                    {x.nodeCount} node{x.updatedAt ? ` · sửa ${ago(x.updatedAt)}` : ''}
                  </small>
                </span>
              </button>
            ))}
          </div>
          <div className="mc-addmenu-group">Tạo</div>
          <button type="button" role="menuitem" onClick={act(() => p.onCreate('empty'))}>
            <Plus size={13} /> Project mới <small>canvas trống</small>
          </button>
          <button type="button" role="menuitem" onClick={act(() => p.onCreate('template'))} disabled={!active}>
            <LayoutTemplate size={13} /> Làm mẫu từ project này <small>giữ node, prompt, ảnh vào · bỏ kết quả</small>
          </button>
          <button type="button" role="menuitem" onClick={act(() => p.onCreate('copy'))} disabled={!active}>
            <Copy size={13} /> Nhân bản project này <small>giữ cả kết quả</small>
          </button>
          <div className="mc-addmenu-group">Project đang mở</div>
          <button type="button" role="menuitem" onClick={act(p.onRename)} disabled={!active}>
            <Pencil size={13} /> Đổi tên
          </button>
          <button
            type="button"
            role="menuitem"
            className="mc-project-danger"
            onClick={act(p.onDelete)}
            disabled={!active || p.projects.length <= 1}
            title={p.projects.length <= 1 ? 'Không xóa được project cuối cùng' : undefined}
          >
            <Trash2 size={13} /> Xóa project <small>ảnh / video đã tạo vẫn còn</small>
          </button>
        </div>
      )}
    </div>
  )
}
