/**
 * Pure Mapper: Chuyển đổi SalesScript từ ChatGPT sang các clip Google Flow.
 * 
 * NGUYÊN TẮC:
 * - Hàm thuần (Pure function), không side effect.
 * - Bất biến nghiệp vụ: 1 kịch bản = 1 clip độc lập.
 * - Số lượng clip lấy từ số kịch bản; thời lượng lấy từ cấu hình Flow.
 * - Giữ trọn vẹn nội dung text prompt không cắt bớt.
 *
 * `ScenePlan` và các field `scene*` được giữ lại để tương thích dữ liệu/API cũ.
 */

import type {
  AssetRef,
  SalesScript,
  ScenePlan,
  ScenePlanConfig,
  ScriptCollection,
  ScriptGenerationConfig,
} from '../contracts'

import { getWorkflowConfig } from './workflowConfig.ts'

export const DEFAULT_CLIP_DURATION_SECONDS = getWorkflowConfig().defaultClipDurationSeconds

export const DEFAULT_SCENE_CONFIG: ScenePlanConfig = {
  count: 3,
  durations: [DEFAULT_CLIP_DURATION_SECONDS],
  aspectRatio: '9:16',
  cameraStyles: [],
}

export function normalizeClipDuration(
  value?: number,
  fallback = getWorkflowConfig().defaultClipDurationSeconds,
): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.round(value)
    : fallback
}

/** Use the same word budget policy exposed by the backend. */
export function estimateVoiceoverWordRange(durationSeconds?: number): { min: number; max: number } {
  const duration = normalizeClipDuration(durationSeconds)
  return {
    min: Math.max(1, Math.round(duration * getWorkflowConfig().voiceoverWordsPerSecond.min)),
    max: Math.max(1, Math.round(duration * getWorkflowConfig().voiceoverWordsPerSecond.max)),
  }
}

export function isScriptCollectionStale(
  collection: ScriptCollection | undefined,
  current: ScriptGenerationConfig & { promptTemplate?: string; model?: string },
): boolean {
  if (!collection) return false
  return (
    collection.requestedCount !== current.count ||
    collection.actualCount !== collection.requestedCount ||
    collection.actualCount !== collection.items.length ||
    collection.contentMode !== current.contentMode ||
    (collection.storyMode || 'sequential') !== (current.storyMode || 'sequential') ||
    (collection.batchSize || 8) !== (current.batchSize || 8) ||
    (current.minWords !== undefined && collection.minWords !== current.minWords) ||
    (current.maxWords !== undefined && collection.maxWords !== current.maxWords) ||
    collection.platform !== (current.platform || 'auto') ||
    collection.clipDurationSeconds !== normalizeClipDuration(current.clipDurationSeconds) ||
    collection.promptTemplate !== (current.promptTemplate || '') ||
    collection.requestedModel !== (current.model || getWorkflowConfig().defaultScriptModel)
  )
}

/**
 * Lấy toàn bộ nội dung text của 1 kịch bản để gửi cho Veo.
 * Ưu tiên visual_direction (tiếng Anh) làm prompt chính cho Veo vì đã chứa sẵn
 * cinematic direction + Vietnamese dialogue reference.
 */
export function getFullScriptContent(s?: SalesScript): string {
  if (!s) return ''
  const visual = s.visualDirection || (s as any).visual_direction
  const voice = s.voiceover || (s as any).voice_over
  const onScreen = s.onScreenText || (s as any).on_screen_text

  // Nếu có visual_direction (tiếng Anh) — dùng làm prompt chính cho Veo
  if (visual && visual.trim()) {
    // visual_direction đã chứa cinematic direction
    // KHÔNG ghép voiceover vào prompt Veo — voice sẽ được lồng riêng bằng VieNeu-TTS
    // TUYỆT ĐỐI KHÔNG ghép on_screen_text vào prompt Veo — tránh AI Veo tự vẽ/in chữ lên video
    return visual.trim()
  }

  // Fallback: ghép các phần kịch bản khi không có visual_direction (tuyệt đối không đưa onScreen vào prompt Veo)
  const parts: string[] = []
  if (voice) {
    parts.push(`Lời thoại: ${voice}`)
  }
  if (parts.length > 0) {
    if (s.cta) parts.push(`CTA: ${s.cta}`)
    return parts.join('\n\n')
  }

  if (s.content && s.content.trim()) return s.content.trim()

  const fallbackParts = [
    s.hook ? `Hook: ${s.hook}` : '',
    s.problem ? `Vấn đề: ${s.problem}` : '',
    s.product ? `Sản phẩm: ${s.product}` : '',
    s.benefits ? `Lợi ích: ${s.benefits}` : '',
    s.cta ? `CTA: ${s.cta}` : '',
  ].filter(Boolean)

  return fallbackParts.join('\n\n')
}

/**
 * Map danh sách kịch bản thành danh sách clip theo quan hệ 1:1.
 */
