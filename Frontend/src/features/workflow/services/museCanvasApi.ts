/**
 * Muse Canvas — lưu cấu hình + project / đồ thị: localStorage (nạp tức thì) và backend (bền vững).
 *   GET/PUT /api/workflow/muse/config               (config.json, khóa muse_canvas — cấu hình chung)
 *   /api/workflow/muse/projects[/{id}[/canvas]]      (Data/muse_canvas_projects/ — mỗi project 1 đồ thị)
 * /api/workflow/muse/canvas (project đang mở) chỉ còn cho bản frontend cũ.
 */
import { API_URL } from '../../../shared/constants'
import { fileStem } from './museCanvasNodes.ts'
import type { GptChatErrorCode, GptChatPoolStatus } from './museGptChat.ts'
import {
  normalizeProjectIndex,
  normalizeProjectMeta,
  projectSettingsToApi,
  type MuseProjectIndex,
  type MuseProjectMeta,
  type MuseProjectSettings,
} from './museProjects.ts'
import {
  DEFAULT_MUSE_CANVAS_CONFIG,
  museCanvasConfigToApi,
  normalizeMuseCanvasConfig,
  type MuseAccountLite,
  type MuseCanvasConfig,
} from './museCanvasConfig.ts'

const CONFIG_KEY = 'muse_canvas_config_v1'
/** Bản cache đồ thị trước khi có project (1 khóa cho cả canvas) — dọn đi, đồ thị cũ đã thành project ở backend. */
const LEGACY_GRAPH_KEY = 'muse_canvas_graph_v1'
const GRAPH_KEY_PREFIX = 'muse_canvas_graph_v1:'
try {
  if (typeof window !== 'undefined') window.localStorage.removeItem(LEGACY_GRAPH_KEY)
} catch {
  /* bỏ qua */
}

export interface MuseCanvasGraph {
  nodes: any[]
  edges: any[]
  viewport?: { x: number; y: number; zoom: number } | null
}

function readLocal<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key)
    return raw ? (JSON.parse(raw) as T) : null
  } catch {
    return null
  }
}

function writeLocal(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    /* localStorage đầy / bị chặn: vẫn còn bản trên backend */
  }
}

/** Bản cục bộ để hiện ngay khi mở tab (trước khi backend trả lời). */
export function loadLocalMuseCanvasConfig(): MuseCanvasConfig {
  return normalizeMuseCanvasConfig(readLocal(CONFIG_KEY) ?? DEFAULT_MUSE_CANVAS_CONFIG)
}

export async function fetchMuseCanvasConfig(): Promise<MuseCanvasConfig> {
  const res = await fetch(`${API_URL}/api/workflow/muse/config`)
  if (!res.ok) throw new Error(`Không tải được cấu hình Muse Canvas (HTTP ${res.status}) — backend đã khởi động lại chưa?`)
  const cfg = normalizeMuseCanvasConfig(await res.json())
  writeLocal(CONFIG_KEY, cfg)
  return cfg
}

export async function saveMuseCanvasConfig(cfg: MuseCanvasConfig): Promise<MuseCanvasConfig> {
  writeLocal(CONFIG_KEY, cfg)
  const res = await fetch(`${API_URL}/api/workflow/muse/config`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(museCanvasConfigToApi(cfg)),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(typeof err.detail === 'string' ? err.detail : `Không lưu được cấu hình Muse Canvas (HTTP ${res.status})`)
  }
  return normalizeMuseCanvasConfig(await res.json())
}

// ---------------------------------------------------------------- project (mỗi project 1 đồ thị)
//   GET/POST /api/workflow/muse/projects, PATCH/DELETE /projects/{id}, POST /projects/{id}/open,
//   GET/PUT /projects/{id}/canvas   (app/workflow/muse_projects.py)

const PROJECTS_KEY = 'muse_canvas_projects_v1'
const projectGraphKey = (pid: string) => `${GRAPH_KEY_PREFIX}${pid}`

/**
 * Cache đồ thị của 1 project trên máy. localStorage chỉ vài MB cho cả app: đầy thì bỏ cache của các project khác
 * (backend mới là bản gốc, mở project đó sẽ tải lại) rồi ghi lại.
 */
