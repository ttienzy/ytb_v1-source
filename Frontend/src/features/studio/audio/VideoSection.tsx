import { lazy, Suspense, useEffect, useState, type RefObject } from 'react'
import { ChevronDown, ChevronUp, Loader2 } from 'lucide-react'

// Nhúng nguyên trang Video (kho video nguồn, chỉnh sửa, kho hoàn tất, Gộp). Tải mã của nó khi mở lần đầu.
const VideoPage = lazy(() => import('../../video/VideoPage').then(module => ({ default: module.VideoPage })))

interface VideoSectionProps {
  open: boolean
  onToggle: () => void
  /** Số video nguồn trong kho (hiện cạnh tiêu đề khi đang gập). */
  count: number
  /** Gọi mỗi khi danh sách video nguồn được nạp lại (mở khối, nhập, xóa) để Workflow Audio cập nhật trạng thái nền. */
  onLibraryChanged: () => void
  sectionRef: RefObject<HTMLElement | null>
}

/** Khối gập "Video nền": chứa trang Video như một phần của Workflow Audio. Giữ nguyên trạng thái bên trong khi gập lại. */
export function VideoSection({ open, onToggle, count, onLibraryChanged, sectionRef }: VideoSectionProps) {
  const [mounted, setMounted] = useState(false)
  useEffect(() => { if (open) setMounted(true) }, [open])

  return (
    <section className="aw-card aw-outputs aw-video-block" ref={sectionRef}>
      <div className="aw-outputs-head">
        <button type="button" className="aw-outputs-toggle" onClick={onToggle} aria-expanded={open}>
          {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          <strong>Video nền</strong>
          <span className="aw-pill neutral">{count}</span>
        </button>
        <small className="aw-video-hint">Video nhập ở đây là hình nền cho các video Audio — dùng chung mọi truyện, không cần chọn khổ.</small>
      </div>
      {mounted && (
        <div className="aw-video-body" hidden={!open}>
          <Suspense fallback={<div className="aw-empty"><Loader2 size={16} className="spin" /> Đang tải…</div>}>
            <VideoPage embedded onLibraryChanged={onLibraryChanged} />
          </Suspense>
        </div>
      )}
    </section>
  )
}
