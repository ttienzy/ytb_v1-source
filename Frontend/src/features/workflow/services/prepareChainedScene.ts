import type { ScenePlan } from '../contracts'

/** Resolve the next clip's actual input before submitting any generation job. */
export async function prepareChainedScene<T extends Omit<ScenePlan, 'referenceAssets'>>(
  scene: T, index: number, previous: Omit<ScenePlan, 'referenceAssets'> | undefined,
  extract: (videoPath: string) => Promise<{ ok: boolean; file_path: string; image_id: string }>,
  preview: (imageId: string) => string,
): Promise<T> {
  // A lost polling connection must resume the same job, without another upload/generation.
  if (scene.jobId && !scene.videoUrl && !scene.outputFilePath) return scene
  if (index === 0 || scene.chainFromPrevious === false) {
    return { ...scene, jobId: null, startFramePath: null, startFramePreviewUrl: null }
  }
  const path = previous?.outputFilePath || previous?.videoUrl
  if (!path) throw new Error(`Hãy tạo clip #${index} trước để nối khung hình.`)
  const frame = await extract(path)
  if (!frame.ok || !frame.file_path) throw new Error('Không trích xuất được frame cuối. Chuỗi đã dừng trước khi gửi clip tiếp theo.')
  return { ...scene, jobId: null, startFramePath: frame.file_path, startFramePreviewUrl: preview(frame.image_id) }
}
