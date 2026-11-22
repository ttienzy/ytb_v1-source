import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_MUSE_CANVAS_CONFIG } from '../services/museCanvasConfig.ts'
import {
  INPUT_SPECS,
  MUSE_HANDLE,
  MUSE_NODE,
  autoMuseConnection,
  buildClipScriptContext,
  buildClipScriptRequest,
  buildScriptContext,
  buildScriptVideoInstruction,
  clipScriptFingerprint,
  clipScriptState,
  clipSentPaths,
  createClipScriptNode,
  createInputNode,
  createOutputNode,
  createScriptNode,
  explainMuseConnection,
  isValidMuseConnection,
  newerClipFor,
  normalizeClipScriptData,
  planClipPromptNodes,
  scriptRefsFromSources,
  splitClipRefs,
  type MuseNodeLike,
} from '../services/museCanvasNodes.ts'

const img = (p: string) => ({ id: p, name: p, path: p, previewUrl: '/x?file=' + p, size: 1 })
const board = (id: string, label: string) =>
  createOutputNode({ x: 0, y: 0 }, img(`D:/${id}.png`), { jobNodeId: 'sheet', jobType: MUSE_NODE.characterSheet, sourceNodeId: id, rowLabel: label }, '', id)
const scene = (id: string, label = '', withImage = true): MuseNodeLike => {
  const n = createInputNode(MUSE_NODE.scene, { x: 0, y: 0 }, id)
  return { ...n, data: { ...n.data, label, image: withImage ? img(`D:/${id}.jpg`) : null } }
}

test('node Tham chiếu bối cảnh: độc lập, 1 ảnh, id tiền tố scene', () => {
  const n = createInputNode(MUSE_NODE.scene, { x: 1, y: 2 })
  assert.equal(n.type, 'museSceneImage')
  assert.match(n.id, /^scene-/)
  assert.deepEqual(n.data, { title: 'Tham chiếu bối cảnh', label: '', image: null })
  assert.equal(INPUT_SPECS[MUSE_NODE.scene].jobType, '')
})

test('dây: bối cảnh chỉ vào cổng Tham chiếu của Kịch bản video / Kịch bản / Kịch bản tạo video', () => {
  const nodes = [
    scene('s1'),
    createScriptNode({ x: 0, y: 0 }, 'P', 'vs'),
    { id: 'txt', type: MUSE_NODE.scriptText, position: { x: 0, y: 0 }, data: {} },
    createClipScriptNode({ x: 0, y: 0 }, 'P', 'cs'),
    { id: 'sheet', type: MUSE_NODE.characterSheet, position: { x: 0, y: 0 }, data: {} },
    { id: 'ext', type: MUSE_NODE.extract, position: { x: 0, y: 0 }, data: {} },
    { id: 'clip', type: MUSE_NODE.clipPrompt, position: { x: 0, y: 0 }, data: {} },
  ]
  for (const t of ['vs', 'txt', 'cs'])
    assert.equal(isValidMuseConnection({ source: 's1', target: t, sourceHandle: MUSE_HANDLE.imagesOut, targetHandle: MUSE_HANDLE.refsIn }, nodes), true, t)
  for (const t of ['sheet', 'ext', 'clip'])
    assert.equal(isValidMuseConnection({ source: 's1', target: t, sourceHandle: MUSE_HANDLE.imagesOut, targetHandle: MUSE_HANDLE.imagesIn }, nodes), false, t)
  // thả dây lên thân node Kịch bản tạo video -> tự chọn cổng Tham chiếu
  assert.deepEqual(autoMuseConnection('s1', 'source', MUSE_HANDLE.imagesOut, 'cs', nodes, []), {
    source: 's1',
    target: 'cs',
    sourceHandle: MUSE_HANDLE.imagesOut,
    targetHandle: MUSE_HANDLE.refsIn,
  })
  assert.match(explainMuseConnection('s1', 'source', 'sheet', nodes, []), /Tham chiếu bối cảnh chỉ nối vào cổng “Bối cảnh” của Nhân vật trong bối cảnh/)
})

test('vai trò "Bối cảnh" + câu dặn trong Kịch bản video (Muse) và Tạo video', () => {
  const refs = scriptRefsFromSources([board('b1', 'Bộ 1'), scene('s1', 'Quán cà phê gỗ')])
  assert.deepEqual(refs.map((r) => [r.kind, r.label]), [['board', 'Bộ 1'], ['scene', 'Quán cà phê gỗ']])
  assert.equal(scriptRefsFromSources([scene('s9')])[0].label, 'Bối cảnh 1')
  const ctx = buildScriptContext(refs)
  assert.match(ctx, /- Image 2: scene \/ location reference/)
  assert.match(ctx, /- Location: Image 2 shows the scene \/ location\. Use exactly this place/)
  assert.match(buildScriptVideoInstruction(refs, '9:16'), /\nLocation: Image 2 shows/)
  // không có bối cảnh -> không thêm câu nào
  assert.doesNotMatch(buildScriptContext(scriptRefsFromSources([board('b1', 'Bộ 1')])), /Location:/)
})

