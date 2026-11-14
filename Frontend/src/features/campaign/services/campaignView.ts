/** Hàm thuần dựng nhãn/huy hiệu từ trạng thái engine v3. Không gọi mạng, không React: dễ test. */
import type { ArtifactView, BlockView, BundleMember, ElementState, GarmentRef, Motion, Plan, PlanItem, RiskLevel, SceneItem, ScriptDoc, ScriptShot, ShotRole } from '../types.ts'

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted'
export interface Badge { label: string; tone: Tone; hint?: string }

/** Đang có việc chạy: có lượt thực thi, HOẶC bất kỳ phần tử nào còn run đang chạy (phòng ảnh chụp trạng thái lệch nhau). */
export function isRunning(state: { active_exec: string | null; blocks: BlockView[] } | null | undefined): boolean {
  if (!state) return false
  return !!state.active_exec || state.blocks.some(b => b.steps.some(s => s.elements.some(e => !!e.active_run)))
}

/** Mọi bước của đồ thị v3 đều có thực thi; danh sách này giữ để huy hiệu khối bỏ qua bước lạ của backend cũ. */
export const IMPLEMENTED_STEPS = new Set([
  'garment_source', 'fact_sheet', 'cast', 'cast_profile', 'cast_sheet', 'scene_set', 'style', 'scene_plate',
  'brief', 'format', 'script', 'scene_anchor', 'clip', 'voice', 'assemble', 'export_pack',
])

const REASON_TEXT: Record<string, string> = {
  prompt: 'prompt',
  tier: 'độ phân giải 360p/720p',
  logic: 'phiên bản logic bước',
  'params.count': 'số ảnh',
  'params.aspect': 'tỉ lệ',
  'params.duration': 'thời lượng',
  'params._nonce': 'yêu cầu tạo lại',
  'inputs.garment_source': 'ảnh sản phẩm',
  'inputs.cast': 'ảnh nhân vật',
  'inputs.cast_profile': 'hồ sơ nhân vật',
  'inputs.cast_sheet': 'cast sheet đã duyệt',
  'inputs.scene_set': 'các cảnh',
  'inputs.style': 'phong cách',
  'inputs.scene_plate': 'ảnh bối cảnh',
  'inputs.scene_anchor': 'khung chốt cảnh đã duyệt',
  'inputs.brief': 'brief',
  'inputs.format': 'format',
  'inputs.fact_sheet': 'hồ sơ áo',
  'inputs.script': 'kịch bản',
  'inputs.clip': 'clip đã duyệt',
  'inputs.voice': 'giọng đọc',
}

/** "inputs.scene_anchor[scene:2]" -> "khung chốt cảnh đã duyệt (cảnh 2)". */
export function reasonText(reason: string): string {
  const m = /^(.*)\[([^\]]+)\]$/.exec(reason)
  if (m) return `${REASON_TEXT[m[1]] ?? m[1]} (${elementLabel(m[2])})`
  return REASON_TEXT[reason] ?? reason
}

/** "scene:2" -> "cảnh 2", "shot:3" -> "shot 3". */
export function elementLabel(key: string): string {
  const m = /^(scene|shot):(\d+)$/.exec(key)
  if (!m) return key
  return `${m[1] === 'scene' ? 'cảnh' : 'shot'} ${m[2]}`
}

export function describeElement(el: ElementState | undefined): Badge {
  if (!el) return { label: 'Chưa có', tone: 'muted' }
  if (el.active_run) return { label: 'Đang chạy', tone: 'info' }
  if (el.state === 'blocked') {
    return { label: 'Chờ đầu vào', tone: 'muted', hint: el.blockers.map(b => `${b.dep}: ${b.reason}`).join('; ') }
  }
  if (el.state === 'missing') return { label: 'Chưa có', tone: 'muted' }
  if (el.state === 'pinned') return { label: el.stale ? 'Ghim (đã cũ)' : 'Ghim', tone: 'info' }
  if (el.state === 'stale') {
    return { label: 'Cũ', tone: 'warn', hint: 'Đổi: ' + (el.reasons.map(reasonText).join(', ') || 'đầu vào') }
  }
  return { label: 'Mới', tone: 'ok' }
}

