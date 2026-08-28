import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  FolderPlus,
  FolderSymlink,
  HardDrive,
  HelpCircle,
  KeyRound,
  Link,
  Loader2,
  Lock,
  LogOut,
  RefreshCw,
  Save,
  Settings,
  Sparkles,
  Upload,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'

function GoogleDriveIcon({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M7.71 3.5L1.15 15l3.43 6 6.55-11.5L7.71 3.5zm1.72 0l6.56 11.5h6.86L16.29 3.5H9.43zm-4 12.5l3.43 6h13.71l-3.43-6H5.43z" />
    </svg>
  )
}

interface GDriveStatus {
  connected: boolean
  auth_type: string
  email: string
  name: string
  avatar_url: string
  folder_id: string
  folder_name: string
  folder_url: string
  storage_used_bytes: number
  storage_total_bytes: number
  auto_upload: boolean
  has_credentials: boolean
  client_id: string
  message: string
}

export function GoogleDriveSection() {
  const [status, setStatus] = useState<GDriveStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  // Folder inputs
  const [customFolder, setCustomFolder] = useState('')
  const [folderSaving, setFolderSaving] = useState(false)

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
      const res = await fetch(`${API_URL}/api/gdrive/status`)
      if (!res.ok) throw new Error()
      const data: GDriveStatus = await res.json()
      setStatus(data)
      if (data.folder_id) {
        setCustomFolder(data.folder_id)
      }
      if (data.client_id) {
        setClientId(data.client_id)
      }
      if (!data.has_credentials) {
        setShowCredForm(true)
      }
    } catch {
      setError('Không thể kết nối với dịch vụ Google Drive của Backend.')
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
      const res = await fetch(`${API_URL}/api/gdrive/credentials`, {
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
      setMessage('Đã lưu cấu hình Google OAuth Client ID thành công!')
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
    setMessage('Đang mở trình duyệt Google để xác thực... Vui lòng đăng nhập và cấp quyền.')
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/gdrive/login`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Đăng nhập Google Drive thất bại.')
      }
      setStatus(data)
      setMessage('Kết nối Google Drive thành công!')
    } catch (err: any) {
      setError(err.message || 'Đăng nhập tự động thất bại.')
      // Mở rộng tùy chọn thủ công nếu gặp lỗi redirect
      setShowManualCode(true)
      handleGetAuthUrl()
    } finally {
      setActionLoading(false)
    }
  }

  async function handleGetAuthUrl() {
    try {
      const res = await fetch(`${API_URL}/api/gdrive/auth-url?redirect_uri=${encodeURIComponent('http://localhost:8080/')}`)
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
      setError('Vui lòng dán Authorization Code hoặc đường link chuyển hướng sau khi đăng nhập.')
      return
    }
    setExchangingCode(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/gdrive/exchange-code`, {
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
      setMessage('Xác thực và kết nối Google Drive thành công!')
      setShowManualCode(false)
      setManualCode('')
    } catch (err: any) {
      setError(err.message || 'Xác thực mã thất bại.')
    } finally {
      setExchangingCode(false)
    }
  }

  async function handleDisconnect() {
    if (!window.confirm('Bạn có chắc chắn muốn ngắt kết nối tài khoản Google Drive này?')) {
      return
    }
    setActionLoading(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/gdrive/disconnect`, {
        method: 'POST',
      })
      if (!res.ok) throw new Error()
      await loadStatus()
      setMessage('Đã ngắt kết nối Google Drive.')
    } catch {
      setError('Ngắt kết nối thất bại.')
    } finally {
      setActionLoading(false)
    }
  }

  async function handleSaveFolder() {
    if (!customFolder.trim()) {
      setError('Vui lòng nhập Folder ID hoặc Link Google Drive.')
      return
    }
    setFolderSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/gdrive/folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          folder_id: customFolder.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Không thể lưu thư mục.')
      }
      setStatus(data)
      setMessage(`Đã cập nhật thư mục lưu trữ: ${data.folder_name}`)
    } catch (err: any) {
      setError(err.message || 'Cập nhật thư mục thất bại.')
    } finally {
      setFolderSaving(false)
    }
  }

  async function handleCreateDefaultFolder() {
    setFolderSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/gdrive/folder/create?folder_name=AI_Clean_Videos`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) throw new Error()
      setStatus(data)
      setCustomFolder(data.folder_id)
      setMessage('Đã tạo thư mục "AI_Clean_Videos" trên Google Drive của bạn!')
    } catch {
      setError('Tạo thư mục thất bại.')
    } finally {
      setFolderSaving(false)
    }
  }

  async function handleToggleAutoUpload(checked: boolean) {
    try {
      const res = await fetch(`${API_URL}/api/gdrive/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          auto_upload: checked,
        }),
      })
      const data = await res.json()
      if (res.ok) {
        setStatus(data)
      }
    } catch {
      // ignore
    }
  }

  function formatBytes(bytes: number): string {
    if (!bytes || bytes === 0) return '0 GB'
    const gb = bytes / (1024 * 1024 * 1024)
    return `${gb.toFixed(2)} GB`
  }

  const usedBytes = status?.storage_used_bytes || 0
  const totalBytes = status?.storage_total_bytes || 15 * 1024 * 1024 * 1024
  const usedPercent = totalBytes > 0 ? Math.min(100, Math.round((usedBytes / totalBytes) * 100)) : 0

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

      {/* Main Connection Card */}
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
                background: status?.connected ? '#e0f2fe' : '#f1f5f9',
                color: status?.connected ? '#0284c7' : '#64748b',
                borderRadius: 12,
                flexShrink: 0,
              }}
            >
              <GoogleDriveIcon size={24} />
            </div>
            <div>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                Đồng bộ Google Drive
              </h3>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                Tự động tải lên và sao lưu video sau khi xóa watermark vào Google Drive cá nhân
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
                  background: '#0284c7',
                  color: '#fff',
                }}
              >
                {actionLoading ? (
                  <>
                    <Loader2 size={14} className="spin" /> Đang kết nối...
                  </>
                ) : (
                  <>
                    <GoogleDriveIcon size={16} /> Đăng nhập Google Drive
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {/* Connected Details */}
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
            {/* User info & Storage quota */}
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
              {/* Account info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {status.avatar_url ? (
                  <img
                    src={status.avatar_url}
                    alt="avatar"
                    style={{ width: 40, height: 40, borderRadius: '50%', border: '1.5px solid #0284c7' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      background: '#0284c7',
                      color: '#fff',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    {status.email ? status.email[0].toUpperCase() : 'G'}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                    {status.name || status.email}
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748b' }}>{status.email}</div>
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
                      marginTop: 3,
                    }}
                  >
                    <CheckCircle2 size={10} /> Đã kết nối OAuth 2.0
                  </span>
                </div>
              </div>

              {/* Storage quota */}
              <div>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 11.5,
                    marginBottom: 6,
                  }}
                >
                  <span style={{ color: '#64748b', fontWeight: 600 }}>Dung lượng Drive:</span>
                  <span style={{ fontWeight: 700, color: '#1e293b' }}>
                    {formatBytes(usedBytes)} / {formatBytes(totalBytes)} ({usedPercent}%)
                  </span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: 7,
                    background: '#e2e8f0',
                    borderRadius: 999,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${usedPercent}%`,
                      height: '100%',
                      background: usedPercent > 85 ? '#ef4444' : '#0284c7',
                      borderRadius: 999,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Folder Configuration */}
            <div>
              <label style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
                Thư mục lưu trữ video trên Google Drive
              </label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <input
                  value={customFolder}
                  onChange={e => setCustomFolder(e.target.value)}
                  placeholder="Dán link hoặc Folder ID trên Google Drive..."
                  style={{ flex: 1, minWidth: 260, height: 38, fontSize: 12.5 }}
                />
                <button
                  type="button"
                  className="btn-p"
                  onClick={handleSaveFolder}
                  disabled={folderSaving}
                  style={{ height: 38, padding: '0 14px', fontSize: 12, background: '#0f172a' }}
                >
                  {folderSaving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Lưu thư mục
                </button>
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={handleCreateDefaultFolder}
                  disabled={folderSaving}
                  title="Tạo thư mục mặc định AI_Clean_Videos"
                  style={{ height: 38, padding: '0 12px', fontSize: 12 }}
                >
                  <FolderPlus size={13} /> Tạo thư mục mặc định
                </button>
              </div>

              {status.folder_name && (
                <div
                  style={{
                    marginTop: 8,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    fontSize: 11.5,
                    color: '#64748b',
                  }}
                >
                  <div>
                    Đang lưu vào thư mục: <strong>{status.folder_name}</strong> (ID: <code>{status.folder_id}</code>)
                  </div>
                  {status.folder_url && (
                    <a
                      href={status.folder_url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        color: '#0284c7',
                        fontWeight: 600,
                        textDecoration: 'none',
                      }}
                    >
                      Mở trên Google Drive <ExternalLink size={11} />
                    </a>
                  )}
                </div>
              )}
            </div>

            {/* Auto-upload setting toggle */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '12px 14px',
                background: '#f8fafc',
                borderRadius: 10,
                border: '1px solid #e2e8f0',
              }}
            >
              <div>
                <strong style={{ fontSize: 12.5, color: '#0f172a', display: 'block' }}>
                  Tự động tải lên Google Drive sau khi xóa xong watermark
                </strong>
                <span style={{ fontSize: 11.5, color: '#64748b' }}>
                  File video sau khi xử lý xong vẫn lưu trên ổ cứng máy tính (Local) và sao lưu thêm 1 bản lên Drive.
                </span>
              </div>
              <input
                type="checkbox"
                checked={status.auto_upload}
                onChange={e => handleToggleAutoUpload(e.target.checked)}
                style={{ width: 18, height: 18, cursor: 'pointer' }}
              />
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
                <KeyRound size={15} color="#0284c7" /> Hướng dẫn tạo Google OAuth 2.0 Credentials (1 phút):
              </div>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  Vào{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#0284c7', fontWeight: 600 }}
                  >
                    Google Cloud Console Credentials <ExternalLink size={11} />
                  </a>
                  {' '}và bật <strong>Google Drive API</strong>.
                </li>
                <li>
                  Vào <strong>OAuth consent screen</strong> $\rightarrow$ chọn <em>External</em> $\rightarrow$ thêm email của bạn vào <em>Test users</em>.
                </li>
                <li>
                  Vào <strong>Credentials</strong> $\rightarrow$ <strong>Create Credentials</strong> $\rightarrow$ <strong>OAuth client ID</strong> $\rightarrow$ Chọn loại <strong>Desktop app</strong> (hoặc <strong>Web application</strong> với Authorized redirect URI: <code>http://localhost:8080/</code>).
                </li>
                <li>Dán <strong>Client ID</strong> &amp; <strong>Client Secret</strong> (hoặc nội dung file JSON) vào bên dưới rồi bấm Lưu.</li>
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
                  <span>Cấu hình Google OAuth 2.0 Client ID &amp; Secret</span>
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
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}
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
                  color: '#0284c7',
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
                    background: '#f0f9ff',
                    border: '1px solid #bae6fd',
                    borderRadius: 10,
                    padding: 14,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  <div style={{ fontSize: 12, color: '#0369a1' }}>
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
                        background: '#0284c7',
                        width: 'fit-content',
                        textDecoration: 'none',
                        fontSize: 12,
                      }}
                    >
                      <ExternalLink size={13} /> Mở liên kết đăng nhập Google Drive
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
                    <label style={{ fontSize: 11.5, fontWeight: 600, color: '#0369a1', display: 'block', marginBottom: 4 }}>
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
                        style={{ height: 36, fontSize: 12, background: '#0369a1' }}
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
