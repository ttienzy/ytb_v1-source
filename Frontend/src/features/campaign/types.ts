/** Kiểu dữ liệu của Campaign engine (khớp Backend/app/campaign). */

export type StepStateName = 'blocked' | 'missing' | 'fresh' | 'stale' | 'pinned'
export type GateState = 'approved' | 'need_approval' | 'rejected' | null
export type Tier = 'draft' | 'final'

export interface CampaignSummary {
  id: string
  name: string
  niche: string
  platform: string
  credit_cap: number | null
  created_at: string
  updated_at: string
}

export interface Blocker { dep: string; reason: string }

export interface LastRun {
  id: string
  state: string
  error: string
  attempt: number
  credit_actual: number | null
  external_ref: string
}

export interface ElementProgress { message: string; started_at: number }

export interface ElementState {
  step_key: string
  element_key: string
  state: StepStateName
  reasons: string[]
  blockers: Blocker[]
  selected_artifact_id: string | null
  fingerprint: string | null
  cached_artifact_id: string | null
  pinned: boolean
  stale: boolean
  gate: GateState
  active_run: string | null
  last_run: LastRun | null
  progress?: ElementProgress | null
  params?: Record<string, unknown>
}

export interface StepView {
  key: string
  title: string
  kind: 'input_files' | 'input_params' | 'compute'
  lane: string
  paid: boolean
  gate: boolean
  advisory: boolean
  map: boolean
  params: Record<string, any>
  elements: ElementState[]
}

export interface BlockView {
  block: number
  title: string
  state: string
  steps: StepView[]
}

export interface CampaignState {
  campaign: CampaignSummary | null
  tier: Tier
  spent_credit: number
  blocks: BlockView[]
  active_exec: string | null
}

export interface PlanItem {
  step_key: string
  element_key: string
  action: string
  reason: string
  fingerprint: string | null
  lane: string
  credit: number | null
  images: number
  llm_calls: number
  estimate: boolean
  blockers: Blocker[]
}

export interface Plan {
  items: PlanItem[]
  total_credit: number
  unknown_cost_items: number
  estimated_credit?: number
  images: number
  llm_calls: number
  credit_cap: number | null
  spent_credit: number
  over_budget: boolean
  needs_confirm: boolean
  runnable: number
}

export interface RunResponse { exec_id: string | null; plan: Plan }

export interface ArtifactView {
  id: string
  kind: string
  content_hash: string
  step_key: string | null
  element_key: string
  fingerprint: string | null
  meta: Record<string, any>
  parent_ids: string[]
  created_at: string
}

export interface RefSlot { role: string; label?: string; desc?: string }

export interface PromptTemplate {
  template_id: string
  version: number
  kind: string
  name: string
  body: string
  ref_slots: RefSlot[]
  owner: 'system' | 'user'
  read_only: boolean
  base_id: string
}

export interface PromptWarning { code: string; message: string }

export interface PromptPreview {
  prompt: string
  ref_order: { role: string; label?: string; path: string; artifact_id?: string }[]
  missing_variables: string[]
  warnings: PromptWarning[]
  template: { template_id: string; version: number; name: string; body_hash: string; read_only: boolean }
  aspect: string
  count: number
  note: string
}

export interface RunView {
  id: string
  step_key: string
  element_key: string
  state: string
  attempt: number
  credit_est: number | null
  credit_actual: number | null
  external_ref: string
  error: string
  artifact_id: string | null
  created_at: string
  finished_at: string | null
}

export type RiskLevel = 'low' | 'medium' | 'high'
export interface FactSheetRisk {
  level: RiskLevel
  reasons: string[]
  motion_limit: 'free' | 'gentle' | 'minimal'
  logo_rule: 'none' | 'reference_only'
}
export interface FactSheet {
  category: string; color: string; material: string; fit: string; length: string; neckline: string
  sleeves: string; pattern: string; logo_present: boolean; logo_text: string; details: string[]
  sizes: string; summary: string; summary_vi: string; do_not_say: string[]
  risk?: FactSheetRisk
}

