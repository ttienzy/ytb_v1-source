import test from 'node:test'
import assert from 'node:assert/strict'
import {
  creditText,
  doneCount,
  driftWarning,
  formatRange,
  isSegmentBusy,
  jobStorageKey,
  longActions,
  needsLongMotion,
  progressSummary,
  timelineBlocks,
  type LongSegment,
} from '../services/longMotionView.ts'

const seg = (index: number, state: LongSegment['state'], extra: Partial<LongSegment> = {}): LongSegment => ({
  index, start: index * 7, end: index * 7 + 7.8, length: 7.8, state, attempts: 0, veo_job_id: null, error: null, note: null,
  output: null, out_duration: null, ...extra,
})

test('chỉ video dài hơn 10 giây mới cần chia đoạn', () => {
  assert.equal(needsLongMotion(10), false)
  assert.equal(needsLongMotion(10.04), false)
  assert.equal(needsLongMotion(10.5), true)
  assert.equal(needsLongMotion(21.5), true)
  assert.equal(needsLongMotion(undefined), false)
  assert.equal(needsLongMotion(NaN), false)
})

test('timelineBlocks: vị trí theo % và phần gối của từng đoạn', () => {
  const blocks = timelineBlocks([
    { index: 0, start: 0, end: 7.8333 },
    { index: 1, start: 6.8333, end: 14.6667 },
    { index: 2, start: 13.6667, end: 21.5 },
  ], 21.5)
  assert.equal(blocks.length, 3)
  assert.equal(blocks[0].leftPct, 0)
  assert.equal(blocks[0].overlapPct, 0)
  assert.ok(Math.abs(blocks[1].leftPct - (6.8333 / 21.5) * 100) < 1e-9)
  assert.ok(Math.abs(blocks[1].overlapPct - (1 / 7.8334) * 100) < 0.01)
  assert.ok(Math.abs(blocks[2].leftPct + blocks[2].widthPct - 100) < 1e-6)
  assert.deepEqual(timelineBlocks([], 0), [])
})

test('longActions: chạy tất cả chỉ khi không có đoạn đang chạy; ghép chỉ khi xong hết', () => {
  const idle = { segments: [seg(0, 'done'), seg(1, 'idle'), seg(2, 'idle')], merge: { state: 'idle' as const }, exports: {}, worker_alive: false }
  assert.equal(longActions(idle).canRunAll, true)
  assert.equal(longActions(idle).canMerge, false)
  const busy = { ...idle, segments: [seg(0, 'done'), seg(1, 'generating'), seg(2, 'queued')], worker_alive: true }
  const a = longActions(busy)
  assert.equal(a.canRunAll, false)
  assert.equal(a.canStop, true)
  assert.match(a.runBlockedReason, /Đang có đoạn chạy/)
  const finished = { ...idle, segments: [seg(0, 'done'), seg(1, 'done')] }
  assert.equal(longActions(finished).canMerge, true)
  assert.equal(longActions(finished).canRunAll, false)
  assert.equal(longActions({ ...finished, merge: { state: 'running' } }).canMerge, false)
  assert.equal(longActions({ ...finished, merge: { state: 'done' } }).canCleanExport, true)
  assert.equal(longActions({ ...finished, merge: { state: 'done' }, exports: { clean: { state: 'running' } } }).canCleanExport, false)
})

test('progressSummary nói rõ khi đoạn lỗi làm dừng hàng đợi', () => {
  assert.match(progressSummary({ segments: [seg(0, 'done'), seg(1, 'error'), seg(2, 'idle')], merge: { state: 'idle' } }), /Đoạn 2 lỗi/)
  assert.match(progressSummary({ segments: [seg(0, 'done'), seg(1, 'generating')], merge: { state: 'idle' } }), /Đang tạo đoạn 2\/2 \(1 đoạn xong\)/)
  assert.equal(progressSummary({ segments: [seg(0, 'done'), seg(1, 'done')], merge: { state: 'done' } }), 'Đã ghép xong 2 đoạn.')
  assert.equal(doneCount([seg(0, 'done'), seg(1, 'idle')]), 1)
  assert.equal(isSegmentBusy('uploading'), true)
  assert.equal(isSegmentBusy('error'), false)
})

test('định dạng chữ: khoảng thời gian, credit "khoảng" khi chưa đo, khóa lưu theo file', () => {
  assert.equal(formatRange({ start: 6.8333, end: 14.6667 }), '6,8–14,7 giây')
  assert.equal(creditText(90), 'khoảng 90 credits')
  assert.equal(creditText(90, true), '90 credits')
  assert.equal(jobStorageKey({ name: 'a.mp4', size: 12 }), 'motionLong:a.mp4:12')
})

test('driftWarning: chỉ báo khi video Flow lệch quá 0,3 giây so với đoạn đã gửi', () => {
  assert.equal(driftWarning([seg(0, 'done', { out_duration: 7.9 })]), '')
  const text = driftWarning([seg(0, 'done', { out_duration: 10 }), seg(1, 'done', { out_duration: 7.8 })])
  assert.match(text, /đoạn 1: 10,0 giây thay vì 7,8 giây/)
  assert.doesNotMatch(text, /đoạn 2/)
})