test('Kịch bản tạo video: ảnh bối cảnh KHÔNG thành clip, gửi sau ảnh clip, số #N+1', () => {
  // bối cảnh nối trước vẫn bị xếp sau ảnh clip khi gửi
  const refs = scriptRefsFromSources([scene('s1', 'Studio gỗ'), board('b1', 'Bộ 1'), board('b2', 'Bộ 2')])
  const { clips, scenes } = splitClipRefs(refs)
  assert.deepEqual(clips.map((r) => r.sourceNodeId), ['b1', 'b2'])
  assert.deepEqual(scenes.map((r) => r.sourceNodeId), ['s1'])
  const body = buildClipScriptRequest(DEFAULT_MUSE_CANVAS_CONFIG, 'P', refs)
  assert.deepEqual(body.reference_images, ['D:/b1.png', 'D:/b2.png', 'D:/s1.jpg'])
  assert.equal(body.chat_title, 'Muse Canvas · Kịch bản clip · 2 ảnh + 1 bối cảnh')
  const ctx = buildClipScriptContext(refs)
  assert.match(ctx, /- #1: character design board .*"Bộ 1"/)
  assert.match(ctx, /- #3: scene \/ location reference .*"Studio gỗ" \(shared by every clip, NOT a clip\)/)
  assert.match(ctx, /N = 2\. Write exactly 2 scripts .* one per reference image #1–#2/)
  assert.match(ctx, /- Location: #3 shows the scene/)
  assert.match(ctx, /replace the default STUDIO sentence/)
})

test('Kịch bản tạo video: trạng thái / dấu vân tay tính bối cảnh, k ↔ ảnh clip không lệch', () => {
  const only = scriptRefsFromSources([scene('s1')])
  assert.equal(clipScriptState(only, null), 'no_refs')
  assert.throws(() => buildClipScriptRequest(DEFAULT_MUSE_CANVAS_CONFIG, 'P', only), /Chỉ có ảnh bối cảnh/)
  assert.equal(clipScriptState(scriptRefsFromSources([board('b1', 'B'), scene('s1', '', false)]), null), 'no_image')

  const refs = scriptRefsFromSources([board('b1', 'Bộ 1'), scene('s1'), board('b2', 'Bộ 2')])
  const fp = clipScriptFingerprint(refs)
  assert.equal(fp, 'D:/b1.png|D:/b2.png||scene:D:/s1.jpg')
  assert.deepEqual(clipSentPaths(fp), ['D:/b1.png', 'D:/b2.png'])
  assert.deepEqual(clipSentPaths('D:/b1.png|D:/b2.png'), ['D:/b1.png', 'D:/b2.png']) // bản lưu trước khi có bối cảnh
  assert.deepEqual(clipSentPaths(''), [])
  const done = { inputPath: fp, status: 'done' as const, text: 'x', updatedAt: 1 }
  assert.equal(clipScriptState(refs, done), 'done')
  // đổi ảnh bối cảnh -> kịch bản cũ
  const other = scriptRefsFromSources([board('b1', 'Bộ 1'), scene('s2'), board('b2', 'Bộ 2')])
  assert.equal(clipScriptState(other, done), 'stale')
  // bản viết trước khi có bối cảnh, nay nối thêm bối cảnh -> cũ
  assert.equal(clipScriptState(refs, { ...done, inputPath: 'D:/b1.png|D:/b2.png' }), 'stale')
})

const SCRIPT = (n: number) =>
  Array.from({ length: n }, (_, i) => {
    const k = i + 1
    return `=== SCRIPT ${k}/${n} — REF #${k} — Bộ ${k} — 8s ===\n**VIDEO PROMPT:**\n\`\`\`\nVertical 9:16 fashion video, exactly 8 seconds. [0–4s] a [4–8s] b\n\`\`\`\n=== END SCRIPT ${k} ===`
  }).join('\n\n')

test('Ra node Clip: clip k lấy đúng ảnh clip #k dù bối cảnh nối xen giữa', () => {
  const refs = scriptRefsFromSources([board('b1', 'Bộ 1'), scene('s1'), board('b2', 'Bộ 2')])
  const cs = createClipScriptNode({ x: 0, y: 0 }, 'P', 'cs')
  const data = { ...cs.data, result: { inputPath: clipScriptFingerprint(refs), status: 'done', text: SCRIPT(2), updatedAt: 5 } }
  const plan = planClipPromptNodes({ ...cs, data }, refs, [])
  assert.equal(plan.nodes.length, 2)
  assert.deepEqual(plan.nodes.map((n) => (n.data.image as { path: string } | null)?.path), ['D:/b1.png', 'D:/b2.png'])
  // "Dùng bản mới": số clip đọc từ ảnh clip, không tính bối cảnh
  const clip = { ...(plan.nodes[1].data as never as Record<string, unknown>), origin: { clipScriptNodeId: 'cs', updatedAt: 1, k: 2 } }
  const newer = newerClipFor(clip as never, normalizeClipScriptData(data))
  assert.equal(newer?.clip.k, 2)
  assert.equal(newer?.imagePath, 'D:/b2.png')
})
