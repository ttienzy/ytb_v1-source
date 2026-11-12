import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  audioSteps,
  DEFAULT_STYLE,
  describeStyle,
  mergeStyle,
  styleNeedsOverlay,
  backgroundSummary,
  hasBackgroundWork,
  type BgItem,
  buildRunBody,
  buildStoryViews,
  doneSet,
  canAddStory,
  chapterRange,
  filterStoryViews,
  formatRanges,
  normalizeText,
  parseSummary,
  pruneCompleted,
  queueTotals,
  removeStory,
  setStoryChapters,
  stepState,
  toggleChapter,
  validateQueue,
  type AudioStory,
  type QueueItem,
} from './audioModel.ts'

const ch = (n: number, completed = false) => ({ chapter_number: n, title: `C${n}`, completed })
const story = (slug: string, name: string, total = 3, done = 0, thumbnail: string | null = 't.png'): AudioStory => ({ story_slug: slug, name, thumbnail_name: thumbnail, total_chapters: total, done_chapters: done })

test('normalizeText bỏ dấu tiếng Việt và đ', () => {
  assert.equal(normalizeText('  TA LÀ TẠ UYỂN '), 'ta la ta uyen')
  assert.equal(normalizeText('Đại Đường'), 'dai duong')
})

test('buildStoryViews: trạng thái + sắp xếp (đã xong xuống cuối, còn lại theo tên)', () => {
  const stories = [
    story('b', 'Bạch Xà', 2, 2),
    story('a', 'An Nhiên', 2, 1),
    story('c', 'Cửu Long', 2, 0),
    story('d', 'Rỗng', 0, 0),
  ]
  const views = buildStoryViews(stories)
  assert.deepEqual(views.map(v => [v.story.story_slug, v.status]), [['a', 'partial'], ['c', 'new'], ['d', 'empty'], ['b', 'done']])
  assert.equal(views[0].doneCount, 1)
})

test('buildStoryViews: số đã làm không vượt tổng', () => {
  const views = buildStoryViews([story('a', 'A', 3, 9)])
  assert.equal(views[0].doneCount, 3)
  assert.equal(views[0].status, 'done')
})

test('doneSet lấy các chương đã hoàn thành từ danh sách chương đã tải', () => {
  assert.deepEqual([...doneSet([ch(1, true), ch(2), ch(3, true)])].sort(), [1, 3])
  assert.equal(doneSet(null).size, 0)
})

test('filterStoryViews: tìm không dấu theo từng từ + bộ lọc trạng thái + queued', () => {
  const views = buildStoryViews([story('a', 'Ta Là Tạ Uyển'), story('b', 'Đại Đường', 1, 1), story('c', 'Tạ Uyển Ngoại Truyện', 2, 1)])
  const slugs = (opts: Parameters<typeof filterStoryViews>[1]) => filterStoryViews(views, opts).map(v => v.story.story_slug).sort()
  assert.deepEqual(slugs({ query: 'ta uyen', filter: 'all', queue: [] }), ['a', 'c'])
  assert.deepEqual(slugs({ query: 'dai duong', filter: 'all', queue: [] }), ['b'])
  assert.deepEqual(slugs({ query: '', filter: 'pending', queue: [] }), ['a', 'c'])
  assert.deepEqual(slugs({ query: '', filter: 'done', queue: [] }), ['b'])
  assert.deepEqual(slugs({ query: '', filter: 'partial', queue: [] }), ['c'])
  assert.deepEqual(slugs({ query: '', filter: 'queued', queue: [{ story_slug: 'b', chapter_numbers: [1] }] }), ['b'])
})

test('hàng đợi: toggle, sắp xếp, bỏ truyện khi hết chương, giới hạn số truyện', () => {
  let q: QueueItem[] = []
  q = toggleChapter(q, 'a', 3)
  q = toggleChapter(q, 'a', 1)
  assert.deepEqual(q, [{ story_slug: 'a', chapter_numbers: [1, 3] }])
  q = toggleChapter(q, 'a', 1)
  q = toggleChapter(q, 'a', 3)
  assert.deepEqual(q, [])
  assert.deepEqual(queueTotals(setStoryChapters([], 'x', [2, 2, 1])), { stories: 1, chapters: 2 })

  let full: QueueItem[] = []
  for (let i = 0; i < 3; i++) full = setStoryChapters(full, `s${i}`, [1], 3)
  assert.equal(canAddStory(full, 's9', 3), false)
  assert.equal(canAddStory(full, 's1', 3), true)
  assert.equal(setStoryChapters(full, 's9', [1], 3), full, 'quá giới hạn thì không thêm')
  assert.deepEqual(removeStory(full, 's1').map(i => i.story_slug), ['s0', 's2'])
})

