import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Loader2 } from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import type { AudioChapter } from './audioModel'

interface ChapterContent {
  chapter_number: number
  title: string
  paragraph: string
  chars: number
}

// Cache nội dung đã xem (đọc lại / lùi tiến không phải tải lại). Giới hạn để không phình bộ nhớ: mỗi chương ~8 KB.
const CACHE = new Map<string, ChapterContent>()
const CACHE_LIMIT = 60

function remember(key: string, value: ChapterContent) {
  CACHE.delete(key)
  CACHE.set(key, value)
  while (CACHE.size > CACHE_LIMIT) CACHE.delete(CACHE.keys().next().value as string)
}

interface ChapterReaderProps {
  slug: string
  chapters: AudioChapter[]
  /** Chương đang xem (null = chưa chọn). */
  viewing: number | null
  onView: (chapter: number) => void
}

/** Đọc nội dung một chương (chỉ tải khi xem) kèm nút chương trước/sau — xem không làm thay đổi hàng đợi. */
export function ChapterReader({ slug, chapters, viewing, onView }: ChapterReaderProps) {
  const key = viewing === null ? '' : `${slug}:${viewing}`
  const [state, setState] = useState<{ key: string; data?: ChapterContent; error?: boolean }>({ key: '' })

  useEffect(() => {
    if (!key || viewing === null) return
    const cached = CACHE.get(key)
    if (cached) { setState({ key, data: cached }); return }
    let alive = true
    setState({ key })
    fetch(`${API_URL}/api/audio/stories/${encodeURIComponent(slug)}/chapters/${viewing}`)
      .then(response => (response.ok ? response.json() : Promise.reject(new Error(String(response.status)))))
      .then((data: ChapterContent) => { remember(key, data); if (alive) setState({ key, data }) })
      .catch(() => { if (alive) setState({ key, error: true }) })
    return () => { alive = false }
  }, [key, slug, viewing])

  if (viewing === null) {
    return <div className="aw-empty">Bấm vào một số chương ở trên để đọc nội dung chương đó.</div>
  }

  const index = chapters.findIndex(chapter => chapter.chapter_number === viewing)
  const prev = index > 0 ? chapters[index - 1].chapter_number : null
  const next = index >= 0 && index < chapters.length - 1 ? chapters[index + 1].chapter_number : null
  const ready = state.key === key ? state : { key }
  const title = ready.data?.title ?? chapters[index]?.title ?? ''

  return (
    <div className="aw-reader-content">
      <div className="aw-reader-bar">
        <button type="button" className="aw-icon-btn" onClick={() => prev !== null && onView(prev)} disabled={prev === null} aria-label="Chương trước" title="Chương trước"><ChevronLeft size={16} /></button>
        <div className="aw-reader-title">
          <strong title={title}>Chương {viewing}{title && title !== `Chương ${viewing}` ? ` · ${title}` : ''}</strong>
          {ready.data && <small>{ready.data.chars.toLocaleString('vi-VN')} ký tự</small>}
        </div>
        <button type="button" className="aw-icon-btn" onClick={() => next !== null && onView(next)} disabled={next === null} aria-label="Chương sau" title="Chương sau"><ChevronRight size={16} /></button>
      </div>
      {ready.error ? (
        <div className="aw-empty aw-warn">Không tải được nội dung chương này.</div>
      ) : !ready.data ? (
        <div className="aw-empty"><Loader2 size={16} className="spin" /> Đang tải nội dung…</div>
      ) : ready.data.paragraph ? (
        <article className="aw-reader-text" key={key}>{ready.data.paragraph}</article>
      ) : (
        <div className="aw-empty">Chương này không có nội dung.</div>
      )}
    </div>
  )
}
