import { useRef, useState } from 'react'
import { BookOpen, Check, ImagePlus, Loader2, Sparkles } from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import { ChapterReader } from './ChapterReader'
import { StorySummary } from './StorySummary'
import { chapterRange, doneSet, MAX_QUEUE_STORIES, canAddStory, setStoryChapters, toggleChapter, type AudioChapter, type AudioStory, type QueueItem, type StoryView } from './audioModel'

interface ChapterPickerProps {
  view: StoryView | null
  /** Chương của truyện đang xem: undefined = đang tải, null = tải lỗi. Tải theo từng truyện khi chọn (không nạp sẵn cả kho). */
  chapters: AudioChapter[] | null | undefined
  onRetry: () => void
  queue: QueueItem[]
  onQueueChange: (queue: QueueItem[]) => void
  thumbnailBusy: boolean
  onUploadThumbnail: (slug: string, file: File) => void
  onNotice: (message: string) => void
  /** Gọi khi bản tóm tắt Gemini của truyện vừa được lưu xong. */
  onSummarySaved: (slug: string) => void
}

export function thumbnailUrl(name: string): string {
  return `${API_URL}/api/audio/thumbnails/${encodeURIComponent(name)}`
}

/** Ảnh dùng cho video của truyện: ảnh upload tay (nếu có) → ảnh bìa nguồn (backend tải + cache lần đầu). */
export function storyImageUrl(story: AudioStory): string {
  const version = story.thumbnail_name ? `?v=${encodeURIComponent(story.thumbnail_name)}` : ''
  return `${API_URL}/api/audio/stories/${encodeURIComponent(story.story_slug)}/cover${version}`
}

