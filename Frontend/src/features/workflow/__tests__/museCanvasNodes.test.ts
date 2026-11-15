import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_MUSE_CANVAS_CONFIG } from '../services/museCanvasConfig.ts'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  buildExtractRequest,
  collectExtractInputs,
  createExtractNode,
  createOutfitNode,
  createOutfitStarter,
  extractOutputs,
  extractRowState,
  inputsToRun,
  isValidMuseConnection,
  markInterrupted,
  museEdge,
  normalizeOutfitData,
  pruneResults,
  validateOutfitFile,
  type MuseExtractResult,
} from '../services/museCanvasNodes.ts'

const ref = (p: string) => ({ id: p, name: p, path: p, previewUrl: '/api/ai/muse/preview?file=' + p, size: 1 })

test('muse nodes: mẫu khởi đầu = 1 trang phục nối vào 1 node tách, đúng cổng', () => {
  const { nodes, edges } = createOutfitStarter({ x: 100, y: 200 }, 'PROMPT')
  const [outfit, extract] = nodes
  assert.equal(outfit.type, MUSE_NODE.outfit)
  assert.equal(outfit.data.image, null)
  assert.equal(extract.type, MUSE_NODE.extract)
  assert.equal(extract.data.prompt, 'PROMPT')
  assert.deepEqual(extract.data.results, {})
  assert.deepEqual(
    [edges[0].source, edges[0].target, edges[0].sourceHandle, edges[0].targetHandle],
    [outfit.id, extract.id, MUSE_HANDLE.outfitOut, MUSE_HANDLE.extractIn],
  )
})

test('muse nodes: nhiều trang phục nối vào 1 node tách; chặn nối ngược / trùng / sai loại', () => {
  const a = createOutfitNode({ x: 0, y: 0 }, 'a')
  const b = createOutfitNode({ x: 0, y: 0 }, 'b')
  const x = createExtractNode({ x: 0, y: 0 }, 'p', 'x')
  const y = createExtractNode({ x: 0, y: 0 }, 'p', 'y')
  const nodes = [a, b, x, y]
  const c = (source: string, target: string) => ({ source, target, sourceHandle: 'images', targetHandle: 'images' })
  assert.equal(isValidMuseConnection(c('a', 'x'), nodes, [museEdge('b', 'x')]), true)
  assert.equal(isValidMuseConnection(c('a', 'y'), nodes, [museEdge('a', 'x')]), true) // 1 trang phục → nhiều node tách
  assert.equal(isValidMuseConnection(c('a', 'x'), nodes, [museEdge('a', 'x')]), false)
  assert.equal(isValidMuseConnection(c('x', 'a'), nodes), false)
  assert.equal(isValidMuseConnection(c('a', 'b'), nodes), false)
  assert.equal(isValidMuseConnection(c('x', 'y'), nodes), false)
  assert.equal(isValidMuseConnection({ ...c('a', 'x'), sourceHandle: 'extracted' }, nodes), false)
})

test('muse nodes: bản lưu cũ (mảng images) đổi thành 1 ảnh', () => {
  const d = normalizeOutfitData({ title: 'Ảnh tham chiếu trang phục', images: [ref('1.png'), ref('2.png')] })
  assert.equal(d.title, 'Trang phục')
  assert.equal(d.image?.path, '1.png')
  assert.equal(normalizeOutfitData(undefined).image, null)
})

