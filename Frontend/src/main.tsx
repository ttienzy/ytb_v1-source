import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CheckCircle2, ChevronDown, Clock3, Film, LayoutDashboard, Loader2, Menu, Mic, PanelLeftClose, Play, PlaySquare, Plus, Save, Scissors, Search, Settings, Sparkles, Trash2, Upload, Volume2 } from 'lucide-react'
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
}

const MOCK_SCENES: StudioScene[] = [
  { scene_title: 'Mở đầu', segments: [
    { idx: 0, start: '00:00', end: '00:14', duration: 14, original_text: 'Hey everyone, welcome back to the channel.', vietnamese_vo: 'Xin chào mọi người, hoan h nghen chao tro lai voi kenh.' },
    { idx: 1, start: '00:14', end: '00:32', duration: 18, original_text: 'Today we look at three underrated tools.', vietnamese_vo: 'Hom nay chung ta se xem ba cong cu it nguoi biet.' },
  ] },
  { scene_title: 'Nội dung chính', segments: [
    { idx: 2, start: '00:40', end: '01:02', duration: 22, original_text: 'First, this app automates your recap.', vietnamese_vo: 'Dau tien, ung dung nay tu dong tao tom tat cho ban.' },
    { idx: 3, start: '01:15', end: '01:38', duration: 23, original_text: 'Second, it clones your voice in seconds.', vietnamese_vo: 'Thu hai, no nhan ban giong cua ban trong vai giay.' },
  ] },
]
const MOCK_VOICES = ['Adam', 'Trúc Ly', 'Ngọc Huyền', 'Minh Đức', 'Giọng review của tôi']

function fmtDur(s: number) { return `${s.toFixed(1)}s` }

