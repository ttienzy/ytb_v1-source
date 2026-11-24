import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, Globe, Info, Loader2, LogIn, RefreshCw, Sparkles, Trash2, Wand2 } from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { GeminiState } from '../types'
import { GEMINI_STATUS_MAP, geminiTemplateTitle } from './geminiAccounts'

interface GeminiAccountsCardProps {
  onStatusChange?: (hasReadyAccount: boolean) => void
}

const EMPTY: GeminiState = { accounts: [], active_accounts_count: 0, total_accounts_count: 0, has_cookie: false }

/** Tài khoản Gemini kiểu ChatGPT: danh sách, “(+) Thêm account”, làm mới / đăng nhập lại / xóa từng cái. */
export function GeminiAccountsCard({ onStatusChange }: GeminiAccountsCardProps) {
  const [state, setState] = useState<GeminiState>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [capturing, setCapturing] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/settings/gemini`)
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || 'Không thể tải tài khoản Gemini')
      const data: GeminiState = await res.json()
      setState(data)
      onStatusChange?.(data.active_accounts_count > 0)
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Không kết nối được với Backend.')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }, [onStatusChange])

  useEffect(() => {
    void load()
  }, [load])

  async function call(url: string, init: RequestInit, fallbackError: string) {
    const res = await fetch(`${API_URL}${url}`, init)
    const body = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(body.detail || fallbackError)
    return body
  }

  async function addAccount() {
    setAdding(true)
    setMessage('Đang mở Chrome... Hãy đăng nhập Google (tài khoản dùng Gemini) rồi đợi app tự lưu phiên.')
    setMessageType('info')
    try {
      await call('/api/settings/gemini/accounts/login', { method: 'POST' }, 'Không thể thêm tài khoản Gemini')
      setMessage('Đã thêm tài khoản Gemini thành công!')
      setMessageType('success')
      await load()
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Không thể thêm tài khoản Gemini')
      setMessageType('error')
    } finally {
      setAdding(false)
    }
  }

  async function refreshAccount(id: string) {
    setBusyId(id)
    setMessage('Đang làm mới cookie qua Chrome profile ấm (ngầm, vài giây)...')
    setMessageType('info')
    try {
      await call(`/api/settings/gemini/accounts/${id}/refresh`, { method: 'POST' }, 'Không thể làm mới phiên đăng nhập')
      setMessage('Đã làm mới cookie thành công!')
      setMessageType('success')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi làm mới cookie')
      setMessageType('error')
    } finally {
      setBusyId(null)
      await load()
    }
  }

  async function reloginAccount(id: string) {
    setBusyId(id)
    setMessage('Đang mở Chrome... Hãy đăng nhập lại Google trong cửa sổ vừa mở.')
    setMessageType('info')
    try {
      await call(
        '/api/settings/gemini/accounts/login',
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ account_id: id }) },
        'Không thể đăng nhập lại',
      )
      setMessage('Đã đăng nhập lại thành công!')
      setMessageType('success')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Không thể đăng nhập lại')
      setMessageType('error')
    } finally {
      setBusyId(null)
      await load()
    }
  }

  async function deleteAccount(id: string) {
    if (!window.confirm('Bạn có chắc chắn muốn xóa tài khoản Gemini này? Profile Chrome của nó cũng được xóa.')) return
    setBusyId(id)
    try {
      await call(`/api/settings/gemini/accounts/${id}`, { method: 'DELETE' }, 'Không thể xóa tài khoản')
      setMessage('Đã xóa tài khoản Gemini.')
      setMessageType('info')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Lỗi khi xóa tài khoản')
      setMessageType('error')
    } finally {
      setBusyId(null)
      await load()
    }
  }

  /** Bắt lại khung request Gemini từ profile của một tài khoản — chỉ cần khi Gemini đổi giao thức. */
  async function captureTemplate() {
    setCapturing(true)
    setMessage('Đang mở Chrome để bắt khung request — không tạo lịch sử chat...')
    setMessageType('info')
    try {
      const result = await call('/api/settings/gemini/capture-template', { method: 'POST' }, 'Không cập nhật được template Gemini')
      setState((prev) => ({ ...prev, template_source: 'captured', template_saved_at: result.template_saved_at }))
      setMessage('Đã cập nhật template Gemini từ phiên đăng nhập trên máy này.')
      setMessageType('success')
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Không cập nhật được template Gemini.')
      setMessageType('error')
    } finally {
      setCapturing(false)
    }
  }

  const { accounts, active_accounts_count: active } = state
  return (
    <div className="gemini-card" data-testid="gemini-accounts-card">
      <div className="gemini-card-header">
        <div className="gemini-card-title-group">
          <div className="gemini-badge-icon">
            <Sparkles size={16} />
          </div>
          <div>
            <h3 className="gemini-title">Tài khoản Gemini (kịch bản Recap · phân tích sản phẩm · Chiến dịch AI)</h3>
            <p className="gemini-subtitle">
              Mỗi tài khoản có một profile Chrome riêng, tự làm mới cookie khi hết hạn và tự xoay sang tài khoản khác khi lỗi
              hoặc bị giới hạn tốc độ.
            </p>
          </div>
        </div>
        <div className="gemini-header-status">
          <span className={`gemini-status-pill ${active > 0 ? 'connected' : 'disconnected'}`}>
            {active > 0 ? <CheckCircle2 size={13} /> : <AlertCircle size={13} />}
            {`${active}/${state.total_accounts_count} Sẵn sàng`}
          </span>
          <button type="button" className="btn-gemini-secondary" onClick={load} disabled={loading} title="Tải lại danh sách">
            <RefreshCw size={13} className={loading ? 'spin-icon' : ''} />
            Làm mới
          </button>
        </div>
      </div>

      <div className="gemini-card-body">
        <div className="gemini-action-bar">
          <span style={{ fontSize: 13, fontWeight: 500, color: '#334155' }}>
            {accounts.length ? `${accounts.length} account · ${active} sẵn sàng` : 'Chưa có tài khoản Gemini nào'}
          </span>
          <button type="button" className="btn-gemini-primary" onClick={addAccount} disabled={adding}>
            {adding ? <Loader2 size={14} className="spin-icon" /> : <Globe size={14} />}
            <span>(+) Thêm account Gemini</span>
          </button>
          {state.total_accounts_count > 0 && (
            <button
              type="button"
              className="btn-gemini-chrome"
              onClick={captureTemplate}
              disabled={capturing}
              title={geminiTemplateTitle(state)}
            >
              {capturing ? <Loader2 size={14} className="spin-icon" /> : <Wand2 size={14} />}
              <span>Cập nhật template Gemini</span>
            </button>
          )}
        </div>

        {message && (
          <div className={`gemini-inline-message ${messageType}`}>
            {messageType === 'success' && <CheckCircle2 size={14} />}
            {messageType === 'error' && <AlertCircle size={14} />}
            {messageType === 'info' && <Info size={14} />}
            <span>{message}</span>
          </div>
        )}

        {accounts.length > 0 && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            {accounts.map((acc) => {
              const info = GEMINI_STATUS_MAP[acc.status] || { color: '#64748b', label: acc.status }
              const busy = busyId === acc.id
              return (
                <div
                  key={acc.id}
                  data-testid="gemini-account-row"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    padding: '10px 14px',
                    background: '#ffffff',
                    border: '1px solid #e2e8f0',
                    borderRadius: 6,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: info.color, flex: '0 0 auto' }} />
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{acc.email || acc.id}</span>
                    <span style={{ fontSize: 12, color: info.color, whiteSpace: 'nowrap' }}>· {info.label}</span>
                    {acc.message && (
                      <span
                        title={acc.message}
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
                      >
                        {acc.message}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: '0 0 auto' }}>
                    <button
                      type="button"
                      title="Làm mới cookie bằng profile Chrome ấm (ngầm)"
                      onClick={() => refreshAccount(acc.id)}
                      disabled={busy}
                      style={iconBtn('#f8fafc', '#cbd5e1', '#475569')}
                    >
                      <RefreshCw size={13} className={busy ? 'spin-icon' : ''} />
                    </button>
                    <button
                      type="button"
                      title="Đăng nhập lại (mở cửa sổ Chrome)"
                      onClick={() => reloginAccount(acc.id)}
                      disabled={busy}
                      style={iconBtn('#f8fafc', '#cbd5e1', '#475569')}
                    >
                      <LogIn size={13} />
                    </button>
                    <button
                      type="button"
                      title="Xóa tài khoản này"
                      onClick={() => deleteAccount(acc.id)}
                      disabled={busy}
                      style={iconBtn('#fef2f2', '#fecaca', '#dc2626')}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        <div className="gemini-guide-box">
          <Info size={15} className="guide-icon" />
          <div className="guide-steps">
            <div className="guide-step">
              Bấm <strong>(+) Thêm account Gemini</strong> → Chrome mở ra → đăng nhập Google một lần. App tự lưu phiên và đọc email tài khoản.
            </div>
            <div className="guide-step">
              Nhiều account: app tự xoay khi tài khoản hết hạn cookie (“Làm mới” ngầm hoặc “Đăng nhập lại”) hoặc bị giới hạn tốc độ.
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function iconBtn(bg: string, border: string, color: string) {
  return { padding: '6px 8px', borderRadius: 4, background: bg, border: `1px solid ${border}`, color, cursor: 'pointer' } as const
}