test('muse nodes: đầu vào theo thứ tự dây, tên mặc định, trạng thái từng dòng', () => {
  const a = createOutfitNode({ x: 0, y: 0 }, 'a')
  const b = createOutfitNode({ x: 0, y: 0 }, 'b')
  const c = createOutfitNode({ x: 0, y: 0 }, 'c')
  const x = createExtractNode({ x: 0, y: 0 }, 'p', 'x')
  a.data.image = ref('a.png')
  b.data.image = ref('b.png')
  b.data.label = 'Áo dài đỏ'
  const inputs = collectExtractInputs('x', [a, b, c, x], [museEdge('a', 'x'), museEdge('b', 'x'), museEdge('c', 'x')])
  assert.deepEqual(inputs.map((i) => i.label), ['Trang phục 1', 'Áo dài đỏ', 'Trang phục 3'])

  const results: Record<string, MuseExtractResult> = {
    a: { sourceNodeId: 'a', inputPath: 'old.png', status: 'done', output: ref('out-a.png'), updatedAt: 1 },
    b: { sourceNodeId: 'b', inputPath: 'b.png', status: 'error', error: 'x', updatedAt: 1 },
  }
  assert.deepEqual(inputs.map((i) => extractRowState(i, results)), ['stale', 'error', 'no_image'])
  // "Tách tất cả" chỉ chạy dòng chưa có kết quả / ảnh đã đổi; dòng lỗi phải bấm chạy lại riêng
  assert.deepEqual(inputsToRun(inputs, results).map((i) => i.sourceNodeId), ['a'])
  results.a.inputPath = 'a.png'
  assert.deepEqual(extractOutputs(inputs, results).map((o) => o.path), ['out-a.png'])
})

test('muse nodes: kết quả đang chạy khi mở lại canvas thành "gián đoạn"; bỏ kết quả của dây đã gỡ', () => {
  const results: Record<string, MuseExtractResult> = {
    a: { sourceNodeId: 'a', inputPath: 'a.png', status: 'running', updatedAt: 1 },
    b: { sourceNodeId: 'b', inputPath: 'b.png', status: 'done', updatedAt: 1 },
  }
  const fixed = markInterrupted(results, 5)!
  assert.equal(fixed.a.status, 'interrupted')
  assert.match(fixed.a.error || '', /ĐÃ gửi/)
  assert.equal(markInterrupted(fixed), null)
  assert.deepEqual(Object.keys(pruneResults(fixed, ['a'])!), ['a'])
  assert.equal(pruneResults(fixed, ['a', 'b']), null)
})

test('muse nodes: request tách gửi ảnh + prompt nguyên văn, ra ảnh, theo cấu hình canvas', () => {
  const cfg = { ...DEFAULT_MUSE_CANVAS_CONFIG, accountMode: 'fixed' as const, accountId: 'acc1', timeoutSeconds: 900 }
  const body = buildExtractRequest(cfg, '  Extract ONLY the outfit  ', { sourceNodeId: 'a', label: 'Áo dài đỏ', image: ref('D:/x/a.png') })
  assert.deepEqual(body, {
    prompt: 'Extract ONLY the outfit',
    reference_images: ['D:/x/a.png'],
    output_kind: 'image',
    apply_prefix: false,
    chat_title: 'Muse Canvas · Tách áo quần · Áo dài đỏ',
    file_prefix: 'muse_canvas_outfit',
    account_id: 'acc1',
    use_side_chat: true,
    continuation: false,
    timeout_seconds: 900,
  })
  assert.throws(() => buildExtractRequest(cfg, 'p', { sourceNodeId: 'b', label: 'Trang phục 2', image: null }), /chưa có ảnh/)
})

test('muse nodes: kiểm tra file ảnh trang phục', () => {
  assert.equal(validateOutfitFile({ name: 'ao.png', size: 1000, type: 'image/png' }), null)
  assert.equal(validateOutfitFile({ name: 'AO.JPG', size: 1000 }), null)
  assert.match(validateOutfitFile({ name: 'clip.mp4', size: 1000, type: 'video/mp4' }) || '', /PNG, JPG hoặc WebP/)
  assert.match(validateOutfitFile({ name: 'big.webp', size: 26 * 1024 * 1024, type: 'image/webp' }) || '', /25 MB/)
})

// ---------------------------------------------------------------- node Ảnh kết quả + cặp nhân vật

import {
  JOB_SPECS,
  createInputNode,
  createJobNode,
  createStarter,
  findOutputNodeFor,
  museOutputEdge,
  newerOutputFor,
  normalizeOutputData,
  planOutputNodes,
} from '../services/museCanvasNodes.ts'

