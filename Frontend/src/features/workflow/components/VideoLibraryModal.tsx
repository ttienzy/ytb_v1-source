import React, { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import {
  Film,
  X,
  Download,
  ChevronDown,
  Volume2,
  VolumeX,
  FolderOpen,
  Trash2,
  Play,
  RotateCcw,
  Clock,
  HardDrive,
  Copy,
  Check,
  Search,
  Sparkles,
  Layers,
  ImageDown,
  Loader2,
  Ratio,
  Monitor,
  Video,
  Mic,
  Music,
  Columns2,
  Pause,
  Upload,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { ExportedVideoItem } from '../contracts'
import {
  fetchExportedVideos,
  deleteExportedVideo,
  openExportFolder,
  callWorkflowVideoExport,
  callGenerateVoiceover,
  getExportCleanStatus,
  triggerExportClean,
  attachReferenceVideoToExport,
} from '../services/workflowApi'
import * as veoApi from '../../veo-studio/services/veoApi'
import { getWorkflowConfig } from '../services/workflowConfig'

interface VideoLibraryModalProps {
  isOpen: boolean
  onClose: () => void
  onVideoCountChange?: (count: number) => void
}

export function VideoLibraryModal({
  isOpen,
  onClose,
  onVideoCountChange,
}: VideoLibraryModalProps) {
  const [videos, setVideos] = useState<ExportedVideoItem[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [selectedIndex, setSelectedIndex] = useState<number>(0)
  const [searchTerm, setSearchTerm] = useState('')
  const [copied, setCopied] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'all' | 'export' | 'veo_scene' | 'motion_control'>('all')
  const [isExtractingFrame, setIsExtractingFrame] = useState(false)
  const [frameSaved, setFrameSaved] = useState(false)

  // Chế độ Đối chiếu video gốc cho Motion Control
  const [isComparing, setIsComparing] = useState(false)
  const [compareMode, setCompareMode] = useState<'side_by_side' | 'slider'>('side_by_side')
  const [sliderPercent, setSliderPercent] = useState(50)
  const sliderStageRef = useRef<HTMLDivElement | null>(null)
  const isDraggingSliderRef = useRef(false)
  const [localRefUrl, setLocalRefUrl] = useState<string | null>(null)
  const [selectedRefFile, setSelectedRefFile] = useState<File | null>(null)
  const [isSavingRef, setIsSavingRef] = useState(false)
  const [isSyncPlaying, setIsSyncPlaying] = useState(false)
  const [syncCurrentTime, setSyncCurrentTime] = useState(0)
  const [syncDuration, setSyncDuration] = useState(10)
  const [syncSpeed, setSyncSpeed] = useState(1)
  const [isMutedRef, setIsMutedRef] = useState(true)
  const [isMutedVeo, setIsMutedVeo] = useState(false)

  const mainVideoRef = useRef<HTMLVideoElement | null>(null)
  const refVideoRef = useRef<HTMLVideoElement | null>(null)

  useEffect(() => {
    if (mainVideoRef.current) {
      mainVideoRef.current.muted = isMutedVeo
    }
  }, [isMutedVeo])

  useEffect(() => {
    if (refVideoRef.current) {
      refVideoRef.current.muted = isMutedRef
    }
  }, [isMutedRef])
  const [isDownloadMenuOpen, setIsDownloadMenuOpen] = useState(false)
  const downloadMenuRef = useRef<HTMLDivElement>(null)

  interface CleanProgressState {
    filename: string
    mute: boolean
    processedFrames: number
    frameEstimate: number
    percent: number
    isDone: boolean
    error: string | null
  }
  const [cleaningState, setCleaningState] = useState<CleanProgressState | null>(null)
  const cleanPollRef = useRef<NodeJS.Timeout | null>(null)

  useEffect(() => {
    return () => {
      if (cleanPollRef.current) clearInterval(cleanPollRef.current)
    }
  }, [])

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (downloadMenuRef.current && !downloadMenuRef.current.contains(event.target as Node)) {
        setIsDownloadMenuOpen(false)
      }
    }
    if (isDownloadMenuOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isDownloadMenuOpen])

  useEffect(() => {
    setIsDownloadMenuOpen(false)
    setIsComparing(false)
    setCompareMode('side_by_side')
    setSliderPercent(50)
    setIsMutedRef(true)
    setIsMutedVeo(false)
    if (localRefUrl) {
      URL.revokeObjectURL(localRefUrl)
      setLocalRefUrl(null)
    }
    setSelectedRefFile(null)
    setIsSyncPlaying(false)
    setSyncCurrentTime(0)
  }, [selectedIndex])

  // Chế độ Ghép Nhanh (Remix Multi-clip)
  const [isRemixMode, setIsRemixMode] = useState(false)
  const [selectedRemixClips, setSelectedRemixClips] = useState<ExportedVideoItem[]>([])
  const [remixVoiceId, setRemixVoiceId] = useState<string>(getWorkflowConfig().defaultVoiceId)
  const [remixBgmTrackId, setRemixBgmTrackId] = useState<string>('none')
  const [availableBgm, setAvailableBgm] = useState<Array<{ track_id: string; name: string }>>([])
  const [isRemixing, setIsRemixing] = useState(false)

  // Tải danh sách BGM khi mở modal
  useEffect(() => {
    if (isOpen) {
      fetch(`${API_URL}/api/bgm`)
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          const rawTracks = Array.isArray(data) ? data : (data?.tracks || [])
          const tracks = rawTracks.map((t: any) => ({
            track_id: t.track_id || t.id,
            name: t.name || t.title || t.track_id,
          }))
          setAvailableBgm(tracks)
        })
        .catch((err) => console.warn('Lỗi tải danh sách BGM:', err))
    }
  }, [isOpen])

  const toggleRemixClip = (clip: ExportedVideoItem) => {
    setSelectedRemixClips((prev) => {
      const existing = prev.findIndex((c) => c.filename === clip.filename)
      if (existing >= 0) {
        return prev.filter((c) => c.filename !== clip.filename)
      } else {
        return [...prev, clip]
      }
    })
  }

  const totalRemixDuration = selectedRemixClips.reduce(
    (acc, c) => acc + (c.durationSec && c.durationSec > 0 ? c.durationSec : getWorkflowConfig().defaultClipDurationSeconds),
    0
  )

  const handleExecuteRemix = async () => {
    if (selectedRemixClips.length < 2) {
      alert('Vui lòng chọn ít nhất 2 clip Veo để ghép video!')
      return
    }

    const validPaths = selectedRemixClips.map((c) => c.filePath || c.videoUrl).filter(Boolean)
    if (validPaths.length < selectedRemixClips.length) {
      alert('Một số clip không có đường dẫn file hợp lệ.')
      return
    }

    setIsRemixing(true)
    try {
      let voiceoverAudioPath: string | undefined = undefined

      // Nếu chọn Brand Voice và có prompt trong các clip
      if (remixVoiceId && remixVoiceId !== 'none') {
        const textsToSpeak: string[] = []
        selectedRemixClips.forEach((c) => {
          if (c.prompt && c.prompt.trim()) {
            textsToSpeak.push(c.prompt.trim())
          }
        })

        if (textsToSpeak.length > 0) {
          try {
            const voRes = await callGenerateVoiceover({
              voiceId: remixVoiceId,
              scripts: textsToSpeak,
              combineAll: true,
            })
            voiceoverAudioPath = voRes.combinedFilePath || voRes.combinedAudioUrl || undefined
          } catch (voErr) {
            console.warn('Lỗi tạo giọng đọc cho remix, vẫn tiếp tục ghép video:', voErr)
          }
        }
      }

      const bgmTrackIds = remixBgmTrackId && remixBgmTrackId !== 'none' ? [remixBgmTrackId] : undefined

      const exportRes = await callWorkflowVideoExport(
        validPaths,
        undefined,
        undefined,
        voiceoverAudioPath,
        false, // Tắt âm thanh môi trường Veo để video trong trẻo
        bgmTrackIds,
        0.10,
        0.0
      )

      // Tải lại danh sách video
      await loadVideos()
      setFilterType('export') // Chuyển sang tab video hoàn chỉnh
      setIsRemixMode(false)
      setSelectedRemixClips([])
      setSelectedIndex(0)
      alert(`🎉 Ghép video Remix thành công! Video "${exportRes.outputFilename}" đã được tạo và lưu vào thư viện.`)
    } catch (err: any) {
      console.error('Lỗi khi ghép video Remix:', err)
      alert(`Lỗi ghép video: ${err.message || err}`)
    } finally {
      setIsRemixing(false)
    }
  }

  const loadVideos = async () => {
    setIsLoading(true)
    try {
      const list = await fetchExportedVideos()
      setVideos(list)
      onVideoCountChange?.(list.length)
      if (list.length > 0 && selectedIndex >= list.length) {
        setSelectedIndex(0)
      }
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadVideos()
    }
  }, [isOpen])

  // ESC to close
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const exportCount = videos.filter((v) => (v.sourceType || 'export') === 'export').length
  const motionCount = videos.filter((v) => v.isMotionControl).length
  const veoPromptCount = videos.filter((v) => v.sourceType === 'veo_scene' && !v.isMotionControl).length

  const filtered = videos.filter((v) => {
    if (filterType === 'export') {
      if ((v.sourceType || 'export') !== 'export') return false
    } else if (filterType === 'motion_control') {
      if (!v.isMotionControl) return false
    } else if (filterType === 'veo_scene') {
      if (v.sourceType !== 'veo_scene' || v.isMotionControl) return false
    }
    if (!searchTerm.trim()) return true
    const term = searchTerm.toLowerCase()
    return (
      v.filename.toLowerCase().includes(term) ||
      (v.title && v.title.toLowerCase().includes(term)) ||
      (v.prompt && v.prompt.toLowerCase().includes(term))
    )
  })

  const currentVideo = filtered[selectedIndex] || filtered[0]

  
  const formatSyncTime = (secs: number) => {
    const s = Math.floor(secs || 0)
    const m = Math.floor(s / 60)
    const rem = s % 60
    return `${m}:${rem < 10 ? '0' : ''}${rem}`
  }

  const toggleSyncPlay = () => {
    if (isSyncPlaying) {
      mainVideoRef.current?.pause()
      refVideoRef.current?.pause()
      setIsSyncPlaying(false)
    } else {
      mainVideoRef.current?.play()
      refVideoRef.current?.play()
      setIsSyncPlaying(true)
    }
  }

  const handleSyncScrub = (e: React.ChangeEvent<HTMLInputElement>) => {
    const targetSec = parseFloat(e.target.value)
    setSyncCurrentTime(targetSec)
    if (mainVideoRef.current) {
      mainVideoRef.current.currentTime = targetSec
    }
    if (refVideoRef.current) {
      const trimStart = currentVideo?.referenceTrimStart || 0
      refVideoRef.current.currentTime = trimStart + targetSec
    }
  }

  const changeSyncSpeed = (speed: number) => {
    setSyncSpeed(speed)
    if (mainVideoRef.current) mainVideoRef.current.playbackRate = speed
    if (refVideoRef.current) refVideoRef.current.playbackRate = speed
  }

  const switchCompareMode = (mode: 'side_by_side' | 'slider') => {
    setCompareMode(mode)
    setTimeout(() => {
      if (mainVideoRef.current) {
        mainVideoRef.current.currentTime = syncCurrentTime
        mainVideoRef.current.playbackRate = syncSpeed
        if (isSyncPlaying) mainVideoRef.current.play().catch(() => {})
      }
      if (refVideoRef.current) {
        const trimStart = currentVideo?.referenceTrimStart || 0
        refVideoRef.current.currentTime = trimStart + syncCurrentTime
        refVideoRef.current.playbackRate = syncSpeed
        if (isSyncPlaying) refVideoRef.current.play().catch(() => {})
      }
    }, 50)
  }

  const updateSliderPos = (clientX: number) => {
    if (!sliderStageRef.current) return
    const rect = sliderStageRef.current.getBoundingClientRect()
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width))
    const pct = Math.round((x / rect.width) * 100)
    setSliderPercent(pct)
  }

  const handleSliderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingSliderRef.current = true
    try {
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    } catch (_) {}
    updateSliderPos(e.clientX)
  }

  const handleSliderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingSliderRef.current || e.buttons > 0) {
      updateSliderPos(e.clientX)
    }
  }

  const handleSliderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    isDraggingSliderRef.current = false
    try {
      ;(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId)
    } catch (_) {}
  }

  const handleSyncTimeUpdate = () => {
    if (mainVideoRef.current) {
      const cur = mainVideoRef.current.currentTime
      setSyncCurrentTime(cur)
      if (mainVideoRef.current.duration) {
        setSyncDuration(mainVideoRef.current.duration)
      }
      if (refVideoRef.current) {
        const trimStart = currentVideo?.referenceTrimStart || 0
        const targetRefTime = trimStart + cur
        if (Math.abs(refVideoRef.current.currentTime - targetRefTime) > 0.25) {
          refVideoRef.current.currentTime = targetRefTime
        }
      }
    }
  }

  const handleSyncEnded = () => {
    setIsSyncPlaying(false)
    if (refVideoRef.current) refVideoRef.current.pause()
  }

  const handleLocalRefChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      if (localRefUrl) URL.revokeObjectURL(localRefUrl)
      const url = URL.createObjectURL(file)
      setLocalRefUrl(url)
      setSelectedRefFile(file)
    }
  }

  const handleSaveRefToBackend = async () => {
    if (!selectedRefFile || !currentVideo) return
    setIsSavingRef(true)
    try {
      const res = await attachReferenceVideoToExport(currentVideo.filename, selectedRefFile)
      if (res.ok && res.reference_video_url) {
        currentVideo.referenceVideoUrl = res.reference_video_url
        alert('Đã lưu liên kết video gốc thành công!')
      } else {
        alert('Không thể lưu liên kết video gốc.')
      }
    } finally {
      setIsSavingRef(false)
    }
  }

  const handleDelete = async (filename: string) => {
    if (!window.confirm(`Bạn có chắc chắn muốn xóa vĩnh viễn video "${filename}" khỏi ổ đĩa?`)) {
      return
    }
    setDeletingId(filename)
    try {
      const ok = await deleteExportedVideo(filename)
      if (ok) {
        await loadVideos()
      } else {
        alert('Không thể xóa video!')
      }
    } finally {
      setDeletingId(null)
    }
  }

  const handleOpenFolder = async (filename: string) => {
    const ok = await openExportFolder(filename)
    if (!ok) {
      alert('Không thể mở thư mục trên máy!')
    }
  }

  const handleCopyPath = (path: string) => {
    navigator.clipboard.writeText(path)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleCopyPrompt = (promptText: string) => {
    navigator.clipboard.writeText(promptText)
    setCopiedPrompt(true)
    setTimeout(() => setCopiedPrompt(false), 2000)
  }

  const handleDownload = async (
    video: ExportedVideoItem,
    mute: boolean = false,
    clean: boolean = false
  ) => {
    if (!clean) {
      const a = document.createElement('a')
      if (mute) {
        const separator = video.videoUrl.includes('?') ? '&' : '?'
        a.href = `${video.videoUrl}${separator}mute=true`
        a.download = `${video.filename.replace(/\.mp4$/i, '')}_no_audio.mp4`
      } else {
        a.href = video.videoUrl
        a.download = video.filename
      }
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      return
    }

    // Chế độ Xóa Watermark AI (clean = true)
    try {
      const status = await getExportCleanStatus(video.filename, mute)
      if (status.cached && status.downloadUrl) {
        const a = document.createElement('a')
        a.href = status.downloadUrl
        a.download = `${video.filename.replace(/\.mp4$/i, '')}_clean${mute ? '_no_audio' : ''}.mp4`
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        return
      }

      // Chưa có file clean trong cache -> Mở dialog tiến trình và kích hoạt background job
      setCleaningState({
        filename: video.filename,
        mute,
        processedFrames: 0,
        frameEstimate: 0,
        percent: 5,
        isDone: false,
        error: null,
      })

      await triggerExportClean(video.filename, mute)

      if (cleanPollRef.current) clearInterval(cleanPollRef.current)
      cleanPollRef.current = setInterval(async () => {
        try {
          const st = await getExportCleanStatus(video.filename, mute)
          if (st.status === 'done' || st.cached) {
            if (cleanPollRef.current) clearInterval(cleanPollRef.current)
            setCleaningState((prev) => (prev ? { ...prev, percent: 100, isDone: true } : null))

            const dlUrl = st.downloadUrl || `${API_URL}/api/workflow/exports/${video.filename}?clean=true&mute=${mute}`
            const a = document.createElement('a')
            a.href = dlUrl
            a.download = `${video.filename.replace(/\.mp4$/i, '')}_clean${mute ? '_no_audio' : ''}.mp4`
            document.body.appendChild(a)
            a.click()
            document.body.removeChild(a)

            setTimeout(() => {
              setCleaningState(null)
            }, 1800)
          } else if (st.status === 'error') {
            if (cleanPollRef.current) clearInterval(cleanPollRef.current)
            setCleaningState((prev) => (prev ? { ...prev, error: st.error || 'Lỗi khi xóa watermark' } : null))
          } else {
            const pct = st.frameEstimate > 0 ? Math.min(98, Math.round((st.processedFrames / st.frameEstimate) * 100)) : 15
            setCleaningState((prev) =>
              prev
                ? {
                    ...prev,
                    processedFrames: st.processedFrames,
                    frameEstimate: st.frameEstimate,
                    percent: Math.max(prev.percent, pct),
                  }
                : null
            )
          }
        } catch (pollErr: any) {
          console.warn('Lỗi poll clean status:', pollErr)
        }
      }, 1000)
    } catch (err: any) {
      alert(err?.message || 'Không thể bắt đầu xóa watermark video')
      setCleaningState(null)
    }
  }

  const handleExtractLastFrame = async (video: ExportedVideoItem) => {
    setIsExtractingFrame(true)
    try {
      const vidId = video.id || video.filename
      await veoApi.extractLastFrame(vidId)
      setFrameSaved(true)
      setTimeout(() => setFrameSaved(false), 3000)
    } catch (err: any) {
      alert(err?.message || 'Không thể trích xuất frame cuối của video này!')
    } finally {
      setIsExtractingFrame(false)
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes <= 0) return '0 KB'
    const mb = bytes / (1024 * 1024)
    return `${mb.toFixed(1)} MB`
  }

  const formatDate = (iso?: string) => {
    if (!iso) return ''
    try {
      const d = new Date(iso)
      if (isNaN(d.getTime())) return iso
      return d.toLocaleString('vi-VN', {
        hour: '2-digit',
        minute: '2-digit',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      })
    } catch {
      return iso || ''
    }
  }

  if (!isOpen) return null

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999999,
        background: 'rgba(15, 23, 42, 0.7)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 1120,
          height: '88vh',
          maxHeight: 820,
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 25px 60px -12px rgba(15, 23, 42, 0.35)',
          border: '1px solid #cbd5e1',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'wfScaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '12px 20px',
            background: '#f8fafc',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                background: '#0f172a',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
              }}
            >
              <Film size={16} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
                  Thư Viện Video Đã Xuất
                </span>
                <span
                  style={{
                    background: '#f1f5f9',
                    color: '#334155',
                    border: '1px solid #cbd5e1',
                    fontSize: 10.5,
                    fontWeight: 600,
                    padding: '1px 7px',
                    borderRadius: 99,
                  }}
                >
                  {videos.length} video
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                Quản lý các video hoàn chỉnh & clip Veo AI đã render
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {/* Nút Chế độ Ghép Nhanh Remix */}
            <button
              type="button"
              onClick={() => {
                const nextMode = !isRemixMode
                setIsRemixMode(nextMode)
                if (nextMode) {
                  setFilterType('veo_scene')
                }
              }}
              style={{
                height: 30,
                padding: '0 11px',
                borderRadius: 6,
                border: isRemixMode ? '1px solid #6366f1' : '1px solid #cbd5e1',
                background: isRemixMode ? '#4f46e5' : '#f8fafc',
                color: isRemixMode ? '#ffffff' : '#334155',
                fontSize: 11.5,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.15s ease',
                boxShadow: isRemixMode ? '0 2px 6px rgba(99, 102, 241, 0.3)' : 'none',
              }}
              title="Bật/tắt chế độ chọn nhiều clip Veo để ghép video mới (Remix)"
            >
              <Sparkles size={13} color={isRemixMode ? '#ffffff' : '#4f46e5'} />
              <span>{isRemixMode ? `Remix (${selectedRemixClips.length} clip)` : 'Ghép Nhanh (Remix)'}</span>
            </button>

            <button
              type="button"
              onClick={loadVideos}
              disabled={isLoading}
              style={{
                height: 30,
                padding: '0 10px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#334155',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                transition: 'all 0.15s',
              }}
              title="Làm mới danh sách video"
            >
              <RotateCcw size={12} className={isLoading ? 'animate-spin' : ''} />
              <span>Làm mới</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                width: 30,
                height: 30,
                borderRadius: 6,
                border: '1px solid #e2e8f0',
                background: '#ffffff',
                color: '#64748b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s',
              }}
              title="Đóng (ESC)"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Body: Two columns layout */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left Column: Video List / Gallery */}
          <div
            style={{
              width: 340,
              borderRight: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              background: '#f8fafc',
              flexShrink: 0,
            }}
          >
            {/* Search Bar & Filter Tabs */}
            <div
              style={{
                padding: '10px 12px 8px',
                borderBottom: '1px solid #e2e8f0',
                background: '#ffffff',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '5px 9px',
                  background: '#f8fafc',
                  borderRadius: 6,
                  border: '1px solid #e2e8f0',
                }}
              >
                <Search size={13} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Tìm theo tên hoặc prompt..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 11.5,
                    width: '100%',
                    color: '#0f172a',
                  }}
                />
                {searchTerm && (
                  <X
                    size={12}
                    color="#94a3b8"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSearchTerm('')}
                  />
                )}
              </div>

              {/* Segmented Filter Switcher */}
              <div
                style={{
                  display: 'flex',
                  background: '#f1f5f9',
                  borderRadius: 6,
                  padding: 2,
                  gap: 2,
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    setFilterType('all')
                    setSelectedIndex(0)
                  }}
                  style={{
                    flex: 1,
                    padding: '4px 3px',
                    borderRadius: 5,
                    border: 'none',
                    background: filterType === 'all' ? '#ffffff' : 'transparent',
                    color: filterType === 'all' ? '#0f172a' : '#64748b',
                    boxShadow: filterType === 'all' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                    fontSize: 10,
                    fontWeight: filterType === 'all' ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                  }}
                  title="Toàn bộ video và clip"
                >
                  Tất cả ({videos.length})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilterType('veo_scene')
                    setSelectedIndex(0)
                  }}
                  style={{
                    flex: 1,
                    padding: '4px 3px',
                    borderRadius: 5,
                    border: 'none',
                    background: filterType === 'veo_scene' ? '#ffffff' : 'transparent',
                    color: filterType === 'veo_scene' ? '#059669' : '#64748b',
                    boxShadow: filterType === 'veo_scene' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                    fontSize: 10,
                    fontWeight: filterType === 'veo_scene' ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                  }}
                  title="Các clip Veo sinh từ Prompt"
                >
                  Clip Veo ({veoPromptCount})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilterType('motion_control')
                    setSelectedIndex(0)
                  }}
                  style={{
                    flex: 1,
                    padding: '4px 3px',
                    borderRadius: 5,
                    border: 'none',
                    background: filterType === 'motion_control' ? '#ffffff' : 'transparent',
                    color: filterType === 'motion_control' ? '#c026d3' : '#64748b',
                    boxShadow: filterType === 'motion_control' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                    fontSize: 10,
                    fontWeight: filterType === 'motion_control' ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                  }}
                  title="Các clip điều khiển chuyển động nhân vật từ Motion Control Studio"
                >
                  Motion ({motionCount})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilterType('export')
                    setSelectedIndex(0)
                  }}
                  style={{
                    flex: 1,
                    padding: '4px 3px',
                    borderRadius: 5,
                    border: 'none',
                    background: filterType === 'export' ? '#ffffff' : 'transparent',
                    color: filterType === 'export' ? '#4f46e5' : '#64748b',
                    boxShadow: filterType === 'export' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                    fontSize: 10,
                    fontWeight: filterType === 'export' ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                    whiteSpace: 'nowrap',
                  }}
                  title="Các video hoàn chỉnh đã ghép nối"
                >
                  Hoàn chỉnh ({exportCount})
                </button>
              </div>
            </div>

            {/* Video List */}
            <div
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '8px 10px',
                display: 'flex',
                flexDirection: 'column',
                gap: 6,
              }}
            >
              {filtered.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '50px 20px',
                    color: '#94a3b8',
                    fontSize: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                  }}
                >
                  <Film size={28} strokeWidth={1.5} color="#cbd5e1" />
                  <div>{searchTerm ? 'Không tìm thấy video phù hợp' : 'Chưa có video nào'}</div>
                </div>
              ) : (
                filtered.map((item, idx) => {
                  const isSelected = item.filename === currentVideo?.filename
                  const remixIndex = selectedRemixClips.findIndex((c) => c.filename === item.filename)
                  return (
                    <div
                      key={item.filename}
                      onClick={() => {
                        setSelectedIndex(idx)
                        if (isRemixMode) {
                          toggleRemixClip(item)
                        }
                      }}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: remixIndex >= 0 ? '1.5px solid #6366f1' : isSelected ? '1.5px solid #334155' : '1px solid #e2e8f0',
                        background: remixIndex >= 0 ? '#f5f3ff' : '#ffffff',
                        boxShadow: remixIndex >= 0 ? '0 2px 6px rgba(99, 102, 241, 0.12)' : isSelected ? '0 2px 6px rgba(15, 23, 42, 0.08)' : '0 1px 2px rgba(0,0,0,0.02)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        position: 'relative',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0 }}>
                          {isRemixMode ? (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation()
                                toggleRemixClip(item)
                              }}
                              style={{
                                width: 28,
                                height: 28,
                                borderRadius: 6,
                                background: remixIndex >= 0 ? '#4f46e5' : '#f1f5f9',
                                border: remixIndex >= 0 ? '2px solid #6366f1' : '1px solid #cbd5e1',
                                color: remixIndex >= 0 ? '#ffffff' : '#64748b',
                                fontSize: 11,
                                fontWeight: 700,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                marginTop: 1,
                                cursor: 'pointer',
                                boxShadow: remixIndex >= 0 ? '0 2px 5px rgba(79, 70, 229, 0.3)' : 'none',
                                transition: 'all 0.15s ease',
                              }}
                              title={remixIndex >= 0 ? `Clip thứ #${remixIndex + 1} (Bấm để bỏ chọn)` : 'Bấm để thêm clip vào danh sách ghép'}
                            >
                              {remixIndex >= 0 ? remixIndex + 1 : '+'}
                            </button>
                          ) : (
                            <div
                              style={{
                                width: 32,
                                height: 32,
                                borderRadius: 6,
                                background: isSelected ? '#0f172a' : '#f1f5f9',
                                color: isSelected ? '#ffffff' : '#64748b',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                                marginTop: 1,
                              }}
                            >
                              <Play size={12} fill={isSelected ? '#ffffff' : '#64748b'} />
                            </div>
                          )}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div
                              style={{
                                fontSize: 11.5,
                                fontWeight: isSelected ? 700 : 600,
                                color: '#0f172a',
                                lineHeight: 1.35,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                              }}
                              title={item.title || item.filename}
                            >
                              {item.title || item.filename}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 }}>
                              {item.isMotionControl ? (
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 600,
                                    padding: '1px 5px',
                                    borderRadius: 3,
                                    background: '#fdf4ff',
                                    color: '#c026d3',
                                    border: '1px solid #f0abfc',
                                  }}
                                >
                                  Motion Control
                                </span>
                              ) : (
                                <span
                                  style={{
                                    fontSize: 9,
                                    fontWeight: 600,
                                    padding: '1px 5px',
                                    borderRadius: 3,
                                    background: item.sourceType === 'veo_scene' ? '#ecfdf5' : '#eef2ff',
                                    color: item.sourceType === 'veo_scene' ? '#059669' : '#4338ca',
                                    border: item.sourceType === 'veo_scene' ? '1px solid #a7f3d0' : '1px solid #c7d2fe',
                                  }}
                                >
                                  {item.sourceType === 'veo_scene' ? 'Clip Veo' : 'Hoàn Chỉnh'}
                                </span>
                              )}
                              <span style={{ fontSize: 9.5, color: '#94a3b8' }}>
                                {formatDate(item.createdAt)}
                              </span>
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleDelete(item.filename)
                          }}
                          disabled={deletingId === item.filename}
                          style={{
                            border: 'none',
                            background: 'transparent',
                            color: '#94a3b8',
                            cursor: 'pointer',
                            padding: 3,
                            borderRadius: 4,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'color 0.15s',
                          }}
                          title="Xóa video khỏi ổ đĩa"
                          onMouseEnter={(e) => (e.currentTarget.style.color = '#ef4444')}
                          onMouseLeave={(e) => (e.currentTarget.style.color = '#94a3b8')}
                        >
                          <Trash2 size={12} />
                        </button>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 8,
                          fontSize: 10,
                          color: '#64748b',
                          marginTop: 6,
                          paddingTop: 5,
                          borderTop: '1px solid #f1f5f9',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock size={10} color="#64748b" /> {Math.round(item.durationSec)}s
                        </span>
                        <span>•</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <HardDrive size={10} color="#64748b" /> {formatFileSize(item.sizeBytes)}
                        </span>
                        {item.sceneCount ? (
                          <>
                            <span>•</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Layers size={10} color="#64748b" /> {item.sceneCount} cảnh
                            </span>
                          </>
                        ) : null}
                      </div>
                    </div>
                  )
                })
              )}
            </div>
          </div>

          {/* Right Column: Theater Player & Details */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              background: '#ffffff',
              overflowY: 'auto',
            }}
          >
            {currentVideo ? (
              <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 14 }}>
                {/* Cinema Screen hoặc Chế độ Đối Chiếu 2 Màn Hình */}
                {isComparing ? (
                  <div
                    style={{
                      width: '100%',
                      background: '#070a12',
                      borderRadius: 10,
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.2)',
                      border: '1px solid #1e293b',
                    }}
                  >
                    {/* Header bar đối chiếu */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '8px 14px',
                        background: '#0f172a',
                        borderBottom: '1px solid #1e293b',
                        flexShrink: 0,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#f8fafc', fontSize: 12, fontWeight: 700 }}>
                          <Columns2 size={14} color="#f0abfc" />
                          <span>Đối chiếu chuyển động</span>
                        </div>

                        {/* Chuyển đổi giữa 2 chế độ: Song song & Soi đè lớp */}
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            background: 'rgba(255,255,255,0.08)',
                            borderRadius: 5,
                            padding: 2,
                            gap: 2,
                          }}
                        >
                          <button
                            type="button"
                            onClick={() => switchCompareMode('side_by_side')}
                            style={{
                              border: 'none',
                              background: compareMode === 'side_by_side' ? '#334155' : 'transparent',
                              color: compareMode === 'side_by_side' ? '#f8fafc' : '#94a3b8',
                              fontSize: 10.5,
                              fontWeight: compareMode === 'side_by_side' ? 700 : 500,
                              padding: '2px 8px',
                              borderRadius: 4,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title="Hiển thị 2 video song song từ đầu đến chân không bị cắt"
                          >
                            <Columns2 size={11} />
                            <span>Song song</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => switchCompareMode('slider')}
                            disabled={!localRefUrl && !currentVideo.referenceVideoUrl}
                            style={{
                              border: 'none',
                              background: compareMode === 'slider' ? '#334155' : 'transparent',
                              color: compareMode === 'slider' ? '#f8fafc' : '#94a3b8',
                              fontSize: 10.5,
                              fontWeight: compareMode === 'slider' ? 700 : 500,
                              padding: '2px 8px',
                              borderRadius: 4,
                              cursor: (!localRefUrl && !currentVideo.referenceVideoUrl) ? 'not-allowed' : 'pointer',
                              opacity: (!localRefUrl && !currentVideo.referenceVideoUrl) ? 0.4 : 1,
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title="Xếp đè 2 video và kéo thanh trượt để soi khớp vị trí từng milimet"
                          >
                            <Layers size={11} />
                            <span>Soi đè lớp</span>
                          </button>
                        </div>
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <label
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            color: '#cbd5e1',
                            background: 'rgba(255,255,255,0.1)',
                            padding: '3px 9px',
                            borderRadius: 4,
                            cursor: 'pointer',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            transition: 'background 0.15s',
                          }}
                          title="Chọn file video tham chiếu gốc từ máy tính"
                        >
                          <Upload size={11} />
                          <span>{(localRefUrl || currentVideo.referenceVideoUrl) ? 'Đổi clip gốc' : 'Chọn clip gốc từ máy'}</span>
                          <input
                            type="file"
                            accept="video/*"
                            style={{ display: 'none' }}
                            onChange={handleLocalRefChosen}
                          />
                        </label>
                        <button
                          type="button"
                          onClick={() => setIsComparing(false)}
                          style={{
                            background: 'transparent',
                            border: 'none',
                            color: '#94a3b8',
                            fontSize: 11,
                            cursor: 'pointer',
                            padding: '2px 6px',
                          }}
                        >
                          Đóng
                        </button>
                      </div>
                    </div>

                    {/* Vùng Video: Chế độ Song Song (Side-by-Side) */}
                    {compareMode === 'side_by_side' ? (
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '1fr 1fr',
                          gap: 8,
                          padding: '8px 12px',
                          height: 480,
                          background: '#090d16',
                          boxSizing: 'border-box',
                        }}
                      >
                        {/* Video Gốc (Trái) */}
                        <div
                          style={{
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            width: '100%',
                            minWidth: 0,
                            minHeight: 0,
                            overflow: 'hidden',
                            background: '#020617',
                            borderRadius: 8,
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              top: 8,
                              left: 8,
                              zIndex: 10,
                              background: 'rgba(15,23,42,0.85)',
                              backdropFilter: 'blur(4px)',
                              color: '#f8fafc',
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 4,
                              border: '1px solid rgba(255,255,255,0.15)',
                            }}
                          >
                            Clip Gốc (Tham Chiếu)
                          </div>
                          {(localRefUrl || currentVideo.referenceVideoUrl) ? (
                            <video
                              ref={refVideoRef}
                              src={localRefUrl || currentVideo.referenceVideoUrl}
                              playsInline
                              muted={isMutedRef}
                              style={{
                                maxWidth: '100%',
                                maxHeight: '100%',
                                width: 'auto',
                                height: '100%',
                                objectFit: 'contain',
                                display: 'block',
                                borderRadius: 6,
                                boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                              }}
                            />
                          ) : (
                            <div style={{ padding: 20, textAlign: 'center', color: '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
                              <Film size={32} color="#475569" />
                              <div style={{ fontSize: 12, color: '#cbd5e1', fontWeight: 600 }}>Chưa có file gốc đi kèm</div>
                              <div style={{ fontSize: 11, color: '#64748b', maxWidth: 220 }}>Bấm bên dưới để chọn clip gốc từ máy tính và soi chuyển động ngay</div>
                              <label
                                style={{
                                  padding: '6px 14px',
                                  borderRadius: 6,
                                  background: '#4f46e5',
                                  color: '#ffffff',
                                  fontSize: 11.5,
                                  fontWeight: 600,
                                  cursor: 'pointer',
                                  display: 'inline-flex',
                                  alignItems: 'center',
                                  gap: 6,
                                  boxShadow: '0 2px 6px rgba(79, 70, 229, 0.4)',
                                }}
                              >
                                <Upload size={12} />
                                <span>Chọn clip gốc từ máy</span>
                                <input
                                  type="file"
                                  accept="video/*"
                                  style={{ display: 'none' }}
                                  onChange={handleLocalRefChosen}
                                />
                              </label>
                            </div>
                          )}
                        </div>

                        {/* Video Kết Quả Veo AI (Phải) */}
                        <div
                          style={{
                            position: 'relative',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            height: '100%',
                            width: '100%',
                            minWidth: 0,
                            minHeight: 0,
                            overflow: 'hidden',
                            background: '#020617',
                            borderRadius: 8,
                            border: '1px solid rgba(255, 255, 255, 0.08)',
                          }}
                        >
                          <div
                            style={{
                              position: 'absolute',
                              top: 8,
                              left: 8,
                              zIndex: 10,
                              background: 'rgba(192,38,211,0.85)',
                              backdropFilter: 'blur(4px)',
                              color: '#ffffff',
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 4,
                            }}
                          >
                            Kết Quả Veo AI
                          </div>
                          <video
                            ref={mainVideoRef}
                            src={currentVideo.videoUrl}
                            playsInline
                            muted={isMutedVeo}
                            style={{
                              maxWidth: '100%',
                              maxHeight: '100%',
                              width: 'auto',
                              height: '100%',
                              objectFit: 'contain',
                              display: 'block',
                              borderRadius: 6,
                              boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
                            }}
                            onTimeUpdate={handleSyncTimeUpdate}
                            onEnded={handleSyncEnded}
                          />
                        </div>
                      </div>
                    ) : (
                      /* Vùng Video: Chế độ Soi Đè Lớp (Split Slider) */
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '8px 12px',
                          height: 480,
                          background: '#090d16',
                          boxSizing: 'border-box',
                          userSelect: 'none',
                        }}
                      >
                        <div
                          ref={sliderStageRef}
                          onPointerDown={handleSliderPointerDown}
                          onPointerMove={handleSliderPointerMove}
                          onPointerUp={handleSliderPointerUp}
                          style={{
                            position: 'relative',
                            height: '100%',
                            aspectRatio: currentVideo.aspectRatio === '16:9' ? '16/9' : currentVideo.aspectRatio === '1:1' ? '1/1' : '9/16',
                            maxWidth: '100%',
                            borderRadius: 8,
                            overflow: 'hidden',
                            background: '#000000',
                            boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            cursor: 'ew-resize',
                          }}
                        >
                          {/* Badge bên trái */}
                          <div
                            style={{
                              position: 'absolute',
                              top: 8,
                              left: 8,
                              zIndex: 20,
                              background: 'rgba(15,23,42,0.85)',
                              backdropFilter: 'blur(4px)',
                              color: '#f8fafc',
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 4,
                              border: '1px solid rgba(255,255,255,0.15)',
                              pointerEvents: 'none',
                            }}
                          >
                            Clip Gốc (Tham Chiếu)
                          </div>

                          {/* Badge bên phải */}
                          <div
                            style={{
                              position: 'absolute',
                              top: 8,
                              right: 8,
                              zIndex: 20,
                              background: 'rgba(192,38,211,0.85)',
                              backdropFilter: 'blur(4px)',
                              color: '#ffffff',
                              fontSize: 10,
                              fontWeight: 700,
                              padding: '2px 7px',
                              borderRadius: 4,
                              pointerEvents: 'none',
                            }}
                          >
                            Kết Quả Veo AI
                          </div>

                          {/* Lớp Video Gốc (Nền bên dưới) */}
                          <div style={{ position: 'absolute', inset: 0, width: '100%', height: '100%' }}>
                            <video
                              ref={refVideoRef}
                              src={localRefUrl || currentVideo.referenceVideoUrl}
                              playsInline
                              muted={isMutedRef}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                            />
                          </div>

                          {/* Lớp Video Veo AI (Đè bên trên với clipPath) */}
                          <div
                            style={{
                              position: 'absolute',
                              inset: 0,
                              width: '100%',
                              height: '100%',
                              clipPath: `inset(0 0 0 ${sliderPercent}%)`,
                            }}
                          >
                            <video
                              ref={mainVideoRef}
                              src={currentVideo.videoUrl}
                              playsInline
                              muted={isMutedVeo}
                              style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                              onTimeUpdate={handleSyncTimeUpdate}
                              onEnded={handleSyncEnded}
                            />
                          </div>

                          {/* Thanh trượt phân cách và nút kéo */}
                          <div
                            style={{
                              position: 'absolute',
                              top: 0,
                              bottom: 0,
                              left: `${sliderPercent}%`,
                              width: 2,
                              background: '#ffffff',
                              boxShadow: '0 0 8px rgba(0,0,0,0.8)',
                              transform: 'translateX(-50%)',
                              pointerEvents: 'none',
                              zIndex: 30,
                            }}
                          >
                            <div
                              style={{
                                position: 'absolute',
                                top: '50%',
                                left: '50%',
                                transform: 'translate(-50%, -50%)',
                                width: 28,
                                height: 28,
                                background: '#ffffff',
                                borderRadius: '50%',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                boxShadow: '0 2px 10px rgba(0,0,0,0.5)',
                                fontSize: 10,
                                fontWeight: 800,
                                color: '#0f172a',
                                letterSpacing: -1,
                              }}
                            >
                              ◀▶
                            </div>
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Thanh điều khiển đồng bộ (Unified Sync Controller) */}
                    <div style={{ padding: '8px 14px', background: '#0f172a', borderTop: '1px solid #1e293b', display: 'flex', flexDirection: 'column', gap: 6, flexShrink: 0 }}>
                      {/* Timeline Scrubber */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <span style={{ fontSize: 10.5, color: '#94a3b8', fontFamily: 'monospace', minWidth: 32 }}>
                          {formatSyncTime(syncCurrentTime)}
                        </span>
                        <input
                          type="range"
                          min={0}
                          max={syncDuration || 10}
                          step={0.05}
                          value={syncCurrentTime}
                          onChange={handleSyncScrub}
                          style={{ flex: 1, accentColor: '#c026d3', cursor: 'pointer', height: 4 }}
                        />
                        <span style={{ fontSize: 10.5, color: '#94a3b8', fontFamily: 'monospace', minWidth: 32 }}>
                          {formatSyncTime(syncDuration || 10)}
                        </span>
                      </div>

                      {/* Các nút bấm Play/Speed/Mute */}
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <button
                            type="button"
                            onClick={toggleSyncPlay}
                            style={{
                              height: 28,
                              padding: '0 12px',
                              borderRadius: 5,
                              border: 'none',
                              background: '#c026d3',
                              color: '#ffffff',
                              fontSize: 11,
                              fontWeight: 700,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 5,
                            }}
                          >
                            {isSyncPlaying ? <Pause size={12} fill="#ffffff" /> : <Play size={12} fill="#ffffff" />}
                            <span>{isSyncPlaying ? 'Tạm dừng' : 'Phát đồng bộ'}</span>
                          </button>

                          {/* Chọn tốc độ phát */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 2, background: 'rgba(255,255,255,0.08)', borderRadius: 5, padding: 2 }}>
                            {[1, 0.75, 0.5].map((speed) => (
                              <button
                                key={speed}
                                type="button"
                                onClick={() => changeSyncSpeed(speed)}
                                style={{
                                  border: 'none',
                                  background: syncSpeed === speed ? '#334155' : 'transparent',
                                  color: syncSpeed === speed ? '#f8fafc' : '#94a3b8',
                                  fontSize: 10,
                                  fontWeight: syncSpeed === speed ? 700 : 500,
                                  padding: '2px 6px',
                                  borderRadius: 4,
                                  cursor: 'pointer',
                                }}
                                title={`Tốc độ ${speed}x (Soi chi tiết)`}
                              >
                                {speed}x
                              </button>
                            ))}
                          </div>

                          {/* Bật/Tắt âm thanh clip gốc */}
                          <button
                            type="button"
                            onClick={() => setIsMutedRef((prev) => !prev)}
                            style={{
                              height: 26,
                              padding: '0 8px',
                              borderRadius: 5,
                              border: isMutedRef ? '1px solid #334155' : '1px solid rgba(255,255,255,0.3)',
                              background: isMutedRef ? 'transparent' : 'rgba(255,255,255,0.12)',
                              color: isMutedRef ? '#94a3b8' : '#f8fafc',
                              fontSize: 10.5,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title={isMutedRef ? 'Bật âm thanh clip gốc' : 'Tắt âm thanh clip gốc'}
                          >
                            {isMutedRef ? <VolumeX size={11} /> : <Volume2 size={11} />}
                            <span>Âm gốc</span>
                          </button>

                          {/* Bật/Tắt âm thanh clip Veo AI */}
                          <button
                            type="button"
                            onClick={() => setIsMutedVeo((prev) => !prev)}
                            style={{
                              height: 26,
                              padding: '0 8px',
                              borderRadius: 5,
                              border: isMutedVeo ? '1px solid #334155' : '1px solid rgba(192, 38, 211, 0.4)',
                              background: isMutedVeo ? 'transparent' : 'rgba(192, 38, 211, 0.2)',
                              color: isMutedVeo ? '#94a3b8' : '#f0abfc',
                              fontSize: 10.5,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title={isMutedVeo ? 'Bật âm thanh clip Veo AI' : 'Tắt âm thanh clip Veo AI'}
                          >
                            {isMutedVeo ? <VolumeX size={11} /> : <Volume2 size={11} />}
                            <span>Âm Veo</span>
                          </button>
                        </div>

                        {/* Nút lưu liên kết clip gốc nếu là clip vừa chọn từ máy */}
                        {selectedRefFile && !currentVideo.referenceVideoUrl && (
                          <button
                            type="button"
                            onClick={handleSaveRefToBackend}
                            disabled={isSavingRef}
                            style={{
                              height: 26,
                              padding: '0 10px',
                              borderRadius: 5,
                              border: 'none',
                              background: '#059669',
                              color: '#ffffff',
                              fontSize: 10.5,
                              fontWeight: 600,
                              cursor: 'pointer',
                              display: 'inline-flex',
                              alignItems: 'center',
                              gap: 4,
                            }}
                            title="Lưu file video gốc này vào hệ thống để các lần sau tự động có sẵn"
                          >
                            {isSavingRef ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
                            <span>{isSavingRef ? 'Đang lưu...' : 'Lưu liên kết vào clip'}</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      width: '100%',
                      height: 380,
                      background: '#070a12',
                      borderRadius: 10,
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                      border: '1px solid #1e293b',
                    }}
                  >
                    <video
                      key={currentVideo.videoUrl}
                      src={currentVideo.videoUrl}
                      controls
                      autoPlay
                      playsInline
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'contain',
                      }}
                    />
                  </div>
                )}

                {/* Video Info Header & Actions */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 10,
                  }}
                >
                  {/* Row 1: Title + Source Label */}
                  <div>
                    <h3
                      style={{
                        margin: 0,
                        fontSize: 14.5,
                        fontWeight: 700,
                        color: '#0f172a',
                        lineHeight: 1.4,
                      }}
                    >
                      {currentVideo.title || currentVideo.filename}
                    </h3>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 3 }}>
                      <span
                        style={{
                          fontWeight: 600,
                          color: currentVideo.isMotionControl
                            ? '#c026d3'
                            : currentVideo.sourceType === 'veo_scene'
                            ? '#059669'
                            : '#4f46e5',
                        }}
                      >
                        {currentVideo.isMotionControl
                          ? 'Phân cảnh Motion Control (AI Edit)'
                          : currentVideo.sourceType === 'veo_scene'
                          ? 'Phân cảnh Veo AI'
                          : 'Video hoàn chỉnh'}
                      </span>
                      <span style={{ margin: '0 6px' }}>•</span>
                      <span>Đã tạo {formatDate(currentVideo.createdAt)}</span>
                    </div>
                  </div>

                  {/* Row 2: Action Toolbar (Clean, single line, moderate button size) */}
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      flexWrap: 'wrap',
                    }}
                  >
                    {/* Split Button: Tải MP4 (Gốc / Không âm thanh) */}
                    <div ref={downloadMenuRef} style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
                      <button
                        type="button"
                        onClick={() => handleDownload(currentVideo, false)}
                        style={{
                          height: 32,
                          padding: '0 11px 0 13px',
                          borderRadius: '6px 0 0 6px',
                          border: 'none',
                          borderRight: '1px solid rgba(255,255,255,0.18)',
                          background: '#0f172a',
                          color: '#ffffff',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          whiteSpace: 'nowrap',
                          transition: 'all 0.15s ease',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#1e293b')}
                        onMouseLeave={(e) => (e.currentTarget.style.background = '#0f172a')}
                        title="Tải video định dạng MP4 gốc về máy"
                      >
                        <Download size={13} />
                        <span>Tải MP4</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setIsDownloadMenuOpen((prev) => !prev)}
                        style={{
                          height: 32,
                          width: 26,
                          padding: 0,
                          borderRadius: '0 6px 6px 0',
                          border: 'none',
                          background: isDownloadMenuOpen ? '#1e293b' : '#0f172a',
                          color: '#ffffff',
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          transition: 'all 0.15s ease',
                          boxShadow: '0 1px 2px rgba(0,0,0,0.06)',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#1e293b')}
                        onMouseLeave={(e) => {
                          if (!isDownloadMenuOpen) e.currentTarget.style.background = '#0f172a'
                        }}
                        title="Tùy chọn tải video (có tiếng hoặc tách tiếng)"
                      >
                        <ChevronDown
                          size={13}
                          style={{
                            transform: isDownloadMenuOpen ? 'rotate(180deg)' : 'none',
                            transition: 'transform 0.15s ease',
                          }}
                        />
                      </button>

                      {/* Dropdown Menu Popup (4 Tùy chọn: Gốc & Xóa Watermark AI) */}
                      {isDownloadMenuOpen && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 'calc(100% + 5px)',
                            left: 0,
                            zIndex: 100,
                            minWidth: 260,
                            background: '#ffffff',
                            borderRadius: 8,
                            border: '1px solid #e2e8f0',
                            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.15), 0 8px 10px -6px rgba(0,0,0,0.1)',
                            padding: '6px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: 3,
                          }}
                        >
                          {/* Label nhóm 1 */}
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#94a3b8', padding: '4px 8px 2px', textTransform: 'uppercase', letterSpacing: 0.5 }}>
                            Bản Gốc (Tải Ngay)
                          </div>

                          {/* Option 1: Tải có âm thanh (Gốc) */}
                          <button
                            type="button"
                            onClick={() => {
                              handleDownload(currentVideo, false, false)
                              setIsDownloadMenuOpen(false)
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '7px 8px',
                              borderRadius: 6,
                              border: 'none',
                              background: 'transparent',
                              color: '#1e293b',
                              fontSize: 12,
                              textAlign: 'left',
                              cursor: 'pointer',
                              width: '100%',
                              transition: 'background 0.12s ease',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f1f5f9')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div
                              style={{
                                width: 26,
                                height: 26,
                                borderRadius: 6,
                                background: '#eff6ff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              <Volume2 size={14} color="#3b82f6" />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <span style={{ fontWeight: 600, color: '#0f172a' }}>Tải có âm thanh</span>
                              <span style={{ fontSize: 10.5, color: '#64748b' }}>Video gốc kèm đầy đủ audio (tức thì)</span>
                            </div>
                          </button>

                          {/* Option 2: Tải không âm thanh (Mute) */}
                          <button
                            type="button"
                            onClick={() => {
                              handleDownload(currentVideo, true, false)
                              setIsDownloadMenuOpen(false)
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '7px 8px',
                              borderRadius: 6,
                              border: 'none',
                              background: 'transparent',
                              color: '#1e293b',
                              fontSize: 12,
                              textAlign: 'left',
                              cursor: 'pointer',
                              width: '100%',
                              transition: 'background 0.12s ease',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#fff7ed')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div
                              style={{
                                width: 26,
                                height: 26,
                                borderRadius: 6,
                                background: '#ffedd5',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              <VolumeX size={14} color="#ea580c" />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontWeight: 600, color: '#c2410c' }}>Tải không âm thanh</span>
                                <span
                                  style={{
                                    fontSize: 9,
                                    padding: '1px 5px',
                                    borderRadius: 4,
                                    background: '#ffedd5',
                                    color: '#c2410c',
                                    fontWeight: 700,
                                  }}
                                >
                                  MUTE
                                </span>
                              </div>
                              <span style={{ fontSize: 10.5, color: '#9a3412' }}>Tách sạch audio (*_no_audio.mp4)</span>
                            </div>
                          </button>

                          {/* Divider */}
                          <div style={{ height: 1, background: '#f1f5f9', margin: '4px 2px' }} />

                          {/* Label nhóm 2 */}
                          <div style={{ fontSize: 10, fontWeight: 700, color: '#7c3aed', padding: '2px 8px 2px', textTransform: 'uppercase', letterSpacing: 0.5, display: 'flex', alignItems: 'center', gap: 4 }}>
                            <Sparkles size={11} color="#7c3aed" /> Xóa Watermark AI (SynthID)
                          </div>

                          {/* Option 3: Tải sạch Watermark (Có tiếng) */}
                          <button
                            type="button"
                            onClick={() => {
                              handleDownload(currentVideo, false, true)
                              setIsDownloadMenuOpen(false)
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '7px 8px',
                              borderRadius: 6,
                              border: 'none',
                              background: 'transparent',
                              color: '#1e293b',
                              fontSize: 12,
                              textAlign: 'left',
                              cursor: 'pointer',
                              width: '100%',
                              transition: 'background 0.12s ease',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#f5f3ff')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div
                              style={{
                                width: 26,
                                height: 26,
                                borderRadius: 6,
                                background: '#ede9fe',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              <Sparkles size={14} color="#7c3aed" />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontWeight: 600, color: '#6d28d9' }}>Tải sạch Watermark</span>
                                <span
                                  style={{
                                    fontSize: 9,
                                    padding: '1px 5px',
                                    borderRadius: 4,
                                    background: '#ede9fe',
                                    color: '#6d28d9',
                                    fontWeight: 700,
                                  }}
                                >
                                  ✨ AI
                                </span>
                              </div>
                              <span style={{ fontSize: 10.5, color: '#7c3aed' }}>Xóa logo SynthID, giữ nguyên tiếng</span>
                            </div>
                          </button>

                          {/* Option 4: Tải sạch Watermark (Tắt tiếng) */}
                          <button
                            type="button"
                            onClick={() => {
                              handleDownload(currentVideo, true, true)
                              setIsDownloadMenuOpen(false)
                            }}
                            style={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 10,
                              padding: '7px 8px',
                              borderRadius: 6,
                              border: 'none',
                              background: 'transparent',
                              color: '#1e293b',
                              fontSize: 12,
                              textAlign: 'left',
                              cursor: 'pointer',
                              width: '100%',
                              transition: 'background 0.12s ease',
                            }}
                            onMouseEnter={(e) => (e.currentTarget.style.background = '#fdf4ff')}
                            onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
                          >
                            <div
                              style={{
                                width: 26,
                                height: 26,
                                borderRadius: 6,
                                background: '#fae8ff',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                flexShrink: 0,
                              }}
                            >
                              <VolumeX size={14} color="#c026d3" />
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontWeight: 600, color: '#a21caf' }}>Tải sạch + Tắt tiếng</span>
                                <span
                                  style={{
                                    fontSize: 9,
                                    padding: '1px 5px',
                                    borderRadius: 4,
                                    background: '#fae8ff',
                                    color: '#a21caf',
                                    fontWeight: 700,
                                  }}
                                >
                                  ✨ MUTE
                                </span>
                              </div>
                              <span style={{ fontSize: 10.5, color: '#a21caf' }}>Xóa logo SynthID + tắt sạch audio</span>
                            </div>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Lưu frame cuối vào Thư viện Veo (nếu là clip Veo) */}
                    {currentVideo.sourceType === 'veo_scene' && (
                      <button
                        type="button"
                        onClick={() => handleExtractLastFrame(currentVideo)}
                        disabled={isExtractingFrame}
                        style={{
                          height: 32,
                          padding: '0 12px',
                          borderRadius: 6,
                          border: '1px solid #cbd5e1',
                          background: frameSaved ? '#ecfdf5' : '#ffffff',
                          color: frameSaved ? '#059669' : '#334155',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: isExtractingFrame ? 'wait' : 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          whiteSpace: 'nowrap',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!frameSaved) e.currentTarget.style.background = '#f8fafc'
                        }}
                        onMouseLeave={(e) => {
                          if (!frameSaved) e.currentTarget.style.background = '#ffffff'
                        }}
                        title="Trích xuất khung hình cuối của video và lưu vào Thư viện Ảnh Veo Studio"
                      >
                        {isExtractingFrame ? (
                          <Loader2 size={13} className="animate-spin" />
                        ) : frameSaved ? (
                          <Check size={13} color="#059669" />
                        ) : (
                          <ImageDown size={13} />
                        )}
                        <span>{frameSaved ? 'Đã lưu vào Thư viện' : 'Lưu frame cuối'}</span>
                      </button>
                    )}

                    {/* Đối chiếu bản gốc cho Motion Control */}
                    {currentVideo.isMotionControl && (
                      <button
                        type="button"
                        onClick={() => setIsComparing((prev) => !prev)}
                        style={{
                          height: 32,
                          padding: '0 12px',
                          borderRadius: 6,
                          border: isComparing ? '1.5px solid #c026d3' : '1px solid #cbd5e1',
                          background: isComparing ? '#fdf4ff' : '#ffffff',
                          color: isComparing ? '#c026d3' : '#334155',
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          whiteSpace: 'nowrap',
                          transition: 'all 0.15s ease',
                          boxShadow: isComparing ? '0 2px 6px rgba(192, 38, 211, 0.2)' : '0 1px 2px rgba(0,0,0,0.05)',
                        }}
                        title="So sánh song song đối chiếu với video tham chiếu gốc"
                      >
                        <Columns2 size={13} color={isComparing ? '#c026d3' : '#64748b'} />
                        <span>{isComparing ? 'Thoát đối chiếu' : 'Đối chiếu bản gốc'}</span>
                      </button>
                    )}

                    {/* Mở thư mục */}
                    <button
                      type="button"
                      onClick={() => handleOpenFolder(currentVideo.filename)}
                      style={{
                        height: 32,
                        padding: '0 12px',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        background: '#ffffff',
                        color: '#334155',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 6,
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#f8fafc')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#ffffff')}
                      title="Mở thư mục chứa file trong Windows File Explorer"
                    >
                      <FolderOpen size={13} color="#d97706" />
                      <span>Mở thư mục</span>
                    </button>

                    {/* Xóa */}
                    <button
                      type="button"
                      onClick={() => handleDelete(currentVideo.filename)}
                      disabled={deletingId === currentVideo.filename}
                      style={{
                        height: 32,
                        padding: '0 12px',
                        borderRadius: 6,
                        border: '1px solid #fecaca',
                        background: '#fff1f2',
                        color: '#dc2626',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 5,
                        whiteSpace: 'nowrap',
                        transition: 'all 0.15s ease',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.background = '#fee2e2')}
                      onMouseLeave={(e) => (e.currentTarget.style.background = '#fff1f2')}
                      title="Xóa video khỏi ổ đĩa"
                    >
                      <Trash2 size={13} />
                      <span>Xóa</span>
                    </button>
                  </div>
                </div>

                {/* Spec Grid: Thông số kỹ thuật mini chips */}
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(4, 1fr)',
                    gap: 8,
                  }}
                >
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '7px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Clock size={14} color="#6366f1" />
                    <div>
                      <div style={{ fontSize: 9.5, color: '#64748b' }}>Thời lượng</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
                        {Math.round(currentVideo.durationSec)}s
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '7px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <HardDrive size={14} color="#059669" />
                    <div>
                      <div style={{ fontSize: 9.5, color: '#64748b' }}>Dung lượng</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
                        {formatFileSize(currentVideo.sizeBytes)}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '7px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Ratio size={14} color="#d97706" />
                    <div>
                      <div style={{ fontSize: 9.5, color: '#64748b' }}>Tỉ lệ</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
                        {currentVideo.aspectRatio || '9:16'}
                      </div>
                    </div>
                  </div>

                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '7px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                    }}
                  >
                    <Monitor size={14} color="#0284c7" />
                    <div>
                      <div style={{ fontSize: 9.5, color: '#64748b' }}>Độ phân giải</div>
                      <div style={{ fontSize: 12, fontWeight: 700, color: '#0f172a' }}>
                        {currentVideo.resolution || '720×1280'}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Prompt block if available */}
                {currentVideo.prompt && (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 5,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                      }}
                    >
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 700,
                          color: '#334155',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 5,
                        }}
                      >
                        <Sparkles size={12} color="#6366f1" />
                        <span>Mô Tả Phân Cảnh (Prompt Veo AI)</span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleCopyPrompt(currentVideo.prompt!)}
                        style={{
                          border: 'none',
                          background: 'transparent',
                          color: '#64748b',
                          fontSize: 10.5,
                          cursor: 'pointer',
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 5px',
                          borderRadius: 4,
                        }}
                        title="Sao chép prompt"
                      >
                        {copiedPrompt ? <Check size={11} color="#059669" /> : <Copy size={11} />}
                        <span>{copiedPrompt ? 'Đã sao chép' : 'Sao chép prompt'}</span>
                      </button>
                    </div>
                    <div
                      style={{
                        fontSize: 11,
                        color: '#1e293b',
                        whiteSpace: 'pre-wrap',
                        maxHeight: 85,
                        overflowY: 'auto',
                        lineHeight: 1.45,
                      }}
                    >
                      {currentVideo.prompt}
                    </div>
                  </div>
                )}

                {/* File Path Bar */}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: '8px 12px',
                    fontSize: 10.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div
                    style={{
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      marginRight: 10,
                    }}
                  >
                    <span style={{ fontWeight: 600, color: '#64748b' }}>Đường dẫn file: </span>
                    <span style={{ color: '#0f172a', fontFamily: 'monospace' }}>
                      {currentVideo.filePath}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyPath(currentVideo.filePath)}
                    style={{
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      borderRadius: 5,
                      padding: '3px 8px',
                      fontSize: 10.5,
                      cursor: 'pointer',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      flexShrink: 0,
                      color: '#334155',
                      fontWeight: 500,
                    }}
                  >
                    {copied ? <Check size={11} color="#059669" /> : <Copy size={11} />}
                    <span>{copied ? 'Đã sao chép' : 'Sao chép'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#94a3b8',
                  padding: 40,
                  textAlign: 'center',
                  gap: 10,
                }}
              >
                <Film size={40} strokeWidth={1} color="#cbd5e1" />
                <div style={{ fontSize: 13, fontWeight: 600, color: '#64748b' }}>
                  Chưa có video nào
                </div>
                <div style={{ fontSize: 11, maxWidth: 340, lineHeight: 1.5 }}>
                  Khi bạn xuất video hoàn chỉnh từ Flow Studio hoặc render clip Veo AI, các video sẽ tự động xuất hiện tại đây.
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ─── REMIX FLOATING BOTTOM ACTION BAR ─── */}
        {isRemixMode && (
          <div
            style={{
              padding: '10px 20px',
              background: '#0f172a',
              borderTop: '1px solid #1e293b',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 16,
              color: '#ffffff',
              flexShrink: 0,
              boxShadow: '0 -4px 15px rgba(0,0,0,0.2)',
            }}
          >
            {/* Left Info & Selected Order */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 26,
                    height: 26,
                    borderRadius: 6,
                    background: '#6366f1',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontWeight: 700,
                    fontSize: 12,
                  }}
                >
                  ⚡
                </span>
                <div>
                  <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                    Remix: {selectedRemixClips.length} clip{' '}
                    <span style={{ fontSize: 11, fontWeight: 500, color: '#94a3b8' }}>
                      (Tổng ~{Math.round(totalRemixDuration)}s)
                    </span>
                  </div>
                  <div style={{ fontSize: 10.5, color: '#94a3b8' }}>
                    {selectedRemixClips.length < 2
                      ? 'Chọn thêm ít nhất 1 clip Veo nữa để ghép'
                      : 'Ghép nối theo đúng thứ tự đánh số [1], [2]...'}
                  </div>
                </div>
              </div>

              {/* Clip Sequence Badges */}
              {selectedRemixClips.length > 0 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    overflowX: 'auto',
                    maxWidth: 240,
                    padding: '2px 0',
                  }}
                >
                  {selectedRemixClips.map((clip, idx) => (
                    <div
                      key={clip.filename}
                      style={{
                        background: '#1e293b',
                        border: '1px solid #334155',
                        borderRadius: 5,
                        padding: '2px 6px',
                        fontSize: 10,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                        whiteSpace: 'nowrap',
                      }}
                    >
                      <span style={{ color: '#818cf8', fontWeight: 700 }}>#{idx + 1}</span>
                      <span
                        style={{
                          maxWidth: 60,
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          color: '#e2e8f0',
                        }}
                        title={clip.title || clip.filename}
                      >
                        {clip.title || clip.filename}
                      </span>
                      <X
                        size={10}
                        color="#94a3b8"
                        style={{ cursor: 'pointer' }}
                        onClick={() => toggleRemixClip(clip)}
                      />
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => setSelectedRemixClips([])}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#f87171',
                      fontSize: 10,
                      cursor: 'pointer',
                      padding: 0,
                    }}
                  >
                    Xóa
                  </button>
                </div>
              )}
            </div>

            {/* Middle Controls: Voice & BGM */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* Giọng đọc */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Mic size={13} color="#a5b4fc" />
                <select
                  value={remixVoiceId}
                  onChange={(e) => setRemixVoiceId(e.target.value)}
                  style={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#e2e8f0',
                    fontSize: 11,
                    borderRadius: 6,
                    padding: '5px 8px',
                    outline: 'none',
                    cursor: 'pointer',
                  }}
                >
                  <option value="bf4bed06c671">🎙️ Ads_Female (Nữ quảng cáo)</option>
                  <option value="7e16be95b7fd">🎙️ Review (Review tự nhiên)</option>
                  <option value="a5b304485f8b">🎙️ Google Voice (Chuẩn)</option>
                  <option value="none">🔇 Không lồng tiếng</option>
                </select>
              </div>

              {/* Nhạc nền BGM */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Music size={13} color="#a5b4fc" />
                <select
                  value={remixBgmTrackId}
                  onChange={(e) => setRemixBgmTrackId(e.target.value)}
                  style={{
                    background: '#1e293b',
                    border: '1px solid #334155',
                    color: '#e2e8f0',
                    fontSize: 11,
                    borderRadius: 6,
                    padding: '5px 8px',
                    outline: 'none',
                    cursor: 'pointer',
                    maxWidth: 150,
                  }}
                >
                  <option value="none">🔇 Không nhạc nền</option>
                  {availableBgm.map((bgm) => (
                    <option key={bgm.track_id} value={bgm.track_id}>
                      🎵 {bgm.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Right Action Button */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button
                type="button"
                onClick={handleExecuteRemix}
                disabled={selectedRemixClips.length < 2 || isRemixing}
                style={{
                  padding: '8px 16px',
                  borderRadius: 7,
                  border: 'none',
                  background:
                    selectedRemixClips.length < 2 || isRemixing
                      ? '#334155'
                      : 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: selectedRemixClips.length < 2 || isRemixing ? 'not-allowed' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  boxShadow:
                    selectedRemixClips.length < 2 || isRemixing
                      ? 'none'
                      : '0 4px 12px rgba(99, 102, 241, 0.4)',
                  transition: 'all 0.15s ease',
                }}
              >
                {isRemixing ? (
                  <>
                    <Loader2 size={14} className="animate-spin" />
                    <span>Đang ghép video & audio...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>⚡ Ghép Video Mới ({selectedRemixClips.length} clip)</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )

  const cleanProgressModal = cleaningState ? createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 1000001,
        background: 'rgba(15, 23, 42, 0.75)',
        backdropFilter: 'blur(5px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
      }}
    >
      <div
        style={{
          width: 440,
          maxWidth: '92vw',
          background: '#ffffff',
          borderRadius: 14,
          padding: '22px 24px',
          boxShadow: '0 25px 60px -12px rgba(0,0,0,0.35)',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
          animation: 'wfScaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 42,
              height: 42,
              borderRadius: 10,
              background: cleaningState.isDone
                ? '#ecfdf5'
                : cleaningState.error
                ? '#fef2f2'
                : '#f5f3ff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              flexShrink: 0,
            }}
          >
            {cleaningState.isDone ? (
              <Check size={22} color="#059669" />
            ) : cleaningState.error ? (
              <X size={22} color="#ef4444" />
            ) : (
              <Sparkles size={22} color="#7c3aed" />
            )}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
              {cleaningState.isDone
                ? 'Đã Xóa Xong Watermark!'
                : cleaningState.error
                ? 'Xóa Watermark Thất Bại'
                : 'Đang Xóa Watermark AI (SynthID)...'}
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: '#64748b',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                marginTop: 2,
              }}
              title={cleaningState.filename}
            >
              {cleaningState.filename}
            </div>
          </div>
        </div>

        {/* Progress body */}
        {cleaningState.error ? (
          <div
            style={{
              padding: '10px 12px',
              borderRadius: 8,
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#dc2626',
              fontSize: 12,
              lineHeight: 1.4,
            }}
          >
            {cleaningState.error}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {/* Progress Bar */}
            <div
              style={{
                width: '100%',
                height: 8,
                borderRadius: 99,
                background: '#e2e8f0',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  width: `${cleaningState.percent}%`,
                  height: '100%',
                  background: cleaningState.isDone
                    ? '#059669'
                    : 'linear-gradient(90deg, #6366f1, #a855f7)',
                  borderRadius: 99,
                  transition: 'width 0.4s ease',
                }}
              />
            </div>

            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: 11.5,
                color: '#64748b',
              }}
            >
              <span>
                {cleaningState.isDone
                  ? '✓ Đang tự động tải video về máy...'
                  : cleaningState.frameEstimate > 0
                  ? `Đang inpainting: ${cleaningState.processedFrames} / ${cleaningState.frameEstimate} frames`
                  : 'Đang khởi tạo Playwright Chromium inpainting...'}
              </span>
              <span style={{ fontWeight: 700, color: '#0f172a' }}>{cleaningState.percent}%</span>
            </div>
          </div>
        )}

        {/* Footer / Close Button */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 4 }}>
          <button
            type="button"
            onClick={() => {
              if (cleanPollRef.current) clearInterval(cleanPollRef.current)
              setCleaningState(null)
            }}
            style={{
              height: 32,
              padding: '0 14px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            {cleaningState.isDone ? 'Đóng' : 'Hủy bỏ'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null

  return (
    <>
      {createPortal(modalContent, document.body)}
      {cleanProgressModal}
    </>
  )
}
