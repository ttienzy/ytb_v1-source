/**
 * Workflow API Client Service
 * Gọi trực tiếp các endpoint backend chuẩn hóa: Asset Upload, Gemini, GPT, và FFmpeg Export.
 */

import { API_URL } from '../../../shared/constants'
import type {
  AssetBundle,
  AssetRef,
  ProductAnalysis,
  SalesScript,
  ScenePlanConfig,
  ScriptGenerationConfig,
  ScriptCollection,
  WorkflowExportResponse,
  ExportedVideoItem,
} from '../contracts'
import { DEFAULT_CLIP_DURATION_SECONDS } from './buildScenePlan'

/**
 * Upload file ảnh (Sản phẩm / Mẫu / Bối cảnh) lên backend để lưu file thật
 */
export async function uploadWorkflowAsset(
  file: File,
  kind: 'product' | 'model' | 'scene' = 'product'
): Promise<AssetRef> {
  const formData = new FormData()
  formData.append('file', file)
  formData.append('kind', kind)

  const res = await fetch(`${API_URL}/api/workflow/assets/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Upload asset thất bại (HTTP ${res.status})`)
  }

  const data = await res.json()
  return {
    id: data.id,
    kind: data.kind as any,
    previewUrl: `${API_URL}${data.preview_url}`,
    backendPath: data.backend_path,
    fileName: data.file_name,
    uploadStatus: 'uploaded',
  }
}

/**
 * Lấy prompt Gemini mặc định từ backend
 */
export async function fetchGeminiDefaultPrompt(): Promise<string> {
  const res = await fetch(`${API_URL}/api/workflow/prompts/gemini`)
  if (!res.ok) return ''
  const data = await res.json()
  return data.prompt || ''
}

/**
 * Lấy prompt GPT mặc định từ backend
 */
export async function fetchGptDefaultPrompt(): Promise<string> {
  const res = await fetch(`${API_URL}/api/workflow/prompts/gpt`)
  if (!res.ok) return ''
  const data = await res.json()
  return data.prompt || ''
}

/**
 * Gọi Gemini Web hoặc 9Router Vision phân tích sản phẩm từ danh sách ảnh và prompt
 */
export async function callGeminiAnalysis(
  images: string[],
  prompt?: string,
  provider: 'gemini' | '9router' = 'gemini',
): Promise<ProductAnalysis> {
  const res = await fetch(`${API_URL}/api/workflow/gemini/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      images,
      prompt,
      provider,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Lỗi phân tích ${provider} (HTTP ${res.status})`)
  }

  const data = await res.json()
  const classifications = (data.classifications || []).map((c: any) => ({
    name: c.name || '',
    colorVariant: c.color_variant || c.colorVariant || '',
    mainIngredients: c.main_ingredients || c.mainIngredients || '',
    coreBenefits: c.core_benefits || c.coreBenefits || '',
    experienceScent: c.experience_scent || c.experienceScent || '',
  }))

  const featureList = data.features || []
  const uspList = data.key_selling_points || data.selling_points || []
  const productFeaturesText = data.product_features || featureList.join('; ') || data.raw_text || ''

  return {
    rawText: data.raw_text || '',
    productFeatures: productFeaturesText,
    features: featureList.length > 0 ? featureList : (productFeaturesText ? [productFeaturesText] : []),
    sellingPoints: uspList,
    keySellingPoints: uspList,
    suggestedAngles: data.suggested_angles || [],
    classifications,
    modelAttributes: data.model_attributes || data.modelAttributes,
    sceneVibe: data.scene_vibe || data.sceneVibe,
    providerUsed: data.provider_used || provider,
  }
}

/**
 * Tự động làm mới cookie Gemini qua Chrome ngầm (3-5 giây)
 */
