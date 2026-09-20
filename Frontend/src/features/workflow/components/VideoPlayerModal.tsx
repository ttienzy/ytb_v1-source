import React, { useEffect, useRef, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import {
  X,
  Download,
  Copy,
  Check,
  Film,
  Sparkles,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Maximize2,
  Gauge,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'

interface VideoPlayerModalProps {
  isOpen: boolean
  onClose: () => void
  videoUrl: string
  referenceVideoUrl?: string | null
  title?: string
  prompt?: string
  durationSec?: number
  aspectRatio?: string
}

export function VideoPlayerModal({
  isOpen,
  onClose,
  videoUrl,
  referenceVideoUrl,
  title = 'Xem toàn cảnh Video',
  prompt,
  durationSec,
  aspectRatio = '9:16',
}: VideoPlayerModalProps) {
  const [copiedLink, setCopiedLink] = useState(false)
  const [copiedPrompt, setCopiedPrompt] = useState(false)
  const [isPromptExpanded, setIsPromptExpanded] = useState(true)

  // ── Sync Engine State ──
  const flowVideoRef = useRef<HTMLVideoElement | null>(null)
  const refVideoRef = useRef<HTMLVideoElement | null>(null)

  const [isPlaying, setIsPlaying] = useState(true)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(durationSec || 6)
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1)
  const [activeAudio, setActiveAudio] = useState<'flow' | 'reference' | 'mute'>('flow')

  const hasReference = Boolean(referenceVideoUrl)

  // ── Format Helper: 00:04.2 ──
  const formatTime = (secs: number) => {
    if (!Number.isFinite(secs) || secs < 0) return '00:00'
    const m = Math.floor(secs / 60)
    const s = Math.floor(secs % 60)
    const ms = Math.floor((secs % 1) * 10)
    return `${m < 10 ? '0' : ''}${m}:${s < 10 ? '0' : ''}${s}.${ms}`
  }

  // ── Đồng bộ Phát / Tạm dừng cả 2 video ──
  const togglePlaySync = useCallback(() => {
    const flowVid = flowVideoRef.current
    const refVid = refVideoRef.current

    if (isPlaying) {
      flowVid?.pause()
      refVid?.pause()
      setIsPlaying(false)
    } else {
      // Đảm bảo đồng bộ thời gian trước khi phát lại
      if (flowVid && refVid) {
        const targetTime = flowVid.currentTime || 0
        refVid.currentTime = targetTime
      }
      flowVid?.play().catch(() => {})
      refVid?.play().catch(() => {})
      setIsPlaying(true)
    }
  }, [isPlaying])

  // ── Tua về 0s và phát lại từ đầu cùng lúc ──
  const handleRestartSync = useCallback(() => {
    const flowVid = flowVideoRef.current
    const refVid = refVideoRef.current

    if (flowVid) flowVid.currentTime = 0
    if (refVid) refVid.currentTime = 0
    setCurrentTime(0)

    flowVid?.play().catch(() => {})
    refVid?.play().catch(() => {})
    setIsPlaying(true)
  }, [])

  // ── Kéo thanh Scrubber đồng bộ ──
  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newTime = parseFloat(e.target.value)
    setCurrentTime(newTime)
    if (flowVideoRef.current) flowVideoRef.current.currentTime = newTime
    if (refVideoRef.current) refVideoRef.current.currentTime = newTime
  }

  // ── Đổi tốc độ phát (Slow Motion 0.5x, 1x, 1.5x, 2x) ──
  const handleChangeSpeed = (speed: number) => {
    setPlaybackSpeed(speed)
    if (flowVideoRef.current) flowVideoRef.current.playbackRate = speed
    if (refVideoRef.current) refVideoRef.current.playbackRate = speed
  }

  // ── Điều khiển âm thanh (Audio Selector) ──
  useEffect(() => {
    if (flowVideoRef.current) {
      flowVideoRef.current.muted = activeAudio !== 'flow'
    }
    if (refVideoRef.current) {
      refVideoRef.current.muted = activeAudio !== 'reference'
    }
  }, [activeAudio])

  // ── Cập nhật Time & Duration từ flowVideo ──
  const handleTimeUpdate = () => {
    if (flowVideoRef.current) {
      setCurrentTime(flowVideoRef.current.currentTime)
      if (flowVideoRef.current.duration && !Number.isNaN(flowVideoRef.current.duration)) {
        setDuration(flowVideoRef.current.duration)
      }
    }
  }

  // ── Tự động Loop đồng bộ khi video kết thúc ──
  const handleVideoEnded = () => {
    handleRestartSync()
  }

  // ── Phím tắt bàn phím (Space, R, Esc) ──
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return

      if (e.key === 'Escape') {
        onClose()
      } else if (e.code === 'Space') {
        e.preventDefault()
        togglePlaySync()
      } else if (e.key === 'r' || e.key === 'R' || e.key === '0') {
        e.preventDefault()
        handleRestartSync()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose, togglePlaySync, handleRestartSync])

  // Reset state khi mở modal
  useEffect(() => {
    if (isOpen) {
      setIsPlaying(true)
      setCurrentTime(0)
      setPlaybackSpeed(1)
      setActiveAudio('flow')
    }
  }, [isOpen])

  if (!isOpen || !videoUrl) return null

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(videoUrl)
    setCopiedLink(true)
    setTimeout(() => setCopiedLink(false), 2000)
  }

  const handleCopyPrompt = () => {
    if (!prompt) return
    navigator.clipboard.writeText(prompt)
    setCopiedPrompt(true)
    setTimeout(() => setCopiedPrompt(false), 2000)
  }

  const handleDownload = () => {
    const a = document.createElement('a')
    a.href = videoUrl
    a.download = `${title.replace(/\s+/g, '_')}.mp4`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
  }

  const modalContent = (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999999,
        background: 'rgba(3, 7, 18, 0.92)',
        backdropFilter: 'blur(16px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '16px 20px',
        animation: 'fadeIn 0.2s ease-out',
      }}
      onClick={onClose}
    >
      {/* Nút thoát nổi ở góc trên bên phải màn hình */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation()
          onClose()
        }}
        style={{
          position: 'fixed',
          top: 18,
          right: 24,
          zIndex: 10000000,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '8px 16px',
          borderRadius: 30,
          border: '1px solid rgba(255, 255, 255, 0.25)',
          background: 'rgba(15, 23, 42, 0.85)',
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          backdropFilter: 'blur(12px)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.6)',
          transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#ef4444'
          e.currentTarget.style.borderColor = '#ef4444'
          e.currentTarget.style.transform = 'scale(1.04)'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(15, 23, 42, 0.85)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.25)'
          e.currentTarget.style.transform = 'scale(1)'
        }}
        title="Đóng xem video (Phím ESC)"
      >
        <X size={16} />
        <span>Đóng (ESC)</span>
      </button>

      {/* Khung chứa nội dung Modal Toàn Cảnh Rộng Rãi */}
      <div
        style={{
          width: '100%',
          maxWidth: hasReference ? 'min(96vw, 1340px)' : aspectRatio === '9:16' ? 520 : 960,
          maxHeight: '94vh',
          height: hasReference ? '90vh' : 'auto',
          background: '#090d16',
          borderRadius: 20,
          border: '1px solid rgba(255, 255, 255, 0.14)',
          boxShadow: '0 30px 100px -15px rgba(0, 0, 0, 0.9), 0 0 50px rgba(99, 102, 241, 0.12)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── HEADER CỐ ĐỊNH CAO CẤP ── */}
        <div
          style={{
            padding: '14px 22px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'linear-gradient(180deg, rgba(30, 41, 59, 0.85) 0%, rgba(15, 23, 42, 0.75) 100%)',
            backdropFilter: 'blur(10px)',
            flexShrink: 0,
            gap: 16,
          }}
        >
          {/* Tiêu đề & Badges */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'linear-gradient(135deg, #6366f1 0%, #ec4899 100%)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                boxShadow: '0 4px 14px rgba(236, 72, 153, 0.35)',
                flexShrink: 0,
              }}
            >
              <Film size={18} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 15,
                  fontWeight: 800,
                  color: '#f8fafc',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                }}
              >
                <span>{hasReference ? 'So sánh Chuyển động Điện ảnh (Side-by-Side)' : title}</span>
                {hasReference && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      padding: '2px 8px',
                      borderRadius: 12,
                      background: 'rgba(99, 102, 241, 0.2)',
                      color: '#a5b4fc',
                      border: '1px solid rgba(99, 102, 241, 0.4)',
                    }}
                  >
                    Sync Play Engine
                  </span>
                )}
              </div>
              <div style={{ fontSize: 11.5, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 10, marginTop: 2 }}>
                <span>Khung hình: <strong style={{ color: '#e2e8f0' }}>{aspectRatio}</strong></span>
                <span>• Thời lượng: <strong style={{ color: '#e2e8f0' }}>{durationSec || Math.round(duration)}s</strong></span>
                {hasReference && <span style={{ color: '#64748b' }}>• Phím tắt: [Space] Phát/Dừng • [R] Tua về 0s</span>}
              </div>
            </div>
          </div>

          {/* Quick Actions (Copy, Download, Close) */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleCopyUrl}
              style={{
                padding: '7px 14px',
                borderRadius: 8,
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'rgba(255, 255, 255, 0.06)',
                color: '#cbd5e1',
                fontSize: 12,
                fontWeight: 600,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.12)')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.06)')}
              title="Sao chép link video MP4"
            >
              {copiedLink ? <Check size={14} color="#10b981" /> : <Copy size={14} />}
              <span>{copiedLink ? 'Đã sao chép' : 'Copy link'}</span>
            </button>

            <button
              type="button"
              onClick={handleDownload}
              style={{
                padding: '7px 16px',
                borderRadius: 8,
                border: 'none',
                background: 'linear-gradient(135deg, #f43f5e 0%, #e11d48 100%)',
                color: '#ffffff',
                fontSize: 12,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                boxShadow: '0 4px 12px rgba(225, 29, 72, 0.35)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-1px)')}
              onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
              title="Tải video về máy tính"
            >
              <Download size={14} />
              <span>Tải MP4</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                width: 32,
                height: 32,
                borderRadius: 8,
                border: '1px solid rgba(239, 68, 68, 0.35)',
                background: 'rgba(239, 68, 68, 0.12)',
                color: '#fca5a5',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = '#ef4444'
                e.currentTarget.style.color = '#ffffff'
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.12)'
                e.currentTarget.style.color = '#fca5a5'
              }}
              title="Đóng (ESC)"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* ── KHU VỰC PHÁT VIDEO CHÍNH ── */}
        <div
          style={{
            flex: 1,
            background: '#040711',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            overflow: 'hidden',
            minHeight: 0,
            padding: hasReference ? '12px 16px 8px 16px' : '16px',
          }}
        >
          {hasReference ? (
            /* BỐ CỤC 2 VIDEO SONG SONG (SPLIT-SCREEN CINEMA) */
            <div
              style={{
                width: '100%',
                height: '100%',
                display: 'grid',
                gridTemplateColumns: '1fr 1fr',
                gap: 16,
                alignItems: 'stretch',
                minHeight: 0,
              }}
            >
              {/* CỘT 1: KẾT QUẢ FLOW AI */}
              <div
                style={{
                  minWidth: 0,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'rgba(15, 23, 42, 0.65)',
                  borderRadius: 14,
                  border: '1px solid rgba(168, 85, 247, 0.3)',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4), inset 0 0 20px rgba(168, 85, 247, 0.05)',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {/* Header Card 1 */}
                <div
                  style={{
                    padding: '8px 14px',
                    background: 'linear-gradient(90deg, rgba(168, 85, 247, 0.18) 0%, rgba(15, 23, 42, 0.6) 100%)',
                    borderBottom: '1px solid rgba(168, 85, 247, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#a855f7', boxShadow: '0 0 8px #a855f7' }} />
                    <span style={{ color: '#e9d5ff', fontSize: 12, fontWeight: 800, letterSpacing: 0.3 }}>
                      KẾT QUẢ FLOW AI
                    </span>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#a855f7', color: '#ffffff', fontWeight: 700 }}>
                      Generated
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setActiveAudio(activeAudio === 'flow' ? 'mute' : 'flow')}
                      style={{
                        background: activeAudio === 'flow' ? 'rgba(168, 85, 247, 0.3)' : 'transparent',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: activeAudio === 'flow' ? '#d8b4fe' : '#64748b',
                        borderRadius: 6,
                        padding: '3px 8px',
                        fontSize: 10.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      title="Bật/Tắt tiếng video AI"
                    >
                      {activeAudio === 'flow' ? <Volume2 size={12} /> : <VolumeX size={12} />}
                      <span>{activeAudio === 'flow' ? 'Audio ON' : 'Audio OFF'}</span>
                    </button>
                  </div>
                </div>

                {/* Video 1 Element */}
                <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#020617', minHeight: 0 }}>
                  <video
                    ref={flowVideoRef}
                    src={videoUrl}
                    playsInline
                    autoPlay
                    onTimeUpdate={handleTimeUpdate}
                    onEnded={handleVideoEnded}
                    onClick={togglePlaySync}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      cursor: 'pointer',
                    }}
                  />
                  {!isPlaying && (
                    <div
                      onClick={togglePlaySync}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(0,0,0,0.3)',
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: '50%',
                          background: 'rgba(168, 85, 247, 0.85)',
                          backdropFilter: 'blur(8px)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                          boxShadow: '0 0 24px rgba(168, 85, 247, 0.6)',
                        }}
                      >
                        <Play size={24} style={{ marginLeft: 3 }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* CỘT 2: VIDEO THAM CHIẾU (MOTION REFERENCE) */}
              <div
                style={{
                  minWidth: 0,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  background: 'rgba(15, 23, 42, 0.65)',
                  borderRadius: 14,
                  border: '1px solid rgba(14, 165, 233, 0.3)',
                  boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4), inset 0 0 20px rgba(14, 165, 233, 0.05)',
                  overflow: 'hidden',
                  position: 'relative',
                }}
              >
                {/* Header Card 2 */}
                <div
                  style={{
                    padding: '8px 14px',
                    background: 'linear-gradient(90deg, rgba(14, 165, 233, 0.18) 0%, rgba(15, 23, 42, 0.6) 100%)',
                    borderBottom: '1px solid rgba(14, 165, 233, 0.25)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexShrink: 0,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#0ea5e9', boxShadow: '0 0 8px #0ea5e9' }} />
                    <span style={{ color: '#bae6fd', fontSize: 12, fontWeight: 800, letterSpacing: 0.3 }}>
                      VIDEO THAM CHIẾU MOTION
                    </span>
                    <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 4, background: '#0ea5e9', color: '#ffffff', fontWeight: 700 }}>
                      Original Reference
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <button
                      type="button"
                      onClick={() => setActiveAudio(activeAudio === 'reference' ? 'mute' : 'reference')}
                      style={{
                        background: activeAudio === 'reference' ? 'rgba(14, 165, 233, 0.3)' : 'transparent',
                        border: '1px solid rgba(255, 255, 255, 0.15)',
                        color: activeAudio === 'reference' ? '#7dd3fc' : '#64748b',
                        borderRadius: 6,
                        padding: '3px 8px',
                        fontSize: 10.5,
                        fontWeight: 700,
                        cursor: 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      title="Bật/Tắt tiếng video tham chiếu"
                    >
                      {activeAudio === 'reference' ? <Volume2 size={12} /> : <VolumeX size={12} />}
                      <span>{activeAudio === 'reference' ? 'Audio ON' : 'Audio OFF'}</span>
                    </button>
                  </div>
                </div>

                {/* Video 2 Element */}
                <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#020617', minHeight: 0 }}>
                  <video
                    ref={refVideoRef}
                    src={referenceVideoUrl || ''}
                    playsInline
                    autoPlay
                    onClick={togglePlaySync}
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'contain',
                      cursor: 'pointer',
                    }}
                  />
                  {!isPlaying && (
                    <div
                      onClick={togglePlaySync}
                      style={{
                        position: 'absolute',
                        inset: 0,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background: 'rgba(0,0,0,0.3)',
                        cursor: 'pointer',
                      }}
                    >
                      <div
                        style={{
                          width: 56,
                          height: 56,
                          borderRadius: '50%',
                          background: 'rgba(14, 165, 233, 0.85)',
                          backdropFilter: 'blur(8px)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#ffffff',
                          boxShadow: '0 0 24px rgba(14, 165, 233, 0.6)',
                        }}
                      >
                        <Play size={24} style={{ marginLeft: 3 }} />
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : (
            /* BỐ CỤC 1 VIDEO ĐƠN (FULL VIEW) */
            <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <video
                src={videoUrl}
                controls
                autoPlay
                playsInline
                style={{
                  width: '100%',
                  height: '100%',
                  maxHeight: '74vh',
                  objectFit: 'contain',
                  borderRadius: 12,
                }}
              />
            </div>
          )}
        </div>

        {/* ── THANH ĐIỀU KHIỂN ĐỒNG BỘ NỔI BẬT (SYNC CONTROL DECK) ── */}
        {hasReference && (
          <div
            style={{
              padding: '10px 20px',
              background: 'linear-gradient(180deg, #090d16 0%, #0f172a 100%)',
              borderTop: '1px solid rgba(255, 255, 255, 0.1)',
              display: 'flex',
              flexDirection: 'column',
              gap: 8,
              flexShrink: 0,
            }}
          >
            {/* Scrubber Timeline Bar */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <span style={{ fontSize: 11.5, fontFamily: 'monospace', color: '#a5b4fc', fontWeight: 700, minWidth: 50 }}>
                {formatTime(currentTime)}
              </span>

              <input
                type="range"
                min={0}
                max={duration || 6}
                step={0.05}
                value={currentTime}
                onChange={handleSeek}
                style={{
                  flex: 1,
                  accentColor: '#ec4899',
                  cursor: 'pointer',
                  height: 6,
                  borderRadius: 3,
                }}
              />

              <span style={{ fontSize: 11.5, fontFamily: 'monospace', color: '#94a3b8', fontWeight: 600, minWidth: 50, textAlign: 'right' }}>
                {formatTime(duration)}
              </span>
            </div>

            {/* Buttons Row */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
              {/* Cụm nút Play Sync & Restart */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {/* NÚT PHÁT ĐỒNG THỜI 2 VIDEO (NỔI BẬT NHẤT THEO YÊU CẦU USER) */}
                <button
                  type="button"
                  onClick={togglePlaySync}
                  style={{
                    padding: '8px 20px',
                    borderRadius: 10,
                    border: 'none',
                    background: isPlaying
                      ? 'linear-gradient(135deg, #f59e0b 0%, #d97706 100%)'
                      : 'linear-gradient(135deg, #6366f1 0%, #ec4899 100%)',
                    color: '#ffffff',
                    fontSize: 13,
                    fontWeight: 800,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 8,
                    boxShadow: isPlaying
                      ? '0 4px 14px rgba(245, 158, 11, 0.4)'
                      : '0 4px 20px rgba(236, 72, 153, 0.45)',
                    transition: 'all 0.15s cubic-bezier(0.4, 0, 0.2, 1)',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.transform = 'scale(1.03)')}
                  onMouseLeave={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                  title="Phát hoặc tạm dừng cả 2 video cùng lúc (Phím Space)"
                >
                  {isPlaying ? <Pause size={16} /> : <Play size={16} />}
                  <span>{isPlaying ? 'Tạm dừng cả 2' : 'Phát đồng thời 2 video'}</span>
                </button>

                {/* Nút tua về 0s */}
                <button
                  type="button"
                  onClick={handleRestartSync}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 10,
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(255, 255, 255, 0.08)',
                    color: '#e2e8f0',
                    fontSize: 12,
                    fontWeight: 700,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    transition: 'all 0.15s ease',
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.15)')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
                  title="Tua lại từ đầu 0s (Phím R)"
                >
                  <RotateCcw size={14} />
                  <span>Tua về 0s</span>
                </button>
              </div>

              {/* Tốc độ phát Slow Motion */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'rgba(255,255,255,0.05)', padding: '3px 6px', borderRadius: 8, border: '1px solid rgba(255,255,255,0.1)' }}>
                <Gauge size={13} color="#94a3b8" style={{ marginLeft: 4 }} />
                <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 600, marginRight: 2 }}>Tốc độ:</span>
                {[0.5, 1, 1.5].map((speed) => (
                  <button
                    key={speed}
                    type="button"
                    onClick={() => handleChangeSpeed(speed)}
                    style={{
                      padding: '3px 8px',
                      borderRadius: 6,
                      border: 'none',
                      background: playbackSpeed === speed ? '#6366f1' : 'transparent',
                      color: playbackSpeed === speed ? '#ffffff' : '#cbd5e1',
                      fontSize: 11,
                      fontWeight: 700,
                      cursor: 'pointer',
                      transition: 'all 0.1s ease',
                    }}
                    title={speed === 0.5 ? 'Chế độ Slow Motion so sánh cử động chậm' : `${speed}x`}
                  >
                    {speed}x
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── PROMPT KỊCH BẢN ĐIỆN ẢNH (COLLAPSIBLE FOOTER) ── */}
        {prompt && (
          <div
            style={{
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              background: '#0d1322',
              flexShrink: 0,
            }}
          >
            <div
              onClick={() => setIsPromptExpanded(!isPromptExpanded)}
              style={{
                padding: '8px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                cursor: 'pointer',
                userSelect: 'none',
                background: 'rgba(255, 255, 255, 0.02)',
              }}
            >
              <div style={{ fontWeight: 700, color: '#f43f5e', fontSize: 11.5, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={13} />
                <span>Prompt kịch bản điện ảnh đã gửi lên Flow:</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    handleCopyPrompt()
                  }}
                  style={{
                    padding: '2px 8px',
                    borderRadius: 4,
                    border: '1px solid rgba(255, 255, 255, 0.15)',
                    background: 'rgba(255, 255, 255, 0.06)',
                    color: '#94a3b8',
                    fontSize: 10.5,
                    fontWeight: 600,
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                  title="Sao chép prompt này"
                >
                  {copiedPrompt ? <Check size={11} color="#10b981" /> : <Copy size={11} />}
                  <span>{copiedPrompt ? 'Đã chép' : 'Chép prompt'}</span>
                </button>
                <div style={{ color: '#64748b' }}>
                  {isPromptExpanded ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
                </div>
              </div>
            </div>

            {isPromptExpanded && (
              <div
                style={{
                  padding: '6px 18px 12px 18px',
                  maxHeight: 120,
                  overflowY: 'auto',
                  fontSize: 11,
                  lineHeight: 1.45,
                  color: '#e2e8f0',
                  whiteSpace: 'pre-wrap',
                }}
              >
                {prompt}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
