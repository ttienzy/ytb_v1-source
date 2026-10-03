import { useState, useEffect } from 'react'
import {
  Menu,
  PanelLeftClose,
  Sparkles,
  Heart,
  X,
  Copy,
  Check,
  ChevronDown,
} from 'lucide-react'
import { navGroups } from '../../shared/constants'
import qrImage from '../../assets/qr-vietqr-sepay.png'

import type { PublisherDailySummary } from '../../features/monitor/types'

// --- Donation Config ---
const DONATION_ACCOUNT = '0849606559'
const DONATION_NAME = 'NGUYEN DIEN TIEN'
const DONATION_BANK = 'MB Bank (Ngân hàng TMCP Quân đội)'

type SidebarProps = {
  activePage: string
  setActivePage: (page: string) => void
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  summary?: PublisherDailySummary | null
}

function DonationModal({ onClose }: { onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = () => {
    navigator.clipboard.writeText(DONATION_ACCOUNT).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    })
  }

  return (
    <div className="donation-overlay" onClick={onClose}>
      <div className="donation-modal" onClick={e => e.stopPropagation()}>
        {/* Animated rainbow top bar */}
        <div className="donation-modal-banner" />

        <button className="donation-modal-close" onClick={onClose} title="Đóng">
          <X size={15} />
        </button>

        <div className="donation-modal-inner">
          {/* Header */}
          <div className="donation-header">
            <div className="donation-heart-icon">
              <Heart size={22} fill="#f43f5e" color="#f43f5e" />
            </div>
            <h3 className="donation-title">Ủng hộ tác giả ☕</h3>
            <p className="donation-subtitle">
              Mỗi đóng góp nhỏ là động lực lớn để Admin duy trì &amp; ra mắt tính năng mới 🚀
            </p>
          </div>

          {/* QR Code */}
          <div className="donation-qr-wrap">
            <div className="donation-qr-frame">
              <img
                src={qrImage}
                alt="QR SePay - Ủng hộ CreatorFlow AI"
                className="donation-qr-img"
              />
            </div>
          </div>

          {/* Bank info */}
          <div className="donation-bank-info">
            <div className="donation-bank-row">
              <span className="donation-bank-label">Ngân hàng</span>
              <span className="donation-bank-value">{DONATION_BANK}</span>
            </div>
            <div className="donation-bank-row">
              <span className="donation-bank-label">Số tài khoản</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="donation-bank-value donation-account">{DONATION_ACCOUNT}</span>
                <button className="donation-copy-btn" onClick={handleCopy} title="Sao chép số tài khoản">
                  {copied ? <Check size={13} color="#4ade80" /> : <Copy size={13} />}
                </button>
              </div>
            </div>
            <div className="donation-bank-row">
              <span className="donation-bank-label">Tên chủ tài khoản</span>
              <span className="donation-bank-value">{DONATION_NAME}</span>
            </div>
          </div>

          {/* Thank you note */}
          <div className="donation-thank-note">
            💖 Cảm ơn bạn rất nhiều! Sự ủng hộ của bạn chính là nguồn động lực
            để Admin tiếp tục phát triển và cập nhật CreatorFlow AI.
          </div>
        </div>
      </div>
    </div>
  )
}

