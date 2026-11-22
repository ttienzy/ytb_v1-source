/**
 * Phần nhỏ của mô hình node "Cắt video" mà cả museCanvasNodes.ts (node Ghép video cần biết video đã cắt còn "hoàn chỉnh"
 * không) lẫn museVideoCut.ts dùng — tách riêng để hai module không import vòng lẫn nhau. Thuần TS, không phụ thuộc gì.
 */

export interface CutPiece {
  start: number
  end: number
  removed: boolean
}

/** Các đoạn GIỮ LẠI, đoạn liền nhau gộp làm một — đúng thứ backend nhận. Bỏ qua phần tử hỏng (đọc từ bản lưu). */
export function cutKeptSegments(pieces: readonly unknown[]): { start: number; end: number }[] {
  const out: { start: number; end: number }[] = []
  for (const raw of pieces) {
    const p = raw as Partial<CutPiece> | null
    if (!p || typeof p !== 'object' || p.removed === true) continue
    if (typeof p.start !== 'number' || typeof p.end !== 'number' || !(p.end > p.start)) continue
    const last = out[out.length - 1]
    if (last && p.start - last.end < 0.005) last.end = p.end
    else out.push({ start: p.start, end: p.end })
  }
  return out
}

/** Dấu vân tay kết quả: nguồn + các đoạn giữ lại (cùng nguồn, cùng đoạn = cùng video, không cần cắt lại). */
export const cutResultKey = (sourcePath: string, pieces: readonly unknown[]) =>
  `${sourcePath}|${cutKeptSegments(pieces).map((g) => `${g.start.toFixed(2)}-${g.end.toFixed(2)}`).join(';')}`

/**
 * Video "hoàn chỉnh" của 1 node Cắt video: đã "Cắt & lưu" VÀ chưa chỉnh gì sau lần cắt đó. null = chưa cắt / đã chỉnh
 * (bản cũ) — node phía sau (Ghép video) không được dùng.
 */
export function cutCompleteVideo(data: Record<string, unknown> | undefined): { path: string; previewUrl: string; durationSec: number } | null {
  const d = data ?? {}
  const v = d.video as { path?: unknown; previewUrl?: unknown; durationSec?: unknown } | null | undefined
  if (!v || typeof v.path !== 'string' || !v.path) return null
  const pieces = Array.isArray(d.pieces) ? d.pieces : []
  const sourcePath = typeof d.sourcePath === 'string' ? d.sourcePath : ''
  if (!sourcePath || typeof d.resultKey !== 'string' || d.resultKey !== cutResultKey(sourcePath, pieces)) return null
  return {
    path: v.path,
    previewUrl: typeof v.previewUrl === 'string' ? v.previewUrl : '',
    durationSec: typeof v.durationSec === 'number' && Number.isFinite(v.durationSec) ? v.durationSec : 0,
  }
}
