import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
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
  Square,
  Tag,
  ThumbsUp,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import { PippitHistoryTab } from '../history/components/PippitHistoryTab'
import { fmtBytes } from '../../shared/utils/formatters'
import './PublisherPage.css'
import * as api from './services/publisherApi'
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
import type {
  ActiveFacebookPage,
  DriveFolder,
  DriveVideo,
  ScheduleSlot,
} from './types'

const QUICK_HASHTAGS = [
  '#shorts',
  '#reviewamthuc',
  '#foodreview',
  '#reels',
  '#monngon',
  '#amthuc',
  '#streetfood',
  '#vietnamfood',
]

const CAPTION_STATES_KEY = 'pippit_caption_states'
const CAPTION_TAG_STATES_KEY = 'pippit_caption_tag_states'
const CAPTION_CUSTOM_TAGS_KEY = 'pippit_caption_custom_tags'
const CAPTION_HIDDEN_TAGS_KEY = 'pippit_caption_hidden_tags'
const DEFAULT_CAPTION_STATES: Record<string, string> = {
  studio: '{filename}\n\n#shorts #reviewamthuc #foodreview #reels',
  audio: '{filename}\n\n#truyenaudio #truyenhay #kechuyen #shorts',
}
const DEFAULT_CAPTION_TAG_STATES: Record<string, string[]> = {
  studio: ['#shorts', '#reviewamthuc', '#foodreview', '#reels'],
  audio: ['#truyenaudio', '#truyenhay', '#kechuyen', '#shorts'],
}

function captionWorkflowLabel(workflow: string): string {
  const labels: Record<string, string> = { studio: 'Studio', audio: 'Audio' }
  return labels[workflow] || workflow.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
}

function resolvePublishedCaption(template: string, filename: string): string {
  const resolved = template.replace(/{filename}/g, filename)
  return resolved
    .split(filename).join('')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function fmtSlotTime(ms: number): string {
  return new Date(ms).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}

function TikTokIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-2.88 2.88 2.89 2.89 0 0 1-2.89-2.88 2.89 2.89 0 0 1 2.89-2.88c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 0 0-.79-.05A6.34 6.34 0 0 0 3 15.67a6.34 6.34 0 0 0 6.34 6.33 6.34 6.34 0 0 0 6.34-6.33V8.89a8.28 8.28 0 0 0 4.91 1.6V7.04a4.85 4.85 0 0 1-1-.35z" />
    </svg>
  )
}

function FacebookIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

