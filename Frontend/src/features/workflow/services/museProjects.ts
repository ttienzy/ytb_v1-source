/**
 * Muse Canvas — nhiều project (thuần TS, không React/DOM, để node:test chạy được).
 *
 * Backend: /api/workflow/muse/projects (app/workflow/muse_projects.py). Mỗi project = 1 đồ thị canvas + cài đặt riêng
 * (project Google Flow, khung hình, chất lượng, tiền tố file). Phần còn lại của cấu hình (tài khoản Muse, chat, chờ,
 * song song) dùng chung — `applyProjectSettings` ghép hai phần thành cấu hình node thấy.
 *
 * Nhân bản (`copyGraph`): MỌI id node được đổi mới (kể cả chỗ dữ liệu node nhắc tới id: kết quả theo nguồn, thứ tự,
 * cắt clip, origin…) — lượt chạy (museRuns), khóa chống trùng job Flow và vòng hỏi đều theo id node, hai project trùng
 * id sẽ nhận nhầm kết quả của nhau. Chế độ 'template' bỏ thêm mọi kết quả đã tạo, giữ cấu trúc + prompt + ảnh vào.
 */
import { MUSE_NODE, isJobType, museNodeId, type MuseEdgeLike, type MuseNodeLike } from './museCanvasNodes.ts'
import { normalizeFlowSeconds, normalizeFlowVariants, type MuseCanvasConfig } from './museCanvasConfig.ts'

export interface MuseProjectSettings {
  flowProjectId: string
  flowAspect: '9:16' | '16:9'
  flowResolution: '720p' | '360p'
  /** 0 = Tự động; 3–15 giây */
  flowSeconds: number
  /** 1–4 biến thể mỗi lần Tạo video */
  flowVariants: number
  filePrefix: string
}

export interface MuseProjectMeta {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  nodeCount: number
  edgeCount: number
  settings: MuseProjectSettings
}

export interface MuseProjectIndex {
  activeId: string
  projects: MuseProjectMeta[]
}

/** Khóa cấu hình thuộc project (sửa trong panel thì ghi vào project đang mở, không vào cấu hình chung). */
export const PROJECT_SETTING_KEYS = ['flowProjectId', 'flowAspect', 'flowResolution', 'flowSeconds', 'flowVariants', 'filePrefix'] as const
export type ProjectSettingKey = (typeof PROJECT_SETTING_KEYS)[number]
export const isProjectSettingKey = (k: string): k is ProjectSettingKey => (PROJECT_SETTING_KEYS as readonly string[]).includes(k)

export const DEFAULT_PROJECT_SETTINGS: MuseProjectSettings = {
  flowProjectId: '',
  flowAspect: '9:16',
  flowResolution: '720p',
  flowSeconds: 0,
  flowVariants: 1,
  filePrefix: 'muse_canvas',
}

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '')
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

export function normalizeProjectSettings(raw: unknown): MuseProjectSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const get = (camel: string, snake: string) => (camel in r ? r[camel] : r[snake])
  const aspect = get('flowAspect', 'flow_aspect')
  const res = get('flowResolution', 'flow_resolution')
  return {
    flowProjectId: str(get('flowProjectId', 'flow_project_id'), 64),
    flowAspect: aspect === '16:9' ? '16:9' : '9:16',
    flowResolution: res === '360p' ? '360p' : '720p',
    flowSeconds: normalizeFlowSeconds(get('flowSeconds', 'flow_seconds')),
    flowVariants: normalizeFlowVariants(get('flowVariants', 'flow_variants')),
    filePrefix: str(get('filePrefix', 'file_prefix'), 40).replace(/[^A-Za-z0-9_-]/g, '_') || DEFAULT_PROJECT_SETTINGS.filePrefix,
  }
}

