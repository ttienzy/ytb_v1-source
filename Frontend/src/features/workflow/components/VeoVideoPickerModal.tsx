import React, { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Film,
  Search,
  X,
  RotateCcw,
  Play,
  CheckCircle2,
} from 'lucide-react'
import type { ExportedVideoItem } from '../contracts'
import { fetchExportedVideos } from '../services/workflowApi'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSelectClip: (clip: ExportedVideoItem) => void
  targetSceneIndex: number
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
    return d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) + ' ' + d.toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' })
  } catch {
    return isoString
  }
}

export function VeoVideoPickerModal({
  isOpen,
  onClose,
  onSelectClip,
  targetSceneIndex,
}: Props) {
  const [clips, setClips] = useState<ExportedVideoItem[]>([])
  const [loading, setLoading] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [hoveredClipId, setHoveredClipId] = useState<string | null>(null)
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)

  const loadClips = async () => {
    setLoading(true)
    try {
      const all = await fetchExportedVideos()
      // Lọc các clip Veo phân cảnh (veo_scene)
      const veoClips = all.filter((v) => v.sourceType === 'veo_scene')
      setClips(veoClips)
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
    if (!searchQuery.trim()) return clips
    const q = searchQuery.toLowerCase().trim()
    return clips.filter(
      (c) =>
        c.filename.toLowerCase().includes(q) ||
        (c.prompt && c.prompt.toLowerCase().includes(q)) ||
        (c.title && c.title.toLowerCase().includes(q))
    )
  }, [clips, searchQuery])

  if (!isOpen) return null

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
          maxWidth: 960,
          height: '85vh',
          maxHeight: 740,
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
                  Chọn Clip Veo Cho Cảnh #{targetSceneIndex + 1}
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
                  {clips.length} clip sẵn có
                </span>
              </div>
              <div style={{ fontSize: 11, color: '#64748b', marginTop: 1 }}>
                Chọn 1 clip đã render sẵn từ Google Veo để gán vào cảnh (tiết kiệm 100% credit & thời gian)
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

        {/* Search Toolbar */}
        <div
          style={{
            padding: '10px 20px',
            background: '#ffffff',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
          }}
        >
          <div
            style={{
              flex: 1,
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
              placeholder="Tìm kiếm theo từ khóa prompt (vd: nước hoa, bathroom, luxury, macro...)"
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
                style={{ border: 'none', background: 'transparent', color: '#94a3b8', cursor: 'pointer', padding: 0 }}
              >
                <X size={13} />
              </button>
            )}
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
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 10, color: '#6d28d9' }}>
              <RotateCcw size={26} className="animate-spin" />
              <span style={{ fontSize: 12.5, fontWeight: 600 }}>Đang quét thư viện clip Veo AI...</span>
            </div>
          ) : filteredClips.length === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', gap: 8, color: '#94a3b8' }}>
              <Film size={36} strokeWidth={1.5} />
              <div style={{ fontSize: 13, fontWeight: 600, color: '#475569' }}>
                {searchQuery ? 'Không tìm thấy clip nào phù hợp với từ khóa.' : 'Chưa có clip Veo nào trong thư viện.'}
              </div>
              <div style={{ fontSize: 11 }}>
                Hãy render clip đầu tiên từ node Veo Studio để lưu vào thư viện tái sử dụng.
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
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
                        autoPlay={isHovered}
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
                            background: 'rgba(0,0,0,0.5)',
                            backdropFilter: 'blur(2px)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#ffffff',
                            pointerEvents: 'none',
                          }}
                        >
                          <Play size={14} fill="#ffffff" style={{ marginLeft: 2 }} />
                        </div>
                      )}

                      {/* Duration Tag */}
                      <span
                        style={{
                          position: 'absolute',
                          bottom: 6,
                          right: 6,
                          background: 'rgba(15, 23, 42, 0.75)',
                          color: '#ffffff',
                          fontSize: 9.5,
                          fontWeight: 700,
                          padding: '1px 5px',
                          borderRadius: 4,
                          backdropFilter: 'blur(2px)',
                        }}
                      >
                        {Math.round(clip.durationSec || 10)}s
                      </span>
                    </div>

                    {/* Meta Body */}
                    <div style={{ padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 5, flex: 1 }}>
                      <div
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          color: '#1e293b',
                          lineHeight: 1.35,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                          height: 30,
                        }}
                        title={clip.prompt || clip.filename}
                      >
                        {clip.prompt ? clip.prompt.slice(0, 90) : clip.filename}
                      </div>

                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          fontSize: 10,
                          color: '#64748b',
                          marginTop: 2,
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
                        onMouseLeave={(e) => (e.currentTarget.style.background = isSelected ? '#7c3aed' : '#4f46e5')}
                      >
                        <CheckCircle2 size={12} />
                        <span>Gán vào Cảnh #{targetSceneIndex + 1}</span>
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
            💡 <b>Mẹo tái sử dụng:</b> Bạn có thể chọn bất kỳ clip 10s nào trong thư viện để thử nghiệm kịch bản bán hàng khác mà không tốn credit!
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
