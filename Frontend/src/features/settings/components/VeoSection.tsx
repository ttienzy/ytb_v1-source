import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
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
  const [, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Accordion toggles
  const [showManualForm, setShowManualForm] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

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
      setShowManualForm(false)
      await loadStatus()
    } catch (err: any) {
      setError(err?.message || 'Không thể lưu credentials.')
    } finally {
      setManualSaving(false)
    }
  }

  return (
    <div className="tab-fade-in" style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Alert Messages */}
      {message && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: '#dcfce7',
            border: '1px solid #bbf7d0',
            color: '#15803d',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
          }}
        >
          <CheckCircle2 size={15} /> {message}
        </div>
      )}

      {error && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12.5,
          }}
        >
          <AlertCircle size={15} /> {error}
        </div>
      )}

      {/* Main Card */}
      <div className="mailtm-card" style={{ padding: '16px 20px' }}>
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
          <div
            style={{
              display: 'grid',
              width: 36,
              height: 36,
              placeItems: 'center',
              background: '#f1f5f9',
              color: '#475569',
              borderRadius: 9,
              flexShrink: 0,
            }}
          >
            <Clapperboard size={18} />
          </div>
          <div>
            <h3 className="gemini-title" style={{ fontSize: 14.5, fontWeight: 700 }}>
              Cài đặt Google Veo &amp; Google Flow Labs
            </h3>
            <p className="gemini-subtitle">
              Quản lý kết nối Bridge Server, tài khoản Google Flow và kiểm tra số dư Credits.
            </p>
          </div>
        </div>

        {/* Status Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: 12,
            marginBottom: 16,
          }}
        >
          {/* Bridge Server Card */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 500 }}>Bridge Server</span>
              {status?.bridge_running ? (
                <span style={{ fontSize: 11, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                  <Wifi size={12} /> Đang chạy
                </span>
              ) : (
                <span style={{ fontSize: 11, color: '#ef4444', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                  <WifiOff size={12} /> Dừng
                </span>
              )}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>
              127.0.0.1:{status?.bridge_port || 56526}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              Secret Key:{' '}
              <span style={{ color: status?.secret_generated ? '#16a34a' : '#94a3b8', fontWeight: 600 }}>
                {status?.secret_generated ? 'Đã tạo ✓' : 'Chưa tạo'}
              </span>
            </div>
          </div>

          {/* Chrome Extension Card */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 500 }}>Chrome Extension</span>
              {status?.extension.connected ? (
                <span style={{ fontSize: 11, color: '#16a34a', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                  <CheckCircle2 size={12} /> Đã kết nối
                </span>
              ) : (
                <span style={{ fontSize: 11, color: '#d97706', display: 'flex', alignItems: 'center', gap: 4, fontWeight: 600 }}>
                  <AlertCircle size={12} /> Chưa kết nối
                </span>
              )}
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>
              {status?.extension.connected ? `${status.extension.tab_count} tab Google Flow` : 'Offline'}
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              Heartbeat: {status?.extension.last_heartbeat ? new Date(status.extension.last_heartbeat).toLocaleTimeString() : 'Chưa có'}
            </div>
          </div>

          {/* reCAPTCHA Solver Card */}
          <div
            style={{
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 10,
              padding: '12px 14px',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 500 }}>reCAPTCHA Solver</span>
              <Shield size={13} color="#64748b" />
            </div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>
              {status?.total_captcha_solved ?? 0} token đã giải
            </div>
            <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
              Pending: {status?.captcha_queue_size ?? 0}
            </div>
          </div>
        </div>

        {/* Accounts & Credits Section */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: 14,
            marginBottom: 14,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <Coins size={14} color="#64748b" />
              <h4 style={{ margin: 0, fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>
                Tài khoản &amp; Số dư Credits ({status?.accounts.length || 0})
              </h4>
            </div>
            <button
              type="button"
              className="mailtm-btn-refresh"
              onClick={handleRefreshCredits}
              disabled={refreshing}
              style={{ height: 28, padding: '0 10px', fontSize: 11.5, gap: 5 }}
            >
              {refreshing ? <Loader2 size={12} className="spin" /> : <RefreshCw size={12} />}
              Làm mới Credits ngay
            </button>
          </div>

          {status && status.accounts.length > 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {status.accounts.map((acc) => (
                <div
                  key={acc.email}
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '10px 12px',
                    borderRadius: 8,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        width: 32,
                        height: 32,
                        borderRadius: '50%',
                        background: '#e2e8f0',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: '#475569',
                        flexShrink: 0,
                      }}
                    >
                      <User size={15} />
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12.5, color: '#0f172a' }}>{acc.email}</div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                        <span
                          style={{
                            fontSize: 10,
                            padding: '1px 6px',
                            borderRadius: 4,
                            background: '#f1f5f9',
                            color: '#475569',
                            border: '1px solid #cbd5e1',
                            fontWeight: 600,
                          }}
                        >
                          {acc.tier}
                        </span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>
                          {acc.last_updated ? `Cập nhật: ${new Date(acc.last_updated).toLocaleTimeString()}` : ''}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Credits & Status */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      style={{
                        textAlign: 'right',
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: '#fefce8',
                        border: '1px solid #fef08a',
                      }}
                    >
                      <div style={{ fontSize: 9.5, color: '#854d0e', textTransform: 'uppercase', fontWeight: 600 }}>
                        Credits khả dụng
                      </div>
                      <div style={{ fontSize: 15, fontWeight: 700, color: '#a16207', lineHeight: 1.2 }}>
                        {acc.credits != null ? acc.credits : '—'}
                      </div>
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 3,
                          background: acc.has_token ? '#dcfce7' : '#fee2e2',
                          color: acc.has_token ? '#16a34a' : '#ef4444',
                          fontWeight: 600,
                          textAlign: 'center',
                        }}
                      >
                        Token {acc.has_token ? '✓' : '✗'}
                      </span>
                      <span
                        style={{
                          fontSize: 10,
                          padding: '1px 6px',
                          borderRadius: 3,
                          background: acc.session_valid ? '#dcfce7' : '#fee2e2',
                          color: acc.session_valid ? '#16a34a' : '#ef4444',
                          fontWeight: 600,
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
                padding: 20,
                textAlign: 'center',
                borderRadius: 8,
                background: '#f8fafc',
                border: '1px dashed #cbd5e1',
              }}
            >
              <User size={24} style={{ color: '#94a3b8', margin: '0 auto 6px' }} />
              <div style={{ fontSize: 12.5, color: '#334155', fontWeight: 600 }}>Chưa có tài khoản nào được kết nối</div>
              <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4, maxWidth: 440, margin: '4px auto 0' }}>
                Hãy nạp Extension vào Chrome và mở tab <code>https://labs.google/fx/tools/flow</code> đã đăng nhập, hoặc nhập cookie thủ công bên dưới.
              </div>
              <div style={{ marginTop: 10 }}>
                <a
                  href="https://labs.google/fx/tools/flow"
                  target="_blank"
                  rel="noreferrer"
                  className="mailtm-btn-refresh"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    fontSize: 11.5,
                    height: 28,
                    padding: '0 10px',
                    textDecoration: 'none',
                  }}
                >
                  <ExternalLink size={12} color="#64748b" /> Mở Google Flow trong Chrome
                </a>
              </div>
            </div>
          )}
        </div>

        {/* Manual Cookie Dropdown / Accordion Card */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: 14,
            marginBottom: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
              fontWeight: 600,
              fontSize: 12.5,
              color: '#0f172a',
            }}
            onClick={() => setShowManualForm(!showManualForm)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <KeyRound size={14} color="#64748b" />
              <span>Nhập Cookie / Access Token thủ công (Tùy chọn)</span>
            </div>
            {showManualForm ? <ChevronUp size={15} color="#64748b" /> : <ChevronDown size={15} color="#64748b" />}
          </div>

          {showManualForm && (
            <form onSubmit={handleSaveManual} style={{ marginTop: 12 }}>
              <p style={{ fontSize: 11.5, color: '#64748b', marginTop: 0, marginBottom: 12 }}>
                Dành cho trường hợp bạn không muốn chạy Chrome Extension mà muốn dán trực tiếp Cookie hoặc Access Token từ Developer Tools.
              </p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                    Email tài khoản Google
                  </label>
                  <input
                    type="email"
                    className="mailtm-input"
                    value={manualEmail}
                    onChange={(e) => setManualEmail(e.target.value)}
                    placeholder="yourname@gmail.com"
                    style={{ width: '100%', height: 32, fontSize: 12 }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                    Cookie <code>labs.google</code> (chứa <code>__Secure-next-auth.session-token</code>)
                  </label>
                  <textarea
                    value={manualCookie}
                    onChange={(e) => setManualCookie(e.target.value)}
                    placeholder="__Secure-next-auth.session-token=...; SAPISID=..."
                    rows={3}
                    style={{
                      width: '100%',
                      padding: '8px 10px',
                      borderRadius: 6,
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      color: '#0f172a',
                      fontSize: 11.5,
                      fontFamily: 'monospace',
                      resize: 'vertical',
                    }}
                  />
                </div>

                <div>
                  <label style={{ fontSize: 11.5, fontWeight: 600, color: '#334155', display: 'block', marginBottom: 4 }}>
                    Access Token OAuth2 (Tùy chọn)
                  </label>
                  <input
                    type="text"
                    className="mailtm-input"
                    value={manualToken}
                    onChange={(e) => setManualToken(e.target.value)}
                    placeholder="ya29.a0Ac..."
                    style={{ width: '100%', height: 32, fontSize: 12, fontFamily: 'monospace' }}
                  />
                </div>

                <div style={{ marginTop: 2, display: 'flex', justifyContent: 'flex-end' }}>
                  <button
                    type="submit"
                    className="mailtm-btn-primary"
                    disabled={manualSaving}
                    style={{ height: 30, padding: '0 12px', fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 5 }}
                  >
                    {manualSaving ? <Loader2 size={12} className="spin" /> : <Save size={12} />}
                    Lưu cấu hình thủ công
                  </button>
                </div>
              </div>
            </form>
          )}
        </div>

        {/* Extension Setup Guide Accordion */}
        <div
          style={{
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 10,
            padding: 12,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              cursor: 'pointer',
            }}
            onClick={() => setShowGuide(!showGuide)}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
              <HelpCircle size={14} color="#64748b" />
              <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                Hướng dẫn kết nối tự động bằng Chrome Extension
              </span>
            </div>
            {showGuide ? <ChevronUp size={14} color="#64748b" /> : <ChevronDown size={14} color="#64748b" />}
          </div>

          {showGuide && (
            <ol style={{ fontSize: 11.5, color: '#475569', margin: '10px 0 0', paddingLeft: 18, lineHeight: 1.6 }}>
              <li>
                Mở trình duyệt Google Chrome, truy cập <code>chrome://extensions</code> và bật công tắc <strong>Developer mode</strong>.
              </li>
              <li>
                Bấm <strong>Load unpacked</strong> và chọn thư mục:{' '}
                <code style={{ background: '#e2e8f0', padding: '1px 5px', borderRadius: 4, color: '#0f172a', fontSize: 11 }}>
                  tools\Extensions\FlowsVeo-Clean
                </code>
              </li>
              <li>
                Mở tab <code>https://labs.google/fx/tools/flow</code> và đăng nhập tài khoản Google. Extension sẽ tự động đồng bộ Cookie, Token và số dư Credits về ứng dụng này.
              </li>
            </ol>
          )}
        </div>
      </div>
    </div>
  )
}
