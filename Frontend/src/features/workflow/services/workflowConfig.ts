import { toApiError } from '../../../shared/apiError.ts'

/** Backend owns runtime policy. These defaults also support offline editing. */
export interface PollingPolicy {
  intervalMs: number
  timeoutMs: number
  requestTimeoutMs: number
  maxConsecutiveErrors: number
}

export interface WorkflowConfig {
  defaultClipDurationSeconds: number
  defaultScriptModel: string
  defaultVoiceId: string
  defaultVeoModel: string
  defaultAspectRatio: '9:16' | '16:9'
  defaultResolution: string
  defaultVariations: number
  voiceoverWordsPerSecond: { min: number; max: number }
  polling: PollingPolicy
}

const fallback: WorkflowConfig = {
  defaultClipDurationSeconds: 10,
  defaultScriptModel: 'cx/gpt-5.5',
  defaultVoiceId: 'bf4bed06c671',
  defaultVeoModel: 'Omni 1.1 Flash',
  defaultAspectRatio: '9:16',
  defaultResolution: '720p',
  defaultVariations: 1,
  voiceoverWordsPerSecond: { min: 2.0, max: 2.4 },
  polling: { intervalMs: 3000, timeoutMs: 900000, requestTimeoutMs: 30000, maxConsecutiveErrors: 5 },
}
let config: WorkflowConfig = fallback

export function getWorkflowConfig(): WorkflowConfig { return config }

export async function loadWorkflowConfig(apiBase: string): Promise<WorkflowConfig> {
  let response: Response
  try {
    response = await fetch(`${apiBase}/api/workflow/config`)
  } catch (error) {
    throw toApiError(error, 'tải cấu hình workflow')
  }
  if (!response.ok) throw new Error(`Không tải được cấu hình workflow (HTTP ${response.status}).`)
  const next: WorkflowConfig = await response.json()
  const values = [next.defaultClipDurationSeconds, next.defaultVariations, next.voiceoverWordsPerSecond?.min,
    next.voiceoverWordsPerSecond?.max, ...Object.values(next.polling || {})]
  if (!next.defaultScriptModel || !next.defaultVoiceId || !next.defaultVeoModel ||
      !['9:16', '16:9'].includes(next.defaultAspectRatio) || !next.defaultResolution || next.defaultVariations < 1 ||
      !next.polling?.timeoutMs ||
      !next.polling?.intervalMs || !next.polling?.requestTimeoutMs || !next.polling?.maxConsecutiveErrors ||
      values.some(value => !Number.isFinite(value) || value <= 0) ||
      next.voiceoverWordsPerSecond.min > next.voiceoverWordsPerSecond.max) {
    throw new Error('Cấu hình workflow từ backend không hợp lệ.')
  }
  config = next
  return config
}
