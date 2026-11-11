import { useState } from 'react'
import {
  Bot,
  ChevronRight,
  Clapperboard,
  Film,
  HardDrive,
  ImageIcon,
  Mail,
  Send,
  Sparkles,
} from 'lucide-react'
import { GeminiSection } from './components/GeminiSection'
import { ImageGenSection } from './components/ImageGenSection'
import { GoogleDriveSection } from './components/GoogleDriveSection'
import { MailTmSection } from './components/MailTmSection'
import { PippitSection } from './components/PippitSection'
import { VeoSection } from './components/VeoSection'
import { MuseSection } from './components/MuseSection'
import { YouTubeBrandIcon, YouTubeSection } from './components/YouTubeSection'
import { ContactSection } from './components/ContactSection'

type TabKey = 'gemini_yt' | 'image_gen' | 'mailtm' | 'pippit' | 'gdrive' | 'youtube' | 'veo' | 'muse' | 'contact'

interface SettingsTabConfig {
  id: TabKey
  label: string
  desc: string
  icon: React.ReactNode
  hasStatus?: boolean
}

export function SettingsPage() {
  const [activeTab, setActiveTab] = useState<TabKey>('gemini_yt')
  const [hasGeminiCookie, setHasGeminiCookie] = useState(false)
  const [hasImageGenReady, setHasImageGenReady] = useState(false)
  const [hasMuseConnected, setHasMuseConnected] = useState(false)
  const [pippitRefreshKey, setPippitRefreshKey] = useState(0)

  const tabs: SettingsTabConfig[] = [
    {
      id: 'gemini_yt',
      label: 'Gemini & YouTube',
      desc: 'Cookie & tải video dự phòng',
      icon: <Sparkles size={16} />,
      hasStatus: hasGeminiCookie,
    },
    {
      id: 'image_gen',
      label: 'Tài khoản ChatGPT',
      desc: 'Tạo ảnh & viết kịch bản AI',
      icon: <ImageIcon size={16} />,
      hasStatus: hasImageGenReady,
    },
    {
      id: 'mailtm',
      label: 'Mail.tm',
      desc: 'Email ảo & nhận OTP tự động',
      icon: <Mail size={16} />,
    },
    {
      id: 'pippit',
      label: 'Pippit AI & Fanpages',
      desc: 'Token & kết nối Fanpage FB',
      icon: <Bot size={16} />,
    },
    {
      id: 'gdrive',
      label: 'Google Drive',
      desc: 'Lưu trữ & đồng bộ đám mây',
      icon: <HardDrive size={16} />,
    },
    {
      id: 'youtube',
      label: 'YouTube',
      desc: 'Kênh xuất bản & Google API',
      icon: <YouTubeBrandIcon size={16} />,
    },
    {
      id: 'veo',
      label: 'Google Veo',
      desc: 'Tạo video AI (Veo 2 & 3)',
      icon: <Clapperboard size={16} />,
    },
    {
      id: 'muse',
      label: 'Muse AI (Meta)',
      desc: 'Sinh video AI, Character & Ghép clip',
      icon: <Film size={16} />,
      hasStatus: hasMuseConnected,
    },
    {
      id: 'contact',
      label: 'Liên hệ tác giả',
      desc: 'Telegram QR & Hỗ trợ kỹ thuật',
      icon: <Send size={16} />,
    },
  ]

  return (
    <section className="settings-page settings-vertical-layout" style={{ paddingTop: 4 }}>
      {/* ── Left Sidebar Navigation ── */}
      <aside className="settings-v-sidebar">
        <div className="settings-v-sidebar-header">
          <span className="settings-v-sidebar-title">Cấu hình &amp; Tích hợp</span>
          <span className="settings-v-sidebar-desc">Quản lý kết nối các dịch vụ</span>
        </div>

        <nav className="settings-v-nav-list" aria-label="Cài đặt dịch vụ">
          {tabs.map(tab => {
            const isActive = activeTab === tab.id
            return (
              <button
                key={tab.id}
                type="button"
                className={`settings-v-tab-btn ${isActive ? 'active' : ''}`}
                onClick={() => setActiveTab(tab.id)}
              >
                <span className="settings-v-tab-icon">
                  {tab.icon}
                </span>

                <div className="settings-v-tab-info">
                  <span className="settings-v-tab-label">{tab.label}</span>
                  <span className="settings-v-tab-sub">{tab.desc}</span>
                </div>

                <div className="settings-v-tab-meta">
                  {tab.hasStatus && (
                    <span
                      className="settings-v-status-dot"
                      title="Dịch vụ đã kết nối cookie thành công"
                    />
                  )}
                  <ChevronRight size={13} className="settings-v-chevron" />
                </div>
              </button>
            )
          })}
        </nav>
      </aside>

      {/* ── Right Content Area ── */}
      <main className="settings-v-main">
        {/* Tab 1: Gemini & YouTube */}
        {activeTab === 'gemini_yt' && (
          <GeminiSection onCookieStatusChange={setHasGeminiCookie} />
        )}

        {/* Tab: Tạo ảnh AI */}
        {activeTab === 'image_gen' && (
          <div className="tab-fade-in">
            <ImageGenSection onStatusChange={setHasImageGenReady} />
          </div>
        )}

        {/* Tab 2: Mail.tm */}
        {activeTab === 'mailtm' && (
          <div className="tab-fade-in">
            <MailTmSection
              onRegisteredPippit={() => setPippitRefreshKey(k => k + 1)}
            />
          </div>
        )}

        {/* Tab 3: Pippit & Real Facebook Pages */}
        {activeTab === 'pippit' && (
          <div className="tab-fade-in">
            <PippitSection key={pippitRefreshKey} />
          </div>
        )}

        {/* Tab 4: Google Drive */}
        {activeTab === 'gdrive' && (
          <div className="tab-fade-in">
            <GoogleDriveSection />
          </div>
        )}

        {/* Tab 5: YouTube */}
        {activeTab === 'youtube' && (
          <div className="tab-fade-in">
            <YouTubeSection />
          </div>
        )}

        {/* Tab 6: Google Veo */}
        {activeTab === 'veo' && (
          <div className="tab-fade-in">
            <VeoSection />
          </div>
        )}

        {/* Tab 7: Muse AI (Meta) */}
        {activeTab === 'muse' && (
          <div className="tab-fade-in">
            <MuseSection onStatusChange={setHasMuseConnected} />
          </div>
        )}

        {/* Tab 8: Liên hệ tác giả & Telegram QR */}
        {activeTab === 'contact' && (
          <div className="tab-fade-in">
            <ContactSection />
          </div>
        )}
      </main>
    </section>
  )
}


