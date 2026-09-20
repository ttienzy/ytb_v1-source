import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  Clock3,
  ExternalLink,
  HardDriveUpload,
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
  X,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import type { BgmOut } from '../bgm/types'
import type { Voice } from '../voices/types'
import { BatchQueuePanel } from './components/BatchQueuePanel'
import { PipelineDiagram } from './components/PipelineDiagram'
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
  const [bgmVolume, setBgmVolume] = useState(initialCfg.bgmVolume !== undefined ? initialCfg.bgmVolume : 0.1)
  const [showRawTranscript, setShowRawTranscript] = useState(false)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<JobOut | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'single' | 'batch'>(initialUrls && initialUrls.length > 0 ? 'batch' : 'single')
  const [selectedWorkflow, setSelectedWorkflow] = useState<'youtube' | 'audio'>('youtube')
  const [audioStories, setAudioStories] = useState<Array<{ story_slug: string; name: string; thumbnail_name?: string | null; chapters: Array<{ chapter_number: number; title: string; completed?: boolean; drive_uploaded?: boolean }> }>>([])
  const [audioStory, setAudioStory] = useState('')
  const [audioChapter, setAudioChapter] = useState<number | ''>('')
  const [audioMode, setAudioMode] = useState<'single' | 'batch'>('single')
  const [audioQueueFilter, setAudioQueueFilter] = useState<'all' | 'completed' | 'pending' | 'active'>('all')
  const [audioBatchQueue, setAudioBatchQueue] = useState<Array<{ story_slug: string; chapter_numbers: number[] }>>([])
  const [audioThumbnailBusy, setAudioThumbnailBusy] = useState(false)
  const [audioVoice, setAudioVoice] = useState('')
  const [audioPresets, setAudioPresets] = useState<Array<{ name: string; description?: string }>>([])
  const [audioAspect, setAudioAspect] = useState<'9:16' | '16:9'>('9:16')
  const [audioBgmEnabled, setAudioBgmEnabled] = useState(true)
  const [audioAutoUploadDrive, setAudioAutoUploadDrive] = useState(false)
  const [audioJob, setAudioJob] = useState<Record<string, any> | null>(null)
  const [audioOutputs, setAudioOutputs] = useState<Array<{ file_name: string; name: string; duration_sec: number; created_at: string; story_name?: string; chapter_number?: number; chapter_title?: string; thumbnail_name?: string | null }>>([])
  const [selectedAudioOutputStory, setSelectedAudioOutputStory] = useState<string | null>(null)
  const [audioDriveOpen, setAudioDriveOpen] = useState(false)
  const [audioDriveMode, setAudioDriveMode] = useState<'upload' | 'delete'>('upload')
  const [audioDriveSelected, setAudioDriveSelected] = useState<string[]>([])
  const [audioDriveAutoDelete, setAudioDriveAutoDelete] = useState(true)
  const [audioDriveProgress, setAudioDriveProgress] = useState<Array<{ file_name: string; status: string; percent: number; error?: string }>>([])
  const [audioDriveBusy, setAudioDriveBusy] = useState(false)
  const [audioError, setAudioError] = useState('')
  const [audioBusy, setAudioBusy] = useState(false)
  const [audioTestText, setAudioTestText] = useState('')
  const [audioTestBusy, setAudioTestBusy] = useState(false)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

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
      setYtLoginMsg('✅ Đã đăng nhập và lưu Cookie YouTube thành công! Đang tự động tiếp tục tiến trình...')
      if (job?.job_id) {
        setTimeout(() => handleResumeJob(), 1200)
      }
    } catch (error: any) {
      setYtLoginMsg(`❌ ${error instanceof Error ? error.message : 'Đăng nhập thất bại.'}`)
    } finally {
      setYtLoggingIn(false)
    }
  }

  async function handleResumeJob() {
    if (!job?.job_id) return
    setResumingJob(true)
    try {
      const response = await fetch(`${API_URL}/api/recap/jobs/${job.job_id}/resume`, {
        method: 'POST',
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

  useEffect(() => {
    if (selectedWorkflow !== 'audio') return
    fetch(`${API_URL}/api/audio/stories`).then(r => r.json()).then((items) => {
      setAudioStories(items)
      if (!audioStory && items[0]) { setAudioStory(items[0].story_slug); setAudioChapter(items[0].chapters[0]?.chapter_number ?? '') }
    }).catch(() => setAudioError('Không tải được danh sách truyện đã crawl.'))
    fetch(`${API_URL}/api/voices`).then(r => r.json()).then(d => { const list = d.voices ?? d ?? []; if (!audioVoice && list[0]) setAudioVoice(list[0].voice_id) }).catch(() => {})
    fetch(`${API_URL}/api/voices/presets`).then(r => r.json()).then(list => { setAudioPresets(list); if (!audioVoice && !clonedVoices.length && list[0]) setAudioVoice(list[0].name) }).catch(() => {})
    fetch(`${API_URL}/api/audio/outputs`).then(r => r.json()).then(setAudioOutputs).catch(() => {})
  }, [selectedWorkflow]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!audioJob?.job_id || audioJob.status === 'completed' || audioJob.status === 'error') return
    const timer = window.setInterval(async () => {
      const response = await fetch(`${API_URL}/api/audio/jobs/${audioJob.job_id}`)
      if (response.ok) {
        const next = await response.json(); setAudioJob(next)
        if (next.status === 'completed' || next.status === 'error') {
          window.clearInterval(timer)
          if (next.status === 'completed') fetch(`${API_URL}/api/audio/outputs`).then(r => r.json()).then(setAudioOutputs)
        }
      }
    }, 1000)
    return () => window.clearInterval(timer)
  }, [audioJob?.job_id, audioJob?.status])

  const selectedAudioStory = audioStories.find(s => s.story_slug === audioStory)
  const sortedAudioStories = useMemo(() => [...audioStories].sort((a, b) => {
    const aDone = a.chapters.length > 0 && a.chapters.every(chapter => chapter.completed)
    const bDone = b.chapters.length > 0 && b.chapters.every(chapter => chapter.completed)
    if (aDone !== bDone) return aDone ? 1 : -1
    return a.name.localeCompare(b.name, 'vi')
  }), [audioStories])
  const sortedAudioChapters = useMemo(() => selectedAudioStory ? [...selectedAudioStory.chapters].sort((a, b) => {
    if (a.completed !== b.completed) return a.completed ? 1 : -1
    return a.chapter_number - b.chapter_number
  }) : [], [selectedAudioStory])
  const audioOutputGroups = useMemo(() => {
    const groups = new Map<string, typeof audioOutputs>()
    audioOutputs.forEach(item => {
      const story = item.story_name || 'Video Audio khác'
      groups.set(story, [...(groups.get(story) || []), item])
    })
    return Array.from(groups, ([story_name, videos]) => ({ story_name, videos }))
  }, [audioOutputs])
  function openAudioDrive(mode: 'upload' | 'delete') {
    setAudioDriveMode(mode)
    setAudioDriveAutoDelete(true)
    const files = audioOutputGroups.flatMap(group => group.videos.map(video => video.file_name))
    setAudioDriveSelected(files)
    setAudioDriveProgress(files.map(file_name => ({ file_name, status: 'queued', percent: 0 })))
    setAudioDriveOpen(true)
  }
  async function submitAudioDriveAction() {
    if (!audioDriveSelected.length) return
    setAudioDriveBusy(true)
    try {
      const endpoint = audioDriveMode === 'upload' ? '/api/audio/outputs/upload-drive' : '/api/audio/outputs/delete-local'
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ file_names: audioDriveSelected, ...(audioDriveMode === 'upload' ? { auto_delete_local: audioDriveAutoDelete } : {}) }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Không thể xử lý video.')
      if (audioDriveMode === 'upload') {
        let status = data
        setAudioDriveProgress(status.items || [])
        while (status.status !== 'completed') {
          await new Promise(resolve => setTimeout(resolve, 500))
          const statusResponse = await fetch(`${API_URL}/api/audio/outputs/upload-drive/${data.job_id}`)
          if (!statusResponse.ok) throw new Error('Không thể đọc tiến độ upload.')
          status = await statusResponse.json()
          setAudioDriveProgress(status.items || [])
        }
        const failed = (status.items || []).filter((item: { status: string; error?: string }) => item.status === 'error')
        setAudioError(failed.length ? `${failed.length} video upload lỗi: ${failed[0].error}` : '')
      } else {
        setAudioError('')
      }
      const latest = await fetch(`${API_URL}/api/audio/outputs`)
      if (latest.ok) setAudioOutputs(await latest.json())
      setAudioDriveOpen(false)
    } catch (error) {
      setAudioError(error instanceof Error ? error.message : 'Không thể xử lý video Audio.')
    } finally {
      setAudioDriveBusy(false)
    }
  }
  const completedChaptersForStory = (storyName: string) => {
    const story = audioStories.find(item => item.name === storyName)
    const fromHistory = story?.chapters.filter(chapter => chapter.completed).map(chapter => chapter.chapter_number) || []
    const fromLocal = audioOutputs.filter(item => item.story_name === storyName && item.chapter_number).map(item => item.chapter_number as number)
    return new Set([...fromHistory, ...fromLocal])
  }
  const isStoryCompleted = (story: typeof audioStories[number]) => story.chapters.length > 0 && story.chapters.every(chapter => completedChaptersForStory(story.name).has(chapter.chapter_number))
  const filteredAudioStories = useMemo(() => sortedAudioStories.filter(story => {
    const completed = isStoryCompleted(story)
    const active = audioBatchQueue.some(item => item.story_slug === story.story_slug) || audioJob?.current_story === story.name
    if (audioQueueFilter === 'completed') return completed
    if (audioQueueFilter === 'pending') return !completed && !active
    if (audioQueueFilter === 'active') return active
    return true
  }), [sortedAudioStories, audioQueueFilter, audioBatchQueue, audioJob?.current_story, audioOutputs, audioStories])
  const isStoryQueued = (storySlug: string) => audioBatchQueue.some(item => item.story_slug === storySlug)
  const toggleBatchStory = (story: typeof audioStories[number]) => {
    setAudioBatchQueue(current => {
      const existing = current.find(item => item.story_slug === story.story_slug)
      if (existing) return current.filter(item => item.story_slug !== story.story_slug)
      if (current.length >= 10) return current
      const completed = completedChaptersForStory(story.name)
      const chapters = story.chapters.filter(chapter => !completed.has(chapter.chapter_number)).map(chapter => chapter.chapter_number)
      return chapters.length ? [...current, { story_slug: story.story_slug, chapter_numbers: chapters }] : current
    })
  }
  const toggleBatchChapter = (storySlug: string, chapterNumber: number) => {
    setAudioBatchQueue(current => current.map(item => {
      if (item.story_slug !== storySlug) return item
      const chapter_numbers = item.chapter_numbers.includes(chapterNumber) ? item.chapter_numbers.filter(number => number !== chapterNumber) : [...item.chapter_numbers, chapterNumber]
      return { ...item, chapter_numbers }
    }).filter(item => item.chapter_numbers.length > 0))
  }
  const audioStepState = (key: string) => {
    if (!audioJob) return 'pending'
    const order = ['voice', 'duration', 'image', 'merge', 'mux', ...(audioBgmEnabled ? ['bgm'] : []), ...(audioAutoUploadDrive ? ['drive'] : []), 'done']
    const current = order.indexOf(audioJob.step)
    const index = order.indexOf(key)
    if (audioJob.status === 'error' && index === current) return 'error'
    if (index < current || (audioJob.step === 'done' && index === current)) return 'done'
    if (index === current) return 'running'
    return 'pending'
  }
  const audioNode = (key: string, number: string, title: string) => {
    const state = audioStepState(key)
    return <div className={`audio-flow-node ${state}`}><span className="audio-flow-number">{state === 'done' ? <CheckCircle2 size={17} /> : state === 'error' ? <AlertCircle size={17} /> : number}</span><strong>{title}</strong><small>{state === 'running' ? audioJob?.message : state === 'error' ? audioJob?.error : state === 'done' ? 'Đã hoàn tất' : 'Đang chờ'}</small></div>
  }
  async function startAudioWorkflow() {
    if (!audioStory || !audioVoice) { setAudioError('Hãy chọn truyện và giọng đọc.'); return }
    if (audioMode === 'single' && audioChapter === '') { setAudioError('Hãy chọn 1 chương để chạy đơn lẻ.'); return }
    if (audioMode === 'batch' && audioBatchQueue.length === 0) { setAudioError('Hãy chọn ít nhất 1 truyện trong hàng loạt.'); return }
    if (audioMode === 'single' && !selectedAudioStory?.thumbnail_name) { setAudioError('Hãy chọn thumbnail cho bộ truyện trước khi chạy.'); return }
    if (audioMode === 'batch' && audioBatchQueue.some(item => !audioStories.find(story => story.story_slug === item.story_slug)?.thumbnail_name)) { setAudioError('Mỗi truyện trong queue phải có thumbnail.'); return }
    setAudioBusy(true); setAudioError(''); setAudioJob(null)
    try {
      const response = await fetch(`${API_URL}/api/audio/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ story_slug: audioStory, ...(audioMode === 'batch' ? { batch_items: audioBatchQueue } : { chapter_number: audioChapter }), voice_id: audioVoice, aspect: audioAspect, bgm_random: true, bgm_enabled: audioBgmEnabled, auto_upload_drive: audioAutoUploadDrive, delete_local_after_upload: audioAutoUploadDrive }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.detail || `Lỗi ${response.status}`)
      setAudioJob(data)
    } catch (error) { setAudioError(error instanceof Error ? error.message : 'Không thể khởi động workflow Audio.') }
    finally { setAudioBusy(false) }
  }
  async function uploadAudioThumbnail(storySlug: string, file: File) {
    if (!storySlug) return
    setAudioThumbnailBusy(true); setAudioError('')
    try {
      const form = new FormData(); form.append('file', file)
      const response = await fetch(`${API_URL}/api/audio/stories/${encodeURIComponent(storySlug)}/thumbnail`, { method: 'POST', body: form })
      const data = await response.json(); if (!response.ok) throw new Error(data.detail || 'Không thể lưu thumbnail.')
      setAudioStories(items => items.map(item => item.story_slug === storySlug ? { ...item, thumbnail_name: data.thumbnail_name } : item))
    } catch (error) { setAudioError(error instanceof Error ? error.message : 'Không thể lưu thumbnail.') }
    finally { setAudioThumbnailBusy(false) }
  }
  async function startAudioTest() {
    if (!audioTestText.trim()) { setAudioError('Hãy dán nội dung text để test.'); return }
    setAudioTestBusy(true); setAudioError(''); setAudioJob(null)
    try {
      const response = await fetch(`${API_URL}/api/audio/test-run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: audioTestText.trim() }) })
      const data = await response.json(); if (!response.ok) throw new Error(data.detail || `Lỗi ${response.status}`)
      setAudioJob(data)
    } catch (error) { setAudioError(error instanceof Error ? error.message : 'Không thể khởi động test workflow.') }
    finally { setAudioTestBusy(false) }
  }

  // Poll loop
  const pollJob = useCallback(async (id: string) => {
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs/${id}`)
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
      /* network hiccup — keep polling */
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
                    ? '✅ Hoàn tất (có BGM)'
                    : job.overall === 'merged'
                    ? '✅ Hoàn tất'
                    : job.overall === 'error'
                    ? '❌ Có lỗi'
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
                      background: ytLoginMsg.startsWith('✅') ? '#f0fdf4' : '#fff',
                      border: '1px solid',
                      borderColor: ytLoginMsg.startsWith('✅') ? '#bbf7d0' : '#fecdd3',
                      fontSize: 12,
                      color: ytLoginMsg.startsWith('✅') ? '#166534' : '#be123c',
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
              <div className="err-block">
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>{job.error}</span>
              </div>
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
      ) : (
        <div className="audio-workflow-panel">
          <div className="audio-mode-switcher" role="tablist" aria-label="Chế độ tạo Audio">
            <button type="button" role="tab" aria-selected={audioMode === 'single'} className={audioMode === 'single' ? 'active' : ''} onClick={() => setAudioMode('single')}><Play size={15} /> Đơn lẻ <span>(1 video)</span></button>
            <button type="button" role="tab" aria-selected={audioMode === 'batch'} className={audioMode === 'batch' ? 'active' : ''} onClick={() => setAudioMode('batch')}><Layers size={17} /> Hàng loạt <span>(Queue tối đa 10)</span></button>
          </div>
          <div className="audio-workflow-hero">
            <span className="workflow-card-icon audio"><Headphones size={24} /></span>
            <div>
              <p className="overline">AUDIO WORKFLOW</p>
              <h2>Workflow Audio</h2>
              <p>Tạo, xử lý và hoàn thiện nội dung âm thanh trong một quy trình tập trung.</p>
            </div>
          </div>
          <div className="settings-card audio-form-card">
            <div className="audio-form-grid">
              {audioMode === 'single' ? <><label>Truyện đã crawl<select value={audioStory} onChange={e => { const nextStory = audioStories.find(s => s.story_slug === e.target.value); setAudioStory(e.target.value); setAudioChapter(nextStory?.chapters.find(chapter => !chapter.completed)?.chapter_number ?? nextStory?.chapters[0]?.chapter_number ?? '') }}><option value="">-- Chọn truyện --</option>{sortedAudioStories.map(s => <option key={s.story_slug} value={s.story_slug}>{s.name} ({s.chapters.filter(c => !c.completed).length}/{s.chapters.length} chương chưa làm)</option>)}</select></label><label>Chương<select value={audioChapter} onChange={e => setAudioChapter(e.target.value ? Number(e.target.value) : '')}><option value="">-- Chọn chương --</option>{sortedAudioChapters.map(c => <option key={c.chapter_number} value={c.chapter_number}>Chương {c.chapter_number} · {c.title}{c.completed ? (c.drive_uploaded ? ' · Đã upload Drive' : ' · Đã hoàn thành') : ''}</option>)}</select></label></> : <div className="audio-batch-selector"><div className="audio-batch-selector-head"><strong>Queue truyện và chương</strong><div className="audio-queue-filter"><label htmlFor="audio-status-filter">Trạng thái</label><select id="audio-status-filter" value={audioQueueFilter} onChange={e => setAudioQueueFilter(e.target.value as typeof audioQueueFilter)}><option value="all">Tất cả</option><option value="completed">Đã hoàn thành</option><option value="pending">Chưa hoàn thành</option><option value="active">Đang hoàn thành</option></select><small>{audioBatchQueue.length}/10 truyện</small></div></div><div className="audio-story-queue-list">{filteredAudioStories.map(story => { const queued = audioBatchQueue.find(item => item.story_slug === story.story_slug); const completed = completedChaptersForStory(story.name); return <div className={`audio-queue-story ${queued ? 'selected' : ''}`} key={story.story_slug}><div className="audio-queue-story-head"><button type="button" className="audio-queue-story-toggle" onClick={() => toggleBatchStory(story)} disabled={!queued && audioBatchQueue.length >= 10}><input type="checkbox" readOnly checked={Boolean(queued)} /><span>{story.name}</span></button>{isStoryCompleted(story) ? <em className="audio-completed-badge">Đã hoàn thành</em> : queued ? <em className="audio-active-badge">Đang hoàn thành</em> : <small>{completed.size}/{story.chapters.length} chương đã xong</small>}</div><div className="audio-queue-thumbnail">{story.thumbnail_name ? <img src={`${API_URL}/api/audio/thumbnails/${encodeURIComponent(story.thumbnail_name)}`} alt={`Thumbnail ${story.name}`} /> : <span>Chưa có thumbnail</span>}<label className="secondary-button audio-queue-thumbnail-button">{story.thumbnail_name ? 'Đổi ảnh' : 'Chọn thumbnail'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={audioThumbnailBusy} onChange={e => { const file = e.target.files?.[0]; if (file) uploadAudioThumbnail(story.story_slug, file); e.currentTarget.value = '' }} /></label></div>{queued && <div className="audio-queue-chapters">{[...story.chapters].sort((a, b) => { if (a.completed !== b.completed) return a.completed ? 1 : -1; return a.chapter_number - b.chapter_number }).map(chapter => <label key={chapter.chapter_number} className={completed.has(chapter.chapter_number) ? 'completed' : ''}><input type="checkbox" disabled={completed.has(chapter.chapter_number)} checked={queued.chapter_numbers.includes(chapter.chapter_number)} onChange={() => toggleBatchChapter(story.story_slug, chapter.chapter_number)} /><span>Chương {chapter.chapter_number}</span><small>{chapter.title}{completed.has(chapter.chapter_number) ? (chapter.drive_uploaded ? ' · Đã upload Drive' : ' · Đã hoàn thành') : ''}</small></label>)}</div>}</div> })}</div></div>}
              <label>Giọng đọc<select value={audioVoice} onChange={e => setAudioVoice(e.target.value)}><option value="">-- Chọn giọng --</option>{clonedVoices.length > 0 && <optgroup label="Giọng đã clone">{clonedVoices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}</optgroup>}{audioPresets.length > 0 && <optgroup label="Preset VieNeu">{audioPresets.map(v => <option key={v.name} value={v.name}>{v.name}</option>)}</optgroup>}</select></label>
              <label>Khổ video<select value={audioAspect} onChange={e => setAudioAspect(e.target.value as '9:16' | '16:9')}><option value="9:16">Dọc 9:16</option><option value="16:9">Ngang 16:9</option></select></label>
            </div>
            {audioMode === 'single' && <div className="audio-thumbnail-picker">
              <div><strong>Thumbnail bộ truyện <span className="audio-required">*</span></strong><small>{selectedAudioStory?.thumbnail_name ? 'Đã chọn ảnh. Mỗi chương sẽ được gắn label: Audio tên truyện - phần số chương.' : 'Bắt buộc chọn 1 ảnh cho bộ truyện.'}</small></div>
              <label className="secondary-button audio-thumbnail-button"><Upload size={15} /> {audioThumbnailBusy ? 'Đang lưu…' : selectedAudioStory?.thumbnail_name ? 'Đổi ảnh' : 'Chọn ảnh'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={!audioStory || audioThumbnailBusy} onChange={e => { const file = e.target.files?.[0]; if (file) uploadAudioThumbnail(audioStory, file); e.currentTarget.value = '' }} /></label>
              {selectedAudioStory?.thumbnail_name && <img className="audio-thumbnail-preview" src={`${API_URL}/api/audio/thumbnails/${encodeURIComponent(selectedAudioStory.thumbnail_name)}`} alt="Thumbnail truyện" />}
            </div>}
            <label className="audio-bgm-toggle"><input type="checkbox" checked={audioBgmEnabled} disabled={audioBusy || audioJob?.status === 'queued' || audioJob?.status === 'running'} onChange={e => setAudioBgmEnabled(e.target.checked)} /><Music size={15} /> Thêm nhạc nền vào video</label>
            {audioBgmEnabled && <div className="audio-bgm-note"><Music size={15} /> Workflow sẽ tự chọn ngẫu nhiên 1 bài từ tab “Thư viện nhạc” và mix nhỏ dưới giọng đọc.</div>}
            <label className="audio-drive-auto-toggle"><input type="checkbox" checked={audioAutoUploadDrive} disabled={audioBusy || audioJob?.status === 'queued' || audioJob?.status === 'running'} onChange={e => setAudioAutoUploadDrive(e.target.checked)} /><HardDriveUpload size={15} /> Tự động upload lên Google Drive và xóa local sau khi thành công</label>
            <p className="audio-output-path">Video hoàn tất sẽ lưu tại <code>D:\MMO\ytb_v1\Data\media\videos\Viaudio</code></p>
            <button type="button" className="primary-button" onClick={startAudioWorkflow} disabled={audioBusy || (audioJob?.status === 'running' || audioJob?.status === 'queued')}><Headphones size={15} /> {audioBusy ? 'Đang khởi động…' : 'Bắt đầu Workflow Audio'}</button>
            {audioError && <div className="audio-error"><AlertCircle size={15} /> {audioError}</div>}
          </div>
          {audioJob && <div className="settings-card audio-progress-card"><h3>Tiến trình workflow</h3><div className="audio-flowchart"><div className="audio-flow-row audio-flow-start">{audioNode('voice', '01', 'Chuyển nội dung thành voice')}<i className="audio-flow-arrow right" />{audioNode('duration', '02', 'Lấy thời lượng voice')}</div><div className="audio-flow-connector down" />{audioNode('image', '03', 'Xử lý thumbnail + label')}<div className="audio-flow-connector down" />{audioNode('merge', '04', 'Gộp video theo thời lượng')}<div className="audio-flow-connector down" />{audioNode('mux', '05', 'Ghép voice vào video')}{audioBgmEnabled && <><div className="audio-flow-connector down" />{audioNode('bgm', '06', 'Mix nhạc nền ngẫu nhiên')}</>}{audioAutoUploadDrive && <><div className="audio-flow-connector down" />{audioNode('drive', audioBgmEnabled ? '07' : '06', 'Upload Google Drive + xóa local')}</>}<div className="audio-flow-connector down" />{audioNode('done', audioAutoUploadDrive ? (audioBgmEnabled ? '08' : '07') : (audioBgmEnabled ? '07' : '06'), 'Hoàn thành video')}</div><div className="audio-progress-track"><div style={{ width: `${audioJob.progress || 0}%` }} /></div>{audioJob.status === 'running' && audioJob.total_chapters > 1 && <p className="audio-progress-chapters">Đã hoàn thành {audioJob.completed_chapters || 0}/{audioJob.total_chapters} chương · đang xử lý chương {audioJob.current_chapter}</p>}{audioJob.status === 'completed' && <p className="audio-success">{audioJob.message} Các video đã được thêm vào nhóm của truyện.</p>}</div>}
          <div className="settings-card audio-test-card"><div className="video-section-head"><div><p className="overline">TEST WORKFLOW</p><h2>Test nhanh bằng text</h2><p>Dán nội dung bất kỳ để kiểm tra toàn bộ luồng Audio.</p></div></div><textarea value={audioTestText} onChange={e => setAudioTestText(e.target.value)} placeholder="Dán nội dung chương hoặc đoạn text muốn test tại đây…" rows={7} disabled={audioTestBusy} /><div className="audio-test-actions"><small>Dùng giọng preset mặc định · Video nền khổ dọc 9:16</small><button type="button" className="primary-button" onClick={startAudioTest} disabled={audioTestBusy || Boolean(audioJob && (audioJob.status === 'queued' || audioJob.status === 'running'))}><Headphones size={15} /> {audioTestBusy ? 'Đang khởi động…' : 'Chạy test workflow'}</button></div></div>
          <div className="settings-card audio-output-gallery"><div className="video-section-head"><div><h2>Video Audio hoàn tất <span className="done-count">{audioOutputs.length}</span></h2><p>Video được nhóm theo tên truyện. Bấm vào một truyện để xem các chương.</p></div><div className="audio-output-actions"><button type="button" className="primary-button" onClick={() => openAudioDrive('upload')} disabled={!audioOutputs.length}><HardDriveUpload size={14} /> Đẩy lên ggdrive</button><button type="button" className="secondary-button" onClick={() => openAudioDrive('delete')} disabled={!audioOutputs.length}><Trash2 size={14} /> Xóa ở local</button></div></div>{audioOutputs.length === 0 ? <div className="video-empty">Chưa có video Audio hoàn tất.</div> : <div className="audio-story-output-grid">{audioOutputGroups.map(group => <div className="audio-story-output-card" key={group.story_name}><button type="button" className="audio-story-output-main" onClick={() => setSelectedAudioOutputStory(group.story_name)}><span className="audio-story-output-icon"><Play size={19} fill="currentColor" /></span><span className="audio-story-output-copy"><strong>{group.story_name}</strong><small>{group.videos.length} video · {group.videos.filter(v => v.chapter_number).map(v => `Chương ${v.chapter_number}`).join(', ') || 'Video đã hoàn tất'}</small></span><ArrowRight size={16} /></button></div>)}</div>}</div>
          {selectedAudioOutputStory && <div className="video-modal-backdrop" onClick={() => setSelectedAudioOutputStory(null)}><div className="video-modal audio-story-output-modal" onClick={e => e.stopPropagation()}><div className="video-modal-head"><strong>{selectedAudioOutputStory}</strong><button type="button" className="icon-button" onClick={() => setSelectedAudioOutputStory(null)} aria-label="Đóng"><X size={18} /></button></div><div className="audio-story-video-list">{audioOutputGroups.find(g => g.story_name === selectedAudioOutputStory)?.videos.map(item => <div className="audio-story-video-item" key={item.file_name}><video controls preload="metadata" poster={item.thumbnail_name ? `${API_URL}/api/audio/thumbnails/${encodeURIComponent(item.thumbnail_name)}` : undefined} src={`${API_URL}/api/audio/outputs/${encodeURIComponent(item.file_name)}`} /><div><strong>{item.chapter_number ? `Chương ${item.chapter_number}` : item.name}</strong><small>{item.chapter_title || item.name} · {Math.round(item.duration_sec)} giây</small></div></div>)}</div></div></div>}
          {audioDriveOpen && <div className="video-modal-backdrop" onClick={() => !audioDriveBusy && setAudioDriveOpen(false)}><div className="video-modal audio-drive-modal" onClick={e => e.stopPropagation()}><div className="video-modal-head"><strong>{audioDriveMode === 'upload' ? 'Đẩy video Audio lên Google Drive' : 'Xóa video Audio ở local'}</strong><button type="button" className="icon-button" onClick={() => setAudioDriveOpen(false)} disabled={audioDriveBusy} aria-label="Đóng"><X size={18} /></button></div><div className="audio-drive-body">{audioDriveMode === 'upload' && <p className="audio-drive-note">Chọn video của một hoặc nhiều truyện. Video sẽ được lưu trực tiếp theo cấu trúc <strong>Audio / Tên truyện / video.mp4</strong>; số chương đã nằm trong tên file.</p>}<div className="audio-drive-selection-actions"><button type="button" onClick={() => setAudioDriveSelected(audioOutputGroups.flatMap(group => group.videos.map(video => video.file_name)))} disabled={audioDriveBusy}>Chọn tất cả</button><button type="button" onClick={() => setAudioDriveSelected([])} disabled={audioDriveBusy}>Bỏ chọn</button></div><div className="audio-drive-video-list">{audioOutputGroups.map(group => <div className="audio-drive-story-group" key={group.story_name}><div className="audio-drive-story-heading"><strong>{group.story_name}</strong><span>{group.videos.filter(video => audioDriveSelected.includes(video.file_name)).length}/{group.videos.length} video</span></div>{group.videos.map(video => { const progress = audioDriveProgress.find(item => item.file_name === video.file_name); return <label key={video.file_name} className="audio-drive-video"><input type="checkbox" checked={audioDriveSelected.includes(video.file_name)} onChange={() => setAudioDriveSelected(current => current.includes(video.file_name) ? current.filter(name => name !== video.file_name) : [...current, video.file_name])} /><div className="audio-drive-video-copy"><strong>{video.chapter_number ? `Chương ${video.chapter_number}` : video.name}</strong><small>{progress?.status === 'uploading' ? `Đang upload… ${progress.percent}%` : progress?.status === 'done' ? 'Upload thành công' : progress?.status === 'error' ? `Upload lỗi: ${progress.error || 'Không xác định'}` : (video.chapter_title || video.name)}</small>{audioDriveMode === 'upload' && progress && <div className="audio-drive-progress"><div style={{ width: `${progress.percent}%` }} /></div>}</div></label> })}</div>)}</div><div className="audio-drive-footer"><div className="audio-drive-footer-left"><span>Đã chọn {audioDriveSelected.length}/{audioOutputs.length} video</span>{audioDriveMode === 'upload' && <label className="audio-drive-auto-delete"><input type="checkbox" checked={audioDriveAutoDelete} onChange={e => setAudioDriveAutoDelete(e.target.checked)} /> Xóa local sau khi upload thành công</label>}</div><button type="button" className={audioDriveMode === 'upload' ? 'primary-button' : 'danger-button'} onClick={submitAudioDriveAction} disabled={audioDriveBusy || !audioDriveSelected.length}>{audioDriveBusy ? <Loader2 size={14} className="spin" /> : audioDriveMode === 'upload' ? <HardDriveUpload size={14} /> : <Trash2 size={14} />}{audioDriveMode === 'upload' ? 'Đẩy lên ggdrive' : 'Xóa ở local'}</button></div></div></div></div>}
        </div>
      )}
    </section>
  )
}
