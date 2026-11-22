import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  VIDEO_INGR_MAX_REFS,
  autoMuseConnection,
  buildVideoIngrRequest,
  createInputNode,
  createOutputNode,
  createScriptNode,
  createVideoIngrNode,
  createVideoRefNode,
  explainMuseConnection,
  isValidMuseConnection,
  museEdge,
  normalizeVideoIngrData,
  scriptRefsFromSources,
  videoIngrBlockers,
  videoIngrCredits,
  videoIngrFingerprint,
  videoIngrFromJob,
  videoIngrIsBatchTile,
  videoIngrNextAttempt,
  videoIngrOverallState,
  videoIngrSlotCount,
  videoIngrState,
  videoIngrTileToRef,
  videoIngrTotalCredits,
  videoIngrTrim,
  type MuseNodeLike,
  type MuseVideoRef,
  type VideoIngrFlow,
} from '../services/museCanvasNodes.ts'
import { runKey, runKeyNodeId } from '../services/museRunRegistry.ts'
import { copyGraph } from '../services/museProjects.ts'

const img = (p: string) => ({ id: p, name: p, path: p, previewUrl: '/x?file=' + p, size: 1 })
const board = (id: string, label = '') =>
  createOutputNode({ x: 0, y: 0 }, img(`D:/${id}.webp`), { jobNodeId: 'sp', jobType: MUSE_NODE.scenePlace, sourceNodeId: 'x', rowLabel: label || id }, label, id)
const videoRefNode = (id: string, withVideo = true): MuseNodeLike => {
  const n = createVideoRefNode({ x: 0, y: 0 }, id)
  return withVideo ? { ...n, data: { ...n.data, video: VIDEO } } : n
}
const VIDEO: MuseVideoRef = { id: 'v', name: 'subway.mp4', path: 'D:/u/subway.mp4', previewUrl: '/api/ai/muse/preview?file=subway.mp4', size: 1000, durationSec: 13.6, source: 'upload' }
const FLOW: VideoIngrFlow = { projectId: '5f37623c-212', flowProjectId: 'flow-abc', aspect: '9:16' }

test('node mới: prompt mặc định, id tiền tố vingr, đọc dữ liệu hỏng', () => {
  const n = createVideoIngrNode({ x: 0, y: 0 }, 'PROMPT')
  assert.equal(n.type, 'museVideoIngredients')
  assert.match(n.id, /^vingr-/)
  assert.deepEqual(normalizeVideoIngrData(n.data), {
    title: 'Ingredients (video + ảnh)', prompt: 'PROMPT', promptSource: 'default', order: [], trimStart: null, trimEnd: null, videos: [], collapsed: false,
  })
  const d = normalizeVideoIngrData({ trimStart: -1, trimEnd: 7.456, video: 'x', order: ['a', 3] })
  assert.deepEqual([d.trimStart, d.trimEnd, d.videos, d.order], [null, 7.46, [], ['a']])
  // bản lưu cũ có `video` (1 video) -> biến thể 1; mảng `videos` bỏ phần tử hỏng và giới hạn 4
  const old = { status: 'done', fingerprint: 'f', attempt: 1, startedAt: 0, updatedAt: 0, files: ['a.mp4'] }
  assert.deepEqual(normalizeVideoIngrData({ video: old }).videos, [old])
  assert.equal(normalizeVideoIngrData({ videos: [old, null, 'x', { ...old, attempt: 2 }, old, old, old, old] }).videos.length, 4)
})

