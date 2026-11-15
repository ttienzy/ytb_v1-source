import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  Globe,
  Info,
  Loader2,
  LogIn,
  Pencil,
  RefreshCw,
  Trash2,
  Users,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { MuseAccount, MuseAccountsState } from '../types'

interface MuseAccountsCardProps {
  /** Gọi sau mỗi thay đổi (thêm/xóa/kiểm tra) để phần trạng thái phía trên làm mới. */
  onChanged?: (state: MuseAccountsState) => void
}

const MUSE_STATUS_MAP: Record<string, { color: string; label: string }> = {
  active: { color: '#10b981', label: 'Sẵn sàng' },
  exhausted: { color: '#f59e0b', label: 'Hết hạn mức (tạm nghỉ)' },
  error: { color: '#ef4444', label: 'Hết phiên — đăng nhập lại' },
}

const EMPTY: MuseAccountsState = {
  accounts: [],
  active_accounts_count: 0,
  total_accounts_count: 0,
}

async function readError(res: Response, fallback: string): Promise<string> {
  if (res.status === 404 || res.status === 405) {
    const data = await res.json().catch(() => ({}))
    if (data?.detail && data.detail !== 'Not Found') return String(data.detail)
    return 'API tài khoản Muse chưa có — hãy khởi động lại Backend.'
  }
  const data = await res.json().catch(() => ({}))
  return data?.detail ? String(data.detail) : fallback
}

