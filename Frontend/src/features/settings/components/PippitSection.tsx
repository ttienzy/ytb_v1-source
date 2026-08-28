import { useCallback, useEffect, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  Clock3,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Share2,
  Trash2,
  X,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { PippitAccount, PippitTask } from '../types'

export function PippitSection() {
  const [accounts, setAccounts] = useState<PippitAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // Add account form
  const [showAddForm, setShowAddForm] = useState(false)
  const [addEmail, setAddEmail] = useState('')
  const [addPassword, setAddPassword] = useState('')
  const [addProxy, setAddProxy] = useState('')

  // Task list modal
  const [viewTasksAcc, setViewTasksAcc] = useState<PippitAccount | null>(null)
  const [tasks, setTasks] = useState<PippitTask[]>([])
  const [tasksLoading, setTasksLoading] = useState(false)

  const loadPippitAccounts = useCallback(async () => {
    try {
      const res = await fetch(`${API_URL}/api/pippit/accounts`)
      if (!res.ok) throw new Error()
      const data: PippitAccount[] = await res.json()
      setAccounts(data)
    } catch {
      // ignore
    }
  }, [])

  useEffect(() => {
    loadPippitAccounts()
  }, [loadPippitAccounts])

  async function handleAddAccount(e: React.FormEvent) {
    e.preventDefault()
    if (!addEmail.trim() || !addPassword.trim()) {
      setMessage('Vui lòng nhập đầy đủ Email và Mật khẩu.')
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const res = await fetch(`${API_URL}/api/pippit/accounts/login-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: addEmail.trim(),
          password: addPassword.trim(),
          proxy: addProxy.trim(),
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Đăng nhập Pippit thất bại')
      await loadPippitAccounts()
      setShowAddForm(false)
      setAddEmail('')
      setAddPassword('')
      setAddProxy('')
      setMessage(`Đã đăng nhập thành công cho ${data.email}!`)
    } catch (err: any) {
      setMessage(err.message || 'Lỗi đăng nhập tài khoản')
    } finally {
      setLoading(false)
    }
  }

  async function handleRefreshPages(acc: PippitAccount) {
    setLoading(true)
    setMessage(`Đang quét lại Real Pages cho ${acc.email}...`)
    try {
      const res = await fetch(
        `${API_URL}/api/pippit/accounts/${acc.id}/refresh-pages`,
        {
          method: 'POST',
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Quét Pages thất bại')
      await loadPippitAccounts()
      const count = (data.facebook_pages || []).filter(
        (p: any) => p.page_id
      ).length
      setMessage(
        `Đã quét xong: Tìm thấy ${count} Real Facebook Pages cho ${acc.email}.`
      )
    } catch (err: any) {
      setMessage(err.message || 'Lỗi quét lại Fanpages')
    } finally {
      setLoading(false)
    }
  }

  async function handleViewTasks(acc: PippitAccount) {
    setViewTasksAcc(acc)
    setTasksLoading(true)
    try {
      const res = await fetch(`${API_URL}/api/pippit/accounts/${acc.id}/tasks`)
      if (!res.ok) throw new Error()
      const data = await res.json()
      setTasks(Array.isArray(data) ? data : [])
    } catch {
      setTasks([])
    } finally {
      setTasksLoading(false)
    }
  }

  async function handleDeletePippit(acc: PippitAccount) {
    if (!confirm(`Bạn có chắc muốn xóa tài khoản Pippit ${acc.email}?`)) return
    try {
      const res = await fetch(`${API_URL}/api/pippit/accounts/${acc.id}`, {
        method: 'DELETE',
      })
      if (res.ok) {
        setAccounts(prev => prev.filter(a => a.id !== acc.id))
      }
    } catch {
      // ignore
    }
  }

  return (
    <div className="settings-card">
      <div className="integration-title">
        <div
          className="gemini-icon"
          style={{ background: '#ecfdf5', color: '#059669' }}
        >
          <Bot size={18} />
        </div>
        <div>
          <h2>Pippit AI (Quản lý tài khoản & Real Facebook Pages)</h2>
          <p>
            Sử dụng Pure HTTP Reverse-Engineered REST API để đăng nhập, kéo
            Facebook Pages thật và lên lịch video.
          </p>
        </div>
      </div>

      <div
        className="mtm-section-hdr"
        style={{ borderTop: 'none', margin: '0 0 14px', paddingTop: 0 }}
      >
        <span className="mtm-section-title">
          Danh sách tài khoản Pippit{' '}
          <span className="mtm-badge">{accounts.length}</span>
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button
            type="button"
            className="chrome-button"
            style={{ minHeight: 32, padding: '0 10px', fontSize: 11 }}
            onClick={() => setShowAddForm(!showAddForm)}
          >
            <Plus size={13} /> {showAddForm ? 'Đóng form' : 'Thêm tài khoản'}
          </button>
          <button
            type="button"
            className="chrome-button"
            style={{ minHeight: 32, padding: '0 10px', fontSize: 11 }}
            onClick={loadPippitAccounts}
          >
            <RefreshCw size={13} /> Làm mới
          </button>
        </div>
      </div>

      {showAddForm && (
        <form
          onSubmit={handleAddAccount}
          style={{
            background: '#f8fafc',
            padding: 16,
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            marginBottom: 16,
          }}
        >
          <div className="mtm-form-grid">
            <div>
              <label>Email Pippit</label>
              <input
                value={addEmail}
                onChange={e => setAddEmail(e.target.value)}
                placeholder="vd: user@domain.com"
                disabled={loading}
              />
            </div>
            <div>
              <label>Mật khẩu</label>
              <input
                type="password"
                value={addPassword}
                onChange={e => setAddPassword(e.target.value)}
                placeholder="Mật khẩu..."
                disabled={loading}
              />
            </div>
            <div>
              <label>
                Proxy riêng <span>(tùy chọn: host:port)</span>
              </label>
              <input
                value={addProxy}
                onChange={e => setAddProxy(e.target.value)}
                placeholder="user:pass@host:port"
                disabled={loading}
              />
            </div>
          </div>
          <div className="settings-actions">
            <button
              type="submit"
              className="primary-button"
              disabled={loading}
            >
              {loading ? (
                <Loader2 size={15} className="spin" />
              ) : (
                <Bot size={15} />
              )}{' '}
              Đăng nhập Pure HTTP & Kéo Pages
            </button>
          </div>
        </form>
      )}

      {accounts.length === 0 ? (
        <div
          style={{
            padding: '24px 16px',
            textAlign: 'center',
            background: '#f8fafc',
            borderRadius: 10,
            border: '1px dashed #e2e8f0',
            color: '#94a3b8',
            fontSize: 12,
          }}
        >
          Chưa có tài khoản Pippit nào. Hãy bấm{' '}
          <strong>“Đăng nhập & Kéo Pages”</strong> trên bảng Mail.tm ở trên hoặc
          bấm <strong>“Thêm tài khoản”</strong> để bắt đầu!
        </div>
      ) : (
        <div className="pip-acc-grid">
          {accounts.map(acc => (
            <div key={acc.id} className="pip-acc-card">
              <div className="pip-acc-top">
                <div className="pip-acc-meta">
                  <span className="pip-email-title">
                    <Bot size={16} style={{ color: '#059669' }} /> {acc.email}
                  </span>
                  <span
                    className="cookie-status"
                    style={{ padding: '3px 8px', fontSize: 11 }}
                  >
                    <CheckCircle2 size={12} /> {acc.status}
                  </span>
                  {acc.workspace_id && (
                    <span
                      className="mtm-badge"
                      style={{ background: '#f1f5f9', color: '#475569' }}
                    >
                      ws: {acc.workspace_id}
                    </span>
                  )}
                  {acc.proxy && (
                    <span
                      className="mtm-badge"
                      style={{ background: '#fef3c7', color: '#b45309' }}
                    >
                      proxy: {acc.proxy.split('@').pop()}
                    </span>
                  )}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <button
                    type="button"
                    className="chrome-button"
                    style={{ minHeight: 28, padding: '0 9px', fontSize: 11 }}
                    onClick={() => handleRefreshPages(acc)}
                    disabled={loading}
                    title="Quét lại Real Facebook Pages từ Pippit"
                  >
                    <RefreshCw size={12} className={loading ? 'spin' : ''} />{' '}
                    Quét lại Pages
                  </button>
                  <button
                    type="button"
                    className="chrome-button"
                    style={{ minHeight: 28, padding: '0 9px', fontSize: 11 }}
                    onClick={() => handleViewTasks(acc)}
                    title="Xem lịch bài đăng trên Facebook"
                  >
                    <Clock3 size={12} /> Lịch đăng (
                    {acc.facebook_pages?.filter(p => p.page_id).length || 0}{' '}
                    Pages)
                  </button>
                  <button
                    type="button"
                    className="mtm-btn-del"
                    onClick={() => handleDeletePippit(acc)}
                    title="Xóa tài khoản Pippit"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {/* 3 Real Facebook Pages Management */}
              <div className="pip-fb-container">
                <div className="pip-fb-hdr">
                  <span className="pip-fb-title">
                    <Share2 size={13} style={{ color: '#3b82f6' }} /> 3 Real
                    Facebook Pages (platform_type=301)
                  </span>
                </div>

                <div className="pip-fb-slots">
                  {[0, 1, 2].map(idx => {
                    const slot = acc.facebook_pages?.[idx]
                    const isConn = Boolean(slot?.page_id)
                    return (
                      <div
                        key={idx}
                        className={`pip-slot-card ${
                          isConn ? 'connected' : ''
                        }`}
                      >
                        <span className="pip-slot-num">{idx + 1}</span>
                        <div className="pip-slot-info">
                          <strong>
                            {slot?.page_name ||
                              `Slot ${idx + 1} (Chưa gán Page)`}
                          </strong>
                          <span>
                            {slot?.page_id
                              ? `ID: ${slot.page_id}`
                              : 'Chưa có Page liên kết'}
                          </span>
                        </div>
                        {isConn && (
                          <span
                            style={{
                              fontSize: 10,
                              fontWeight: 700,
                              color: slot?.un_expired
                                ? '#16a34a'
                                : '#d97706',
                              background: slot?.un_expired
                                ? '#dcfce7'
                                : '#fef3c7',
                              padding: '2px 6px',
                              borderRadius: 6,
                            }}
                          >
                            {slot?.un_expired
                              ? 'Sẵn sàng'
                              : 'Cần cấp quyền lại'}
                          </span>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {message && (
        <p
          className="settings-message"
          style={{
            color: '#059669',
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            marginTop: 12,
          }}
        >
          <CheckCircle2 size={15} /> {message}
        </p>
      )}

      {/* View Tasks Modal */}
      {viewTasksAcc && (
        <div
          className="mtm-modal-backdrop"
          onClick={() => setViewTasksAcc(null)}
        >
          <div
            className="mtm-modal-card"
            style={{ maxWidth: 640 }}
            onClick={e => e.stopPropagation()}
          >
            <div className="mtm-modal-hdr">
              <div>
                <h3>Lịch bài đăng Pippit (Facebook)</h3>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  Tài khoản: {viewTasksAcc.email}
                </span>
              </div>
              <button
                type="button"
                className="icon-button"
                onClick={() => setViewTasksAcc(null)}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mtm-modal-body" style={{ padding: 18 }}>
              {tasksLoading ? (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: 30,
                    color: '#64748b',
                  }}
                >
                  <Loader2 size={20} className="spin" /> Đang tải danh sách bài
                  đăng...
                </div>
              ) : tasks.length === 0 ? (
                <div
                  style={{
                    padding: 30,
                    textAlign: 'center',
                    color: '#94a3b8',
                    fontSize: 13,
                  }}
                >
                  Chưa có bài đăng nào được lên lịch qua tài khoản này.
                </div>
              ) : (
                <div
                  style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
                >
                  {tasks.map((t, i) => (
                    <div
                      key={t.task_id || i}
                      style={{
                        padding: 12,
                        background: '#f8fafc',
                        borderRadius: 10,
                        border: '1px solid #e2e8f0',
                        fontSize: 12.5,
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          justifyContent: 'space-between',
                          alignItems: 'center',
                          marginBottom: 6,
                        }}
                      >
                        <strong>
                          {t.page_name || `Page ID: ${t.page_id}`}
                        </strong>
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: t.published ? '#16a34a' : '#4f46e5',
                          }}
                        >
                          {t.published ? 'ĐÃ ĐĂNG' : 'ĐANG HẸN GIỜ'}
                        </span>
                      </div>
                      <div style={{ color: '#475569', marginBottom: 4 }}>
                        {t.description || t.title || '(Không có nội dung)'}
                      </div>
                      {t.post_url && (
                        <a
                          href={t.post_url}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            color: '#2563eb',
                            fontSize: 11.5,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <ExternalLink size={12} /> Xem bài đăng Facebook
                        </a>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