test('dây: cổng Video nhận đúng 1 Video tham chiếu; cổng Ảnh nhận tối đa 3 node có ảnh', () => {
  const nodes = [
    videoRefNode('v1'),
    videoRefNode('v2'),
    board('b1'),
    board('b2'),
    ...Array.from({ length: VIDEO_INGR_MAX_REFS + 1 }, (_, i) => board(`b${i + 3}`)), // đủ node để thử đúng giới hạn + 1
    createInputNode(MUSE_NODE.scene, { x: 0, y: 0 }, 'sc'),
    createVideoIngrNode({ x: 0, y: 0 }, 'P', 'vi'),
    createScriptNode({ x: 0, y: 0 }, 'P', 'vs'),
  ]
  const ok = (source: string, sh: string, th: string, edges = [] as ReturnType<typeof museEdge>[]) =>
    isValidMuseConnection({ source, target: 'vi', sourceHandle: sh, targetHandle: th }, nodes, edges)
  assert.equal(ok('v1', MUSE_HANDLE.refVideoOut, MUSE_HANDLE.refVideoIn), true)
  assert.equal(ok('v1', MUSE_HANDLE.refVideoOut, MUSE_HANDLE.refsIn), false)
  assert.equal(ok('b1', MUSE_HANDLE.imageOut, MUSE_HANDLE.refsIn), true)
  assert.equal(ok('sc', MUSE_HANDLE.imagesOut, MUSE_HANDLE.refsIn), true)
  assert.equal(ok('b1', MUSE_HANDLE.imageOut, MUSE_HANDLE.refVideoIn), false)
  // đã có 1 video -> video thứ 2 không vào được
  const vEdge = museEdge('v1', 'vi', MUSE_HANDLE.refVideoOut, MUSE_HANDLE.refVideoIn)
  assert.equal(ok('v2', MUSE_HANDLE.refVideoOut, MUSE_HANDLE.refVideoIn, [vEdge]), false)
  assert.match(explainMuseConnection('v2', 'source', 'vi', nodes, [vEdge]), /chỉ nhận 1 video/)
  // đã có 3 ảnh -> ảnh thứ 4 không vào được
  // đã đủ VIDEO_INGR_MAX_REFS ảnh -> ảnh kế tiếp không vào được (giới hạn lấy từ hằng số, không ghi cứng)
  const full = ['b1', 'b2', ...Array.from({ length: VIDEO_INGR_MAX_REFS - 2 }, (_, i) => `b${i + 3}`)].map((b) => museEdge(b, 'vi', MUSE_HANDLE.imageOut, MUSE_HANDLE.refsIn))
  const extra = `b${VIDEO_INGR_MAX_REFS + 1}`
  assert.equal(full.length, VIDEO_INGR_MAX_REFS)
  assert.equal(ok(extra, MUSE_HANDLE.imageOut, MUSE_HANDLE.refsIn, full), false)
  assert.match(explainMuseConnection(extra, 'source', 'vi', nodes, full), new RegExp(`tối đa ${VIDEO_INGR_MAX_REFS} ảnh`))
  // thả lên thân node -> tự chọn đúng cổng
  assert.equal(autoMuseConnection('v1', 'source', MUSE_HANDLE.refVideoOut, 'vi', nodes, [])?.targetHandle, MUSE_HANDLE.refVideoIn)
  assert.equal(autoMuseConnection('b1', 'source', MUSE_HANDLE.imageOut, 'vi', nodes, [])?.targetHandle, MUSE_HANDLE.refsIn)
  // Video tham chiếu vẫn không vào node khác
  assert.equal(isValidMuseConnection({ source: 'v1', target: 'vs', sourceHandle: MUSE_HANDLE.refVideoOut, targetHandle: MUSE_HANDLE.refsIn }, nodes), false)
})

test('đoạn cắt: mặc định cả video, tối đa 15 s; credit ước tính theo giá đo 8 s = 30', () => {
  assert.deepEqual(videoIngrTrim({ trimStart: null, trimEnd: null }, 13.6), { start: 0, end: 13.6, length: 13.6 })
  assert.deepEqual(videoIngrTrim({ trimStart: null, trimEnd: null }, 20), { start: 0, end: 15, length: 15 })
  assert.deepEqual(videoIngrTrim({ trimStart: null, trimEnd: null }, 7.5), { start: 0, end: 7.5, length: 7.5 })
  assert.deepEqual(videoIngrTrim({ trimStart: 2, trimEnd: null }, 13.6), { start: 2, end: 13.6, length: 11.6 })
  assert.deepEqual(videoIngrTrim({ trimStart: 1.5, trimEnd: 9 }, 13.6), { start: 1.5, end: 9, length: 7.5 })
  assert.equal(videoIngrCredits(8), 30)
  assert.equal(videoIngrCredits(10), 38)
  assert.equal(videoIngrCredits(15), 56)
})