test('chapterRange (Shift+click) theo thứ tự hiển thị, cả hai chiều', () => {
  const shown = [5, 6, 7, 8, 9]
  assert.deepEqual(chapterRange(shown, 6, 8), [6, 7, 8])
  assert.deepEqual(chapterRange(shown, 9, 7), [7, 8, 9])
  assert.deepEqual(chapterRange(shown, 6, 42), [42])
})

test('pruneCompleted giữ lại chương chưa xong (vd chương lỗi); truyện chưa tải lại thì giữ nguyên', () => {
  const q: QueueItem[] = [
    { story_slug: 'a', chapter_numbers: [1, 2, 3] },
    { story_slug: 'b', chapter_numbers: [1] },
    { story_slug: 'c', chapter_numbers: [4, 5] },
  ]
  const fresh = { a: [ch(1, true), ch(2, true), ch(3)], b: [ch(1, true)] }
  assert.deepEqual(pruneCompleted(q, fresh), [{ story_slug: 'a', chapter_numbers: [3] }, { story_slug: 'c', chapter_numbers: [4, 5] }])
})

test('validateQueue', () => {
  const stories = [story('a', 'A'), story('b', 'B', 3, 0, null)]
  assert.deepEqual(validateQueue([], stories, 'v').errors, ['Chọn ít nhất 1 chương ở danh sách bên trái.'])
  const v = validateQueue([{ story_slug: 'a', chapter_numbers: [1] }, { story_slug: 'b', chapter_numbers: [1] }], stories, '')
  assert.deepEqual(v.missingThumbnail.map(s => s.story_slug), ['b'])
  assert.equal(v.errors.length, 2)
  assert.deepEqual(validateQueue([{ story_slug: 'a', chapter_numbers: [1] }], stories, 'v').errors, [])
})

test('buildRunBody: 1 chương -> chạy đơn, nhiều -> batch_items', () => {
  const opts = { voice: 'v', aspect: '9:16' as const, bgm: true, drive: false, bgFit: 'fill' as const, style: DEFAULT_STYLE }
  const single = buildRunBody([{ story_slug: 'a', chapter_numbers: [4] }], opts)
  assert.equal(single.chapter_number, 4)
  assert.equal(single.batch_items, undefined)
  const batch = buildRunBody([{ story_slug: 'a', chapter_numbers: [1, 2] }, { story_slug: 'b', chapter_numbers: [1] }], { ...opts, drive: true })
  assert.deepEqual(batch.batch_items, [{ story_slug: 'a', chapter_numbers: [1, 2] }, { story_slug: 'b', chapter_numbers: [1] }])
  assert.equal(batch.auto_upload_drive, true)
  assert.equal(batch.delete_local_after_upload, true)
  assert.equal(batch.story_slug, 'a')
  assert.equal(batch.bg_fit, 'fill')
  assert.deepEqual(batch.options, DEFAULT_STYLE)
  assert.deepEqual(single.options, DEFAULT_STYLE)
  assert.equal(buildRunBody([{ story_slug: 'a', chapter_numbers: [4] }], { ...opts, bgFit: 'blur' }).bg_fit, 'blur')
})

test('audioSteps + stepState: thứ tự khớp backend, skipped, error, completed', () => {
  const steps = audioSteps({ bgm: true, drive: false })
  assert.deepEqual(steps.map(s => s.key), ['image', 'voice', 'duration', 'merge', 'mux', 'bgm', 'done'])
  assert.deepEqual(audioSteps({ bgm: false, drive: true }).map(s => s.key), ['image', 'voice', 'duration', 'merge', 'mux', 'drive', 'done'])
  assert.deepEqual(audioSteps({ bgm: true, drive: false, overlay: true }).map(s => s.key), ['image', 'voice', 'duration', 'merge', 'overlay', 'mux', 'bgm', 'done'])
  const running = { status: 'running', step: 'merge' }
  assert.equal(stepState(running, 'voice', steps), 'done')
  assert.equal(stepState(running, 'merge', steps), 'running')
  assert.equal(stepState(running, 'mux', steps), 'pending')
  assert.equal(stepState({ status: 'running', step: 'voice', skipped_steps: ['image'] }, 'image', steps), 'skipped')
  assert.equal(stepState({ status: 'error', step: 'voice' }, 'voice', steps), 'error')
  assert.equal(stepState({ status: 'completed', step: 'done' }, 'bgm', steps), 'done')
  assert.equal(stepState(null, 'voice', steps), 'pending')
})

