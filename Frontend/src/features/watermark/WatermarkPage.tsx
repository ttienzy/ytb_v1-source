import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock3,
  Download,
  Eraser,
  FileVideo,
  Film,
  FolderOpen,
  Loader2,
  RefreshCw,
  Trash2,
  Upload,
  XCircle,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import { fmtBytes } from '../../shared/utils/formatters'
import type { QueuedFile, WatermarkBatchJob } from './types'

export function WatermarkPage() {
  const [cliOk, setCliOk] = useState<boolean | null>(null)
  const [cliMsg, setCliMsg] = useState('')
  const [queue, setQueue] = useState<QueuedFile[]>([])
  const [currentJob, setCurrentJob] = useState<WatermarkBatchJob | null>(null)
  const [historyJobs, setHistoryJobs] = useState<WatermarkBatchJob[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const pollTimerRef = useRef<any>(null)

  // Check CLI status
  const checkCli = useCallback(() => {
    fetch(`${API_URL}/api/watermark/check`)
      .then(r => r.json())
      .then(data => {
        setCliOk(data.gwr_available)
        setCliMsg(data.message)
      })
      .catch(() => {
        setCliOk(false)
        setCliMsg('Không thể kết nối với Backend service.')
      })
  }, [])

  // Load Job History
  const loadHistory = useCallback(() => {
    fetch(`${API_URL}/api/watermark/jobs`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((jobs: WatermarkBatchJob[]) => setHistoryJobs(jobs))
      .catch(() => {})
  }, [])

  useEffect(() => {
    checkCli()
    loadHistory()
  }, [checkCli, loadHistory])

  // Polling current job
  useEffect(() => {
    if (
      !currentJob ||
      currentJob.status === 'done' ||
      currentJob.status === 'error'
    ) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      setIsProcessing(false)
      return
    }

    setIsProcessing(true)
    pollTimerRef.current = setInterval(() => {
      fetch(`${API_URL}/api/watermark/jobs/${currentJob.job_id}`)
        .then(r => (r.ok ? r.json() : Promise.reject()))
        .then((updated: WatermarkBatchJob) => {
          setCurrentJob(updated)
          if (updated.status === 'done' || updated.status === 'error') {
            clearInterval(pollTimerRef.current)
            setIsProcessing(false)
            loadHistory()
          }
        })
        .catch(() => {})
    }, 1000)

    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [currentJob?.job_id, currentJob?.status, loadHistory])

  // Helper lấy đường dẫn native từ Electron Desktop
  function getNativeFilePath(f: File): string {
    try {
      if ((window as any).desktop?.getPathForFile) {
        const p = (window as any).desktop.getPathForFile(f)
        if (p) return p
      }
    } catch (e) {
      console.warn('getPathForFile failed:', e)
    }
    return (f as any).path || ''
  }

  // Add files to queue
  function handleAddFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return
    setErrorMsg('')
    const newItems: QueuedFile[] = []

    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const nativePath = getNativeFilePath(f)
      if (
        f.name.toLowerCase().endsWith('.mp4') ||
        nativePath.toLowerCase().endsWith('.mp4')
      ) {
        if (!queue.some(q => q.name === f.name)) {
          newItems.push({
            path: nativePath || f.name,
            name: f.name,
            size: f.size || 0,
            file: f, // Lưu File object để upload sau
          })
        }
      }
    }

    if (newItems.length > 0) {
      setQueue(prev => [...prev, ...newItems])
    }
  }

  // Import by direct path (prompt) — hỗ trợ cả file và thư mục
  function handleImportPath() {
    const entered = window.prompt(
      'Nhập đường dẫn file MP4 hoặc thư mục chứa video:',
      'C:\\Users\\nguye\\Videos\\fl1\\Cooking_beef_fried_rice_202608232323.mp4'
    )
    if (!entered) return
    setErrorMsg('')
    const trimmed = entered
      .trim()
      .replace(/^"(.*)"$/, '$1')
      .replace(/^'(.*)'$/, '$1')
    if (trimmed) {
      const name = trimmed.split(/[\\/]/).pop() || trimmed
      if (!queue.some(q => q.path === trimmed)) {
        setQueue(prev => [...prev, { path: trimmed, name, size: 0 }])
      }
    }
  }

  // Start processing — auto-detect upload mode vs path mode
  async function handleStartProcess() {
    if (queue.length === 0) return
    setErrorMsg('')
    setIsProcessing(true)

    try {
      // Detect mode: nếu có File object → upload mode, còn không → path mode
      const hasFileObjects = queue.some(q => q.file)
      const hasValidPaths = queue.some(
        q => q.path && q.path !== q.name && !q.path.includes(' ')
      )

      let res: Response
      let data: any

      if (hasFileObjects && !hasValidPaths) {
        // ═══ UPLOAD MODE (Web Browser) ═══
        const formData = new FormData()
        for (const item of queue) {
          if (item.file) {
            formData.append('files', item.file)
          }
        }

        res = await fetch(`${API_URL}/api/watermark/upload`, {
          method: 'POST',
          body: formData,
        })
      } else {
        // ═══ PATH MODE (Electron or manual path) ═══
        res = await fetch(`${API_URL}/api/watermark/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: queue.map(q => q.path) }),
        })
      }

      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.detail || `Lỗi ${res.status}`)
      }

      data = await res.json()

      // Initial fetch of job
      const jobRes = await fetch(
        `${API_URL}/api/watermark/jobs/${data.job_id}`
      )
      if (jobRes.ok) {
        const jobData = await jobRes.json()
        setCurrentJob(jobData)
      } else {
        setCurrentJob({
          job_id: data.job_id,
          status: 'running',
          total: data.total,
          done: 0,
          failed: 0,
          videos: queue.map(q => ({
            name: q.name,
            size_bytes: q.size,
            status: 'pending',
          })),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
      setQueue([])
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Khởi động xóa watermark thất bại.'
      )
      setIsProcessing(false)
    }
  }

  return (
    <section className="settings-page wm-page">
      <div className="settings-heading wm-heading">
        <div>
          <p className="overline">GEMINI SYNTHID</p>
          <h1>Xóa Watermark</h1>
          <p className="page-subtitle">
            Tự động phát hiện và xóa biểu tượng watermark ✦ SynthID khỏi video
            gốc bằng AI Inpainting.
          </p>
        </div>
      </div>

      {/* CLI Check Banner */}
      {cliOk !== null && (
        <div
          className={`wm-cli-banner ${
            cliOk ? 'wm-cli-ok' : 'wm-cli-error'
          }`}
        >
          {cliOk ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{cliMsg}</span>
          {!cliOk && (
            <span className="wm-cli-cmd">
              npm install -g @pilio/gemini-watermark-remover
            </span>
          )}
        </div>
      )}

      {errorMsg && (
        <div className="err-block">
          <AlertCircle size={15} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Active Job Progress Card */}
      {currentJob && (
        <div className="wm-progress-card">
          <div className="wm-prog-header">
            <div className="wm-queue-label">
              <Film size={16} />
              <span>
                Tiến trình xử lý — Job{' '}
                <code style={{ color: '#6366f1' }}>{currentJob.job_id}</code>
              </span>
            </div>
            <span className={`wm-badge wm-badge-${currentJob.status}`}>
              {currentJob.status === 'running' && (
                <Loader2 size={12} className="spin" />
              )}
              {currentJob.status === 'running'
                ? 'Đang xử lý'
                : currentJob.status === 'done'
                ? 'Hoàn thành'
                : currentJob.status === 'error'
                ? 'Có lỗi'
                : 'Chờ'}
            </span>
            {currentJob.failed > 0 && (
              <span className="wm-prog-fail">
                {currentJob.failed} file lỗi
              </span>
            )}
            <div
              style={{
                marginLeft: 'auto',
                display: 'flex',
                gap: 8,
                alignItems: 'center',
              }}
            >
              {currentJob.done > 0 && (
                <a
                  href={`${API_URL}/api/watermark/download-all/${currentJob.job_id}`}
                  download={`watermark_clean_${currentJob.job_id}.zip`}
                  className="primary-button"
                  style={{
                    minHeight: 32,
                    height: 32,
                    fontSize: 12,
                    padding: '0 12px',
                    textDecoration: 'none',
                    background: '#16a34a',
                  }}
                  title="Tải toàn bộ các video sạch trong job này về máy dưới dạng 1 file ZIP"
                >
                  <Download size={14} /> Tải tất cả ({currentJob.done} video
                  ZIP)
                </a>
              )}
              <button
                type="button"
                className="wm-new-btn"
                onClick={() => {
                  setCurrentJob(null)
                  setQueue([])
                }}
              >
                + Mẻ mới
              </button>
            </div>
          </div>

          <div className="wm-prog-bar-wrap">
            <div
              className="wm-prog-bar"
              style={{
                width: `${
                  currentJob.total > 0
                    ? ((currentJob.done + currentJob.failed) /
                        currentJob.total) *
                      100
                    : 0
                }%`,
              }}
            />
          </div>

          <div className="wm-prog-pct">
            {currentJob.done}/{currentJob.total} video hoàn thành (
            {currentJob.total > 0
              ? Math.round((currentJob.done / currentJob.total) * 100)
              : 0}
            %)
          </div>

          {/* Videos in this job */}
          <div className="wm-list" style={{ marginTop: 14 }}>
            {currentJob.videos.map((v, i) => (
              <div key={i} className={`wm-item wm-item-${v.status}`}>
                <FileVideo size={16} className="wm-file-icon" />
                <div className="wm-item-info">
                  <div className="wm-item-name">{v.name}</div>
                  <div className="wm-item-size">
                    {fmtBytes(v.size_bytes)}
                    {v.output_name && ` → fl1_clean/${v.output_name}`}
                  </div>
                </div>
                <div className="wm-item-status">
                  {v.status === 'pending' && (
                    <span className="wm-st wm-st-pending">Đang chờ</span>
                  )}
                  {v.status === 'running' && (
                    <span className="wm-st wm-st-running">
                      <Loader2 size={13} className="spin" />
                      {v.processed_frames != null
                        ? `${v.processed_frames}${
                            v.frame_estimate
                              ? `/${v.frame_estimate}`
                              : ''
                          } frames`
                        : 'Đang xóa...'}
                    </span>
                  )}
                  {v.status === 'done' && (
                    <span className="wm-st wm-st-done">
                      <CheckCircle2 size={13} /> Sạch 100%
                    </span>
                  )}
                  {v.status === 'error' && (
                    <span
                      className="wm-st wm-st-error"
                      title={v.error || 'Lỗi xử lý'}
                    >
                      <XCircle size={13} /> Lỗi
                    </span>
                  )}
                  {v.status === 'done' && (
                    <a
                      href={`${API_URL}/api/watermark/download/${
                        currentJob.job_id
                      }/${encodeURIComponent(v.name)}`}
                      download={v.name}
                      className="wm-dl"
                      title="Tải video sạch về máy"
                    >
                      <Download size={14} />
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Upload / Queue Card */}
      {!currentJob && (
        <div className="settings-card">
          <div className="integration-title">
            <div className="gemini-icon">
              <Eraser size={18} />
            </div>
            <div>
              <h2>Chọn Video cần xóa Watermark</h2>
              <p>Kéo thả nhiều file MP4 từ máy tính hoặc bấm để duyệt chọn.</p>
            </div>
          </div>

          <div
            className={`wm-dropzone ${
              isDragging ? 'wm-dropzone-over' : ''
            } ${cliOk === false ? 'wm-dropzone-disabled' : ''}`}
            onDragOver={e => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setIsDragging(false)
              handleAddFiles(e.dataTransfer.files)
            }}
            onClick={() => fileInputRef.current?.click()}
          >
            <input
              ref={fileInputRef}
              type="file"
              accept="video/mp4"
              multiple
              style={{ display: 'none' }}
              onChange={e => handleAddFiles(e.target.files)}
            />
            <Upload size={32} className="wm-drop-icon" />
            <p className="wm-drop-title">Kéo & thả video MP4 vào đây</p>
            <p className="wm-drop-sub">
              hoặc <span className="wm-drop-link">duyệt chọn từ máy</span>
            </p>
          </div>

          <div
            className="settings-actions"
            style={{ justifyContent: 'space-between' }}
          >
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                className="primary-button"
                onClick={handleStartProcess}
                disabled={
                  queue.length === 0 || isProcessing || cliOk === false
                }
              >
                {isProcessing ? (
                  <Loader2 size={16} className="spin" />
                ) : (
                  <Eraser size={16} />
                )}
                Bắt đầu xóa watermark ({queue.length} video)
              </button>
              <button
                type="button"
                className="chrome-button"
                onClick={handleImportPath}
                disabled={isProcessing}
              >
                <FolderOpen size={15} /> Nhập đường dẫn file
              </button>
            </div>

            {queue.length > 0 && (
              <button
                type="button"
                className="chrome-button"
                onClick={() => setQueue([])}
                style={{ color: '#ef4444' }}
              >
                <Trash2 size={14} /> Xóa danh sách
              </button>
            )}
          </div>

          {/* Queue files list */}
          {queue.length > 0 && (
            <div style={{ marginTop: 20 }}>
              <div className="wm-queue-label" style={{ marginBottom: 10 }}>
                <span>Danh sách chờ xử lý ({queue.length} file):</span>
              </div>
              <div className="wm-list">
                {queue.map((q, idx) => (
                  <div key={idx} className="wm-item">
                    <FileVideo size={16} className="wm-file-icon" />
                    <div className="wm-item-info">
                      <div className="wm-item-name">{q.name}</div>
                      <div className="wm-item-size">
                        {q.path || '—'}{' '}
                        {q.size > 0 ? `· ${fmtBytes(q.size)}` : ''}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="wm-remove-btn"
                      onClick={() =>
                        setQueue(queue.filter((_, i) => i !== idx))
                      }
                      title="Bỏ file này"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* History Jobs Card */}
      {historyJobs.length > 0 && (
        <div className="settings-card" style={{ marginTop: 22 }}>
          <div className="integration-title">
            <div className="gemini-icon">
              <Clock3 size={17} />
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                width: '100%',
                alignItems: 'center',
              }}
            >
              <div>
                <h2>Lịch sử các đợt xử lý ({historyJobs.length})</h2>
                <p>Xem lại các đợt xóa watermark đã hoàn thành gần đây.</p>
              </div>
              <button
                type="button"
                className="chrome-button"
                onClick={loadHistory}
                style={{ height: 34, padding: '0 12px' }}
              >
                <RefreshCw size={13} /> Làm mới
              </button>
            </div>
          </div>

          <div className="voices-list">
            {historyJobs.map(job => (
              <div
                key={job.job_id}
                className="voice-item"
                style={{ alignItems: 'center' }}
              >
                <div className="voice-item-info">
                  <strong>
                    Batch {job.job_id}
                    <span
                      className={`wm-badge wm-badge-${job.status}`}
                      style={{
                        marginLeft: 8,
                        fontSize: 10,
                        padding: '2px 7px',
                      }}
                    >
                      {job.status === 'done'
                        ? 'Hoàn thành'
                        : job.status === 'running'
                        ? 'Đang chạy'
                        : job.status}
                    </span>
                  </strong>
                  <span>
                    {job.done}/{job.total} video xong ·{' '}
                    {new Date(job.created_at).toLocaleString()}
                    {job.videos.length > 0
                      ? ` · ${job.videos[0].name}${
                          job.videos.length > 1
                            ? ` (+${job.videos.length - 1})`
                            : ''
                        }`
                      : ''}
                  </span>
                </div>
                <div className="voice-item-actions">
                  {job.done > 0 && (
                    <a
                      href={`${API_URL}/api/watermark/download-all/${job.job_id}`}
                      download={`watermark_clean_${job.job_id}.zip`}
                      className="chrome-button"
                      style={{
                        height: 32,
                        padding: '0 10px',
                        fontSize: 11,
                        textDecoration: 'none',
                      }}
                      title="Tải tất cả file sạch dạng ZIP"
                    >
                      <Download size={12} /> ZIP ({job.done})
                    </a>
                  )}
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => {
                      setCurrentJob(job)
                      setQueue([])
                    }}
                  >
                    Xem chi tiết
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  )
}
