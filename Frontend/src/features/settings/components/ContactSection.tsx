import { useState } from 'react'
import {
  Check,
  Copy,
  ExternalLink,
  Headphones,
  HelpCircle,
  MessageCircle,
  QrCode,
  Send,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import telegramQrImg from '@/assets/telegram_qr.png'
import foreverAvatarImg from '@/assets/forever.png'

export function ContactSection() {
  const [copied, setCopied] = useState(false)

  const telegramUsername = 'ttienzy'
  const telegramUrl = 'https://t.me/ttienzy'

  const handleCopy = () => {
    navigator.clipboard.writeText(`@${telegramUsername}`)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="tab-fade-in" style={{ maxWidth: 880, margin: '0 auto' }}>
      {/* ── Main Clean Card ── */}
      <div
        className="settings-card"
        style={{
          background: 'var(--card-bg, #ffffff)',
          border: '1px solid var(--border-color, #e2e8f0)',
          borderRadius: 14,
          padding: '26px 30px',
          boxShadow: '0 1px 3px rgba(0, 0, 0, 0.04), 0 1px 2px rgba(0, 0, 0, 0.02)',
        }}
      >
        {/* Header: Icon + Title + Subtitle */}
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: 'rgba(36, 161, 222, 0.1)',
              border: '1px solid rgba(36, 161, 222, 0.25)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#24A1DE',
              flexShrink: 0,
              marginTop: 2,
            }}
          >
            <Send size={22} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: 'uppercase',
                  letterSpacing: '0.06em',
                  color: '#24A1DE',
                  background: 'rgba(36, 161, 222, 0.08)',
                  padding: '2px 8px',
                  borderRadius: 6,
                }}
              >
                Tác giả &amp; Hỗ trợ
              </span>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  fontSize: 11.5,
                  fontWeight: 500,
                  color: '#10b981',
                  background: 'rgba(16, 185, 129, 0.08)',
                  padding: '2px 8px',
                  borderRadius: 6,
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: '#10b981',
                    boxShadow: '0 0 0 2px rgba(16, 185, 129, 0.25)',
                  }}
                />
                Trực tuyến Telegram
              </span>
            </div>
            <h3
              style={{
                margin: 0,
                fontSize: 18,
                fontWeight: 700,
                color: 'var(--text-primary, #0f172a)',
                lineHeight: 1.3,
              }}
            >
              Thông tin liên hệ &amp; Kênh hỗ trợ
            </h3>
            <p
              style={{
                margin: '5px 0 0',
                fontSize: 13,
                color: 'var(--text-secondary, #64748b)',
                lineHeight: 1.45,
              }}
            >
              Quét mã QR Telegram bên dưới hoặc liên hệ trực tiếp với tác giả để được hỗ trợ kỹ thuật, hướng dẫn cấu hình và giải đáp thắc mắc về CreatorFlow AI.
            </p>
          </div>
        </div>

        {/* ── Main Two-Column Grid ── */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(280px, 320px) 1fr',
            gap: 28,
            alignItems: 'start',
          }}
        >
          {/* Cột Trái: Thẻ QR Telegram */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              background: 'linear-gradient(180deg, #f8fafc 0%, #f1f5f9 100%)',
              border: '1px solid #e2e8f0',
              borderRadius: 16,
              padding: '22px 18px 18px',
              textAlign: 'center',
              boxShadow: '0 4px 12px rgba(15, 23, 42, 0.03)',
            }}
          >
            {/* Ảnh QR Telegram với khung bo viền cao cấp */}
            <div
              style={{
                position: 'relative',
                background: '#ffffff',
                borderRadius: 14,
                padding: '10px',
                border: '1px solid #cbd5e1',
                boxShadow: '0 10px 25px -5px rgba(36, 161, 222, 0.12), 0 8px 10px -6px rgba(0, 0, 0, 0.04)',
                maxWidth: '100%',
              }}
            >
              <img
                src={telegramQrImg}
                alt="Telegram QR Code - Tien (@ttienzy)"
                style={{
                  display: 'block',
                  width: '100%',
                  maxWidth: 240,
                  height: 'auto',
                  borderRadius: 10,
                }}
              />
            </div>

            {/* Chú thích phía dưới QR */}
            <div
              style={{
                marginTop: 14,
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 12,
                fontWeight: 500,
                color: '#475569',
              }}
            >
              <QrCode size={14} style={{ color: '#24A1DE' }} />
              <span>Quét mã bằng ứng dụng Telegram</span>
            </div>

            {/* Nút bấm mở Telegram trực tiếp */}
            <a
              href={telegramUrl}
              target="_blank"
              rel="noreferrer"
              style={{
                marginTop: 14,
                width: '100%',
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '10px 16px',
                borderRadius: 10,
                background: '#24A1DE',
                color: '#ffffff',
                fontSize: 13.5,
                fontWeight: 600,
                textDecoration: 'none',
                boxShadow: '0 4px 12px rgba(36, 161, 222, 0.3)',
                transition: 'all 0.15s ease',
              }}
              onMouseEnter={e => {
                e.currentTarget.style.background = '#1d93cb'
                e.currentTarget.style.transform = 'translateY(-1px)'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.background = '#24A1DE'
                e.currentTarget.style.transform = 'translateY(0)'
              }}
            >
              <Send size={15} />
              <span>Mở Telegram (@{telegramUsername})</span>
              <ExternalLink size={13} style={{ opacity: 0.8 }} />
            </a>
          </div>

          {/* Cột Phải: Thông tin chi tiết & Kênh liên hệ */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Thẻ Profile Tác giả */}
            <div
              style={{
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: '16px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 14,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <img
                  src={foreverAvatarImg}
                  alt="Tien Avatar"
                  style={{
                    width: 46,
                    height: 46,
                    borderRadius: '50%',
                    border: '2px solid #e2e8f0',
                    boxShadow: '0 2px 6px rgba(0, 0, 0, 0.08)',
                  }}
                />
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#0f172a' }}>
                      Tien
                    </h4>
                    <span
                      style={{
                        fontSize: 11,
                        fontWeight: 600,
                        color: '#4f46e5',
                        background: 'rgba(79, 70, 229, 0.08)',
                        padding: '1px 7px',
                        borderRadius: 5,
                      }}
                    >
                      Lead Developer
                    </span>
                  </div>
                  <span style={{ fontSize: 12.5, color: '#64748b' }}>
                    Tác giả CreatorFlow AI · @{telegramUsername}
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleCopy}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  padding: '7px 12px',
                  borderRadius: 8,
                  fontSize: 12,
                  fontWeight: 600,
                  background: copied ? 'rgba(16, 185, 129, 0.1)' : '#f8fafc',
                  border: `1px solid ${copied ? '#10b981' : '#cbd5e1'}`,
                  color: copied ? '#059669' : '#334155',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
                title="Sao chép username Telegram"
              >
                {copied ? <Check size={13} /> : <Copy size={13} />}
                <span>{copied ? 'Đã chép!' : 'Chép Handle'}</span>
              </button>
            </div>

            {/* Các lĩnh vực hỗ trợ */}
            <div
              style={{
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                padding: '16px 18px',
              }}
            >
              <h4
                style={{
                  margin: '0 0 10px',
                  fontSize: 13,
                  fontWeight: 700,
                  color: '#334155',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                }}
              >
                <Headphones size={15} style={{ color: '#4f46e5' }} />
                Nội dung hỗ trợ kỹ thuật
              </h4>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#475569' }}>
                  <Sparkles size={14} style={{ color: '#f59e0b', flexShrink: 0, marginTop: 2 }} />
                  <span>
                    <strong>Cấu hình API &amp; Dịch vụ:</strong> Trợ giúp kết nối Google Gemini, Veo Video Studio, YouTube OAuth &amp; tài khoản ChatGPT.
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#475569' }}>
                  <HelpCircle size={14} style={{ color: '#3b82f6', flexShrink: 0, marginTop: 2 }} />
                  <span>
                    <strong>Xây dựng kịch bản &amp; Prompt:</strong> Tối ưu luồng phân tách cảnh, bóc tách truyện chữ và tạo storyboard tự động.
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12.5, color: '#475569' }}>
                  <MessageCircle size={14} style={{ color: '#10b981', flexShrink: 0, marginTop: 2 }} />
                  <span>
                    <strong>Báo lỗi &amp; Góp ý tính năng:</strong> Phản hồi trực tiếp các vấn đề phát sinh trong quá trình sử dụng phần mềm.
                  </span>
                </div>
              </div>
            </div>

            {/* Thông tin phần mềm */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '12px 16px',
                background: '#ffffff',
                border: '1px solid #e2e8f0',
                borderRadius: 12,
                fontSize: 12.5,
                color: '#475569',
              }}
            >
              <ShieldCheck size={16} style={{ color: '#6366f1', flexShrink: 0 }} />
              <span>
                <strong>CreatorFlow AI</strong> · v1.0.1 · AI Video Production &amp; Multi-Channel Studio
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
