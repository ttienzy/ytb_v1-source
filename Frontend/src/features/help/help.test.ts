import assert from 'node:assert/strict'
import { test } from 'node:test'
import { NAV_STRUCTURE, PAGE_IDS, isPageId } from '../../shared/navModel.ts'
import { HELP_DOCS, HELP_GROUPS, OVERVIEW_GUIDE, allHelpDocs, getHelpDoc } from './registry.ts'
import { allGuideText, allText, fold, legacyToHelpDoc, recentChanges, searchDocs, sectionsOf, slug, type HelpDoc } from './model.ts'
import { HINTS } from './hints.ts'

// Từ khóa của tính năng đã bỏ/đổi tên. Doc đã đối chiếu (verifiedAt) mà nhắc lại thì test đỏ.
// Mỗi lần bỏ một tính năng, thêm một từ vào đây.
const BANNED_TERMS = ['Whisper', 'Studio Batch', 'Smart Crop', 'Omni 1.1', 'Veo 2', '9router', 'AI Workflow']

test('help: danh sách trang sinh từ NAV_STRUCTURE, đúng nhóm và thứ tự sidebar', () => {
  assert.deepEqual(
    HELP_GROUPS.map(g => [g.title, g.pages.map(p => p.pageId)]),
    NAV_STRUCTURE.map(g => [g.title, g.items.map(i => i.label)]),
  )
})

test('help: mọi trang sidebar đều có doc, và doc nào cũng đã được đối chiếu (verifiedAt)', () => {
  for (const id of PAGE_IDS) {
    assert.ok(HELP_DOCS[id], `${id} chưa có tài liệu`)
    assert.ok(HELP_DOCS[id].verifiedAt, `${id} chưa có verifiedAt`)
  }
})

test('help: không rơi về doc khác — id lạ trả null, trang có doc trả đúng doc', () => {
  assert.equal(getHelpDoc('Chiến dịch AI')?.pageId, 'Chiến dịch AI')
  assert.equal(getHelpDoc('Trang không tồn tại'), null)
  assert.equal(getHelpDoc('Dashboard')?.pageId, 'Dashboard')
})

test('help: pageId khớp khóa, related trỏ tới trang có thật, neo area không trùng', () => {
  for (const doc of allHelpDocs()) {
    assert.equal(HELP_DOCS[doc.pageId], doc)
    for (const rel of doc.related) assert.ok(isPageId(rel), `${doc.pageId}: related "${rel}" không tồn tại`)
    const ids = doc.areas.map(a => a.id)
    assert.equal(new Set(ids).size, ids.length, `${doc.pageId}: neo area trùng`)
    for (const req of doc.requires) if (req.fixPage) assert.ok(isPageId(req.fixPage))
    for (const p of doc.problems) if (p.link) assert.ok(isPageId(p.link))
  }
})

test('help: verifiedAt là ngày YYYY-MM-DD hợp lệ', () => {
  for (const doc of allHelpDocs()) assert.match(doc.verifiedAt ?? '', /^\d{4}-\d{2}-\d{2}$/, doc.pageId)
})

test('help: doc đã đối chiếu không được nhắc từ khóa đã bỏ', () => {
  for (const doc of allHelpDocs().filter(d => d.verifiedAt)) {
    const text = fold(allText(doc))
    for (const term of BANNED_TERMS) assert.ok(!text.includes(fold(term)), `${doc.pageId} còn nhắc "${term}"`)
  }
})

test('legacyToHelpDoc giữ nguyên nội dung và lọc related không hợp lệ', () => {
  const doc = legacyToHelpDoc(
    {
      id: 'x',
      title: 'T',
      category: 'C',
      badge: 'B',
      summary: 'S',
      subTabs: [{ id: 'tab-a', label: 'Tab A', desc: 'mô tả', flowSteps: ['1', '2'] }],
      quickSteps: [{ step: 1, title: 'Bước', desc: 'làm gì' }],
      features: [{ title: 'Tab A', desc: 'trùng tên', tip: 'mẹo' }],
      proTips: ['tip'],
      troubleshooting: [{ issue: 'lỗi', solution: 'cách sửa' }],
      relatedPages: ['Video', 'Trang ma'],
    },
    'Dashboard',
  )
  assert.equal(doc.verifiedAt, null)
  assert.deepEqual(doc.start, [{ title: 'Bước', do: 'làm gì' }])
  assert.deepEqual(doc.problems, [{ symptom: 'lỗi', fix: 'cách sửa' }])
  assert.deepEqual(doc.related, ['Video'])
  assert.deepEqual(doc.areas.map(a => a.id), ['tab-a', 'tab-a-2'])
  assert.deepEqual(doc.tips, ['tip'])
})

