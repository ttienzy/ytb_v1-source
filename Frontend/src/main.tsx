import { StrictMode, useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { AlertCircle, CheckCircle2, ChevronDown, Clock3, Download, Film, GitBranch, LayoutDashboard, Loader2, Menu, Mic, PanelLeftClose, Pause, Play, PlaySquare, Plus, Save, Scissors, Search, Settings, Sparkles, Trash2, Upload, Volume2, XCircle } from 'lucide-react'
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

// ─── Types ──────────────────────────────────────────────────────────────────
type BackendSegment = { start_time_sec: number; end_time_sec: number; duration_sec: number; original_text: string; vietnamese_vo: string }
type BackendScene = { scene_title?: string; segments: BackendSegment[] }
type BackendRecap = { video_url?: string; scenes: BackendScene[] }

/** JobOut mới — 4 per-phase status + overall + progress + timestamps */
type JobOut = {
  job_id: string
  youtube_url: string
  overall: string          // idle | running | recap_done | error | merged
  recap_status: string     // idle | running | done | error
  cut_status: string
  voice_status: string
  merge_status: string
  progress: { cut: { done: number; total: number }; voice: { done: number; total: number; phase?: string }; merge: { done: number; total: number } }
  created_at?: string
  updated_at?: string
  voice_id?: string | null
  error?: string | null
  recap?: BackendRecap | null
  clips?: string[] | null
  overspeed?: number[] | null
  final?: string | null
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
type NodeState = 'idle' | 'running' | 'done' | 'error'
function NodeIcon({ state, icon: Icon }: { state: NodeState; icon: React.ElementType }) {
  if (state === 'running') return <Loader2 size={22} className="spin" />
  if (state === 'done') return <CheckCircle2 size={22} />
  if (state === 'error') return <XCircle size={22} />
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
    <span className="n-sub">{subLabel || (st === 'idle' ? 'Chờ…' : st === 'running' ? 'Đang chạy…' : st === 'done' ? 'Hoàn tất' : 'Lỗi')}</span>
    {st === 'running' && pct !== null && <div className="n-pbar"><i style={{ width: pct + '%' }} /></div>}
  </div>
}

function PipelineDiagram({ job, voiceId }: { job: JobOut; voiceId: string }) {
  const segs = (job.recap?.scenes ?? []).reduce((a, s) => a + (s.segments?.length ?? 0), 0)
  const p = job.progress ?? { cut: { done: 0, total: 0 }, voice: { done: 0, total: 0 }, merge: { done: 0, total: 0 } }

  const recapState: NodeState = job.recap_status === 'done' ? 'done' : job.recap_status === 'running' ? 'running' : job.recap_status === 'error' ? 'error' : 'idle'
  const cutState: NodeState = job.cut_status === 'done' ? 'done' : job.cut_status === 'running' ? 'running' : job.cut_status === 'error' ? 'error' : 'idle'
  const voiceState: NodeState = job.voice_status === 'done' ? 'done' : job.voice_status === 'running' ? 'running' : job.voice_status === 'error' ? 'error' : 'idle'
  const mergeState: NodeState = job.merge_status === 'done' ? 'done' : job.merge_status === 'running' ? 'running' : job.merge_status === 'error' ? 'error' : 'idle'

  const afterRecapDone = recapState === 'done'
  const bothDone = cutState === 'done' && voiceState === 'done'

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

  const statusText = (() => {
    if (job.overall === 'error') return `Lỗi: ${job.error ?? 'không xác định'}`
    if (mergeState === 'done') return '✅ Hoàn tất — final_recap.mp4 sẵn sàng tải về'
    if (mergeState === 'running') return 'Ghép video — mux clip + VO → concat final…'
    if (cutState === 'running' || voiceState === 'running') return 'Cut & Voice đang chạy song song…'
    if (recapState === 'running') return 'Recap — đang lấy & phân tích transcript (YouTube → Gemini)…'
    return 'Đang khởi động pipeline…'
  })()

  const dotCls = mergeState === 'done' ? 'dot done' : job.overall === 'error' ? 'dot err' : 'dot run'

  return <>
    <div className="pc-hdr">
      <span className="title">Tiến trình pipeline</span>
      <span className="jid">job: {job.job_id}</span>
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
      <div className={connCls(bothDone, mergeState !== 'idle')} />
      <PipelineNode label="Ghép video" state={mergeState} icon={Film} subLabel={subMerge} progress={mergeState === 'running' ? p.merge : undefined} />
    </div>
    <div className="sbar">
      <span className={dotCls} />
      <span>{statusText}</span>
    </div>
  </>
}

// ─── StudioPage ──────────────────────────────────────────────────────────────
function StudioPage({ setActivePage }: { setActivePage: (p: string) => void }) {
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [rawFile, setRawFile] = useState<File | null>(null)
  const [voiceId, setVoiceId] = useState('')
  const [clonedVoices, setClonedVoices] = useState<Voice[]>([])
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<JobOut | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [playingVo, setPlayingVo] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Load voices on mount
  useEffect(() => {
    fetch(`${API_URL}/api/voices`)
      .then(r => r.ok ? r.json() : Promise.reject())
      .then(d => { const list: Voice[] = d.voices ?? d ?? []; setClonedVoices(list); if (!voiceId && list.length) setVoiceId(list[0].voice_id) })
      .catch(() => {})
  }, []) // eslint-disable-line

  // Poll loop
  const pollJob = useCallback(async (id: string) => {
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs/${id}`)
      if (!r.ok) return
      const data: JobOut = await r.json()
      setJob(data)
      // Stop polling when pipeline fully done or error
      if (data.overall === 'merged' || data.overall === 'error') {
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
    setSubmitError('')
    setSubmitting(true)
    setJob(null)
    try {
      const form = new FormData()
      form.append('youtube_url', youtubeUrl.trim())
      form.append('voice_id', voiceId)
      if (rawFile) form.append('raw_file', rawFile)  // để trống → backend auto-fetch
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
    setJobId(null); setJob(null); setSubmitError(''); setRawFile(null); setYoutubeUrl('')
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
      <div className="fgrid">
        <div className="field">
          <label>Link YouTube</label>
          <input value={youtubeUrl} onChange={e => setYoutubeUrl(e.target.value)}
            placeholder="https://www.youtube.com/watch?v=..." disabled={!!jobId} />
        </div>
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
          <label>Raw transcript <span>(tùy chọn — để trống tự lấy transcript từ YouTube)</span></label>
          <label className="file-trig" style={{ opacity: jobId ? 0.5 : 1, pointerEvents: jobId ? 'none' : 'auto' }}>
            <Upload size={15} />
            <span className="fname">{rawFile ? rawFile.name : 'Tự động lấy từ YouTube'}</span>
            {rawFile && <span className="fsize">· {(rawFile.size / 1024).toFixed(0)} KB</span>}
            <input type="file" accept=".txt" style={{ display: 'none' }} onChange={e => setRawFile(e.target.files?.[0] ?? null)} />
            <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--indigo2)' }}>{rawFile ? 'Đổi ↑' : 'Đính kèm riêng ↑'}</span>
          </label>
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
        {job && !submitting && <span className="hint" style={{ marginLeft: 'auto', color: job.overall === 'error' ? '#dc2626' : job.overall === 'merged' ? '#16a34a' : '#6366f1' }}>
          {job.overall === 'merged' ? '✅ Hoàn tất' : job.overall === 'error' ? '❌ Có lỗi' : '⟳ Đang chạy…'}
        </span>}
      </div>
    </div>

    {/* ── Pipeline diagram ── */}
    {job && <div className="pc">
      <PipelineDiagram job={job} voiceId={voiceId} />

      {/* Error detail */}
      {job.overall === 'error' && job.error && <div className="err-block">
        <AlertCircle size={15} style={{ flexShrink: 0 }} />
        <span>{job.error}</span>
      </div>}

      {/* Final block */}
      {job.overall === 'merged' && job.job_id && <div className="final-block">
        <div className="fthumb"><Film size={36} /></div>
        <div className="finfo">
          <strong>final_recap.mp4 ✓</strong>
          <span className="meta">{allSegs.length} đoạn · {job.recap?.scenes?.length ?? 0} cảnh · 1080p · VO Việt</span>
          {job.overspeed && job.overspeed.length > 0 && <span style={{ fontSize: 11, color: 'var(--amber)' }}>⚠ {job.overspeed.length} đoạn VO ngắn — xem lịch sử để nghe thử</span>}
          <div className="faction">
            <a className="btn-p" href={`${API_URL}/api/recap/jobs/${job.job_id}/final`} download="final_recap.mp4"
               style={{ height: 38, fontSize: 12, textDecoration: 'none' }}>
              <Download size={14} /> Tải về
            </a>
            <button className="btn-g" onClick={reset} style={{ height: 38, fontSize: 12 }}>
              <Trash2 size={14} /> Bắt đầu lại
            </button>
          </div>
        </div>
      </div>}
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

  const overallLabel: Record<string, string> = { merged: 'Hoàn tất', running: 'Đang chạy', error: 'Lỗi', recap_done: 'Đã recap', idle: 'Chờ' }
  const overallBadge: Record<string, string> = { merged: 'b-merged', running: 'b-running', error: 'b-error', recap_done: 'b-idle', idle: 'b-idle' }

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
                {sel.final && sel.job_id
                  ? <div className="fmini">
                      <div className="fmthumb"><Film size={24} /></div>
                      <div className="fminfo">
                        <strong>final_recap.mp4</strong>
                        <span>{segsOf(sel).length} đoạn · 1080p · VO Việt</span>
                        <a href={`${API_URL}/api/recap/jobs/${sel.job_id}/final`} download="final_recap.mp4"
                           className="btn-g" style={{ marginTop: 8, height: 34, fontSize: 11, width: 'fit-content', textDecoration: 'none' }}>
                          <Download size={13} /> Tải về
                        </a>
                      </div>
                    </div>
                  : <p className="settings-message">Chưa có video cuối.</p>}
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
  return <div className="app-shell"><aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}><div className="brand-row"><div className="brand-mark"><Sparkles size={17} /></div>{!collapsed && <span className="brand-name">Search Studio</span>}<button className="icon-button sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <Menu size={18} /> : <PanelLeftClose size={18} />}</button></div><div className="workspace-select"><div className="workspace-avatar">S</div>{!collapsed && <><div className="workspace-copy"><span>Workspace</span><strong>Personal space</strong></div><ChevronDown size={15} /></>}</div><nav className="nav-list">{!collapsed && <span className="nav-label">MENU</span>}{navigation.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activePage === label ? 'nav-item-active' : ''}`} onClick={() => setActivePage(label)}><Icon size={18} /><span className={collapsed ? 'sr-only' : ''}>{label}</span></button>)}</nav><div className="sidebar-footer"><div className="profile-row"><div className="profile-avatar">A</div>{!collapsed && <div className="profile-copy"><strong>Admin</strong><span>admin@example.com</span></div>}</div></div></aside><main className="main-content"><header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{activePage}</strong></div><button className="help-button">?</button></header><div className="content-wrap">{activePage === 'Cài đặt' ? <SettingsPage /> : activePage === 'Voices' ? <VoicesPage /> : activePage === 'Studio' ? <StudioPage setActivePage={setActivePage} /> : activePage === 'Lịch sử' ? <HistoryPage /> : <section className="empty-state"><div className="empty-illustration"><Search size={34} /></div><h2>Chưa có dữ liệu</h2><p>Khu vực này đang được chuẩn bị.</p></section>}</div></main></div>

}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
