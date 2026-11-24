/**
 * Muse Canvas — trợ lý ChatGPT tạm thời dưới đáy canvas (thuần TS, không React/DOM, để node:test chạy được).
 *
 * Ngữ cảnh chat chỉ giữ trong RAM ở client và gửi theo từng lượt (không lưu localStorage / canvas.json):
 * tắt app hoặc tải lại trang là tự reset.
 */
import {
  MUSE_NODE,
  type MuseImageRef,
  type MuseNodeLike,
} from './museCanvasNodes.ts'

export type GptChatRole = 'user' | 'assistant'

export type GptChatErrorCode =
  | 'no_accounts'
  | 'all_busy'
  | 'all_cooldown'
  | 'auth_expired'
  | 'all_failed'
  | 'missing_reference'

export interface GptChatPoolAccount {
  id: string
  email: string
  state: 'free' | 'busy' | 'cooldown'
  retry_after_seconds: number
  reason: string
}

export interface GptChatPoolStatus {
  total: number
  free: number
  busy: number
  cooldown: number
  retry_after_seconds: number
  accounts: GptChatPoolAccount[]
}

export interface GptChatAttachment {
  path: string
  previewUrl: string
  label: string
  sourceNodeId?: string
}

export interface GptChatMessage {
  id: string
  role: GptChatRole
  content: string
  attachments?: GptChatAttachment[]
  accountLabel?: string
  durationSeconds?: number
  createdAt: number
}

export const GPT_CHAT_MAX_HISTORY_TURNS = 10
export const GPT_CHAT_MAX_CONTEXT_CHARS = 16000
export const GPT_CHAT_MAX_ATTACHMENTS = 6

const IMAGE_NODE_TYPES: ReadonlySet<string> = new Set([
  MUSE_NODE.outfit,
  MUSE_NODE.character,
  MUSE_NODE.scene,
  MUSE_NODE.output,
])

const NODE_DEFAULT_LABEL: Record<string, string> = {
  [MUSE_NODE.outfit]: 'Trang phục',
  [MUSE_NODE.character]: 'Nhân vật',
  [MUSE_NODE.scene]: 'Bối cảnh',
  [MUSE_NODE.output]: 'Ảnh kết quả',
}

/** Gom mọi ảnh đang có trên các node ảnh của canvas (khử trùng theo đường dẫn file). */
export function collectCanvasImages(nodes: readonly MuseNodeLike[]): GptChatAttachment[] {
  const seen = new Set<string>()
  const out: GptChatAttachment[] = []
  for (const n of nodes) {
    if (!n.type || !IMAGE_NODE_TYPES.has(n.type)) continue
    const img = (n.data?.image ?? null) as MuseImageRef | null
    const path = typeof img?.path === 'string' ? img.path.trim() : ''
    if (!path || seen.has(path)) continue
    seen.add(path)
    const rawLabel = typeof n.data?.label === 'string' ? n.data.label.trim() : ''
    const fallback = NODE_DEFAULT_LABEL[n.type] || 'Ảnh'
    out.push({
      path,
      previewUrl: typeof img?.previewUrl === 'string' ? img.previewUrl : '',
      label: rawLabel || img?.name || fallback,
      sourceNodeId: n.id,
    })
  }
  return out
}

/** Cắt lịch sử chat theo cửa sổ trượt (tối đa maxTurns lượt gần nhất và <= maxChars ký tự) để gửi backend. */
export function trimChatHistory(
  messages: readonly Pick<GptChatMessage, 'role' | 'content'>[],
  maxTurns: number = GPT_CHAT_MAX_HISTORY_TURNS,
  maxChars: number = GPT_CHAT_MAX_CONTEXT_CHARS,
): { role: GptChatRole; content: string }[] {
  const valid = messages
    .map((m) => ({ role: m.role, content: (m.content || '').trim() }))
    .filter((m) => (m.role === 'user' || m.role === 'assistant') && m.content.length > 0)
  const slice = valid.slice(-Math.max(0, maxTurns))
  const kept: { role: GptChatRole; content: string }[] = []
  let total = 0
  for (let i = slice.length - 1; i >= 0; i--) {
    const item = slice[i]
    if (kept.length > 0 && total + item.content.length > maxChars) break
    kept.push(
      kept.length === 0 && item.content.length > maxChars
        ? { role: item.role, content: item.content.slice(0, maxChars) }
        : item,
    )
    total += item.content.length
  }
  return kept.reverse()
}

export function formatPoolBadge(pool: GptChatPoolStatus | null): {
  text: string
  tone: 'ok' | 'busy' | 'warn' | 'empty'
} {
  if (!pool) return { text: 'GPT', tone: 'ok' }
  if (pool.total === 0) return { text: 'Chưa có acc GPT', tone: 'empty' }
  if (pool.free > 0) return { text: `GPT · ${pool.free}/${pool.total} rảnh`, tone: 'ok' }
  if (pool.busy > 0) return { text: `GPT · 0/${pool.total} rảnh (${pool.busy} đang bận)`, tone: 'busy' }
  if (pool.cooldown > 0) {
    const mins = Math.max(1, Math.ceil((pool.retry_after_seconds || 60) / 60))
    return { text: `GPT · tạm giới hạn (~${mins}p)`, tone: 'warn' }
  }
  return { text: `GPT · 0/${pool.total} khả dụng`, tone: 'warn' }
}

/** Rút tiêu đề ngắn gọn cho Ô prompt khi đẩy kết quả từ khung chat ra canvas. */
export function promptBoxLabelFromReply(reply: string): string {
  for (const line of reply.split(/\r?\n/)) {
    const cleaned = line
      .replace(/^[\s#>*\-•]+/, '')
      .replace(/[*_`]+/g, '')
      .trim()
    if (!cleaned) continue
    return cleaned.length > 42 ? `${cleaned.slice(0, 41)}…` : cleaned
  }
  return 'Kịch bản GPT'
}
