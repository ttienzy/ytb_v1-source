import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CheckCircle2, ChevronDown, Clock3, LayoutDashboard, Menu, Mic, PanelLeftClose, Play, PlaySquare, Plus, Save, Search, Settings, Sparkles, Trash2, Volume2 } from 'lucide-react'
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

function App() {
  const [activePage, setActivePage] = useState('Cài đặt')
  const [collapsed, setCollapsed] = useState(false)
  return <div className="app-shell"><aside className={`sidebar ${collapsed ? 'sidebar-collapsed' : ''}`}><div className="brand-row"><div className="brand-mark"><Sparkles size={17} /></div>{!collapsed && <span className="brand-name">Search Studio</span>}<button className="icon-button sidebar-toggle" onClick={() => setCollapsed(!collapsed)}>{collapsed ? <Menu size={18} /> : <PanelLeftClose size={18} />}</button></div><div className="workspace-select"><div className="workspace-avatar">S</div>{!collapsed && <><div className="workspace-copy"><span>Workspace</span><strong>Personal space</strong></div><ChevronDown size={15} /></>}</div><nav className="nav-list">{!collapsed && <span className="nav-label">MENU</span>}{navigation.map(({ label, icon: Icon }) => <button key={label} className={`nav-item ${activePage === label ? 'nav-item-active' : ''}`} onClick={() => setActivePage(label)}><Icon size={18} /><span className={collapsed ? 'sr-only' : ''}>{label}</span></button>)}</nav><div className="sidebar-footer"><div className="profile-row"><div className="profile-avatar">A</div>{!collapsed && <div className="profile-copy"><strong>Admin</strong><span>admin@example.com</span></div>}</div></div></aside><main className="main-content"><header className="topbar"><div className="breadcrumbs"><span>Workspace</span><span>/</span><strong>{activePage}</strong></div><button className="help-button">?</button></header><div className="content-wrap">{activePage === 'Cài đặt' ? <SettingsPage /> : activePage === 'Voices' ? <VoicesPage /> : <section className="empty-state"><div className="empty-illustration"><Search size={34} /></div><h2>Chưa có dữ liệu</h2><p>Khu vực này đang được chuẩn bị.</p></section>}</div></main></div>
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
