import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Download, Eraser, FileVideo, Film, FolderOpen, GitBranch, LayoutDashboard, Loader2, Menu, Mic, Music, PanelLeftClose, Pause, Play, PlaySquare, Plus, RefreshCw, Save, Scissors, Search, Settings, Sparkles, Trash2, Upload, Volume2, XCircle } from 'lucide-react'
import './styles.css'

const API_URL = 'http://127.0.0.1:8000'
const navigation = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Studio', icon: PlaySquare },
  { label: 'Voices', icon: Mic },
  { label: 'Thư viện nhạc', icon: Music },
  { label: 'Xóa Watermark', icon: Eraser },
  { label: 'Lịch sử', icon: Clock3 },
  { label: 'Cài đặt', icon: Settings },
]

type GeminiState = { has_cookie: boolean; cookie_count: number; saved_at?: string; client_context_token: string; app_url: string }
type YtState = { logged_in: boolean; cookie_count: number; saved_at?: string | null }

function SettingsPage() {
  const [state, setState] = useState<GeminiState>({ has_cookie: false, cookie_count: 0, client_context_token: '', app_url: 'https://gemini.google.com/app' })
  const [cookies, setCookies] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [yt, setYt] = useState<YtState>({ logged_in: false, cookie_count: 0 })
  const [ytLoading, setYtLoading] = useState(false)
  const [ytMsg, setYtMsg] = useState('')

  useEffect(() => { fetch(`${API_URL}/api/settings/gemini`).then((response) => response.json()).then(setState).catch(() => setMessage('Không kết nối được Backend.')) }, [])
  useEffect(() => { fetch(`${API_URL}/api/recap/yt/login`).then((r) => r.json()).then(setYt).catch(() => { }) }, [])

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

  async function loginYt() {
    setYtLoading(true); setYtMsg('Đang mở Chrome tới YouTube. Hãy đăng nhập Google (account KHÁC Gemini, không bị SABR để giữ 1080p)...')
    try {
      const response = await fetch(`${API_URL}/api/recap/yt/login`, { method: 'POST' })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Đăng nhập thất bại')
      setYt({ logged_in: true, cookie_count: result.cookie_count }); setYtMsg('Đã đăng nhập YouTube — cookies lưu để yt-dlp fallback khi bị bot-wall.')
    } catch (error) { setYtMsg(error instanceof Error ? error.message : 'Đăng nhập thất bại.') } finally { setYtLoading(false) }
  }

  return <section className="settings-page"><div className="settings-heading"><div><p className="overline">CẤU HÌNH</p><h1>Cài đặt</h1><p className="page-subtitle">Quản lý kết nối và thông tin xác thực cho các công cụ.</p></div></div><div className="settings-card"><div className="integration-title"><div className="gemini-icon"><Sparkles size={17} /></div><div><h2>Gemini (Highlight video)</h2><p>Dùng Gemini web bằng cookie (free) — dẫn cookie từ gemini.google.com</p></div></div><label>Cookies <span>(đã có — dán mới để đổi)</span></label><textarea value={cookies} onChange={(event) => setCookies(event.target.value)} placeholder={state.has_cookie ? '•••••••• (đã lưu)' : 'Dán cookie Gemini tại đây...'} /><div className="settings-grid"><div><label>Client context token <span>(chỉ cần khi upload FILE)</span></label><input value={state.client_context_token} onChange={(event) => setState({ ...state, client_context_token: event.target.value })} placeholder="...(lấy từ DevTools, link YouTube không cần)" /></div><div><label>App URL <span>(tùy chọn)</span></label><input value={state.app_url} onChange={(event) => setState({ ...state, app_url: event.target.value })} /></div></div><div className="settings-actions"><button className="primary-button" onClick={save} disabled={loading}><Save size={16} /> Lưu</button><button className="chrome-button" onClick={loginChrome} disabled={loading}><span className="chrome-logo">◉</span> Đăng nhập Gemini (Chrome)</button>{state.has_cookie && <span className="cookie-status"><CheckCircle2 size={15} /> Đã có cookie</span>}</div>{message && <p className="settings-message">{message}</p>}<p className="settings-help"><strong>Cách 1:</strong> bấm “Đăng nhập Gemini (Chrome)” → cửa sổ Chrome mở, đăng nhập Google 1 lần → tool tự lấy cookie (lần sau tự gia hạn). <strong>Cách 2:</strong> dán cookie thủ công ở trên.</p></div><div className="settings-card" style={{ marginTop: 22 }}><div className="integration-title"><div className="gemini-icon"><Film size={17} /></div><div><h2>YouTube (tải video recap)</h2><p>Khi IP bị YouTube chặn bot (“Sign in to confirm”), yt-dlp tự fallback sang cookies account đã login. Profile riêng — không đụng Gemini.</p></div></div><div className="settings-actions"><button className="chrome-button" onClick={loginYt} disabled={ytLoading}><span className="chrome-logo">◉</span> {ytLoading ? 'Đang chờ đăng nhập...' : 'Đăng nhập YouTube (Chrome)'}</button>{yt.logged_in && <span className="cookie-status"><CheckCircle2 size={15} /> Đã có cookie{yt.cookie_count ? ` · ${yt.cookie_count}` : ''}{yt.saved_at ? ` · ${new Date(yt.saved_at).toLocaleString()}` : ''}</span>}</div>{ytMsg && <p className="settings-message">{ytMsg}</p>}<p className="settings-help">Mặc định tải KHÔNG dùng cookies (1080p). Chỉ khi bị bot-wall mới tự chuyển sang cookies. <strong>Dùng account Google khác (không bị thử nghiệm SABR) để giữ 1080p</strong> — account bị SABR sẽ ra 360p.</p></div></section>
}

type Voice = { voice_id: string; name: string; created_at?: string; tags?: string[] }
type Preset = { name: string; description: string; gender: string }
type BgmOut = { track_id: string; name: string; needs_attribution: boolean; description: string | null; duration_sec: number; created_at?: string }

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