function writeProjectGraphLocal(pid: string, graph: MuseCanvasGraph): void {
  const key = projectGraphKey(pid)
  const blob = JSON.stringify(graph)
  try {
    window.localStorage.setItem(key, blob)
    return
  } catch {
    /* đầy: dọn rồi thử lại */
  }
  try {
    const others: string[] = []
    for (let i = 0; i < window.localStorage.length; i++) {
      const k = window.localStorage.key(i)
      if (k && k.startsWith(GRAPH_KEY_PREFIX) && k !== key) others.push(k)
    }
    others.forEach((k) => window.localStorage.removeItem(k))
    window.localStorage.setItem(key, blob)
  } catch {
    /* vẫn không đủ chỗ: chỉ còn bản trên backend */
  }
}
/** Lần lưu canvas đang gửi của từng project: đọc lại project đó phải chờ nó xong (đổi qua lại nhanh A → B → A). */
const pendingSaves = new Map<string, Promise<unknown>>()
/** Project vừa xóa: canvas đang đóng của nó không được lưu lại (khỏi ghi rác vào localStorage / lỗi 404). */
const deletedProjects = new Set<string>()

async function detailOrThrow(res: Response, fallback: string): Promise<any> {
  const d = await res.json().catch(() => ({}))
  if (res.status === 404 && d.detail === 'Not Found') throw new Error(`${fallback} — backend chưa có project Muse Canvas, hãy khởi động lại backend.`)
  if (!res.ok) {
    const detail = Array.isArray(d.detail) ? d.detail.map((x: any) => x?.msg).filter(Boolean).join('; ') : d.detail
    throw new Error(typeof detail === 'string' && detail ? detail : `${fallback} (HTTP ${res.status})`)
  }
  return d
}

/** Danh sách project đã thấy lần trước (để vẽ ngay khi mở tab). */
export function loadLocalProjectIndex(): MuseProjectIndex {
  return normalizeProjectIndex(readLocal(PROJECTS_KEY))
}

export async function fetchMuseProjects(): Promise<MuseProjectIndex> {
  const raw = await detailOrThrow(await fetch(`${API_URL}/api/workflow/muse/projects`), 'Không tải được danh sách project')
  writeLocal(PROJECTS_KEY, raw)
  return normalizeProjectIndex(raw)
}

export async function createMuseProject(body: {
  name: string
  graph?: MuseCanvasGraph
  settings?: MuseProjectSettings
  activate?: boolean
}): Promise<MuseProjectMeta> {
  const res = await fetch(`${API_URL}/api/workflow/muse/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: body.name,
      graph: body.graph,
      settings: body.settings ? projectSettingsToApi(body.settings) : undefined,
      activate: body.activate ?? true,
    }),
  })
  const meta = normalizeProjectMeta(await detailOrThrow(res, 'Không tạo được project'))
  if (!meta) throw new Error('Backend trả project không hợp lệ.')
  return meta
}

export async function updateMuseProject(id: string, patch: { name?: string; settings?: MuseProjectSettings }): Promise<MuseProjectMeta> {
  const res = await fetch(`${API_URL}/api/workflow/muse/projects/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: patch.name, settings: patch.settings ? projectSettingsToApi(patch.settings) : undefined }),
  })
  const meta = normalizeProjectMeta(await detailOrThrow(res, 'Không lưu được project'))
  if (!meta) throw new Error('Backend trả project không hợp lệ.')
  return meta
}

export async function deleteMuseProject(id: string): Promise<MuseProjectIndex> {
  const res = await fetch(`${API_URL}/api/workflow/muse/projects/${encodeURIComponent(id)}`, { method: 'DELETE' })
  const raw = await detailOrThrow(res, 'Không xóa được project')
  deletedProjects.add(id)
  try {
    window.localStorage.removeItem(projectGraphKey(id))
  } catch {
    /* bỏ qua */
  }
  writeLocal(PROJECTS_KEY, raw)
  return normalizeProjectIndex(raw)
}