test('formatRanges gộp dải liên tiếp', () => {
  assert.equal(formatRanges([1, 2, 3, 5, 7, 8]), '1–3, 5, 7–8')
  assert.equal(formatRanges([9, 1, 1]), '1, 9')
  assert.equal(formatRanges([]), '')
})

test('parseSummary: tiêu đề viết hoa, gạch đầu dòng, đoạn văn', () => {
  const blocks = parseSummary('GIỚI THIỆU\nTruyện về cô gái trọng sinh.\n\nDIỄN BIẾN CHÍNH:\n- Chương 1–3: hủy hôn\n* Chương 4: đối đầu\n\nĐIỂM NỔI BẬT\nNhịp nhanh.')
  assert.deepEqual(blocks.map(b => b.type), ['heading', 'para', 'heading', 'bullet', 'bullet', 'heading', 'para'])
  assert.equal(blocks[2].text, 'DIỄN BIẾN CHÍNH')
  assert.equal(blocks[3].text, 'Chương 1–3: hủy hôn')
  assert.deepEqual(parseSummary('  \n '), [])
  assert.equal(parseSummary('1234')[0].type, 'para', 'chỉ số không phải tiêu đề')
})

const bg = (id: string, a: BgItem['states']['9:16']['status'], b: BgItem['states']['9:16']['status']): BgItem => ({
  video_id: id, name: id, duration_sec: 10, size_bytes: 1,
  states: { '9:16': { status: a }, '16:9': { status: b, error: b === 'error' ? 'boom' : null } },
})

test('backgroundSummary đếm theo khổ đang chọn', () => {
  const items = [bg('a', 'ready', 'missing'), bg('b', 'running', 'ready'), bg('c', 'error', 'ready'), bg('d', 'queued', 'error')]
  assert.deepEqual(backgroundSummary(items, '9:16'), { total: 4, ready: 1, busy: 2, failed: 1 })
  assert.deepEqual(backgroundSummary(items, '16:9'), { total: 4, ready: 2, busy: 0, failed: 1 })
  assert.deepEqual(backgroundSummary([], '9:16'), { total: 0, ready: 0, busy: 0, failed: 0 })
})

test('hasBackgroundWork: còn clip chờ/đang chuẩn hóa ở khổ nào cũng cần theo dõi', () => {
  assert.equal(hasBackgroundWork([bg('a', 'ready', 'ready')]), false)
  assert.equal(hasBackgroundWork([bg('a', 'ready', 'queued')]), true)
  assert.equal(hasBackgroundWork([bg('a', 'missing', 'error')]), false)
})

test('mergeStyle: thiếu trường -> mặc định; sai kiểu/ngoài khoảng -> kẹp về hợp lệ', () => {
  assert.deepEqual(mergeStyle(undefined), DEFAULT_STYLE)
  assert.deepEqual(mergeStyle('rác'), DEFAULT_STYLE)
  const s = mergeStyle({ voice_speed: 9, bgm_volume: -1, dim: 'x', title_card: 'bay', bgm_duck: 'strong', logo_id: '../x', logo_position: 'bl', waveform: 1, fade_out_sec: 3 })
  assert.equal(s.voice_speed, 1.5)
  assert.equal(s.bgm_volume, 0)
  assert.equal(s.dim, 0)
  assert.equal(s.title_card, 'off')
  assert.equal(s.bgm_duck, 'strong')
  assert.equal(s.logo_id, null)
  assert.equal(s.logo_position, 'bl')
  assert.equal(s.waveform, false)
  assert.equal(s.fade_out_sec, 3)
  assert.equal(mergeStyle({ logo_id: 'abcdef012345' }).logo_id, 'abcdef012345')
})

test('styleNeedsOverlay + describeStyle', () => {
  assert.equal(styleNeedsOverlay(DEFAULT_STYLE), false)
  assert.deepEqual(describeStyle(DEFAULT_STYLE), [])
  const custom = { ...DEFAULT_STYLE, dim: 0.3, waveform: true, voice_speed: 1.1, title_card: 'intro' as const, bg_mode: 'cover' as const, logo_id: 'abcdef012345', bgm_volume: 0.4, loudnorm: false }
  assert.equal(styleNeedsOverlay(custom), true)
  assert.deepEqual(describeStyle(custom), ['Đọc ×1.10', 'Nhạc 40%', 'Không chuẩn hóa âm lượng', 'Nền ảnh bìa', 'Tối 30%', 'Tiêu đề đầu video', 'Waveform', 'Logo'])
  assert.equal(styleNeedsOverlay({ ...DEFAULT_STYLE, bg_mode: 'cover' }), false, 'đổi nền không cần lớp phủ')
})