test('chặn trước khi gửi (không tốn credit)', () => {
  const refs = scriptRefsFromSources([board('b1'), board('b2')])
  const d = { prompt: 'P', trimStart: null, trimEnd: null }
  assert.deepEqual(videoIngrBlockers(d, VIDEO, refs, FLOW), [])
  assert.match(videoIngrBlockers(d, VIDEO, refs, null)[0], /Chưa chọn project Flow/)
  assert.match(videoIngrBlockers(d, null, refs, FLOW)[0], /Chưa nối “Video tham chiếu”/)
  assert.match(videoIngrBlockers(d, VIDEO, [], FLOW)[0], /Chưa nối ảnh tham chiếu/)
  assert.deepEqual(videoIngrBlockers({ ...d, trimEnd: 13 }, VIDEO, refs, FLOW), []) // 13 s: Flow nhận tới 15 s
  assert.match(videoIngrBlockers({ ...d, trimStart: 0, trimEnd: 15.5 }, { ...VIDEO, durationSec: 20 }, refs, FLOW)[0], /tối đa 15 giây/)
  assert.match(videoIngrBlockers({ ...d, trimStart: 5, trimEnd: 6 }, VIDEO, refs, FLOW)[0], /quá ngắn/)
  assert.match(videoIngrBlockers({ ...d, trimStart: 6, trimEnd: 5 }, VIDEO, refs, FLOW)[0], /không hợp lệ/)
  assert.match(videoIngrBlockers({ ...d, trimStart: 5, trimEnd: 14.5 }, VIDEO, refs, FLOW)[0], /vượt quá độ dài video/)
  assert.match(videoIngrBlockers({ ...d, prompt: '  ' }, VIDEO, refs, FLOW)[0], /Prompt đang trống/)
  assert.match(videoIngrBlockers(d, VIDEO, refs, { ...FLOW, flowProjectId: '' })[0], /chưa có mã project trên Google Flow/)
})

test('request video_edit: Omni 1.2, 720p, ảnh theo thứ tự, đoạn cắt, media id, khóa chống trùng theo lần gửi', () => {
  const refs = scriptRefsFromSources([board('b2'), board('b1')], ['b1', 'b2'])
  const d = { prompt: '  PROMPT  ', trimStart: 0.5, trimEnd: 9.25 }
  const body = buildVideoIngrRequest('vingr-1', d, VIDEO, refs, FLOW, 'media-123', 1)
  assert.deepEqual(
    { ...body, idempotency_key: undefined },
    {
      prompt: 'PROMPT',
      model_display_name: 'Omni 1.2 Flash',
      input_mode: 'video_edit',
      aspect_ratio: '9:16',
      duration_seconds: 9,
      resolution: '720p',
      num_outputs: 1,
      variant: 1,
      project_id: '5f37623c-212',
      ingredient_image_paths: ['D:/b1.webp', 'D:/b2.webp'],
      reference_video_id: 'media-123',
      reference_video_start_seconds: 0.5,
      reference_video_end_seconds: 9.25,
      idempotency_key: undefined,
    },
  )
  assert.match(String(body.idempotency_key), /^musevingr-vingr-1-[a-z0-9]+-a1-v1$/)
  assert.notEqual(buildVideoIngrRequest('vingr-1', d, VIDEO, refs, FLOW, 'media-123', 2).idempotency_key, body.idempotency_key)
  // mỗi biến thể 1 khóa riêng (1 job riêng); gửi lại CÙNG lần + CÙNG biến thể thì cùng khóa (backend không tạo thêm job)
  const keys = [1, 2, 3, 4].map((v) => String(buildVideoIngrRequest('vingr-1', d, VIDEO, refs, FLOW, 'media-123', 1, v).idempotency_key))
  assert.equal(new Set(keys).size, 4)
  assert.deepEqual(keys.map((k) => k.slice(-3)), ['-v1', '-v2', '-v3', '-v4'])
  assert.equal(buildVideoIngrRequest('vingr-1', d, VIDEO, refs, FLOW, 'media-999', 1, 3).idempotency_key, keys[2])
  // mọi biến thể giống hệt về nội dung: mỗi job vẫn num_outputs = 1
  assert.equal(buildVideoIngrRequest('vingr-1', d, VIDEO, refs, FLOW, 'media-123', 1, 4).num_outputs, 1)
  // `variant` đi kèm để backend (chống trùng theo nội dung) không gộp các biến thể giống hệt nhau thành 1 job
  assert.deepEqual([1, 2, 3, 4].map((v) => buildVideoIngrRequest('vingr-1', d, VIDEO, refs, FLOW, 'media-123', 1, v).variant), [1, 2, 3, 4])
  assert.throws(() => buildVideoIngrRequest('vingr-1', d, VIDEO, refs, FLOW, '', 1), /mã video tham chiếu/)
  assert.throws(() => buildVideoIngrRequest('vingr-1', d, null, refs, FLOW, 'm', 1), /Video tham chiếu/)
})

