import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Clock3,
  ExternalLink,
  Headphones,
  KeyRound,
  Layers,
  Loader2,
  Music,
  Play,
  RotateCcw,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  Video,
  Volume2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import type { BgmOut } from '../bgm/types'
import type { Voice } from '../voices/types'
import { AudioWorkflowPanel } from './audio/AudioWorkflowPanel'
import { BatchQueuePanel } from './components/BatchQueuePanel'
import { PipelineDiagram } from './components/PipelineDiagram'
import { JOB_LOST_MSG, isJobLost, isOffline } from './pollState'
import { VideoResultCard } from './components/VideoResultCard'
import type { JobOut } from './types'
import './StudioYoutube.css'

const YOUTUBE_AUDIO_CONFIG_KEY = 'yt_workflow_audio_config'

interface SavedAudioConfig {
  voiceId?: string
  bgmEnabled?: boolean
  bgmIds?: string[]
  bgmVolume?: number
}

function getSavedAudioConfig(): SavedAudioConfig {
  try {
    const raw = localStorage.getItem(YOUTUBE_AUDIO_CONFIG_KEY)
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function saveAudioConfig(cfg: SavedAudioConfig) {
  try {
    localStorage.setItem(YOUTUBE_AUDIO_CONFIG_KEY, JSON.stringify(cfg))
  } catch {}
}

function YoutubeIcon({ size = 16, style, className }: { size?: number; style?: React.CSSProperties; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      style={style}
      className={className}
    >
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

export function StudioPage({
  setActivePage,
  initialUrls,
}: {
  setActivePage: (p: string) => void
  initialUrls?: string[]
}) {
  const initialCfg = useMemo(() => getSavedAudioConfig(), [])
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [rawText, setRawText] = useState('')
  const [rawFile, setRawFile] = useState<File | null>(null)
  const [voiceId, setVoiceId] = useState(initialCfg.voiceId || '')
  const [clonedVoices, setClonedVoices] = useState<Voice[]>([])
  const [bgmList, setBgmList] = useState<BgmOut[]>([])
  const [bgmEnabled, setBgmEnabled] = useState(initialCfg.bgmEnabled !== undefined ? initialCfg.bgmEnabled : true)
  const [bgmIds, setBgmIds] = useState<string[]>(initialCfg.bgmIds || [])
  const [bgmVolume, setBgmVolume] = useState(initialCfg.bgmVolume !== undefined ? initialCfg.bgmVolume : 0.5)
  const [showRawTranscript, setShowRawTranscript] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<JobOut | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'single' | 'batch'>(initialUrls && initialUrls.length > 0 ? 'batch' : 'single')
  const [selectedWorkflow, setSelectedWorkflow] = useState<'youtube' | 'audio'>('youtube')
  const [audioMounted, setAudioMounted] = useState(false)
  useEffect(() => { if (selectedWorkflow === 'audio') setAudioMounted(true) }, [selectedWorkflow])
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  // Job biến mất khỏi backend (restart) / backend không phản hồi: báo rõ thay vì giữ trạng thái cũ mãi mãi.
  const [jobLost, setJobLost] = useState(false)
  const [offline, setOffline] = useState(false)
  const pollFailsRef = useRef(0)

  useEffect(() => {
    if (initialUrls && initialUrls.length > 0) {
      setMode('batch')
    }
  }, [initialUrls])

  // YouTube Bot-Wall Login State
  const [ytLoggingIn, setYtLoggingIn] = useState(false)
  const [ytLoginMsg, setYtLoginMsg] = useState('')
  const [resumingJob, setResumingJob] = useState(false)

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
    setYtLoginMsg('Đang mở Chrome để bạn đăng nhập YouTube... Vui lòng đăng nhập trên cửa sổ Chrome vừa mở.')
    try {
      const response = await fetch(`${API_URL}/api/recap/yt/login`, {
        method: 'POST',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Đăng nhập thất bại')
      setYtLoginMsg('Đã đăng nhập và lưu Cookie YouTube thành công! Đang tự động tiếp tục tiến trình...')
      if (job?.job_id) {
        setTimeout(() => handleResumeJob(), 1200)
      }
    } catch (error: any) {
      setYtLoginMsg(error instanceof Error ? error.message : 'Đăng nhập thất bại.')
    } finally {
      setYtLoggingIn(false)
    }
  }

  async function handleResumeJob() {
    if (!job?.job_id) return
    setResumingJob(true)
    try {
      // Gửi giọng đang chọn làm dự phòng (job cũ không lưu giọng); backend ưu tiên giọng đã lưu của job.
      const response = await fetch(`${API_URL}/api/recap/jobs/${job.job_id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ voice_id: voiceId || null }),
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Lỗi khi tiếp tục tiến trình')
      }
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(() => pollJob(job.job_id), 1500)
      pollJob(job.job_id)
    } catch (error: any) {
      alert(error instanceof Error ? error.message : 'Lỗi khi thử lại tiến trình.')
    } finally {
      setResumingJob(false)
    }
  }

  // Auto-save audio config to localStorage whenever changed
  useEffect(() => {
    saveAudioConfig({
      voiceId,
      bgmEnabled,
      bgmIds,
      bgmVolume,
    })
  }, [voiceId, bgmEnabled, bgmIds, bgmVolume])

  // Load voices + bgm on mount & restore user selection
  useEffect(() => {
    const saved = getSavedAudioConfig()
    fetch(`${API_URL}/api/voices`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => {
        const list: Voice[] = d.voices ?? d ?? []
        setClonedVoices(list)
        if (saved.voiceId && list.some(v => v.voice_id === saved.voiceId)) {
          setVoiceId(saved.voiceId)
        } else if (!voiceId && list.length) {
          setVoiceId(list[0].voice_id)
        }
      })
      .catch(() => {})

    fetch(`${API_URL}/api/bgm`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: BgmOut[]) => {
        const list = d ?? []
        setBgmList(list)
        if (saved.bgmIds && Array.isArray(saved.bgmIds) && saved.bgmIds.length > 0) {
          const validSavedIds = saved.bgmIds.filter(id => list.some(t => t.track_id === id))
          if (validSavedIds.length > 0) {
            setBgmIds(validSavedIds)
            return
          }
        }
        // Fallback chọn tất cả chỉ khi chưa từng có cấu hình đã lưu
        if (list.length > 0 && bgmIds.length === 0) {
          setBgmIds(list.map(t => t.track_id))
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line

  // Poll loop
  const pollJob = useCallback(async (id: string) => {
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs/${id}`)
      pollFailsRef.current = 0
      setOffline(false)
      if (isJobLost(r.status)) {
        // Backend không còn job này (khởi động lại giữa chừng) → dừng poll + dừng đồng hồ, báo cách xử lý.
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
        setJobLost(true)
        setJob(prev => (prev ? { ...prev, overall: 'error', error: JOB_LOST_MSG } : prev))
        return
      }
      if (!r.ok) return
      const data: JobOut = await r.json()
      setJob(data)
      // Stop polling when pipeline fully done or error
      if (
        data.overall === 'merged' ||
        data.overall === 'polished' ||
        data.overall === 'error'
      ) {
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }
    } catch {
      /* network hiccup — keep polling; nhiều lần liên tiếp thì hiện cảnh báo mất kết nối */
      pollFailsRef.current += 1
      if (isOffline(pollFailsRef.current)) setOffline(true)
    }
  }, [])

  useEffect(() => {
    if (!jobId) return
    pollRef.current = setInterval(() => pollJob(jobId), 1500)
    pollJob(jobId)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [jobId, pollJob])

  async function startPipeline() {
    if (!youtubeUrl.trim()) {
      setSubmitError('Dán link YouTube.')
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
    setJob(null)
    setJobLost(false)
    setOffline(false)
    pollFailsRef.current = 0
    try {
      const form = new FormData()
      form.append('youtube_url', youtubeUrl.trim())
      form.append('voice_id', voiceId)
      if (rawFile)
        form.append('raw_file', rawFile) // file đính kèm → skip auto-fetch (ưu tiên)
      else if (rawText.trim())
        form.append('raw_text', rawText) // dán text → skip auto-fetch
      if (bgmEnabled && bgmIds.length) {
        form.append('bgm_ids', JSON.stringify(bgmIds))
        form.append('bgm_volume', String(bgmVolume))
      }
      const r = await fetch(`${API_URL}/api/recap/run`, {
        method: 'POST',
        body: form,
      })
      const data = await r.json()
      if (!r.ok)
        throw new Error(data.detail || data.error || `Lỗi ${r.status}`)
      setJobId(data.job_id)
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : 'Khởi động pipeline thất bại.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setJobId(null)
    setJob(null)
    setJobLost(false)
    setOffline(false)
    pollFailsRef.current = 0
    setSubmitError('')
    setRawText('')
    setRawFile(null)
    setYoutubeUrl('')
    // Giữ nguyên cấu hình Giọng đọc (voiceId) và Nhạc nền (bgmEnabled, bgmIds, bgmVolume) đã chọn
  }

  const allSegs = (job?.recap?.scenes ?? []).flatMap(s => s.segments)

  return (
    <section className="settings-page studio-page">
      {/* ── Workflow Navigation Tabs ── */}
      <div className="workflow-tab-switcher" role="tablist" aria-label="Chọn workflow">
        <button
          type="button"
          role="tab"
          aria-selected={selectedWorkflow === 'youtube'}
          className={`workflow-tab-btn ${selectedWorkflow === 'youtube' ? 'active' : ''}`}
          onClick={() => setSelectedWorkflow('youtube')}
        >
          <YoutubeIcon size={14} className="workflow-tab-icon" />
          <span>Workflow YouTube</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={selectedWorkflow === 'audio'}
          className={`workflow-tab-btn ${selectedWorkflow === 'audio' ? 'active' : ''}`}
          onClick={() => setSelectedWorkflow('audio')}
        >
          <Headphones size={14} className="workflow-tab-icon" />
          <span>Workflow Audio</span>
        </button>
      </div>

      {selectedWorkflow === 'youtube' ? (
        <>
      {/* ── Input form ── */}
      <div className="settings-card" id="formCard">
        {/* Tab toggle: Đơn lẻ / Hàng loạt */}
        <div className="batch-tab-group">
          <button
            type="button"
            id="tab-single"
            className={`batch-tab-btn ${mode === 'single' ? 'active' : ''}`}
            onClick={() => setMode('single')}
          >
            <Play size={13} />
            Đơn lẻ (1 video)
          </button>
          <button
            type="button"
            id="tab-batch"
            className={`batch-tab-btn ${mode === 'batch' ? 'active' : ''}`}
            onClick={() => setMode('batch')}
          >
            <Layers size={13} />
            Hàng loạt (Queue tối đa 10)
          </button>
        </div>

        {mode === 'single' ? (
          <>
            <div className="yt-workflow-columns">
              {/* CỘT TRÁI: NGUỒN VIDEO & KỊCH BẢN */}
              <div className="yt-workflow-col">
                <div className="yt-section-header">
                  <Video size={15} />
                  <span>Nguồn Video &amp; Kịch Bản</span>
                </div>

                <div className="yt-field">
                  <label className="yt-label">
                    <YoutubeIcon size={14} style={{ color: '#ef4444' }} />
                    <span>Link YouTube</span>
                  </label>
                  <input
                    className="yt-input"
                    value={youtubeUrl}
                    onChange={e => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    disabled={Boolean(jobId)}
                  />
                </div>

                {/* Raw transcript collapsible drawer */}
                <div className="yt-raw-accordion">
                  <button
                    type="button"
                    className="yt-raw-toggle"
                    onClick={() => setShowRawTranscript(prev => !prev)}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                      {showRawTranscript || rawFile || rawText.trim() ? (
                        <ChevronUp size={13} />
                      ) : (
                        <ChevronDown size={13} />
                      )}
                      <span>Đính kèm raw transcript</span>
                      <small>(tùy chọn khi YouTube chặn auto-fetch)</small>
                    </div>
                    {(rawFile || rawText.trim()) && (
                      <span className="yt-raw-attached-badge">
                        {rawFile ? rawFile.name : `${rawText.length.toLocaleString()} ký tự`}
                      </span>
                    )}
                  </button>

                  {(showRawTranscript || rawFile || rawText.trim()) && (
                    <div className="yt-raw-body">
                      <div className="raw-row">
                        <label
                          className="file-trig"
                          style={{
                            opacity: jobId ? 0.5 : 1,
                            pointerEvents: jobId ? 'none' : 'auto',
                          }}
                        >
                          <Upload size={14} />
                          <span className="fname">
                            {rawFile ? rawFile.name : 'Đính kèm raw.txt'}
                          </span>
                          {rawFile && (
                            <span className="fsize">
                              · {(rawFile.size / 1024).toFixed(0)} KB
                            </span>
                          )}
                          <input
                            type="file"
                            accept=".txt,.json"
                            style={{ display: 'none' }}
                            onChange={e => setRawFile(e.target.files?.[0] ?? null)}
                          />
                          <span
                            style={{
                              marginLeft: 'auto',
                              fontSize: 11,
                              color: 'var(--indigo2)',
                            }}
                          >
                            {rawFile ? 'Đổi ↑' : 'File ↑'}
                          </span>
                        </label>
                        {rawFile && (
                          <button
                            type="button"
                            className="raw-clear"
                            onClick={() => setRawFile(null)}
                          >
                            ✕ huỷ file
                          </button>
                        )}
                      </div>
                      <textarea
                        className="raw-input"
                        value={rawText}
                        onChange={e => setRawText(e.target.value)}
                        placeholder={
                          rawFile
                            ? 'Đã đính kèm file — text ở đây bị bỏ qua'
                            : 'Hoặc dán transcript tại đây (mỗi dòng [MM:SS] caption). Bỏ trống cả 2 → tự lấy từ YouTube.'
                        }
                        rows={2}
                        disabled={Boolean(jobId) || Boolean(rawFile)}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* CỘT PHẢI: GIỌNG ĐỌC & NHẠC NỀN */}
              <div className="yt-workflow-col">
                <div className="yt-section-header">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Volume2 size={15} />
                    <span>Giọng Đọc &amp; Nhạc Nền</span>
                  </div>
                  <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="yt-saved-indicator">✓ Đã lưu</span>
                    <button
                      type="button"
                      className="yt-reset-btn"
                      title="Chọn lại tất cả bài hát và đặt lại âm lượng 10%"
                      onClick={() => {
                        if (bgmList.length > 0) setBgmIds(bgmList.map(t => t.track_id))
                        setBgmVolume(0.1)
                        setBgmEnabled(true)
                        if (clonedVoices.length > 0) setVoiceId(clonedVoices[0].voice_id)
                      }}
                    >
                      Đặt lại
                    </button>
                  </div>
                </div>

                <div className="yt-field">
                  <label className="yt-label">Giọng đọc (Voice)</label>
                  {clonedVoices.length === 0 ? (
                    <p className="settings-message" style={{ marginTop: 2, fontSize: 12 }}>
                      Chưa có giọng — tạo ở Voices trước.
                    </p>
                  ) : (
                    <select
                      className="yt-select"
                      value={voiceId}
                      onChange={e => setVoiceId(e.target.value)}
                      disabled={Boolean(jobId)}
                    >
                      {clonedVoices.map(v => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>

                <div className="yt-bgm-block">
                  <label className="yt-bgm-toggle">
                    <input
                      type="checkbox"
                      checked={bgmEnabled}
                      onChange={e => setBgmEnabled(e.target.checked)}
                      disabled={Boolean(jobId)}
                    />
                    <Music size={14} />
                    <span>Nhạc nền (BGM)</span>
                  </label>

                  {bgmEnabled && (
                    <div className="yt-bgm-body">
                      {bgmList.length === 0 ? (
                        <p className="bgm-empty">
                          Chưa có track — thêm ở “Thư viện nhạc”.
                        </p>
                      ) : (
                        <div className="yt-bgm-chips">
                          {bgmList.map(t => {
                            const order = bgmIds.indexOf(t.track_id)
                            const on = order >= 0
                            return (
                              <button
                                key={t.track_id}
                                type="button"
                                className={`chip${on ? ' chip-active' : ''}`}
                                disabled={Boolean(jobId)}
                                onClick={() =>
                                  setBgmIds(prev =>
                                    on
                                      ? prev.filter(x => x !== t.track_id)
                                      : [...prev, t.track_id]
                                  )
                                }
                              >
                                {on && (
                                  <span className="chip-order">{order + 1}. </span>
                                )}
                                {t.name}
                                {t.duration_sec
                                  ? ` · ${t.duration_sec.toFixed(0)}s`
                                  : ''}
                                {t.needs_attribution ? ' · CC' : ''}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      <div className="yt-bgm-vol-row">
                        <span>Âm lượng: {(bgmVolume * 100).toFixed(0)}%</span>
                        <input
                          type="range"
                          className="yt-bgm-slider"
                          min={0}
                          max={0.5}
                          step={0.01}
                          value={bgmVolume}
                          onChange={e => setBgmVolume(parseFloat(e.target.value))}
                          disabled={Boolean(jobId)}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer buttons (Đơn lẻ) */}
            <div className="yt-workflow-footer">
              {!jobId ? (
                <button
                  type="button"
                  className="studio-btn-primary"
                  onClick={startPipeline}
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Sparkles size={15} />
                  )}
                  {submitting ? 'Đang khởi động…' : 'Bắt đầu tạo recap video'}
                </button>
              ) : (
                <button type="button" className="btn-g" onClick={reset}>
                  <Trash2 size={14} /> Bắt đầu lại
                </button>
              )}
              <button
                type="button"
                className="btn-g"
                onClick={() => setActivePage('Lịch sử')}
                style={{ gap: 6 }}
              >
                <Clock3 size={14} /> Xem Lịch sử
              </button>
              {submitError && (
                <span style={{ color: '#dc2626', fontSize: 12 }}>
                  <AlertCircle
                    size={13}
                    style={{ display: 'inline', marginRight: 4 }}
                  />
                  {submitError}
                </span>
              )}
              {job && !submitting && (
                <span
                  className="hint"
                  style={{
                    marginLeft: 'auto',
                    color:
                      job.overall === 'error'
                        ? '#dc2626'
                        : job.overall === 'merged' || job.overall === 'polished'
                        ? '#16a34a'
                        : '#6366f1',
                  }}
                >
                  {job.overall === 'polished'
                    ? 'Hoàn tất (có BGM)'
                    : job.overall === 'merged'
                    ? 'Hoàn tất'
                    : job.overall === 'error'
                    ? 'Có lỗi'
                    : '⟳ Đang chạy…'}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            {/* GIỌNG & NHẠC (Batch) */}
            <div className="yt-workflow-columns" style={{ marginBottom: 16 }}>
              <div className="yt-workflow-col">
                <div className="yt-section-header">
                  <Volume2 size={15} />
                  <span>Giọng Đọc (Batch)</span>
                </div>
                <div className="yt-field">
                  <label className="yt-label">Giọng đọc dùng chung</label>
                  {clonedVoices.length === 0 ? (
                    <p className="settings-message" style={{ marginTop: 2, fontSize: 12 }}>
                      Chưa có giọng — tạo ở Voices trước.
                    </p>
                  ) : (
                    <select
                      className="yt-select"
                      value={voiceId}
                      onChange={e => setVoiceId(e.target.value)}
                    >
                      {clonedVoices.map(v => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              </div>

              <div className="yt-workflow-col">
                <div className="yt-section-header">
                  <Music size={15} />
                  <span>Nhạc Nền (Batch)</span>
                </div>
                <div className="yt-bgm-block">
                  <label className="yt-bgm-toggle">
                    <input
                      type="checkbox"
                      checked={bgmEnabled}
                      onChange={e => setBgmEnabled(e.target.checked)}
                    />
                    <span>Phối nhạc nền BGM tự động</span>
                  </label>
                  {bgmEnabled && (
                    <div className="yt-bgm-body">
                      {bgmList.length > 0 && (
                        <div className="yt-bgm-chips">
                          {bgmList.map(t => {
                            const order = bgmIds.indexOf(t.track_id)
                            const on = order >= 0
                            return (
                              <button
                                key={t.track_id}
                                type="button"
                                className={`chip${on ? ' chip-active' : ''}`}
                                onClick={() =>
                                  setBgmIds(prev =>
                                    on
                                      ? prev.filter(x => x !== t.track_id)
                                      : [...prev, t.track_id]
                                  )
                                }
                              >
                                {on && <span className="chip-order">{order + 1}. </span>}
                                {t.name}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      <div className="yt-bgm-vol-row">
                        <span>Âm lượng: {(bgmVolume * 100).toFixed(0)}%</span>
                        <input
                          type="range"
                          className="yt-bgm-slider"
                          min={0}
                          max={0.5}
                          step={0.01}
                          value={bgmVolume}
                          onChange={e => setBgmVolume(parseFloat(e.target.value))}
                        />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Batch Panel (Textarea danh sách link + Nút chạy + Status list) */}
            <BatchQueuePanel
              voiceId={voiceId}
              bgmEnabled={bgmEnabled}
              bgmIds={bgmIds}
              bgmVolume={bgmVolume}
              disabled={false}
              setActivePage={setActivePage}
              initialUrls={initialUrls}
            />
          </>
        )}
      </div>

      {/* ── Pipeline diagram ── */}
      {job && (
        <div className="pc">
          <PipelineDiagram
            job={job}
            voiceId={voiceId}
            polishEnabled={bgmEnabled && bgmIds.length > 0}
          />

          {offline && !jobLost && (
            <div className="err-block" style={{ marginBottom: 10 }}>
              <AlertCircle size={15} style={{ flexShrink: 0 }} />
              <span>Mất kết nối với backend — đang thử lại. Job vẫn có thể đang chạy.</span>
            </div>
          )}

          {/* Error detail */}
          {job.overall === 'error' && job.error && (
            isYouTubeBotWallError(job.error) ? (
              <div
                style={{
                  marginTop: 16,
                  padding: 16,
                  background: '#fff1f2',
                  border: '1.5px solid #fecdd3',
                  borderRadius: 12,
                  color: '#9f1239',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
                  <AlertTriangle size={18} color="#e11d48" />
                  <span>YouTube yêu cầu xác thực tài khoản (Bot-Wall)</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
                  YouTube phát hiện lưu lượng tải video tự động và chặn bằng yêu cầu <em>"Sign in to confirm you're not a bot"</em>. Bạn cần đăng nhập tài khoản YouTube để cập nhật Cookie.
                </div>

                {ytLoginMsg && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: ytLoginMsg.startsWith('Đã đăng nhập') ? '#f0fdf4' : '#fff',
                      border: '1px solid',
                      borderColor: ytLoginMsg.startsWith('Đã đăng nhập') ? '#bbf7d0' : '#fecdd3',
                      fontSize: 12,
                      color: ytLoginMsg.startsWith('Đã đăng nhập') ? '#166534' : '#be123c',
                    }}
                  >
                    {ytLoginMsg}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-p"
                    onClick={handleLoginYouTube}
                    disabled={ytLoggingIn}
                    style={{
                      background: '#e11d48',
                      height: 36,
                      padding: '0 14px',
                      fontSize: 12.5,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {ytLoggingIn ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}
                    {ytLoggingIn ? 'Đang mở Chrome…' : 'Đăng nhập YouTube qua Chrome'}
                  </button>

                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setActivePage('Cài đặt')}
                    style={{ height: 36, padding: '0 12px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <Settings size={14} /> Chuyển đến trang Cài đặt
                  </button>

                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={handleResumeJob}
                    disabled={resumingJob || ytLoggingIn}
                    style={{ height: 36, padding: '0 12px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    {resumingJob ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
                    Thử lại tiến trình
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="err-block">
                  <AlertCircle size={15} style={{ flexShrink: 0 }} />
                  <span>{job.error}</span>
                </div>
                {/* Chạy tiếp từ bước lỗi (transcript/recap, cut, voice, merge, polish) — bước đã xong giữ nguyên.
                    Job đã mất khỏi backend thì không có gì để chạy tiếp → chỉ còn "Bắt đầu lại". */}
                {!jobLost && (
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={handleResumeJob}
                  disabled={resumingJob}
                  style={{ marginTop: 10, height: 36, padding: '0 12px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                >
                  {resumingJob ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
                  Thử lại từ bước lỗi
                </button>
                )}
              </>
            )
          )}

          {/* Final block — polished (BGM) */}
          {(job.overall === 'polished' || job.overall === 'merged') &&
            job.job_id && (
              <VideoResultCard
                jobId={job.job_id}
                variant={job.overall === 'polished' ? 'polished' : 'merged'}
                segments={allSegs.length}
                scenes={job.recap?.scenes?.length ?? 0}
                overspeedCount={job.overspeed?.length}
                credits={job.overall === 'polished' ? job.credits : null}
                caption={job.caption || job.recap?.caption}
                onReset={reset}
              />
            )}
        </div>
      )}
        </>
      ) : null}

      {/* Mount lần đầu khi mở tab Audio rồi giữ nguyên (ẩn) để không mất job đang chạy khi chuyển tab */}
      {audioMounted && (
        <div hidden={selectedWorkflow !== 'audio'}>
          <AudioWorkflowPanel />
        </div>
      )}
    </section>
  )
}
