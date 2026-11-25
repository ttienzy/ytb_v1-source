import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GOLDEN_PRESETS, planSlots, type PlanInput } from './scheduleSlots.ts'

const at = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).getTime()
const videos = ['a', 'b', 'c', 'd'].map(uid => ({ uid }))
const pages = [{ page_id: 'p1' }, { page_id: 'p2' }]

function input(over: Partial<PlanInput<{ uid: string }, { page_id: string }>> = {}): PlanInput<{ uid: string }, { page_id: string }> {
  return {
    videos, pages, mode: 'golden_hours', startDate: '2026-12-01', startTime: '08:00', intervalMinutes: 30,
    goldenSlots: GOLDEN_PRESETS['2_per_day'].slots, jitter: false, customTimes: {}, customPages: {}, now: at(2026, 11, 25, 9),
    ...over,
  }
}

test('khung giờ vàng: trải qua nhiều ngày theo từng mốc, chia kênh xoay vòng', () => {
  const plan = planSlots(input())
  assert.deepEqual(plan.map(p => p.schedule_time_ms), [at(2026, 12, 1, 11, 45), at(2026, 12, 1, 19, 45), at(2026, 12, 2, 11, 45), at(2026, 12, 2, 19, 45)])
  assert.deepEqual(plan.map(p => p.page.page_id), ['p1', 'p2', 'p1', 'p2'])
})

test('khung giờ vàng: bắt đầu hôm nay thì bỏ mốc đã trôi, hết mốc thì sang ngày mai', () => {
  const now = at(2026, 12, 1, 12, 0)
  const plan = planSlots(input({ now, startDate: '2026-12-01' }))
  assert.equal(plan[0].schedule_time_ms, at(2026, 12, 1, 19, 45))
  assert.equal(plan[1].schedule_time_ms, at(2026, 12, 2, 11, 45))
  const late = planSlots(input({ now: at(2026, 12, 1, 21, 0), startDate: '2026-12-01' }))
  assert.equal(late[0].schedule_time_ms, at(2026, 12, 2, 11, 45))
})

test('jitter ổn định giữa các lần tính và nằm trong -5…+10 phút', () => {
  const a = planSlots(input({ jitter: true }))
  const b = planSlots(input({ jitter: true }))
  assert.deepEqual(a.map(p => p.schedule_time_ms), b.map(p => p.schedule_time_ms))
  const exact = planSlots(input())
  a.forEach((p, i) => {
    const diff = (p.schedule_time_ms - exact[i].schedule_time_ms) / 60000
    assert.ok(diff >= -5 && diff <= 10, `lệch ${diff} phút`)
  })
})

test('giãn cách đều + giờ/kênh tuỳ chỉnh từng video', () => {
  const base = at(2026, 12, 1, 8, 0)
  const plan = planSlots(input({ mode: 'interval', customTimes: { b: at(2026, 12, 5, 7, 0) }, customPages: { c: 'p2' } }))
  assert.deepEqual(plan.map(p => p.schedule_time_ms), [base, at(2026, 12, 5, 7, 0), base + 60 * 60000, base + 90 * 60000])
  assert.equal(plan[2].page.page_id, 'p2')
})

test('interval trong quá khứ được đẩy lên tối thiểu +5 phút; thiếu video/kênh/mốc thì rỗng', () => {
  const now = at(2026, 12, 1, 10, 0)
  const plan = planSlots(input({ mode: 'interval', startDate: '2026-12-01', startTime: '08:00', now }))
  assert.equal(plan[0].schedule_time_ms, now + 5 * 60000)
  assert.deepEqual(planSlots(input({ videos: [] })), [])
  assert.deepEqual(planSlots(input({ pages: [] })), [])
  assert.deepEqual(planSlots(input({ goldenSlots: [] })), [])
})
