import React, { useState, useEffect } from 'react'
import {
  Film,
  X,
  Download,
  FolderOpen,
  Trash2,
  Play,
  RotateCcw,
  Clock,
  HardDrive,
  Copy,
  Check,
  Search,
  ExternalLink,
  Layers,
  Sparkles,
} from 'lucide-react'
import type { ExportedVideoItem } from '../contracts'
import {
  fetchExportedVideos,
  deleteExportedVideo,
  openExportFolder,
} from '../services/workflowApi'

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
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [filterType, setFilterType] = useState<'all' | 'export' | 'veo_scene'>('all')

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

  const exportCount = videos.filter((v) => (v.sourceType || 'export') === 'export').length
  const veoCount = videos.filter((v) => v.sourceType === 'veo_scene').length

  const filtered = videos.filter((v) => {
    if (filterType !== 'all') {
      const vType = v.sourceType || 'export'
      if (vType !== filterType) return false
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

  const handleDownload = (video: ExportedVideoItem) => {
    const a = document.createElement('a')
    a.href = video.videoUrl
    a.download = video.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        background: 'rgba(10, 15, 30, 0.75)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 1040,
          height: '86vh',
          background: '#ffffff',
          borderRadius: 16,
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.35)',
          border: '1px solid #e2e8f0',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'wfModalIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
            background: 'linear-gradient(135deg, #f8fafc, #f1f5f9)',
            borderBottom: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div
              style={{
                width: 34,
                height: 34,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                boxShadow: '0 3px 8px rgba(79, 70, 229, 0.3)',
              }}
            >
              <Film size={18} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 15, fontWeight: 800, color: '#0f172a' }}>
                  Thư Viện Video Đã Xuất
                </span>
                <span
                  style={{
                    background: '#e0e7ff',
                    color: '#4338ca',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '2px 8px',
                    borderRadius: 12,
                  }}
                >
                  {videos.length} video
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#64748b' }}>
                Quản lý các video hoàn chỉnh đã ghép nối từ Veo Flow Studio
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <button
              type="button"
              onClick={loadVideos}
              disabled={isLoading}
              style={{
                padding: '6px 12px',
                borderRadius: 8,
                border: '1px solid #cbd5e1',
                background: '#ffffff',
                color: '#475569',
                fontSize: 11.5,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
              title="Làm mới danh sách video"
            >
              <RotateCcw size={13} className={isLoading ? 'animate-spin' : ''} />
              Làm mới
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: 'none',
                background: '#f1f5f9',
                color: '#64748b',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Body: Two columns layout */}
        <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
          {/* Left Column: Video List / Gallery */}
          <div
            style={{
              width: 380,
              borderRight: '1px solid #e2e8f0',
              display: 'flex',
              flexDirection: 'column',
              background: '#f8fafc',
            }}
          >
            {/* Search Bar & Filter Tabs */}
            <div style={{ padding: '10px 12px 6px', borderBottom: '1px solid #e2e8f0', background: '#ffffff', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '6px 10px',
                  background: '#f1f5f9',
                  borderRadius: 8,
                  border: '1px solid #e2e8f0',
                }}
              >
                <Search size={14} color="#94a3b8" />
                <input
                  type="text"
                  placeholder="Tìm kiếm video hoặc prompt..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    outline: 'none',
                    fontSize: 12,
                    width: '100%',
                    color: '#0f172a',
                  }}
                />
                {searchTerm && (
                  <X
                    size={13}
                    color="#94a3b8"
                    style={{ cursor: 'pointer' }}
                    onClick={() => setSearchTerm('')}
                  />
                )}
              </div>

              {/* Filter Tabs */}
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  type="button"
                  onClick={() => { setFilterType('all'); setSelectedIndex(0) }}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    borderRadius: 6,
                    border: 'none',
                    background: filterType === 'all' ? '#e0e7ff' : 'transparent',
                    color: filterType === 'all' ? '#4338ca' : '#64748b',
                    fontSize: 10.5,
                    fontWeight: filterType === 'all' ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Tất cả ({videos.length})
                </button>
                <button
                  type="button"
                  onClick={() => { setFilterType('veo_scene'); setSelectedIndex(0) }}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    borderRadius: 6,
                    border: 'none',
                    background: filterType === 'veo_scene' ? '#d1fae5' : 'transparent',
                    color: filterType === 'veo_scene' ? '#047857' : '#64748b',
                    fontSize: 10.5,
                    fontWeight: filterType === 'veo_scene' ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  🎥 Clip Veo ({veoCount})
                </button>
                <button
                  type="button"
                  onClick={() => { setFilterType('export'); setSelectedIndex(0) }}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    borderRadius: 6,
                    border: 'none',
                    background: filterType === 'export' ? '#fef3c7' : 'transparent',
                    color: filterType === 'export' ? '#b45309' : '#64748b',
                    fontSize: 10.5,
                    fontWeight: filterType === 'export' ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  🎬 Hoàn chỉnh ({exportCount})
                </button>
              </div>
            </div>

            {/* List */}
            <div style={{ flex: 1, overflowY: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filtered.length === 0 ? (
                <div
                  style={{
                    textAlign: 'center',
                    padding: '40px 20px',
                    color: '#94a3b8',
                    fontSize: 12,
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 10,
                  }}
                >
                  <Film size={32} strokeWidth={1.5} color="#cbd5e1" />
                  <div>{searchTerm ? 'Không tìm thấy video phù hợp' : 'Chưa có video nào trong thư viện'}</div>
                </div>
              ) : (
                filtered.map((item, idx) => {
                  const isSelected = item.filename === currentVideo?.filename
                  return (
                    <div
                      key={item.filename}
                      onClick={() => setSelectedIndex(idx)}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 10,
                        border: isSelected ? '1.5px solid #6366f1' : '1px solid #e2e8f0',
                        background: isSelected ? '#ffffff' : '#ffffff',
                        boxShadow: isSelected ? '0 4px 12px rgba(99, 102, 241, 0.12)' : '0 1px 3px rgba(0,0,0,0.03)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        position: 'relative',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div
                            style={{
                              width: 32,
                              height: 32,
                              borderRadius: 6,
                              background: isSelected ? '#e0e7ff' : '#f1f5f9',
                              color: isSelected ? '#4f46e5' : '#64748b',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            <Play size={14} fill={isSelected ? '#4f46e5' : '#64748b'} />
                          </div>
                          <div>
                            <div
                              style={{
                                fontSize: 12,
                                fontWeight: 700,
                                color: isSelected ? '#4338ca' : '#0f172a',
                                wordBreak: 'break-all',
                                lineHeight: 1.3,
                              }}
                            >
                              {item.title || item.filename}
                            </div>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 3 }}>
                              <span
                                style={{
                                  fontSize: 9.5,
                                  fontWeight: 700,
                                  padding: '1px 5px',
                                  borderRadius: 4,
                                  background: item.sourceType === 'veo_scene' ? '#d1fae5' : '#e0e7ff',
                                  color: item.sourceType === 'veo_scene' ? '#047857' : '#4338ca',
                                }}
                              >
                                {item.sourceType === 'veo_scene' ? '🎥 Clip Veo' : '🎬 Hoàn Chỉnh'}
                              </span>
                              <span style={{ fontSize: 10, color: '#94a3b8' }}>
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
                            color: '#ef4444',
                            cursor: 'pointer',
                            padding: 4,
                            borderRadius: 4,
                            opacity: 0.7,
                          }}
                          title="Xóa video khỏi ổ đĩa"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 10,
                          fontSize: 10.5,
                          color: '#64748b',
                          marginTop: 8,
                          paddingTop: 6,
                          borderTop: '1px solid #f1f5f9',
                        }}
                      >
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <Clock size={11} color="#6366f1" /> {Math.round(item.durationSec)}s
                        </span>
                        <span>•</span>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                          <HardDrive size={11} color="#059669" /> {formatFileSize(item.sizeBytes)}
                        </span>
                        {item.sceneCount ? (
                          <>
                            <span>•</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Layers size={11} color="#d97706" /> {item.sceneCount} cảnh
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

          {/* Right Column: Theater Player & Quick Actions */}
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
              <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
                {/* Cinema Screen (Contain format - No crop/zoom) */}
                <div
                  style={{
                    width: '100%',
                    height: 380,
                    background: '#050811',
                    borderRadius: 12,
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
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

                {/* Video Info Header & Actions */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 16,
                  }}
                >
                  <div>
                    <h3 style={{ margin: 0, fontSize: 16, fontWeight: 800, color: '#0f172a' }}>
                      {currentVideo.title || currentVideo.filename}
                    </h3>
                    <div style={{ fontSize: 11, color: '#64748b', marginTop: 4, display: 'flex', gap: 12 }}>
                      <span>Thời lượng: <strong>{Math.round(currentVideo.durationSec)}s</strong></span>
                      <span>Dung lượng: <strong>{formatFileSize(currentVideo.sizeBytes)}</strong></span>
                      <span>Tỉ lệ: <strong>{currentVideo.aspectRatio || '9:16'}</strong></span>
                      <span>Độ phân giải: <strong>{currentVideo.resolution || '1080p'}</strong></span>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <button
                      type="button"
                      onClick={() => handleDownload(currentVideo)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 8,
                        border: 'none',
                        background: 'linear-gradient(135deg, #6366f1, #4f46e5)',
                        color: '#ffffff',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                        boxShadow: '0 2px 8px rgba(79, 70, 229, 0.3)',
                      }}
                    >
                      <Download size={14} />
                      Tải MP4
                    </button>

                    <button
                      type="button"
                      onClick={() => handleOpenFolder(currentVideo.filename)}
                      style={{
                        padding: '7px 14px',
                        borderRadius: 8,
                        border: '1px solid #cbd5e1',
                        background: '#f8fafc',
                        color: '#334155',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 6,
                      }}
                      title="Mở thư mục chứa file trong Windows File Explorer"
                    >
                      <FolderOpen size={14} color="#f59e0b" />
                      Mở Thư Mục
                    </button>

                    <button
                      type="button"
                      onClick={() => handleDelete(currentVideo.filename)}
                      disabled={deletingId === currentVideo.filename}
                      style={{
                        padding: '7px 12px',
                        borderRadius: 8,
                        border: '1px solid #fecaca',
                        background: '#fff1f2',
                        color: '#e11d48',
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 5,
                      }}
                      title="Xóa video khỏi hệ thống"
                    >
                      <Trash2 size={14} />
                      Xóa
                    </button>
                  </div>
                </div>

                {/* Prompt block if available */}
                {currentVideo.prompt && (
                  <div
                    style={{
                      background: '#f8fafc',
                      border: '1px solid #e2e8f0',
                      borderRadius: 8,
                      padding: '10px 14px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}
                  >
                    <div style={{ fontSize: 11, fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: 5 }}>
                      <Sparkles size={12} color="#6366f1" />
                      Prompt Phân Cảnh (Veo AI):
                    </div>
                    <div style={{ fontSize: 11, color: '#1e293b', whiteSpace: 'pre-wrap', maxHeight: 120, overflowY: 'auto', lineHeight: 1.45 }}>
                      {currentVideo.prompt}
                    </div>
                  </div>
                )}
                <div
                  style={{
                    background: '#f8fafc',
                    border: '1px solid #e2e8f0',
                    borderRadius: 8,
                    padding: '10px 14px',
                    fontSize: 11,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                  }}
                >
                  <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginRight: 10 }}>
                    <span style={{ fontWeight: 700, color: '#475569' }}>Đường dẫn file: </span>
                    <span style={{ color: '#0f172a', fontFamily: 'monospace' }}>{currentVideo.filePath}</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCopyPath(currentVideo.filePath)}
                    style={{
                      border: '1px solid #cbd5e1',
                      background: '#ffffff',
                      borderRadius: 6,
                      padding: '4px 8px',
                      fontSize: 10.5,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                      flexShrink: 0,
                    }}
                  >
                    {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
                    {copied ? 'Đã sao chép' : 'Sao chép'}
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
                  gap: 12,
                }}
              >
                <Film size={48} strokeWidth={1} color="#cbd5e1" />
                <div style={{ fontSize: 14, fontWeight: 600, color: '#64748b' }}>
                  Chưa có video hoàn chỉnh nào
                </div>
                <div style={{ fontSize: 11.5, maxWidth: 360, lineHeight: 1.5 }}>
                  Khi bạn render các phân cảnh trong khối <strong>Veo Flow Studio</strong> và nhấn nút{' '}
                  <strong>Xuất Video Hoàn Chỉnh (MP4)</strong>, video sẽ tự động được lưu trữ và hiển thị tại đây.
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
