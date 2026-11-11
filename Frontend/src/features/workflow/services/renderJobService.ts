import type { VeoJobOut, VeoJobRequest, VeoProject } from '../../veo-studio/types'
import type { AssetRef, ScenePlan } from '../contracts'
import type { VeoVideoConfig } from '../types'
import { getWorkflowConfig, type PollingPolicy } from './workflowConfig.ts'
import { pollJob } from './pollJob.ts'
import { MAX_REFERENCES, OMNI_12, isOmni12, pickReferencePaths } from './veoModelPolicy.ts'

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

/** Omni 1.2 (HTTP): Ingredients 3–15 giây; clip nối tiếp lấy khung cuối clip trước làm ảnh tham chiếu đầu tiên. */
function buildOmni12Request(params: RenderSceneJobParams, assets: AssetRef[]): VeoJobRequest {
  const { scene, project, videoConfig } = params
  // Ảnh sản phẩm/nhân vật chỉ bắt buộc đã tải lên nếu thật sự được gửi đi.
  const refs = pickReferencePaths(scene.startFramePath, assets.filter(a => a.uploadStatus === 'uploaded' && a.backendPath?.trim()))
  const pending = assets.some(a => a.uploadStatus !== 'uploaded' || !a.backendPath?.trim())
  if (pending && refs.length < MAX_REFERENCES) {
    throw new Error('Ảnh tham chiếu chưa tải xong hoặc tải thất bại. Hãy tải lại ảnh trước khi render.')
  }
  const mode = refs.length ? 'ingredients' : 'text_to_video'
  if (mode === 'ingredients' && (scene.durationSec < 3 || scene.durationSec > 15)) {
    throw new Error(`Omni 1.2 Ingredients nhận 3–15 giây (clip #${scene.sceneNumber} đang là ${scene.durationSec} giây).`)
  }
  if (mode === 'text_to_video' && scene.durationSec !== 10) {
    throw new Error('Omni 1.2 không có ảnh tham chiếu chỉ tạo được clip 10 giây. Hãy nối ảnh sản phẩm/nhân vật hoặc chọn 10 giây.')
  }
  if (!['720p', '360p'].includes(videoConfig.resolution)) throw new Error('Omni 1.2 nhận 360p hoặc 720p.')
  return {
    project_id: project.id, prompt: scene.prompt.trim(), model_display_name: OMNI_12,
    input_mode: mode, image_path: null, end_image_path: null, ingredient_image_paths: refs,
    aspect_ratio: videoConfig.aspectRatio, duration_seconds: scene.durationSec, resolution: videoConfig.resolution, num_outputs: 1,
  }
}

/** A workflow clip has exactly one output; reference images never become frames implicitly. */
export function buildWorkflowVideoRequest(params: RenderSceneJobParams): VeoJobRequest {
  const { scene, project, videoConfig } = params
  const assets = params.referenceAssets ?? scene.referenceAssets ?? []
  if (!scene.prompt.trim()) throw new Error(`Clip #${scene.sceneNumber} chưa có prompt.`)
  if (scene.sceneNumber > 1 && scene.chainFromPrevious !== false && !scene.startFramePath) {
    throw new Error(`Clip #${scene.sceneNumber} cần frame cuối của clip trước làm Start Frame.`)
  }
  if (videoConfig.variations !== 1) throw new Error('Chuỗi video yêu cầu 1 biến thể mỗi clip. Hãy chọn 1 biến thể trong Cấu hình Veo.')
  if (!['16:9', '9:16'].includes(videoConfig.aspectRatio)) throw new Error('Chọn tỉ lệ 16:9 hoặc 9:16 cho video.')
  if (isOmni12(videoConfig.model)) return buildOmni12Request(params, assets)
  // Omni 1.1 đã bỏ khỏi AI Workflow; model khác không nhận ảnh tham chiếu/nối clip ở đây.
  throw new Error(`AI Workflow chỉ tạo clip bằng Omni 1.2 Flash (đang chọn "${videoConfig.model || 'chưa chọn'}"). Mở Cấu hình Veo và chọn Omni 1.2 Flash.`)
}

/** Injectable transport and policy keep lifecycle tests independent of the provider. */
export class RenderJobController {
  private readonly controller = new AbortController()
  private readonly api?: RenderApi
  private readonly policy: PollingPolicy

  constructor(api?: RenderApi, policy?: PollingPolicy) {
    this.api = api
    this.policy = policy ?? { ...getWorkflowConfig().polling, timeoutMs: Math.max(getWorkflowConfig().polling.timeoutMs, 1110000) }
  }

  public cancel() { this.controller.abort() }

  public async renderScene(params: RenderSceneJobParams): Promise<RenderJobResult> {
    const { scene, onProgress, onSubmitted } = params
    let jobId = scene.jobId || undefined
    try {
      const api = this.api ?? await import('../../veo-studio/services/veoApi')
      if (this.controller.signal.aborted) throw new Error('Đã dừng theo dõi job.')
      if (!jobId) {
        const request = buildWorkflowVideoRequest(params)
        onProgress?.(15, 'Đang gửi yêu cầu render...')
        const job = await api.submitJob(request)
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