test('muse nodes: tách các dòng đã xong ra node Ảnh kết quả, không tạo trùng', () => {
  const a = createOutfitNode({ x: 0, y: 0 }, 'a')
  const b = createOutfitNode({ x: 0, y: 0 }, 'b')
  const x = createExtractNode({ x: 100, y: 50 }, 'p', 'x')
  a.data.image = ref('a.png')
  b.data.image = ref('b.png')
  const inputs = collectExtractInputs('x', [a, b, x], [museEdge('a', 'x'), museEdge('b', 'x')])
  const results: Record<string, MuseExtractResult> = {
    a: { sourceNodeId: 'a', inputPath: 'a.png', status: 'done', output: ref('out-a.png'), updatedAt: 1 },
    b: { sourceNodeId: 'b', inputPath: 'b.png', status: 'error', updatedAt: 1 },
  }
  const plan = planOutputNodes({ ...x, width: 420 }, inputs, results, [a, b, x])
  assert.equal(plan.nodes.length, 1) // dòng lỗi không tách ra
  const out = plan.nodes[0]
  assert.equal(out.type, MUSE_NODE.output)
  assert.deepEqual(normalizeOutputData(out.data).origin, { jobNodeId: 'x', jobType: MUSE_NODE.extract, sourceNodeId: 'a', rowLabel: 'Trang phục 1' })
  assert.equal(normalizeOutputData(out.data).image?.path, 'out-a.png')
  assert.ok(out.position.x > x.position.x + 420)
  assert.deepEqual(
    [plan.edges[0].source, plan.edges[0].target, plan.edges[0].sourceHandle, plan.edges[0].targetHandle],
    ['x', out.id, MUSE_HANDLE.jobOut, MUSE_HANDLE.imageIn],
  )
  // đã có node cho dòng đó -> không tạo nữa
  assert.equal(findOutputNodeFor([a, b, x, out], 'x', 'a')?.id, out.id)
  assert.equal(planOutputNodes(x, inputs, results, [a, b, x, out]).nodes.length, 0)
  // chạy lại dòng đó ra ảnh mới -> node kết quả biết có ảnh mới hơn
  const outData = normalizeOutputData(out.data)
  assert.equal(newerOutputFor(outData, { title: '', prompt: '', promptSource: 'default', results }), null)
  results.a = { ...results.a, output: ref('out-a-v2.png') }
  assert.equal(newerOutputFor(outData, { title: '', prompt: '', promptSource: 'default', results })?.path, 'out-a-v2.png')
})

test('muse nodes: dây vào node Ảnh kết quả chỉ từ cổng ra của node chạy, mỗi node 1 nguồn', () => {
  const x = createExtractNode({ x: 0, y: 0 }, 'p', 'x')
  const y = createExtractNode({ x: 0, y: 0 }, 'p', 'y')
  const a = createOutfitNode({ x: 0, y: 0 }, 'a')
  const o = createOutputNodeLike('o')
  const nodes = [x, y, a, o]
  const c = (source: string, sourceHandle: string) => ({ source, target: 'o', sourceHandle, targetHandle: 'image' })
  assert.equal(isValidMuseConnection(c('x', 'extracted'), nodes), true)
  assert.equal(isValidMuseConnection(c('y', 'extracted'), nodes, [museOutputEdge('x', 'o')]), false) // đã có nguồn
  assert.equal(isValidMuseConnection(c('a', 'images'), nodes), false) // ảnh vào không nối thẳng vào kết quả
  assert.equal(isValidMuseConnection({ source: 'o', target: 'x', sourceHandle: 'image', targetHandle: 'images' }, nodes), false)
})

function createOutputNodeLike(id: string) {
  return { id, type: MUSE_NODE.output, position: { x: 0, y: 0 }, data: { title: 'Ảnh kết quả', label: '', image: null, origin: null } }
}

