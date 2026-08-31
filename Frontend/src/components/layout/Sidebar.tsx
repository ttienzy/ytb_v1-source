import {
  ChevronDown,
  Menu,
  PanelLeftClose,
  Sparkles,
} from 'lucide-react'
import { navigation } from '../../shared/constants'

import type { PublisherDailySummary } from '../../features/monitor/types'

type SidebarProps = {
  activePage: string
  setActivePage: (page: string) => void
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  summary?: PublisherDailySummary | null
}

export function Sidebar({
  activePage,
  setActivePage,
  collapsed,
  setCollapsed,
  summary,
}: SidebarProps) {
  // Check if Pippit or YouTube has unposted channels
  const unpostedPippit = summary?.channels.some(
    c => (c.platform === 'tiktok' || c.platform === 'facebook') && c.status === 'unposted'
  )
  const unpostedYoutube = summary?.channels.some(
    c => c.platform === 'youtube' && c.status === 'unposted'
  )

  return (
    <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
      <div className="brand-row">
        <div className="brand-mark">
          <Sparkles size={17} />
        </div>
        {!collapsed && <span className="brand-name">Search Studio</span>}
        <button
          type="button"
          className="icon-button sidebar-toggle"
          onClick={() => setCollapsed(!collapsed)}
          title={collapsed ? 'Mở rộng menu' : 'Thu gọn menu'}
        >
          {collapsed ? <Menu size={18} /> : <PanelLeftClose size={18} />}
        </button>
      </div>

      <div className="workspace-select">
        <div className="workspace-avatar">S</div>
        {!collapsed && (
          <>
            <div className="workspace-copy">
              <span>Workspace</span>
              <strong>Personal space</strong>
            </div>
            <ChevronDown size={15} />
          </>
        )}
      </div>

      <nav className="nav-list">
        {!collapsed && <span className="nav-label">MENU</span>}
        {navigation.map(({ label, icon: Icon }) => {
          const hasUnposted =
            (label === 'Lên lịch Pippit' && unpostedPippit) ||
            (label === 'Lên lịch Youtube' && unpostedYoutube)

          return (
            <button
              type="button"
              key={label}
              className={`nav-item ${activePage === label ? 'nav-item-active' : ''}`}
              onClick={() => setActivePage(label)}
              style={{ position: 'relative' }}
            >
              <Icon size={18} />
              <span className={collapsed ? 'sr-only' : ''}>{label}</span>
              {hasUnposted && (
                <span
                  style={{
                    position: 'absolute',
                    right: collapsed ? 8 : 12,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 7,
                    height: 7,
                    borderRadius: '50%',
                    backgroundColor: '#e11d48',
                    boxShadow: '0 0 0 2px #fff',
                  }}
                  title="Có kênh chưa đăng bài hôm nay"
                />
              )}
            </button>
          )
        })}
      </nav>

      <div className="sidebar-footer">
        <div className="profile-row">
          <div className="profile-avatar">A</div>
          {!collapsed && (
            <div className="profile-copy">
              <strong>Admin</strong>
              <span>admin@example.com</span>
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
