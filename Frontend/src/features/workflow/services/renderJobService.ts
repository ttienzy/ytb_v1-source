/**
 * Render Job Service cho Google Veo 3.0 Flow Studio
 * Quản lý vòng đời submit job -> polling status -> hoàn tất clip hoặc báo lỗi.
 * Hỗ trợ truyền reference images (input_mode: ingredients) với file path thật.
 * KHÔNG sử dụng ảnh mẫu giả lập (Unsplash) khi gặp lỗi.
 */

import * as veoApi from '../../veo-studio/services/veoApi'
import type { VeoProject } from '../../veo-studio/types'
import type { AssetRef, ScenePlan } from '../contracts'
import type { VeoVideoConfig } from '../types'

export interface RenderSceneJobParams {
  scene: ScenePlan
  project: VeoProject
  videoConfig: VeoVideoConfig
  referenceAssets?: AssetRef[]
  onProgress?: (progress: number, step?: string) => void
}

export interface RenderJobResult {
  ok: boolean
  videoUrl?: string
  outputFilePath?: string
  error?: string
}

export class RenderJobController {
  private isCancelled = false
  private timer: any = null

  public cancel() {
    this.isCancelled = true
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
  }

  public async renderScene(params: RenderSceneJobParams): Promise<RenderJobResult> {
    const { scene, project, videoConfig, referenceAssets = [], onProgress } = params

    if (!scene.prompt || !scene.prompt.trim()) {
      return {
        ok: false,
        error: `Phân cảnh #${scene.sceneNumber} chưa có nội dung prompt.`,
      }
    }

    // Xác định input mode: ưu tiên frames (Start Frame từ clip trước) -> ingredients -> text_to_video
    const ingredientPaths = referenceAssets
      .map((a) => a.backendPath)
      .filter((p): p is string => Boolean(p && p.trim()))
      .slice(0, 3)

    let inputMode: 'text_to_video' | 'frames' | 'ingredients' = 'text_to_video'
    let imagePath: string | null = null
    let ingredientImagePaths: string[] = []

    if (scene.startFramePath) {
      inputMode = 'frames'
      imagePath = scene.startFramePath
    } else if (ingredientPaths.length > 0) {
      inputMode = 'ingredients'
      ingredientImagePaths = ingredientPaths
    }

    try {
      onProgress?.(15, `Đang gửi yêu cầu render (${inputMode === 'frames' ? 'Khung hình nối tiếp' : inputMode === 'ingredients' ? 'Ảnh tham chiếu' : 'Prompt'})...`)

      const job = await veoApi.submitJob({
        project_id: project.id,
        prompt: scene.prompt.trim(),
        model_display_name: videoConfig.model || 'Omni 1.1 Flash',
        input_mode: inputMode,
        image_path: imagePath,
        ingredient_image_paths: ingredientImagePaths,
        aspect_ratio: (videoConfig.aspectRatio || '9:16') as any,
        duration_seconds: scene.durationSec || 4,
        resolution: videoConfig.resolution || '720p',
        num_outputs: videoConfig.variations || 1,
      })

      if (this.isCancelled) {
        return { ok: false, error: 'Job đã bị hủy bởi người dùng.' }
      }

      onProgress?.(30, 'Job đã được tiếp nhận, đang tiến hành sinh video...')

      // Polling kiểm tra trạng thái
      return new Promise<RenderJobResult>((resolve) => {
        let attempts = 0
        const maxAttempts = 80 // Tối đa ~4 phút polling

        this.timer = setInterval(async () => {
          if (this.isCancelled) {
            clearInterval(this.timer)
            resolve({ ok: false, error: 'Job đã bị hủy.' })
            return
          }

          attempts++
          try {
            const status = await veoApi.getJobStatus(job.job_id)
            if (!status) return

            if (status.status === 'done') {
              clearInterval(this.timer)
              const outputFile = status.output_files?.[0] || ''
              const videoUrl = outputFile ? veoApi.getVideoStreamUrl(outputFile) : ''
              onProgress?.(100, 'Hoàn thành render video!')
              resolve({
                ok: true,
                videoUrl,
                outputFilePath: outputFile,
              })
            } else if (status.status === 'error') {
              clearInterval(this.timer)
              const errMsg = status.error_message || 'Google Veo báo lỗi trong quá trình tạo video.'
              resolve({ ok: false, error: errMsg })
            } else {
              // Cập nhật progress động
              const currentProgress = Math.min(92, 30 + Math.floor(attempts * 1.5))
              const stepName = status.current_step || 'Đang render video trên Veo Flow...'
              onProgress?.(currentProgress, stepName)

              if (attempts >= maxAttempts) {
                clearInterval(this.timer)
                resolve({
                  ok: false,
                  error: 'Hết thời gian chờ (timeout) khi render video trên Veo.',
                })
              }
            }
          } catch (err: any) {
            if (attempts >= 10) {
              clearInterval(this.timer)
              resolve({
                ok: false,
                error: err?.message || 'Lỗi mạng khi kiểm tra trạng thái render.',
              })
            }
          }
        }, 3000)
      })
    } catch (err: any) {
      return {
        ok: false,
        error: err?.message || 'Không thể kết nối tới Google Veo Studio để tạo job.',
      }
    }
  }
}
