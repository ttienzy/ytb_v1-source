import { useCallback, useEffect, useRef, useState } from 'react'
import { Clapperboard, FileText, ImagePlus, SkipForward, Zap } from 'lucide-react'
import type { VeoBridgeStatus, VeoCapabilities, VeoHistoryItem, VeoJobOut, VeoJobRequest } from './types'
import * as api from './services/veoApi'
import { TextToVideoTab } from './components/TextToVideoTab'
import { ImageToVideoTab } from './components/ImageToVideoTab'
import { ExtendTab } from './components/ExtendTab'
import { StatusTab } from './components/StatusTab'
import { VideoPlayer } from './components/VideoPlayer'
import { VideoGallery } from './components/VideoGallery'

type TabKey = 'text' | 'image' | 'extend' | 'status'
const TABS: { key: TabKey; label: string; icon: typeof FileText }[] = [
  { key: 'text', label: 'Text', icon: FileText },
  { key: 'image', label: 'Image', icon: ImagePlus },
  { key: 'extend', label: 'Extend', icon: SkipForward },
  { key: 'status', label: 'Status', icon: Zap },
]

interface Props {
  setActivePage: (page: string) => void
}

export function VeoStudioPage({ setActivePage }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('text')
  const [capabilities, setCapabilities] = useState<VeoCapabilities | null>(null)
  const [bridgeStatus, setBridgeStatus] = useState<VeoBridgeStatus | null>(null)
  const [statusLoading, setStatusLoading] = useState(false)
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
        }
      }
    }, 2000)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [activeJob?.job_id, activeJob?.status, loadHistory])

  // Submit job
  const handleSubmit = async (request: VeoJobRequest) => {
    setBusy(true)
    setMessage('')
    try {
      const job = await api.submitJob(request)
      setActiveJob(job)
      setJobs((prev) => [job, ...prev])
      setMessage(`Job ${job.job_id} đã tạo`)
    } catch (e: any) {
      setMessage(e.message || 'Tạo job thất bại')
    } finally {
      setBusy(false)
    }
  }

  const handleDeleteVideo = async (videoId: string) => {
    await api.deleteVideo(videoId)
    loadHistory()
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
      {/* Header */}
      <div className="settings-heading">
        <p className="overline">VEO AI STUDIO</p>
        <h1>
          <Clapperboard size={24} style={{ marginRight: 8, verticalAlign: 'middle' }} />
          Veo Studio
        </h1>
        <p className="page-subtitle">
          Tạo video AI với Google Flow — Text, Image, Extend.
          {bridgeStatus?.bridge_running ? (
            <span className="veo-bridge-pill online">🟢 Bridge Online</span>
          ) : (
            <span className="veo-bridge-pill offline">🔴 Bridge Offline</span>
          )}
        </p>
      </div>

      {/* Split layout */}
      <div className="veo-layout">
        {/* Sidebar */}
        <aside className="veo-sidebar">
          {/* Tab bar */}
          <div className="veo-tab-bar">
            {TABS.map((tab) => (
              <button
                key={tab.key}
                className={`veo-tab ${activeTab === tab.key ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <tab.icon size={15} />
                <span>{tab.label}</span>
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="veo-sidebar-body">
            {activeTab === 'text' && (
              <TextToVideoTab
                capabilities={capabilities}
                onSubmit={handleSubmit}
                busy={busy}
              />
            )}
            {activeTab === 'image' && (
              <ImageToVideoTab
                capabilities={capabilities}
                onSubmit={handleSubmit}
                busy={busy}
              />
            )}
            {activeTab === 'extend' && (
              <ExtendTab
                capabilities={capabilities}
                history={history}
                onSubmit={handleSubmit}
                busy={busy}
              />
            )}
            {activeTab === 'status' && (
              <StatusTab
                status={bridgeStatus}
                loading={statusLoading}
                onRefresh={loadStatus}
              />
            )}
          </div>
        </aside>

        {/* Main stage */}
        <main className="veo-main">
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
        </main>
      </div>
    </div>
  )
}
