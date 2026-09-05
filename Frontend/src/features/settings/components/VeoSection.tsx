import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clapperboard,
  Coins,
  ExternalLink,
  HelpCircle,
  KeyRound,
  Loader2,
  RefreshCw,
  Save,
  Shield,
  User,
  Wifi,
  WifiOff,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { VeoBridgeStatus } from '../../veo-studio/types'

export function VeoSection() {
  const [status, setStatus] = useState<VeoBridgeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Manual credentials form
  const [manualEmail, setManualEmail] = useState('')
  const [manualCookie, setManualCookie] = useState('')
  const [manualToken, setManualToken] = useState('')
  const [manualSaving, setManualSaving] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/veo/status`)
      if (!res.ok) throw new Error('Không thể tải trạng thái Veo')
      const data: VeoBridgeStatus = await res.json()
      setStatus(data)
    } catch {
      setError('Không kết nối được với Veo Bridge service.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
    const interval = setInterval(loadStatus, 6000)
    return () => clearInterval(interval)
  }, [loadStatus])

  // Lệnh yêu cầu Extension đọc lại credits từ Google Flow
  async function handleRefreshCredits() {
    setRefreshing(true)
    setMessage('')
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/veo/refresh-credits`, { method: 'POST' })
      if (!res.ok) throw new Error('Yêu cầu làm mới thất bại')
      setMessage('Đã gửi yêu cầu làm mới. Đang đồng bộ từ tab Google Flow...')

      // Poll lại sau 2.5s và 5s để cập nhật kết quả mới nhất
      setTimeout(loadStatus, 2500)
      setTimeout(loadStatus, 5000)
    } catch (err: any) {
      setError(err?.message || 'Không thể yêu cầu làm mới credits')
    } finally {
      setRefreshing(false)
    }
  }

  // Lưu credentials thủ công
  async function handleSaveManual(e: React.FormEvent) {
    e.preventDefault()
    if (!manualEmail.trim() || !manualCookie.trim()) {
      setError('Vui lòng nhập Email và Cookie.')
      return
    }
    setManualSaving(true)
    setMessage('')
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/veo/manual-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: manualEmail.trim(),
          cookie: manualCookie.trim(),
          access_token: manualToken.trim(),
        }),
      })
      if (!res.ok) throw new Error('Lưu thất bại')
      const data = await res.json()
      setMessage(data.message || 'Đã lưu thông tin xác thực.')
      setManualCookie('')
      setManualToken('')
      await loadStatus()
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu credentials.')
    } finally {
      setManualSaving(false)
    }
  }

  return (
    <div className="tab-fade-in" style={{ maxWidth: 860 }}>
      {/* ── Header ── */}
      <div className="section-header" style={{ marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Clapperboard size={22} style={{ color: '#ef7420' }} />
          <div>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 600 }}>
              Cài đặt Google Veo &amp; Google Flow Labs
            </h3>
            <p style={{ margin: 0, fontSize: 13, color: '#9ca3af', marginTop: 2 }}>
              Quản lý kết nối Bridge Server, tài khoản Google Flow và kiểm tra số dư Credits.
            </p>
          </div>
        </div>
      </div>

      {message && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(34, 197, 94, 0.1)',
            border: '1px solid rgba(34, 197, 94, 0.25)',
            color: '#22c55e',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
          }}
        >
          <CheckCircle2 size={16} /> {message}
        </div>
      )}

      {error && (
        <div
          style={{
            marginBottom: 14,
            padding: '10px 14px',
            borderRadius: 8,
            background: 'rgba(239, 68, 68, 0.1)',
            border: '1px solid rgba(239, 68, 68, 0.25)',
            color: '#ef4444',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 13,
          }}
        >
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* ── Status Grid ── */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 12,
          marginBottom: 16,
        }}
      >
        {/* Bridge Server Card */}
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>Bridge Server</span>
            {status?.bridge_running ? (
              <span style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                <Wifi size={13} /> Đang chạy
              </span>
            ) : (
              <span style={{ fontSize: 11, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4 }}>
                <WifiOff size={13} /> Dừng
              </span>
            )}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#f3f4f6' }}>
            127.0.0.1:{status?.bridge_port || 56526}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            Secret Key: {status?.secret_generated ? 'Đã tạo ✓' : 'Chưa tạo'}
          </div>
        </div>

        {/* Extension Card */}
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>Chrome Extension</span>
            {status?.extension.connected ? (
              <span style={{ fontSize: 11, color: '#22c55e', display: 'flex', alignItems: 'center', gap: 4 }}>
                <CheckCircle2 size={13} /> Đã kết nối
              </span>
            ) : (
              <span style={{ fontSize: 11, color: '#f59e0b', display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertCircle size={13} /> Chưa kết nối
              </span>
            )}
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#f3f4f6' }}>
            {status?.extension.connected ? `${status.extension.tab_count} tab Google Flow` : 'Offline'}
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            Heartbeat: {status?.extension.last_heartbeat ? new Date(status.extension.last_heartbeat).toLocaleTimeString() : 'Chưa có'}
          </div>
        </div>

        {/* Captcha Queue Card */}
        <div
          style={{
            padding: 14,
            borderRadius: 10,
            background: 'rgba(255, 255, 255, 0.03)',
            border: '1px solid rgba(255, 255, 255, 0.08)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 12, color: '#9ca3af', fontWeight: 500 }}>reCAPTCHA Solver</span>
            <Shield size={14} style={{ color: '#3b82f6' }} />
          </div>
          <div style={{ fontSize: 15, fontWeight: 600, color: '#f3f4f6' }}>
            {status?.total_captcha_solved ?? 0} token đã giải
          </div>
          <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
            Pending: {status?.captcha_queue_size ?? 0}
          </div>
        </div>
      </div>

      {/* ── Accounts & Credits Section ── */}
      <div
        style={{
          padding: 18,
          borderRadius: 12,
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Coins size={18} style={{ color: '#eab308' }} />
            <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
              Tài khoản &amp; Số dư Credits ({status?.accounts.length || 0})
            </h4>
          </div>
          <button
            type="button"
            className="primary-button"
            onClick={handleRefreshCredits}
            disabled={refreshing}
            style={{
              padding: '6px 12px',
              fontSize: 12,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
            }}
          >
            {refreshing ? <Loader2 size={13} className="spinning" /> : <RefreshCw size={13} />}
            Làm mới Credits ngay
          </button>
        </div>

        {status && status.accounts.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {status.accounts.map((acc) => (
              <div
                key={acc.email}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  padding: '12px 16px',
                  borderRadius: 8,
                  background: 'rgba(0, 0, 0, 0.25)',
                  border: '1px solid rgba(255, 255, 255, 0.06)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  <div
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: '50%',
                      background: 'rgba(239, 116, 32, 0.15)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ef7420',
                    }}
                  >
                    <User size={18} />
                  </div>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: 14, color: '#f3f4f6' }}>{acc.email}</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                      <span
                        style={{
                          fontSize: 11,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: acc.tier === 'ULTRA' ? 'rgba(168, 85, 247, 0.2)' : 'rgba(59, 130, 246, 0.2)',
                          color: acc.tier === 'ULTRA' ? '#c084fc' : '#60a5fa',
                          fontWeight: 600,
                        }}
                      >
                        {acc.tier}
                      </span>
                      <span style={{ fontSize: 11, color: '#6b7280' }}>
                        {acc.last_updated ? `Cập nhật: ${new Date(acc.last_updated).toLocaleTimeString()}` : ''}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Credits Pill */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div
                    style={{
                      textAlign: 'right',
                      padding: '6px 12px',
                      borderRadius: 8,
                      background: 'rgba(234, 179, 8, 0.12)',
                      border: '1px solid rgba(234, 179, 8, 0.3)',
                    }}
                  >
                    <div style={{ fontSize: 11, color: '#ca8a04', textTransform: 'uppercase', fontWeight: 600 }}>
                      Credits khả dụng
                    </div>
                    <div style={{ fontSize: 18, fontWeight: 700, color: '#facc15' }}>
                      {acc.credits != null ? acc.credits : '—'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 3,
                        background: acc.has_token ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                        color: acc.has_token ? '#22c55e' : '#ef4444',
                        fontWeight: 500,
                        textAlign: 'center',
                      }}
                    >
                      Token {acc.has_token ? '✓' : '✗'}
                    </span>
                    <span
                      style={{
                        fontSize: 10,
                        padding: '2px 6px',
                        borderRadius: 3,
                        background: acc.session_valid ? 'rgba(34, 197, 94, 0.2)' : 'rgba(239, 68, 68, 0.2)',
                        color: acc.session_valid ? '#22c55e' : '#ef4444',
                        fontWeight: 500,
                        textAlign: 'center',
                      }}
                    >
                      Session {acc.session_valid ? '✓' : '✗'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div
            style={{
              padding: 24,
              textAlign: 'center',
              borderRadius: 8,
              background: 'rgba(0, 0, 0, 0.15)',
              border: '1px dashed rgba(255, 255, 255, 0.1)',
            }}
          >
            <User size={28} style={{ color: '#6b7280', marginBottom: 8 }} />
            <div style={{ fontSize: 14, color: '#9ca3af', fontWeight: 500 }}>Chưa có tài khoản nào được kết nối</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4, maxWidth: 460, margin: '4px auto 0' }}>
              Hãy nạp Extension vào Chrome và mở tab <code>https://labs.google/fx/tools/flow</code> đã đăng nhập, hoặc nhập cookie thủ công bên dưới.
            </div>
            <div style={{ marginTop: 12 }}>
              <a
                href="https://labs.google/fx/tools/flow"
                target="_blank"
                rel="noreferrer"
                className="chrome-button"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, textDecoration: 'none' }}
              >
                <ExternalLink size={13} /> Mở Google Flow trong Chrome
              </a>
            </div>
          </div>
        )}
      </div>

      {/* ── Manual Cookie Input Card ── */}
      <div
        style={{
          padding: 18,
          borderRadius: 12,
          background: 'rgba(255, 255, 255, 0.02)',
          border: '1px solid rgba(255, 255, 255, 0.08)',
          marginBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <KeyRound size={17} style={{ color: '#60a5fa' }} />
          <h4 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            Nhập Cookie / Access Token thủ công (Tùy chọn)
          </h4>
        </div>
        <p style={{ fontSize: 12, color: '#9ca3af', marginTop: 0, marginBottom: 12 }}>
          Dành cho trường hợp bạn không muốn chạy Chrome Extension mà muốn dán trực tiếp Cookie hoặc Access Token từ Developer Tools.
        </p>

        <form onSubmit={handleSaveManual}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: '#d1d5db', display: 'block', marginBottom: 4 }}>
                Email tài khoản Google
              </label>
              <input
                type="email"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                placeholder="yourname@gmail.com"
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f3f4f6',
                  fontSize: 13,
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: '#d1d5db', display: 'block', marginBottom: 4 }}>
                Cookie <code>labs.google</code> (chứa <code>__Secure-next-auth.session-token</code>)
              </label>
              <textarea
                value={manualCookie}
                onChange={(e) => setManualCookie(e.target.value)}
                placeholder="__Secure-next-auth.session-token=...; SAPISID=..."
                rows={3}
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f3f4f6',
                  fontSize: 12,
                  fontFamily: 'monospace',
                  resize: 'vertical',
                }}
              />
            </div>

            <div>
              <label style={{ fontSize: 12, fontWeight: 500, color: '#d1d5db', display: 'block', marginBottom: 4 }}>
                Access Token OAuth2 (Tùy chọn)
              </label>
              <input
                type="text"
                value={manualToken}
                onChange={(e) => setManualToken(e.target.value)}
                placeholder="ya29.a0Ac..."
                style={{
                  width: '100%',
                  padding: '8px 12px',
                  borderRadius: 6,
                  background: 'rgba(0, 0, 0, 0.3)',
                  border: '1px solid rgba(255, 255, 255, 0.12)',
                  color: '#f3f4f6',
                  fontSize: 12,
                  fontFamily: 'monospace',
                }}
              />
            </div>

            <div style={{ marginTop: 4 }}>
              <button
                type="submit"
                className="primary-button"
                disabled={manualSaving}
                style={{ padding: '8px 16px', fontSize: 13, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {manualSaving ? <Loader2 size={14} className="spinning" /> : <Save size={14} />}
                Lưu cấu hình thủ công
              </button>
            </div>
          </div>
        </form>
      </div>

      {/* ── Extension Setup Guide Card ── */}
      <div
        style={{
          padding: 16,
          borderRadius: 12,
          background: 'rgba(239, 116, 32, 0.04)',
          border: '1px solid rgba(239, 116, 32, 0.18)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
          <HelpCircle size={16} style={{ color: '#ef7420' }} />
          <strong style={{ fontSize: 14, color: '#fdba74' }}>Hướng dẫn kết nối tự động bằng Chrome Extension</strong>
        </div>
        <ol style={{ fontSize: 13, color: '#d1d5db', margin: 0, paddingLeft: 20, lineHeight: 1.6 }}>
          <li>
            Mở trình duyệt Google Chrome, truy cập <code>chrome://extensions</code> và bật công tắc <strong>Developer mode</strong>.
          </li>
          <li>
            Bấm <strong>Load unpacked</strong> và chọn thư mục: <br />
            <code style={{ background: 'rgba(0,0,0,0.3)', padding: '2px 6px', borderRadius: 4, color: '#f3f4f6' }}>
              tools\Extensions\FlowsVeo-Clean
            </code>
          </li>
          <li>
            Mở tab <code>https://labs.google/fx/tools/flow</code> và đăng nhập tài khoản Google. Extension sẽ tự động đồng bộ Cookie, Token và số dư Credits về ứng dụng này.
          </li>
        </ol>
      </div>
    </div>
  )
}
