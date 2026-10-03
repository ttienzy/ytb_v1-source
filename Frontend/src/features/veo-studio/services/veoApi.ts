/**
 * Veo Studio — API Client
 */

import { API_URL } from '../../../shared/constants'
import type {
  VeoBridgeStatus,
  VeoCapabilities,
  VeoHistoryItem,
  VeoImageGenerateRequest,
  VeoImageGenerateResponse,
  VeoImageItem,
  VeoJobOut,
  VeoJobRequest,
  VeoProject,
} from '../types'

const BASE = `${API_URL}/api/veo`

async function responseError(resp: Response, fallback: string): Promise<Error> {
  const body = await resp.json().catch(() => null) as { detail?: unknown; error?: unknown } | null
  const detail = body?.detail ?? body?.error
  let message = ''
  if (typeof detail === 'string') {
    message = detail
  } else if (Array.isArray(detail)) {
    message = detail
      .map((item) => {
        if (typeof item === 'string') return item
        if (item && typeof item === 'object' && 'msg' in item) return String(item.msg)
        return JSON.stringify(item)
      })
      .filter(Boolean)
      .join('; ')
  }
  return new Error(message || `${fallback} (HTTP ${resp.status})`)
}

// ─── Projects ───────────────────────────────────────────────────────────────

export async function getProjects(): Promise<VeoProject[]> {
  const resp = await fetch(`${BASE}/projects`)
  if (!resp.ok) return []
  return resp.json()
}

export async function getActiveProject(): Promise<VeoProject | null> {
  const resp = await fetch(`${BASE}/projects/active`)
  if (!resp.ok) return null
  return resp.json()
}