function formatTime(sec: number): string {
  if (!sec) return 'chưa'
  return new Date(sec * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

const iconBtn = {
  padding: '6px 8px',
  borderRadius: 4,
  background: '#f8fafc',
  border: '1px solid #cbd5e1',
  color: '#475569',
  cursor: 'pointer',
  display: 'inline-flex',
  alignItems: 'center',
  gap: 4,
  fontSize: 11.5,
  fontWeight: 600,
} as const

export function MuseAccountsCard({ onChanged }: MuseAccountsCardProps) {
  const [state, setState] = useState<MuseAccountsState>(EMPTY)
  const [loading, setLoading] = useState(false)
  const [adding, setAdding] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [busyAction, setBusyAction] = useState<'check' | 'login' | 'open' | 'delete' | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editLabel, setEditLabel] = useState('')
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')

  const say = (text: string, type: 'success' | 'error' | 'info') => {
    setMessage(text)
    setMessageType(type)
  }

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/settings/muse/accounts`)
      if (!res.ok) throw new Error(await readError(res, 'Không tải được danh sách tài khoản Muse'))
      const data: MuseAccountsState = await res.json()
      setState(data)
      onChanged?.(data)
    } catch (err: any) {
      say(err?.message || 'Lỗi khi tải tài khoản Muse', 'error')
    } finally {
      setLoading(false)
    }
  }, [onChanged])

  useEffect(() => {
    load()
  }, [load])

  async function handleAdd() {
    setAdding(true)
    say('Đang mở Chrome… Hãy đăng nhập tài khoản Meta/Muse trong cửa sổ vừa mở. App tự nhận khi đăng nhập xong (tối đa 7 phút).', 'info')
    try {
      const res = await fetch(`${API_URL}/api/settings/muse/accounts/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error(await readError(res, 'Không đăng nhập được Muse'))
      const data = await res.json()
      say(`Đã thêm tài khoản Muse “${data.account?.label || ''}”.`, 'success')
    } catch (err: any) {
      say(err?.message || 'Lỗi khi thêm tài khoản Muse', 'error')
    } finally {
      setAdding(false)
      await load()
    }
  }

  async function runAction(acc: MuseAccount, action: 'check' | 'login' | 'open' | 'delete') {
    if (action === 'delete') {
      if (!window.confirm(`Xóa tài khoản Muse “${acc.label}”? Profile Chrome của tài khoản này cũng bị xóa.`)) return
    }
    setBusyId(acc.id)
    setBusyAction(action)
    try {
      let res: Response
      if (action === 'check') {
        say(`Đang kiểm tra phiên đăng nhập “${acc.label}”…`, 'info')
        res = await fetch(`${API_URL}/api/settings/muse/accounts/${acc.id}/check`, { method: 'POST' })
        if (!res.ok) throw new Error(await readError(res, 'Không kiểm tra được tài khoản'))
        const data = await res.json()
        if (data.account?.status === 'active') say(`“${acc.label}” đang đăng nhập bình thường.`, 'success')
        else say(data.account?.message || `“${acc.label}” chưa đăng nhập.`, 'error')
      } else if (action === 'login') {
        say(`Đang mở Chrome của “${acc.label}”… Đăng nhập lại trong cửa sổ vừa mở.`, 'info')
        res = await fetch(`${API_URL}/api/settings/muse/accounts/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account_id: acc.id }),
        })
        if (!res.ok) throw new Error(await readError(res, 'Không đăng nhập lại được'))
        say(`Đã đăng nhập lại “${acc.label}”.`, 'success')
      } else if (action === 'open') {
        res = await fetch(`${API_URL}/api/settings/muse/open-browser?account_id=${encodeURIComponent(acc.id)}`, {
          method: 'POST',
        })
        if (!res.ok) throw new Error(await readError(res, 'Không mở được Chrome'))
        say(`Đã mở Chrome của “${acc.label}”.`, 'info')
      } else {
        res = await fetch(`${API_URL}/api/settings/muse/accounts/${acc.id}`, { method: 'DELETE' })
        if (!res.ok) throw new Error(await readError(res, 'Không xóa được tài khoản'))
        say(`Đã xóa tài khoản “${acc.label}”.`, 'info')
      }
    } catch (err: any) {
      say(err?.message || 'Lỗi thao tác tài khoản Muse', 'error')
    } finally {
      setBusyId(null)
      setBusyAction(null)
      await load()
    }
  }

  async function saveLabel(acc: MuseAccount) {
    const label = editLabel.trim()
    setEditingId(null)
    if (!label || label === acc.label) return
    try {
      const res = await fetch(`${API_URL}/api/settings/muse/accounts/${acc.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label }),
      })
      if (!res.ok) throw new Error(await readError(res, 'Không đổi được tên'))
    } catch (err: any) {
      say(err?.message || 'Lỗi khi đổi tên', 'error')
    } finally {
      await load()
    }
  }

  const ready = state.active_accounts_count

  return (
    <div
      style={{
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: 8,
        padding: '18px 20px',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
      }}
    >
      {/* Tiêu đề */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Users size={17} color="#0f172a" />
          <h3 style={{ fontSize: 14, fontWeight: 700, color: '#0f172a', margin: 0 }}>Tài khoản Muse</h3>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              padding: '2px 8px',
              borderRadius: 12,
              background: ready > 0 ? '#ecfdf5' : '#fef2f2',
              color: ready > 0 ? '#059669' : '#dc2626',
              border: `1px solid ${ready > 0 ? '#a7f3d0' : '#fecaca'}`,
            }}
          >
            {`${ready}/${state.total_accounts_count} Sẵn sàng`}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={load} disabled={loading} style={{ ...iconBtn, padding: '7px 12px' }}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            Làm mới
          </button>
          <button
            type="button"
            onClick={handleAdd}
            disabled={adding}
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
              cursor: adding ? 'not-allowed' : 'pointer',
            }}
          >
            {adding ? <Loader2 size={13} className="animate-spin" /> : <Globe size={13} />}
            (+) Thêm tài khoản Muse
          </button>
        </div>
      </div>

      {message && (
        <div
          style={{
            padding: '9px 12px',
            borderRadius: 6,
            fontSize: 12.5,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            background: messageType === 'success' ? '#f0fdf4' : messageType === 'error' ? '#fef2f2' : '#f8fafc',
            border: `1px solid ${messageType === 'success' ? '#bbf7d0' : messageType === 'error' ? '#fecaca' : '#e2e8f0'}`,
            color: messageType === 'success' ? '#166534' : messageType === 'error' ? '#991b1b' : '#334155',
          }}
        >
          {messageType === 'success' ? <CheckCircle2 size={15} /> : messageType === 'error' ? <AlertCircle size={15} /> : <Info size={15} />}
          <span>{message}</span>
        </div>
      )}

      {/* Danh sách */}
      {state.accounts.length === 0 ? (
        <div style={{ fontSize: 12.5, color: '#64748b', padding: '6px 2px' }}>
          Chưa có tài khoản Muse nào. Bấm “(+) Thêm tài khoản Muse” để đăng nhập — Muse Studio cần ít nhất một tài khoản để tạo video.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {state.accounts.map(acc => {
            const st = MUSE_STATUS_MAP[acc.status] || { color: '#64748b', label: acc.status }
            const isBusy = busyId === acc.id
            return (
              <div
                key={acc.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  padding: '10px 14px',
                  background: '#ffffff',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: st.color, flexShrink: 0 }} />
                    {editingId === acc.id ? (
                      <input
                        autoFocus
                        value={editLabel}
                        maxLength={60}
                        onChange={e => setEditLabel(e.target.value)}
                        onBlur={() => saveLabel(acc)}
                        onKeyDown={e => {
                          if (e.key === 'Enter') saveLabel(acc)
                          if (e.key === 'Escape') setEditingId(null)
                        }}
                        style={{ fontSize: 13, padding: '2px 6px', border: '1px solid #cbd5e1', borderRadius: 4, width: 200 }}
                      />
                    ) : (
                      <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>{acc.label}</span>
                    )}
                    {editingId !== acc.id && (
                      <button
                        type="button"
                        title="Đổi tên"
                        onClick={() => {
                          setEditingId(acc.id)
                          setEditLabel(acc.label)
                        }}
                        style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#94a3b8', display: 'inline-flex' }}
                      >
                        <Pencil size={12} />
                      </button>
                    )}
                    <span style={{ fontSize: 12, color: st.color }}>· {st.label}</span>
                    {acc.busy && (
                      <span style={{ fontSize: 10.5, color: '#1d4ed8', background: '#eff6ff', padding: '1px 6px', borderRadius: 4 }}>
                        đang chạy job
                      </span>
                    )}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', paddingLeft: 16 }}>
                    {acc.running ? 'Chrome đang mở' : 'Chrome đang tắt'} · cổng {acc.cdpPort} · kiểm tra lần cuối {formatTime(acc.lastCheckedAt)}
                    {acc.lastUsed ? ` · dùng lần cuối ${formatTime(acc.lastUsed)}` : ''}
                  </div>
                  {acc.message && (
                    <div style={{ fontSize: 11.5, color: '#b45309', paddingLeft: 16 }} title={acc.message}>
                      {acc.message}
                    </div>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                  <button type="button" title="Mở cửa sổ Chrome của tài khoản này" onClick={() => runAction(acc, 'open')} disabled={isBusy} style={iconBtn}>
                    {isBusy && busyAction === 'open' ? <Loader2 size={13} className="animate-spin" /> : <ExternalLink size={13} />}
                  </button>
                  <button type="button" title="Kiểm tra phiên đăng nhập" onClick={() => runAction(acc, 'check')} disabled={isBusy} style={iconBtn}>
                    <RefreshCw size={13} className={isBusy && busyAction === 'check' ? 'animate-spin' : ''} />
                  </button>
                  <button
                    type="button"
                    title="Đăng nhập lại (mở Chrome của tài khoản này)"
                    onClick={() => runAction(acc, 'login')}
                    disabled={isBusy}
                    style={iconBtn}
                  >
                    {isBusy && busyAction === 'login' ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
                    Đăng nhập lại
                  </button>
                  <button
                    type="button"
                    title="Xóa tài khoản này"
                    onClick={() => runAction(acc, 'delete')}
                    disabled={isBusy}
                    style={{ ...iconBtn, background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626' }}
                  >
                    {isBusy && busyAction === 'delete' ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

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
        <div>
          Tạo video <strong>không cần mở Chrome</strong>: app kết nối thẳng tới Muse bằng phiên đăng nhập đã lưu. Chrome chỉ
          dùng khi thêm / đăng nhập lại tài khoản; mỗi tài khoản có profile Chrome riêng nên không đăng xuất lẫn nhau.
        </div>
        <div style={{ marginTop: 4 }}>
          Muse Studio chọn được tài khoản cụ thể, hoặc để <strong>Tự động</strong>: app luân phiên các tài khoản “Sẵn sàng”, ưu
          tiên tài khoản đang rảnh. Tài khoản “Hết phiên” bị bỏ qua cho tới khi đăng nhập lại.
        </div>
      </div>
    </div>
  )
}
