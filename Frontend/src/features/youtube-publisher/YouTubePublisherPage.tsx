import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  AlertCircle,
  Calendar,
  CalendarClock,
  Check,
  CheckCircle2,
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
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Tag,
  Trash2,
  Tv,
  UploadCloud,
  X,
  XCircle,
} from 'lucide-react'
import { YouTubeBrandIcon } from '../settings/components/YouTubeSection'
import * as api from './services/youtubePublisherApi'
import type {
  DriveFolder,
  DriveVideo,
  GoldenSlot,
  YouTubeCategory,
  YouTubeScheduleSlot,
  YouTubeStatus,
  YouTubeTask,
} from './types'

const QUICK_HASHTAGS = [
  '#shorts',
  '#recap',
  '#reviewphim',
  '#phimhay',
  '#reviewamthuc',
  '#foodreview',
  '#streetfood',
  '#monngon',
  '#docla',
]

const INTERVAL_PRESETS = [
  { label: '15 phút', value: 15 },
  { label: '30 phút', value: 30 },
  { label: '45 phút', value: 45 },
  { label: '1 giờ', value: 60 },
  { label: '2 giờ', value: 120 },
  { label: '3 giờ', value: 180 },
]

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

function formatBytes(bytes?: number): string {
  if (!bytes || bytes === 0) return '0 MB'
  const mb = bytes / (1024 * 1024)
  if (mb >= 1024) {
    return `${(mb / 1024).toFixed(2)} GB`
  }
  return `${mb.toFixed(1)} MB`
}

