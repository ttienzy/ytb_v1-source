import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MUSE_HANDLE,
  PROMPT_BOX_MAX_CHARS,
  createClipScriptNode,
  createPromptBoxNode,
  createScriptNode,
  explainMuseConnection,
  isValidMuseConnection,
  normalizePromptBoxData,
  promptBoxPreview,
  promptBoxStats,
} from '../services/museCanvasNodes.ts'
import { copyGraph } from '../services/museProjects.ts'

test('Ô prompt: tạo mới, id tiền tố promptbox, mỗi lần 1 ô riêng', () => {
  const a = createPromptBoxNode({ x: 0, y: 0 })
  const b = createPromptBoxNode({ x: 0, y: 0 })
  assert.equal(a.type, 'musePromptBox')
  assert.match(a.id, /^promptbox-/)
  assert.notEqual(a.id, b.id)
  assert.deepEqual(a.data, { title: 'Ô prompt', label: '', text: '', collapsed: false })
})

test('đọc dữ liệu: thiếu / sai kiểu / quá dài', () => {
  assert.deepEqual(normalizePromptBoxData(undefined), { title: 'Ô prompt', label: '', text: '', collapsed: false })
  assert.deepEqual(normalizePromptBoxData({ label: 'A', text: 5, collapsed: 'yes' }), { title: 'Ô prompt', label: 'A', text: '', collapsed: false })
  assert.equal(normalizePromptBoxData({ text: 'x'.repeat(PROMPT_BOX_MAX_CHARS + 10) }).text.length, PROMPT_BOX_MAX_CHARS)
  assert.equal(normalizePromptBoxData({ collapsed: true }).collapsed, true)
})

test('đếm chữ + dòng xem trước khi thu gọn', () => {
  assert.equal(promptBoxStats('   '), 'Trống')
  assert.equal(promptBoxStats('a b  c\nd'), '8 ký tự · 4 từ')
  assert.equal(promptBoxPreview('\n\n  Dòng đầu  \nDòng hai'), 'Dòng đầu')
  assert.equal(promptBoxPreview('x'.repeat(200), 10), 'xxxxxxxxx…')
  assert.equal(promptBoxPreview(''), '')
})

test('độc lập: chưa nối vào node nào, có câu giải thích', () => {
  const nodes = [createPromptBoxNode({ x: 0, y: 0 }, 'p'), createScriptNode({ x: 0, y: 0 }, 'P', 'vs'), createClipScriptNode({ x: 0, y: 0 }, 'P', 'cs')]
  for (const t of ['vs', 'cs'])
    assert.equal(isValidMuseConnection({ source: 'p', target: t, sourceHandle: MUSE_HANDLE.promptOut, targetHandle: MUSE_HANDLE.refsIn }, nodes), false)
  assert.match(explainMuseConnection('p', 'source', 'vs', nodes, []), /Ô prompt đang độc lập/)
})

test('nhân bản / làm mẫu giữ chữ trong ô', () => {
  const n = createPromptBoxNode({ x: 0, y: 0 }, 'promptbox-a-1', 'PROMPT GỐC')
  for (const mode of ['copy', 'template'] as const) {
    const g = copyGraph({ nodes: [n], edges: [] }, mode, (p) => `${p}-new`)
    assert.equal(g.nodes[0].data.text, 'PROMPT GỐC')
  }
})
