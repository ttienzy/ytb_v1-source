import { useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Layers,
  RefreshCw,
  X,
} from 'lucide-react'
import type { ChannelDailyStatus, PublisherDailySummary } from '../types'

function FacebookIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function TikTokIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.5 6.31 6.31 0 0 0 1.86-4.49V8.62a8.16 8.16 0 0 0 4.91 1.63v-3.56z" />
    </svg>
  )
}

function YouTubeIcon({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

export function ChannelHealthModal({
  isOpen,
  onClose,
  summary,
  isRefreshing,
  onRefresh,
  onNavigate,
}: {
  isOpen: boolean
  onClose: () => void
  summary: PublisherDailySummary | null
  isRefreshing?: boolean
  onRefresh: () => void
  onNavigate: (page: string) => void
}) {
  const [filter, setFilter] = useState<'all' | 'unposted' | 'warning' | 'healthy'>('all')

  if (!isOpen || !summary) return null

  const filteredChannels = summary.channels.filter(c => {
    if (filter === 'all') return true
    return c.status === filter
  })

  function getPlatformColor(platform: string) {
    if (platform === 'youtube') return '#dc2626'
    if (platform === 'facebook') return '#1877f2'
    return '#0f172a'
  }

  function getPlatformBg(platform: string) {
    if (platform === 'youtube') return '#fef2f2'
    if (platform === 'facebook') return '#eff6ff'
    return '#f8fafc'
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
        zIndex: 99999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        style={{
          background: '#ffffff',
          borderRadius: 16,
          width: '100%',
          maxWidth: 680,
          maxHeight: '90vh',
          display: 'flex',
          flexDirection: 'column',
          boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
          overflow: 'hidden',
          animation: 'modalSlideIn 0.2s ease-out',
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: '20px 24px 16px',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            background: '#f8fafc',
          }}
        >
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div
                style={{
                  width: 32,
                  height: 32,
                  borderRadius: 8,
                  background: '#e0e7ff',
                  color: '#4338ca',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Layers size={18} />
              </div>
              <h2 style={{ fontSize: 17, fontWeight: 700, margin: 0, color: '#0f172a' }}>
                Sức Khỏe Kênh &amp; Trạng Thái Đăng Bài
              </h2>
            </div>
            <p style={{ margin: '4px 0 0 40px', fontSize: 12.5, color: '#64748b' }}>
              Theo dõi nhịp độ đăng video hôm nay (<strong>{summary.date}</strong> - Giờ VN)
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={onRefresh}
              disabled={isRefreshing}
              title="Đồng bộ trực tiếp dữ liệu mới nhất từ Pippit & YouTube"
              style={{
                background: isRefreshing ? '#f1f5f9' : '#fff',
                border: '1px solid #cbd5e1',
                borderRadius: 8,
                padding: '6px 12px',
                cursor: isRefreshing ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
                fontSize: 12,
                color: isRefreshing ? '#94a3b8' : '#334155',
                fontWeight: 600,
              }}
            >
              <RefreshCw size={12} className={isRefreshing ? 'spin' : ''} />
              {isRefreshing ? 'Đang đồng bộ...' : 'Làm mới'}
            </button>
            <button
              type="button"
              onClick={onClose}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#64748b',
                cursor: 'pointer',
                padding: 6,
                borderRadius: 6,
              }}
            >
              <X size={20} />
            </button>
          </div>
        </div>

        {/* Stats Highlight Bar */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
            padding: '14px 24px',
            background: '#fff',
            borderBottom: '1px solid #f1f5f9',
          }}
        >
          {/* Unposted stat */}
          <div
            onClick={() => setFilter('unposted')}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: summary.unposted_count > 0 ? '#fff1f2' : '#f8fafc',
              border: `1px solid ${summary.unposted_count > 0 ? '#fecdd3' : '#e2e8f0'}`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: summary.unposted_count > 0 ? '#be123c' : '#64748b' }}>
                CHƯA ĐĂNG HÔM NAY
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: summary.unposted_count > 0 ? '#e11d48' : '#0f172a' }}>
                {summary.unposted_count} <span style={{ fontSize: 12, fontWeight: 500 }}>kênh</span>
              </div>
            </div>
            {summary.unposted_count > 0 ? (
              <AlertCircle size={22} color="#e11d48" />
            ) : (
              <CheckCircle2 size={22} color="#10b981" />
            )}
          </div>

          {/* Warning stat */}
          <div
            onClick={() => setFilter('warning')}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: summary.warning_count > 0 ? '#fffbeb' : '#f8fafc',
              border: `1px solid ${summary.warning_count > 0 ? '#fde68a' : '#e2e8f0'}`,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: summary.warning_count > 0 ? '#b45309' : '#64748b' }}>
                CẦN NẠP THÊM BÀI
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: summary.warning_count > 0 ? '#d97706' : '#0f172a' }}>
                {summary.warning_count} <span style={{ fontSize: 12, fontWeight: 500 }}>kênh</span>
              </div>
            </div>
            <AlertTriangle size={22} color={summary.warning_count > 0 ? '#d97706' : '#94a3b8'} />
          </div>

          {/* Healthy stat */}
          <div
            onClick={() => setFilter('healthy')}
            style={{
              padding: '10px 14px',
              borderRadius: 10,
              background: '#f0fdf4',
              border: '1px solid #bbf7d0',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#15803d' }}>
                LỊCH PHÁT AN TOÀN
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: '#16a34a' }}>
                {summary.healthy_count} <span style={{ fontSize: 12, fontWeight: 500 }}>kênh</span>
              </div>
            </div>
            <CheckCircle2 size={22} color="#16a34a" />
          </div>
        </div>

        {/* Filter Tabs */}
        <div
          style={{
            padding: '10px 24px',
            display: 'flex',
            gap: 8,
            borderBottom: '1px solid #f1f5f9',
            background: '#fafafa',
          }}
        >
          {(
            [
              { id: 'all', label: `Tất cả (${summary.total_channels})` },
              { id: 'unposted', label: `🔴 Chưa có bài (${summary.unposted_count})` },
              { id: 'warning', label: `🟡 Cần thêm bài (${summary.warning_count})` },
              { id: 'healthy', label: `🟢 An toàn (${summary.healthy_count})` },
            ] as const
          ).map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setFilter(tab.id)}
              style={{
                padding: '5px 12px',
                borderRadius: 20,
                border: filter === tab.id ? '1px solid #4f46e5' : '1px solid #e2e8f0',
                background: filter === tab.id ? '#4f46e5' : '#fff',
                color: filter === tab.id ? '#fff' : '#475569',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {/* Channel Cards List */}
        <div style={{ flex: 1, overflowY: 'auto', padding: '16px 24px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          {filteredChannels.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '32px 0', color: '#94a3b8', fontSize: 13 }}>
              Không có kênh nào trong danh mục này.
            </div>
          ) : (
            filteredChannels.map(ch => (
              <div
                key={`${ch.platform}_${ch.channel_id}`}
                style={{
                  border: `1px solid ${ch.status === 'unposted' ? '#fecdd3' : ch.status === 'warning' ? '#fde68a' : '#e2e8f0'}`,
                  background: ch.status === 'unposted' ? '#fffbfa' : '#fff',
                  borderRadius: 12,
                  padding: 14,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 12,
                  boxShadow: '0 1px 3px rgba(0,0,0,0.03)',
                }}
              >
                {/* Channel Info */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                  {/* Platform Icon with Avatar */}
                  <div style={{ position: 'relative', flexShrink: 0 }}>
                    {ch.avatar_url ? (
                      <img
                        src={ch.avatar_url}
                        alt={ch.channel_name}
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: '50%',
                          objectFit: 'cover',
                          border: '2px solid #e2e8f0',
                        }}
                      />
                    ) : (
                      <div
                        style={{
                          width: 42,
                          height: 42,
                          borderRadius: '50%',
                          background: getPlatformBg(ch.platform),
                          color: getPlatformColor(ch.platform),
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontWeight: 700,
                          fontSize: 16,
                          border: '1px solid #cbd5e1',
                        }}
                      >
                        {ch.channel_name.charAt(0).toUpperCase()}
                      </div>
                    )}
                    {/* Platform Badge Overlay */}
                    <div
                      style={{
                        position: 'absolute',
                        bottom: -2,
                        right: -2,
                        width: 18,
                        height: 18,
                        borderRadius: '50%',
                        background: getPlatformColor(ch.platform),
                        color: '#fff',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        boxShadow: '0 0 0 2px #fff',
                      }}
                    >
                      {ch.platform === 'youtube' && <YouTubeIcon size={10} />}
                      {ch.platform === 'tiktok' && <TikTokIcon size={10} />}
                      {ch.platform === 'facebook' && <FacebookIcon size={10} />}
                    </div>
                  </div>

                  {/* Text Details */}
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <strong
                        style={{
                          fontSize: 14,
                          color: '#0f172a',
                          whiteSpace: 'nowrap',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                        }}
                        title={ch.channel_name}
                      >
                        {ch.channel_name}
                      </strong>
                      <span
                        style={{
                          fontSize: 10.5,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 4,
                          textTransform: 'uppercase',
                          background: getPlatformBg(ch.platform),
                          color: getPlatformColor(ch.platform),
                        }}
                      >
                        {ch.platform}
                      </span>
                    </div>

                    <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 3 }}>
                      {ch.account_email ? <span>{ch.account_email} · </span> : null}
                      Hôm nay: <strong style={{ color: ch.today_count > 0 ? '#16a34a' : '#e11d48' }}>{ch.today_count} bài</strong>
                      {' · '}
                      Lịch phát: <strong style={{ color: ch.buffer_days >= 3 ? '#16a34a' : ch.buffer_days > 0 ? '#d97706' : '#e11d48' }}>{ch.buffer_days} ngày tới</strong>
                    </div>
                  </div>
                </div>

                {/* Status & Action */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  {ch.status === 'unposted' && (
                    <span
                      style={{
                        padding: '4px 8px',
                        background: '#fee2e2',
                        color: '#dc2626',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <AlertCircle size={12} /> Chưa đăng
                    </span>
                  )}
                  {ch.status === 'warning' && (
                    <span
                      style={{
                        padding: '4px 8px',
                        background: '#fef3c7',
                        color: '#b45309',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <AlertTriangle size={12} /> Cần nạp bài
                    </span>
                  )}
                  {ch.status === 'healthy' && (
                    <span
                      style={{
                        padding: '4px 8px',
                        background: '#dcfce7',
                        color: '#15803d',
                        borderRadius: 6,
                        fontSize: 11,
                        fontWeight: 700,
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <CheckCircle2 size={12} /> Đã có lịch
                    </span>
                  )}

                  {/* 1-Click Action Button */}
                  <button
                    type="button"
                    onClick={() => {
                      onClose()
                      if (ch.platform === 'youtube') {
                        onNavigate('Lên lịch Youtube')
                      } else {
                        onNavigate('Lên lịch Pippit')
                      }
                    }}
                    style={{
                      background: getPlatformColor(ch.platform),
                      color: '#fff',
                      border: 'none',
                      borderRadius: 8,
                      padding: '6px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    Lên lịch <ExternalLink size={11} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {/* Footer info */}
        <div
          style={{
            padding: '12px 24px',
            borderTop: '1px solid #e2e8f0',
            background: '#f8fafc',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 12,
            color: '#64748b',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Clock size={13} />
            <span>Thuật toán Shorts &amp; TikTok ưu tiên duy trì đăng 1-3 video đều đặn mỗi ngày.</span>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              background: '#fff',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: '5px 14px',
              fontSize: 12,
              fontWeight: 600,
              color: '#334155',
              cursor: 'pointer',
            }}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  )
}
