import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_MUSE_CANVAS_CONFIG } from '../services/museCanvasConfig.ts'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  SCRIPT_MAX_REFS,
  SCRIPT_VIDEO_SETTLE_SECONDS,
  autoMuseConnection,
  buildScriptVideoRequest,
  createInputNode,
  createOutputNode,
  createScriptNode,
  createScriptTextNode,
  interruptScriptVideo,
  isValidMuseConnection,
  museEdge,
  museVideoStreamPath,
  normalizeScriptData,
  normalizeScriptTextData,
  scriptVideoFingerprint,
  scriptVideoState,
  type ScriptRef,
} from '../services/museCanvasNodes.ts'

const ref = (p: string) => ({ id: p, name: p, path: p, previewUrl: '/api/ai/muse/output?file=' + p, size: 1 })
const refs: ScriptRef[] = [
  { sourceNodeId: 'b1', kind: 'board', label: 'Trang phục 1', image: ref('D:/b1.webp') },
  { sourceNodeId: 'c1', kind: 'character', label: 'Linh', image: ref('D:/face.png') },
]

test('kịch bản → video: node Kịch bản nhận ảnh tham chiếu ở cổng riêng, vẫn chỉ 1 nguồn kịch bản', () => {
  const s1 = createScriptNode({ x: 0, y: 0 }, 'P', 's1')
  const s2 = createScriptNode({ x: 0, y: 0 }, 'P', 's2')
  const t = createScriptTextNode({ x: 0, y: 0 }, { text: 'A', updatedAt: 1 }, 's1', '', 't1')
  const b = createOutputNode({ x: 0, y: 0 }, ref('b.webp'), { jobNodeId: 'j', jobType: MUSE_NODE.characterSheet, sourceNodeId: 'x', rowLabel: '' }, '', 'b1')
  const c = createInputNode(MUSE_NODE.character, { x: 0, y: 0 }, 'c1')
  const nodes = [s1, s2, t, b, c]
  const scriptEdge = museEdge('s1', 't1', MUSE_HANDLE.scriptOut, MUSE_HANDLE.scriptIn)
  const ok = (source: string, sh: string, th: string, edges: any[] = [scriptEdge]) =>
    isValidMuseConnection({ source, target: 't1', sourceHandle: sh, targetHandle: th }, nodes, edges)
  assert.ok(ok('b1', MUSE_HANDLE.imageOut, MUSE_HANDLE.refsIn)) // đã có dây kịch bản vẫn nối ảnh được
  assert.ok(ok('c1', MUSE_HANDLE.imagesOut, MUSE_HANDLE.refsIn))
  assert.ok(!ok('s2', MUSE_HANDLE.scriptOut, MUSE_HANDLE.scriptIn)) // 1 nguồn kịch bản
  // có dây ảnh rồi vẫn nối được nguồn kịch bản
  assert.ok(ok('s2', MUSE_HANDLE.scriptOut, MUSE_HANDLE.scriptIn, [museEdge('b1', 't1', MUSE_HANDLE.imageOut, MUSE_HANDLE.refsIn)]))
  assert.ok(!ok('b1', MUSE_HANDLE.imageOut, MUSE_HANDLE.scriptIn))
  assert.ok(!ok('s2', MUSE_HANDLE.scriptOut, MUSE_HANDLE.refsIn, []))
  // thả ảnh lên thân node Kịch bản: tự vào cổng Tham chiếu
  assert.equal(autoMuseConnection('b1', 'source', MUSE_HANDLE.imageOut, 't1', nodes, [scriptEdge])?.targetHandle, MUSE_HANDLE.refsIn)
})

