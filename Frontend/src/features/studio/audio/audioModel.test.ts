import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_CTA,
  DEFAULT_STEPS,
  DEFAULT_STYLE,
  describeStyle,
  estimateSeconds,
  formatDuration,
  mergeStyle,
  planQueue,
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

test('validateQueue: thiếu ảnh không chặn chạy (dùng ảnh bìa nguồn / ảnh thay thế), chỉ liệt kê để cảnh báo', () => {
  const stories = [story('a', 'A'), story('b', 'B', 3, 0, null), { ...story('c', 'C', 3, 0, null), has_cover: true }]
  assert.deepEqual(validateQueue([], stories, 'v').errors, ['Chọn ít nhất 1 chương ở danh sách bên trái.'])
  const v = validateQueue([{ story_slug: 'a', chapter_numbers: [1] }, { story_slug: 'b', chapter_numbers: [1] }, { story_slug: 'c', chapter_numbers: [1] }], stories, '')
  assert.deepEqual(v.noImage.map(s => s.story_slug), ['b'], 'c có ảnh bìa nguồn')
  assert.deepEqual(v.errors, ['Chọn giọng đọc.'])
  assert.deepEqual(validateQueue([{ story_slug: 'b', chapter_numbers: [1] }], stories, 'v').errors, [])
})

test('buildRunBody: luôn batch_items + đơn vị đầu ra', () => {
  const opts = { unit: 'story' as const, voice: 'v', aspect: '16:9' as const, bgm: true, drive: false, bgFit: 'fill' as const, style: DEFAULT_STYLE }
  const single = buildRunBody([{ story_slug: 'a', chapter_numbers: [4] }], opts)
  assert.deepEqual(single.batch_items, [{ story_slug: 'a', chapter_numbers: [4] }])
  assert.equal(single.unit, 'story')
  assert.equal(single.chapter_number, undefined)
  const batch = buildRunBody([{ story_slug: 'a', chapter_numbers: [1, 2] }, { story_slug: 'b', chapter_numbers: [1] }], { ...opts, unit: 'chapter', drive: true })
  assert.deepEqual(batch.batch_items, [{ story_slug: 'a', chapter_numbers: [1, 2] }, { story_slug: 'b', chapter_numbers: [1] }])
  assert.equal(batch.unit, 'chapter')
  assert.equal(batch.auto_upload_drive, true)
  assert.equal(batch.delete_local_after_upload, true)
  assert.equal(batch.story_slug, 'a')
  assert.equal(batch.aspect, '16:9')
  assert.deepEqual(batch.options, DEFAULT_STYLE)
  assert.equal(buildRunBody([{ story_slug: 'a', chapter_numbers: [4] }], { ...opts, bgFit: 'blur' }).bg_fit, 'blur')
})

test('ước lượng thời lượng + số video của hàng đợi', () => {
  assert.equal(estimateSeconds(undefined, 5, 5), null)
  assert.equal(Math.round(estimateSeconds(17900, 5, 5) ?? 0), 1000)
  assert.equal(Math.round(estimateSeconds(17900, 5, 2) ?? 0), 400, 'chia đều theo số chương đã chọn')
  assert.equal(formatDuration(null), '')
  assert.equal(formatDuration(20), '< 1 phút')
  assert.equal(formatDuration(37 * 60), '≈ 37 phút')
  assert.equal(formatDuration(65 * 60), '≈ 1 giờ 5 phút')
  assert.equal(formatDuration(120 * 60), '≈ 2 giờ')
  const stories = [story('a', 'A', 5), story('b', 'B', 40)]
  const lengths = { a: 17.9 * 60 * 37, b: 17.9 * 60 * 300 }
  const queue = [{ story_slug: 'a', chapter_numbers: [1, 2, 3, 4, 5] }, { story_slug: 'b', chapter_numbers: Array.from({ length: 40 }, (_, i) => i + 1) }]
  const plan = planQueue(queue, stories, lengths, 'story')
  assert.equal(plan.videos, 1 + 3, 'truyện 5 giờ chia 3 tập (≤ 120 phút/tập)')
  assert.equal(Math.round((plan.seconds ?? 0) / 60), 337)
  assert.equal(planQueue(queue, stories, lengths, 'chapter').videos, 45)
  assert.equal(planQueue(queue, stories, {}, 'story').seconds, null, 'chưa có độ dài thì không đoán bừa')
})

test('stepState theo danh sách bước của backend: skipped, error, completed', () => {
  const steps = DEFAULT_STEPS
  assert.deepEqual(steps.map(s => s.key), ['prepare', 'voice', 'render', 'mix', 'package', 'done'])
  const running = { status: 'running', step: 'render' }
  assert.equal(stepState(running, 'voice', steps), 'done')
  assert.equal(stepState(running, 'render', steps), 'running')
  assert.equal(stepState(running, 'mix', steps), 'pending')
  assert.equal(stepState({ status: 'running', step: 'voice', skipped_steps: ['prepare'] }, 'prepare', steps), 'skipped')
  assert.equal(stepState({ status: 'error', step: 'voice' }, 'voice', steps), 'error')
  assert.equal(stepState({ status: 'completed', step: 'done' }, 'mix', steps), 'done')
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
  // Cấu hình lưu từ bản trước (không có bố cục/phụ đề) → mặc định mới; giá trị lạ → mặc định.
  const old = mergeStyle({ voice_speed: 1.2, bg_mode: 'cover' })
  assert.equal(old.layout, 'cover_center')
  assert.equal(old.subtitles, true)
  assert.equal(mergeStyle({ layout: 'grid', subtitles: 'yes', cta_text: '   ' }).layout, 'cover_center')
  assert.equal(mergeStyle({ cta_text: '   ' }).cta_text, DEFAULT_CTA)
  assert.equal(mergeStyle({ cta_text: 'x'.repeat(80) }).cta_text.length, 60)
  assert.equal(mergeStyle({ layout: 'classic', subtitles: false }).subtitles, false)
})

test('describeStyle: chỉ liệt kê khác mặc định; lớp phủ của bố cục "Nền video" chỉ tính khi đang dùng bố cục đó', () => {
  assert.deepEqual(describeStyle(DEFAULT_STYLE), [])
  const overlays = { dim: 0.3, waveform: true, title_card: 'intro' as const, bg_mode: 'cover' as const }
  const custom = { ...DEFAULT_STYLE, ...overlays, layout: 'classic' as const, voice_speed: 1.1, logo_id: 'abcdef012345', bgm_volume: 0.4, loudnorm: false, subtitles: false }
  assert.deepEqual(describeStyle(custom), ['Đọc ×1.10', 'Nhạc 40%', 'Không chuẩn hóa âm lượng', 'Không phụ đề', 'Nền ảnh bìa', 'Tối 30%', 'Tiêu đề đầu video', 'Waveform', 'Logo'])
  assert.deepEqual(describeStyle({ ...DEFAULT_STYLE, ...overlays }), [], 'bố cục ảnh bìa bỏ qua các lớp phủ đó')
  assert.deepEqual(describeStyle({ ...DEFAULT_STYLE, cta_text: 'Theo dõi kênh' }), ['Lời nhắc riêng'])
  assert.deepEqual(describeStyle({ ...DEFAULT_STYLE, cta: false, chapter_label: false }), ['Không nhãn chương', 'Không nhắc đăng ký'])
})
