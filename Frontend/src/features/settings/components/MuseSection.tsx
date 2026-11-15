import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Film, FolderOpen, Info, Loader2, Save } from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { MuseAccountsState, MuseSettings } from '../types'
import { MuseAccountsCard } from './MuseAccountsCard'

interface MuseSectionProps {
  onStatusChange?: (isConnected: boolean) => void
}

const inputStyle = {
  width: '100%',
  padding: '8px 12px',
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  fontSize: 13,
  color: '#0f172a',
  background: '#ffffff',
  boxSizing: 'border-box',
} as const

const labelStyle = { display: 'block', fontSize: 12, fontWeight: 600, color: '#334155', marginBottom: 6 } as const

export function MuseSection({ onStatusChange }: MuseSectionProps) {
  const [settings, setSettings] = useState<MuseSettings>({
    ok: true,
    download_dir: '',
    timeout_seconds: 600,
    default_prompt_prefix: '',
  })
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/settings/muse`)
      if (!res.ok) throw new Error('Không thể tải cấu hình Muse')
      setSettings(await res.json())
    } catch (err: any) {
      setMessage(err?.message || 'Không thể tải cấu hình Muse')
      setMessageType('error')
    }
  }, [])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  // Chấm xanh của tab Cài đặt = có ít nhất một tài khoản Muse sẵn sàng.
  const handleAccountsChanged = useCallback(
    (s: MuseAccountsState) => onStatusChange?.(s.active_accounts_count > 0),
    [onStatusChange],
  )

  async function handleOpenFolder() {
    try {
      const res = await fetch(`${API_URL}/api/ai/muse/open-folder`, { method: 'POST' })
      if (!res.ok) throw new Error('Không thể mở thư mục')
    } catch (err: any) {
      setMessage(err?.message || 'Không thể mở thư mục trên máy tính')
      setMessageType('error')
    }
  }

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/settings/muse`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          download_dir: settings.download_dir,
          timeout_seconds: Number(settings.timeout_seconds),
          default_prompt_prefix: settings.default_prompt_prefix,
        }),
      })
      if (!res.ok) throw new Error('Lỗi khi lưu cấu hình')
      setSettings(await res.json())
      setMessage('Đã lưu cấu hình Muse AI.')
      setMessageType('success')
    } catch (err: any) {
      setMessage(err?.message || 'Lỗi khi lưu cài đặt')
      setMessageType('error')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, borderBottom: '1px solid #e2e8f0', paddingBottom: 16 }}>
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
            flexShrink: 0,
          }}
        >
          <Film size={20} />
        </div>
        <div>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>Cấu hình Meta Muse AI</h2>
          <p style={{ fontSize: 12.5, color: '#64748b', margin: '3px 0 0' }}>
            Tài khoản Muse, thư mục lưu video và cấu hình sinh video Meta Muse Spark. Tạo video kết nối thẳng tới Muse,
            Chrome chỉ mở khi thêm hoặc đăng nhập lại tài khoản.
          </p>
        </div>
      </div>

      {message && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 12.5,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: messageType === 'success' ? '#f0fdf4' : messageType === 'error' ? '#fef2f2' : '#f8fafc',
            border: `1px solid ${messageType === 'success' ? '#bbf7d0' : messageType === 'error' ? '#fecaca' : '#e2e8f0'}`,
            color: messageType === 'success' ? '#166534' : messageType === 'error' ? '#991b1b' : '#334155',
          }}
        >
          {messageType === 'success' ? <CheckCircle2 size={16} /> : messageType === 'error' ? <AlertCircle size={16} /> : <Info size={16} />}
          <span>{message}</span>
        </div>
      )}

      {/* Danh sách tài khoản Muse */}
      <MuseAccountsCard onChanged={handleAccountsChanged} />

      {/* Cấu hình sinh video */}
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
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Cấu hình sinh video</h3>
          <p style={{ fontSize: 12, color: '#64748b', margin: '3px 0 0' }}>Áp dụng khi sinh video từ Muse Studio.</p>
        </div>

        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <label style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>Thư mục lưu video MP4</label>
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
            placeholder="Bỏ trống = thư mục Downloads trong dữ liệu app"
            style={inputStyle}
          />
          <p style={{ fontSize: 11, color: '#64748b', margin: '4px 0 0' }}>
            Video Muse tạo xong được tải thẳng về thư mục này và hiện trong lịch sử Muse Studio.
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 14 }}>
          <div>
            <label style={labelStyle}>Thời gian chờ video (giây, tối thiểu 600)</label>
            <input
              type="number"
              min={600}
              value={settings.timeout_seconds}
              onChange={e => setSettings({ ...settings, timeout_seconds: Number(e.target.value) })}
              placeholder="600"
              style={inputStyle}
            />
          </div>
          <div>
            <label style={labelStyle}>Tiền tố prompt mặc định (tuỳ chọn)</label>
            <input
              type="text"
              value={settings.default_prompt_prefix}
              onChange={e => setSettings({ ...settings, default_prompt_prefix: e.target.value })}
              placeholder="Ví dụ: cinematic, 8k resolution, highly detailed"
              style={inputStyle}
            />
          </div>
        </div>

        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 4 }}>
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
