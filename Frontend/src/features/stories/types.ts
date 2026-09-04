export interface StoryCategory {
  id: number
  categoryName: string
  url: string
}

export interface StorySummary {
  id: number
  name: string
  url: string
  image?: string
  authorName?: string
  totalChapter?: number
  totalView?: number
  following?: number
  lastChapterUpdatedAt?: string | null
  updatedAt?: string | null
  importedAt?: string | null
  teamName?: string
  crawledChapterCount?: number
  progressPercent?: number
  lastCrawledAt?: string | null
  categories?: StoryCategory[]
}

export interface StoryChapter {
  id: number
  title: string
  chapterNumber: number
  updatedAt?: string
  crawled?: boolean
}

export interface StoryMetadata {
  story: StorySummary & {
    description?: string
    state?: number
    updatedAt?: string
    storySlug: string
  }
  chapters: StoryChapter[]
  categories?: StoryCategory[]
}

export interface CrawlResult {
  mode: 'chapter' | 'all'
  requested_count: number
  crawled_count: number
  failed_count: number
  chapters: Array<{
    chapter_number: number
    title?: string
    status: 'crawled' | 'error'
    error?: string
  }>
}

export interface BulkCrawlResult {
  mode: 'bulk'
  category_ids: number[]
  requested_stories: number
  completed_stories: number
  skipped_stories: number
  failed_stories: number
}

export type CrawlJobResult = CrawlResult | BulkCrawlResult

export type CrawlChapterStatus = 'pending' | 'running' | 'crawled' | 'error'

export interface CrawlJobChapter {
  chapter_number: number
  title?: string
  status: CrawlChapterStatus
  error?: string
}

export interface CrawlJobStory {
  story_slug: string
  name: string
  status: 'pending' | 'running' | 'completed' | 'skipped' | 'completed_with_errors' | 'error'
  total: number
  done: number
  chapters: CrawlJobChapter[]
  error?: string
}

export interface CrawlJob {
  job_id: string
  story_slug: string
  chapter_number: number | null
  kind: 'single' | 'bulk'
  category_ids: number[]
  recrawl_full: boolean
  status: 'queued' | 'running' | 'completed' | 'completed_with_errors' | 'error'
  total: number
  done: number
  current_chapter: number | null
  chapters: CrawlJobChapter[]
  total_stories: number
  completed_stories: number
  current_story: string | null
  stories: CrawlJobStory[]
  result?: CrawlJobResult | null
  error?: string | null
}

export interface SavedChapter {
  id: number | null
  title: string
  chapterNumber: number
  paragraph: string
  updatedAt?: string | null
  crawledAt: string
}

export interface SavedStory {
  story: StoryMetadata['story']
  categories?: StoryCategory[]
  chapters: SavedChapter[]
}

export interface StoryStatistics {
  total_stories: number
  metadata_stories: number
  crawled_stories: number
  uncrawled_stories: number
  crawled_chapters: number
}
