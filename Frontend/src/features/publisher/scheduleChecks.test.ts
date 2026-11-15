import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  channelLabel,
  countByTarget,
  ensureFutureTimes,
  isPostedToTarget,
  scheduleRange,
  summarizeRun,
} from './scheduleChecks.ts'

const SORA = { page_id: '4056099954436', page_name: 'sora', platform: 'tiktok', handle: 'sorasocute6' }
const BEP = { page_id: '4047175776004', page_name: 'Căn Bếp Nhỏ', platform: 'facebook' }

test('isPostedToTarget matches by channel id', () => {
  assert.ok(isPostedToTarget([{ platform: 'tiktok', channel_name: 'x', channel_id: '4056099954436' }], SORA))
})

test('isPostedToTarget matches by platform + accent-insensitive name, ignores other platform', () => {
  assert.ok(isPostedToTarget([{ platform: 'facebook', channel_name: 'Can Bep Nho' }], BEP))
  assert.ok(!isPostedToTarget([{ platform: 'tiktok', channel_name: 'Căn Bếp Nhỏ' }], BEP))
  assert.ok(isPostedToTarget([{ platform: 'tiktok', channel_name: '[TikTok] sora (@sorasocute6)' }], SORA))
  assert.ok(!isPostedToTarget([], SORA))
  assert.ok(!isPostedToTarget(undefined, SORA))
})

test('channelLabel shows platform and handle', () => {
  assert.equal(channelLabel(SORA), 'TikTok · sora (@sorasocute6)')
  assert.equal(channelLabel(BEP), 'Facebook · Căn Bếp Nhỏ')
})

test('scheduleRange / countByTarget', () => {
  const slots = [
    { file_id: 'a', schedule_time_ms: 300, page_id: 'p1' },
    { file_id: 'b', schedule_time_ms: 100, page_id: 'p2' },
    { file_id: 'c', schedule_time_ms: 200, page_id: 'p1' },
  ]
  assert.deepEqual(scheduleRange(slots), { first: 100, last: 300 })
  assert.equal(scheduleRange([]), null)
  assert.deepEqual([...countByTarget(slots)], [['p1', 2], ['p2', 1]])
})

test('ensureFutureTimes shifts only past slots and spaces them', () => {
  const now = 1_000_000
  const out = ensureFutureTimes(
    [
      { file_id: 'a', schedule_time_ms: now - 10, page_id: 'p' },
      { file_id: 'b', schedule_time_ms: now + 3_600_000, page_id: 'p' },
      { file_id: 'c', schedule_time_ms: now + 60_000, page_id: 'p' },
    ],
    now
  )
  assert.equal(out[0].schedule_time_ms, now + 180_000)
  assert.equal(out[1].schedule_time_ms, now + 3_600_000)
  assert.equal(out[2].schedule_time_ms, now + 180_000 + 300_000)
})

test('summarizeRun', () => {
  const base = { file_id: 'x', file_name: 'x', title: 'x', page_name: 'p', schedule_time_ms: 0 }
  assert.equal(summarizeRun([{ ...base, ok: true }, { ...base, ok: true }]).text, 'Đã lên lịch 2/2 video qua Pippit.')
  const r = summarizeRun([{ ...base, ok: true }, { ...base, ok: false, error: 'e' }])
  assert.equal(r.failed, 1)
  assert.equal(r.text, 'Đã lên lịch 1/2 video, 1 video lỗi.')
})