/** Ghi nhớ project đang mở ở backend (mở lại app vào đúng project này). */
export async function openMuseProject(id: string): Promise<MuseProjectIndex> {
  const res = await fetch(`${API_URL}/api/workflow/muse/projects/${encodeURIComponent(id)}/open`, { method: 'POST' })
  const raw = await detailOrThrow(res, 'Không mở được project')
  writeLocal(PROJECTS_KEY, raw)
  return normalizeProjectIndex(raw)
}

export function loadLocalProjectGraph(pid: string): MuseCanvasGraph {
  const g = readLocal<MuseCanvasGraph>(projectGraphKey(pid))
  return { nodes: g?.nodes ?? [], edges: g?.edges ?? [], viewport: g?.viewport ?? null }
}

export async function fetchMuseProjectGraph(pid: string): Promise<MuseCanvasGraph> {
  await pendingSaves.get(pid)?.catch(() => {})
  const g = await detailOrThrow(await fetch(`${API_URL}/api/workflow/muse/projects/${encodeURIComponent(pid)}/canvas`), 'Không tải được canvas của project')
  const graph = { nodes: g.nodes ?? [], edges: g.edges ?? [], viewport: g.viewport ?? null }
  writeProjectGraphLocal(pid, graph)
  return graph
}

export async function saveMuseProjectGraph(pid: string, graph: MuseCanvasGraph): Promise<void> {
  if (deletedProjects.has(pid)) return
  writeProjectGraphLocal(pid, graph)
  const job = (async () => {
    const res = await fetch(`${API_URL}/api/workflow/muse/projects/${encodeURIComponent(pid)}/canvas`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(graph),
    })
    await detailOrThrow(res, 'Không lưu được canvas')
  })()
  pendingSaves.set(pid, job)
  try {
    await job
  } finally {
    if (pendingSaves.get(pid) === job) pendingSaves.delete(pid)
  }
}

export async function fetchMuseAccounts(): Promise<MuseAccountLite[]> {
  const res = await fetch(`${API_URL}/api/settings/muse/accounts`)
  if (!res.ok) throw new Error('Không tải được danh sách tài khoản Muse')
  const data = await res.json()
  return (data.accounts || []).map((a: any) => ({
    id: String(a.id),
    label: String(a.label || a.id),
    status: String(a.status || ''),
  }))
}

// ---------------------------------------------------------------- node: ảnh trang phục + prompt

export interface MusePromptInfo {
  name: string
  prompt: string
  is_custom: boolean
}

/** Tải ảnh lên backend (Data/media/muse_uploads) — node chỉ giữ đường dẫn, không nhúng base64. */
export async function uploadMuseImage(file: File): Promise<{ path: string; previewUrl: string; name: string; size: number }> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_URL}/api/ai/muse/upload`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(typeof err.detail === 'string' ? err.detail : `Tải ảnh lên thất bại (HTTP ${res.status})`)
  }
  const d = await res.json()
  return { path: d.file_path, previewUrl: d.preview_url, name: d.file_name, size: d.file_size }
}

/** URL đầy đủ để <img> hiển thị ảnh đã tải lên. */
export function museMediaUrl(previewUrl: string): string {
  return previewUrl.startsWith('http') ? previewUrl : `${API_URL}${previewUrl}`
}

async function promptCall(name: string, init?: RequestInit): Promise<MusePromptInfo> {
  const res = await fetch(`${API_URL}/api/workflow/muse/prompts/${encodeURIComponent(name)}`, init)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(typeof err.detail === 'string' ? err.detail : `Lỗi prompt mặc định (HTTP ${res.status}) — backend đã khởi động lại chưa?`)
  }
  return res.json()
}

export const fetchMusePrompt = (name: string) => promptCall(name)
export const saveMusePromptDefault = (name: string, prompt: string) =>
  promptCall(name, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) })
export const resetMusePromptDefault = (name: string) => promptCall(name, { method: 'DELETE' })

export interface MuseImageResult {
  path: string
  previewUrl: string
  size: number
  sessionId: string | null
  accountLabel: string | null
}

export interface MuseTextResult {
  text: string
  /** File .md backend đã lưu (Data/media/muse_texts) */
  path: string
  /** Có bài nhưng có thể chưa đủ (hết thời gian chờ) */
  warning: string | null
  sessionId: string | null
}

/** Chạy 1 lần Muse lấy CÂU TRẢ LỜI CHỮ (output_kind=text), vd. node Kịch bản video. Lỗi -> throw. */
export async function generateMuseText(body: Record<string, unknown>): Promise<MuseTextResult> {
  const res = await fetch(`${API_URL}/api/ai/muse/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.ok) {
    throw new Error(typeof d.detail === 'string' ? d.detail : d.error || `Muse lỗi (HTTP ${res.status})`)
  }
  if (!d.reply_text) throw new Error('Muse không trả chữ (backend cũ chưa hỗ trợ? hãy khởi động lại backend).')
  return { text: d.reply_text, path: d.local_path || '', warning: d.error || null, sessionId: d.session_id ?? null }
}

