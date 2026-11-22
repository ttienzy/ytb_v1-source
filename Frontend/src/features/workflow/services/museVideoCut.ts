/**
 * Node "Cắt video" của Muse Canvas — độc lập: nhận 1 video (cổng "Video" nối từ node Video tham chiếu hoặc từ một node
 * Cắt video khác), cho cắt NHIỀU khúc như CapCut (tách tại đầu phát, xóa / khôi phục từng đoạn, kéo mép đoạn), xem trước
 * kết quả (phát bỏ qua đoạn đã xóa) rồi "Cắt & lưu" thành 1 video mới. Cổng ra "Video" nối tiếp vào node Ingredients
 * hoặc một node Cắt video khác (kết quả nằm ở `data.video`, cùng dạng với node Video tham chiếu).
 *
 * Mô hình: `pieces` luôn phủ liền mạch [0, duration] của video nguồn; mỗi đoạn có cờ `removed`. Mọi thao tác là hàm thuần
 * (không React / DOM) để node:test chạy được. Thời gian làm tròn 0,01 giây.
 */
import type { XYPosition } from '@xyflow/react'
import {
  MUSE_NODE,
  museNodeId,
  normalizeVideoRefData,
  type MuseNodeLike,
  type MuseVideoRef,
} from './museCanvasNodes.ts'
import { cutKeptSegments, cutResultKey, type CutPiece } from './museVideoCutKey.ts'

export { cutCompleteVideo, cutKeptSegments, cutResultKey, type CutPiece } from './museVideoCutKey.ts'

export interface MuseVideoCutData {
  title: string
  label: string
  /** Đường dẫn video nguồn mà `pieces` thuộc về — đổi nguồn thì các vết cắt cũ vô nghĩa, bắt đầu lại */
  sourcePath: string
  /** Độ dài video nguồn (giây) lúc dựng `pieces` */
  duration: number
  pieces: CutPiece[]
  /** Video đã cắt & lưu (cùng dạng MuseVideoRef để node sau đọc như video tham chiếu) */
  video: MuseVideoRef | null
  /** Dấu vân tay (nguồn + đoạn giữ lại) lúc cắt — khác hiện tại thì `video` là bản cũ */
  resultKey: string
  status: 'idle' | 'cutting' | 'error'
  error: string
  [key: string]: unknown
}

export const VIDEO_CUT_TITLE = 'Cắt video'
/** Đoạn ngắn nhất khi tách / kéo mép (giây) */
export const CUT_MIN_PIECE = 0.1
/** Video sau cắt ngắn hơn ngưỡng này thì backend từ chối */
export const CUT_MIN_RESULT = 0.3
/** Flow nhận tối đa 15 giây video mẫu (xem node Ingredients) */
export const CUT_FLOW_MAX_SECONDS = 15
export const CUT_MAX_PIECES = 60
export const CUT_FRAME = 1 / 30

const r2 = (n: number) => Math.round(n * 100) / 100
const finite = (v: unknown, d = 0) => (typeof v === 'number' && Number.isFinite(v) ? v : d)

// ---------------------------------------------------------------- dữ liệu node

export function createVideoCutNode(position: XYPosition, id = museNodeId('videocut')): MuseNodeLike {
  const data: MuseVideoCutData = {
    title: VIDEO_CUT_TITLE,
    label: '',
    sourcePath: '',
    duration: 0,
    pieces: [],
    video: null,
    resultKey: '',
    status: 'idle',
    error: '',
  }
  return { id, type: MUSE_NODE.videoCut, position, data }
}

/** Chuẩn hóa `pieces` đọc từ bản lưu (có thể hỏng): sắp xếp, cắt vào [0, duration], lấp khoảng hở, gộp đoạn quá ngắn. */
export function cutNormalizePieces(raw: unknown, duration: number): CutPiece[] {
  if (!(duration > 0)) return []
  const list: CutPiece[] = Array.isArray(raw)
    ? raw
        .filter((p): p is Record<string, unknown> => !!p && typeof p === 'object')
        .map((p) => ({ start: finite(p.start, NaN), end: finite(p.end, NaN), removed: p.removed === true }))
        .filter((p) => Number.isFinite(p.start) && Number.isFinite(p.end) && p.end > p.start)
        .sort((a, b) => a.start - b.start)
    : []
  if (!list.length) return cutInitPieces(duration)
  const out: CutPiece[] = []
  let cursor = 0
  for (const p of list) {
    const start = Math.max(cursor, Math.min(p.start, duration))
    const end = Math.min(duration, Math.max(p.end, start))
    if (end - start < CUT_MIN_PIECE - 1e-9) continue
    if (start > cursor + 1e-6) {
      // khoảng hở: nối dài đoạn trước (hoặc đoạn đầu) cho liền mạch
      if (out.length) out[out.length - 1] = { ...out[out.length - 1], end: start }
      else out.push({ start: 0, end: start, removed: false })
    }
    out.push({ start: r2(start), end: r2(end), removed: p.removed })
    cursor = end
  }
  if (!out.length) return cutInitPieces(duration)
  out[0] = { ...out[0], start: 0 }
  out[out.length - 1] = { ...out[out.length - 1], end: r2(duration) }
  return out.slice(0, CUT_MAX_PIECES)
}

