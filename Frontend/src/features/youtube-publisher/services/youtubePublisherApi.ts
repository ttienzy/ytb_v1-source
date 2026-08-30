import { API_URL } from '../../../shared/constants'
import type {
  DriveFolder,
  DriveVideo,
  YouTubeCategory,
  YouTubeScheduleSlot,
  YouTubeStatus,
  YouTubeTask,
} from '../types'

export async function fetchYouTubeStatus(): Promise<YouTubeStatus> {
  const res = await fetch(`${API_URL}/api/youtube/status`)
  if (!res.ok) throw new Error('Không thể lấy trạng thái YouTube')
  return res.json()
}

export async function fetchYouTubeCategories(): Promise<YouTubeCategory[]> {
  const res = await fetch(`${API_URL}/api/youtube/categories`)
  if (!res.ok) throw new Error('Không thể lấy danh mục YouTube')
  return res.json()
}

export async function fetchDriveStatus(): Promise<any> {
  const res = await fetch(`${API_URL}/api/gdrive/status`)
  if (!res.ok) throw new Error('Không thể lấy trạng thái Google Drive')
  return res.json()
}

export async function fetchDriveFolders(): Promise<DriveFolder[]> {
  const res = await fetch(`${API_URL}/api/gdrive/folders`)
  if (!res.ok) throw new Error('Không thể tải danh sách thư mục Google Drive')
  return res.json()
}

export async function fetchDriveVideos(folderId?: string, search?: string): Promise<DriveVideo[]> {
  const params = new URLSearchParams()
  if (folderId) params.append('folder_id', folderId)
  if (search) params.append('q', search)
  const res = await fetch(`${API_URL}/api/gdrive/videos?${params.toString()}`)
  if (!res.ok) throw new Error('Không thể tải video từ Google Drive')
  const data = await res.json()
  return data.videos || []
}

export async function uploadLocalVideoFile(file: File): Promise<{ file_path: string; file_name: string }> {
  const formData = new FormData()
  formData.append('file', file)
  const res = await fetch(`${API_URL}/api/youtube/upload-file`, {
    method: 'POST',
    body: formData,
  })
  if (!res.ok) throw new Error('Không thể tải file video lên hệ thống')
  return res.json()
}

export async function publishSingleVideo(slot: YouTubeScheduleSlot): Promise<any> {
  const res = await fetch(`${API_URL}/api/youtube/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      file_path: slot.file_path,
      drive_file_id: slot.drive_file_id,
      source_type: slot.source_type,
      title: slot.title,
      description: slot.description,
      tags: slot.tags,
      category_id: slot.category_id,
      privacy_status: slot.privacy_status,
      publish_at: slot.publish_at,
    }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Đăng video thất bại')
  return data
}

export async function bulkScheduleVideos(slots: YouTubeScheduleSlot[]): Promise<any> {
  const res = await fetch(`${API_URL}/api/youtube/bulk-schedule`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slots }),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.detail || 'Lên lịch hàng loạt thất bại')
  return data
}

export async function fetchYouTubeTasks(): Promise<YouTubeTask[]> {
  const res = await fetch(`${API_URL}/api/youtube/tasks`)
  if (!res.ok) throw new Error('Không thể tải lịch sử tác vụ YouTube')
  return res.json()
}

export async function deleteYouTubeTask(taskId: string): Promise<boolean> {
  const res = await fetch(`${API_URL}/api/youtube/tasks/${encodeURIComponent(taskId)}`, {
    method: 'DELETE',
  })
  return res.ok
}
