import React, { useState, useEffect } from 'react'
import { createPortal } from 'react-dom'
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
  Sparkles,
  Layers,
  ImageDown,
  Loader2,
  Ratio,
  Monitor,
  Video,
} from 'lucide-react'
import type { ExportedVideoItem } from '../contracts'
import {
  fetchExportedVideos,
  deleteExportedVideo,
  openExportFolder,
} from '../services/workflowApi'
import * as veoApi from '../../veo-studio/services/veoApi'

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
  const [filterType, setFilterType] = useState<'all' | 'export' | 'veo_scene'>('all')
  const [isExtractingFrame, setIsExtractingFrame] = useState(false)
  const [frameSaved, setFrameSaved] = useState(false)

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

  const handleCopyPrompt = (promptText: string) => {
    navigator.clipboard.writeText(promptText)
    setCopiedPrompt(true)
    setTimeout(() => setCopiedPrompt(false), 2000)
  }

  const handleDownload = (video: ExportedVideoItem) => {
    const a = document.createElement('a')
    a.href = video.videoUrl
    a.download = video.filename
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
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
                    padding: '4px 6px',
                    borderRadius: 5,
                    border: 'none',
                    background: filterType === 'all' ? '#ffffff' : 'transparent',
                    color: filterType === 'all' ? '#0f172a' : '#64748b',
                    boxShadow: filterType === 'all' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
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
                  onClick={() => {
                    setFilterType('veo_scene')
                    setSelectedIndex(0)
                  }}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    borderRadius: 5,
                    border: 'none',
                    background: filterType === 'veo_scene' ? '#ffffff' : 'transparent',
                    color: filterType === 'veo_scene' ? '#059669' : '#64748b',
                    boxShadow: filterType === 'veo_scene' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                    fontSize: 10.5,
                    fontWeight: filterType === 'veo_scene' ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
                >
                  Clip Veo ({veoCount})
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setFilterType('export')
                    setSelectedIndex(0)
                  }}
                  style={{
                    flex: 1,
                    padding: '4px 6px',
                    borderRadius: 5,
                    border: 'none',
                    background: filterType === 'export' ? '#ffffff' : 'transparent',
                    color: filterType === 'export' ? '#4f46e5' : '#64748b',
                    boxShadow: filterType === 'export' ? '0 1px 2px rgba(0,0,0,0.08)' : 'none',
                    fontSize: 10.5,
                    fontWeight: filterType === 'export' ? 700 : 500,
                    cursor: 'pointer',
                    transition: 'all 0.15s ease',
                  }}
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
                  return (
                    <div
                      key={item.filename}
                      onClick={() => setSelectedIndex(idx)}
                      style={{
                        padding: '8px 10px',
                        borderRadius: 8,
                        border: isSelected ? '1.5px solid #334155' : '1px solid #e2e8f0',
                        background: isSelected ? '#ffffff' : '#ffffff',
                        boxShadow: isSelected ? '0 2px 6px rgba(15, 23, 42, 0.08)' : '0 1px 2px rgba(0,0,0,0.02)',
                        cursor: 'pointer',
                        transition: 'all 0.15s ease',
                        position: 'relative',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8 }}>
                        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, flex: 1, minWidth: 0 }}>
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
                {/* Cinema Screen (Contain format - No crop/zoom) */}
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
                          color: currentVideo.sourceType === 'veo_scene' ? '#059669' : '#4f46e5',
                        }}
                      >
                        {currentVideo.sourceType === 'veo_scene' ? '🎥 Phân cảnh Veo AI' : '🎬 Video hoàn chỉnh'}
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
                    {/* Tải MP4 */}
                    <button
                      type="button"
                      onClick={() => handleDownload(currentVideo)}
                      style={{
                        height: 32,
                        padding: '0 13px',
                        borderRadius: 6,
                        border: 'none',
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
                      title="Tải video định dạng MP4 về máy"
                    >
                      <Download size={13} />
                      <span>Tải MP4</span>
                    </button>

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
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
