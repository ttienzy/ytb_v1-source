import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_MUSE_CANVAS_CONFIG } from '../services/museCanvasConfig.ts'
import {
  FREE_IMAGE_MAX_REFS,
  MUSE_HANDLE,
  MUSE_NODE,
  SCRIPT_REF_SOURCE_TYPES,
  buildFreeImageGptRequest,
  buildFreeImageMuseRequest,
  createClipPromptNode,
  createFrameExtractNode,
  createFreeImageNode,
  createOutputNode,
  createPromptBoxNode,
  createScriptNode,
  createVideoIngrNode,
  createVideoRefNode,
  explainMuseConnection,
  frameExtractKey,
  freeImageFingerprint,
  freeImageState,
  isValidMuseConnection,
  museEdge,
  museInputPortTops,
  normalizeFrameExtractData,
  normalizeFreeImageData,
  scriptRefsFromSources,
  type MuseImageRef,
} from '../services/museCanvasNodes.ts'
import { copyGraph } from '../services/museProjects.ts'
import { runKey, runKeyNodeId } from '../services/museRunRegistry.ts'

const img = (p: string): MuseImageRef => ({ id: p, name: p, path: p, previewUrl: '/f?p=' + p, size: 123 })

test('Tách khung hình: normalize, key ổn định, kết nối video vào và ảnh ra', () => {
  const n = createFrameExtractNode({ x: 0, y: 0 }, 'frame-1')
  assert.equal(n.type, MUSE_NODE.frameExtract)
  assert.deepEqual(normalizeFrameExtractData(n.data), {
    title: 'Tách khung hình',
    label: '',
    mode: 'last',
    timeSec: 0,
    image: null,
    resultKey: '',
    status: 'idle',
    error: '',
    sourceDuration: 0,
  })
  assert.equal(frameExtractKey('a.mp4', 'last', 4.5), 'a.mp4|last|0')
  assert.equal(frameExtractKey('a.mp4', 'time', 4.567), 'a.mp4|time|4.57')

  const vref = createVideoRefNode({ x: 0, y: 0 }, 'v1')
  const clip = createClipPromptNode({ x: 0, y: 0 }, { k: 1, n: 1, name: 'C1', seconds: 8, videoPrompt: 'P', body: '' }, null, null, 'c1')
  const vingr = createVideoIngrNode({ x: 0, y: 0 }, 'P', 'vi1')
  const nodes = [vref, clip, n, vingr]

  assert.equal(isValidMuseConnection({ source: 'v1', target: 'frame-1', sourceHandle: MUSE_HANDLE.refVideoOut, targetHandle: MUSE_HANDLE.refVideoIn }, nodes), true)
  assert.equal(isValidMuseConnection({ source: 'c1', target: 'frame-1', sourceHandle: MUSE_HANDLE.clipVideoOut, targetHandle: MUSE_HANDLE.refVideoIn }, nodes), true)
  // Cắt/Video -> Frame đã có nguồn -> chặn
  const existing = museEdge('v1', 'frame-1', MUSE_HANDLE.refVideoOut, MUSE_HANDLE.refVideoIn)
  assert.equal(isValidMuseConnection({ source: 'c1', target: 'frame-1', sourceHandle: MUSE_HANDLE.clipVideoOut, targetHandle: MUSE_HANDLE.refVideoIn }, nodes, [existing]), false)
  // Output image nối vào Tạo video Flow & scriptRefsFromSources đọc được
  assert.equal(SCRIPT_REF_SOURCE_TYPES.includes(MUSE_NODE.frameExtract), true)
  assert.equal(isValidMuseConnection({ source: 'frame-1', target: 'vi1', sourceHandle: MUSE_HANDLE.imageOut, targetHandle: MUSE_HANDLE.refsIn }, nodes), true)

  const frameWithImg = { ...n, data: { ...n.data, label: 'Cuối clip 1', image: img('D:/f1.png') } }
  const refs = scriptRefsFromSources([frameWithImg])
  assert.equal(refs.length, 1)
  assert.equal(refs[0].label, 'Cuối clip 1')
  assert.equal(refs[0].image?.path, 'D:/f1.png')
})

