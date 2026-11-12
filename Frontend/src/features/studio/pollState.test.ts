import assert from 'node:assert/strict'
import test from 'node:test'
import { JOB_LOST_MSG, OFFLINE_AFTER_FAILS, isJobLost, isOffline } from './pollState.ts'

test('isJobLost: chỉ 404 là job đã mất; lỗi khác không dừng poll', () => {
  assert.equal(isJobLost(404), true)
  for (const s of [200, 500, 502, 503, 400]) assert.equal(isJobLost(s), false)
})

test('isOffline: cảnh báo mất kết nối sau vài lần poll thất bại liên tiếp, không báo vì 1 lần chập chờn', () => {
  assert.equal(isOffline(0), false)
  assert.equal(isOffline(OFFLINE_AFTER_FAILS - 1), false)
  assert.equal(isOffline(OFFLINE_AFTER_FAILS), true)
  assert.equal(isOffline(20), true)
})

test('JOB_LOST_MSG hướng dẫn rõ việc cần làm', () => {
  assert.match(JOB_LOST_MSG, /Bắt đầu lại/)
})
