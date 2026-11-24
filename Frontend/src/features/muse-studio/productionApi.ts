import { API_URL } from '../../shared/constants'

export const base = API_URL + '/api/muse-production'
export const roles = ['scout', 'showrunner', 'producer'] as const
export type Role = (typeof roles)[number]
export const roleNames: Record<Role, string> = {
  scout: 'Săn tin',
  showrunner: 'Biên kịch & phản biện',
  producer: 'Sản xuất hình ảnh',
}
export interface Channel {
  name: string
  sources: string[]
  brand_voice: string
  visual_style: string
  seconds: number
  aspect: '9:16' | '16:9'
  voice_id: string
  accounts: Partial<Record<Role, string>>
  instructions?: Partial<Record<Role, string>>
  fallback: boolean
  preview_first: boolean
  rules: string[]
  daily_at: string
  daily_topic: string
}
export const blankChannel: Channel = {
  name: 'Kênh của tôi',
  sources: [],
  brand_voice: 'Tự nhiên, lôi cuốn, gần gũi và truyền cảm hứng.',
  visual_style: 'Phóng sự minh họa, ánh sáng tự nhiên, màu sắc nhất quán.',
  seconds: 45,
  aspect: '9:16',
  voice_id: '',
  accounts: {},
  fallback: true,
  preview_first: false,
  rules: [],
  daily_at: '',
  daily_topic: '',
}
export interface EpisodeRow {
  id: string
  topic: string
  stage: string
  status: string
  updated?: number
}
export interface Scene {
  scene: number
  seconds: number
  narration: string
  visual: string
  mood: string
  cut: string
  fact_ids: number[]
}
export interface Episode extends EpisodeRow {
  channel: Channel
  version: number
  error: string
  live_message?: string
  project: string | null
  receipt: object | null
  brief: {
    topic: string
    summary: string
    facts: { claim: string; url: string; source_title: string; evidence: string; published: string | null }[]
    hooks: { angle: string; hook: string }[]
  } | null
  script: { title: string; hook: number; scenes: Scene[] } | null
  manifest: {
    continuity: string
    scenes: { scene: number; image_prompt: string; motion_prompt: string }[]
  } | null
  review: { decision: string; feedback: string; score: number; scenes: number[] } | null
  media: Record<string, Partial<Record<'clip' | 'segment' | 'voice' | 'image', string>>>
  draft: string | null
}
export interface History {
  seq: number
  at: number
  stage: string
  message: string
  has_artifact: boolean
}
export const stages: Record<string, string> = {
  scout: 'Săn tin',
  brief_review: 'Phản biện nguồn',
  script: 'Viết kịch bản',
  manifest: 'Chuẩn bị cảnh',
  assets: 'Sản xuất cảnh',
  assemble: 'Ghép bản dựng',
  visual_review: 'Phản biện hình ảnh',
  draft: 'Bản dựng',
}
export function statusText(ep: EpisodeRow) {
  return (
    {
      script_gate: 'Chờ duyệt kịch bản',
      sample_gate: 'Chờ duyệt cảnh mẫu',
      draft_gate: 'Chờ duyệt bản dựng',
      approved: 'Đã duyệt bản dựng',
      attention: 'Cần xử lý',
    }[ep.status] ?? (ep.status === 'queued' ? 'Đang chờ · ' : '') + (stages[ep.stage] ?? ep.stage)
  )
}
export async function request<T>(
  path: string,
  method = 'GET',
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetch(base + path, {
    method,
    signal,
    ...(data === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) }),
  })
  if (!r.ok) {
    const err = await r.json().catch(() => ({}))
    throw new Error(
      typeof err.detail === 'string'
        ? err.detail
        : err.detail?.map?.((x: { msg: string }) => x.msg).join(' · ') ||
          'Không kết nối được dây chuyền Muse.',
    )
  }
  return r.json()
}
