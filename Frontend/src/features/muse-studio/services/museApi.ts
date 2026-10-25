import { API_URL } from '../../../shared/constants'
import type {
  MuseStatus,
  MuseGenerateRequest,
  MuseGenerateResult,
  MuseHistoryItem,
  MuseHistoryResponse,
  MuseUploadResponse,
} from '../types'

export async function uploadMuseMedia(file: File): Promise<MuseUploadResponse> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_URL}/api/ai/muse/upload`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || 'Lỗi khi tải file lên máy chủ')
  }
  return res.json()
}

export async function getMuseStatus(): Promise<MuseStatus> {
  const res = await fetch(`${API_URL}/api/settings/muse/status`)
  if (!res.ok) throw new Error('Không thể kiểm tra trạng thái Muse')
  return res.json()
}

export async function openMuseBrowser(): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/api/settings/muse/open-browser`, { method: 'POST' })
  if (!res.ok) throw new Error('Không thể mở cửa sổ trình duyệt')
  return res.json()
}

export async function openMuseFolder(): Promise<{ ok: boolean; path: string }> {
  const res = await fetch(`${API_URL}/api/ai/muse/open-folder`, { method: 'POST' })
  if (!res.ok) throw new Error('Không thể mở thư mục video')
  return res.json()
}

export async function getMuseHistory(limit: number = 50): Promise<MuseHistoryItem[]> {
  const res = await fetch(`${API_URL}/api/ai/muse/history?limit=${limit}`)
  if (!res.ok) throw new Error('Không thể tải lịch sử video')
  const data: MuseHistoryResponse = await res.json()
  return data.items || []
}

export async function generateMuseVideo(req: MuseGenerateRequest): Promise<MuseGenerateResult> {
  const res = await fetch(`${API_URL}/api/ai/muse/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(req),
  })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || 'Lỗi khi sinh video từ Muse AI')
  }
  return res.json()
}

export function getVideoMediaUrl(pathOrFile: string): string {
  if (pathOrFile.startsWith('/api/')) {
    return `${API_URL}${pathOrFile}`
  }
  return `${API_URL}/api/ai/muse/stream?file=${encodeURIComponent(pathOrFile)}`
}
