import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  CheckCircle2,
  CheckSquare,
  ExternalLink,
  Film,
  HardDrive,
  Loader2,
  RefreshCw,
  Search,
  Square,
  UploadCloud,
} from 'lucide-react'
import * as api from '../services/discoverApi'
import type { DriveUploadTask, ScoutedVideoItem } from '../types'

const NICHE_PRESETS = [
  {
    id: 'bento',
    label: 'Cơm Hộp Bento',
    query: 'Nấu Ăn Cùng TikTok Cách Làm Cơm Hộp Đơn Giản Bento Món Ngon Mỗi Ngày',
  },
  {
    id: 'street_snack',
    label: 'Ăn Vặt Đường Phố',
    query: 'Nấu Ăn Cùng TikTok Các Món Ăn Vặt Đường Phố Hấp Dẫn Dễ Làm',
  },
  {
    id: 'mochi_matcha',
    label: 'Bánh Ngọt & Mochi',
    query: 'Nấu Ăn Cùng TikTok Làm Các Loại Bánh Kem Mochi Từ Matcha Trà Xanh',
  },
  {
    id: 'spicy_asmr',
    label: 'ASMR Ẩm Thực',
    query: 'Nấu Ăn Cùng TikTok Món Cay Đừng Xem Khi Đói ASMR Nấu Ăn Đơn Giản',
  },
  {
    id: 'family_meal',
    label: 'Cơm Gia Đình',
    query: 'Cơm Gia Đình Nấu Ăn Cùng TikTok Món Ngon Mỗi Ngày Đơn Giản Ấm Cúng',
  },
]

interface NicheVideoScoutTabProps {
  onSendToStudioBatch?: (urls: string[]) => void
}

function getThumbnailUrl(video: ScoutedVideoItem): string {
  const vid =
    video.video_id && video.video_id !== 'VIDEO_ID'
      ? video.video_id
      : video.url.match(/(?:v=|youtu\.be\/|embed\/|shorts\/)([A-Za-z0-9_-]{11})/)?.[1]
  if (vid) {
    return `https://i.ytimg.com/vi/${vid}/hqdefault.jpg`
  }
  if (video.thumbnail_url && !video.thumbnail_url.includes('VIDEO_ID') && video.thumbnail_url.startsWith('http')) {
    return video.thumbnail_url
  }
  return ''
}

