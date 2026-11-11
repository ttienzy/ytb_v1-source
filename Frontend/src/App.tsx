import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Loader2, Search } from 'lucide-react'
import { Sidebar } from './components/layout/Sidebar'
import { getDailyPublishingSummary } from './features/monitor/services/monitorApi'
import type { PublisherDailySummary } from './features/monitor/types'
import { DashboardPage } from './features/dashboard/DashboardPage'

const BgmPage = lazy(() => import('./features/bgm/BgmPage').then(module => ({ default: module.BgmPage })))
const DiscoverPage = lazy(() => import('./features/discover/DiscoverPage').then(module => ({ default: module.DiscoverPage })))
const HistoryPage = lazy(() => import('./features/history/HistoryPage').then(module => ({ default: module.HistoryPage })))
const ChannelHealthModal = lazy(() => import('./features/monitor/components/ChannelHealthModal').then(module => ({ default: module.ChannelHealthModal })))
const PublisherPage = lazy(() => import('./features/publisher/PublisherPage').then(module => ({ default: module.PublisherPage })))
const SettingsPage = lazy(() => import('./features/settings/SettingsPage').then(module => ({ default: module.SettingsPage })))
const StoriesPage = lazy(() => import('./features/stories/StoriesPage').then(module => ({ default: module.StoriesPage })))
const StudioPage = lazy(() => import('./features/studio/StudioPage').then(module => ({ default: module.StudioPage })))
const VoicesPage = lazy(() => import('./features/voices/VoicesPage').then(module => ({ default: module.VoicesPage })))
const WatermarkPage = lazy(() => import('./features/watermark/WatermarkPage').then(module => ({ default: module.WatermarkPage })))
const VideoPage = lazy(() => import('./features/video/VideoPage').then(module => ({ default: module.VideoPage })))
const VeoStudioPage = lazy(() => import('./features/veo-studio/VeoStudioPage').then(module => ({ default: module.VeoStudioPage })))
const MuseStudioPage = lazy(() => import('./features/muse-studio/MuseStudioPage').then(module => ({ default: module.MuseStudioPage })))
const YouTubePublisherPage = lazy(() => import('./features/youtube-publisher/YouTubePublisherPage').then(module => ({ default: module.YouTubePublisherPage })))
const WorkflowPage = lazy(() => import('./features/workflow/WorkflowPage').then(module => ({ default: module.WorkflowPage })))
const CampaignPage = lazy(() => import('./features/campaign/CampaignPage').then(module => ({ default: module.CampaignPage })))
const HelpDrawer = lazy(() => import('./features/help/components/HelpDrawer').then(module => ({ default: module.HelpDrawer })))

const PUBLISHER_PAGES = new Set(['Lên lịch Pippit', 'Lên lịch Youtube'])

export function App() {
  const [activePage, setActivePage] = useState('Dashboard')
  const [collapsed, setCollapsed] = useState(false)
  const [studioBatchUrls, setStudioBatchUrls] = useState<string[]>([])
  const [monitorSummary, setMonitorSummary] = useState<PublisherDailySummary | null>(null)
  const [isRefreshingMonitor, setIsRefreshingMonitor] = useState(false)
  const [showHealthModal, setShowHealthModal] = useState(false)
  const [showHelpDrawer, setShowHelpDrawer] = useState(false)
  const previousPageRef = useRef(activePage)

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

  // Refresh after entering/leaving a publisher page, but do not duplicate the initial request.
  useEffect(() => {
    const previousPage = previousPageRef.current
    previousPageRef.current = activePage
    if (previousPage === activePage) return
    if (PUBLISHER_PAGES.has(previousPage) || PUBLISHER_PAGES.has(activePage)) {
      loadMonitorSummary(false)
    }
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

        <Suspense
          fallback={(
            <div className="content-wrap">
              <section className="empty-state" aria-live="polite">
                <div className="empty-illustration">
                  <Loader2 size={28} className="spinning" />
                </div>
                <h2>Đang mở công cụ</h2>
                <p>Đang tải mô-đun cần thiết…</p>
              </section>
            </div>
          )}
        >
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
          ) : activePage === 'Muse Studio' ? (
            <MuseStudioPage setActivePage={setActivePage} />
          ) : activePage === 'AI Workflow' ? (
            <WorkflowPage />
          ) : activePage === 'Chiến dịch AI' ? (
            <CampaignPage />
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
              monitorSummary={monitorSummary}
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
        </Suspense>
      </main>

      {/* Channel Health & Daily Status Modal */}
      {showHealthModal && (
        <Suspense fallback={null}>
          <ChannelHealthModal
            isOpen
            onClose={() => setShowHealthModal(false)}
            summary={monitorSummary}
            isRefreshing={isRefreshingMonitor}
            onRefresh={() => loadMonitorSummary(true)}
            onNavigate={page => setActivePage(page)}
          />
        </Suspense>
      )}

      {/* In-App Help & Docs Drawer */}
      {showHelpDrawer && (
        <Suspense fallback={null}>
          <HelpDrawer
            isOpen
            onClose={() => setShowHelpDrawer(false)}
            currentSidebar={activePage}
            onNavigate={page => setActivePage(page)}
          />
        </Suspense>
      )}
    </div>
  )
}
export default App
