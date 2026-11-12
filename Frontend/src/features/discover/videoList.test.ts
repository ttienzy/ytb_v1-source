import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { ChannelVideo } from './types.ts'
import { filterVideos, keepExistingSelection, mergeVideos, scanToast } from './videoList.ts'

function vid(id: string, extra: Partial<ChannelVideo> = {}): ChannelVideo {
  return {
    id,
    title: id,
    url: `https://youtu.be/${id}`,
    duration_formatted: '10:00',
    view_count_formatted: '1 lượt xem',
    thumbnail_url: '',
    ...extra,
  }
}

const sample = [
  vid('a', { is_new: true, view_count: 5, duration_sec: 600 }),
  vid('b', { is_new: true, processed_status: 'completed', view_count: 50 }),
  vid('c', { processed_status: 'processing', view_count: 500 }),
  vid('d', { duration_sec: 60, view_count: 1 }),
]

test('filter new: chỉ video mới mà chưa làm', () => {
  assert.deepEqual(filterVideos(sample, 'new').map(v => v.id), ['a'])
})

test('filter unprocessed loại cả completed lẫn processing', () => {
  assert.deepEqual(filterVideos(sample, 'unprocessed').map(v => v.id), ['a', 'd'])
})

test('filter completed / golden / views / all', () => {
  assert.deepEqual(filterVideos(sample, 'completed').map(v => v.id), ['b'])
  assert.deepEqual(filterVideos(sample, 'golden').map(v => v.id), ['a'])
  assert.deepEqual(filterVideos(sample, 'views').map(v => v.id), ['c', 'b', 'a', 'd'])
  assert.deepEqual(filterVideos(sample, 'all').map(v => v.id), ['a', 'b', 'c', 'd'])
})

test('mergeVideos bỏ trùng và giữ thứ tự', () => {
  const merged = mergeVideos([vid('a'), vid('b')], [vid('b'), vid('c')])
  assert.deepEqual(merged.map(v => v.id), ['a', 'b', 'c'])
})

test('keepExistingSelection bỏ URL không còn trong danh sách', () => {
  assert.deepEqual(keepExistingSelection(['https://youtu.be/a', 'https://youtu.be/zz'], sample), ['https://youtu.be/a'])
})

test('scanToast', () => {
  assert.equal(scanToast({ first_scan: true, new_in_scan: 0, previous_scan_at: null }, false), null)
  assert.match(scanToast({ first_scan: true, new_in_scan: 0, previous_scan_at: null }, true)!, /mốc/)
  assert.match(scanToast({ first_scan: false, new_in_scan: 2, previous_scan_at: 1_700_000_000 }, false)!, /Có 2 video mới/)
  assert.match(scanToast({ first_scan: false, new_in_scan: 0, previous_scan_at: 1_700_000_000 }, true)!, /chưa đăng video mới/)
  assert.equal(scanToast({ first_scan: false, new_in_scan: 0, previous_scan_at: 1_700_000_000 }, false), null)
})