test('Tạo ảnh tự do: cổng Text -> Image, tối đa 4 ảnh, chống vòng lặp, build request Muse & GPT', () => {
  assert.deepEqual(museInputPortTops(['Text', 'Image']), [40, 76])
  const pb = createPromptBoxNode({ x: 0, y: 0 }, 'pb1', 'Studio portrait')
  const f1 = createFreeImageNode({ x: 0, y: 0 }, 'Prompt A', 'fi1')
  const f2 = createFreeImageNode({ x: 0, y: 0 }, 'Prompt B', 'fi2')
  const sc = createScriptNode({ x: 0, y: 0 }, 'P', 'sc1')
  const out = createOutputNode({ x: 0, y: 0 }, img('D:/o.png'), null, 'Out', 'out1')
  const refs = Array.from({ length: FREE_IMAGE_MAX_REFS + 1 }, (_, i) =>
    createOutputNode({ x: 0, y: 0 }, img(`D:/r${i}.png`), null, `R${i}`, `r${i}`),
  )
  const nodes = [pb, f1, f2, sc, out, ...refs]

  assert.deepEqual(normalizeFreeImageData(f1.data), {
    title: 'Tạo ảnh tự do',
    prompt: 'Prompt A',
    promptSource: 'custom',
    provider: 'muse',
    aspect: '9:16',
    order: [],
    result: null,
    collapsed: false,
  })
  // Nhận Ô prompt & Tối đa 4 ảnh
  assert.equal(isValidMuseConnection({ source: 'pb1', target: 'fi1', sourceHandle: MUSE_HANDLE.promptOut, targetHandle: MUSE_HANDLE.promptIn }, nodes), true)
  const fullEdges = refs.slice(0, FREE_IMAGE_MAX_REFS).map((r) => museEdge(r.id, 'fi1', MUSE_HANDLE.imageOut, MUSE_HANDLE.refsIn))
  assert.equal(isValidMuseConnection({ source: `r${FREE_IMAGE_MAX_REFS}`, target: 'fi1', sourceHandle: MUSE_HANDLE.imageOut, targetHandle: MUSE_HANDLE.refsIn }, nodes, fullEdges), false)
  assert.match(explainMuseConnection(`r${FREE_IMAGE_MAX_REFS}`, 'source', 'fi1', nodes, fullEdges), /tối đa 4/)

  // Chống vòng fi1 -> fi2 -> fi1
  const e12 = museEdge('fi1', 'fi2', MUSE_HANDLE.imageOut, MUSE_HANDLE.refsIn)
  assert.equal(isValidMuseConnection({ source: 'fi1', target: 'fi2', sourceHandle: MUSE_HANDLE.imageOut, targetHandle: MUSE_HANDLE.refsIn }, nodes), true)
  assert.equal(isValidMuseConnection({ source: 'fi2', target: 'fi1', sourceHandle: MUSE_HANDLE.imageOut, targetHandle: MUSE_HANDLE.refsIn }, nodes, [e12]), false)
  // Đầu ra nối sang Kịch bản
  assert.equal(isValidMuseConnection({ source: 'fi1', target: 'sc1', sourceHandle: MUSE_HANDLE.imageOut, targetHandle: MUSE_HANDLE.refsIn }, nodes), true)

  // Trạng thái & build request
  const fp = freeImageFingerprint('Prompt A', '1:1', [])
  assert.equal(freeImageState('Prompt A', '1:1', [], null), 'pending')
  assert.equal(freeImageState('  ', '1:1', [], null), 'no_prompt')
  const doneRes = { sourceNodeId: 'free', inputPath: fp, status: 'done' as const, output: img('D:/out.png'), updatedAt: 1 }
  assert.equal(freeImageState('Prompt A', '1:1', [], doneRes), 'done')
  assert.equal(freeImageState('Prompt B', '1:1', [], doneRes), 'stale')

  const museReq = buildFreeImageMuseRequest(DEFAULT_MUSE_CANVAS_CONFIG, 'A red dress', '9:16', [])
  assert.equal(museReq.output_kind, 'image')
  assert.deepEqual(museReq.reference_images, [])
  assert.match(String(museReq.prompt), /^Create a vertical 9:16 image: A red dress/)

  const gptReq = buildFreeImageGptRequest(DEFAULT_MUSE_CANVAS_CONFIG, 'Studio flatlay', '1:1', [])
  assert.equal(gptReq.aspect, '1:1')
  assert.equal(gptReq.prompt, 'Studio flatlay')
})

test('runKey & copyGraph template xóa kết quả của Tách khung hình và Tạo ảnh tự do', () => {
  assert.equal(runKeyNodeId(runKey.frameExtract('frame-9')), 'frame-9')
  assert.equal(runKeyNodeId(runKey.freeImage('freeimg-9')), 'freeimg-9')

  const fe = {
    ...createFrameExtractNode({ x: 0, y: 0 }, 'frame-1'),
    data: { title: 'Tách khung hình', label: '', mode: 'time', timeSec: 2.5, image: img('D:/f.png'), resultKey: 'k', status: 'idle', error: '', sourceDuration: 10 },
  }
  const fi = {
    ...createFreeImageNode({ x: 0, y: 0 }, 'Hello', 'freeimg-1'),
    data: { title: 'Tạo ảnh tự do', prompt: 'Hello', promptSource: 'custom', provider: 'gpt', aspect: '16:9', order: [], result: { sourceNodeId: 'free', status: 'done', inputPath: 'x', updatedAt: 1 }, collapsed: false },
  }
  const tpl = copyGraph({ nodes: [fe, fi], edges: [] }, 'template', (p) => `${p}-new`)
  assert.equal(tpl.nodes[0].data.image, null)
  assert.equal(tpl.nodes[0].data.timeSec, 2.5)
  assert.equal(tpl.nodes[1].data.result, null)
  assert.equal(tpl.nodes[1].data.prompt, 'Hello')
})
