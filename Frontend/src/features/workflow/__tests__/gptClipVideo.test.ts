import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  CLIP_VIDEO_STALL_MS,
  buildClipVideoRequest,
  clipVideoStalled,
  stopWaitingVideo,
  clipFlowCredits,
  clipFlowSettings,
  clipVideoBlockers,
  clipVideoFingerprint,
  clipVideoState,
  fileStem,
  isProjectHomeError,
  isSafeFlowError,
  normalizeClipPromptData,
} from '../services/museCanvasNodes.ts'
import { normalizeMuseCanvasConfig, museCanvasConfigToApi } from '../services/museCanvasConfig.ts'

const ref = (p: string) => ({ id: p, name: p, path: p, previewUrl: '/x?file=' + p, size: 1 })
const clipData = (over: Record<string, unknown> = {}) =>
  normalizeClipPromptData({ k: 2, n: 3, seconds: 8, prompt: '[0–2s] a. [2–8s] b.', image: ref('D:/b2.png'), ...over })
const FLOW = { projectId: 'p1', aspect: '9:16' as const, resolution: '720p' as const }

test('clip video: cấu hình Flow mặc định 9:16 + 720p, lưu / nạp lại đúng', () => {
  const d = normalizeMuseCanvasConfig({})
  assert.deepEqual([d.flowProjectId, d.flowAspect, d.flowResolution], ['', '9:16', '720p'])
  const c = normalizeMuseCanvasConfig({ flow_project_id: ' p1 ', flow_aspect: '16:9', flow_resolution: '360p' })
  assert.deepEqual(clipFlowSettings(c), { projectId: 'p1', aspect: '16:9', resolution: '360p' })
  assert.deepEqual(normalizeMuseCanvasConfig(museCanvasConfigToApi(c)), c)
  assert.equal(normalizeMuseCanvasConfig({ flow_aspect: '1:1' }).flowAspect, '9:16') // Omni Ingredients chỉ 9:16 / 16:9
})

test('clip video: chặn trước khi gửi — chưa chọn project, thiếu ảnh, số giây sai, prompt trống (độ dài prompt không chặn)', () => {
  assert.deepEqual(clipVideoBlockers(clipData(), FLOW), [])
  assert.match(clipVideoBlockers(clipData(), { ...FLOW, projectId: '' })[0], /Chưa chọn project Flow/)
  assert.match(clipVideoBlockers(clipData({ image: null }), FLOW)[0], /Chưa có ảnh tham chiếu/)
  assert.match(clipVideoBlockers(clipData({ seconds: 7.5 }), FLOW)[0], /số giây nguyên 3–15/)
  assert.match(clipVideoBlockers(clipData({ seconds: 16 }), FLOW)[0], /số giây nguyên 3–15/)
  assert.match(clipVideoBlockers(clipData({ prompt: '   ' }), FLOW)[0], /Prompt video đang trống/)
  assert.deepEqual(clipVideoBlockers(clipData({ prompt: 'x'.repeat(2819) }), FLOW), []) // 2.819 ký tự vẫn tạo được
  assert.equal(String(buildClipVideoRequest('n1', clipData({ prompt: 'x'.repeat(2819) }), FLOW, 1).prompt).length, 2819)
  assert.throws(() => buildClipVideoRequest('n1', clipData({ image: null }), FLOW, 1), /Chưa có ảnh tham chiếu/)
})

test('clip video: request Omni 1.2 Ingredients với ảnh #k, project đã chọn và khóa chống trùng theo lần gửi', () => {
  const body = buildClipVideoRequest('clip-n1', clipData(), FLOW, 1)
  const { idempotency_key: key, ...rest } = body
  assert.deepEqual(rest, {
    prompt: '[0–2s] a. [2–8s] b.',
    model_display_name: 'Omni 1.2 Flash',
    input_mode: 'ingredients',
    aspect_ratio: '9:16',
    duration_seconds: 8,
    resolution: '720p',
    num_outputs: 1,
    project_id: 'p1',
    ingredient_image_paths: ['D:/b2.png'],
  })
  assert.match(String(key), /^musecanvas-clip-n1-.+-a1$/)
  assert.equal(buildClipVideoRequest('clip-n1', clipData(), FLOW, 1).idempotency_key, key) // bấm 2 lần cùng lần gửi -> cùng khóa
  assert.notEqual(buildClipVideoRequest('clip-n1', clipData(), FLOW, 2).idempotency_key, key) // "Tạo lại" -> khóa mới
  assert.notEqual(buildClipVideoRequest('clip-n1', clipData({ seconds: 9, prompt: '[0–9s] a.' }), FLOW, 1).idempotency_key, key)
})

