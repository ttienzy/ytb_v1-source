import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  Eye,
  FileImage,
  FileVideo,
  FolderOpen,
  HardDrive,
  Loader2,
  Play,
  RefreshCw,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import { fmtBytes } from '../../shared/utils/formatters'
import type { QueuedFile, WatermarkBatchJob, WatermarkVideoItem } from './types'

const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp']
const VIDEO_EXTENSIONS = ['.mp4', '.mov', '.webm']

export function WatermarkPage() {
  const [activeTab, setActiveTab] = useState<'image' | 'video'>('image')
  const [cliOk, setCliOk] = useState<boolean | null>(null)
  const [cliMsg, setCliMsg] = useState('')
  const [driveStatus, setDriveStatus] = useState<any>(null)

  // Separate Queues
  const [imageQueue, setImageQueue] = useState<QueuedFile[]>([])
  const [videoQueue, setVideoQueue] = useState<QueuedFile[]>([])

  // Modal Preview
  const [selectedPreviewImage, setSelectedPreviewImage] = useState<{
    job_id: string
    item: WatermarkVideoItem
    previewType: 'clean' | 'orig'
  } | null>(null)

  // Jobs
  const [currentJob, setCurrentJob] = useState<WatermarkBatchJob | null>(null)
  const [historyJobs, setHistoryJobs] = useState<WatermarkBatchJob[]>([])
  const [isProcessing, setIsProcessing] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [syncingDriveJobId, setSyncingDriveJobId] = useState<string | null>(null)
  const [syncingVideoName, setSyncingVideoName] = useState<string | null>(null)

  const imageFileInputRef = useRef<HTMLInputElement | null>(null)
  const videoFileInputRef = useRef<HTMLInputElement | null>(null)
  const pollTimerRef = useRef<any>(null)

  // Check CLI status with auto-retry on startup
  const checkCli = useCallback((retryCount = 0) => {
    fetch(`${API_URL}/api/watermark/check`)
      .then(r => r.json())
      .then(data => {
        setCliOk(data.gwr_available)
        setCliMsg(data.message)
      })
      .catch(() => {
        if (retryCount < 10) {
          setTimeout(() => checkCli(retryCount + 1), 1500)
        } else {
          setCliOk(false)
          setCliMsg('Không thể kết nối với Backend service.')
        }
      })
  }, [])

  // Load History with auto-retry
  const loadHistory = useCallback((retryCount = 0) => {
    fetch(`${API_URL}/api/watermark/jobs`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((jobs: WatermarkBatchJob[]) => setHistoryJobs(jobs))
      .catch(() => {
        if (retryCount < 5) {
          setTimeout(() => loadHistory(retryCount + 1), 2000)
        }
      })
  }, [])

  const loadDriveStatus = useCallback((retryCount = 0) => {
    fetch(`${API_URL}/api/gdrive/status`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(data => setDriveStatus(data))
      .catch(() => {
        if (retryCount < 5) {
          setTimeout(() => loadDriveStatus(retryCount + 1), 2000)
        }
      })
  }, [])

  useEffect(() => {
    checkCli()
    loadHistory()
    loadDriveStatus()
  }, [checkCli, loadHistory, loadDriveStatus])

  // Polling current job
  useEffect(() => {
    if (
      !currentJob ||
      (currentJob.status === 'done' && !currentJob.videos.some(v => v.drive_status === 'uploading')) ||
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
          if (
            (updated.status === 'done' || updated.status === 'error') &&
            !updated.videos.some(v => v.drive_status === 'uploading')
          ) {
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

  // Polling Drive Sync Status
  useEffect(() => {
    const isAnySyncing =
      syncingDriveJobId !== null ||
      historyJobs.some(j => j.videos.some(v => v.drive_status === 'uploading'))

    if (!isAnySyncing) return

    const timer = setInterval(() => {
      loadHistory()
      if (currentJob?.job_id) {
        fetch(`${API_URL}/api/watermark/jobs/${currentJob.job_id}`)
          .then(r => (r.ok ? r.json() : Promise.reject()))
          .then(updated => setCurrentJob(updated))
          .catch(() => {})
      }
    }, 1200)

    return () => clearInterval(timer)
  }, [syncingDriveJobId, historyJobs, currentJob?.job_id, loadHistory])

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

  function detectMediaType(nameOrPath: string): 'image' | 'video' {
    const lower = nameOrPath.toLowerCase()
    if (IMAGE_EXTENSIONS.some(ext => lower.endsWith(ext))) return 'image'
    return 'video'
  }

  function handleAddImageFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return
    setErrorMsg('')
    const newItems: QueuedFile[] = []

    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const nativePath = getNativeFilePath(f)
      const targetStr = (nativePath || f.name).toLowerCase()
      const isImage = IMAGE_EXTENSIONS.some(ext => targetStr.endsWith(ext))

      if (isImage) {
        if (!imageQueue.some(q => q.name === f.name)) {
          newItems.push({
            path: nativePath || f.name,
            name: f.name,
            size: f.size || 0,
            media_type: 'image',
            file: f,
          })
        }
      }
    }

    if (newItems.length > 0) {
      setImageQueue(prev => [...prev, ...newItems])
    }
  }

  function handleAddVideoFiles(files: FileList | File[] | null) {
    if (!files || files.length === 0) return
    setErrorMsg('')
    const newItems: QueuedFile[] = []

    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      const nativePath = getNativeFilePath(f)
      const targetStr = (nativePath || f.name).toLowerCase()
      const isVideo = VIDEO_EXTENSIONS.some(ext => targetStr.endsWith(ext))

      if (isVideo) {
        if (!videoQueue.some(q => q.name === f.name)) {
          newItems.push({
            path: nativePath || f.name,
            name: f.name,
            size: f.size || 0,
            media_type: 'video',
            file: f,
          })
        }
      }
    }

    if (newItems.length > 0) {
      setVideoQueue(prev => [...prev, ...newItems])
    }
  }

  function handleImportImagePath() {
    const entered = window.prompt(
      'Nhập đường dẫn file ảnh hoặc thư mục chứa ảnh:',
      'C:\\Users\\nguye\\OneDrive\\Pictures\\ai_profile'
    )
    if (!entered) return
    setErrorMsg('')
    const trimmed = entered.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    if (trimmed) {
      const name = trimmed.split(/[\\/]/).pop() || trimmed
      if (!imageQueue.some(q => q.path === trimmed)) {
        setImageQueue(prev => [
          ...prev,
          { path: trimmed, name, size: 0, media_type: 'image' },
        ])
      }
    }
  }

  function handleImportVideoPath() {
    const entered = window.prompt(
      'Nhập đường dẫn file video hoặc thư mục chứa video:',
      'C:\\Users\\nguye\\Videos\\fl1'
    )
    if (!entered) return
    setErrorMsg('')
    const trimmed = entered.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
    if (trimmed) {
      const name = trimmed.split(/[\\/]/).pop() || trimmed
      if (!videoQueue.some(q => q.path === trimmed)) {
        setVideoQueue(prev => [
          ...prev,
          { path: trimmed, name, size: 0, media_type: 'video' },
        ])
      }
    }
  }

  async function handleStartProcess(targetQueue: QueuedFile[], isImage: boolean) {
    if (targetQueue.length === 0) return
    setErrorMsg('')
    setIsProcessing(true)

    try {
      const hasFileObjects = targetQueue.some(q => q.file)
      const hasValidPaths = targetQueue.some(
        q => q.path && q.path !== q.name && !q.path.includes(' ')
      )

      let res: Response
      let data: any

      if (hasFileObjects && !hasValidPaths) {
        const formData = new FormData()
        for (const item of targetQueue) {
          if (item.file) {
            formData.append('files', item.file)
          }
        }

        res = await fetch(`${API_URL}/api/watermark/upload`, {
          method: 'POST',
          body: formData,
        })
      } else {
        res = await fetch(`${API_URL}/api/watermark/process`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ paths: targetQueue.map(q => q.path) }),
        })
      }

      if (!res.ok) {
        const err = await res.json().catch(() => null)
        throw new Error(err?.detail || `Lỗi ${res.status}`)
      }

      data = await res.json()

      const jobRes = await fetch(`${API_URL}/api/watermark/jobs/${data.job_id}`)
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
          videos: targetQueue.map(q => ({
            name: q.name,
            size_bytes: q.size,
            media_type: q.media_type,
            status: 'pending',
          })),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }

      if (isImage) setImageQueue([])
      else setVideoQueue([])
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Khởi động xử lý thất bại.'
      )
      setIsProcessing(false)
    }
  }

  async function handleSyncBatchToDrive(jobId: string, force = true) {
    setSyncingDriveJobId(jobId)
    setErrorMsg('')
    try {
      const res = await fetch(`${API_URL}/api/watermark/jobs/${jobId}/sync-drive?force=${force}`, {
        method: 'POST',
      })
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Không thể đồng bộ file lên Google Drive.')
      }
      if (currentJob?.job_id === jobId) {
        setCurrentJob(data)
      }
      loadHistory()
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi đồng bộ Google Drive.')
    } finally {
      setSyncingDriveJobId(null)
    }
  }

  async function handleSyncSingleToDrive(jobId: string, filename: string) {
    setSyncingVideoName(filename)
    setErrorMsg('')
    try {
      const res = await fetch(
        `${API_URL}/api/watermark/jobs/${jobId}/videos/${encodeURIComponent(filename)}/sync-drive`,
        { method: 'POST' }
      )
      const data = await res.json()
      if (!res.ok) {
        throw new Error(data.detail || 'Không thể đồng bộ file lên Google Drive.')
      }
      if (currentJob?.job_id === jobId) {
        setCurrentJob(data)
      }
      loadHistory()
    } catch (err: any) {
      setErrorMsg(err.message || 'Lỗi đồng bộ Google Drive.')
    } finally {
      setSyncingVideoName(null)
    }
  }

  const isImageTab = activeTab === 'image'
  const activeQueue = isImageTab ? imageQueue : videoQueue

  const filteredHistoryJobs = useMemo(() => {
    return historyJobs.filter(job => {
      const isImgJob = job.videos.some(v => v.media_type === 'image' || detectMediaType(v.name) === 'image')
      return isImageTab ? isImgJob : !isImgJob
    })
  }, [historyJobs, isImageTab])

  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', paddingBottom: 40 }}>
      {/* ── Top Header ── */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 16,
          paddingBottom: 16,
          borderBottom: '1px solid #e2e8f0',
          marginBottom: 20,
        }}
      >
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: '0 0 4px 0', letterSpacing: '-0.02em' }}>
            Xóa Watermark
          </h1>
          <p style={{ fontSize: 13, color: '#64748b', margin: 0 }}>
            Tự động loại bỏ dấu mờ SynthID và watermark trên hình ảnh và video.
          </p>
        </div>

        {driveStatus?.connected && (
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              fontSize: 12,
              color: '#334155',
              fontWeight: 500,
            }}
          >
            <HardDrive size={14} color="#64748b" />
            <span>
              Google Drive: <strong>{driveStatus.folder_name || 'AI_Clean_Media'}</strong>
            </span>
          </div>
        )}
      </div>

      {/* ── Segmented Control Tabs ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div
          style={{
            display: 'inline-flex',
            background: '#f1f5f9',
            padding: 3,
            borderRadius: 8,
            border: '1px solid #e2e8f0',
          }}
        >
          <button
            type="button"
            onClick={() => setActiveTab('image')}
            style={{
              padding: '7px 18px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              background: isImageTab ? '#fff' : 'transparent',
              color: isImageTab ? '#0f172a' : '#64748b',
              boxShadow: isImageTab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <span>Hình ảnh</span>
            {imageQueue.length > 0 && (
              <span style={{ fontSize: 11, background: isImageTab ? '#f1f5f9' : '#e2e8f0', padding: '1px 6px', borderRadius: 999 }}>
                {imageQueue.length}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('video')}
            style={{
              padding: '7px 18px',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 600,
              border: 'none',
              background: !isImageTab ? '#fff' : 'transparent',
              color: !isImageTab ? '#0f172a' : '#64748b',
              boxShadow: !isImageTab ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              transition: 'all 0.15s ease',
            }}
          >
            <span>Video</span>
            {videoQueue.length > 0 && (
              <span style={{ fontSize: 11, background: !isImageTab ? '#f1f5f9' : '#e2e8f0', padding: '1px 6px', borderRadius: 999 }}>
                {videoQueue.length}
              </span>
            )}
          </button>
        </div>

        <span style={{ fontSize: 12, color: '#94a3b8' }}>
          {isImageTab ? 'Định dạng: PNG, JPG, JPEG, WEBP · Mọi tỷ lệ' : 'Định dạng: MP4, MOV, WEBM'}
        </span>
      </div>

      {/* CLI Warning (Only if error) */}
      {cliOk === false && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          <AlertCircle size={16} />
          <span>{cliMsg || 'Công cụ xử lý watermark chưa sẵn sàng.'}</span>
          <code style={{ marginLeft: 'auto', background: '#fee2e2', padding: '2px 6px', borderRadius: 4, fontSize: 11 }}>
            npm install -g @pilio/gemini-watermark-remover sharp
          </code>
        </div>
      )}

      {errorMsg && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#b91c1c',
            padding: '10px 14px',
            borderRadius: 8,
            fontSize: 13,
            marginBottom: 16,
          }}
        >
          <AlertCircle size={16} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* ── Active Job Card ── */}
      {currentJob && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 20,
            marginBottom: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                Tiến trình xử lý
              </span>
              <span style={{ fontSize: 12, color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: 4 }}>
                Mã đợt: {currentJob.job_id}
              </span>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '2px 8px',
                  borderRadius: 4,
                  background:
                    currentJob.status === 'done'
                      ? '#ecfdf5'
                      : currentJob.status === 'running'
                      ? '#eff6ff'
                      : '#fef2f2',
                  color:
                    currentJob.status === 'done'
                      ? '#059669'
                      : currentJob.status === 'running'
                      ? '#2563eb'
                      : '#dc2626',
                }}
              >
                {currentJob.status === 'running'
                  ? 'Đang xử lý'
                  : currentJob.status === 'done'
                  ? 'Hoàn thành'
                  : 'Lỗi'}
              </span>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {currentJob.done > 0 && (
                <>
                  {driveStatus?.connected && (
                    <button
                      type="button"
                      onClick={() => handleSyncBatchToDrive(currentJob.job_id)}
                      disabled={syncingDriveJobId === currentJob.job_id}
                      style={{
                        height: 32,
                        padding: '0 12px',
                        fontSize: 12,
                        background: '#f8fafc',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        color: '#334155',
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                    >
                      {syncingDriveJobId === currentJob.job_id ? (
                        <Loader2 size={13} className="spin" />
                      ) : (
                        <UploadCloud size={13} />
                      )}
                      Đồng bộ Drive
                    </button>
                  )}
                  <a
                    href={`${API_URL}/api/watermark/download-all/${currentJob.job_id}`}
                    download={`watermark_clean_${currentJob.job_id}.zip`}
                    style={{
                      height: 32,
                      padding: '0 12px',
                      fontSize: 12,
                      background: '#0f172a',
                      borderRadius: 6,
                      color: '#fff',
                      fontWeight: 600,
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <Download size={13} /> Tải tất cả ({currentJob.done} tệp ZIP)
                  </a>
                </>
              )}

              <button
                type="button"
                onClick={() => {
                  setCurrentJob(null)
                  if (isImageTab) setImageQueue([])
                  else setVideoQueue([])
                }}
                style={{
                  height: 32,
                  padding: '0 12px',
                  fontSize: 12,
                  background: '#f1f5f9',
                  border: 'none',
                  borderRadius: 6,
                  color: '#475569',
                  fontWeight: 600,
                  cursor: 'pointer',
                }}
              >
                Tạo đợt mới
              </button>
            </div>
          </div>

          {/* Minimal Progress Bar */}
          <div style={{ width: '100%', height: 6, background: '#f1f5f9', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
            <div
              style={{
                width: `${
                  currentJob.total > 0
                    ? ((currentJob.done + currentJob.failed) / currentJob.total) * 100
                    : 0
                }%`,
                height: '100%',
                background: currentJob.status === 'error' ? '#ef4444' : '#2563eb',
                borderRadius: 999,
                transition: 'width 0.3s ease',
              }}
            />
          </div>

          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14 }}>
            Đã hoàn thành {currentJob.done}/{currentJob.total} tệp (
            {currentJob.total > 0 ? Math.round((currentJob.done / currentJob.total) * 100) : 0}%)
          </div>

          {/* Job Items List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {currentJob.videos.map((v, i) => {
              const isImg = v.media_type === 'image' || detectMediaType(v.name) === 'image'
              return (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '8px 12px',
                    background: '#f8fafc',
                    borderRadius: 6,
                    border: '1px solid #f1f5f9',
                    fontSize: 13,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                    {isImg ? <FileImage size={16} color="#64748b" /> : <FileVideo size={16} color="#64748b" />}
                    <span style={{ fontWeight: 500, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {v.name}
                    </span>
                    <span style={{ fontSize: 11, color: '#94a3b8' }}>{fmtBytes(v.size_bytes)}</span>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {v.status === 'running' && (
                      <span style={{ fontSize: 12, color: '#2563eb', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <Loader2 size={12} className="spin" />
                        {v.processed_frames != null ? `${v.processed_frames}/${v.frame_estimate || ''} frames` : 'Đang xử lý...'}
                      </span>
                    )}

                    {v.status === 'done' && (
                      <>
                        <span style={{ fontSize: 12, color: '#059669', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <CheckCircle2 size={13} /> Hoàn thành
                        </span>

                        {isImg && (
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedPreviewImage({
                                job_id: currentJob.job_id,
                                item: v,
                                previewType: 'clean',
                              })
                            }
                            style={{
                              height: 26,
                              padding: '0 8px',
                              fontSize: 11,
                              background: '#fff',
                              border: '1px solid #cbd5e1',
                              borderRadius: 4,
                              color: '#334155',
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <Eye size={12} /> So sánh
                          </button>
                        )}

                        {v.drive_status === 'done' && v.drive_url && (
                          <a
                            href={v.drive_url}
                            target="_blank"
                            rel="noreferrer"
                            style={{
                              height: 26,
                              padding: '0 8px',
                              fontSize: 11,
                              background: '#fff',
                              border: '1px solid #cbd5e1',
                              borderRadius: 4,
                              color: '#2563eb',
                              textDecoration: 'none',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                          >
                            <ExternalLink size={11} /> Drive
                          </a>
                        )}

                        <a
                          href={`${API_URL}/api/watermark/download/${currentJob.job_id}/${encodeURIComponent(v.name)}`}
                          download={v.name}
                          style={{
                            height: 26,
                            padding: '0 8px',
                            fontSize: 11,
                            background: '#fff',
                            border: '1px solid #cbd5e1',
                            borderRadius: 4,
                            color: '#334155',
                            textDecoration: 'none',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                          }}
                        >
                          <Download size={12} /> Tải về
                        </a>
                      </>
                    )}

                    {v.status === 'error' && (
                      <span style={{ fontSize: 12, color: '#dc2626', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                        <XCircle size={13} /> Lỗi
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Main Input & Queue Area ── */}
      {!currentJob && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
            marginBottom: 20,
          }}
        >
          {/* Dropzone */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '36px 20px',
              background: isDragging ? '#f8fafc' : '#fcfcfd',
              border: `2px dashed ${isDragging ? '#94a3b8' : '#e2e8f0'}`,
              borderRadius: 10,
              cursor: 'pointer',
              transition: 'all 0.15s ease',
            }}
            onDragOver={e => {
              e.preventDefault()
              setIsDragging(true)
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={e => {
              e.preventDefault()
              setIsDragging(false)
              if (isImageTab) handleAddImageFiles(e.dataTransfer.files)
              else handleAddVideoFiles(e.dataTransfer.files)
            }}
            onClick={() => {
              if (isImageTab) imageFileInputRef.current?.click()
              else videoFileInputRef.current?.click()
            }}
          >
            {isImageTab ? (
              <input
                ref={imageFileInputRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp"
                multiple
                style={{ display: 'none' }}
                onChange={e => {
                  if (e.target.files) handleAddImageFiles(e.target.files)
                }}
              />
            ) : (
              <input
                ref={videoFileInputRef}
                type="file"
                accept="video/mp4,video/quicktime,video/webm,.mp4,.mov,.webm"
                multiple
                style={{ display: 'none' }}
                onChange={e => {
                  if (e.target.files) handleAddVideoFiles(e.target.files)
                }}
              />
            )}

            <UploadCloud size={30} color="#94a3b8" style={{ marginBottom: 10 }} />
            <div style={{ fontSize: 14, fontWeight: 600, color: '#1e293b', marginBottom: 4 }}>
              Kéo thả {isImageTab ? 'hình ảnh' : 'video'} vào đây hoặc bấm để chọn tệp
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              {isImageTab
                ? 'Hỗ trợ PNG, JPG, JPEG, WEBP · Mọi tỷ lệ 9:16, 1:1, 16:9, 3:4'
                : 'Hỗ trợ MP4, MOV, WEBM'}
            </div>
          </div>

          {/* Action Bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 16,
              flexWrap: 'wrap',
              gap: 10,
            }}
          >
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                type="button"
                onClick={() => handleStartProcess(activeQueue, isImageTab)}
                disabled={activeQueue.length === 0 || isProcessing || cliOk === false}
                style={{
                  height: 36,
                  padding: '0 16px',
                  fontSize: 13,
                  fontWeight: 600,
                  background: activeQueue.length === 0 ? '#94a3b8' : '#0f172a',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: activeQueue.length === 0 ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {isProcessing ? (
                  <Loader2 size={14} className="spin" />
                ) : (
                  <Play size={13} fill="currentColor" />
                )}
                Bắt đầu xử lý ({activeQueue.length} {isImageTab ? 'ảnh' : 'video'})
              </button>

              <button
                type="button"
                onClick={isImageTab ? handleImportImagePath : handleImportVideoPath}
                disabled={isProcessing}
                style={{
                  height: 36,
                  padding: '0 14px',
                  fontSize: 13,
                  fontWeight: 500,
                  background: '#fff',
                  color: '#334155',
                  border: '1px solid #cbd5e1',
                  borderRadius: 6,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <FolderOpen size={14} /> Nhập đường dẫn thư mục...
              </button>
            </div>

            {activeQueue.length > 0 && (
              <button
                type="button"
                onClick={() => (isImageTab ? setImageQueue([]) : setVideoQueue([]))}
                style={{
                  height: 36,
                  padding: '0 12px',
                  fontSize: 12,
                  color: '#ef4444',
                  background: 'transparent',
                  border: 'none',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                }}
              >
                <Trash2 size={13} /> Xóa danh sách
              </button>
            )}
          </div>

          {/* Queue Items */}
          {activeQueue.length > 0 && (
            <div style={{ marginTop: 16, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
              <div style={{ fontSize: 12, fontWeight: 600, color: '#64748b', marginBottom: 8 }}>
                Danh sách chờ ({activeQueue.length} tệp)
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {activeQueue.map((q, idx) => (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '8px 12px',
                      background: '#f8fafc',
                      borderRadius: 6,
                      border: '1px solid #f1f5f9',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                      {isImageTab ? <FileImage size={15} color="#64748b" /> : <FileVideo size={15} color="#64748b" />}
                      <span style={{ fontSize: 13, fontWeight: 500, color: '#0f172a' }}>{q.name}</span>
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>
                        {q.size > 0 ? fmtBytes(q.size) : q.path}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (isImageTab) setImageQueue(imageQueue.filter((_, i) => i !== idx))
                        else setVideoQueue(videoQueue.filter((_, i) => i !== idx))
                      }}
                      style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 4 }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── History Section ── */}
      {filteredHistoryJobs.length > 0 && (
        <div
          style={{
            background: '#fff',
            border: '1px solid #e2e8f0',
            borderRadius: 12,
            padding: 20,
            boxShadow: '0 1px 3px rgba(0,0,0,0.02)',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Clock size={16} color="#64748b" />
              <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                Lịch sử xử lý {isImageTab ? 'hình ảnh' : 'video'} ({filteredHistoryJobs.length} đợt)
              </span>
            </div>

            <button
              type="button"
              onClick={loadHistory}
              style={{
                height: 28,
                padding: '0 10px',
                fontSize: 12,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
                color: '#64748b',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
              }}
            >
              <RefreshCw size={12} /> Làm mới
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {filteredHistoryJobs.map(job => (
              <div
                key={job.job_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  background: '#f8fafc',
                  borderRadius: 8,
                  border: '1px solid #f1f5f9',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                    <span style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                      Đợt {job.job_id}
                    </span>
                    <span
                      style={{
                        fontSize: 11,
                        padding: '1px 6px',
                        borderRadius: 4,
                        background: job.status === 'done' ? '#ecfdf5' : '#f1f5f9',
                        color: job.status === 'done' ? '#059669' : '#64748b',
                        fontWeight: 500,
                      }}
                    >
                      {job.status === 'done' ? 'Hoàn thành' : job.status}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, color: '#64748b' }}>
                    {job.done}/{job.total} tệp · {new Date(job.created_at).toLocaleString()}
                    {job.videos.length > 0 && ` · ${job.videos[0].name}${job.videos.length > 1 ? ` (+${job.videos.length - 1})` : ''}`}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  {job.done > 0 && (
                    <a
                      href={`${API_URL}/api/watermark/download-all/${job.job_id}`}
                      download={`watermark_clean_${job.job_id}.zip`}
                      style={{
                        height: 28,
                        padding: '0 10px',
                        fontSize: 12,
                        background: '#fff',
                        border: '1px solid #cbd5e1',
                        borderRadius: 6,
                        color: '#334155',
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <Download size={12} /> ZIP ({job.done})
                    </a>
                  )}

                  <button
                    type="button"
                    onClick={() => {
                      setCurrentJob(job)
                      if (isImageTab) setImageQueue([])
                      else setVideoQueue([])
                    }}
                    style={{
                      height: 28,
                      padding: '0 10px',
                      fontSize: 12,
                      background: '#0f172a',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      cursor: 'pointer',
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

      {/* ── Before / After Modal ── */}
      {selectedPreviewImage && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            backgroundColor: 'rgba(15, 23, 42, 0.75)',
            backdropFilter: 'blur(4px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 20,
          }}
          onClick={() => setSelectedPreviewImage(null)}
        >
          <div
            style={{
              background: '#fff',
              borderRadius: 12,
              width: '100%',
              maxWidth: 780,
              maxHeight: '90vh',
              display: 'flex',
              flexDirection: 'column',
              boxShadow: '0 20px 25px -5px rgba(0,0,0,0.2)',
              overflow: 'hidden',
            }}
            onClick={e => e.stopPropagation()}
          >
            {/* Header */}
            <div
              style={{
                padding: '12px 18px',
                borderBottom: '1px solid #e2e8f0',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, color: '#0f172a' }}>
                So sánh ảnh: {selectedPreviewImage.item.name}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <a
                  href={`${API_URL}/api/watermark/download/${selectedPreviewImage.job_id}/${encodeURIComponent(
                    selectedPreviewImage.item.name
                  )}`}
                  download={selectedPreviewImage.item.name}
                  style={{
                    height: 28,
                    padding: '0 10px',
                    fontSize: 12,
                    background: '#0f172a',
                    color: '#fff',
                    borderRadius: 6,
                    textDecoration: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Download size={12} /> Tải ảnh sạch
                </a>
                <button
                  type="button"
                  onClick={() => setSelectedPreviewImage(null)}
                  style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4 }}
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            {/* Toggle */}
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 8,
                padding: '8px 16px',
                background: '#f8fafc',
                borderBottom: '1px solid #e2e8f0',
              }}
            >
              <button
                type="button"
                onClick={() =>
                  setSelectedPreviewImage(prev =>
                    prev ? { ...prev, previewType: 'clean' } : null
                  )
                }
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  background: selectedPreviewImage.previewType === 'clean' ? '#0f172a' : 'transparent',
                  color: selectedPreviewImage.previewType === 'clean' ? '#fff' : '#64748b',
                  cursor: 'pointer',
                }}
              >
                Ảnh đã làm sạch
              </button>
              <button
                type="button"
                onClick={() =>
                  setSelectedPreviewImage(prev =>
                    prev ? { ...prev, previewType: 'orig' } : null
                  )
                }
                style={{
                  padding: '5px 12px',
                  borderRadius: 6,
                  fontSize: 12,
                  fontWeight: 600,
                  border: 'none',
                  background: selectedPreviewImage.previewType === 'orig' ? '#0f172a' : 'transparent',
                  color: selectedPreviewImage.previewType === 'orig' ? '#fff' : '#64748b',
                  cursor: 'pointer',
                }}
              >
                Ảnh gốc có watermark
              </button>
            </div>

            {/* Preview Box */}
            <div
              style={{
                padding: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: '#0f172a',
                overflow: 'auto',
                minHeight: 360,
                maxHeight: '65vh',
              }}
            >
              <img
                src={`${API_URL}/api/watermark/preview/${selectedPreviewImage.job_id}/${encodeURIComponent(
                  selectedPreviewImage.item.name
                )}?type=${selectedPreviewImage.previewType}&t=${Date.now()}`}
                alt={selectedPreviewImage.item.name}
                style={{
                  maxWidth: '100%',
                  maxHeight: '60vh',
                  objectFit: 'contain',
                  borderRadius: 4,
                }}
              />
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