function StudioPage() {
  // MOCK — chưa nối BE recap. Dữ liệu giả để xem trước flow.
  const [youtubeUrl, setYoutubeUrl] = useState('https://www.youtube.com/watch?v=oa4WoU-dm0o')
  const [rawFile, setRawFile] = useState<File | null>(null)
  const [job, setJob] = useState<StudioJob | null>(null)
  const [voiceId, setVoiceId] = useState('Adam')

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

  function wait(ms: number) { return new Promise(r => setTimeout(r, ms)) }
  async function startRecap() {
    setJob({ job_id: 'mock-' + Math.random().toString(36).slice(2, 8), youtube_url: youtubeUrl, status: 'recap_running', voice_id: voiceId, scenes: [], overspeed: [] })
    await wait(900)
    setJob(j => j ? { ...j, status: 'recap_done', scenes: MOCK_SCENES } : j)
  }
  async function cut() { setJob(j => j ? { ...j, status: 'cut_running' } : j); await wait(1100); setJob(j => j ? { ...j, status: 'cut_done' } : j) }
  async function voice() { setJob(j => j ? { ...j, status: 'voice_running' } : j); await wait(1300); setJob(j => j ? { ...j, status: 'voice_done', overspeed: [3] } : j) }
  async function merge() { setJob(j => j ? { ...j, status: 'merge_running' } : j); await wait(1100); setJob(j => j ? { ...j, status: 'merged' } : j) }
  function reset() { setJob(null); setRawFile(null) }

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
      <span className="mock-badge">MOCK — xem trước, chưa nối BE</span>
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
      ? <div className="settings-card">
          <div className="integration-title"><div className="gemini-icon"><Upload size={17} /></div><div><h2>Bước 1 — Tạo recap</h2><p>Dán link YouTube + tải file transcript (raw.txt). Gemini phân tích → recap.json.</p></div></div>
          <label>Link YouTube</label>
          <input value={youtubeUrl} onChange={(e) => setYoutubeUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
          <label style={{ marginTop: 18 }}>Transcript (raw.txt)</label>
          <div className="voice-file-row"><input type="file" accept=".txt" onChange={(e) => setRawFile(e.target.files?.[0] ?? null)} /><span className="voice-file-name">{rawFile ? rawFile.name : 'Chưa chọn file'}</span></div>
          <div className="settings-actions"><button className="primary-button" onClick={startRecap} disabled={!youtubeUrl.trim()}><Sparkles size={16} /> Tạo recap</button></div>
        </div>
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
          <div className="integration-title"><div className="gemini-icon"><Scissors size={17} /></div><div><h2>Bước 2 — Cắt video</h2><p>yt-dlp tải 1 lần → FFmpeg cut [start, end] mỗi segment → clip_i.mp4.</p></div></div>
          <div className="settings-actions"><button className="primary-button" onClick={cut} disabled={stepState('cut') === 'done' || stepState('cut') === 'running' || stepState('recap') !== 'done'}>{stepState('cut') === 'running' ? <Loader2 size={16} className="spin" /> : <Scissors size={16} />} {stepState('cut') === 'done' ? 'Đã cắt xong' : stepState('cut') === 'running' ? 'Đang cắt…' : 'Cắt video'}</button></div>
          {stepState('cut') === 'done' && <div className="chips">{allSegments.map(s => <span key={s.idx} className="chip">🎬 clip_{s.idx}.mp4</span>)}</div>}
        </div>

        {/* voice */}
        <div className="settings-card" style={{ marginTop: 22 }}>
          <div className="integration-title"><div className="gemini-icon"><Mic size={17} /></div><div><h2>Bước 3 — Tạo voice</h2><p>Gom vietnamese_vo → /tts/batch → vo_i.wav + atempo sync theo duration_sec.</p></div></div>
          <label>Chọn giọng</label>
          <select value={voiceId} onChange={(e) => setVoiceId(e.target.value)} disabled={stepState('voice') === 'done'}>
            {MOCK_VOICES.map(v => <option key={v} value={v}>{v}</option>)}
          </select>
          <div className="settings-actions"><button className="primary-button" onClick={voice} disabled={stepState('voice') === 'done' || stepState('voice') === 'running' || stepState('cut') !== 'done'}>{stepState('voice') === 'running' ? <Loader2 size={16} className="spin" /> : <Mic size={16} />} {stepState('voice') === 'done' ? 'Đã tạo voice xong' : stepState('voice') === 'running' ? 'Đang tạo voice…' : 'Tạo voice'}</button></div>
          {stepState('voice') === 'done' && <div className="chips">{allSegments.map(s => <span key={s.idx} className={`chip ${job.overspeed.includes(s.idx) ? 'chip-warn' : ''}`}>🔊 vo_{s.idx}.wav{job.overspeed.includes(s.idx) ? ' · quá dài' : ''}</span>)}</div>}
        </div>

        {/* merge */}
        <div className="settings-card" style={{ marginTop: 22 }}>
          <div className="integration-title"><div className="gemini-icon"><Film size={17} /></div><div><h2>Bước 4 — Ghép</h2><p>FFmpeg concat clip_i + vo_i đã sync → final_recap.mp4.</p></div></div>
          <div className="settings-actions"><button className="primary-button" onClick={merge} disabled={stepState('merge') === 'done' || stepState('merge') === 'running' || stepState('voice') !== 'done'}>{stepState('merge') === 'running' ? <Loader2 size={16} className="spin" /> : <Film size={16} />} {stepState('merge') === 'merged' ? 'Đã ghép xong' : stepState('merge') === 'running' ? 'Đang ghép…' : 'Ghép video'}</button></div>
          {stepState('merge') === 'merged' && <div className="studio-final">
            <div className="final-placeholder"><Play size={40} /></div>
            <div className="final-meta"><strong>final_recap.mp4</strong><span>{allSegments.length} đoạn · tổng ~{fmtDur(allSegments.reduce((a, s) => a + s.duration, 0))}</span></div>
            <button className="chrome-button" onClick={reset}><Trash2 size={15} /> Bắt đầu lại</button>
          </div>}
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
