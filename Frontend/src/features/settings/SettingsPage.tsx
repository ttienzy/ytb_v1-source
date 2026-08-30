import { useEffect, useState } from 'react'
import {
  Bot,
  CheckCircle2,
  Film,
  HardDrive,
  Mail,
  Save,
  Sparkles,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import { GoogleDriveSection } from './components/GoogleDriveSection'
import { MailTmSection } from './components/MailTmSection'
import { PippitSection } from './components/PippitSection'
import { YouTubeBrandIcon, YouTubeSection } from './components/YouTubeSection'
import type { GeminiState, YtState } from './types'

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<
    'gemini_yt' | 'mailtm' | 'pippit' | 'gdrive' | 'youtube'
  >('gemini_yt')


  const [state, setState] = useState<GeminiState>({
    has_cookie: false,
    cookie_count: 0,
    client_context_token: '',
    app_url: 'https://gemini.google.com/app',
  })
  const [cookies, setCookies] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [yt, setYt] = useState<YtState>({ logged_in: false, cookie_count: 0 })
  const [ytLoading, setYtLoading] = useState(false)
  const [ytMsg, setYtMsg] = useState('')
  const [pippitRefreshKey, setPippitRefreshKey] = useState(0)

  useEffect(() => {
    fetch(`${API_URL}/api/settings/gemini`)
      .then(response => response.json())
      .then(setState)
      .catch(() => setMessage('Không kết nối được Backend.'))
  }, [])

  useEffect(() => {
    fetch(`${API_URL}/api/recap/yt/login`)
      .then(r => r.json())
      .then(setYt)
      .catch(() => {})
  }, [])

  async function save() {
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch(`${API_URL}/api/settings/gemini`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cookies,
          client_context_token: state.client_context_token,
          app_url: state.app_url,
        }),
      })
      if (!response.ok) throw new Error()
      const next = await response.json()
      setState({ ...state, has_cookie: next.has_cookie })
      setCookies('')
      setMessage('Đã lưu cấu hình.')
    } catch {
      setMessage('Lưu cấu hình thất bại.')
    } finally {
      setLoading(false)
    }
  }

  async function loginChrome() {
    setLoading(true)
    setMessage('Đang mở Chrome. Hãy đăng nhập Google một lần...')
    try {
      const response = await fetch(
        `${API_URL}/api/settings/gemini/login`,
        { method: 'POST' }
      )
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Đăng nhập thất bại')
      setState({
        ...state,
        has_cookie: true,
        cookie_count: result.cookie_count,
      })
      setMessage('Đã đăng nhập và lưu cookie Gemini.')
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : 'Đăng nhập thất bại.'
      )
    } finally {
      setLoading(false)
    }
  }

  async function loginYt() {
    setYtLoading(true)
    setYtMsg(
      'Đang mở Chrome tới YouTube. Hãy đăng nhập Google (account KHÁC Gemini, không bị SABR để giữ 1080p)...'
    )
    try {
      const response = await fetch(`${API_URL}/api/recap/yt/login`, {
        method: 'POST',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Đăng nhập thất bại')
      setYt({ logged_in: true, cookie_count: result.cookie_count })
      setYtMsg(
        'Đã đăng nhập YouTube — cookies lưu để yt-dlp fallback khi bị bot-wall.'
      )
    } catch (error) {
      setYtMsg(
        error instanceof Error ? error.message : 'Đăng nhập thất bại.'
      )
    } finally {
      setYtLoading(false)
    }
  }

  return (
    <section className="settings-page" style={{ paddingTop: 6 }}>
      {/* ── Settings Tab Bar ── */}
      <div className="settings-nav-tabs">
        <button
          type="button"
          className={`settings-tab-btn ${
            activeTab === 'gemini_yt' ? 'active' : ''
          }`}
          onClick={() => setActiveTab('gemini_yt')}
        >
          <Sparkles size={16} />
          <span>Gemini &amp; YouTube</span>
          {state.has_cookie && (
            <span className="tab-status-dot" title="Gemini đã kết nối" />
          )}
        </button>

        <button
          type="button"
          className={`settings-tab-btn ${
            activeTab === 'mailtm' ? 'active' : ''
          }`}
          onClick={() => setActiveTab('mailtm')}
        >
          <Mail size={16} />
          <span>Mail.tm (Email &amp; OTP)</span>
        </button>

        <button
          type="button"
          className={`settings-tab-btn ${
            activeTab === 'pippit' ? 'active' : ''
          }`}
          onClick={() => setActiveTab('pippit')}
        >
          <Bot size={16} />
          <span>Pippit AI &amp; Fanpages</span>
        </button>

        <button
          type="button"
          className={`settings-tab-btn ${
            activeTab === 'gdrive' ? 'active' : ''
          }`}
          onClick={() => setActiveTab('gdrive')}
        >
          <HardDrive size={16} />
          <span>Google Drive</span>
        </button>

        <button
          type="button"
          className={`settings-tab-btn ${
            activeTab === 'youtube' ? 'active' : ''
          }`}
          onClick={() => setActiveTab('youtube')}
        >
          <YouTubeBrandIcon size={16} />
          <span>YouTube</span>
        </button>
      </div>


      {/* ── Tab 1: Gemini & YouTube ── */}
      {activeTab === 'gemini_yt' && (
        <div className="tab-fade-in">
          <div className="settings-card">
            <div className="integration-title">
              <div className="gemini-icon">
                <Sparkles size={17} />
              </div>
              <div>
                <h2>Gemini (Highlight video)</h2>
                <p>
                  Dùng Gemini web bằng cookie (free) — dẫn cookie từ
                  gemini.google.com
                </p>
              </div>
            </div>
            <label>
              Cookies <span>(đã có — dán mới để đổi)</span>
            </label>
            <textarea
              value={cookies}
              onChange={event => setCookies(event.target.value)}
              placeholder={
                state.has_cookie
                  ? '•••••••• (đã lưu)'
                  : 'Dán cookie Gemini tại đây...'
              }
            />
            <div className="settings-grid">
              <div>
                <label>
                  Client context token <span>(chỉ cần khi upload FILE)</span>
                </label>
                <input
                  value={state.client_context_token}
                  onChange={event =>
                    setState({
                      ...state,
                      client_context_token: event.target.value,
                    })
                  }
                  placeholder="...(lấy từ DevTools, link YouTube không cần)"
                />
              </div>
              <div>
                <label>
                  App URL <span>(tùy chọn)</span>
                </label>
                <input
                  value={state.app_url}
                  onChange={event =>
                    setState({ ...state, app_url: event.target.value })
                  }
                />
              </div>
            </div>
            <div className="settings-actions">
              <button
                type="button"
                className="primary-button"
                onClick={save}
                disabled={loading}
              >
                <Save size={16} /> Lưu
              </button>
              <button
                type="button"
                className="chrome-button"
                onClick={loginChrome}
                disabled={loading}
              >
                <span className="chrome-logo">◉</span> Đăng nhập Gemini (Chrome)
              </button>
              {state.has_cookie && (
                <span className="cookie-status">
                  <CheckCircle2 size={15} /> Đã có cookie
                </span>
              )}
            </div>
            {message && <p className="settings-message">{message}</p>}
            <p className="settings-help">
              <strong>Cách 1:</strong> bấm “Đăng nhập Gemini (Chrome)” → cửa sổ
              Chrome mở, đăng nhập Google 1 lần → tool tự lấy cookie (lần sau tự
              gia hạn). <strong>Cách 2:</strong> dán cookie thủ công ở trên.
            </p>
          </div>

          <div className="settings-card" style={{ marginTop: 22 }}>
            <div className="integration-title">
              <div className="gemini-icon">
                <Film size={17} />
              </div>
              <div>
                <h2>YouTube (tải video recap)</h2>
                <p>
                  Khi IP bị YouTube chặn bot (“Sign in to confirm”), yt-dlp tự
                  fallback sang cookies account đã login. Profile riêng — không
                  đụng Gemini.
                </p>
              </div>
            </div>
            <div className="settings-actions">
              <button
                type="button"
                className="chrome-button"
                onClick={loginYt}
                disabled={ytLoading}
              >
                <span className="chrome-logo">◉</span>{' '}
                {ytLoading
                  ? 'Đang chờ đăng nhập...'
                  : 'Đăng nhập YouTube (Chrome)'}
              </button>
              {yt.logged_in && (
                <span className="cookie-status">
                  <CheckCircle2 size={15} /> Đã có cookie
                  {yt.cookie_count ? ` · ${yt.cookie_count}` : ''}
                  {yt.saved_at
                    ? ` · ${new Date(yt.saved_at).toLocaleString()}`
                    : ''}
                </span>
              )}
            </div>
            {ytMsg && <p className="settings-message">{ytMsg}</p>}
            <p className="settings-help">
              Mặc định tải KHÔNG dùng cookies (1080p). Chỉ khi bị bot-wall mới
              tự chuyển sang cookies.{' '}
              <strong>
                Dùng account Google khác (không bị thử nghiệm SABR) để giữ 1080p
              </strong>{' '}
              — account bị SABR sẽ ra 360p.
            </p>
          </div>
        </div>
      )}

      {/* ── Tab 2: Mail.tm ── */}
      {activeTab === 'mailtm' && (
        <div className="tab-fade-in">
          <MailTmSection
            onRegisteredPippit={() => setPippitRefreshKey(k => k + 1)}
          />
        </div>
      )}

      {/* ── Tab 3: Pippit & Real Facebook Pages ── */}
      {activeTab === 'pippit' && (
        <div className="tab-fade-in">
          <PippitSection key={pippitRefreshKey} />
        </div>
      )}

      {/* ── Tab 4: Google Drive ── */}
      {activeTab === 'gdrive' && (
        <div className="tab-fade-in">
          <GoogleDriveSection />
        </div>
      )}

      {/* ── Tab 5: YouTube ── */}
      {activeTab === 'youtube' && (
        <div className="tab-fade-in">
          <YouTubeSection />
        </div>
      )}
    </section>
  )
}

