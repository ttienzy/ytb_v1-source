import { useCallback, useEffect, useState } from 'react'
import {
  AlertCircle,
  Bot,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  EyeOff,
  Inbox,
  Key,
  Layers,
  Loader2,
  Mail,
  Plus,
  RefreshCw,
  Trash2,
  X,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type {
  MailAccount,
  MailDomain,
  MailMessage,
  MailMessageDetail,
} from '../types'

export function MailTmSection({
  onRegisteredPippit,
}: {
  onRegisteredPippit?: () => void
}) {
  const [domains, setDomains] = useState<MailDomain[]>([])
  const [accounts, setAccounts] = useState<MailAccount[]>([])
  const [tab, setTab] = useState<'single' | 'batch'>('single')

  // Single form state
  const [username, setUsername] = useState('')
  const [selectedDomain, setSelectedDomain] = useState('')
  const [password, setPassword] = useState('')
  const [showPass, setShowPass] = useState(false)

  // Batch form state
  const [batchPrefix, setBatchPrefix] = useState('pip')
  const [batchDomain, setBatchDomain] = useState('')
  const [batchCount, setBatchCount] = useState(3)
  const [batchPassword, setBatchPassword] = useState('')
  const [showBatchPass, setShowBatchPass] = useState(false)

  // Status & Feedback
  const [loading, setLoading] = useState(false)
  const [feedback, setFeedback] = useState<{
    text: string
    type: 'success' | 'error'
  } | null>(null)
  const [copiedKey, setCopiedKey] = useState<string | null>(null)

  // Inbox Modal State
  const [inboxAccount, setInboxAccount] = useState<MailAccount | null>(null)
  const [messages, setMessages] = useState<MailMessage[]>([])
  const [inboxLoading, setInboxLoading] = useState(false)
  const [selectedMsg, setSelectedMsg] = useState<MailMessageDetail | null>(null)
  const [msgLoading, setMsgLoading] = useState(false)

  // Pure HTTP Login & Sync Modal
  const [syncModal, setSyncModal] = useState<{
    open: boolean
    account: MailAccount | null
    step: 'idle' | 'running' | 'done' | 'error'
    message: string
    pagesCount?: number
  }>({ open: false, account: null, step: 'idle', message: '' })

  const loadDomains = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/mailtm/domains`)
      if (!res.ok) throw new Error()
      const data: MailDomain[] = await res.json()
      setDomains(data)
      if (data.length > 0) {
        setSelectedDomain(prev => prev || data[0].domain)
        setBatchDomain(prev => prev || data[0].domain)
      }
    } catch {
      // ignore
    }
  }, [])

  const loadAccounts = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/mailtm/accounts`)
      if (!res.ok) throw new Error()
      const data: MailAccount[] = await res.json()
      setAccounts(data)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadDomains()
    loadAccounts()
  }, [loadDomains, loadAccounts])

  function copyText(text: string, key: string) {
    navigator.clipboard.writeText(text)
    setCopiedKey(key)
    setTimeout(() => setCopiedKey(null), 2000)
  }

  function generatePass(target: 'single' | 'batch') {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789!@#$'
    let pass = ''
    for (let i = 0; i < 12; i++) {
      pass += chars.charAt(Math.floor(Math.random() * chars.length))
    }
    if (target === 'single') setPassword(pass)
    else setBatchPassword(pass)
  }

  async function handleCreateSingle(e: React.FormEvent) {
    e.preventDefault()
    if (!username.trim() || !selectedDomain || !password.trim()) {
      setFeedback({
        text: 'Vui lòng nhập đầy đủ Username, Domain và Mật khẩu.',
        type: 'error',
      })
      return
    }
    setLoading(true)
    setFeedback(null)
    try {
      const res = await fetch(`${API_URL}/api/mailtm/accounts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: username.trim(),
          domain: selectedDomain,
          password: password.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Tạo tài khoản thất bại')
      setAccounts(prev => [data, ...prev])
      setUsername('')
      setFeedback({
        text: `Đã tạo tài khoản thành công: ${data.address}`,
        type: 'success',
      })
    } catch (err: any) {
      setFeedback({ text: err.message || 'Lỗi tạo tài khoản', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleCreateBatch(e: React.FormEvent) {
    e.preventDefault()
    if (!batchPrefix.trim() || !batchDomain || !batchPassword.trim()) {
      setFeedback({
        text: 'Vui lòng điền đầy đủ Tiền tố, Domain và Mật khẩu.',
        type: 'error',
      })
      return
    }
    setLoading(true)
    setFeedback(null)
    try {
      const res = await fetch(`${API_URL}/api/mailtm/accounts/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prefix: batchPrefix.trim(),
          domain: batchDomain,
          password: batchPassword.trim(),
          count: Number(batchCount) || 3,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Tạo hàng loạt thất bại')
      setAccounts(prev => [...data, ...prev])
      setFeedback({
        text: `Đã tạo thành công ${data.length} tài khoản Mail.tm!`,
        type: 'success',
      })
    } catch (err: any) {
      setFeedback({ text: err.message || 'Lỗi tạo hàng loạt', type: 'error' })
    } finally {
      setLoading(false)
    }
  }

  async function handleDelete(account: MailAccount) {
    if (!confirm(`Bạn có chắc muốn xóa tài khoản ${account.address}?`)) return
    try {
      const res = await fetch(
        `${API_URL}/api/mailtm/accounts/${account.id}`,
        { method: 'DELETE' }
      )
      if (res.ok) {
        setAccounts(prev => prev.filter(a => a.id !== account.id))
      }
    } catch {
      // ignore
    }
  }

  async function openInbox(account: MailAccount) {
    setInboxAccount(account)
    setSelectedMsg(null)
    setInboxLoading(true)
    try {
      const res = await fetch(
        `${API_URL}/api/mailtm/accounts/${account.id}/messages`
      )
      if (!res.ok) throw new Error()
      const data = await res.json()
      setMessages(data)
    } catch {
      setMessages([])
    } finally {
      setInboxLoading(false)
    }
  }

  async function openMsgDetail(msgId: string) {
    if (!inboxAccount) return
    setMsgLoading(true)
    try {
      const res = await fetch(
        `${API_URL}/api/mailtm/accounts/${inboxAccount.id}/messages/${msgId}`
      )
      if (!res.ok) throw new Error()
      const data = await res.json()
      setSelectedMsg(data)
    } catch {
      // ignore
    } finally {
      setMsgLoading(false)
    }
  }

  async function startLoginSyncPippit(account: MailAccount) {
    setSyncModal({
      open: true,
      account,
      step: 'running',
      message:
        'Đang đăng nhập Pure HTTP vào Pippit và trích xuất Workspace ID, Real Facebook Pages...',
    })
    try {
      const res = await fetch(`${API_URL}/api/pippit/accounts/login-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: account.address,
          password: account.password,
          mailtm_id: account.id,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Đăng nhập Pippit thất bại')
      const connectedCount = (data.facebook_pages || []).filter(
        (p: any) => p.page_id
      ).length
      setSyncModal({
        open: true,
        account,
        step: 'done',
        message: `Đăng nhập thành công! Đã kết nối ${connectedCount} Real Facebook Pages cho ${account.address}.`,
        pagesCount: connectedCount,
      })
      if (onRegisteredPippit) onRegisteredPippit()
    } catch (err: any) {
      setSyncModal({
        open: true,
        account,
        step: 'error',
        message:
          err.message || 'Đăng nhập Pippit thất bại. Vui lòng kiểm tra lại tài khoản.',
      })
    }
  }

  return (
    <div className="mailtm-container">
      <div className="mailtm-card">
        <div className="mailtm-card-header">
          <div className="gemini-card-title-group">
            <div className="gemini-badge-icon">
              <Mail size={17} />
            </div>
            <div>
              <h3 className="gemini-title">Mail.tm (Hộp thư tạm thời tự động)</h3>
              <p className="gemini-subtitle">
                Tự động tạo email theo tên miền tùy ý &amp; đọc mã xác nhận OTP (lưu trữ trong config.json).
              </p>
            </div>
          </div>
        </div>

        <div className="mailtm-card-body">
          <div className="mailtm-segmented-tabs">
            <button
              type="button"
              className={`mailtm-seg-btn ${tab === 'single' ? 'active' : ''}`}
              onClick={() => setTab('single')}
            >
              <Plus size={13} /> Tạo 1 tài khoản tùy chỉnh
            </button>
            <button
              type="button"
              className={`mailtm-seg-btn ${tab === 'batch' ? 'active' : ''}`}
              onClick={() => setTab('batch')}
            >
              <Layers size={13} /> Tạo hàng loạt (Batch Generate)
            </button>
          </div>

          {tab === 'single' ? (
            <form onSubmit={handleCreateSingle}>
              <div className="mailtm-form-grid">
                <div className="mailtm-field">
                  <label className="mailtm-label">
                    Username <span>(tùy chọn)</span>
                  </label>
                  <input
                    className="mailtm-input"
                    value={username}
                    onChange={e => setUsername(e.target.value)}
                    placeholder="vd: recap_pip01"
                    disabled={loading}
                  />
                </div>
                <div className="mailtm-field">
                  <label className="mailtm-label">Tên miền (Domain Mail.tm)</label>
                  <select
                    className="mailtm-select"
                    value={selectedDomain}
                    onChange={e => setSelectedDomain(e.target.value)}
                    disabled={loading || domains.length === 0}
                  >
                    {domains.map(d => (
                      <option key={d.id} value={d.domain}>
                        @{d.domain}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mailtm-field">
                  <label className="mailtm-label">Mật khẩu</label>
                  <div className="mailtm-input-wrap">
                    <input
                      className="mailtm-input"
                      type={showPass ? 'text' : 'password'}
                      value={password}
                      onChange={e => setPassword(e.target.value)}
                      placeholder="Mật khẩu tùy ý..."
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="mailtm-input-addon"
                      onClick={() => setShowPass(!showPass)}
                      title={showPass ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    >
                      {showPass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="mailtm-actions">
                <button type="submit" className="mailtm-btn-primary" disabled={loading}>
                  {loading ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Plus size={14} />
                  )}{' '}
                  Tạo tài khoản
                </button>
                <button
                  type="button"
                  className="mailtm-btn-secondary"
                  onClick={() => generatePass('single')}
                  disabled={loading}
                >
                  <Key size={14} /> Tạo pass ngẫu nhiên
                </button>
              </div>
            </form>
          ) : (
            <form onSubmit={handleCreateBatch}>
              <div className="mailtm-form-grid">
                <div className="mailtm-field">
                  <label className="mailtm-label">Tiền tố Username (Prefix)</label>
                  <input
                    className="mailtm-input"
                    value={batchPrefix}
                    onChange={e => setBatchPrefix(e.target.value)}
                    placeholder="vd: pip_acc"
                    disabled={loading}
                  />
                </div>
                <div className="mailtm-field">
                  <label className="mailtm-label">Số lượng tài khoản (1-20)</label>
                  <input
                    className="mailtm-input"
                    type="number"
                    min={1}
                    max={20}
                    value={batchCount}
                    onChange={e => setBatchCount(parseInt(e.target.value) || 1)}
                    disabled={loading}
                  />
                </div>
                <div className="mailtm-field">
                  <label className="mailtm-label">Tên miền (Domain)</label>
                  <select
                    className="mailtm-select"
                    value={batchDomain}
                    onChange={e => setBatchDomain(e.target.value)}
                    disabled={loading || domains.length === 0}
                  >
                    {domains.map(d => (
                      <option key={d.id} value={d.domain}>
                        @{d.domain}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mailtm-field">
                  <label className="mailtm-label">Mật khẩu chung</label>
                  <div className="mailtm-input-wrap">
                    <input
                      className="mailtm-input"
                      type={showBatchPass ? 'text' : 'password'}
                      value={batchPassword}
                      onChange={e => setBatchPassword(e.target.value)}
                      placeholder="Mật khẩu cho các tài khoản..."
                      disabled={loading}
                    />
                    <button
                      type="button"
                      className="mailtm-input-addon"
                      onClick={() => setShowBatchPass(!showBatchPass)}
                      title={showBatchPass ? 'Ẩn mật khẩu' : 'Hiện mật khẩu'}
                    >
                      {showBatchPass ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </div>
                </div>
              </div>
              <div className="mailtm-actions">
                <button type="submit" className="mailtm-btn-primary" disabled={loading}>
                  {loading ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Layers size={14} />
                  )}{' '}
                  Tạo {batchCount} tài khoản hàng loạt
                </button>
                <button
                  type="button"
                  className="mailtm-btn-secondary"
                  onClick={() => generatePass('batch')}
                  disabled={loading}
                >
                  <Key size={14} /> Tạo pass ngẫu nhiên
                </button>
              </div>
            </form>
          )}

          {feedback && (
            <p
              className="settings-message"
              style={{
                color: feedback.type === 'success' ? '#16a34a' : '#dc2626',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                marginTop: 12,
                fontSize: 12.5,
              }}
            >
              {feedback.type === 'success' ? (
                <CheckCircle2 size={14} />
              ) : (
                <AlertCircle size={14} />
              )}
              {feedback.text}
            </p>
          )}

          {/* Danh sách tài khoản đã lưu */}
          <div className="mailtm-table-header">
            <div className="mailtm-table-title">
              <span>Danh sách tài khoản đã lưu</span>
              <span className="mailtm-count-badge">{accounts.length}</span>
            </div>
            <button
              type="button"
              className="mailtm-btn-refresh"
              onClick={() => {
                loadDomains()
                loadAccounts()
              }}
            >
              <RefreshCw size={12} /> Làm mới
            </button>
          </div>

          {accounts.length === 0 ? (
            <div
              style={{
                padding: '24px 16px',
                textAlign: 'center',
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px dashed #e2e8f0',
                color: '#94a3b8',
                fontSize: 12,
              }}
            >
              Chưa có tài khoản Mail.tm nào được lưu. Hãy tạo tài khoản ở trên để bắt
              đầu.
            </div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table className="mailtm-table">
                <thead>
                  <tr>
                    <th>Địa chỉ Email</th>
                    <th>Mật khẩu</th>
                    <th>Ngày tạo</th>
                    <th style={{ textAlign: 'right' }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {accounts.map(acc => (
                    <tr key={acc.id}>
                      <td>
                        <button
                          type="button"
                          className="mailtm-tag-email"
                          onClick={() => copyText(acc.address, `email_${acc.id}`)}
                          title="Click để copy email"
                        >
                          <Mail size={12} style={{ color: '#6366f1' }} />
                          <strong>{acc.address}</strong>
                          {copiedKey === `email_${acc.id}` ? (
                            <Check size={11} style={{ color: '#16a34a' }} />
                          ) : (
                            <Copy size={11} style={{ opacity: 0.6 }} />
                          )}
                        </button>
                      </td>
                      <td>
                        <button
                          type="button"
                          className="mailtm-tag-pass"
                          onClick={() => copyText(acc.password, `pass_${acc.id}`)}
                          title="Click để copy mật khẩu"
                        >
                          <Key size={12} />
                          <span>{acc.password}</span>
                          {copiedKey === `pass_${acc.id}` ? (
                            <Check size={11} style={{ color: '#16a34a' }} />
                          ) : (
                            <Copy size={11} style={{ opacity: 0.6 }} />
                          )}
                        </button>
                      </td>
                      <td style={{ color: '#94a3b8', fontSize: 11.5 }}>
                        {acc.created_at
                          ? new Date(acc.created_at).toLocaleString()
                          : '—'}
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="mailtm-row-actions">
                          <button
                            type="button"
                            className="mailtm-btn-pages"
                            onClick={() => startLoginSyncPippit(acc)}
                            title="Đăng nhập Pure HTTP và kéo toàn bộ Real Facebook Pages của tài khoản này"
                          >
                            <Bot size={12} /> Đăng nhập &amp; Kéo Pages
                          </button>
                          <button
                            type="button"
                            className="mailtm-btn-inbox"
                            onClick={() => openInbox(acc)}
                          >
                            <Inbox size={12} /> Hòm thư / OTP
                          </button>
                          <button
                            type="button"
                            className="mailtm-btn-del"
                            onClick={() => handleDelete(acc)}
                            title="Xóa tài khoản"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* Pippit Login & Sync Modal */}
      {syncModal.open && (
        <div
          className="mtm-modal-backdrop"
          onClick={() => setSyncModal({ ...syncModal, open: false })}
        >
          <div
            className="mtm-modal-card"
            style={{ maxWidth: 540 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="mtm-modal-hdr">
              <div>
                <h3>Đồng Bộ Pippit Pure HTTP (Không Cần Trình Duyệt)</h3>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Tài khoản: {syncModal.account?.address}
                </span>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setSyncModal({ ...syncModal, open: false })}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mtm-modal-body" style={{ padding: '24px 22px' }}>
              <div className="pip-progress-box">
                <div
                  className={`pip-progress-step ${
                    syncModal.step !== 'idle' ? 'done' : ''
                  }`}
                >
                  <span className="pip-step-icon">1</span>
                  <span>
                    Đăng nhập qua Passport XOR 0x05 & cấp Session Cookies
                  </span>
                </div>
                <div
                  className={`pip-progress-step ${
                    syncModal.step === 'running'
                      ? 'active'
                      : syncModal.step === 'done'
                      ? 'done'
                      : ''
                  }`}
                >
                  <span className="pip-step-icon">
                    {syncModal.step === 'running' ? (
                      <Loader2 size={14} className="spin" />
                    ) : (
                      '2'
                    )}
                  </span>
                  <span>Trích xuất Workspace ID từ bootstrap HTML</span>
                </div>
                <div
                  className={`pip-progress-step ${
                    syncModal.step === 'done' ? 'done' : ''
                  }`}
                >
                  <span className="pip-step-icon">3</span>
                  <span>
                    Kéo danh sách Real Facebook Pages (platform_type=301)
                  </span>
                </div>
              </div>

              <p
                className="settings-message"
                style={{
                  color: syncModal.step === 'error' ? '#dc2626' : '#059669',
                  fontWeight: 600,
                  margin: '8px 0',
                }}
              >
                {syncModal.message}
              </p>

              {syncModal.step === 'done' && (
                <button
                  type="button"
                  className="primary-button"
                  style={{ alignSelf: 'flex-end', marginTop: 14 }}
                  onClick={() => setSyncModal({ ...syncModal, open: false })}
                >
                  <Check size={16} /> Đóng & Xem danh sách Pages
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Inbox Modal */}
      {inboxAccount && (
        <div
          className="mtm-modal-backdrop"
          onClick={() => setInboxAccount(null)}
        >
          <div className="mtm-modal-card" onClick={e => e.stopPropagation()}>
            <div className="mtm-modal-hdr">
              <div>
                <h3>Hộp thư: {inboxAccount.address}</h3>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Đọc email tự động và nhận mã kích hoạt OTP
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => openInbox(inboxAccount)}
                  disabled={inboxLoading}
                  title="Làm mới hộp thư"
                >
                  <RefreshCw
                    size={15}
                    className={inboxLoading ? 'spin' : ''}
                  />
                </button>
                <button
                  type="button"
                  className="icon-button"
                  onClick={() => setInboxAccount(null)}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="mtm-modal-body">
              {inboxLoading ? (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 10,
                    padding: 30,
                    color: '#64748b',
                  }}
                >
                  <Loader2
                    size={24}
                    className="spin"
                    style={{ color: '#4f46e5' }}
                  />
                  <span style={{ fontSize: 13 }}>Đang kiểm tra hộp thư...</span>
                </div>
              ) : messages.length === 0 ? (
                <div
                  style={{
                    padding: 40,
                    textAlign: 'center',
                    color: '#94a3b8',
                  }}
                >
                  <Inbox
                    size={36}
                    style={{ marginBottom: 8, opacity: 0.5 }}
                  />
                  <p
                    style={{
                      margin: 0,
                      fontSize: 14,
                      fontWeight: 600,
                      color: '#475569',
                    }}
                  >
                    Hộp thư đang trống
                  </p>
                  <span style={{ fontSize: 12 }}>
                    Chưa có email nào được gửi tới địa chỉ này. Hãy gửi thử hoặc
                    bấm làm mới.
                  </span>
                </div>
              ) : (
                messages.map(m => (
                  <div
                    key={m.id}
                    className={`mtm-msg-card ${
                      selectedMsg?.id === m.id ? 'active' : ''
                    }`}
                    onClick={() => openMsgDetail(m.id)}
                  >
                    <div className="mtm-msg-top">
                      <span className="mtm-msg-from">
                        {m.from_name || m.from_addr}
                      </span>
                      <span className="mtm-msg-time">
                        {new Date(m.created_at).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="mtm-msg-subject">
                      {m.subject || '(Không có tiêu đề)'}
                    </div>
                    <div className="mtm-msg-intro">{m.intro}</div>

                    {m.otp_code && (
                      <div
                        className="mtm-otp-banner"
                        onClick={e => {
                          e.stopPropagation()
                          copyText(m.otp_code!, `otp_${m.id}`)
                        }}
                      >
                        <span>Mã xác nhận phát hiện:</span>
                        <span className="mtm-otp-code">{m.otp_code}</span>
                        {copiedKey === `otp_${m.id}` ? (
                          <Check size={13} />
                        ) : (
                          <Copy size={13} />
                        )}
                      </div>
                    )}

                    {selectedMsg?.id === m.id && (
                      <div
                        style={{
                          marginTop: 14,
                          paddingTop: 14,
                          borderTop: '1px dashed #cbd5e1',
                          fontSize: 12.5,
                          color: '#334155',
                          lineHeight: 1.6,
                        }}
                      >
                        {msgLoading ? (
                          <div
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 6,
                              color: '#64748b',
                            }}
                          >
                            <Loader2 size={14} className="spin" /> Đang tải
                            nội dung...
                          </div>
                        ) : selectedMsg.text ? (
                          <pre
                            style={{
                              whiteSpace: 'pre-wrap',
                              fontFamily: 'inherit',
                              margin: 0,
                              background: '#f8fafc',
                              padding: 12,
                              borderRadius: 8,
                            }}
                          >
                            {selectedMsg.text}
                          </pre>
                        ) : (
                          <div>{selectedMsg.intro}</div>
                        )}
                      </div>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
