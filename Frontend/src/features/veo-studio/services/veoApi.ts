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
    const err = await resp.json().catch(() => ({ detail: `HTTP ${resp.status}` }))
    throw new Error(err.detail || 'Gửi job thất bại')
  }
  return resp.json()
}

export async function getJobs(): Promise<VeoJobOut[]> {
  const resp = await fetch(`${BASE}/jobs`)
  if (!resp.ok) return []
  return resp.json()
}

export async function getJobStatus(jobId: string): Promise<VeoJobOut | null> {
  const resp = await fetch(`${BASE}/jobs/${jobId}`)
  if (!resp.ok) return null
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

// ─── Upload ─────────────────────────────────────────────────────────────────

export async function uploadImage(
  file: File,
): Promise<{ file_id: string; file_path: string }> {
  const body = new FormData()
  body.append('file', file)
  const resp = await fetch(`${BASE}/upload-image`, { method: 'POST', body })
  if (!resp.ok) throw new Error('Upload ảnh thất bại')
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

