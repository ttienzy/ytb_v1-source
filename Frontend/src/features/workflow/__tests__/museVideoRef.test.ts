import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  VIDEO_REF_MAX_BYTES,
  autoMuseConnection,
  createClipScriptNode,
  createJobNode,
  createScriptNode,
  createVideoRefNode,
  explainMuseConnection,
  isValidMuseConnection,
  normalizeVideoRefData,
  validateVideoRefFile,
  videoRefMeta,
} from '../services/museCanvasNodes.ts'
import { copyGraph } from '../services/museProjects.ts'

test('node Video tham chiếu: độc lập, 1 video, id tiền tố videoref', () => {
  const n = createVideoRefNode({ x: 1, y: 2 })
  assert.equal(n.type, 'museVideoRef')
  assert.match(n.id, /^videoref-/)
  assert.deepEqual(n.data, { title: 'Video tham chiếu', label: '', video: null })
})

test('đọc dữ liệu: video hợp lệ / thiếu trường / hỏng', () => {
  assert.deepEqual(normalizeVideoRefData(undefined), { title: 'Video tham chiếu', label: '', video: null })
  const d = normalizeVideoRefData({ label: 'Mẫu', video: { path: 'D:\\v\\mau.mp4', previewUrl: '/api/ai/muse/preview?file=x.mp4', size: 10, durationSec: 'x' } })
  assert.deepEqual(d.video, {
    id: 'D:\\v\\mau.mp4',
    name: 'mau.mp4',
    path: 'D:\\v\\mau.mp4',
    previewUrl: '/api/ai/muse/preview?file=x.mp4',
    size: 10,
    durationSec: 0,
    source: 'upload',
  })
  assert.equal(normalizeVideoRefData({ video: { path: '' } }).video, null)
  assert.equal(normalizeVideoRefData({ video: 'hỏng' }).video, null)
  assert.equal(normalizeVideoRefData({ video: { path: 'a.mp4', source: 'library' } }).video?.source, 'library')
})

test('kiểm tra file tải lên', () => {
  assert.equal(validateVideoRefFile({ name: 'a.mp4', size: 100, type: 'video/mp4' }), null)
  assert.equal(validateVideoRefFile({ name: 'A.MOV', size: 100, type: '' }), null)
  assert.equal(validateVideoRefFile({ name: 'b.webm', size: 100 }), null)
  assert.match(validateVideoRefFile({ name: 'c.gif', size: 100, type: 'image/gif' }) ?? '', /chỉ nhận video/)
  assert.match(validateVideoRefFile({ name: 'd.mp4', size: VIDEO_REF_MAX_BYTES + 1, type: 'video/mp4' }) ?? '', /quá 300 MB/)
  assert.match(validateVideoRefFile({ name: 'e.mp4', size: 0, type: 'video/mp4' }) ?? '', /rỗng/)
})

test('chữ thời lượng · dung lượng', () => {
  assert.equal(videoRefMeta({ durationSec: 8.24, size: 8.4 * 1024 * 1024 }), '8.2 s · 8.4 MB')
  assert.equal(videoRefMeta({ durationSec: 12.6, size: 300 * 1024 }), '13 s · 300 KB')
  assert.equal(videoRefMeta({ durationSec: 0, size: 0 }), '')
})

test('chỉ nối vào node Ingredients: các node khác không nhận, có câu giải thích', () => {
  const nodes = [
    createVideoRefNode({ x: 0, y: 0 }, 'v'),
    createScriptNode({ x: 0, y: 0 }, 'P', 'vs'),
    createClipScriptNode({ x: 0, y: 0 }, 'P', 'cs'),
    createJobNode(MUSE_NODE.scenePlace, { x: 0, y: 0 }, 'P', 'sp'),
  ]
  for (const t of ['vs', 'cs', 'sp'])
    for (const th of [MUSE_HANDLE.refsIn, MUSE_HANDLE.imagesIn, MUSE_HANDLE.scenesIn])
      assert.equal(isValidMuseConnection({ source: 'v', target: t, sourceHandle: MUSE_HANDLE.refVideoOut, targetHandle: th }, nodes), false)
  assert.equal(autoMuseConnection('v', 'source', MUSE_HANDLE.refVideoOut, 'vs', nodes, []), null)
  assert.match(explainMuseConnection('v', 'source', 'vs', nodes, []), /Video tham chiếu nối vào cổng “Video” của node Ingredients \(video \+ ảnh\) hoặc node Cắt video/)
})

test('nhân bản / làm mẫu: giữ video (là đầu vào), id node mới', () => {
  const n = createVideoRefNode({ x: 0, y: 0 }, 'videoref-a-1')
  const withVideo = { ...n, data: { ...n.data, video: { id: 'x', name: 'm.mp4', path: 'D:/m.mp4', previewUrl: '/p', size: 1, durationSec: 5, source: 'upload' } } }
  for (const mode of ['copy', 'template'] as const) {
    const g = copyGraph({ nodes: [withVideo], edges: [] }, mode, (p) => `${p}-new`)
    assert.equal(g.nodes[0].id, 'videoref-new')
    assert.equal((g.nodes[0].data.video as { path: string }).path, 'D:/m.mp4')
  }
})
