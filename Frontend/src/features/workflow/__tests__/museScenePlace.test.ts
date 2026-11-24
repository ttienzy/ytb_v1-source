import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_MUSE_CANVAS_CONFIG } from '../services/museCanvasConfig.ts'
import {
  JOB_SPECS,
  MUSE_HANDLE,
  MUSE_NODE,
  autoMuseConnection,
  buildGptJobRequest,
  buildJobRequest,
  buildJobRows,
  createInputNode,
  createJobNode,
  createOutputNode,
  extractRowState,
  inputsToRun,
  isValidMuseConnection,
  jobPortFor,
  primaryInputsFromSources,
  scriptRefsFromSources,
  secondaryInputsFromSources,
  type MuseNodeLike,
} from '../services/museCanvasNodes.ts'
import { copyGraph } from '../services/museProjects.ts'

const SPEC = JOB_SPECS[MUSE_NODE.scenePlace]
const img = (p: string) => ({ id: p, name: p, path: p, previewUrl: '/x?file=' + p, size: 1 })
const boardOut = (id: string, label = '') =>
  createOutputNode({ x: 0, y: 0 }, img(`D:/${id}.png`), { jobNodeId: 'sheet', jobType: MUSE_NODE.characterSheet, sourceNodeId: 'c', rowLabel: 'Nhân vật 1 × Trang phục 2' }, label, id)
const productOut = (id: string) =>
  createOutputNode({ x: 0, y: 0 }, img(`D:/${id}.png`), { jobNodeId: 'ext', jobType: MUSE_NODE.extract, sourceNodeId: 'o', rowLabel: 'Trang phục 1' }, '', id)
const input = (type: string, id: string, label = '', withImage = true): MuseNodeLike => {
  const n = createInputNode(type, { x: 0, y: 0 }, id)
  return { ...n, data: { ...n.data, label, image: withImage ? img(`D:/${id}.jpg`) : null } }
}

test('node mới: spec, prompt mặc định scene_place, cổng phụ Bối cảnh bắt buộc', () => {
  const n = createJobNode(MUSE_NODE.scenePlace, { x: 0, y: 0 }, 'PROMPT')
  assert.equal(n.type, 'museScenePlace')
  assert.match(n.id, /^sceneplace-/)
  assert.equal(SPEC.promptName, 'scene_place')
  assert.equal(SPEC.gptAspect, '9:16')
  assert.deepEqual(
    [SPEC.secondary?.handle, SPEC.secondary?.fromNodeType, SPEC.secondary?.required, SPEC.secondary?.promptName],
    [MUSE_HANDLE.scenesIn, MUSE_NODE.scene, true, undefined],
  )
})

test('cổng: Nhân vật = bảng thiết kế / nhân vật tham chiếu; Bối cảnh = Tham chiếu bối cảnh', () => {
  assert.equal(jobPortFor(SPEC, boardOut('b1')), 'primary')
  assert.equal(jobPortFor(SPEC, input(MUSE_NODE.character, 'ch')), 'primary')
  assert.equal(jobPortFor(SPEC, input(MUSE_NODE.scene, 'sc')), 'secondary')
  assert.equal(jobPortFor(SPEC, productOut('p1')), null)
  assert.equal(jobPortFor(SPEC, input(MUSE_NODE.outfit, 'of')), null)

  const nodes = [
    boardOut('b1'),
    productOut('p1'),
    input(MUSE_NODE.character, 'ch'),
    input(MUSE_NODE.scene, 'sc'),
    input(MUSE_NODE.outfit, 'of'),
    createJobNode(MUSE_NODE.scenePlace, { x: 0, y: 0 }, 'P', 'sp'),
  ]
  const ok = (source: string, sh: string, th: string) => isValidMuseConnection({ source, target: 'sp', sourceHandle: sh, targetHandle: th }, nodes)
  assert.equal(ok('b1', MUSE_HANDLE.imageOut, MUSE_HANDLE.imagesIn), true)
  assert.equal(ok('ch', MUSE_HANDLE.imagesOut, MUSE_HANDLE.imagesIn), true)
  assert.equal(ok('sc', MUSE_HANDLE.imagesOut, MUSE_HANDLE.scenesIn), true)
  // sai cổng / sai loại
  assert.equal(ok('sc', MUSE_HANDLE.imagesOut, MUSE_HANDLE.imagesIn), false)
  assert.equal(ok('b1', MUSE_HANDLE.imageOut, MUSE_HANDLE.scenesIn), false)
  assert.equal(ok('p1', MUSE_HANDLE.imageOut, MUSE_HANDLE.imagesIn), false)
  assert.equal(ok('of', MUSE_HANDLE.imagesOut, MUSE_HANDLE.imagesIn), false)
  // thả lên thân node -> tự chọn đúng cổng
  assert.equal(autoMuseConnection('sc', 'source', MUSE_HANDLE.imagesOut, 'sp', nodes, [])?.targetHandle, MUSE_HANDLE.scenesIn)
  assert.equal(autoMuseConnection('b1', 'source', MUSE_HANDLE.imageOut, 'sp', nodes, [])?.targetHandle, MUSE_HANDLE.imagesIn)
})

