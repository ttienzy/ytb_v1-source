import type { VeoJobOut, VeoJobRequest, VeoProject } from '../../veo-studio/types'
import type { AssetRef, ScenePlan } from '../contracts'
import type { VeoVideoConfig } from '../types'
import { getWorkflowConfig, type PollingPolicy } from './workflowConfig.ts'
import { pollJob } from './pollJob.ts'

export interface RenderSceneJobParams {
  scene: ScenePlan
  project: VeoProject
  videoConfig: VeoVideoConfig
  referenceAssets?: AssetRef[]
  onProgress?: (progress: number, step?: string) => void
  onSubmitted?: (jobId: string) => void
}

export interface RenderJobResult {
  ok: boolean
  jobId?: string
  videoUrl?: string
  outputFilePath?: string
  error?: string
}

/**
 * Veo currently exposes lifecycle states, not a numeric provider percentage.
 * These stage estimates are kept in one place so the UI never invents a value
 * per component. They must be presented as estimated progress until Flow
 * exposes a real percentage.
 */
export const VEO_STAGE_PROGRESS: Record<VeoJobOut['status'], number> = {
  pending: 15,
  captcha: 25,
  submitting: 35,
  generating: 65,
  downloading: 90,
  done: 100,
  error: 0,
}

export function getVeoStageProgress(status: VeoJobOut['status']): number {
  return VEO_STAGE_PROGRESS[status] ?? 0
}

interface RenderApi {
  submitJob: (request: VeoJobRequest) => Promise<VeoJobOut>
  getJobStatus: (id: string, signal?: AbortSignal) => Promise<VeoJobOut | null>
  getVideoStreamUrl: (path: string) => string
}

/** Injectable transport and policy keep lifecycle tests independent of the provider. */
export class RenderJobController {
  private readonly controller = new AbortController()
  private readonly api?: RenderApi
  private readonly policy: PollingPolicy

  constructor(api?: RenderApi, policy = getWorkflowConfig().polling) {
    this.api = api
    this.policy = policy
  }

  public cancel() { this.controller.abort() }

  public async renderScene(params: RenderSceneJobParams): Promise<RenderJobResult> {
    const { scene, project, videoConfig, onProgress, onSubmitted } = params
    const assets = params.referenceAssets ?? scene.referenceAssets ?? []
    let jobId = scene.jobId || undefined
    try {
      const api = this.api ?? await import('../../veo-studio/services/veoApi')
      if (this.controller.signal.aborted) throw new Error('Đã dừng theo dõi job.')
      if (!scene.prompt.trim()) throw new Error(`Clip #${scene.sceneNumber} chưa có prompt.`)
      if (assets.some(asset => asset.uploadStatus !== 'uploaded' || !asset.backendPath?.trim())) {
        throw new Error('Ảnh tham chiếu chưa tải xong hoặc tải thất bại. Hãy tải lại ảnh trước khi render.')
      }
      const ingredientPaths = [...new Set(assets.map(asset => asset.backendPath!))]
      if (!scene.startFramePath && ingredientPaths.length > 3) {
        throw new Error('Veo chỉ nhận tối đa 3 ảnh tham chiếu. Hãy chọn lại ảnh sản phẩm, nhân vật và bối cảnh.')
      }
      if (!videoConfig.model || !videoConfig.resolution) throw new Error('Chưa chọn cấu hình Veo hợp lệ.')
      if (!jobId) {
        onProgress?.(15, 'Đang gửi yêu cầu render...')
        const job = await api.submitJob({
          project_id: project.id,
          prompt: scene.prompt.trim(),
          model_display_name: videoConfig.model,
          input_mode: scene.startFramePath ? 'frames' : ingredientPaths.length ? 'ingredients' : 'text_to_video',
          image_path: scene.startFramePath || null,
          ingredient_image_paths: scene.startFramePath ? [] : ingredientPaths,
          aspect_ratio: videoConfig.aspectRatio,
          duration_seconds: scene.durationSec,
          resolution: videoConfig.resolution,
          num_outputs: videoConfig.variations,
        })
        jobId = job.job_id
        onSubmitted?.(jobId)
      }
      let lastProgress = 15
      const status = await pollJob({
        read: signal => api.getJobStatus(jobId!, signal),
        isTerminal: value => value.status === 'done' || value.status === 'error',
        onUpdate: value => {
          const nextProgress = getVeoStageProgress(value.status)
          // A delayed provider response must not make the progress bar move backwards.
          if (value.status !== 'error') lastProgress = Math.max(lastProgress, nextProgress)
          onProgress?.(value.status === 'error' ? 0 : lastProgress, value.current_step)
        },
        policy: this.policy,
        signal: this.controller.signal,
      })
      if (status.status === 'error') return { ok: false, error: status.error_message || 'Veo render thất bại.' }
      const outputFilePath = status.output_files?.[0]
      if (!outputFilePath) throw new Error('Job báo hoàn tất nhưng chưa có video đầu ra.')
      return { ok: true, jobId, outputFilePath, videoUrl: api.getVideoStreamUrl(outputFilePath) }
    } catch (error) {
      return { ok: false, jobId, error: error instanceof Error ? error.message : 'Không thể render video.' }
    }
  }
}