test('muse nodes: cặp Nhân vật tham chiếu → Bảng thiết kế nhân vật, không lẫn với họ trang phục', () => {
  const { nodes, edges } = createStarter(MUSE_NODE.characterSheet, { x: 0, y: 0 }, 'BOARD')
  const [ch, sheet] = nodes
  assert.equal(ch.type, MUSE_NODE.character)
  assert.equal(sheet.type, MUSE_NODE.characterSheet)
  assert.equal(sheet.data.title, 'Bảng thiết kế nhân vật')
  assert.equal(edges[0].source, ch.id)
  const outfit = createOutfitNode({ x: 0, y: 0 }, 'o1')
  const extract = createExtractNode({ x: 0, y: 0 }, 'p', 'x1')
  const all = [ch, sheet, outfit, extract]
  const c = (source: string, target: string) => ({ source, target, sourceHandle: 'images', targetHandle: 'images' })
  assert.equal(isValidMuseConnection(c(outfit.id, sheet.id), all), false)
  assert.equal(isValidMuseConnection(c(ch.id, extract.id), all), false)
  const ch2 = createInputNode(MUSE_NODE.character, { x: 0, y: 0 }, 'c2')
  assert.equal(isValidMuseConnection(c('c2', sheet.id), [...all, ch2], edges), true)
  ;(ch2.data as any).image = ref('linh.png')
  const inputs = collectExtractInputs(sheet.id, [...all, ch2], [...edges, museEdge('c2', sheet.id)])
  assert.deepEqual(inputs.map((i) => i.label), ['Nhân vật 1', 'Nhân vật 2'])
  const body = buildJobRequestFor(sheet.type!, inputs[1])
  assert.equal(body.chat_title, 'Muse Canvas · Bảng nhân vật · Nhân vật 2')
  assert.equal(body.file_prefix, 'muse_canvas_character')
  assert.equal(createJobNode(MUSE_NODE.characterSheet, { x: 0, y: 0 }, 'p').data.prompt, 'p')
})

import { buildJobRequest } from '../services/museCanvasNodes.ts'
function buildJobRequestFor(type: string, input: Parameters<typeof buildJobRequest>[3]) {
  return buildJobRequest(JOB_SPECS[type], DEFAULT_MUSE_CANVAS_CONFIG, 'p', input) as Record<string, unknown>
}

// ---------------------------------------------------------------- nhân vật × trang phục

import { buildJobRows, rowFingerprint, secondaryInputsFromSources, createOutputNode } from '../services/museCanvasNodes.ts'

test('muse nodes: Ảnh kết quả từ Tách áo quần nối vào cổng "outfits" của Bảng thiết kế nhân vật', () => {
  const sheet = createJobNode(MUSE_NODE.characterSheet, { x: 0, y: 0 }, 'p', 'sheet')
  const extract = createExtractNode({ x: 0, y: 0 }, 'p', 'x')
  const outfitOut = createOutputNode({ x: 0, y: 0 }, ref('ao.png'), { jobNodeId: 'x', jobType: MUSE_NODE.extract, sourceNodeId: 'a', rowLabel: 'Trang phục 1' }, '', 'o1')
  const boardOut = createOutputNode({ x: 0, y: 0 }, ref('board.png'), { jobNodeId: 'sheet', jobType: MUSE_NODE.characterSheet, sourceNodeId: 'c', rowLabel: 'Nhân vật 1' }, '', 'o2')
  const nodes = [sheet, extract, outfitOut, boardOut]
  const c = (source: string, target: string, targetHandle: string) => ({ source, target, sourceHandle: 'image', targetHandle })
  assert.equal(isValidMuseConnection(c('o1', 'sheet', 'outfits'), nodes), true)
  assert.equal(isValidMuseConnection(c('o1', 'sheet', 'images'), nodes), false) // cổng nhân vật không nhận trang phục
  assert.equal(isValidMuseConnection(c('o2', 'sheet', 'outfits'), nodes), false) // ảnh bảng nhân vật không phải trang phục
  assert.equal(isValidMuseConnection(c('o1', 'x', 'outfits'), nodes), false) // node tách không có cổng phụ
  assert.equal(isValidMuseConnection(c('o1', 'sheet', 'outfits'), nodes, [{ source: 'o1', target: 'sheet' }]), false)
})