export interface GptScriptResult {
  text: string
  /** File .md backend đã lưu (Data/media/muse_texts) */
  path: string
  accountLabel: string | null
}

/** Node "Kịch bản tạo video": 1 lượt ChatGPT viết kịch bản từng clip (POST /api/workflow/muse/gpt-script). Lỗi -> throw. */
export async function generateGptClipScript(body: Record<string, unknown>): Promise<GptScriptResult> {
  const res = await fetch(`${API_URL}/api/workflow/muse/gpt-script`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  if (res.status === 404 || res.status === 405) throw new Error('Backend chưa có node Kịch bản tạo video — hãy khởi động lại backend.')
  if (!res.ok || !d.ok) throw new Error(typeof d.detail === 'string' ? d.detail : `ChatGPT lỗi (HTTP ${res.status})`)
  if (!d.text) throw new Error('ChatGPT không trả chữ.')
  return { text: d.text, path: d.local_path || '', accountLabel: d.account_label ?? null }
}

export interface MuseVideoResult {
  /** Mọi video đã tải (cuối = bản chính) */
  paths: string[]
  reply: string | null
  sessionId: string | null
}

/** Chạy 1 lần Muse ra VIDEO (output_kind=video). Lỗi -> throw kèm câu của backend. */
export async function generateMuseVideo(body: Record<string, unknown>): Promise<MuseVideoResult> {
  const res = await fetch(`${API_URL}/api/ai/muse/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.ok) {
    throw new Error(typeof d.detail === 'string' ? d.detail : d.error || `Muse lỗi (HTTP ${res.status})`)
  }
  const paths: string[] = Array.isArray(d.local_paths) && d.local_paths.length ? d.local_paths : d.local_path ? [d.local_path] : []
  if (!paths.length) throw new Error('Muse không trả video.')
  return { paths, reply: d.reply_text ?? null, sessionId: d.session_id ?? null }
}

// ---------------------------------------------------------------- Hoàn thiện video (node Video kết quả)

export interface BgmTrackLite {
  id: string
  name: string
  durationSec: number
}

/** Thư viện nhạc (GET /api/bgm). */
export async function fetchBgmTracks(): Promise<BgmTrackLite[]> {
  const res = await fetch(`${API_URL}/api/bgm`)
  if (!res.ok) throw new Error('Không tải được Thư viện nhạc')
  const data = await res.json()
  const raw = Array.isArray(data) ? data : data?.tracks || []
  return raw.map((t: any) => ({ id: String(t.track_id), name: String(t.name || t.track_id), durationSec: Number(t.duration_sec) || 0 }))
}

export const bgmAudioUrl = (trackId: string) => `${API_URL}/api/bgm/${encodeURIComponent(trackId)}/audio`

/** Logo kênh (dùng chung kho logo của Workflow Audio: POST /api/audio/logo). */
export async function uploadChannelLogo(file: File): Promise<string> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`${API_URL}/api/audio/logo`, { method: 'POST', body: form })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.logo_id) throw new Error(typeof d.detail === 'string' ? d.detail : `Tải logo thất bại (HTTP ${res.status})`)
  return String(d.logo_id)
}

export const channelLogoUrl = (logoId: string) => `${API_URL}/api/audio/logo/${encodeURIComponent(logoId)}`

export interface MuseFinishResult {
  filename: string
  path: string
  title: string
  durationSec: number
}

/** Xuất video hoàn chỉnh (POST /api/workflow/muse/finish) → lưu vào Thư Viện Video. */
export async function finishMuseVideo(body: Record<string, unknown>): Promise<MuseFinishResult> {
  const res = await fetch(`${API_URL}/api/workflow/muse/finish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      typeof d.detail === 'string' ? d.detail : res.status === 404 || res.status === 405 ? 'Backend chưa có chức năng này — khởi động lại backend.' : `Lỗi xuất video (HTTP ${res.status})`,
    )
  }
  return { filename: d.filename, path: d.file_path, title: d.title || '', durationSec: Number(d.duration_sec) || 0 }
}

