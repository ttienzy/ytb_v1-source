import { useEffect, useState } from 'react'
import {
  AlertCircle,
  ArrowDownCircle,
  CheckCircle2,
  Loader2,
  RefreshCw,
  RotateCcw,
} from 'lucide-react'
import type { UpdaterStatusEvent } from '../../../vite-env'
import { GeminiAccountsCard } from './GeminiAccountsCard'

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
  // Update check states
  const [appVersion, setAppVersion] = useState(typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'v1.0.0')
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
    if (window.desktop?.getAppVersion) {
      window.desktop.getAppVersion().then((ver) => {
        if (ver) setAppVersion(ver.startsWith('v') ? ver : `v${ver}`)
      }).catch(() => {})
    }

    const handleUpdaterStatus = (data: UpdaterStatusEvent) => {
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
    }

    window.desktop?.getUpdaterStatus?.().then(handleUpdaterStatus).catch(() => {})

    if (window.desktop?.onUpdaterStatus) {
      const unsub = window.desktop.onUpdaterStatus(handleUpdaterStatus)
      return unsub
    }
  }, [])

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

    // Mở giao diện bằng trình duyệt thường (không qua Electron) thì không có bộ cập nhật để dùng.
    setUpdateError('Chức năng cập nhật chỉ hoạt động trong ứng dụng desktop.')
    setUpdateChecking(false)
  }

  async function handleDownloadUpdate() {
    setUpdateError('')
    setUpdateStatus('downloading')
    setDownloadProgress({ percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 })

    if (window.desktop?.startDownloadUpdate) {
      const res = await window.desktop.startDownloadUpdate()
      if (res?.error) {
        setUpdateError(res.error)
        setUpdateStatus('available')
      }
    } else {
      setUpdateError('Chức năng cập nhật chỉ hoạt động trong ứng dụng desktop.')
      setUpdateStatus('available')
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
      {/* ── CARD 1: TÀI KHOẢN GEMINI (nhiều account như ChatGPT) ── */}
      <GeminiAccountsCard onStatusChange={onCookieStatusChange} />

      {/* ── CARD 2: CHECK FOR UPDATES ── */}
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
                {updateInfo.version && typeof __GITHUB_REPO__ !== 'undefined' && (
                  <a
                    href={`https://github.com/${__GITHUB_REPO__.owner}/${__GITHUB_REPO__.repo}/releases/tag/${updateInfo.version.startsWith('v') ? updateInfo.version : `v${updateInfo.version}`}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ fontSize: 12, marginLeft: 10 }}
                  >
                    Xem ghi chú phát hành
                  </a>
                )}
                {updateInfo.isDev && (
                  <span className="update-dev-note">
                    (Môi trường Dev: Tải thử nghiệm)
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