test('trạng thái: đổi thứ tự ảnh / đoạn cắt / prompt -> video là bản cũ', () => {
  const refs = scriptRefsFromSources([board('b1'), board('b2')])
  const base = normalizeVideoIngrData(createVideoIngrNode({ x: 0, y: 0 }, 'P').data)
  const fp = videoIngrFingerprint(base, VIDEO, refs, FLOW)
  const done = { status: 'done' as const, fingerprint: fp, attempt: 1, startedAt: 0, updatedAt: 0, files: ['a.mp4'] }
  assert.equal(videoIngrState(done, base, VIDEO, refs, FLOW), 'done')
  assert.equal(videoIngrState(done, { ...base, trimEnd: 8 }, VIDEO, refs, FLOW), 'stale')
  assert.equal(videoIngrState(done, base, VIDEO, [...refs].reverse(), FLOW), 'stale')
  assert.equal(videoIngrState(done, { ...base, prompt: 'P2' }, VIDEO, refs, FLOW), 'stale')
  assert.equal(videoIngrState(undefined, base, VIDEO, refs, FLOW), 'none')
  assert.equal(videoIngrState({ ...done, status: 'running' }, base, VIDEO, refs, FLOW), 'running')
  assert.equal(videoIngrState({ ...done, status: 'error' }, base, VIDEO, refs, FLOW), 'error')
})

test('biến thể: tổng credit nhân theo số biến thể, lần gửi kế tiếp, số ô hiển thị, trạng thái chung', () => {
  assert.equal(videoIngrTotalCredits(8, 1), 30)
  assert.equal(videoIngrTotalCredits(8, 3), 90)
  assert.equal(videoIngrTotalCredits(13, 4), 4 * videoIngrCredits(13))
  assert.equal(videoIngrTotalCredits(8, 0), 30) // tối thiểu 1 biến thể
  assert.equal(videoIngrNextAttempt([]), 1)
  assert.equal(videoIngrNextAttempt([{ attempt: 1 }, { attempt: 3 }, { attempt: 2 }]), 4)
  // cấu hình giảm xuống nhưng đã có 3 video: vẫn hiện đủ 3 ô (không giấu video đã tạo), tối đa 4
  assert.deepEqual([videoIngrSlotCount(1, 0), videoIngrSlotCount(2, 0), videoIngrSlotCount(1, 3), videoIngrSlotCount(4, 2), videoIngrSlotCount(2, 9)], [1, 2, 3, 4, 4])
  assert.equal(videoIngrOverallState(['done', 'running', 'error']), 'running')
  assert.equal(videoIngrOverallState(['done', 'error', 'stale']), 'error')
  assert.equal(videoIngrOverallState(['done', 'stale']), 'stale')
  assert.equal(videoIngrOverallState(['done', 'none']), 'done')
  assert.equal(videoIngrOverallState(['none']), 'none')
})

