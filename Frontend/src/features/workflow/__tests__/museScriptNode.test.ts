import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_MUSE_CANVAS_CONFIG } from '../services/museCanvasConfig.ts'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  SCRIPT_MAX_REFS,
  autoMuseConnection,
  buildScriptContext,
  buildScriptRequest,
  createInputNode,
  createOutputNode,
  createScriptNode,
  explainMuseConnection,
  interruptScript,
  isValidMuseConnection,
  moveScriptRef,
  museEdge,
  normalizeMuseEdges,
  normalizeScriptData,
  scriptFingerprint,
  scriptRefsFromSources,
  scriptState,
  type ScriptRef,
} from '../services/museCanvasNodes.ts'

const ref = (p: string) => ({ id: p, name: p, path: p, previewUrl: '/api/ai/muse/output?file=' + p, size: 1 })
const output = (id: string, path: string | null, jobType: string = MUSE_NODE.characterSheet, label = '', rowLabel = '') =>
  createOutputNode({ x: 0, y: 0 }, path ? ref(path) : (null as any), { jobNodeId: 'j', jobType, sourceNodeId: 'x', rowLabel }, label, id)
const asSrc = (ns: { id: string; type?: string; data: Record<string, unknown> }[]) => ns.map((n) => ({ id: n.id, type: n.type, data: n.data }))

test('script node: tạo node độc lập, prompt nạp từ file, data chuẩn hóa', () => {
  const n = createScriptNode({ x: 1, y: 2 }, 'PROMPT', 's1')
  assert.equal(n.type, MUSE_NODE.script)
  assert.deepEqual(normalizeScriptData(n.data), { title: 'Kịch bản video', prompt: 'PROMPT', promptSource: 'default', notes: '', order: [], result: null, collapsed: false })
  assert.deepEqual(normalizeScriptData({ order: ['a', 3, 'b'] }).order, ['a', 'b'])
  assert.equal(normalizeScriptData({ result: { bad: 1 } }).result, null)
})

test('script node: 1 cổng Tham chiếu nhận nhiều ảnh mọi loại (bảng, ảnh sản phẩm, nhân vật, trang phục)', () => {
  const nodes = [
    createScriptNode({ x: 0, y: 0 }, 'P', 's1'),
    output('b1', 'b1.webp'),
    output('p1', 'p1.webp', MUSE_NODE.extract),
    createInputNode(MUSE_NODE.character, { x: 0, y: 0 }, 'c1'),
    createInputNode(MUSE_NODE.character, { x: 0, y: 0 }, 'c2'),
    createInputNode(MUSE_NODE.outfit, { x: 0, y: 0 }, 'o1'),
    { id: 'j', type: MUSE_NODE.extract, position: { x: 0, y: 0 }, data: {} },
  ]
  const edges = [museEdge('c1', 's1', MUSE_HANDLE.imagesOut, MUSE_HANDLE.refsIn)]
  const ok = (source: string, sh: string, th: string = MUSE_HANDLE.refsIn) =>
    isValidMuseConnection({ source, target: 's1', sourceHandle: sh, targetHandle: th }, nodes, edges)
  assert.ok(ok('b1', MUSE_HANDLE.imageOut))
  assert.ok(ok('p1', MUSE_HANDLE.imageOut))
  assert.ok(ok('c2', MUSE_HANDLE.imagesOut)) // nhiều nhân vật cũng được
  assert.ok(ok('o1', MUSE_HANDLE.imagesOut))
  assert.ok(!ok('c1', MUSE_HANDLE.imagesOut)) // trùng dây
  assert.ok(!ok('j', MUSE_HANDLE.jobOut)) // node chạy không nối thẳng vào
  assert.ok(!ok('b1', MUSE_HANDLE.imageOut, 'identity'))
  assert.ok(!isValidMuseConnection({ source: 's1', target: 'b1', sourceHandle: 'x', targetHandle: MUSE_HANDLE.imageIn }, nodes, []))
  // thả lên thân node: tự chọn cổng Tham chiếu
  assert.deepEqual(autoMuseConnection('o1', 'source', MUSE_HANDLE.imagesOut, 's1', nodes, []), {
    source: 'o1',
    target: 's1',
    sourceHandle: MUSE_HANDLE.imagesOut,
    targetHandle: MUSE_HANDLE.refsIn,
  })
  assert.match(explainMuseConnection('s1', 'source', 'b1', nodes, []), /chỉ nối ra node Kịch bản/)
  // dây cổng "identity" của bản đầu chuyển sang cổng Tham chiếu
  const [legacy] = normalizeMuseEdges([{ id: 'e', source: 'c1', target: 's1', targetHandle: 'identity', type: 'museLink' }])
  assert.equal(legacy.targetHandle, MUSE_HANDLE.refsIn)
})

