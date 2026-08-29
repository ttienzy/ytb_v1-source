import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Copy,
  ExternalLink,
  Eye,
  FileVideo,
  Filter,
  Folder,
  FolderOpen,
  HardDrive,
  Hash,
  Link2,
  Loader2,
  MessageCircle,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Share2,
  Sparkles,
  Tag,
  ThumbsUp,
  Trash2,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react'
import { fmtBytes } from '../../shared/utils/formatters'
import * as api from './services/publisherApi'
import type {
  ActiveFacebookPage,
  DriveFolder,
  DriveVideo,
  PippitAccount,
  PippitScheduleTask,
  ScheduleSlot,
} from './types'

const QUICK_HASHTAGS = [
  '#shorts',
  '#reels',
  '#reviewamthuc',
  '#foodreview',
  '#streetfood',
  '#monngon',
  '#docla',
  '#amthucthegioi',
]

const INTERVAL_PRESETS = [
  { label: '15 phút', value: 15 },
  { label: '30 phút', value: 30 },
  { label: '45 phút', value: 45 },
  { label: '1 giờ', value: 60 },
  { label: '2 giờ', value: 120 },
  { label: '3 giờ', value: 180 },
]

export interface GoldenSlot {
  id: string
  time: string // "07:15"
  label: string // "Sáng" | "Trưa" | "Tối" | "Mốc X"
}

export const GOLDEN_PRESETS: Record<string, { label: string; desc: string; slots: GoldenSlot[] }> = {
  '1_per_day': {
    label: '1 bài / ngày',
    desc: 'Đăng vào khung giờ vàng tối (19:45)',
    slots: [{ id: 'evening', time: '19:45', label: 'Tối' }],
  },
  '2_per_day': {
    label: '2 bài / ngày',
    desc: 'Trưa (11:45) + Tối (19:45)',
    slots: [
      { id: 'lunch', time: '11:45', label: 'Trưa' },
      { id: 'evening', time: '19:45', label: 'Tối' },
    ],
  },
  '3_per_day': {
    label: '3 bài / ngày (Khuyên dùng)',
    desc: 'Sáng (07:15) + Trưa (11:45) + Tối (19:45)',
    slots: [
      { id: 'morning', time: '07:15', label: 'Sáng' },
      { id: 'lunch', time: '11:45', label: 'Trưa' },
      { id: 'evening', time: '19:45', label: 'Tối' },
    ],
  },
}

const GOLDEN_SETTINGS_KEY = 'pippit_scheduler_golden_settings'

function getSlotPeriodName(time: string): string {
  const [hh] = time.split(':').map(Number)
  if (hh >= 5 && hh < 11) return 'Sáng'
  if (hh >= 11 && hh < 15) return 'Trưa'
  if (hh >= 15 && hh < 18) return 'Chiều'
  return 'Tối'
}

function formatDriveDate(dateStr?: string): string {
  if (!dateStr) return '—'
  try {
    const d = new Date(dateStr)
    const now = new Date()
    const isToday = d.toDateString() === now.toDateString()
    if (isToday) {
      const hh = String(d.getHours()).padStart(2, '0')
      const mm = String(d.getMinutes()).padStart(2, '0')
      return `Hôm nay ${hh}:${mm}`
    }
    const isThisYear = d.getFullYear() === now.getFullYear()
    if (isThisYear) {
      return `${d.getDate()} thg ${d.getMonth() + 1}`
    }
    return `${d.getDate()} thg ${d.getMonth() + 1}, ${d.getFullYear()}`
  } catch {
    return dateStr
  }
}

