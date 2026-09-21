import { useState } from 'react'
import {
  Menu,
  PanelLeftClose,
  Sparkles,
  Heart,
  X,
  Copy,
  Check,
} from 'lucide-react'
import { navigation } from '../../shared/constants'
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

  // Check if Pippit or YouTube has unposted channels
  const unpostedPippit = summary?.channels.some(
    c => (c.platform === 'tiktok' || c.platform === 'facebook') && c.status === 'unposted'
  )
  const unpostedYoutube = summary?.channels.some(
    c => c.platform === 'youtube' && c.status === 'unposted'
  )

  return (
    <>
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

        {/* Donation Footer */}
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
