/**
 * Đối chiếu video Ingredients với đoạn video mẫu đã gửi lên Flow (thuần, không React — node:test nạp được).
 *
 * Video kết quả là bản "chỉnh" của đoạn mẫu `[start, end]`: giây t của kết quả ứng với giây `start + t` của video mẫu.
 * Hai video phát cùng lúc, video kết quả là chủ (đồng hồ chính); video mẫu được kéo theo.
 */

export interface CompareSpan {
  /** Giây bắt đầu / kết thúc của đoạn mẫu đã gửi lên Flow (trên video mẫu gốc) */
  start: number
  end: number
}

/** Lệch tối đa (giây) giữa hai video khi phát trước khi kéo video mẫu về đúng chỗ. */
export const COMPARE_MAX_DRIFT = 0.35

const finite = (n: number | null | undefined, fallback = 0) => (typeof n === 'number' && Number.isFinite(n) ? n : fallback)

/**
 * Độ dài đoạn đối chiếu = phần chung ngắn hơn của đoạn mẫu và video kết quả (Flow có thể ra lệch vài khung hình).
 * `resultDuration` chưa biết (video chưa nạp metadata) thì lấy độ dài đoạn mẫu.
 */
export function compareLength(span: CompareSpan, resultDuration?: number | null): number {
  const segment = Math.max(0, finite(span.end) - finite(span.start))
  const result = finite(resultDuration, 0)
  return result > 0 ? Math.min(segment, result) : segment
}

/** Giây trên video mẫu ứng với giây `t` của video kết quả (kẹp trong đoạn mẫu). */
export function compareRefTime(span: CompareSpan, t: number): number {
  const start = finite(span.start)
  const end = Math.max(start, finite(span.end))
  return Math.min(end, Math.max(start, start + finite(t)))
}

/** Giây của video kết quả ứng với giây `refTime` trên video mẫu (ngược của compareRefTime). */
export function compareResultTime(span: CompareSpan, refTime: number): number {
  return Math.max(0, finite(refTime) - finite(span.start))
}

/** Hai video đang lệch nhau quá ngưỡng (giây `resultTime` của kết quả vs `refTime` của mẫu)? */
export function compareNeedsResync(span: CompareSpan, refTime: number, resultTime: number): boolean {
  return Math.abs(finite(refTime) - compareRefTime(span, resultTime)) > COMPARE_MAX_DRIFT
}

/** Đã phát hết đoạn đối chiếu chưa (dừng cả hai, tua về đầu). */
export function compareFinished(span: CompareSpan, resultTime: number, resultDuration?: number | null): boolean {
  const length = compareLength(span, resultDuration)
  return length > 0 && finite(resultTime) >= length - 0.05
}

/** Chỉ ô "Xong" (dấu vân tay khớp hiện tại) mới so được với mẫu: "Bản cũ" nghĩa là mẫu / đoạn cắt đã đổi. */
export function canCompareWithReference(state: string, hasFile: boolean, hasReference: boolean): boolean {
  return state === 'done' && hasFile && hasReference
}

/** "m:ss.s" cho nhãn thời gian. */
export function formatCompareTime(t: number): string {
  const v = Math.max(0, finite(t))
  const m = Math.floor(v / 60)
  const s = v - m * 60
  return `${m}:${s.toFixed(1).padStart(4, '0')}`
}