export async function callRefreshGeminiCookie(): Promise<{ ok: boolean; cookie_count: number }> {
  const res = await fetch(`${API_URL}/api/workflow/gemini/refresh-cookie`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Lỗi làm mới cookie (HTTP ${res.status})`)
  }
  return res.json()
}

/**
 * Kiểm tra trạng thái cookie Gemini
 */
export async function callCheckGeminiCookieStatus(): Promise<{ valid: boolean; error?: string }> {
  const res = await fetch(`${API_URL}/api/workflow/gemini/cookie-status`)
  if (!res.ok) {
    return { valid: false, error: `HTTP ${res.status}` }
  }
  return res.json()
}

/**
 * Gọi ChatGPT sinh số lượng kịch bản động từ payload có cấu trúc.
 * Mỗi kịch bản tương ứng với một clip Google Flow độc lập.
 */
export async function callGptScriptGeneration(params: {
  productData?: string
  images?: string[]
  productAnalysis?: ProductAnalysis
  assets?: AssetBundle
  sceneConfig?: ScenePlanConfig
  scriptConfig?: ScriptGenerationConfig
  promptTemplate?: string
  model?: string
}): Promise<{ scripts: SalesScript[]; rawText: string; model: string; collection: ScriptCollection }> {
  const res = await fetch(`${API_URL}/api/workflow/gpt/generate-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      product_data: params.productData || '',
      images: params.images || [],
      product_analysis: params.productAnalysis,
      assets: params.assets,
      scene_config: params.sceneConfig,
      script_config: params.scriptConfig
        ? {
            count: params.scriptConfig.count,
            content_mode: params.scriptConfig.contentMode,
            story_mode: params.scriptConfig.storyMode,
            voice_id: params.scriptConfig.voiceId,
            character_profile: params.scriptConfig.characterProfile,
            scene_profile: params.scriptConfig.sceneProfile,
            clip_duration_seconds: params.scriptConfig.clipDurationSeconds,
            min_words: params.scriptConfig.minWords,
            max_words: params.scriptConfig.maxWords,
            platform: params.scriptConfig.platform,
          }
        : undefined,
      prompt_template: params.promptTemplate,
      model: params.model || 'cx/gpt-5.5',
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Lỗi tạo kịch bản GPT (HTTP ${res.status})`)
  }

  const data = await res.json()
  const rawScripts = (data.scripts || []) as any[]
  const normalizedScripts: SalesScript[] = rawScripts.map((s: any) => ({
    id: s.id,
    phase: s.phase,
    angle: s.angle || '',
    title: s.title || '',
    content: s.content || s.voiceover || s.voice_over || '',
    voiceover: s.voiceover || s.voice_over,
    visualDirection: s.visualDirection || s.visual_direction,
    onScreenText: s.onScreenText || s.on_screen_text,
    hook: s.hook,
    problem: s.problem,
    product: s.product,
    benefits: s.benefits,
    cta: s.cta,
    wordCount: s.wordCount ?? s.word_count ?? 0,
    word_count: s.wordCount ?? s.word_count ?? 0,
  }))

  return {
    scripts: normalizedScripts,
    rawText: data.raw_text || '',
    model: data.model || '',
    collection: {
      requestedCount: data.requested_count ?? params.scriptConfig?.count ?? normalizedScripts.length,
      actualCount: data.actual_count ?? normalizedScripts.length,
      items: normalizedScripts,
      contentMode: params.scriptConfig?.contentMode || 'sales',
      platform: params.scriptConfig?.platform || 'auto',
      clipDurationSeconds: data.clip_duration_seconds ?? params.scriptConfig?.clipDurationSeconds ?? DEFAULT_CLIP_DURATION_SECONDS,
      minWords: data.min_words ?? params.scriptConfig?.minWords ?? 0,
      maxWords: data.max_words ?? params.scriptConfig?.maxWords ?? 0,
      repaired: Boolean(data.repaired),
      promptTemplate: params.promptTemplate || '',
      requestedModel: params.model || 'cx/gpt-5.5',
      generationModel: data.model || '',
    },
  }
}

/**
 * Trích xuất Canonical Character Profile & Scene Profile tiếng Anh bằng AI từ ảnh người mẫu / bối cảnh
 */
export async function callExtractProfiles(params: {
  modelImage?: string | null
  sceneImage?: string | null
  model?: string
}): Promise<{ characterProfile: string; sceneProfile: string }> {
  const res = await fetch(`${API_URL}/api/workflow/extract-profiles`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model_image: params.modelImage || null,
      scene_image: params.sceneImage || null,
      model: params.model,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Lỗi trích xuất profile bằng AI (HTTP ${res.status})`)
  }

  const data = await res.json()
  return {
    characterProfile: data.character_profile || '',
    sceneProfile: data.scene_profile || '',
  }
}

/**
 * Gọi VieNeu-TTS sinh file âm thanh đọc lời thoại voiceover
 */