export function describeGate(gate: ElementState['gate']): Badge | null {
  if (gate === 'approved') return { label: 'Đã duyệt', tone: 'ok' }
  if (gate === 'need_approval') return { label: 'Cần duyệt', tone: 'warn' }
  if (gate === 'rejected') return { label: 'Đã từ chối', tone: 'bad' }
  return null
}

/** Huy hiệu của cả khối, chỉ xét các bước đã có thực thi. */
export function blockBadge(block: BlockView): Badge {
  const steps = block.steps.filter(s => IMPLEMENTED_STEPS.has(s.key))
  if (steps.length === 0) return { label: 'Sắp có', tone: 'muted' }
  const els = steps.flatMap(s => s.elements)
  // Chưa có phần tử nào (vd. khung chốt cảnh khi chưa có cảnh): trước đây rơi xuống cuối và báo nhầm "Xong".
  if (els.length === 0) return { label: 'Chờ đầu vào', tone: 'muted' }
  if (els.some(e => e.active_run)) return { label: 'Đang chạy', tone: 'info' }
  if (els.some(e => e.gate === 'need_approval')) return { label: 'Cần duyệt', tone: 'warn' }
  if (els.some(e => e.state === 'stale')) return { label: 'Cũ', tone: 'warn' }
  if (els.some(e => e.state === 'missing')) return { label: 'Chưa có', tone: 'muted' }
  if (els.some(e => e.state === 'blocked')) return { label: 'Chờ đầu vào', tone: 'muted' }
  return { label: 'Xong', tone: 'ok' }
}

export function planSummary(plan: Plan | null): string {
  if (!plan) return ''
  const parts: string[] = []
  if (plan.images) parts.push(`${plan.images} ảnh ChatGPT`)
  if (plan.llm_calls) parts.push(`${plan.llm_calls} lượt LLM`)
  if (plan.unknown_cost_items && plan.estimated_credit) parts.push(`dự kiến ${plan.estimated_credit} credit Flow (${plan.unknown_cost_items} việc chưa đo được giá)`)
  else parts.push(plan.unknown_cost_items ? `${plan.total_credit} credit Flow (+${plan.unknown_cost_items} việc chưa rõ giá)` : `${plan.total_credit} credit Flow`)
  return plan.runnable ? `Sẽ chạy: ${parts.join(' · ')}` : 'Không có gì cần chạy'
}

const NOT_RUNNABLE = ['waiting', 'blocked', 'skip_not_approved', 'input_missing']

/** Việc của bước/phần tử này nếu kế hoạch cho biết nó KHÔNG chạy được (null = chạy được hoặc chưa rõ). */
export function planBlocker(plan: Plan | null, stepKey: string, elementKey: string): PlanItem | null {
  const item = plan?.items.find(i => i.step_key === stepKey && i.element_key === elementKey)
  return item && NOT_RUNNABLE.includes(item.action) ? item : null
}

/** Backend không khởi chạy gì (exec_id rỗng): nói rõ lý do thay vì im lặng. */
export function nothingToRunMessage(plan: Plan, target: string): string {
  const reasons = plan.items.filter(i => i.step_key === target && NOT_RUNNABLE.includes(i.action)).map(i => i.reason)
  return reasons.length
    ? `Chưa chạy được (${[...new Set(reasons)].join('; ')}).`
    : 'Không có gì cần chạy: kết quả hiện tại đã là mới nhất.'
}

/** Thành viên (ảnh theo thứ tự + vai trò) của artifact dạng bundle. */
export function bundleMembers(bundle: ArtifactView | undefined): BundleMember[] {
  const members = bundle?.meta?.members
  return Array.isArray(members) ? members.map((m: any) => ({ artifact_id: String(m.artifact_id), role: String(m.role ?? '') })) : []
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  return typeof error === 'string' ? error : 'Có lỗi không xác định.'
}

