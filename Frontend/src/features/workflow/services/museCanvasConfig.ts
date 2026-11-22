/**
 * Muse Canvas — cấu hình dùng chung cho mọi node (thuần TS, không import React/DOM để node:test chạy được).
 *
 * Backend: GET/PUT /api/workflow/muse/config (snake_case, app/workflow/muse_canvas.py).
 * Khi chạy, node sẽ gọi /api/ai/muse/generate qua HTTP (nhiều tài khoản Muse), không dùng trình duyệt.
 */

export type MuseAccountMode = 'auto' | 'fixed'
export type MuseChatMode = 'new_per_run' | 'continue' | 'main'
export type MuseOutputKind = 'video' | 'image'
export type MuseAspectRatio = '9:16' | '16:9' | '1:1'
export type MuseAudioMode = 'auto' | 'silent' | 'voiceover'
export type MuseLanguage = 'vi' | 'en'

export interface MuseCanvasConfig {
  accountMode: MuseAccountMode
  accountId: string
  chatMode: MuseChatMode
  chatTitlePrefix: string
  outputKind: MuseOutputKind
  aspectRatio: MuseAspectRatio
  durationSeconds: number
  audioMode: MuseAudioMode
  language: MuseLanguage
  stylePreset: string
  promptPrefix: string
  promptSuffix: string
  avoid: string
  timeoutSeconds: number
  maxParallel: number
  filePrefix: string
  /** Google Flow (Omni 1.2) cho nút "Tạo video" của node Clip: project (VeoProject.id), khung hình, chất lượng */
  flowProjectId: string
  flowAspect: FlowAspect
  flowResolution: FlowResolution
  /** Thời lượng video Flow (giây): 0 = Tự động (theo kịch bản / video tham chiếu), 3–15 = cố định */
  flowSeconds: number
  /** Số biến thể mỗi lần bấm Tạo video (node Ingredients): 1–4, mỗi biến thể là 1 job Flow riêng */
  flowVariants: number
}

export type FlowAspect = '9:16' | '16:9'
export type FlowResolution = '720p' | '360p'

/** Omni 1.2 trên Flow: Ingredients 3–15 giây, chỉnh video cắt 3–15 giây (khớp FLOW_MIN/MAX_SECONDS ở backend). */
export const FLOW_MIN_SECONDS = 3
export const FLOW_MAX_SECONDS = 15
/** 0 = Tự động; còn lại 3–15 (số nguyên). Giá trị lạ -> Tự động. */
export function normalizeFlowSeconds(v: unknown): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= FLOW_MIN_SECONDS && n <= FLOW_MAX_SECONDS ? n : 0
}

/** 1–4 biến thể (khớp FLOW_MAX_VARIANTS ở backend). Giá trị lạ -> 1. */
export const FLOW_MAX_VARIANTS = 4
export function normalizeFlowVariants(v: unknown): number {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n >= 1 && n <= FLOW_MAX_VARIANTS ? n : 1
}

/** Thời lượng Muse đã kiểm chứng ra video đúng (khớp DURATIONS ở backend). */
export const MUSE_DURATIONS = [5, 10] as const
export const MUSE_MIN_TIMEOUT = 600
export const MUSE_MAX_PARALLEL = 4

export const DEFAULT_MUSE_CANVAS_CONFIG: MuseCanvasConfig = {
  accountMode: 'auto',
  accountId: '',
  chatMode: 'new_per_run',
  chatTitlePrefix: 'Muse Canvas',
  outputKind: 'video',
  aspectRatio: '9:16',
  durationSeconds: 5,
  audioMode: 'auto',
  language: 'vi',
  stylePreset: 'none',
  promptPrefix: '',
  promptSuffix: '',
  avoid: '',
  timeoutSeconds: MUSE_MIN_TIMEOUT,
  maxParallel: 1,
  filePrefix: 'muse_canvas',
  flowProjectId: '',
  flowAspect: '9:16',
  flowResolution: '720p',
  flowSeconds: 0,
  flowVariants: 1,
}

export interface MuseStylePreset {
  id: string
  label: string
  /** Câu mô tả phong cách thêm vào chỉ dẫn (tiếng Anh: Muse hiểu ổn định hơn). */
  prompt: string
}

export const MUSE_STYLE_PRESETS: MuseStylePreset[] = [
  { id: 'none', label: 'Không áp phong cách', prompt: '' },
  { id: 'cinematic', label: 'Điện ảnh', prompt: 'cinematic look, soft natural lighting, shallow depth of field, smooth camera movement' },
  { id: 'ugc', label: 'UGC / quay điện thoại', prompt: 'authentic handheld smartphone footage, natural light, casual creator style' },
  { id: 'product', label: 'Quảng cáo sản phẩm', prompt: 'clean commercial product shot, studio lighting, crisp details, premium feel' },
  { id: 'anime', label: 'Anime', prompt: 'anime style, vibrant colors, expressive characters' },
  { id: '3d', label: 'Hoạt hình 3D', prompt: 'stylized 3D animation, soft global illumination, playful colors' },
  { id: 'documentary', label: 'Tài liệu', prompt: 'documentary style, observational camera, realistic colors' },
]

