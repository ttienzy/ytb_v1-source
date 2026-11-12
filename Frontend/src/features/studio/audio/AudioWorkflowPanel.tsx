import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Headphones, Loader2, X } from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { Voice } from '../../voices/types'
import { AudioOutputs, type AudioOutput } from './AudioOutputs'
import { JobBar, type AudioJob } from './JobBar'
import { RunPanel, type Aspect } from './RunPanel'
import { StoryBrowser } from './StoryBrowser'
import { StyleStudio, type BgmTrack } from './StyleStudio'
import { VideoSection } from './VideoSection'
import { backgroundSummary, buildRunBody, buildStoryViews, DEFAULT_STYLE, hasBackgroundWork, mergeStyle, pruneCompleted, styleNeedsOverlay, validateQueue, type AudioChapter, type AudioStory, type AudioStyle, type BgFit, type BgItem, type QueueItem } from './audioModel'
import './AudioWorkflow.css'

const SETTINGS_KEY = 'audio_workflow_settings_v2'

interface SavedSettings {
  voice?: string
  aspect?: Aspect
  bgm?: boolean
  drive?: boolean
  bgFit?: BgFit
  style?: unknown
}

function loadSettings(): SavedSettings {
  try {
    return JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}
  } catch {
    return {}
  }
}

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_URL}${path}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

