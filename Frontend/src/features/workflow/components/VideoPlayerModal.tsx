import React from 'react'
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
  const [copied, setCopied] = React.useState(false)

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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        background: 'rgba(10, 15, 30, 0.85)',
        backdropFilter: 'blur(8px)',
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
          maxWidth: aspectRatio === '9:16' ? 440 : 860,
          maxHeight: '94vh',
          background: '#0f172a',
          borderRadius: 16,
          border: '1px solid rgba(255, 255, 255, 0.15)',
          boxShadow: '0 25px 60px rgba(0, 0, 0, 0.6)',
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
            padding: '12px 18px',
            borderBottom: '1px solid rgba(255, 255, 255, 0.1)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            background: 'rgba(30, 41, 59, 0.5)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
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
              }}
            >
              <Film size={15} />
            </div>
            <div>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f8fafc' }}>
                {title}
              </div>
              <div style={{ fontSize: 10.5, color: '#94a3b8', display: 'flex', gap: 8 }}>
                <span>Khung hình: <strong>{aspectRatio}</strong></span>
                {durationSec ? <span>• Thời lượng: <strong>{durationSec}s</strong></span> : null}
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
                border: 'none',
                background: 'rgba(255, 255, 255, 0.08)',
                color: '#94a3b8',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
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
            minHeight: aspectRatio === '9:16' ? 420 : 320,
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

        {/* Prompt Information footer if available */}
        {prompt && (
          <div
            style={{
              padding: '10px 16px',
              background: '#1e293b',
              borderTop: '1px solid rgba(255, 255, 255, 0.08)',
              fontSize: 11,
              color: '#cbd5e1',
              maxHeight: 120,
              overflowY: 'auto',
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
}
