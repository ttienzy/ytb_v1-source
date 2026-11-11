/** Hàm thuần dựng nhãn/huy hiệu từ trạng thái engine. Không gọi mạng, không React: dễ test. */
import type { ArtifactView, BlockView, BundleMember, ElementState, Plan, PlanItem, RiskLevel } from '../types.ts'

export type Tone = 'ok' | 'warn' | 'bad' | 'info' | 'muted'
export interface Badge { label: string; tone: Tone; hint?: string }

/** Bước đã có thực thi thật. Khối nào không có bước ở đây sẽ hiện "Sắp có". */
/** Đang có việc chạy: có lượt thực thi, HOẶC bất kỳ phần tử nào còn run đang chạy (phòng ảnh chụp trạng thái lệch nhau). */
export function isRunning(state: { active_exec: string | null; blocks: BlockView[] } | null | undefined): boolean {
  if (!state) return false
  return !!state.active_exec || state.blocks.some(b => b.steps.some(s => s.elements.some(e => !!e.active_run)))
}

export const IMPLEMENTED_STEPS = new Set(['garment_source', 'fact_sheet', 'cast', 'style', 'brief', 'angle', 'hook', 'shot_plan', 'script', 'look', 'anchor_frame', 'storyboard', 'clip', 'voice', 'assemble'])

/** Khối chưa làm -> giai đoạn dự kiến (docs/PLAN_ai_workflow_campaign.md). */
export const BLOCK_PHASE: Record<number, string> = { 1: 'GĐ3', 2: 'GĐ3', 3: 'GĐ5', 4: 'GĐ4', 5: 'GĐ6', 6: 'GĐ7', 7: 'GĐ8', 8: 'GĐ8' }

const REASON_TEXT: Record<string, string> = {
  prompt: 'prompt',
  tier: 'độ phân giải 360p/720p',
  logic: 'phiên bản logic bước',
  'params.count': 'số ảnh',
  'params.aspect': 'tỉ lệ',
  'params._nonce': 'yêu cầu tạo lại',
  'inputs.garment_source': 'ảnh sản phẩm',
  'inputs.cast': 'ảnh nhân vật',
  'inputs.style': 'phong cách',
  'inputs.brief': 'brief',
  'inputs.look': 'ảnh mẫu đã duyệt',
  'inputs.storyboard': 'storyboard đã duyệt',
  'inputs.anchor_frame': 'khung mẫu đã duyệt',
  'inputs.shot_plan': 'danh sách shot',
}

export function reasonText(reason: string): string {
  return REASON_TEXT[reason] ?? reason
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
  if (steps.length === 0) return { label: `Sắp có (${BLOCK_PHASE[block.block] ?? ''})`.trim(), tone: 'muted' }
  const els = steps.flatMap(s => s.elements)
  if (els.some(e => e.active_run)) return { label: 'Đang chạy', tone: 'info' }
  if (els.some(e => e.gate === 'need_approval')) return { label: 'Cần duyệt', tone: 'warn' }
  if (els.some(e => e.state === 'stale')) return { label: 'Cũ', tone: 'warn' }
  if (els.some(e => e.state === 'missing')) return { label: 'Chưa có', tone: 'muted' }
  if (els.some(e => e.state === 'blocked')) return { label: 'Chờ đầu vào', tone: 'muted' }
  return { label: 'Xong', tone: 'ok' }
}

export const BOARD_LABEL: Record<string, string> = {
  hero_walk: 'Bước tới', turn_reveal: 'Xoay khoe dáng', pose_sequence: 'Chuỗi tạo dáng', detail_macro: 'Cận chi tiết',
  fabric_touch: 'Chạm vải', still_life: 'Tĩnh vật', closer_cta: 'Kết',
}

/** Các nhịp của shot; kế hoạch tạo trước v2.4 chưa có `panels` thì lấy từ mô tả khung đầu/khác biệt cũ (như backend). */
export function shotPanels(s: { panels?: { framing: string; action: string }[]; framing?: string; keyframe_start?: string; end_delta?: string }): { framing: string; action: string }[] {
  if (s.panels?.length) return s.panels
  return [s.keyframe_start, s.end_delta].filter((a): a is string => !!a).map(action => ({ framing: s.framing ?? 'medium', action }))
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

export const ROLE_LABEL: Record<string, string> = { hook: 'Hook', benefit: 'Lợi ích', cta: 'Kêu gọi (CTA)' }
export const HOOK_TYPE_LABEL: Record<string, string> = {
  contrast: 'Đối lập', direct: 'Nói thẳng vào máy', pain_question: 'Câu hỏi nỗi đau', surprise_visual: 'Hình ảnh bất ngờ',
  number_signal: 'Con số', other: 'Khác',
}
export const MOTION_LABEL: Record<string, string> = { minimal: 'Tối thiểu', gentle: 'Nhẹ', free: 'Tự do' }

/** Số từ lời thoại tối đa hợp với số giây (khoảng 3 từ/giây, khớp luật backend). */
export const maxWords = (seconds: number): number => Math.max(0, Math.round(seconds)) * 3
export const countWords = (text: string): number => (text.match(/\S+/g) ?? []).length

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

/** Giao diện cần backend có các executor/cổng này; thiếu = backend đang chạy là bản cũ. */
export const EXPECTED_EXECUTORS = ['fact_sheet', 'angle', 'hook', 'shot_plan', 'script', 'look', 'anchor_frame', 'storyboard', 'clip', 'voice', 'assemble']
export const EXPECTED_GATES = ['look', 'anchor_frame', 'storyboard', 'clip']

export interface BackendMeta { executors: string[]; gated_steps: string[] }

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
