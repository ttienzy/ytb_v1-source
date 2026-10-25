import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Film,
  FolderOpen,
  History,
  Image as ImageIcon,
  Layers,
  Loader2,
  Maximize2,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Sparkles,
  Trash2,
  UploadCloud,
  Video,
  X,
} from 'lucide-react'
import type {
  MuseStatus,
  MuseHistoryItem,
  MuseGenerateResult,
  MuseReferenceMedia,
} from './types'
import * as api from './services/museApi'
import { API_URL } from '../../shared/constants'

interface Props {
  setActivePage: (page: string) => void
}

const PRESET_STYLES = [
  { label: 'Cinematic 4K', prompt: 'cinematic lighting, photorealistic 4k, hyper-detailed, depth of field' },
  { label: 'Cyberpunk City', prompt: 'cyberpunk neon city, night rain, reflections, futuristic atmosphere' },
  { label: 'Thiên nhiên Macro', prompt: 'macro cinematography, 8k nature documentary, vivid natural lighting' },
  { label: 'Chân dung Điện ảnh', prompt: 'cinematic portrait shot, 85mm lens, golden hour rim lighting, highly detailed' },
  { label: 'Drone Bay Lượn', prompt: 'wide cinematic fpv drone sweep, smooth camera motion, epic landscape scale' },
  { label: '3D Hoạt hình', prompt: 'stylized 3D animation, pixar style lighting, vibrant colors, expressive motion' },
]