/** Chọn chương của một truyện: lưới số chương (click để chọn, Shift+click chọn cả dải). */
export function ChapterPicker({ view, chapters, onRetry, queue, onQueueChange, thumbnailBusy, onUploadThumbnail, onNotice, onSummarySaved }: ChapterPickerProps) {
  // Component được đặt key theo truyện nên các state này tự reset khi đổi truyện.
  const [tab, setTab] = useState<'summary' | 'chapter'>('summary')
  const [viewing, setViewing] = useState<number | null>(null)
  const lastClicked = useRef<{ slug: string; chapter: number } | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  if (!view) {
    return <div className="aw-chapters aw-empty">Chọn một truyện ở danh sách bên trái để chọn chương.</div>
  }

  const { story } = view
  const slug = story.story_slug
  const hasImage = !!(story.thumbnail_name || story.has_cover)
  const selected = new Set(queue.find(item => item.story_slug === slug)?.chapter_numbers ?? [])
  const list = chapters ?? []
  const done = doneSet(chapters)
  const shown = list.map(chapter => chapter.chapter_number)

  const apply = (numbers: number[]) => {
    if (!canAddStory(queue, slug)) {
      onNotice(`Hàng đợi tối đa ${MAX_QUEUE_STORIES} truyện. Bỏ bớt một truyện trước khi thêm truyện mới.`)
      return
    }
    onQueueChange(setStoryChapters(queue, slug, numbers))
  }

  const click = (chapter: number, shift: boolean, readOnly: boolean) => {
    // Bấm số chương vừa chọn vào hàng đợi vừa mở nội dung chương đó để đọc; Ctrl+click chỉ đọc (không đụng tới hàng đợi).
    setViewing(chapter)
    setTab('chapter')
    if (readOnly) return
    if (shift && lastClicked.current?.slug === slug) {
      apply([...selected, ...chapterRange(shown, lastClicked.current.chapter, chapter)])
    } else if (!canAddStory(queue, slug)) {
      onNotice(`Hàng đợi tối đa ${MAX_QUEUE_STORIES} truyện. Bỏ bớt một truyện trước khi thêm truyện mới.`)
      return
    } else {
      onQueueChange(toggleChapter(queue, slug, chapter))
    }
    lastClicked.current = { slug, chapter }
  }

  const pending = shown.filter(number => !done.has(number))

  return (
    <div className="aw-chapters">
      <div className="aw-chapters-head">
        <button
          type="button"
          className={`aw-thumb-btn ${hasImage ? '' : 'missing'}`}
          onClick={() => fileInput.current?.click()}
          disabled={thumbnailBusy}
          title={story.thumbnail_name ? 'Ảnh bạn đã tải lên — bấm để đổi' : story.has_cover ? 'Ảnh bìa nguồn: dùng làm hình video + thumbnail. Bấm để thay bằng ảnh của bạn.' : 'Truyện không có ảnh bìa — video dùng ảnh thay thế. Bấm để thêm ảnh.'}
        >
          {thumbnailBusy ? <Loader2 size={16} className="spin" /> : hasImage ? <img src={storyImageUrl(story)} alt="" /> : <ImagePlus size={18} />}
          <span>{hasImage ? 'Đổi ảnh' : 'Thêm ảnh'}</span>
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          hidden
          onChange={event => {
            const file = event.target.files?.[0]
            if (file) onUploadThumbnail(slug, file)
            event.currentTarget.value = ''
          }}
        />
        <div className="aw-chapters-title">
          <strong title={story.name}>{story.name}</strong>
          <small>
            {view.doneCount}/{view.total} chương đã làm · {story.thumbnail_name ? 'ảnh của bạn' : story.has_cover ? 'ảnh bìa nguồn' : <em className="aw-warn">không có ảnh bìa</em>}
          </small>
        </div>
      </div>

      <div className="aw-chapters-actions">
        <button type="button" onClick={() => apply(pending)} disabled={!pending.length} title="Chọn mọi chương chưa làm">Chưa làm ({pending.length})</button>
        <button type="button" onClick={() => apply(shown)} disabled={!shown.length}>Tất cả</button>
        <button type="button" onClick={() => apply([])} disabled={!selected.size}>Bỏ chọn</button>
        <span className="aw-chapters-count">{selected.size ? `Đã chọn ${selected.size}` : 'Shift+click: chọn dải · Ctrl+click: chỉ đọc'}</span>
      </div>

      {chapters === undefined ? (
        <div className="aw-empty"><Loader2 size={16} className="spin" /> Đang tải chương…</div>
      ) : chapters === null ? (
        <div className="aw-empty aw-warn">Không tải được danh sách chương. <button type="button" className="aw-link" onClick={onRetry}>Thử lại</button></div>
      ) : shown.length === 0 ? (
        <div className="aw-empty">Truyện này chưa có chương nào được crawl.</div>
      ) : (
        <>
        <div className="aw-chapter-grid">
          {list.map(chapter => {
            const isDone = done.has(chapter.chapter_number)
            const isSelected = selected.has(chapter.chapter_number)
            return (
              <button
                key={chapter.chapter_number}
                type="button"
                className={`aw-chip ${isSelected ? 'selected' : ''} ${isDone ? 'done' : ''}`}
                onClick={event => click(chapter.chapter_number, event.shiftKey, event.ctrlKey || event.metaKey)}
                title={`Chương ${chapter.chapter_number} · ${chapter.title}${isDone ? ' · đã làm (chọn để làm lại)' : ''}`}
                aria-pressed={isSelected}
              >
                {isDone && !isSelected && <Check size={10} strokeWidth={3} />}
                {chapter.chapter_number}
              </button>
            )
          })}
        </div>

        <div className="aw-reader">
          <div className="aw-tabs" role="tablist" aria-label="Xem truyện">
            <button type="button" role="tab" aria-selected={tab === 'summary'} className={tab === 'summary' ? 'active' : ''} onClick={() => setTab('summary')}>
              <Sparkles size={13} /> Tóm tắt cốt truyện{story.has_summary && <i className="aw-dot" title="Đã có tóm tắt" />}
            </button>
            <button type="button" role="tab" aria-selected={tab === 'chapter'} className={tab === 'chapter' ? 'active' : ''} onClick={() => setTab('chapter')}>
              <BookOpen size={13} /> Đọc chương{viewing !== null ? ` ${viewing}` : ''}
            </button>
          </div>
          <div className="aw-reader-body">
            {tab === 'summary'
              ? <StorySummary slug={slug} totalChapters={view.total} onSaved={onSummarySaved} />
              : <ChapterReader slug={slug} chapters={list} viewing={viewing} onView={setViewing} />}
          </div>
        </div>
        </>
      )}
    </div>
  )
}
