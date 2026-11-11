import { API_URL } from '../../../shared/constants.ts'
import type { LongMotionJob, LongMotionOptions, LongPlan } from './longMotionView.ts'

const BASE = `${API_URL}/api/motion-long`

async function parse<T>(res: Response, fallback: string): Promise<T> {
  if (res.ok) return res.json() as Promise<T>
  let detail = ''
  try {
    const data = await res.json()
    detail = typeof data?.detail === 'string' ? data.detail : JSON.stringify(data?.detail ?? '')
  } catch {
    /* thân phản hồi không phải JSON */
  }
  throw new Error(detail || `${fallback} (HTTP ${res.status})`)
}

const json = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
})

export async function planLongMotion(duration: number, overlap: boolean, overlapSeconds: number): Promise<LongPlan> {
  const res = await fetch(`${BASE}/plan`, json({ duration, overlap, overlap_seconds: overlapSeconds }))
  return parse<LongPlan>(res, 'Không chia được video')
}

export async function createLongMotion(args: {
  video: File
  prompt: string
  imagePaths: string[]
  aspectRatio?: string
  options: Partial<LongMotionOptions>
}): Promise<LongMotionJob> {
  const body = new FormData()
  body.append('video', args.video)
  body.append('prompt', args.prompt)
  body.append('image_paths', JSON.stringify(args.imagePaths))
  body.append('aspect_ratio', args.aspectRatio || '')
  body.append('options', JSON.stringify(args.options))
  const res = await fetch(`${BASE}/jobs`, { method: 'POST', body })
  return parse<LongMotionJob>(res, 'Không tạo được kế hoạch')
}

export async function getLongMotion(id: string): Promise<LongMotionJob> {
  return parse<LongMotionJob>(await fetch(`${BASE}/jobs/${id}`), 'Không đọc được trạng thái')
}

export async function runLongMotion(id: string, indices?: number[]): Promise<LongMotionJob> {
  return parse<LongMotionJob>(await fetch(`${BASE}/jobs/${id}/run`, json(indices ? { indices } : {})), 'Không chạy được')
}

export async function stopLongMotion(id: string): Promise<LongMotionJob> {
  return parse<LongMotionJob>(await fetch(`${BASE}/jobs/${id}/stop`, { method: 'POST' }), 'Không dừng được')
}

export async function mergeLongMotion(id: string, options: Partial<LongMotionOptions>): Promise<LongMotionJob> {
  return parse<LongMotionJob>(await fetch(`${BASE}/jobs/${id}/merge`, json(options)), 'Không ghép được')
}

export async function cleanLongMotion(id: string): Promise<LongMotionJob> {
  return parse<LongMotionJob>(await fetch(`${BASE}/jobs/${id}/exports/clean`, { method: 'POST' }), 'Không xóa được watermark')
}

export async function deleteLongMotion(id: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${id}`, { method: 'DELETE' })
  if (!res.ok) await parse(res, 'Không xóa được')
}

export function longMotionFileUrl(id: string, kind: 'final' | 'clean' | 'segment' | 'source', opts?: { index?: number; attachment?: boolean; bust?: number }): string {
  const q = new URLSearchParams()
  if (opts?.index != null) q.set('index', String(opts.index))
  if (opts?.attachment) q.set('attachment', 'true')
  if (opts?.bust) q.set('t', String(opts.bust))
  const qs = q.toString()
  return `${BASE}/jobs/${id}/file/${kind}${qs ? `?${qs}` : ''}`
}

export interface BgmTrackLite {
  track_id: string
  name: string
}

export async function listBgmTracks(): Promise<BgmTrackLite[]> {
  const res = await fetch(`${API_URL}/api/bgm`)
  return parse<BgmTrackLite[]>(res, 'Không đọc được Thư viện nhạc')
}
