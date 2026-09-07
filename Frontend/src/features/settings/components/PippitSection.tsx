import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  Loader2,
  Music,
  Plus,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  Video,
  X,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { PippitAccount, PippitTask } from '../types'

function FacebookIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function TikTokIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5 20.1a6.34 6.34 0 0 0 10.86-4.43v-7a8.16 8.16 0 0 0 4.77 1.52v-3.4a4.85 4.85 0 0 1-1.04-.1z" />
    </svg>
  )
}

export function PippitSection() {
  const [accounts, setAccounts] = useState<PippitAccount[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  // Search & Pagination
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize, setPageSize] = useState(5)

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
    setMessage(`Đang quét lại các kênh liên kết cho ${acc.email}...`)
    try {
      const res = await fetch(
        `${API_URL}/api/pippit/accounts/${acc.id}/refresh-pages`,
        {
          method: 'POST',
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Quét kênh liên kết thất bại')
      await loadPippitAccounts()
      const fbCount = (data.facebook_pages || []).filter(
        (p: any) => p.page_id
      ).length
      const ttCount = (data.tiktok_channels || []).filter(
        (t: any) => t.channel_id
      ).length
      const total = fbCount + ttCount
      setMessage(
        `Đã quét xong: Tìm thấy ${fbCount} Facebook Pages và ${ttCount} TikTok (${total}/3 kênh) cho ${acc.email}.`
      )
    } catch (err: any) {
      setMessage(err.message || 'Lỗi quét lại kênh liên kết')
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

  const filteredAccounts = useMemo(() => {
    if (!searchQuery.trim()) return accounts
    const q = searchQuery.trim().toLowerCase()
    return accounts.filter(acc => {
      const emailMatch = acc.email?.toLowerCase().includes(q)
      const wsMatch = acc.workspace_id?.toLowerCase().includes(q)
      const pageMatch = acc.facebook_pages?.some(
        p => p.page_name?.toLowerCase().includes(q) || p.page_id?.includes(q)
      )
      const ttMatch = acc.tiktok_channels?.some(
        t => t.nickname?.toLowerCase().includes(q) || t.channel_id?.includes(q)
      )
      return Boolean(emailMatch || wsMatch || pageMatch || ttMatch)
    })
  }, [accounts, searchQuery])

  const totalItems = filteredAccounts.length
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize))
  const safePage = Math.min(currentPage, totalPages)
  const startIndex = (safePage - 1) * pageSize
  const paginatedAccounts = filteredAccounts.slice(startIndex, startIndex + pageSize)

  return (
    <div className="mailtm-container">
      <div className="mailtm-card">
        <div className="mailtm-card-header">
          <div className="gemini-card-title-group">
            <div className="gemini-badge-icon">
              <Bot size={17} />
            </div>
            <div>
              <h3 className="gemini-title">Pippit AI (Quản lý tài khoản &amp; Real Facebook Pages)</h3>
              <p className="gemini-subtitle">
                Sử dụng Pure HTTP Reverse-Engineered REST API để đăng nhập, kéo Facebook Pages thật và lên lịch video.
              </p>
            </div>
          </div>
        </div>

        <div className="mailtm-card-body">
          <div
            className="mailtm-table-header"
            style={{ borderTop: 'none', margin: '0 0 12px', paddingTop: 0 }}
          >
            <div className="mailtm-table-title">
              <span>Danh sách tài khoản Pippit</span>
              <span className="mailtm-count-badge">{filteredAccounts.length}</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div className="pip-search-wrap">
                <Search size={12} className="pip-search-icon" />
                <input
                  className="pip-search-input"
                  placeholder="Tìm email, Page..."
                  value={searchQuery}
                  onChange={e => {
                    setSearchQuery(e.target.value)
                    setCurrentPage(1)
                  }}
                />
              </div>
              <button
                type="button"
                className="mailtm-btn-refresh"
                onClick={() => setShowAddForm(!showAddForm)}
              >
                <Plus size={12} /> {showAddForm ? 'Đóng form' : 'Thêm tài khoản'}
              </button>
              <button
                type="button"
                className="mailtm-btn-refresh"
                onClick={loadPippitAccounts}
              >
                <RefreshCw size={12} /> Làm mới
              </button>
            </div>
          </div>

          {showAddForm && (
            <form
              onSubmit={handleAddAccount}
              style={{
                background: '#f8fafc',
                padding: 14,
                borderRadius: 10,
                border: '1px solid #e2e8f0',
                marginBottom: 14,
              }}
            >
              <div className="mailtm-form-grid">
                <div className="mailtm-field">
                  <label className="mailtm-label">Email Pippit</label>
                  <input
                    className="mailtm-input"
                    value={addEmail}
                    onChange={e => setAddEmail(e.target.value)}
                    placeholder="vd: user@domain.com"
                    disabled={loading}
                  />
                </div>
                <div className="mailtm-field">
                  <label className="mailtm-label">Mật khẩu</label>
                  <input
                    className="mailtm-input"
                    type="password"
                    value={addPassword}
                    onChange={e => setAddPassword(e.target.value)}
                    placeholder="Mật khẩu..."
                    disabled={loading}
                  />
                </div>
                <div className="mailtm-field">
                  <label className="mailtm-label">
                    Proxy riêng <span>(tùy chọn: host:port)</span>
                  </label>
                  <input
                    className="mailtm-input"
                    value={addProxy}
                    onChange={e => setAddProxy(e.target.value)}
                    placeholder="user:pass@host:port"
                    disabled={loading}
                  />
                </div>
              </div>
              <div className="mailtm-actions">
                <button
                  type="submit"
                  className="mailtm-btn-primary"
                  disabled={loading}
                >
                  {loading ? (
                    <Loader2 size={14} className="spin" />
                  ) : (
                    <Bot size={14} />
                  )}{' '}
                  Đăng nhập Pure HTTP &amp; Kéo Pages
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
                borderRadius: 8,
                border: '1px dashed #e2e8f0',
                color: '#94a3b8',
                fontSize: 12,
              }}
            >
              Chưa có tài khoản Pippit nào. Hãy bấm{' '}
              <strong>“Đăng nhập &amp; Kéo Pages”</strong> trên bảng Mail.tm ở trên hoặc
              bấm <strong>“Thêm tài khoản”</strong> để bắt đầu!
            </div>
          ) : filteredAccounts.length === 0 ? (
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
              Không tìm thấy tài khoản nào khớp với từ khóa tìm kiếm "{searchQuery}".
            </div>
          ) : (
            <>
              <div className="pip-acc-grid">
                {paginatedAccounts.map(acc => {
                  const connectedFb = (acc.facebook_pages || []).filter(p => p.page_id)
                  const connectedTt = (acc.tiktok_channels || []).filter(t => t.channel_id)
                  const totalConnected = connectedFb.length + connectedTt.length
                  const remainingSlots = Math.max(0, 3 - totalConnected)

                  return (
                    <div key={acc.id} className="pip-acc-card">
                      <div className="pip-acc-top">
                        <div className="pip-acc-meta">
                          <span className="pip-email-title">
                            <Bot size={15} style={{ color: '#4f46e5' }} /> {acc.email}
                          </span>
                          <span className="pip-status-pill">
                            <span className="pip-status-dot" /> {acc.status}
                          </span>
                          {acc.workspace_id && (
                            <span className="pip-badge-meta">
                              ws: {acc.workspace_id}
                            </span>
                          )}
                          {acc.proxy && (
                            <span className="pip-badge-meta">
                              proxy: {acc.proxy.split('@').pop()}
                            </span>
                          )}
                          <span
                            className={`pip-quota-badge ${
                              totalConnected >= 3
                                ? 'max'
                                : totalConnected > 0
                                ? 'active'
                                : 'empty'
                            }`}
                            title="Mỗi tài khoản Pippit hỗ trợ tối đa 3 kênh liên kết tổng cộng (Facebook Pages, TikTok, Instagram)"
                          >
                            <Share2 size={11} /> {totalConnected}/3 Kênh
                            {totalConnected >= 3 ? ' (Tối đa)' : ''}
                          </span>
                        </div>

                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <button
                            type="button"
                            className="mailtm-btn-refresh"
                            onClick={() => handleRefreshPages(acc)}
                            disabled={loading}
                            title="Quét lại các kênh Facebook Pages &amp; TikTok từ Pippit"
                          >
                            <RefreshCw size={11} className={loading ? 'spin' : ''} />{' '}
                            Quét lại kênh
                          </button>
                          <button
                            type="button"
                            className="mailtm-btn-refresh"
                            onClick={() => handleViewTasks(acc)}
                            title="Xem lịch bài đăng của tài khoản này"
                          >
                            <Clock3 size={11} /> Lịch đăng ({connectedFb.length})
                          </button>
                          <button
                            type="button"
                            className="mailtm-btn-del"
                            onClick={() => handleDeletePippit(acc)}
                            title="Xóa tài khoản Pippit"
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>

                      {/* Connected Channels: Minimalist cards with Photo Avatars & 3-channel max quota */}
                      {totalConnected === 0 ? (
                        <div className="pip-empty-channels-banner">
                          <span>
                            Chưa liên kết kênh nào · Hỗ trợ tối đa 3 kênh (Facebook Pages, TikTok, Instagram)
                          </span>
                          <span className="pip-slots-remaining">Còn trống 3 slot</span>
                        </div>
                      ) : (
                        <div className="pip-channels-wrap">
                          {/* Facebook Pages with Photo */}
                          {connectedFb.map((fb, idx) => (
                            <div key={`fb-${fb.page_id || idx}`} className="pip-channel-card">
                              <div className="pip-channel-avatar-wrap">
                                {fb.avatar_url ? (
                                  <img
                                    src={fb.avatar_url}
                                    alt=""
                                    className="pip-channel-avatar"
                                  />
                                ) : (
                                  <div className="pip-channel-avatar-placeholder fb">
                                    <FacebookIcon size={12} />
                                  </div>
                                )}
                                <span className="pip-platform-badge fb" title="Facebook Fanpage">
                                  <FacebookIcon size={7} />
                                </span>
                              </div>
                              <div className="pip-channel-info">
                                <span className="pip-channel-name" title={fb.page_name}>
                                  {fb.page_name}
                                </span>
                                <span className="pip-channel-sub">ID: {fb.page_id}</span>
                              </div>
                              <span
                                className={`pip-channel-status ${
                                  fb.un_expired ? 'ready' : 'warn'
                                }`}
                                title={fb.un_expired ? 'Sẵn sàng đăng bài' : 'Cần cấp quyền'}
                              >
                                {fb.un_expired ? 'Sẵn sàng' : 'Cần cấp quyền'}
                              </span>
                            </div>
                          ))}

                          {/* TikTok Channels with Photo */}
                          {connectedTt.map((tt, idx) => (
                            <div key={`tt-${tt.channel_id || idx}`} className="pip-channel-card">
                              <div className="pip-channel-avatar-wrap">
                                {tt.avatar_url ? (
                                  <img
                                    src={tt.avatar_url}
                                    alt=""
                                    className="pip-channel-avatar"
                                  />
                                ) : (
                                  <div className="pip-channel-avatar-placeholder tt">
                                    <TikTokIcon size={12} />
                                  </div>
                                )}
                                <span className="pip-platform-badge tt" title="TikTok Channel">
                                  <TikTokIcon size={7} />
                                </span>
                              </div>
                              <div className="pip-channel-info">
                                <span className="pip-channel-name" title={tt.nickname}>
                                  {tt.nickname}{' '}
                                  {tt.handle && (
                                    <small className="pip-channel-handle">@{tt.handle}</small>
                                  )}
                                </span>
                                <span className="pip-channel-sub">ID: {tt.channel_id}</span>
                              </div>
                              <span
                                className={`pip-channel-status ${
                                  tt.un_expired ? 'ready' : 'warn'
                                }`}
                                title={
                                  tt.un_expired ? 'Sẵn sàng đăng video' : 'Hết hạn ủy quyền'
                                }
                              >
                                {tt.un_expired ? 'Sẵn sàng' : 'Hết hạn'}
                              </span>
                            </div>
                          ))}

                          {/* Empty slot indicator if < 3 channels */}
                          {remainingSlots > 0 && (
                            <div
                              className="pip-channel-card empty-slot"
                              title={`Tài khoản này còn có thể liên kết thêm ${remainingSlots} kênh nữa (tối đa 3 kênh / tài khoản Pippit)`}
                            >
                              <Plus size={12} />
                              <span>Còn {remainingSlots} slot trống</span>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {/* Pagination Controls */}
              {totalItems > 0 && (
                <div className="pip-pagination-bar">
                  <div className="pip-pagination-info">
                    Hiển thị <strong>{startIndex + 1}</strong> -{' '}
                    <strong>{Math.min(startIndex + pageSize, totalItems)}</strong>{' '}
                    trên <strong>{totalItems}</strong> tài khoản
                  </div>
                  <div className="pip-pagination-controls">
                    <button
                      type="button"
                      className="pip-page-btn"
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={safePage <= 1}
                      title="Trang trước"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(
                        p =>
                          p === 1 ||
                          p === totalPages ||
                          Math.abs(p - safePage) <= 1
                      )
                      .map((p, idx, arr) => {
                        const prev = arr[idx - 1]
                        const showEllipsis = prev && p - prev > 1
                        return (
                          <span
                            key={p}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                            }}
                          >
                            {showEllipsis && (
                              <span
                                style={{
                                  padding: '0 4px',
                                  color: '#94a3b8',
                                }}
                              >
                                …
                              </span>
                            )}
                            <button
                              type="button"
                              className={`pip-page-btn ${
                                p === safePage ? 'active' : ''
                              }`}
                              onClick={() => setCurrentPage(p)}
                            >
                              {p}
                            </button>
                          </span>
                        )
                      })}
                    <button
                      type="button"
                      className="pip-page-btn"
                      onClick={() =>
                        setCurrentPage(p => Math.min(totalPages, p + 1))
                      }
                      disabled={safePage >= totalPages}
                      title="Trang sau"
                    >
                      <ChevronRight size={14} />
                    </button>
                    <select
                      className="pip-page-select"
                      value={pageSize}
                      onChange={e => {
                        setPageSize(Number(e.target.value))
                        setCurrentPage(1)
                      }}
                      title="Số tài khoản trên mỗi trang"
                    >
                      <option value={5}>5 / trang</option>
                      <option value={10}>10 / trang</option>
                      <option value={20}>20 / trang</option>
                      <option value={50}>50 / trang</option>
                    </select>
                  </div>
                </div>
              )}
            </>
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
                fontSize: 12.5,
              }}
            >
              <CheckCircle2 size={14} /> {message}
            </p>
          )}
        </div>
      </div>

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