export function MuseStudioPage({ setActivePage }: Props) {
  // Connection state
  const [status, setStatus] = useState<MuseStatus | null>(null)
  const [checkingStatus, setCheckingStatus] = useState(false)
  const [launchingBrowser, setLaunchingBrowser] = useState(false)

  // Creation state
  const [prompt, setPrompt] = useState(
    'A cute golden retriever puppy wearing tiny sunglasses sitting on a beach towel under an umbrella, bright tropical sunlight, photorealistic 4k'
  )
  const [referenceImage, setReferenceImage] = useState('')
  const [mediaList, setMediaList] = useState<MuseReferenceMedia[]>([])
  const [uploadingMedia, setUploadingMedia] = useState(false)
  const [manualPathInput, setManualPathInput] = useState('')
  const [showManualInput, setShowManualInput] = useState(false)
  const [isDragOver, setIsDragOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [useSideChat, setUseSideChat] = useState(true)
  const [continuation, setContinuation] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [genError, setGenError] = useState('')

  // Monitor & History state
  const [history, setHistory] = useState<MuseHistoryItem[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [activeVideo, setActiveVideo] = useState<{
    id: string
    title: string
    streamUrl: string
    localPath?: string
    fileSize?: number
    createdAt?: string
    durationSec?: number
  } | null>(null)
  const [copiedPath, setCopiedPath] = useState(false)

  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // 1. Kiểm tra live status
  const checkStatus = useCallback(async () => {
    setCheckingStatus(true)
    try {
      const res = await api.getMuseStatus()
      setStatus(res)
    } catch {
      setStatus(null)
    } finally {
      setCheckingStatus(false)
    }
  }, [])

  // 2. Tải lịch sử video
  const loadHistory = useCallback(async () => {
    setLoadingHistory(true)
    try {
      const items = await api.getMuseHistory(50)
      setHistory(items)
      // Mặc định chọn video mới nhất nếu chưa có video active
      if (items.length > 0) {
        setActiveVideo(prev => {
          if (prev) return prev
          const first = items[0]
          return {
            id: first.id,
            title: first.filename,
            streamUrl: api.getVideoMediaUrl(first.filename),
            localPath: first.local_path,
            fileSize: first.file_size,
            createdAt: first.created_at,
          }
        })
      }
    } catch (err) {
      console.error('Lỗi tải lịch sử Muse:', err)
    } finally {
      setLoadingHistory(false)
    }
  }, [])

  useEffect(() => {
    checkStatus()
    loadHistory()
  }, [checkStatus, loadHistory])

  // 3. Mở Chrome Muse
  async function handleOpenBrowser() {
    setLaunchingBrowser(true)
    try {
      await api.openMuseBrowser()
      setTimeout(checkStatus, 3000)
    } catch (err: any) {
      alert(err?.message || 'Không thể mở trình duyệt Muse')
    } finally {
      setLaunchingBrowser(false)
    }
  }

  // 4. Mở thư mục tải về
  async function handleOpenFolder() {
    try {
      await api.openMuseFolder()
    } catch (err: any) {
      alert(err?.message || 'Không thể mở thư mục trên máy')
    }
  }

  // 5. Thêm Style Preset
  function handleAddStyle(stylePrompt: string) {
    setPrompt(prev => {
      const trimmed = prev.trim()
      if (!trimmed) return stylePrompt
      if (trimmed.includes(stylePrompt)) return trimmed
      return `${trimmed}, ${stylePrompt}`
    })
  }

  // Xử lý upload file media tham chiếu
  async function handleFilesSelected(files: FileList | File[]) {
    const arr = Array.from(files)
    if (arr.length === 0) return
    setUploadingMedia(true)
    try {
      for (const f of arr) {
        const res = await api.uploadMuseMedia(f)
        if (res.ok) {
          setMediaList(prev => [
            ...prev,
            {
              id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              name: res.file_name,
              path: res.file_path,
              type: res.file_type,
              size: res.file_size,
              previewUrl: `${API_URL}${res.preview_url}`,
            },
          ])
        }
      }
    } catch (err: any) {
      alert(err?.message || 'Lỗi khi tải file media lên')
    } finally {
      setUploadingMedia(false)
    }
  }

  function handleRemoveMedia(id: string) {
    setMediaList(prev => prev.filter(m => m.id !== id))
  }

  function handleAddManualPath() {
    const p = manualPathInput.trim()
    if (!p) return
    const isVid = p.toLowerCase().endsWith('.mp4') || p.toLowerCase().endsWith('.webm') || p.toLowerCase().endsWith('.mov')
    setMediaList(prev => [
      ...prev,
      {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name: p.split(/[\\/]/).pop() || p,
        path: p,
        type: isVid ? 'video' : 'image',
        size: 0,
        previewUrl: '',
      },
    ])
    setManualPathInput('')
    setShowManualInput(false)
  }

  // 6. Xử lý Sinh Video
  async function handleGenerate() {
    const cleanPrompt = prompt.trim()
    if (!cleanPrompt || isGenerating) return

    setIsGenerating(true)
    setGenError('')
    setElapsedSec(0)

    timerRef.current = setInterval(() => {
      setElapsedSec(sec => sec + 1)
    }, 1000)

    try {
      const images = mediaList.filter(m => m.type === 'image').map(m => m.path)
      const videos = mediaList.filter(m => m.type === 'video').map(m => m.path)
      const allMedia = mediaList.map(m => m.path)

      const result: MuseGenerateResult = await api.generateMuseVideo({
        prompt: cleanPrompt,
        reference_image: images.length > 0 ? images[0] : (referenceImage.trim() || undefined),
        reference_images: images.length > 0 ? images : undefined,
        reference_video: videos.length > 0 ? videos[0] : undefined,
        reference_videos: videos.length > 0 ? videos : undefined,
        reference_media: allMedia.length > 0 ? allMedia : undefined,
        use_side_chat: useSideChat,
        continuation: continuation,
      })

      if (result.ok && result.local_path) {
        // Cập nhật monitor sang video mới sinh
        const filename = result.local_path.split(/[\\/]/).pop() || 'muse_video.mp4'
        setActiveVideo({
          id: filename,
          title: filename,
          streamUrl: api.getVideoMediaUrl(filename),
          localPath: result.local_path,
          fileSize: result.file_size || undefined,
          durationSec: result.duration_seconds || undefined,
          createdAt: result.created_at,
        })
        // Tải lại lịch sử
        loadHistory()
      } else {
        setGenError(result.error || 'Muse không thể tạo video. Vui lòng thử lại.')
      }
    } catch (err: any) {
      setGenError(err?.message || 'Lỗi khi kết nối với Muse Service')
    } finally {
      if (timerRef.current) {
        clearInterval(timerRef.current)
        timerRef.current = null
      }
      setIsGenerating(false)
    }
  }

  // Sao chép đường dẫn file
  function handleCopyPath(path?: string) {
    if (!path) return
    navigator.clipboard.writeText(path)
    setCopiedPath(true)
    setTimeout(() => setCopiedPath(false), 2000)
  }

  // Chọn video từ gallery
  function handleSelectClip(item: MuseHistoryItem) {
    setActiveVideo({
      id: item.id,
      title: item.filename,
      streamUrl: api.getVideoMediaUrl(item.filename),
      localPath: item.local_path,
      fileSize: item.file_size,
      createdAt: item.created_at,
    })
  }

  const isConnected = Boolean(status?.is_connected)

  return (
    <div style={{ maxWidth: 1400, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 18 }}>
      {/* Top Header Bar */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 12,
          padding: '14px 18px',
          background: '#ffffff',
          border: '1px solid #e2e8f0',
          borderRadius: 8,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div
            style={{
              width: 38,
              height: 38,
              borderRadius: 8,
              background: '#0f172a',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
            }}
          >
            <Sparkles size={18} />
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <h1 style={{ fontSize: 16, fontWeight: 700, color: '#0f172a', margin: 0 }}>
                Muse Studio
              </h1>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: '1px 7px',
                  borderRadius: 10,
                  background: '#eff6ff',
                  color: '#1d4ed8',
                  border: '1px solid #bfdbfe',
                }}
              >
                Meta Muse Spark
              </span>
            </div>
            <p style={{ fontSize: 12, color: '#64748b', margin: '2px 0 0' }}>
              Không gian sáng tạo video điện ảnh — Tự động hóa qua Meta Muse Cloud VM &amp; Chrome CDP
            </p>
          </div>
        </div>

        {/* Toolbar Controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {/* Status Indicator */}
          <div
            onClick={checkStatus}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 6,
              fontSize: 11.5,
              fontWeight: 600,
              background: isConnected ? '#ecfdf5' : '#fef3c7',
              color: isConnected ? '#15803d' : '#b45309',
              border: isConnected ? '1px solid #bbf7d0' : '1px solid #fde68a',
              cursor: 'pointer',
            }}
            title="Bấm để kiểm tra lại trạng thái kết nối"
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: '50%',
                background: isConnected ? '#16a34a' : '#d97706',
              }}
            />
            {checkingStatus ? 'Đang kiểm tra...' : isConnected ? 'Sẵn sàng' : 'Chưa kết nối'}
            <RefreshCw size={11} className={checkingStatus ? 'animate-spin' : ''} style={{ marginLeft: 2 }} />
          </div>

          {/* Open Chrome */}
          <button
            type="button"
            onClick={handleOpenBrowser}
            disabled={launchingBrowser}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 11px',
              borderRadius: 6,
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#334155',
              fontSize: 12,
              fontWeight: 600,
              cursor: launchingBrowser ? 'not-allowed' : 'pointer',
            }}
          >
            {launchingBrowser ? <Loader2 size={12} className="animate-spin" /> : <ExternalLink size={12} />}
            Mở Muse Chrome
          </button>

          {/* Open Downloads Folder */}
          <button
            type="button"
            onClick={handleOpenFolder}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 11px',
              borderRadius: 6,
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              color: '#334155',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            <FolderOpen size={12} />
            Thư mục video
          </button>

          {/* Settings Shortcut */}
          <button
            type="button"
            onClick={() => setActivePage('Cài đặt')}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              padding: '6px 10px',
              borderRadius: 6,
              background: '#f8fafc',
              border: '1px solid #e2e8f0',
              color: '#64748b',
              fontSize: 12,
              fontWeight: 500,
              cursor: 'pointer',
            }}
            title="Mở cấu hình kỹ thuật Muse trong phần Cài đặt"
          >
            <Settings size={12} />
            Cài đặt
          </button>
        </div>
      </header>

      {/* Main Studio Split Layout */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(400px, 460px) 1fr',
          gap: 18,
          alignItems: 'start',
        }}
      >
        {/* ================= LEFT COLUMN: WORKSPACE ================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Prompt Editor Card */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                Mô tả cảnh quay (Video Prompt)
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 11, color: '#94a3b8' }}>
                  {prompt.length} ký tự
                </span>
                {prompt.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setPrompt('')}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#94a3b8',
                      cursor: 'pointer',
                      padding: 2,
                    }}
                    title="Xóa nội dung prompt"
                  >
                    <Trash2 size={13} />
                  </button>
                )}
              </div>
            </div>

            <textarea
              rows={5}
              value={prompt}
              onChange={e => setPrompt(e.target.value)}
              placeholder="Nhập prompt tiếng Anh hoặc tiếng Việt (Ví dụ: A cinematic drone flight over a misty pine forest in sunrise, ultra detailed, 4k)..."
              style={{
                width: '100%',
                padding: '10px 12px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 13,
                lineHeight: '1.5',
                color: '#0f172a',
                background: '#ffffff',
                boxSizing: 'border-box',
                resize: 'vertical',
                outline: 'none',
                fontFamily: 'inherit',
              }}
            />

            {/* Quick Style Enhancer Pills */}
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: '#64748b', marginBottom: 6 }}>
                Gợi ý phong cách nhanh:
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {PRESET_STYLES.map(style => (
                  <button
                    key={style.label}
                    type="button"
                    onClick={() => handleAddStyle(style.prompt)}
                    style={{
                      padding: '4px 9px',
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 500,
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      color: '#334155',
                      cursor: 'pointer',
                    }}
                  >
                    + {style.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Advanced Studio Parameters Card */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
              Tùy chọn tạo sinh
            </div>

            {/* Toggle 1: Side Chat */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
                  Phân luồng New Chat riêng biệt
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  Tự động bấm '+ New chat' để video không bị dính vào dự án cũ
                </div>
              </div>
              <input
                type="checkbox"
                checked={useSideChat}
                onChange={e => setUseSideChat(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#2563eb' }}
              />
            </div>

            {/* Toggle 2: Continuation */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '8px 10px',
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 6,
              }}
            >
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a' }}>
                  Tiếp nối video trước (Continuation)
                </div>
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  Giữ ngữ cảnh để render phân cảnh kế tiếp trong cùng đoạn phim
                </div>
              </div>
              <input
                type="checkbox"
                checked={continuation}
                onChange={e => setContinuation(e.target.checked)}
                style={{ width: 16, height: 16, cursor: 'pointer', accentColor: '#2563eb' }}
              />
            </div>

            {/* Reference Media Section (Ảnh & Video tham chiếu) */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <label style={{ fontSize: 12, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <UploadCloud size={14} color="#2563eb" />
                  Media tham chiếu (Ảnh & Video)
                </label>
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  {mediaList.length} file đã chọn
                </span>
              </div>

              {/* Technical Limits Banner */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 3,
                  padding: '7px 10px',
                  borderRadius: 6,
                  background: '#f1f5f9',
                  border: '1px solid #e2e8f0',
                  fontSize: 11,
                  lineHeight: '1.4',
                  color: '#475569',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <ImageIcon size={11} color="#0284c7" />
                  <span><strong>Ảnh:</strong> Tối đa ~10-15 ảnh (ngân sách 8MB inline, tự động tối ưu qua Canvas)</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <Video size={11} color="#7c3aed" />
                  <span><strong>Video:</strong> Tối đa 100MB/video (kế thừa chuyển động, ghép nối phân cảnh)</span>
                </div>
              </div>

              {/* Dropzone */}
              <div
                onDragOver={e => { e.preventDefault(); setIsDragOver(true) }}
                onDragLeave={() => setIsDragOver(false)}
                onDrop={e => {
                  e.preventDefault()
                  setIsDragOver(false)
                  if (e.dataTransfer.files) handleFilesSelected(e.dataTransfer.files)
                }}
                onClick={() => fileInputRef.current?.click()}
                style={{
                  border: `2px dashed ${isDragOver ? '#2563eb' : '#cbd5e1'}`,
                  background: isDragOver ? '#eff6ff' : '#f8fafc',
                  borderRadius: 6,
                  padding: '12px 14px',
                  textAlign: 'center',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept="image/*,video/mp4,video/webm"
                  style={{ display: 'none' }}
                  onChange={e => {
                    if (e.target.files) handleFilesSelected(e.target.files)
                    e.target.value = ''
                  }}
                />
                {uploadingMedia ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#2563eb', fontSize: 12, fontWeight: 500 }}>
                    <Loader2 size={16} className="animate-spin" />
                    Đang tải media lên...
                  </div>
                ) : (
                  <>
                    <UploadCloud size={20} color="#64748b" />
                    <div style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                      Kéo & thả hoặc click để chọn ảnh / video
                    </div>
                    <div style={{ fontSize: 10, color: '#94a3b8' }}>
                      Hỗ trợ PNG, JPG, WEBP (nhiều ảnh) & MP4, WEBM (video)
                    </div>
                  </>
                )}
              </div>

              {/* Uploaded Media Chips List */}
              {mediaList.length > 0 && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                  {mediaList.map(item => (
                    <div
                      key={item.id}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '6px 8px',
                        background: '#ffffff',
                        border: '1px solid #e2e8f0',
                        borderRadius: 6,
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, flex: 1 }}>
                        {item.type === 'image' ? (
                          item.previewUrl ? (
                            <img
                              src={item.previewUrl}
                              alt=""
                              style={{ width: 32, height: 32, borderRadius: 4, objectFit: 'cover', border: '1px solid #cbd5e1' }}
                            />
                          ) : (
                            <div style={{ width: 32, height: 32, borderRadius: 4, background: '#e0f2fe', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <ImageIcon size={16} color="#0284c7" />
                            </div>
                          )
                        ) : (
                          <div style={{ width: 32, height: 32, borderRadius: 4, background: '#f3e8ff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <Video size={16} color="#7c3aed" />
                          </div>
                        )}
                        <div style={{ minWidth: 0, flex: 1 }}>
                          <div style={{ fontSize: 12, fontWeight: 600, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                            {item.name}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#64748b' }}>
                            <span
                              style={{
                                padding: '1px 5px',
                                borderRadius: 3,
                                fontWeight: 600,
                                fontSize: 9,
                                background: item.type === 'image' ? '#e0f2fe' : '#f3e8ff',
                                color: item.type === 'image' ? '#0369a1' : '#6b21a8',
                              }}
                            >
                              {item.type === 'image' ? 'ẢNH' : 'VIDEO'}
                            </span>
                            {item.size > 0 && <span>{(item.size / 1024 / 1024).toFixed(2)} MB</span>}
                          </div>
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveMedia(item.id)}
                        style={{
                          background: 'transparent',
                          border: 'none',
                          color: '#94a3b8',
                          cursor: 'pointer',
                          padding: 4,
                          borderRadius: 4,
                        }}
                        title="Xoá media này"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {/* Manual Path Toggle */}
              <div style={{ marginTop: 2 }}>
                {!showManualInput ? (
                  <button
                    type="button"
                    onClick={() => setShowManualInput(true)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#2563eb',
                      fontSize: 11,
                      fontWeight: 500,
                      cursor: 'pointer',
                      padding: 0,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Plus size={12} />
                    Nhập đường dẫn file thủ công từ máy tính
                  </button>
                ) : (
                  <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                    <input
                      type="text"
                      value={manualPathInput}
                      onChange={e => setManualPathInput(e.target.value)}
                      placeholder="D:\Path\To\image.png hoặc video.mp4"
                      style={{
                        flex: 1,
                        padding: '6px 8px',
                        borderRadius: 4,
                        border: '1px solid #cbd5e1',
                        fontSize: 11,
                        outline: 'none',
                      }}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddManualPath() }}
                    />
                    <button
                      type="button"
                      onClick={handleAddManualPath}
                      disabled={!manualPathInput.trim()}
                      style={{
                        padding: '6px 10px',
                        borderRadius: 4,
                        background: '#2563eb',
                        color: '#fff',
                        border: 'none',
                        fontSize: 11,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                    >
                      Thêm
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowManualInput(false)}
                      style={{
                        padding: '6px 8px',
                        borderRadius: 4,
                        background: '#f1f5f9',
                        color: '#64748b',
                        border: '1px solid #e2e8f0',
                        fontSize: 11,
                        cursor: 'pointer',
                      }}
                    >
                      Hủy
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Primary Action Button Box */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <button
              type="button"
              onClick={handleGenerate}
              disabled={isGenerating || !prompt.trim()}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                width: '100%',
                padding: '12px 16px',
                borderRadius: 6,
                background: isGenerating || !prompt.trim() ? '#94a3b8' : '#2563eb',
                border: 'none',
                color: '#ffffff',
                fontSize: 13.5,
                fontWeight: 600,
                cursor: isGenerating || !prompt.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {isGenerating ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Đang khởi tạo video ({elapsedSec}s)...
                </>
              ) : (
                <>
                  <Play size={15} fill="currentColor" />
                  Khởi tạo video với Muse Spark
                </>
              )}
            </button>

            {isGenerating && (
              <div
                style={{
                  padding: '10px 12px',
                  background: '#eff6ff',
                  border: '1px solid #bfdbfe',
                  borderRadius: 6,
                  fontSize: 11.5,
                  color: '#1e40af',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <Clock size={14} className="animate-spin" />
                <span>
                  Đang kết nối Chrome CDP, gõ prompt và render trên Meta VM ({elapsedSec}s). Vui lòng đợi trong 30-75 giây...
                </span>
              </div>
            )}

            {genError && (
              <div
                style={{
                  padding: '10px 12px',
                  background: '#fef2f2',
                  border: '1px solid #fecaca',
                  borderRadius: 6,
                  fontSize: 12,
                  color: '#991b1b',
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                }}
              >
                <AlertCircle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{genError}</span>
              </div>
            )}

            <div style={{ fontSize: 11, color: '#64748b', textAlign: 'center' }}>
              Video sau khi render xong sẽ tự động trích xuất blob MP4 và hiển thị ngay trên màn hình.
            </div>
          </div>
        </div>

        {/* ================= RIGHT COLUMN: MONITOR & HISTORY ================= */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Active Video Player Monitor Card */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Film size={15} style={{ color: '#0f172a' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                  {activeVideo ? activeVideo.title : 'Màn hình xem trước video'}
                </span>
              </div>

              {activeVideo?.fileSize && (
                <span style={{ fontSize: 11, color: '#64748b' }}>
                  {(activeVideo.fileSize / 1024).toFixed(1)} KB
                </span>
              )}
            </div>

            {/* Video Viewport */}
            <div
              style={{
                width: '100%',
                aspectRatio: '16 / 9',
                background: '#090d16',
                borderRadius: 6,
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                position: 'relative',
              }}
            >
              {activeVideo ? (
                <video
                  key={activeVideo.streamUrl}
                  src={activeVideo.streamUrl}
                  controls
                  autoPlay
                  loop
                  playsInline
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'contain',
                  }}
                />
              ) : (
                <div style={{ textAlign: 'center', color: '#64748b', padding: 20 }}>
                  <Video size={40} style={{ opacity: 0.4, marginBottom: 8 }} />
                  <div style={{ fontSize: 13, fontWeight: 500, color: '#94a3b8' }}>
                    Chưa có video được chọn
                  </div>
                  <div style={{ fontSize: 11.5, color: '#64748b', marginTop: 4 }}>
                    Nhập prompt bên trái và bấm 'Khởi tạo video' hoặc chọn clip từ thư viện bên dưới.
                  </div>
                </div>
              )}
            </div>

            {/* Video Action Toolbar */}
            {activeVideo && (
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: 8,
                  paddingTop: 4,
                  borderTop: '1px solid #f1f5f9',
                }}
              >
                <div style={{ fontSize: 11, color: '#64748b' }}>
                  {activeVideo.durationSec
                    ? `Render trong ${activeVideo.durationSec}s`
                    : 'Đã lưu trong thư mục tải về'}
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  {/* Download MP4 file */}
                  <a
                    href={activeVideo.streamUrl}
                    download={activeVideo.title}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '5px 10px',
                      borderRadius: 4,
                      background: '#ffffff',
                      border: '1px solid #cbd5e1',
                      color: '#0f172a',
                      fontSize: 11.5,
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    <Download size={12} />
                    Tải MP4
                  </a>

                  {/* Copy Path */}
                  {activeVideo.localPath && (
                    <button
                      type="button"
                      onClick={() => handleCopyPath(activeVideo.localPath)}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                        padding: '5px 10px',
                        borderRadius: 4,
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        color: '#0f172a',
                        fontSize: 11.5,
                        fontWeight: 600,
                        cursor: 'pointer',
                      }}
                      title={activeVideo.localPath}
                    >
                      {copiedPath ? <Check size={12} color="#16a34a" /> : <Copy size={12} />}
                      {copiedPath ? 'Đã sao chép' : 'Sao chép đường dẫn'}
                    </button>
                  )}

                  {/* Continue this scene */}
                  <button
                    type="button"
                    onClick={() => {
                      setContinuation(true)
                      setPrompt(prev => `${prev} -> next scene continuing smoothly`)
                    }}
                    style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 4,
                      padding: '5px 10px',
                      borderRadius: 4,
                      background: '#eff6ff',
                      border: '1px solid #bfdbfe',
                      color: '#1e40af',
                      fontSize: 11.5,
                      fontWeight: 600,
                      cursor: 'pointer',
                    }}
                  >
                    <Layers size={12} />
                    Nối cảnh này
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Recent Clips Gallery Card */}
          <div
            style={{
              background: '#ffffff',
              border: '1px solid #e2e8f0',
              borderRadius: 8,
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <History size={14} style={{ color: '#0f172a' }} />
                <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
                  Thư viện video đã tạo ({history.length})
                </span>
              </div>
              <button
                type="button"
                onClick={loadHistory}
                disabled={loadingHistory}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 4,
                  background: 'transparent',
                  border: 'none',
                  color: '#64748b',
                  fontSize: 11.5,
                  cursor: 'pointer',
                  padding: 2,
                }}
              >
                <RefreshCw size={11} className={loadingHistory ? 'animate-spin' : ''} />
                Làm mới
              </button>
            </div>

            {history.length === 0 ? (
              <div
                style={{
                  padding: '24px 0',
                  textAlign: 'center',
                  color: '#94a3b8',
                  fontSize: 12,
                }}
              >
                Chưa có clip nào trong thư mục tải về. Video tạo từ Muse Studio sẽ hiển thị tại đây.
              </div>
            ) : (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                  gap: 10,
                  maxHeight: 320,
                  overflowY: 'auto',
                  paddingRight: 4,
                }}
              >
                {history.map(item => {
                  const isSelected = activeVideo?.id === item.id
                  return (
                    <div
                      key={item.id}
                      onClick={() => handleSelectClip(item)}
                      onMouseEnter={e => {
                        const vid = e.currentTarget.querySelector('video')
                        if (vid) vid.play().catch(() => {})
                      }}
                      onMouseLeave={e => {
                        const vid = e.currentTarget.querySelector('video')
                        if (vid) {
                          vid.pause()
                          vid.currentTime = 0.5
                        }
                      }}
                      style={{
                        padding: 8,
                        borderRadius: 6,
                        border: isSelected ? '2px solid #2563eb' : '1px solid #e2e8f0',
                        background: isSelected ? '#eff6ff' : '#f8fafc',
                        cursor: 'pointer',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        transition: 'border-color 0.15s ease',
                      }}
                    >
                      <div
                        style={{
                          width: '100%',
                          aspectRatio: '16 / 9',
                          background: '#090d16',
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          position: 'relative',
                          overflow: 'hidden',
                        }}
                      >
                        <video
                          src={`${api.getVideoMediaUrl(item.filename)}#t=0.5`}
                          preload="metadata"
                          muted
                          playsInline
                          loop
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover',
                            display: 'block',
                          }}
                        />
                        <span
                          style={{
                            position: 'absolute',
                            bottom: 4,
                            right: 4,
                            fontSize: 9.5,
                            fontWeight: 600,
                            padding: '1px 5px',
                            borderRadius: 3,
                            background: 'rgba(0,0,0,0.7)',
                            color: '#ffffff',
                            pointerEvents: 'none',
                          }}
                        >
                          MP4
                        </span>
                      </div>

                      <div>
                        <div
                          style={{
                            fontSize: 11.5,
                            fontWeight: 600,
                            color: '#0f172a',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={item.filename}
                        >
                          {item.filename}
                        </div>
                        <div
                          style={{
                            display: 'flex',
                            justifyContent: 'space-between',
                            fontSize: 10.5,
                            color: '#64748b',
                            marginTop: 2,
                          }}
                        >
                          <span>{(item.file_size / 1024).toFixed(0)} KB</span>
                          <span>{new Date(item.created_at).toLocaleDateString('vi-VN')}</span>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
