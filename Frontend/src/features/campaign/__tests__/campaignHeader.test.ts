import assert from 'node:assert/strict'
import test from 'node:test'
import { budgetView, campaignInitial, parseServerTime, shortDate } from '../services/campaignView.ts'

test('giờ backend không kèm múi giờ được hiểu là UTC', () => {
  assert.equal(parseServerTime('2026-11-10 13:11:21.683405')?.toISOString(), '2026-11-10T13:11:21.683Z')
  assert.equal(parseServerTime('2026-11-10T13:11:21+07:00')?.toISOString(), '2026-11-10T06:11:21.000Z')
  assert.equal(parseServerTime(''), null)
  assert.equal(parseServerTime('không phải ngày'), null)
})

test('ngày ngắn chỉ thêm năm khi khác năm nay', () => {
  const now = new Date('2026-11-11T00:00:00Z')
  assert.match(shortDate('2026-11-09 13:35:48', now), /^\d{2}\/11$/)
  assert.match(shortDate('2025-03-02 10:00:00', now), /^\d{2}\/03\/2025$/)
  assert.equal(shortDate(null, now), '')
})

test('ngân sách credit: phần trăm và mức cảnh báo', () => {
  assert.deepEqual(budgetView(100, 300), { pct: 33, tone: 'ok', label: '100 / 300 credit' })
  assert.equal(budgetView(250, 300).tone, 'warn')
  assert.equal(budgetView(300, 300).tone, 'bad')
  assert.equal(budgetView(450, 300).pct, 100)
  assert.deepEqual(budgetView(40, null), { pct: null, tone: 'muted', label: '40 credit · không giới hạn' })
  assert.equal(budgetView(0, 0).tone, 'bad')
})

test('chữ cái đại diện bỏ dấu tiếng Việt', () => {
  assert.equal(campaignInitial('Bộ thun trắng'), 'B')
  assert.equal(campaignInitial('đầm xòe'), 'D')
  assert.equal(campaignInitial('  ủng da'), 'U')
  assert.equal(campaignInitial(''), '?')
})