function formatDuration(seconds?: number): string {
  if (!seconds || seconds <= 0) return '00:10'
  const rounded = Math.round(seconds)
  const m = Math.floor(rounded / 60)
  const s = Math.floor(rounded % 60)
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

function toLocalDatetimeInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function PublisherPage() {
  const [activeTab, setActiveTab] = useState<'bulk' | 'history'>('bulk')

  // GDrive state
  const [driveStatus, setDriveStatus] = useState<any>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string>('')
  const [selectedFolderName, setSelectedFolderName] = useState<string>('')
  const [videos, setVideos] = useState<DriveVideo[]>([])
  const [isLoadingVideos, setIsLoadingVideos] = useState(false)
  const [videoSearch, setVideoSearch] = useState('')
  const [selectedVideoIds, setSelectedVideoIds] = useState<Set<string>>(new Set())

  // Folder Picker Modal state
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false)
  const [modalParentId, setModalParentId] = useState<string>('root')
  const [modalBreadcrumbs, setModalBreadcrumbs] = useState<{ id: string; name: string }[]>([
    { id: 'root', name: 'Drive của tôi' },
  ])
  const [modalFolders, setModalFolders] = useState<DriveFolder[]>([])
  const [modalSelectedFolder, setModalSelectedFolder] = useState<DriveFolder | null>(null)
  const [isLoadingModalFolders, setIsLoadingModalFolders] = useState(false)
  const [modalSearch, setModalSearch] = useState('')
  const [customLinkInput, setCustomLinkInput] = useState('')

  // Active Facebook Pages state
  const [activePages, setActivePages] = useState<ActiveFacebookPage[]>([])
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set())

  // Individual video scheduling overrides
  const [customSlotTimes, setCustomSlotTimes] = useState<Record<string, number>>({})
  const [customSlotPages, setCustomSlotPages] = useState<Record<string, string>>({})

  // Global Scheduling defaults
  const [startDate, setStartDate] = useState<string>(() => {
    const d = new Date()
    return d.toISOString().split('T')[0]
  })
  const [startTime, setStartTime] = useState<string>(() => {
    const d = new Date(Date.now() + 15 * 60 * 1000)
    const hh = String(d.getHours()).padStart(2, '0')
    const mm = String(d.getMinutes()).padStart(2, '0')
    return `${hh}:${mm}`
  })
  const [intervalMinutes, setIntervalMinutes] = useState<number>(30)

  // Golden Hours Scheduling State
  const [scheduleMode, setScheduleMode] = useState<'golden_hours' | 'interval'>(() => {
    try {
      const saved = localStorage.getItem(GOLDEN_SETTINGS_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        return parsed.scheduleMode || 'golden_hours'
      }
    } catch {}
    return 'golden_hours'
  })

  const [goldenPreset, setGoldenPreset] = useState<'1_per_day' | '2_per_day' | '3_per_day' | 'custom'>(() => {
    try {
      const saved = localStorage.getItem(GOLDEN_SETTINGS_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        return parsed.goldenPreset || '3_per_day'
      }
    } catch {}
    return '3_per_day'
  })

  const [goldenSlots, setGoldenSlots] = useState<GoldenSlot[]>(() => {
    try {
      const saved = localStorage.getItem(GOLDEN_SETTINGS_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (Array.isArray(parsed.goldenSlots) && parsed.goldenSlots.length > 0) {
          return parsed.goldenSlots
        }
      }
    } catch {}
    return GOLDEN_PRESETS['3_per_day'].slots
  })

  const [enableRandomJitter, setEnableRandomJitter] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(GOLDEN_SETTINGS_KEY)
      if (saved) {
        const parsed = JSON.parse(saved)
        if (typeof parsed.enableRandomJitter === 'boolean') {
          return parsed.enableRandomJitter
        }
      }
    } catch {}
    return true
  })

  // Save Golden Schedule Settings to LocalStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        GOLDEN_SETTINGS_KEY,
        JSON.stringify({
          scheduleMode,
          goldenPreset,
          goldenSlots,
          enableRandomJitter,
        })
      )
    } catch {}
  }, [scheduleMode, goldenPreset, goldenSlots, enableRandomJitter])

  const [captionTemplate, setCaptionTemplate] = useState<string>(
    '{filename}\n\n#shorts #reviewamthuc #foodreview #reels'
  )

  // Tasks & Execution state
  const [tasks, setTasks] = useState<PippitScheduleTask[]>([])
  const [isLoadingTasks, setIsLoadingTasks] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [submitProgress, setSubmitProgress] = useState<{ current: number; total: number } | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // History Filter & Pagination state
  const [historySearch, setHistorySearch] = useState('')
  const [historyStatusFilter, setHistoryStatusFilter] = useState<'all' | 'waiting' | 'published' | 'failed'>('all')
  const [historyPageFilter, setHistoryPageFilter] = useState<string>('all')
  const [historyDatePreset, setHistoryDatePreset] = useState<'all' | 'today' | 'tomorrow' | '7days' | 'custom'>('all')
  const [historyCustomDate, setHistoryCustomDate] = useState<string>('')
  const [historySortOrder, setHistorySortOrder] = useState<'time_asc' | 'time_desc' | 'created_desc'>('time_asc')
  const [historyPage, setHistoryPage] = useState<number>(1)
  const [historyPageSize, setHistoryPageSize] = useState<number>(15)

  // Computed History Stats
  const historyStats = useMemo(() => {
    let waiting = 0
    let published = 0
    let failed = 0
    for (const t of tasks) {
      if (t.published || t.status === 3) published++
      else if (t.status === 4 || Boolean(t.failed_reason)) failed++
      else waiting++
    }
    return {
      total: tasks.length,
      waiting,
      published,
      failed,
    }
  }, [tasks])

  // Distinct Pages in History
  const distinctHistoryPages = useMemo(() => {
    const map = new Map<string, string>()
    for (const t of tasks) {
      const pid = String(t.page_id || '').trim()
      const pname = t.page_name || pid || 'Fanpage'
      if (pid) {
        map.set(pid, pname)
      }
    }
    return Array.from(map.entries()).map(([page_id, page_name]) => ({ page_id, page_name }))
  }, [tasks])

  // Filtered & Sorted Tasks
  const filteredTasks = useMemo(() => {
    let list = [...tasks]

    // 1. Search query
    if (historySearch.trim()) {
      const s = historySearch.toLowerCase().trim()
      list = list.filter(
        t =>
          (t.title && t.title.toLowerCase().includes(s)) ||
          (t.description && t.description.toLowerCase().includes(s)) ||
          (t.page_name && t.page_name.toLowerCase().includes(s)) ||
          (t.task_id && t.task_id.toLowerCase().includes(s))
      )
    }

    // 2. Status filter
    if (historyStatusFilter === 'waiting') {
      list = list.filter(t => !t.published && t.status !== 3 && t.status !== 4 && !t.failed_reason)
    } else if (historyStatusFilter === 'published') {
      list = list.filter(t => t.published || t.status === 3)
    } else if (historyStatusFilter === 'failed') {
      list = list.filter(t => t.status === 4 || Boolean(t.failed_reason))
    }

    // 3. Page filter
    if (historyPageFilter !== 'all') {
      list = list.filter(t => String(t.page_id) === historyPageFilter || t.page_name === historyPageFilter)
    }

    // 4. Date filter
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, '0')
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`

    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000)
    const tomorrowStr = `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`

    if (historyDatePreset === 'today') {
      list = list.filter(t => {
        if (!t.schedule_time_ms) return false
        const d = new Date(t.schedule_time_ms)
        const dStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        return dStr === todayStr
      })
    } else if (historyDatePreset === 'tomorrow') {
      list = list.filter(t => {
        if (!t.schedule_time_ms) return false
        const d = new Date(t.schedule_time_ms)
        const dStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        return dStr === tomorrowStr
      })
    } else if (historyDatePreset === '7days') {
      const in7Days = now.getTime() + 7 * 24 * 60 * 60 * 1000
      list = list.filter(t => {
        if (!t.schedule_time_ms) return false
        return t.schedule_time_ms >= now.getTime() - 24 * 60 * 60 * 1000 && t.schedule_time_ms <= in7Days
      })
    } else if (historyDatePreset === 'custom' && historyCustomDate) {
      list = list.filter(t => {
        if (!t.schedule_time_ms) return false
        const d = new Date(t.schedule_time_ms)
        const dStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
        return dStr === historyCustomDate
      })
    }

    // 5. Sort
    if (historySortOrder === 'time_asc') {
      list.sort((a, b) => (a.schedule_time_ms || 0) - (b.schedule_time_ms || 0))
    } else if (historySortOrder === 'time_desc') {
      list.sort((a, b) => (b.schedule_time_ms || 0) - (a.schedule_time_ms || 0))
    } else if (historySortOrder === 'created_desc') {
      list.sort((a, b) => {
        const da = a.created_at ? new Date(a.created_at).getTime() : 0
        const db = b.created_at ? new Date(b.created_at).getTime() : 0
        return db - da
      })
    }

    return list
  }, [tasks, historySearch, historyStatusFilter, historyPageFilter, historyDatePreset, historyCustomDate, historySortOrder])

  // Pagination calculation
  const totalPages = Math.max(1, Math.ceil(filteredTasks.length / historyPageSize))
  const paginatedTasks = useMemo(() => {
    const start = (historyPage - 1) * historyPageSize
    return filteredTasks.slice(start, start + historyPageSize)
  }, [filteredTasks, historyPage, historyPageSize])

  // Reset page to 1 when filters change
  useEffect(() => {
    setHistoryPage(1)
  }, [historySearch, historyStatusFilter, historyPageFilter, historyDatePreset, historyCustomDate, historySortOrder, historyPageSize])

  // Preview modal state
  const [previewModalOpen, setPreviewModalOpen] = useState(false)
  const [previewSlotIndex, setPreviewSlotIndex] = useState(0)
  const [copiedPreviewCaption, setCopiedPreviewCaption] = useState(false)

  const openPreviewAt = (index: number) => {
    setPreviewSlotIndex(index)
    setPreviewModalOpen(true)
    setCopiedPreviewCaption(false)
  }

  const handleCopyPreviewCaption = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopiedPreviewCaption(true)
    setTimeout(() => setCopiedPreviewCaption(false), 2000)
  }

  // 1. Initial Load
  const loadInitialData = useCallback(async () => {
    try {
      const [drvStatus, pages] = await Promise.all([
        api.fetchDriveStatus().catch(() => null),
        api.fetchActiveFacebookPages().catch(() => []),
      ])

      setDriveStatus(drvStatus)
      if (drvStatus?.folder_id) {
        setSelectedFolderId(drvStatus.folder_id)
        setSelectedFolderName(drvStatus.folder_name || 'AI_Clean_Videos')
      }

      setActivePages(pages)
      if (pages.length > 0) {
        setSelectedPageIds(new Set([pages[0].page_id]))
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi tải dữ liệu ban đầu')
    }
  }, [])

  // 2. Load Drive Videos when selected folder changes
  const loadVideos = useCallback(async (folderId: string, search = '') => {
    if (!folderId) return
    setIsLoadingVideos(true)
    setErrorMessage('')
    try {
      const res = await api.fetchDriveVideos(folderId, search)
      setVideos(res.videos || [])
      if (res.folder_name) {
        setSelectedFolderName(res.folder_name)
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải danh sách video từ Google Drive')
    } finally {
      setIsLoadingVideos(false)
    }
  }, [])

  // 3. Load Pippit Tasks History
  const loadTasks = useCallback(async () => {
    setIsLoadingTasks(true)
    try {
      const res = await api.fetchPippitAllTasks()
      setTasks(res || [])
    } catch (err: any) {
      console.warn('Load tasks error:', err)
    } finally {
      setIsLoadingTasks(false)
    }
  }, [])

  useEffect(() => {
    loadInitialData()
    loadTasks()
  }, [loadInitialData, loadTasks])

  useEffect(() => {
    if (selectedFolderId) {
      loadVideos(selectedFolderId, videoSearch)
    }
  }, [selectedFolderId, loadVideos])

  // Folder Picker Modal functions
  const loadModalFolders = useCallback(async (parentId: string, search = '') => {
    setIsLoadingModalFolders(true)
    setModalSelectedFolder(null)
    try {
      const data = await api.fetchDriveFolders(parentId, search)
      setModalFolders(data || [])
    } catch (err: any) {
      console.error('Failed to load folders:', err)
    } finally {
      setIsLoadingModalFolders(false)
    }
  }, [])

  const openFolderPickerModal = () => {
    setIsFolderModalOpen(true)
    setModalBreadcrumbs([{ id: 'root', name: 'Drive của tôi' }])
    setModalParentId('root')
    setModalSearch('')
    setModalSelectedFolder(null)
    loadModalFolders('root')
  }

  const handleNavigateFolder = (folder: DriveFolder) => {
    setModalBreadcrumbs(prev => [...prev, { id: folder.id, name: folder.name }])
    setModalParentId(folder.id)
    setModalSearch('')
    setModalSelectedFolder(null)
    loadModalFolders(folder.id)
  }

  const handleBreadcrumbClick = (index: number) => {
    const target = modalBreadcrumbs[index]
    const newBreadcrumbs = modalBreadcrumbs.slice(0, index + 1)
    setModalBreadcrumbs(newBreadcrumbs)
    setModalParentId(target.id)
    setModalSearch('')
    setModalSelectedFolder(null)
    loadModalFolders(target.id)
  }

  const handleConfirmSelectModal = () => {
    if (modalSelectedFolder) {
      setSelectedFolderId(modalSelectedFolder.id)
      setSelectedFolderName(modalSelectedFolder.name)
      setIsFolderModalOpen(false)
      loadVideos(modalSelectedFolder.id)
      return
    }

    const currentCrumb = modalBreadcrumbs[modalBreadcrumbs.length - 1]
    if (currentCrumb.id !== 'root') {
      setSelectedFolderId(currentCrumb.id)
      setSelectedFolderName(currentCrumb.name)
      setIsFolderModalOpen(false)
      loadVideos(currentCrumb.id)
    }
  }

  const handleCustomLinkSubmit = () => {
    if (!customLinkInput.trim()) return
    setSelectedFolderId(customLinkInput.trim())
    setSelectedFolderName('Thư mục Drive liên kết')
    setIsFolderModalOpen(false)
    loadVideos(customLinkInput.trim())
    setCustomLinkInput('')
  }

  // Filtered Drive videos
  const filteredVideos = useMemo(() => {
    if (!videoSearch.trim()) return videos
    const s = videoSearch.toLowerCase()
    return videos.filter(v => v.name.toLowerCase().includes(s))
  }, [videos, videoSearch])

  // Select all / deselect all
  const handleToggleSelectAll = () => {
    if (selectedVideoIds.size === filteredVideos.length) {
      setSelectedVideoIds(new Set())
    } else {
      setSelectedVideoIds(new Set(filteredVideos.map(v => v.id)))
    }
  }

  const handleToggleVideo = (id: string) => {
    setSelectedVideoIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

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

  // Format filename to clean human-readable title
  const cleanTitleFromName = (filename: string) => {
    return filename
      .replace(/\.mp4$/i, '')
      .replace(/_clean$/i, '')
      .replace(/_[0-9]{8,14}$/, '')
      .replace(/_/g, ' ')
      .trim()
  }

  // Golden Hours preset selection
  const handleSelectGoldenPreset = (presetKey: '1_per_day' | '2_per_day' | '3_per_day') => {
    setGoldenPreset(presetKey)
    setGoldenSlots(GOLDEN_PRESETS[presetKey].slots)
    setCustomSlotTimes({})
  }

  // Update a specific golden slot's time
  const handleUpdateGoldenSlotTime = (index: number, newTime: string) => {
    setGoldenPreset('custom')
    setGoldenSlots(prev => {
      const next = [...prev]
      const label = getSlotPeriodName(newTime)
      next[index] = { ...next[index], time: newTime, label }
      return next
    })
    setCustomSlotTimes({})
  }

  // Add a new custom golden time slot
  const handleAddGoldenSlot = () => {
    setGoldenPreset('custom')
    setGoldenSlots(prev => {
      let nextTime = '15:00'
      if (prev.length === 1) nextTime = '11:45'
      else if (prev.length === 2) nextTime = '07:15'
      else if (prev.length >= 3) nextTime = '21:00'
      const label = getSlotPeriodName(nextTime)
      return [...prev, { id: `custom_${Date.now()}`, time: nextTime, label }]
    })
    setCustomSlotTimes({})
  }

  // Remove a golden time slot
  const handleRemoveGoldenSlot = (index: number) => {
    if (goldenSlots.length <= 1) return
    setGoldenPreset('custom')
    setGoldenSlots(prev => prev.filter((_, i) => i !== index))
    setCustomSlotTimes({})
  }

  // Computed timeline schedule slots with individual overrides
  const scheduledSlots = useMemo<ScheduleSlot[]>(() => {
    const selectedVideosList = videos.filter(v => selectedVideoIds.has(v.id))
    if (selectedVideosList.length === 0 || activePages.length === 0 || selectedPageIds.size === 0) {
      return []
    }

    const pagesList = activePages.filter(p => selectedPageIds.has(p.page_id))
    if (pagesList.length === 0) return []

    const nowMs = Date.now()
    const [yyyy, mm, dd] = startDate.split('-').map(Number)

    // =========================================================================
    // MODE 1: INTERVAL (Fixed time step)
    // =========================================================================
    if (scheduleMode === 'interval') {
      const [hh, min] = startTime.split(':').map(Number)
      const baseDate = new Date(yyyy, mm - 1, dd, hh, min, 0, 0)
      let baseMs = baseDate.getTime()
      if (baseMs < nowMs) {
        baseMs = Math.ceil(nowMs / 60000) * 60000 + 5 * 60000
      }

      return selectedVideosList.map((video, idx) => {
        const slotTimeMs = customSlotTimes[video.id] ?? (baseMs + idx * intervalMinutes * 60 * 1000)
        const chosenPageId = customSlotPages[video.id]
        const targetPage =
          pagesList.find(p => p.page_id === chosenPageId) ||
          pagesList[idx % pagesList.length] ||
          pagesList[0]

        const cleanTitle = cleanTitleFromName(video.name)
        const caption = captionTemplate.replace(/{filename}/g, cleanTitle)

        return {
          file_id: video.id,
          file_name: video.name,
          size_bytes: video.size_bytes,
          duration_seconds: video.duration_seconds || 10,
          title: cleanTitle,
          caption: caption,
          schedule_time_ms: slotTimeMs,
          page_id: targetPage.page_id,
          page_name: targetPage.page_name,
        }
      })
    }

    // =========================================================================
    // MODE 2: GOLDEN HOURS (Multi-Day Rolling & Anti-Spam Jitter)
    // =========================================================================
    const sortedSlots = [...goldenSlots].sort((a, b) => a.time.localeCompare(b.time))
    if (sortedSlots.length === 0) return []

    let currentDayOffset = 0
    let currentSlotIdx = 0

    // Deterministic pseudo-jitter (stable per video + day)
    const getJitterMs = (seedStr: string, isEnabled: boolean): number => {
      if (!isEnabled) return 0
      let hash = 0
      for (let i = 0; i < seedStr.length; i++) {
        hash = (hash << 5) - hash + seedStr.charCodeAt(i)
        hash |= 0
      }
      const minJitter = -5
      const maxJitter = 10
      const range = maxJitter - minJitter + 1
      const offsetMinutes = minJitter + (Math.abs(hash) % range)
      return offsetMinutes * 60 * 1000
    }

    // Check if start date is today to skip already elapsed slots
    const todayObj = new Date()
    const isStartToday =
      todayObj.getFullYear() === yyyy &&
      todayObj.getMonth() === mm - 1 &&
      todayObj.getDate() === dd

    if (isStartToday) {
      while (currentSlotIdx < sortedSlots.length) {
        const [sh, sm] = sortedSlots[currentSlotIdx].time.split(':').map(Number)
        const slotDate = new Date(yyyy, mm - 1, dd, sh, sm, 0, 0)
        if (slotDate.getTime() > nowMs + 5 * 60 * 1000) {
          break
        }
        currentSlotIdx++
      }
      if (currentSlotIdx >= sortedSlots.length) {
        currentDayOffset = 1
        currentSlotIdx = 0
      }
    }

    return selectedVideosList.map((video, idx) => {
      // If individual custom time override exists, use it
      if (customSlotTimes[video.id] !== undefined) {
        const chosenPageId = customSlotPages[video.id]
        const targetPage =
          pagesList.find(p => p.page_id === chosenPageId) ||
          pagesList[idx % pagesList.length] ||
          pagesList[0]
        const cleanTitle = cleanTitleFromName(video.name)
        const caption = captionTemplate.replace(/{filename}/g, cleanTitle)

        return {
          file_id: video.id,
          file_name: video.name,
          size_bytes: video.size_bytes,
          duration_seconds: video.duration_seconds || 10,
          title: cleanTitle,
          caption: caption,
          schedule_time_ms: customSlotTimes[video.id],
          page_id: targetPage.page_id,
          page_name: targetPage.page_name,
        }
      }

      // Compute multi-day slot time
      const targetDate = new Date(yyyy, mm - 1, dd + currentDayOffset)
      const slotDef = sortedSlots[currentSlotIdx]
      const [sh, sm] = slotDef.time.split(':').map(Number)
      const slotDateObj = new Date(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        targetDate.getDate(),
        sh,
        sm,
        0,
        0
      )

      const jitter = getJitterMs(`${video.id}_${currentDayOffset}_${currentSlotIdx}`, enableRandomJitter)
      let slotTimeMs = slotDateObj.getTime() + jitter

      // Ensure not in past
      if (slotTimeMs < nowMs + 5 * 60 * 1000) {
        slotTimeMs = nowMs + (idx + 1) * 15 * 60 * 1000
      }

      // Advance to next slot / day
      currentSlotIdx++
      if (currentSlotIdx >= sortedSlots.length) {
        currentSlotIdx = 0
        currentDayOffset++
      }

      const chosenPageId = customSlotPages[video.id]
      const targetPage =
        pagesList.find(p => p.page_id === chosenPageId) ||
        pagesList[idx % pagesList.length] ||
        pagesList[0]

      const cleanTitle = cleanTitleFromName(video.name)
      const caption = captionTemplate.replace(/{filename}/g, cleanTitle)

      return {
        file_id: video.id,
        file_name: video.name,
        size_bytes: video.size_bytes,
        duration_seconds: video.duration_seconds || 10,
        title: cleanTitle,
        caption: caption,
        schedule_time_ms: slotTimeMs,
        page_id: targetPage.page_id,
        page_name: targetPage.page_name,
      }
    })
  }, [
    videos,
    selectedVideoIds,
    activePages,
    selectedPageIds,
    startDate,
    startTime,
    intervalMinutes,
    scheduleMode,
    goldenSlots,
    enableRandomJitter,
    captionTemplate,
    customSlotTimes,
    customSlotPages,
  ])

  // Update individual slot time
  const handleUpdateSlotTime = (videoId: string, isoDatetime: string) => {
    const timeMs = new Date(isoDatetime).getTime()
    if (isNaN(timeMs)) return
    setCustomSlotTimes(prev => ({
      ...prev,
      [videoId]: timeMs,
    }))
  }

  // Quick adjust time for individual slot (+15m, +30m, +60m)
  const handleAdjustSlotTime = (videoId: string, currentMs: number, deltaMinutes: number) => {
    setCustomSlotTimes(prev => ({
      ...prev,
      [videoId]: currentMs + deltaMinutes * 60 * 1000,
    }))
  }

  // Update individual slot target page
  const handleUpdateSlotPage = (videoId: string, pageId: string) => {
    setCustomSlotPages(prev => ({
      ...prev,
      [videoId]: pageId,
    }))
  }

  // Reset all custom times back to automatic sequential calculation
  const handleResetAllSlotTimes = () => {
    setCustomSlotTimes({})
    setCustomSlotPages({})
  }

  // Submit bulk schedule
  const handleStartBulkSchedule = async () => {
    if (scheduledSlots.length === 0 || activePages.length === 0) return
    setErrorMessage('')
    setSuccessMessage('')
    setIsSubmitting(true)
    setSubmitProgress({ current: 0, total: scheduledSlots.length })

    try {
      const firstPage = activePages.find(p => p.page_id === scheduledSlots[0].page_id)
      const accountId = firstPage?.account_id || ''

      // Safeguard: Đảm bảo thời gian lên lịch không bị trôi về quá khứ nếu người dùng ngâm trang lâu
      const minAllowedMs = Date.now() + 3 * 60 * 1000
      const safeSlots = scheduledSlots.map((slot, sIdx) => {
        if (slot.schedule_time_ms < minAllowedMs) {
          return {
            ...slot,
            schedule_time_ms: minAllowedMs + sIdx * 5 * 60 * 1000,
          }
        }
        return slot
      })

      const res = await api.submitBulkSchedule(accountId, safeSlots)

      if (res.ok || res.success_count > 0) {
        setSuccessMessage(
          `🎉 Thành công! Đã lên lịch ${res.success_count}/${res.total} video lên Fanpage qua Pippit!`
        )
        // Refresh tasks
        loadTasks()
      } else {
        setErrorMessage(res.message || 'Lên lịch thất bại.')
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Đã xảy ra lỗi khi gửi yêu cầu lên lịch')
    } finally {
      setIsSubmitting(false)
      setSubmitProgress(null)
    }
  }

  const handleAddHashtag = (tag: string) => {
    setCaptionTemplate(prev => {
      if (prev.includes(tag)) return prev
      return `${prev.trim()} ${tag}`
    })
  }

  return (
    <section className="settings-page pub-page">
      {/* Top Header */}
      <div className="settings-heading pub-heading">
        <div className="pub-heading-left">
          <p className="overline">PIPPIT AUTOMATION</p>
          <div className="pub-title-row">
            <h1>Lên lịch Pippit Hàng Loạt</h1>
            <span className="pub-badge-ai">
              <Sparkles size={13} /> Auto Scheduler
            </span>
          </div>
          <p className="page-subtitle">
            Tự động đồng bộ video ngắn 10s từ Google Drive, thiết lập khoảng cách phát thông minh và lên lịch đăng hàng loạt lên Facebook Fanpage qua Pippit Cloud.
          </p>

          <div className="pub-status-tags">
            <div className={`pub-tag ${driveStatus?.connected ? 'pub-tag-ok' : 'pub-tag-err'}`}>
              <HardDrive size={13} />
              <span>
                Google Drive:{' '}
                <strong>
                  {driveStatus?.connected
                    ? `${selectedFolderName || driveStatus.folder_name || 'Đã kết nối'}`
                    : 'Chưa kết nối'}
                </strong>
              </span>
            </div>

            <div className={`pub-tag ${activePages.length > 0 ? 'pub-tag-ok' : 'pub-tag-err'}`}>
              <Share2 size={13} />
              <span>
                Fanpage Facebook: <strong>{activePages.length} Fanpage đang kết nối</strong>
              </span>
            </div>
          </div>
        </div>

        <div className="pub-tab-switcher">
          <button
            type="button"
            className={`pub-tab-btn ${activeTab === 'bulk' ? 'pub-tab-active' : ''}`}
            onClick={() => setActiveTab('bulk')}
          >
            <Send size={15} /> Đặt lịch hàng loạt
          </button>
          <button
            type="button"
            className={`pub-tab-btn ${activeTab === 'history' ? 'pub-tab-active' : ''}`}
            onClick={() => {
              setActiveTab('history')
              loadTasks()
            }}
          >
            <CalendarClock size={15} /> Lịch đã đặt ({tasks.length})
          </button>
        </div>
      </div>

      {/* Alert Messages */}
      {errorMessage && (
        <div className="err-block" style={{ marginBottom: 16 }}>
          <AlertCircle size={16} />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div
          className="err-block"
          style={{
            marginBottom: 16,
            background: '#f0fdf4',
            color: '#16a34a',
            borderColor: '#bbf7d0',
          }}
        >
          <CheckCircle2 size={16} />
          <span>{successMessage}</span>
        </div>
      )}

      {/* TAB 1: BULK SCHEDULER (BALANCED 2-COLUMN LAYOUT) */}
      {activeTab === 'bulk' && (
        <div className="pub-bulk-grid-2col">
          {/* LEFT COLUMN: GOOGLE DRIVE FILE EXPLORER */}
          <div className="pub-card pub-col-drive">
            <div className="pub-card-header">
              <div className="pub-card-title">
                <HardDrive size={17} className="pub-icon-drive" />
                <div>
                  <h3>1. Kho Video Google Drive</h3>
                  <span>Chọn các video ngắn cần đăng</span>
                </div>
              </div>
              <button
                type="button"
                className="chrome-button pub-btn-refresh"
                onClick={() => loadVideos(selectedFolderId, videoSearch)}
                title="Quét lại file từ Google Drive"
                disabled={isLoadingVideos}
              >
                <RefreshCw size={13} className={isLoadingVideos ? 'spin' : ''} />
              </button>
            </div>

            {/* Current Folder Selected Card with Change Button */}
            <div className="pub-curr-folder-card">
              <div className="pub-curr-folder-icon">
                <FolderOpen size={22} />
              </div>
              <div className="pub-curr-folder-info">
                <div className="pub-curr-folder-top">
                  <strong className="pub-curr-folder-name">
                    {selectedFolderName || 'AI_Clean_Videos'}
                  </strong>
                  <span className="pub-curr-folder-count">{videos.length} video</span>
                </div>
                <span className="pub-curr-folder-sub">
                  ID: {selectedFolderId ? `${selectedFolderId.substring(0, 16)}...` : 'Mặc định'}
                </span>
              </div>
              <button
                type="button"
                className="chrome-button pub-btn-change-folder"
                onClick={openFolderPickerModal}
              >
                <Folder size={13} /> Đổi thư mục
              </button>
            </div>

            {/* Video Search Filter Bar */}
            <div className="pub-search-box" style={{ marginTop: 10 }}>
              <Search size={14} className="pub-search-icon" />
              <input
                type="text"
                placeholder="Lọc tên video trong thư mục này..."
                value={videoSearch}
                onChange={e => setVideoSearch(e.target.value)}
                className="pub-search-input"
              />
            </div>

            {/* Select All Row */}
            <div className="pub-select-all-row" style={{ marginTop: 10 }}>
              <label className="pub-checkbox-label">
                <input
                  type="checkbox"
                  checked={
                    filteredVideos.length > 0 &&
                    selectedVideoIds.size === filteredVideos.length
                  }
                  onChange={handleToggleSelectAll}
                  disabled={filteredVideos.length === 0}
                />
                <span>Chọn tất cả ({filteredVideos.length} video)</span>
              </label>
              <span className="pub-selected-pill">
                Đã chọn: <strong>{selectedVideoIds.size}</strong>
              </span>
            </div>

            {/* Video List */}
            <div className="pub-video-list">
              {isLoadingVideos ? (
                <div className="pub-empty-box">
                  <Loader2 size={24} className="spin" style={{ color: '#4f46e5' }} />
                  <p style={{ marginTop: 8 }}>Đang tải video từ Google Drive...</p>
                </div>
              ) : filteredVideos.length === 0 ? (
                <div className="pub-empty-box">
                  <FileVideo size={28} style={{ color: '#94a3b8' }} />
                  <p style={{ marginTop: 8 }}>Không tìm thấy file video MP4 nào trong thư mục này.</p>
                </div>
              ) : (
                filteredVideos.map(video => {
                  const isSelected = selectedVideoIds.has(video.id)
                  const cleanName = cleanTitleFromName(video.name)
                  return (
                    <div
                      key={video.id}
                      className={`pub-video-card-item ${
                        isSelected ? 'pub-video-card-selected' : ''
                      }`}
                      onClick={() => handleToggleVideo(video.id)}
                    >
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => {}} // Handled by parent div
                        className="pub-video-custom-checkbox"
                      />

                      <div className="pub-video-thumb-icon">
                        <FileVideo size={18} />
                        <span className="pub-video-dur-tag">
                          {formatDuration(video.duration_seconds)}
                        </span>
                      </div>

                      <div className="pub-video-details">
                        <strong className="pub-video-clean-title">{cleanName}</strong>
                        <div className="pub-video-sub-line">
                          <span className="pub-video-raw-filename">{video.name}</span>
                          <span className="pub-dot-sep">•</span>
                          <span className="pub-video-size-txt">{fmtBytes(video.size_bytes)}</span>
                        </div>
                      </div>

                      {video.web_view_link && (
                        <a
                          href={video.web_view_link}
                          target="_blank"
                          rel="noreferrer"
                          className="pub-video-link-btn"
                          onClick={e => e.stopPropagation()}
                          title="Xem trên Google Drive ↗"
                        >
                          <ExternalLink size={13} />
                        </a>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* RIGHT STACK: CONFIGURATION & DETAILED TIMELINE */}
          <div className="pub-col-right-stack">
            {/* SECTION 1: FANPAGE FACEBOOK & SETTINGS */}
            <div className="pub-card pub-section-config">
              <div className="pub-card-header">
                <div className="pub-card-title">
                  <Share2 size={17} className="pub-icon-fb" />
                  <div>
                    <h3>2. Cấu hình Kênh & Lịch phát tự động</h3>
                    <span>Chọn Fanpage đích và thiết lập giãn cách thời gian</span>
                  </div>
                </div>
              </div>

              <div className="pub-config-2col-layout">
                {/* Left side: Active Fanpage Selector */}
                <div className="pub-config-side-pages">
                  <label className="pub-label">
                    Fanpage Facebook Active ({selectedPageIds.size}/{activePages.length}):
                  </label>
                  <div className="pub-active-pages-list">
                    {activePages.map(page => {
                      const isSelected = selectedPageIds.has(page.page_id)
                      return (
                        <div
                          key={page.page_id}
                          className={`pub-active-page-card ${
                            isSelected ? 'pub-active-page-card-selected' : ''
                          }`}
                          onClick={() => handleTogglePage(page.page_id)}
                        >
                          <div className="pub-page-card-left">
                            {page.avatar_url ? (
                              <img
                                src={page.avatar_url}
                                alt=""
                                className="pub-active-page-avatar"
                              />
                            ) : (
                              <div className="pub-active-page-fb-icon">
                                <Share2 size={16} />
                              </div>
                            )}
                            <div className="pub-page-card-text">
                              <strong className="pub-page-card-name">{page.page_name}</strong>
                              <span className="pub-page-card-meta">
                                ID: {page.page_id} • {page.account_email}
                              </span>
                            </div>
                          </div>

                          <div className="pub-page-card-right">
                            <span className="pub-page-status-pill">🟢 Đang kết nối</span>
                            <div
                              className={`pub-page-radio ${
                                isSelected ? 'pub-page-radio-checked' : ''
                              }`}
                            >
                              {isSelected && <Check size={12} />}
                            </div>
                          </div>
                        </div>
                      )
                    })}

                    {activePages.length === 0 && (
                      <div className="pub-no-pages-alert">
                        <AlertCircle size={18} />
                        <div>
                          <strong>Chưa có Fanpage Facebook nào được liên kết</strong>
                          <p>Vui lòng liên kết Fanpage trên Pippit để bắt đầu đăng bài.</p>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Right side: Timing & Caption */}
                <div className="pub-config-side-params">
                  {/* Schedule Strategy Switcher */}
                  <div className="pub-mode-switcher-container">
                    <label className="pub-label">Chiến lược lên lịch:</label>
                    <div className="pub-mode-toggle-group">
                      <button
                        type="button"
                        className={`pub-mode-toggle-btn ${
                          scheduleMode === 'golden_hours' ? 'pub-mode-toggle-active' : ''
                        }`}
                        onClick={() => {
                          setScheduleMode('golden_hours')
                          setCustomSlotTimes({})
                        }}
                      >
                        <CalendarClock size={13} /> Khung giờ vàng
                      </button>
                      <button
                        type="button"
                        className={`pub-mode-toggle-btn ${
                          scheduleMode === 'interval' ? 'pub-mode-toggle-active' : ''
                        }`}
                        onClick={() => {
                          setScheduleMode('interval')
                          setCustomSlotTimes({})
                        }}
                      >
                        <Clock size={13} /> Giãn cách đều
                      </button>
                    </div>
                  </div>

                  {/* MODE A: GOLDEN HOURS CONTROLS */}
                  {scheduleMode === 'golden_hours' ? (
                    <div className="pub-golden-section">
                      {/* Presets Row */}
                      <div className="pub-field">
                        <label className="pub-label">Tần suất đăng bài:</label>
                        <div className="pub-presets-row">
                          <button
                            type="button"
                            className={`pub-preset-btn ${
                              goldenPreset === '1_per_day' ? 'pub-preset-active' : ''
                            }`}
                            onClick={() => handleSelectGoldenPreset('1_per_day')}
                          >
                            1 bài / ngày
                          </button>
                          <button
                            type="button"
                            className={`pub-preset-btn ${
                              goldenPreset === '2_per_day' ? 'pub-preset-active' : ''
                            }`}
                            onClick={() => handleSelectGoldenPreset('2_per_day')}
                          >
                            2 bài / ngày
                          </button>
                          <button
                            type="button"
                            className={`pub-preset-btn ${
                              goldenPreset === '3_per_day' ? 'pub-preset-active' : ''
                            }`}
                            onClick={() => handleSelectGoldenPreset('3_per_day')}
                          >
                            3 bài / ngày
                          </button>
                          {goldenPreset === 'custom' && (
                            <span className="pub-preset-btn pub-preset-active pub-preset-custom-tag">
                              Tự chỉnh ({goldenSlots.length} mốc)
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Golden Slots Pills List */}
                      <div className="pub-field">
                        <div className="pub-label-between">
                          <label className="pub-label">Mốc giờ trong ngày:</label>
                          <button
                            type="button"
                            className="pub-btn-add-golden-slot"
                            onClick={handleAddGoldenSlot}
                            title="Thêm mốc giờ mới"
                          >
                            <Plus size={11} /> Thêm mốc
                          </button>
                        </div>

                        <div className="pub-golden-slots-list">
                          {goldenSlots.map((slot, sIdx) => {
                            const periodName = getSlotPeriodName(slot.time)
                            return (
                              <div key={slot.id || sIdx} className="pub-golden-slot-pill">
                                <span className="pub-golden-slot-tag">{periodName}</span>
                                <input
                                  type="time"
                                  value={slot.time}
                                  onChange={e => handleUpdateGoldenSlotTime(sIdx, e.target.value)}
                                  className="pub-golden-slot-time-input"
                                />
                                {goldenSlots.length > 1 && (
                                  <button
                                    type="button"
                                    className="pub-golden-slot-remove-btn"
                                    onClick={() => handleRemoveGoldenSlot(sIdx)}
                                    title="Xóa mốc"
                                  >
                                    <X size={11} />
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      </div>

                      {/* Start Date & Anti-Spam Jitter Row */}
                      <div className="pub-time-row" style={{ marginTop: 6 }}>
                        <div className="pub-field" style={{ flex: 1 }}>
                          <label className="pub-label">
                            <Calendar size={13} /> Ngày bắt đầu:
                          </label>
                          <input
                            type="date"
                            value={startDate}
                            onChange={e => setStartDate(e.target.value)}
                            className="pub-input"
                          />
                        </div>

                        <div className="pub-field" style={{ flex: 1.1 }}>
                          <label className="pub-label">Chống spam Meta:</label>
                          <label className="pub-jitter-card">
                            <input
                              type="checkbox"
                              checked={enableRandomJitter}
                              onChange={e => {
                                setEnableRandomJitter(e.target.checked)
                                setCustomSlotTimes({})
                              }}
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
                    /* MODE B: INTERVAL CONTROLS */
                    <div className="pub-interval-section">
                      {/* Start Date & Time */}
                      <div className="pub-time-row">
                        <div className="pub-field" style={{ flex: 1 }}>
                          <label className="pub-label">
                            <Calendar size={13} /> Ngày bắt đầu:
                          </label>
                          <input
                            type="date"
                            value={startDate}
                            onChange={e => setStartDate(e.target.value)}
                            className="pub-input"
                          />
                        </div>
                        <div className="pub-field" style={{ flex: 1 }}>
                          <label className="pub-label">
                            <Clock size={13} /> Giờ bắt đầu:
                          </label>
                          <input
                            type="time"
                            value={startTime}
                            onChange={e => setStartTime(e.target.value)}
                            className="pub-input"
                          />
                        </div>
                      </div>

                      {/* Interval Presets */}
                      <div className="pub-field">
                        <label className="pub-label">Giãn cách tự động:</label>
                        <div className="pub-presets-row">
                          {INTERVAL_PRESETS.map(p => (
                            <button
                              type="button"
                              key={p.value}
                              className={`pub-preset-btn ${
                                intervalMinutes === p.value ? 'pub-preset-active' : ''
                              }`}
                              onClick={() => setIntervalMinutes(p.value)}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Caption Template */}
                  <div className="pub-field" style={{ marginTop: 8 }}>
                    <div className="pub-label-between">
                      <label className="pub-label">
                        <Tag size={13} /> Mẫu Caption & Tiêu đề:
                      </label>
                      <button
                        type="button"
                        className="pub-tag-btn"
                        onClick={() => setCaptionTemplate(prev => `${prev} {filename}`)}
                        title="Chèn biến tên video tự động"
                      >
                        + {'{filename}'}
                      </button>
                    </div>
                    <textarea
                      rows={2}
                      value={captionTemplate}
                      onChange={e => setCaptionTemplate(e.target.value)}
                      className="pub-textarea"
                      placeholder="Nhập nội dung bài viết..."
                    />
                    <div className="pub-hashtag-chips">
                      {QUICK_HASHTAGS.map(tag => (
                        <span
                          key={tag}
                          className="pub-hash-chip"
                          onClick={() => handleAddHashtag(tag)}
                        >
                          <Hash size={11} />
                          {tag.replace('#', '')}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* SECTION 2: DETAILED TIMELINE & INDIVIDUAL SCHEDULE EDITOR */}
            <div className="pub-card pub-section-timeline">
              <div className="pub-card-header">
                <div className="pub-card-title">
                  <CalendarClock size={17} className="pub-icon-time" />
                  <div>
                    <h3>3. Dòng thời gian chi tiết</h3>
                    <span>Tùy chỉnh lịch phát & Fanpage riêng cho từng video</span>
                  </div>
                </div>

                <div className="pub-card-header-actions">
                  {scheduledSlots.length > 0 && (
                    <button
                      type="button"
                      className="chrome-button pub-btn-preview-all"
                      onClick={() => openPreviewAt(0)}
                      title="Xem trước bài đăng trên Facebook Feed / Reels"
                    >
                      <Eye size={13} /> Xem trước bài đăng ({scheduledSlots.length})
                    </button>
                  )}
                  {Object.keys(customSlotTimes).length > 0 && (
                    <button
                      type="button"
                      className="chrome-button pub-btn-reset-time"
                      onClick={handleResetAllSlotTimes}
                      title="Đặt lại tất cả các video theo giãn cách tự động"
                    >
                      <RotateCcw size={12} /> Đặt lại giờ tự động
                    </button>
                  )}
                </div>
              </div>

              <div className="pub-timeline-summary">
                <div className="pub-sum-item">
                  <span>Tổng video:</span>
                  <strong>{scheduledSlots.length} clip</strong>
                </div>
                {scheduleMode === 'interval' ? (
                  <div className="pub-sum-item">
                    <span>Giãn cách:</span>
                    <strong>+{intervalMinutes} phút</strong>
                  </div>
                ) : (
                  <div className="pub-sum-item">
                    <span>Tần suất:</span>
                    <strong>{goldenSlots.length} bài / ngày</strong>
                  </div>
                )}
                {scheduledSlots.length > 0 && (
                  <div className="pub-sum-item">
                    <span>{scheduleMode === 'golden_hours' ? 'Hoàn thành vào:' : 'Mốc cuối:'}</span>
                    <strong>
                      {scheduleMode === 'golden_hours'
                        ? new Date(
                            scheduledSlots[scheduledSlots.length - 1].schedule_time_ms
                          ).toLocaleDateString('vi-VN', {
                            day: '2-digit',
                            month: '2-digit',
                            hour: '2-digit',
                            minute: '2-digit',
                          })
                        : new Date(
                            scheduledSlots[scheduledSlots.length - 1].schedule_time_ms
                          ).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </strong>
                  </div>
                )}
              </div>

              {/* Timeline Slot Cards with Individual Edit */}
              <div className="pub-timeline-list-2col">
                {scheduledSlots.length === 0 ? (
                  <div className="pub-empty-box">
                    <Clock size={28} />
                    <p>Hãy tích chọn video ở Cột bên trái để xem và tùy chỉnh lịch đăng bài tại đây.</p>
                  </div>
                ) : (
                  scheduledSlots.map((slot, idx) => {
                    const isCustom = customSlotTimes[slot.file_id] !== undefined
                    const slotDate = new Date(slot.schedule_time_ms)
                    const timeStr = `${String(slotDate.getHours()).padStart(2, '0')}:${String(
                      slotDate.getMinutes()
                    ).padStart(2, '0')}`
                    const periodInfo = getSlotPeriodName(timeStr)

                    return (
                      <div
                        key={slot.file_id || idx}
                        className={`pub-slot-card-detailed ${
                          isCustom ? 'pub-slot-card-customized' : ''
                        }`}
                      >
                        <div className="pub-slot-card-top-row">
                          <div className="pub-slot-title-left">
                            <span className="pub-slot-num-badge">#{idx + 1}</span>
                            <strong className="pub-slot-detailed-title" title={slot.title}>
                              {slot.title}
                            </strong>
                          </div>
                          <div className="pub-slot-meta-right">
                            {scheduleMode === 'golden_hours' && (
                              <span className="pub-slot-period-badge">
                                {periodInfo}
                              </span>
                            )}
                            <span className="pub-slot-dur-chip">
                              <Clock size={11} /> {formatDuration(slot.duration_seconds)}
                            </span>
                            <span className="pub-slot-size-txt">{fmtBytes(slot.size_bytes)}</span>
                            {isCustom && (
                              <span className="pub-slot-custom-tag">Đã chỉnh giờ</span>
                            )}
                            <button
                              type="button"
                              className="pub-btn-preview-slot"
                              onClick={() => openPreviewAt(idx)}
                              title="Xem trước bài đăng này"
                            >
                              <Eye size={12} /> Xem trước
                            </button>
                          </div>
                        </div>

                        <div className="pub-slot-grid-controls">
                          {/* Individual Target Page selector */}
                          <div className="pub-slot-ctrl-item pub-slot-page-ctrl">
                            <span className="pub-slot-ctrl-lbl">
                              <Share2 size={12} /> Đăng lên:
                            </span>
                            <select
                              value={slot.page_id}
                              onChange={e => handleUpdateSlotPage(slot.file_id, e.target.value)}
                              className="pub-slot-page-select"
                            >
                              {activePages.map(p => (
                                <option key={p.page_id} value={p.page_id}>
                                  {p.page_name}
                                </option>
                              ))}
                            </select>
                          </div>

                          {/* Individual Datetime Picker & Quick adjustment */}
                          <div className="pub-slot-ctrl-item pub-slot-time-ctrl">
                            <span className="pub-slot-ctrl-lbl">
                              <Clock size={12} /> Giờ phát:
                            </span>
                            <div className="pub-slot-time-inputs-wrap">
                              <input
                                type="datetime-local"
                                value={toLocalDatetimeInput(slot.schedule_time_ms)}
                                onChange={e => handleUpdateSlotTime(slot.file_id, e.target.value)}
                                className="pub-slot-datetime-input"
                              />
                              <div className="pub-slot-quick-btns">
                                <button
                                  type="button"
                                  className="pub-quick-adj-btn"
                                  onClick={() => handleAdjustSlotTime(slot.file_id, slot.schedule_time_ms, 15)}
                                  title="Lùi thêm 15 phút"
                                >
                                  +15p
                                </button>
                                <button
                                  type="button"
                                  className="pub-quick-adj-btn"
                                  onClick={() => handleAdjustSlotTime(slot.file_id, slot.schedule_time_ms, 30)}
                                  title="Lùi thêm 30 phút"
                                >
                                  +30p
                                </button>
                                <button
                                  type="button"
                                  className="pub-quick-adj-btn"
                                  onClick={() => handleAdjustSlotTime(slot.file_id, slot.schedule_time_ms, 60)}
                                  title="Lùi thêm 1 giờ"
                                >
                                  +1h
                                </button>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
              </div>

              {/* Submit Action Block */}
              <div className="pub-action-block" style={{ marginTop: 16 }}>
                {isSubmitting && submitProgress && (
                  <div className="pub-progress-wrap">
                    <div className="pub-progress-text">
                      <Loader2 size={14} className="spin" />
                      <span>
                        Đang xử lý & lên lịch Pippit ({submitProgress.current}/{submitProgress.total})...
                      </span>
                    </div>
                    <div className="wm-prog-bar-wrap">
                      <div
                        className="wm-prog-bar"
                        style={{
                          width: `${(submitProgress.current / submitProgress.total) * 100}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <button
                  type="button"
                  className="pub-submit-btn"
                  disabled={
                    scheduledSlots.length === 0 ||
                    isSubmitting ||
                    activePages.length === 0 ||
                    selectedPageIds.size === 0
                  }
                  onClick={handleStartBulkSchedule}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 size={18} className="spin" /> Đang kích hoạt Pippit...
                    </>
                  ) : (
                    <>
                      <UploadCloud size={18} /> BẮT ĐẦU ĐẶT LỊCH HÀNG LOẠT ({scheduledSlots.length} VIDEO)
                    </>
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* TAB 2: SCHEDULED TASKS HISTORY & LIVE TRACKING */}
      {activeTab === 'history' && (
        <div className="settings-card pub-history-card">
          {/* Header */}
          <div className="pub-history-header">
            <div>
              <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <CalendarClock size={20} color="#4f46e5" />
                Lịch sử & Quản lý bài đăng Pippit ({tasks.length})
              </h2>
              <p>Theo dõi tiến độ phát sóng, lọc theo ngày và xem liên kết bài viết Facebook theo thời gian thực.</p>
            </div>
            <button
              type="button"
              className="chrome-button"
              onClick={loadTasks}
              disabled={isLoadingTasks}
              style={{ gap: 6 }}
            >
              <RefreshCw size={13} className={isLoadingTasks ? 'spin' : ''} /> Làm mới trạng thái
            </button>
          </div>

          {/* 1. Overview Stats Grid */}
          <div className="pub-stat-grid">
            <div className="pub-stat-card">
              <div className="pub-stat-icon" style={{ background: '#e0e7ff', color: '#4f46e5' }}>
                <CalendarClock size={20} />
              </div>
              <div>
                <div className="pub-stat-val">{historyStats.total}</div>
                <div className="pub-stat-lbl">Tổng bài đã lên lịch</div>
              </div>
            </div>

            <div className="pub-stat-card">
              <div className="pub-stat-icon" style={{ background: '#eff6ff', color: '#2563eb' }}>
                <Clock size={20} />
              </div>
              <div>
                <div className="pub-stat-val" style={{ color: '#2563eb' }}>{historyStats.waiting}</div>
                <div className="pub-stat-lbl">Đang chờ phát</div>
              </div>
            </div>

            <div className="pub-stat-card">
              <div className="pub-stat-icon" style={{ background: '#f0fdf4', color: '#16a34a' }}>
                <CheckCircle2 size={20} />
              </div>
              <div>
                <div className="pub-stat-val" style={{ color: '#16a34a' }}>{historyStats.published}</div>
                <div className="pub-stat-lbl">Đã phát thành công</div>
              </div>
            </div>

            <div className="pub-stat-card">
              <div className="pub-stat-icon" style={{ background: '#fef2f2', color: '#dc2626' }}>
                <XCircle size={20} />
              </div>
              <div>
                <div className="pub-stat-val" style={{ color: '#dc2626' }}>{historyStats.failed}</div>
                <div className="pub-stat-lbl">Lỗi / Thất bại</div>
              </div>
            </div>
          </div>

          {/* 2. Interactive Filter Toolbar */}
          <div className="pub-filter-toolbar">
            {/* Top row: Status Tabs & Quick Date presets */}
            <div className="pub-filter-top-row">
              <div className="pub-filter-status-pills">
                <button
                  type="button"
                  className={`pub-filter-pill-btn ${historyStatusFilter === 'all' ? 'pub-filter-pill-active' : ''}`}
                  onClick={() => setHistoryStatusFilter('all')}
                >
                  Tất cả ({historyStats.total})
                </button>
                <button
                  type="button"
                  className={`pub-filter-pill-btn ${historyStatusFilter === 'waiting' ? 'pub-filter-pill-active' : ''}`}
                  onClick={() => setHistoryStatusFilter('waiting')}
                >
                  <Clock size={12} /> Đang chờ ({historyStats.waiting})
                </button>
                <button
                  type="button"
                  className={`pub-filter-pill-btn ${historyStatusFilter === 'published' ? 'pub-filter-pill-active' : ''}`}
                  onClick={() => setHistoryStatusFilter('published')}
                >
                  <CheckCircle2 size={12} /> Đã đăng ({historyStats.published})
                </button>
                {historyStats.failed > 0 && (
                  <button
                    type="button"
                    className={`pub-filter-pill-btn ${historyStatusFilter === 'failed' ? 'pub-filter-pill-active' : ''}`}
                    onClick={() => setHistoryStatusFilter('failed')}
                  >
                    <XCircle size={12} /> Thất bại ({historyStats.failed})
                  </button>
                )}
              </div>

              {/* Quick Date Presets */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                <span style={{ fontSize: 11.5, color: '#64748b', fontWeight: 600 }}>Lọc ngày:</span>
                <select
                  value={historyDatePreset}
                  onChange={e => setHistoryDatePreset(e.target.value as any)}
                  className="pub-filter-select"
                  style={{ minWidth: 120 }}
                >
                  <option value="all">Tất cả ngày</option>
                  <option value="today">Hôm nay</option>
                  <option value="tomorrow">Ngày mai</option>
                  <option value="7days">7 ngày tới</option>
                  <option value="custom">Chọn ngày cụ thể...</option>
                </select>

                {historyDatePreset === 'custom' && (
                  <input
                    type="date"
                    value={historyCustomDate}
                    onChange={e => setHistoryCustomDate(e.target.value)}
                    className="pub-filter-select"
                  />
                )}
              </div>
            </div>

            {/* Bottom row: Search query, Fanpage filter, Sort & Page size */}
            <div className="pub-filter-bottom-row">
              <div className="pub-filter-search-wrap">
                <Search size={14} className="pub-filter-search-icon" />
                <input
                  type="text"
                  placeholder="Tìm theo tên video, hashtag, ID bài đăng..."
                  value={historySearch}
                  onChange={e => setHistorySearch(e.target.value)}
                  className="pub-filter-search-input"
                />
                {historySearch && (
                  <button
                    type="button"
                    onClick={() => setHistorySearch('')}
                    style={{
                      position: 'absolute',
                      right: 8,
                      background: 'none',
                      border: 'none',
                      cursor: 'pointer',
                      color: '#94a3b8',
                    }}
                  >
                    <X size={14} />
                  </button>
                )}
              </div>

              <div className="pub-filter-controls-group">
                {/* Fanpage filter */}
                {distinctHistoryPages.length > 1 && (
                  <select
                    value={historyPageFilter}
                    onChange={e => setHistoryPageFilter(e.target.value)}
                    className="pub-filter-select"
                  >
                    <option value="all">Tất cả Fanpage ({distinctHistoryPages.length})</option>
                    {distinctHistoryPages.map(p => (
                      <option key={p.page_id} value={p.page_id}>
                        {p.page_name}
                      </option>
                    ))}
                  </select>
                )}

                {/* Sort Order */}
                <select
                  value={historySortOrder}
                  onChange={e => setHistorySortOrder(e.target.value as any)}
                  className="pub-filter-select"
                >
                  <option value="time_asc">Giờ phát: Sớm nhất trước ↗</option>
                  <option value="time_desc">Giờ phát: Muộn nhất trước ↘</option>
                  <option value="created_desc">Mới tạo gần đây nhất</option>
                </select>

                {/* Page Size */}
                <select
                  value={historyPageSize}
                  onChange={e => setHistoryPageSize(Number(e.target.value))}
                  className="pub-filter-select"
                  style={{ minWidth: 90 }}
                >
                  <option value={10}>10 / trang</option>
                  <option value={15}>15 / trang</option>
                  <option value={30}>30 / trang</option>
                  <option value={50}>50 / trang</option>
                  <option value={100}>100 / trang</option>
                </select>
              </div>
            </div>
          </div>

          {/* 3. Task List Table */}
          <div className="pub-tasks-table-wrap">
            {filteredTasks.length === 0 ? (
              <div className="pub-empty-box" style={{ padding: '50px 0' }}>
                <CalendarClock size={36} color="#94a3b8" />
                <p style={{ marginTop: 10, fontSize: 13.5, color: '#64748b' }}>
                  {tasks.length === 0
                    ? 'Chưa có bài đăng nào được lên lịch.'
                    : 'Không tìm thấy bài đăng nào phù hợp với bộ lọc hiện tại.'}
                </p>
                {tasks.length > 0 && (
                  <button
                    type="button"
                    className="chrome-button"
                    onClick={() => {
                      setHistorySearch('')
                      setHistoryStatusFilter('all')
                      setHistoryPageFilter('all')
                      setHistoryDatePreset('all')
                      setHistoryCustomDate('')
                    }}
                    style={{ marginTop: 8 }}
                  >
                    Xóa tất cả bộ lọc
                  </button>
                )}
              </div>
            ) : (
              <div className="pub-tasks-list">
                {paginatedTasks.map((task, idx) => {
                  const globalIdx = (historyPage - 1) * historyPageSize + idx + 1
                  const schedDate = task.schedule_time_ms
                    ? new Date(task.schedule_time_ms)
                    : null
                  const schedDateStr = schedDate
                    ? schedDate.toLocaleString('vi-VN', {
                        day: '2-digit',
                        month: '2-digit',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })
                    : '—'
                  const isPublished = task.published || task.status === 3
                  const isFailed = task.status === 4 || Boolean(task.failed_reason)

                  // Period name (Sáng/Trưa/Chiều/Tối)
                  let periodBadge = ''
                  if (schedDate) {
                    const hh = schedDate.getHours()
                    if (hh >= 5 && hh < 11) periodBadge = 'Sáng'
                    else if (hh >= 11 && hh < 15) periodBadge = 'Trưa'
                    else if (hh >= 15 && hh < 18) periodBadge = 'Chiều'
                    else periodBadge = 'Tối'
                  }

                  return (
                    <div key={task.task_id || `${task.schedule_time_ms}_${idx}`} className="pub-task-row">
                      <div className="pub-task-info">
                        <div className="pub-task-title-line">
                          <span
                            style={{
                              fontSize: 11,
                              fontWeight: 700,
                              background: '#f1f5f9',
                              color: '#475569',
                              padding: '2px 7px',
                              borderRadius: 6,
                            }}
                          >
                            #{globalIdx}
                          </span>
                          <strong>{task.title || 'Video ngắn'}</strong>

                          <span
                            className={`pub-task-status ${
                              isPublished
                                ? 'pub-status-done'
                                : isFailed
                                ? 'pub-status-err'
                                : 'pub-status-wait'
                            }`}
                          >
                            {isPublished ? (
                              <>
                                <CheckCircle2 size={12} /> Đã đăng
                              </>
                            ) : isFailed ? (
                              <>
                                <XCircle size={12} /> Thất bại
                              </>
                            ) : (
                              <>
                                <Clock size={12} /> Đang chờ phát
                              </>
                            )}
                          </span>

                          {periodBadge && !isPublished && (
                            <span
                              style={{
                                fontSize: 10.5,
                                fontWeight: 700,
                                padding: '1px 6px',
                                borderRadius: 4,
                                background: '#f8fafc',
                                border: '1px solid #e2e8f0',
                                color: '#64748b',
                              }}
                            >
                              {periodBadge}
                            </span>
                          )}
                        </div>

                        <div className="pub-task-desc">{task.description}</div>

                        <div className="pub-task-meta">
                          <span>
                            <Share2 size={12} /> <strong>{task.page_name || task.page_id || 'Fanpage'}</strong>
                          </span>
                          <span>
                            <Calendar size={12} /> Hẹn lúc: <strong>{schedDateStr}</strong>
                          </span>
                          {task.task_id && (
                            <span style={{ color: '#94a3b8' }}>
                              ID: <code>{task.task_id}</code>
                            </span>
                          )}
                          {task.failed_reason && (
                            <span style={{ color: '#ef4444', fontWeight: 600 }}>Lỗi: {task.failed_reason}</span>
                          )}
                        </div>
                      </div>

                      <div className="pub-task-actions">
                        {task.post_url ? (
                          <a
                            href={task.post_url}
                            target="_blank"
                            rel="noreferrer"
                            className="primary-button pub-btn-link"
                            style={{ textDecoration: 'none' }}
                          >
                            <ExternalLink size={13} /> Xem bài viết ↗
                          </a>
                        ) : isPublished ? (
                          <span className="pub-published-text" style={{ color: '#16a34a', fontWeight: 600, fontSize: 12 }}>
                            ✅ Đã đăng Facebook
                          </span>
                        ) : (
                          <span className="pub-waiting-text" style={{ color: '#64748b', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <Clock size={12} /> Đang xếp hàng...
                          </span>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* 4. Pagination Navigation Bar */}
          {filteredTasks.length > 0 && (
            <div className="pub-pagination-bar">
              <div style={{ fontSize: 12, color: '#64748b' }}>
                Hiển thị <strong>{(historyPage - 1) * historyPageSize + 1}</strong> –{' '}
                <strong>{Math.min(historyPage * historyPageSize, filteredTasks.length)}</strong> trên tổng số{' '}
                <strong>{filteredTasks.length}</strong> bài đăng (Trang {historyPage}/{totalPages})
              </div>

              <div className="pub-page-nav-btns">
                <button
                  type="button"
                  className="pub-page-num-btn"
                  onClick={() => setHistoryPage(1)}
                  disabled={historyPage === 1}
                  title="Về trang đầu"
                >
                  ««
                </button>
                <button
                  type="button"
                  className="pub-page-num-btn"
                  onClick={() => setHistoryPage(prev => Math.max(1, prev - 1))}
                  disabled={historyPage === 1}
                  title="Trang trước"
                >
                  <ChevronLeft size={14} />
                </button>

                {/* Numeric page pills */}
                {Array.from({ length: totalPages }, (_, i) => i + 1)
                  .filter(p => p === 1 || p === totalPages || Math.abs(p - historyPage) <= 2)
                  .map((pageNum, i, arr) => {
                    const showEllipsis = i > 0 && pageNum - arr[i - 1] > 1
                    return (
                      <span key={pageNum} style={{ display: 'inline-flex', alignItems: 'center' }}>
                        {showEllipsis && <span style={{ padding: '0 4px', color: '#94a3b8' }}>...</span>}
                        <button
                          type="button"
                          className={`pub-page-num-btn ${historyPage === pageNum ? 'pub-page-num-active' : ''}`}
                          onClick={() => setHistoryPage(pageNum)}
                        >
                          {pageNum}
                        </button>
                      </span>
                    )
                  })}

                <button
                  type="button"
                  className="pub-page-num-btn"
                  onClick={() => setHistoryPage(prev => Math.min(totalPages, prev + 1))}
                  disabled={historyPage >= totalPages}
                  title="Trang sau"
                >
                  <ChevronRight size={14} />
                </button>
                <button
                  type="button"
                  className="pub-page-num-btn"
                  onClick={() => setHistoryPage(totalPages)}
                  disabled={historyPage >= totalPages}
                  title="Đến trang cuối"
                >
                  »»
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* FOLDER PICKER MODAL */}
      {isFolderModalOpen && (
        <div className="modal-backdrop" onClick={() => setIsFolderModalOpen(false)}>
          <div className="modal-dialog pub-folder-modal" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="modal-header pub-modal-header">
              <div className="pub-modal-title">
                <div className="pub-modal-icon-badge">
                  <HardDrive size={18} />
                </div>
                <div>
                  <h3>Chọn thư mục lưu trữ Video</h3>
                  <span className="pub-modal-subtitle">
                    Duyệt các thư mục trên Google Drive của bạn
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="icon-button pub-modal-close"
                onClick={() => setIsFolderModalOpen(false)}
                title="Đóng"
              >
                <X size={18} />
              </button>
            </div>

            {/* Breadcrumbs Path */}
            <div className="pub-modal-breadcrumbs">
              <div className="pub-crumbs-wrap">
                {modalBreadcrumbs.map((crumb, idx) => (
                  <div key={crumb.id} className="pub-breadcrumb-step">
                    {idx > 0 && <ChevronRight size={13} className="pub-crumb-arrow" />}
                    <button
                      type="button"
                      className={`pub-crumb-btn ${
                        idx === modalBreadcrumbs.length - 1 ? 'pub-crumb-current' : ''
                      }`}
                      onClick={() => handleBreadcrumbClick(idx)}
                    >
                      {idx === 0 ? <HardDrive size={13} /> : <Folder size={13} />}
                      <span>{crumb.name}</span>
                    </button>
                  </div>
                ))}
              </div>
              <span className="pub-folder-count-badge">
                {modalFolders.length} thư mục
              </span>
            </div>

            {/* Search filter */}
            <div className="pub-modal-search-row">
              <Search size={14} className="pub-search-icon" />
              <input
                type="text"
                placeholder="Lọc nhanh thư mục theo tên..."
                value={modalSearch}
                onChange={e => {
                  setModalSearch(e.target.value)
                  loadModalFolders(modalParentId, e.target.value)
                }}
                className="pub-modal-search-input"
              />
            </div>

            {/* Folder Table List */}
            <div className="pub-modal-folder-list">
              {isLoadingModalFolders ? (
                <div className="pub-empty-box" style={{ padding: '40px 0' }}>
                  <Loader2 size={26} className="spin" style={{ color: '#4f46e5' }} />
                  <p style={{ marginTop: 8 }}>Đang quét thư mục Google Drive...</p>
                </div>
              ) : modalFolders.length === 0 ? (
                <div className="pub-empty-box" style={{ padding: '40px 0' }}>
                  <FolderOpen size={32} style={{ color: '#94a3b8' }} />
                  <p style={{ marginTop: 8 }}>Không có thư mục con nào ở cấp này.</p>
                </div>
              ) : (
                <div className="pub-folder-table">
                  <div className="pub-folder-thead">
                    <div className="pub-th-col pub-th-name">Tên thư mục</div>
                    <div className="pub-th-col pub-th-owner">Chủ sở hữu</div>
                    <div className="pub-th-col pub-th-date">Ngày sửa đổi</div>
                    <div className="pub-th-col pub-th-act">Mở</div>
                  </div>

                  <div className="pub-folder-tbody">
                    {modalFolders.map(f => {
                      const isSelected = modalSelectedFolder?.id === f.id
                      return (
                        <div
                          key={f.id}
                          className={`pub-folder-trow ${
                            isSelected ? 'pub-folder-trow-active' : ''
                          }`}
                          onClick={() => setModalSelectedFolder(f)}
                          onDoubleClick={() => handleNavigateFolder(f)}
                          title="Click để chọn, Double click để mở thư mục"
                        >
                          <div className="pub-td-col pub-td-name">
                            <div className="pub-gdrive-folder-icon">
                              <Folder size={17} />
                            </div>
                            <span className="pub-trow-folder-name">{f.name}</span>
                          </div>

                          <div className="pub-td-col pub-td-owner">
                            <span className="pub-owner-badge">tôi</span>
                          </div>

                          <div className="pub-td-col pub-td-date">
                            <span className="pub-trow-date">{formatDriveDate(f.modified_time)}</span>
                          </div>

                          <div className="pub-td-col pub-td-act">
                            <button
                              type="button"
                              className="pub-btn-open-dir"
                              onClick={e => {
                                e.stopPropagation()
                                handleNavigateFolder(f)
                              }}
                              title="Mở thư mục này"
                            >
                              <ChevronRight size={15} />
                            </button>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}
            </div>

            {/* Modal Footer / Custom link + Confirm */}
            <div className="pub-modal-footer">
              <div className="pub-custom-link-box">
                <Link2 size={15} style={{ color: '#94a3b8' }} />
                <input
                  type="text"
                  placeholder="Hoặc dán link / ID Google Drive..."
                  value={customLinkInput}
                  onChange={e => setCustomLinkInput(e.target.value)}
                  className="pub-custom-link-input"
                />
                <button
                  type="button"
                  className="chrome-button pub-btn-browse-link"
                  onClick={handleCustomLinkSubmit}
                  disabled={!customLinkInput.trim()}
                >
                  Duyệt link
                </button>
              </div>

              <div className="pub-modal-footer-btns">
                <button
                  type="button"
                  className="chrome-button"
                  onClick={() => setIsFolderModalOpen(false)}
                >
                  Hủy
                </button>

                <button
                  type="button"
                  className="primary-button pub-btn-confirm-select"
                  disabled={
                    !modalSelectedFolder &&
                    modalBreadcrumbs[modalBreadcrumbs.length - 1].id === 'root'
                  }
                  onClick={handleConfirmSelectModal}
                >
                  <Check size={15} />{' '}
                  {modalSelectedFolder
                    ? `Chọn "${modalSelectedFolder.name}"`
                    : modalBreadcrumbs.length > 1
                    ? `Chọn "${modalBreadcrumbs[modalBreadcrumbs.length - 1].name}"`
                    : 'Chọn thư mục'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* PREVIEW MODAL: REALISTIC FACEBOOK POST & REEL PREVIEW */}
      {previewModalOpen && scheduledSlots.length > 0 && (
        <div
          className="modal-backdrop pub-preview-modal-backdrop"
          onClick={() => setPreviewModalOpen(false)}
        >
          <div className="pub-preview-modal" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="pub-modal-header">
              <div className="pub-modal-title">
                <div className="pub-preview-icon-badge">
                  <Eye size={18} />
                </div>
                <div>
                  <h3>Xem Trước Bài Đăng Facebook</h3>
                  <span className="pub-modal-subtitle">
                    Mô phỏng bài viết và video xuất hiện trên Facebook Feed / Reels
                  </span>
                </div>
              </div>
              <button
                type="button"
                className="chrome-button pub-modal-close"
                onClick={() => setPreviewModalOpen(false)}
              >
                <X size={18} />
              </button>
            </div>

            {/* Navigation Toolbar */}
            <div className="pub-preview-nav-bar">
              <div className="pub-preview-nav-left">
                <button
                  type="button"
                  className="pub-preview-nav-btn"
                  disabled={previewSlotIndex === 0}
                  onClick={() => setPreviewSlotIndex(prev => Math.max(0, prev - 1))}
                >
                  <ChevronLeft size={15} /> Video trước
                </button>
                <span className="pub-preview-slot-counter">
                  Video <strong>{previewSlotIndex + 1}</strong> / {scheduledSlots.length}
                </span>
                <button
                  type="button"
                  className="pub-preview-nav-btn"
                  disabled={previewSlotIndex >= scheduledSlots.length - 1}
                  onClick={() =>
                    setPreviewSlotIndex(prev => Math.min(scheduledSlots.length - 1, prev + 1))
                  }
                >
                  Video sau <ChevronRight size={15} />
                </button>
              </div>

              <div className="pub-preview-slot-pills">
                {scheduledSlots.map((s, idx) => (
                  <button
                    key={s.file_id || idx}
                    type="button"
                    className={`pub-preview-pill-btn ${
                      idx === previewSlotIndex ? 'pub-preview-pill-active' : ''
                    }`}
                    onClick={() => setPreviewSlotIndex(idx)}
                    title={s.title}
                  >
                    #{idx + 1}
                  </button>
                ))}
              </div>
            </div>

            {/* Modal Body: Facebook Post Mockup */}
            <div className="pub-preview-body">
              {(() => {
                const currentSlot = scheduledSlots[previewSlotIndex]
                if (!currentSlot) return null
                const targetPage =
                  activePages.find(p => p.page_id === currentSlot.page_id) || activePages[0]
                const resolvedCaption = captionTemplate.replace(/{filename}/g, currentSlot.title)
                const scheduleDate = new Date(currentSlot.schedule_time_ms)
                const formattedDate = scheduleDate.toLocaleString('vi-VN', {
                  weekday: 'long',
                  year: 'numeric',
                  month: 'numeric',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })

                return (
                  <div className="fb-mock-card">
                    {/* Facebook Post Header */}
                    <div className="fb-mock-header">
                      <div className="fb-mock-author">
                        {targetPage?.picture_url ? (
                          <img src={targetPage.picture_url} alt="" className="fb-mock-avatar" />
                        ) : (
                          <div className="fb-mock-avatar-placeholder">
                            {targetPage?.page_name?.charAt(0) || 'F'}
                          </div>
                        )}
                        <div className="fb-mock-author-info">
                          <div className="fb-mock-page-name-row">
                            <strong className="fb-mock-page-name">
                              {targetPage?.page_name || 'Facebook Page'}
                            </strong>
                            <span className="fb-mock-dot">•</span>
                            <span className="fb-mock-follow">Theo dõi</span>
                          </div>
                          <div className="fb-mock-schedule-time">
                            <Clock size={11} />
                            <span>Lên lịch phát: {formattedDate}</span>
                            <span className="fb-mock-dot">•</span>
                            <span className="fb-mock-globe">🌐</span>
                          </div>
                        </div>
                      </div>

                      <div className="fb-mock-menu-dots">•••</div>
                    </div>

                    {/* Facebook Post Caption */}
                    <div className="fb-mock-caption-content">
                      <div className="fb-mock-text">
                        {resolvedCaption.split('\n').map((line, lIdx) => (
                          <p key={lIdx} style={{ margin: '0 0 6px 0' }}>
                            {line.split(' ').map((word, wIdx) => {
                              if (word.startsWith('#')) {
                                return (
                                  <span key={wIdx} className="fb-mock-hashtag">
                                    {word}{' '}
                                  </span>
                                )
                              }
                              return word + ' '
                            })}
                          </p>
                        ))}
                      </div>
                    </div>

                    {/* Video Mock Player */}
                    <div className="fb-mock-media-wrap">
                      <div className="fb-mock-video-player">
                        <div className="fb-mock-video-inner">
                          <div className="fb-mock-play-circle">
                            <Play size={24} fill="#ffffff" />
                          </div>
                          <div className="fb-mock-video-title-bar">
                            <FileVideo size={13} />
                            <span>{currentSlot.title}</span>
                          </div>
                          <div className="fb-mock-video-bottom-badges">
                            <span className="fb-mock-dur-pill">
                              ⏱️ {formatDuration(currentSlot.duration_seconds)}
                            </span>
                            <span className="fb-mock-size-pill">
                              {fmtBytes(currentSlot.size_bytes)}
                            </span>
                            <span className="fb-mock-hd-pill">HD 1080p • 10s</span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* Facebook Post Reactions / Stats Bar */}
                    <div className="fb-mock-stats-row">
                      <div className="fb-mock-likes-summary">
                        <span className="fb-like-icon-circle">👍</span>
                        <span className="fb-love-icon-circle">❤️</span>
                        <span className="fb-stats-txt">Pippit Auto Scheduler</span>
                      </div>
                      <div className="fb-mock-comments-shares">
                        <span>Reels & Video Feeds</span>
                      </div>
                    </div>

                    {/* Facebook Action Buttons */}
                    <div className="fb-mock-actions-bar">
                      <button type="button" className="fb-mock-act-btn">
                        <ThumbsUp size={14} /> Thích
                      </button>
                      <button type="button" className="fb-mock-act-btn">
                        <MessageCircle size={14} /> Bình luận
                      </button>
                      <button type="button" className="fb-mock-act-btn">
                        <Share2 size={14} /> Chia sẻ
                      </button>
                    </div>
                  </div>
                )
              })()}
            </div>

            {/* Modal Footer */}
            <div className="pub-modal-footer">
              <div className="pub-preview-footer-left">
                <button
                  type="button"
                  className="chrome-button pub-btn-copy-caption"
                  onClick={() => {
                    const cur = scheduledSlots[previewSlotIndex]
                    if (cur) {
                      const txt = captionTemplate.replace(/{filename}/g, cur.title)
                      handleCopyPreviewCaption(txt)
                    }
                  }}
                >
                  {copiedPreviewCaption ? (
                    <>
                      <Check size={13} style={{ color: '#16a34a' }} /> Đã sao chép caption!
                    </>
                  ) : (
                    <>
                      <Copy size={13} /> Sao chép Caption
                    </>
                  )}
                </button>
              </div>
              <div className="pub-modal-footer-btns">
                <button
                  type="button"
                  className="chrome-button"
                  onClick={() => setPreviewModalOpen(false)}
                >
                  Đóng xem trước
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