export const MUSE_CHAT_MODE_OPTIONS: { id: MuseChatMode; label: string; hint: string }[] = [
  { id: 'new_per_run', label: 'Chat mới mỗi lần chạy', hint: 'Mỗi lần chạy mở một chat phụ mới trên Muse, kết quả không lẫn ngữ cảnh cũ.' },
  { id: 'continue', label: 'Nối tiếp chat trước', hint: 'Gửi vào chat của lần chạy trước (cùng tài khoản) để Muse giữ nhân vật / bối cảnh.' },
  { id: 'main', label: 'Chat chính', hint: 'Gửi vào chat chính của tài khoản Muse.' },
]

const ASPECTS: MuseAspectRatio[] = ['9:16', '16:9', '1:1']
const pick = <T extends string>(v: unknown, allowed: readonly T[], fallback: T): T =>
  allowed.includes(v as T) ? (v as T) : fallback
const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '')

/** Nhận dữ liệu từ backend (snake_case) hoặc localStorage (camelCase), trả cấu hình hợp lệ. */
export function normalizeMuseCanvasConfig(raw: unknown): MuseCanvasConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const get = (camel: string, snake: string) => (camel in r ? r[camel] : r[snake])
  const d = DEFAULT_MUSE_CANVAS_CONFIG
  const duration = Number(get('durationSeconds', 'duration_seconds'))
  const timeout = Number(get('timeoutSeconds', 'timeout_seconds'))
  const parallel = Number(get('maxParallel', 'max_parallel'))
  const preset = text(get('stylePreset', 'style_preset'), 40)
  const filePrefix = text(get('filePrefix', 'file_prefix'), 40).replace(/[^A-Za-z0-9_-]/g, '_')
  return {
    accountMode: pick(get('accountMode', 'account_mode'), ['auto', 'fixed'] as const, d.accountMode),
    accountId: text(get('accountId', 'account_id'), 64),
    chatMode: pick(get('chatMode', 'chat_mode'), ['new_per_run', 'continue', 'main'] as const, d.chatMode),
    chatTitlePrefix: text(get('chatTitlePrefix', 'chat_title_prefix'), 60) || d.chatTitlePrefix,
    outputKind: pick(get('outputKind', 'output_kind'), ['video', 'image'] as const, d.outputKind),
    aspectRatio: pick(get('aspectRatio', 'aspect_ratio'), ASPECTS, d.aspectRatio),
    durationSeconds: (MUSE_DURATIONS as readonly number[]).includes(duration) ? duration : d.durationSeconds,
    audioMode: pick(get('audioMode', 'audio_mode'), ['auto', 'silent', 'voiceover'] as const, d.audioMode),
    language: pick(get('language', 'language'), ['vi', 'en'] as const, d.language),
    stylePreset: MUSE_STYLE_PRESETS.some((p) => p.id === preset) ? preset : d.stylePreset,
    promptPrefix: text(get('promptPrefix', 'prompt_prefix'), 1000),
    promptSuffix: text(get('promptSuffix', 'prompt_suffix'), 1000),
    avoid: text(get('avoid', 'avoid'), 1000),
    timeoutSeconds: Number.isFinite(timeout) ? Math.max(MUSE_MIN_TIMEOUT, Math.round(timeout)) : d.timeoutSeconds,
    maxParallel: Number.isFinite(parallel) ? Math.min(MUSE_MAX_PARALLEL, Math.max(1, Math.round(parallel))) : d.maxParallel,
    filePrefix: filePrefix || d.filePrefix,
    flowProjectId: text(get('flowProjectId', 'flow_project_id'), 64),
    flowAspect: pick(get('flowAspect', 'flow_aspect'), ['9:16', '16:9'] as const, d.flowAspect),
    flowResolution: pick(get('flowResolution', 'flow_resolution'), ['720p', '360p'] as const, d.flowResolution),
    flowSeconds: normalizeFlowSeconds(get('flowSeconds', 'flow_seconds')),
    flowVariants: normalizeFlowVariants(get('flowVariants', 'flow_variants')),
  }
}

/** Cấu hình -> body PUT /api/workflow/muse/config. */
export function museCanvasConfigToApi(c: MuseCanvasConfig): Record<string, unknown> {
  return {
    account_mode: c.accountMode,
    account_id: c.accountMode === 'fixed' ? c.accountId : '',
    chat_mode: c.chatMode,
    chat_title_prefix: c.chatTitlePrefix,
    output_kind: c.outputKind,
    aspect_ratio: c.aspectRatio,
    duration_seconds: c.durationSeconds,
    audio_mode: c.audioMode,
    language: c.language,
    style_preset: c.stylePreset,
    prompt_prefix: c.promptPrefix,
    prompt_suffix: c.promptSuffix,
    avoid: c.avoid,
    timeout_seconds: c.timeoutSeconds,
    max_parallel: c.maxParallel,
    file_prefix: c.filePrefix,
    flow_project_id: c.flowProjectId,
    flow_aspect: c.flowAspect,
    flow_resolution: c.flowResolution,
    flow_seconds: c.flowSeconds,
    flow_variants: c.flowVariants,
  }
}