export const cutInitPieces = (duration: number): CutPiece[] => (duration > 0 ? [{ start: 0, end: r2(duration), removed: false }] : [])

export function normalizeVideoCutData(raw: Record<string, unknown> | undefined): MuseVideoCutData {
  const d = raw ?? {}
  const duration = finite(d.duration) > 0 ? r2(finite(d.duration)) : 0
  const video = normalizeVideoRefData({ video: d.video }).video
  return {
    title: typeof d.title === 'string' && d.title.trim() ? d.title : VIDEO_CUT_TITLE,
    label: typeof d.label === 'string' ? d.label : '',
    sourcePath: typeof d.sourcePath === 'string' ? d.sourcePath : '',
    duration,
    pieces: cutNormalizePieces(d.pieces, duration),
    video,
    resultKey: typeof d.resultKey === 'string' ? d.resultKey : '',
    status: d.status === 'cutting' || d.status === 'error' ? d.status : 'idle',
    error: typeof d.error === 'string' ? d.error : '',
  }
}

// ---------------------------------------------------------------- thao tác trên đoạn (thuần)

/** Chỉ số đoạn chứa thời điểm t (t đúng ranh giới thuộc đoạn sau; t = cuối video thuộc đoạn cuối). */
export function cutPieceAt(pieces: CutPiece[], t: number): number {
  if (!pieces.length) return -1
  for (let i = 0; i < pieces.length; i++) if (t >= pieces[i].start && t < pieces[i].end) return i
  return t >= pieces[pieces.length - 1].end ? pieces.length - 1 : 0
}

/** Tách đoạn chứa t làm hai (như "Split" trên CapCut). Quá gần mép / quá nhiều đoạn thì giữ nguyên. */
export function cutSplit(pieces: CutPiece[], t: number): CutPiece[] {
  const i = cutPieceAt(pieces, t)
  if (i < 0 || pieces.length >= CUT_MAX_PIECES) return pieces
  const p = pieces[i]
  const at = r2(t)
  if (at - p.start < CUT_MIN_PIECE - 1e-9 || p.end - at < CUT_MIN_PIECE - 1e-9) return pieces
  return [...pieces.slice(0, i), { ...p, end: at }, { ...p, start: at }, ...pieces.slice(i + 1)]
}

export const cutKeptCount = (pieces: CutPiece[]) => pieces.filter((p) => !p.removed).length

/** Xóa / khôi phục 1 đoạn. Không cho xóa đoạn giữ cuối cùng (video kết quả không thể rỗng). */
export function cutToggleRemoved(pieces: CutPiece[], i: number): CutPiece[] {
  const p = pieces[i]
  if (!p) return pieces
  if (!p.removed && cutKeptCount(pieces) <= 1) return pieces
  return pieces.map((x, k) => (k === i ? { ...x, removed: !x.removed } : x))
}

/** Chỉ giữ đoạn i, xóa mọi đoạn khác. */
export const cutKeepOnly = (pieces: CutPiece[], i: number): CutPiece[] =>
  pieces[i] ? pieces.map((x, k) => ({ ...x, removed: k !== i })) : pieces

/** Khôi phục mọi đoạn đã xóa (giữ nguyên các vết tách). */
export const cutRestoreAll = (pieces: CutPiece[]): CutPiece[] => pieces.map((x) => ({ ...x, removed: false }))

/** Gộp đoạn i với đoạn sau (bỏ vết tách giữa chúng); chỉ coi là xóa khi CẢ HAI đều đã xóa. */
export function cutMergeNext(pieces: CutPiece[], i: number): CutPiece[] {
  const a = pieces[i]
  const b = pieces[i + 1]
  if (!a || !b) return pieces
  return [...pieces.slice(0, i), { start: a.start, end: b.end, removed: a.removed && b.removed }, ...pieces.slice(i + 2)]
}

