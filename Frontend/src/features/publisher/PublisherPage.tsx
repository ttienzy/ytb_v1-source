import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  Clock,
  Eye,
  Film,
  Loader2,
  Plus,
  RotateCcw,
  Send,
  Share2,
  Sparkles,
  Square,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react'
import { PippitHistoryTab } from '../history/components/PippitHistoryTab'
import './PublisherPage.css'
import * as api from './services/publisherApi'
import {
  resolveSlotCaption,
  resolveSlotTitle,
  type CaptionMode,
} from './captionUtils'
import {
  channelLabel,
  countByTarget,
  ensureFutureTimes,
  isPostedToTarget,
  scheduleRange,
  summarizeRun,
  targetPlatform,
  type BulkRunItem,
} from './scheduleChecks'
import {
  GOLDEN_PRESETS,
  getSlotPeriodName,
  planSlots,
  type GoldenSlot,
  type ScheduleMode,
} from './scheduleSlots'
import type {
  ActiveFacebookPage,
  CaptionOverride,
  PublishableVideo,
  ScheduleSlot,
  TikTokOptions,
} from './types'
import { fmtSlotTime, slotBase } from './videoModel'
import {
  CaptionComposer,
  DEFAULT_PRESETS,
  PRESETS_STORAGE_KEY,
  loadCaptionPresets,
  type CaptionPreset,
} from './components/CaptionComposer'
import { FacebookIcon, TikTokIcon } from './components/PlatformIcons'
import { PostPreviewModal } from './components/PostPreviewModal'
import { TimelineSlotCard } from './components/TimelineSlotCard'
import { VideoSourcePicker } from './components/VideoSourcePicker'

const GOLDEN_SETTINGS_KEY = 'pippit_scheduler_golden_settings'
const CAPTION_MODE_KEY = 'pippit_caption_mode_v2'

const INTERVAL_PRESETS = [
  { label: '15 phút', value: 15 },
  { label: '30 phút', value: 30 },
  { label: '45 phút', value: 45 },
  { label: '1 giờ', value: 60 },
  { label: '2 giờ', value: 120 },
  { label: '3 giờ', value: 180 },
]

function readSavedGolden() {
  try {
    return JSON.parse(localStorage.getItem(GOLDEN_SETTINGS_KEY) || 'null') || {}
  } catch {
    return {}
  }
}

