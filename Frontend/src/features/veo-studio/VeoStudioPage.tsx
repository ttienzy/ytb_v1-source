import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, FileText, ImagePlus, SkipForward, Zap, Lock } from 'lucide-react'
import type {
  VeoBridgeStatus,
  VeoCapabilities,
  VeoHistoryItem,
  VeoJobOut,
  VeoJobRequest,
  VeoProject,
} from './types'
import * as api from './services/veoApi'
import { ProjectSelector } from './components/ProjectSelector'
import { TextToVideoTab } from './components/TextToVideoTab'
import { ImageToVideoTab } from './components/ImageToVideoTab'
import { ExtendTab } from './components/ExtendTab'
import { StatusTab } from './components/StatusTab'
import { VideoPlayer } from './components/VideoPlayer'
import { VideoGallery } from './components/VideoGallery'

type TabKey = 'text' | 'image' | 'extend' | 'status'
const TABS: { key: TabKey; label: string; icon: typeof FileText; enabled: boolean }[] = [
  { key: 'text', label: 'Text', icon: FileText, enabled: true },
  { key: 'image', label: 'Image', icon: ImagePlus, enabled: true },
  { key: 'extend', label: 'Extend', icon: SkipForward, enabled: true },
  { key: 'status', label: 'Status', icon: Zap, enabled: true },
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
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
  const handleSubmit = async (request: VeoJobRequest) => {
    if (!activeProject) {
      setMessage('⚠️ Vui lòng tạo hoặc chọn một Project trước khi tạo video')
      return
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
    } catch (e: any) {
      setMessage(e.message || 'Tạo job thất bại')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteVideo = async (videoId: string) => {
    await api.deleteVideo(videoId)
    loadHistory()
    loadProjects()
  }

  const handleSelectHistory = (item: VeoHistoryItem) => {
    // Create a synthetic "done" job for preview
    setActiveJob({
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
    })
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
              <>
                {activeTab === 'text' && (
                  <TextToVideoTab
                    capabilities={capabilities}
                    onSubmit={handleSubmit}
                    busy={busy}
                    activeProject={activeProject}
                    onBatchVideoDone={() => {
                      loadHistory()
                      loadProjects()
                    }}
                    onPreviewJob={(job) => setActiveJob(job)}
                  />
                )}
                {activeTab === 'image' && (
                  <ImageToVideoTab
                    capabilities={capabilities}
                    onSubmit={handleSubmit}
                    busy={busy}
                    activeProject={activeProject}
                  />
                )}
                {activeTab === 'extend' && (
                  <ExtendTab
                    capabilities={capabilities}
                    history={history}
                    onSubmit={handleSubmit}
                    busy={busy}
                    activeProject={activeProject}
                  />
                )}
                {activeTab === 'status' && (
                  <StatusTab
                    status={bridgeStatus}
                    loading={statusLoading}
                    onRefresh={loadStatus}
                  />
                )}
              </>
            )}
          </div>
        </section>

        {/* Inspector Panel (Player + Status + Gallery) */}
        <aside className="veo-inspector">
          {/* Player + Step Tracker */}
          <VideoPlayer
            activeJob={activeJob}
            onClose={() => setActiveJob(null)}
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
          />
        </aside>
      </div>
    </div>
  )
}
