import { API_URL } from '../../../shared/constants'
import type { ChannelVideosResponse, DiscoveredChannel } from '../types'

export async function fetchPresetChannels(): Promise<DiscoveredChannel[]> {
  const res = await fetch(`${API_URL}/api/discover/preset-channels`)
  if (!res.ok) throw new Error('Không thể tải danh sách kênh đề xuất')
  return res.json()
}

export async function fetchSavedChannels(): Promise<DiscoveredChannel[]> {
  const res = await fetch(`${API_URL}/api/discover/saved-channels`)
  if (!res.ok) throw new Error('Không thể tải danh sách kênh đã lưu')
  return res.json()
}

export async function saveCustomChannel(channel: Partial<DiscoveredChannel>): Promise<{ ok: boolean; saved_count: number }> {
  const res = await fetch(`${API_URL}/api/discover/saved-channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(channel),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Lưu kênh thất bại')
  }
  return res.json()
}

export async function deleteSavedChannel(handleOrId: string): Promise<{ ok: boolean }> {
  const res = await fetch(`${API_URL}/api/discover/saved-channels/${encodeURIComponent(handleOrId)}`, {
    method: 'DELETE',
  })
  if (!res.ok) throw new Error('Xóa kênh thất bại')
  return res.json()
}

export async function searchChannelsWithGemini(query: string, category?: string): Promise<{ query: string; results: DiscoveredChannel[] }> {
  const res = await fetch(`${API_URL}/api/discover/recommend-channels`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, category }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Tìm kiếm kênh bằng Gemini thất bại')
  }
  return res.json()
}

export async function fetchChannelVideos(channelUrl: string, limit = 24, offset = 0): Promise<ChannelVideosResponse> {
  const res = await fetch(`${API_URL}/api/discover/channel-videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel_url: channelUrl, limit, offset }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || 'Không thể quét danh sách video từ kênh')
  }
  return res.json()
}