export function NicheVideoScoutTab({ onSendToStudioBatch }: NicheVideoScoutTabProps) {
  // Search & Prompt State
  const [query, setQuery] = useState('')
  const [directLinksText, setDirectLinksText] = useState('')
  const [showDirectLinksInput, setShowDirectLinksInput] = useState(false)
  const [isSearching, setIsSearching] = useState(false)

  // Videos State
  const [videos, setVideos] = useState<ScoutedVideoItem[]>([])
  const [selectedUrls, setSelectedUrls] = useState<string[]>([])
  const [prefixText, setPrefixText] = useState('[Douyin]_')

  // Google Drive State
  const [folders, setFolders] = useState<any[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState<string>('')
  const [loadingFolders, setLoadingFolders] = useState(false)
  const [uploading, setUploading] = useState(false)

  // Tasks State
  const [driveTasks, setDriveTasks] = useState<DriveUploadTask[]>([])
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const pollTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  function showToast(text: string) {
    setToastMsg(text)
    setTimeout(() => setToastMsg(null), 4500)
  }

  // Load Google Drive folders on mount
  const loadFolders = useCallback(async () => {
    setLoadingFolders(true)
    try {
      const list = await api.fetchDriveFolders('root')
      setFolders(list || [])
      if (list && list.length > 0 && !selectedFolderId) {
        setSelectedFolderId(list[0].id)
      }
    } catch {
      /* ignore if drive not connected */
    } finally {
      setLoadingFolders(false)
    }
  }, [selectedFolderId])

  // Stop polling helper
  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
  }, [])

  // Smart check task status: auto stop polling when all tasks reach terminal state
  const checkTasksStatus = useCallback(async () => {
    try {
      const list = await api.fetchDriveUploadTasks()
      const taskList = list || []
      setDriveTasks(taskList)

      const hasActive = taskList.some(
        t => t.status === 'pending' || t.status === 'downloading' || t.status === 'uploading'
      )

      if (!hasActive) {
        stopPolling()
      }
      return hasActive
    } catch {
      return false
    }
  }, [stopPolling])

  // Start polling only when there is active work
  const startPolling = useCallback(() => {
    stopPolling()
    pollTimerRef.current = setInterval(async () => {
      const stillActive = await checkTasksStatus()
      if (!stillActive) {
        stopPolling()
      }
    }, 3000)
  }, [checkTasksStatus, stopPolling])

  // On mount: only fetch once. If tasks from previous session are still running, poll. Otherwise remain idle.
  useEffect(() => {
    loadFolders()
    checkTasksStatus().then(hasActive => {
      if (hasActive) {
        startPolling()
      }
    })
    return () => {
      stopPolling()
    }
  }, [loadFolders, checkTasksStatus, startPolling, stopPolling])

  // Clean video title to standard file name
  function cleanFileName(title: string): string {
    return title
      .replace(/[\\/:*?"<>|]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
  }

  // Handle Scout with Gemini
  async function handleScout(customQuery?: string) {
    let rawQ = (customQuery !== undefined ? customQuery : query).trim()
    // Sanitize query to avoid triggering Gemini safety filters
    const q = rawQ
      .replace(/[\u4e00-\u9fff]+/g, '')
      .replace(/[\[\(【「［].*?[\]\)】」］]/g, '')
      .replace(/\b(trung\s*qu[oố]c|china|chinese|nội địa trung)\b/gi, 'Châu Á')
      .replace(/\b(douyin|dôuyin)\b/gi, 'TikTok')
      .replace(/\s+/g, ' ')
      .trim()

    const directUrls = directLinksText
      .split('\n')
      .map(s => s.trim())
      .filter(s => s.startsWith('http'))

    if (!q && directUrls.length === 0) {
      showToast('Vui lòng nhập từ khóa tìm kiếm hoặc dán ít nhất 1 đường link YouTube!')
      return
    }

    setIsSearching(true)
    try {
      const res = await api.scoutNicheVideos(q, undefined, directUrls.length > 0 ? directUrls : undefined)
      const list: ScoutedVideoItem[] = (res.results || []).map(item => ({
        ...item,
        custom_name: `${cleanFileName(item.title)}.mp4`,
      }))

      setVideos(list)
      setSelectedUrls(list.map(v => v.url)) // Default select all
      if (list.length > 0) {
        showToast(`Đã tìm thấy ${list.length} video phù hợp.`)
      } else {
        showToast('Không tìm thấy video phù hợp. Bạn có thể thử đổi từ khóa khác.')
      }
    } catch (err: any) {
      showToast(`Lỗi tìm kiếm: ${err.message || 'Không kết nối được dịch vụ'}`)
    } finally {
      setIsSearching(false)
    }
  }

  // Handle Preset Click
  function handlePresetClick(preset: typeof NICHE_PRESETS[0]) {
    setQuery(preset.query)
    handleScout(preset.query)
  }

  // Toggle selection
  function toggleSelect(url: string) {
    setSelectedUrls(prev => (prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url]))
  }

  function toggleSelectAll() {
    if (selectedUrls.length === videos.length) {
      setSelectedUrls([])
    } else {
      setSelectedUrls(videos.map(v => v.url))
    }
  }

  // Rename individual video custom name
  function handleRenameChange(url: string, newName: string) {
    setVideos(prev =>
      prev.map(v => (v.url === url ? { ...v, custom_name: newName } : v))
    )
  }

  // Apply Prefix to all custom names
  function applyPrefixToAll() {
    if (!prefixText) return
    setVideos(prev =>
      prev.map(v => {
        const raw = v.custom_name || `${cleanFileName(v.title)}.mp4`
        const withoutOldPrefix = raw.replace(/^\[.*?\]_?/, '')
        return {
          ...v,
          custom_name: `${prefixText}${withoutOldPrefix}`,
        }
      })
    )
    showToast(`Đã áp dụng tiền tố "${prefixText}" cho toàn bộ danh sách.`)
  }

  // Trigger Drive Upload
  async function handleStartUpload() {
    const selectedItems = videos
      .filter(v => selectedUrls.includes(v.url))
      .map(v => ({
        url: v.url,
        title: v.title,
        custom_name: v.custom_name || `${cleanFileName(v.title)}.mp4`,
      }))

    if (selectedItems.length === 0) {
      showToast('Vui lòng chọn ít nhất 1 video để lưu vào Drive.')
      return
    }

    setUploading(true)
    try {
      await api.startDriveUploadBatch(selectedItems, selectedFolderId || undefined)
      showToast(`Đã thêm ${selectedItems.length} video vào hàng đợi lưu trữ Drive.`)
      await checkTasksStatus()
      startPolling()
    } catch (err: any) {
      showToast(`Lỗi bắt đầu upload: ${err.message || 'Không thể tạo tác vụ'}`)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 4 }}>
      {/* Toast Notification */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            top: 24,
            right: 24,
            zIndex: 9999,
            padding: '10px 18px',
            borderRadius: 8,
            background: '#0f172a',
            color: '#fff',
            fontSize: 13,
            fontWeight: 500,
            boxShadow: '0 10px 25px -5px rgba(0,0,0,0.3)',
            display: 'flex',
            alignItems: 'center',
            gap: 10,
          }}
        >
          <span>{toastMsg}</span>
        </div>
      )}

      {/* 1. Header & AI Search Card */}
      <div
        className="card"
        style={{
          padding: 20,
          background: '#ffffff',
          borderRadius: 12,
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: '#0f172a' }}>
              Khai Thác Video &amp; Lưu Trữ Google Drive
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: '#64748b' }}>
              Tìm kiếm video theo chủ đề hoặc dán liên kết YouTube để tải xuống và đồng bộ hóa trực tiếp vào Google Drive.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowDirectLinksInput(!showDirectLinksInput)}
            style={{
              padding: '6px 14px',
              borderRadius: 7,
              border: '1px solid #cbd5e1',
              background: showDirectLinksInput ? '#f1f5f9' : '#fff',
              color: '#334155',
              fontSize: 12.5,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            {showDirectLinksInput ? 'Ẩn ô nhập liên kết' : 'Dán liên kết YouTube'}
          </button>
        </div>

        {/* Quick Presets */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: '#64748b' }}>Chủ đề gợi ý:</span>
          {NICHE_PRESETS.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => handlePresetClick(p)}
              disabled={isSearching}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                border: query === p.query ? '1px solid #2563eb' : '1px solid #e2e8f0',
                background: query === p.query ? '#eff6ff' : '#f8fafc',
                color: query === p.query ? '#1d4ed8' : '#475569',
                fontSize: 12,
                fontWeight: 500,
                cursor: 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>

        {/* Direct Links Textarea (Collapsible) */}
        {showDirectLinksInput && (
          <div style={{ background: '#f8fafc', padding: 12, borderRadius: 8, border: '1px dashed #cbd5e1' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: '#334155' }}>
                Dán danh sách liên kết YouTube (mỗi liên kết 1 dòng):
              </span>
              <button
                type="button"
                onClick={() => setDirectLinksText('')}
                style={{ border: 'none', background: 'transparent', color: '#94a3b8', fontSize: 11, cursor: 'pointer' }}
              >
                Xóa tất cả
              </button>
            </div>
            <textarea
              rows={3}
              value={directLinksText}
              onChange={e => setDirectLinksText(e.target.value)}
              placeholder="https://www.youtube.com/watch?v=MEMAI9iJsYg&#10;https://www.youtube.com/watch?v=NZlynWbzqjM"
              style={{
                width: '100%',
                padding: '8px 12px',
                borderRadius: 6,
                border: '1px solid #cbd5e1',
                fontSize: 12,
                fontFamily: 'monospace',
                resize: 'vertical',
                boxSizing: 'border-box',
              }}
            />
          </div>
        )}

        {/* Search Bar Input */}
        <div style={{ display: 'flex', gap: 10 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <Search
              size={16}
              style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }}
            />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleScout()}
              placeholder="Nhập từ khóa tìm kiếm hoặc chủ đề video... (Nhấn Enter để tìm kiếm)"
              disabled={isSearching}
              style={{
                width: '100%',
                padding: '9px 14px 9px 38px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                fontSize: 13,
                boxSizing: 'border-box',
                outline: 'none',
              }}
            />
          </div>

          <button
            type="button"
            onClick={() => handleScout()}
            disabled={isSearching}
            style={{
              padding: '0 22px',
              borderRadius: 8,
              border: 'none',
              background: '#0f172a',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: isSearching ? 'not-allowed' : 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              opacity: isSearching ? 0.75 : 1,
            }}
          >
            {isSearching && <Loader2 size={15} className="animate-spin" />}
            <span>{isSearching ? 'Đang tìm kiếm...' : 'Tìm Kiếm Video'}</span>
          </button>
        </div>
      </div>

      {/* 2. Actions & Google Drive Control Bar */}
      {videos.length > 0 && (
        <div
          className="card"
          style={{
            padding: '12px 18px',
            background: '#fff',
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          {/* Select all & Count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <button
              type="button"
              onClick={toggleSelectAll}
              style={{
                border: 'none',
                background: 'transparent',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 13,
                fontWeight: 600,
                color: '#334155',
                cursor: 'pointer',
              }}
            >
              {selectedUrls.length === videos.length ? (
                <CheckSquare size={16} color="#0f172a" />
              ) : (
                <Square size={16} color="#94a3b8" />
              )}
              <span>Chọn tất cả ({selectedUrls.length}/{videos.length})</span>
            </button>

            {/* Prefix tool */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>Tiền tố tệp:</span>
              <input
                type="text"
                value={prefixText}
                onChange={e => setPrefixText(e.target.value)}
                style={{
                  width: 90,
                  padding: '4px 8px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: 12,
                }}
              />
              <button
                type="button"
                onClick={applyPrefixToAll}
                style={{
                  padding: '4px 10px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  background: '#f8fafc',
                  fontSize: 11.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                  color: '#334155',
                }}
              >
                Áp dụng
              </button>
            </div>
          </div>

          {/* Drive destination & Upload CTA */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <HardDrive size={15} color="#475569" />
              <span style={{ fontSize: 12, color: '#64748b' }}>Thư mục Drive:</span>
              <select
                value={selectedFolderId}
                onChange={e => setSelectedFolderId(e.target.value)}
                disabled={loadingFolders || folders.length === 0}
                style={{
                  padding: '5px 10px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  fontSize: 12.5,
                  fontWeight: 500,
                  color: '#0f172a',
                  background: '#fff',
                  maxWidth: 180,
                }}
              >
                {folders.length === 0 ? (
                  <option value="">Thư mục mặc định (Root)</option>
                ) : (
                  folders.map(f => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Send to Studio button if available */}
            {onSendToStudioBatch && (
              <button
                type="button"
                onClick={() => onSendToStudioBatch(videos.filter(v => selectedUrls.includes(v.url)).map(v => v.url))}
                style={{
                  padding: '6px 14px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  background: '#fff',
                  color: '#334155',
                  fontSize: 12.5,
                  fontWeight: 500,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                <span>Chuyển sang Studio</span>
              </button>
            )}

            {/* Upload to Drive CTA */}
            <button
              type="button"
              onClick={handleStartUpload}
              disabled={uploading || selectedUrls.length === 0}
              style={{
                padding: '7px 16px',
                borderRadius: 6,
                border: 'none',
                background: '#0284c7',
                color: '#fff',
                fontSize: 12.5,
                fontWeight: 600,
                cursor: uploading || selectedUrls.length === 0 ? 'not-allowed' : 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                opacity: uploading || selectedUrls.length === 0 ? 0.6 : 1,
              }}
            >
              {uploading ? <Loader2 size={15} className="animate-spin" /> : <UploadCloud size={15} />}
              <span>Lưu vào Google Drive ({selectedUrls.length})</span>
            </button>
          </div>
        </div>
      )}

      {/* 3. Videos List */}
      {videos.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {videos.map(v => {
            const isSelected = selectedUrls.includes(v.url)
            const thumbUrl = getThumbnailUrl(v)

            return (
              <div
                key={v.url}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 14,
                  padding: 12,
                  borderRadius: 10,
                  background: isSelected ? '#f8fafc' : '#fff',
                  border: isSelected ? '1px solid #94a3b8' : '1px solid #e2e8f0',
                  transition: 'all 0.15s ease',
                }}
              >
                {/* Checkbox */}
                <button
                  type="button"
                  onClick={() => toggleSelect(v.url)}
                  style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 4 }}
                >
                  {isSelected ? <CheckSquare size={17} color="#0f172a" /> : <Square size={17} color="#94a3b8" />}
                </button>

                {/* Thumbnail */}
                <div
                  style={{
                    width: 144,
                    height: 84,
                    borderRadius: 6,
                    overflow: 'hidden',
                    background: '#0f172a',
                    flexShrink: 0,
                    position: 'relative',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {thumbUrl ? (
                    <img
                      src={thumbUrl}
                      alt={v.title}
                      referrerPolicy="no-referrer"
                      crossOrigin="anonymous"
                      loading="lazy"
                      style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      onError={e => {
                        const target = e.currentTarget
                        if (target.src.includes('hqdefault.jpg')) {
                          target.src = target.src.replace('hqdefault.jpg', 'mqdefault.jpg')
                        } else {
                          target.style.display = 'none'
                        }
                      }}
                    />
                  ) : (
                    <Film size={22} color="#64748b" />
                  )}

                  {v.duration_approx && v.duration_approx !== '—' && (
                    <span
                      style={{
                        position: 'absolute',
                        bottom: 4,
                        right: 4,
                        background: 'rgba(15, 23, 42, 0.85)',
                        color: '#fff',
                        fontSize: 10.5,
                        fontWeight: 600,
                        padding: '1px 5px',
                        borderRadius: 4,
                      }}
                    >
                      {v.duration_approx}
                    </span>
                  )}
                </div>

                {/* Video Info & Rename Input */}
                <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                    <a
                      href={v.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        fontSize: 13.5,
                        fontWeight: 600,
                        color: '#0f172a',
                        textDecoration: 'none',
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={v.title}
                    >
                      {v.title}
                    </a>
                    <a href={v.url} target="_blank" rel="noreferrer" style={{ color: '#94a3b8' }}>
                      <ExternalLink size={13} />
                    </a>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: '#64748b' }}>
                    <span style={{ fontWeight: 600, color: '#334155' }}>Kênh: {v.channel_name}</span>
                    {v.niche_topic && (
                      <span
                        style={{
                          background: '#f1f5f9',
                          color: '#475569',
                          border: '1px solid #e2e8f0',
                          padding: '1px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontWeight: 500,
                        }}
                      >
                        {v.niche_topic}
                      </span>
                    )}
                  </div>

                  {/* Inline Rename File Input */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 }}>
                    <span style={{ fontSize: 11.5, fontWeight: 600, color: '#64748b', whiteSpace: 'nowrap' }}>
                      Tên tệp Drive:
                    </span>
                    <input
                      type="text"
                      value={v.custom_name || ''}
                      onChange={e => handleRenameChange(v.url, e.target.value)}
                      placeholder="Tên tệp khi lưu vào Google Drive..."
                      style={{
                        flex: 1,
                        padding: '4px 10px',
                        borderRadius: 6,
                        border: '1px solid #cbd5e1',
                        fontSize: 12,
                        color: '#0f172a',
                        background: '#fff',
                      }}
                    />
                  </div>

                  {v.reason && (
                    <p style={{ margin: 0, fontSize: 11.5, color: '#64748b', lineHeight: 1.4 }}>
                      Ghi chú: {v.reason}
                    </p>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* 4. Active Drive Upload Tasks Queue */}
      {driveTasks.length > 0 && (
        <div
          className="card"
          style={{
            padding: 18,
            background: '#fff',
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h3 style={{ margin: 0, fontSize: 14, fontWeight: 700, color: '#0f172a' }}>
              Tiến trình tải &amp; lưu trữ Google Drive ({driveTasks.length})
            </h3>
            <button
              type="button"
              onClick={async () => {
                const hasActive = await checkTasksStatus()
                if (hasActive) startPolling()
              }}
              style={{
                border: 'none',
                background: 'transparent',
                color: '#64748b',
                cursor: 'pointer',
                display: 'inline-flex',
                alignItems: 'center',
                gap: 4,
                fontSize: 12,
              }}
            >
              <RefreshCw size={12} /> Làm mới
            </button>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {driveTasks.slice(0, 10).map(t => (
              <div
                key={t.task_id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '10px 14px',
                  borderRadius: 8,
                  background: '#f8fafc',
                  border: '1px solid #f1f5f9',
                  gap: 12,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: 12.5,
                      fontWeight: 600,
                      color: '#0f172a',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {t.custom_name || t.title || t.url}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                    {t.status === 'downloading' && 'Đang tải video từ YouTube (yt-dlp)...'}
                    {t.status === 'uploading' && 'Đang tải lên Google Drive (Resumable)...'}
                    {t.status === 'done' && 'Đã lưu thành công vào Google Drive'}
                    {t.status === 'error' && `Lỗi: ${t.error}`}
                    {t.status === 'pending' && 'Đang chờ xử lý...'}
                  </div>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  {/* Status Badge */}
                  <span
                    style={{
                      padding: '3px 8px',
                      borderRadius: 6,
                      fontSize: 11,
                      fontWeight: 600,
                      background:
                        t.status === 'done'
                          ? '#dcfce7'
                          : t.status === 'error'
                          ? '#fee2e2'
                          : '#e0e7ff',
                      color:
                        t.status === 'done'
                          ? '#15803d'
                          : t.status === 'error'
                          ? '#b91c1c'
                          : '#4338ca',
                    }}
                  >
                    {t.status === 'done' ? 'Hoàn thành' : t.status === 'error' ? 'Thất bại' : `${t.progress_percent}%`}
                  </span>

                  {/* View on Drive Link */}
                  {t.web_view_link && (
                    <a
                      href={t.web_view_link}
                      target="_blank"
                      rel="noreferrer"
                      style={{
                        padding: '4px 10px',
                        borderRadius: 6,
                        background: '#0284c7',
                        color: '#fff',
                        fontSize: 11.5,
                        fontWeight: 600,
                        textDecoration: 'none',
                        display: 'inline-flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                    >
                      <ExternalLink size={12} /> Mở Drive
                    </a>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
