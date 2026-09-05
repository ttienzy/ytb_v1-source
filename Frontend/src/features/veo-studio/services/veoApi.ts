/**
 * Veo Studio — API Client
 */

import { API_URL } from '../../../shared/constants'
import type {
  VeoBridgeStatus,
  VeoCapabilities,
  VeoHistoryItem,
  VeoJobOut,
  VeoJobRequest,
} from '../types'

const BASE = `${API_URL}/api/veo`

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

export function getVideoStreamUrl(videoId: string): string {
  return `${BASE}/history/${videoId}/file`
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