test('fold/slug: bỏ dấu tiếng Việt, đ -> d', () => {
  assert.equal(fold('Đường Dẫn Âm Thanh'), 'duong dan am thanh')
  assert.equal(slug('Nền video — Lấp đầy!'), 'nen-video-lap-day')
})

function sample(over: Partial<HelpDoc> = {}): HelpDoc {
  return {
    pageId: 'Video',
    title: 'Video',
    summary: '',
    verifiedAt: '2026-11-12',
    requires: [],
    start: [{ title: 'Chọn nền', do: 'Bấm Quản lý nền để thêm video nền' }],
    areas: [{ id: 'nen-video', name: 'Nền video', what: 'Thư viện video nền, tự chuẩn hóa' }],
    concepts: [],
    problems: [{ symptom: 'Không có video nền', fix: 'Tải video local lên thư viện' }],
    related: [],
    changes: [],
    ...over,
  }
}

test('searchDocs: không dấu, mọi từ phải khớp, tiêu đề xếp trước', () => {
  const docs = [sample()]
  const hits = searchDocs(docs, 'nen video')
  assert.ok(hits.length >= 2)
  assert.equal(hits[0].anchor, 'nen-video') // khớp tiêu đề của area
  assert.deepEqual(searchDocs(docs, 'nen khong-co-tu-nay'), [])
  assert.deepEqual(searchDocs(docs, '   '), [])
  const problem = searchDocs(docs, 'local')[0]
  assert.equal(problem.section, 'problems')
})

test('sectionsOf chỉ trả các mục có nội dung', () => {
  assert.deepEqual(sectionsOf(sample()), ['start', 'areas', 'problems'])
  assert.deepEqual(sectionsOf(sample({ tips: ['x'], areas: [] })), ['start', 'areas', 'problems'])
})

test('mọi doc có tóm tắt, ít nhất một bước bắt đầu, một khối giao diện và một sự cố', () => {
  for (const doc of allHelpDocs()) {
    assert.ok(doc.summary.length > 20, `${doc.pageId}: thiếu tóm tắt`)
    assert.ok(doc.start.length > 0, `${doc.pageId}: không có bước nào`)
    assert.ok(doc.areas.length > 0, `${doc.pageId}: không có khối giao diện`)
    assert.ok(doc.problems.length > 0, `${doc.pageId}: không có sự cố`)
    assert.ok(doc.related.length > 0, `${doc.pageId}: không có trang liên quan`)
  }
})

test('Tổng quan quy trình: mọi bước trỏ tới trang có thật, không nhắc từ khóa đã bỏ', () => {
  assert.ok(OVERVIEW_GUIDE.journeys.length >= 4)
  const ids = OVERVIEW_GUIDE.journeys.map(j => j.id)
  assert.equal(new Set(ids).size, ids.length)
  for (const journey of OVERVIEW_GUIDE.journeys) {
    assert.ok(journey.steps.length >= 2, journey.name)
    for (const step of journey.steps) assert.ok(isPageId(step.page), `${journey.name}: "${step.page}" không phải trang`)
  }
  const text = fold(allGuideText(OVERVIEW_GUIDE))
  for (const term of BANNED_TERMS) assert.ok(!text.includes(fold(term)), `Tổng quan còn nhắc "${term}"`)
})

test('hints: mỗi dấu "?" trỏ tới một khối hoặc mục có thật trong doc của trang đó', () => {
  const sections = ['requires', 'start', 'areas', 'concepts', 'problems', 'changes', 'related']
  for (const [key, hint] of Object.entries(HINTS)) {
    const doc = HELP_DOCS[hint.pageId]
    assert.ok(doc, `${key}: trang ${hint.pageId} chưa có doc`)
    const exists = doc.areas.some(area => area.id === hint.anchor) || sections.includes(hint.anchor)
    assert.ok(exists, `${key}: neo "${hint.anchor}" không có trong doc ${hint.pageId}`)
    assert.ok(hint.label.length > 0)
  }
})

test('recentChanges: gom từ mọi doc, mới nhất trước, có giới hạn', () => {
  const docs = [
    { ...sample(), pageId: 'Video' as const, changes: [{ date: '2026-11-10', text: 'a' }, { date: '2026-11-12', text: 'b' }] },
    { ...sample(), pageId: 'Voices' as const, changes: [{ date: '2026-11-11', text: 'c' }] },
  ]
  const list = recentChanges(docs, 2)
  assert.deepEqual(list.map(c => c.text), ['b', 'c'])
  assert.equal(list[0].pageId, 'Video')
  assert.deepEqual(recentChanges([], 5), [])
  assert.ok(recentChanges(allHelpDocs(), 50).length > 0)
})
