import { StrictMode, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CheckCircle2, ChevronDown, Clock3, Film, LayoutDashboard, Loader2, Menu, Mic, PanelLeftClose, Pause, Play, PlaySquare, Plus, Save, Scissors, Search, Settings, Sparkles, Trash2, Upload, Volume2 } from 'lucide-react'
import './styles.css'

const API_URL = 'http://127.0.0.1:8000'
const navigation = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Studio', icon: PlaySquare },
  { label: 'Voices', icon: Mic },
  { label: 'Lịch sử', icon: Clock3 },
  { label: 'Cài đặt', icon: Settings },
]

type GeminiState = { has_cookie: boolean; cookie_count: number; saved_at?: string; client_context_token: string; app_url: string }

function SettingsPage() {
  const [state, setState] = useState<GeminiState>({ has_cookie: false, cookie_count: 0, client_context_token: '', app_url: 'https://gemini.google.com/app' })
  const [cookies, setCookies] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => { fetch(`${API_URL}/api/settings/gemini`).then((response) => response.json()).then(setState).catch(() => setMessage('Không kết nối được Backend.')) }, [])

  async function save() {
    setLoading(true); setMessage('')
    try {
      const response = await fetch(`${API_URL}/api/settings/gemini`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ cookies, client_context_token: state.client_context_token, app_url: state.app_url }) })
      if (!response.ok) throw new Error()
      const next = await response.json(); setState({ ...state, has_cookie: next.has_cookie }); setCookies(''); setMessage('Đã lưu cấu hình.')
    } catch { setMessage('Lưu cấu hình thất bại.') } finally { setLoading(false) }
  }

  async function loginChrome() {
    setLoading(true); setMessage('Đang mở Chrome. Hãy đăng nhập Google một lần...')
    try {
      const response = await fetch(`${API_URL}/api/settings/gemini/login`, { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Đăng nhập thất bại')
      setState({ ...state, has_cookie: true, cookie_count: result.cookie_count }); setMessage('Đã đăng nhập và lưu cookie Gemini.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Đăng nhập thất bại.') } finally { setLoading(false) }
  }

  return <section className="settings-page"><div className="settings-heading"><div><p className="overline">CẤU HÌNH</p><h1>Cài đặt</h1><p className="page-subtitle">Quản lý kết nối và thông tin xác thực cho các công cụ.</p></div></div><div className="settings-card"><div className="integration-title"><div className="gemini-icon"><Sparkles size={17} /></div><div><h2>Gemini (Highlight video)</h2><p>Dùng Gemini web bằng cookie (free) — dẫn cookie từ gemini.google.com</p></div></div><label>Cookies <span>(đã có — dán mới để đổi)</span></label><textarea value={cookies} onChange={(event) => setCookies(event.target.value)} placeholder={state.has_cookie ? '•••••••• (đã lưu)' : 'Dán cookie Gemini tại đây...'} /><div className="settings-grid"><div><label>Client context token <span>(chỉ cần khi upload FILE)</span></label><input value={state.client_context_token} onChange={(event) => setState({ ...state, client_context_token: event.target.value })} placeholder="...(lấy từ DevTools, link YouTube không cần)" /></div><div><label>App URL <span>(tùy chọn)</span></label><input value={state.app_url} onChange={(event) => setState({ ...state, app_url: event.target.value })} /></div></div><div className="settings-actions"><button className="primary-button" onClick={save} disabled={loading}><Save size={16} /> Lưu</button><button className="chrome-button" onClick={loginChrome} disabled={loading}><span className="chrome-logo">◉</span> Đăng nhập Gemini (Chrome)</button>{state.has_cookie && <span className="cookie-status"><CheckCircle2 size={15} /> Đã có cookie</span>}</div>{message && <p className="settings-message">{message}</p>}<p className="settings-help"><strong>Cách 1:</strong> bấm “Đăng nhập Gemini (Chrome)” → cửa sổ Chrome mở, đăng nhập Google 1 lần → tool tự lấy cookie (lần sau tự gia hạn). <strong>Cách 2:</strong> dán cookie thủ công ở trên.</p></div></section>
}

type Voice = { voice_id: string; name: string; created_at?: string; tags?: string[] }
type Preset = { name: string; description: string; gender: string }

function VoicesPage() {
  const [voices, setVoices] = useState<Voice[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState('')

  useEffect(() => {
    fetch(`${API_URL}/api/voices`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not ok'))))
      .then((d) => setVoices(d.voices ?? d ?? []))
      .catch(() => setMessage('Voice service chưa kết nối. (BE chưa triển khai)'))
    fetch(`${API_URL}/api/voices/presets`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not ok'))))
      .then(setPresets)
      .catch(() => { /* preset là tuỳ chọn — không bắt buộc */ })
  }, [])

  async function create() {
    if (!file || !name.trim()) { setMessage('Cần tên giọng và audio mẫu (3-8s).'); return }
    setLoading(true); setMessage('')
    const form = new FormData()
    form.append('name', name.trim())
    form.append('ref_audio', file)
    try {
      const r = await fetch(`${API_URL}/api/voices`, { method: 'POST', body: form })
      if (!r.ok) throw new Error()
      const v = await r.json(); setVoices([v, ...voices]); setName(''); setFile(null)
      setMessage('Đã thêm giọng.')
    } catch { setMessage('Tạo giọng thất bại. (BE chưa triển khai?)') } finally { setLoading(false) }
  }

  async function remove(id: string) {
    try {
      const r = await fetch(`${API_URL}/api/voices/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      setVoices(voices.filter((v) => v.voice_id !== id))
    } catch { setMessage('Xoá thất bại.') }
  }

  async function preview(id: string) {
    setPreviewing(id); setMessage('')
    try {
      const r = await fetch(`${API_URL}/api/voices/${encodeURIComponent(id)}/preview`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: previewText || undefined }),
      })
      if (!r.ok) { const e = await r.json().catch(() => null); throw new Error(e?.detail || `Lỗi ${r.status}`) }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'TTS thất bại.') }
    finally { setPreviewing(null) }
  }

  return <section className="settings-page"><div className="settings-heading"><div><p className="overline">GIỌNG NÓI</p><h1>Voices</h1><p className="page-subtitle">Quản lý giọng đọc Việt cho recap — clone từ audio mẫu, chọn giọng khi TTS.</p></div></div><div className="settings-card"><div className="integration-title"><div className="gemini-icon"><Mic size={17} /></div><div><h2>Thêm giọng (voice clone)</h2><p>Tải audio mẫu 3-8 giây — VieNeu-TTS sẽ tự khử ồn rồi clone zero-shot.</p></div></div><label>Tên giọng</label><input value={name} onChange={(e) => setName(e.target.value)} placeholder="vd: Giọng review hài" /><label style={{ marginTop: 18 }}>Audio mẫu <span>(3-8s, wav/mp3)</span></label><div className="voice-file-row"><input type="file" accept="audio/*" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /><span className="voice-file-name">{file ? file.name : 'Chưa chọn file'}</span></div><div className="settings-actions"><button className="primary-button" onClick={create} disabled={loading}><Plus size={16} /> Tạo giọng</button></div>{message && <p className="settings-message">{message}</p>}</div><div className="settings-card" style={{ marginTop: 22 }}><div className="integration-title"><div className="gemini-icon"><Play size={17} /></div><div><h2>Nghe thử</h2><p>Nhập text rồi bấm “Nghe thử” ở bất kỳ giọng nào dưới đây.</p></div></div><label>Text nghe thử <span>(để trống → câu mặc định)</span></label><input value={previewText} onChange={(e) => setPreviewText(e.target.value)} placeholder="vd: Xin chào, đây là giọng đọc thử." /></div><div className="settings-card" style={{ marginTop: 22 }}><div className="integration-title"><div className="gemini-icon"><Volume2 size={17} /></div><div><h2>Danh sách giọng (đã clone)</h2><p>Giọng bạn clone từ audio mẫu.</p></div></div>{voices.length === 0 ? <p className="settings-message">Chưa có giọng nào.</p> : <div className="voices-list">{voices.map((v) => <div key={v.voice_id} className="voice-item"><div className="voice-item-info"><strong>{v.name}</strong><span>{v.voice_id}{v.created_at ? ` · ${v.created_at}` : ''}</span></div><div className="voice-item-actions"><button className="primary-button" onClick={() => preview(v.voice_id)} disabled={previewing === v.voice_id}><Play size={15} /> {previewing === v.voice_id ? 'Đang tạo...' : 'Nghe thử'}</button><button className="chrome-button" onClick={() => remove(v.voice_id)}><Trash2 size={15} /> Xoá</button></div></div>)}</div>}</div><div className="settings-card" style={{ marginTop: 22 }}><div className="integration-title"><div className="gemini-icon"><Mic size={17} /></div><div><h2>Preset voices</h2><p>20 giọng sẵn dùng của VieNeu — không cần clone.</p></div></div>{presets.length === 0 ? <p className="settings-message">Chưa tải được preset (voice-service chưa chạy?).</p> : <div className="voices-list">{presets.map((p) => <div key={p.name} className="voice-item"><div className="voice-item-info"><strong>{p.name}</strong><span>{p.description}</span></div><div className="voice-item-actions"><button className="primary-button" onClick={() => preview(p.name)} disabled={previewing === p.name}><Play size={15} /> {previewing === p.name ? 'Đang tạo...' : 'Nghe thử'}</button></div></div>)}</div>}</div></section>
}

type StudioSegment = { idx: number; start: string; end: string; duration: number; original_text: string; vietnamese_vo: string }
type StudioScene = { scene_title: string; segments: StudioSegment[] }
type StudioJob = {
  job_id: string
  youtube_url: string
  status: 'recap_running' | 'recap_done' | 'cut_running' | 'cut_done' | 'voice_running' | 'voice_done' | 'merge_running' | 'merged' | 'idle'
  voice_id: string
  scenes: StudioScene[]
  overspeed: number[]
  clips: string[]
}

// Recap trả về từ BE — /api/recap/generate
type BackendSegment = { start_time_sec: number; end_time_sec: number; duration_sec: number; original_text: string; vietnamese_vo: string }
type BackendScene = { scene_title?: string; segments: BackendSegment[] }
type BackendRecap = { video_url?: string; scenes: BackendScene[] }
type RecapJobOut = { job_id: string; youtube_url: string; status: string; error?: string | null; recap?: BackendRecap | null; clips?: string[] | null; overspeed?: number[] | null; final?: string | null }

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

function mapRecap(job: RecapJobOut, voiceId: string): StudioJob {
  const scenes: StudioScene[] = (job.recap?.scenes ?? []).map(sc => ({
    scene_title: sc.scene_title ?? '',
    segments: sc.segments.map(seg => ({
      idx: 0, start: fmtTime(seg.start_time_sec), end: fmtTime(seg.end_time_sec),
      duration: seg.duration_sec, original_text: seg.original_text, vietnamese_vo: seg.vietnamese_vo,
    })),
  }))
  let i = 0
  scenes.forEach(sc => sc.segments.forEach(seg => { seg.idx = i++ }))
  // Dùng status/clips/overspeed thật từ BE (rehydrate sau restart trả đúng trạng thái trên disk).
  return {
    job_id: job.job_id,
    youtube_url: job.youtube_url,
    status: (job.status as StudioJob['status']) || 'recap_done',
    voice_id: voiceId,
    scenes,
    overspeed: job.overspeed ?? [],
    clips: job.clips ?? [],
  }
}

function fmtDur(s: number) { return `${s.toFixed(1)}s` }

function StudioPage() {
  // Toàn bộ 4 bước (recap + cut + voice + merge) đã nối BE thật.
  const [youtubeUrl, setYoutubeUrl] = useState('https://www.youtube.com/watch?v=oa4WoU-dm0o')
  const [rawFile, setRawFile] = useState<File | null>(null)
  const [job, setJob] = useState<StudioJob | null>(null)
  const [clonedVoices, setClonedVoices] = useState<Voice[]>([])
  const [voiceId, setVoiceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [recapError, setRecapError] = useState('')
  const [cutError, setCutError] = useState('')
  const [voiceError, setVoiceError] = useState('')
  const [mergeError, setMergeError] = useState('')
  const [playingVo, setPlayingVo] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const [recentJobs, setRecentJobs] = useState<RecapJobOut[]>([])
  const [loadingRecent, setLoadingRecent] = useState(false)

  useEffect(() => {
    fetch(`${API_URL}/api/voices`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not ok'))))
      .then((d) => {
        const list: Voice[] = d.voices ?? d ?? []
        setClonedVoices(list)
        if (!voiceId && list.length) setVoiceId(list[0].voice_id)
      })
      .catch(() => setClonedVoices([]))
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // Tải danh sách job gần đây (từ disk qua rehydrate) — chỉ khi chưa có job nào đang mở.
  useEffect(() => {
    if (job) return
    setLoadingRecent(true)
    fetch(`${API_URL}/api/recap/jobs`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('not ok'))))
      .then((list: RecapJobOut[]) => setRecentJobs(Array.isArray(list) ? list : []))
      .catch(() => setRecentJobs([]))
      .finally(() => setLoadingRecent(false))
  }, [job])

  function openJob(j: RecapJobOut) {
    stopVo()
    setRecapError(''); setCutError(''); setVoiceError(''); setMergeError('')
    setJob(mapRecap(j, voiceId || j.youtube_url))
  }

  function statusLabel(status: string) {
    const m: Record<string, string> = {
      recap_running: 'Đang recap', recap_done: 'Đã recap', cut_running: 'Đang cắt', cut_done: 'Đã cắt',
      voice_running: 'Đang voice', voice_done: 'Đã voice', merge_running: 'Đang ghép', merged: 'Đã ghép xong', error: 'Lỗi',
    }
    return m[status] || status
  }

  const allSegments = job ? job.scenes.flatMap(s => s.segments) : []
  const stepState = (k: 'recap' | 'cut' | 'voice' | 'merge') => {
    if (!job) return 'pending' as const
    const order = ['recap_done', 'cut_done', 'voice_done', 'merged']
    const map = { recap: 'recap_done', cut: 'cut_done', voice: 'voice_done', merge: 'merged' } as const
    if (job.status === (`${k}_running` as string)) return 'running' as const
    const curIdx = order.indexOf(job.status === 'idle' ? 'recap_done' : job.status.replace('_running', '_done'))
    const myIdx = order.indexOf(map[k])
    if (myIdx <= curIdx) return 'done' as const
    if (myIdx === curIdx + 1) return 'active' as const
    return 'pending' as const
  }

  async function startRecap() {
    if (!youtubeUrl.trim()) { setRecapError('Dán link YouTube.'); return }
    if (!rawFile) { setRecapError('Cần tải file transcript (raw.txt).'); return }
    setBusy(true); setRecapError('')
    setJob({ job_id: '', youtube_url: youtubeUrl.trim(), status: 'recap_running', voice_id: voiceId, scenes: [], overspeed: [], clips: [] })
    try {
      const form = new FormData()
      form.append('youtube_url', youtubeUrl.trim())
      form.append('raw_file', rawFile)
      const r = await fetch(`${API_URL}/api/recap/generate`, { method: 'POST', body: form })
      const data: RecapJobOut = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `Lỗi ${r.status}`)
      setJob(mapRecap(data, voiceId))
    } catch (e) {
      setRecapError(e instanceof Error ? e.message : 'Tạo recap thất bại.')
      setJob(null)
    } finally { setBusy(false) }
  }
  async function cut() {
    if (!job) return
    setCutError('')
    setJob(j => j ? { ...j, status: 'cut_running' } : j)
    try {
      const r = await fetch(`${API_URL}/api/recap/cut`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id }),
      })
      const data: RecapJobOut = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `Lỗi ${r.status}`)
      setJob(j => j ? { ...j, status: 'cut_done', clips: data.clips ?? [] } : j)
    } catch (e) {
      setCutError(e instanceof Error ? e.message : 'Cắt video thất bại.')
      setJob(j => j ? { ...j, status: 'recap_done' } : j) // revert để bật lại nút
    }
  }
  async function voice() {
    if (!job || !voiceId) return
    setVoiceError('')
    setJob(j => j ? { ...j, status: 'voice_running' } : j)
    try {
      const r = await fetch(`${API_URL}/api/recap/voice`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id, voice_id: voiceId }),
      })
      const data: RecapJobOut = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `Lỗi ${r.status}`)
      setJob(j => j ? { ...j, status: 'voice_done', voice_id: voiceId, overspeed: data.overspeed ?? [] } : j)
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : 'Tạo voice thất bại.')
      setJob(j => j ? { ...j, status: 'cut_done' } : j) // revert để bật lại nút
    }
  }
  async function merge() {
    if (!job) return
    setMergeError('')
    setJob(j => j ? { ...j, status: 'merge_running' } : j)
    try {
      const r = await fetch(`${API_URL}/api/recap/merge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job_id: job.job_id }),
      })
      const data: RecapJobOut = await r.json()
      if (!r.ok) throw new Error(data.error || data.detail || `Lỗi ${r.status}`)
      setJob(j => j ? { ...j, status: 'merged' } : j)
    } catch (e) {
      setMergeError(e instanceof Error ? e.message : 'Ghép video thất bại.')
      setJob(j => j ? { ...j, status: 'voice_done' } : j) // revert để bật lại nút
    }
  }
  function stopVo() { audioRef.current?.pause(); audioRef.current = null; setPlayingVo(null) }
  async function toggleVo(idx: number) {
    if (!job) return
    const audio = audioRef.current
    if (audio && playingVo === idx) { stopVo(); return } // đang phát đoạn này → bấm lại = dừng
    audio?.pause()
    setPlayingVo(idx)
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs/${job.job_id}/voice/${idx}`)
      if (!r.ok) { const e = await r.json().catch(() => null); throw new Error(e?.detail || `Lỗi ${r.status}`) }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = audio ?? new Audio()
      a.onended = () => { URL.revokeObjectURL(url); setPlayingVo(null) }
      a.src = url
      audioRef.current = a
      await a.play()
    } catch (e) {
      setVoiceError(e instanceof Error ? e.message : `Phát vo_${idx}.wav thất bại.`)
      setPlayingVo(null)
    }
  }
  function reset() { stopVo(); setJob(null); setRawFile(null) }

  const steps = [
    { k: 'recap' as const, label: 'Tạo recap', icon: Sparkles },
    { k: 'cut' as const, label: 'Cắt video', icon: Scissors },
    { k: 'voice' as const, label: 'Tạo voice', icon: Mic },
    { k: 'merge' as const, label: 'Ghép', icon: Film },
  ]

  return <section className="settings-page studio-page">
    <div className="settings-heading"><div>
      <p className="overline">YOUTUBE RECAP</p><h1>Studio</h1>
      <p className="page-subtitle">Tóm tắt video YouTube + lồng tiếng Việt — pipeline 4 bước.</p>
      <span className="mock-badge">Pipeline 4 bước đã nối BE · tải final_recap.mp4 khi ghép xong</span>
    </div></div>

    <div className="studio-stepper">
      {steps.map((s, i) => {
        const st = stepState(s.k)
        return <div key={s.k} className={`step ${st}`}>
          <div className="step-num">{st === 'done' ? <CheckCircle2 size={18} /> : st === 'running' ? <Loader2 size={18} className="spin" /> : i + 1}</div>
          <div className="step-body"><s.icon size={15} /><span>{s.label}</span></div>
        </div>
      })}
    </div>

    {!job
      ? <>
        <div className="settings-card">
          <div className="integration-title"><div className="gemini-icon"><Upload size={17} /></div><div><h2>Bước 1 — Tạo recap</h2><p>Dán link YouTube + tải file transcript (raw.txt). Gemini phân tích → recap (giữ in-memory state).</p></div></div>
          <label>Link YouTube</label>
          <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
          <label style={{ marginTop: 18 }}>Transcript (raw.txt)</label>
          <div className="voice-file-row"><input type="file" accept=".txt" onChange={(e) => setRawFile(e.target.files?.[0] ?? null)} /><span className="voice-file-name">{rawFile ? rawFile.name : 'Chưa chọn file'}</span></div>
          <div className="settings-actions"><button className="primary-button" onClick={startRecap} disabled={!youtubeUrl.trim() || !rawFile || busy}>{busy ? <Loader2 size={16} className="spin" /> : <Sparkles size={16} />} {busy ? 'Đang phân tích…' : 'Tạo recap'}</button></div>
          {recapError && <p className="settings-message">{recapError}</p>}
        </div>
        {(recentJobs.length > 0 || loadingRecent) && <div className="settings-card" style={{ marginTop: 22 }}>
          <div className="integration-title"><div className="gemini-icon"><Clock3 size={17} /></div><div><h2>Việc gần đây</h2><p>Các job đã tạo (tự khôi phục từ disk sau khi restart server). Bấm “Mở” để xem/tiếp tục.</p></div></div>
          {loadingRecent && recentJobs.length === 0
            ? <p className="settings-message">Đang tải việc gần đây…</p>
            : recentJobs.length === 0
              ? <p className="settings-message">Chưa có job nào trên disk.</p>
              : <div className="voices-list">
                  {recentJobs.map(j => {
                    const n = (j.recap?.scenes ?? []).reduce((a, sc) => a + (sc.segments?.length ?? 0), 0)
                    return <div key={j.job_id} className="voice-item">
                      <div className="voice-item-info">
                        <strong>{j.youtube_url || j.job_id}</strong>
                        <span>{j.job_id} · {statusLabel(j.status)}{n ? ` · ${n} đoạn` : ''}{j.final ? ' · có final' : ''}</span>
                      </div>
                      <div className="voice-item-actions">
                        <button className="primary-button" onClick={() => openJob(j)}><Play size={15} /> Mở</button>
                      </div>
                    </div>
                  })}
                </div>}
        </div>}
        </>
      : <>
        {/* recap result */}
        <div className="settings-card" style={{ marginTop: 22 }}>
          <div className="integration-title"><div className="gemini-icon"><Sparkles size={17} /></div><div><h2>recap.json</h2><p>{job.scenes.length} scene · {allSegments.length} segment · job {job.job_id}</p></div></div>
          {allSegments.length === 0
            ? <p className="settings-message">{job.status === 'recap_running' ? 'Đang phân tích bằng Gemini…' : 'Chưa có dữ liệu.'}</p>
            : <div className="segment-table-wrap"><table className="segment-table">
              <thead><tr><th>#</th><th>Scene</th><th>Bắt đầu</th><th>Kết thúc</th><th>Độ dài</th><th>Vietnamese VO</th></tr></thead>
              <tbody>{job.scenes.flatMap(s => s.segments.map(seg => <tr key={seg.idx}>
                <td>{seg.idx}</td><td>{s.scene_title}</td><td>{seg.start}</td><td>{seg.end}</td><td>{fmtDur(seg.duration)}</td>
                <td>{seg.vietnamese_vo}</td>
              </tr>))}</tbody>
            </table></div>}
        </div>

        {/* cut */}
        <div className="settings-card" style={{ marginTop: 22 }}>
          <div className="integration-title"><div className="gemini-icon"><Scissors size={17} /></div><div><h2>Bước 2 — Cắt video</h2><p>yt-dlp tải 1 lần (1080p, video-only) → FFmpeg cut [start, end] mỗi segment → clip_i.mp4.</p></div></div>
          <div className="settings-actions"><button className="primary-button" onClick={cut} disabled={stepState('cut') === 'done' || stepState('cut') === 'running' || stepState('recap') !== 'done'}>{stepState('cut') === 'running' ? <Loader2 size={16} className="spin" /> : <Scissors size={16} />} {stepState('cut') === 'done' ? 'Đã cắt xong' : stepState('cut') === 'running' ? 'Đang cắt…' : 'Cắt video'}</button></div>
          {stepState('cut') === 'running' && <p className="settings-message">Đang tải video 1080p + cắt {allSegments.length} đoạn (có thể mất 1-2 phút với video dài)…</p>}
          {cutError && <p className="settings-message">{cutError}</p>}
          {stepState('cut') === 'done' && <div className="chips">{(job.clips.length ? job.clips : allSegments.map(s => `clip_${s.idx}.mp4`)).map(name => <span key={name} className="chip">🎬 {name}</span>)}</div>}
        </div>

        {/* voice */}
        <div className="settings-card" style={{ marginTop: 22 }}>
          <div className="integration-title"><div className="gemini-icon"><Mic size={17} /></div><div><h2>Bước 3 — Tạo voice</h2><p>Gom vietnamese_vo → /tts/batch (voice-service) → vo_i.wav + atempo sync theo duration_sec.</p></div></div>
          <label>Chọn giọng <span>(chỉ giọng đã clone)</span></label>
          {clonedVoices.length === 0
            ? <p className="settings-message">Chưa có giọng clone — tạo ở trang Voices trước.</p>
            : <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={stepState('voice') === 'done'}>
                {clonedVoices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
              </select>}
          <div className="settings-actions"><button className="primary-button" onClick={voice} disabled={!voiceId || stepState('voice') === 'done' || stepState('voice') === 'running' || stepState('cut') !== 'done'}>{stepState('voice') === 'running' ? <Loader2 size={16} className="spin" /> : <Mic size={16} />} {stepState('voice') === 'done' ? 'Đã tạo voice xong' : stepState('voice') === 'running' ? 'Đang tạo voice…' : 'Tạo voice'}</button></div>
          {stepState('voice') === 'running' && <p className="settings-message">Đang TTS {allSegments.length} đoạn + atempo sync (CPU/ONNX, có thể mất 1-2 phút)…</p>}
          {voiceError && <p className="settings-message">{voiceError}</p>}
          {stepState('voice') === 'done' && <div className="chips">{allSegments.map(s => {
            const over = job.overspeed.includes(s.idx)
            const isPlaying = playingVo === s.idx
            return <button key={s.idx} className={`chip ${over ? 'chip-warn' : ''} ${isPlaying ? 'chip-active' : ''}`} onClick={() => toggleVo(s.idx)} title="Bấm để nghe thử">
              {isPlaying ? <Pause size={13} /> : <Play size={13} />} vo_{s.idx}.wav{over ? ' · ép tốc độ' : ''}
            </button>
          })}</div>}
          {stepState('voice') === 'done' && job.overspeed.length > 0 && <p className="settings-message">⚠ {job.overspeed.length} đoạn VO dài hơn 2× clip → atempo ép tốc độ nhiều (nghe có thể hơi nhanh).</p>}
        </div>

        {/* merge */}
        <div className="settings-card" style={{ marginTop: 22 }}>
          <div className="integration-title"><div className="gemini-icon"><Film size={17} /></div><div><h2>Bước 4 — Ghép</h2><p>Mux clip_i + vo_i → seg_i → concat (stream-copy) → final_recap.mp4.</p></div></div>
          <div className="settings-actions"><button className="primary-button" onClick={merge} disabled={stepState('merge') === 'done' || stepState('merge') === 'running' || stepState('voice') !== 'done'}>{stepState('merge') === 'running' ? <Loader2 size={16} className="spin" /> : <Film size={16} />} {stepState('merge') === 'done' ? 'Đã ghép xong' : stepState('merge') === 'running' ? 'Đang ghép…' : 'Ghép video'}</button></div>
          {stepState('merge') === 'running' && <p className="settings-message">Đang mux {allSegments.length} đoạn + concat (stream-copy, ~1-2 phút với video dài)…</p>}
          {mergeError && <p className="settings-message">{mergeError}</p>}
          {stepState('merge') === 'done' && job.job_id && <>
            <div className="studio-final">
              <video className="final-video" controls preload="metadata" src={`${API_URL}/api/recap/jobs/${job.job_id}/final`} />
              <div className="final-meta"><strong>final_recap.mp4</strong><span>{allSegments.length} đoạn · ~{fmtDur(allSegments.reduce((a, s) => a + s.duration, 0))} · 1080p + VO Việt</span>
                <a className="chrome-button" href={`${API_URL}/api/recap/jobs/${job.job_id}/final`} download="final_recap.mp4" style={{ textDecoration: 'none', display: 'inline-flex' }}><Upload size={15} /> Tải về</a>
              </div>
              <button className="chrome-button" onClick={reset}><Trash2 size={15} /> Bắt đầu lại</button>
            </div>
          </>}
        </div>
      </>}
  </section>
}

function App() {
  const [activePage, setActivePage] = useState('Studio')
  const [collapsed, setCollapsed] = useState(false)
  return <div className="app-shell"><aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}><div className="brand-row"><div className="brand-mark"><Sparkles size={17} /></div>{!collapsed && <span className="brand-name">Search Studio</span>}<button className="icon-button sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <Menu size={18} /> : <PanelLeftClose size={18} />}</button></div><div className="workspace-select"><div className="workspace-avatar">S</div>{!collapsed && <><div className="workspace-copy"><span>Workspace</span><strong>Personal space</strong></div><ChevronDown size={15} /></>}</div><nav className="nav-list">{!collapsed && <span className="nav-label">MENU</span>}{navigation.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activePage === label ? 'nav-item-active' : ''}`} onClick={() => setActivePage(label)}><Icon size={18} /><span className={collapsed ? 'sr-only' : ''}>{label}</span></button>)}</nav><div className="sidebar-footer"><div className="profile-row"><div className="profile-avatar">A</div>{!collapsed && <div className="profile-copy"><strong>Admin</strong><span>admin@example.com</span></div>}</div></div></aside><main className="main-content"><header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{activePage}</strong></div><button className="help-button">?</button></header><div className="content-wrap">{activePage === 'Cài đặt' ? <SettingsPage /> : activePage === 'Voices' ? <VoicesPage /> : activePage === 'Studio' ? <StudioPage /> : <section className="empty-state"><div className="empty-illustration"><Search size={34} /></div><h2>Chưa có dữ liệu</h2><p>Khu vực này đang được chuẩn bị.</p></section>}</div></main></div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