test('lượt tải / gửi chạy qua museRuns; làm mẫu giữ prompt, bỏ video đã tạo', () => {
  assert.equal(runKeyNodeId(runKey.videoIngr('vingr-x-1')), 'vingr-x-1')
  const n = createVideoIngrNode({ x: 0, y: 0 }, 'P', 'vingr-a-1')
  const withVideo = { ...n, data: { ...n.data, trimEnd: 8, videos: [{ status: 'done', fingerprint: 'f', attempt: 1, startedAt: 0, updatedAt: 0 }, { status: 'error', fingerprint: 'f', attempt: 1, startedAt: 0, updatedAt: 0 }] } }
  const copy = copyGraph({ nodes: [withVideo], edges: [] }, 'copy', (p) => `${p}-new`)
  assert.deepEqual((copy.nodes[0].data.videos as { status: string }[]).map((v) => v.status), ['done', 'error'])
  const tpl = copyGraph({ nodes: [withVideo], edges: [] }, 'template', (p) => `${p}-new`)
  assert.deepEqual([tpl.nodes[0].data.videos, tpl.nodes[0].data.prompt, tpl.nodes[0].data.trimEnd], [[], 'P', 8])
})

test('x2–x4 = MỘT job Flow ra nhiều video (HAR 2026-11-23): num_outputs = số biến thể, 360p theo cấu hình', () => {
  const d = normalizeVideoIngrData({ prompt: 'P' })
  const refs = scriptRefsFromSources([board('b1'), board('b2')])
  const F360: VideoIngrFlow = { ...FLOW, resolution: '360p' }
  const body = buildVideoIngrRequest('vingr-1', d, VIDEO, refs, F360, 'media-123', 1, 1, 3)
  assert.equal(body.num_outputs, 3)
  assert.equal(body.resolution, '360p')
  assert.equal(body.variant, 1)
  assert.match(String(body.idempotency_key), /-a1-x3$/)
  // một ô tạo lại riêng: 1 video, khóa + variant theo ô
  const one = buildVideoIngrRequest('vingr-1', d, VIDEO, refs, F360, 'media-123', 2, 3)
  assert.deepEqual([one.num_outputs, one.variant], [1, 3])
  assert.match(String(one.idempotency_key), /-a2-v3$/)
  // không có resolution (bản lưu cũ) = 720p; 720p giữ nguyên dấu vân tay cũ, 360p khác
  assert.equal(buildVideoIngrRequest('vingr-1', d, VIDEO, refs, FLOW, 'media-123', 1).resolution, '720p')
  assert.equal(videoIngrFingerprint(d, VIDEO, refs, { ...FLOW, resolution: '720p' }), videoIngrFingerprint(d, VIDEO, refs, FLOW))
  assert.notEqual(videoIngrFingerprint(d, VIDEO, refs, F360), videoIngrFingerprint(d, VIDEO, refs, FLOW))
  // giá: HAR 3 video 13 s 360p = 48 credit (16/video); 720p giữ giá đo cũ
  assert.equal(videoIngrCredits(13, '360p'), 16)
  assert.equal(videoIngrCredits(13.63, '360p'), 16)                     // đúng đoạn trong HAR: Flow bỏ phần giây lẻ
  assert.equal(videoIngrTotalCredits(13, 3, '360p'), 48)
  assert.equal(videoIngrCredits(8), 30)
})