export function PublisherPage() {
  const [activeTab, setActiveTab] = useState<'bulk' | 'history'>('bulk')

  // Kho video đã chọn (hỗ trợ chọn trộn từ nhiều nguồn trong cùng 1 lượt lên lịch)
  const [selectedOrder, setSelectedOrder] = useState<string[]>([])
  const [videoRegistry, setVideoRegistry] = useState<Record<string, PublishableVideo>>({})
  const [sourceRefreshKey, setSourceRefreshKey] = useState(0)

  // Kênh đăng (Facebook + TikTok)
  const [activePages, setActivePages] = useState<ActiveFacebookPage[]>([])
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set())
  const [tiktokOpts, setTiktokOpts] = useState<TikTokOptions>({
    privacy_level: 1,
    allow_comment: true,
    allow_duet: true,
    allow_stitch: true,
  })

  // Tuỳ chỉnh từng video (giờ / kênh / caption riêng)
  const [customSlotTimes, setCustomSlotTimes] = useState<Record<string, number>>({})
  const [customSlotPages, setCustomSlotPages] = useState<Record<string, string>>({})
  const [captionOverrides, setCaptionOverrides] = useState<Record<string, CaptionOverride>>({})

  // Chiến lược thời gian
  const [startDate, setStartDate] = useState<string>(() => new Date().toISOString().split('T')[0])
  const [startTime, setStartTime] = useState<string>(() => {
    const d = new Date(Date.now() + 15 * 60 * 1000)
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
  })
  const [intervalMinutes, setIntervalMinutes] = useState<number>(30)
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(() => readSavedGolden().scheduleMode || 'golden_hours')
  const [goldenPreset, setGoldenPreset] = useState<'1_per_day' | '2_per_day' | '3_per_day' | 'custom'>(
    () => readSavedGolden().goldenPreset || '3_per_day',
  )
  const [goldenSlots, setGoldenSlots] = useState<GoldenSlot[]>(() => {
    const s = readSavedGolden().goldenSlots
    return Array.isArray(s) && s.length > 0 ? s : GOLDEN_PRESETS['3_per_day'].slots
  })
  const [enableRandomJitter, setEnableRandomJitter] = useState<boolean>(() => {
    const j = readSavedGolden().enableRandomJitter
    return typeof j === 'boolean' ? j : true
  })

  useEffect(() => {
    try {
      localStorage.setItem(
        GOLDEN_SETTINGS_KEY,
        JSON.stringify({ scheduleMode, goldenPreset, goldenSlots, enableRandomJitter }),
      )
    } catch { /* bỏ qua */ }
  }, [scheduleMode, goldenPreset, goldenSlots, enableRandomJitter])

  // Soạn Caption & AI Caption (Gemini · 0 credit)
  const [captionMode, setCaptionMode] = useState<CaptionMode>(() =>
    localStorage.getItem(CAPTION_MODE_KEY) === 'template' ? 'template' : 'smart',
  )
  const [presets, setPresets] = useState<CaptionPreset[]>(loadCaptionPresets)
  const [activePresetId, setActivePresetId] = useState<string>(() => loadCaptionPresets()[0]?.id || DEFAULT_PRESETS[0].id)
  const [captionTemplate, setCaptionTemplate] = useState<string>(() => loadCaptionPresets()[0]?.template || DEFAULT_PRESETS[0].template)
  const [selectedTags, setSelectedTags] = useState<string[]>(() => loadCaptionPresets()[0]?.tags || DEFAULT_PRESETS[0].tags)
  const [tone, setTone] = useState<string>('sales_tiktok')
  const [extraBrief, setExtraBrief] = useState<string>('')
  const [includeDisclosure, setIncludeDisclosure] = useState<boolean>(false)
  const [isGeneratingBatch, setIsGeneratingBatch] = useState<boolean>(false)
  const [generatingUid, setGeneratingUid] = useState<string | null>(null)
  const [aiError, setAiError] = useState<string>('')

  useEffect(() => {
    try { localStorage.setItem(CAPTION_MODE_KEY, captionMode) } catch { /* bỏ qua */ }
  }, [captionMode])

  // Thực thi đặt lịch
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitProgress, setSubmitProgress] = useState<{ current: number; total: number; title: string } | null>(null)
  const [runResults, setRunResults] = useState<BulkRunItem[] | null>(null)
  const stopRequestedRef = useRef(false)
  const [stopRequested, setStopRequested] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  useEffect(() => {
    if (!successMessage) return
    const timer = window.setTimeout(() => setSuccessMessage(''), 4000)
    return () => window.clearTimeout(timer)
  }, [successMessage])

  // Modal xem trước
  const [previewOpen, setPreviewOpen] = useState(false)
  const [previewIdx, setPreviewIdx] = useState(0)

  useEffect(() => {
    api.fetchActiveFacebookPages().then(
      pages => {
        setActivePages(pages)
        if (pages.length > 0) setSelectedPageIds(new Set([pages[0].page_id]))
      },
      err => setErrorMessage(err?.message || 'Không tải được danh sách kênh đăng Pippit'),
    )
  }, [])

  const selectedUidSet = useMemo(() => new Set(selectedOrder), [selectedOrder])
  const selectedTargets = useMemo(() => activePages.filter(p => selectedPageIds.has(p.page_id)), [activePages, selectedPageIds])
  const hasTikTokTarget = useMemo(() => selectedTargets.some(p => targetPlatform(p) === 'tiktok'), [selectedTargets])

  const registerVideos = useCallback((list: PublishableVideo[]) => {
    if (list.length === 0) return
    setVideoRegistry(prev => {
      const next = { ...prev }
      for (const v of list) next[v.uid] = v
      return next
    })
  }, [])

  const toggleVideo = useCallback((v: PublishableVideo) => {
    setVideoRegistry(prev => ({ ...prev, [v.uid]: v }))
    setSelectedOrder(prev => (prev.includes(v.uid) ? prev.filter(id => id !== v.uid) : [...prev, v.uid]))
  }, [])

  const setManyVideos = useCallback((list: PublishableVideo[], on: boolean) => {
    if (list.length === 0) return
    setVideoRegistry(prev => {
      const next = { ...prev }
      for (const v of list) next[v.uid] = v
      return next
    })
    const ids = list.map(v => v.uid)
    const idSet = new Set(ids)
    setSelectedOrder(prev => (on ? [...prev, ...ids.filter(id => !prev.includes(id))] : prev.filter(id => !idSet.has(id))))
  }, [])

  const selectedVideos = useMemo(
    () => selectedOrder.map(id => videoRegistry[id]).filter((v): v is PublishableVideo => Boolean(v)),
    [selectedOrder, videoRegistry],
  )

  const selectedSourceCount = useMemo(() => new Set(selectedVideos.map(v => v.source_type)).size, [selectedVideos])

  const handleTogglePage = (pageId: string) => {
    setSelectedPageIds(prev => {
      const next = new Set(prev)
      if (next.has(pageId)) {
        if (next.size > 1) next.delete(pageId)
      } else {
        next.add(pageId)
      }
      return next
    })
  }

  // Quản lý bộ mẫu caption
  const persistPresets = (next: CaptionPreset[]) => {
    setPresets(next)
    try { localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(next)) } catch { /* bỏ qua */ }
  }

  const handleSelectPreset = (id: string) => {
    const p = presets.find(x => x.id === id)
    if (!p) return
    setActivePresetId(p.id)
    setCaptionTemplate(p.template)
    setSelectedTags(p.tags)
  }

  const handleSavePreset = (newName?: string) => {
    if (newName) {
      const id = `custom_${Date.now()}`
      const created: CaptionPreset = { id, name: newName, template: captionTemplate, tags: selectedTags }
      persistPresets([...presets, created])
      setActivePresetId(id)
      setSuccessMessage(`Đã tạo bộ mẫu “${newName}”.`)
      return
    }
    const next = presets.map(p => (p.id === activePresetId ? { ...p, template: captionTemplate, tags: selectedTags } : p))
    persistPresets(next)
    setSuccessMessage('Đã lưu thay đổi cho bộ mẫu đang chọn.')
  }

  const handleDeletePreset = (id: string) => {
    const next = presets.filter(p => p.id !== id)
    if (next.length === 0) return
    persistPresets(next)
    if (activePresetId === id) {
      setActivePresetId(next[0].id)
      setCaptionTemplate(next[0].template)
      setSelectedTags(next[0].tags)
    }
  }

  // Tính dòng thời gian + caption cuối cùng cho từng bài
  const scheduledSlots = useMemo<ScheduleSlot[]>(() => {
    const planned = planSlots({
      videos: selectedVideos,
      pages: selectedTargets,
      mode: scheduleMode,
      startDate,
      startTime,
      intervalMinutes,
      goldenSlots,
      jitter: enableRandomJitter,
      customTimes: customSlotTimes,
      customPages: customSlotPages,
      now: Date.now(),
    })
    return planned.map(({ video, page, schedule_time_ms }, idx) => {
      const d = new Date(schedule_time_ms)
      const dateStr = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`
      const override = captionOverrides[video.uid]
      const caption = resolveSlotCaption({
        mode: captionMode,
        video,
        override,
        template: captionTemplate,
        tags: selectedTags,
        index: idx + 1,
        date: dateStr,
        appendDisclosure: includeDisclosure,
      })
      const title = resolveSlotTitle(video, override, caption)
      return {
        ...slotBase(video),
        title,
        caption,
        schedule_time_ms,
        page_id: page.page_id,
        page_name: page.page_name,
      }
    })
  }, [
    selectedVideos,
    selectedTargets,
    scheduleMode,
    startDate,
    startTime,
    intervalMinutes,
    goldenSlots,
    enableRandomJitter,
    customSlotTimes,
    customSlotPages,
    captionOverrides,
    captionMode,
    captionTemplate,
    selectedTags,
    includeDisclosure,
  ])

  const duplicateUids = useMemo(() => {
    const out = new Set<string>()
    for (const slot of scheduledSlots) {
      const page = activePages.find(p => p.page_id === slot.page_id)
      const video = videoRegistry[slot.uid]
      if (page && video && isPostedToTarget(video.published_channels, page)) out.add(slot.uid)
    }
    return out
  }, [scheduledSlots, activePages, videoRegistry])

  const slotRange = useMemo(() => scheduleRange(scheduledSlots), [scheduledSlots])

  // Gemini AI viết caption (cả lô hoặc 1 bài)
  const runAiCaption = async (targetSlots: ScheduleSlot[], singleUid?: string) => {
    if (targetSlots.length === 0) return
    setAiError('')
    if (singleUid) setGeneratingUid(singleUid)
    else setIsGeneratingBatch(true)
    try {
      const batch = targetSlots.slice(0, 15)
      const items = batch.map(s => {
        const v = videoRegistry[s.uid]
        const pg = activePages.find(p => p.page_id === s.page_id)
        return {
          uid: s.uid,
          title: v?.title || s.title || s.file_name,
          context_text: v?.context_text || '',
          existing_caption: s.caption,
          platform: pg ? targetPlatform(pg) : 'tiktok',
        }
      })
      const res = await api.generateCaptions({
        items,
        tone,
        extra_brief: extraBrief,
        include_ai_disclosure: includeDisclosure,
      })
      setCaptionOverrides(prev => {
        const next = { ...prev }
        for (const item of res.items) next[item.uid] = { title: item.title, caption: item.full_text }
        return next
      })
      setSuccessMessage(`Gemini đã viết caption riêng cho ${res.items.length}/${batch.length} video.`)
    } catch (err: any) {
      setAiError(err?.message || 'Gemini không viết được caption. Kiểm tra tài khoản Gemini ở Cài đặt.')
    } finally {
      if (singleUid) setGeneratingUid(null)
      else setIsGeneratingBatch(false)
    }
  }

  const updateSlotCaption = (uid: string, patch: CaptionOverride) => {
    setCaptionOverrides(prev => ({ ...prev, [uid]: { ...prev[uid], ...patch } }))
  }

  const resetSlotCaption = (uid: string) => {
    setCaptionOverrides(prev => {
      const next = { ...prev }
      delete next[uid]
      return next
    })
  }

  // Đặt lịch từng video tuần tự để có tiến trình thật & dừng được giữa chừng
  const handleStartBulkSchedule = async () => {
    if (scheduledSlots.length === 0 || activePages.length === 0 || isSubmitting) return
    setErrorMessage('')
    setSuccessMessage('')
    setRunResults([])
    setIsSubmitting(true)
    stopRequestedRef.current = false
    setStopRequested(false)

    const slots = ensureFutureTimes(scheduledSlots, Date.now())
    const results: BulkRunItem[] = []
    for (let i = 0; i < slots.length; i++) {
      if (stopRequestedRef.current) break
      const slot = slots[i]
      setSubmitProgress({ current: i, total: slots.length, title: slot.title || slot.file_name })
      const page = activePages.find(p => p.page_id === slot.page_id)
      const plat = page ? targetPlatform(page) : undefined
      const base = {
        uid: slot.uid,
        file_name: slot.file_name,
        title: slot.title || slot.file_name,
        page_name: page ? channelLabel(page) : slot.page_name,
        schedule_time_ms: slot.schedule_time_ms,
      }
      try {
        const [fresh] = ensureFutureTimes([slot], Date.now())
        const res = await api.submitBulkSchedule(
          page?.account_id || '',
          [{ ...fresh, platform: plat }],
          plat === 'tiktok' ? tiktokOpts : undefined,
        )
        const r = res.results?.[0]
        results.push({
          ...base,
          schedule_time_ms: fresh.schedule_time_ms,
          ok: Boolean(r?.ok),
          error: r?.ok ? undefined : r?.error || res.message || 'Pippit không trả kết quả',
          task_id: r?.task_id,
        })
      } catch (err: any) {
        results.push({
          ...base,
          ok: false,
          error: `${err?.message || err}. Kiểm tra tab “Lịch đã đặt” trước khi đặt lại (Pippit có thể đã nhận bài).`,
        })
      }
      setRunResults([...results])
    }

    const okIds = new Set(results.filter(r => r.ok).map(r => r.uid))
    if (okIds.size > 0) {
      setSelectedOrder(prev => prev.filter(id => !okIds.has(id)))
      setCustomSlotTimes(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !okIds.has(id))))
      setCustomSlotPages(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !okIds.has(id))))
      setCaptionOverrides(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !okIds.has(id))))
      setSourceRefreshKey(k => k + 1)
    }
    const summary = summarizeRun(results)
    const stoppedNote =
      stopRequestedRef.current && results.length < slots.length ? ` Đã dừng, ${slots.length - results.length} video chưa gửi.` : ''
    if (summary.failed > 0) setErrorMessage(summary.text + stoppedNote)
    else if (results.length > 0) setSuccessMessage(summary.text + stoppedNote)
    setIsSubmitting(false)
    setSubmitProgress(null)
  }

  return (
    <section className="settings-page pub-page">
      <div className="settings-heading pub-heading">
        <div className="pub-heading-left">
          <p className="overline">PIPPIT AUTOMATION</p>
          <div className="pub-title-row">
            <h1>Lên lịch Pippit Hàng Loạt</h1>
            <span className="pub-badge-ai">
              <Sparkles size={13} /> Auto Scheduler 2.0
            </span>
          </div>
          <p className="page-subtitle">
            Chọn video từ Chiến dịch AI, Thư viện AI (Flow/Muse/Motion), Recap, máy tính hoặc Google Drive; soạn caption riêng / nhờ AI viết rồi lên lịch lên Facebook & TikTok.
          </p>
          <div className="pub-status-tags">
            <div className={`pub-tag ${activePages.length > 0 ? 'pub-tag-ok' : 'pub-tag-err'}`}>
              <Share2 size={13} />
              <span>
                Kênh đăng:{' '}
                <strong>
                  {activePages.length === 0
                    ? 'chưa có kênh nào'
                    : `${activePages.filter(p => targetPlatform(p) === 'facebook').length} Facebook · ${activePages.filter(p => targetPlatform(p) === 'tiktok').length} TikTok`}
                </strong>
              </span>
            </div>
            {selectedVideos.length > 0 && (
              <div className="pub-tag pub-tag-ok">
                <Film size={13} />
                <span>
                  Đang chọn <strong>{selectedVideos.length} video</strong>
                  {selectedSourceCount > 1 ? ` từ ${selectedSourceCount} nguồn` : ''}
                </span>
              </div>
            )}
          </div>
        </div>

        <div className="pub-tab-switcher">
          <button type="button" className={`pub-tab-btn ${activeTab === 'bulk' ? 'pub-tab-active' : ''}`} onClick={() => setActiveTab('bulk')}>
            <Send size={15} /> Đặt lịch hàng loạt
          </button>
          <button type="button" className={`pub-tab-btn ${activeTab === 'history' ? 'pub-tab-active' : ''}`} onClick={() => setActiveTab('history')}>
            <CalendarClock size={15} /> Lịch đã đặt
          </button>
        </div>
      </div>

      {errorMessage && (
        <div className="err-block" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} />
          <span>{errorMessage}</span>
        </div>
      )}
      {successMessage && (
        <div className="err-block" style={{ marginBottom: 16, background: '#f0fdf4', color: '#16a34a', borderColor: '#bbf7d0' }}>
          <CheckCircle2 size={16} />
          <span>{successMessage}</span>
        </div>
      )}

      {activeTab === 'bulk' && (
        <div className="pub-bulk-grid-2col">
          {/* CỘT TRÁI: KHO VIDEO ĐA NGUỒN */}
          <div className="pub-card pub-col-drive">
            <div className="pub-card-header">
              <div className="pub-card-title">
                <Film size={17} className="pub-icon-drive" />
                <div>
                  <h3>1. Kho Video Nguồn</h3>
                  <span>Chọn trộn từ Chiến dịch AI, Thư viện AI, Recap, Máy tính hoặc Drive</span>
                </div>
              </div>
              {selectedOrder.length > 0 && (
                <button type="button" className="pub2-mini-btn" onClick={() => setSelectedOrder([])} title="Bỏ chọn tất cả video">
                  Bỏ chọn ({selectedOrder.length})
                </button>
              )}
            </div>

            <VideoSourcePicker
              selectedUids={selectedUidSet}
              targets={selectedTargets}
              refreshKey={sourceRefreshKey}
              onToggle={toggleVideo}
              onSetMany={setManyVideos}
              onRegister={registerVideos}
            />
          </div>

          {/* CỘT PHẢI: KÊNH + LỊCH + CAPTION + DÒNG THỜI GIAN */}
          <div className="pub-col-right-stack">
            <div className="pub-card pub-section-config">
              <div className="pub-card-header">
                <div className="pub-card-title">
                  <Share2 size={17} className="pub-icon-fb" />
                  <div>
                    <h3>2. Kênh đăng, Lịch phát & Caption</h3>
                    <span>Chọn kênh Facebook / TikTok, khung giờ và chế độ caption</span>
                  </div>
                </div>
              </div>

              <div className="pub-config-2col-layout">
                {/* Chọn kênh + tuỳ chọn TikTok */}
                <div className="pub-config-side-pages">
                  <label className="pub-label">
                    Kênh đăng (đã chọn {selectedPageIds.size}/{activePages.length}):
                  </label>
                  <div className="pub-active-pages-list">
                    {activePages.map(page => {
                      const isSelected = selectedPageIds.has(page.page_id)
                      const plat = targetPlatform(page)
                      const expired = page.un_expired === false
                      return (
                        <div
                          key={page.page_id}
                          role="button"
                          tabIndex={0}
                          aria-pressed={isSelected}
                          className={`pub-active-page-card ${isSelected ? 'pub-active-page-card-selected' : ''}`}
                          onClick={() => handleTogglePage(page.page_id)}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault()
                              handleTogglePage(page.page_id)
                            }
                          }}
                          title={selectedPageIds.size === 1 && isSelected ? 'Cần chọn ít nhất 1 kênh' : undefined}
                        >
                          <div className="pub-page-card-left">
                            <span className="pub-page-avatar-wrap">
                              <span className={`pub-page-avatar-fallback pub-plat-${plat}`}>{(page.page_name || '?').charAt(0).toUpperCase()}</span>
                              {page.avatar_url && (
                                <img src={page.avatar_url} alt="" className="pub-active-page-avatar" onError={e => { e.currentTarget.style.display = 'none' }} />
                              )}
                              <span className={`pub-page-plat-badge pub-plat-${plat}`}>
                                {plat === 'tiktok' ? <TikTokIcon size={9} /> : <FacebookIcon size={9} />}
                              </span>
                            </span>
                            <div className="pub-page-card-text">
                              <strong className="pub-page-card-name">{page.page_name}</strong>
                              <span className="pub-page-card-meta">
                                {plat === 'tiktok' ? 'TikTok' : 'Facebook Page'}
                                {page.handle ? ` · @${page.handle}` : ''} · {page.account_email}
                              </span>
                            </div>
                          </div>
                          <div className="pub-page-card-right">
                            {expired ? (
                              <span className="pub-page-status-pill pub-page-status-expired">Hết hạn ủy quyền</span>
                            ) : (
                              <span className="pub-page-status-pill">Đang kết nối</span>
                            )}
                            <div className={`pub-page-radio ${isSelected ? 'pub-page-radio-checked' : ''}`}>{isSelected && <Check size={12} />}</div>
                          </div>
                        </div>
                      )
                    })}
                    {activePages.length === 0 && (
                      <div className="pub-no-pages-alert">
                        <AlertCircle size={18} />
                        <div>
                          <strong>Chưa có kênh Facebook / TikTok nào</strong>
                          <p>Liên kết kênh trên Pippit rồi bấm quét lại tài khoản trong Cài đặt.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  {hasTikTokTarget && (
                    <div className="pub2-tt-opts">
                      <label className="pub-label">Tuỳ chọn TikTok:</label>
                      <div className="pub2-tt-opts-row">
                        <select
                          className="pub2-tone-select"
                          value={tiktokOpts.privacy_level}
                          onChange={e => setTiktokOpts(o => ({ ...o, privacy_level: Number(e.target.value) as 1 | 2 | 3 }))}
                          aria-label="Quyền riêng tư TikTok"
                        >
                          <option value={1}>Công khai</option>
                          <option value={2}>Bạn bè</option>
                          <option value={3}>Riêng tư</option>
                        </select>
                        <label><input type="checkbox" checked={tiktokOpts.allow_comment} onChange={e => setTiktokOpts(o => ({ ...o, allow_comment: e.target.checked }))} /> Bình luận</label>
                        <label><input type="checkbox" checked={tiktokOpts.allow_duet} onChange={e => setTiktokOpts(o => ({ ...o, allow_duet: e.target.checked }))} /> Duet</label>
                        <label><input type="checkbox" checked={tiktokOpts.allow_stitch} onChange={e => setTiktokOpts(o => ({ ...o, allow_stitch: e.target.checked }))} /> Stitch</label>
                      </div>
                    </div>
                  )}
                </div>

                {/* Thời gian + Trình soạn Caption */}
                <div className="pub-config-side-params">
                  <div className="pub-mode-switcher-container">
                    <label className="pub-label">Chiến lược lên lịch:</label>
                    <div className="pub-mode-toggle-group">
                      <button type="button" className={`pub-mode-toggle-btn ${scheduleMode === 'golden_hours' ? 'pub-mode-toggle-active' : ''}`} onClick={() => { setScheduleMode('golden_hours'); setCustomSlotTimes({}) }}>
                        <CalendarClock size={13} /> Khung giờ vàng
                      </button>
                      <button type="button" className={`pub-mode-toggle-btn ${scheduleMode === 'interval' ? 'pub-mode-toggle-active' : ''}`} onClick={() => { setScheduleMode('interval'); setCustomSlotTimes({}) }}>
                        <Clock size={13} /> Giãn cách đều
                      </button>
                    </div>
                  </div>

                  {scheduleMode === 'golden_hours' ? (
                    <div className="pub-golden-section">
                      <div className="pub-field">
                        <label className="pub-label">Tần suất đăng bài:</label>
                        <div className="pub-presets-row">
                          {(['1_per_day', '2_per_day', '3_per_day'] as const).map(k => (
                            <button
                              key={k}
                              type="button"
                              className={`pub-preset-btn ${goldenPreset === k ? 'pub-preset-active' : ''}`}
                              onClick={() => { setGoldenPreset(k); setGoldenSlots(GOLDEN_PRESETS[k].slots); setCustomSlotTimes({}) }}
                            >
                              {k.replace('_per_day', ' bài / ngày')}
                            </button>
                          ))}
                          {goldenPreset === 'custom' && <span className="pub-preset-btn pub-preset-active pub-preset-custom-tag">Tự chỉnh ({goldenSlots.length} mốc)</span>}
                        </div>
                      </div>

                      <div className="pub-field">
                        <div className="pub-label-between">
                          <label className="pub-label">Mốc giờ trong ngày:</label>
                          <button
                            type="button"
                            className="pub-btn-add-golden-slot"
                            onClick={() => {
                              setGoldenPreset('custom')
                              setGoldenSlots(prev => {
                                const t = prev.length === 1 ? '11:45' : prev.length === 2 ? '07:15' : '21:00'
                                return [...prev, { id: `custom_${Date.now()}`, time: t, label: getSlotPeriodName(t) }]
                              })
                              setCustomSlotTimes({})
                            }}
                          >
                            <Plus size={11} /> Thêm mốc
                          </button>
                        </div>
                        <div className="pub-golden-slots-list">
                          {goldenSlots.map((slot, sIdx) => (
                            <div key={slot.id || sIdx} className="pub-golden-slot-pill">
                              <span className="pub-golden-slot-tag">{getSlotPeriodName(slot.time)}</span>
                              <input
                                type="time"
                                value={slot.time}
                                onChange={e => {
                                  const v = e.target.value
                                  setGoldenPreset('custom')
                                  setGoldenSlots(prev => prev.map((it, i) => (i === sIdx ? { ...it, time: v, label: getSlotPeriodName(v) } : it)))
                                  setCustomSlotTimes({})
                                }}
                                className="pub-golden-slot-time-input"
                              />
                              {goldenSlots.length > 1 && (
                                <button
                                  type="button"
                                  className="pub-golden-slot-remove-btn"
                                  onClick={() => {
                                    setGoldenPreset('custom')
                                    setGoldenSlots(prev => prev.filter((_, i) => i !== sIdx))
                                    setCustomSlotTimes({})
                                  }}
                                  title="Xóa mốc"
                                >
                                  <X size={11} />
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>

                      <div className="pub-time-row" style={{ marginTop: 6 }}>
                        <div className="pub-field" style={{ flex: 1 }}>
                          <label className="pub-label"><Calendar size={13} /> Ngày bắt đầu:</label>
                          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="pub-input" />
                        </div>
                        <div className="pub-field" style={{ flex: 1.1 }}>
                          <label className="pub-label">Chống spam Meta:</label>
                          <label className="pub-jitter-card">
                            <input
                              type="checkbox"
                              checked={enableRandomJitter}
                              onChange={e => { setEnableRandomJitter(e.target.checked); setCustomSlotTimes({}) }}
                              className="pub-jitter-cb"
                            />
                            <div className="pub-jitter-info">
                              <strong>Lệch ngẫu nhiên ±5-10p</strong>
                              <span>Tránh phát hiện bot tự động</span>
                            </div>
                          </label>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="pub-interval-section">
                      <div className="pub-time-row">
                        <div className="pub-field" style={{ flex: 1 }}>
                          <label className="pub-label"><Calendar size={13} /> Ngày bắt đầu:</label>
                          <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="pub-input" />
                        </div>
                        <div className="pub-field" style={{ flex: 1 }}>
                          <label className="pub-label"><Clock size={13} /> Giờ bắt đầu:</label>
                          <input type="time" value={startTime} onChange={e => setStartTime(e.target.value)} className="pub-input" />
                        </div>
                      </div>
                      <div className="pub-field">
                        <label className="pub-label">Giãn cách tự động:</label>
                        <div className="pub-presets-row">
                          {INTERVAL_PRESETS.map(p => (
                            <button key={p.value} type="button" className={`pub-preset-btn ${intervalMinutes === p.value ? 'pub-preset-active' : ''}`} onClick={() => setIntervalMinutes(p.value)}>
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  <CaptionComposer
                    mode={captionMode}
                    onModeChange={setCaptionMode}
                    template={captionTemplate}
                    onTemplateChange={setCaptionTemplate}
                    tags={selectedTags}
                    onTagsChange={setSelectedTags}
                    presets={presets}
                    activePresetId={activePresetId}
                    onSelectPreset={handleSelectPreset}
                    onSavePreset={handleSavePreset}
                    onDeletePreset={handleDeletePreset}
                    tone={tone}
                    onToneChange={setTone}
                    extraBrief={extraBrief}
                    onExtraBriefChange={setExtraBrief}
                    includeDisclosure={includeDisclosure}
                    onIncludeDisclosureChange={setIncludeDisclosure}
                    selectedCount={scheduledSlots.length}
                    isGenerating={isGeneratingBatch}
                    aiError={aiError}
                    onGenerateAll={() => void runAiCaption(scheduledSlots)}
                  />
                </div>
              </div>
            </div>

            {/* PHẦN 3: DÒNG THỜI GIAN CHI TIẾT */}
            <div className="pub-card pub-section-timeline">
              <div className="pub-card-header">
                <div className="pub-card-title">
                  <CalendarClock size={17} className="pub-icon-time" />
                  <div>
                    <h3>3. Dòng thời gian chi tiết</h3>
                    <span>Chỉnh giờ, kênh và sửa trực tiếp caption riêng cho từng video</span>
                  </div>
                </div>
                <div className="pub-card-header-actions">
                  {scheduledSlots.length > 0 && (
                    <button type="button" className="chrome-button pub-btn-preview-all" onClick={() => { setPreviewIdx(0); setPreviewOpen(true) }}>
                      <Eye size={13} /> Xem trước bài đăng ({scheduledSlots.length})
                    </button>
                  )}
                  {(Object.keys(customSlotTimes).length > 0 || Object.keys(customSlotPages).length > 0) && (
                    <button type="button" className="chrome-button pub-btn-reset-time" onClick={() => { setCustomSlotTimes({}); setCustomSlotPages({}) }}>
                      <RotateCcw size={12} /> Đặt lại giờ tự động
                    </button>
                  )}
                </div>
              </div>

              <div className="pub-timeline-list-2col">
                {scheduledSlots.length === 0 ? (
                  <div className="pub-empty-box">
                    <Clock size={28} />
                    <p>Hãy tích chọn video ở Cột bên trái (Chiến dịch AI, Thư viện AI, Recap, Máy tính hoặc Drive) để chỉnh lịch & caption tại đây.</p>
                  </div>
                ) : (
                  scheduledSlots.map((slot, idx) => (
                    <TimelineSlotCard
                      key={slot.uid}
                      slot={slot}
                      index={idx}
                      scheduleMode={scheduleMode}
                      activePages={activePages}
                      selectedPageIds={selectedPageIds}
                      isCustomTime={customSlotTimes[slot.uid] !== undefined}
                      isDuplicate={duplicateUids.has(slot.uid)}
                      override={captionOverrides[slot.uid]}
                      isGeneratingOne={generatingUid === slot.uid}
                      onUpdatePage={pid => setCustomSlotPages(p => ({ ...p, [slot.uid]: pid }))}
                      onUpdateTime={iso => {
                        const ms = new Date(iso).getTime()
                        if (!Number.isNaN(ms)) setCustomSlotTimes(p => ({ ...p, [slot.uid]: ms }))
                      }}
                      onAdjustTime={delta => setCustomSlotTimes(p => ({ ...p, [slot.uid]: slot.schedule_time_ms + delta * 60_000 }))}
                      onUpdateCaption={patch => updateSlotCaption(slot.uid, patch)}
                      onResetCaption={() => resetSlotCaption(slot.uid)}
                      onRegenerateOne={() => void runAiCaption([slot], slot.uid)}
                      onPreview={() => { setPreviewIdx(idx); setPreviewOpen(true) }}
                    />
                  ))
                )}
              </div>

              {/* Thanh đặt lịch dính đáy */}
              <div className="pub-action-bar">
                {isSubmitting && submitProgress ? (
                  <div className="pub-action-progress">
                    <div className="pub-progress-text">
                      <Loader2 size={14} className="spin" />
                      <span>
                        {stopRequested ? 'Đang dừng sau video hiện tại… ' : 'Đang upload & lên lịch '}
                        <strong>{submitProgress.current + 1}/{submitProgress.total}</strong>: {submitProgress.title}
                      </span>
                    </div>
                    <div className="wm-prog-bar-wrap">
                      <div className="wm-prog-bar" style={{ width: `${(submitProgress.current / submitProgress.total) * 100}%` }} />
                    </div>
                  </div>
                ) : (
                  <div className="pub-action-summary">
                    {scheduledSlots.length === 0 ? (
                      <span>Chưa chọn video nào.</span>
                    ) : (
                      <>
                        <span>
                          <strong>{scheduledSlots.length} video</strong> →{' '}
                          {[...countByTarget(scheduledSlots)]
                            .map(([pid, n]) => {
                              const pg = activePages.find(p => p.page_id === pid)
                              return `${pg ? channelLabel(pg) : pid} (${n})`
                            })
                            .join(', ')}
                        </span>
                        {slotRange && (
                          <span className="pub-action-range">
                            <Clock size={12} /> {fmtSlotTime(slotRange.first)}
                            {slotRange.last !== slotRange.first ? ` → ${fmtSlotTime(slotRange.last)}` : ''}
                          </span>
                        )}
                        {duplicateUids.size > 0 && (
                          <span className="pub-action-dup">
                            <AlertTriangle size={12} /> {duplicateUids.size} video đã đăng lên kênh đích
                            <button type="button" onClick={() => setSelectedOrder(prev => prev.filter(id => !duplicateUids.has(id)))}>
                              Bỏ chọn
                            </button>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}

                {isSubmitting ? (
                  <button type="button" className="pub-stop-btn" onClick={() => { stopRequestedRef.current = true; setStopRequested(true) }} disabled={stopRequested}>
                    <Square size={14} /> {stopRequested ? 'Đang dừng…' : 'Dừng'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pub-submit-btn"
                    disabled={scheduledSlots.length === 0 || activePages.length === 0 || selectedPageIds.size === 0}
                    onClick={() => void handleStartBulkSchedule()}
                  >
                    <UploadCloud size={17} /> Đặt lịch {scheduledSlots.length} video
                  </button>
                )}
              </div>

              {runResults && runResults.length > 0 && (
                <div className="pub-run-results">
                  <div className="pub-run-results-head">
                    <strong>Kết quả lượt đặt lịch: {summarizeRun(runResults).text}</strong>
                    {!isSubmitting && (
                      <button type="button" className="pub-icon-close" onClick={() => setRunResults(null)} title="Đóng">
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <ul>
                    {runResults.map((r, i) => (
                      <li key={`${r.uid}-${i}`} className={r.ok ? 'is-ok' : 'is-err'}>
                        {r.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                        <span className="pub-run-title">{r.title}</span>
                        <span className="pub-run-meta">{r.page_name} · {fmtSlotTime(r.schedule_time_ms)}</span>
                        {!r.ok && r.error && <span className="pub-run-err">{r.error}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'history' && <PippitHistoryTab />}

      <PostPreviewModal
        open={previewOpen}
        slots={scheduledSlots}
        index={previewIdx}
        activePages={activePages}
        onIndexChange={setPreviewIdx}
        onUpdateCaption={updateSlotCaption}
        onClose={() => setPreviewOpen(false)}
      />
    </section>
  )
}
