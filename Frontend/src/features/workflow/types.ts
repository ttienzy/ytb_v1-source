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
  onChangeImage?: (index: number, url: string | null) => void
  onDelete?: () => void
}

export interface CharacterSceneNodeData {
  title?: string
  modelImage?: string | null
  sceneImage?: string | null
  onChange?: (key: 'modelImage' | 'sceneImage', value: string | null) => void
  onDelete?: () => void
}

export interface AssetInputNodeData {
  productImage?: string | null
  modelImage?: string | null
  sceneImage?: string | null
  productName?: string
  onChange?: (key: 'productImage' | 'modelImage' | 'sceneImage' | 'productName', value: string | null) => void
  onDelete?: () => void
}

export interface GeminiAnalysisResult {
  productFeatures: string
  modelAttributes?: string
  sceneVibe?: string
  keySellingPoints: string[]
  suggestedAngles: string[]
}

export interface GeminiAnalysisNodeData {
  title: string
  model: string // e.g. 'gemini-2.5-flash'
  provider: string // 'Google Gemini 2.5'
  isAnalyzing?: boolean
  analysisResult?: GeminiAnalysisResult | null
  onAnalyze?: () => void
  onDelete?: () => void
}

export interface GeneratedSceneItem {
  sceneNumber: number
  title: string
  prompt: string
  durationSec: number // 4s, 5s, 8s
  aspectRatio: '9:16' | '16:9' | '1:1'
  cameraMotion?: string
  isRendering?: boolean
  renderProgress?: number
  videoUrl?: string | null
  thumbnailUrl?: string | null
  refImages?: {
    productUrl?: string | null
    modelUrl?: string | null
    sceneUrl?: string | null
  }
}

export interface GptScriptNodeData {
  title: string
  prompt: string
  model: string // e.g. 'cx/gpt-5.5'
  provider: string // '9Router (Local)'
  totalScenes: number
  targetDuration: number // total seconds, e.g. 15
  isGenerating?: boolean
  scenes: GeneratedSceneItem[]
  onGenerate?: () => void
  onChangePrompt?: (val: string) => void
  onAddScene?: () => void
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
  finalVideoUrl?: string | null
  refImages?: {
    productUrls?: (string | null)[]
    modelUrl?: string | null
    sceneUrl?: string | null
  }
  onSelectScene?: (index: number) => void
  onUpdateScenePrompt?: (index: number, prompt: string) => void
  onUpdateSceneDuration?: (index: number, duration: number) => void
  onUpdateSceneMotion?: (index: number, motion: string) => void
  onRenderScene?: (index: number) => void
  onExportVideo?: () => void
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