test('clip video: trạng thái, video cũ khi đổi prompt / cấu hình, phân loại lỗi, credit', () => {
  const d = clipData()
  assert.equal(clipVideoState(d, FLOW), 'none')
  const fp = clipVideoFingerprint(d, FLOW)
  const done = normalizeClipPromptData({ ...d, video: { status: 'done', fingerprint: fp, attempt: 1, files: ['D:/veo/a.mp4'], startedAt: 1, updatedAt: 2 } })
  assert.equal(clipVideoState(done, FLOW), 'done')
  assert.equal(clipVideoState(done, { ...FLOW, resolution: '360p' }), 'stale')
  assert.equal(clipVideoState({ ...done, prompt: d.prompt + ' more' }, FLOW), 'stale')
  assert.equal(clipVideoState(normalizeClipPromptData({ ...d, video: { status: 'running', fingerprint: fp, attempt: 1, startedAt: 1, updatedAt: 1 } }), FLOW), 'running')
  assert.equal(isProjectHomeError('Giải reCAPTCHA thất bại: Open a Flow project: reCAPTCHA is not loaded on the home page'), true)
  assert.equal(isProjectHomeError('FLOW_RENDER_FAILED'), false)
  assert.equal(isSafeFlowError('CAPTCHA_FAILED'), true)
  assert.equal(isSafeFlowError('FLOW_RENDER_FAILED'), false)
  assert.equal(isSafeFlowError(undefined), false)
  assert.deepEqual([clipFlowCredits(8, '720p'), clipFlowCredits(9, '360p')], [24, 9])
})

test('clip video: job im lặng quá 25 phút bị coi là nghi đã chết; "Dừng chờ" mở lại nút Tạo lại và không coi là chưa gửi', () => {
  const t0 = 1_000_000_000_000
  const run = { status: 'running' as const, jobId: 'j1', fingerprint: 'x', attempt: 1, startedAt: t0, updatedAt: t0, backendUpdatedAt: t0 + 60_000 }
  assert.equal(clipVideoStalled(run, t0 + 10 * 60_000), false) // chờ 10 phút: bình thường (hàng đợi / render dài)
  assert.equal(clipVideoStalled(run, t0 + 60_000 + CLIP_VIDEO_STALL_MS), false)
  assert.equal(clipVideoStalled(run, t0 + 60_000 + CLIP_VIDEO_STALL_MS + 1), true)
  // chưa có mốc từ backend: tính từ lúc bấm; job chưa có id / không chạy / không có: không bao giờ "stalled"
  assert.equal(clipVideoStalled({ ...run, backendUpdatedAt: undefined }, t0 + CLIP_VIDEO_STALL_MS + 1), true)
  assert.equal(clipVideoStalled({ ...run, jobId: undefined }, t0 + 99 * 60_000), false)
  assert.equal(clipVideoStalled({ ...run, status: 'error' }, t0 + 99 * 60_000), false)
  assert.equal(clipVideoStalled(null, t0), false)

  const stopped = stopWaitingVideo(run, t0 + 5)
  assert.deepEqual([stopped.status, stopped.errorCode, stopped.jobId, stopped.updatedAt], ['error', 'STOPPED_WAITING', 'j1', t0 + 5])
  assert.match(stopped.error || '', /Đã dừng chờ/)
  assert.equal(isSafeFlowError(stopped.errorCode), false) // job có thể vẫn chạy: nút "Tìm lại video" còn, không bảo "chưa mất credit"
  const d = clipData()
  const node = normalizeClipPromptData({ ...d, video: { ...stopped, fingerprint: clipVideoFingerprint(d, FLOW) } })
  assert.equal(clipVideoState(node, FLOW), 'error') // sau khi dừng chờ: không còn "running" -> nút Tạo lại bật
})

test('clip video: id video Veo lấy từ đường dẫn Windows lẫn POSIX', () => {
  assert.equal(fileStem('D:\\GOOGLE SEARCH\\tools\\Backend\\Data\\media\\veo_outputs\\ed3a4075-08f.mp4'), 'ed3a4075-08f')
  assert.equal(fileStem('/data/veo_outputs/abc.mp4'), 'abc')
  assert.equal(fileStem('abc'), 'abc')
})