function toLocalDatetimeInput(ms: number): string {
  const d = new Date(ms)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

interface YouTubePublisherPageProps {
  setActivePage?: (page: string) => void
}

export function YouTubePublisherPage({ setActivePage }: YouTubePublisherPageProps) {
  const [activeTab, setActiveTab] = useState<'bulk' | 'history'>('bulk')

  // YouTube Channel State
  const [ytStatus, setYtStatus] = useState<YouTubeStatus | null>(null)
  const [categories, setCategories] = useState<YouTubeCategory[]>([])
  const [ytLoading, setYtLoading] = useState(true)

  // Drive state
  const [driveStatus, setDriveStatus] = useState<any>(null)
  const [selectedFolderId, setSelectedFolderId] = useState<string>('')
  const [driveFolders, setDriveFolders] = useState<DriveFolder[]>([])
  const [driveVideos, setDriveVideos] = useState<DriveVideo[]>([])
  const [selectedDriveVideoIds, setSelectedDriveVideoIds] = useState<string[]>([])
  const [loadingDrive, setLoadingDrive] = useState(false)
  const [searchDrive, setSearchDrive] = useState('')

  // Video Source Mode: 'gdrive' | 'local'
  const [sourceMode, setSourceMode] = useState<'gdrive' | 'local'>('gdrive')

  // Queue of Schedule Slots
  const [slots, setSlots] = useState<YouTubeScheduleSlot[]>([])

  // Scheduling Configurations
  const [scheduleMode, setScheduleMode] = useState<'golden' | 'interval'>('golden')
  const [goldenPreset, setGoldenPreset] = useState<string>('3_per_day')
  const [customInterval, setCustomInterval] = useState<number>(60)
  const [startDateStr, setStartDateStr] = useState<string>(() => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000)
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`
  })
  const [customStartDateTime, setCustomStartDateTime] = useState<string>(() =>
    toLocalDatetimeInput(Date.now() + 30 * 60 * 1000)
  )

  // Bulk Edit Tools
  const [bulkPrefix, setBulkPrefix] = useState('')
  const [bulkSuffix, setBulkSuffix] = useState('')
  const [bulkDescription, setBulkDescription] = useState('')
  const [bulkTags, setBulkTags] = useState('')
  const [bulkCategory, setBulkCategory] = useState('24')
  const [bulkPrivacy, setBulkPrivacy] = useState<'public' | 'unlisted' | 'private' | 'scheduled'>('public')

  // Execution & Progress State
  const [submitting, setSubmitting] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [progressPercent, setProgressPercent] = useState(0)

  // History State
  const [tasks, setTasks] = useState<YouTubeTask[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [taskFilter, setTaskFilter] = useState<'all' | 'published' | 'scheduled' | 'failed'>('all')
  const [taskSearch, setTaskSearch] = useState('')

  // Notifications
  const [toastMsg, setToastMsg] = useState<{ type: 'success' | 'error'; text: string } | null>(null)

  function showToast(text: string, type: 'success' | 'error' = 'success') {
    setToastMsg({ type, text })
    setTimeout(() => setToastMsg(null), 5000)
  }

  // Load Initial Status
  const loadStatus = useCallback(async () => {
    setYtLoading(true)
    try {
      const [statusData, catsData, driveData] = await Promise.all([
        api.fetchYouTubeStatus(),
        api.fetchYouTubeCategories().catch(() => []),
        api.fetchDriveStatus().catch(() => null),
      ])
      setYtStatus(statusData)
      setCategories(catsData)
      setDriveStatus(driveData)
      if (driveData?.folder_id) {
        setSelectedFolderId(driveData.folder_id)
      }
    } catch {
      // ignore
    } finally {
      setYtLoading(false)
    }
  }, [])

  useEffect(() => {
    loadStatus()
  }, [loadStatus])

  // Load Drive Folders & Videos
  const loadDriveData = useCallback(async (folderId?: string) => {
    setLoadingDrive(true)
    try {
      const [folders, videos] = await Promise.all([
        api.fetchDriveFolders().catch(() => []),
        api.fetchDriveVideos(folderId, searchDrive).catch(() => []),
      ])
      setDriveFolders(folders)
      setDriveVideos(videos)
    } catch (err: any) {
      showToast(err.message || 'Lỗi tải dữ liệu Google Drive', 'error')
    } finally {
      setLoadingDrive(false)
    }
  }, [searchDrive])

  useEffect(() => {
    if (sourceMode === 'gdrive' && driveStatus?.connected) {
      loadDriveData(selectedFolderId || driveStatus.folder_id)
    }
  }, [sourceMode, driveStatus?.connected, selectedFolderId, loadDriveData])

  // Load Tasks History
  const loadTasks = useCallback(async () => {
    setLoadingTasks(true)
    try {
      const data = await api.fetchYouTubeTasks()
      setTasks(data)
    } catch {
      // ignore
    } finally {
      setLoadingTasks(false)
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'history') {
      loadTasks()
    }
  }, [activeTab, loadTasks])

  // Toggle selection for Drive videos
  function toggleSelectDriveVideo(id: string) {
    setSelectedDriveVideoIds(prev =>
      prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id]
    )
  }

  function handleSelectAllDrive() {
    if (selectedDriveVideoIds.length === driveVideos.length) {
      setSelectedDriveVideoIds([])
    } else {
      setSelectedDriveVideoIds(driveVideos.map(v => v.id))
    }
  }

  // Add selected Drive videos to queue
  function handleAddDriveVideosToQueue() {
    const selectedVideos = driveVideos.filter(v => selectedDriveVideoIds.includes(v.id))
    if (selectedVideos.length === 0) return

    const newSlots: YouTubeScheduleSlot[] = selectedVideos.map(v => {
      const cleanName = v.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ')
      return {
        id: `slot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        source_type: 'gdrive',
        drive_file_id: v.id,
        file_name: v.name,
        title: cleanName,
        description: ytStatus?.default_tags || '',
        tags: ytStatus?.default_tags || '',
        category_id: '24',
        privacy_status: (ytStatus?.default_privacy as any) || 'public',
        thumbnail_url: v.thumbnail_link,
        size_bytes: v.size_bytes,
        duration_seconds: v.duration_seconds,
      }
    })

    setSlots(prev => [...prev, ...newSlots])
    setSelectedDriveVideoIds([])
    showToast(`Đã thêm ${newSlots.length} video vào hàng chờ lên lịch!`)
  }

  // Handle local files upload to queue
  function handleAddLocalFiles(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files
    if (!files || files.length === 0) return

    const newSlots: YouTubeScheduleSlot[] = Array.from(files).map(file => {
      const cleanName = file.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ')
      // Electron / Browser File object has .path in desktop environment
      const filePath = (file as any).path || ''
      return {
        id: `slot_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
        source_type: 'local',
        file_path: filePath,
        file_name: file.name,
        file: file,
        title: cleanName,
        description: ytStatus?.default_tags || '',
        tags: ytStatus?.default_tags || '',
        category_id: '24',
        privacy_status: (ytStatus?.default_privacy as any) || 'public',
        size_bytes: file.size,
      }
    })

    setSlots(prev => [...prev, ...newSlots])
    showToast(`Đã thêm ${newSlots.length} video từ máy tính vào hàng chờ!`)
  }

  // Auto-calculate Publish Times for All Queued Slots
  function applyScheduleTimings() {
    if (slots.length === 0) return

    const updated = [...slots]

    if (scheduleMode === 'golden') {
      const preset = GOLDEN_PRESETS[goldenPreset] || GOLDEN_PRESETS['3_per_day']
      const goldenSlots = preset.slots
      let currentDay = new Date(startDateStr)
      let slotIndex = 0

      for (let i = 0; i < updated.length; i++) {
        const gSlot = goldenSlots[slotIndex]
        const [hh, mm] = gSlot.time.split(':').map(Number)
        const d = new Date(currentDay)
        d.setHours(hh, mm, 0, 0)

        updated[i] = {
          ...updated[i],
          privacy_status: 'scheduled',
          publish_at: d.toISOString(),
        }

        slotIndex++
        if (slotIndex >= goldenSlots.length) {
          slotIndex = 0
          currentDay.setDate(currentDay.getDate() + 1)
        }
      }
    } else {
      // Interval mode
      let startTime = new Date(customStartDateTime).getTime()
      for (let i = 0; i < updated.length; i++) {
        const d = new Date(startTime + i * customInterval * 60 * 1000)
        updated[i] = {
          ...updated[i],
          privacy_status: 'scheduled',
          publish_at: d.toISOString(),
        }
      }
    }

    setSlots(updated)
    showToast('Đã tự động tính toán và phân bổ thời gian cho tất cả video!')
  }

  // Bulk Apply Metadata
  function applyBulkMetadata() {
    if (slots.length === 0) return

    setSlots(prev =>
      prev.map((slot, idx) => {
        let newTitle = slot.title
        if (bulkPrefix) newTitle = `${bulkPrefix} ${newTitle}`
        if (bulkSuffix) newTitle = `${newTitle} ${bulkSuffix}`

        let newDesc = slot.description
        if (bulkDescription) {
          newDesc = bulkDescription
        }

        let newTags = slot.tags
        if (bulkTags) {
          newTags = newTags ? `${newTags}, ${bulkTags}` : bulkTags
        }

        return {
          ...slot,
          title: newTitle,
          description: newDesc,
          tags: newTags,
          category_id: bulkCategory || slot.category_id,
          privacy_status: bulkPrivacy || slot.privacy_status,
        }
      })
    )
    showToast('Đã áp dụng cài đặt hàng loạt thành công!')
  }

  // Quick append hashtag to bulk tags
  function addQuickHashtag(tag: string) {
    if (!bulkTags.includes(tag)) {
      setBulkTags(prev => (prev ? `${prev}, ${tag}` : tag))
    }
  }

  // Delete slot from queue
  function removeSlot(id: string) {
    setSlots(prev => prev.filter(s => s.id !== id))
  }

  // Single publish trigger
  async function handlePublishSingle(slot: YouTubeScheduleSlot) {
    try {
      const targetSlot = { ...slot }
      if (targetSlot.source_type === 'local' && !targetSlot.file_path && targetSlot.file) {
        showToast(`Đang nạp file "${targetSlot.file_name}" lên hệ thống...`, 'success')
        const uploaded = await api.uploadLocalVideoFile(targetSlot.file)
        targetSlot.file_path = uploaded.file_path
      }
      showToast(`Đang tải video "${targetSlot.title}" lên YouTube...`, 'success')
      await api.publishSingleVideo(targetSlot)
      showToast(`Video "${targetSlot.title}" đã được đăng / lên lịch thành công!`, 'success')
      removeSlot(slot.id)
    } catch (err: any) {
      showToast(err.message || 'Đăng video thất bại', 'error')
    }
  }

  // Bulk Schedule Execution
  async function handleExecuteBulkSchedule() {
    if (slots.length === 0) return
    if (!ytStatus?.connected) {
      showToast('Vui lòng kết nối tài khoản YouTube trong Cài đặt trước khi đăng video.', 'error')
      return
    }

    setSubmitting(true)
    setProgressPercent(0)
    setProgressMsg(`Bắt đầu xử lý ${slots.length} video...`)

    try {
      const preparedSlots: YouTubeScheduleSlot[] = []
      for (let i = 0; i < slots.length; i++) {
        const slot = { ...slots[i] }
        if (slot.source_type === 'local' && !slot.file_path && slot.file) {
          setProgressMsg(`Đang tải file ${i + 1}/${slots.length} (${slot.file_name}) lên hệ thống...`)
          const uploaded = await api.uploadLocalVideoFile(slot.file)
          slot.file_path = uploaded.file_path
        }
        preparedSlots.push(slot)
      }

      setProgressMsg(`Đang đăng tải và lên lịch ${preparedSlots.length} video lên YouTube...`)
      const res = await api.bulkScheduleVideos(preparedSlots)
      if (res.failed === 0) {
        showToast(`🎉 Toàn bộ ${res.succeeded} video đã được đăng / lên lịch thành công!`, 'success')
        setSlots([])
      } else {
        showToast(
          `Hoàn tất: ${res.succeeded} thành công, ${res.failed} thất bại. Xem chi tiết trong Lịch sử tác vụ.`,
          res.succeeded > 0 ? 'success' : 'error'
        )
      }
    } catch (err: any) {
      showToast(err.message || 'Lỗi xử lý lên lịch hàng loạt', 'error')
    } finally {
      setSubmitting(false)
      setProgressMsg('')
    }
  }

  // Filtered Tasks
  const filteredTasks = useMemo(() => {
    return tasks.filter(t => {
      if (taskFilter !== 'all' && t.status !== taskFilter) return false
      if (taskSearch.trim()) {
        const q = taskSearch.toLowerCase()
        return (
          t.title?.toLowerCase().includes(q) ||
          t.file_name?.toLowerCase().includes(q) ||
          t.video_id?.toLowerCase().includes(q)
        )
      }
      return true
    })
  }, [tasks, taskFilter, taskSearch])

  async function handleDeleteTask(taskId: string) {
    if (!window.confirm('Bạn có muốn xóa bản ghi tác vụ này khỏi lịch sử?')) return
    await api.deleteYouTubeTask(taskId)
    setTasks(prev => prev.filter(t => t.task_id !== taskId))
    showToast('Đã xóa bản ghi tác vụ.')
  }

  return (
    <div style={{ padding: '0 0 40px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      {/* Toast Notification */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            right: 24,
            zIndex: 9999,
            background: toastMsg.type === 'success' ? '#0f172a' : '#991b1b',
            color: '#fff',
            padding: '12px 18px',
            borderRadius: 10,
            boxShadow: '0 10px 25px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {toastMsg.type === 'success' ? <CheckCircle2 size={16} color="#4ade80" /> : <AlertCircle size={16} color="#fca5a5" />}
          <span>{toastMsg.text}</span>
          <button
            type="button"
            onClick={() => setToastMsg(null)}
            style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', marginLeft: 8 }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* Top Header Card */}
      <div className="card" style={{ padding: '16px 20px', background: '#fff', borderRadius: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <div
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                background: '#fef2f2',
                color: '#dc2626',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              <YouTubeBrandIcon size={26} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800, color: '#0f172a' }}>
                  Lên lịch &amp; Đăng Video YouTube
                </h2>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 999,
                    background: ytStatus?.connected ? '#dcfce7' : '#fee2e2',
                    color: ytStatus?.connected ? '#15803d' : '#b91c1c',
                  }}
                >
                  {ytStatus?.connected ? '● Kênh Đã Kết Nối' : '○ Chưa Kết Nối'}
                </span>
              </div>
              <p style={{ margin: '2px 0 0', fontSize: 12, color: '#64748b' }}>
                {ytStatus?.connected
                  ? `Kênh: ${ytStatus.channel_title} (${ytStatus.subscriber_count.toLocaleString()} subs, ${ytStatus.video_count.toLocaleString()} videos)`
                  : 'Vui lòng kết nối tài khoản Google trong Cài đặt để bắt đầu lên lịch đăng video.'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            {ytStatus?.connected ? (
              <>
                {ytStatus.channel_id && (
                  <a
                    href={`https://www.youtube.com/channel/${ytStatus.channel_id}`}
                    target="_blank"
                    rel="noreferrer"
                    className="btn-cancel"
                    style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                  >
                    <ExternalLink size={12} /> Xem Kênh YouTube
                  </a>
                )}
                <a
                  href="https://studio.youtube.com"
                  target="_blank"
                  rel="noreferrer"
                  className="btn-cancel"
                  style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                >
                  <Tv size={12} /> YouTube Studio
                </a>
              </>
            ) : (
              setActivePage && (
                <button
                  type="button"
                  className="btn-p"
                  onClick={() => setActivePage('Cài đặt')}
                  style={{ background: '#dc2626', color: '#fff', fontSize: 12 }}
                >
                  Mở Cài đặt YouTube
                </button>
              )
            )}
          </div>
        </div>

        {/* Tab Navigation */}
        <div style={{ display: 'flex', gap: 10, marginTop: 16, borderTop: '1px solid #f1f5f9', paddingTop: 14 }}>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'bulk' ? 'active' : ''}`}
            onClick={() => setActiveTab('bulk')}
            style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12.5 }}
          >
            <CalendarClock size={15} />
            <span>Lên lịch đăng video ({slots.length})</span>
          </button>
          <button
            type="button"
            className={`settings-tab-btn ${activeTab === 'history' ? 'active' : ''}`}
            onClick={() => setActiveTab('history')}
            style={{ padding: '6px 14px', borderRadius: 8, fontSize: 12.5 }}
          >
            <Clock size={15} />
            <span>Lịch sử tác vụ ({tasks.length})</span>
          </button>
        </div>
      </div>

      {/* Tab 1: Bulk Scheduler */}
      {activeTab === 'bulk' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Step 1: Select Video Source */}
          <div className="card" style={{ padding: 18, background: '#fff', borderRadius: 14 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: '#0f172a',
                    color: '#fff',
                    fontSize: 12,
                    fontWeight: 800,
                    display: 'grid',
                    placeItems: 'center',
                  }}
                >
                  1
                </span>
                <strong style={{ fontSize: 14, color: '#0f172a' }}>Chọn nguồn Video cần đăng tải</strong>
              </div>

              {/* Source Switcher */}
              <div style={{ display: 'flex', gap: 6, background: '#f1f5f9', padding: 3, borderRadius: 8 }}>
                <button
                  type="button"
                  onClick={() => setSourceMode('gdrive')}
                  style={{
                    border: 'none',
                    background: sourceMode === 'gdrive' ? '#fff' : 'transparent',
                    color: sourceMode === 'gdrive' ? '#0f172a' : '#64748b',
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    boxShadow: sourceMode === 'gdrive' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  }}
                >
                  <HardDrive size={13} /> Google Drive
                </button>
                <button
                  type="button"
                  onClick={() => setSourceMode('local')}
                  style={{
                    border: 'none',
                    background: sourceMode === 'local' ? '#fff' : 'transparent',
                    color: sourceMode === 'local' ? '#0f172a' : '#64748b',
                    padding: '4px 10px',
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                    boxShadow: sourceMode === 'local' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
                  }}
                >
                  <FileVideo size={13} /> File trên Máy tính
                </button>
              </div>
            </div>

            {/* Source Content: Google Drive */}
            {sourceMode === 'gdrive' ? (
              <div>
                {!driveStatus?.connected ? (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px dashed #cbd5e1',
                      borderRadius: 10,
                      padding: 20,
                      textAlign: 'center',
                    }}
                  >
                    <HardDrive size={30} color="#94a3b8" style={{ margin: '0 auto 8px' }} />
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#334155' }}>
                      Chưa kết nối Google Drive
                    </div>
                    <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 12px' }}>
                      Hãy vào phần Cài đặt $\rightarrow$ Google Drive để kết nối và duyệt video từ cloud.
                    </p>
                    {setActivePage && (
                      <button
                        type="button"
                        className="btn-p"
                        onClick={() => setActivePage('Cài đặt')}
                        style={{ fontSize: 12 }}
                      >
                        Mở Cài đặt Google Drive
                      </button>
                    )}
                  </div>
                ) : (
                  <div>
                    {/* Folder & Search Row */}
                    <div style={{ display: 'flex', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
                      <select
                        value={selectedFolderId}
                        onChange={e => setSelectedFolderId(e.target.value)}
                        style={{
                          height: 36,
                          borderRadius: 8,
                          border: '1px solid #cbd5e1',
                          padding: '0 10px',
                          fontSize: 12.5,
                          fontWeight: 600,
                          minWidth: 200,
                        }}
                      >
                        <option value="">📁 Thư mục mặc định ({driveStatus.folder_name || 'AI_Clean_Videos'})</option>
                        {driveFolders.map(f => (
                          <option key={f.id} value={f.id}>
                            📁 {f.name}
                          </option>
                        ))}
                      </select>

                      <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                        <input
                          value={searchDrive}
                          onChange={e => setSearchDrive(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && loadDriveData(selectedFolderId)}
                          placeholder="Tìm kiếm video trong Drive..."
                          style={{ width: '100%', height: 36, fontSize: 12.5, paddingLeft: 30 }}
                        />
                        <Search size={14} style={{ position: 'absolute', left: 9, top: 11, color: '#94a3b8' }} />
                      </div>

                      <button
                        type="button"
                        className="btn-cancel"
                        onClick={() => loadDriveData(selectedFolderId)}
                        disabled={loadingDrive}
                        style={{ height: 36, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
                      >
                        <RefreshCw size={13} className={loadingDrive ? 'spin' : ''} /> Làm mới
                      </button>
                    </div>

                    {/* Videos Table */}
                    {loadingDrive ? (
                      <div style={{ padding: 40, textAlign: 'center', color: '#64748b' }}>
                        <Loader2 size={24} className="spin" style={{ margin: '0 auto 8px' }} />
                        <div style={{ fontSize: 12 }}>Đang tải danh sách video từ Google Drive...</div>
                      </div>
                    ) : driveVideos.length === 0 ? (
                      <div style={{ padding: 30, textAlign: 'center', color: '#94a3b8', fontSize: 12 }}>
                        Không có file video nào trong thư mục này.
                      </div>
                    ) : (
                      <div
                        style={{
                          maxHeight: 280,
                          overflowY: 'auto',
                          border: '1px solid #e2e8f0',
                          borderRadius: 10,
                        }}
                      >
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                          <thead>
                            <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                              <th style={{ padding: '8px 10px', textAlign: 'left', width: 34 }}>
                                <input
                                  type="checkbox"
                                  checked={selectedDriveVideoIds.length > 0 && selectedDriveVideoIds.length === driveVideos.length}
                                  onChange={handleSelectAllDrive}
                                  style={{ cursor: 'pointer' }}
                                />
                              </th>
                              <th style={{ padding: '8px 10px', textAlign: 'left' }}>Tên Video</th>
                              <th style={{ padding: '8px 10px', textAlign: 'center', width: 90 }}>Thời lượng</th>
                              <th style={{ padding: '8px 10px', textAlign: 'center', width: 90 }}>Dung lượng</th>
                              <th style={{ padding: '8px 10px', textAlign: 'center', width: 110 }}>Ngày tạo</th>
                            </tr>
                          </thead>
                          <tbody>
                            {driveVideos.map(v => {
                              const isSelected = selectedDriveVideoIds.includes(v.id)
                              return (
                                <tr
                                  key={v.id}
                                  onClick={() => toggleSelectDriveVideo(v.id)}
                                  style={{
                                    borderBottom: '1px solid #f1f5f9',
                                    background: isSelected ? '#eff6ff' : 'transparent',
                                    cursor: 'pointer',
                                  }}
                                >
                                  <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                                    <input
                                      type="checkbox"
                                      checked={isSelected}
                                      onChange={() => toggleSelectDriveVideo(v.id)}
                                      style={{ cursor: 'pointer' }}
                                    />
                                  </td>
                                  <td style={{ padding: '8px 10px', fontWeight: 600, color: '#1e293b' }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                      {v.thumbnail_link ? (
                                        <img
                                          src={v.thumbnail_link}
                                          alt=""
                                          style={{ width: 42, height: 26, objectFit: 'cover', borderRadius: 4 }}
                                        />
                                      ) : (
                                        <FileVideo size={16} color="#64748b" />
                                      )}
                                      <span style={{ wordBreak: 'break-all' }}>{v.name}</span>
                                    </div>
                                  </td>
                                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#64748b' }}>
                                    {formatDuration(v.duration_seconds)}
                                  </td>
                                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#64748b' }}>
                                    {formatBytes(v.size_bytes)}
                                  </td>
                                  <td style={{ padding: '8px 10px', textAlign: 'center', color: '#64748b' }}>
                                    {formatDriveDate(v.created_time)}
                                  </td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Add to Queue Button */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 12 }}>
                      <span style={{ fontSize: 12, color: '#64748b' }}>
                        Đã chọn <strong>{selectedDriveVideoIds.length}</strong> / {driveVideos.length} video
                      </span>
                      <button
                        type="button"
                        className="btn-p"
                        onClick={handleAddDriveVideosToQueue}
                        disabled={selectedDriveVideoIds.length === 0}
                        style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}
                      >
                        <Plus size={14} /> Thêm {selectedDriveVideoIds.length} video vào hàng chờ
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              /* Local Files Picker */
              <div
                style={{
                  border: '2px dashed #cbd5e1',
                  borderRadius: 12,
                  padding: '30px 20px',
                  textAlign: 'center',
                  background: '#f8fafc',
                }}
              >
                <FileVideo size={36} color="#dc2626" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: 13.5, fontWeight: 700, color: '#0f172a' }}>
                  Chọn file video từ máy tính của bạn
                </div>
                <p style={{ fontSize: 12, color: '#64748b', margin: '4px 0 16px' }}>
                  Hỗ trợ định dạng MP4, MOV, MKV, WebM...
                </p>
                <label
                  className="btn-p"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    cursor: 'pointer',
                    fontSize: 12.5,
                    background: '#dc2626',
                  }}
                >
                  <Plus size={14} /> Duyệt file từ máy tính
                  <input
                    type="file"
                    multiple
                    accept="video/*"
                    onChange={handleAddLocalFiles}
                    style={{ display: 'none' }}
                  />
                </label>
              </div>
            )}
          </div>

          {/* Step 2: Queue & Batch Settings */}
          {slots.length > 0 && (
            <>
              {/* Batch Configuration Tools */}
              <div className="card" style={{ padding: 18, background: '#fff', borderRadius: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
                  <span
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: 999,
                      background: '#0f172a',
                      color: '#fff',
                      fontSize: 12,
                      fontWeight: 800,
                      display: 'grid',
                      placeItems: 'center',
                    }}
                  >
                    2
                  </span>
                  <strong style={{ fontSize: 14, color: '#0f172a' }}>
                    Cấu hình Lên lịch &amp; Metadata Hàng loạt
                  </strong>
                </div>

                {/* Scheduling Mode Selection */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1.2fr 1fr',
                    gap: 16,
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 12,
                    padding: 14,
                    marginBottom: 16,
                  }}
                >
                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 8 }}>
                      Chiến lược hẹn giờ đăng:
                    </label>
                    <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
                      <label style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="schedMode"
                          checked={scheduleMode === 'golden'}
                          onChange={() => setScheduleMode('golden')}
                        />
                        <span>Khung giờ vàng (Golden Hours)</span>
                      </label>
                      <label style={{ fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}>
                        <input
                          type="radio"
                          name="schedMode"
                          checked={scheduleMode === 'interval'}
                          onChange={() => setScheduleMode('interval')}
                        />
                        <span>Khoảng cách đều (Interval)</span>
                      </label>
                    </div>

                    {scheduleMode === 'golden' ? (
                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        {Object.entries(GOLDEN_PRESETS).map(([k, v]) => (
                          <button
                            key={k}
                            type="button"
                            onClick={() => setGoldenPreset(k)}
                            style={{
                              border: goldenPreset === k ? '1.5px solid #dc2626' : '1px solid #cbd5e1',
                              background: goldenPreset === k ? '#fef2f2' : '#fff',
                              color: goldenPreset === k ? '#dc2626' : '#334155',
                              padding: '6px 12px',
                              borderRadius: 8,
                              fontSize: 12,
                              fontWeight: 700,
                              cursor: 'pointer',
                              textAlign: 'left',
                            }}
                          >
                            <div>{v.label}</div>
                            <div style={{ fontSize: 10.5, fontWeight: 500, color: '#64748b' }}>{v.desc}</div>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        {INTERVAL_PRESETS.map(p => (
                          <button
                            key={p.value}
                            type="button"
                            onClick={() => setCustomInterval(p.value)}
                            style={{
                              border: customInterval === p.value ? '1.5px solid #dc2626' : '1px solid #cbd5e1',
                              background: customInterval === p.value ? '#fef2f2' : '#fff',
                              color: customInterval === p.value ? '#dc2626' : '#334155',
                              padding: '4px 10px',
                              borderRadius: 6,
                              fontSize: 12,
                              fontWeight: 600,
                              cursor: 'pointer',
                            }}
                          >
                            {p.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  <div>
                    <label style={{ fontSize: 12, fontWeight: 700, color: '#334155', display: 'block', marginBottom: 8 }}>
                      Bắt đầu từ ngày / giờ:
                    </label>
                    {scheduleMode === 'golden' ? (
                      <div>
                        <input
                          type="date"
                          value={startDateStr}
                          onChange={e => setStartDateStr(e.target.value)}
                          style={{ width: '100%', height: 38, fontSize: 12.5, borderRadius: 8, border: '1px solid #cbd5e1', padding: '0 8px' }}
                        />
                      </div>
                    ) : (
                      <div>
                        <input
                          type="datetime-local"
                          value={customStartDateTime}
                          onChange={e => setCustomStartDateTime(e.target.value)}
                          style={{ width: '100%', height: 38, fontSize: 12.5, borderRadius: 8, border: '1px solid #cbd5e1', padding: '0 8px' }}
                        />
                      </div>
                    )}

                    <button
                      type="button"
                      className="btn-p"
                      onClick={applyScheduleTimings}
                      style={{ marginTop: 10, width: '100%', height: 34, fontSize: 12, background: '#0f172a' }}
                    >
                      <Sparkles size={13} /> Phân bổ thời gian cho {slots.length} video
                    </button>
                  </div>
                </div>

                {/* Bulk Metadata Form */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12, marginBottom: 12 }}>
                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
                      Thêm Tiền tố Tiêu đề (Prefix)
                    </label>
                    <input
                      value={bulkPrefix}
                      onChange={e => setBulkPrefix(e.target.value)}
                      placeholder="vd: [Review Phim]"
                      style={{ width: '100%', height: 36, fontSize: 12 }}
                    />
                  </div>

                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
                      Chế độ riêng tư mặc định
                    </label>
                    <select
                      value={bulkPrivacy}
                      onChange={e => setBulkPrivacy(e.target.value as any)}
                      style={{ width: '100%', height: 36, fontSize: 12, borderRadius: 8, border: '1px solid #cbd5e1', padding: '0 8px' }}
                    >
                      <option value="public">🌐 Công khai (Public)</option>
                      <option value="unlisted">🔗 Không công khai (Unlisted)</option>
                      <option value="private">🔒 Riêng tư (Private)</option>
                      <option value="scheduled">⏰ Hẹn giờ (Scheduled)</option>
                    </select>
                  </div>

                  <div>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569', display: 'block', marginBottom: 4 }}>
                      Danh mục Video
                    </label>
                    <select
                      value={bulkCategory}
                      onChange={e => setBulkCategory(e.target.value)}
                      style={{ width: '100%', height: 36, fontSize: 12, borderRadius: 8, border: '1px solid #cbd5e1', padding: '0 8px' }}
                    >
                      {categories.map(c => (
                        <option key={c.id} value={c.id}>
                          {c.title}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Bulk Tags & Quick Hashtags */}
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <label style={{ fontSize: 11.5, fontWeight: 700, color: '#475569' }}>
                      Tags &amp; Hashtags (phân cách bằng dấu phẩy)
                    </label>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      {QUICK_HASHTAGS.map(tag => (
                        <button
                          key={tag}
                          type="button"
                          onClick={() => addQuickHashtag(tag)}
                          style={{
                            border: '1px solid #e2e8f0',
                            background: '#f8fafc',
                            color: '#0284c7',
                            padding: '1px 6px',
                            borderRadius: 4,
                            fontSize: 10.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                          }}
                        >
                          +{tag}
                        </button>
                      ))}
                    </div>
                  </div>
                  <input
                    value={bulkTags}
                    onChange={e => setBulkTags(e.target.value)}
                    placeholder="recap, review, review phim, shorts..."
                    style={{ width: '100%', height: 36, fontSize: 12 }}
                  />
                </div>

                <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
                  <button
                    type="button"
                    className="btn-p"
                    onClick={applyBulkMetadata}
                    style={{ fontSize: 12, background: '#475569' }}
                  >
                    Áp dụng Tiêu đề &amp; Tags cho toàn bộ hàng chờ
                  </button>
                </div>
              </div>

              {/* Step 3: Slots Review List */}
              <div className="card" style={{ padding: 18, background: '#fff', borderRadius: 14 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span
                      style={{
                        width: 24,
                        height: 24,
                        borderRadius: 999,
                        background: '#dc2626',
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 800,
                        display: 'grid',
                        placeItems: 'center',
                      }}
                    >
                      3
                    </span>
                    <strong style={{ fontSize: 14, color: '#0f172a' }}>
                      Danh sách {slots.length} video chuẩn bị đăng
                    </strong>
                  </div>

                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setSlots([])}
                    style={{ fontSize: 11.5, color: '#dc2626', borderColor: '#fca5a5' }}
                  >
                    Xóa tất cả
                  </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {slots.map((slot, index) => (
                    <div
                      key={slot.id}
                      style={{
                        border: '1px solid #e2e8f0',
                        borderRadius: 10,
                        padding: 12,
                        background: '#f8fafc',
                        display: 'flex',
                        gap: 14,
                        alignItems: 'flex-start',
                      }}
                    >
                      <div
                        style={{
                          width: 22,
                          height: 22,
                          borderRadius: 999,
                          background: '#e2e8f0',
                          color: '#475569',
                          fontSize: 11,
                          fontWeight: 800,
                          display: 'grid',
                          placeItems: 'center',
                          flexShrink: 0,
                          marginTop: 4,
                        }}
                      >
                        {index + 1}
                      </div>

                      {/* Thumbnail */}
                      <div style={{ width: 90, height: 56, flexShrink: 0, borderRadius: 6, overflow: 'hidden', background: '#0f172a' }}>
                        {slot.thumbnail_url ? (
                          <img src={slot.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>
                            <FileVideo size={20} />
                          </div>
                        )}
                      </div>

                      {/* Slot Inputs */}
                      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 8 }}>
                          <input
                            value={slot.title}
                            onChange={e => {
                              const val = e.target.value
                              setSlots(prev => prev.map(s => (s.id === slot.id ? { ...s, title: val } : s)))
                            }}
                            placeholder="Tiêu đề video YouTube..."
                            style={{ flex: 1, height: 34, fontSize: 12.5, fontWeight: 600 }}
                          />

                          <select
                            value={slot.privacy_status}
                            onChange={e => {
                              const val = e.target.value as any
                              setSlots(prev => prev.map(s => (s.id === slot.id ? { ...s, privacy_status: val } : s)))
                            }}
                            style={{ width: 140, height: 34, fontSize: 12, borderRadius: 8, border: '1px solid #cbd5e1', padding: '0 6px' }}
                          >
                            <option value="public">🌐 Công khai</option>
                            <option value="unlisted">🔗 Không công khai</option>
                            <option value="private">🔒 Riêng tư</option>
                            <option value="scheduled">⏰ Hẹn giờ</option>
                          </select>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1.2fr 1fr', gap: 8 }}>
                          <input
                            value={slot.tags}
                            onChange={e => {
                              const val = e.target.value
                              setSlots(prev => prev.map(s => (s.id === slot.id ? { ...s, tags: val } : s)))
                            }}
                            placeholder="Tags phân cách dấu phẩy..."
                            style={{ height: 32, fontSize: 11.5 }}
                          />

                          <input
                            type="datetime-local"
                            value={slot.publish_at ? toLocalDatetimeInput(new Date(slot.publish_at).getTime()) : ''}
                            onChange={e => {
                              const iso = e.target.value ? new Date(e.target.value).toISOString() : undefined
                              setSlots(prev =>
                                prev.map(s =>
                                  s.id === slot.id ? { ...s, publish_at: iso, privacy_status: 'scheduled' } : s
                                )
                              )
                            }}
                            style={{ height: 32, fontSize: 11.5, borderRadius: 6, border: '1px solid #cbd5e1', padding: '0 6px' }}
                          />
                        </div>
                      </div>

                      {/* Actions */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        <button
                          type="button"
                          className="btn-p"
                          onClick={() => handlePublishSingle(slot)}
                          title="Đăng tải ngay video này lên YouTube"
                          style={{ height: 32, padding: '0 10px', fontSize: 11.5, background: '#dc2626' }}
                        >
                          <Send size={12} /> Đăng ngay
                        </button>
                        <button
                          type="button"
                          className="btn-cancel"
                          onClick={() => removeSlot(slot.id)}
                          title="Xóa video khỏi danh sách"
                          style={{ height: 32, padding: '0 8px', color: '#dc2626' }}
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Final Big Action Button */}
                <div
                  style={{
                    marginTop: 20,
                    paddingTop: 16,
                    borderTop: '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                      Sẵn sàng đăng tải <strong>{slots.length} video</strong> lên kênh YouTube
                    </div>
                    <div style={{ fontSize: 11.5, color: '#64748b' }}>
                      Các video sẽ được tải lên và lên lịch tuần tự theo đúng cấu hình thời gian đã chọn.
                    </div>
                  </div>

                  <button
                    type="button"
                    className="btn-p"
                    onClick={handleExecuteBulkSchedule}
                    disabled={submitting}
                    style={{
                      height: 44,
                      padding: '0 24px',
                      fontSize: 13.5,
                      fontWeight: 800,
                      background: '#dc2626',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    {submitting ? (
                      <>
                        <Loader2 size={16} className="spin" /> Đang xử lý đăng tải...
                      </>
                    ) : (
                      <>
                        <Send size={16} /> Tiến hành Đăng / Lên lịch {slots.length} Video
                      </>
                    )}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
      )}

      {/* Tab 2: History View */}
      {activeTab === 'history' && (
        <div className="card" style={{ padding: 20, background: '#fff', borderRadius: 14 }}>
          {/* Filters & Search */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16, flexWrap: 'wrap', gap: 10 }}>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['all', 'published', 'scheduled', 'failed'] as const).map(f => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setTaskFilter(f)}
                  style={{
                    border: 'none',
                    background: taskFilter === f ? '#0f172a' : '#f1f5f9',
                    color: taskFilter === f ? '#fff' : '#475569',
                    padding: '6px 14px',
                    borderRadius: 8,
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  {f === 'all'
                    ? `Tất cả (${tasks.length})`
                    : f === 'published'
                    ? 'Đã đăng'
                    : f === 'scheduled'
                    ? 'Đã hẹn giờ'
                    : 'Thất bại'}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <div style={{ position: 'relative', width: 220 }}>
                <input
                  value={taskSearch}
                  onChange={e => setTaskSearch(e.target.value)}
                  placeholder="Tìm kiếm tác vụ..."
                  style={{ width: '100%', height: 34, fontSize: 12, paddingLeft: 28 }}
                />
                <Search size={13} style={{ position: 'absolute', left: 8, top: 10, color: '#94a3b8' }} />
              </div>

              <button
                type="button"
                className="btn-cancel"
                onClick={loadTasks}
                disabled={loadingTasks}
                style={{ height: 34, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12 }}
              >
                <RefreshCw size={13} className={loadingTasks ? 'spin' : ''} />
              </button>
            </div>
          </div>

          {/* Tasks Table */}
          {loadingTasks ? (
            <div style={{ padding: 50, textAlign: 'center', color: '#64748b' }}>
              <Loader2 size={24} className="spin" style={{ margin: '0 auto 8px' }} />
              <div style={{ fontSize: 12 }}>Đang tải lịch sử tác vụ...</div>
            </div>
          ) : filteredTasks.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              Chưa có tác vụ nào trong danh sách.
            </div>
          ) : (
            <div style={{ border: '1px solid #e2e8f0', borderRadius: 10, overflow: 'hidden' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0', color: '#475569' }}>
                    <th style={{ padding: '10px 12px', textAlign: 'left' }}>Video / Tiêu đề</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', width: 110 }}>Trạng thái</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', width: 130 }}>Thời gian đăng/hẹn</th>
                    <th style={{ padding: '10px 12px', textAlign: 'center', width: 140 }}>Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredTasks.map(t => (
                    <tr key={t.task_id} style={{ borderBottom: '1px solid #f1f5f9' }}>
                      <td style={{ padding: '10px 12px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                          {t.thumbnail_url ? (
                            <img
                              src={t.thumbnail_url}
                              alt=""
                              style={{ width: 50, height: 32, objectFit: 'cover', borderRadius: 4 }}
                            />
                          ) : (
                            <div style={{ width: 50, height: 32, background: '#f1f5f9', borderRadius: 4, display: 'grid', placeItems: 'center' }}>
                              <FileVideo size={16} color="#64748b" />
                            </div>
                          )}
                          <div>
                            <div style={{ fontWeight: 700, color: '#0f172a' }}>{t.title}</div>
                            <div style={{ fontSize: 11, color: '#64748b' }}>{t.file_name}</div>
                            {t.error_message && (
                              <div style={{ fontSize: 11, color: '#dc2626', marginTop: 2 }}>{t.error_message}</div>
                            )}
                          </div>
                        </div>
                      </td>

                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '3px 8px',
                            borderRadius: 999,
                            fontSize: 10.5,
                            fontWeight: 700,
                            background:
                              t.status === 'published' || t.status === 'public'
                                ? '#dcfce7'
                                : t.status === 'scheduled'
                                ? '#e0e7ff'
                                : '#fee2e2',
                            color:
                              t.status === 'published' || t.status === 'public'
                                ? '#15803d'
                                : t.status === 'scheduled'
                                ? '#4338ca'
                                : '#b91c1c',
                          }}
                        >
                          {t.status === 'published' || t.status === 'public' ? (
                            <>
                              <CheckCircle2 size={11} /> Đã xuất bản
                            </>
                          ) : t.status === 'scheduled' ? (
                            <>
                              <Clock size={11} /> Đã lên lịch
                            </>
                          ) : (
                            <>
                              <XCircle size={11} /> Thất bại
                            </>
                          )}
                        </span>
                      </td>

                      <td style={{ padding: '10px 12px', textAlign: 'center', color: '#64748b' }}>
                        {t.publish_at ? formatDriveDate(t.publish_at) : formatDriveDate(t.created_at)}
                      </td>

                      <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                          {t.youtube_url && (
                            <>
                              <a
                                href={t.youtube_url}
                                target="_blank"
                                rel="noreferrer"
                                className="btn-cancel"
                                title="Mở xem trên YouTube"
                                style={{ textDecoration: 'none', padding: '4px 8px', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                              >
                                <ExternalLink size={12} /> Xem
                              </a>
                              <button
                                type="button"
                                className="btn-cancel"
                                title="Sao chép link video YouTube"
                                onClick={() => {
                                  navigator.clipboard.writeText(t.youtube_url || '')
                                  showToast('Đã sao chép link YouTube!')
                                }}
                                style={{ padding: '4px 8px' }}
                              >
                                <Copy size={12} />
                              </button>
                            </>
                          )}

                          <button
                            type="button"
                            className="btn-cancel"
                            title="Xóa bản ghi khỏi lịch sử"
                            onClick={() => handleDeleteTask(t.task_id)}
                            style={{ padding: '4px 8px', color: '#dc2626' }}
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