// ─── BgmPage (Thư viện nhạc) ─────────────────────────────────────────────────
function BgmPage() {
  const [tracks, setTracks] = useState<BgmOut[]>([])
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [needsAttr, setNeedsAttr] = useState(false)
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function load() {
    fetch(`${API_URL}/api/bgm`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: BgmOut[]) => setTracks(d))
      .catch(() => setMessage('Không tải được thư viện nhạc.'))
  }
  useEffect(() => { load() }, []) // eslint-disable-line

  async function create() {
    if (!file || !name.trim()) { setMessage('Cần tên track và file audio.'); return }
    setLoading(true); setMessage('')
    const form = new FormData()
    form.append('name', name.trim())
    form.append('audio', file)
    form.append('needs_attribution', String(needsAttr))
    if (needsAttr && description.trim()) form.append('description', description.trim())
    try {
      const r = await fetch(`${API_URL}/api/bgm`, { method: 'POST', body: form })
      if (!r.ok) { const e = await r.json().catch(() => null); throw new Error(e?.detail || `Lỗi ${r.status}`) }
      const t: BgmOut = await r.json()
      setTracks([t, ...tracks]); setName(''); setFile(null); setNeedsAttr(false); setDescription('')
      setMessage('Đã thêm track.')
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Thêm track thất bại.') }
    finally { setLoading(false) }
  }

  async function importFolder() {
    const folder = window.prompt('Đường dẫn thư mục nhạc:', 'C:\\Users\\nguye\\Music\\music_no_copyright')
    if (!folder) return
    setImporting(true); setMessage('')
    try {
      const r = await fetch(`${API_URL}/api/bgm/import`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder }),
      })
      if (!r.ok) { const e = await r.json().catch(() => null); throw new Error(e?.detail || `Lỗi ${r.status}`) }
      const imported: BgmOut[] = await r.json()
      setMessage(`Đã nhập ${imported.length} track.`); load()
    } catch (e) { setMessage(e instanceof Error ? e.message : 'Nhập thất bại.') }
    finally { setImporting(false) }
  }

  async function remove(id: string) {
    try {
      const r = await fetch(`${API_URL}/api/bgm/${id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      setTracks(tracks.filter(t => t.track_id !== id))
    } catch { setMessage('Xoá thất bại.') }
  }

  function stopPreview() { audioRef.current?.pause(); audioRef.current = null; setPlaying(null) }
  function preview(id: string) {
    if (playing === id) { stopPreview(); return }
    stopPreview(); setPlaying(id)
    const a = new Audio(`${API_URL}/api/bgm/${id}/audio`)
    a.onended = () => { setPlaying(null) }
    a.onerror = () => { setPlaying(null); setMessage('Không phát được audio.') }
    audioRef.current = a; a.play().catch(() => setPlaying(null))
  }

  return <section className="settings-page">
    <div className="settings-heading"><div>
      <p className="overline">NHẠC NỀN</p><h1>Thư viện nhạc</h1>
      <p className="page-subtitle">Nhạc không bản quyền — mix dưới VO khi tạo recap. Track cần ghi credit có badge CC BY.</p>
    </div></div>

    <div className="settings-card">
      <div className="integration-title"><div className="gemini-icon"><Music size={17} /></div>
        <div><h2>Thêm track</h2><p>Tải file audio + tên. Tick “cần credit” nếu track yêu cầu attribution (CC BY…).</p></div></div>
      <label>Tên track</label>
      <input value={name} onChange={e => setName(e.target.value)} placeholder="vd: carefree-by-kevin-macleod" />
      <label style={{ marginTop: 18 }}>File audio <span>(mp3/wav)</span></label>
      <div className="voice-file-row"><input type="file" accept="audio/*" onChange={e => setFile(e.target.files?.[0] ?? null)} />
        <span className="voice-file-name">{file ? file.name : 'Chưa chọn file'}</span></div>
      <label style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
        <input type="checkbox" checked={needsAttr} onChange={e => setNeedsAttr(e.target.checked)} style={{ width: 16, height: 16 }} />
        Cần ghi credit (attribution)
      </label>
      {needsAttr && <><label style={{ marginTop: 14 }}>Credit text <span>(dán vào mô tả YouTube)</span></label>
        <textarea value={description} onChange={e => setDescription(e.target.value)} rows={3}
          placeholder="vd: Carefree by Kevin MacLeod (incompetech.com) — Licensed under Creative Commons: By Attribution 4.0…" /></>}
      <div className="settings-actions">
        <button className="primary-button" onClick={create} disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" /> : <Plus size={16} />} Thêm track
        </button>
        <button className="chrome-button" onClick={importFolder} disabled={importing}>
          {importing ? <Loader2 size={15} className="spin" /> : <Upload size={15} />} Nhập từ thư mục
        </button>
      </div>
      {message && <p className="settings-message">{message}</p>}
    </div>

    <div className="settings-card" style={{ marginTop: 22 }}>
      <div className="integration-title"><div className="gemini-icon"><Music size={17} /></div>
        <div><h2>Danh sách track</h2><p>{tracks.length} track. Bấm ▶ để nghe thử.</p></div></div>
      {tracks.length === 0
        ? <p className="settings-message">Chưa có track nào — thêm thủ công hoặc “Nhập từ thư mục”.</p>
        : <div className="voices-list">{tracks.map(t => <div key={t.track_id} className="voice-item">
          <div className="voice-item-info">
            <strong>{t.name}{t.needs_attribution && <span className="badge b-merged" style={{ marginLeft: 8, fontSize: 10, padding: '2px 7px' }}>CC BY</span>}</strong>
            <span>{t.duration_sec ? `${t.duration_sec.toFixed(0)}s` : '—'}{t.needs_attribution && t.description ? ' · cần credit' : ' · không cần credit'}</span>
          </div>
          <div className="voice-item-actions">
            <button className="primary-button" onClick={() => preview(t.track_id)}>
              {playing === t.track_id ? <Pause size={15} /> : <Play size={15} />} {playing === t.track_id ? 'Dừng' : 'Nghe'}
            </button>
            <button className="chrome-button" onClick={() => remove(t.track_id)}><Trash2 size={15} /> Xoá</button>
          </div>
        </div>)}</div>}
    </div>
  </section>
}

// ─── WatermarkPage (Xóa Watermark Gemini SynthID) ───────────────────────────
type WatermarkVideoItem = {
  name: string
  size_bytes: number
  status: 'pending' | 'running' | 'done' | 'error'
  output_name?: string | null
  error?: string | null
  processed_frames?: number | null
  frame_estimate?: number | null
}

type WatermarkBatchJob = {
  job_id: string
  status: 'idle' | 'running' | 'done' | 'error'
  total: number
  done: number
  failed: number
  videos: WatermarkVideoItem[]
  created_at: string
  updated_at: string
}

type QueuedFile = {
  path: string       // đường dẫn native hoặc tên file
  name: string
  size: number
  file?: File        // File object từ browser (cho upload mode)
}

function fmtBytes(bytes: number): string {
  if (!bytes || bytes === 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

function WatermarkPage() {
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
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((jobs: WatermarkBatchJob[]) => setHistoryJobs(jobs))
      .catch(() => { })
  }, [])

  useEffect(() => {
    checkCli()
    loadHistory()
  }, [checkCli, loadHistory])

  // Polling current job
  useEffect(() => {
    if (!currentJob || currentJob.status === 'done' || currentJob.status === 'error') {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
      setIsProcessing(false)
      return
    }

    setIsProcessing(true)
    pollTimerRef.current = setInterval(() => {
      fetch(`${API_URL}/api/watermark/jobs/${currentJob.job_id}`)
        .then(r => r.ok ? r.json() : Promise.reject())
        .then((updated: WatermarkBatchJob) => {
          setCurrentJob(updated)
          if (updated.status === 'done' || updated.status === 'error') {
            clearInterval(pollTimerRef.current)
            setIsProcessing(false)
            loadHistory()
          }
        })
        .catch(() => { })
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
      if (f.name.toLowerCase().endsWith('.mp4') || nativePath.toLowerCase().endsWith('.mp4')) {
        if (!queue.some(q => q.name === f.name)) {
          newItems.push({
            path: nativePath || f.name,
            name: f.name,
            size: f.size || 0,
            file: f,  // Lưu File object để upload sau
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
    const trimmed = entered.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1')
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
      const hasValidPaths = queue.some(q => q.path && q.path !== q.name && !q.path.includes(' '))

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
          videos: queue.map(q => ({ name: q.name, size_bytes: q.size, status: 'pending' })),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
      }
      setQueue([])
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Khởi động xóa watermark thất bại.')
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
            Tự động phát hiện và xóa biểu tượng watermark ✦ SynthID khỏi video gốc bằng AI Inpainting.
          </p>
        </div>
      </div>

      {/* CLI Check Banner */}
      {cliOk !== null && (
        <div className={`wm-cli-banner ${cliOk ? 'wm-cli-ok' : 'wm-cli-error'}`}>
          {cliOk ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          <span>{cliMsg}</span>
          {!cliOk && <span className="wm-cli-cmd">npm install -g @pilio/gemini-watermark-remover</span>}
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
              <span>Tiến trình xử lý — Job <code style={{ color: '#6366f1' }}>{currentJob.job_id}</code></span>
            </div>
            <span className={`wm-badge wm-badge-${currentJob.status}`}>
              {currentJob.status === 'running' && <Loader2 size={12} className="spin" />}
              {currentJob.status === 'running' ? 'Đang xử lý' : currentJob.status === 'done' ? 'Hoàn thành' : currentJob.status === 'error' ? 'Có lỗi' : 'Chờ'}
            </span>
            {currentJob.failed > 0 && (
              <span className="wm-prog-fail">{currentJob.failed} file lỗi</span>
            )}
            <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}>
              {currentJob.done > 0 && (
                <a
                  href={`${API_URL}/api/watermark/download-all/${currentJob.job_id}`}
                  download={`watermark_clean_${currentJob.job_id}.zip`}
                  className="primary-button"
                  style={{ minHeight: 32, height: 32, fontSize: 12, padding: '0 12px', textDecoration: 'none', background: '#16a34a' }}
                  title="Tải toàn bộ các video sạch trong job này về máy dưới dạng 1 file ZIP"
                >
                  <Download size={14} /> Tải tất cả ({currentJob.done} video ZIP)
                </a>
              )}
              <button
                className="wm-new-btn"
                onClick={() => { setCurrentJob(null); setQueue([]) }}
              >
                + Mẻ mới
              </button>
            </div>
          </div>

          <div className="wm-prog-bar-wrap">
            <div
              className="wm-prog-bar"
              style={{ width: `${currentJob.total > 0 ? ((currentJob.done + currentJob.failed) / currentJob.total) * 100 : 0}%` }}
            />
          </div>

          <div className="wm-prog-pct">
            {currentJob.done}/{currentJob.total} video hoàn thành ({currentJob.total > 0 ? Math.round(((currentJob.done) / currentJob.total) * 100) : 0}%)
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
                  {v.status === 'pending' && <span className="wm-st wm-st-pending">Đang chờ</span>}
                  {v.status === 'running' && (
                    <span className="wm-st wm-st-running">
                      <Loader2 size={13} className="spin" />
                      {v.processed_frames != null
                        ? `${v.processed_frames}${v.frame_estimate ? `/${v.frame_estimate}` : ''} frames`
                        : 'Đang xóa...'}
                    </span>
                  )}
                  {v.status === 'done' && (
                    <span className="wm-st wm-st-done">
                      <CheckCircle2 size={13} /> Sạch 100%
                    </span>
                  )}
                  {v.status === 'error' && (
                    <span className="wm-st wm-st-error" title={v.error || 'Lỗi xử lý'}>
                      <XCircle size={13} /> Lỗi
                    </span>
                  )}
                  {v.status === 'done' && (
                    <a
                      href={`${API_URL}/api/watermark/download/${currentJob.job_id}/${encodeURIComponent(v.name)}`}
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
            className={`wm-dropzone ${isDragging ? 'wm-dropzone-over' : ''} ${cliOk === false ? 'wm-dropzone-disabled' : ''}`}
            onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
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
            <p className="wm-drop-sub">hoặc <span className="wm-drop-link">duyệt chọn từ máy</span></p>
          </div>

          <div className="settings-actions" style={{ justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                className="primary-button"
                onClick={handleStartProcess}
                disabled={queue.length === 0 || isProcessing || cliOk === false}
              >
                {isProcessing ? <Loader2 size={16} className="spin" /> : <Eraser size={16} />}
                Bắt đầu xóa watermark ({queue.length} video)
              </button>
              <button
                className="chrome-button"
                onClick={handleImportPath}
                disabled={isProcessing}
              >
                <FolderOpen size={15} /> Nhập đường dẫn file
              </button>
            </div>

            {queue.length > 0 && (
              <button
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
                      <div className="wm-item-size">{q.path || '—'} {q.size > 0 ? `· ${fmtBytes(q.size)}` : ''}</div>
                    </div>
                    <button
                      className="wm-remove-btn"
                      onClick={() => setQueue(queue.filter((_, i) => i !== idx))}
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
            <div style={{ display: 'flex', justifyContent: 'space-between', width: '100%', alignItems: 'center' }}>
              <div>
                <h2>Lịch sử các đợt xử lý ({historyJobs.length})</h2>
                <p>Xem lại các đợt xóa watermark đã hoàn thành gần đây.</p>
              </div>
              <button className="chrome-button" onClick={loadHistory} style={{ height: 34, padding: '0 12px' }}>
                <RefreshCw size={13} /> Làm mới
              </button>
            </div>
          </div>

          <div className="voices-list">
            {historyJobs.map(job => (
              <div key={job.job_id} className="voice-item" style={{ alignItems: 'center' }}>
                <div className="voice-item-info">
                  <strong>
                    Batch {job.job_id}
                    <span className={`wm-badge wm-badge-${job.status}`} style={{ marginLeft: 8, fontSize: 10, padding: '2px 7px' }}>
                      {job.status === 'done' ? 'Hoàn thành' : job.status === 'running' ? 'Đang chạy' : job.status}
                    </span>
                  </strong>
                  <span>
                    {job.done}/{job.total} video xong · {new Date(job.created_at).toLocaleString()}
                    {job.videos.length > 0 ? ` · ${job.videos[0].name}${job.videos.length > 1 ? ` (+${job.videos.length - 1})` : ''}` : ''}
                  </span>
                </div>
                <div className="voice-item-actions">
                  {job.done > 0 && (
                    <a
                      href={`${API_URL}/api/watermark/download-all/${job.job_id}`}
                      download={`watermark_clean_${job.job_id}.zip`}
                      className="chrome-button"
                      style={{ height: 32, padding: '0 10px', fontSize: 11, textDecoration: 'none' }}
                      title="Tải tất cả file sạch dạng ZIP"
                    >
                      <Download size={12} /> ZIP ({job.done})
                    </a>
                  )}
                  <button
                    className="primary-button"
                    onClick={() => { setCurrentJob(job); setQueue([]) }}
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

// ─── Types ──────────────────────────────────────────────────────────────────
type BackendSegment = { start_time_sec: number; end_time_sec: number; duration_sec: number; original_text: string; vietnamese_vo: string }
type BackendScene = { scene_title?: string; segments: BackendSegment[] }
type BackendRecap = { video_url?: string; scenes: BackendScene[] }
/** JobOut mới — 4 per-phase status + overall + progress + timestamps */
type JobOut = {
  job_id: string
  youtube_url: string
  overall: string          // idle | running | recap_done | error | merged | polished
  recap_status: string     // idle | running | done | error
  cut_status: string
  voice_status: string
  merge_status: string
  polish_status: string    // idle | running | done | error (Phase R5)
  progress: { cut: { done: number; total: number }; voice: { done: number; total: number; phase?: string }; merge: { done: number; total: number }; polish?: { done: number; total: number; step?: string } }
  created_at?: string
  updated_at?: string
  voice_id?: string | null
  error?: string | null
  recap?: BackendRecap | null
  clips?: string[] | null
  overspeed?: number[] | null
  final?: string | null
  final_studio?: string | null
  credits?: string | null
  // legacy compat
  detail?: string
}

function fmtTime(sec: number) {
  const s = Math.max(0, Math.floor(sec || 0))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}
function fmtDur(s: number) { return `${s.toFixed(1)}s` }
function fmtTs(iso?: string | null) {
  if (!iso) return '—'
  try { return new Date(iso).toLocaleString('vi-VN', { hour12: false }) } catch { return iso }
}

// ─── Node icons helper ───────────────────────────────────────────────────────
type NodeState = 'idle' | 'running' | 'done' | 'error' | 'skipped'
function NodeIcon({ state, icon: Icon }: { state: NodeState; icon: React.ElementType }) {
  if (state === 'running') return <Loader2 size={22} className="spin" />
  if (state === 'done') return <CheckCircle2 size={22} />
  if (state === 'error') return <XCircle size={22} />
  if (state === 'skipped') return <span className="n-skip">—</span>
  return <Icon size={20} />
}

// ─── Pipeline Diagram ────────────────────────────────────────────────────────
function PipelineNode({
  label, subLabel, state: st, icon: Icon, progress,
}: { label: string; subLabel?: string; state: NodeState; icon: React.ElementType; progress?: { done: number; total: number } }) {
  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : null
  return <div className={`node ${st}`}>
    <div className="n-icon"><NodeIcon state={st} icon={Icon} /></div>
    <span className="n-label">{label}</span>
    <span className="n-sub">{subLabel || (st === 'idle' ? 'Chờ…' : st === 'running' ? 'Đang chạy…' : st === 'done' ? 'Hoàn tất' : st === 'skipped' ? 'Bỏ qua' : 'Lỗi')}</span>
    {st === 'running' && pct !== null && <div className="n-pbar"><i style={{ width: pct + '%' }} /></div>}
  </div>
}

function PipelineDiagram({ job, voiceId, polishEnabled }: { job: JobOut; voiceId: string; polishEnabled: boolean }) {
  const segs = (job.recap?.scenes ?? []).reduce((a, s) => a + (s.segments?.length ?? 0), 0)
  const p = job.progress ?? { cut: { done: 0, total: 0 }, voice: { done: 0, total: 0 }, merge: { done: 0, total: 0 } }

  const recapState: NodeState = job.recap_status === 'done' ? 'done' : job.recap_status === 'running' ? 'running' : job.recap_status === 'error' ? 'error' : 'idle'
  const cutState: NodeState = job.cut_status === 'done' ? 'done' : job.cut_status === 'running' ? 'running' : job.cut_status === 'error' ? 'error' : 'idle'
  const voiceState: NodeState = job.voice_status === 'done' ? 'done' : job.voice_status === 'running' ? 'running' : job.voice_status === 'error' ? 'error' : 'idle'
  const mergeState: NodeState = job.merge_status === 'done' ? 'done' : job.merge_status === 'running' ? 'running' : job.merge_status === 'error' ? 'error' : 'idle'
  const polishState: NodeState = !polishEnabled
    ? 'skipped'
    : job.polish_status === 'done' ? 'done' : job.polish_status === 'running' ? 'running' : job.polish_status === 'error' ? 'error' : 'idle'

  const afterRecapDone = recapState === 'done'
  const bothDone = cutState === 'done' && voiceState === 'done'
  const mergeDone = mergeState === 'done'

  const connCls = (active: boolean, done: boolean) =>
    `conn${done ? ' done' : active ? ' active' : ''}`
  const forkCls = (active: boolean, done: boolean) =>
    `fork-lines${done ? ' done' : active ? ' active' : ''}`
  const joinCls = (active: boolean, done: boolean) =>
    `join-lines${done ? ' done' : active ? ' active' : ''}`

  const subRecap = recapState === 'done' ? `${segs} đoạn · ${job.recap?.scenes?.length ?? 0} cảnh` : undefined
  const subCut = cutState === 'running' && p.cut.total > 0 ? `Đang cắt ${p.cut.done}/${p.cut.total}` : cutState === 'done' ? `${p.cut.total} clip` : undefined
  const subVoice = voiceState === 'running' ? (p.voice.phase === 'unpack' ? `Giải nén ${p.voice.done}/${p.voice.total}` : `TTS đang tổng hợp…`) : voiceState === 'done' ? `${p.voice.total} VO` : undefined
  const subMerge = mergeState === 'running' && p.merge.total > 0 ? `Mux ${p.merge.done}/${p.merge.total}` : mergeState === 'done' ? 'final_recap.mp4' : undefined
  const subPolish = polishState === 'running' ? 'Đang mix BGM…' : polishState === 'done' ? 'final_studio.mp4' : polishState === 'skipped' ? 'Không dùng' : undefined

  const statusText = (() => {
    if (job.overall === 'error') return `Lỗi: ${job.error ?? 'không xác định'}`
    if (polishState === 'done') return '✅ Hoàn tất — final_studio.mp4 sẵn sàng tải về'
    if (polishState === 'running') return 'Polish — đang mix nhạc nền dưới VO…'
    if (mergeState === 'done') return '✅ Hoàn tất — final_recap.mp4 sẵn sàng tải về'
    if (mergeState === 'running') return 'Ghép video — mux clip + VO → concat final…'
    if (cutState === 'running' || voiceState === 'running') return 'Cut & Voice đang chạy song song…'
    if (recapState === 'running') return 'Recap — đang lấy & phân tích transcript (YouTube → Gemini)…'
    return 'Đang khởi động pipeline…'
  })()

  const dotCls = polishState === 'done' ? 'dot done' : mergeState === 'done' ? 'dot done' : job.overall === 'error' ? 'dot err' : 'dot run'

  const overallPct = (() => {
    const sc = (s: NodeState) => s === 'done' ? 1 : s === 'running' ? 0.5 : 0
    const denom = polishEnabled ? 5 : 4
    const pts = sc(recapState) + sc(cutState) + sc(voiceState) + sc(mergeState) + (polishEnabled ? sc(polishState) : 0)
    return Math.round(pts / denom * 100)
  })()

  return <>
    <div className="pc-hdr">
      <div className="pc-title-wrap">
        <span className="title">Tiến trình pipeline</span>
        <span className="jid">job: {job.job_id}</span>
      </div>
      <div className="pc-progress">
        <span className="pc-pct">{overallPct}%</span>
        <div className="pc-pbar"><i style={{ width: overallPct + '%' }} /></div>
      </div>
    </div>
    <div className="flow">
      <PipelineNode label="Recap" state={recapState} icon={Sparkles} subLabel={subRecap} />
      <div className={connCls(afterRecapDone, afterRecapDone)} />
      <div className={forkCls(afterRecapDone, bothDone)} />
      <div className="pcol">
        <span className="pbadge">↕ song song</span>
        <PipelineNode label="Cắt video" state={cutState} icon={Scissors} subLabel={subCut} progress={cutState === 'running' ? p.cut : undefined} />
        <PipelineNode label="Tạo voice" state={voiceState} icon={Mic} subLabel={subVoice} progress={voiceState === 'running' && p.voice.phase === 'unpack' ? p.voice : undefined} />
      </div>
      <div className={joinCls(afterRecapDone, bothDone)} />
      <div className={connCls(bothDone, mergeDone)} />
      <PipelineNode label="Ghép video" state={mergeState} icon={Film} subLabel={subMerge} progress={mergeState === 'running' ? p.merge : undefined} />
      <div className={connCls(mergeDone, polishState !== 'idle' && polishState !== 'skipped')} />
      <PipelineNode label="Polish" state={polishState} icon={Music} subLabel={subPolish} />
    </div>
    <div className="sbar">
      <span className={dotCls} />
      <span>{statusText}</span>
    </div>
  </>
}

// ─── Video result card (Studio + History) ────────────────────────────────────
function VideoResultCard({
  jobId, variant, segments, scenes, overspeedCount, credits, onReset, compact,
}: {
  jobId: string
  variant: 'polished' | 'merged'
  segments: number
  scenes: number
  overspeedCount?: number | null
  credits?: string | null
  onReset?: () => void
  compact?: boolean
}) {
  const polished = variant === 'polished'
  const endpoint = polished ? 'studio' : 'final'
  const filename = polished ? 'final_studio.mp4' : 'final_recap.mp4'
  const Icon = polished ? Music : Film
  const subtitle = polished
    ? `${segments} đoạn · ${scenes} cảnh · 1080p · VO Việt + BGM`
    : `${segments} đoạn · ${scenes} cảnh · 1080p · VO Việt`
  const src = `${API_URL}/api/recap/jobs/${jobId}/${endpoint}`

  return <div className={`vrc${compact ? ' vrc-compact' : ''}`}>
    <div className="vrc-player">
      <video className="vrc-video" src={src} controls preload="metadata" playsInline />
      <div className="vrc-badge"><Icon size={13} /> {filename}</div>
    </div>
    <div className="vrc-side">
      <div className="vrc-status">
        <CheckCircle2 size={18} />
        <div>
          <strong>{filename} ✓</strong>
          <span className="meta">{subtitle}</span>
        </div>
      </div>
      {overspeedCount && overspeedCount > 0 && (
        <p className="vrc-warn"><AlertCircle size={13} /> {overspeedCount} đoạn VO ngắn — xem lịch sử để nghe thử</p>
      )}
      <div className="vrc-actions">
        <a className="btn-p vrc-dl" href={src} download={filename}>
          <Download size={14} /> Tải về
        </a>
        {onReset && (
          <button className="btn-g" onClick={onReset}>
            <Trash2 size={14} /> Bắt đầu lại
          </button>
        )}
      </div>
      {credits && (
        <div className="vrc-credit">
          <div className="vrc-credit-hdr"><Sparkles size={14} /> Credit nhạc — dán vào mô tả YouTube</div>
          <textarea readOnly value={credits} rows={4}
            onClick={e => (e.target as HTMLTextAreaElement).select()} />
        </div>
      )}
    </div>
  </div>
}

// ─── StudioPage ──────────────────────────────────────────────────────────────
function StudioPage({ setActivePage }: { setActivePage: (p: string) => void }) {
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [rawText, setRawText] = useState('')
  const [rawFile, setRawFile] = useState<File | null>(null)
  const [voiceId, setVoiceId] = useState('')
  const [clonedVoices, setClonedVoices] = useState<Voice[]>([])
  const [bgmList, setBgmList] = useState<BgmOut[]>([])
  const [bgmEnabled, setBgmEnabled] = useState(false)
  const [bgmIds, setBgmIds] = useState<string[]>([])
  const [bgmVolume, setBgmVolume] = useState(0.15)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<JobOut | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [playingVo, setPlayingVo] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load voices + bgm on mount
  useEffect(() => {
    fetch(`${API_URL}/api/voices`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { const list: Voice[] = d.voices ?? d ?? []; setClonedVoices(list); if (!voiceId && list.length) setVoiceId(list[0].voice_id) })
      .catch(() => { })
    fetch(`${API_URL}/api/bgm`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then((d: BgmOut[]) => setBgmList(d))
      .catch(() => { })
  }, []) // eslint-disable-line

  // Poll loop
  const pollJob = useCallback(async (id: string) => {
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs/${id}`)
      if (!r.ok) return
      const data: JobOut = await r.json()
      setJob(data)
      // Stop polling when pipeline fully done or error
      if (data.overall === 'merged' || data.overall === 'polished' || data.overall === 'error') {
        if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
      }
    } catch { /* network hiccup — keep polling */ }
  }, [])

  useEffect(() => {
    if (!jobId) return
    pollRef.current = setInterval(() => pollJob(jobId), 1500)
    pollJob(jobId)
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [jobId, pollJob])

  async function startPipeline() {
    if (!youtubeUrl.trim()) { setSubmitError('Dán link YouTube.'); return }
    if (!voiceId) { setSubmitError('Chọn giọng trước.'); return }
    if (bgmEnabled && bgmIds.length === 0) { setSubmitError('Bật nhạc nền thì chọn ít nhất 1 track.'); return }
    setSubmitError('')
    setSubmitting(true)
    setJob(null)
    try {
      const form = new FormData()
      form.append('youtube_url', youtubeUrl.trim())
      form.append('voice_id', voiceId)
      if (rawFile) form.append('raw_file', rawFile)  // file đính kèm → skip auto-fetch (ưu tiên)
      else if (rawText.trim()) form.append('raw_text', rawText)  // dán text → skip auto-fetch
      if (bgmEnabled && bgmIds.length) {
        form.append('bgm_ids', JSON.stringify(bgmIds))
        form.append('bgm_volume', String(bgmVolume))
      }
      const r = await fetch(`${API_URL}/api/recap/run`, { method: 'POST', body: form })
      const data = await r.json()
      if (!r.ok) throw new Error(data.detail || data.error || `Lỗi ${r.status}`)
      setJobId(data.job_id)
    } catch (e) {
      setSubmitError(e instanceof Error ? e.message : 'Khởi động pipeline thất bại.')
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    audioRef.current?.pause(); audioRef.current = null; setPlayingVo(null)
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    setJobId(null); setJob(null); setSubmitError(''); setRawText(''); setRawFile(null); setYoutubeUrl('')
  }

  function stopVo() { audioRef.current?.pause(); audioRef.current = null; setPlayingVo(null) }
  async function toggleVo(idx: number) {
    if (!job) return
    if (playingVo === idx) { stopVo(); return }
    audioRef.current?.pause(); setPlayingVo(idx)
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs/${job.job_id}/voice/${idx}`)
      if (!r.ok) { const e = await r.json().catch(() => null); throw new Error(e?.detail || `Lỗi ${r.status}`) }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = new Audio(url)
      a.onended = () => { URL.revokeObjectURL(url); setPlayingVo(null) }
      audioRef.current = a; await a.play()
    } catch (e) { setPlayingVo(null) }
  }

  const allSegs = (job?.recap?.scenes ?? []).flatMap(s => s.segments)

  return <section className="settings-page studio-page">
    <div className="settings-heading"><div>
      <h1>Studio</h1>
      <p className="page-subtitle">Dán link YouTube — transcript tự lấy, <strong>1 click</strong>, Cut &amp; Voice chạy song song, ghép tự động.</p>
    </div></div>

    {/* ── Input form ── */}
    <div className="settings-card" id="formCard">
      <div className="fsection">
        <p className="foverline">NGUỒN</p>
        <div className="fgrid">
          <div className="field">
            <label>Link YouTube</label>
            <input value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=..." disabled={!!jobId} />
          </div>
          <div className="field field-full">
            <label>Raw transcript <span>(tùy chọn — đính kèm file hoặc dán text khi YouTube chặn tự lấy; để trống → tự fetch)</span></label>
            <div className="raw-row">
              <label className="file-trig" style={{ opacity: jobId ? 0.5 : 1, pointerEvents: jobId ? 'none' : 'auto' }}>
                <Upload size={15} />
                <span className="fname">{rawFile ? rawFile.name : 'Đính kèm raw.txt'}</span>
                {rawFile && <span className="fsize">· {(rawFile.size / 1024).toFixed(0)} KB</span>}
                <input type="file" accept=".txt,.json" style={{ display: 'none' }} onChange={e => setRawFile(e.target.files?.[0] ?? null)} />
                <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--indigo2)' }}>{rawFile ? 'Đổi ↑' : 'File ↑'}</span>
              </label>
              {rawFile && <button type="button" className="raw-clear" onClick={() => setRawFile(null)}>✕ huỷ file</button>}
            </div>
            <textarea
              className="raw-input"
              value={rawText}
              onChange={e => setRawText(e.target.value)}
              placeholder={rawFile ? 'Đã đính kèm file — text ở đây bị bỏ qua' : "Hoặc dán transcript tại đây (mỗi dòng [MM:SS] caption). Bỏ trống cả 2 → tự lấy từ YouTube."}
              rows={3}
              disabled={!!jobId || !!rawFile}
            />
            {(rawFile || rawText.trim()) && <span className="raw-hint">{rawFile ? `file ${rawFile.name} (${(rawFile.size / 1024).toFixed(0)} KB)` : `${rawText.length.toLocaleString()} ký tự`} · sẽ skip auto-fetch</span>}
          </div>
        </div>
      </div>

      <div className="fsection">
        <p className="foverline">GIỌNG &amp; NHẠC</p>
        <div className="fgrid">
          <div className="field">
            <label>Voice</label>
            {clonedVoices.length === 0
              ? <p className="settings-message" style={{ marginTop: 4 }}>Chưa có giọng — tạo ở Voices trước.</p>
              : <select value={voiceId} onChange={e => setVoiceId(e.target.value)} disabled={!!jobId}
                style={{ width: '100%', height: 44, padding: '0 12px', background: 'var(--bg3)', border: '1px solid var(--border)', borderRadius: 9, color: 'var(--text)', fontSize: 13 }}>
                {clonedVoices.map(v => <option key={v.voice_id} value={v.voice_id}>{v.name}</option>)}
              </select>}
          </div>
          <div className="field field-full">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
              <input type="checkbox" checked={bgmEnabled} onChange={e => setBgmEnabled(e.target.checked)} disabled={!!jobId} style={{ width: 16, height: 16 }} />
              <Music size={15} /> Nhạc nền (BGM) <span style={{ fontWeight: 400, color: 'var(--text2)' }}>— mix dưới VO; chọn nhiều → tự nối theo thứ tự, video dài hơn sẽ lặp</span>
            </label>
            {bgmEnabled && (
              <div className="bgm-body">
                {bgmList.length === 0
                  ? <p className="bgm-empty">Chưa có track — thêm ở “Thư viện nhạc”.</p>
                  : <div className="chips">
                    {bgmList.map(t => {
                      const order = bgmIds.indexOf(t.track_id)
                      const on = order >= 0
                      return <button key={t.track_id} type="button" className={`chip${on ? ' chip-active' : ''}`} disabled={!!jobId}
                        onClick={() => setBgmIds(prev => on ? prev.filter(x => x !== t.track_id) : [...prev, t.track_id])}>
                        {on && <span className="chip-order">{order + 1}. </span>}{t.name}{t.duration_sec ? ` · ${t.duration_sec.toFixed(0)}s` : ''}{t.needs_attribution ? ' · CC' : ''}
                      </button>
                    })}
                  </div>}
                <label className="bgm-vol">
                  <span className="bgm-vol-label">Volume: {(bgmVolume * 100).toFixed(0)}%</span>
                  <input type="range" className="bgm-range" min={0} max={0.5} step={0.01} value={bgmVolume}
                    onChange={e => setBgmVolume(parseFloat(e.target.value))} disabled={!!jobId} />
                </label>
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="ff">
        {!jobId
          ? <button className="btn-p" onClick={startPipeline} disabled={submitting}>
            {submitting ? <Loader2 size={15} className="spin" /> : <Play size={15} />}
            {submitting ? 'Đang khởi động…' : 'Tạo recap video'}
          </button>
          : <button className="btn-g" onClick={reset}>
            <Trash2 size={14} /> Bắt đầu lại
          </button>}
        <button className="btn-g" onClick={() => setActivePage('Lịch sử')} style={{ gap: 6 }}>
          <Clock3 size={14} /> Xem Lịch sử
        </button>
        {submitError && <span style={{ color: '#dc2626', fontSize: 12 }}><AlertCircle size={13} style={{ display: 'inline', marginRight: 4 }} />{submitError}</span>}
        {job && !submitting && <span className="hint" style={{ marginLeft: 'auto', color: job.overall === 'error' ? '#dc2626' : job.overall === 'merged' || job.overall === 'polished' ? '#16a34a' : '#6366f1' }}>
          {job.overall === 'polished' ? '✅ Hoàn tất (có BGM)' : job.overall === 'merged' ? '✅ Hoàn tất' : job.overall === 'error' ? '❌ Có lỗi' : '⟳ Đang chạy…'}
        </span>}
      </div>
    </div>

    {/* ── Pipeline diagram ── */}
    {job && <div className="pc">
      <PipelineDiagram job={job} voiceId={voiceId} polishEnabled={bgmEnabled && bgmIds.length > 0} />

      {/* Error detail */}
      {job.overall === 'error' && job.error && <div className="err-block">
        <AlertCircle size={15} style={{ flexShrink: 0 }} />
        <span>{job.error}</span>
      </div>}

      {/* Final block — polished (BGM) */}
      {(job.overall === 'polished' || job.overall === 'merged') && job.job_id && (
        <VideoResultCard
          jobId={job.job_id}
          variant={job.overall === 'polished' ? 'polished' : 'merged'}
          segments={allSegs.length}
          scenes={job.recap?.scenes?.length ?? 0}
          overspeedCount={job.overspeed?.length}
          credits={job.overall === 'polished' ? job.credits : null}
          onReset={reset} />
      )}
    </div>}
  </section>
}

// ─── HistoryPage ─────────────────────────────────────────────────────────────
function HistoryPage() {
  const [jobs, setJobs] = useState<JobOut[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<JobOut | null>(null)
  const [playingVo, setPlayingVo] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  async function loadJobs() {
    setLoading(true)
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs`)
      const data: JobOut[] = r.ok ? await r.json() : []
      setJobs(Array.isArray(data) ? data : [])
      if (data.length && !sel) setSel(data[0])
    } catch { setJobs([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { loadJobs() }, []) // eslint-disable-line

  const overallLabel: Record<string, string> = { merged: 'Hoàn tất', polished: 'BGM', running: 'Đang chạy', error: 'Lỗi', recap_done: 'Đã recap', idle: 'Chờ' }
  const overallBadge: Record<string, string> = { merged: 'b-merged', polished: 'b-merged', running: 'b-running', error: 'b-error', recap_done: 'b-idle', idle: 'b-idle' }

  const filtered = jobs.filter(j =>
    j.youtube_url?.toLowerCase().includes(search.toLowerCase()) ||
    j.job_id?.toLowerCase().includes(search.toLowerCase())
  )

  function stopVo() { audioRef.current?.pause(); audioRef.current = null; setPlayingVo(null) }
  async function toggleVo(job: JobOut, idx: number) {
    if (playingVo === idx) { stopVo(); return }
    audioRef.current?.pause(); setPlayingVo(idx)
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs/${job.job_id}/voice/${idx}`)
      if (!r.ok) { setPlayingVo(null); return }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = new Audio(url)
      a.onended = () => { URL.revokeObjectURL(url); setPlayingVo(null) }
      audioRef.current = a; await a.play()
    } catch { setPlayingVo(null) }
  }

  const segsOf = (j: JobOut) => (j.recap?.scenes ?? []).flatMap(s => s.segments)

  return <section className="settings-page">
    <div className="settings-heading"><div>
      <h1>Lịch sử</h1>
      <p className="page-subtitle">Mọi job đã chạy — chi tiết recap, clips, voice và video cuối kèm dấu thời gian.</p>
    </div>
      <button className="chrome-button" onClick={loadJobs}><Search size={15} /> Làm mới</button>
    </div>

    <div className="history-layout">
      {/* ── List ── */}
      <div>
        <div className="swrap">
          <Search size={14} />
          <input className="hsearch" placeholder="Tìm link hoặc job ID…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        {loading && <p className="settings-message">Đang tải…</p>}
        <div className="hlist">
          {filtered.length === 0 && !loading && <p className="settings-message">Không tìm thấy job nào.</p>}
          {filtered.map(j => <div key={j.job_id} className={`hitem${sel?.job_id === j.job_id ? ' sel' : ''}`} onClick={() => { setSel(j); stopVo() }}>
            <div className="hicon"><Film size={16} /></div>
            <div className="hii">
              <strong>{j.youtube_url?.replace('https://www.youtube.com/watch?v=', 'yt/').replace('https://youtube.com/watch?v=', 'yt/') || j.job_id}</strong>
              <span>{j.job_id} · {segsOf(j).length} đoạn · {j.voice_id ?? '—'}</span>
            </div>
            <div className="hright">
              <span className={`badge ${overallBadge[j.overall] ?? 'b-idle'}`}>{overallLabel[j.overall] ?? j.overall}</span>
              <span className="ts">{fmtTs(j.created_at).split(', ')[1] ?? '—'}</span>
            </div>
          </div>)}
        </div>
      </div>

      {/* ── Detail ── */}
      <div className="dpanel">
        {!sel
          ? <div className="dempty">
            <Clock3 size={40} />
            <div>Chọn một job bên trái để xem chi tiết.</div>
          </div>
          : <div className="card scroll" style={{ padding: 0, overflow: 'hidden' }}>
            <div className="dhead">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                <strong style={{ wordBreak: 'break-all', fontSize: 13 }}>{sel.youtube_url}</strong>
                <span className={`badge ${overallBadge[sel.overall] ?? 'b-idle'}`} style={{ flexShrink: 0 }}>{overallLabel[sel.overall] ?? sel.overall}</span>
              </div>
              <div className="dkv" style={{ marginTop: 12 }}>
                <span className="k">Job ID</span><span className="v" style={{ fontFamily: 'monospace' }}>{sel.job_id}</span>
                <span className="k">Voice</span><span className="v">{sel.voice_id ?? '—'}</span>
                <span className="k">Số đoạn</span><span className="v">{segsOf(sel).length} segment · {sel.recap?.scenes?.length ?? 0} cảnh</span>
                <span className="k">Tạo lúc</span><span className="v">{fmtTs(sel.created_at)}</span>
                <span className="k">Cập nhật</span><span className="v">{fmtTs(sel.updated_at)}</span>
              </div>
            </div>

            {sel.error && <div className="err-block" style={{ margin: '12px 20px 0' }}>
              <AlertCircle size={14} style={{ flexShrink: 0 }} /><span>{sel.error}</span>
            </div>}

            <hr className="divider" style={{ margin: '16px 20px' }} />

            {/* Recap table */}
            <div className="dsec">
              <h3><Sparkles size={13} /> Recap — kịch bản VO</h3>
              {segsOf(sel).length === 0
                ? <p className="settings-message">Chưa có recap.</p>
                : <div className="stw"><table className="st">
                  <thead><tr><th>#</th><th>Cảnh</th><th>Giờ</th><th>Dài</th><th>Vietnamese VO</th></tr></thead>
                  <tbody>{sel.recap?.scenes?.flatMap((sc, si) => sc.segments.map((seg, i) => {
                    const idx = (sel.recap?.scenes?.slice(0, si) ?? []).reduce((a, s) => a + s.segments.length, 0) + i
                    return <tr key={idx}>
                      <td>{idx}</td>
                      <td>{sc.scene_title ?? `Cảnh ${si + 1}`}</td>
                      <td>{fmtTime(seg.start_time_sec)} → {fmtTime(seg.end_time_sec)}</td>
                      <td>{seg.duration_sec.toFixed(1)}s</td>
                      <td style={{ maxWidth: 240 }}>{seg.vietnamese_vo}</td>
                    </tr>
                  }))}
                  </tbody>
                </table></div>}
            </div>

            {/* Clips */}
            {sel.clips && sel.clips.length > 0 && <div className="dsec mt">
              <h3><Scissors size={13} /> Clips đã cắt</h3>
              <div className="chips">{sel.clips.map(c => <span key={c} className="chip">🎬 {c}</span>)}</div>
            </div>}

            {/* Voice */}
            {sel.voice_status === 'done' && <div className="dsec mt">
              <h3><Mic size={13} /> Voice — nghe thử</h3>
              <div className="chips">
                {segsOf(sel).map((_, idx) => {
                  const isOver = sel.overspeed?.includes(idx)
                  const isPlaying = playingVo === idx
                  return <button key={idx} className={`chip chip-play${isOver ? ' chip-warn' : ''}`}
                    onClick={() => toggleVo(sel, idx)}>
                    {isPlaying ? <Pause size={12} /> : <Play size={12} />} vo_{idx}.wav{isOver ? ' ⚠' : ''}
                  </button>
                })}
              </div>
            </div>}

            {/* Final video */}
            <div className="dsec mt">
              <h3><Film size={13} /> Video cuối</h3>
              {sel.job_id && (sel.final_studio || sel.final) ? (
                <VideoResultCard
                  jobId={sel.job_id}
                  variant={sel.final_studio ? 'polished' : 'merged'}
                  segments={segsOf(sel).length}
                  scenes={sel.recap?.scenes?.length ?? 0}
                  credits={sel.final_studio ? sel.credits : null}
                  compact />
              ) : <p className="settings-message">Chưa có video cuối.</p>}
            </div>

            <div style={{ height: 20 }} />
          </div>}
      </div>
    </div>
  </section>
}

function App() {

  const [activePage, setActivePage] = useState('Studio')
  const [collapsed, setCollapsed] = useState(false)
  return <div className="app-shell"><aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}><div className="brand-row"><div className="brand-mark"><Sparkles size={17} /></div>{!collapsed && <span className="brand-name">Search Studio</span>}<button className="icon-button sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <Menu size={18} /> : <PanelLeftClose size={18} />}</button></div><div className="workspace-select"><div className="workspace-avatar">S</div>{!collapsed && <><div className="workspace-copy"><span>Workspace</span><strong>Personal space</strong></div><ChevronDown size={15} /></>}</div><nav className="nav-list">{!collapsed && <span className="nav-label">MENU</span>}{navigation.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activePage === label ? 'nav-item-active' : ''}`} onClick={() => setActivePage(label)}><Icon size={18} /><span className={collapsed ? 'sr-only' : ''}>{label}</span></button>)}</nav><div className="sidebar-footer"><div className="profile-row"><div className="profile-avatar">A</div>{!collapsed && <div className="profile-copy"><strong>Admin</strong><span>admin@example.com</span></div>}</div></div></aside><main className="main-content"><header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{activePage}</strong></div><button className="help-button">?</button></header><div className="content-wrap">{activePage === 'Cài đặt' ? <SettingsPage /> : activePage === 'Voices' ? <VoicesPage /> : activePage === 'Thư viện nhạc' ? <BgmPage /> : activePage === 'Xóa Watermark' ? <WatermarkPage /> : activePage === 'Studio' ? <StudioPage setActivePage={setActivePage} /> : activePage === 'Lịch sử' ? <HistoryPage /> : <section className="empty-state"><div className="empty-illustration"><Search size={34} /></div><h2>Chưa có dữ liệu</h2><p>Khu vực này đang được chuẩn bị.</p></section>}</div></main></div>

}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
