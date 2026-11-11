import { useEffect, useState, useCallback } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Globe,
  ImageIcon,
  Info,
  Loader2,
  RefreshCw,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { ImageGenState } from '../types'

interface ImageGenSectionProps {
  onStatusChange?: (hasReadyAccount: boolean) => void
}

const CGPT_STATUS_MAP: Record<string, { color: string; label: string }> = {
  active: { color: '#10b981', label: 'Sẵn sàng' },
  exhausted: { color: '#f59e0b', label: 'Đụng giới hạn ảnh (cooldown)' },
  error: { color: '#ef4444', label: 'Cookie hết hạn — đăng nhập lại' },
}

export function ImageGenSection({ onStatusChange }: ImageGenSectionProps) {
  const [state, setState] = useState<ImageGenState>({
    provider: 'chatgpt',
    accounts: [],
    active_accounts_count: 0,
    total_accounts_count: 0,
  })

  // Action states
  const [loading, setLoading] = useState(false)
  const [loggingIn, setLoggingIn] = useState(false)
  const [refreshingId, setRefreshingId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  // Testing states
  const [testPrompt, setTestPrompt] = useState('Chân dung nhân vật nữ thám tử trẻ trung, phong cách cinematic, 9:16')
  const [generatingTest, setGeneratingTest] = useState(false)
  const [testResult, setTestResult] = useState<{ path: string; elapsed: number } | null>(null)

  // Messages
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')

  const loadSettings = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/settings/image-gen`)
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('Backend chưa được khởi động lại để nhận API Tạo ảnh mới. Hãy restart Backend!')
        }
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || 'Không thể tải cài đặt tạo ảnh')
      }
      const data: ImageGenState = await res.json()
      setState(data)
      setMessage('')
      onStatusChange?.(data.active_accounts_count > 0)
    } catch (err: any) {
      console.error(err)
      setMessage(err?.message || 'Lỗi khi tải cài đặt')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }, [onStatusChange])

  useEffect(() => {
    loadSettings()
  }, [loadSettings])

  async function handleAddAccount() {
    setLoggingIn(true)
    setMessage('Đang mở Chrome... Hãy đăng nhập ChatGPT Plus và mở 1 cuộc chat để app tóm phiên.')
    setMessageType('info')
    try {
      const res = await fetch(`${API_URL}/api/settings/image-gen/chatgpt/login`, {
        method: 'POST',
      })
      if (!res.ok) {
        if (res.status === 404) {
          throw new Error('API chưa sẵn sàng (404 Not Found). Hãy khởi động lại Backend để nạp router mới.')
        }
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || 'Không thể đăng nhập ChatGPT')
      }
      setMessage('Đã thêm tài khoản ChatGPT Plus thành công!')
      setMessageType('success')
      await loadSettings()
    } catch (err: any) {
      setMessage(err?.message || 'Lỗi khi đăng nhập ChatGPT')
      setMessageType('error')
    } finally {
      setLoggingIn(false)
    }
  }

  async function handleRefreshAccount(id: string) {
    setRefreshingId(id)
    setMessage('Đang làm mới cookie phiên đăng nhập qua Chrome profile ấm...')
    setMessageType('info')
    try {
      const res = await fetch(`${API_URL}/api/settings/image-gen/chatgpt/refresh/${id}`, {
        method: 'POST',
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || 'Không thể làm mới phiên đăng nhập')
      }
      setMessage('Đã làm mới cookie thành công!')
      setMessageType('success')
      await loadSettings()
    } catch (err: any) {
      setMessage(err?.message || 'Lỗi khi làm mới cookie')
      setMessageType('error')
    } finally {
      setRefreshingId(null)
    }
  }

  async function handleDeleteAccount(id: string) {
    if (!window.confirm('Bạn có chắc chắn muốn xóa tài khoản ChatGPT này?')) return
    setDeletingId(id)
    try {
      const res = await fetch(`${API_URL}/api/settings/image-gen/chatgpt/accounts/${id}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error('Không thể xóa tài khoản')
      setMessage('Đã xóa tài khoản ChatGPT.')
      setMessageType('info')
      await loadSettings()
    } catch (err: any) {
      setMessage(err?.message || 'Lỗi khi xóa tài khoản')
      setMessageType('error')
    } finally {
      setDeletingId(null)
    }
  }

  async function handleTestGenerate() {
    if (!testPrompt.trim()) return
    setGeneratingTest(true)
    setTestResult(null)
    setMessage('Đang gửi lệnh tạo ảnh thử nghiệm tới tài khoản ChatGPT Plus...')
    setMessageType('info')
    try {
      const res = await fetch(`${API_URL}/api/settings/image-gen/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: testPrompt.trim(), aspect_ratio: '9:16' }),
      })
      if (!res.ok) {
        const errData = await res.json().catch(() => ({}))
        throw new Error(errData.detail || 'Lỗi khi tạo ảnh thử nghiệm')
      }
      const data = await res.json()
      setTestResult({ path: data.saved_path, elapsed: data.elapsed_seconds })
      setMessage(`Tạo ảnh thành công trong ${data.elapsed_seconds}s! Đã lưu tại: ${data.saved_path}`)
      setMessageType('success')
    } catch (err: any) {
      setMessage(err?.message || 'Lỗi khi tạo ảnh thử nghiệm')
      setMessageType('error')
    } finally {
      setGeneratingTest(false)
      await loadSettings()
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header Card */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: '16px 20px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 8,
              background: '#f5f3ff',
              border: '1px solid #ddd6fe',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#7c3aed',
            }}
          >
            <ImageIcon size={22} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h3 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                Tài khoản ChatGPT (tạo ảnh · viết kịch bản)
              </h3>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 12,
                  background: state.active_accounts_count > 0 ? '#ecfdf5' : '#fef2f2',
                  color: state.active_accounts_count > 0 ? '#059669' : '#dc2626',
                  border: `1px solid ${state.active_accounts_count > 0 ? '#a7f3d0' : '#fecaca'}`,
                }}
              >
                {`${state.active_accounts_count}/${state.total_accounts_count} Sẵn sàng`}
              </span>
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
              Sử dụng tài khoản ChatGPT Plus (reverse-gpt, đa account, có ảnh tham chiếu). Render đa luồng chia tải + tự làm mới cookie khi hết hạn.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={loadSettings}
          disabled={loading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 6,
            padding: '7px 14px',
            borderRadius: 6,
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            color: '#334155',
            fontSize: 12,
            fontWeight: 600,
            cursor: loading ? 'not-allowed' : 'pointer',
          }}
        >
          <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
          Làm mới
        </button>
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
            background: messageType === 'success' ? '#f0fdf4' : messageType === 'error' ? '#fef2f2' : '#f8fafc',
            border: `1px solid ${messageType === 'success' ? '#bbf7d0' : messageType === 'error' ? '#fecaca' : '#e2e8f0'}`,
            color: messageType === 'success' ? '#166534' : messageType === 'error' ? '#991b1b' : '#334155',
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

      {/* Account Management Card */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            padding: '12px 14px',
            background: '#f8fafc',
            border: '1px solid #e2e8f0',
            borderRadius: 8,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span
              style={{
                width: 9,
                height: 9,
                borderRadius: '50%',
                background: state.accounts.length ? '#10b981' : '#94a3b8',
              }}
            />
            <span style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>
              {state.accounts.length
                ? `${state.accounts.length} account · ${state.active_accounts_count} sẵn sàng`
                : 'Chưa có tài khoản ChatGPT Plus nào'}
            </span>
          </div>
          <button
            type="button"
            onClick={handleAddAccount}
            disabled={loggingIn}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '7px 14px',
              borderRadius: 6,
              background: '#7c3aed',
              border: '1px solid #7c3aed',
              color: '#ffffff',
              fontSize: 12,
              fontWeight: 600,
              cursor: loggingIn ? 'not-allowed' : 'pointer',
            }}
          >
            {loggingIn ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
            (+) Thêm account ChatGPT
          </button>
        </div>

        {/* Account List */}
        {state.accounts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {state.accounts.map((acc) => {
              const statusInfo = CGPT_STATUS_MAP[acc.status] || { color: '#64748b', label: acc.status }
              return (
                <div
                  key={acc.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '10px 14px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: statusInfo.color,
                      }}
                    />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                      {acc.email || acc.id}
                    </span>
                    <span style={{ fontSize: 12, color: statusInfo.color }}>
                      · {statusInfo.label}
                    </span>
                    {acc.message && (
                      <span
                        style={{
                          fontSize: 11.5,
                          color: '#b45309',
                          background: '#fef3c7',
                          padding: '2px 8px',
                          borderRadius: 4,
                          maxWidth: 280,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                        title={acc.message}
                      >
                        {acc.message}
                      </span>
                    )}
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      title="Làm mới cookie phiên đăng nhập"
                      onClick={() => handleRefreshAccount(acc.id)}
                      disabled={refreshingId === acc.id}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 4,
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        color: '#475569',
                        cursor: 'pointer',
                      }}
                    >
                      <RefreshCw size={13} className={refreshingId === acc.id ? 'animate-spin' : ''} />
                    </button>
                    <button
                      type="button"
                      title="Xóa tài khoản này"
                      onClick={() => handleDeleteAccount(acc.id)}
                      disabled={deletingId === acc.id}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 4,
                        background: '#fef2f2',
                        border: '1px solid #fecaca',
                        color: '#dc2626',
                        cursor: 'pointer',
                      }}
                    >
                      {deletingId === acc.id ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Info notice */}
        <div
          style={{
            padding: '10px 12px',
            borderRadius: 6,
            background: '#fffbeb',
            border: '1px solid #fde68a',
            fontSize: 12,
            color: '#92400e',
            lineHeight: 1.6,
          }}
        >
          <div><strong>Lưu ý về hạn mức ảnh:</strong> Nên dùng tài khoản <strong>ChatGPT Plus</strong> để có hạn mức tạo ảnh cao và tốc độ ưu tiên. Tài khoản miễn phí (Free plan) bị OpenAI giới hạn rất chặt (chỉ 1–2 ảnh/ngày; khi chạm limit OpenAI sẽ khóa tạo ảnh trong 16–24h).</div>
          <div style={{ marginTop: 4 }}>Hệ thống hỗ trợ <strong>đa account</strong>: Tự động xoay sang tài khoản khác khi tài khoản hiện tại đụng giới hạn (exhausted) hoặc hết hạn cookie.</div>
        </div>
      </div>

      {/* Test Generation Card */}
      <div
        style={{
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
          padding: '20px',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} color="#7c3aed" />
          <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
            Kiểm tra tạo ảnh thử nghiệm
          </h4>
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <input
            type="text"
            value={testPrompt}
            onChange={(e) => setTestPrompt(e.target.value)}
            placeholder="Nhập prompt mô tả hình ảnh cần tạo..."
            style={{
              flex: 1,
              padding: '8px 12px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              fontSize: 13,
              color: '#0f172a',
            }}
          />
          <button
            type="button"
            onClick={handleTestGenerate}
            disabled={generatingTest || !state.accounts.length}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 16px',
              borderRadius: 6,
              background: '#0f172a',
              border: '1px solid #0f172a',
              color: '#ffffff',
              fontSize: 12.5,
              fontWeight: 600,
              cursor: generatingTest || !state.accounts.length ? 'not-allowed' : 'pointer',
            }}
          >
            {generatingTest ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
            Tạo thử ảnh
          </button>
        </div>

        {testResult && (
          <div
            style={{
              padding: '12px 14px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 6,
              fontSize: 12.5,
              color: '#334155',
            }}
          >
            <div><strong>Thời gian render:</strong> {testResult.elapsed}s</div>
            <div style={{ wordBreak: 'break-all', marginTop: 4 }}>
              <strong>Đường dẫn file:</strong> <code>{testResult.path}</code>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
