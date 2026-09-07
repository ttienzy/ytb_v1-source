import { useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  ExternalLink,
  Folder,
  FolderPlus,
  FolderSymlink,
  HardDrive,
  HelpCircle,
  KeyRound,
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
  workflow_folders?: Record<string, { folder_id: string; folder_name: string; folder_url?: string }>
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
  const [workflowFolderInputs, setWorkflowFolderInputs] = useState<Record<string, string>>({ audio: '', studio: '' })
  const [showAddWorkflow, setShowAddWorkflow] = useState(false)
  const [newWorkflowName, setNewWorkflowName] = useState('')
  const [newWorkflowFolderName, setNewWorkflowFolderName] = useState('')

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
        setCustomFolder(data.folder_name || '')
      }
      setWorkflowFolderInputs(Object.fromEntries(Object.entries(data.workflow_folders || {}).map(([key, folder]) => [key, folder.folder_name || ''])))
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

  async function handleRenameRootFolder() {
    const name = customFolder.trim()
    if (!name) {
      setError('Vui lòng nhập tên mới cho folder gốc.')
      return
    }
    setFolderSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/gdrive/folder/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder_name: name }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Không thể đổi tên folder gốc.')
      setStatus(data)
      setCustomFolder(data.folder_name || name)
      setMessage(`Đã đổi tên folder gốc thành "${data.folder_name || name}".`)
    } catch (err: any) {
      setError(err.message || 'Không thể đổi tên folder gốc.')
    } finally {
      setFolderSaving(false)
    }
  }

  async function handleWorkflowFolder(workflow: string, create: boolean) {
    const value = workflowFolderInputs[workflow].trim()
    if (!value) {
      setError(create ? `Vui lòng nhập tên folder cho workflow ${workflow === 'audio' ? 'Audio' : 'Studio'}.` : 'Vui lòng dán Folder ID hoặc link Google Drive.')
      return
    }
    setFolderSaving(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/gdrive/workflow-folder${create ? '/create' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(create ? { workflow, folder_name: value } : { workflow, folder_id: value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Không thể cập nhật folder workflow.')
      setStatus(data)
      setWorkflowFolderInputs(prev => ({ ...prev, [workflow]: data.workflow_folders?.[workflow]?.folder_name || value }))
      setMessage(`Đã đặt folder ${workflow}: ${data.workflow_folders?.[workflow]?.folder_name || value}`)
    } catch (err: any) {
      setError(err.message || 'Không thể cập nhật folder workflow.')
    } finally {
      setFolderSaving(false)
    }
  }

  async function handleRenameWorkflowFolder(workflow: string) {
    const value = workflowFolderInputs[workflow].trim()
    if (!value) {
      setError('Vui lòng nhập tên mới cho folder workflow.')
      return
    }
    setFolderSaving(true)
    setError('')
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/gdrive/workflow-folder/rename`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow, folder_name: value }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Không thể đổi tên folder workflow.')
      setStatus(data)
      setWorkflowFolderInputs(prev => ({ ...prev, [workflow]: data.workflow_folders?.[workflow]?.folder_name || value }))
      setMessage(`Đã đổi tên folder ${workflow}.`)
    } catch (err: any) {
      setError(err.message || 'Không thể đổi tên folder workflow.')
    } finally {
      setFolderSaving(false)
    }
  }

  async function handleAddWorkflow() {
    const workflow = newWorkflowName.trim()
    const folderName = newWorkflowFolderName.trim()
    if (!workflow || !folderName) {
      setError('Vui lòng nhập tên workflow và tên folder.')
      return
    }
    setFolderSaving(true)
    setError('')
    try {
      const res = await fetch(`${API_URL}/api/gdrive/workflow-folder/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow, folder_name: folderName }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Không thể tạo workflow folder.')
      setStatus(data)
      const key = workflow.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '')
      setWorkflowFolderInputs(prev => ({ ...prev, [key]: data.workflow_folders?.[key]?.folder_name || folderName }))
      setNewWorkflowName('')
      setNewWorkflowFolderName('')
      setShowAddWorkflow(false)
      setMessage(`Đã thêm workflow ${workflow} và tạo folder thành công.`)
    } catch (err: any) {
      setError(err.message || 'Không thể tạo workflow folder.')
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
      <div className="mailtm-card" style={{ padding: '16px 20px' }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 16,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
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
              <GoogleDriveIcon size={19} />
            </div>
            <div>
              <h3 className="gemini-title" style={{ fontSize: 14.5, fontWeight: 700 }}>
                Đồng bộ Google Drive
              </h3>
              <p className="gemini-subtitle">
                Tự động tải lên và sao lưu video sau khi xóa watermark vào Google Drive cá nhân
              </p>
            </div>
          </div>

          <div>
            {status?.connected ? (
              <button
                type="button"
                className="mailtm-btn-danger-outline"
                onClick={handleDisconnect}
                disabled={actionLoading}
              >
                <LogOut size={12} color="#ef4444" /> Ngắt kết nối
              </button>
            ) : (
              <button
                type="button"
                className="mailtm-btn-primary"
                onClick={handleAutoLogin}
                disabled={actionLoading}
                style={{
                  height: 32,
                  padding: '0 12px',
                  fontSize: 12,
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
                padding: '12px 14px',
                borderRadius: 10,
                border: '1px solid #e2e8f0',
                alignItems: 'center',
              }}
            >
              {/* Account info */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {status.avatar_url ? (
                  <img
                    src={status.avatar_url}
                    alt="avatar"
                    style={{ width: 36, height: 36, borderRadius: '50%', border: '1px solid #cbd5e1', objectFit: 'cover' }}
                  />
                ) : (
                  <div
                    style={{
                      width: 36,
                      height: 36,
                      borderRadius: '50%',
                      background: '#e2e8f0',
                      color: '#475569',
                      display: 'grid',
                      placeItems: 'center',
                      fontWeight: 700,
                      fontSize: 13,
                    }}
                  >
                    {status.email ? status.email[0].toUpperCase() : 'G'}
                  </div>
                )}
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                    {status.name || status.email}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b' }}>{status.email}</div>
                  <span
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      fontSize: 10,
                      fontWeight: 600,
                      color: '#16a34a',
                      background: '#dcfce7',
                      padding: '1px 6px',
                      borderRadius: 4,
                      marginTop: 2,
                    }}
                  >
                    <CheckCircle2 size={9} /> Đã kết nối OAuth 2.0
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
                    fontSize: 11,
                    marginBottom: 5,
                  }}
                >
                  <span style={{ color: '#64748b', fontWeight: 500 }}>Dung lượng Drive:</span>
                  <span style={{ fontWeight: 600, color: '#1e293b' }}>
                    {formatBytes(usedBytes)} / {formatBytes(totalBytes)} ({usedPercent}%)
                  </span>
                </div>
                <div
                  style={{
                    width: '100%',
                    height: 6,
                    background: '#e2e8f0',
                    borderRadius: 999,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      width: `${usedPercent}%`,
                      height: '100%',
                      background: usedPercent > 85 ? '#ef4444' : '#475569',
                      borderRadius: 999,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Folder Configuration */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
              {/* Current Active Folder Banner */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12, paddingBottom: 10, borderBottom: '1px solid #e2e8f0', flexWrap: 'wrap', gap: 10 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 6, background: '#f1f5f9', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#475569', flexShrink: 0 }}>
                    <Folder size={15} />
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                      Thư mục gốc lưu video: <span style={{ color: '#0f172a', fontWeight: 700 }}>{status.folder_name || 'Chưa đặt'}</span>
                      <span style={{ fontSize: 10, fontWeight: 600, padding: '1.5px 6px', borderRadius: 4, background: '#dcfce7', color: '#16a34a' }}>
                        Đang sử dụng
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                      Tất cả video đã xóa watermark sẽ tự động tải vào thư mục này. (ID: <code>{status.folder_id || 'chưa có'}</code>)
                    </div>
                  </div>
                </div>

                {status.folder_url && (
                  <a
                    href={status.folder_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mailtm-btn-refresh"
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 5,
                      height: 28,
                      padding: '0 9px',
                      borderRadius: 6,
                      fontSize: 11.5,
                      fontWeight: 500,
                      textDecoration: 'none',
                    }}
                  >
                    Mở xem trên Google Drive <ExternalLink size={11} />
                  </a>
                )}
              </div>

              {/* Input & Actions */}
              <div>
                <label style={{ fontSize: 11.5, fontWeight: 600, marginBottom: 5, display: 'block', color: '#334155' }}>
                  Đổi tên folder gốc lưu trữ
                </label>
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                  <input
                    className="mailtm-input"
                    value={customFolder}
                    onChange={e => setCustomFolder(e.target.value)}
                    placeholder="Nhập tên mới cho folder gốc (VD: MMO_Videos)"
                    style={{ flex: 1, minWidth: 260, height: 32, fontSize: 12 }}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && customFolder.trim()) {
                        e.preventDefault()
                        handleRenameRootFolder()
                      }
                    }}
                  />
                  <button
                    type="button"
                    className="mailtm-btn-refresh"
                    onClick={handleRenameRootFolder}
                    disabled={folderSaving || !customFolder.trim()}
                    title="Đổi tên folder gốc hiện tại"
                    style={{
                      height: 32,
                      padding: '0 12px',
                      fontSize: 11.5,
                      fontWeight: 600,
                      background: '#1e293b',
                      color: '#ffffff',
                      borderColor: '#0f172a',
                      gap: 5,
                    }}
                  >
                    {folderSaving ? <Loader2 size={12} className="spin" /> : <Save size={12} />}
                    Đổi tên folder gốc
                  </button>
                </div>

                <p style={{ fontSize: 11, color: '#94a3b8', marginTop: 6, marginBottom: 0 }}>
                  💡 Folder ID được giữ nguyên; thao tác này chỉ đổi tên folder gốc hiện tại trên Google Drive.
                </p>
              </div>
            </div>

            {/* Auto-upload setting toggle */}
            <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4 }}>
                <div style={{ fontSize: 12.5, fontWeight: 700, color: '#0f172a' }}>Quản lý tập trung folder lưu theo workflow</div>
                <button
                  type="button"
                  className="mailtm-btn-refresh"
                  onClick={() => setShowAddWorkflow(value => !value)}
                  style={{ height: 26, padding: '0 8px', fontSize: 11, gap: 4 }}
                >
                  <FolderPlus size={11} /> Thêm workflow
                </button>
              </div>
              <div style={{ fontSize: 11.5, color: '#64748b', marginBottom: 10 }}>
                Tất cả folder Audio và Studio được quản lý tại đây và nằm bên trong folder gốc ở phía trên. Video sẽ tự động đi vào folder tương ứng; nếu chưa cấu hình, hệ thống dùng folder gốc.
              </div>
              {showAddWorkflow && (
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '9px 0', borderTop: '1px solid #e2e8f0', flexWrap: 'wrap' }}>
                  <input
                    className="mailtm-input"
                    value={newWorkflowName}
                    onChange={e => setNewWorkflowName(e.target.value)}
                    placeholder="Tên workflow mới (VD: Shorts)"
                    style={{ flex: '1 1 180px', height: 28, fontSize: 11.5 }}
                  />
                  <input
                    className="mailtm-input"
                    value={newWorkflowFolderName}
                    onChange={e => setNewWorkflowFolderName(e.target.value)}
                    placeholder="Tên folder lưu"
                    style={{ flex: '1 1 220px', height: 28, fontSize: 11.5 }}
                  />
                  <button
                    type="button"
                    className="mailtm-btn-refresh"
                    disabled={folderSaving}
                    onClick={handleAddWorkflow}
                    style={{
                      height: 28,
                      padding: '0 10px',
                      fontSize: 11,
                      fontWeight: 600,
                      background: '#1e293b',
                      color: '#ffffff',
                      borderColor: '#0f172a',
                      gap: 4,
                    }}
                  >
                    <FolderPlus size={11} /> Tạo folder workflow
                  </button>
                </div>
              )}
              {Array.from(new Set(['audio', 'studio', ...Object.keys(status.workflow_folders || {})])).map(workflow => {
                const folder = status.workflow_folders?.[workflow]
                const label = workflow === 'audio' ? 'Audio' : workflow === 'studio' ? 'Studio' : workflow.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
                return (
                  <div key={workflow} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid #f1f5f9', flexWrap: 'wrap' }}>
                    <Folder size={14} color="#64748b" />
                    <strong style={{ width: 65, fontSize: 11.5, color: '#1e293b' }}>{label}</strong>
                    <span style={{ flex: 1, minWidth: 160, fontSize: 11, color: folder ? '#334155' : '#94a3b8' }}>
                      {folder?.folder_name || 'Chưa cấu hình — dùng folder mặc định'}
                    </span>
                    <input
                      className="mailtm-input"
                      value={workflowFolderInputs[workflow]}
                      onChange={e => setWorkflowFolderInputs(prev => ({ ...prev, [workflow]: e.target.value }))}
                      placeholder={folder ? 'Nhập tên mới cho folder này' : 'Tên folder con (VD: Audio_Videos)'}
                      style={{ flex: '1 1 200px', minWidth: 180, height: 28, fontSize: 11.5 }}
                    />
                    {!folder ? (
                      <button
                        type="button"
                        className="mailtm-btn-refresh"
                        disabled={folderSaving}
                        onClick={() => handleWorkflowFolder(workflow, true)}
                        style={{
                          height: 28,
                          padding: '0 9px',
                          fontSize: 11,
                          fontWeight: 500,
                          background: '#f8fafc',
                          color: '#1e293b',
                          borderColor: '#cbd5e1',
                          gap: 4,
                        }}
                      >
                        <FolderPlus size={11} /> Tạo folder
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="mailtm-btn-refresh"
                        disabled={folderSaving}
                        onClick={() => handleRenameWorkflowFolder(workflow)}
                        style={{
                          height: 28,
                          padding: '0 9px',
                          fontSize: 11,
                          fontWeight: 500,
                          gap: 4,
                        }}
                      >
                        <Save size={11} /> Đổi tên
                      </button>
                    )}
                    {folder?.folder_url && (
                      <a href={folder.folder_url} target="_blank" rel="noreferrer" title="Mở folder trên Google Drive" style={{ display: 'inline-flex', alignItems: 'center' }}>
                        <ExternalLink size={13} color="#64748b" />
                      </a>
                    )}
                  </div>
                )
              })}
            </div>

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
                borderRadius: 10,
                padding: '12px 14px',
                fontSize: 12,
                color: '#334155',
                lineHeight: 1.6,
              }}
            >
              <div style={{ fontWeight: 600, color: '#0f172a', marginBottom: 6, display: 'flex', alignItems: 'center', gap: 6 }}>
                <KeyRound size={14} color="#64748b" /> Hướng dẫn tạo Google OAuth 2.0 Credentials (1 phút):
              </div>
              <ol style={{ margin: 0, paddingLeft: 18 }}>
                <li>
                  Vào{' '}
                  <a
                    href="https://console.cloud.google.com/apis/credentials"
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: '#2563eb', fontWeight: 600 }}
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
            <div style={{ marginTop: 12, background: '#fff', border: '1px solid #e2e8f0', borderRadius: 10, padding: 14 }}>
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
                onClick={() => setShowCredForm(!showCredForm)}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                  <Settings size={14} color="#64748b" />
                  <span>Cấu hình Google OAuth 2.0 Client ID &amp; Secret</span>
                  {status?.has_credentials && (
                    <span style={{ fontSize: 10, color: '#16a34a', background: '#dcfce7', padding: '1px 6px', borderRadius: 4, fontWeight: 600 }}>
                      Đã lưu Client ID
                    </span>
                  )}
                </div>
                {showCredForm ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
              </div>

              {showCredForm && (
                <form onSubmit={handleSaveCredentials} style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 600, display: 'block', marginBottom: 4, color: '#334155' }}>Client ID</label>
                    <input
                      className="mailtm-input"
                      value={clientId}
                      onChange={e => setClientId(e.target.value)}
                      placeholder="vd: 123456789-abcdef.apps.googleusercontent.com"
                      style={{ width: '100%', height: 32, fontSize: 12 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 600, display: 'block', marginBottom: 4, color: '#334155' }}>Client Secret</label>
                    <input
                      className="mailtm-input"
                      type="password"
                      value={clientSecret}
                      onChange={e => setClientSecret(e.target.value)}
                      placeholder="vd: GOCSPX-xxxxxxxxxxxxxxxx"
                      style={{ width: '100%', height: 32, fontSize: 12 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 600, display: 'block', marginBottom: 4, color: '#334155' }}>
                      Hoặc dán toàn bộ nội dung file <code>credentials.json</code>:
                    </label>
                    <textarea
                      value={credJson}
                      onChange={e => setCredJson(e.target.value)}
                      placeholder={'{\n  "installed": {\n    "client_id": "...",\n    "client_secret": "..."\n  }\n}'}
                      style={{ width: '100%', minHeight: 70, fontSize: 11, fontFamily: 'monospace', border: '1px solid #e2e8f0', borderRadius: 6, padding: 8 }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                    <button
                      type="submit"
                      className="mailtm-btn-primary"
                      disabled={savingCreds}
                      style={{ height: 30, padding: '0 12px', fontSize: 11.5 }}
                    >
                      {savingCreds ? <Loader2 size={12} className="spin" /> : <Save size={12} />} Lưu thông tin xác thực
                    </button>
                  </div>
                </form>
              )}
            </div>

            {/* Manual Code Fallback Option */}
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  fontSize: 11.5,
                  color: '#475569',
                  cursor: 'pointer',
                  fontWeight: 500,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                }}
                onClick={() => {
                  setShowManualCode(!showManualCode)
                  if (!authUrl) handleGetAuthUrl()
                }}
              >
                <HelpCircle size={12} color="#64748b" />
                <span>Gặp lỗi kết nối tự động? Bấm vào đây để đăng nhập thủ công qua link</span>
              </div>

              {showManualCode && (
                <div
                  style={{
                    marginTop: 8,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                  }}
                >
                  <div style={{ fontSize: 11.5, color: '#334155' }}>
                    <strong>Cách 2:</strong> Bấm link bên dưới để mở trang đăng nhập Google trong trình duyệt của bạn:
                  </div>

                  {authUrl ? (
                    <a
                      href={authUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mailtm-btn-primary"
                      style={{
                        height: 28,
                        padding: '0 10px',
                        fontSize: 11.5,
                        width: 'fit-content',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                    >
                      <ExternalLink size={12} /> Mở liên kết đăng nhập Google Drive
                    </a>
                  ) : (
                    <button
                      type="button"
                      className="mailtm-btn-refresh"
                      onClick={handleGetAuthUrl}
                      style={{ width: 'fit-content', height: 28, fontSize: 11.5 }}
                    >
                      Tạo liên kết đăng nhập
                    </button>
                  )}

                  <div>
                    <label style={{ fontSize: 11, fontWeight: 500, color: '#64748b', display: 'block', marginBottom: 4 }}>
                      Sau khi cấp quyền, dán toàn bộ đường link trình duyệt chuyển hướng (hoặc mã Authorization Code) vào đây:
                    </label>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        className="mailtm-input"
                        value={manualCode}
                        onChange={e => setManualCode(e.target.value)}
                        placeholder="vd: http://localhost:8080/?code=4/0Abc... hoặc mã 4/0Abc..."
                        style={{ flex: 1, height: 30, fontSize: 11.5 }}
                      />
                      <button
                        type="button"
                        className="mailtm-btn-primary"
                        onClick={handleExchangeManualCode}
                        disabled={exchangingCode}
                        style={{ height: 30, padding: '0 12px', fontSize: 11.5 }}
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
