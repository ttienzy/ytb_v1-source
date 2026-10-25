import { useEffect, useState, useCallback } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Film,
  FolderOpen,
  Info,
  Loader2,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { MuseSettings, MuseStatus } from '../types'

interface MuseSectionProps {
  onStatusChange?: (isConnected: boolean) => void
}

export function MuseSection({ onStatusChange }: MuseSectionProps) {
  const [settings, setSettings] = useState<MuseSettings>({
    ok: true,
    is_connected: false,
    app_url: 'https://muse.ai/',
    cdp_port: 9225,
    auto_download: true,
    download_dir: '',
    timeout_seconds: 120,
    default_prompt_prefix: '',
    profile_dir: '',
  })

  const [status, setStatus] = useState<MuseStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')

  // 1. Tải cấu hình từ Backend
  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings/muse`)
      if (!res.ok) throw new Error('Không thể tải cấu hình Muse')
      const data: MuseSettings = await res.json()
      setSettings(data)
      onStatusChange?.(data.is_connected)
    } catch (err: any) {
      console.error('Lỗi tải cấu hình Muse:', err)
    }
  }, [onStatusChange])

  // 2. Kiểm tra live status qua CDP
  const checkStatus = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/settings/muse/status`)
      if (!res.ok) throw new Error('Không thể kết nối máy chủ')
      const data: MuseStatus = await res.json()
      setStatus(data)
      setSettings(prev => ({ ...prev, is_connected: data.is_connected }))
      onStatusChange?.(data.is_connected)

      if (data.is_connected) {
        setMessage('Đã kết nối Chrome CDP. Phiên Meta Muse AI sẵn sàng.')
        setMessageType('success')
      } else {
        setMessage(data.message || 'Chưa phát hiện phiên đăng nhập Muse.')
        setMessageType(data.is_running ? 'info' : 'error')
      }
    } catch (err: any) {
      setMessage(err?.message || 'Lỗi khi kiểm tra kết nối CDP')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }, [onStatusChange])

  useEffect(() => {
    loadSettings()
    checkStatus()
  }, [loadSettings, checkStatus])

  // 3. Mở cửa sổ Chrome Muse
  async function handleOpenBrowser() {
    setLaunching(true)
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/settings/muse/open-browser`, { method: 'POST' })
      if (!res.ok) throw new Error('Không thể mở Chrome')
      setMessage('Đã mở cửa sổ Chrome Muse. Vui lòng kiểm tra trên màn hình.')
      setMessageType('info')
      setTimeout(checkStatus, 3000)
    } catch (err: any) {
      setMessage(err?.message || 'Lỗi mở trình duyệt')
      setMessageType('error')
    } finally {
      setLaunching(false)
    }
  }

  // 4. Mở thư mục tải video
  async function handleOpenFolder() {
    try {
      const res = await fetch(`${API_URL}/api/ai/muse/open-folder`, { method: 'POST' })
      if (!res.ok) throw new Error('Không thể mở thư mục')
    } catch (err: any) {
      setMessage(err?.message || 'Không thể mở thư mục trên máy tính')
      setMessageType('error')
    }
  }

  // 5. Lưu cài đặt
  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/settings/muse`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          app_url: settings.app_url,
          cdp_port: Number(settings.cdp_port),
          auto_download: settings.auto_download,
          download_dir: settings.download_dir,
          timeout_seconds: Number(settings.timeout_seconds),
          default_prompt_prefix: settings.default_prompt_prefix,
        }),
      })
      if (!res.ok) throw new Error('Lỗi khi lưu cấu hình')
      const data: MuseSettings = await res.json()
      setSettings(data)
      setMessage('Đã lưu cấu hình Muse AI thành công.')
      setMessageType('success')
    } catch (err: any) {
      setMessage(err?.message || 'Lỗi khi lưu cài đặt')
      setMessageType('error')
    } finally {
      setSaving(false)
    }
  }

  const isConnected = Boolean(status?.is_connected || settings.is_connected)

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          borderBottom: '1px solid #e2e8f0',
          paddingBottom: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 8,
              background: '#f1f5f9',
              border: '1px solid #e2e8f0',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#0f172a',
            }}
          >
            <Film size={20} />
          </div>
          <div>
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
              Cấu hình Meta Muse AI
            </h2>
            <p style={{ fontSize: 12.5, color: '#64748b', margin: '3px 0 0' }}>
              Quản lý kết nối Chrome CDP, thư mục lưu video và cấu hình sinh video Meta Muse Spark.
            </p>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            onClick={checkStatus}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 12px',
              borderRadius: 6,
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#334155',
              fontSize: 12,
              fontWeight: 600,
              cursor: loading ? 'not-allowed' : 'pointer',
            }}
          >
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Kiểm tra
          </button>
          <button
            type="button"
            onClick={handleOpenBrowser}
            disabled={launching}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 6,
              background: '#0f172a',
              border: '1px solid #0f172a',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: launching ? 'not-allowed' : 'pointer',
            }}
          >
            {launching ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
            Mở Chrome Muse
          </button>
        </div>
      </div>

      {/* Message Banner */}
      {message && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 12.5,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background:
              messageType === 'success' ? '#f0fdf4' : messageType === 'error' ? '#fef2f2' : '#f8fafc',
            border:
              messageType === 'success'
                ? '1px solid #bbf7d0'
                : messageType === 'error'
                ? '1px solid #fecaca'
                : '1px solid #e2e8f0',
            color:
              messageType === 'success' ? '#166534' : messageType === 'error' ? '#991b1b' : '#334155',
          }}
        >
          {messageType === 'success' ? (
            <CheckCircle2 size={16} />
          ) : messageType === 'error' ? (
            <AlertCircle size={16} />
          ) : (
            <Info size={16} />
          )}
          <span>{message}</span>
        </div>
      )}

      {/* Diagnostic Cards */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
          gap: 12,
        }}
      >
        {/* Card 1: Live Status */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '14px 16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
              Trạng thái Muse
            </span>
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                padding: '2px 8px',
                borderRadius: 12,
                fontSize: 11,
                fontWeight: 600,
                background: isConnected ? '#ecfdf5' : '#fef3c7',
                color: isConnected ? '#15803d' : '#b45309',
                border: isConnected ? '1px solid #bbf7d0' : '1px solid #fde68a',
              }}
            >
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: '50%',
                  background: isConnected ? '#16a34a' : '#d97706',
                }}
              />
              {isConnected ? 'Sẵn sàng' : 'Chưa kết nối'}
            </span>
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
            {status?.tab_title || 'Meta Muse Spark AI'}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            {status?.is_running ? 'Chrome đang chạy với CDP' : 'Chrome chưa khởi động'}
          </div>
        </div>

        {/* Card 2: Remote Debugging Port */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '14px 16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
              Cổng CDP Port
            </span>
            <Server size={14} style={{ color: '#64748b' }} />
          </div>
          <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
            127.0.0.1:{settings.cdp_port || 9225}
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            Độc lập, không trùng với Google Flow (56526)
          </div>
        </div>

        {/* Card 3: Storage Profile */}
        <div
          style={{
            background: '#ffffff',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
            padding: '14px 16px',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600, textTransform: 'uppercase' }}>
              Dữ liệu phiên Profile
            </span>
            <ShieldCheck size={14} style={{ color: '#16a34a' }} />
          </div>
          <div
            style={{
              fontSize: 12,
              fontWeight: 500,
              color: '#0f172a',
              fontFamily: 'monospace',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={settings.profile_dir}
          >
            Backend/Data/ChromeProfile
          </div>
          <div style={{ fontSize: 11, color: '#64748b', marginTop: 4 }}>
            Lưu giữ đăng nhập vĩnh viễn
          </div>
        </div>
      </div>

      {/* Main Settings Form */}
      <form
        onSubmit={handleSaveSettings}
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: '20px 22px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 10 }}>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>
            Thông số kỹ thuật &amp; Đường dẫn
          </h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '3px 0 0' }}>
            Các thiết lập dùng cho bot tự động hóa CDP khi kích hoạt sinh video từ Muse Studio.
          </p>
        </div>

        {/* Row 1: URL & Port */}
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
              Muse App URL
            </label>
            <input
              type="text"
              value={settings.app_url}
              onChange={e => setSettings({ ...settings, app_url: e.target.value })}
              placeholder="https://muse.ai/"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 13,
                color: '#0f172a',
                background: '#ffffff',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
              CDP Remote Port
            </label>
            <input
              type="number"
              value={settings.cdp_port}
              onChange={e => setSettings({ ...settings, cdp_port: Number(e.target.value) })}
              placeholder="9225"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 13,
                color: '#0f172a',
                background: '#ffffff',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Row 2: Download Directory */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
              Thư mục lưu trữ video MP4 tải về
            </label>
            <button
              type="button"
              onClick={handleOpenFolder}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                background: 'transparent',
                border: 'none',
                color: '#2563eb',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                padding: 0,
              }}
            >
              <FolderOpen size={13} />
              Mở thư mục
            </button>
          </div>
          <input
            type="text"
            value={settings.download_dir}
            onChange={e => setSettings({ ...settings, download_dir: e.target.value })}
            placeholder="D:\GOOGLE SEARCH\tools\Backend\Data\Downloads"
            style={{
              width: '100%',
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              fontSize: 13,
              color: '#0f172a',
              background: '#ffffff',
              boxSizing: 'border-box',
            }}
          />
          <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>
            Video được Muse Spark render sẽ tự động trích xuất blob và lưu vào thư mục này.
          </p>
        </div>

        {/* Row 3: Timeout & Default Prefix */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
              Thời gian Timeout (giây)
            </label>
            <input
              type="number"
              value={settings.timeout_seconds}
              onChange={e => setSettings({ ...settings, timeout_seconds: Number(e.target.value) })}
              placeholder="120"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 13,
                color: '#0f172a',
                background: '#ffffff',
                boxSizing: 'border-box',
              }}
            />
          </div>

          <div>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 }}>
              Tiền tố prompt mặc định (tuỳ chọn)
            </label>
            <input
              type="text"
              value={settings.default_prompt_prefix}
              onChange={e => setSettings({ ...settings, default_prompt_prefix: e.target.value })}
              placeholder="Ví dụ: cinematic, 8k resolution, highly detailed"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 13,
                color: '#0f172a',
                background: '#ffffff',
                boxSizing: 'border-box',
              }}
            />
          </div>
        </div>

        {/* Row 4: Auto-download Toggle */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 6,
          }}
        >
          <div>
            <div style={{ fontSize: 12.5, fontWeight: 600, color: '#0f172a' }}>
              Tự động tải file MP4 về ổ đĩa
            </div>
            <div style={{ fontSize: 11.5, color: '#64748b' }}>
              Ngay khi Muse AI render xong video trong trình duyệt, tự động tải xuống không cần bấm tay.
            </div>
          </div>
          <label style={{ position: 'relative', display: 'inline-block', width: 40, height: 22, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.auto_download}
              onChange={e => setSettings({ ...settings, auto_download: e.target.checked })}
              style={{ opacity: 0, width: 0, height: 0 }}
            />
            <span
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: settings.auto_download ? '#2563eb' : '#cbd5e1',
                borderRadius: 22,
                transition: '0.2s',
              }}
            >
              <span
                style={{
                  position: 'absolute',
                  content: '""',
                  height: 16,
                  width: 16,
                  left: settings.auto_download ? 21 : 3,
                  bottom: 3,
                  backgroundColor: 'white',
                  borderRadius: '50%',
                  transition: '0.2s',
                }}
              />
            </span>
          </label>
        </div>

        {/* Submit Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 8 }}>
          <button
            type="submit"
            disabled={saving}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '9px 18px',
              borderRadius: 6,
              background: '#2563eb',
              border: 'none',
              color: '#ffffff',
              fontSize: 13,
              fontWeight: 600,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Lưu cấu hình
          </button>
        </div>
      </form>
    </div>
  )
}