export const projectSettingsToApi = (s: MuseProjectSettings) => ({
  flow_project_id: s.flowProjectId,
  flow_aspect: s.flowAspect,
  flow_resolution: s.flowResolution,
  flow_seconds: s.flowSeconds,
  flow_variants: s.flowVariants,
  file_prefix: s.filePrefix,
})

export function normalizeProjectMeta(raw: unknown): MuseProjectMeta | null {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const id = str(r.id, 48)
  if (!id) return null
  return {
    id,
    name: str(r.name, 80) || 'Project',
    // backend gửi giây (time.time()); giữ ms cho Date. Bản cache trên máy cũng là JSON thô của backend.
    createdAt: Math.round(num(r.created_at) * 1000),
    updatedAt: Math.round(num(r.updated_at) * 1000),
    nodeCount: num(r.node_count),
    edgeCount: num(r.edge_count),
    settings: normalizeProjectSettings(r.settings),
  }
}

export function normalizeProjectIndex(raw: unknown): MuseProjectIndex {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const list = Array.isArray(r.projects) ? r.projects : []
  const projects = list.map(normalizeProjectMeta).filter((p): p is MuseProjectMeta => !!p)
  const want = str(r.active_id, 48)
  const activeId = projects.some((p) => p.id === want) ? want : (sortProjects(projects)[0]?.id ?? '')
  return { activeId, projects }
}

/** Mới sửa nhất trước. */
export const sortProjects = (projects: MuseProjectMeta[]) => [...projects].sort((a, b) => b.updatedAt - a.updatedAt)

/** Cấu hình node thấy = cấu hình chung + cài đặt của project đang mở. */
export function applyProjectSettings(config: MuseCanvasConfig, s: MuseProjectSettings | null | undefined): MuseCanvasConfig {
  return s ? { ...config, ...s } : config
}

/** Tên không trùng: "Áo xanh" → "Áo xanh (2)" … */
export function uniqueProjectName(base: string, existing: string[]): string {
  const name = base.trim() || 'Project mới'
  const taken = new Set(existing.map((n) => n.trim().toLowerCase()))
  if (!taken.has(name.toLowerCase())) return name
  const stem = name.replace(/\s*\(\d+\)$/, '')
  for (let i = 2; i < 1000; i++) {
    const cand = `${stem} (${i})`
    if (!taken.has(cand.toLowerCase())) return cand
  }
  return `${stem} (${Date.now().toString(36)})`
}

// ---------------------------------------------------------------- nhân bản

export type CopyMode = 'copy' | 'template'

export interface GraphLike {
  nodes: MuseNodeLike[]
  edges: MuseEdgeLike[]
  viewport?: { x: number; y: number; zoom: number } | null
}

/** Node tách ra bằng "Ra node" từ kết quả — làm mẫu thì bỏ, chạy lại rồi "Ra node" sẽ tạo mới. */
const DERIVED_TYPES: string[] = [MUSE_NODE.scriptText, MUSE_NODE.videoOutput, MUSE_NODE.clipPrompt]

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

function remapIn(value: unknown, re: RegExp | null, map: Map<string, string>): unknown {
  if (!re) return value
  if (typeof value === 'string') return value.replace(re, (m) => map.get(m) ?? m)
  if (Array.isArray(value)) return value.map((v) => remapIn(v, re, map))
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k.replace(re, (m) => map.get(m) ?? m)] = remapIn(v, re, map)
    return out
  }
  return value
}

/** Lượt đang chạy ở project gốc lúc nhân bản: bản sao không có gì chờ phía sau -> báo lỗi rõ ràng (không tự gửi lại). */
function stopRunning(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stopRunning)
  if (value && typeof value === 'object') {
    const o = value as Record<string, unknown>
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(o)) out[k] = stopRunning(v)
    if (o.status === 'running') {
      out.status = 'error'
      out.error = 'Bản sao: lượt này đang chạy ở project gốc lúc nhân bản — xem kết quả ở project gốc.'
    }
    return out
  }
  return value
}

