import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  Clock3,
  KeyRound,
  Loader2,
  Settings,
  SkipForward,
  Square,
  XCircle,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { BatchOut } from '../types'

const STATUS_ICONS: Record<string, JSX.Element> = {
  pending: <Clock3 size={15} style={{ color: '#94a3b8' }} />,
  running: <Loader2 size={15} className="spin" style={{ color: '#4f46e5' }} />,
  done: <CheckCircle2 size={15} style={{ color: '#16a34a' }} />,
  error: <XCircle size={15} style={{ color: '#dc2626' }} />,
  skipped: <SkipForward size={15} style={{ color: '#94a3b8' }} />,
}

const STATUS_LABELS: Record<string, string> = {
  idle: 'Chưa bắt đầu',
  running: 'Đang xử lý…',
  done: 'Hoàn tất',
  stopped: 'Đã dừng',
}

function truncateUrl(url: string, max = 55): string {
  if (url.length <= max) return url
  return url.slice(0, max - 1) + '…'
}

interface Props {
  voiceId: string
  bgmEnabled: boolean
  bgmIds: string[]
  bgmVolume: number
  disabled?: boolean
  setActivePage?: (page: string) => void
}

export function BatchQueuePanel({
  voiceId,
  bgmEnabled,
  bgmIds,
  bgmVolume,
  disabled,
  setActivePage,
}: Props) {
  const [urlsText, setUrlsText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const [batchId, setBatchId] = useState<string | null>(null)
  const [batch, setBatch] = useState<BatchOut | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // YouTube Bot-Wall Login State
  const [ytLoggingIn, setYtLoggingIn] = useState(false)
  const [ytLoginMsg, setYtLoginMsg] = useState('')

  function isYouTubeBotWallError(errorStr?: string): boolean {
    if (!errorStr) return false
    const low = errorStr.toLowerCase()
    return (
      low.includes('sign in to confirm') ||
      low.includes('not a bot') ||
      low.includes('exporting-youtube-cookies') ||
      low.includes('--cookies') ||
      low.includes('cookies-from-browser') ||
      low.includes('bot-wall')
    )
  }

  async function handleLoginYouTube() {
    setYtLoggingIn(true)
    setYtLoginMsg('Đang mở Chrome để bạn đăng nhập YouTube...')
    try {
      const response = await fetch(`${API_URL}/api/recap/yt/login`, {
        method: 'POST',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Đăng nhập thất bại')
      setYtLoginMsg('✅ Đã đăng nhập và lưu Cookie YouTube thành công!')
    } catch (error: any) {
      setYtLoginMsg(`❌ ${error instanceof Error ? error.message : 'Đăng nhập thất bại.'}`)
    } finally {
      setYtLoggingIn(false)
    }
  }

  const parsedUrls = urlsText
    .split('\n')
    .map(l => l.trim())
    .filter(Boolean)
  const uniqueUrls = [...new Set(parsedUrls)]
  const urlCount = uniqueUrls.length
  const urlError =
    urlCount === 0
      ? ''
      : urlCount > 10
      ? `Tối đa 10 URL (hiện có ${urlCount})`
      : uniqueUrls.some(u => !u.includes('youtube.com') && !u.includes('youtu.be'))
      ? 'Một số link không phải YouTube URL'
      : ''

  const pollBatch = useCallback(async (id: string) => {
    try {
      const r = await fetch(`${API_URL}/api/recap/batch/${id}`)
      if (!r.ok) return
      const data: BatchOut = await r.json()
      setBatch(data)
      if (data.status === 'done' || data.status === 'stopped') {
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }
    } catch {
      /* network error — continue polling */
    }
  }, [])

  useEffect(() => {
    if (!batchId) return
    pollRef.current = setInterval(() => pollBatch(batchId), 3000)
    pollBatch(batchId)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [batchId, pollBatch])

  async function submitBatch() {
    if (urlCount === 0) {
      setSubmitError('Dán ít nhất 1 link YouTube.')
      return
    }
    if (urlCount > 10) {
      setSubmitError('Tối đa 10 URL mỗi batch.')
      return
    }
    if (urlError) {
      setSubmitError(urlError)
      return
    }
    if (!voiceId) {
      setSubmitError('Chọn giọng trước.')
      return
    }
    if (bgmEnabled && bgmIds.length === 0) {
      setSubmitError('Bật nhạc nền thì chọn ít nhất 1 track.')
      return
    }
    setSubmitError('')
    setSubmitting(true)
    setBatch(null)
    setBatchId(null)
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }

    try {
      const body: Record<string, unknown> = {
        urls: uniqueUrls,
        voice_id: voiceId,
      }
      if (bgmEnabled && bgmIds.length) {
        body.bgm_ids = bgmIds
        body.bgm_volume = bgmVolume
        body.bgm_fade_out = true
      }
      const r = await fetch(`${API_URL}/api/recap/batch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || `Lỗi ${r.status}`)
      setBatchId(data.batch_id)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Khởi động batch thất bại.')
    } finally {
      setSubmitting(false)
    }
  }

  async function stopBatch() {
    if (!batchId) return
    try {
      await fetch(`${API_URL}/api/recap/batch/${batchId}`, { method: 'DELETE' })
    } catch {
      /* ignore */
    }
  }

  function resetBatch() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setBatchId(null)
    setBatch(null)
    setSubmitError('')
    setUrlsText('')
  }

  const isActive = batch && (batch.status === 'running' || batch.status === 'idle')

  return (
    <div className="batch-queue-panel">
      {!batchId && (
        <div className="fsection">
          <p className="foverline">DANH SÁCH LINK (1–10)</p>
          <div className="field">
            <label>
              Mỗi dòng 1 link YouTube
              {urlCount > 0 && (
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: '12px',
                    color: urlError ? '#dc2626' : '#4f46e5',
                    fontWeight: 700,
                  }}
                >
                  {urlCount}/10 link
                </span>
              )}
            </label>
            <textarea
              className="raw-input"
              value={urlsText}
              onChange={e => setUrlsText(e.target.value)}
              placeholder={
                'https://www.youtube.com/watch?v=xxx\nhttps://www.youtube.com/watch?v=yyy\nhttps://www.youtube.com/watch?v=zzz\n...'
              }
              disabled={Boolean(batchId) || disabled}
              rows={6}
              style={{ minHeight: '120px' }}
            />
            {urlError && (
              <p style={{ color: '#dc2626', fontSize: '12px', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                <AlertCircle size={13} />
                {urlError}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Submit error */}
      {submitError && (
        <div style={{ color: '#dc2626', fontSize: '12px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <AlertCircle size={14} />
          {submitError}
        </div>
      )}

      {/* Button submit batch */}
      {!batchId && (
        <div className="ff">
          <button
            type="button"
            className="btn-p"
            onClick={submitBatch}
            disabled={submitting || disabled || urlCount === 0 || Boolean(urlError)}
            id="btn-batch-submit"
          >
            {submitting ? (
              <>
                <Loader2 size={15} className="spin" />
                Đang khởi động batch…
              </>
            ) : (
              <>
                <ChevronRight size={15} />
                Chạy Batch ({urlCount} link)
              </>
            )}
          </button>
          {setActivePage && (
            <button
              type="button"
              className="btn-g"
              onClick={() => setActivePage('Lịch sử')}
              style={{ gap: 6 }}
            >
              <Clock3 size={14} /> Xem Lịch sử
            </button>
          )}
        </div>
      )}

      {/* Batch status panel */}
      {batch && (
        <div className="batch-status-panel">
          <div className="batch-status-header">
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {batch.status === 'running' && <Loader2 size={16} className="spin" style={{ color: '#4f46e5' }} />}
              {batch.status === 'done' && <CheckCircle2 size={16} style={{ color: '#16a34a' }} />}
              {batch.status === 'stopped' && <XCircle size={16} style={{ color: '#dc2626' }} />}
              <span className="batch-status-title">
                Batch <code style={{ fontSize: '12px', background: '#e2e8f0', padding: '2px 6px', borderRadius: 4 }}>{batch.batch_id}</code>
                {' — '}
                <span
                  style={{
                    color:
                      batch.status === 'done'
                        ? '#16a34a'
                        : batch.status === 'stopped'
                        ? '#dc2626'
                        : '#4f46e5',
                  }}
                >
                  {STATUS_LABELS[batch.status] ?? batch.status}
                </span>
              </span>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: '12px', fontWeight: 600 }}>
              <span style={{ color: '#16a34a' }}>✅ {batch.done_count} xong</span>
              <span style={{ color: '#dc2626' }}>❌ {batch.error_count} lỗi</span>
              <span style={{ color: '#64748b' }}>⏳ {batch.pending_count} chờ</span>
              <span style={{ color: '#94a3b8' }}>/ {batch.total} tổng</span>
            </div>
          </div>

          {/* YouTube Bot-Wall Alert Banner */}
          {batch.items.some(it => it.status === 'error' && isYouTubeBotWallError(it.error)) && (
            <div
              style={{
                marginBottom: 12,
                padding: '12px 14px',
                background: '#fff1f2',
                border: '1.5px solid #fecdd3',
                borderRadius: 10,
                color: '#9f1239',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 13 }}>
                <AlertTriangle size={16} color="#e11d48" />
                <span>Phát hiện video bị chặn bởi YouTube Bot-Wall</span>
              </div>
              <div style={{ marginTop: 4, fontSize: 12, color: '#475569', lineHeight: 1.4 }}>
                Một số video trong hàng đợi bị YouTube chặn với yêu cầu <em>"Sign in to confirm you're not a bot"</em>. Vui lòng đăng nhập YouTube để cập nhật Cookie.
              </div>

              {ytLoginMsg && (
                <div
                  style={{
                    marginTop: 8,
                    padding: '6px 10px',
                    borderRadius: 6,
                    background: ytLoginMsg.startsWith('✅') ? '#f0fdf4' : '#fff',
                    border: '1px solid',
                    borderColor: ytLoginMsg.startsWith('✅') ? '#bbf7d0' : '#fecdd3',
                    fontSize: 11.5,
                    color: ytLoginMsg.startsWith('✅') ? '#166534' : '#be123c',
                  }}
                >
                  {ytLoginMsg}
                </div>
              )}

              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn-p"
                  onClick={handleLoginYouTube}
                  disabled={ytLoggingIn}
                  style={{
                    background: '#e11d48',
                    height: 32,
                    padding: '0 12px',
                    fontSize: 12,
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                >
                  {ytLoggingIn ? <Loader2 size={13} className="spin" /> : <KeyRound size={13} />}
                  {ytLoggingIn ? 'Đang mở Chrome…' : 'Đăng nhập YouTube qua Chrome'}
                </button>

                {setActivePage && (
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setActivePage('Cài đặt')}
                    style={{ height: 32, padding: '0 10px', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                  >
                    <Settings size={13} /> Trang Cài đặt
                  </button>
                )}
              </div>
            </div>
          )}

          <div className="batch-item-list">
            {batch.items.map((item, idx) => (
              <div key={idx} className={`batch-item batch-item--${item.status}`}>
                <span className="batch-item-index">{idx + 1}</span>
                <span className="batch-item-icon">{STATUS_ICONS[item.status]}</span>
                <div className="batch-item-info">
                  <span className="batch-item-url" title={item.url}>
                    {truncateUrl(item.url)}
                  </span>
                  {item.status === 'error' && item.error && (
                    <span className="batch-item-error">
                      {isYouTubeBotWallError(item.error)
                        ? '🔴 Lỗi YouTube Bot-Wall: Cần đăng nhập tài khoản YouTube để xác thực'
                        : item.error}
                    </span>
                  )}
                  {item.status === 'running' && item.retry_count > 0 && (
                    <span className="batch-item-retry">⟳ Đang retry lần {item.retry_count}…</span>
                  )}
                  {item.status === 'done' && item.retry_count > 0 && (
                    <span style={{ fontSize: '11px', color: '#16a34a' }}>✓ Hoàn tất sau retry</span>
                  )}
                </div>
                {item.status === 'error' && isYouTubeBotWallError(item.error) && (
                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={handleLoginYouTube}
                    disabled={ytLoggingIn}
                    title="Đăng nhập YouTube để vượt qua Bot-Wall"
                    style={{
                      padding: '3px 8px',
                      fontSize: 11,
                      color: '#e11d48',
                      borderColor: '#fca5a5',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <KeyRound size={11} /> Login YT
                  </button>
                )}
                {item.job_id && item.status === 'done' && setActivePage && (
                  <button
                    type="button"
                    className="batch-item-view"
                    onClick={() => setActivePage('Lịch sử')}
                    title="Xem trong Lịch sử"
                  >
                    Xem ↗
                  </button>
                )}
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
            {isActive && (
              <button
                type="button"
                className="btn-g"
                onClick={stopBatch}
                id="btn-batch-stop"
                style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#dc2626', borderColor: '#fca5a5' }}
              >
                <Square size={14} />
                Dừng batch
              </button>
            )}
            {(batch.status === 'done' || batch.status === 'stopped') && (
              <button
                type="button"
                className="btn-p"
                onClick={resetBatch}
                id="btn-batch-reset"
              >
                Tạo batch mới
              </button>
            )}
            {setActivePage && (
              <button
                type="button"
                className="btn-g"
                onClick={() => setActivePage('Lịch sử')}
                style={{ gap: 6 }}
              >
                <Clock3 size={14} /> Xem Lịch sử
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
