import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Film,
  HelpCircle,
  KeyRound,
  Loader2,
  Lock,
  LogOut,
  Save,
  Settings,
  Tv,
  UploadCloud,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'

export function YouTubeBrandIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

interface YouTubeStatus {
  connected: boolean
  auth_type: string
  email: string
  name: string
  avatar_url: string
  channel_id: string
  channel_title: string
  channel_custom_url: string
  channel_avatar_url: string
  subscriber_count: number
  video_count: number
  default_privacy: string
  default_tags: string
  auto_upload: boolean
  has_credentials: boolean
  client_id: string
  message: string
}

export function YouTubeSection() {
  const [status, setStatus] = useState<YouTubeStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Settings inputs
  const [defaultPrivacy, setDefaultPrivacy] = useState('private')
  const [defaultTags, setDefaultTags] = useState('')
  const [autoUpload, setAutoUpload] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)

  // Credentials inputs
  const [showCredForm, setShowCredForm] = useState(false)
  const [clientId, setClientId] = useState('')
  const [clientSecret, setClientSecret] = useState('')
  const [credJson, setCredJson] = useState('')
  const [savingCreds, setSavingCreds] = useState(false)

  // Manual Auth Code Exchange
  const [showManualCode, setShowManualCode] = useState(false)
  const [authUrl, setAuthUrl] = useState('')
  const [manualCode, setManualCode] = useState('')
  const [exchangingCode, setExchangingCode] = useState(false)

  async function loadStatus() {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/youtube/status`)
      if (!res.ok) throw new Error()
      const data: YouTubeStatus = await res.json()
      setStatus(data)
      setDefaultPrivacy(data.default_privacy || 'private')
      setDefaultTags(data.default_tags || '')
      setAutoUpload(!!data.auto_upload)
      if (data.client_id) {
        setClientId(data.client_id)
      }
      if (!data.has_credentials) {
        setShowCredForm(true)
      }
    } catch {
      setError('Không thể kết nối với dịch vụ YouTube của Backend.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  async function handleSaveCredentials(e?: React.FormEvent) {
    if (e) e.preventDefault()
    if (!credJson.trim() && (!clientId.trim() || !clientSecret.trim())) {
      setError('Vui lòng nhập cả Client ID & Client Secret hoặc dán nội dung file credentials.json.')
      return
    }
    setSavingCreds(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/youtube/credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId.trim() || null,
          client_secret: clientSecret.trim() || null,
          credentials_json: credJson.trim() || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Lưu thông tin xác thực thất bại.')
      }
      setStatus(data)
      setMessage('Đã lưu cấu hình Google OAuth Client ID cho YouTube thành công!')
      setShowCredForm(false)
    } catch (err: any) {
      setError(err.message || 'Lưu thông tin xác thực thất bại.')
    } finally {
      setSavingCreds(false)
    }
  }

  async function handleAutoLogin() {
    if (!status?.has_credentials && !clientId.trim()) {
      setError('Vui lòng nhập Client ID & Client Secret của Google Cloud trước khi đăng nhập.')
      setShowCredForm(true)
      return
    }

    setActionLoading(true)
    setMessage('Đang mở trình duyệt Google để xác thực YouTube... Vui lòng đăng nhập và cấp quyền.')
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/youtube/login`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Đăng nhập YouTube thất bại.')
      }
      setStatus(data)
      setMessage('Kết nối kênh YouTube thành công!')
    } catch (err: any) {
      setError(err.message || 'Đăng nhập tự động thất bại.')
      setShowManualCode(true)
      handleGetAuthUrl()
    } finally {
      setActionLoading(false)
    }
  }

  async function handleGetAuthUrl() {
    try {
      const res = await fetch(`${API_URL}/api/youtube/auth-url?redirect_uri=${encodeURIComponent('http://localhost:8080/')}`)
      const data = await res.json()
      if (res.ok && data.auth_url) {
        setAuthUrl(data.auth_url)
      }
    } catch {
      // ignore
    }
  }

  async function handleExchangeManualCode() {
    if (!manualCode.trim()) {
      setError('Vui lòng dán Authorization Code hoặc link chuyển hướng sau khi đăng nhập.')
      return
    }
    setExchangingCode(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/youtube/exchange-code`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: manualCode.trim(),
          redirect_uri: 'http://localhost:8080/',
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Xác thực mã Authorization Code thất bại.')
      }
      setStatus(data)
      setMessage('Xác thực và kết nối kênh YouTube thành công!')
      setShowManualCode(false)
      setManualCode('')
    } catch (err: any) {
      setError(err.message || 'Xác thực mã thất bại.')
    } finally {
      setExchangingCode(false)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Bạn có chắc chắn muốn ngắt kết nối kênh YouTube này?')) {
      return
    }
    setActionLoading(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/youtube/disconnect`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error()
      await loadStatus()
      setMessage('Đã ngắt kết nối tài khoản YouTube.')
    } catch {
      setError('Ngắt kết nối thất bại.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleSaveSettings() {
    setSavingSettings(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/youtube/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          default_privacy: defaultPrivacy,
          default_tags: defaultTags,
          auto_upload: autoUpload,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Lưu cài đặt thất bại.')
      }
      setStatus(data)
      setMessage('Đã lưu cấu hình YouTube thành công!')
    } catch (err: any) {
      setError(err.message || 'Lưu cài đặt thất bại.')
    } finally {
      setSavingSettings(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Notifications */}
      {message && (
        <div
          style={{
            background: '#f0fdf4',
            border: '1px solid #86efac',
            color: '#15803d',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 12.5,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <CheckCircle2 size={16} />
          <span>{message}</span>
        </div>
      )}

      {error && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#dc2626',
            borderRadius: 10,
            padding: '10px 14px',
            fontSize: 12.5,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {/* Main YouTube Connection Card */}
      <div className="card" style={{ padding: 20 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                display: 'grid',
                width: 44,
                height: 44,
                placeItems: 'center',
                background: status?.connected ? '#fef2f2' : '#f1f5f9',
                color: status?.connected ? '#dc2626' : '#64748b',
                borderRadius: 12,
                flexShrink: 0,
              }}
            >
              <YouTubeBrandIcon size={26} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                Kênh YouTube &amp; Tự động hoá Video
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                Lưu trữ xác thực OAuth 2.0 để tự động đăng tải và quản lý video trực tiếp lên YouTube Studio
              </p>
            </div>
          </div>

          <div>
            {status?.connected ? (
              <button
                type="button"
                className="btn-cancel"
                onClick={handleDisconnect}
                disabled={actionLoading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  color: '#dc2626',
                  borderColor: '#fca5a5',
                  background: '#fef2f2',
                }}
              >
                <LogOut size={13} /> Ngắt kết nối
              </button>
            ) : (
              <button
                type="button"
                className="btn-p"
                onClick={handleAutoLogin}
                disabled={actionLoading}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 7,
                  background: '#dc2626',
                  color: '#fff',
                }}
              >
                {actionLoading ? (
                  <>
                    <Loader2 size={14} className="spin" /> Đang kết nối...
                  </>
                ) : (
                  <>
                    <YouTubeBrandIcon size={16} /> Đăng nhập Kênh YouTube
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Connected Channel Info */}
        {status?.connected ? (
          <div
            style={{
              marginTop: 18,
              paddingTop: 16,
              borderTop: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              gap: 16,
            }}
          >
            {/* Account & Channel Stats */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '1.2fr 1fr',
                gap: 16,
                background: '#f8fafc',
                padding: '14px 16px',
                borderRadius: 12,
                border: '1px solid #e2e8f0',
              }}
            >
              {/* Channel Profile */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                {status.channel_avatar_url || status.avatar_url ? (
                  <img
                    src={status.channel_avatar_url || status.avatar_url}
                    alt="channel avatar"
                    style={{ width: 44, height: 44, borderRadius: '50%', border: '2px solid #dc2626' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: '#dc2626',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                      fontSize: 16,
                    }}
                  >
                    {status.channel_title ? status.channel_title[0].toUpperCase() : 'YT'}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>
                    {status.channel_title || status.name || 'Kênh YouTube'}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748b' }}>
                    {status.channel_custom_url || status.email || status.channel_id}
                  </div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 10.5,
                      fontWeight: 700,
                      color: '#15803d',
                      background: '#dcfce7',
                      padding: '1px 6px',
                      borderRadius: 4,
                      marginTop: 4,
                    }}
                  >
                    <CheckCircle2 size={10} /> Đã cấp quyền YouTube Data API v3
                  </span>
                </div>
              </div>

              {/* Statistics */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-around', borderLeft: '1px solid #e2e8f0', paddingLeft: 12 }}>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                    {status.subscriber_count.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Người đăng ký</div>
                </div>
                <div style={{ textAlign: 'center' }}>
                  <div style={{ fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                    {status.video_count.toLocaleString()}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>Video đã tải lên</div>
                </div>
              </div>
            </div>

            {/* Quick Links */}
            {status.channel_id && (
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <a
                  href={`https://www.youtube.com/channel/${status.channel_id}`}
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#dc2626',
                    background: '#fff',
                    border: '1px solid #fca5a5',
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  <YouTubeBrandIcon size={13} /> Mở Trang Kênh trên YouTube <ExternalLink size={11} />
                </a>
                <a
                  href="https://studio.youtube.com"
                  target="_blank"
                  rel="noreferrer"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    color: '#475569',
                    background: '#fff',
                    border: '1px solid #cbd5e1',
                    padding: '6px 12px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 600,
                    textDecoration: 'none',
                  }}
                >
                  <Tv size={13} /> Mở YouTube Studio <ExternalLink size={11} />
                </a>
              </div>
            )}

            {/* Configuration Settings */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px' }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#1e293b', marginBottom: 12 }}>
                Cấu hình mặc định khi đăng tải video lên YouTube
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4, color: '#334155' }}>
                    Chế độ riêng tư mặc định (Privacy Status)
                  </label>
                  <select
                    value={defaultPrivacy}
                    onChange={e => setDefaultPrivacy(e.target.value)}
                    style={{ width: '100%', height: 38, fontSize: 12.5, borderRadius: 8, border: '1px solid #cbd5e1', padding: '0 8px' }}
                  >
                    <option value="private">🔒 Riêng tư (Private) - Chỉ bạn mới xem được</option>
                    <option value="unlisted">🔗 Không công khai (Unlisted) - Ai có link mới xem được</option>
                    <option value="public">🌐 Công khai (Public) - Xuất bản cho tất cả mọi người</option>
                  </select>
                </div>

                <div>
                  <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4, color: '#334155' }}>
                    Thẻ Tags mặc định (phân cách bằng dấu phẩy)
                  </label>
                  <input
                    value={defaultTags}
                    onChange={e => setDefaultTags(e.target.value)}
                    placeholder="recap, review, video hay, ai summary"
                    style={{ width: '100%', height: 38, fontSize: 12.5 }}
                  />
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  marginTop: 14,
                  paddingTop: 12,
                  borderTop: '1px solid #e2e8f0',
                }}
              >
                <div>
                  <strong style={{ fontSize: 12.5, color: '#0f172a', display: 'block' }}>
                    Bật tự động hoá đăng tải video lên YouTube
                  </strong>
                  <span style={{ fontSize: 11.5, color: '#64748b' }}>
                    Cho phép các quy trình tự động xuất video kích hoạt đăng lên kênh YouTube của bạn.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={autoUpload}
                  onChange={e => setAutoUpload(e.target.checked)}
                  style={{ width: 18, height: 18, cursor: 'pointer' }}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
                <button
                  type="button"
                  className="btn-p"
                  onClick={handleSaveSettings}
                  disabled={savingSettings}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, background: '#0f172a' }}
                >
                  {savingSettings ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Lưu cấu hình mặc định
                </button>
              </div>
            </div>
          </div>
        ) : (
          /* Not Connected / Setup Form */
          <div style={{ marginTop: 16 }}>
            {/* Guide Card */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: '14px 16px',
                fontSize: 12.5,
                color: '#334155',
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 700, color: '#0f172a', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <KeyRound size={15} color="#dc2626" /> Hướng dẫn tạo Google OAuth 2.0 cho YouTube Data API v3 (1 phút):
              </div>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  Vào{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#dc2626', fontWeight: 600 }}
                  >
                    Google Cloud Console Credentials <ExternalLink size={11} />
                  </a>
                  {' '}và bật <strong>YouTube Data API v3</strong>.
                </li>
                <li>
                  Vào <strong>OAuth consent screen</strong> $\rightarrow$ chọn <em>External</em> $\rightarrow$ thêm email tài khoản YouTube của bạn vào <em>Test users</em>.
                </li>
                <li>
                  Vào <strong>Credentials</strong> $\rightarrow$ <strong>Create Credentials</strong> $\rightarrow$ <strong>OAuth client ID</strong> $\rightarrow$ Chọn loại <strong>Desktop app</strong> (hoặc <strong>Web application</strong> với Authorized redirect URI: <code>http://localhost:8080/</code>).
                </li>
                <li>Dán <strong>Client ID</strong> &amp; <strong>Client Secret</strong> (hoặc dán nội dung file JSON) vào bên dưới rồi bấm Lưu.</li>
              </ol>
            </div>

            {/* Credentials Input Form */}
            <div style={{ marginTop: 14, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 12, padding: 16 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  cursor: 'pointer',
                  fontWeight: 700,
                  fontSize: 13,
                  color: '#0f172a',
                }}
                onClick={() => setShowCredForm(!showCredForm)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Settings size={15} color="#64748b" />
                  <span>Cấu hình Google OAuth 2.0 Client ID &amp; Secret (YouTube)</span>
                  {status?.has_credentials && (
                    <span style={{ fontSize: 11, color: '#16a34a', background: '#dcfce7', padding: '1px 6px', borderRadius: 4 }}>
                      Đã lưu Client ID
                    </span>
                  )}
                </div>
                {showCredForm ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>

              {showCredForm && (
                <form onSubmit={handleSaveCredentials} style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Client ID</label>
                    <input
                      value={clientId}
                      onChange={e => setClientId(e.target.value)}
                      placeholder="vd: 123456789-abcdef.apps.googleusercontent.com"
                      style={{ width: '100%', height: 38, fontSize: 12.5 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>Client Secret</label>
                    <input
                      type="password"
                      value={clientSecret}
                      onChange={e => setClientSecret(e.target.value)}
                      placeholder="vd: GOCSPX-xxxxxxxxxxxxxxxx"
                      style={{ width: '100%', height: 38, fontSize: 12.5 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 600, display: 'block', marginBottom: 4 }}>
                      Hoặc dán toàn bộ nội dung file <code>credentials.json</code>:
                    </label>
                    <textarea
                      value={credJson}
                      onChange={e => setCredJson(e.target.value)}
                      placeholder={'{\n  "installed": {\n    "client_id": "...",\n    "client_secret": "..."\n  }\n}'}
                      style={{ width: '100%', minHeight: 80, fontSize: 11.5, fontFamily: 'monospace' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      type="submit"
                      className="btn-p"
                      disabled={savingCreds}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, background: '#dc2626' }}
                    >
                      {savingCreds ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Lưu thông tin xác thực
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Manual Code Fallback Option */}
            <div style={{ marginTop: 12 }}>
              <div
                style={{
                  fontSize: 12,
                  color: '#dc2626',
                  cursor: 'pointer',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                onClick={() => {
                  setShowManualCode(!showManualCode)
                  if (!authUrl) handleGetAuthUrl()
                }}
              >
                <HelpCircle size={13} />
                <span>Gặp lỗi kết nối tự động? Bấm vào đây để đăng nhập thủ công qua link</span>
              </div>

              {showManualCode && (
                <div
                  style={{
                    marginTop: 10,
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    borderRadius: 10,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ fontSize: 12, color: '#991b1b' }}>
                    <strong>Cách 2:</strong> Bấm link bên dưới để mở trang đăng nhập Google trong trình duyệt của bạn:
                  </div>

                  {authUrl ? (
                    <a
                      href={authUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn-p"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        background: '#dc2626',
                        width: 'fit-content',
                        textDecoration: 'none',
                        fontSize: 12,
                      }}
                    >
                      <ExternalLink size={13} /> Mở liên kết đăng nhập YouTube
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="btn-cancel"
                      onClick={handleGetAuthUrl}
                      style={{ width: 'fit-content', fontSize: 12 }}
                    >
                      Tạo liên kết đăng nhập
                    </button>
                  )}

                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 600, color: '#991b1b', display: 'block', marginBottom: 4 }}>
                      Sau khi cấp quyền, dán toàn bộ đường link trình duyệt chuyển hướng (hoặc mã Authorization Code) vào đây:
                    </label>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <input
                        value={manualCode}
                        onChange={e => setManualCode(e.target.value)}
                        placeholder="vd: http://localhost:8080/?code=4/0Abc... hoặc mã 4/0Abc..."
                        style={{ flex: 1, height: 36, fontSize: 12 }}
                      />
                      <button
                        type="button"
                        className="btn-p"
                        onClick={handleExchangeManualCode}
                        disabled={exchangingCode}
                        style={{ height: 36, fontSize: 12, background: '#991b1b' }}
                      >
                        {exchangingCode ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />} Xác thực mã
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
