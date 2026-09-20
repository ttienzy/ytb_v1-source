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
  /** Mô tả nhân vật tham chiếu bằng tiếng Anh (Canonical Character Profile) */
  characterProfile?: string
  /** Mô tả bối cảnh/không gian bằng tiếng Anh (Canonical Scene Profile) */
  sceneProfile?: string
  /** Đang trích xuất profile từ ảnh bằng AI */
  isExtractingProfile?: boolean
  isStartNode?: boolean
  isOrphan?: boolean
  onChange?: (key: 'modelImage' | 'sceneImage', value: string | null, asset?: AssetRef | null) => void
  onChangeProfile?: (key: 'characterProfile' | 'sceneProfile', value: string) => void
  onAutoExtractProfile?: () => void
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
  providerUsed?: 'gemini' | '9router'
  isRefreshingCookie?: boolean
  cookieValid?: boolean
  onAnalyze?: () => void
  onRefreshCookie?: () => void
  onAnalyze9Router?: () => void
  onChangePrompt?: (prompt: string) => void
  onResetPrompt?: () => void
  onSetStartNode?: () => void
  onDelete?: () => void
}



export interface GeneratedSceneItem {
  voiceover?: string
  jobId?: string | null
  errorMessage?: string | null
  sceneNumber: number
  title: string
  prompt: string
  durationSec: number // Tên field legacy; đại diện thời lượng của một clip Flow.
  aspectRatio: '9:16' | '16:9' | '1:1'
  cameraMotion?: string
  isRendering?: boolean
  renderProgress?: number
  renderStep?: string | null
  videoUrl?: string | null
  outputFilePath?: string | null
  thumbnailUrl?: string | null
  startFramePath?: string | null
  startFramePreviewUrl?: string | null
  chainFromPrevious?: boolean
  isExtractingFrame?: boolean
  renderStatus?: 'idle' | 'queued' | 'captcha' | 'submitting' | 'generating' | 'downloading' | 'done' | 'error'
  refImages?: {
    productUrl?: string | null
    modelUrl?: string | null
    sceneUrl?: string | null
  }
}

export interface GptSalesScriptItem {
  id?: string
  /** Giai đoạn phễu: Hook | Reveal | Demo | CTA */
  phase?: string
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
  // Audio settings — Voice (VieNeu-TTS)
  voiceEnabled?: boolean       // Tự động tạo voiceover khi ghép
  voiceId?: string             // ID giọng VieNeu-TTS (e.g. 'bf4bed06c671')
  // Audio settings — BGM
  bgmEnabled?: boolean         // Thêm nhạc nền khi ghép
  bgmTrackIds?: string[]       // Danh sách BGM track IDs đã chọn
  bgmVolume?: number           // Volume BGM (0.05 - 0.30, default 0.10)
  // Audio settings — Veo Ambient
  keepVeoAmbient?: boolean     // Giữ SFX/ambient sound từ Veo clips
  veoAmbientVolume?: number    // Volume ambient Veo (0.0 - 0.20, default 0.10)
}