function templateData(type: string | undefined, data: Record<string, unknown>): Record<string, unknown> {
  if (isJobType(type)) return { ...data, results: {} } // mọi node chạy ra ảnh (Tách áo quần, Bảng nhân vật, Nhân vật trong bối cảnh…)
  switch (type) {
    case MUSE_NODE.output:
      return { ...data, image: null }
    case MUSE_NODE.script:
    case MUSE_NODE.clipScript:
      return { ...data, result: null }
    case MUSE_NODE.clipMerge:
      return { ...data, merge: null, order: [], trims: {}, origin: data.origin ?? null }
    case MUSE_NODE.videoIngredients:
      // giữ prompt / đoạn cắt / thứ tự ảnh, bỏ video Flow đã tạo
      return { ...data, videos: [], video: undefined }
    case MUSE_NODE.videoCut:
      // giữ các vết cắt, bỏ video đã cắt (cắt lại ở project mới)
      return { ...data, video: null, resultKey: '', status: 'idle', error: '' }
    default:
      return data
  }
}

/**
 * Bản sao đồ thị cho project mới: id node / dây mới, mọi chỗ nhắc id cũ trong dữ liệu được đổi theo.
 * 'template': bỏ kết quả đã tạo (ảnh, kịch bản, video, bản ghép) và các node tách ra từ kết quả; giữ ảnh vào, prompt, cài đặt.
 */
export function copyGraph(graph: GraphLike, mode: CopyMode, newId: (prefix: string) => string = museNodeId): GraphLike {
  let nodes = graph.nodes
  let edges = graph.edges
  if (mode === 'template') {
    const drop = new Set(nodes.filter((n) => n.type && DERIVED_TYPES.includes(n.type)).map((n) => n.id))
    nodes = nodes.filter((n) => !drop.has(n.id))
    edges = edges.filter((e) => !drop.has(e.source) && !drop.has(e.target))
  }
  const map = new Map<string, string>()
  for (const n of nodes) map.set(n.id, newId(n.id.split('-')[0] || 'node'))
  const ids = [...map.keys()].sort((a, b) => b.length - a.length).map(escapeRe)
  // id đứng riêng (không dính chữ / số / gạch nối hai bên): "a|b", "job:a::b" vẫn khớp, "a-12" không khớp "a-1"
  const re = ids.length ? new RegExp(`(?<![A-Za-z0-9_-])(?:${ids.join('|')})(?![A-Za-z0-9_-])`, 'g') : null

  const outNodes = nodes.map((n) => {
    let data = remapIn(n.data ?? {}, re, map) as Record<string, unknown>
    data = mode === 'template' ? templateData(n.type, data) : (stopRunning(data) as Record<string, unknown>)
    return { ...n, id: map.get(n.id)!, data }
  })
  const outEdges = edges
    .filter((e) => map.has(e.source) && map.has(e.target))
    .map((e) => {
      const source = map.get(e.source)!
      const target = map.get(e.target)!
      return { ...e, id: `e-${source}-${e.sourceHandle ?? ''}-${target}-${e.targetHandle ?? ''}`, source, target }
    })
  // React Flow giữ cờ chọn trong node / dây: bản sao bắt đầu không chọn gì
  for (const n of outNodes as (MuseNodeLike & { selected?: boolean })[]) delete n.selected
  for (const e of outEdges as (MuseEdgeLike & { selected?: boolean })[]) delete e.selected
  return { nodes: outNodes, edges: outEdges, viewport: graph.viewport ?? null }
}

/** Số lượt đang chờ (Muse / ChatGPT / xuất video) thuộc các node này — để báo khi đổi project. */
export function countRunsFor(nodeIds: Iterable<string>, runningKeys: string[], keyNodeId: (key: string) => string): number {
  const set = new Set(nodeIds)
  return runningKeys.filter((k) => set.has(keyNodeId(k))).length
}
