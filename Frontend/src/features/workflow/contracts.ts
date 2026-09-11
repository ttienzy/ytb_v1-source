/**
 * Shared Data Contracts cho toàn bộ hệ thống AI Workflow
 * Định nghĩa các dữ liệu trung gian chuẩn hóa trao đổi giữa các Node và Service.
 */

export interface AssetRef {
  id: string
  kind: 'product' | 'model' | 'scene'
  previewUrl: string
  backendPath?: string
  fileName?: string
  uploadStatus: 'idle' | 'uploading' | 'uploaded' | 'error'
  error?: string
}

export interface AssetBundle {
  products: AssetRef[]
  model?: AssetRef | null
  scene?: AssetRef | null
  characterProfile?: string
  sceneProfile?: string
}

export interface ProductClassificationItem {
  name: string
  colorVariant?: string
  mainIngredients?: string
  coreBenefits?: string
  experienceScent?: string
}

export interface ProductAnalysis {
  rawText: string
  features: string[]
  sellingPoints: string[]
  productFeatures?: string
  keySellingPoints?: string[]
  suggestedAngles: string[]
  classifications?: ProductClassificationItem[]
  modelAttributes?: string
  sceneVibe?: string
  providerUsed?: 'gemini' | '9router'
}

export interface ScriptGenerationConfig {
  count: number
  contentMode: 'sales' | 'review' | 'ugc' | 'lifestyle' | 'tutorial' | 'comparison' | 'unboxing'
  /** sequential = phễu liên hoàn; independent = các clip độc lập */
  storyMode?: 'sequential' | 'independent'
  /** Thời lượng của một clip Google Flow mà mỗi kịch bản sẽ tạo ra. */
  clipDurationSeconds?: number
  minWords?: number
  maxWords?: number
  platform?: 'tiktok' | 'reels' | 'shorts' | 'auto'
  /** ID giọng đọc VieNeu-TTS cho Brand Voice */
  voiceId?: string
  /** Mô tả nhân vật tham chiếu bằng tiếng Anh (Canonical Character Profile) */
  characterProfile?: string
  /** Mô tả bối cảnh/không gian bằng tiếng Anh (Canonical Scene Profile) */
  sceneProfile?: string
}

export interface SalesScript {
  id?: string
  /** Giai đoạn phễu: Hook | Reveal | Demo | CTA */
  phase?: string
  angle: string
  title: string
  content: string
  voiceover?: string
  visualDirection?: string
  onScreenText?: string
  hook?: string
  problem?: string
  product?: string
  benefits?: string
  cta?: string
  wordCount?: number
  word_count?: number
}

export interface ScriptCollection {
  requestedCount: number
  actualCount: number
  items: SalesScript[]
  contentMode: string
  platform: string
  clipDurationSeconds: number
  minWords: number
  maxWords: number
  repaired: boolean
  promptTemplate: string
  requestedModel: string
  generationModel?: string
  storyMode?: string
  voiceId?: string
}

export interface ScenePlanConfig {
  count: number
  durations: number[]
  aspectRatio: '9:16' | '16:9' | '1:1'
  cameraStyles?: string[]
}

export interface ScenePlan {
  sceneNumber: number
  title: string
  prompt: string
  durationSec: number
  aspectRatio: '9:16' | '16:9' | '1:1'
  cameraMotion?: string
  referenceAssets: AssetRef[]
  videoUrl?: string | null
  outputFilePath?: string | null
  thumbnailUrl?: string | null
  startFramePath?: string | null
  startFramePreviewUrl?: string | null
  jobId?: string | null
  renderStatus?: 'idle' | 'queued' | 'submitting' | 'generating' | 'done' | 'error'
  renderProgress?: number
  errorMessage?: string | null
}

export interface WorkflowExportRequest {
  sceneVideoPaths: string[]
  bgmPath?: string
  /** Đường dẫn file voiceover VieNeu-TTS (đè lên audio Veo) */
  voiceoverAudioPath?: string
  /** True = trộn ambient Veo (volume 0.15) + VO; False = chỉ VO */
  mixOriginalAudio?: boolean
  resolution?: string
}

export interface WorkflowExportResponse {
  jobId: string
  finalVideoUrl: string
  filePath?: string
  durationSec: number
  status: 'done' | 'error'
  error?: string
}

export interface ExportedVideoItem {
  id: string
  filename: string
  videoUrl: string
  filePath: string
  sizeBytes: number
  durationSec: number
  createdAt: string
  sceneCount?: number
  aspectRatio?: string
  resolution?: string
  title?: string
  sourceType?: 'export' | 'veo_scene'
  prompt?: string
  modelDisplayName?: string
}
