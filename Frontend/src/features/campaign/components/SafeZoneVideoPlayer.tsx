import { useState } from 'react'
import { Eye, EyeOff, Heart, MessageCircle, Share2, ShoppingBag } from 'lucide-react'

interface Props {
  src: string
  ctaText?: string
  testId?: string
}

/** Trình phát xem trước video dọc 9:16 kèm lớp phủ mô phỏng Safe-Zone TikTok Shop / Reels. */
export function SafeZoneVideoPlayer({ src, ctaText, testId }: Props) {
  const [safeZone, setSafeZone] = useState(true)

  return (
    <div className="cp-sz-wrap" data-testid={testId || 'safe-zone-player'}>
      <div className="cp-sz-toolbar">
        <button
          type="button"
          className={`btn-g cp-small ${safeZone ? 'is-active' : ''}`}
          data-testid="toggle-safe-zone"
          aria-pressed={safeZone}
          onClick={() => setSafeZone((v) => !v)}
        >
          {safeZone ? <Eye size={13} /> : <EyeOff size={13} />}
          <span>{safeZone ? 'Đang bật khung Safe-Zone TikTok' : 'Bật khung Safe-Zone TikTok'}</span>
        </button>
      </div>
      <div className="cp-sz-frame">
        <video key={src} src={src} controls preload="metadata" playsInline />
        {safeZone && (
          <div className="cp-sz-overlay" aria-hidden="true" data-testid="safe-zone-overlay">
            <div className="cp-sz-top">
              <span>Đang Follow</span>
              <strong>Dành cho bạn</strong>
            </div>
            <div className="cp-sz-right">
              <span><Heart size={16} /></span>
              <span><MessageCircle size={16} /></span>
              <span><Share2 size={16} /></span>
            </div>
            <div className="cp-sz-bottom">
              <div className="cp-sz-bag">
                <ShoppingBag size={12} />
                <span>{ctaText?.trim() ? ctaText.trim() : 'Giỏ hàng cam · Xem mẫu'}</span>
              </div>
              <div className="cp-sz-lines">
                <i style={{ width: '72%' }} />
                <i style={{ width: '50%' }} />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