export function buildClipPlans(params: {
  scripts: SalesScript[]
  sceneConfig?: Partial<ScenePlanConfig>
  assets?: AssetRef[]
}): ScenePlan[] {
  const { scripts, sceneConfig, assets = [] } = params
  const count = scripts.length

  if (sceneConfig?.count !== undefined && sceneConfig.count !== count) {
    throw new Error(
      `Số clip phải bằng số kịch bản theo quy tắc 1:1 (nhận ${scripts.length} kịch bản nhưng cấu hình yêu cầu ${sceneConfig.count} clip).`
    )
  }

  const durations = sceneConfig?.durations ?? DEFAULT_SCENE_CONFIG.durations
  const aspectRatio = sceneConfig?.aspectRatio ?? DEFAULT_SCENE_CONFIG.aspectRatio
  const cameraStyles = sceneConfig?.cameraStyles ?? DEFAULT_SCENE_CONFIG.cameraStyles ?? []

  const clips: ScenePlan[] = []

  for (let i = 0; i < count; i++) {
    const script = scripts[i]
    const rawDuration = durations[i] !== undefined ? durations[i] : durations[0]
    const durationSec = normalizeClipDuration(rawDuration)
    const cameraMotion = cameraStyles[i] || cameraStyles[0]

    const title = script?.title
      ? `Clip ${i + 1}: ${script.title}`
      : script?.angle
      ? `Clip ${i + 1}: ${script.angle}`
      : `Clip #${i + 1}`

    const prompt = getFullScriptContent(script)

    clips.push({
      sceneNumber: i + 1,
      title,
      prompt,
      voiceover: script.voiceover || script.content,
      durationSec,
      aspectRatio,
      cameraMotion,
      referenceAssets: assets,
      renderStatus: 'idle',
      renderProgress: 0,
      videoUrl: null,
      outputFilePath: null,
      chainFromPrevious: sceneConfig?.storyMode !== 'independent' && i > 0,
      startFramePath: null,
      startFramePreviewUrl: null,
    })
  }

  return clips
}

/** @deprecated Dùng buildClipPlans. Giữ alias để đọc project/workflow cũ. */
export const buildScenePlan = buildClipPlans

/**
 * Tiện ích legacy cho Scene Builder. Không dùng trong luồng GPT -> Flow chính.
 */
export function splitScriptToScenes(params: {
  script: SalesScript
  sceneConfig?: Partial<ScenePlanConfig>
  assets?: AssetRef[]
}): ScenePlan[] {
  const { script, sceneConfig, assets = [] } = params
  const durations = sceneConfig?.durations ?? [4, 6, 4]
  const aspectRatio = sceneConfig?.aspectRatio ?? '9:16'

  const duration1 = Math.min(10, Math.max(1, durations[0] || 4))
  const duration2 = Math.min(10, Math.max(1, durations[1] || 6))
  const duration3 = Math.min(10, Math.max(1, durations[2] || 4))

  let scene1Prompt = ''
  let scene2Prompt = ''
  let scene3Prompt = ''

  const scriptVisual = script.visualDirection || (script as any).visual_direction
  const scriptVoice = script.voiceover || (script as any).voice_over
  const scriptOnScreen = script.onScreenText || (script as any).on_screen_text

  if (script.hook || script.problem || script.product || script.benefits || script.cta) {
    scene1Prompt = [
      scriptVisual ? `Hình ảnh mở đầu: ${scriptVisual}` : '',
      script.hook ? `Hook: ${script.hook}` : '',
      script.problem ? `Vấn đề: ${script.problem}` : '',
    ].filter(Boolean).join('\n\n')

    scene2Prompt = [
      scriptVisual ? `Hình ảnh cận cảnh: ${scriptVisual}` : '',
      script.product ? `Sản phẩm: ${script.product}` : '',
      script.benefits ? `Lợi ích: ${script.benefits}` : '',
    ].filter(Boolean).join('\n\n')

    scene3Prompt = [
      script.cta ? `Kêu gọi hành động (CTA): ${script.cta}` : '',
    ].filter(Boolean).join('\n\n')
  } else {
    const visual = scriptVisual ? `Hình ảnh: ${scriptVisual}\n` : ''
    const fullText = scriptVoice || script.content || ''
    const paras = fullText.split(/\n\s*\n/).map((p: string) => p.trim()).filter(Boolean)
    if (paras.length >= 3) {
      scene1Prompt = `${visual}Mở đầu: ${paras[0]}`
      scene2Prompt = `${visual}Nội dung chính: ${paras.slice(1, -1).join('\n\n')}`
      scene3Prompt = `${visual}Kết thúc & CTA: ${paras[paras.length - 1]}`
    } else {
      scene1Prompt = `${visual}Phân đoạn 1 - Hook & Khởi đầu:\n${fullText}`
      scene2Prompt = `${visual}Phân đoạn 2 - Chi tiết sản phẩm & Trải nghiệm:\n${fullText}`
      scene3Prompt = `${visual}Phân đoạn 3 - Chốt deal & Kêu gọi hành động:\n${script.cta || fullText}`
    }
  }

  return [
    {
      sceneNumber: 1,
      title: `Cảnh 1: Mở đầu (${script.title || script.angle})`,
      prompt: scene1Prompt || getFullScriptContent(script),
      durationSec: duration1,
      aspectRatio,
      cameraMotion: 'Cận cảnh chi tiết',
      referenceAssets: assets,
      renderStatus: 'idle',
      renderProgress: 0,
      videoUrl: null,
      outputFilePath: null,
    },
    {
      sceneNumber: 2,
      title: `Cảnh 2: Trải nghiệm & Điểm nổi bật`,
      prompt: scene2Prompt || getFullScriptContent(script),
      durationSec: duration2,
      aspectRatio,
      cameraMotion: 'Tracking Shot',
      referenceAssets: assets,
      renderStatus: 'idle',
      renderProgress: 0,
      videoUrl: null,
      outputFilePath: null,
    },
    {
      sceneNumber: 3,
      title: `Cảnh 3: Chốt hành động (CTA)`,
      prompt: scene3Prompt || getFullScriptContent(script),
      durationSec: duration3,
      aspectRatio,
      cameraMotion: 'Slow Push In',
      referenceAssets: assets,
      renderStatus: 'idle',
      renderProgress: 0,
      videoUrl: null,
      outputFilePath: null,
    },
  ]
}
