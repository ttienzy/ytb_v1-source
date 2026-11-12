import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  blurClipPath,
  cropFrame,
  defaults,
  formatDuration,
  formatSize,
  groupMergedByAspect,
  mergeTotalSeconds,
  normalizeOptions,
  progressSummary,
  type MergedItem,
} from './videoModel.ts'

test('normalizeOptions: thiếu trường (bản lưu cũ) vẫn đủ, blur được gộp sâu', () => {
  const out = normalizeOptions({ aspect: '16:9', blur: { enabled: true } })
  assert.equal(out.aspect, '16:9')
  assert.equal(out.crop, defaults.crop)
  assert.deepEqual(out.blur, { ...defaults.blur, enabled: true })
  assert.deepEqual(normalizeOptions(null), defaults)
  assert.deepEqual(normalizeOptions('rác'), defaults)
})

test('mergeTotalSeconds', () => {
  assert.equal(mergeTotalSeconds(2, 30), 150)
  assert.equal(mergeTotalSeconds(0, 0), 0)
  assert.equal(mergeTotalSeconds(Number.NaN, 5), 5)
  assert.equal(mergeTotalSeconds(-3, 0), 0)
})

test('formatDuration / formatSize', () => {
  assert.equal(formatDuration(22.4), '0:22')
  assert.equal(formatDuration(125), '2:05')
  assert.equal(formatDuration(3725), '1:02:05')
  assert.equal(formatDuration(0), '—')
  assert.equal(formatDuration(undefined), '—')
  assert.equal(formatSize(2.4 * 1024 * 1024), '2.4 MB')
  assert.equal(formatSize(3 * 1024 ** 3), '3.0 GB')
})

test('cropFrame: giữ nguyên = không khung, vuông = căn giữa, tự chỉnh = theo thanh trượt', () => {
  const base = { crop_x: 0.1, crop_y: 0.2, crop_w: 0.5, crop_h: 0.6 }
  assert.equal(cropFrame({ ...base, crop: 'fit' }), null)
  assert.deepEqual(cropFrame({ ...base, crop: 'square' }), { left: '15%', top: '15%', width: '70%', height: '70%' })
  assert.deepEqual(cropFrame({ ...base, crop: 'custom' }), { left: '10%', top: '20%', width: '50%', height: '60%' })
})

test('blurClipPath: khung nằm lệch/tràn mép không cho giá trị âm', () => {
  assert.equal(blurClipPath({ x: 0.25, y: 0.25, w: 0.5, h: 0.25 }), 'inset(25% 25% 50% 25%)')
  assert.equal(blurClipPath({ x: 0.8, y: 0.9, w: 0.5, h: 0.5 }), 'inset(90% 0% 0% 80%)')
})

test('groupMergedByAspect', () => {
  const item = (aspect: MergedItem['aspect'], n: string): MergedItem => ({ file_name: n, name: n, duration_sec: 1, aspect, created_at: '' })
  const groups = groupMergedByAspect([item('9:16', 'a'), item('16:9', 'b'), item('9:16', 'c')])
  assert.deepEqual(groups['9:16'].map(i => i.file_name), ['a', 'c'])
  assert.deepEqual(groups['16:9'].map(i => i.file_name), ['b'])
})

test('progressSummary', () => {
  const p = { a: { percent: 100, status: 'done' as const }, b: { percent: 40, status: 'processing' as const }, c: { percent: 10, status: 'error' as const } }
  assert.deepEqual(progressSummary(['a', 'b', 'c', 'd'], p), { done: 1, failed: 1, percent: Math.round((100 + 40 + 10 + 0) / 4) })
  assert.deepEqual(progressSummary([], p), { done: 0, failed: 0, percent: 0 })
})