/** Kéo ranh giới giữa đoạn i và i+1 tới t (không cho đoạn nào ngắn hơn CUT_MIN_PIECE). */
export function cutMoveBoundary(pieces: CutPiece[], i: number, t: number): CutPiece[] {
  const a = pieces[i]
  const b = pieces[i + 1]
  if (!a || !b) return pieces
  const at = r2(Math.min(b.end - CUT_MIN_PIECE, Math.max(a.start + CUT_MIN_PIECE, t)))
  if (at === a.end) return pieces
  return pieces.map((x, k) => (k === i ? { ...x, end: at } : k === i + 1 ? { ...x, start: at } : x))
}

export const cutKeptDuration = (pieces: CutPiece[]) => r2(cutKeptSegments(pieces).reduce((s, g) => s + (g.end - g.start), 0))
export const cutRemovedDuration = (pieces: CutPiece[]) => r2(pieces.filter((p) => p.removed).reduce((s, p) => s + (p.end - p.start), 0))

/** Có chỉnh gì so với video gốc không (đã tách hoặc đã xóa đoạn)? */
export const cutHasEdits = (pieces: CutPiece[]) => pieces.length > 1 || pieces.some((p) => p.removed)

/**
 * Xem trước kết quả: đang ở t. Nếu t nằm trong đoạn đã xóa thì trả thời điểm cần nhảy tới (đầu đoạn giữ kế tiếp), `null` =
 * không còn đoạn giữ nào phía sau (hết video). t nằm trong đoạn giữ thì trả chính t.
 */
export function cutSkipTarget(pieces: CutPiece[], t: number): number | null {
  const i = cutPieceAt(pieces, t)
  if (i < 0) return t
  if (!pieces[i].removed) return t
  for (let k = i + 1; k < pieces.length; k++) if (!pieces[k].removed) return pieces[k].start
  return null
}

/** Thời điểm đầu của video kết quả trong video nguồn (đầu đoạn giữ thứ nhất), 0 nếu không có. */
export const cutFirstKeptStart = (pieces: CutPiece[]) => pieces.find((p) => !p.removed)?.start ?? 0

/** Thời gian trong video KẾT QUẢ ứng với thời điểm t của video nguồn (bỏ phần đã xóa phía trước). */
export function cutSourceToResult(pieces: CutPiece[], t: number): number {
  let acc = 0
  for (const p of pieces) {
    if (t <= p.start) break
    if (!p.removed) acc += Math.min(t, p.end) - p.start
    if (t < p.end) break
  }
  return r2(acc)
}

// ---------------------------------------------------------------- hiển thị

/** "0:03.2" / "1:05.0" — phút:giây.phần mười. */
export function cutFormatTime(t: number): string {
  const v = Math.max(0, t)
  const m = Math.floor(v / 60)
  const s = v - m * 60
  return `${m}:${s < 10 ? '0' : ''}${s.toFixed(1)}`
}

const RULER_STEPS = [0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600]

/** Vạch chia thước thời gian: bước "đẹp" nhỏ nhất để hai vạch cách nhau ≥ minPx. */
export function cutRulerTicks(duration: number, trackPx: number, minPx = 54): { time: number; major: boolean }[] {
  if (!(duration > 0) || !(trackPx > 0)) return []
  const pxPerSec = trackPx / duration
  const step = RULER_STEPS.find((s) => s * pxPerSec >= minPx) ?? RULER_STEPS[RULER_STEPS.length - 1]
  const ticks: { time: number; major: boolean }[] = []
  const count = Math.floor(duration / step + 1e-9)
  for (let i = 0; i <= count; i++) ticks.push({ time: r2(i * step), major: true })
  return ticks
}

/** Kích thước dải khung hình xin backend theo mức zoom (ảnh càng rộng càng nét khi phóng to timeline). */
export const cutStripWidth = (zoom: number) => (zoom <= 1.01 ? 960 : zoom <= 2.01 ? 1920 : 3840)

/** Cảnh báo / nhận xét về độ dài kết quả cho Flow ('' = không cần nhắc). */
export function cutFlowHint(keptSec: number): string {
  if (keptSec > CUT_FLOW_MAX_SECONDS) return `Dài ${keptSec.toFixed(1)}s — Flow chỉ nhận tối đa ${CUT_FLOW_MAX_SECONDS}s video mẫu, cần bỏ thêm ${(keptSec - CUT_FLOW_MAX_SECONDS).toFixed(1)}s.`
  if (keptSec < 3) return `Chỉ ${keptSec.toFixed(1)}s — Flow cần video mẫu tối thiểu 3s.`
  return ''
}
