/**
 * Veo Studio — TypeScript Types
 *
 * Mirrors Backend schemas. Model names & durations from Google Help docs.
 */

// ─── Enums ──────────────────────────────────────────────────────────────────

export type JobStatus =
  | 'pending'
  | 'captcha'
  | 'submitting'
  | 'generating'
  | 'downloading'
  | 'done'
  | 'error'

export type InputMode = 'text_to_video' | 'frames' | 'ingredients' | 'extend'
export type AspectRatio = '16:9' | '9:16'

// ─── Model Info ─────────────────────────────────────────────────────────────

export interface VeoModelInfo {
  display_name: string
  provider: string
  provider_model_id: string | null
  group: string
  supported_modes: string[]
  supported_durations: number[]
  supported_resolutions: string[]
  extend_supported: boolean | null
  verified: boolean
}

export interface VeoCapabilityProfile {
  id: string
  model_display_name: string
  provider_model_id: string
  input_mode: InputMode
  aspect_ratio: AspectRatio
  duration_seconds: number
  resolution: string
  num_outputs: number
  credit_cost: number
  documented: boolean
  runtime_verified: boolean
  note: string
}

// ─── Projects ───────────────────────────────────────────────────────────────

export interface VeoProject {
  id: string
  name: string
  flow_project_id: string
  account_email: string
  is_active: boolean
  video_count: number
  created_at: string
  updated_at: string
}

// ─── Job ────────────────────────────────────────────────────────────────────

export interface VeoJobRequest {
  project_id?: string | null
  prompt: string
  model_display_name: string
  input_mode: InputMode
  aspect_ratio: AspectRatio
  duration_seconds: number
  resolution: string
  num_outputs: number
  seed?: number | null
  image_path?: string | null
  end_image_path?: string | null
  source_video_id?: string | null
  continuation_prompt?: string | null
}

export interface VeoJobOut {
  job_id: string
  project_id?: string | null
  flow_project_id?: string | null
  capability_profile_id?: string | null
  status: JobStatus
  input_mode: InputMode
  prompt: string
  model_display_name: string
  aspect_ratio: string
  duration_seconds: number
  resolution: string
  num_outputs: number
  current_step: string
  error_message: string | null
  output_files: string[]
  created_at: string
  updated_at: string
}

// ─── Bridge Status ──────────────────────────────────────────────────────────

export interface ExtensionInfo {
  ext_fp: string
  version: string
  tab_count: number
  last_heartbeat: string | null
  connected: boolean
}

export interface AccountInfo {
  email: string
  tier: string
  credits: number | null
  has_token: boolean
  session_valid: boolean
  last_updated: string | null
}

export interface VeoBridgeStatus {
  bridge_running: boolean
  bridge_port: number
  bridge_uptime_seconds: number
  secret_generated: boolean
  extension: ExtensionInfo
  accounts: AccountInfo[]
  captcha_queue_size: number
  total_captcha_solved: number
  last_captcha_at: string | null
}

// ─── Capabilities ───────────────────────────────────────────────────────────

export interface VeoCapabilities {
  models: VeoModelInfo[]
  profiles: VeoCapabilityProfile[]
  aspect_ratios: string[]
  max_outputs: number
  last_verified: string | null
  note: string
}

// ─── History ────────────────────────────────────────────────────────────────

export interface VeoHistoryItem {
  video_id: string
  file_name: string
  file_path: string
  file_size_bytes: number
  duration_seconds: number
  width: number
  height: number
  prompt: string
  model_display_name: string
  aspect_ratio: string
  input_mode: string
  created_at: string
}

// ─── Batch Script & Multi-threading ─────────────────────────────────────────

export type SceneStatus = 'idle' | 'queued' | 'running' | 'done' | 'error'

export interface BatchSceneItem {
  id: string
  sceneNumber: number
  timecode?: string
  prompt: string
  durationSeconds: number
  status: SceneStatus
  jobId?: string
  workerId?: number
  error?: string
  videoUrl?: string
  progressStep?: string
}

export type ScriptSplitMode = 'by_video' | 'by_scene'

export interface ScriptParseOptions {
  splitMode?: ScriptSplitMode
  autoDuration: boolean
  ignoreAudioText: boolean
  includeTitlePrefix: boolean
}

// ─── Image Generation (Nano Banana) ─────────────────────────────────────────

export type ImageModelKey = 'GEM_PIX_2' | 'NARWHAL' | 'HARBOR_SEAL'
export type ImageAspectRatio = '16:9' | '4:3' | '1:1' | '3:4' | '9:16'

export interface VeoImageItem {
  id: string
  media_id: string
  prompt: string
  model_display_name: string
  model_key: string
  aspect_ratio: ImageAspectRatio
  seed?: number | null
  image_url: string
  local_path: string
  project_id: string
  created_at: string
}

export interface VeoImageGenerateRequest {
  prompt: string
  model_key: ImageModelKey
  model_display_name: string
  aspect_ratio: ImageAspectRatio
  count: number
  seed?: number | null
  project_id?: string | null
  reference_image_ids?: string[]
}

export interface VeoImageGenerateResponse {
  ok: boolean
  images: VeoImageItem[]
  error?: string
}