export interface PromptPresetItem {
  id: string
  name: string
  content_mode: string
  prompt: string
  description?: string
  is_system: boolean
  updated_at?: string
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
  contentMode?: 'sales' | 'review' | 'ugc' | 'lifestyle' | 'tutorial' | 'comparison' | 'unboxing' | string
  platform?: 'tiktok' | 'reels' | 'shorts' | 'auto'
  /** sequential = phễu liên hoàn; independent = clip độc lập */
  storyMode?: 'sequential' | 'independent'
  /** ID giọng đọc VieNeu-TTS cho Brand Voice (legacy) */
  voiceId?: string
  clipDurationSeconds?: number
  scenes?: GeneratedSceneItem[]
  selectedPresetId?: string
  availablePresets?: PromptPresetItem[]
  onGenerate?: () => void
  onChangePrompt?: (val: string) => void
  onResetPrompt?: () => void
  onSelectScript?: (index: number) => void
  onSelectPreset?: (presetId: string) => void
  onSaveAsNewPreset?: (name: string, contentMode: string, prompt: string) => Promise<void> | void
  onUpdatePreset?: (presetId: string, prompt: string) => Promise<void> | void
  onDeletePreset?: (presetId: string) => Promise<void> | void
  onChangeScriptConfig?: (cfg: {
    count?: number
    contentMode?: 'sales' | 'review' | 'ugc' | 'lifestyle' | 'tutorial' | 'comparison' | 'unboxing' | string
    platform?: 'tiktok' | 'reels' | 'shorts' | 'auto'
    storyMode?: 'sequential' | 'independent'
    voiceId?: string
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
  scriptSourceStale?: boolean
  selectedGptScriptAngle?: string
  availableGptScripts?: GptSalesScriptItem[]
  refImages?: {
    productUrls?: (string | null)[]
    modelUrl?: string | null
    sceneUrl?: string | null
  }
  exportedCount?: number
  voiceId?: string
  voiceoverUrl?: string | null
  voiceoverFilePath?: string | null
  voiceoverDurationSec?: number
  voiceoverSignature?: string | null
  isGeneratingVoiceover?: boolean
  mixOriginalAudio?: boolean
  onOpenVeoSetup?: () => void
  onApplyGptScript?: (scriptIndex: number) => void
  onApplyAllGptScripts?: () => void
  onSelectScene?: (index: number) => void
  onUpdateScenePrompt?: (index: number, prompt: string) => void
  onUpdateSceneDuration?: (index: number, duration: number) => void
  onUpdateSceneMotion?: (index: number, motion: string) => void
  onRenderScene?: (index: number) => void
  onRenderAllScenes?: () => void
  onExtractLastFrame?: (sourceSceneIndex: number) => void
  onToggleChainFrames?: (sceneIndex: number, enabled: boolean) => void
  onGenerateVoiceover?: () => void
  onToggleMixAudio?: (mix: boolean) => void
  onExportVideo?: () => void
  onOpenPreviewModal?: (videoUrl: string, title?: string, prompt?: string) => void
  onOpenLibrary?: () => void
  onOpenVideoPicker?: (sceneIndex: number) => void
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

// -------------------------------------------------------------
// Multi-Workflow Navigation Tabs
// -------------------------------------------------------------
export type WorkflowTabId = 'chaining' | 'motion' | (string & {})

export interface WorkflowTabItem {
  id: WorkflowTabId
  title: string
  shortTitle?: string
  badge?: string
  badgeType?: 'new' | 'pro' | 'beta' | 'count'
  iconName: 'film' | 'crosshair' | 'sparkles' | 'layers'
  description: string
}

export const DEFAULT_WORKFLOW_TABS: WorkflowTabItem[] = [
  {
    id: 'chaining',
    title: 'Kịch Bản Liên Hoàn',
    shortTitle: 'Multi-Clip',
    badge: 'Multi-Clip',
    badgeType: 'count',
    iconName: 'film',
    description: 'Quy trình tự động hóa: Phân tích ảnh, tạo kịch bản bán hàng và kết nối chuỗi phân cảnh liên hoàn với Veo AI',
  },
  {
    id: 'motion',
    title: 'Motion Control',
    shortTitle: 'Motion',
    badge: 'MỚI',
    badgeType: 'new',
    iconName: 'crosshair',
    description: 'Video tham chiếu & điều khiển chuyển động: Chuyển giao động tác mẫu từ video sang nhân vật và góc máy mới',
  },
]

// -------------------------------------------------------------
// Motion Control Workflow Types (Google Flow Ingredient Model)
// -------------------------------------------------------------
export interface MotionReferenceAsset {
  id: string
  role: 'character' | 'motion' | 'scene'
  title: string
  required?: boolean
  filled: boolean
  previewUrl: string | null
  fileName: string
  file?: File
  mediaId?: string
  mediaProjectId?: string
  backendPath?: string
  trimStartSec?: number
  trimEndSec?: number
}

export interface MotionCreativeDirection {
  creativeBrief: string
  subjectAction: string
  cameraMovement: string
  sceneAtmosphere: string
  styleDirection: string
  negativePrompt: string
}

export interface MotionPresetItem {
  id: string
  name: string
  description: string
  icon?: string
  creative_brief: string
  subject_action: string
  camera_movement: string
  scene_atmosphere: string
  style_direction: string
  negative_prompt: string
  is_default?: boolean
}

export interface MotionOutputConfig {
  profileId?: string
  modelDisplayName?: string
  aspectRatio: '9:16' | '16:9'
  durationSeconds: number
  resolution: '360p' | '720p'
  numOutputs: number
  creditCost?: number
  projectMode?: 'new_per_run' | 'selected'
  projectNamePrefix?: string
  freshAssets?: boolean
  showReferenceComparison?: boolean
  activePresetId?: string
}

export type MotionRunStage =
  | 'preflight'
  | 'connection'
  | 'authentication'
  | 'project'
  | 'reference_upload'
  | 'image_upload'
  | 'submission'
  | 'captcha'
  | 'generation'
  | 'download'
  | 'backend'
  | 'unknown'

export interface MotionRunError {
  code: string
  stage: MotionRunStage
  stageLabel: string
  title: string
  message: string
  hint: string
  retryable: boolean
  jobId?: string
}

export interface MotionVariantSlot {
  index: number
  jobId?: string
  status: 'idle' | 'submitting' | 'generating' | 'done' | 'error'
  progressText?: string
  videoUrl?: string | null
  error?: MotionRunError | null
}

export interface MotionWorkflowDraft {
  references: {
    character: MotionReferenceAsset
    motion: MotionReferenceAsset
    scene: MotionReferenceAsset
  }
  creative: MotionCreativeDirection
  output: MotionOutputConfig
  finalPrompt: string
  isCustomPromptEdited: boolean
}
