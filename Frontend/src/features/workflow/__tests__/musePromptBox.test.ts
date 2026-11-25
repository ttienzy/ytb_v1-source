import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  PROMPT_BOX_MAX_CHARS,
  autoMuseConnection,
  clipScriptFingerprint,
  clipScriptState,
  createPromptBoxNode,
  createScriptNode,
  explainMuseConnection,
  extractRowState,
  isValidMuseConnection,
  linkedPromptKey,
  museEdge,
  normalizePromptBoxData,
  promptBoxPreview,
  promptBoxStats,
  rowFingerprint,
  scriptFingerprint,
  scriptState,
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

test('một Ô prompt nối nhiều loại node; mỗi cổng chỉ nhận một ô và giữ được các dây media', () => {
  const types = [
    MUSE_NODE.extract, MUSE_NODE.characterSheet, MUSE_NODE.scenePlace, MUSE_NODE.freeImage, MUSE_NODE.script,
    MUSE_NODE.clipScript, MUSE_NODE.clipPrompt, MUSE_NODE.videoIngredients, MUSE_NODE.scriptText,
  ]
  const nodes = [
    ...Object.values(MUSE_NODE).map((type) => ({ id: type, type })),
    { id: 'second', type: MUSE_NODE.promptBox },
  ]
  const prompt = MUSE_NODE.promptBox
  const wire = (target: string, source = prompt as string) => museEdge(source, target, MUSE_HANDLE.promptOut, MUSE_HANDLE.promptIn)
  const existing = types.map((type) => wire(type))
  for (const type of Object.values(MUSE_NODE)) {
    const allowed = types.some((t) => t === type)
    assert.equal(isValidMuseConnection(wire(type), nodes), allowed, type)
    if (!allowed) continue
    const unrelated = existing.filter((e) => e.target !== type)
    assert.equal(isValidMuseConnection(wire(type), nodes, unrelated), true)
    assert.equal(isValidMuseConnection(wire(type, 'second'), nodes, existing), false)
    assert.equal(isValidMuseConnection({ ...wire(type), targetHandle: MUSE_HANDLE.refsIn }, nodes), false)
    assert.equal(isValidMuseConnection(wire(type, MUSE_NODE.character), nodes), false)
    assert.equal(autoMuseConnection(prompt, 'source', MUSE_HANDLE.promptOut, type, nodes, unrelated)?.targetHandle, MUSE_HANDLE.promptIn)
    assert.equal(autoMuseConnection(type, 'target', MUSE_HANDLE.promptIn, prompt, nodes, unrelated)?.source, prompt)
  }
  const clip = museEdge(MUSE_NODE.clipScript, MUSE_NODE.clipPrompt, MUSE_HANDLE.clipOut, MUSE_HANDLE.clipIn)
  assert.equal(isValidMuseConnection(clip, nodes, existing), true)
  assert.equal(isValidMuseConnection(wire(MUSE_NODE.clipPrompt), nodes, [clip]), true)
  assert.equal(autoMuseConnection(MUSE_NODE.clipPrompt, 'target', MUSE_HANDLE.promptIn, MUSE_NODE.clipScript, nodes, []), null)
  assert.match(explainMuseConnection('second', 'source', MUSE_NODE.clipPrompt, nodes, existing), /chỉ nhận một Ô prompt/)
})

test('đổi hoặc gỡ prompt nối dây làm kết quả cũ, dấu vân tay ảnh vẫn đọc được', () => {
  const promptKey = linkedPromptKey('Góc quay 1')
  const nextKey = linkedPromptKey('Góc quay 2')
  assert.equal(linkedPromptKey(' Góc quay 1 '), promptKey)
  const image = { id: 'img', name: 'Ảnh', path: '/img.jpg', previewUrl: '', size: 12 }
  const input = { sourceNodeId: 'source', label: 'Ảnh', image }
  const refs = [{ ...input, kind: 'character' as const }]
  const result = { inputPath: rowFingerprint(input), sourceNodeId: 'source', status: 'done' as const, updatedAt: 1, output: image }
  assert.equal(extractRowState(input, { source: result }), 'done')
  assert.equal(extractRowState(input, { source: result }, promptKey), 'stale')
  const linked = { ...result, promptKey }
  assert.equal(extractRowState(input, { source: linked }, promptKey), 'done')
  assert.equal(extractRowState(input, { source: linked }, nextKey), 'stale')
  assert.equal(extractRowState(input, { source: linked }), 'stale')
  assert.equal(scriptState(refs, { ...linked, inputPath: scriptFingerprint(refs) }, undefined, nextKey), 'stale')
  assert.equal(clipScriptState(refs, { ...linked, inputPath: clipScriptFingerprint(refs) }, promptKey), 'done')
})

test('nhân bản / làm mẫu giữ chữ trong ô', () => {
  const n = createPromptBoxNode({ x: 0, y: 0 }, 'promptbox-a-1', 'PROMPT GỐC')
  const script = createScriptNode({ x: 100, y: 100 }, 'Prompt nội bộ', 'script-a-1')
  for (const mode of ['copy', 'template'] as const) {
    const g = copyGraph({
      nodes: [n, script], edges: [museEdge(n.id, script.id, MUSE_HANDLE.promptOut, MUSE_HANDLE.promptIn)],
    }, mode, (p) => `${p}-new`)
    assert.equal(g.nodes[0].data.text, 'PROMPT GỐC')
    assert.equal(g.nodes[1].data.prompt, 'Prompt nội bộ')
    assert.equal(g.edges[0].source, g.nodes[0].id)
    assert.equal(g.edges[0].target, g.nodes[1].id)
    assert.equal(g.edges[0].targetHandle, MUSE_HANDLE.promptIn)
  }
})
