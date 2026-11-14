import { useMemo, useState } from 'react'
import { Check, FileText, Loader2, Search, X } from 'lucide-react'
import { ChapterPicker, storyImageUrl } from './ChapterPicker'
import { estimateSeconds, filterStoryViews, formatDuration, type AudioChapter, type QueueItem, type StoryFilter, type StoryView } from './audioModel'
import { VirtualList } from './VirtualList'

const FILTERS: Array<{ key: StoryFilter; label: string }> = [
  { key: 'pending', label: 'Chưa xong' },
  { key: 'all', label: 'Tất cả' },
  { key: 'partial', label: 'Làm dở' },
  { key: 'done', label: 'Đã xong' },
  { key: 'queued', label: 'Trong hàng đợi' },
]

const ROW_HEIGHT = 58

/** Chữ viết tắt từ 2 từ đầu, bỏ dấu câu ở đầu tên (vd "Bạn Thân" -> BT thay vì ngoặc kép). */
function initials(name: string): string {
  const words = name.split(/\s+/).map(word => word.replace(/^[^\p{L}\p{N}]+/u, '')).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '').slice(0, 2)
  return letters.toUpperCase() || '?'
}

interface StoryBrowserProps {
  views: StoryView[]
  /** Ký tự mỗi truyện + tốc độ đọc → thời lượng ước tính. */
  lengths: Record<string, number>
  cps: number
  loading: boolean
  loadError: string
  queue: QueueItem[]
  onQueueChange: (queue: QueueItem[]) => void
  focusedSlug: string | null
  onFocus: (slug: string) => void
  /** Chương đã tải theo truyện (thiếu khóa = đang tải, null = lỗi). */
  chaptersBySlug: Record<string, AudioChapter[] | null | undefined>
  onRetryChapters: (slug: string) => void
  thumbnailBusy: boolean
  onUploadThumbnail: (slug: string, file: File) => void
  onNotice: (message: string) => void
  onSummarySaved: (slug: string) => void
}

/** Duyệt truyện (tìm không dấu, lọc, danh sách ảo hóa) + chọn chương — thay cho ô <select> 2.000+ lựa chọn. */
export function StoryBrowser({ views, lengths, cps, loading, loadError, queue, onQueueChange, focusedSlug, onFocus, chaptersBySlug, onRetryChapters, thumbnailBusy, onUploadThumbnail, onNotice, onSummarySaved }: StoryBrowserProps) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<StoryFilter>('pending')

  const filtered = useMemo(() => filterStoryViews(views, { query, filter, queue }), [views, query, filter, queue])
  const queuedCount = useMemo(() => new Map(queue.map(item => [item.story_slug, item.chapter_numbers.length])), [queue])
  const focused = useMemo(() => views.find(view => view.story.story_slug === focusedSlug) ?? null, [views, focusedSlug])

  return (
    <div className="aw-card aw-browser">
      <div className="aw-browser-head">
        <div className="aw-search">
          <Search size={15} />
          <input value={query} onChange={event => setQuery(event.target.value)} placeholder={`Tìm trong ${views.length.toLocaleString('vi-VN')} truyện… (gõ không dấu cũng được)`} aria-label="Tìm truyện" />
          {query && <button type="button" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm"><X size={14} /></button>}
        </div>
        <div className="aw-filters" role="tablist" aria-label="Lọc truyện">
          {FILTERS.map(item => (
            <button key={item.key} type="button" role="tab" aria-selected={filter === item.key} className={filter === item.key ? 'active' : ''} onClick={() => setFilter(item.key)}>
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="aw-browser-body">
        <div className="aw-story-pane">
          {loading ? (
            <div className="aw-empty"><Loader2 size={18} className="spin" /> Đang tải danh sách truyện…</div>
          ) : loadError ? (
            <div className="aw-empty aw-warn">{loadError}</div>
          ) : filtered.length === 0 ? (
            <div className="aw-empty">{views.length ? 'Không có truyện nào khớp.' : 'Chưa có truyện nào được crawl. Hãy crawl truyện ở mục "Crawl truyện".'}</div>
          ) : (
            <VirtualList
              className="aw-story-list"
              items={filtered}
              rowHeight={ROW_HEIGHT}
              getKey={view => view.story.story_slug}
              scrollToKey={focusedSlug}
              renderRow={view => {
                const { story } = view
                const inQueue = queuedCount.get(story.story_slug) || 0
                const percent = view.total ? Math.round((view.doneCount / view.total) * 100) : 0
                return (
                  <button type="button" role="option" aria-selected={story.story_slug === focusedSlug} className={`aw-story ${story.story_slug === focusedSlug ? 'active' : ''}`} onClick={() => onFocus(story.story_slug)}>
                    <span className="aw-story-thumb">
                      {(story.thumbnail_name || story.has_cover)
                        ? <img src={storyImageUrl(story)} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true }} />
                        : null}
                      <span className="aw-story-initials">{initials(story.name)}</span>
                    </span>
                    <span className="aw-story-info">
                      <strong title={story.name}>{story.name}</strong>
                      <span className="aw-story-meta">
                        <span>{view.doneCount}/{view.total} chương{lengths[story.story_slug] ? ` · ${formatDuration(estimateSeconds(lengths[story.story_slug], view.total, view.total, cps)).replace('≈ ', '')}` : ''}</span>
                        <span className="aw-bar"><i style={{ width: `${percent}%` }} /></span>
                      </span>
                    </span>
                    {story.has_summary && <FileText size={13} className="aw-has-summary" aria-label="Đã có tóm tắt" />}
                    {inQueue > 0 ? <span className="aw-pill" title={`${inQueue} chương trong hàng đợi`}>+{inQueue}</span> : view.status === 'done' ? <Check size={14} className="aw-ok" /> : null}
                  </button>
                )
              }}
            />
          )}
        </div>

        <ChapterPicker key={focused?.story.story_slug ?? 'none'} onSummarySaved={onSummarySaved} view={focused} chapters={focused ? chaptersBySlug[focused.story.story_slug] : undefined} onRetry={() => focused && onRetryChapters(focused.story.story_slug)} queue={queue} onQueueChange={onQueueChange} thumbnailBusy={thumbnailBusy} onUploadThumbnail={onUploadThumbnail} onNotice={onNotice} />
      </div>

      <div className="aw-browser-foot">
        {filtered.length.toLocaleString('vi-VN')} / {views.length.toLocaleString('vi-VN')} truyện
      </div>
    </div>
  )
}