test('luật nối của các node ảnh vào Bảng thiết kế và Tách áo quần', () => {
  const nodes = [
    input(MUSE_NODE.character, 'ch'),
    input(MUSE_NODE.outfit, 'of'),
    input(MUSE_NODE.scene, 'sc'),
    productOut('p1'),
    boardOut('b1'),
    createJobNode(MUSE_NODE.characterSheet, { x: 0, y: 0 }, 'P', 'sheet'),
    createJobNode(MUSE_NODE.extract, { x: 0, y: 0 }, 'P', 'ext'),
  ]
  const ok = (source: string, target: string, sh: string, th: string) => isValidMuseConnection({ source, target, sourceHandle: sh, targetHandle: th }, nodes)
  assert.equal(ok('ch', 'sheet', MUSE_HANDLE.imagesOut, MUSE_HANDLE.imagesIn), true)
  assert.equal(ok('of', 'ext', MUSE_HANDLE.imagesOut, MUSE_HANDLE.imagesIn), true)
  assert.equal(ok('p1', 'sheet', MUSE_HANDLE.imageOut, MUSE_HANDLE.outfitsIn), true)
  assert.equal(ok('b1', 'sheet', MUSE_HANDLE.imageOut, MUSE_HANDLE.imagesIn), false)
  assert.equal(ok('b1', 'sheet', MUSE_HANDLE.imageOut, MUSE_HANDLE.outfitsIn), false)
  assert.equal(ok('sc', 'sheet', MUSE_HANDLE.imagesOut, MUSE_HANDLE.imagesIn), false)
  assert.equal(ok('ch', 'ext', MUSE_HANDLE.imagesOut, MUSE_HANDLE.imagesIn), true)
  assert.equal(ok('of', 'sheet', MUSE_HANDLE.imagesOut, MUSE_HANDLE.imagesIn), false)
})

test('dòng chạy: mỗi nhân vật × bối cảnh = 1 ảnh; tên lấy theo Ảnh kết quả', () => {
  const primary = primaryInputsFromSources(SPEC, [boardOut('b1', ''), input(MUSE_NODE.character, 'ch', 'Linh'), productOut('p1')])
  assert.deepEqual(primary.map((p) => [p.sourceNodeId, p.label]), [['b1', 'Nhân vật 1 × Trang phục 2'], ['ch', 'Linh']])
  const scenes = secondaryInputsFromSources([input(MUSE_NODE.scene, 's1', 'Ga tàu'), input(MUSE_NODE.scene, 's2'), boardOut('x')], 'Bối cảnh', SPEC)
  assert.deepEqual(scenes.map((s) => [s.sourceNodeId, s.label]), [['s1', 'Ga tàu'], ['s2', 'Bối cảnh 2']])
  const rows = buildJobRows(primary, scenes, { rowLabel: 'Bối cảnh' })
  assert.deepEqual(rows.map((r) => r.sourceNodeId), ['b1|s1', 'b1|s2', 'ch|s1', 'ch|s2'])
  assert.equal(rows[0].label, 'Nhân vật 1 × Trang phục 2 × Ga tàu')
  assert.equal(inputsToRun(rows, {}).length, 4)
})

test('chưa nối bối cảnh: dòng hiện nhưng không chạy được', () => {
  const primary = primaryInputsFromSources(SPEC, [boardOut('b1')])
  const rows = buildJobRows(primary, [], { rowLabel: 'Bối cảnh' })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].extra?.[0].sourceNodeId, '')
  assert.equal(extractRowState(rows[0], {}), 'no_image')
  assert.deepEqual(inputsToRun(rows, {}), [])
  assert.throws(() => buildJobRequest(SPEC, DEFAULT_MUSE_CANVAS_CONFIG, 'P', rows[0]), /Bối cảnh chưa có ảnh/)
  // node cũ (không bắt buộc) giữ hành vi: không ảnh phụ = mỗi ảnh chính 1 dòng tự chạy được
  assert.deepEqual(buildJobRows(primary, []), primary)
})

test('request: ảnh 1 = nhân vật, ảnh 2 = bối cảnh, prompt gửi nguyên văn (không ghép prompt kết hợp)', () => {
  const [row] = buildJobRows(primaryInputsFromSources(SPEC, [boardOut('b1')]), secondaryInputsFromSources([input(MUSE_NODE.scene, 's1')], 'Bối cảnh', SPEC), {
    rowLabel: 'Bối cảnh',
  })
  const muse = buildJobRequest(SPEC, DEFAULT_MUSE_CANVAS_CONFIG, '  PROMPT  ', row, 'KHÔNG GHÉP')
  assert.deepEqual(muse.reference_images, ['D:/b1.png', 'D:/s1.jpg'])
  assert.equal(muse.prompt, 'PROMPT') // node không có prompt kết hợp: không ghép dù có truyền vào
  assert.equal(muse.output_kind, 'image')
  assert.match(String(muse.file_prefix), /_sceneplace$/)
  const gpt = buildGptJobRequest(SPEC, DEFAULT_MUSE_CANVAS_CONFIG, 'PROMPT', row)
  assert.deepEqual(gpt.reference_images, ['D:/b1.png', 'D:/s1.jpg'])
  assert.equal(gpt.aspect, '9:16')
  assert.equal(gpt.prompt, 'PROMPT')
})

test('Ảnh kết quả của node mới vào kịch bản với vai trò “Nhân vật trong bối cảnh”; làm mẫu thì bỏ kết quả', () => {
  const out = createOutputNode({ x: 0, y: 0 }, img('D:/r.png'), { jobNodeId: 'sp', jobType: MUSE_NODE.scenePlace, sourceNodeId: 'b1|s1', rowLabel: 'X' }, '', 'o1')
  assert.equal(scriptRefsFromSources([out])[0].kind, 'scene_photo')
  const job = createJobNode(MUSE_NODE.scenePlace, { x: 0, y: 0 }, 'P', 'sp')
  const withResult = { ...job, data: { ...job.data, results: { 'b1|s1': { sourceNodeId: 'b1|s1', inputPath: 'x', status: 'done', updatedAt: 1 } } } }
  const tpl = copyGraph({ nodes: [withResult], edges: [] }, 'template', (p) => `${p}-new`)
  assert.deepEqual(tpl.nodes[0].data.results, {})
  assert.equal(tpl.nodes[0].data.prompt, 'P')
})
