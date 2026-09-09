import type { AssetRef, ProductAnalysis, SalesScript, ScenePlan, ScenePlanConfig, ScriptCollection } from './contracts'

export type { AssetRef, AssetBundle, ProductAnalysis, SalesScript, ScenePlan, ScenePlanConfig, ScriptCollection } from './contracts'

export type WorkflowNodeType =
  | 'productAssets'
  | 'characterScene'
  | 'assetInput'
  | 'geminiAnalysis'
  | 'gptScript'
  | 'veoFlowStudio'
  | 'sceneVideo'
  | 'exportTimeline'

export interface AssetImageItem {
  id: string
  type: 'product' | 'model' | 'scene'
  label: string
  previewUrl: string | null
  fileName?: string
}

export interface ProductAssetsNodeData {
  title?: string
  productName?: string
  images: (string | null)[] // up to 3 images: [main, detail, angle]
  assets?: (AssetRef | null)[]
  isStartNode?: boolean
  isOrphan?: boolean
  onChangeImage?: (index: number, url: string | null, asset?: AssetRef | null) => void
  onSetStartNode?: () => void
  onDelete?: () => void
}

export interface CharacterSceneNodeData {
  title?: string
  modelImage?: string | null
  sceneImage?: string | null
  modelAsset?: AssetRef | null
  sceneAsset?: AssetRef | null
  isStartNode?: boolean
  isOrphan?: boolean
  onChange?: (key: 'modelImage' | 'sceneImage', value: string | null, asset?: AssetRef | null) => void
  onSetStartNode?: () => void
  onDelete?: () => void
}

export interface AssetInputNodeData {
  productImage?: string | null
  modelImage?: string | null
  sceneImage?: string | null
  productName?: string
  isStartNode?: boolean
  isOrphan?: boolean
  onChange?: (key: 'productImage' | 'modelImage' | 'sceneImage' | 'productName', value: string | null) => void
  onSetStartNode?: () => void
  onDelete?: () => void
}

export interface GeminiProductClassification {
  name: string
  colorVariant?: string
  mainIngredients?: string
  coreBenefits?: string
  experienceScent?: string
}

export interface GeminiAnalysisResult {
  productFeatures: string // Điểm 'ăn tiền' & yếu tố thu hút chung
  classifications?: GeminiProductClassification[] // Phân loại chi tiết từng sản phẩm
  modelAttributes?: string
  sceneVibe?: string
  keySellingPoints: string[]
  suggestedAngles: string[]
}

export interface GeminiAnalysisNodeData {
  title: string
  model: string // e.g. 'gemini-2.5-flash'
  provider: string // 'Google Gemini 2.5'
  prompt?: string
  connectedImages?: (string | null)[]
  isConnectedToImages?: boolean
  isAnalyzing?: boolean
  analysisError?: string | null
  isStartNode?: boolean
  isOrphan?: boolean
  analysisResult?: GeminiAnalysisResult | null
  onAnalyze?: () => void
  onChangePrompt?: (prompt: string) => void
  onResetPrompt?: () => void
  onSetStartNode?: () => void
  onDelete?: () => void
}



export interface GeneratedSceneItem {
  sceneNumber: number
  title: string
  prompt: string
  durationSec: number // Tên field legacy; đại diện thời lượng của một clip Flow.
  aspectRatio: '9:16' | '16:9' | '1:1'
  cameraMotion?: string
  isRendering?: boolean
  renderProgress?: number
  videoUrl?: string | null
  outputFilePath?: string | null
  thumbnailUrl?: string | null
  refImages?: {
    productUrl?: string | null
    modelUrl?: string | null
    sceneUrl?: string | null
  }
}

export interface GptSalesScriptItem {
  id?: string
  angle: string
  title?: string
  content: string
  voiceover?: string
  visualDirection?: string
  visual_direction?: string
  onScreenText?: string
  on_screen_text?: string
  hook?: string
  problem?: string
  product?: string
  benefits?: string
  cta?: string
  wordCount?: number
  word_count?: number
}

export interface VeoVideoConfig {
  model: string
  aspectRatio: '16:9' | '9:16'
  duration: number
  resolution: string
  variations: number
  creditCost?: number
}

