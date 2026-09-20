import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, Video, Sparkles, Film, Activity, Download, X, Send, ImageDown, Loader2 } from 'lucide-react'
import type {
  StudioTask,
  VeoBridgeStatus,
  VeoCapabilities,
  VeoHistoryItem,
  VeoImageItem,
  VeoJobOut,
  VeoJobRequest,
  VeoProject,
} from './types'
import * as api from './services/veoApi'
import { ProjectSelector } from './components/ProjectSelector'
import { TextToVideoTab } from './components/TextToVideoTab'
import { TextToImageTab } from './components/TextToImageTab'
import { ImageToVideoTab } from './components/ImageToVideoTab'
import { StatusTab } from './components/StatusTab'
import { VideoPlayer } from './components/VideoPlayer'
import { VideoGallery } from './components/VideoGallery'
import { StudioTaskToastDock } from './components/StudioTaskToastDock'
import { StudioErrorBoundary } from './components/StudioErrorBoundary'

type TabKey = 'text' | 'image-gen' | 'image' | 'status'
const TABS: { key: TabKey; label: string; icon: typeof Video; enabled: boolean }[] = [
  { key: 'text', label: 'Tạo Video', icon: Video, enabled: true },
  { key: 'image-gen', label: 'Tạo Ảnh (Studio)', icon: Sparkles, enabled: true },
  { key: 'image', label: 'Ảnh sang Video', icon: Film, enabled: true },
  { key: 'status', label: 'Hệ Thống & Bridge', icon: Activity, enabled: true },
]

interface Props {
  setActivePage: (page: string) => void
}

