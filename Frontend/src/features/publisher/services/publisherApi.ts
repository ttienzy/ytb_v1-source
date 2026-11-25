import { API_URL } from '../../../shared/constants'
import type {
  ActiveFacebookPage,
  BulkScheduleResponse,
  CaptionGenerateResponse,
  DriveFolder,
  DriveVideoList,
  PippitAccount,
  PippitScheduleTask,
  PublishableVideo,
  ScheduleSlot,
  SourceListResponse,
  SourceType,
  TikTokOptions,
} from '../types'

export async function fetchDriveStatus() {
  const r = await fetch(`${API_URL}/api/gdrive/status`)
  if (!r.ok) throw new Error('Không thể lấy trạng thái Google Drive')
  return r.json()
}

export async function fetchDriveFolders(
  parentId: string = 'root',
  query?: string
): Promise<DriveFolder[]> {
  const params = new URLSearchParams()
  if (parentId) params.append('parent_id', parentId)
  if (query) params.append('q', query)
  const r = await fetch(`${API_URL}/api/gdrive/folders?${params.toString()}`)
  if (!r.ok) throw new Error('Không thể lấy danh sách thư mục Google Drive')
  return r.json()
}

export async function fetchDriveVideos(
  folderId?: string,
  query?: string
): Promise<DriveVideoList> {
  const params = new URLSearchParams()
  if (folderId) params.append('folder_id', folderId)
  if (query) params.append('q', query)
  const r = await fetch(`${API_URL}/api/gdrive/videos?${params.toString()}`)
  if (!r.ok) throw new Error('Không thể lấy danh sách video từ Google Drive')
  return r.json()
}

export async function fetchPippitAccounts(): Promise<PippitAccount[]> {
  const r = await fetch(`${API_URL}/api/pippit/accounts`)
  if (!r.ok) throw new Error('Không thể lấy danh sách tài khoản Pippit')
  return r.json()
}

export async function fetchActiveFacebookPages(): Promise<ActiveFacebookPage[]> {
  try {
    const [fbRes, ttRes] = await Promise.all([
      fetch(`${API_URL}/api/pippit/active-pages`),
      fetch(`${API_URL}/api/pippit/active-tiktok-channels`),
    ])
    const fbPages = fbRes.ok ? await fbRes.json() : []
    const ttChannels = ttRes.ok ? await ttRes.json() : []

    const mappedTT: ActiveFacebookPage[] = (ttChannels || []).map((t: any) => ({
      page_id: t.channel_id,
      page_name: t.nickname || (t.handle ? `@${t.handle}` : `TikTok ${t.channel_id}`),
      handle: t.handle || '',
      avatar_url: t.avatar_url,
      status: t.status,
      account_id: t.account_id,
      account_email: t.account_email,
      un_expired: t.un_expired,
      platform: 'tiktok',
    }))
    return [...fbPages, ...mappedTT]
  } catch {
    const r = await fetch(`${API_URL}/api/pippit/active-pages`)
    if (!r.ok) throw new Error('Không thể lấy danh sách Facebook Fanpage active')
    return r.json()
  }
}

export async function fetchPippitAllTasks(): Promise<PippitScheduleTask[]> {
  const r = await fetch(`${API_URL}/api/pippit/all-tasks`)
  if (!r.ok) throw new Error('Không thể lấy danh sách lịch bài đăng Pippit')
  return r.json()
}

export async function fetchSources(
  source: Exclude<SourceType, 'drive'>,
  opts: { q?: string; group?: string; limit?: number; offset?: number } = {}
): Promise<SourceListResponse> {
  const params = new URLSearchParams({ source })
  if (opts.q) params.set('q', opts.q)
  if (opts.group) params.set('group', opts.group)
  params.set('limit', String(opts.limit ?? 60))
  params.set('offset', String(opts.offset ?? 0))
  const r = await fetch(`${API_URL}/api/pippit/sources?${params.toString()}`)
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.detail || 'Không thể tải kho video')
  return data
}

export async function uploadLocalVideos(files: File[]): Promise<{ items: PublishableVideo[]; errors: string[] }> {
  const form = new FormData()
  for (const f of files) form.append('files', f)
  const r = await fetch(`${API_URL}/api/pippit/sources/upload-local`, { method: 'POST', body: form })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.detail || 'Không thể tải video từ máy lên')
  return data
}

export async function generateCaptions(payload: {
  items: { uid: string; title: string; context_text: string; existing_caption: string; platform: string }[]
  tone: string
  extra_brief: string
  include_ai_disclosure: boolean
}): Promise<CaptionGenerateResponse> {
  const r = await fetch(`${API_URL}/api/pippit/generate-captions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(data.detail || 'Gemini không viết được caption')
  return data
}

export type BulkSlot = ScheduleSlot & { platform?: 'facebook' | 'tiktok' }

export async function submitBulkSchedule(
  accountId: string,
  slots: BulkSlot[],
  tiktok?: TikTokOptions
): Promise<BulkScheduleResponse> {
  const payload = {
    account_id: accountId,
    items: slots.map(s => ({
      file_id: s.drive_file_id || null,
      file_path: s.file_path || null,
      file_name: s.file_name,
      title: s.title,
      caption: s.caption,
      schedule_time_ms: s.schedule_time_ms,
      page_id: s.page_id,
      source_type: s.source_type,
      source_id: s.source_id,
      prepend_title: false,
      ...(s.platform ? { platform: s.platform } : {}),
      ...(s.platform === 'tiktok' && tiktok ? tiktok : {}),
    })),
  }

  const r = await fetch(`${API_URL}/api/pippit/bulk-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json()
  if (!r.ok) {
    throw new Error(typeof data.detail === 'string' ? data.detail : 'Lên lịch đăng bài hàng loạt thất bại')
  }
  return data
}

