import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DEFAULT_PROJECT_SETTINGS,
  applyProjectSettings,
  copyGraph,
  countRunsFor,
  isProjectSettingKey,
  normalizeProjectIndex,
  normalizeProjectSettings,
  projectSettingsToApi,
  sortProjects,
  uniqueProjectName,
  type GraphLike,
} from '../services/museProjects.ts'
import { DEFAULT_MUSE_CANVAS_CONFIG } from '../services/museCanvasConfig.ts'
import { MUSE_NODE, museEdge, MUSE_HANDLE } from '../services/museCanvasNodes.ts'
import { runKey, runKeyNodeId } from '../services/museRunRegistry.ts'

test('index từ backend: giây -> ms, active_id sai thì lấy project mới sửa nhất', () => {
  const idx = normalizeProjectIndex({
    active_id: 'khong-co',
    projects: [
      { id: 'p-a', name: 'A', created_at: 1, updated_at: 10, node_count: 3, edge_count: 2, settings: { flow_project_id: 'v1' } },
      { id: 'p-b', name: 'B', created_at: 1, updated_at: 20, node_count: 0, edge_count: 0 },
      { name: 'không id' },
    ],
  })
  assert.equal(idx.projects.length, 2)
  assert.equal(idx.activeId, 'p-b')
  assert.equal(idx.projects[0].updatedAt, 10_000)
  assert.equal(idx.projects[0].settings.flowProjectId, 'v1')
  assert.deepEqual(idx.projects[1].settings, DEFAULT_PROJECT_SETTINGS)
  assert.deepEqual(sortProjects(idx.projects).map((p) => p.id), ['p-b', 'p-a'])
  assert.deepEqual(normalizeProjectIndex(null), { activeId: '', projects: [] })
})

test('cài đặt project: chuẩn hóa + đổi qua lại snake_case', () => {
  const s = normalizeProjectSettings({ flow_project_id: ' v9 ', flow_aspect: '1:1', flow_resolution: '360p', file_prefix: 'a b/c' })
  assert.deepEqual(s, { flowProjectId: 'v9', flowAspect: '9:16', flowResolution: '360p', flowSeconds: 0, flowVariants: 1, filePrefix: 'a_b_c' })
  assert.deepEqual(projectSettingsToApi(s), { flow_project_id: 'v9', flow_aspect: '9:16', flow_resolution: '360p', flow_seconds: 0, flow_variants: 1, file_prefix: 'a_b_c' })
  assert.deepEqual(normalizeProjectSettings(projectSettingsToApi(s)), s)
})

test('cấu hình node thấy = cấu hình chung + cài đặt project', () => {
  const s = { flowProjectId: 'v2', flowAspect: '16:9' as const, flowResolution: '360p' as const, flowSeconds: 8, flowVariants: 2, filePrefix: 'ao' }
  const c = applyProjectSettings({ ...DEFAULT_MUSE_CANVAS_CONFIG, flowProjectId: 'chung', maxParallel: 3 }, s)
  assert.equal(c.flowProjectId, 'v2')
  assert.equal(c.flowAspect, '16:9')
  assert.equal(c.filePrefix, 'ao')
  assert.equal(c.maxParallel, 3)
  assert.equal(applyProjectSettings(DEFAULT_MUSE_CANVAS_CONFIG, null), DEFAULT_MUSE_CANVAS_CONFIG)
  assert.equal(isProjectSettingKey('flowProjectId'), true)
  assert.equal(isProjectSettingKey('maxParallel'), false)
})

test('tên project không trùng', () => {
  assert.equal(uniqueProjectName('Áo xanh', ['Khác']), 'Áo xanh')
  assert.equal(uniqueProjectName('Áo xanh', ['áo xanh']), 'Áo xanh (2)')
  assert.equal(uniqueProjectName('Áo xanh (2)', ['Áo xanh', 'Áo xanh (2)']), 'Áo xanh (3)')
  assert.equal(uniqueProjectName('  ', []), 'Project mới')
})

/** Đồ thị nhỏ đủ các kiểu tham chiếu id: kết quả theo nguồn, khóa ghép "a|b", order, trims, origin. */
function sample(): GraphLike {
  const ch = 'character-k1-1'
  const ch12 = 'character-k1-12' // tiền tố trùng với ch: không được đổi nhầm
  const sheet = 'characterSheet-k1-2'
  const out = 'output-k1-3'
  const cs = 'clipscript-k1-4'
  const clip = 'clip-k1-5'
  const merge = 'merge-k1-6'
  return {
    nodes: [
      { id: ch, type: MUSE_NODE.character, position: { x: 0, y: 0 }, data: { image: { path: 'C:/a.png' } } },
      { id: ch12, type: MUSE_NODE.character, position: { x: 0, y: 0 }, data: { label: ch12 } },
      {
        id: sheet,
        type: MUSE_NODE.characterSheet,
        position: { x: 0, y: 0 },
        data: {
          prompt: 'P',
          results: {
            [ch]: { sourceNodeId: ch, status: 'done', output: { path: 'C:/o.png' } },
            [`${ch12}|${out}`]: { sourceNodeId: `${ch12}|${out}`, status: 'running' },
          },
        },
      },
      { id: out, type: MUSE_NODE.output, position: { x: 0, y: 0 }, data: { image: { path: 'C:/o.png' }, origin: { jobNodeId: sheet, sourceNodeId: ch } } },
      { id: cs, type: MUSE_NODE.clipScript, position: { x: 0, y: 0 }, data: { prompt: 'S', order: [out], result: { status: 'done', text: 'x' } } },
      { id: clip, type: MUSE_NODE.clipPrompt, position: { x: 0, y: 0 }, data: { origin: { clipScriptNodeId: cs } } },
      { id: merge, type: MUSE_NODE.clipMerge, position: { x: 0, y: 0 }, data: { order: [clip], trims: { [clip]: { start: 1, end: 0 } }, merge: { status: 'done' }, removeWatermark: false } },
    ],
    edges: [
      museEdge(ch, sheet, MUSE_HANDLE.imagesOut, MUSE_HANDLE.imagesIn),
      museEdge(sheet, out, MUSE_HANDLE.jobOut, MUSE_HANDLE.imageIn),
      museEdge(out, cs, MUSE_HANDLE.imageOut, MUSE_HANDLE.refsIn),
      museEdge(cs, clip, MUSE_HANDLE.clipOut, MUSE_HANDLE.clipIn),
      museEdge(clip, merge, MUSE_HANDLE.clipVideoOut, MUSE_HANDLE.clipVideoIn),
    ],
    viewport: { x: 1, y: 2, zoom: 1 },
  }
}

