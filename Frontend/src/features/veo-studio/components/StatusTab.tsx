import { RefreshCw, ExternalLink, Wifi, WifiOff, User, Shield, Clock } from 'lucide-react'
import type { VeoBridgeStatus } from '../types'

interface Props {
  status: VeoBridgeStatus | null
  loading: boolean
  onRefresh: () => void
}

export function StatusTab({ status, loading, onRefresh }: Props) {
  if (!status) {
    return (
      <div className="veo-tab-content">
        <div className="veo-notice">
          <span>⏳</span>
          <div>
            <strong>Đang kết nối...</strong>
            <p>Đang kiểm tra trạng thái Bridge Server.</p>
          </div>
        </div>
      </div>
    )
  }

  const uptimeMin = Math.floor(status.bridge_uptime_seconds / 60)
  const uptimeHr = Math.floor(uptimeMin / 60)
  const uptimeStr = uptimeHr > 0 ? `${uptimeHr}h ${uptimeMin % 60}m` : `${uptimeMin}m`

  return (
    <div className="veo-tab-content">
      {/* Bridge Status */}
      <div className="veo-status-card">
        <div className="veo-status-header">
          {status.bridge_running ? <Wifi size={16} className="veo-led green" /> : <WifiOff size={16} className="veo-led red" />}
          <strong>Bridge Server</strong>
          <button className="veo-refresh-btn" onClick={onRefresh} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'spinning' : ''} />
          </button>
        </div>
        <div className="veo-status-grid">
          <span>Cổng</span>
          <span>127.0.0.1:{status.bridge_port}</span>
          <span>Trạng thái</span>
          <span className={status.bridge_running ? 'veo-green' : 'veo-red'}>
            {status.bridge_running ? '🟢 Đang chạy' : '🔴 Dừng'}
          </span>
          <span>Uptime</span>
          <span>{uptimeStr}</span>
          <span>Secret</span>
          <span>{status.secret_generated ? '🔑 Đã tạo' : '❌ Chưa tạo'}</span>
        </div>
      </div>

      {/* Extension Status */}
      <div className="veo-status-card">
        <div className="veo-status-header">
          {status.extension.connected ? <Wifi size={16} className="veo-led green" /> : <WifiOff size={16} className="veo-led red" />}
          <strong>Chrome Extension</strong>
        </div>
        <div className="veo-status-grid">
          <span>Kết nối</span>
          <span className={status.extension.connected ? 'veo-green' : 'veo-red'}>
            {status.extension.connected ? '🟢 Online' : '🔴 Offline'}
          </span>
          <span>Phiên bản</span>
          <span>{status.extension.version || '—'}</span>
          <span>Tab Google</span>
          <span>{status.extension.tab_count} tab</span>
          <span>Heartbeat</span>
          <span>
            {status.extension.last_heartbeat
              ? new Date(status.extension.last_heartbeat).toLocaleTimeString('vi-VN')
              : '—'}
          </span>
        </div>
      </div>

      {/* CAPTCHA Stats */}
      <div className="veo-status-card">
        <div className="veo-status-header">
          <Shield size={16} />
          <strong>reCAPTCHA</strong>
        </div>
        <div className="veo-status-grid">
          <span>Queue</span>
          <span>{status.captcha_queue_size} pending</span>
          <span>Đã giải</span>
          <span>{status.total_captcha_solved} token</span>
          <span>Lần cuối</span>
          <span>
            {status.last_captcha_at
              ? new Date(status.last_captcha_at).toLocaleTimeString('vi-VN')
              : '—'}
          </span>
        </div>
      </div>

      {/* Accounts */}
      <div className="veo-status-card">
        <div className="veo-status-header">
          <User size={16} />
          <strong>Tài khoản ({status.accounts.length})</strong>
        </div>
        {status.accounts.length > 0 ? (
          <div className="veo-accounts-list">
            {status.accounts.map((acc) => (
              <div className="veo-account-row" key={acc.email}>
                <div className="veo-account-info">
                  <strong>{acc.email}</strong>
                  <small>
                    {acc.tier.toUpperCase()}
                    {acc.credits != null ? ` · ${acc.credits} credits` : ''}
                  </small>
                </div>
                <div className="veo-account-badges">
                  <span className={`veo-badge ${acc.has_token ? 'green' : 'red'}`}>Token</span>
                  <span className={`veo-badge ${acc.session_valid ? 'green' : 'red'}`}>Session</span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="veo-empty-hint">
            <User size={14} />
            Chưa có tài khoản. Nạp Extension vào Chrome và mở labs.google.
          </div>
        )}
      </div>

      {/* Quick Actions */}
      <div className="veo-quick-actions">
        <a
          href="https://labs.google/fx/tools/flow"
          target="_blank"
          rel="noopener noreferrer"
          className="veo-action-btn"
        >
          <ExternalLink size={14} /> Mở Google Flow
        </a>
      </div>
    </div>
  )
}
