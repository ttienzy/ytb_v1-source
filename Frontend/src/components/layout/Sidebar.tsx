import {
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
        {collapsed ? (
          <button
            type="button"
            className="sidebar-toggle"
            onClick={() => setCollapsed(false)}
            title="Mở rộng menu"
          >
            <Menu size={15} />
          </button>
        ) : (
          <>
            <div className="brand-mark">
              <Sparkles size={15} />
            </div>
            <span className="brand-name">CreatorFlow AI</span>
            <button
              type="button"
              className="sidebar-toggle"
              onClick={() => setCollapsed(true)}
              title="Thu gọn menu"
            >
              <PanelLeftClose size={13} />
            </button>
          </>
        )}
      </div>

      <nav className="nav-list">
        {!collapsed && <span className="nav-label">Menu</span>}
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
              title={collapsed ? label : undefined}
            >
              <Icon size={16} style={{ flexShrink: 0 }} />
              <span className={collapsed ? 'sr-only' : ''}>{label}</span>
              {hasUnposted && (
                <span
                  style={{
                    position: 'absolute',
                    right: collapsed ? 8 : 10,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    backgroundColor: '#e11d48',
                    boxShadow: activePage === label ? '0 0 0 2px #fff' : '0 0 0 2px #f1f5f9',
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