/** Thư Viện Video vừa có video mới (nút Thư Viện Video cập nhật số đếm). */
export const VIDEO_LIBRARY_CHANGED = 'creatorflow:video-library-changed'
export function notifyVideoLibraryChanged(): void {
  try {
    window.dispatchEvent(new Event(VIDEO_LIBRARY_CHANGED))
  } catch {
    /* không có window (test) */
  }
}

export const exportVideoUrl = (filename: string) => `${API_URL}/api/workflow/exports/${encodeURIComponent(filename)}`

export async function openExportFolder(filename: string): Promise<void> {
  await fetch(`${API_URL}/api/workflow/exports/${encodeURIComponent(filename)}/open-folder`, { method: 'POST' })
}

/** Mở thư mục chứa video Muse đã tải. */
export async function openMuseVideoFolder(): Promise<void> {
  await fetch(`${API_URL}/api/ai/muse/open-folder`, { method: 'POST' })
}

/** Node gạt sang GPT: tạo 1 ảnh bằng tài khoản ChatGPT (POST /api/workflow/muse/gpt-image). Lỗi -> throw kèm câu của backend. */
export async function generateGptImage(body: Record<string, unknown>): Promise<MuseImageResult> {
  const res = await fetch(`${API_URL}/api/workflow/muse/gpt-image`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  if (res.status === 404 || res.status === 405) throw new Error('Backend chưa có chế độ GPT — hãy khởi động lại backend.')
  if (!res.ok || !d.ok) {
    throw new Error(typeof d.detail === 'string' ? d.detail : `ChatGPT lỗi (HTTP ${res.status})`)
  }
  if (!d.preview_url || !d.local_path) throw new Error('ChatGPT không trả ảnh.')
  return { path: d.local_path, previewUrl: d.preview_url, size: d.file_size || 0, sessionId: null, accountLabel: null }
}

/** Chạy 1 lần Muse ra ẢNH (POST /api/ai/muse/generate, output_kind=image). Lỗi -> throw kèm câu của backend. */
export async function generateMuseImage(body: Record<string, unknown>): Promise<MuseImageResult> {
  const res = await fetch(`${API_URL}/api/ai/muse/generate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok || !d.ok) {
    throw new Error(typeof d.detail === 'string' ? d.detail : d.error || `Muse lỗi (HTTP ${res.status})`)
  }
  if (!d.preview_url || !d.local_path) throw new Error('Muse không trả ảnh (backend cũ chưa hỗ trợ ảnh? hãy khởi động lại backend).')
  return {
    path: d.local_path,
    previewUrl: d.preview_url,
    size: d.file_size || 0,
    sessionId: d.session_id ?? null,
    accountLabel: d.account_label ?? null,
  }
}

// ---------------------------------------------------------------- Google Flow (Omni 1.2) cho node Clip

export interface FlowProject {
  id: string
  name: string
  flow_project_id: string
  account_email: string
  is_active: boolean
  video_count: number
  created_at: string
}

export interface FlowAccount {
  email: string
  credits: number | null
  seen_at: string
}

export interface FlowProjectCheck {
  ok: boolean
  state: 'open' | 'redirected' | 'missing' | 'no_extension' | 'unknown'
  message: string
  account_email?: string
  accounts: FlowAccount[]
}

async function jsonOrThrow<T>(res: Response, fallback: string): Promise<T> {
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof d.detail === 'string' ? d.detail : `${fallback} (HTTP ${res.status})`)
  return d as T
}

export async function listFlowProjects(): Promise<FlowProject[]> {
  return jsonOrThrow<FlowProject[]>(await fetch(`${API_URL}/api/veo/projects`), 'Không tải được danh sách project Flow')
}

/** Tạo project trên tab Flow (tài khoản đang đăng nhập) — extension tạo và trả mã project. */
export async function createFlowProject(name: string): Promise<FlowProject> {
  const res = await fetch(`${API_URL}/api/veo/projects`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })
  return jsonOrThrow<FlowProject>(res, 'Không tạo được project Flow')
}

export async function fetchFlowAccounts(): Promise<FlowAccount[]> {
  const d = await jsonOrThrow<{ accounts: FlowAccount[] }>(await fetch(`${API_URL}/api/workflow/muse/flow/accounts`), 'Không tải được tài khoản Flow')
  return d.accounts || []
}

/** Mở project trên tab Flow và xác nhận (không tạo video). Có thể mất tới ~45 s (chờ heartbeat của extension). */
export async function checkFlowProject(projectId: string): Promise<FlowProjectCheck> {
  const res = await fetch(`${API_URL}/api/workflow/muse/flow/check`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ project_id: projectId }),
  })
  return jsonOrThrow<FlowProjectCheck>(res, 'Không kiểm tra được project')
}

export interface VeoJobLite {
  job_id: string
  status: string
  current_step?: string
  error_code?: string | null
  error_message?: string | null
  output_files?: string[]
  /** Nhiều video trong một lệnh (chỉnh video x2–x4): kết cục từng biến thể theo thứ tự item; rỗng với job 1 video */
  outputs?: VeoJobOutput[]
  deduplicated?: boolean
  updated_at?: string
}

export interface VeoJobOutput {
  index: number
  status: 'done' | 'error'
  file?: string | null
  media_id?: string | null
  error?: string | null
  error_code?: string | null
}

export async function submitVeoJob(body: Record<string, unknown>): Promise<VeoJobLite> {
  const res = await fetch(`${API_URL}/api/veo/jobs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail = Array.isArray(d.detail) ? d.detail.map((x: any) => x?.msg).filter(Boolean).join('; ') : d.detail
    throw new Error(typeof detail === 'string' && detail ? detail : `Không gửi được job Flow (HTTP ${res.status})`)
  }
  return d as VeoJobLite
}

export async function getVeoJob(jobId: string): Promise<VeoJobLite | null> {
  const res = await fetch(`${API_URL}/api/veo/jobs/${encodeURIComponent(jobId)}`)
  if (res.status === 404) return null
  return jsonOrThrow<VeoJobLite>(res, 'Không đọc được trạng thái job')
}

/** Tìm lại video đã tạo trong project (khớp mediaId) thay vì gửi lại — dùng khi job báo lỗi / hết giờ. */
export async function recoverVeoJob(jobId: string): Promise<VeoJobLite> {
  const res = await fetch(`${API_URL}/api/veo/jobs/${encodeURIComponent(jobId)}/recover-current`, { method: 'POST' })
  return jsonOrThrow<VeoJobLite>(res, 'Không tìm lại được video')
}

export interface MuseCutResult {
  file_name: string
  file_path: string
  preview_url: string
  file_size: number
  duration: number
  width: number
  height: number
  segments: { start: number; end: number }[]
  cached: boolean
}

/** Node Cắt video: giữ các đoạn đã chọn rồi ghép thành 1 video mới (không tốn credit). */
export async function cutMuseVideo(path: string, segments: { start: number; end: number }[], keepAudio = true): Promise<MuseCutResult> {
  const res = await fetch(`${API_URL}/api/workflow/muse/video-cut`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, segments, keep_audio: keepAudio }),
  })
  return detailOrThrow(res, 'Không cắt được video')
}