export interface GptScriptNodeData {
  title: string
  prompt?: string
  model?: string // e.g. 'cx/gpt-5.5'
  provider?: string // '9Router (Local)'
  connectedImages?: (string | null)[]
  isConnectedToImages?: boolean
  hasProductData?: boolean
  productDataPreview?: string
  isGenerating?: boolean
  scriptError?: string | null
  isStartNode?: boolean
  isOrphan?: boolean
  salesScripts?: GptSalesScriptItem[]
  scriptCollection?: ScriptCollection
  isScriptOutputStale?: boolean
  activeScriptIndex?: number
  requestedCount?: number
  contentMode?: 'sales' | 'review' | 'ugc' | 'lifestyle' | 'tutorial' | 'comparison' | 'unboxing'
  platform?: 'tiktok' | 'reels' | 'shorts' | 'auto'
  clipDurationSeconds?: number
  scenes?: GeneratedSceneItem[]
  onGenerate?: () => void
  onChangePrompt?: (val: string) => void
  onResetPrompt?: () => void
  onSelectScript?: (index: number) => void
  onChangeScriptConfig?: (cfg: {
    count?: number
    contentMode?: 'sales' | 'review' | 'ugc' | 'lifestyle' | 'tutorial' | 'comparison' | 'unboxing'
    platform?: 'tiktok' | 'reels' | 'shorts' | 'auto'
  }) => void
  onPushToVeo?: (scriptIndex: number) => void
  onPushAllToVeo?: () => void
  onPushSingleToVeo?: (scriptIndex: number) => void
  onSetStartNode?: () => void
  onDelete?: () => void
}

export interface VeoFlowStudioNodeData {
  title?: string
  model?: string // 'Google Veo 3.0'
  scenes: GeneratedSceneItem[]
  activeSceneIndex: number
  aspectRatio: '9:16' | '16:9' | '1:1'
  resolution: '1080p' | '4k' | '720p'
  isRendering?: boolean
  renderProgress?: number
  isExporting?: boolean
  exportProgress?: number
  isStartNode?: boolean
  isOrphan?: boolean
  finalVideoUrl?: string | null
  activeProject?: {
    id: string
    name: string
    flow_project_id?: string
    clip_count?: number
  } | null
  videoConfig?: VeoVideoConfig
  durationOptions?: number[]
  isSourceScriptStale?: boolean
  selectedGptScriptAngle?: string
  availableGptScripts?: GptSalesScriptItem[]
  refImages?: {
    productUrls?: (string | null)[]
    modelUrl?: string | null
    sceneUrl?: string | null
  }
  onOpenVeoSetup?: () => void
  onApplyGptScript?: (scriptIndex: number) => void
  onApplyAllGptScripts?: () => void
  onSelectScene?: (index: number) => void
  onUpdateScenePrompt?: (index: number, prompt: string) => void
  onUpdateSceneDuration?: (index: number, duration: number) => void
  onUpdateSceneMotion?: (index: number, motion: string) => void
  onRenderScene?: (index: number) => void
  onExportVideo?: () => void
  onOpenPreviewModal?: (videoUrl: string, title?: string, prompt?: string) => void
  onOpenLibrary?: () => void
  onSetStartNode?: () => void
  onDelete?: () => void
}


export interface SceneVideoNodeData {
  sceneNumber: number
  title: string
  prompt: string
  durationSec: number
  aspectRatio: '9:16' | '16:9' | '1:1'
  cameraMotion: string
  isRendering?: boolean
  renderProgress?: number // 0 - 100
  videoUrl?: string | null
  thumbnailUrl?: string | null
  refImages: {
    productUrl?: string | null
    modelUrl?: string | null
    sceneUrl?: string | null
  }
  onPromptChange?: (val: string) => void
  onDurationChange?: (sec: number) => void
  onRender?: () => void
  onDelete?: () => void
}

export interface ExportTimelineNodeData {
  title: string
  resolution: '1080p' | '4k' | '720p'
  format: 'mp4'
  bgmTrack?: string
  voiceId?: string
  isExporting?: boolean
  exportProgress?: number
  finalVideoUrl?: string | null
  onExport?: () => void
  onDelete?: () => void
}