/** Workflow Audio: chọn truyện/chương (trái) → hàng đợi + cấu hình + chạy (phải) → tiến trình một hàng → kho video. */
export function AudioWorkflowPanel() {
  const saved = useMemo(loadSettings, [])
  const [stories, setStories] = useState<AudioStory[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [outputs, setOutputs] = useState<AudioOutput[]>([])
  const [cloned, setCloned] = useState<Voice[]>([])
  const [presets, setPresets] = useState<Array<{ name: string; description?: string }>>([])
  const [outputDir, setOutputDir] = useState('')

  const [voice, setVoice] = useState(saved.voice || '')
  const [aspect, setAspect] = useState<Aspect>(saved.aspect === '16:9' ? '16:9' : '9:16')
  const [bgm, setBgm] = useState(saved.bgm ?? true)
  const [drive, setDrive] = useState(saved.drive ?? false)
  const [bgFit, setBgFit] = useState<BgFit>(saved.bgFit === 'blur' ? 'blur' : 'fill')
  // Âm thanh & hiệu ứng: nhớ giữa các lần mở; mergeStyle chuẩn hóa giá trị cũ/hỏng về khoảng hợp lệ.
  const [style, setStyle] = useState<AudioStyle>(() => mergeStyle(saved.style))
  const [tracks, setTracks] = useState<BgmTrack[]>([])
  const patchStyle = useCallback((patch: Partial<AudioStyle>) => setStyle(current => ({ ...current, ...patch })), [])
  // Thư viện video nền (nguồn dùng chung, không gắn khổ): danh sách + trạng thái chuẩn hóa từng khổ.
  const [bgItems, setBgItems] = useState<BgItem[]>([])
  const [bgLoaded, setBgLoaded] = useState(false)
  const [videoOpen, setVideoOpen] = useState(false)
  const videoRef = useRef<HTMLElement | null>(null)

  // Chương theo từng truyện, tải khi chọn truyện (thiếu khóa = chưa tải/đang tải, null = lỗi).
  const [chaptersBySlug, setChaptersBySlug] = useState<Record<string, AudioChapter[] | null | undefined>>({})
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [focusedSlug, setFocusedSlug] = useState<string | null>(null)
  const [job, setJob] = useState<AudioJob | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [thumbnailBusy, setThumbnailBusy] = useState(false)
  const [testText, setTestText] = useState('')
  const [testBusy, setTestBusy] = useState(false)
  const refreshedJob = useRef('')
  const queueRef = useRef<QueueItem[]>([])
  const focusedRef = useRef<string | null>(null)
  queueRef.current = queue
  focusedRef.current = focusedSlug

  const loadStories = useCallback(async (): Promise<AudioStory[]> => {
    const items = await getJson<AudioStory[]>('/api/audio/stories')
    setStories(items)
    return items
  }, [])
  const loadOutputs = useCallback(async (): Promise<AudioOutput[]> => {
    const items = await getJson<AudioOutput[]>('/api/audio/outputs')
    setOutputs(items)
    return items
  }, [])

  const markSummarized = useCallback((slug: string) => {
    setStories(items => items.map(item => (item.story_slug === slug ? { ...item, has_summary: true } : item)))
  }, [])

  const loadChapters = useCallback(async (slug: string): Promise<AudioChapter[] | null> => {
    try {
      const data = await getJson<{ chapters: AudioChapter[] }>(`/api/audio/stories/${encodeURIComponent(slug)}/chapters`)
      setChaptersBySlug(current => ({ ...current, [slug]: data.chapters }))
      return data.chapters
    } catch {
      setChaptersBySlug(current => ({ ...current, [slug]: null }))
      return null
    }
  }, [])

  // Nạp dữ liệu một lần khi mở tab.
  useEffect(() => {
    let alive = true
    Promise.all([loadStories(), loadOutputs()])
      .catch(() => alive && setLoadError('Không tải được danh sách truyện đã crawl. Kiểm tra backend đang chạy.'))
      .finally(() => alive && setLoading(false))
    getJson<{ output_dir?: string }>('/api/audio/config').then(data => alive && setOutputDir(data.output_dir || '')).catch(() => {})
    Promise.allSettled([getJson<{ voices?: Voice[] } | Voice[]>('/api/voices'), getJson<Array<{ name: string; description?: string }>>('/api/voices/presets')]).then(([voicesResult, presetsResult]) => {
      if (!alive) return
      const cloneList = voicesResult.status === 'fulfilled' ? (Array.isArray(voicesResult.value) ? voicesResult.value : voicesResult.value.voices ?? []) : []
      const presetList = presetsResult.status === 'fulfilled' ? presetsResult.value : []
      setCloned(cloneList)
      setPresets(presetList)
      // Giọng đã lưu nếu còn tồn tại, không thì giọng clone đầu tiên, không thì preset đầu tiên.
      setVoice(current => {
        const valid = (id: string) => !!id && (cloneList.some(item => item.voice_id === id) || presetList.some(item => item.name === id))
        return valid(current) ? current : cloneList[0]?.voice_id || presetList[0]?.name || ''
      })
    })
    return () => { alive = false }
  }, [loadStories, loadOutputs])

  useEffect(() => {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify({ voice, aspect, bgm, drive, bgFit, style })) } catch { /* bỏ qua */ }
  }, [voice, aspect, bgm, drive, bgFit, style])

  // Danh sách nhạc nền để chọn một bài cụ thể; bài đã lưu mà không còn trong thư viện thì quay về "ngẫu nhiên".
  useEffect(() => {
    let alive = true
    getJson<BgmTrack[]>('/api/bgm').then(list => {
      if (!alive) return
      const items = list.map(({ track_id, name }) => ({ track_id, name }))
      setTracks(items)
      setStyle(current => (current.bgm_track_id && !items.some(item => item.track_id === current.bgm_track_id) ? { ...current, bgm_track_id: null } : current))
    }).catch(() => {})
    return () => { alive = false }
  }, [])

  const loadBackgrounds = useCallback(async () => {
    const data = await getJson<{ items: BgItem[] }>(`/api/audio/backgrounds?fit=${bgFit}`)
    setBgItems(data.items)
    setBgLoaded(true)
  }, [bgFit])

  // Tải lúc mở tab và khi đổi cách khớp khung (mỗi cách có bộ clip chuẩn hóa riêng); còn clip đang chuẩn hóa thì hỏi lại mỗi 2 giây.
  useEffect(() => { loadBackgrounds().catch(() => {}) }, [loadBackgrounds])
  const bgBusy = hasBackgroundWork(bgItems)
  useEffect(() => {
    if (!bgBusy) return
    const timer = window.setInterval(() => { loadBackgrounds().catch(() => {}) }, 2000)
    return () => window.clearInterval(timer)
  }, [bgBusy, loadBackgrounds])
  const bgSummary = useMemo(() => backgroundSummary(bgItems, aspect), [bgItems, aspect])

  // Có video nguồn chưa chuẩn bị cho khổ + cách khớp đang chọn → xếp hàng chuẩn bị ngầm (workflow chạy tới đâu cũng tự chuẩn bị phần thiếu,
  // nhưng chuẩn bị sẵn thì chương đầu tiên không phải chờ). Mỗi tổ hợp (khổ, cách khớp, số video) chỉ yêu cầu một lần.
  const preparedKey = useRef('')
  useEffect(() => {
    const total = bgSummary.total
    if (style.bg_mode === 'cover' || !bgLoaded || total === 0 || bgSummary.ready + bgSummary.busy + bgSummary.failed >= total) return
    const key = `${aspect}|${bgFit}|${total}`
    if (preparedKey.current === key) return
    preparedKey.current = key
    fetch(`${API_URL}/api/audio/backgrounds/prepare`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fit: bgFit, aspects: [aspect] }) })
      .then(() => loadBackgrounds())
      .catch(() => {})
  }, [style.bg_mode, bgLoaded, bgSummary, aspect, bgFit, loadBackgrounds])

  function openVideoBlock() {
    setVideoOpen(true)
    window.setTimeout(() => videoRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60)
  }

  const views = useMemo(() => buildStoryViews(stories), [stories])
  useEffect(() => {
    if (!focusedSlug && views.length) setFocusedSlug(views[0].story.story_slug)
  }, [views, focusedSlug])
  // Chọn truyện nào thì tải chương truyện đó (một lần, có cache; `requested` chặn gọi trùng khi state khác đổi trong lúc đang tải).
  const requestedRef = useRef(new Set<string>())
  useEffect(() => {
    if (!focusedSlug || focusedSlug in chaptersBySlug || requestedRef.current.has(focusedSlug)) return
    requestedRef.current.add(focusedSlug)
    loadChapters(focusedSlug)
  }, [focusedSlug, chaptersBySlug, loadChapters])

  const validation = useMemo(() => {
    const base = validateQueue(queue, stories, voice)
    // Chưa có video nền nào thì chạy chắc chắn thất bại ở bước ghép — chặn từ đầu.
    if (style.bg_mode === 'library' && bgLoaded && bgItems.length === 0) base.errors.push('Chưa có video nền — mở khối "Video nền" bên dưới để thêm ít nhất 1 video.')
    return base
  }, [queue, stories, voice, bgLoaded, bgItems.length, style.bg_mode])
  const running = job?.status === 'queued' || job?.status === 'running'

  // Theo dõi job. Job nằm trong RAM backend: backend khởi động lại → 404 → coi là đã mất (không treo mãi).
  useEffect(() => {
    if (!job?.job_id || job.status === 'completed' || job.status === 'error') return
    const jobId = job.job_id
    let failures = 0
    let stopped = false
    const giveUp = (reason: string) => {
      stopped = true
      setJob(current => (current && current.job_id === jobId ? { ...current, status: 'error', error: reason, message: reason } : current))
    }
    const timer = window.setInterval(async () => {
      if (stopped) return
      try {
        const response = await fetch(`${API_URL}/api/audio/jobs/${jobId}`)
        if (stopped) return
        if (response.status === 404) { window.clearInterval(timer); giveUp('Backend đã khởi động lại nên mất tiến trình job này. Các chương đã xong vẫn còn trong kho video; hãy chạy lại các chương còn thiếu.'); return }
        if (!response.ok) throw new Error(`HTTP ${response.status}`)
        failures = 0
        const next: AudioJob = await response.json()
        setJob(next)
        if (next.status === 'completed' || next.status === 'error') { window.clearInterval(timer); stopped = true }
      } catch {
        failures += 1
        if (failures >= 8) { window.clearInterval(timer); giveUp('Mất kết nối tới backend, không theo dõi được tiến trình. Kiểm tra backend rồi chạy lại.') }
      }
    }, 1000)
    return () => { stopped = true; window.clearInterval(timer) }
  }, [job?.job_id, job?.status])

  // Job kết thúc: cập nhật kho video + trạng thái "đã làm", rồi bỏ chương đã xong khỏi hàng đợi (chỉ còn chương lỗi để chạy lại).
  useEffect(() => {
    if (!job || (job.status !== 'completed' && job.status !== 'error') || refreshedJob.current === job.job_id) return
    refreshedJob.current = job.job_id
    const slugs = [...new Set([...queueRef.current.map(item => item.story_slug), ...(focusedRef.current ? [focusedRef.current] : [])])]
    Promise.all([loadStories(), loadOutputs(), ...slugs.map(async slug => [slug, await loadChapters(slug)] as const)])
      .then(([, , ...fresh]) => setQueue(current => pruneCompleted(current, Object.fromEntries(fresh.map(([slug, chapters]) => [slug, chapters ?? undefined])))))
      .catch(() => {})
  }, [job, loadStories, loadOutputs, loadChapters])

  useEffect(() => {
    if (!notice) return
    const timer = window.setTimeout(() => setNotice(''), 4500)
    return () => window.clearTimeout(timer)
  }, [notice])

  async function startJob(path: string, body: Record<string, unknown>, fallback: string) {
    const response = await fetch(`${API_URL}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await response.json().catch(() => ({}))
    if (!response.ok) throw new Error(data.detail || `${fallback} (lỗi ${response.status})`)
    setJob(data)
  }

  async function run() {
    if (validation.errors.length || running) return
    setBusy(true)
    setError('')
    setJob(null)
    try {
      await startJob('/api/audio/run', buildRunBody(queue, { voice, aspect, bgm, drive, bgFit, style }), 'Không thể khởi động workflow Audio')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể khởi động workflow Audio.')
    } finally {
      setBusy(false)
    }
  }

  async function runTest() {
    if (!testText.trim()) { setError('Hãy dán nội dung text để test.'); return }
    setTestBusy(true)
    setError('')
    setJob(null)
    try {
      await startJob('/api/audio/test-run', { text: testText.trim(), ...(voice ? { voice_id: voice } : {}), aspect, bg_fit: bgFit, options: style }, 'Không thể khởi động test workflow')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể khởi động test workflow.')
    } finally {
      setTestBusy(false)
    }
  }

  async function uploadThumbnail(slug: string, file: File) {
    setThumbnailBusy(true)
    setError('')
    try {
      const form = new FormData()
      form.append('file', file)
      const response = await fetch(`${API_URL}/api/audio/stories/${encodeURIComponent(slug)}/thumbnail`, { method: 'POST', body: form })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(data.detail || 'Không thể lưu thumbnail.')
      setStories(items => items.map(item => (item.story_slug === slug ? { ...item, thumbnail_name: data.thumbnail_name } : item)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể lưu thumbnail.')
    } finally {
      setThumbnailBusy(false)
    }
  }

  return (
    <div className="aw">
      {job && <JobBar job={job} bgm={bgm} drive={drive} overlay={styleNeedsOverlay(style)} onDismiss={() => setJob(null)} />}

      {(error || notice) && (
        <div className={`aw-banner ${error ? 'error' : ''}`} role="alert">
          <AlertCircle size={15} />
          <span>{error || notice}</span>
          <button type="button" className="aw-icon-btn" onClick={() => { setError(''); setNotice('') }} aria-label="Đóng"><X size={14} /></button>
        </div>
      )}

      <div className="aw-main">
        <StoryBrowser
          views={views}
          loading={loading}
          loadError={loadError}
          queue={queue}
          onQueueChange={setQueue}
          focusedSlug={focusedSlug}
          onFocus={setFocusedSlug}
          chaptersBySlug={chaptersBySlug}
          onRetryChapters={slug => { requestedRef.current.delete(slug); setChaptersBySlug(current => { const { [slug]: _drop, ...rest } = current; return rest }) }}
          thumbnailBusy={thumbnailBusy}
          onUploadThumbnail={uploadThumbnail}
          onNotice={setNotice}
          onSummarySaved={markSummarized}
        />
        <RunPanel
          stories={stories}
          queue={queue}
          onQueueChange={setQueue}
          onFocus={setFocusedSlug}
          voice={voice}
          onVoice={setVoice}
          cloned={cloned}
          presets={presets}
          aspect={aspect}
          onAspect={setAspect}
          bgm={bgm}
          onBgm={setBgm}
          drive={drive}
          onDrive={setDrive}
          outputDir={outputDir}
          bg={bgSummary}
          bgLoaded={bgLoaded}
          bgFit={bgFit}
          onBgFit={setBgFit}
          bgMode={style.bg_mode}
          onManageBg={openVideoBlock}
          running={running}
          busy={busy}
          errors={validation.errors}
          onRun={run}
        />
      </div>

      <StyleStudio style={style} onChange={patchStyle} onReset={() => setStyle(DEFAULT_STYLE)} locked={running || busy} tracks={tracks} bgm={bgm} aspect={aspect} bgFit={bgFit} previewSlug={focusedSlug} onError={setError} />

      <VideoSection open={videoOpen} onToggle={() => setVideoOpen(value => !value)} count={bgItems.length} onLibraryChanged={() => { loadBackgrounds().catch(() => {}) }} sectionRef={videoRef} />

      <AudioOutputs outputs={outputs} onChanged={() => { loadOutputs().catch(() => {}); loadStories().catch(() => {}) }} onError={setError} />

      <details className="aw-card aw-test">
        <summary><Headphones size={14} /> Test nhanh bằng text <small>— kiểm tra luồng mà không cần truyện</small></summary>
        <textarea value={testText} onChange={event => setTestText(event.target.value)} placeholder="Dán một đoạn văn bản ngắn để thử giọng + ghép video…" rows={4} disabled={testBusy} />
        <div className="aw-test-actions">
          <small>Dùng giọng và khổ video đang chọn · không có thumbnail/nhạc nền nên 2 bước đó được bỏ qua.</small>
          <button type="button" className="aw-ghost" onClick={runTest} disabled={testBusy || running || !testText.trim()}>
            {testBusy ? <Loader2 size={14} className="spin" /> : <Headphones size={14} />} Chạy test
          </button>
        </div>
      </details>
    </div>
  )
}
