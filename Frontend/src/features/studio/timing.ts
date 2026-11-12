// Tính toán thuần cho hiển thị thời gian pipeline (không import React/DOM → test được bằng node:test).
import type { PhaseTiming } from './types'

/** 45 → "45s", 8.4 → "8.4s", 81 → "1p21s", 3600 → "60p00s". */
export function fmtDur(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '—'
  if (sec < 10) return `${sec.toFixed(1)}s`
  if (sec < 60) return `${Math.round(sec)}s`
  const total = Math.round(sec)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}p${String(s).padStart(2, '0')}s`
}

/**
 * Số giây của 1 phase. Đã kết thúc → duration_sec; đang chạy (có started_at, chưa ended_at) và job
 * còn sống (`live`) → đếm tiếp tới `nowMs`; còn lại null.
 */
export function phaseSec(t: PhaseTiming | undefined | null, nowMs: number, live: boolean): number | null {
  if (!t) return null
  if (t.duration_sec != null) return t.duration_sec
  if (live && t.started_at && !t.ended_at) {
    const start = Date.parse(t.started_at)
    if (Number.isFinite(start)) return Math.max(0, (nowMs - start) / 1000)
  }
  return null
}

/** Cộng các phase có số liệu; không phase nào có → null. */
export function sumPhases(
  timings: Record<string, PhaseTiming> | null | undefined,
  keys: string[],
  nowMs: number,
  live: boolean,
): number | null {
  let sum = 0
  let any = false
  for (const k of keys) {
    const s = phaseSec(timings?.[k], nowMs, live)
    if (s != null) {
      sum += s
      any = true
    }
  }
  return any ? sum : null
}

/** Tổng thời gian job: đã chốt (`total`) → dùng; chưa → từ created_at tới giờ nếu job còn chạy. */
export function totalSec(
  timings: Record<string, PhaseTiming> | null | undefined,
  createdAt: string | undefined,
  nowMs: number,
  live: boolean,
): number | null {
  const t = timings?.total
  if (t?.duration_sec != null) return t.duration_sec
  if (live && createdAt) {
    const start = Date.parse(createdAt)
    if (Number.isFinite(start)) return Math.max(0, (nowMs - start) / 1000)
  }
  return null
}

/** Chi tiết voice: giây TTS thuần, số lô, lô được bỏ qua nhờ đã có trên đĩa (resume). */
export function voiceDetailText(t: PhaseTiming | undefined | null): string {
  const d = t?.detail
  if (!d) return ''
  const parts: string[] = []
  if (d.tts_sec != null && d.tts_sec > 0) parts.push(`TTS ${fmtDur(d.tts_sec)}`)
  if (d.unpack_sec != null && d.unpack_sec >= 1) parts.push(`giải nén ${fmtDur(d.unpack_sec)}`)
  if (d.batches) parts.push(`${d.batches} lô`)
  if (d.resumed_batches) parts.push(`bỏ qua ${d.resumed_batches} lô đã có`)
  return parts.join(' · ')
}

/** Chi tiết merge: số đoạn và giây ffmpeg thật (khác thời gian chờ giọng khi chạy chồng lên voice). */
export function mergeDetailText(t: PhaseTiming | undefined | null): string {
  const d = t?.detail
  if (!d?.segments) return ''
  if (d.ffmpeg_sec == null) return `${d.segments} đoạn`
  return `${d.segments} đoạn · ffmpeg ${fmtDur(d.ffmpeg_sec)} (${(d.ffmpeg_sec / d.segments).toFixed(1)}s/đoạn)`
}

/** Dòng mô tả chi tiết Gemini: số chunk + giây/chunk, chờ 429, refresh cookie, caption. */
export function geminiDetailText(t: PhaseTiming | undefined | null): string {
  const d = t?.detail
  if (!d) return ''
  const parts: string[] = []
  if (d.chunks?.length) parts.push(`${d.chunks.length} chunk: ${d.chunks.map(fmtDur).join(' · ')}`)
  if (d.tail_sec != null && d.tail_sec >= 1) parts.push(`caption ${fmtDur(d.tail_sec)}`)
  if (d.rate_limit_wait_sec) parts.push(`chờ rate-limit ${fmtDur(d.rate_limit_wait_sec)}`)
  if (d.cookie_refresh_sec) parts.push(`làm mới cookie ${fmtDur(d.cookie_refresh_sec)}`)
  if (d.network_retries) parts.push(`lỗi mạng thử lại ${d.network_retries} lần`)
  return parts.join(' · ')
}
