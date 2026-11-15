import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  autoMuseConnection,
  createScriptNode,
  createScriptTextNode,
  createVideoOutputNode,
  explainMuseConnection,
  findVideoNodeFor,
  isValidMuseConnection,
  mainVideoPath,
  museEdge,
  newerVideoFor,
  normalizeScriptTextData,
  normalizeVideoOutputData,
  planVideoOutputNode,
} from '../services/museCanvasNodes.ts'

const textWithVideo = (id: string, updatedAt: number, paths = ['D:/v_01.mp4', 'D:/v_02.mp4']) => {
  const n = createScriptTextNode({ x: 200, y: 40 }, { text: 'S', updatedAt: 1 }, 's1', 'Bộ xanh', id)
  n.data.video = { inputPath: 'x', status: 'done', paths, updatedAt }
  return n
}

test('video: "Ra node" tạo node Video kết quả bên phải node Kịch bản, không tạo trùng cho cùng lần tạo', () => {
  const text = textWithVideo('t1', 100)
  const plan = planVideoOutputNode({ ...text, width: 440 }, [text])!
  assert.ok(plan)
  assert.equal(plan.node.type, MUSE_NODE.videoOutput)
  assert.deepEqual(plan.node.position, { x: 200 + 440 + 90, y: 40 })
  assert.deepEqual(normalizeVideoOutputData(plan.node.data), {
    title: 'Video kết quả',
    label: 'Bộ xanh',
    paths: ['D:/v_01.mp4', 'D:/v_02.mp4'],
    origin: { scriptTextNodeId: 't1', updatedAt: 100 },
    finish: null,
    final: null,
  })
  assert.equal(plan.edge.sourceHandle, MUSE_HANDLE.videoOut)
  assert.equal(plan.edge.targetHandle, MUSE_HANDLE.videoIn)
  const nodes = [text, plan.node]
  assert.equal(findVideoNodeFor(nodes, 't1', 100)?.id, plan.node.id)
  assert.equal(planVideoOutputNode(text, nodes), null)
  // tạo lại -> "Ra node" thêm node mới, xếp lệch xuống
  const again = planVideoOutputNode({ ...textWithVideo('t1', 200), width: 440 }, nodes)!
  assert.equal(again.node.position.y, 40 + 60)
  // chưa có video / lỗi / đang chạy: không tạo
  const t2 = createScriptTextNode({ x: 0, y: 0 }, { text: 'S', updatedAt: 1 }, 's1', '', 't2')
  assert.equal(planVideoOutputNode(t2, []), null)
  t2.data.video = { inputPath: 'x', status: 'running', updatedAt: 1 }
  assert.equal(planVideoOutputNode(t2, []), null)
  assert.equal(mainVideoPath(['a', 'b']), 'b')
  assert.equal(mainVideoPath([]), '')
})

test('video: node giữ video riêng, báo khi node Kịch bản tạo video mới hơn', () => {
  const out = normalizeVideoOutputData(createVideoOutputNode({ x: 0, y: 0 }, { paths: ['D:/a.mp4'], updatedAt: 1 }, 't1').data)
  assert.equal(newerVideoFor(out, normalizeScriptTextData(textWithVideo('t1', 1).data)), null)
  assert.deepEqual(newerVideoFor(out, normalizeScriptTextData(textWithVideo('t1', 2, ['D:/b.mp4']).data))?.paths, ['D:/b.mp4'])
  assert.equal(normalizeVideoOutputData({ paths: ['a', 3, ''] }).paths.length, 1)
  assert.equal(normalizeVideoOutputData({ origin: { scriptTextNodeId: 1 } }).origin, null)
})

test('video: dây chỉ từ cổng video của node Kịch bản, mỗi node Video kết quả 1 nguồn', () => {
  const t1 = textWithVideo('t1', 1)
  const t2 = textWithVideo('t2', 1)
  const s1 = createScriptNode({ x: 0, y: 0 }, 'P', 's1')
  const v = createVideoOutputNode({ x: 0, y: 0 }, { paths: ['a'], updatedAt: 1 }, 't1', '', 'v1')
  const nodes = [t1, t2, s1, v]
  const ok = (source: string, sh: string, th: string, edges: any[] = []) =>
    isValidMuseConnection({ source, target: 'v1', sourceHandle: sh, targetHandle: th }, nodes, edges)
  assert.ok(ok('t1', MUSE_HANDLE.videoOut, MUSE_HANDLE.videoIn))
  const e = museEdge('t1', 'v1', MUSE_HANDLE.videoOut, MUSE_HANDLE.videoIn)
  assert.ok(!ok('t2', MUSE_HANDLE.videoOut, MUSE_HANDLE.videoIn, [e]))
  assert.ok(!ok('s1', MUSE_HANDLE.scriptOut, MUSE_HANDLE.videoIn))
  // node video không nối ra đâu
  assert.ok(!isValidMuseConnection({ source: 'v1', target: 't2', sourceHandle: 'video', targetHandle: MUSE_HANDLE.refsIn }, nodes, []))
  assert.equal(autoMuseConnection('t1', 'source', MUSE_HANDLE.videoOut, 'v1', nodes, [])?.targetHandle, MUSE_HANDLE.videoIn)
  assert.match(explainMuseConnection('t2', 'source', 'v1', nodes, [e]), /chỉ có 1 nguồn/)
  assert.match(explainMuseConnection('s1', 'source', 'v1', nodes, []), /chỉ nhận dây từ node Kịch bản/)
})