test('kịch bản → video: trạng thái theo kịch bản + ảnh; sửa kịch bản thì video thành cũ', () => {
  assert.equal(scriptVideoState('  ', refs, null), 'no_text')
  assert.equal(scriptVideoState('S', [], null), 'pending') // không ảnh vẫn cho tạo (UI hỏi lại)
  assert.equal(scriptVideoState('S', [{ ...refs[0], image: null }], null), 'no_image')
  const many = Array.from({ length: SCRIPT_MAX_REFS + 1 }, (_, i) => ({ ...refs[0], sourceNodeId: `b${i}` }))
  assert.equal(scriptVideoState('S', many, null), 'too_many')
  const fp = scriptVideoFingerprint('SCRIPT', refs)
  assert.equal(fp, scriptVideoFingerprint(' SCRIPT \n', refs)) // khoảng trắng đầu/cuối không tính
  const done = { inputPath: fp, status: 'done' as const, paths: ['D:/v_01.mp4', 'D:/v_02.mp4'], updatedAt: 1 }
  assert.equal(scriptVideoState('SCRIPT', refs, done), 'done')
  assert.equal(scriptVideoState('SCRIPT sửa', refs, done), 'stale')
  assert.equal(scriptVideoState('SCRIPT', [...refs].reverse(), done), 'stale')
  assert.equal(scriptVideoState('', [], { ...done, status: 'running' }), 'running')
  const intr = interruptScriptVideo({ ...done, status: 'running' }, 9)
  assert.equal(intr?.status, 'interrupted')
  assert.match(intr!.error!, /ĐÃ gửi/)
  assert.equal(interruptScriptVideo(done), null)
})

test('kịch bản → video: request gửi kịch bản (bản đang sửa) + ảnh theo thứ tự, ra video, tải mọi clip', () => {
  const cfg = { ...DEFAULT_MUSE_CANVAS_CONFIG, aspectRatio: '9:16' as const, chatMode: 'new_per_run' as const, chatTitlePrefix: 'Muse Canvas', filePrefix: 'mc' }
  const body = buildScriptVideoRequest(cfg, '  ## Concept\nOne model…  ', refs, '3 bộ xanh')
  assert.equal(body.output_kind, 'video')
  assert.equal(body.collect_all, true)
  assert.equal(body.settle_seconds, SCRIPT_VIDEO_SETTLE_SECONDS)
  assert.equal(body.apply_prefix, false)
  assert.deepEqual(body.reference_images, ['D:/b1.webp', 'D:/face.png'])
  const prompt = String(body.prompt)
  assert.ok(prompt.startsWith('Create the video described in my script below.'))
  assert.match(prompt, /Image 1: character design board .* — "Trang phục 1"/)
  assert.match(prompt, /Identity anchor: Image 2/)
  assert.match(prompt, /Aspect ratio: 9:16/)
  assert.match(prompt, /Do not ask me questions/)
  assert.ok(prompt.endsWith('## My script\n## Concept\nOne model…'))
  assert.equal(body.chat_title, 'Muse Canvas · Video · 3 bộ xanh')
  assert.equal(body.file_prefix, 'mc_video')
  assert.match(String(buildScriptVideoRequest(cfg, 'S', []).prompt), /No reference images are attached/)
  assert.throws(() => buildScriptVideoRequest(cfg, ' ', refs), /trống/)
  assert.throws(() => buildScriptVideoRequest(cfg, 'S', [{ ...refs[1], image: null }]), /Linh: chưa có ảnh/)
  assert.equal(museVideoStreamPath('D:\\a b\\v.mp4'), '/api/ai/muse/stream?path=D%3A%5Ca%20b%5Cv.mp4')
})

test('thu gọn: cờ collapsed lưu trong data của cả hai node', () => {
  assert.equal(normalizeScriptData({ collapsed: true }).collapsed, true)
  assert.equal(normalizeScriptData({}).collapsed, false)
  const t = normalizeScriptTextData({ collapsed: true, order: ['a', 1], video: { status: 'done', inputPath: 'x', updatedAt: 1 } })
  assert.equal(t.collapsed, true)
  assert.deepEqual(t.order, ['a'])
  assert.equal(t.video?.status, 'done')
  assert.equal(normalizeScriptTextData({ video: { nope: 1 } }).video, null)
})
