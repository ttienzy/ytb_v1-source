import { API_URL } from '../../shared/constants'
import { blurClipPath, cropFrame, type Options } from './videoModel'

interface PreviewStageProps {
  options: Options
  /** Đường dẫn video đang xem trước (video đầu tiên được chọn); undefined = chưa chọn. */
  src: string | undefined
  name?: string
}

/** Xem trước trực tiếp: nền + video + khung cắt + vùng làm mờ + nhãn, đúng khổ đầu ra. */
export function PreviewStage({ options, src, name }: PreviewStageProps) {
  const frame = cropFrame(options)
  const background = options.background_image
    ? { backgroundImage: `url(${API_URL}/api/video/background/${options.background_image})`, backgroundSize: 'cover', backgroundPosition: 'center' }
    : {}
  const blur = options.blur
  return (
    <div className="vp-preview">
      <div className="vp-stage-wrap">
      <div className={`vp-stage a-${options.aspect.replace(':', '-')}`} style={{ backgroundColor: options.background, ...background }}>
        {src ? <video src={src} muted controls loop /> : <div className="vp-stage-empty">Chọn một video ở kho để xem trước</div>}
        <div className="vp-safe" />
        {frame && <div className="vp-crop" style={frame} />}
        {blur.enabled && (
          <>
            {src && <video className="vp-blur-video" src={src} muted autoPlay loop style={{ clipPath: blurClipPath(blur), filter: `blur(${Math.max(1, blur.amount / 8)}px)` }} />}
            <div className="vp-blur-frame" style={{ left: `${blur.x * 100}%`, top: `${blur.y * 100}%`, width: `${blur.w * 100}%`, height: `${blur.h * 100}%` }}>Làm mờ {blur.amount}%</div>
          </>
        )}
        <div className={`vp-label pos-${options.label_position}`} style={{ background: options.label_background, ...(options.label_position === 'custom' ? { left: `${options.label_x * 100}%`, top: `${options.label_y * 100}%`, bottom: 'auto' } : {}) }}>
          {options.label || 'Nhãn'}
        </div>
      </div>
      </div>
      {name && <small className="vp-preview-name" title={name}>{name}</small>}
    </div>
  )
}
