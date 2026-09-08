import { API_URL } from '../../../shared/constants'
import type {
  BulkScheduleResponse,
  DriveFolder,
  DriveVideoList,
  DriveVideo,
  PippitAccount,
  PippitScheduleTask,
  ScheduleSlot,
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
      page_name: `[TikTok] ${t.nickname}${t.handle ? ` (@${t.handle})` : ''}`,
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

export async function submitBulkSchedule(
  accountId: string,
  slots: ScheduleSlot[]
): Promise<BulkScheduleResponse> {
  const payload = {
    account_id: accountId,
    items: slots.map(s => ({
      file_id: s.file_id,
      file_path: (s as any).file_path || null,
      file_name: s.file_name,
      title: s.title,
      caption: s.caption,
      schedule_time_ms: s.schedule_time_ms,
      page_id: s.page_id,
    })),
  }

  const r = await fetch(`${API_URL}/api/pippit/bulk-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const data = await r.json()
  if (!r.ok) {
    throw new Error(data.detail || 'Lên lịch đăng bài hàng loạt thất bại')
  }
  return data
}
