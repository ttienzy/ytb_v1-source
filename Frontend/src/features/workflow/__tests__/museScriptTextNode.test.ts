import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  autoMuseConnection,
  createScriptNode,
  createScriptTextNode,
  explainMuseConnection,
  findScriptTextNodeFor,
  isValidMuseConnection,
  museEdge,
  newerScriptFor,
  normalizeScriptData,
  normalizeScriptTextData,
  planScriptTextNode,
  scriptTextEdited,
} from '../services/museCanvasNodes.ts'

const doneScript = (id: string, updatedAt: number, text = 'SCRIPT') => {
  const n = createScriptNode({ x: 100, y: 50 }, 'P', id)
  n.data.result = { inputPath: 'a|b', status: 'done', text, path: 'D:/x.md', updatedAt }
  return n
}

test('script text: "Ra node" tạo node Kịch bản bên phải, nối dây; lần viết đã có node thì không tạo trùng', () => {
  const script = doneScript('s1', 111)
  const plan = planScriptTextNode({ ...script, width: 460 }, [script])!
  assert.ok(plan)
  assert.equal(plan.node.type, MUSE_NODE.scriptText)
  assert.deepEqual(plan.node.position, { x: 100 + 460 + 90, y: 50 })
  const d = normalizeScriptTextData(plan.node.data)
  assert.deepEqual(d, { title: 'Kịch bản', label: '', text: 'SCRIPT', originalText: 'SCRIPT', path: 'D:/x.md', origin: { scriptNodeId: 's1', updatedAt: 111 }, order: [], video: null, collapsed: false })
  assert.equal(plan.edge.source, 's1')
  assert.equal(plan.edge.sourceHandle, MUSE_HANDLE.scriptOut)
  assert.equal(plan.edge.targetHandle, MUSE_HANDLE.scriptIn)
  const nodes = [script, plan.node]
  assert.equal(findScriptTextNodeFor(nodes, 's1', 111)?.id, plan.node.id)
  assert.equal(planScriptTextNode(script, nodes), null)
  // viết lại -> "Ra node" lần nữa tạo node mới (giữ bản cũ), xếp lệch xuống
  const rewritten = doneScript('s1', 222, 'SCRIPT 2')
  const plan2 = planScriptTextNode({ ...rewritten, width: 460 }, nodes)!
  assert.equal(plan2.node.position.y, 50 + 60)
  // chưa viết xong / lỗi thì không tạo
  const pending = createScriptNode({ x: 0, y: 0 }, 'P', 's2')
  assert.equal(planScriptTextNode(pending, []), null)
  pending.data.result = { inputPath: '', status: 'error', error: 'x', updatedAt: 1 }
  assert.equal(planScriptTextNode(pending, []), null)
})

test('script text: sửa được, biết đã sửa; nguồn viết lại thì báo bản mới', () => {
  const n = createScriptTextNode({ x: 0, y: 0 }, { text: 'A', path: 'p.md', updatedAt: 1 }, 's1')
  const d = normalizeScriptTextData(n.data)
  assert.equal(scriptTextEdited(d), false)
  assert.equal(scriptTextEdited({ ...d, text: 'A sửa' }), true)
  assert.equal(normalizeScriptTextData({ text: 'cũ' }).originalText, 'cũ') // bản lưu thiếu originalText
  assert.equal(normalizeScriptTextData({ origin: { scriptNodeId: 1 } }).origin, null)
  const same = normalizeScriptData(doneScript('s1', 1).data)
  assert.equal(newerScriptFor(d, same), null)
  const newer = newerScriptFor(d, normalizeScriptData(doneScript('s1', 2, 'B').data))
  assert.equal(newer?.text, 'B')
  const running = normalizeScriptData(doneScript('s1', 2).data)
  running.result!.status = 'running'
  assert.equal(newerScriptFor(d, running), null)
})

test('script text: dây chỉ từ cổng script của Kịch bản video, mỗi node Kịch bản 1 nguồn', () => {
  const s1 = doneScript('s1', 1)
  const s2 = doneScript('s2', 1)
  const t = createScriptTextNode({ x: 0, y: 0 }, { text: 'A', updatedAt: 1 }, 's1', '', 't1')
  const out = { id: 'o', type: MUSE_NODE.output, position: { x: 0, y: 0 }, data: {} }
  const nodes = [s1, s2, t, out]
  const conn = (source: string, target: string, sh: string, th: string, edges: any[] = []) =>
    isValidMuseConnection({ source, target, sourceHandle: sh, targetHandle: th }, nodes, edges)
  assert.ok(conn('s1', 't1', MUSE_HANDLE.scriptOut, MUSE_HANDLE.scriptIn))
  const e = museEdge('s1', 't1', MUSE_HANDLE.scriptOut, MUSE_HANDLE.scriptIn)
  assert.ok(!conn('s2', 't1', MUSE_HANDLE.scriptOut, MUSE_HANDLE.scriptIn, [e]))
  assert.ok(!conn('o', 't1', MUSE_HANDLE.imageOut, MUSE_HANDLE.scriptIn))
  assert.ok(!conn('s1', 'o', MUSE_HANDLE.scriptOut, MUSE_HANDLE.imageIn))
  assert.ok(!conn('t1', 's2', 'script', MUSE_HANDLE.refsIn))
  assert.deepEqual(autoMuseConnection('s1', 'source', MUSE_HANDLE.scriptOut, 't1', nodes, []), {
    source: 's1',
    target: 't1',
    sourceHandle: MUSE_HANDLE.scriptOut,
    targetHandle: MUSE_HANDLE.scriptIn,
  })
  assert.match(explainMuseConnection('s2', 'source', 't1', nodes, [e]), /chỉ có 1 nguồn kịch bản/)
  assert.match(explainMuseConnection('o', 'source', 't1', nodes, []), /nhận kịch bản từ Kịch bản video và ảnh tham chiếu/)
})