export async function createProject(name: string): Promise<VeoProject> {
  const resp = await fetch(`${BASE}/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
    throw new Error(err.detail || 'Tạo project thất bại')
  }
  return resp.json()
}

export async function selectProject(projectId: string): Promise<VeoProject> {
  const resp = await fetch(`${BASE}/projects/${projectId}/select`, {
    method: 'POST',
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
    throw new Error(err.detail || 'Chọn project thất bại')
  }
  return resp.json()
}

export async function deleteProject(projectId: string): Promise<boolean> {
  const resp = await fetch(`${BASE}/projects/${projectId}`, { method: 'DELETE' })
  return resp.ok
}

// ─── Jobs ───────────────────────────────────────────────────────────────────

export async function submitJob(request: VeoJobRequest): Promise<VeoJobOut> {
  const resp = await fetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!resp.ok) {
    throw await responseError(resp, 'Gửi job thất bại')
  }
  return resp.json()
}

export async function getJobs(): Promise<VeoJobOut[]> {
  const resp = await fetch(`${BASE}/jobs`)
  if (!resp.ok) return []
  return resp.json()
}

export async function getJobStatus(jobId: string, signal?: AbortSignal): Promise<VeoJobOut | null> {
  const resp = await fetch(`${BASE}/jobs/${jobId}`, { signal })
  if (!resp.ok) throw new Error(`Không đọc được job ${jobId} (HTTP ${resp.status}).`)
  return resp.json()
}

export async function deleteJob(jobId: string): Promise<boolean> {
  const resp = await fetch(`${BASE}/jobs/${jobId}`, { method: 'DELETE' })
  return resp.ok
}

// ─── Status & Capabilities ─────────────────────────────────────────────────

export async function getBridgeStatus(): Promise<VeoBridgeStatus> {
  const resp = await fetch(`${BASE}/status`)
  if (!resp.ok) throw new Error('Không kết nối được Backend')
  return resp.json()
}

export async function getCapabilities(): Promise<VeoCapabilities> {
  const resp = await fetch(`${BASE}/capabilities`)
  if (!resp.ok) throw new Error('Không lấy được capabilities')
  return resp.json()
}

// ─── History ────────────────────────────────────────────────────────────────

export async function getHistory(): Promise<VeoHistoryItem[]> {
  const resp = await fetch(`${BASE}/history`)
  if (!resp.ok) return []
  return resp.json()
}

export async function deleteVideo(videoId: string): Promise<boolean> {
  const resp = await fetch(`${BASE}/history/${videoId}`, { method: 'DELETE' })
  return resp.ok
}

export function getVideoStreamUrl(videoIdOrPath: string): string {
  if (!videoIdOrPath) return ''
  const cleanId = videoIdOrPath.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, '') || videoIdOrPath
  return `${BASE}/history/${encodeURIComponent(cleanId)}/file`
}

export async function extractLastFrame(
  videoId: string,
): Promise<{
  ok: boolean
  image_id: string
  file_path: string
  preview_url: string
  prompt?: string
  aspect_ratio?: string
}> {
  const streamId = videoId.match(/\/history\/([^/?#]+)\/file(?:[?#]|$)/)?.[1]
  const cleanId = streamId ? decodeURIComponent(streamId) : videoId.split(/[/\\]/).pop()?.replace(/\.[^/.]+$/, '') || videoId
  const resp = await fetch(`${BASE}/history/${encodeURIComponent(cleanId)}/extract-last-frame`, {
    method: 'POST',
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
    throw new Error(err.detail || 'Trích xuất frame cuối thất bại')
  }
  return resp.json()
}


// ─── Upload ─────────────────────────────────────────────────────────────────

export async function uploadImage(
  file: File,
): Promise<{ file_id: string; file_path: string }> {
  const body = new FormData()
  body.append('file', file)
  const resp = await fetch(`${BASE}/upload-image`, { method: 'POST', body })
  if (!resp.ok) throw await responseError(resp, 'Upload ảnh thất bại')
  return resp.json()
}

export async function uploadVideoReference(
  file: File,
  flowProjectId: string,
  options?: { forceFresh?: boolean; nativeUi?: boolean },
): Promise<{ ok: boolean; media_id: string; project_id: string; filename: string; cached?: boolean }> {
  const bytes = new Uint8Array(await file.arrayBuffer())
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }

  const resp = await fetch(`${BASE}/upload-video`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      project_id: flowProjectId,
      video_base64: btoa(binary),
      video_mime: file.type || 'video/mp4',
      video_filename: file.name,
      force_fresh: options?.forceFresh === true,
      native_ui: options?.nativeUi === true,
    }),
  })
  if (!resp.ok) {
    throw await responseError(resp, 'Upload video tham chiếu thất bại')
  }
  return resp.json()
}

// ─── Image Generation (Nano Banana) ─────────────────────────────────────────

export async function generateImages(
  request: VeoImageGenerateRequest,
): Promise<VeoImageGenerateResponse> {
  const resp = await fetch(`${BASE}/images/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
    throw new Error(err.detail || 'Tạo ảnh thất bại')
  }
  return resp.json()
}

export async function getImages(projectId?: string | null): Promise<VeoImageItem[]> {
  const query = projectId ? `?project_id=${encodeURIComponent(projectId)}` : ''
  const resp = await fetch(`${BASE}/images${query}`)
  if (!resp.ok) return []
  return resp.json()
}

export async function deleteImage(imageId: string): Promise<boolean> {
  const resp = await fetch(`${BASE}/images/${imageId}`, { method: 'DELETE' })
  return resp.ok
}

export function getImageFileUrl(imageId: string): string {
  return `${BASE}/images/${imageId}/file`
}

export function getImageCleanUrl(imageId: string): string {
  return `${BASE}/images/${imageId}/clean`
}

export async function downloadCleanImage(imageId: string): Promise<Blob> {
  const resp = await fetch(getImageCleanUrl(imageId))
  if (!resp.ok) {
    throw await responseError(resp, 'Xóa watermark và tải ảnh thất bại')
  }
  return resp.blob()
}