export async function callGenerateVoiceover(params: {
  voiceId: string
  scripts: string[]
  combineAll?: boolean
}): Promise<{
  voiceId: string
  items: { index: number; text: string; audioUrl: string; filePath: string; durationSec: number }[]
  combinedAudioUrl?: string | null
  combinedFilePath?: string | null
  totalDurationSec: number
}> {
  const res = await fetch(`${API_URL}/api/workflow/generate-voiceover`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      voice_id: params.voiceId,
      scripts: params.scripts,
      combine_all: params.combineAll ?? true,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Lỗi tạo voiceover TTS (HTTP ${res.status})`)
  }

  const data = await res.json()
  return {
    voiceId: data.voice_id,
    items: (data.items || []).map((it: any) => ({
      index: it.index,
      text: it.text,
      audioUrl: it.audio_url?.startsWith('http') ? it.audio_url : `${API_URL}${it.audio_url}`,
      filePath: it.file_path,
      durationSec: it.duration_sec,
    })),
    combinedAudioUrl: data.combined_audio_url
      ? (data.combined_audio_url.startsWith('http') ? data.combined_audio_url : `${API_URL}${data.combined_audio_url}`)
      : null,
    combinedFilePath: data.combined_file_path || null,
    totalDurationSec: data.total_duration_sec || 0,
  }
}

/**
 * Gọi backend ghép các file video phân cảnh bằng FFmpeg
 */
export async function callWorkflowVideoExport(
  sceneVideoPaths: string[],
  bgmPath?: string,
  outputFilename?: string,
  voiceoverAudioPath?: string,
  mixOriginalAudio?: boolean,
  bgmTrackIds?: string[],
  bgmVolume?: number,
  veoAmbientVolume?: number
): Promise<WorkflowExportResponse> {
  const res = await fetch(`${API_URL}/api/workflow/export`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      scene_video_paths: sceneVideoPaths,
      bgm_path: bgmPath,
      output_filename: outputFilename,
      voiceover_audio_path: voiceoverAudioPath,
      mix_original_audio: mixOriginalAudio ?? true,
      bgm_track_ids: bgmTrackIds && bgmTrackIds.length > 0 ? bgmTrackIds : undefined,
      bgm_volume: bgmVolume ?? 0.10,
      veo_ambient_volume: veoAmbientVolume ?? 0.10,
    }),
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.detail || `Lỗi xuất ghép video FFmpeg (HTTP ${res.status})`)
  }

  const data = await res.json()
  return {
    ...data,
    finalVideoUrl: data.final_video_url?.startsWith('http')
      ? data.final_video_url
      : `${API_URL}${data.final_video_url}`,
  }
}

/**
 * Lấy danh sách video đã xuất trong thư viện
 */
export async function fetchExportedVideos(): Promise<ExportedVideoItem[]> {
  try {
    const res = await fetch(`${API_URL}/api/workflow/exports`)
    if (!res.ok) return []
    const data = await res.json()
    const rawItems = data.items || []
    return rawItems.map((item: any) => ({
      id: item.id,
      filename: item.filename,
      videoUrl: item.video_url?.startsWith('http') ? item.video_url : `${API_URL}${item.video_url}`,
      filePath: item.file_path,
      sizeBytes: item.size_bytes || 0,
      durationSec: item.duration_sec || 0,
      createdAt: item.created_at,
      sceneCount: item.scene_count,
      aspectRatio: item.aspect_ratio || '9:16',
      resolution: item.resolution || '1080p',
      title: item.title || item.filename,
      sourceType: item.source_type || 'export',
      prompt: item.prompt || '',
      modelDisplayName: item.model_display_name || '',
    }))
  } catch (err) {
    console.warn('Lỗi khi lấy danh sách video đã xuất:', err)
    return []
  }
}

/**
 * Xóa video đã xuất khỏi thư viện
 */
export async function deleteExportedVideo(filename: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/workflow/exports/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    })
    return res.ok
  } catch (err) {
    console.error('Lỗi khi xóa video đã xuất:', err)
    return false
  }
}

/**
 * Mở thư mục chứa video trên máy tính (Windows Explorer)
 */
export async function openExportFolder(filename: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_URL}/api/workflow/exports/${encodeURIComponent(filename)}/open-folder`, {
      method: 'POST',
    })
    return res.ok
  } catch (err) {
    console.error('Lỗi khi mở thư mục video:', err)
    return false
  }
}
