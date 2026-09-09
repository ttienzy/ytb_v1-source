/**
 * Pure Mapper: Chuyển đổi SalesScript từ ChatGPT sang ScenePlan cho Veo Flow Studio.
 * 
 * NGUYÊN TẮC:
 * - Hàm thuần (Pure function), không side effect.
 * - Dynamic config: Số lượng scene và durations lấy từ sceneConfig, không hardcode.
 * - Giữ trọn vẹn nội dung text prompt không cắt bớt.
 */

import type { AssetRef, SalesScript, ScenePlan, ScenePlanConfig } from '../contracts'

export const DEFAULT_SCENE_CONFIG: ScenePlanConfig = {
  count: 3,
  durations: [4, 8, 4],
  aspectRatio: '9:16',
  cameraStyles: ['Cận cảnh chất liệu & Chi tiết', 'Tracking Shot chuyển động', 'Slow Push In chốt CTA'],
}

/**
 * Lấy toàn bộ nội dung text của 1 kịch bản, ưu tiên visualDirection cho Veo
 */
export function getFullScriptContent(s?: SalesScript): string {
  if (!s) return ''
  const visual = s.visualDirection || (s as any).visual_direction
  const voice = s.voiceover || (s as any).voice_over
  const onScreen = s.onScreenText || (s as any).on_screen_text

  const parts: string[] = []
  if (visual) {
    parts.push(`Hình ảnh: ${visual}`)
  }
  if (voice) {
    parts.push(`Lời thoại: ${voice}`)
  }
  if (onScreen) {
    parts.push(`Chữ trên màn hình: ${onScreen}`)
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
 * Map danh sách kịch bản (mỗi kịch bản tương ứng 1 phân cảnh)
 */
export function buildScenePlan(params: {
  scripts: SalesScript[]
  sceneConfig?: Partial<ScenePlanConfig>
  assets?: AssetRef[]
}): ScenePlan[] {
  const { scripts, sceneConfig, assets = [] } = params
  const count = sceneConfig?.count ?? (scripts.length > 0 ? scripts.length : DEFAULT_SCENE_CONFIG.count)

  if (scripts.length < count) {
    throw new Error(
      `Không đủ số lượng kịch bản để tạo ${count} phân cảnh (nhận được ${scripts.length}/${count} kịch bản). Vui lòng tạo lại kịch bản.`
    )
  }

  const durations = sceneConfig?.durations ?? DEFAULT_SCENE_CONFIG.durations
  const aspectRatio = sceneConfig?.aspectRatio ?? DEFAULT_SCENE_CONFIG.aspectRatio
  const cameraStyles = sceneConfig?.cameraStyles ?? DEFAULT_SCENE_CONFIG.cameraStyles ?? []

  const scenes: ScenePlan[] = []

  for (let i = 0; i < count; i++) {
    const script = scripts[i]
    const rawDuration = durations[i] !== undefined ? durations[i] : (durations[0] || 4)
    const durationSec = Math.min(10, Math.max(1, rawDuration))
    const cameraMotion = cameraStyles[i] || 'Cận cảnh chi tiết'

    const title = script?.title
      ? `Cảnh ${i + 1}: ${script.title}`
      : script?.angle
      ? `Cảnh ${i + 1}: ${script.angle}`
      : `Phân cảnh #${i + 1}`

    const prompt = getFullScriptContent(script)

    scenes.push({
      sceneNumber: i + 1,
      title,
      prompt,
      durationSec,
      aspectRatio,
      cameraMotion,
      referenceAssets: assets,
      renderStatus: 'idle',
      renderProgress: 0,
      videoUrl: null,
      outputFilePath: null,
    })
  }

  return scenes
}

/**
 * Phân rã 1 kịch bản duy nhất thành 3 phân cảnh (Mở đầu -> Điểm nổi bật -> CTA)
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
      scriptOnScreen ? `Chữ trên màn hình: ${scriptOnScreen}` : '',
    ].filter(Boolean).join('\n\n')
  } else {
    const visual = scriptVisual ? `Hình ảnh: ${scriptVisual}\n` : ''
    const fullText = scriptVoice || script.content || ''
    const paras = fullText.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean)
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
