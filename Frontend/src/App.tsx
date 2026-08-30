import { useState } from 'react'
import { Search } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { BgmPage } from './features/bgm/BgmPage'
import { DiscoverPage } from './features/discover/DiscoverPage'
import { HistoryPage } from './features/history/HistoryPage'
import { PublisherPage } from './features/publisher/PublisherPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { StudioPage } from './features/studio/StudioPage'
import { VoicesPage } from './features/voices/VoicesPage'
import { WatermarkPage } from './features/watermark/WatermarkPage'
import { YouTubePublisherPage } from './features/youtube-publisher/YouTubePublisherPage'

export function App() {
  const [activePage, setActivePage] = useState('Khám Phá Kênh')
  const [collapsed, setCollapsed] = useState(false)
  const [studioBatchUrls, setStudioBatchUrls] = useState<string[]>([])

  const handleSendToStudioBatch = (urls: string[]) => {
    setStudioBatchUrls(urls)
    setActivePage('Studio')
  }

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
      />
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span>/</span>
            <strong>{activePage}</strong>
          </div>
          <button type="button" className="help-button">
            ?
          </button>
        </header>

        <div className="content-wrap">
          {activePage === 'Khám Phá Kênh' ? (
            <DiscoverPage
              onSendToStudioBatch={handleSendToStudioBatch}
              setActivePage={setActivePage}
            />
          ) : activePage === 'Cài đặt' ? (
            <SettingsPage />
          ) : activePage === 'Voices' ? (
            <VoicesPage />
          ) : activePage === 'Thư viện nhạc' ? (
            <BgmPage />
          ) : activePage === 'Xóa Watermark' ? (
            <WatermarkPage />
          ) : activePage === 'Lên lịch Pippit' ? (
            <PublisherPage />
          ) : activePage === 'Lên lịch Youtube' ? (
            <YouTubePublisherPage setActivePage={setActivePage} />
          ) : activePage === 'Studio' ? (
            <StudioPage
              setActivePage={setActivePage}
              initialUrls={studioBatchUrls}
            />
          ) : activePage === 'Lịch sử' ? (
            <HistoryPage />
          ) : (
            <section className="empty-state">
              <div className="empty-illustration">
                <Search size={34} />
              </div>
              <h2>Chưa có dữ liệu</h2>
              <p>Khu vực này đang được chuẩn bị.</p>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
export default App
