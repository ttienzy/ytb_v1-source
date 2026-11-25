import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  AI_DISCLOSURE,
  cleanTitleFromName,
  getCaptionWarnings,
  isMeaningfulTitle,
  renderCaptionTemplate,
  resolveSlotCaption,
  resolveSlotTitle,
  resolveSpintax,
  smartTruncate,
  uniqueTags,
} from './captionUtils.ts'

const vars = { title: 'Set thun NY', hashtags: ['#thun', '#ny'], index: 3, date: '25/11' }
const video = { title: 'x', file_name: 'd327067e-de3.mp4' }

test('{filename} / {title} KHÔNG bị xoá ngược khỏi caption (lỗi cũ: tiêu đề biến mất rồi backend nhồi tên file)', () => {
  const out = renderCaptionTemplate('{filename}\n\nMặc cực mát #hot', vars, 0)
  assert.equal(out, 'Set thun NY\n\nMặc cực mát #hot\n\n#thun #ny')
  assert.equal(renderCaptionTemplate('{title} - {title}', { ...vars, hashtags: [] }, 0), 'Set thun NY - Set thun NY')
})

test('biến {hashtags} {cta} {index} {date}; mẫu không có {hashtags} thì hashtag được nối cuối', () => {
  assert.equal(renderCaptionTemplate('Bài {index} ngày {date}\n{cta}\n{hashtags}', { ...vars, cta: 'Chốt đơn' }, 0), 'Bài 3 ngày 25/11\nChốt đơn\n#thun #ny')
  assert.equal(renderCaptionTemplate('Chỉ chữ', vars, 0), 'Chỉ chữ\n\n#thun #ny')
  assert.equal(renderCaptionTemplate('Chỉ chữ', { ...vars, hashtags: [] }, 0), 'Chỉ chữ')
})

test('giá trị biến chứa ngoặc nhọn không bị thay lại', () => {
  assert.equal(renderCaptionTemplate('{title}', { ...vars, title: '{cta} đỏ', hashtags: [] }, 0), '{cta} đỏ')
})

test('spintax: xác định theo seed, mỗi bài một lựa chọn', () => {
  const t = '{Mặc là mê|Xinh xỉu|Chốt ngay}'
  assert.equal(resolveSpintax(t, 0), resolveSpintax(t, 0))
  assert.deepEqual(new Set([0, 1, 2].map(s => resolveSpintax(t, s))).size, 3)
  assert.equal(resolveSpintax('{title} không phải spintax', 5), '{title} không phải spintax')
})

test('resolveSlotCaption: override > nguồn > mẫu', () => {
  const src = { ...video, default_caption: 'Caption nguồn', default_hashtags: ['#src'], default_cta: 'Bấm giỏ' }
  const base = { mode: 'smart' as const, video: src, template: 'Mẫu {title}', tags: ['#tpl'], index: 0, date: '' }
  assert.equal(resolveSlotCaption({ ...base, override: { caption: 'Tay sửa' } }), 'Tay sửa')
  assert.equal(resolveSlotCaption(base), 'Caption nguồn\n\nBấm giỏ\n\n#src')
  assert.equal(resolveSlotCaption({ ...base, mode: 'template' }), 'Mẫu\n\n#src #tpl')
  const bare = { ...base, video }
  assert.equal(resolveSlotCaption(bare), 'Mẫu\n\n#tpl') // tên file thô (hash) không lộ ra
  assert.equal(resolveSlotCaption({ ...bare, override: { caption: '' } }), '')
})

test('khai báo AI chỉ thêm một lần khi bật', () => {
  const base = { mode: 'template' as const, video, template: 'Hi', tags: [], index: 0, date: '', appendDisclosure: true }
  const once = resolveSlotCaption(base)
  assert.equal(once, `Hi\n\n${AI_DISCLOSURE}`)
  assert.equal(resolveSlotCaption({ ...base, override: { caption: once } }), once)
})

test('resolveSlotTitle: không lấy tên file thô làm tiêu đề', () => {
  assert.equal(resolveSlotTitle(video, undefined, 'Dòng đầu hay\n#tag'), 'Dòng đầu hay')
  assert.equal(resolveSlotTitle({ ...video, default_title: 'Hook gốc' }, undefined, 'x'), 'Hook gốc')
  assert.equal(resolveSlotTitle(video, { title: 'Sửa tay' }, 'x'), 'Sửa tay')
})

test('isMeaningfulTitle / cleanTitleFromName', () => {
  assert.ok(!isMeaningfulTitle('d327067e-de3'))
  assert.ok(!isMeaningfulTitle('muse_final_20261115_101331_ddbf'))
  assert.ok(isMeaningfulTitle('Baking chocolate lava cake'))
  assert.equal(cleanTitleFromName('Preparing_Phở_Bò_final_20261115101331.mp4'), 'Preparing Phở Bò')
})

test('smartTruncate cắt theo từ; uniqueTags chuẩn hoá', () => {
  const out = smartTruncate('một hai ba bốn năm sáu bảy tám chín mười', 20)
  assert.ok(out.length <= 20 && out.endsWith('…') && !out.includes('sá…'))
  assert.deepEqual(uniqueTags(['a', '#A', ' b c ', '#', '']), ['#a', '#bc'])
})

test('getCaptionWarnings', () => {
  assert.deepEqual(getCaptionWarnings('ok', 'tiktok', 1000), [])
  assert.ok(getCaptionWarnings('', 'tiktok', 1)[0].includes('trống'))
  assert.ok(getCaptionWarnings('x'.repeat(2300), 'tiktok', 1).some(w => w.includes('2200')))
  assert.ok(getCaptionWarnings('x'.repeat(560), 'facebook', 1).some(w => w.includes('Facebook')))
  assert.equal(getCaptionWarnings('x'.repeat(560), 'tiktok', 1).length, 0)
  assert.ok(getCaptionWarnings('ok', 'tiktok', 300 * 1024 * 1024).some(w => w.includes('250 MB')))
  assert.ok(getCaptionWarnings('Xem d327067e-de3 nè', 'tiktok', 1, 'd327067e-de3.mp4').some(w => w.includes('tên file')))
})