/** Backend lưu giờ UTC rồi trả isoformat KHÔNG kèm múi giờ: chuỗi không có múi giờ được hiểu là UTC. */
export function parseServerTime(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const hasZone = /([zZ]|[+-]\d{2}:?\d{2})$/.test(iso)
  const d = new Date(hasZone ? iso : `${iso.replace(' ', 'T')}Z`)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Ngày ngắn kiểu Việt Nam (dd/mm, thêm năm nếu khác năm nay). */
export function shortDate(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parseServerTime(iso)
  if (!d) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  return d.getFullYear() === now.getFullYear() ? `${dd}/${mm}` : `${dd}/${mm}/${d.getFullYear()}`
}

export const PLATFORM_LABEL: Record<string, string> = { tiktok: 'TikTok', reels: 'Reels', shopee: 'Shopee Video' }

/** Ngân sách credit Flow: phần trăm đã dùng (0–100) và mức cảnh báo. cap null = không giới hạn. */
export function budgetView(spent: number, cap: number | null | undefined): { pct: number | null; tone: Tone; label: string } {
  const used = Math.max(0, Number(spent) || 0)
  if (cap == null) return { pct: null, tone: 'muted', label: `${used} credit · không giới hạn` }
  const limit = Math.max(0, Number(cap) || 0)
  const pct = limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100))
  const tone: Tone = used >= limit ? 'bad' : pct >= 80 ? 'warn' : 'ok'
  return { pct, tone, label: `${used} / ${limit} credit` }
}

/** Chữ cái đại diện cho ô màu của chiến dịch (bỏ dấu tiếng Việt cho gọn). */
export function campaignInitial(name: string): string {
  const ch = (name.trim()[0] ?? '?').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'D')
  return ch.toUpperCase()
}

