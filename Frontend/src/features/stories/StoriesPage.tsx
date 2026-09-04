import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  BarChart3,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock3,
  Download,
  Database,
  Eye,
  Library,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import {
  fetchSavedStory,
  fetchCrawledStories,
  fetchStoriesByCategory,
  fetchStoryCategories,
  fetchStoryCrawlJob,
  fetchStoryMetadata,
  fetchStoryStatistics,
  fetchBulkStoryCrawlJob,
  startBulkStoryCrawl,
  startStoryCrawl,
} from './services/storiesApi'
import type { CrawlJob, SavedStory, StoryCategory, StoryMetadata, StoryStatistics, StorySummary } from './types'

const SOURCE_URL = 'https://daotruyen.me'
type StorySortOption = 'views-desc' | 'views-asc' | 'updated-desc' | 'updated-asc' | 'imported-desc' | 'imported-asc'

export function StoriesPage() {
  const [categories, setCategories] = useState<StoryCategory[]>([])
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<number[]>([])
  const [stories, setStories] = useState<StorySummary[]>([])
  const [viewMode, setViewMode] = useState<'category' | 'crawled'>('category')
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const [categorySearch, setCategorySearch] = useState('')
  const [statistics, setStatistics] = useState<StoryStatistics | null>(null)
  const [selectedStory, setSelectedStory] = useState<StorySummary | null>(null)
  const [hoveredStory, setHoveredStory] = useState<string | null>(null)
  const [hoverPosition, setHoverPosition] = useState<{ top: number; left: number } | null>(null)
  const [metadata, setMetadata] = useState<StoryMetadata | null>(null)
  const [savedStory, setSavedStory] = useState<SavedStory | null>(null)
  const [viewingChapter, setViewingChapter] = useState<number | null>(null)
  const [storySort, setStorySort] = useState<StorySortOption>('views-desc')
  const [recrawlFullStories, setRecrawlFullStories] = useState(false)
  const [loadingCategories, setLoadingCategories] = useState(true)
  const [loadingStories, setLoadingStories] = useState(false)
  const [loadingMetadata, setLoadingMetadata] = useState(false)
  const [crawling, setCrawling] = useState<number | 'all' | null>(null)
  const [crawlJobId, setCrawlJobId] = useState<string | null>(null)
  const [crawlJob, setCrawlJob] = useState<CrawlJob | null>(null)
  const [bulkJobId, setBulkJobId] = useState<string | null>(null)
  const [bulkJob, setBulkJob] = useState<CrawlJob | null>(null)
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null)
  const categoryDropdownRef = useRef<HTMLDivElement>(null)
  const storyLoadRequestRef = useRef(0)
  const isBusy = crawling !== null || bulkJobId !== null

  useEffect(() => {
    fetchStoryCategories()
      .then(setCategories)
      .catch(error => setMessage({ type: 'error', text: error.message }))
      .finally(() => setLoadingCategories(false))
  }, [])

  useEffect(() => {
    fetchStoryStatistics()
      .then(setStatistics)
      .catch(error => setMessage({ type: 'error', text: error.message }))
  }, [])

  useEffect(() => {
    if (savedStory?.chapters.length && viewingChapter === null) {
      setViewingChapter(savedStory.chapters[0].chapterNumber)
    }
  }, [savedStory, viewingChapter])

  useEffect(() => {
    const closeCategoryMenu = (event: MouseEvent) => {
      if (categoryDropdownRef.current && !categoryDropdownRef.current.contains(event.target as Node)) {
        setCategoryMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', closeCategoryMenu)
    return () => document.removeEventListener('mousedown', closeCategoryMenu)
  }, [])

  useEffect(() => {
    if (!crawlJobId || !selectedStory) return
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      try {
        const job = await fetchStoryCrawlJob(selectedStory.url, crawlJobId)
        if (cancelled) return
        setCrawlJob(job)
        if (job.status === 'completed' || job.status === 'completed_with_errors' || job.status === 'error') {
          if (cancelled) return
          if (job.status === 'error') {
            setMessage({ type: 'error', text: job.error || 'Cào truyện thất bại.' })
          } else {
            const result = job.result
            setMessage({
              type: job.status === 'completed_with_errors' ? 'error' : 'success',
              text: result
                ? `Đã lưu ${result.crawled_count}/${result.requested_count} chương vào SQLite${result.failed_count ? `, lỗi ${result.failed_count} chương` : ''}.`
                : 'Đã hoàn tất cào truyện.',
            })
            const [freshMetadata, freshSaved] = await Promise.all([
              fetchStoryMetadata(selectedStory.url),
              fetchSavedStory(selectedStory.url),
            ])
            if (cancelled) return
            setMetadata(freshMetadata)
            setSavedStory(freshSaved)
            fetchStoryStatistics().then(setStatistics).catch(() => undefined)
            if (viewMode === 'crawled') {
              fetchCrawledStories(selectedCategoryIds).then(setStories).catch(() => undefined)
            }
          }
          setCrawlJobId(null)
          setCrawling(null)
          return
        }
        timer = window.setTimeout(poll, 700)
      } catch (error) {
        if (!cancelled) {
          setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Không thể đọc tiến trình cào' })
          timer = window.setTimeout(poll, 1500)
        }
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [crawlJobId, selectedStory])

  useEffect(() => {
    if (!bulkJobId) return
    let cancelled = false
    let timer: number | undefined

    const poll = async () => {
      try {
        const job = await fetchBulkStoryCrawlJob(bulkJobId)
        if (cancelled) return
        setBulkJob(job)
        if (job.status === 'completed' || job.status === 'completed_with_errors' || job.status === 'error') {
          if (job.status === 'error') {
            setMessage({ type: 'error', text: job.error || 'Cào hàng loạt thất bại.' })
          } else {
            const result = job.result
            setMessage({
              type: job.status === 'completed_with_errors' ? 'error' : 'success',
              text: result && 'requested_stories' in result
                ? `Đã xử lý ${result.completed_stories}/${result.requested_stories} truyện${result.skipped_stories ? `, bỏ qua ${result.skipped_stories} truyện đã đủ chương` : ''}${result.failed_stories ? `, lỗi ${result.failed_stories} truyện` : ''}.`
                : 'Đã hoàn tất cào hàng loạt.',
            })
            fetchStoryStatistics().then(setStatistics).catch(() => undefined)
            if (viewMode === 'crawled') {
              fetchCrawledStories(selectedCategoryIds).then(setStories).catch(() => undefined)
            }
            if (selectedStory) {
              Promise.all([fetchStoryMetadata(selectedStory.url), fetchSavedStory(selectedStory.url)])
                .then(([freshMetadata, freshSaved]) => {
                  if (!cancelled) {
                    setMetadata(freshMetadata)
                    setSavedStory(freshSaved)
                  }
                })
                .catch(() => undefined)
            }
          }
          setBulkJobId(null)
          return
        }
        timer = window.setTimeout(poll, 700)
      } catch (error) {
        if (!cancelled) {
          setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Không thể đọc tiến trình cào hàng loạt' })
          timer = window.setTimeout(poll, 1500)
        }
      }
    }

    void poll()
    return () => {
      cancelled = true
      if (timer !== undefined) window.clearTimeout(timer)
    }
  }, [bulkJobId, selectedCategoryIds, selectedStory, viewMode])

  const resetSelectedStory = () => {
    setStories([])
    setSelectedStory(null)
    setMetadata(null)
    setSavedStory(null)
    setViewingChapter(null)
  }

  const loadCategoryStories = async (categoryIds: number[]) => {
    const requestId = ++storyLoadRequestRef.current
    resetSelectedStory()
    setMessage(null)
    if (!categoryIds.length) {
      setLoadingStories(false)
      return
    }
    setLoadingStories(true)
    try {
      const pages = await Promise.all(categoryIds.map(categoryId => fetchStoriesByCategory(categoryId)))
      if (requestId !== storyLoadRequestRef.current) return
      const unique = new Map<string, StorySummary>()
      pages.flat().forEach(story => unique.set(story.url, story))
      setStories([...unique.values()])
    } catch (error) {
      if (requestId !== storyLoadRequestRef.current) return
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Không thể tải truyện' })
    } finally {
      if (requestId === storyLoadRequestRef.current) setLoadingStories(false)
    }
  }

  const handleCategoryChange = async (categoryIds: number[]) => {
    setSelectedCategoryIds(categoryIds)
    if (viewMode === 'crawled') {
      await loadCrawledStories(categoryIds)
      return
    }
    await loadCategoryStories(categoryIds)
  }

  const loadCrawledStories = async (categoryIds = selectedCategoryIds) => {
    const requestId = ++storyLoadRequestRef.current
    setViewMode('crawled')
    resetSelectedStory()
    setMessage(null)
    setLoadingStories(true)
    try {
      const loadedStories = await fetchCrawledStories(categoryIds)
      if (requestId === storyLoadRequestRef.current) setStories(loadedStories)
    } catch (error) {
      if (requestId === storyLoadRequestRef.current) {
        setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Không thể tải truyện đã cào' })
      }
    } finally {
      if (requestId === storyLoadRequestRef.current) setLoadingStories(false)
    }
  }

  const selectStory = async (story: StorySummary) => {
    setSelectedStory(story)
    setMetadata(null)
    setSavedStory(null)
    setViewingChapter(null)
    setCrawlJob(null)
    setMessage(null)
    setLoadingMetadata(true)
    try {
      const [storyMetadata, storedStory] = await Promise.all([
        fetchStoryMetadata(story.url),
        fetchSavedStory(story.url),
      ])
      setMetadata(storyMetadata)
      setSavedStory(storedStory)
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Không thể tải chương truyện' })
    } finally {
      setLoadingMetadata(false)
    }
  }

  const crawl = async (chapterNumber?: number) => {
    if (!selectedStory || isBusy) return
    setCrawling(chapterNumber ?? 'all')
    setCrawlJob(null)
    setMessage(null)
    try {
      const job = await startStoryCrawl(selectedStory.url, chapterNumber)
      setCrawlJobId(job.job_id)
    } catch (error) {
      setCrawling(null)
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Cào truyện thất bại' })
    }
  }

  const crawlSelectedCategories = async () => {
    if (!selectedCategoryIds.length || isBusy) return
    setBulkJob(null)
    setMessage(null)
    try {
      const job = await startBulkStoryCrawl(selectedCategoryIds, recrawlFullStories)
      setBulkJobId(job.job_id)
    } catch (error) {
      setMessage({ type: 'error', text: error instanceof Error ? error.message : 'Không thể bắt đầu cào theo thể loại' })
    }
  }

  const visibleStories = useMemo(() => {
    const getTime = (value?: string | null) => {
      if (!value) return 0
      const timestamp = Date.parse(value)
      return Number.isNaN(timestamp) ? 0 : timestamp
    }
    const getValue = (story: StorySummary) => {
      if (storySort.startsWith('views')) return story.totalView ?? 0
      if (storySort.startsWith('updated')) return getTime(story.lastChapterUpdatedAt || story.updatedAt)
      return getTime(story.importedAt)
    }
    const descending = storySort.endsWith('desc')
    return [...stories].sort((a, b) => {
      const difference = getValue(b) - getValue(a)
      if (difference !== 0) return descending ? difference : -difference
      return a.name.localeCompare(b.name, 'vi')
    })
  }, [stories, storySort])

  const formatNumber = (value?: number | null) => value === undefined || value === null ? '—' : value.toLocaleString('vi-VN')
  const formatDate = (value?: string | null) => {
    if (!value) return 'Chưa có dữ liệu'
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString('vi-VN', { dateStyle: 'medium', timeStyle: 'short' })
  }

  const storyLastUpdated = (story: StorySummary) => story.lastChapterUpdatedAt || story.updatedAt

  const orderedCategories = useMemo(() => {
    const selectedOrder = new Map(selectedCategoryIds.map((id, index) => [id, index]))
    const query = categorySearch.trim().toLocaleLowerCase()
    return categories
      .filter(category => !query || category.categoryName.toLocaleLowerCase().includes(query))
      .map((category, index) => ({ category, index }))
      .sort((a, b) => {
        const aSelected = selectedOrder.has(a.category.id)
        const bSelected = selectedOrder.has(b.category.id)
        if (aSelected !== bSelected) return aSelected ? -1 : 1
        if (aSelected && bSelected) return selectedOrder.get(a.category.id)! - selectedOrder.get(b.category.id)!
        return a.index - b.index
      })
      .map(({ category }) => category)
  }, [categories, categorySearch, selectedCategoryIds])

  const selectedCategories = useMemo(
    () => selectedCategoryIds.map(id => categories.find(category => category.id === id)).filter((category): category is StoryCategory => Boolean(category)),
    [categories, selectedCategoryIds],
  )

  const toggleCategory = (categoryId: number) => {
    const nextIds = selectedCategoryIds.includes(categoryId)
      ? selectedCategoryIds.filter(id => id !== categoryId)
      : [...selectedCategoryIds, categoryId]
    void handleCategoryChange(nextIds)
  }

  const showStoryHoverDetail = (story: StorySummary, target: HTMLElement) => {
    const rect = target.getBoundingClientRect()
    const cardHeight = 245
    setHoveredStory(story.url)
    setHoverPosition({
      top: Math.max(10, Math.min(rect.top, window.innerHeight - cardHeight - 10)),
      left: rect.right + 10,
    })
  }

  const imageUrl = (path?: string) => (path?.startsWith('http') ? path : path ? `${SOURCE_URL}${path}` : '')
  const savedChapter = savedStory?.chapters.find(chapter => chapter.chapterNumber === viewingChapter)
  const activeJobChapter = (chapterNumber: number) => crawlJob?.chapters.find(chapter => chapter.chapter_number === chapterNumber)
  const progressPercent = crawlJob?.total ? Math.round((crawlJob.done / crawlJob.total) * 100) : 0
  const bulkProgressPercent = bulkJob?.total_stories ? Math.round((bulkJob.completed_stories / bulkJob.total_stories) * 100) : 0
  const showStoryBrowser = viewMode === 'crawled' || selectedCategoryIds.length > 0

  return (
    <section className="stories-page">
      <div className="settings-heading">
        <p className="overline">STORY CRAWLER</p>
        <h1>Cào truyện</h1>
        <p className="page-subtitle">Chọn thể loại, chọn truyện rồi cào từng chương hoặc toàn bộ truyện.</p>
      </div>

      <div className="story-stats-grid">
        <div className="story-stat-card"><span className="story-stat-icon blue"><Library size={17} /></span><div><small>Tổng truyện hệ thống</small><strong>{statistics ? statistics.total_stories.toLocaleString('vi-VN') : '—'}</strong></div></div>
        <div className="story-stat-card"><span className="story-stat-icon green"><Database size={17} /></span><div><small>Truyện đã cào</small><strong>{statistics ? statistics.crawled_stories.toLocaleString('vi-VN') : '—'}</strong></div></div>
        <div className="story-stat-card"><span className="story-stat-icon purple"><BookOpen size={17} /></span><div><small>Chương đã lưu</small><strong>{statistics ? statistics.crawled_chapters.toLocaleString('vi-VN') : '—'}</strong></div></div>
        <div className="story-stat-card"><span className="story-stat-icon amber"><BarChart3 size={17} /></span><div><small>Chưa cào</small><strong>{statistics ? statistics.uncrawled_stories.toLocaleString('vi-VN') : '—'}</strong></div></div>
      </div>

      <div className="stories-toolbar settings-card">
        <div className="story-category-field" ref={categoryDropdownRef}>
          <label htmlFor="story-category-trigger">Thể loại truyện</label>
          <button
            id="story-category-trigger"
            type="button"
            className={`story-category-trigger ${categoryMenuOpen ? 'open' : ''}`}
            onClick={() => setCategoryMenuOpen(open => !open)}
            disabled={loadingCategories || isBusy}
            aria-expanded={categoryMenuOpen}
            aria-haspopup="listbox"
          >
            <span className="story-category-trigger-copy">
              <strong>{selectedCategories.length ? `${selectedCategories.length} thể loại đã chọn` : 'Chọn thể loại truyện'}</strong>
              <small>{selectedCategories.length ? selectedCategories.map(category => category.categoryName).join(', ') : 'Chọn một hoặc nhiều thể loại'}</small>
            </span>
            <ChevronDown size={16} />
          </button>
          {categoryMenuOpen && (
            <div className="story-category-menu" role="listbox" aria-multiselectable="true" aria-label="Danh sách thể loại">
              <div className="story-category-menu-search"><Search size={14} /><input value={categorySearch} onChange={event => setCategorySearch(event.target.value)} placeholder="Tìm thể loại…" autoFocus /></div>
              <div className="story-category-menu-meta"><span>{selectedCategoryIds.length ? `${selectedCategoryIds.length} đang chọn` : 'Chưa chọn thể loại'}</span>{selectedCategoryIds.length > 0 && <button type="button" onClick={() => void handleCategoryChange([])}><X size={12} /> Bỏ chọn</button>}</div>
              <div className="story-category-options">
                {loadingCategories ? <div className="story-category-empty">Đang tải thể loại…</div> : orderedCategories.length === 0 ? <div className="story-category-empty">Không tìm thấy thể loại.</div> : orderedCategories.map(category => {
                  const selected = selectedCategoryIds.includes(category.id)
                  return (
                    <button key={`${category.id}-${category.url}`} type="button" className={`story-category-option ${selected ? 'selected' : ''}`} onClick={() => toggleCategory(category.id)} role="option" aria-selected={selected}>
                      <span className="story-category-check">{selected && <CheckCircle2 size={15} />}</span>
                      <span>{category.categoryName}</span>
                    </button>
                  )
                })}
              </div>
              <small className="story-category-hint">Các thể loại đã chọn luôn được đưa lên đầu danh sách.</small>
            </div>
          )}
        </div>
        <div className="story-view-switch" role="tablist" aria-label="Nguồn danh sách truyện">
          <button type="button" className={viewMode === 'category' ? 'active' : ''} onClick={() => { setStorySort(current => current.startsWith('imported') ? 'views-desc' : current); setViewMode('category'); void loadCategoryStories(selectedCategoryIds) }} disabled={isBusy}><Library size={14} /> Theo thể loại</button>
          <button type="button" className={viewMode === 'crawled' ? 'active' : ''} onClick={() => void loadCrawledStories()} disabled={isBusy}><Database size={14} /> Đã cào <span>{statistics?.crawled_stories ?? 0}</span></button>
        </div>
        <label className="story-recrawl-toggle">
          <input type="checkbox" checked={recrawlFullStories} onChange={event => setRecrawlFullStories(event.target.checked)} disabled={!selectedCategoryIds.length || isBusy} />
          <span>Cào lại truyện đã đủ chương</span>
        </label>
        <button type="button" className="btn-p story-bulk-button" onClick={() => void crawlSelectedCategories()} disabled={!selectedCategoryIds.length || isBusy}>
          {bulkJobId ? <RefreshCw className="spin" size={15} /> : <Download size={15} />}
          {bulkJobId ? 'Đang cào hàng loạt…' : `Cào tất cả (${selectedCategoryIds.length} thể loại)`}
        </button>
        <div className="story-toolbar-note"><Clock3 size={16} /><span>Mỗi request cách nhau 1 giây để hạn chế rate-limit.</span></div>
      </div>

      {message && (
        <div className={`story-message ${message.type}`}>
          {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}{message.text}
        </div>
      )}

      {bulkJob && (bulkJob.status === 'queued' || bulkJob.status === 'running') && (
        <div className="story-bulk-progress settings-card">
          <div className="story-progress-top"><strong>{bulkJob.recrawl_full ? 'Cào lại toàn bộ truyện theo thể loại' : 'Cào toàn bộ truyện theo thể loại'}</strong><span>{bulkJob.completed_stories}/{bulkJob.total_stories || '…'} truyện · {bulkProgressPercent}%</span></div>
          <div className="story-progress-track"><div style={{ width: `${bulkProgressPercent}%` }} /></div>
          <small>{bulkJob.current_story ? `Đang xử lý: ${bulkJob.current_story}` : 'Đang lấy danh sách và kiểm tra truyện…'}</small>
          {bulkJob.stories.length > 0 && <div className="story-bulk-items">{bulkJob.stories.map(story => <div key={story.story_slug}><span>{story.name}</span><small>{story.status === 'skipped' ? 'Đã đủ chương · bỏ qua' : `${story.done}/${story.total || '…'} chương · ${story.status === 'running' ? 'đang cào' : story.status === 'error' ? 'lỗi' : story.status === 'completed' ? 'xong' : 'chờ'}`}</small></div>)}</div>}
        </div>
      )}

      {showStoryBrowser && (
        <div className="stories-layout">
          <div className="story-list-panel settings-card">
            <div className="story-panel-heading">
              <div><h2>{viewMode === 'crawled' ? 'Truyện đã cào' : 'Danh sách truyện'}</h2><span>{loadingStories ? 'Đang tải…' : `${stories.length} truyện`}</span></div>
              <label className="story-sort-control"><span>Sắp xếp</span><select value={storySort} onChange={event => setStorySort(event.target.value as StorySortOption)}><option value="views-desc">Lượt xem: cao → thấp</option><option value="views-asc">Lượt xem: thấp → cao</option><option value="updated-desc">Cập nhật: mới → cũ</option><option value="updated-asc">Cập nhật: cũ → mới</option>{viewMode === 'crawled' && <><option value="imported-desc">Import CSDL: mới → cũ</option><option value="imported-asc">Import CSDL: cũ → mới</option></>}</select></label>
            </div>
            <div className="story-list">
              {loadingStories ? (
                <div className="story-empty"><RefreshCw className="spin" size={20} /> Đang tải truyện…</div>
              ) : visibleStories.length === 0 ? (
                <div className="story-empty"><BookOpen size={22} /> Không tìm thấy truyện.</div>
              ) : visibleStories.map(story => (
                <div
                  className="story-item-wrap"
                  key={story.url}
                  onMouseEnter={event => showStoryHoverDetail(story, event.currentTarget)}
                  onFocus={event => showStoryHoverDetail(story, event.currentTarget)}
                  onMouseLeave={() => setHoveredStory(null)}
                  onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setHoveredStory(null) }}
                >
                  <button type="button" className={`story-item ${selectedStory?.url === story.url ? 'selected' : ''}`} onClick={() => selectStory(story)} disabled={crawling !== null}>
                    {story.image ? <img src={imageUrl(story.image)} alt="" /> : <div className="story-cover"><BookOpen size={17} /></div>}
                    <span className="story-item-copy"><strong>{story.name}</strong><small>{viewMode === 'crawled' ? `${story.crawledChapterCount || 0}/${story.totalChapter || '?'} chương đã lưu` : `${story.teamName || story.authorName || 'Đang cập nhật'} · ${story.totalChapter || '?'} chương`}</small></span>
                    <span className="story-item-action">{selectedStory?.url === story.url ? <CheckCircle2 size={16} /> : <ChevronRight size={16} />}</span>
                  </button>
                  <div className="story-hover-detail" role="tooltip" style={hoveredStory === story.url && hoverPosition ? hoverPosition : undefined}>
                    <div className="story-hover-heading">
                      {story.image ? <img src={imageUrl(story.image)} alt="" /> : <div className="story-cover"><BookOpen size={17} /></div>}
                      <div><strong>{story.name}</strong><small>{story.authorName || 'Tác giả đang cập nhật'}</small></div>
                    </div>
                    <div className="story-hover-stats"><span><strong>{formatNumber(story.totalView)}</strong><small>Total view</small></span><span><strong>{formatNumber(story.following)}</strong><small>Following</small></span><span><strong>{formatNumber(story.totalChapter)}</strong><small>Chương</small></span></div>
                    <dl className="story-hover-meta"><div><dt>Nhóm dịch</dt><dd>{story.teamName || 'Đang cập nhật'}</dd></div><div><dt>Cập nhật gần nhất</dt><dd>{formatDate(storyLastUpdated(story))}</dd></div>{viewMode === 'crawled' && <div><dt>Import vào CSDL</dt><dd>{formatDate(story.importedAt)}</dd></div>}</dl>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="story-detail-panel settings-card">
            {!selectedStory ? (
              <div className="story-empty detail-empty"><BookOpen size={30} /><span>Chọn một truyện để xem các chương.</span></div>
            ) : loadingMetadata ? (
              <div className="story-empty detail-empty"><RefreshCw className="spin" size={24} /> Đang tải thông tin truyện…</div>
            ) : metadata ? (
              <>
                <div className="story-detail-header">
                  <div><p className="overline">TRUYỆN ĐÃ CHỌN</p><h2>{metadata.story.name}</h2><p>{metadata.story.authorName || 'Tác giả đang cập nhật'} · {metadata.chapters.length} chương</p></div>
                  <button type="button" className="btn-p" onClick={() => crawl()} disabled={crawling !== null || metadata.chapters.length === 0}>
                    {crawling === 'all' ? <RefreshCw className="spin" size={15} /> : <Download size={15} />}{crawling === 'all' ? 'Đang cào…' : 'Cào toàn bộ'}
                  </button>
                </div>

                {crawlJob && (crawlJob.status === 'queued' || crawlJob.status === 'running') && (
                  <div className="story-progress">
                    <div className="story-progress-top"><strong>Tiến trình cào</strong><span>{crawlJob.done}/{crawlJob.total || '…'} chương · {progressPercent}%</span></div>
                    <div className="story-progress-track"><div style={{ width: `${progressPercent}%` }} /></div>
                    <small>{crawlJob.current_chapter ? `Đang cào chương ${crawlJob.current_chapter}…` : 'Đang chuẩn bị danh sách chương…'}</small>
                  </div>
                )}

                <div className="chapter-list">
                  {metadata.chapters.map(chapter => {
                    const jobChapter = activeJobChapter(chapter.chapterNumber)
                    const isSaved = chapter.crawled || jobChapter?.status === 'crawled'
                    const state = jobChapter?.status || (isSaved ? 'crawled' : 'pending')
                    return (
                      <div className="chapter-item" key={chapter.chapterNumber}>
                        <div className="chapter-number">{chapter.chapterNumber}</div>
                        <div className="chapter-copy"><strong>{chapter.title}</strong><small>{state === 'running' ? 'Đang cào…' : state === 'error' ? jobChapter?.error || 'Cào lỗi' : isSaved ? 'Đã lưu trong SQLite' : 'Chưa cào'}</small></div>
                        <span className={`chapter-status ${state}`}>
                          {state === 'running' ? <RefreshCw className="spin" size={15} /> : state === 'error' ? <AlertCircle size={15} /> : isSaved ? <CheckCircle2 size={15} /> : <Clock3 size={15} />}
                        </span>
                        <button type="button" className="chapter-view-button" onClick={() => setViewingChapter(chapter.chapterNumber)} disabled={!isSaved} title={isSaved ? 'Xem nội dung đã lưu' : 'Chương chưa được cào'}><Eye size={14} /> Xem</button>
                        <button type="button" className="chapter-crawl-button" onClick={() => crawl(chapter.chapterNumber)} disabled={crawling !== null}>
                          {crawling === chapter.chapterNumber ? <RefreshCw className="spin" size={14} /> : <Download size={14} />} Cào chương
                        </button>
                      </div>
                    )
                  })}
                </div>

                {savedStory && savedStory.chapters.length > 0 && (
                  <section className="saved-story-section">
                    <div className="saved-story-heading"><div><h3>Nội dung đã cào (SQLite)</h3><span>{savedStory.chapters.length} chương đã lưu</span></div><select value={viewingChapter ?? ''} onChange={event => setViewingChapter(Number(event.target.value))}>{savedStory.chapters.map(chapter => <option key={chapter.chapterNumber} value={chapter.chapterNumber}>{chapter.title}</option>)}</select></div>
                    {savedChapter ? <article className="saved-story-content"><h4>{savedChapter.title}</h4><pre>{savedChapter.paragraph}</pre></article> : <div className="story-empty">Chọn chương để xem nội dung.</div>}
                  </section>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  )
}