export function VeoStudioPage({ setActivePage }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('text')
  const [capabilities, setCapabilities] = useState<VeoCapabilities | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<VeoBridgeStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
  const [projects, setProjects] = useState<VeoProject[]>([])
  const [activeProject, setActiveProject] = useState<VeoProject | null>(null)
  const [projectCreating, setProjectCreating] = useState(false)
  const [jobs, setJobs] = useState<VeoJobOut[]>([])
  const [activeJob, setActiveJob] = useState<VeoJobOut | null>(null)
  const [history, setHistory] = useState<VeoHistoryItem[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [forwardedImage, setForwardedImage] = useState<{ path: string; preview: string; prompt: string } | null>(null)
  const [studioTasks, setStudioTasks] = useState<StudioTask[]>([])
  const [previewImage, setPreviewImage] = useState<VeoImageItem | null>(null)
  const [previewVideo, setPreviewVideo] = useState<VeoJobOut | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Download clean image (watermark removed) via fetch + blob
  const handleDownloadClean = async (imageId: string) => {
    if (downloadingId) return
    setDownloadingId(imageId)
    setMessage('Đang xóa watermark khỏi ảnh...')
    try {
      const blob = await api.downloadCleanImage(imageId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `veo_${imageId}_clean.jpg`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setMessage('Đã xóa watermark và tải ảnh về máy.')
    } catch (err) {
      console.error('[download clean]', err)
      setMessage(err instanceof Error ? err.message : 'Xóa watermark thất bại. Vui lòng thử lại.')
    } finally {
      setDownloadingId(null)
    }
  }

  const handlePreviewJob = useCallback((job: VeoJobOut) => {
    setActiveJob(job)
    setPreviewVideo(job)
  }, [])

  const addStudioTask = useCallback((task: StudioTask) => {
    setStudioTasks((prev) => [task, ...prev.filter((t) => t.id !== task.id)])
  }, [])

  const updateStudioTask = useCallback((id: string, patch: Partial<StudioTask>) => {
    setStudioTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
  }, [])

  const removeStudioTask = useCallback((id: string) => {
    setStudioTasks((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const handleSendImageToVideo = (imageItem: VeoImageItem) => {
    setForwardedImage({
      path: imageItem.local_path || imageItem.image_url,
      preview: api.getImageFileUrl(imageItem.id),
      prompt: imageItem.prompt,
    })
    setActiveTab('image')
  }

  // Load capabilities
  useEffect(() => {
    api.getCapabilities().then(setCapabilities).catch(() => {})
  }, [])

  // Load projects from SQLite DB
  const loadProjects = useCallback(async () => {
    try {
      const list = await api.getProjects()
      setProjects(list)
      const active = await api.getActiveProject()
      setActiveProject(active)
    } catch {}
  }, [])
  useEffect(() => { loadProjects() }, [loadProjects])

  // Load history
  const loadHistory = useCallback(() => {
    api.getHistory().then(setHistory).catch(() => {})
  }, [])
  useEffect(() => { loadHistory() }, [loadHistory])

  // Load status
  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    try {
      const s = await api.getBridgeStatus()
      setBridgeStatus(s)
    } catch { /* ignore */ }
    setStatusLoading(false)
  }, [])
  useEffect(() => { loadStatus() }, [loadStatus])

  // Poll active job
  useEffect(() => {
    if (!activeJob || activeJob.status === 'done' || activeJob.status === 'error') {
      if (pollRef.current) clearInterval(pollRef.current)
      return
    }
    pollRef.current = setInterval(async () => {
      const updated = await api.getJobStatus(activeJob.job_id)
      if (updated) {
        setActiveJob(updated)
        setJobs((prev) => prev.map((j) => (j.job_id === updated.job_id ? updated : j)))
        if (updated.status === 'done' || updated.status === 'error') {
          loadHistory()
          loadProjects()
        }
      }
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeJob?.job_id, activeJob?.status, loadHistory, loadProjects])

  // Persistent video tasks polling across tab switches
  useEffect(() => {
    const activeVideoTasks = studioTasks.filter(
      (t) => t.type === 'video' && t.jobId && t.status !== 'completed' && t.status !== 'error',
    )
    if (activeVideoTasks.length === 0) return

    const interval = setInterval(async () => {
      for (const t of activeVideoTasks) {
        try {
          const job = await api.getJobStatus(t.jobId!)
          if (!job) continue

          if (job.status === 'done') {
            updateStudioTask(t.id, {
              status: 'completed',
              statusText: 'Đã hoàn tất video!',
              jobOut: job,
            })
            loadHistory()
            loadProjects()
          } else if (job.status === 'error') {
            updateStudioTask(t.id, {
              status: 'error',
              statusText: 'Lỗi tạo video',
              error: job.error_message || 'Google Flow từ chối tạo video',
              jobOut: job,
            })
          } else {
            updateStudioTask(t.id, {
              status: job.status as any,
              statusText: job.current_step || 'Đang tạo video trên Cloud...',
              jobOut: job,
            })
          }
        } catch {
          // ignore error
        }
      }
    }, 2000)

    return () => clearInterval(interval)
  }, [studioTasks, loadHistory, loadProjects, updateStudioTask])

  // Project handlers
  const handleSelectProject = async (projectId: string) => {
    try {
      const updated = await api.selectProject(projectId)
      setActiveProject(updated)
      await loadProjects()
      setMessage(`Đã kích hoạt & chuyển tab Chrome sang "${updated.name}"`)
    } catch (err: any) {
      setMessage(err.message || 'Lỗi khi chọn project')
    }
  }

  const handleCreateProject = async (name: string) => {
    setProjectCreating(true)
    setMessage('')
    try {
      const created = await api.createProject(name)
      setActiveProject(created)
      await loadProjects()
      setMessage(`Đã tạo và kích hoạt project "${created.name}" (Flow: ${created.flow_project_id.slice(0, 8)}...)`)
    } finally {
      setProjectCreating(false)
    }
  }

  const handleDeleteProject = async (projectId: string) => {
    try {
      await api.deleteProject(projectId)
      await loadProjects()
      setMessage('Đã xóa project khỏi Database')
    } catch (err: any) {
      setMessage(err.message || 'Lỗi khi xóa project')
    }
  }

  // Submit job (enforces active project)
  const handleSubmit = async (request: VeoJobRequest): Promise<VeoJobOut | null> => {
    if (!activeProject) {
      setMessage('⚠️ Vui lòng tạo hoặc chọn một Project trước khi tạo video')
      return null
    }

    setBusy(true)
    setMessage('')
    try {
      const job = await api.submitJob({
        ...request,
        project_id: activeProject.id,
      })
      setActiveJob(job)
      setJobs((prev) => [job, ...prev])
      setMessage(`Job ${job.job_id} đã tạo trong project "${activeProject.name}"`)
      return job
    } catch (e: any) {
      setMessage(e.message || 'Tạo job thất bại')
      throw e
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteVideo = async (videoId: string) => {
    await api.deleteVideo(videoId)
    loadHistory()
    loadProjects()
  }

  const [extractingVideoId, setExtractingVideoId] = useState<string | null>(null)
  const [imageRefreshTrigger, setImageRefreshTrigger] = useState(0)

  const handleSaveLastFrameToLibrary = async (video: {
    job_id?: string
    video_id?: string
    prompt?: string
    aspect_ratio?: string
  }) => {
    const vidId = video.video_id || video.job_id
    if (!vidId) return

    setExtractingVideoId(vidId)
    setMessage('Đang trích xuất frame cuối vào Thư viện...')
    try {
      const result = await api.extractLastFrame(vidId)
      if (result.ok) {
        setImageRefreshTrigger((v) => v + 1)
        setMessage('✅ Đã trích xuất và lưu frame cuối vào Thư viện Ảnh Veo!')
      } else {
        setMessage('Không thể trích xuất frame cuối từ video')
      }
    } catch (err: any) {
      setMessage(err.message || 'Lỗi trích xuất frame cuối')
    } finally {
      setExtractingVideoId(null)
    }
  }


  const handleSelectHistory = (item: VeoHistoryItem) => {
    // Create a synthetic "done" job for preview
    const job: VeoJobOut = {
      job_id: item.video_id,
      status: 'done',
      input_mode: item.input_mode as any,
      prompt: item.prompt,
      model_display_name: item.model_display_name,
      aspect_ratio: item.aspect_ratio,
      duration_seconds: item.duration_seconds,
      resolution: '720p',
      num_outputs: 1,
      current_step: 'Hoàn tất',
      error_message: null,
      output_files: [item.video_id],
      created_at: item.created_at,
      updated_at: item.created_at,
    }
    handlePreviewJob(job)
  }


  return (
    <div className="veo-studio">
      {/* Studio Header Bar */}
      <header className="veo-studio-header">
        <div className="veo-header-left">
          <div className="veo-brand-badge">
            <Clapperboard size={18} className="veo-brand-icon" />
            <span className="veo-brand-title">VEO STUDIO</span>
            <span className="veo-brand-engine">FLOW ENGINE</span>
          </div>
          <div className="veo-bridge-status-tag">
            <span className={`veo-bridge-dot ${bridgeStatus?.bridge_running ? 'online' : 'offline'}`} />
            <span className="veo-bridge-label">{bridgeStatus?.bridge_running ? 'Bridge Online' : 'Bridge Offline'}</span>
          </div>
        </div>

        <div className="veo-header-right">
          <ProjectSelector
            projects={projects}
            activeProject={activeProject}
            onSelectProject={handleSelectProject}
            onCreateProject={handleCreateProject}
            onDeleteProject={handleDeleteProject}
            creating={projectCreating}
          />
        </div>
      </header>

      {/* Studio Layout: Workspace (Left/Center 65%) vs Inspector (Right 35%) */}
      <div className="veo-layout">
        {/* Workspace: Studio Creation Center */}
        <section className="veo-workspace">
          {/* Tab bar */}
          <div className="veo-tab-bar">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className={`veo-tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
                disabled={!tab.enabled}
                title={tab.enabled ? undefined : 'Chưa có profile runtime được xác minh'}
              >
                <tab.icon size={14} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="veo-workspace-body">
            {!activeProject && activeTab !== 'status' ? (
              <div className="veo-project-required-banner">
                <div className="veo-project-required-icon">
                  <Clapperboard size={28} />
                </div>
                <h3>Chưa chọn Project làm việc</h3>
                <p>
                  Google Flow yêu cầu video phải thuộc một Project Workspace cụ thể.
                  Vui lòng bấm nút <strong>"Tạo Project"</strong> ở góc trên bên phải để bắt đầu sử dụng.
                </p>
              </div>
            ) : (
              <StudioErrorBoundary key={activeTab}>
                {activeTab === 'text' && (
                  <TextToVideoTab
                    capabilities={capabilities}
                    onSubmit={handleSubmit}
                    busy={busy}
                    activeProject={activeProject}
                    studioTasks={studioTasks.filter((t) => t.type === 'video')}
                    onRegisterTask={addStudioTask}
                    onUpdateTask={updateStudioTask}
                    onRemoveTask={removeStudioTask}
                    onBatchVideoDone={() => {
                      loadHistory()
                      loadProjects()
                    }}
                    onVideoDone={() => {
                      loadHistory()
                      loadProjects()
                    }}
                    onPreviewJob={handlePreviewJob}
                  />
                )}
                {activeTab === 'image-gen' && (
                  <TextToImageTab
                    activeProject={activeProject}
                    onSendToVideo={handleSendImageToVideo}
                    studioTasks={studioTasks.filter((t) => t.type === 'image')}
                    onRegisterTask={addStudioTask}
                    onUpdateTask={updateStudioTask}
                    onRemoveTask={removeStudioTask}
                    imageRefreshTrigger={imageRefreshTrigger}
                  />
                )}
                {activeTab === 'image' && (
                  <ImageToVideoTab
                    capabilities={capabilities}
                    onSubmit={handleSubmit}
                    busy={busy}
                    activeProject={activeProject}
                    initialImagePath={forwardedImage?.path}
                    initialImagePreview={forwardedImage?.preview}
                    initialPrompt={forwardedImage?.prompt}
                    studioTasks={studioTasks.filter((t) => t.type === 'video')}
                    onRegisterTask={addStudioTask}
                    onUpdateTask={updateStudioTask}
                    onRemoveTask={removeStudioTask}
                    onVideoDone={() => {
                      loadHistory()
                      loadProjects()
                    }}
                    onPreviewJob={handlePreviewJob}
                  />
                )}
                {activeTab === 'status' && (
                  <StatusTab
                    status={bridgeStatus}
                    loading={statusLoading}
                    onRefresh={loadStatus}
                  />
                )}
              </StudioErrorBoundary>
            )}
          </div>
        </section>

        {/* Inspector Panel (Player + Status + Gallery) */}
        <aside className="veo-inspector">
          {/* Player + Step Tracker */}
          <VideoPlayer
            activeJob={activeJob}
            onClose={() => setActiveJob(null)}
            onSaveLastFrameToLibrary={handleSaveLastFrameToLibrary}
            isExtractingFrame={Boolean(
              activeJob &&
                (extractingVideoId === activeJob.job_id ||
                  (activeJob.output_files && activeJob.output_files.includes(extractingVideoId!))),
            )}
          />

          {/* Message */}
          {message && <div className="veo-message">{message}</div>}

          {/* Gallery */}
          <VideoGallery
            items={history}
            onSelect={handleSelectHistory}
            onDelete={handleDeleteVideo}
            onSendToEditor={() => setActivePage('Video')}
            onSendToSchedule={() => setActivePage('Lên lịch Youtube')}
            onSaveLastFrameToLibrary={handleSaveLastFrameToLibrary}
            extractingVideoId={extractingVideoId}
          />

        </aside>
      </div>

      {/* Floating Bottom-Right Task Monitoring Toasts */}
      <StudioTaskToastDock
        tasks={studioTasks}
        onRemoveTask={removeStudioTask}
        onPreviewJob={handlePreviewJob}
        onPreviewImage={(img) => setPreviewImage(img)}
      />

      {/* Global Image Preview Lightbox (Accessible from toasts across any tab) */}
      {previewImage && (
        <div className="veo-lightbox-backdrop" onClick={() => setPreviewImage(null)}>
          <div className="veo-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="veo-lightbox-close"
              onClick={() => setPreviewImage(null)}
              title="Đóng (ESC)"
            >
              <X size={16} />
            </button>
            <div className="veo-lightbox-media">
              <img src={api.getImageFileUrl(previewImage.id)} alt={previewImage.prompt} />
            </div>
            <div className="veo-lightbox-info">
              <div className="veo-lightbox-meta">
                <span className="veo-lightbox-tag ratio">{previewImage.aspect_ratio}</span>
                <span className="veo-lightbox-tag model">{previewImage.model_display_name || 'Nano Banana'}</span>
              </div>
              <p className="veo-lightbox-prompt">{previewImage.prompt}</p>
              <div className="veo-lightbox-actions">
                <button
                  type="button"
                  className="veo-btn-modal-secondary"
                  disabled={downloadingId === previewImage.id}
                  onClick={() => handleDownloadClean(previewImage.id)}
                >
                  {downloadingId === previewImage.id ? (
                    <>
                      <Loader2 size={14} className="spin" />
                      <span>Đang xóa watermark…</span>
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      <span>Tải ảnh về máy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  className="veo-btn-modal-primary"
                  onClick={() => {
                    handleSendImageToVideo(previewImage)
                    setPreviewImage(null)
                  }}
                >
                  <Film size={14} />
                  <span>Tạo Video Từ Ảnh Này</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Global Video Preview Lightbox (Accessible from toasts across any tab & gallery) */}
      {previewVideo && (
        <div className="veo-lightbox-backdrop" onClick={() => setPreviewVideo(null)}>
          <div className="veo-lightbox-card" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 840 }}>
            <button
              type="button"
              className="veo-lightbox-close"
              onClick={() => setPreviewVideo(null)}
              title="Đóng (ESC)"
            >
              <X size={16} />
            </button>
            <div className="veo-lightbox-media">
              <video
                src={api.getVideoStreamUrl(previewVideo.output_files?.[0] || previewVideo.job_id)}
                controls
                autoPlay
                loop
                className="veo-lightbox-video"
              />
            </div>
            <div className="veo-lightbox-info">
              <div className="veo-lightbox-meta">
                <span className="veo-lightbox-tag ratio">{previewVideo.aspect_ratio}</span>
                <span className="veo-lightbox-tag model">{previewVideo.model_display_name}</span>
                {previewVideo.duration_seconds > 0 && (
                  <span className="veo-lightbox-tag dim">{previewVideo.duration_seconds}s</span>
                )}
                <span className="veo-lightbox-tag dim">{previewVideo.resolution || '720p'}</span>
              </div>
              <p className="veo-lightbox-prompt">{previewVideo.prompt}</p>
              <div className="veo-lightbox-actions">
                <a
                  href={api.getVideoStreamUrl(previewVideo.output_files?.[0] || previewVideo.job_id)}
                  download={`flow_video_${previewVideo.job_id}.mp4`}
                  className="veo-btn-modal-secondary"
                >
                  <Download size={14} />
                  <span>Tải video MP4</span>
                </a>
                <button
                  type="button"
                  className="veo-btn-modal-secondary"
                  disabled={extractingVideoId === (previewVideo.job_id || previewVideo.output_files?.[0])}
                  onClick={() => {
                    handleSaveLastFrameToLibrary(previewVideo)
                    setPreviewVideo(null)
                  }}
                  title="Lưu frame cuối vào Thư viện Ảnh Veo"
                >
                  <ImageDown size={14} />
                  <span>Lưu frame cuối vào Thư viện</span>
                </button>
                <button
                  type="button"
                  className="veo-btn-modal-primary"
                  onClick={() => {
                    setActivePage('Video')
                    setPreviewVideo(null)
                  }}
                >
                  <Film size={14} />
                  <span>Chuyển sang Video Editor</span>
                </button>
                <button
                  type="button"
                  className="veo-btn-modal-secondary"
                  onClick={() => {
                    setActivePage('Lên lịch Youtube')
                    setPreviewVideo(null)
                  }}
                >
                  <Send size={14} />
                  <span>Lên lịch Youtube</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