test('muse nodes: mỗi cặp nhân vật × trang phục là 1 dòng; đổi ảnh trang phục thì kết quả thành cũ', () => {
  const chars = [
    { sourceNodeId: 'c1', label: 'Linh', image: ref('linh.png') },
    { sourceNodeId: 'c2', label: 'Nhân vật 2', image: ref('mai.png') },
  ]
  const outs = secondaryInputsFromSources([
    { id: 'o1', type: MUSE_NODE.output, data: { label: '', image: ref('ao1.png'), origin: null } },
    { id: 'o2', type: MUSE_NODE.output, data: { label: 'Áo dài', image: ref('ao2.png'), origin: null } },
    { id: 'zz', type: MUSE_NODE.outfit, data: {} }, // không phải node kết quả -> bỏ
  ])
  assert.deepEqual(outs.map((o) => o.label), ['Trang phục 1', 'Áo dài'])
  assert.deepEqual(buildJobRows(chars, []), chars) // không nối trang phục: như cũ
  const rows = buildJobRows(chars, outs)
  assert.deepEqual(rows.map((r) => [r.sourceNodeId, r.label]), [
    ['c1|o1', 'Linh × Trang phục 1'],
    ['c1|o2', 'Linh × Áo dài'],
    ['c2|o1', 'Nhân vật 2 × Trang phục 1'],
    ['c2|o2', 'Nhân vật 2 × Áo dài'],
  ])
  assert.equal(rowFingerprint(rows[1]), 'linh.png|ao2.png')
  const results: Record<string, MuseExtractResult> = {
    'c1|o2': { sourceNodeId: 'c1|o2', inputPath: 'linh.png|ao2.png', status: 'done', output: ref('b.png'), updatedAt: 1 },
  }
  assert.equal(extractRowState(rows[1], results), 'done')
  const changed = buildJobRows(chars, [outs[0], { ...outs[1], image: ref('ao2-v2.png') }])
  assert.equal(extractRowState(changed[1], results), 'stale')
  assert.equal(extractRowState(buildJobRows(chars, [{ ...outs[0], image: null }])[0], {}), 'no_image')
})

test('muse nodes: request bảng nhân vật gửi ảnh nhân vật rồi ảnh trang phục, ghép prompt kết hợp', () => {
  const spec = JOB_SPECS[MUSE_NODE.characterSheet]
  const row = buildJobRows(
    [{ sourceNodeId: 'c1', label: 'Linh', image: ref('D:/linh.png') }],
    [{ sourceNodeId: 'o1', label: 'Áo dài', image: ref('D:/ao.webp') }],
  )[0]
  const body = buildJobRequest(spec, DEFAULT_MUSE_CANVAS_CONFIG, 'BOARD', row, 'OUTFIT: wear it') as Record<string, unknown>
  assert.deepEqual(body.reference_images, ['D:/linh.png', 'D:/ao.webp'])
  assert.equal(body.prompt, 'BOARD\n\nOUTFIT: wear it')
  assert.equal(body.chat_title, 'Muse Canvas · Bảng nhân vật · Linh × Áo dài')
  // không có trang phục thì không ghép
  const solo = buildJobRequest(spec, DEFAULT_MUSE_CANVAS_CONFIG, 'BOARD', { sourceNodeId: 'c1', label: 'Linh', image: ref('D:/linh.png') }, 'OUTFIT') as Record<string, unknown>
  assert.equal(solo.prompt, 'BOARD')
  assert.deepEqual(solo.reference_images, ['D:/linh.png'])
})

test('muse nodes: dây giữ đúng cổng; nguồn sai loại không thành dòng', () => {
  const e = museEdge('o1', 'sheet', 'image', 'outfits')
  assert.deepEqual([e.sourceHandle, e.targetHandle], ['image', 'outfits'])
  assert.notEqual(e.id, museEdge('o1', 'sheet').id)
  const rows = extractInputsFromSources(
    [
      { id: 'c1', type: MUSE_NODE.character, data: { image: ref('c.png') } },
      { id: 'o1', type: MUSE_NODE.output, data: { image: ref('o.png') } },
    ],
    'Nhân vật',
    MUSE_NODE.character,
  )
  assert.deepEqual(rows.map((r) => r.sourceNodeId), ['c1'])
})

import { extractInputsFromSources } from '../services/museCanvasNodes.ts'

import { autoMuseConnection, explainMuseConnection } from '../services/museCanvasNodes.ts'