function YouTubeIcon({ size = 11 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z" />
    </svg>
  )
}

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
  const [activeWorkflow, setActiveWorkflow] = useState('studio')
  const [childFolders, setChildFolders] = useState<DriveFolder[]>([])
  const [expandedFolderId, setExpandedFolderId] = useState<string | null>(null)
  const [expandedFolderVideos, setExpandedFolderVideos] = useState<Record<string, DriveVideo[]>>({})
  const [isLoadingExpandedFolder, setIsLoadingExpandedFolder] = useState(false)
  const [videos, setVideos] = useState<DriveVideo[]>([])
  const [isLoadingVideos, setIsLoadingVideos] = useState(false)
  const [videoSearch, setVideoSearch] = useState('')
  const [videoPublishedFilter, setVideoPublishedFilter] = useState<'all' | 'unposted' | 'tiktok' | 'facebook' | 'youtube'>('all')
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
  const [showQuickFolderCreate, setShowQuickFolderCreate] = useState(false)
  const [newQuickWorkflow, setNewQuickWorkflow] = useState('')
  const [newQuickFolderId, setNewQuickFolderId] = useState('')
  const [newQuickFolderName, setNewQuickFolderName] = useState('')
  const [folderPickerWorkflow, setFolderPickerWorkflow] = useState('')
  const [isCreatingQuickFolder, setIsCreatingQuickFolder] = useState(false)

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

  const [captionStates, setCaptionStates] = useState<Record<string, string>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CAPTION_STATES_KEY) || '{}')
      return { ...DEFAULT_CAPTION_STATES, ...(saved && typeof saved === 'object' ? saved : {}) }
    } catch {
      return DEFAULT_CAPTION_STATES
    }
  })
  const [captionTagStates, setCaptionTagStates] = useState<Record<string, string[]>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CAPTION_TAG_STATES_KEY) || '{}')
      return { ...DEFAULT_CAPTION_TAG_STATES, ...(saved && typeof saved === 'object' ? saved : {}) }
    } catch {
      return DEFAULT_CAPTION_TAG_STATES
    }
  })
  const [customCaptionTags, setCustomCaptionTags] = useState<Record<string, string[]>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CAPTION_CUSTOM_TAGS_KEY) || '{}')
      return saved && typeof saved === 'object' ? saved : {}
    } catch {
      return {}
    }
  })
  const [hiddenCaptionTags, setHiddenCaptionTags] = useState<Record<string, string[]>>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CAPTION_HIDDEN_TAGS_KEY) || '{}')
      return saved && typeof saved === 'object' ? saved : {}
    } catch {
      return {}
    }
  })
  const [selectedCaptionHashtags, setSelectedCaptionHashtags] = useState<string[]>(() => captionTagStates.studio || DEFAULT_CAPTION_TAG_STATES.studio)
  const [showCaptionStateCreate, setShowCaptionStateCreate] = useState(false)
  const [newCaptionStateName, setNewCaptionStateName] = useState('')
  const [newCaptionTag, setNewCaptionTag] = useState('')
  const [captionTemplate, setCaptionTemplate] = useState<string>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CAPTION_STATES_KEY) || '{}')
      return saved?.studio || DEFAULT_CAPTION_STATES.studio
    } catch {
      return DEFAULT_CAPTION_STATES.studio
    }
  })

  useEffect(() => {
    setCaptionStates(current => {
      const next = { ...current, [activeWorkflow]: captionTemplate }
      try { localStorage.setItem(CAPTION_STATES_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    setCaptionTagStates(current => {
      const next = { ...current, [activeWorkflow]: selectedCaptionHashtags }
      try { localStorage.setItem(CAPTION_TAG_STATES_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }, [activeWorkflow, captionTemplate, selectedCaptionHashtags])

  // Execution state
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
      setChildFolders(res.folders || [])
      setExpandedFolderId(null)
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

  useEffect(() => {
    loadInitialData()
  }, [loadInitialData])

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

  const openFolderPickerModal = (workflow = '') => {
    setFolderPickerWorkflow(workflow)
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

  const handleConfirmSelectModal = async () => {
    const selected = modalSelectedFolder || (() => {
      const current = modalBreadcrumbs[modalBreadcrumbs.length - 1]
      return current.id !== 'root' ? { id: current.id, name: current.name } : null
    })()
    if (selected) {
      if (folderPickerWorkflow === '__new_workflow__' || folderPickerWorkflow) {
        setNewQuickFolderId(selected.id)
        setNewQuickFolderName(selected.name)
        setFolderPickerWorkflow('')
        setIsFolderModalOpen(false)
        return
      }
      setSelectedFolderId(selected.id)
      setSelectedFolderName(selected.name)
      setIsFolderModalOpen(false)
      loadVideos(selected.id)
      return
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

  const selectWorkflowCaptionState = (workflow: string) => {
    const key = workflow.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '') || 'studio'
    setActiveWorkflow(key)
    setCaptionTemplate(captionStates[key] || DEFAULT_CAPTION_STATES[key] || DEFAULT_CAPTION_STATES.studio)
    setSelectedCaptionHashtags(captionTagStates[key] || DEFAULT_CAPTION_TAG_STATES[key] || [])
  }

  const handleQuickWorkflowFolder = (folder: { folder_id?: string; folder_name?: string }, workflow = activeWorkflow) => {
    if (!folder.folder_id) return
    selectWorkflowCaptionState(workflow)
    setSelectedFolderId(folder.folder_id)
    setSelectedFolderName(folder.folder_name || 'Thư mục workflow')
    setVideoSearch('')
    setSelectedVideoIds(new Set())
    loadVideos(folder.folder_id)
  }

  const handleOpenChildFolder = async (folder: DriveFolder) => {
    if (expandedFolderId === folder.id) {
      setExpandedFolderId(null)
      return
    }
    setExpandedFolderId(folder.id)
    if (expandedFolderVideos[folder.id]) return
    setIsLoadingExpandedFolder(true)
    try {
      const res = await api.fetchDriveVideos(folder.id)
      setExpandedFolderVideos(current => ({ ...current, [folder.id]: res.videos || [] }))
    } catch (err: any) {
      setErrorMessage(err.message || 'Không thể tải video trong folder con.')
      setExpandedFolderId(null)
    } finally {
      setIsLoadingExpandedFolder(false)
    }
  }

  const handleCreateQuickWorkflowFolder = async () => {
    const workflow = newQuickWorkflow.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '')
    if (!workflow || !newQuickFolderId) {
      setErrorMessage('Vui lòng nhập tên workflow và chọn folder có sẵn trên Google Drive.')
      return
    }
    setIsCreatingQuickFolder(true)
    setErrorMessage('')
    try {
      const response = await fetch(`${API_URL}/api/gdrive/workflow-folder`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflow, folder_id: newQuickFolderId, folder_name: newQuickFolderName }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.detail || 'Không thể tạo folder workflow.')
      setDriveStatus(data)
      const folder = data.workflow_folders?.[workflow]
      if (folder?.folder_id) handleQuickWorkflowFolder(folder, workflow)
      setShowQuickFolderCreate(false)
      setNewQuickWorkflow('')
      setNewQuickFolderName('')
      setSuccessMessage(`Đã thêm workflow ${workflow} dùng folder ${folder?.folder_name || newQuickFolderName}.`)
    } catch (error: any) {
      setErrorMessage(error.message || 'Không thể tạo folder workflow.')
    } finally {
      setIsCreatingQuickFolder(false)
    }
  }

  const openWorkflowFolderPicker = () => {
    openFolderPickerModal('__new_workflow__')
  }

  const workflowFolderLabel = (workflow: string) => {
    const labels: Record<string, string> = {
      audio: 'Audio',
      studio: 'Studio',
      watermark: 'Watermark',
    }
    return labels[workflow] || workflow.replace(/_/g, ' ').replace(/\b\w/g, char => char.toUpperCase())
  }

  // Filtered Drive videos (Search + Published Platform filter)
  const filteredVideos = useMemo(() => {
    return videos.filter(v => {
      // 1. Search query
      if (videoSearch.trim()) {
        const s = videoSearch.toLowerCase().trim()
        const matchName = v.name.toLowerCase().includes(s)
        const matchClean = cleanTitleFromName(v.name).toLowerCase().includes(s)
        if (!matchName && !matchClean) return false
      }

      // 2. Published Channel filter
      const pubList = v.published_channels || []
      if (videoPublishedFilter === 'unposted') {
        return pubList.length === 0
      }
      if (videoPublishedFilter === 'tiktok') {
        return pubList.some(c => c.platform === 'tiktok')
      }
      if (videoPublishedFilter === 'facebook') {
        return pubList.some(c => c.platform === 'facebook')
      }
      if (videoPublishedFilter === 'youtube') {
        return pubList.some(c => c.platform === 'youtube')
      }
      return true
    })
  }, [videos, videoSearch, videoPublishedFilter])

  // Computed Video Published Stats
  const videoStats = useMemo(() => {
    let unposted = 0
    let tiktok = 0
    let facebook = 0
    let youtube = 0
    for (const v of videos) {
      const list = v.published_channels || []
      if (list.length === 0) unposted++
      if (list.some(c => c.platform === 'tiktok')) tiktok++
      if (list.some(c => c.platform === 'facebook')) facebook++
      if (list.some(c => c.platform === 'youtube')) youtube++
    }
    return {
      total: videos.length,
      unposted,
      tiktok,
      facebook,
      youtube,
    }
  }, [videos])

  // Smart selection: Select all videos that have not been posted to currently chosen target channel
  const handleSelectUnpostedToCurrentChannel = () => {
    const selectedPageList = activePages.filter(p => selectedPageIds.has(p.page_id))
    const targetNames = new Set(selectedPageList.map(p => (p.page_name || '').toLowerCase()))
    const targetIds = new Set(selectedPageList.map(p => String(p.page_id)))

    const unpostedIds = new Set<string>()
    for (const v of filteredVideos) {
      const list = v.published_channels || []
      if (targetNames.size === 0) {
        if (list.length === 0) unpostedIds.add(v.id)
      } else {
        const alreadyPosted = list.some(
          c => targetIds.has(String(c.channel_id || '')) || targetNames.has((c.channel_name || '').toLowerCase())
        )
        if (!alreadyPosted) {
          unpostedIds.add(v.id)
        }
      }
    }
    setSelectedVideoIds(unpostedIds)
  }

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
    if (!filename) return ''
    return filename
      .replace(/\.[^/.]+$/, '')
      .replace(/[_-]?(clean|final|studio|recap|watermark_removed)[_-]?/gi, ' ')
      .replace(/[_\s-]+[0-9]{6,14}$/, '')
      .replace(/[_\s-]+[0-9]{4,8}[_\s-]+[0-9]{4,8}$/, '')
      .replace(/_/g, ' ')
      .replace(/\s+/g, ' ')
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
    const loadedVideos = [...videos, ...Object.values(expandedFolderVideos).flat()]
    const selectedVideosList = loadedVideos.filter(v => selectedVideoIds.has(v.id))
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
        const caption = resolvePublishedCaption(captionTemplate, cleanTitle)

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
        const caption = resolvePublishedCaption(captionTemplate, cleanTitle)

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
      const caption = resolvePublishedCaption(captionTemplate, cleanTitle)

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
    expandedFolderVideos,
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

  // Video nào đã đăng / lên lịch lên đúng kênh đích (tránh đăng trùng)
  const duplicateFileIds = useMemo(() => {
    const byId = new Map<string, DriveVideo>()
    for (const v of [...videos, ...Object.values(expandedFolderVideos).flat()]) byId.set(v.id, v)
    const out = new Set<string>()
    for (const slot of scheduledSlots) {
      const page = activePages.find(p => p.page_id === slot.page_id)
      const video = byId.get(slot.file_id)
      if (page && video && isPostedToTarget(video.published_channels, page)) out.add(slot.file_id)
    }
    return out
  }, [scheduledSlots, videos, expandedFolderVideos, activePages])

  const slotRange = useMemo(() => scheduleRange(scheduledSlots), [scheduledSlots])

  const handleDeselectDuplicates = () => {
    setSelectedVideoIds(prev => {
      const next = new Set(prev)
      duplicateFileIds.forEach(id => next.delete(id))
      return next
    })
  }

  // Đặt lịch: gửi từng video một (mỗi video = 1 request bulk 1 mục) để có tiến trình thật,
  // dừng được giữa chừng và biết chính xác video nào lỗi. Không tự gửi lại mục lỗi.
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
      setSubmitProgress({ current: i, total: slots.length, title: slot.title })
      const page = activePages.find(p => p.page_id === slot.page_id)
      const base = {
        file_id: slot.file_id,
        file_name: slot.file_name,
        title: slot.title,
        page_name: page ? channelLabel(page) : slot.page_name,
        schedule_time_ms: slot.schedule_time_ms,
      }
      try {
        // Giờ hẹn có thể đã trôi trong lúc upload các video trước.
        const [fresh] = ensureFutureTimes([slot], Date.now())
        const res = await api.submitBulkSchedule(page?.account_id || '', [
          { ...fresh, platform: page ? targetPlatform(page) : undefined },
        ])
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

    const okIds = new Set(results.filter(r => r.ok).map(r => r.file_id))
    if (okIds.size > 0) {
      // Bỏ chọn video đã lên lịch xong để không bấm gửi lại lần nữa.
      setSelectedVideoIds(prev => new Set([...prev].filter(id => !okIds.has(id))))
      setCustomSlotTimes(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !okIds.has(id))))
      setCustomSlotPages(prev => Object.fromEntries(Object.entries(prev).filter(([id]) => !okIds.has(id))))
      if (selectedFolderId) loadVideos(selectedFolderId, videoSearch)
    }
    const summary = summarizeRun(results)
    const stoppedNote = stopRequestedRef.current && results.length < slots.length
      ? ` Đã dừng, ${slots.length - results.length} video chưa gửi.`
      : ''
    if (summary.failed > 0) setErrorMessage(summary.text + stoppedNote)
    else if (results.length > 0) setSuccessMessage(summary.text + stoppedNote)
    setIsSubmitting(false)
    setSubmitProgress(null)
  }

  const handleStopBulkSchedule = () => {
    stopRequestedRef.current = true
    setStopRequested(true)
  }

  const handleAddHashtag = (tag: string) => {
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const isSelected = selectedCaptionHashtags.includes(tag)
    const isInCaption = captionTemplate.includes(tag)
    const shouldRemove = isSelected || isInCaption
    setSelectedCaptionHashtags(prev => shouldRemove ? prev.filter(item => item !== tag) : [...prev, tag])
    setCaptionTemplate(prev => {
      if (shouldRemove) {
        return prev
          .replace(new RegExp(`\\s*${escaped}(?=\\s|$)`, 'gi'), '')
          .replace(/[ \t]{2,}/g, ' ')
          .replace(/[ \t]+\n/g, '\n')
          .trimEnd()
      }
      return `${prev.trim()} ${tag}`
    })
  }

  const removeCustomCaptionTag = (tag: string) => {
    setHiddenCaptionTags(current => {
      const next = { ...current, [activeWorkflow]: Array.from(new Set([...(current[activeWorkflow] || []), tag])) }
      try { localStorage.setItem(CAPTION_HIDDEN_TAGS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    setCustomCaptionTags(current => {
      const next = { ...current, [activeWorkflow]: (current[activeWorkflow] || []).filter(item => item !== tag) }
      try { localStorage.setItem(CAPTION_CUSTOM_TAGS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    if (selectedCaptionHashtags.includes(tag) || captionTemplate.includes(tag)) handleAddHashtag(tag)
  }

  const createCaptionTag = () => {
    const raw = newCaptionTag.trim().replace(/\s+/g, '')
    if (!raw) return
    const tag = raw.startsWith('#') ? raw : `#${raw}`
    setHiddenCaptionTags(current => {
      const next = { ...current, [activeWorkflow]: (current[activeWorkflow] || []).filter(item => item !== tag) }
      try { localStorage.setItem(CAPTION_HIDDEN_TAGS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    setCustomCaptionTags(current => {
      const next = { ...current, [activeWorkflow]: Array.from(new Set([...(current[activeWorkflow] || []), tag])) }
      try { localStorage.setItem(CAPTION_CUSTOM_TAGS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
    setNewCaptionTag('')
  }

  const saveCaptionState = () => {
    const next = { ...captionStates, [activeWorkflow]: captionTemplate }
    const nextTags = { ...captionTagStates, [activeWorkflow]: selectedCaptionHashtags }
    setCaptionStates(next)
    setCaptionTagStates(nextTags)
    try { localStorage.setItem(CAPTION_STATES_KEY, JSON.stringify(next)) } catch {}
    try { localStorage.setItem(CAPTION_TAG_STATES_KEY, JSON.stringify(nextTags)) } catch {}
    setSuccessMessage(`Đã lưu state Caption cho workflow ${captionWorkflowLabel(activeWorkflow)}.`)
  }

  const createCaptionState = () => {
    const key = newCaptionStateName.trim().toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_|_$/g, '')
    if (!key) return
    const template = captionStates[key] || DEFAULT_CAPTION_STATES[key] || DEFAULT_CAPTION_STATES.studio
    const tags = captionTagStates[key] || DEFAULT_CAPTION_TAG_STATES[key] || []
    const next = { ...captionStates, [key]: template }
    const nextTags = { ...captionTagStates, [key]: tags }
    setCaptionStates(next)
    setCaptionTagStates(nextTags)
    setActiveWorkflow(key)
    setCaptionTemplate(template)
    setSelectedCaptionHashtags(tags)
    try { localStorage.setItem(CAPTION_STATES_KEY, JSON.stringify(next)) } catch {}
    try { localStorage.setItem(CAPTION_TAG_STATES_KEY, JSON.stringify(nextTags)) } catch {}
    setNewCaptionStateName('')
    setShowCaptionStateCreate(false)
    setSuccessMessage(`Đã tạo state cho workflow ${captionWorkflowLabel(key)}.`)
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
            Chọn video ngắn trong Google Drive, đặt khung giờ và lên lịch đăng hàng loạt lên Facebook Fanpage / TikTok qua Pippit.
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
                Kênh đăng:{' '}
                <strong>
                  {activePages.length === 0
                    ? 'chưa có kênh nào'
                    : `${activePages.filter(p => targetPlatform(p) === 'facebook').length} Facebook · ${activePages.filter(p => targetPlatform(p) === 'tiktok').length} TikTok`}
                </strong>
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
            onClick={() => setActiveTab('history')}
          >
            <CalendarClock size={15} /> Lịch đã đặt
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
                onClick={() => openFolderPickerModal()}
              >
                <Folder size={13} /> Đổi thư mục
              </button>
            </div>

            {driveStatus?.connected && (
              <div className="pub-quick-workflow-folders">
                <span className="pub-quick-workflow-label">Chọn nhanh folder mặc định:</span>
                {driveStatus?.folder_id && (
                  <button
                    type="button"
                    className={`pub-quick-workflow-btn ${selectedFolderId === driveStatus.folder_id ? 'active' : ''}`}
                    onClick={() => handleQuickWorkflowFolder({ folder_id: driveStatus.folder_id, folder_name: driveStatus.folder_name || 'Folder mặc định' }, 'studio')}
                    title="Mở folder mặc định gốc"
                  >
                    <Folder size={13} /> Folder mặc định
                  </button>
                )}
                {Object.entries(driveStatus?.workflow_folders || {})
                  .filter(([, folder]: [string, any]) => folder?.folder_id)
                  .map(([workflow, folder]) => (
                    <button
                      key={workflow}
                      type="button"
                      className={`pub-quick-workflow-btn ${selectedFolderId === (folder as any).folder_id ? 'active' : ''}`}
                      onClick={() => handleQuickWorkflowFolder(folder as any, workflow)}
                      title={`Mở folder ${workflowFolderLabel(workflow)}`}
                    >
                      <Folder size={13} /> Chọn {workflowFolderLabel(workflow)} Folder
                    </button>
                  ))}
                <button
                  type="button"
                  className="pub-quick-workflow-btn pub-quick-workflow-add"
                  onClick={() => setShowQuickFolderCreate(value => !value)}
                >
                  <Plus size={13} /> Tạo folder workflow
                </button>
              </div>
            )}

            {showQuickFolderCreate && driveStatus?.connected && (
              <div className="pub-quick-workflow-create">
                <input
                  value={newQuickWorkflow}
                  onChange={e => setNewQuickWorkflow(e.target.value)}
                  placeholder="Tên workflow (VD: Audio)"
                  disabled={isCreatingQuickFolder}
                />
                <input
                  value={newQuickFolderName}
                  readOnly
                  placeholder="Chưa chọn folder Drive"
                  disabled={isCreatingQuickFolder}
                />
                <button type="button" className="chrome-button" onClick={openWorkflowFolderPicker} disabled={isCreatingQuickFolder}>
                  <Folder size={13} /> Chọn folder Drive
                </button>
                <button type="button" className="primary-button" onClick={handleCreateQuickWorkflowFolder} disabled={isCreatingQuickFolder}>
                  {isCreatingQuickFolder ? <Loader2 size={13} className="spin" /> : <Check size={13} />} Lưu workflow
                </button>
                <button type="button" className="chrome-button" onClick={() => setShowQuickFolderCreate(false)} disabled={isCreatingQuickFolder}>Hủy</button>
              </div>
            )}

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

            {/* Video Published Channel Filter Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap', marginTop: 8 }}>
              <button
                type="button"
                onClick={() => setVideoPublishedFilter('all')}
                style={{
                  padding: '3px 8px',
                  borderRadius: 14,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: videoPublishedFilter === 'all' ? '1px solid #6366f1' : '1px solid #e2e8f0',
                  background: videoPublishedFilter === 'all' ? '#eef2ff' : '#fff',
                  color: videoPublishedFilter === 'all' ? '#4f46e5' : '#64748b',
                  transition: 'all 0.15s ease',
                }}
              >
                Tất cả ({videoStats.total})
              </button>
              <button
                type="button"
                onClick={() => setVideoPublishedFilter('unposted')}
                style={{
                  padding: '3px 8px',
                  borderRadius: 14,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  border: videoPublishedFilter === 'unposted' ? '1px solid #10b981' : '1px solid #e2e8f0',
                  background: videoPublishedFilter === 'unposted' ? '#ecfdf5' : '#fff',
                  color: videoPublishedFilter === 'unposted' ? '#059669' : '#64748b',
                  transition: 'all 0.15s ease',
                }}
              >
                🆕 Chưa đăng ({videoStats.unposted})
              </button>
              <button
                type="button"
                onClick={() => setVideoPublishedFilter('tiktok')}
                style={{
                  padding: '3px 8px',
                  borderRadius: 14,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  border: videoPublishedFilter === 'tiktok' ? '1px solid #0f172a' : '1px solid #e2e8f0',
                  background: videoPublishedFilter === 'tiktok' ? '#f1f5f9' : '#fff',
                  color: videoPublishedFilter === 'tiktok' ? '#0f172a' : '#64748b',
                  transition: 'all 0.15s ease',
                }}
              >
                <TikTokIcon size={10} /> TikTok ({videoStats.tiktok})
              </button>
              <button
                type="button"
                onClick={() => setVideoPublishedFilter('facebook')}
                style={{
                  padding: '3px 8px',
                  borderRadius: 14,
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 3,
                  border: videoPublishedFilter === 'facebook' ? '1px solid #0284c7' : '1px solid #e2e8f0',
                  background: videoPublishedFilter === 'facebook' ? '#f0f9ff' : '#fff',
                  color: videoPublishedFilter === 'facebook' ? '#0284c7' : '#64748b',
                  transition: 'all 0.15s ease',
                }}
              >
                <FacebookIcon size={10} /> FB ({videoStats.facebook})
              </button>
              {videoStats.youtube > 0 && (
                <button
                  type="button"
                  onClick={() => setVideoPublishedFilter('youtube')}
                  style={{
                    padding: '3px 8px',
                    borderRadius: 14,
                    fontSize: 11,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 3,
                    border: videoPublishedFilter === 'youtube' ? '1px solid #e11d48' : '1px solid #e2e8f0',
                    background: videoPublishedFilter === 'youtube' ? '#fff1f2' : '#fff',
                    color: videoPublishedFilter === 'youtube' ? '#e11d48' : '#64748b',
                    transition: 'all 0.15s ease',
                  }}
                >
                  <YouTubeIcon size={10} /> YT ({videoStats.youtube})
                </button>
              )}
            </div>

            {/* Select All Row */}
            <div className="pub-select-all-row" style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6 }}>
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
                <span>Chọn tất cả ({filteredVideos.length})</span>
              </label>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  onClick={handleSelectUnpostedToCurrentChannel}
                  title="Tự động lọc và chỉ chọn những video chưa từng đăng lên kênh đang chọn ở Bước 2"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                    padding: '3px 8px',
                    borderRadius: 6,
                    fontSize: 11,
                    fontWeight: 600,
                    background: '#f8fafc',
                    border: '1px solid #cbd5e1',
                    color: '#475569',
                    cursor: 'pointer',
                  }}
                >
                  <Sparkles size={11} color="#6366f1" />
                  <span>Chọn video chưa đăng</span>
                </button>
                <span className="pub-selected-pill">
                  Đã chọn: <strong>{selectedVideoIds.size}</strong>
                </span>
              </div>
            </div>

            {/* Video List */}
            <div className="pub-video-list">
              {isLoadingVideos ? (
                <div className="pub-empty-box">
                  <Loader2 size={24} className="spin" style={{ color: '#4f46e5' }} />
                  <p style={{ marginTop: 8 }}>Đang tải video từ Google Drive...</p>
                </div>
              ) : filteredVideos.length === 0 && childFolders.length === 0 ? (
                <div className="pub-empty-box">
                  <FileVideo size={28} style={{ color: '#94a3b8' }} />
                  <p style={{ marginTop: 8 }}>Không tìm thấy file video MP4 nào phù hợp với bộ lọc.</p>
                </div>
              ) : (
                <>
                {childFolders.map(folder => {
                  const isExpanded = expandedFolderId === folder.id
                  const folderVideos = expandedFolderVideos[folder.id] || []
                  return <div key={folder.id}>
                    <div className={`pub-drive-folder-card ${isExpanded ? 'pub-drive-folder-card-expanded' : ''}`} onClick={() => handleOpenChildFolder(folder)}>
                      <div className="pub-drive-folder-card-icon"><FolderOpen size={22} /></div>
                      <div className="pub-drive-folder-card-info">
                        <strong>{folder.name}</strong>
                        <span>{isExpanded ? `${folderVideos.length} video · Bấm để thu gọn` : 'Folder con · Bấm để xổ video'}</span>
                      </div>
                      {isLoadingExpandedFolder && isExpanded ? <Loader2 size={17} className="spin pub-drive-folder-card-arrow" /> : <ChevronRight size={17} className="pub-drive-folder-card-arrow" />}
                    </div>
                    {isExpanded && folderVideos.length > 0 && <div className="pub-drive-folder-video-list">
                      {folderVideos.map(video => {
                        const isSelected = selectedVideoIds.has(video.id)
                        return <div key={video.id} className={`pub-drive-child-video ${isSelected ? 'selected' : ''}`} onClick={() => handleToggleVideo(video.id)}>
                          <input type="checkbox" checked={isSelected} onChange={() => handleToggleVideo(video.id)} onClick={event => event.stopPropagation()} />
                          <FileVideo size={17} />
                          <span>{cleanTitleFromName(video.name)}</span>
                          <small>{formatDuration(video.duration_seconds)} · {fmtBytes(video.size_bytes)}</small>
                        </div>
                      })}
                    </div>}
                    {isExpanded && !isLoadingExpandedFolder && folderVideos.length === 0 && <div className="pub-drive-folder-empty">Folder này chưa có video MP4 trực tiếp.</div>}
                  </div>
                })}
                {filteredVideos.map(video => {
                  const isSelected = selectedVideoIds.has(video.id)
                  const cleanName = cleanTitleFromName(video.name)
                  const selectedPageList = activePages.filter(p => selectedPageIds.has(p.page_id))
                  const targetNames = new Set(selectedPageList.map(p => (p.page_name || '').toLowerCase()))
                  const targetIds = new Set(selectedPageList.map(p => String(p.page_id)))
                  const pubList = video.published_channels || []
                  const isPostedToTarget = pubList.some(
                    c => targetIds.has(String(c.channel_id || '')) || targetNames.has((c.channel_name || '').toLowerCase())
                  )

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
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6 }}>
                          <strong className="pub-video-clean-title">{cleanName}</strong>
                          {isPostedToTarget && (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 3,
                                fontSize: 10,
                                fontWeight: 700,
                                color: '#b45309',
                                background: '#fef3c7',
                                border: '1px solid #fde68a',
                                padding: '1px 5px',
                                borderRadius: 4,
                                flexShrink: 0,
                              }}
                              title="Video này đã từng được lên lịch/đăng lên kênh đang chọn ở Bước 2"
                            >
                              ⚠️ Đã có trên kênh
                            </span>
                          )}
                        </div>

                        <div className="pub-video-sub-line">
                          <span className="pub-video-raw-filename">{video.name}</span>
                          <span className="pub-dot-sep">•</span>
                          <span className="pub-video-size-txt">{fmtBytes(video.size_bytes)}</span>
                        </div>

                        {/* Published Channels Badges Row */}
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                          {pubList.length > 0 ? (
                            pubList.map((c, idx) => {
                              const isTarget =
                                targetNames.has((c.channel_name || '').toLowerCase()) ||
                                targetIds.has(String(c.channel_id || ''))
                              if (c.platform === 'tiktok') {
                                return (
                                  <span
                                    key={idx}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 3,
                                      fontSize: 10,
                                      fontWeight: 600,
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                      background: isTarget ? '#fef3c7' : '#f1f5f9',
                                      color: isTarget ? '#b45309' : '#0f172a',
                                      border: isTarget ? '1px solid #fde68a' : '1px solid #cbd5e1',
                                    }}
                                    title={`Đã lên lịch TikTok: ${c.channel_name}`}
                                  >
                                    <TikTokIcon size={10} />
                                    <span>{c.channel_name}</span>
                                  </span>
                                )
                              }
                              if (c.platform === 'facebook') {
                                return (
                                  <span
                                    key={idx}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: 3,
                                      fontSize: 10,
                                      fontWeight: 600,
                                      padding: '1px 6px',
                                      borderRadius: 4,
                                      background: isTarget ? '#fef3c7' : '#f0f9ff',
                                      color: isTarget ? '#b45309' : '#0284c7',
                                      border: isTarget ? '1px solid #fde68a' : '1px solid #bae6fd',
                                    }}
                                    title={`Đã lên lịch Facebook: ${c.channel_name}`}
                                  >
                                    <FacebookIcon size={10} />
                                    <span>{c.channel_name}</span>
                                  </span>
                                )
                              }
                              return (
                                <span
                                  key={idx}
                                  style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 3,
                                    fontSize: 10,
                                    fontWeight: 600,
                                    padding: '1px 6px',
                                    borderRadius: 4,
                                    background: '#fff1f2',
                                    color: '#e11d48',
                                    border: '1px solid #fecdd3',
                                  }}
                                  title={`Đã lên lịch YouTube: ${c.channel_name}`}
                                >
                                  <YouTubeIcon size={10} />
                                  <span>{c.channel_name}</span>
                                </span>
                              )
                            })
                          ) : (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 2,
                                fontSize: 9.5,
                                fontWeight: 600,
                                padding: '1px 5px',
                                borderRadius: 4,
                                background: '#ecfdf5',
                                color: '#059669',
                                border: '1px solid #a7f3d0',
                              }}
                            >
                              🆕 Chưa đăng
                            </span>
                          )}
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
                })}
                </>
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
                    <h3>2. Kênh đăng & lịch phát</h3>
                    <span>Chọn kênh Facebook / TikTok và khung giờ đăng</span>
                  </div>
                </div>
              </div>

              <div className="pub-config-2col-layout">
                {/* Left side: Active Fanpage Selector */}
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
                          className={`pub-active-page-card ${
                            isSelected ? 'pub-active-page-card-selected' : ''
                          }`}
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
                              <span className={`pub-page-avatar-fallback pub-plat-${plat}`}>
                                {(page.page_name || '?').charAt(0).toUpperCase()}
                              </span>
                              {page.avatar_url && (
                                <img
                                  src={page.avatar_url}
                                  alt=""
                                  className="pub-active-page-avatar"
                                  onError={e => {
                                    e.currentTarget.style.display = 'none'
                                  }}
                                />
                              )}
                              <span className={`pub-page-plat-badge pub-plat-${plat}`} title={plat === 'tiktok' ? 'TikTok' : 'Facebook'}>
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
                          <strong>Chưa có kênh Facebook / TikTok nào</strong>
                          <p>Liên kết kênh trên Pippit rồi bấm quét lại tài khoản trong Cài đặt.</p>
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
                      <div className="pub-caption-state-actions">
                        <button type="button" className="pub-tag-btn" onClick={() => setShowCaptionStateCreate(value => !value)}>+ Tạo state</button>
                        <button type="button" className="pub-tag-btn" onClick={saveCaptionState} title="Lưu mẫu Caption riêng cho workflow này">Lưu state</button>
                        <button type="button" className="pub-tag-btn" onClick={() => setCaptionTemplate(prev => prev.includes('{filename}') ? prev : `${prev} {filename}`)} title="Chèn biến tên video tự động">+ {'{filename}'}</button>
                      </div>
                    <div className="pub-caption-state-switcher" title="Áp dụng state đã lưu">
                      {Object.keys(captionStates).sort().map(key => <button key={key} type="button" data-workflow={key} className={`pub-caption-state-pill ${activeWorkflow === key ? 'active' : ''}`} onClick={() => selectWorkflowCaptionState(key)}>{captionWorkflowLabel(key)}</button>)}
                    </div>
                    </div>
                    {showCaptionStateCreate && <div className="pub-caption-state-create">
                      <input value={newCaptionStateName} onChange={e => setNewCaptionStateName(e.target.value)} placeholder="Tên workflow/state (VD: Audio)" onKeyDown={e => { if (e.key === 'Enter') createCaptionState() }} />
                      <button type="button" className="pub-tag-btn" onClick={createCaptionState} disabled={!newCaptionStateName.trim()}>Tạo</button>
                    </div>}
                    <textarea
                      rows={2}
                      value={captionTemplate}
                      onChange={e => setCaptionTemplate(e.target.value)}
                      className="pub-textarea"
                      placeholder="Nhập nội dung bài viết..."
                    />
                    <div className="pub-hashtag-chips">
                      {Array.from(new Set([...QUICK_HASHTAGS, ...selectedCaptionHashtags, ...(customCaptionTags[activeWorkflow] || [])])).filter(tag => !(hiddenCaptionTags[activeWorkflow] || []).includes(tag)).map(tag => (
                        <span
                          key={tag}
                          className={`pub-hash-chip ${selectedCaptionHashtags.includes(tag) && captionTemplate.includes(tag) ? 'pub-hash-chip-active' : ''}`}
                          onClick={() => handleAddHashtag(tag)}
                        >
                          <Hash size={11} />
                          {tag.replace('#', '')}
                          <button type="button" className="pub-hash-chip-remove" onClick={event => { event.stopPropagation(); removeCustomCaptionTag(tag) }} aria-label={`Xóa ${tag}`}>×</button>
                        </span>
                      ))}
                      <div className="pub-custom-tag-create">
                        <input value={newCaptionTag} onChange={e => setNewCaptionTag(e.target.value)} placeholder="#tag_moi" onKeyDown={e => { if (e.key === 'Enter') createCaptionTag() }} />
                        <button type="button" className="pub-hash-chip pub-custom-tag-button" onClick={createCaptionTag} disabled={!newCaptionTag.trim()}>+ Tạo tag</button>
                      </div>
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
                    <span>Chỉnh giờ và kênh riêng cho từng video</span>
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
                    const isDuplicate = duplicateFileIds.has(slot.file_id)

                    return (
                      <div
                        key={slot.file_id || idx}
                        className={`pub-slot-card-detailed ${
                          isCustom ? 'pub-slot-card-customized' : ''
                        }${isDuplicate ? ' pub-slot-card-duplicate' : ''}`}
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
                            {isDuplicate && (
                              <span
                                className="pub-slot-dup-tag"
                                title="Video này đã được đăng hoặc lên lịch lên đúng kênh đích"
                              >
                                <AlertTriangle size={11} /> Đã đăng lên kênh này
                              </span>
                            )}
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
                              {activePages
                                .filter(p => selectedPageIds.has(p.page_id) || p.page_id === slot.page_id)
                                .map(p => (
                                  <option key={p.page_id} value={p.page_id}>
                                    {channelLabel(p)}
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

              {/* Thanh hành động dính đáy: tóm tắt + đặt lịch + tiến trình */}
              <div className="pub-action-bar">
                {isSubmitting && submitProgress ? (
                  <div className="pub-action-progress">
                    <div className="pub-progress-text">
                      <Loader2 size={14} className="spin" />
                      <span>
                        {stopRequested ? 'Đang dừng sau video hiện tại… ' : 'Đang upload & lên lịch '}
                        <strong>
                          {submitProgress.current + 1}/{submitProgress.total}
                        </strong>
                        : {submitProgress.title}
                      </span>
                    </div>
                    <div className="wm-prog-bar-wrap">
                      <div
                        className="wm-prog-bar"
                        style={{ width: `${(submitProgress.current / submitProgress.total) * 100}%` }}
                      />
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
                        {duplicateFileIds.size > 0 && (
                          <span className="pub-action-dup">
                            <AlertTriangle size={12} /> {duplicateFileIds.size} video đã đăng lên kênh đích
                            <button type="button" onClick={handleDeselectDuplicates}>
                              Bỏ chọn
                            </button>
                          </span>
                        )}
                      </>
                    )}
                  </div>
                )}

                {isSubmitting ? (
                  <button
                    type="button"
                    className="pub-stop-btn"
                    onClick={handleStopBulkSchedule}
                    disabled={stopRequested}
                  >
                    <Square size={14} /> {stopRequested ? 'Đang dừng…' : 'Dừng'}
                  </button>
                ) : (
                  <button
                    type="button"
                    className="pub-submit-btn"
                    disabled={
                      scheduledSlots.length === 0 ||
                      activePages.length === 0 ||
                      selectedPageIds.size === 0
                    }
                    onClick={handleStartBulkSchedule}
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
                      <li key={`${r.file_id}-${i}`} className={r.ok ? 'is-ok' : 'is-err'}>
                        {r.ok ? <CheckCircle2 size={13} /> : <XCircle size={13} />}
                        <span className="pub-run-title">{r.title}</span>
                        <span className="pub-run-meta">
                          {r.page_name} · {fmtSlotTime(r.schedule_time_ms)}
                        </span>
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

      {/* TAB 2: LỊCH ĐÃ ĐẶT — dùng chung component với Lịch sử > Đăng FB & TikTok */}
      {activeTab === 'history' && <PippitHistoryTab />}

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
                const resolvedCaption = resolvePublishedCaption(captionTemplate, currentSlot.title)
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
                        {targetPage?.avatar_url ? (
                          <img src={targetPage.avatar_url} alt="" className="fb-mock-avatar" />
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
                      const txt = resolvePublishedCaption(captionTemplate, cur.title)
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