export function formatTime(iso: string | null | undefined): string {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

/** Trạng thái run -> nhãn tiếng Việt cho sổ chạy. */
export function runStateBadge(state: string): Badge {
  switch (state) {
    case 'done': return { label: 'Xong', tone: 'ok' }
    case 'cached': return { label: 'Dùng lại', tone: 'ok' }
    case 'running': case 'queued': return { label: 'Đang chạy', tone: 'info' }
    case 'error': return { label: 'Lỗi', tone: 'bad' }
    case 'cancelled': return { label: 'Đã hủy', tone: 'muted' }
    case 'unknown': return { label: 'Chưa rõ kết quả', tone: 'warn' }
    default: return { label: state, tone: 'muted' }
  }
}

export function riskBadge(level: RiskLevel | undefined): Badge {
  if (level === 'low') return { label: 'Rủi ro thấp', tone: 'ok' }
  if (level === 'medium') return { label: 'Rủi ro trung bình', tone: 'warn' }
  if (level === 'high') return { label: 'Rủi ro cao', tone: 'bad' }
  return { label: 'Chưa tính', tone: 'muted' }
}

export const MOTION_TEXT: Record<string, string> = {
  free: 'Chuyển động tự do',
  gentle: 'Chuyển động nhẹ, tránh xoay người',
  minimal: 'Chuyển động tối thiểu, ưu tiên cận ảnh thật',
}

export const PATTERN_LABEL: Record<string, string> = {
  solid: 'Trơn', small_print: 'Họa tiết nhỏ', stripes: 'Kẻ sọc', large_print: 'Họa tiết lớn',
  lace: 'Ren', sheer: 'Trong suốt', glossy: 'Vải bóng', other: 'Khác',
}

/** Ô nhiều dòng <-> danh sách (bỏ dòng trống, cắt khoảng trắng). */
export const linesToList = (text: string): string[] => text.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
export const listToLines = (list: string[] | undefined): string => (list ?? []).join(String.fromCharCode(10))

export const ROLE_LABEL: Record<string, string> = { hook: 'Hook', proof: 'Thấy rõ', detail: 'Cận chi tiết', cta: 'Kết (CTA)' }
export const HOOK_TYPE_LABEL: Record<string, string> = {
  direct: 'Nói thẳng vào máy', pain_question: 'Câu hỏi nỗi đau', surprise_visual: 'Hình ảnh bất ngờ', number_signal: 'Con số', story: 'Tình huống',
}
export const MOTION_LABEL: Record<string, string> = { minimal: 'Tối thiểu', gentle: 'Nhẹ', free: 'Tự do' }
export const GARMENT_REF_LABEL: Record<string, string> = { front: 'Ảnh mặt trước', detail: 'Ảnh cận chi tiết', back: 'Ảnh mặt sau' }
export const PRESENTATION_LABEL: Record<string, string> = { woman: 'Nữ', man: 'Nam', person: 'Không ghi giới tính' }

/** Luật lời thoại tiếng Việt đo trên giọng VieNeu: ≈3,7 âm tiết/giây, dung sai 15 % (khớp backend `max_syllables`). */
export const SYLLABLES_PER_SECOND = 3.7
export const maxSyllables = (seconds: number): number => Math.max(1, Math.round(Math.max(0, Number(seconds) || 0) * SYLLABLES_PER_SECOND * 1.15))
export const countSyllables = (text: string): number => (text.match(/[\p{L}\p{N}'’-]+/gu) ?? []).length

/** Số beat nên có theo thời lượng (khớp backend `beats_for`). */
export const beatsFor = (seconds: number): number => (seconds <= 5 ? 2 : seconds <= 10 ? 3 : 4)

/** Kịch bản do phiên bản cũ (v1/v2, trước "format") tạo: shot không có `beats`/`key` (chỉ shot, voiceover, chữ). */
export const LEGACY_SCRIPT_MSG =
  'Kịch bản này được tạo ở phiên bản cũ (trước khi có Format), không sửa được trong khung shot mới. ' +
  'Chọn format rồi bấm “Viết lại” để tạo kịch bản mới; bản cũ vẫn được giữ trong lịch sử.'

const asStr = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v == null ? d : String(v))
const asNum = (v: unknown, d: number): number => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d)

/**
 * Chuẩn hóa kịch bản đọc từ artifact trước khi đưa lên giao diện sửa.
 * - `null`: kịch bản dạng cũ (không shot nào có `beats`) → giao diện báo rõ thay vì vỡ trang
 *   (lỗi thật 2026-11-14: `s.beats.length` trên kịch bản v2 làm trắng toàn bộ app).
 * - Kịch bản v3 thiếu trường (sửa tay, Gemini bỏ sót) → bù giá trị mặc định cho mọi trường giao diện đọc.
 */
export function adaptScriptDoc(raw: unknown): ScriptDoc | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as Record<string, unknown>
  const items = Array.isArray(doc.items) ? (doc.items as Record<string, unknown>[]).filter(x => x && typeof x === 'object') : []
  if (items.length > 0 && !items.some(x => Array.isArray(x.beats))) return null
  const hook = (doc.hook && typeof doc.hook === 'object' ? doc.hook : {}) as Record<string, unknown>
  return {
    ...(doc as unknown as ScriptDoc),
    format_id: asStr(doc.format_id),
    angle_vi: asStr(doc.angle_vi),
    hook: { type: asStr(hook.type, 'direct') || 'direct', on_screen_text: asStr(hook.on_screen_text) },
    caption: asStr(doc.caption),
    cta: asStr(doc.cta),
    hashtags: Array.isArray(doc.hashtags) ? doc.hashtags.map(h => asStr(h)) : [],
    motion_limit: (['minimal', 'gentle', 'free'].includes(asStr(doc.motion_limit)) ? doc.motion_limit : 'free') as Motion,
    total_seconds: asNum(doc.total_seconds, 0),
    items: items.map((x, i) => {
      const cam = (x.camera && typeof x.camera === 'object' ? x.camera : {}) as Record<string, unknown>
      const duration = asNum(x.duration, 5)
      return {
        ...(x as unknown as ScriptShot),
        key: asStr(x.key) || `shot:${i + 1}`,
        role: (asStr(x.role) || 'proof') as ShotRole,
        scene: asStr(x.scene) || 'scene:1',
        duration,
        camera: { angle: asStr(cam.angle), lens: asStr(cam.lens), move: asStr(cam.move) },
        needs_face: x.needs_face == null ? true : !!x.needs_face,
        garment_ref: (['front', 'detail', 'back'].includes(asStr(x.garment_ref)) ? x.garment_ref : 'front') as GarmentRef,
        motion: (['minimal', 'gentle', 'free'].includes(asStr(x.motion)) ? x.motion : 'gentle') as Motion,
        beats: Array.isArray(x.beats) ? x.beats.map(b => asStr(b)) : [],
        expression: asStr(x.expression),
        voiceover: asStr(x.voiceover),
        on_screen_text: asStr(x.on_screen_text),
        max_syllables: asNum(x.max_syllables, maxSyllables(duration)),
      }
    }),
  }
}

/** Các cảnh trong tham số bước `scene_set` (bỏ phần tử hỏng, cấp khóa nếu thiếu). */
export function sceneItems(params: Record<string, any> | undefined): SceneItem[] {
  const raw = params?.items
  if (!Array.isArray(raw)) return []
  return raw.filter((x: unknown) => x && typeof x === 'object').map((x: any, i: number) => ({
    key: String(x.key || `scene:${i + 1}`), name: String(x.name ?? ''), place: String(x.place ?? ''), time: String(x.time ?? ''),
    light: String(x.light ?? ''), mood: String(x.mood ?? ''), action: String(x.action ?? ''),
  }))
}

/** Tên hiển thị của một cảnh: tên người dùng đặt, không thì nơi quay, không thì "cảnh N". */
export function sceneName(scenes: SceneItem[], key: string): string {
  const s = scenes.find(x => x.key === key)
  return s?.name.trim() || s?.place.trim() || elementLabel(key)
}

/** Điền gợi ý vào các ô đang TRỐNG (không ghi đè điều người dùng đã gõ). Trả form mới + danh sách ô đã điền. */
export function fillEmpty(draft: Record<string, string>, suggestion: Record<string, string>, keys: string[]):
  { next: Record<string, string>; filled: string[] } {
  const next = { ...draft }
  const filled: string[] = []
  for (const k of keys) {
    const value = (suggestion[k] ?? '').trim()
    if (value && !(next[k] ?? '').trim()) { next[k] = value; filled.push(k) }
  }
  return { next, filled }
}

/** Thông điệp lỗi HTTP. "Not Found" trần của FastAPI = backend đang chạy chưa có route này (chưa nạp bản mới). */
export function httpErrorMessage(status: number, detail: string, action: string): string {
  if (status === 404 && detail.trim().toLowerCase() === 'not found') {
    return `Backend đang chạy chưa có chức năng này (${action}). Hãy khởi động lại Backend để nạp bản mới rồi thử lại.`
  }
  return detail || `${action} thất bại (HTTP ${status})`
}

/** "Khung đầu: đang tạo… · 42 giây" từ tiến độ backend báo + thời gian đã trôi qua. */
export function progressText(progress: { message: string; started_at: number } | null | undefined, nowMs: number = Date.now()): string {
  if (!progress) return ''
  const seconds = Math.max(0, Math.round(nowMs / 1000 - progress.started_at))
  const mins = Math.floor(seconds / 60)
  const elapsed = mins > 0 ? `${mins} phút ${seconds % 60} giây` : `${seconds} giây`
  return `${progress.message} · đã ${elapsed}`
}

/** Giao diện cần backend có các executor/cổng này; thiếu = backend đang chạy là bản cũ (v2). */
export const EXPECTED_EXECUTORS = ['fact_sheet', 'cast_sheet', 'scene_plate', 'script', 'scene_anchor', 'clip', 'voice', 'assemble', 'export_pack']
export const EXPECTED_GATES = ['cast_sheet', 'scene_anchor', 'clip']

export interface BackendMeta { executors: string[]; gated_steps: string[]; features?: string[] }

/** Trả thông báo tiếng Việt nếu backend đang chạy thiếu chức năng giao diện cần; null nếu ổn. meta=null: không có /meta (backend rất cũ). */
export function backendMismatch(meta: BackendMeta | null): string | null {
  const fix = 'Cách sửa: dừng `npm start` (Ctrl+C), đảm bảo KHÔNG còn backend cũ giữ cổng 8000 (nếu terminal ghi "[BACKEND] đã chạy sẵn, dùng lại service" nghĩa là còn), rồi chạy lại `npm start`.'
  if (!meta) return `Backend đang chạy là bản cũ (chưa có /api/campaigns/meta). ${fix}`
  const missingExec = EXPECTED_EXECUTORS.filter(k => !meta.executors.includes(k))
  const missingGates = EXPECTED_GATES.filter(k => !meta.gated_steps.includes(k))
  if (!missingExec.length && !missingGates.length) return null
  const parts = [
    missingExec.length ? `chưa có bước chạy: ${missingExec.join(', ')}` : '',
    missingGates.length ? `chưa có cổng duyệt: ${missingGates.join(', ')}` : '',
  ].filter(Boolean)
  return `Backend đang chạy là bản cũ (${parts.join('; ')}). ${fix}`
}
