import assert from 'node:assert/strict'
import test from 'node:test'
import { fmtDur, geminiDetailText, mergeDetailText, phaseSec, sumPhases, totalSec, voiceDetailText } from './timing.ts'

test('voiceDetailText: TTS, lô, lô bỏ qua khi resume', () => {
  assert.equal(
    voiceDetailText({ detail: { tts_sec: 151.4, unpack_sec: 0.3, batches: 8, resumed_batches: 3 } }),
    'TTS 2p31s · 8 lô · bỏ qua 3 lô đã có',
  )
  assert.equal(voiceDetailText({ detail: { tts_sec: 0, batches: 1 } }), '1 lô')
  assert.equal(voiceDetailText(undefined), '')
})

test('mergeDetailText: số đoạn và giây ffmpeg trung bình', () => {
  assert.equal(mergeDetailText({ detail: { segments: 60, ffmpeg_sec: 96 } }), '60 đoạn · ffmpeg 1p36s (1.6s/đoạn)')
  assert.equal(mergeDetailText({ detail: { segments: 60 } }), '60 đoạn')
  assert.equal(mergeDetailText({ detail: {} }), '')
})

test('fmtDur: giây, phút', () => {
  assert.equal(fmtDur(8.44), '8.4s')
  assert.equal(fmtDur(45.4), '45s')
  assert.equal(fmtDur(81), '1p21s')
  assert.equal(fmtDur(600), '10p00s')
  assert.equal(fmtDur(-1), '—')
  assert.equal(fmtDur(NaN), '—')
})

test('phaseSec: đã xong dùng duration_sec, đang chạy đếm tiếp, job lỗi thì dừng đếm', () => {
  const start = '2026-01-01T00:00:00.000Z'
  const now = Date.parse(start) + 30_000
  assert.equal(phaseSec({ duration_sec: 12.5 }, now, true), 12.5)
  assert.equal(phaseSec({ started_at: start, ended_at: null, duration_sec: null }, now, true), 30)
  assert.equal(phaseSec({ started_at: start, ended_at: null, duration_sec: null }, now, false), null)
  assert.equal(phaseSec(undefined, now, true), null)
})

test('sumPhases: cộng phase có số liệu, bỏ qua phase thiếu', () => {
  const t = { transcript: { duration_sec: 8 }, gemini: { duration_sec: 80 } }
  assert.equal(sumPhases(t, ['transcript', 'cookie_check', 'gemini'], 0, true), 88)
  assert.equal(sumPhases(t, ['cut'], 0, true), null)
  assert.equal(sumPhases(null, ['cut'], 0, true), null)
})

test('totalSec: ưu tiên total đã chốt, chưa có thì tính từ created_at khi job còn chạy', () => {
  const created = '2026-01-01T00:00:00.000Z'
  const now = Date.parse(created) + 90_000
  assert.equal(totalSec({ total: { duration_sec: 400 } }, created, now, true), 400)
  assert.equal(totalSec({}, created, now, true), 90)
  assert.equal(totalSec({}, created, now, false), null)
})

test('geminiDetailText: liệt kê chunk, caption, rate-limit, cookie', () => {
  const s = geminiDetailText({
    detail: { chunks: [20, 75.2], tail_sec: 8, rate_limit_wait_sec: 30, cookie_refresh_sec: 12 },
  })
  assert.equal(s, '2 chunk: 20s · 1p15s · caption 8.0s · chờ rate-limit 30s · làm mới cookie 12s')
  assert.equal(geminiDetailText({ detail: { network_retries: 2 } }), 'lỗi mạng thử lại 2 lần')
  assert.equal(geminiDetailText({ detail: { network_retries: 0 } }), '')
  assert.equal(geminiDetailText(undefined), '')
  assert.equal(geminiDetailText({ detail: {} }), '')
})