test('script node: vai trò ảnh suy từ nguồn, tên mặc định theo vai trò, thứ tự xếp + đổi chỗ', () => {
  const srcs = asSrc([
    output('b1', 'b1.webp', MUSE_NODE.characterSheet, '', 'Nhân vật 1 × Trang phục 1'),
    output('p1', 'p1.webp', MUSE_NODE.extract),
    createInputNode(MUSE_NODE.character, { x: 0, y: 0 }, 'c1'),
    createInputNode(MUSE_NODE.outfit, { x: 0, y: 0 }, 'o1'),
    output('b2', 'b2.webp', MUSE_NODE.characterSheet, 'Bunny'),
  ])
  let refs = scriptRefsFromSources(srcs)
  assert.deepEqual(
    refs.map((r) => [r.sourceNodeId, r.kind, r.label]),
    [
      ['b1', 'board', 'Nhân vật 1 × Trang phục 1'],
      ['p1', 'product', 'Ảnh sản phẩm 1'],
      ['c1', 'character', 'Nhân vật 1'],
      ['o1', 'outfit_photo', 'Ảnh trang phục 1'],
      ['b2', 'board', 'Bunny'],
    ],
  )
  // đưa ảnh nhân vật lên đầu (2 lần ↑)
  refs = scriptRefsFromSources(srcs, moveScriptRef(refs, 'c1', -1))
  assert.deepEqual(refs.map((r) => r.sourceNodeId), ['b1', 'c1', 'p1', 'o1', 'b2'])
  refs = scriptRefsFromSources(srcs, moveScriptRef(refs, 'c1', -1))
  assert.deepEqual(refs.map((r) => r.sourceNodeId), ['c1', 'b1', 'p1', 'o1', 'b2'])
  assert.deepEqual(moveScriptRef(refs, 'c1', -1), ['c1', 'b1', 'p1', 'o1', 'b2']) // đầu danh sách: giữ nguyên
  // ảnh mới nối (chưa có trong order) xếp sau
  const more = scriptRefsFromSources([...srcs, ...asSrc([output('b3', 'b3.webp')])], refs.map((r) => r.sourceNodeId))
  assert.equal(more.at(-1)!.sourceNodeId, 'b3')
  // node không có ảnh-tham-chiếu thì bỏ qua
  assert.equal(scriptRefsFromSources([{ id: 's', type: MUSE_NODE.script, data: {} }]).length, 0)
})

test('script node: trạng thái — chưa có ảnh, quá giới hạn, thiếu ảnh, cũ khi đổi ảnh / thứ tự', () => {
  const refs: ScriptRef[] = [
    { sourceNodeId: 'c1', kind: 'character', label: 'Linh', image: ref('face.png') },
    { sourceNodeId: 'b1', kind: 'board', label: 'B1', image: ref('b1.webp') },
  ]
  assert.equal(scriptState([], null), 'no_refs')
  assert.equal(scriptState(refs, null), 'pending')
  const many = Array.from({ length: SCRIPT_MAX_REFS + 1 }, (_, i) => ({ sourceNodeId: `b${i}`, kind: 'board' as const, label: `B${i}`, image: ref(`b${i}`) }))
  assert.equal(scriptState(many, null), 'too_many')
  assert.equal(scriptState([{ ...refs[0], image: null }], null), 'no_image')
  const fp = scriptFingerprint(refs)
  assert.equal(fp, 'face.png|b1.webp')
  const done = { inputPath: fp, status: 'done' as const, text: 'SCRIPT', updatedAt: 1 }
  assert.equal(scriptState(refs, done), 'done')
  assert.equal(scriptState([...refs].reverse(), done), 'stale')
  assert.equal(scriptState([], { ...done, status: 'running' }), 'running')
  const intr = interruptScript({ ...done, status: 'running' }, 5)
  assert.equal(intr?.status, 'interrupted')
  assert.match(intr!.error!, /ĐÃ gửi/)
  assert.equal(interruptScript(done), null)
})

test('script node: gửi mọi ảnh chung 1 request, không ép 1 ảnh = 1 bộ', () => {
  const refs: ScriptRef[] = [
    { sourceNodeId: 'c1', kind: 'character', label: 'Linh', image: ref('D:/face.png') },
    { sourceNodeId: 'b1', kind: 'board', label: 'Trang phục 1', image: ref('D:/b1.webp') },
    { sourceNodeId: 'p1', kind: 'product', label: 'Áo xanh', image: ref('D:/p1.webp') },
  ]
  const cfg = { ...DEFAULT_MUSE_CANVAS_CONFIG, chatMode: 'new_per_run' as const, chatTitlePrefix: 'Muse Canvas', filePrefix: 'mc' }
  const body = buildScriptRequest(cfg, '  PROMPT  ', refs, ' ảnh 2 và 3 cùng bộ ')
  assert.equal(body.output_kind, 'text')
  assert.equal(body.apply_prefix, false)
  assert.deepEqual(body.reference_images, ['D:/face.png', 'D:/b1.webp', 'D:/p1.webp'])
  const prompt = String(body.prompt)
  assert.ok(prompt.startsWith('PROMPT\n\n## Attached reference images'))
  assert.match(prompt, /Image 1: character reference photo .* — "Linh"/)
  assert.match(prompt, /Image 2: character design board .* — "Trang phục 1"/)
  assert.match(prompt, /Image 3: outfit product photo .* — "Áo xanh"/)
  assert.match(prompt, /one image does NOT have to be one outfit/)
  assert.match(prompt, /Identity anchor: Image 1 \(the character reference photo\)/)
  // ảnh nhân vật không đứng đầu: ghi đúng số thứ tự của nó
  assert.match(buildScriptContext([refs[1], refs[2], refs[0]]), /Identity anchor: Image 3 \(the character reference photo\)/)
  assert.doesNotMatch(prompt, /Number of outfits: \d/) // số bộ để Muse tự đếm
  assert.match(prompt, /Do not ask me questions/)
  assert.match(prompt, /## Extra notes from me\nảnh 2 và 3 cùng bộ$/)
  assert.equal(body.chat_title, 'Muse Canvas · Kịch bản · 3 ảnh')
  assert.equal(body.file_prefix, 'mc_script')
  assert.equal(body.use_side_chat, true)
  assert.match(buildScriptContext(refs.slice(1)), /no separate character photo/)
  assert.throws(() => buildScriptRequest(cfg, ' ', refs), /Prompt/)
  assert.throws(() => buildScriptRequest(cfg, 'P', []), /ảnh tham chiếu/)
  assert.throws(() => buildScriptRequest(cfg, 'P', [{ ...refs[0], image: null }]), /Linh: chưa có ảnh/)
})