export interface PlanWarning { where: string; code: string; message: string }
export type Motion = 'minimal' | 'gentle' | 'free'
export interface AngleItem { key: string; id: string; title_vi: string; pitch_vi: string; needs_motion: Motion; risk_note: string }
export interface AngleDoc { items: AngleItem[]; chosen: string; warnings?: PlanWarning[] }
export interface HookItem { key: string; type: string; voiceover: string; on_screen_text: string; visual: string; seconds: number; needs_unavailable_visual?: boolean }
export interface HookDoc { items: HookItem[]; chosen?: string; warnings?: PlanWarning[] }
export type Archetype = 'hero' | 'detail' | 'motion' | 'cta'
export type Framing = 'wide' | 'medium' | 'closeup'
export type CameraMove = 'static' | 'push_in' | 'pull_out' | 'pan' | 'orbit'
export type FacePolicy = 'visible' | 'none'
export type BoardType = 'hero_walk' | 'turn_reveal' | 'pose_sequence' | 'detail_macro' | 'fabric_touch' | 'still_life' | 'closer_cta'
export interface ShotPanel { framing: Framing; action: string }
export interface ShotItem {
  key: string; role: 'hook' | 'benefit' | 'cta'; duration: number; motion: Motion; motion_adjusted: boolean
  on_screen_text: string; voiceover: string; board_type: BoardType; panels: ShotPanel[]
  archetype: Archetype; framing: Framing; camera_move: CameraMove; face_policy: FacePolicy; expression?: string; motion_cap?: Motion
  keyframe_start?: string; end_delta?: string
}
export interface ShotPlanDoc { items: ShotItem[]; motion_limit: Motion; warnings?: PlanWarning[] }
export interface ScriptItem { shot: string; voiceover: string; on_screen_text: string }
export interface ScriptDoc { items: ScriptItem[]; caption: string; hashtags: string[]; cta: string; warnings?: PlanWarning[] }

export interface StoryboardPreview {
  prompt: string
  ref_order: { role: string; label?: string; artifact_id?: string }[]
  warnings: PromptWarning[]
  aspect: string
  panels: number
  shot: string
  template: { template_id: string; version: number; name: string }
}
export interface ClipPreview {
  prompt: string
  ref_order: { role: string; label?: string; path: string; artifact_id: string }[]
  warnings: PromptWarning[]
  template: { template_id: string; version: number; name: string }
  tier: Tier
  resolution: string
  aspect: string
  duration: number
  motion: string
  model: string
  credit: number | null
  credit_known: boolean
  credit_estimate: number | null
  shot: string
}

export interface SuggestResult {
  suggestion: Record<string, string>
  note: string
  provider: string
  images: number
  used_fact_sheet: boolean
}

export interface CastItem { id: string; name: string; filename: string; content_hash: string; created_at: string }

export interface BundleMember { artifact_id: string; role: string }

/** Lỗi 409 khi chạy cần xác nhận credit hoặc vượt trần. */
export class RunNeedsConfirmation extends Error {
  kind: 'confirm_required' | 'over_budget'
  plan: Plan
  constructor(kind: 'confirm_required' | 'over_budget', plan: Plan, message: string) {
    super(message)
    this.kind = kind
    this.plan = plan
  }
}

export type ExportVariant = 'clean' | 'no_bgm' | 'clean_no_bgm'
export interface ExportVariantState { state: 'none' | 'running' | 'ready' | 'error'; label: string; message?: string; error?: string; bytes?: number }
/** GET /api/campaigns/{id}/exports: các bản tải phụ của video đang chọn. */
export interface ExportStatus {
  artifact_id: string | null
  fresh: boolean
  has_bgm: boolean
  watermark_removed?: boolean
  variants: Partial<Record<ExportVariant, ExportVariantState>>
  reason: string
}
