import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Film,
  Search,
  X,
  RotateCcw,
  Play,
  CheckCircle2,
  Sparkles,
  FolderOpen,
} from 'lucide-react'
import type { ExportedVideoItem } from '../contracts'
import { fetchExportedVideos } from '../services/workflowApi'
import * as veoApi from '../../veo-studio/services/veoApi'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSelectClip: (clip: ExportedVideoItem) => void
  targetSceneIndex?: number
  title?: string
  subtitle?: string
}

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(1)} KB`
  return `${(kb / 1024).toFixed(1)} MB`
}

function formatDate(isoString: string): string {
  if (!isoString) return ''
  try {
    const d = new Date(isoString)
    return (
      d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) +
      ' ' +
      d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
    )
  } catch {
    return isoString
  }
}

export function VeoVideoPickerModal({
  isOpen,
  onClose,
  onSelectClip,
  targetSceneIndex,
  title,
  subtitle,
}: Props) {
  const [clips, setClips] = useState<ExportedVideoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterSource, setFilterSource] = useState<'all' | 'veo_history' | 'veo_scene' | 'export'>('all')
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)

  const loadClips = async () => {
    setLoading(true)
    try {
      const [allExported, veoHistory] = await Promise.allSettled([
        fetchExportedVideos(),
        veoApi.getHistory(),
      ])

      const combined: ExportedVideoItem[] = []

      // 1. Veo Studio History videos
      if (veoHistory.status === 'fulfilled' && Array.isArray(veoHistory.value)) {
        for (const item of veoHistory.value) {
          combined.push({
            id: `veo-hist-${item.video_id}`,
            filename: item.file_name,
            videoUrl: veoApi.getVideoStreamUrl(item.video_id),
            filePath: item.file_path,
            sizeBytes: item.file_size_bytes || 0,
            durationSec: item.duration_seconds || 10,
            createdAt: item.created_at || '',
            aspectRatio: item.aspect_ratio || '16:9',
            title: item.prompt
              ? item.prompt.length > 50
                ? item.prompt.slice(0, 50) + '...'
                : item.prompt
              : item.file_name,
            sourceType: 'veo_history' as any,
            prompt: item.prompt || '',
            modelDisplayName: item.model_display_name || '',
          })
        }
      }

      // 2. Exported videos & Scene clips
      if (allExported.status === 'fulfilled' && Array.isArray(allExported.value)) {
        for (const item of allExported.value) {
          // Tránh trùng lặp nếu cùng filename
          if (!combined.some((c) => c.filename === item.filename)) {
            combined.push(item)
          }
        }
      }

      setClips(combined)
    } catch (err) {
      console.error('Lỗi khi tải thư viện clip Veo:', err)
      setClips([])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (isOpen) {
      loadClips()
      setSearchQuery('')
      setSelectedClipId(null)
      setFilterSource('all')
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

  const filteredClips = useMemo(() => {
    return clips.filter((c) => {
      if (filterSource !== 'all') {
        if (filterSource === 'veo_history' && c.sourceType !== 'veo_history') return false
        if (filterSource === 'veo_scene' && c.sourceType !== 'veo_scene') return false
        if (filterSource === 'export' && c.sourceType !== 'export') return false
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        return (
          c.filename.toLowerCase().includes(q) ||
          (c.prompt && c.prompt.toLowerCase().includes(q)) ||
          (c.title && c.title.toLowerCase().includes(q))
        )
      }
      return true
    })
  }, [clips, filterSource, searchQuery])

  if (!isOpen) return null

  const modalTitle =
    title ||
    (targetSceneIndex !== undefined
      ? `Chọn Clip Veo Cho Cảnh #${targetSceneIndex + 1}`
      : 'Thư Viện Video Veo Studio')

  const modalSubtitle =
    subtitle ||
    (targetSceneIndex !== undefined
      ? 'Chọn 1 clip đã render sẵn từ Google Veo để gán vào cảnh (tiết kiệm 100% credit & thời gian)'
      : 'Chọn video từ thư viện Veo Studio hoặc workflow để làm nguyên liệu chuyển động tham chiếu')

  return createPortal(
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        backgroundColor: 'rgba(15, 23, 42, 0.65)',
        backdropFilter: 'blur(4px)',
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
          maxWidth: 980,
          height: '85vh',
          maxHeight: 760,
          background: '#ffffff',
          borderRadius: 14,
          boxShadow: '0 25px 50px -12px rgba(15, 23, 42, 0.25)',
          border: '1px solid #cbd5e1',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          animation: 'wfScaleUp 0.18s cubic-bezier(0.16, 1, 0.3, 1)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div
          style={{
            padding: '14px 20px',
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
                width: 34,
                height: 34,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #4f46e5, #7c3aed)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                boxShadow: '0 2px 5px rgba(79, 70, 229, 0.3)',
              }}
            >
              <Film size={17} />
            </div>
            <div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 700, color: '#0f172a' }}>
                  {modalTitle}
                </span>
                <span
                  style={{
                    background: '#ede9fe',
                    color: '#6d28d9',
                    border: '1px solid #ddd6fe',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '1px 8px',
                    borderRadius: 99,
                  }}
                >
                  {clips.length} video sẵn có
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                {modalSubtitle}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <button
              type="button"
              onClick={loadClips}
              disabled={loading}
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
              }}
              title="Làm mới danh sách clip"
            >
              <RotateCcw size={12} className={loading ? 'animate-spin' : ''} />
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
              }}
              title="Đóng (ESC)"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Search & Filter Toolbar */}
        <div
          style={{
            padding: '10px 20px',
            background: '#ffffff',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: 12,
          }}
        >
          <div
            style={{
              flex: 1,
              minWidth: 260,
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              borderRadius: 8,
              border: '1px solid #cbd5e1',
              background: '#f8fafc',
            }}
          >
            <Search size={14} color="#94a3b8" />
            <input
              type="text"
              placeholder="Tìm kiếm theo tên file, từ khóa prompt..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              style={{
                flex: 1,
                border: 'none',
                background: 'transparent',
                outline: 'none',
                fontSize: 12,
                color: '#1e293b',
              }}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{
                  border: 'none',
                  background: 'transparent',
                  color: '#94a3b8',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <X size={13} />
              </button>
            )}
          </div>

          {/* Source Tabs */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <button
              type="button"
              onClick={() => setFilterSource('all')}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: 'none',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                background: filterSource === 'all' ? '#4f46e5' : '#f1f5f9',
                color: filterSource === 'all' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              Tất cả ({clips.length})
            </button>
            <button
              type="button"
              onClick={() => setFilterSource('veo_history')}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: 'none',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                background: filterSource === 'veo_history' ? '#4f46e5' : '#f1f5f9',
                color: filterSource === 'veo_history' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              Veo Studio ({clips.filter((c) => c.sourceType === 'veo_history').length})
            </button>
            <button
              type="button"
              onClick={() => setFilterSource('veo_scene')}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: 'none',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                background: filterSource === 'veo_scene' ? '#4f46e5' : '#f1f5f9',
                color: filterSource === 'veo_scene' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              Phân cảnh ({clips.filter((c) => c.sourceType === 'veo_scene').length})
            </button>
            <button
              type="button"
              onClick={() => setFilterSource('export')}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: 'none',
                fontSize: 11,
                fontWeight: 600,
                cursor: 'pointer',
                background: filterSource === 'export' ? '#4f46e5' : '#f1f5f9',
                color: filterSource === 'export' ? '#ffffff' : '#475569',
                transition: 'all 0.15s ease',
              }}
            >
              Đã xuất ({clips.filter((c) => c.sourceType === 'export').length})
            </button>
          </div>

          <span style={{ fontSize: 11.5, color: '#64748b', whiteSpace: 'nowrap' }}>
            Hiển thị <b>{filteredClips.length}</b> / {clips.length} clip
          </span>
        </div>

        {/* Clips Grid */}
        <div
          style={{
            flex: 1,
            overflowY: 'auto',
            padding: 16,
            background: '#f8fafc',
          }}
        >
          {loading ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: 10,
                color: '#6d28d9',
              }}
            >
              <RotateCcw size={26} className="animate-spin" />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                Đang quét thư viện video Veo Studio...
              </span>
            </div>
          ) : filteredClips.length === 0 ? (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                height: '100%',
                gap: 8,
                color: '#94a3b8',
              }}
            >
              <Film size={36} strokeWidth={1.5} />
              <div style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
                {searchQuery
                  ? 'Không tìm thấy video nào phù hợp với từ khóa.'
                  : 'Chưa có video nào trong thư viện.'}
              </div>
              <div style={{ fontSize: 11 }}>
                Hãy render video từ Veo Studio hoặc workflow để lưu vào thư viện.
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                gap: 14,
              }}
            >
              {filteredClips.map((clip) => {
                const isHovered = hoveredClipId === clip.id
                const isSelected = selectedClipId === clip.id

                return (
                  <div
                    key={clip.id}
                    onClick={() => setSelectedClipId(clip.id)}
                    onMouseEnter={() => setHoveredClipId(clip.id)}
                    onMouseLeave={() => setHoveredClipId(null)}
                    style={{
                      background: '#ffffff',
                      borderRadius: 10,
                      border: isSelected
                        ? '2px solid #7c3aed'
                        : isHovered
                        ? '1px solid #a78bfa'
                        : '1px solid #e2e8f0',
                      boxShadow: isSelected
                        ? '0 0 0 3px rgba(124, 58, 237, 0.15), 0 4px 12px rgba(0,0,0,0.08)'
                        : isHovered
                        ? '0 4px 12px rgba(0,0,0,0.06)'
                        : '0 1px 3px rgba(0,0,0,0.03)',
                      display: 'flex',
                      flexDirection: 'column',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      transition: 'all 0.18s ease',
                      position: 'relative',
                    }}
                  >
                    {/* Video Player Preview Box */}
                    <div
                      style={{
                        width: '100%',
                        height: 180,
                        background: '#070a12',
                        position: 'relative',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        overflow: 'hidden',
                      }}
                    >
                      <video
                        src={clip.videoUrl}
                        controls={isHovered}
                        muted
                        loop
                        playsInline
                        preload="metadata"
                        style={{
                          width: '100%',
                          height: '100%',
                          objectFit: 'contain',
                        }}
                      />

                      {!isHovered && (
                        <div
                          style={{
                            position: 'absolute',
                            width: 32,
                            height: 32,
                            borderRadius: '50%',
                            background: 'rgba(0, 0, 0, 0.55)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ffffff',
                            pointerEvents: 'none',
                          }}
                        >
                          <Play size={13} fill="#ffffff" style={{ marginLeft: 2 }} />
                        </div>
                      )}

                      {/* Badges: Aspect Ratio, Duration & Source */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 8,
                          left: 8,
                          display: 'flex',
                          gap: 4,
                          pointerEvents: 'none',
                        }}
                      >
                        <span
                          style={{
                            background: 'rgba(15, 23, 42, 0.75)',
                            color: '#e2e8f0',
                            fontSize: 9.5,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 4,
                            backdropFilter: 'blur(4px)',
                          }}
                        >
                          {clip.aspectRatio || '16:9'}
                        </span>
                        <span
                          style={{
                            background:
                              clip.isMotionControl
                                ? 'rgba(192, 38, 211, 0.85)'
                                : clip.sourceType === 'veo_history'
                                ? 'rgba(124, 58, 237, 0.85)'
                                : clip.sourceType === 'veo_scene'
                                ? 'rgba(79, 70, 229, 0.85)'
                                : 'rgba(16, 185, 129, 0.85)',
                            color: '#ffffff',
                            fontSize: 9.5,
                            fontWeight: 700,
                            padding: '1px 5px',
                            borderRadius: 4,
                            backdropFilter: 'blur(4px)',
                          }}
                        >
                          {clip.isMotionControl
                            ? 'Motion'
                            : clip.sourceType === 'veo_history'
                            ? 'Veo'
                            : clip.sourceType === 'veo_scene'
                            ? 'Cảnh'
                            : 'Xuất'}
                        </span>
                      </div>

                      <span
                        style={{
                          position: 'absolute',
                          bottom: 8,
                          right: 8,
                          background: 'rgba(0, 0, 0, 0.7)',
                          color: '#f8fafc',
                          fontSize: 10,
                          fontWeight: 700,
                          padding: '1px 6px',
                          borderRadius: 4,
                          backdropFilter: 'blur(4px)',
                          pointerEvents: 'none',
                        }}
                      >
                        {clip.durationSec}s
                      </span>
                    </div>

                    {/* Metadata & Select Action */}
                    <div
                      style={{
                        padding: '10px 12px',
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 6,
                        flex: 1,
                        justifyContent: 'space-between',
                      }}
                    >
                      <div>
                        <div
                          style={{
                            fontSize: 12,
                            fontWeight: 700,
                            color: '#0f172a',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            whiteSpace: 'nowrap',
                          }}
                          title={clip.title || clip.filename}
                        >
                          {clip.title || clip.filename}
                        </div>

                        {clip.prompt && (
                          <div
                            style={{
                              fontSize: 10.5,
                              color: '#64748b',
                              marginTop: 2,
                              lineHeight: 1.35,
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                            title={clip.prompt}
                          >
                            {clip.prompt}
                          </div>
                        )}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 10,
                          color: '#94a3b8',
                          paddingTop: 4,
                          borderTop: '1px solid #f1f5f9',
                        }}
                      >
                        <span>{formatDate(clip.createdAt)}</span>
                        <span>{formatFileSize(clip.sizeBytes)}</span>
                      </div>

                      {/* Select button */}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSelectClip(clip)
                          onClose()
                        }}
                        style={{
                          marginTop: 4,
                          width: '100%',
                          padding: '6px 0',
                          borderRadius: 6,
                          border: 'none',
                          background: isSelected ? '#7c3aed' : '#4f46e5',
                          color: '#ffffff',
                          fontSize: 11,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: 5,
                          boxShadow: '0 1px 2px rgba(79, 70, 229, 0.2)',
                          transition: 'background 0.15s ease',
                        }}
                        onMouseEnter={(e) => (e.currentTarget.style.background = '#6d28d9')}
                        onMouseLeave={(e) =>
                          (e.currentTarget.style.background = isSelected ? '#7c3aed' : '#4f46e5')
                        }
                      >
                        <CheckCircle2 size={12} />
                        <span>
                          {targetSceneIndex !== undefined
                            ? `Gán vào Cảnh #${targetSceneIndex + 1}`
                            : 'Chọn Video Này'}
                        </span>
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            padding: '10px 20px',
            background: '#ffffff',
            borderTop: '1px solid #e2e8f0',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
          }}
        >
          <div style={{ fontSize: 11, color: '#64748b' }}>
            💡 <b>Mẹo tái sử dụng:</b> Bạn có thể chọn bất kỳ clip nào trong thư viện Veo để làm mẫu chuyển động hoặc ghép phân cảnh mà không tốn credit!
          </div>

          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #cbd5e1',
              background: '#ffffff',
              color: '#334155',
              fontSize: 11.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
