import { API_URL } from '../../../shared/constants'
import type {
  MuseAccountOption,
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

function accountQuery(accountId?: string): string {
  return accountId ? `?account_id=${encodeURIComponent(accountId)}` : ''
}

export async function getMuseStatus(accountId?: string): Promise<MuseStatus> {
  const res = await fetch(`${API_URL}/api/settings/muse/status${accountQuery(accountId)}`)
  if (!res.ok) throw new Error('Không thể kiểm tra trạng thái Muse')
  return res.json()
}

export async function openMuseBrowser(accountId?: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/api/settings/muse/open-browser${accountQuery(accountId)}`, { method: 'POST' })
  if (!res.ok) {
    const errorData = await res.json().catch(() => ({}))
    throw new Error(errorData.detail || 'Không thể mở cửa sổ trình duyệt')
  }
  return res.json()
}

export async function listMuseAccounts(): Promise<MuseAccountOption[]> {
  const res = await fetch(`${API_URL}/api/settings/muse/accounts`)
  if (!res.ok) return []
  const data = await res.json()
  return (data.accounts || []).map((a: any) => ({
    id: String(a.id),
    label: String(a.label || a.id),
    status: String(a.status || ''),
    busy: Boolean(a.busy),
  }))
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