test('muse nodes: thả dây vào thân node / cổng sai thì tự chọn đúng cổng, kể cả kéo ngược', () => {
  const sheet = createJobNode(MUSE_NODE.characterSheet, { x: 0, y: 0 }, 'p', 'sheet')
  const ch = createInputNode(MUSE_NODE.character, { x: 0, y: 0 }, 'ch')
  const extract = createExtractNode({ x: 0, y: 0 }, 'p', 'x')
  const out = createOutputNode({ x: 0, y: 0 }, ref('ao.png'), { jobNodeId: 'x', jobType: MUSE_NODE.extract, sourceNodeId: 'a', rowLabel: 'Trang phục 1' }, '', 'o1')
  const fresh = createOutputNodeLike('o9')
  const nodes = [sheet, ch, extract, out, fresh]
  // từ chấm phải Ảnh kết quả, thả lên node bảng -> cổng outfits
  assert.deepEqual(autoMuseConnection('o1', 'source', 'image', 'sheet', nodes, []), { source: 'o1', target: 'sheet', sourceHandle: 'image', targetHandle: 'outfits' })
  // kéo ngược từ cổng outfits, thả lên node Ảnh kết quả
  assert.deepEqual(autoMuseConnection('sheet', 'target', 'outfits', 'o1', nodes, []), { source: 'o1', target: 'sheet', sourceHandle: 'image', targetHandle: 'outfits' })
  // kéo từ cổng Nhân vật nhưng thả lên Ảnh kết quả -> tự đổi sang cổng Trang phục (cùng node bảng)
  assert.equal(autoMuseConnection('sheet', 'target', 'images', 'o1', nodes, [])?.targetHandle, 'outfits')
  // kéo nhầm chấm TRÁI (cổng vào) của Ảnh kết quả rồi thả lên node bảng -> vẫn nối Ảnh kết quả -> Trang phục
  assert.deepEqual(autoMuseConnection('o1', 'target', 'image', 'sheet', nodes, [{ source: 'x', target: 'o1' }]), { source: 'o1', target: 'sheet', sourceHandle: 'image', targetHandle: 'outfits' })
  // không có cách hợp lệ nào: Trang phục gốc thả lên bảng nhân vật
  const outfitNode = createOutfitNode({ x: 0, y: 0 }, 'of')
  assert.equal(autoMuseConnection('of', 'source', 'images', 'sheet', [...nodes, outfitNode], []), null)
  // nhân vật thả lên thân node bảng -> cổng images
  assert.equal(autoMuseConnection('ch', 'source', 'images', 'sheet', nodes, [])?.targetHandle, 'images')
  // node chạy thả lên Ảnh kết quả trống -> cổng image
  assert.equal(autoMuseConnection('x', 'source', 'extracted', 'o9', nodes, [])?.targetHandle, 'image')
  assert.equal(autoMuseConnection('o1', 'source', 'image', 'o1', nodes, []), null)
})

test('muse nodes: giải thích vì sao không nối được', () => {
  const sheet = createJobNode(MUSE_NODE.characterSheet, { x: 0, y: 0 }, 'p', 'sheet')
  const extract = createExtractNode({ x: 0, y: 0 }, 'p', 'x')
  const outfit = createOutfitNode({ x: 0, y: 0 }, 'a')
  const board = createOutputNode({ x: 0, y: 0 }, ref('b.png'), { jobNodeId: 'sheet', jobType: MUSE_NODE.characterSheet, sourceNodeId: 'c', rowLabel: 'Nhân vật 1' }, '', 'ob')
  const nodes = [sheet, extract, outfit, board]
  assert.match(explainMuseConnection('ob', 'source', 'sheet', nodes, []), /chỉ nhận Ảnh kết quả của node Tách áo quần/)
  assert.match(explainMuseConnection('a', 'source', 'sheet', nodes, []), /chỉ nối vào Tách áo quần hoặc Kịch bản video/)
  assert.match(explainMuseConnection('x', 'source', 'sheet', nodes, []), /Ra node/)
  assert.match(explainMuseConnection('a', 'source', 'x', nodes, [{ source: 'a', target: 'x' }]), /đã được nối/)
})
