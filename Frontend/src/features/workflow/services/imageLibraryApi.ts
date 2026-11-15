/** Thư Viện Ảnh của Canvas AI — /api/workflow/images (app/workflow/image_library.py). */
import { API_URL } from '../../../shared/constants'

export type LibraryImageSource = 'muse' | 'upload'

export interface LibraryImage {
  id: string
  file_name: string
  path: string
  source: LibraryImageSource
  label: string
  favorite: boolean
  tags: string[]
  created_at: number
  size: number
  width: number
  height: number
  meta: {
    prompt?: string
    chat_title?: string
    session_id?: string
    account_label?: string
    input_paths?: string[]
  }
  /** URL tương đối của backend: /api/workflow/images/{id}/file */
  preview_url: string
}

async function json<T>(res: Response, fallback: string): Promise<T> {
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(typeof err.detail === 'string' ? err.detail : `${fallback} (HTTP ${res.status})`)
  }
  return res.json()
}

/** Bắn khi thư viện có ảnh mới (vd. node Tách áo quần vừa xong) để toolbar cập nhật số ảnh. */
export const IMAGE_LIBRARY_CHANGED = 'creatorflow:image-library-changed'
export function notifyImageLibraryChanged(): void {
  try {
    window.dispatchEvent(new Event(IMAGE_LIBRARY_CHANGED))
  } catch {
    /* không có window (test) */
  }
}

export function libraryImageUrl(item: Pick<LibraryImage, 'preview_url'>): string {
  return item.preview_url.startsWith('http') ? item.preview_url : `${API_URL}${item.preview_url}`
}

export async function listLibraryImages(params: { q?: string; source?: string; favorite?: boolean } = {}): Promise<LibraryImage[]> {
  const qs = new URLSearchParams()
  if (params.q) qs.set('q', params.q)
  if (params.source) qs.set('source', params.source)
  if (params.favorite) qs.set('favorite', 'true')
  const res = await fetch(`${API_URL}/api/workflow/images${qs.toString() ? `?${qs}` : ''}`)
  return (await json<{ items: LibraryImage[] }>(res, 'Không tải được Thư Viện Ảnh — backend đã khởi động lại chưa?')).items
}

export async function uploadLibraryImage(file: File, label = ''): Promise<LibraryImage> {
  const form = new FormData()
  form.append('file', file)
  form.append('label', label)
  return json(await fetch(`${API_URL}/api/workflow/images/upload`, { method: 'POST', body: form }), 'Tải ảnh lên thất bại')
}

export async function updateLibraryImage(id: string, patch: { label?: string; favorite?: boolean; tags?: string[] }): Promise<LibraryImage> {
  return json(
    await fetch(`${API_URL}/api/workflow/images/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    'Không cập nhật được ảnh',
  )
}

export async function deleteLibraryImage(id: string): Promise<void> {
  await json(await fetch(`${API_URL}/api/workflow/images/${encodeURIComponent(id)}`, { method: 'DELETE' }), 'Không xóa được ảnh')
}

export async function openLibraryFolder(): Promise<void> {
  await json(await fetch(`${API_URL}/api/workflow/images/open-folder`, { method: 'POST' }), 'Không mở được thư mục')
}

export function formatBytes(n: number): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
