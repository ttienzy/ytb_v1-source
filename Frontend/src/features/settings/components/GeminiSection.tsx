import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowDownCircle,
  CheckCircle2,
  ExternalLink,
  Film,
  HelpCircle,
  Info,
  KeyRound,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Trash2,
  Tv,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { GeminiState, YtState } from '../types'

export function ChromeBrandIcon({ size = 15 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <path
        fill="#EA4335"
        d="M12 2C7.03 2 2.9 5.62 2.12 10.37l5.47 3.16c.39-2.6 2.62-4.53 5.41-4.53h9.65C21.46 5.56 17.11 2 12 2z"
      />
      <path
        fill="#FBBC05"
        d="M22.65 11h-9.65c-.56 0-1.1.1-1.6.28l-4.57 7.92A9.97 9.97 0 0 0 12 22c5.03 0 9.24-3.68 9.94-8.54.04-.48.06-.96.06-1.46 0-.34-.02-.67-.05-1z"
      />
      <path
        fill="#34A853"
        d="M12 22c-3.17 0-6-1.48-7.85-3.79l5.46-9.45c-.24.51-.37 1.07-.37 1.66 0 2.22 1.8 4.02 4.02 4.02h.01l-4.56 7.89c1.02.44 2.13.67 3.29.67z"
      />
      <circle fill="#FFFFFF" cx="12" cy="12" r="5" />
      <circle fill="#4285F4" cx="12" cy="12" r="3.7" />
    </svg>
  )
}

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`
}

interface GeminiSectionProps {
  onCookieStatusChange?: (hasCookie: boolean) => void
}

export function GeminiSection({ onCookieStatusChange }: GeminiSectionProps) {
  const [state, setState] = useState<GeminiState>({
    has_cookie: false,
    cookie_count: 0,
    client_context_token: '',
    app_url: 'https://gemini.google.com/app',
  })
  const [cookies, setCookies] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info')

  const [yt, setYt] = useState<YtState>({ logged_in: false, cookie_count: 0 })
  const [ytLoading, setYtLoading] = useState(false)
  const [ytMsg, setYtMsg] = useState('')
  const [ytMsgType, setYtMsgType] = useState<'success' | 'error' | 'info'>('info')

  // Update check states
  const [appVersion, setAppVersion] = useState('v1.0.1')
  const [updateChecking, setUpdateChecking] = useState(false)
  const [updateStatus, setUpdateStatus] = useState<'idle' | 'up_to_date' | 'available' | 'downloading' | 'downloaded'>('idle')
  const [updateInfo, setUpdateInfo] = useState<{
    version?: string
    name?: string
    published_at?: string
    releaseNotes?: string | null
    isDev?: boolean
    html_url?: string
  } | null>(null)
  const [downloadProgress, setDownloadProgress] = useState<{
    percent: number
    bytesPerSecond: number
    transferred: number
    total: number
  }>({ percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 })
  const [updateError, setUpdateError] = useState('')
  const [installing, setInstalling] = useState(false)

  useEffect(() => {
    fetch(`${API_URL}/api/settings/gemini`)
      .then(response => response.json())
      .then(data => {
        setState(data)
        onCookieStatusChange?.(!!data.has_cookie)
      })
      .catch(() => {
        setMessage('Không kết nối được với Backend.')
        setMessageType('error')
      })
  }, [onCookieStatusChange])

  useEffect(() => {
    fetch(`${API_URL}/api/recap/yt/login`)
      .then(r => r.json())
      .then(setYt)
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (window.desktop?.getAppVersion) {
      window.desktop.getAppVersion().then((ver) => {
        if (ver) setAppVersion(ver.startsWith('v') ? ver : `v${ver}`)
      }).catch(() => {})
    }

    if (window.desktop?.onUpdaterStatus) {
      const unsub = window.desktop.onUpdaterStatus((data) => {
        if (data.status === 'checking') {
          setUpdateChecking(true)
          setUpdateError('')
        } else if (data.status === 'available') {
          setUpdateChecking(false)
          setUpdateStatus('available')
          setUpdateInfo({
            version: data.version,
            published_at: data.releaseDate,
            releaseNotes: data.releaseNotes,
            isDev: data.isDev,
          })
        } else if (data.status === 'up_to_date') {
          setUpdateChecking(false)
          setUpdateStatus('up_to_date')
          setUpdateInfo(null)
        } else if (data.status === 'downloading') {
          setUpdateChecking(false)
          setUpdateStatus('downloading')
          setDownloadProgress({
            percent: data.percent ?? 0,
            bytesPerSecond: data.bytesPerSecond ?? 0,
            transferred: data.transferred ?? 0,
            total: data.total ?? 0,
          })
        } else if (data.status === 'downloaded') {
          setUpdateChecking(false)
          setUpdateStatus('downloaded')
        } else if (data.status === 'error') {
          setUpdateChecking(false)
          setUpdateError(data.message || 'Lỗi cập nhật')
        }
      })
      return unsub
    }
  }, [])

  async function save() {
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch(`${API_URL}/api/settings/gemini`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookies,
          client_context_token: state.client_context_token,
          app_url: state.app_url,
        }),
      })
      if (!response.ok) throw new Error()
      const next = await response.json()
      setState(prev => ({
        ...prev,
        has_cookie: next.has_cookie,
        cookie_count: next.cookie_count ?? prev.cookie_count,
      }))
      onCookieStatusChange?.(!!next.has_cookie)
      setCookies('')
      setMessage('Đã lưu cấu hình Gemini thành công.')
      setMessageType('success')
    } catch {
      setMessage('Lưu cấu hình thất bại.')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  async function loginChrome() {
    setLoading(true)
    setMessage('Đang khởi động Chrome. Vui lòng đăng nhập Google một lần...')
    setMessageType('info')
    try {
      const response = await fetch(`${API_URL}/api/settings/gemini/login`, {
        method: 'POST',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Đăng nhập thất bại')
      setState(prev => ({
        ...prev,
        has_cookie: true,
        cookie_count: result.cookie_count,
      }))
      onCookieStatusChange?.(true)
      setMessage('Đã đăng nhập và tự động lưu cookie Gemini thành công!')
      setMessageType('success')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Đăng nhập thất bại.')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  async function resetGeminiCookie() {
    if (!window.confirm('Xóa cookie Gemini đã lưu? Bạn sẽ cần đăng nhập lại trước khi chạy Gemini.')) {
      return
    }
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch(`${API_URL}/api/settings/gemini`, {
        method: 'DELETE',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Xóa cookie Gemini thất bại.')
      setState(prev => ({ ...prev, has_cookie: false, cookie_count: 0, saved_at: undefined }))
      setCookies('')
      onCookieStatusChange?.(false)
      setMessage('Đã xóa cookie Gemini. Profile Chrome và template vẫn được giữ lại.')
      setMessageType('success')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Xóa cookie Gemini thất bại.')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  async function loginYt() {
    setYtLoading(true)
    setYtMsg('Đang mở Chrome tới YouTube. Vui lòng đăng nhập Google...')
    setYtMsgType('info')
    try {
      const response = await fetch(`${API_URL}/api/recap/yt/login`, {
        method: 'POST',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Đăng nhập thất bại')
      setYt({ logged_in: true, cookie_count: result.cookie_count })
      setYtMsg('Đã đăng nhập YouTube — cookies đã lưu để yt-dlp fallback khi bị bot-wall.')
      setYtMsgType('success')
    } catch (error) {
      setYtMsg(error instanceof Error ? error.message : 'Đăng nhập thất bại.')
      setYtMsgType('error')
    } finally {
      setYtLoading(false)
    }
  }

  async function resetYtCookie() {
    if (!window.confirm('Xóa cookie YouTube dự phòng đã lưu cho yt-dlp?')) {
      return
    }
    setYtLoading(true)
    setYtMsg('')
    try {
      const response = await fetch(`${API_URL}/api/recap/yt/login`, {
        method: 'DELETE',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Xóa cookie YouTube thất bại.')
      setYt({ logged_in: false, cookie_count: 0, saved_at: null })
      setYtMsg('Đã xóa cookie YouTube dự phòng. yt-dlp sẽ tiếp tục chạy không cookie.')
      setYtMsgType('success')
    } catch (error) {
      setYtMsg(error instanceof Error ? error.message : 'Xóa cookie YouTube thất bại.')
      setYtMsgType('error')
    } finally {
      setYtLoading(false)
    }
  }

  async function checkUpdates() {
    setUpdateChecking(true)
    setUpdateStatus('idle')
    setUpdateInfo(null)
    setUpdateError('')

    if (window.desktop?.checkForUpdates) {
      try {
        const res = await window.desktop.checkForUpdates()
        if (res.status === 'up_to_date') {
          setUpdateStatus('up_to_date')
        } else if (res.status === 'available') {
          setUpdateStatus('available')
          setUpdateInfo({
            version: res.version,
            published_at: res.releaseDate,
            releaseNotes: res.releaseNotes,
            isDev: res.isDev,
          })
        } else if (res.status === 'error') {
          setUpdateError(res.message || 'Không thể kiểm tra cập nhật.')
        }
      } catch (err: any) {
        setUpdateError(err?.message || 'Không thể kiểm tra cập nhật.')
      } finally {
        setUpdateChecking(false)
      }
      return
    }

    try {
      const res = await fetch('https://api.github.com/repos/ttienzy/ytb_v1/releases/latest')
      if (!res.ok) {
        if (res.status === 404) {
          setUpdateStatus('up_to_date')
          return
        }
        throw new Error(`HTTP ${res.status}`)
      }
      const data = await res.json()
      const latestTag = data.tag_name
      if (latestTag && latestTag !== appVersion) {
        setUpdateStatus('available')
        setUpdateInfo({
          version: data.tag_name,
          name: data.name,
          published_at: data.published_at,
          releaseNotes: data.body,
          html_url: data.html_url,
        })
      } else {
        setUpdateStatus('up_to_date')
      }
    } catch {
      setUpdateError('Không thể kiểm tra cập nhật. Vui lòng kiểm tra kết nối Internet.')
    } finally {
      setUpdateChecking(false)
    }
  }

  async function handleDownloadUpdate() {
    setUpdateError('')
    if (updateInfo?.isDev) {
      alert('Bạn đang ở môi trường phát triển (Dev mode). Tính năng tự động tải và cài đặt đè hoạt động trên bản phát hành chính thức (.exe).')
      return
    }

    if (window.desktop?.startDownloadUpdate) {
      setUpdateStatus('downloading')
      setDownloadProgress({ percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 })
      const res = await window.desktop.startDownloadUpdate()
      if (res?.error) {
        setUpdateError(res.error)
        setUpdateStatus('available')
      }
    } else if (updateInfo?.html_url) {
      window.open(updateInfo.html_url, '_blank')
    }
  }

  function handleQuitAndInstall() {
    if (window.desktop?.quitAndInstall) {
      setInstalling(true)
      window.desktop.quitAndInstall()
    }
  }

  return (
    <div className="gemini-settings-container">
      {/* ── CARD 1: GEMINI HIGHLIGHT VIDEO ── */}
      <div className="gemini-card">
        {/* Header with Title and Connection Badge */}
        <div className="gemini-card-header">
          <div className="gemini-card-title-group">
            <div className="gemini-badge-icon">
              <Sparkles size={16} />
            </div>
            <div>
              <h3 className="gemini-title">Gemini (Highlight Video)</h3>
              <p className="gemini-subtitle">
                Kết nối Gemini Web miễn phí bằng session cookie từ gemini.google.com
              </p>
            </div>
          </div>

          <div className="gemini-header-status">
            {state.has_cookie ? (
              <span className="gemini-status-pill connected">
                <span className="status-dot-pulse" />
                <CheckCircle2 size={13} />
                <span>Đã có Cookie</span>
              </span>
            ) : (
              <span className="gemini-status-pill disconnected">
                <span className="status-dot-idle" />
                <span>Chưa có Cookie</span>
              </span>
            )}
          </div>
        </div>

        {/* Form Body */}
        <div className="gemini-card-body">
          {/* Cookie Input Row */}
          <div className="gemini-form-group">
            <div className="gemini-label-row">
              <label className="gemini-field-label">
                Session Cookies
                <span className="gemini-field-sub">
                  {state.has_cookie ? ' (Đã lưu — dán chuỗi mới nếu cần thay đổi)' : ' (Dán cookie từ DevTools)'}
                </span>
              </label>
            </div>
            <textarea
              className="gemini-textarea"
              rows={2}
              value={cookies}
              onChange={e => setCookies(e.target.value)}
              placeholder={
                state.has_cookie
                  ? '•••••••••••••••••••••••••••••••• (Cookie đã được lưu an toàn)'
                  : 'Dán toàn bộ chuỗi cookie của gemini.google.com vào đây...'
              }
            />
          </div>

          {/* Grid inputs for Token and App URL */}
          <div className="gemini-form-grid">
            <div className="gemini-form-group">
              <label className="gemini-field-label">
                Client Context Token
                <span className="gemini-field-sub"> (Chỉ cần khi upload file)</span>
              </label>
              <input
                className="gemini-input"
                value={state.client_context_token}
                onChange={e =>
                  setState(prev => ({ ...prev, client_context_token: e.target.value }))
                }
                placeholder="Lấy từ DevTools Network (không bắt buộc với link YouTube)"
              />
            </div>

            <div className="gemini-form-group">
              <label className="gemini-field-label">
                App URL
                <span className="gemini-field-sub"> (Mặc định)</span>
              </label>
              <input
                className="gemini-input"
                value={state.app_url}
                onChange={e =>
                  setState(prev => ({ ...prev, app_url: e.target.value }))
                }
                placeholder="https://gemini.google.com/app"
              />
            </div>
          </div>

          {/* Action Buttons */}
          <div className="gemini-action-bar">
            <button
              type="button"
              className="btn-gemini-primary"
              onClick={save}
              disabled={loading}
            >
              {loading ? <Loader2 size={14} className="spin-icon" /> : <Save size={14} />}
              <span>Lưu cấu hình</span>
            </button>

            <button
              type="button"
              className="btn-gemini-chrome"
              onClick={loginChrome}
              disabled={loading}
            >
              <ChromeBrandIcon size={15} />
              <span>Đăng nhập Gemini (Chrome)</span>
            </button>

            {state.has_cookie && (
              <button
                type="button"
                className="btn-gemini-danger"
                onClick={resetGeminiCookie}
                disabled={loading}
              >
                <Trash2 size={14} />
                <span>Reset cookie</span>
              </button>
            )}

            {message && (
              <div className={`gemini-inline-message ${messageType}`}>
                {messageType === 'success' && <CheckCircle2 size={14} />}
                {messageType === 'error' && <AlertCircle size={14} />}
                {messageType === 'info' && <Info size={14} />}
                <span>{message}</span>
              </div>
            )}
          </div>

          {/* Instructions Box */}
          <div className="gemini-guide-box">
            <HelpCircle size={15} className="guide-icon" />
            <div className="guide-content">
              <div className="guide-step">
                <strong>Cách 1 (Khuyên dùng):</strong> Nhấn <em>"Đăng nhập Gemini (Chrome)"</em> → Chrome tự mở để đăng nhập 1 lần, tool sẽ tự động thu nạp và duy trì cookie.
              </div>
              <div className="guide-step">
                <strong>Cách 2 (Thủ công):</strong> Mở DevTools trên tab <code>gemini.google.com</code>, copy cookie và dán vào ô trên rồi nhấn <em>"Lưu cấu hình"</em>.
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ── CARD 2: YOUTUBE RECAP COOKIE FALLBACK ── */}
      <div className="gemini-card">
        <div className="gemini-card-header">
          <div className="gemini-card-title-group">
            <div className="gemini-badge-icon youtube">
              <Film size={16} />
            </div>
            <div>
              <h3 className="gemini-title">YouTube (Tải video Recap dự phòng)</h3>
              <p className="gemini-subtitle">
                Cookie tài khoản YouTube phụ để yt-dlp tự động fallback khi IP bị YouTube yêu cầu xác minh ("Sign in to confirm").
              </p>
            </div>
          </div>

          <div className="gemini-header-status">
            {yt.logged_in ? (
              <span className="gemini-status-pill connected">
                <span className="status-dot-pulse" />
                <CheckCircle2 size={13} />
                <span>
                  Đã có cookie {yt.cookie_count ? `(${yt.cookie_count})` : ''}
                </span>
              </span>
            ) : (
              <span className="gemini-status-pill disconnected">
                <span className="status-dot-idle" />
                <span>Chưa có cookie</span>
              </span>
            )}
          </div>
        </div>

        <div className="gemini-card-body">
          <div className="gemini-action-bar">
            <button
              type="button"
              className="btn-gemini-chrome"
              onClick={loginYt}
              disabled={ytLoading}
            >
              {ytLoading ? (
                <Loader2 size={14} className="spin-icon" />
              ) : (
                <ChromeBrandIcon size={15} />
              )}
              <span>
                {ytLoading ? 'Đang chờ đăng nhập...' : 'Đăng nhập YouTube (Chrome)'}
              </span>
            </button>

            {yt.logged_in && (
              <button
                type="button"
                className="btn-gemini-danger"
                onClick={resetYtCookie}
                disabled={ytLoading}
              >
                <Trash2 size={14} />
                <span>Reset cookie</span>
              </button>
            )}

            {ytMsg && (
              <div className={`gemini-inline-message ${ytMsgType}`}>
                {ytMsgType === 'success' && <CheckCircle2 size={14} />}
                {ytMsgType === 'error' && <AlertCircle size={14} />}
                {ytMsgType === 'info' && <Info size={14} />}
                <span>{ytMsg}</span>
              </div>
            )}
          </div>

          <div className="gemini-guide-box">
            <Info size={15} className="guide-icon" />
            <div className="guide-content">
              Mặc định quá trình tải <strong>không dùng cookies</strong> để đạt chất lượng 1080p. Chỉ khi bot bị chặn mới tự động fallback sang cookies.{' '}
              <em>Lưu ý: Nên dùng tài khoản Google khác với Gemini và không bị thử nghiệm SABR để đảm bảo giữ nguyên độ phân giải 1080p.</em>
            </div>
          </div>
        </div>
      </div>

      {/* ── CARD 3: CHECK FOR UPDATES ── */}
      <div className="gemini-card">
        <div className="gemini-card-header">
          <div className="gemini-card-title-group">
            <div className="gemini-badge-icon update">
              <RefreshCw size={15} />
            </div>
            <div>
              <h3 className="gemini-title">Cập nhật Ứng dụng</h3>
              <p className="gemini-subtitle">
                Kiểm tra và nâng cấp trực tiếp lên phiên bản mới nhất từ máy chủ phát hành.
              </p>
            </div>
          </div>

          <div className="gemini-header-status">
            <span className="gemini-version-pill">
              Phiên bản: <strong>{appVersion}</strong>
            </span>
          </div>
        </div>

        <div className="gemini-card-body">
          <div className="gemini-action-bar">
            <button
              type="button"
              className="btn-gemini-secondary"
              onClick={checkUpdates}
              disabled={updateChecking || updateStatus === 'downloading'}
            >
              {updateChecking ? (
                <Loader2 size={14} className="spin-icon" />
              ) : (
                <RefreshCw size={14} />
              )}
              <span>{updateChecking ? 'Đang kiểm tra...' : 'Kiểm tra cập nhật ngay'}</span>
            </button>

            {updateStatus === 'up_to_date' && (
              <div className="gemini-inline-message success">
                <CheckCircle2 size={14} />
                <span>Bạn đang sử dụng phiên bản mới nhất!</span>
              </div>
            )}

            {updateError && (
              <div className="gemini-inline-message error">
                <AlertCircle size={14} />
                <span>{updateError}</span>
              </div>
            )}
          </div>

          {/* 1. Trạng thái ĐÃ CÓ BẢN MỚI -> Nút Cập nhật ngay */}
          {updateStatus === 'available' && updateInfo && (
            <div className="gemini-update-banner">
              <div className="update-banner-header">
                <div className="update-banner-title">
                  🎉 Đã có phiên bản mới: <strong>{updateInfo.version}</strong> {updateInfo.name ? `(${updateInfo.name})` : ''}
                </div>
                {updateInfo.published_at && (
                  <div className="update-banner-date">
                    Ngày phát hành: {new Date(updateInfo.published_at).toLocaleDateString()}
                  </div>
                )}
              </div>

              <div className="update-action-row">
                <button
                  type="button"
                  className="btn-gemini-primary update-btn"
                  onClick={handleDownloadUpdate}
                >
                  <ArrowDownCircle size={15} />
                  <span>Cập nhật ngay</span>
                </button>
                {updateInfo.isDev && (
                  <span className="update-dev-note">
                    (Môi trường Dev: Nhấn để xem lưu ý)
                  </span>
                )}
              </div>
            </div>
          )}

          {/* 2. Trạng thái ĐANG TẢI BẢN CẬP NHẬT -> Progress Bar */}
          {updateStatus === 'downloading' && (
            <div className="gemini-update-banner downloading">
              <div className="update-banner-title">
                <Loader2 size={14} className="spin-icon" />
                <span>Đang tải bản cập nhật <strong>{updateInfo?.version || ''}</strong>... {downloadProgress.percent}%</span>
              </div>

              <div className="gemini-progress-bar-container">
                <div
                  className="gemini-progress-bar-fill"
                  style={{ width: `${Math.max(4, downloadProgress.percent)}%` }}
                />
              </div>

              <div className="gemini-progress-meta">
                <span>{formatBytes(downloadProgress.transferred)} / {formatBytes(downloadProgress.total)}</span>
                {downloadProgress.bytesPerSecond > 0 && (
                  <span>Tốc độ: {formatBytes(downloadProgress.bytesPerSecond)}/s</span>
                )}
              </div>
            </div>
          )}

          {/* 3. Trạng thái TẢI XONG -> Nút Khởi động lại để hoàn tất */}
          {updateStatus === 'downloaded' && (
            <div className="gemini-update-banner downloaded">
              <div className="update-banner-title success">
                <CheckCircle2 size={16} />
                <span>Bản cập nhật <strong>{updateInfo?.version || ''}</strong> đã sẵn sàng!</span>
              </div>
              <p className="update-banner-desc">
                Bản cài đặt đã được tải về an toàn. Nhấn nút bên dưới để khởi động lại ứng dụng và hoàn tất nâng cấp (dữ liệu của bạn được bảo toàn 100%).
              </p>

              <div className="update-action-row">
                <button
                  type="button"
                  className="btn-gemini-success update-btn"
                  onClick={handleQuitAndInstall}
                  disabled={installing}
                >
                  {installing ? <Loader2 size={15} className="spin-icon" /> : <RotateCcw size={15} />}
                  <span>{installing ? 'Đang khởi động lại...' : 'Khởi động lại để cập nhật'}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