export function Sidebar({
  activePage,
  setActivePage,
  collapsed,
  setCollapsed,
  summary,
}: SidebarProps) {
  const [showDonation, setShowDonation] = useState(false)

  // Track dropdown open/closed state for groups
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>(() => {
    const initial: Record<string, boolean> = {}
    navGroups.forEach(g => {
      initial[g.title] = true
    })
    return initial
  })

  // Automatically keep the group containing activePage open
  useEffect(() => {
    const parentGroup = navGroups.find(g =>
      g.items.some(item => item.label === activePage)
    )
    if (parentGroup && !openGroups[parentGroup.title]) {
      setOpenGroups(prev => ({ ...prev, [parentGroup.title]: true }))
    }
  }, [activePage])

  const toggleGroup = (title: string) => {
    setOpenGroups(prev => ({
      ...prev,
      [title]: !prev[title],
    }))
  }

  // Count unposted channels per platform
  const unpostedPippitCount =
    summary?.channels.filter(
      c => (c.platform === 'tiktok' || c.platform === 'facebook') && c.status === 'unposted'
    ).length || 0

  const unpostedYoutubeCount =
    summary?.channels.filter(
      c => c.platform === 'youtube' && c.status === 'unposted'
    ).length || 0

  return (
    <>
      <aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}>
        {/* Brand Header */}
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

        {/* Grouped Navigation List with Dropdowns */}
        <nav className="nav-list">
          {navGroups.map((group, groupIdx) => {
            const isCollapsible = group.collapsible !== false
            const isGroupOpen = collapsed ? true : (openGroups[group.title] ?? true)

            // Check if this group contains unposted alerts
            const groupUnpostedTotal = group.items.reduce((total, item) => {
              if (item.label === 'Lên lịch Pippit') return total + unpostedPippitCount
              if (item.label === 'Lên lịch Youtube') return total + unpostedYoutubeCount
              return total
            }, 0)

            return (
              <div key={group.title || groupIdx} className="nav-group">
                {!collapsed && (
                  isCollapsible ? (
                    <button
                      type="button"
                      className="nav-group-header"
                      onClick={() => toggleGroup(group.title)}
                      title={isGroupOpen ? `Thu gọn nhóm ${group.title}` : `Mở rộng nhóm ${group.title}`}
                    >
                      <span className="nav-group-title">
                        {group.title}
                        {!isGroupOpen && groupUnpostedTotal > 0 && (
                          <span className="sidebar-group-badge-count">{groupUnpostedTotal}</span>
                        )}
                      </span>
                      <ChevronDown
                        size={13}
                        className={`nav-group-chevron ${isGroupOpen ? '' : 'closed'}`}
                      />
                    </button>
                  ) : (
                    <div className="nav-group-header nav-group-header-static">
                      <span className="nav-group-title">{group.title}</span>
                    </div>
                  )
                )}

                {/* Sub-items list */}
                {(isGroupOpen || collapsed) && (
                  <div className="nav-group-items">
                    {group.items.map(({ label, icon: Icon, badge, badgeVariant }) => {
                      const unpostedCount =
                        label === 'Lên lịch Pippit'
                          ? unpostedPippitCount
                          : label === 'Lên lịch Youtube'
                          ? unpostedYoutubeCount
                          : 0
                      const hasUnposted = unpostedCount > 0
                      const isActive = activePage === label

                      return (
                        <button
                          type="button"
                          key={label}
                          className={`nav-item ${isActive ? 'nav-item-active' : ''}`}
                          onClick={() => setActivePage(label)}
                          title={
                            collapsed
                              ? `${label}${hasUnposted ? ` (${unpostedCount} kênh chưa đăng)` : ''}`
                              : undefined
                          }
                        >
                          <div className="nav-icon-wrap">
                            <Icon size={16} />
                          </div>
                          {!collapsed && (
                            <>
                              <span className="nav-item-text">{label}</span>
                              {badge && (
                                <span className={`sidebar-badge sidebar-badge-${badgeVariant || 'pro'}`}>
                                  {badge}
                                </span>
                              )}
                              {hasUnposted && (
                                <span
                                  className="sidebar-badge-count"
                                  title={`${unpostedCount} kênh chưa đăng bài hôm nay`}
                                >
                                  {unpostedCount}
                                </span>
                              )}
                            </>
                          )}
                          {collapsed && hasUnposted && (
                            <span
                              className="sidebar-dot-count"
                              title={`${unpostedCount} kênh chưa đăng bài hôm nay`}
                            />
                          )}
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </nav>

        {/* Sidebar Footer with Donation Only (Version/status removed) */}
        <div className="sidebar-footer">
          <button
            type="button"
            className={`donation-btn ${collapsed ? 'donation-btn-collapsed' : ''}`}
            onClick={() => setShowDonation(true)}
            title="Ủng hộ tác giả ☕"
          >
            <Heart size={15} className="donation-btn-icon" />
            {!collapsed && <span>Ủng hộ tác giả</span>}
          </button>
        </div>
      </aside>

      {showDonation && <DonationModal onClose={() => setShowDonation(false)} />}
    </>
  )
}