let seq = 0
const fakeId = (prefix: string) => `${prefix}-new-${++seq}`

test('nhân bản: id mới ở node, dây và mọi chỗ dữ liệu nhắc tới id', () => {
  seq = 0
  const g = sample()
  const c = copyGraph(g, 'copy', fakeId)
  const oldIds = new Set(g.nodes.map((n) => n.id))
  assert.equal(c.nodes.length, g.nodes.length)
  assert.ok(c.nodes.every((n) => !oldIds.has(n.id)))
  const blob = JSON.stringify(c)
  for (const id of oldIds) assert.ok(!new RegExp(`(?<![\\w-])${id}(?![\\w-])`).test(blob), `còn id cũ ${id}`)

  const byType = (t: string) => c.nodes.filter((n) => n.type === t)
  const [ch, ch12] = byType(MUSE_NODE.character)
  const sheet = byType(MUSE_NODE.characterSheet)[0]
  const out = byType(MUSE_NODE.output)[0]
  const merge = byType(MUSE_NODE.clipMerge)[0]
  const clip = byType(MUSE_NODE.clipPrompt)[0]
  const results = sheet.data.results as Record<string, any>
  // id dài hơn có tiền tố trùng được đổi đúng (không thành "<mới của ch>2")
  assert.equal(ch12.data.label, ch12.id)
  assert.deepEqual(Object.keys(results).sort(), [ch.id, `${ch12.id}|${out.id}`].sort())
  assert.equal(results[ch.id].sourceNodeId, ch.id)
  assert.deepEqual((out.data.origin as any).jobNodeId, sheet.id)
  assert.deepEqual(merge.data.order, [clip.id])
  assert.deepEqual(Object.keys(merge.data.trims as object), [clip.id])
  // lượt đang chạy ở project gốc: bản sao báo lỗi rõ, không còn "running"
  assert.equal(results[`${ch12.id}|${out.id}`].status, 'error')
  assert.match(results[`${ch12.id}|${out.id}`].error, /project gốc/)
  // dây nối đúng node mới, id dây mới
  assert.equal(c.edges.length, g.edges.length)
  const ids = new Set(c.nodes.map((n) => n.id))
  assert.ok(c.edges.every((e) => ids.has(e.source) && ids.has(e.target) && !g.edges.some((o) => o.id === e.id)))
  assert.deepEqual(c.viewport, g.viewport)
  // đồ thị gốc không bị sửa
  assert.equal(g.nodes[2].data.results && Object.keys(g.nodes[2].data.results as object).includes('character-k1-1'), true)
})

test('làm mẫu: bỏ kết quả + node tách ra từ kết quả, giữ ảnh vào / prompt / cài đặt', () => {
  seq = 0
  const c = copyGraph(sample(), 'template', fakeId)
  const types = c.nodes.map((n) => n.type)
  assert.ok(!types.includes(MUSE_NODE.clipPrompt), 'node Clip bị bỏ (Ra node lại từ kịch bản mới)')
  const byType = (t: string) => c.nodes.find((n) => n.type === t)!
  assert.deepEqual(byType(MUSE_NODE.character).data.image, { path: 'C:/a.png' })
  assert.deepEqual(byType(MUSE_NODE.characterSheet).data.results, {})
  assert.equal(byType(MUSE_NODE.characterSheet).data.prompt, 'P')
  assert.equal(byType(MUSE_NODE.output).data.image, null)
  assert.ok(byType(MUSE_NODE.output).data.origin, 'giữ origin: chạy lại xong node tự nhận ảnh mới')
  assert.equal(byType(MUSE_NODE.clipScript).data.result, null)
  const merge = byType(MUSE_NODE.clipMerge).data
  assert.deepEqual([merge.merge, merge.order, merge.trims, merge.removeWatermark], [null, [], {}, false])
  // dây tới / từ node bị bỏ cũng bỏ
  const ids = new Set(c.nodes.map((n) => n.id))
  assert.equal(c.edges.length, 3)
  assert.ok(c.edges.every((e) => ids.has(e.source) && ids.has(e.target)))
})

test('đếm lượt đang chạy của project', () => {
  const keys = [runKey.job('a', 's1'), runKey.job('a', 's2'), runKey.script('b'), runKey.finish('khac')]
  assert.equal(countRunsFor(['a', 'b'], keys, runKeyNodeId), 3)
  assert.equal(countRunsFor([], keys, runKeyNodeId), 0)
})
