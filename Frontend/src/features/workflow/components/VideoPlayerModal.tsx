import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Download, Copy, Check, Film, Sparkles } from 'lucide-react'

interface VideoPlayerModalProps {
  isOpen: boolean
  onClose: () => void
  videoUrl: string
  title?: string
  prompt?: string
  durationSec?: number
  aspectRatio?: string
}

export function VideoPlayerModal({
  isOpen,
  onClose,
  videoUrl,
  title = 'Xem toàn cảnh Video',
  prompt,
  durationSec,
  aspectRatio = '9:16',
}: VideoPlayerModalProps) {
  const [copied, setCopied] = useState(false)

  // Đóng modal khi nhấn phím Escape (ESC)
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !videoUrl) return null

  const handleCopyUrl = () => {
    navigator.clipboard.writeText(videoUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
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
        background: 'rgba(5, 8, 18, 0.88)',
        backdropFilter: 'blur(10px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '24px 20px',
      }}
      onClick={onClose}
    >
      {/* Nút thoát nổi ở góc trên bên phải màn hình (Luôn luôn bấm được dù màn hình nhỏ hay lớn) */}
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
          padding: '7px 14px',
          borderRadius: 24,
          border: '1px solid rgba(255, 255, 255, 0.3)',
          background: 'rgba(15, 23, 42, 0.8)',
          color: '#ffffff',
          fontSize: 12,
          fontWeight: 700,
          cursor: 'pointer',
          backdropFilter: 'blur(8px)',
          boxShadow: '0 4px 18px rgba(0,0,0,0.5)',
          transition: 'all 0.15s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = '#ef4444'
          e.currentTarget.style.borderColor = '#ef4444'
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'rgba(15, 23, 42, 0.8)'
          e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.3)'
        }}
        title="Đóng xem video (Phím ESC)"
      >
        <X size={16} />
        <span>Đóng (ESC)</span>
      </button>

      {/* Khung chứa nội dung Modal */}
      <div
        style={{
          width: '100%',
          maxWidth: aspectRatio === '9:16' ? 440 : 860,
          maxHeight: '94vh',
          background: '#0f172a',
          borderRadius: 16,
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.7)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          position: 'relative',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header - Luôn cố định, không bị co ép */}
        <div
          style={{
            padding: '12px 18px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(30, 41, 59, 0.7)',
            flexShrink: 0,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
            <div
              style={{
                width: 28,
                height: 28,
                borderRadius: 8,
                background: 'linear-gradient(135deg, #f43f5e, #e11d48)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: '#ffffff',
                flexShrink: 0,
              }}
            >
              <Film size={15} />
            </div>
            <div style={{ minWidth: 0 }}>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#f8fafc',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {title}
              </div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', display: 'flex', gap: 8 }}>
                <span>Khung hình: <strong>{aspectRatio}</strong></span>
                {durationSec ? <span>• Thời lượng: <strong>{durationSec}s</strong></span> : null}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            <button
              type="button"
              onClick={handleCopyUrl}
              style={{
                padding: '5px 10px',
                borderRadius: 6,
                border: '1px solid rgba(255, 255, 255, 0.15)',
                background: 'rgba(255, 255, 255, 0.06)',
                color: '#cbd5e1',
                fontSize: 11,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
              title="Sao chép link video"
            >
              {copied ? <Check size={12} color="#10b981" /> : <Copy size={12} />}
              {copied ? 'Đã chép' : 'Copy link'}
            </button>

            <button
              type="button"
              onClick={handleDownload}
              style={{
                padding: '5px 12px',
                borderRadius: 6,
                border: 'none',
                background: 'linear-gradient(135deg, #f43f5e, #e11d48)',
                color: '#ffffff',
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 5,
              }}
            >
              <Download size={12} />
              Tải MP4
            </button>

            <button
              type="button"
              onClick={onClose}
              style={{
                width: 28,
                height: 28,
                borderRadius: 6,
                border: '1px solid rgba(239, 68, 68, 0.3)',
                background: 'rgba(239, 68, 68, 0.15)',
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
                e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)'
                e.currentTarget.style.color = '#fca5a5'
              }}
              title="Đóng (ESC)"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* Video Player (Full View - Object Fit Contain) */}
        <div
          style={{
            flex: 1,
            background: '#050811',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            position: 'relative',
            minHeight: aspectRatio === '9:16' ? 380 : 320,
            maxHeight: '68vh',
          }}
        >
          <video
            src={videoUrl}
            controls
            autoPlay
            playsInline
            style={{
              width: '100%',
              height: '100%',
              maxHeight: '68vh',
              objectFit: 'contain',
            }}
          />
        </div>

        {/* Prompt Information footer if available - Cố định không bị trôi */}
        {prompt && (
          <div
            style={{
              padding: '10px 16px',
              background: '#1e293b',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: 11,
              color: '#cbd5e1',
              maxHeight: 110,
              overflowY: 'auto',
              flexShrink: 0,
            }}
          >
            <div style={{ fontWeight: 700, color: '#f43f5e', marginBottom: 2, display: 'flex', alignItems: 'center', gap: 4 }}>
              <Sparkles size={11} /> Prompt kịch bản điện ảnh:
            </div>
            <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.4, color: '#e2e8f0', fontSize: 10.5 }}>
              {prompt}
            </div>
          </div>
        )}
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
