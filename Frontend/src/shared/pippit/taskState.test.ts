import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  OVERDUE_GRACE_MS,
  countByState,
  dayLabel,
  failedReasonLabel,
  filterTasks,
  groupByDay,
  listChannels,
  matchesQuery,
  pippitTaskState,
  platformOf,
  postLinkLabel,
  relativeTime,
  taskText,
  type PippitTask,
} from './taskState.ts'

const NOW = new Date(2026, 10, 15, 12, 0, 0).getTime()
const MIN = 60 * 1000
const DAY = 24 * 60 * MIN

test('pippitTaskState: Pippit status wins over local flags', () => {
  assert.equal(pippitTaskState({ status: 3 }, NOW), 'published')
  assert.equal(pippitTaskState({ published: true, status: 1 }, NOW), 'published')
  assert.equal(pippitTaskState({ status: 4 }, NOW), 'failed')
  assert.equal(pippitTaskState({ status: 6 }, NOW), 'failed')
  assert.equal(pippitTaskState({ status: 1, failed_reason: 'x' }, NOW), 'failed')
})

test('pippitTaskState: scheduled / overdue / missing', () => {
  assert.equal(pippitTaskState({ status: 1, schedule_time_ms: NOW + 5 * MIN }, NOW), 'scheduled')
  assert.equal(pippitTaskState({ status: 1, schedule_time_ms: NOW - 5 * MIN }, NOW), 'scheduled')
  assert.equal(pippitTaskState({ status: 1, schedule_time_ms: NOW - OVERDUE_GRACE_MS - MIN }, NOW), 'overdue')
  assert.equal(pippitTaskState({ status: 1, schedule_time_ms: NOW - DAY, missing_on_pippit: true }, NOW), 'missing')
  assert.equal(pippitTaskState({ status: 3, missing_on_pippit: true }, NOW), 'published')
})

test('platformOf defaults to facebook (old records had no platform)', () => {
  assert.equal(platformOf({}), 'facebook')
  assert.equal(platformOf({ platform: 'tiktok' }), 'tiktok')
  assert.equal(postLinkLabel({ platform: 'tiktok' }), 'Xem trên TikTok')
})

test('taskText strips the repeated title and pulls hashtag lines out', () => {
  const t = taskText({
    title: 'Baking chocolate lava cake',
    description: 'Baking chocolate lava cake\n\nBaking chocolate lava cake\n\n#shorts #reviewamthuc #foodreview #reels',
  })
  assert.equal(t.title, 'Baking chocolate lava cake')
  assert.equal(t.body, '')
  assert.deepEqual(t.hashtags, ['#shorts', '#reviewamthuc', '#foodreview', '#reels'])
})

test('taskText keeps a real body and inline hashtags', () => {
  const t = taskText({ title: 'Món A', description: 'Món A\n\nNgon tuyệt #ngon\nDòng 2\n#a #b' })
  assert.equal(t.body, 'Ngon tuyệt #ngon\nDòng 2')
  assert.deepEqual(t.hashtags, ['#a', '#b'])
})

test('taskText without title uses the first caption line', () => {
  const t = taskText({ description: 'Dòng đầu\nDòng hai\n#x' })
  assert.equal(t.title, 'Dòng đầu')
  assert.equal(t.body, 'Dòng hai')
})

test('relativeTime is human readable', () => {
  assert.equal(relativeTime(NOW - 30 * 1000, NOW), 'vừa xong')
  assert.equal(relativeTime(NOW + 3 * MIN, NOW), '3 phút nữa')
  assert.equal(relativeTime(NOW - 5 * 60 * MIN, NOW), '5 giờ trước')
  assert.equal(relativeTime(NOW - 55 * DAY, NOW), '55 ngày trước')
  assert.equal(relativeTime(NOW - 120 * DAY, NOW), '4 tháng trước')
})

test('dayLabel names nearby days', () => {
  assert.equal(dayLabel(NOW, NOW), 'Hôm nay')
  assert.equal(dayLabel(NOW - DAY, NOW), 'Hôm qua')
  assert.equal(dayLabel(NOW + DAY, NOW), 'Ngày mai')
  assert.equal(dayLabel(new Date(2026, 8, 21, 7, 24).getTime(), NOW), 'Thứ Hai, 21/09/2026')
})

test('failedReasonLabel translates known codes and keeps the raw code', () => {
  assert.match(failedReasonLabel({ failed_reason: 'cc_ecom_publisher_publish_error_tech_issue' }), /Lỗi kỹ thuật.*tech_issue/)
  assert.equal(failedReasonLabel({ failed_reason: 'abc' }), 'abc')
})

const TASKS: PippitTask[] = [
  { task_id: '1', platform: 'tiktok', page_id: 'tt', page_name: 'sora', status: 3, schedule_time_ms: NOW - DAY, title: 'Bánh chocolate' },
  { task_id: '2', page_id: 'fb', page_name: 'Căn Bếp Nhỏ', status: 4, failed_reason: 'x', schedule_time_ms: NOW - 2 * DAY },
  { task_id: '3', platform: 'facebook', page_id: 'fb', page_name: 'Căn Bếp Nhỏ', status: 1, schedule_time_ms: NOW + 2 * 60 * MIN },
  { task_id: '4', platform: 'facebook', page_id: 'fb', page_name: 'Căn Bếp Nhỏ', status: 1, schedule_time_ms: NOW + DAY },
]

test('matchesQuery is accent-insensitive and ANDs words', () => {
  assert.ok(matchesQuery(TASKS[0], 'banh choco'))
  assert.ok(matchesQuery(TASKS[1], 'can bep'))
  assert.ok(!matchesQuery(TASKS[0], 'banh pizza'))
})

test('filterTasks + countByState + listChannels', () => {
  const counts = countByState(TASKS, NOW)
  assert.deepEqual(counts, { all: 4, scheduled: 2, overdue: 0, published: 1, failed: 1, missing: 0 })
  const fb = filterTasks(TASKS, { state: 'all', platform: 'facebook', channel: 'all', query: '' }, NOW)
  assert.deepEqual(fb.map(t => t.task_id), ['2', '3', '4'])
  const sched = filterTasks(TASKS, { state: 'scheduled', platform: 'all', channel: 'facebook:fb', query: '' }, NOW)
  assert.deepEqual(sched.map(t => t.task_id), ['3', '4'])
  const ch = listChannels(TASKS)
  assert.equal(ch[0].name, 'Căn Bếp Nhỏ')
  assert.equal(ch[0].count, 3)
})

test('groupByDay puts upcoming first (soonest first), then past (newest first)', () => {
  const groups = groupByDay(TASKS, NOW)
  assert.deepEqual(groups.map(g => g.items.map(t => t.task_id)), [['3'], ['4'], ['1'], ['2']])
  assert.equal(groups[0].label, 'Hôm nay')
  assert.equal(groups[1].label, 'Ngày mai')
  assert.equal(groups[2].label, 'Hôm qua')
})