const ASPECT_WORDS: Record<MuseAspectRatio, string> = {
  '9:16': 'vertical 9:16',
  '16:9': 'horizontal 16:9',
  '1:1': 'square 1:1',
}

/**
 * Ghép chỉ dẫn gửi Muse cho một cảnh. Muse là agent trò chuyện, nên yêu cầu phải nói rõ loại đầu ra,
 * thời lượng và tỉ lệ ngay đầu câu (kiểu "Create a 5-second vertical 9:16 video: …" đã chạy đúng).
 */
export function buildMuseInstruction(c: MuseCanvasConfig, scenePrompt: string): string {
  const scene = [c.promptPrefix, scenePrompt.trim(), c.promptSuffix].filter(Boolean).join(' ').trim()
  const head =
    c.outputKind === 'video'
      ? `Create a ${c.durationSeconds}-second ${ASPECT_WORDS[c.aspectRatio]} video`
      : `Create a ${ASPECT_WORDS[c.aspectRatio]} image`
  const lines = [`${head}: ${scene || '…'}`]
  const style = MUSE_STYLE_PRESETS.find((p) => p.id === c.stylePreset)?.prompt
  if (style) lines.push(`Style: ${style}.`)
  if (c.outputKind === 'video') {
    if (c.audioMode === 'silent') lines.push('Audio: no voice, no music.')
    if (c.audioMode === 'voiceover')
      lines.push(`Audio: natural voiceover in ${c.language === 'vi' ? 'Vietnamese' : 'English'}.`)
  }
  if (c.language === 'vi' && c.audioMode !== 'voiceover') lines.push('Any on-screen text or speech must be in Vietnamese.')
  if (c.avoid) lines.push(`Avoid: ${c.avoid}.`)
  lines.push(`Return the ${c.outputKind} directly, do not ask follow-up questions.`)
  return lines.join('\n')
}

/** Tham số gọi /api/ai/muse/generate tương ứng với cấu hình (node sẽ dùng khi chạy). */
export function museGenerateOptions(c: MuseCanvasConfig): {
  account_id?: string
  use_side_chat: boolean
  continuation: boolean
  timeout_seconds: number
} {
  return {
    ...(c.accountMode === 'fixed' && c.accountId ? { account_id: c.accountId } : {}),
    use_side_chat: c.chatMode === 'new_per_run',
    continuation: c.chatMode === 'continue',
    timeout_seconds: c.timeoutSeconds,
  }
}

export interface MuseAccountLite {
  id: string
  label: string
  status: string
}

/** Cảnh báo cấu hình (hiện trong panel, chặn chạy khi node có rồi). */
export function museConfigWarnings(c: MuseCanvasConfig, accounts: MuseAccountLite[]): string[] {
  const out: string[] = []
  const ready = accounts.filter((a) => a.status === 'active')
  if (accounts.length === 0) out.push('Chưa có tài khoản Muse — thêm ở Cài đặt → Muse AI (Meta).')
  else if (c.accountMode === 'auto' && ready.length === 0) out.push('Không có tài khoản Muse nào “Sẵn sàng”.')
  if (c.accountMode === 'fixed') {
    const acc = accounts.find((a) => a.id === c.accountId)
    if (!acc) out.push('Chưa chọn tài khoản cố định (hoặc tài khoản đã bị xóa).')
    else if (acc.status !== 'active') out.push(`Tài khoản “${acc.label}” đang hết phiên — đăng nhập lại trong Cài đặt.`)
  }
  const usable = c.accountMode === 'fixed' ? 1 : ready.length
  if (c.maxParallel > Math.max(1, usable))
    out.push(`Chạy song song ${c.maxParallel} job nhưng chỉ có ${usable} tài khoản dùng được — mỗi tài khoản chạy 1 job một lúc.`)
  if (c.chatMode === 'continue' && c.maxParallel > 1)
    out.push('“Nối tiếp chat trước” nên chạy tuần tự (song song = 1) để các cảnh nối đúng thứ tự.')
  return out
}

/** Lỗi chặn chạy node Muse (khác cảnh báo: thiếu tài khoản dùng được thì không gửi gì cả). */
export function museRunBlockers(c: MuseCanvasConfig, accounts: MuseAccountLite[]): string[] {
  const ready = accounts.filter((a) => a.status === 'active')
  if (accounts.length === 0) return ['Chưa có tài khoản Muse — thêm ở Cài đặt → Muse AI (Meta).']
  if (c.accountMode === 'fixed') {
    const acc = accounts.find((a) => a.id === c.accountId)
    if (!acc) return ['Chưa chọn tài khoản Muse cố định trong panel cấu hình.']
    if (acc.status !== 'active') return [`Tài khoản “${acc.label}” đang hết phiên — đăng nhập lại trong Cài đặt.`]
    return []
  }
  return ready.length ? [] : ['Không có tài khoản Muse nào “Sẵn sàng”.']
}