/** Dải khung hình (1 ảnh) của video để vẽ timeline. */
export const museVideoStripUrl = (path: string, width: number, height: number) =>
  `${API_URL}/api/workflow/muse/video-strip?path=${encodeURIComponent(path)}&w=${width}&h=${height}`

export const veoVideoUrl = (path: string) => `${API_URL}/api/veo/history/${encodeURIComponent(fileStem(path))}/file`

// ---------------------------------------------------------------- Ghép video (các clip Flow đã tạo)

export interface MergeJob {
  job_id: string
  status: 'running' | 'done' | 'error'
  step: string
  clip: number
  total: number
  result?: { filename?: string; file_path?: string; video_url?: string; duration_sec?: number; title?: string } | null
  error?: string | null
}

/** Bắt đầu ghép (chạy nền ở backend); trả job_id. Lỗi kiểm tra đầu vào (clip thiếu, cắt quá tay) -> throw kèm "Clip N: …". */
export async function startMerge(body: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${API_URL}/api/workflow/muse/merge`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  if (res.status === 404 && d.detail === 'Not Found') throw new Error('Backend chưa có chức năng ghép video — hãy khởi động lại backend.')
  if (!res.ok) {
    const detail = Array.isArray(d.detail) ? d.detail.map((x: any) => x?.msg).filter(Boolean).join('; ') : d.detail
    throw new Error(typeof detail === 'string' && detail ? detail : `Không bắt đầu ghép được (HTTP ${res.status})`)
  }
  return d.job_id as string
}

/** null = backend không còn job này (đã khởi động lại). */
export async function getMergeJob(jobId: string): Promise<MergeJob | null> {
  const res = await fetch(`${API_URL}/api/workflow/muse/merge/${encodeURIComponent(jobId)}`)
  if (res.status === 404) return null
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(typeof d.detail === 'string' ? d.detail : `Không đọc được job ghép (HTTP ${res.status})`)
  return d as MergeJob
}

/** Khung hình đầu / cuối của 1 clip (JPEG) — xem trước điểm nối. */
export const mergeFrameUrl = (path: string, at: 'first' | 'last', width = 200) =>
  `${API_URL}/api/workflow/muse/merge/frame?path=${encodeURIComponent(path)}&at=${at}&w=${width}`

// ---------------------------------------------------------------- ChatGPT trong Muse Canvas (ngữ cảnh tạm thời)

export interface GptChatReply {
  ok: boolean
  provider: 'gpt'
  reply: string
  account_label: string
  duration_seconds: number
  pool?: GptChatPoolStatus
}

export class GptChatApiError extends Error {
  code: GptChatErrorCode
  pool?: GptChatPoolStatus

  constructor(message: string, code: GptChatErrorCode = 'all_failed', pool?: GptChatPoolStatus) {
    super(message)
    this.code = code
    this.pool = pool
  }
}

export async function fetchGptChatPoolStatus(): Promise<GptChatPoolStatus> {
  const res = await fetch(`${API_URL}/api/workflow/muse/gpt-chat/status`)
  return jsonOrThrow<GptChatPoolStatus>(res, 'Không đọc được trạng thái tài khoản ChatGPT')
}

export async function sendMuseGptChat(body: {
  message: string
  history: { role: 'user' | 'assistant'; content: string }[]
  reference_images?: string[]
}): Promise<GptChatReply> {
  const res = await fetch(`${API_URL}/api/workflow/muse/gpt-chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const d = await res.json().catch(() => ({}))
  if (res.status === 404 || res.status === 405) {
    throw new GptChatApiError('Backend chưa có chat GPT trong Muse Canvas — hãy khởi động lại backend.', 'all_failed')
  }
  const detail = d?.detail
  const pool = detail && typeof detail === 'object' ? (detail.pool as GptChatPoolStatus | undefined) : undefined
  const code = (detail && typeof detail === 'object' && typeof detail.code === 'string'
    ? detail.code
    : 'all_failed') as GptChatErrorCode
  const msg =
    detail && typeof detail === 'object' && typeof detail.message === 'string'
      ? detail.message
      : typeof detail === 'string' && detail
        ? detail
        : `ChatGPT lỗi (HTTP ${res.status})`
  if (!res.ok || !d?.ok) {
    throw new GptChatApiError(msg, code, pool)
  }
  if (!d.reply) {
    throw new GptChatApiError('ChatGPT trả lời rỗng.', 'all_failed', d.pool)
  }
  return d as GptChatReply
}
