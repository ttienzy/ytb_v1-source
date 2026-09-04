import { API_URL } from '../../../shared/constants'
import type {
  CrawlResult,
  CrawlJob,
  StoryCategory,
  StoryMetadata,
  SavedStory,
  StoryStatistics,
  StorySummary,
} from '../types'

async function readError(response: Response, fallback: string) {
  const body = await response.json().catch(() => ({}))
  return body.detail || fallback
}

export async function fetchStoryCategories(): Promise<StoryCategory[]> {
  const response = await fetch(`${API_URL}/api/stories/categories`)
  if (!response.ok) throw new Error(await readError(response, 'Không thể tải thể loại truyện'))
  return response.json()
}

export async function fetchStoryStatistics(): Promise<StoryStatistics> {
  const response = await fetch(`${API_URL}/api/stories/stats`)
  if (!response.ok) throw new Error(await readError(response, 'Không thể tải thống kê truyện'))
  return response.json()
}

export async function fetchCrawledStories(categoryIds: number[] = []): Promise<StorySummary[]> {
  const query = categoryIds.map(id => `category_ids=${encodeURIComponent(id)}`).join('&')
  const response = await fetch(`${API_URL}/api/stories/crawled${query ? `?${query}` : ''}`)
  if (!response.ok) throw new Error(await readError(response, 'Không thể tải truyện đã cào'))
  return response.json()
}

export async function fetchStoriesByCategory(categoryId: number): Promise<StorySummary[]> {
  const response = await fetch(`${API_URL}/api/stories/categories/${categoryId}/stories`)
  if (!response.ok) throw new Error(await readError(response, 'Không thể tải danh sách truyện'))
  const body = await response.json()
  return body.stories || []
}

export async function fetchStoryMetadata(storySlug: string): Promise<StoryMetadata> {
  const response = await fetch(`${API_URL}/api/stories/${encodeURIComponent(storySlug)}/metadata`)
  if (!response.ok) throw new Error(await readError(response, 'Không thể tải thông tin truyện'))
  return response.json()
}

export async function startStoryCrawl(storySlug: string, chapterNumber?: number): Promise<{ job_id: string; status: string }> {
  const response = await fetch(`${API_URL}/api/stories/${encodeURIComponent(storySlug)}/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(chapterNumber === undefined ? {} : { chapter_number: chapterNumber }),
  })
  if (!response.ok) throw new Error(await readError(response, 'Cào truyện thất bại'))
  return response.json()
}

export async function startBulkStoryCrawl(categoryIds: number[], recrawlFull = false): Promise<{ job_id: string; status: string; kind: 'bulk'; recrawl_full: boolean }> {
  const response = await fetch(`${API_URL}/api/stories/categories/crawl`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ category_ids: categoryIds, recrawl_full: recrawlFull }),
  })
  if (!response.ok) throw new Error(await readError(response, 'Không thể bắt đầu cào theo thể loại'))
  return response.json()
}

export async function fetchBulkStoryCrawlJob(jobId: string): Promise<CrawlJob> {
  const response = await fetch(`${API_URL}/api/stories/crawl-jobs/${encodeURIComponent(jobId)}`)
  if (!response.ok) throw new Error(await readError(response, 'Không thể đọc tiến trình cào hàng loạt'))
  return response.json()
}

export async function fetchStoryCrawlJob(storySlug: string, jobId: string): Promise<CrawlJob> {
  const response = await fetch(`${API_URL}/api/stories/${encodeURIComponent(storySlug)}/crawl-jobs/${encodeURIComponent(jobId)}`)
  if (!response.ok) throw new Error(await readError(response, 'Không thể đọc tiến trình cào'))
  return response.json()
}

export async function fetchSavedStory(storySlug: string): Promise<SavedStory | null> {
  const response = await fetch(`${API_URL}/api/stories/${encodeURIComponent(storySlug)}/saved`)
  if (response.status === 404) return null
  if (!response.ok) throw new Error(await readError(response, 'Không thể đọc dữ liệu SQLite'))
  return response.json()
}
