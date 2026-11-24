import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  canCompareWithReference,
  COMPARE_MAX_DRIFT,
  compareFinished,
  compareLength,
  compareNeedsResync,
  compareRefTime,
  compareResultTime,
  formatCompareTime,
} from '../services/museVideoCompare.ts'

const span = { start: 2, end: 10 } // đoạn mẫu gửi lên Flow: 8 giây

test('giây t của video kết quả ứng với start + t của video mẫu, kẹp trong đoạn', () => {
  assert.equal(compareRefTime(span, 0), 2)
  assert.equal(compareRefTime(span, 3.5), 5.5)
  assert.equal(compareRefTime(span, 99), 10)
  assert.equal(compareRefTime(span, -4), 2)
  assert.equal(compareResultTime(span, 5.5), 3.5)
  assert.equal(compareResultTime(span, 1), 0)
})

test('độ dài đối chiếu = phần chung ngắn hơn; chưa biết thời lượng kết quả thì theo đoạn mẫu', () => {
  assert.equal(compareLength(span), 8)
  assert.equal(compareLength(span, 0), 8)
  assert.equal(compareLength(span, 7.9), 7.9)  // Flow ra ngắn hơn chút
  assert.equal(compareLength(span, 8.4), 8)    // Flow ra dài hơn chút: không vượt đoạn mẫu
  assert.equal(compareLength({ start: 5, end: 5 }), 0)
  assert.equal(compareLength({ start: Number.NaN, end: 3 }), 3)
})

test('chỉ kéo video mẫu về khi lệch quá ngưỡng (tránh giật khi phát bình thường)', () => {
  assert.equal(compareNeedsResync(span, 5.5, 3.5), false)
  assert.equal(compareNeedsResync(span, 5.5 + COMPARE_MAX_DRIFT - 0.01, 3.5), false)
  assert.equal(compareNeedsResync(span, 5.5 + COMPARE_MAX_DRIFT + 0.05, 3.5), true)
  assert.equal(compareNeedsResync(span, 2, 6), true) // mẫu đứng yên ở đầu đoạn trong khi kết quả đã chạy tới giây 6
})

test('hết đoạn thì dừng cả hai', () => {
  assert.equal(compareFinished(span, 7.96, 8), true)
  assert.equal(compareFinished(span, 4, 8), false)
  assert.equal(compareFinished({ start: 1, end: 1 }, 0, 0), false) // đoạn rỗng: không coi là "đã xong"
})

test('chỉ ô "Xong" có video và có video mẫu mới đối chiếu được ("Bản cũ" = mẫu / đoạn cắt đã đổi)', () => {
  assert.equal(canCompareWithReference('done', true, true), true)
  for (const state of ['stale', 'running', 'error', 'none']) assert.equal(canCompareWithReference(state, true, true), false, state)
  assert.equal(canCompareWithReference('done', false, true), false)
  assert.equal(canCompareWithReference('done', true, false), false)
})

test('nhãn thời gian m:ss.s', () => {
  assert.equal(formatCompareTime(0), '0:00.0')
  assert.equal(formatCompareTime(7.46), '0:07.5')
  assert.equal(formatCompareTime(65), '1:05.0')
  assert.equal(formatCompareTime(-3), '0:00.0')
})
