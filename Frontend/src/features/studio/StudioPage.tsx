import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
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
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import type { BgmOut } from '../bgm/types'
import type { Voice } from '../voices/types'
import { BatchQueuePanel } from './components/BatchQueuePanel'
import { PipelineDiagram } from './components/PipelineDiagram'
import { VideoResultCard } from './components/VideoResultCard'
import type { JobOut } from './types'

export function StudioPage({
  setActivePage,
  initialUrls,
}: {
  setActivePage: (p: string) => void
  initialUrls?: string[]
}) {
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [rawText, setRawText] = useState('')
  const [rawFile, setRawFile] = useState<File | null>(null)
  const [voiceId, setVoiceId] = useState('')
  const [clonedVoices, setClonedVoices] = useState<Voice[]>([])
  const [bgmList, setBgmList] = useState<BgmOut[]>([])
  const [bgmEnabled, setBgmEnabled] = useState(true)
  const [bgmIds, setBgmIds] = useState<string[]>([])
  const [bgmVolume, setBgmVolume] = useState(0.1)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<JobOut | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'single' | 'batch'>(initialUrls && initialUrls.length > 0 ? 'batch' : 'single')
  const [selectedWorkflow, setSelectedWorkflow] = useState<'youtube' | 'audio'>('youtube')
  const [audioStories, setAudioStories] = useState<Array<{ story_slug: string; name: string; thumbnail_name?: string | null; chapters: Array<{ chapter_number: number; title: string }> }>>([])
  const [audioStory, setAudioStory] = useState('')
  const [audioChapter, setAudioChapter] = useState<number | ''>('')
  const [audioMode, setAudioMode] = useState<'single' | 'batch'>('single')
  const [audioBatchQueue, setAudioBatchQueue] = useState<Array<{ story_slug: string; chapter_numbers: number[] }>>([])
  const [audioThumbnailBusy, setAudioThumbnailBusy] = useState(false)
  const [audioVoice, setAudioVoice] = useState('')
  const [audioPresets, setAudioPresets] = useState<Array<{ name: string; description?: string }>>([])
  const [audioAspect, setAudioAspect] = useState<'9:16' | '16:9'>('9:16')
  const [audioBgmEnabled, setAudioBgmEnabled] = useState(true)
  const [audioJob, setAudioJob] = useState<Record<string, any> | null>(null)
  const [audioOutputs, setAudioOutputs] = useState<Array<{ file_name: string; name: string; duration_sec: number; created_at: string; story_name?: string; chapter_number?: number; chapter_title?: string; thumbnail_name?: string | null }>>([])
  const [selectedAudioOutputStory, setSelectedAudioOutputStory] = useState<string | null>(null)
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

  // Load voices + bgm on mount
  useEffect(() => {
    fetch(`${API_URL}/api/voices`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => {
        const list: Voice[] = d.voices ?? d ?? []
        setClonedVoices(list)
        if (!voiceId && list.length) setVoiceId(list[0].voice_id)
      })
      .catch(() => {})
    fetch(`${API_URL}/api/bgm`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: BgmOut[]) => {
        const list = d ?? []
        setBgmList(list)
        if (list.length > 0) {
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
  const audioOutputGroups = useMemo(() => {
    const groups = new Map<string, typeof audioOutputs>()
    audioOutputs.forEach(item => {
      const story = item.story_name || 'Video Audio khác'
      groups.set(story, [...(groups.get(story) || []), item])
    })
    return Array.from(groups, ([story_name, videos]) => ({ story_name, videos }))
  }, [audioOutputs])
  const completedChaptersForStory = (storyName: string) => new Set(audioOutputs.filter(item => item.story_name === storyName && item.chapter_number).map(item => item.chapter_number as number))
  const isStoryCompleted = (story: typeof audioStories[number]) => story.chapters.length > 0 && story.chapters.every(chapter => completedChaptersForStory(story.name).has(chapter.chapter_number))
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
    const order = ['voice', 'duration', 'image', 'merge', 'mux', ...(audioBgmEnabled ? ['bgm'] : []), 'done']
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
      const response = await fetch(`${API_URL}/api/audio/run`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ story_slug: audioStory, ...(audioMode === 'batch' ? { batch_items: audioBatchQueue } : { chapter_number: audioChapter }), voice_id: audioVoice, aspect: audioAspect, bgm_random: true, bgm_enabled: audioBgmEnabled }) })
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
    setBgmEnabled(true)
    setBgmVolume(0.1)
    if (bgmList.length > 0) setBgmIds(bgmList.map(t => t.track_id))
  }

  const allSegs = (job?.recap?.scenes ?? []).flatMap(s => s.segments)

  return (
    <section className="settings-page studio-page">
      <div className="settings-heading">
        <div>
          <h1>Workflow</h1>
          <p className="page-subtitle">
            Chọn workflow phù hợp để bắt đầu sản xuất nội dung của bạn.
          </p>
        </div>
      </div>

      <div className="workflow-switcher" role="tablist" aria-label="Chọn workflow">
        <button
          type="button"
          role="tab"
          aria-selected={selectedWorkflow === 'youtube'}
          className={`workflow-card ${selectedWorkflow === 'youtube' ? 'active' : ''}`}
          onClick={() => setSelectedWorkflow('youtube')}
        >
          <span className="workflow-card-icon youtube"><Play size={20} /></span>
          <span className="workflow-card-copy">
            <strong>Workflow YouTube</strong>
            <span>Recap video, lồng tiếng và ghép tự động</span>
          </span>
          <ArrowRight size={17} className="workflow-card-arrow" />
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={selectedWorkflow === 'audio'}
          className={`workflow-card ${selectedWorkflow === 'audio' ? 'active' : ''}`}
          onClick={() => setSelectedWorkflow('audio')}
        >
          <span className="workflow-card-icon audio"><Headphones size={20} /></span>
          <span className="workflow-card-copy">
            <strong>Workflow Audio</strong>
            <span>Không gian xử lý và tạo nội dung âm thanh</span>
          </span>
          <ArrowRight size={17} className="workflow-card-arrow" />
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
            {/* NGUỒN (Đơn lẻ) */}
            <div className="fsection">
              <p className="foverline">NGUỒN</p>
              <div className="fgrid">
                <div className="field">
                  <label>Link YouTube</label>
                  <input
                    value={youtubeUrl}
                    onChange={e => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    disabled={Boolean(jobId)}
                  />
                </div>
                <div className="field field-full">
                  <label>
                    Raw transcript{' '}
                    <span>
                      (tùy chọn — đính kèm file hoặc dán text khi YouTube chặn tự
                      lấy; để trống → tự fetch)
                    </span>
                  </label>
                  <div className="raw-row">
                    <label
                      className="file-trig"
                      style={{
                        opacity: jobId ? 0.5 : 1,
                        pointerEvents: jobId ? 'none' : 'auto',
                      }}
                    >
                      <Upload size={15} />
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
                    rows={3}
                    disabled={Boolean(jobId) || Boolean(rawFile)}
                  />
                  {(rawFile || rawText.trim()) && (
                    <span className="raw-hint">
                      {rawFile
                        ? `file ${rawFile.name} (${(
                            rawFile.size / 1024
                          ).toFixed(0)} KB)`
                        : `${rawText.length.toLocaleString()} ký tự`}{' '}
                      · sẽ skip auto-fetch
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* GIỌNG & NHẠC (Đơn lẻ) */}
            <div className="fsection">
              <p className="foverline">GIỌNG &amp; NHẠC</p>
              <div className="fgrid">
                <div className="field">
                  <label>Voice</label>
                  {clonedVoices.length === 0 ? (
                    <p className="settings-message" style={{ marginTop: 4 }}>
                      Chưa có giọng — tạo ở Voices trước.
                    </p>
                  ) : (
                    <select
                      value={voiceId}
                      onChange={e => setVoiceId(e.target.value)}
                      disabled={Boolean(jobId)}
                      style={{
                        width: '100%',
                        height: 44,
                        padding: '0 12px',
                        background: 'var(--bg3)',
                        border: '1px solid var(--border)',
                        borderRadius: 9,
                        color: 'var(--text)',
                        fontSize: 13,
                      }}
                    >
                      {clonedVoices.map(v => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="field field-full">
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={bgmEnabled}
                      onChange={e => setBgmEnabled(e.target.checked)}
                      disabled={Boolean(jobId)}
                      style={{ width: 16, height: 16 }}
                    />
                    <Music size={15} /> Nhạc nền (BGM){' '}
                    <span style={{ fontWeight: 400, color: 'var(--text2)' }}>
                      — mix dưới VO; chọn nhiều → tự nối theo thứ tự, video dài hơn
                      sẽ lặp
                    </span>
                  </label>
                  {bgmEnabled && (
                    <div className="bgm-body">
                      {bgmList.length === 0 ? (
                        <p className="bgm-empty">
                          Chưa có track — thêm ở “Thư viện nhạc”.
                        </p>
                      ) : (
                        <div className="chips">
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
                      <label className="bgm-vol">
                        <span className="bgm-vol-label">
                          Volume: {(bgmVolume * 100).toFixed(0)}%
                        </span>
                        <input
                          type="range"
                          className="bgm-range"
                          min={0}
                          max={0.5}
                          step={0.01}
                          value={bgmVolume}
                          onChange={e => setBgmVolume(parseFloat(e.target.value))}
                          disabled={Boolean(jobId)}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer buttons (Đơn lẻ) */}
            <div className="ff">
              {!jobId ? (
                <button
                  type="button"
                  className="btn-p"
                  onClick={startPipeline}
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Play size={15} />
                  )}
                  {submitting ? 'Đang khởi động…' : 'Tạo recap video'}
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
            <div className="fsection">
              <p className="foverline">GIỌNG &amp; NHẠC (DÙNG CHUNG BATCH)</p>
              <div className="fgrid">
                <div className="field">
                  <label>Voice</label>
                  {clonedVoices.length === 0 ? (
                    <p className="settings-message" style={{ marginTop: 4 }}>
                      Chưa có giọng — tạo ở Voices trước.
                    </p>
                  ) : (
                    <select
                      value={voiceId}
                      onChange={e => setVoiceId(e.target.value)}
                      style={{
                        width: '100%',
                        height: 44,
                        padding: '0 12px',
                        background: 'var(--bg3)',
                        border: '1px solid var(--border)',
                        borderRadius: 9,
                        color: 'var(--text)',
                        fontSize: 13,
                      }}
                    >
                      {clonedVoices.map(v => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="field field-full">
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={bgmEnabled}
                      onChange={e => setBgmEnabled(e.target.checked)}
                      style={{ width: 16, height: 16 }}
                    />
                    <Music size={15} /> Nhạc nền (BGM){' '}
                    <span style={{ fontWeight: 400, color: 'var(--text2)' }}>
                      — mix dưới VO; chọn nhiều → tự nối theo thứ tự
                    </span>
                  </label>
                  {bgmEnabled && (
                    <div className="bgm-body">
                      {bgmList.length === 0 ? (
                        <p className="bgm-empty">
                          Chưa có track — thêm ở “Thư viện nhạc”.
                        </p>
                      ) : (
                        <div className="chips">
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
                      <label className="bgm-vol">
                        <span className="bgm-vol-label">
                          Volume: {(bgmVolume * 100).toFixed(0)}%
                        </span>
                        <input
                          type="range"
                          className="bgm-range"
                          min={0}
                          max={0.5}
                          step={0.01}
                          value={bgmVolume}
                          onChange={e => setBgmVolume(parseFloat(e.target.value))}
                        />
                      </label>
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
              {audioMode === 'single' ? <><label>Truyện đã crawl<select value={audioStory} onChange={e => { const nextStory = audioStories.find(s => s.story_slug === e.target.value); setAudioStory(e.target.value); setAudioChapter(nextStory?.chapters[0]?.chapter_number ?? '') }}><option value="">-- Chọn truyện --</option>{audioStories.map(s => <option key={s.story_slug} value={s.story_slug}>{s.name} ({s.chapters.length} chương)</option>)}</select></label><label>Chương<select value={audioChapter} onChange={e => setAudioChapter(e.target.value ? Number(e.target.value) : '')}><option value="">-- Chọn chương --</option>{selectedAudioStory?.chapters.map(c => <option key={c.chapter_number} value={c.chapter_number}>Chương {c.chapter_number} · {c.title}</option>)}</select></label></> : <div className="audio-batch-selector"><div className="audio-batch-selector-head"><strong>Queue truyện và chương</strong><small>{audioBatchQueue.length}/10 truyện</small></div><div className="audio-story-queue-list">{audioStories.map(story => { const queued = audioBatchQueue.find(item => item.story_slug === story.story_slug); const completed = completedChaptersForStory(story.name); return <div className={`audio-queue-story ${queued ? 'selected' : ''}`} key={story.story_slug}><div className="audio-queue-story-head"><button type="button" className="audio-queue-story-toggle" onClick={() => toggleBatchStory(story)} disabled={!queued && audioBatchQueue.length >= 10}><input type="checkbox" readOnly checked={Boolean(queued)} /><span>{story.name}</span></button>{isStoryCompleted(story) ? <em className="audio-completed-badge">Đã hoàn thành</em> : <small>{completed.size}/{story.chapters.length} chương đã xong</small>}</div><div className="audio-queue-thumbnail">{story.thumbnail_name ? <img src={`${API_URL}/api/audio/thumbnails/${encodeURIComponent(story.thumbnail_name)}`} alt={`Thumbnail ${story.name}`} /> : <span>Chưa có thumbnail</span>}<label className="secondary-button audio-queue-thumbnail-button">{story.thumbnail_name ? 'Đổi ảnh' : 'Chọn thumbnail'}<input type="file" accept="image/png,image/jpeg,image/webp" hidden disabled={audioThumbnailBusy} onChange={e => { const file = e.target.files?.[0]; if (file) uploadAudioThumbnail(story.story_slug, file); e.currentTarget.value = '' }} /></label></div>{queued && <div className="audio-queue-chapters">{story.chapters.map(chapter => <label key={chapter.chapter_number} className={completed.has(chapter.chapter_number) ? 'completed' : ''}><input type="checkbox" checked={queued.chapter_numbers.includes(chapter.chapter_number)} onChange={() => toggleBatchChapter(story.story_slug, chapter.chapter_number)} /><span>Chương {chapter.chapter_number}</span><small>{chapter.title}{completed.has(chapter.chapter_number) ? ' · Đã hoàn thành' : ''}</small></label>)}</div>}</div> })}</div></div>}
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
            <p className="audio-output-path">Video hoàn tất sẽ lưu tại <code>D:\MMO\ytb_v1\Data\media\videos\Viaudio</code></p>
            <button type="button" className="primary-button" onClick={startAudioWorkflow} disabled={audioBusy || (audioJob?.status === 'running' || audioJob?.status === 'queued')}><Headphones size={15} /> {audioBusy ? 'Đang khởi động…' : 'Bắt đầu Workflow Audio'}</button>
            {audioError && <div className="audio-error"><AlertCircle size={15} /> {audioError}</div>}
          </div>
          {audioJob && <div className="settings-card audio-progress-card"><h3>Tiến trình workflow</h3><div className="audio-flowchart"><div className="audio-flow-row audio-flow-start">{audioNode('voice', '01', 'Chuyển nội dung thành voice')}<i className="audio-flow-arrow right" />{audioNode('duration', '02', 'Lấy thời lượng voice')}</div><div className="audio-flow-connector down" />{audioNode('image', '03', 'Xử lý thumbnail + label')}<div className="audio-flow-connector down" />{audioNode('merge', '04', 'Gộp video theo thời lượng')}<div className="audio-flow-connector down" />{audioNode('mux', '05', 'Ghép voice vào video')}{audioBgmEnabled && <><div className="audio-flow-connector down" />{audioNode('bgm', '06', 'Mix nhạc nền ngẫu nhiên')}</>}<div className="audio-flow-connector down" />{audioNode('done', audioBgmEnabled ? '07' : '06', 'Hoàn thành video')}</div><div className="audio-progress-track"><div style={{ width: `${audioJob.progress || 0}%` }} /></div>{audioJob.status === 'running' && audioJob.total_chapters > 1 && <p className="audio-progress-chapters">Đã hoàn thành {audioJob.completed_chapters || 0}/{audioJob.total_chapters} chương · đang xử lý chương {audioJob.current_chapter}</p>}{audioJob.status === 'completed' && <p className="audio-success">{audioJob.message} Các video đã được thêm vào nhóm của truyện.</p>}</div>}
          <div className="settings-card audio-test-card"><div className="video-section-head"><div><p className="overline">TEST WORKFLOW</p><h2>Test nhanh bằng text</h2><p>Dán nội dung bất kỳ để kiểm tra toàn bộ luồng Audio.</p></div></div><textarea value={audioTestText} onChange={e => setAudioTestText(e.target.value)} placeholder="Dán nội dung chương hoặc đoạn text muốn test tại đây…" rows={7} disabled={audioTestBusy} /><div className="audio-test-actions"><small>Dùng giọng preset mặc định · Video nền khổ dọc 9:16</small><button type="button" className="primary-button" onClick={startAudioTest} disabled={audioTestBusy || Boolean(audioJob && (audioJob.status === 'queued' || audioJob.status === 'running'))}><Headphones size={15} /> {audioTestBusy ? 'Đang khởi động…' : 'Chạy test workflow'}</button></div></div>
          <div className="settings-card audio-output-gallery"><div className="video-section-head"><div><h2>Video Audio hoàn tất <span className="done-count">{audioOutputs.length}</span></h2><p>Video được nhóm theo tên truyện. Bấm vào một truyện để xem các chương.</p></div></div>{audioOutputs.length === 0 ? <div className="video-empty">Chưa có video Audio hoàn tất.</div> : <div className="audio-story-output-grid">{audioOutputGroups.map(group => <button type="button" className="audio-story-output-card" key={group.story_name} onClick={() => setSelectedAudioOutputStory(group.story_name)}><span className="audio-story-output-icon"><Play size={19} fill="currentColor" /></span><span className="audio-story-output-copy"><strong>{group.story_name}</strong><small>{group.videos.length} video · {group.videos.filter(v => v.chapter_number).map(v => `Chương ${v.chapter_number}`).join(', ') || 'Video đã hoàn tất'}</small></span><ArrowRight size={16} /></button>)}</div>}</div>
          {selectedAudioOutputStory && <div className="video-modal-backdrop" onClick={() => setSelectedAudioOutputStory(null)}><div className="video-modal audio-story-output-modal" onClick={e => e.stopPropagation()}><div className="video-modal-head"><strong>{selectedAudioOutputStory}</strong><button type="button" className="icon-button" onClick={() => setSelectedAudioOutputStory(null)} aria-label="Đóng"><X size={18} /></button></div><div className="audio-story-video-list">{audioOutputGroups.find(g => g.story_name === selectedAudioOutputStory)?.videos.map(item => <div className="audio-story-video-item" key={item.file_name}><video controls preload="metadata" poster={item.thumbnail_name ? `${API_URL}/api/audio/thumbnails/${encodeURIComponent(item.thumbnail_name)}` : undefined} src={`${API_URL}/api/audio/outputs/${encodeURIComponent(item.file_name)}`} /><div><strong>{item.chapter_number ? `Chương ${item.chapter_number}` : item.name}</strong><small>{item.chapter_title || item.name} · {Math.round(item.duration_sec)} giây</small></div></div>)}</div></div></div>}
        </div>
      )}
    </section>
  )
}