test('mỗi ô lấy kết cục của đúng video của mình trong job nhiều video', () => {
  const tile = (k: number) => ({ status: 'running' as const, fingerprint: 'f', attempt: 1, startedAt: 0, updatedAt: 0, outputIndex: k, jobId: 'J' })
  const job = { job_id: 'J', status: 'done', output_files: ['J_v2.mp4', 'J_v3.mp4'], outputs: [
    { index: 0, status: 'error', error: 'Google Flow: … PROMINENT_PEOPLE …', error_code: 'FLOW_PROMINENT_PEOPLE' },
    { index: 1, status: 'done', file: 'J_v2.mp4' },
    { index: 2, status: 'done', file: 'J_v3.mp4' },
  ] }
  const [a, b, c] = [0, 1, 2].map((k) => videoIngrFromJob(tile(k), job, 5))
  assert.deepEqual([a.status, a.errorCode], ['error', 'FLOW_PROMINENT_PEOPLE'])
  assert.deepEqual([b.status, b.files], ['done', ['J_v2.mp4']])
  assert.deepEqual([c.status, c.files], ['done', ['J_v3.mp4']])
  // job đang chạy: mọi ô cùng bước; lỗi chung của cả job (chưa gửi được) áp cho mọi ô
  assert.equal(videoIngrFromJob(tile(2), { job_id: 'J', status: 'generating', current_step: 'Đang tạo' }).detail, 'Đang tạo')
  const fail = videoIngrFromJob(tile(1), { job_id: 'J', status: 'error', error_message: 'Chưa gửi lên Flow (không mất credit): x', error_code: 'NOT_SUBMITTED' })
  assert.deepEqual([fail.status, fail.errorCode], ['error', 'NOT_SUBMITTED'])
  // job 1 video (không outputIndex) giữ hành vi cũ
  const single = videoIngrFromJob({ status: 'running', fingerprint: 'f', attempt: 1, startedAt: 0, updatedAt: 0 }, { job_id: 'K', status: 'done', output_files: ['K.mp4'] })
  assert.deepEqual(single.files, ['K.mp4'])
  // job nhiều video mà backend chỉ nhận được 1 video: ô đầu có video, ô sau báo thiếu (không gán trùng video ô đầu)
  const lost = { job_id: 'J', status: 'done', output_files: ['J.mp4'], outputs: [] }
  assert.deepEqual(videoIngrFromJob(tile(0), lost).files, ['J.mp4'])
  const missing = videoIngrFromJob(tile(1), lost)
  assert.deepEqual([missing.status, missing.errorCode, missing.files], ['error', 'OUTPUT_MISSING', undefined])
  // "Tìm lại video" chỉ cho ô của job 1 video
  const all = [tile(0), tile(1), { ...tile(0), jobId: 'K', outputIndex: undefined }]
  assert.deepEqual(all.map((v) => videoIngrIsBatchTile(v, all)), [true, true, false])
})

test('Ra node: video Flow đã tạo -> dữ liệu node Video tham chiếu (tên file Veo, URL phát); ô chưa xong thì không', () => {
  const done = { status: 'done' as const, fingerprint: 'f', attempt: 1, startedAt: 0, updatedAt: 0, files: ['a8aa718a-689_v2.mp4'] }
  const ref = videoIngrTileToRef(done, (f) => `http://x/api/veo/history/${f}/file`)
  assert.deepEqual(ref, {
    id: 'flow-a8aa718a-689_v2', name: 'a8aa718a-689_v2.mp4', path: 'a8aa718a-689_v2.mp4',
    previewUrl: 'http://x/api/veo/history/a8aa718a-689_v2.mp4/file', size: 0, durationSec: 0, source: 'library',
  })
  assert.equal(videoIngrTileToRef({ ...done, status: 'running' }, String), null)
  assert.equal(videoIngrTileToRef({ ...done, status: 'error' }, String), null)
  assert.equal(videoIngrTileToRef({ ...done, files: [] }, String), null)
  assert.equal(videoIngrTileToRef(undefined, String), null)
})

test('bản lưu cũ: ô sau của cùng job trỏ trùng file ô đầu -> hiện là thiếu video (không phát trùng)', () => {
  const base = { status: 'done' as const, fingerprint: 'f', attempt: 8, startedAt: 0, updatedAt: 0, jobId: 'a8aa718a-689', files: ['a8aa718a-689.mp4'] }
  const d = normalizeVideoIngrData({ videos: [{ ...base, outputIndex: 0 }, { ...base, outputIndex: 1 }] })
  assert.deepEqual(d.videos.map((v) => [v.status, v.errorCode ?? null, v.files ?? null]), [
    ['done', null, ['a8aa718a-689.mp4']],
    ['error', 'OUTPUT_MISSING', null],
  ])
  // job nhiều video đúng (mỗi ô 1 file riêng) giữ nguyên
  const good = normalizeVideoIngrData({ videos: [{ ...base, outputIndex: 0 }, { ...base, outputIndex: 1, files: ['a8aa718a-689_v2.mp4'] }] })
  assert.deepEqual(good.videos.map((v) => v.status), ['done', 'done'])
  // các ô của những job 1 video khác nhau (tạo lại riêng từng ô) không bị đụng tới
  const singles = normalizeVideoIngrData({ videos: [{ ...base, jobId: 'A' }, { ...base, jobId: 'B' }] })
  assert.deepEqual(singles.videos.map((v) => v.status), ['done', 'done'])
})
