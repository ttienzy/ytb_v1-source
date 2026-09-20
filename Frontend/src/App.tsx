import { useCallback, useEffect, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Search } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { BgmPage } from './features/bgm/BgmPage'
import { DiscoverPage } from './features/discover/DiscoverPage'
import { HistoryPage } from './features/history/HistoryPage'
import { ChannelHealthModal } from './features/monitor/components/ChannelHealthModal'
import { getDailyPublishingSummary } from './features/monitor/services/monitorApi'
import type { PublisherDailySummary } from './features/monitor/types'
import { PublisherPage } from './features/publisher/PublisherPage'
import { SettingsPage } from './features/settings/SettingsPage'
import { StoriesPage } from './features/stories/StoriesPage'
import { StudioPage } from './features/studio/StudioPage'
import { VoicesPage } from './features/voices/VoicesPage'
import { WatermarkPage } from './features/watermark/WatermarkPage'
import { VideoPage } from './features/video/VideoPage'
import { VeoStudioPage } from './features/veo-studio/VeoStudioPage'
import { YouTubePublisherPage } from './features/youtube-publisher/YouTubePublisherPage'
import { WorkflowPage } from './features/workflow/WorkflowPage'
import { DashboardPage } from './features/dashboard/DashboardPage'
import { HelpDrawer } from './features/help/components/HelpDrawer'

export function App() {
  const [activePage, setActivePage] = useState('Dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [studioBatchUrls, setStudioBatchUrls] = useState<string[]>([])
  const [monitorSummary, setMonitorSummary] = useState<PublisherDailySummary | null>(null)
  const [isRefreshingMonitor, setIsRefreshingMonitor] = useState(false)
  const [showHealthModal, setShowHealthModal] = useState(false)
  const [showHelpDrawer, setShowHelpDrawer] = useState(false)

  const loadMonitorSummary = useCallback(async (forceSync = false) => {
    if (forceSync) {
      setIsRefreshingMonitor(true)
    }
    try {
      const data = await getDailyPublishingSummary(forceSync)
      setMonitorSummary(data)
    } catch {
      /* ignore background error */
    } finally {
      if (forceSync) {
        setIsRefreshingMonitor(false)
      }
    }
  }, [])

  useEffect(() => {
    loadMonitorSummary(false)
    const interval = setInterval(() => loadMonitorSummary(false), 60000)
    return () => clearInterval(interval)
  }, [loadMonitorSummary])

  // Re-fetch monitor summary when switching to/from publisher pages
  useEffect(() => {
    loadMonitorSummary(false)
  }, [activePage, loadMonitorSummary])

  // Global F1 shortcut to open Help Drawer
  useEffect(() => {
    const handleF1 = (e: KeyboardEvent) => {
      if (e.key === 'F1') {
        e.preventDefault()
        setShowHelpDrawer(prev => !prev)
      }
    }
    window.addEventListener('keydown', handleF1)
    return () => window.removeEventListener('keydown', handleF1)
  }, [])

  const handleSendToStudioBatch = (urls: string[]) => {
    setStudioBatchUrls(urls)
    setActivePage('Workflow')
  }

  return (
    <div className="app-shell">
      <Sidebar
        activePage={activePage}
        setActivePage={setActivePage}
        collapsed={collapsed}
        setCollapsed={setCollapsed}
        summary={monitorSummary}
      />
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumbs">
            <span>Workspace</span>
            <span>/</span>
            <strong>{activePage}</strong>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {/* Daily Publishing Health Pill Button */}
            {monitorSummary && monitorSummary.total_channels > 0 && (
              <button
                type="button"
                onClick={() => setShowHealthModal(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 12px',
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: 'pointer',
                  border:
                    monitorSummary.unposted_count > 0
                      ? '1px solid #fecdd3'
                      : monitorSummary.warning_count > 0
                      ? '1px solid #fde68a'
                      : '1px solid #bbf7d0',
                  background:
                    monitorSummary.unposted_count > 0
                      ? '#fff1f2'
                      : monitorSummary.warning_count > 0
                      ? '#fffbeb'
                      : '#f0fdf4',
                  color:
                    monitorSummary.unposted_count > 0
                      ? '#e11d48'
                      : monitorSummary.warning_count > 0
                      ? '#b45309'
                      : '#15803d',
                  transition: 'all 0.15s ease',
                }}
                title="Bấm để xem chi tiết trạng thái đăng bài của từng kênh hôm nay"
              >
                {monitorSummary.unposted_count > 0 ? (
                  <>
                    <AlertCircle size={14} color="#e11d48" />
                    <span>⚠️ {monitorSummary.unposted_count} kênh chưa đăng hôm nay</span>
                  </>
                ) : monitorSummary.warning_count > 0 ? (
                  <>
                    <AlertTriangle size={14} color="#d97706" />
                    <span>🟡 {monitorSummary.warning_count} kênh cần nạp thêm lịch</span>
                  </>
                ) : (
                  <>
                    <CheckCircle2 size={14} color="#16a34a" />
                    <span>🟢 Đã đủ bài hôm nay</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              className="help-button"
              onClick={() => setShowHelpDrawer(true)}
              title="Mở cẩm nang hướng dẫn sử dụng (F1 / ?)"
            >
              ?
            </button>
          </div>
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
          ) : activePage === 'Video' ? (
            <VideoPage />
          ) : activePage === 'Veo Studio' ? (
            <VeoStudioPage setActivePage={setActivePage} />
          ) : activePage === 'AI Workflow' ? (
            <WorkflowPage />
          ) : activePage === 'Lên lịch Pippit' ? (
            <PublisherPage />
          ) : activePage === 'Lên lịch Youtube' ? (
            <YouTubePublisherPage setActivePage={setActivePage} />
          ) : activePage === 'Workflow' ? (
            <StudioPage
              setActivePage={setActivePage}
              initialUrls={studioBatchUrls}
            />
          ) : activePage === 'Lịch sử' ? (
            <HistoryPage />
          ) : activePage === 'Crawl truyện' ? (
            <StoriesPage />
          ) : activePage === 'Dashboard' ? (
            <DashboardPage
              setActivePage={setActivePage}
              onOpenChannelHealth={() => setShowHealthModal(true)}
            />
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

      {/* Channel Health & Daily Status Modal */}
      <ChannelHealthModal
        isOpen={showHealthModal}
        onClose={() => setShowHealthModal(false)}
        summary={monitorSummary}
        isRefreshing={isRefreshingMonitor}
        onRefresh={() => loadMonitorSummary(true)}
        onNavigate={page => setActivePage(page)}
      />

      {/* In-App Help & Docs Drawer */}
      <HelpDrawer
        isOpen={showHelpDrawer}
        onClose={() => setShowHelpDrawer(false)}
        currentSidebar={activePage}
        onNavigate={page => setActivePage(page)}
      />
    </div>
  )
}
export default App
