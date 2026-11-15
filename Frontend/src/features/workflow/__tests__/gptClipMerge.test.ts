import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_MERGE_FINISH,
  MUSE_NODE,
  autoMuseConnection,
  buildMergeRequest,
  createClipMergeNode,
  createClipPromptNode,
  createClipScriptNode,
  explainMuseConnection,
  isValidMuseConnection,
  mergeBlockers,
  mergeFingerprint,
  mergeFromJob,
  mergeRowsFromSources,
  mergeState,
  mergeSummary,
  moveMergeRow,
  normalizeClipMergeData,
  planMergeNode,
  type MuseMergeResult,
} from '../services/museCanvasNodes.ts'

const clip = (k: number, over: Record<string, unknown> = {}, id = `clip${k}`) => {
  const n = createClipPromptNode({ x: 0, y: 0 }, { k, n: 3, name: `Bộ ${k}`, seconds: 8, videoPrompt: '[0–8s] a.', body: '' }, null, { clipScriptNodeId: 'cs', updatedAt: 1, k }, id)
  Object.assign(n.data, over)
  return n
}
const withVideo = (k: number, file: string | null, status: 'done' | 'running' | 'error' = 'done') =>
  clip(k, file || status !== 'done' ? { video: { status, fingerprint: 'x', attempt: 1, files: file ? [file] : undefined, startedAt: 1, updatedAt: 1 } } : {})
const src = (n: ReturnType<typeof clip>) => ({ id: n.id, type: n.type, data: n.data })

test('merge: node mới mặc định xóa watermark + tắt tiếng gốc (Omni chỉ có tiếng nền phòng thu)', () => {
  const d = normalizeClipMergeData(createClipMergeNode({ x: 0, y: 0 }).data)
  assert.deepEqual([d.removeWatermark, d.finish.muteOriginal, d.finish.originalVolume, d.finish.bgmTrackIds], [true, true, 0.2, []])
  assert.deepEqual(d.finish, DEFAULT_MERGE_FINISH)
  // dữ liệu cũ / thiếu trường: vẫn dùng mặc định ghép (không phải mặc định của node Video kết quả)
  assert.equal(normalizeClipMergeData({}).finish.muteOriginal, true)
  assert.equal(normalizeClipMergeData({ finish: { muteOriginal: false } }).finish.muteOriginal, false)
  assert.equal(normalizeClipMergeData({ removeWatermark: false }).removeWatermark, false)
  assert.deepEqual(normalizeClipMergeData({ trims: { a: { start: -5, end: 999 }, b: 'xấu' } }).trims, { a: { start: 0, end: 60 }, b: { start: 0, end: 0 } })
})

test('merge: lấy file video đã xong của từng node Clip, xếp theo thứ tự người dùng rồi số k', () => {
  const rows = mergeRowsFromSources([src(withVideo(3, 'c.mp4')), src(withVideo(1, 'a.mp4')), src(withVideo(2, null, 'running')), { id: 'x', type: MUSE_NODE.output, data: {} }])
  assert.deepEqual(rows.map((r) => [r.k, r.file, r.status]), [[1, 'a.mp4', 'ready'], [2, null, 'running'], [3, 'c.mp4', 'ready']])
  const reordered = mergeRowsFromSources([src(withVideo(1, 'a.mp4')), src(withVideo(2, 'b.mp4')), src(withVideo(3, 'c.mp4'))], ['clip3', 'clip1'])
  assert.deepEqual(reordered.map((r) => r.k), [3, 1, 2])
  assert.deepEqual(moveMergeRow(reordered, 'clip2', -1), ['clip3', 'clip2', 'clip1'])
  assert.deepEqual(moveMergeRow(reordered, 'clip3', -1), ['clip3', 'clip1', 'clip2']) // đã ở đầu: giữ nguyên
  // clip có lỗi / chưa tạo: không có file
  assert.equal(mergeRowsFromSources([src(withVideo(1, null, 'error'))])[0].status, 'error')
  assert.equal(mergeRowsFromSources([src(clip(1))])[0].status, 'no_video')
})

test('merge: chặn khi chưa nối clip, clip chưa có video, hoặc cắt quá tay', () => {
  assert.match(mergeBlockers([], {})[0], /Chưa nối clip nào/)
  const rows = mergeRowsFromSources([src(withVideo(1, 'a.mp4')), src(withVideo(2, null, 'running')), src(withVideo(3, null))])
  assert.deepEqual(mergeBlockers(rows, {}), ['Clip 2: video đang tạo — chờ xong rồi ghép.', 'Clip 3: chưa có video — tạo video ở node Clip trước.'])
  const ok = mergeRowsFromSources([src(withVideo(1, 'a.mp4')), src(withVideo(2, 'b.mp4'))])
  assert.deepEqual(mergeBlockers(ok, { clip1: { start: 1, end: 1 } }), [])
  assert.match(mergeBlockers(ok, { clip2: { start: 5, end: 2.6 } })[0], /Clip 2: cắt đầu 5s \+ cuối 2\.6s/)
  assert.throws(() => buildMergeRequest(rows, {}, true, DEFAULT_MERGE_FINISH), /video đang tạo/)
})

test('merge: request gửi clip theo thứ tự kèm cắt, watermark, âm thanh, nhãn', () => {
  const rows = mergeRowsFromSources([src(withVideo(1, 'a.mp4')), src(withVideo(2, 'b.mp4'))])
  const finish = { ...DEFAULT_MERGE_FINISH, bgmTrackIds: ['t1'], bgmVolume: 0.4, labelText: ' @kenh ', logoId: 'abcdef012345' }
  assert.deepEqual(buildMergeRequest(rows, { clip2: { start: 0.5, end: 1 } }, true, finish, '  Bộ 2 clip '), {
    clips: [{ path: 'a.mp4', trim_start: 0, trim_end: 0 }, { path: 'b.mp4', trim_start: 0.5, trim_end: 1 }],
    remove_watermark: true,
    title: 'Bộ 2 clip',
    mute_original: true,
    original_volume: 0.2,
    bgm_track_ids: ['t1'],
    bgm_volume: 0.4,
    label_text: '@kenh',
    label_position: 'br',
    label_size: 'm',
    logo_id: 'abcdef012345',
    logo_position: 'tr',
    logo_size: 0.16,
  })
  assert.equal(buildMergeRequest(rows, {}, false, DEFAULT_MERGE_FINISH).remove_watermark, false)
})

test('merge: bản ghép thành "cũ" khi đổi clip, cắt, watermark hoặc cấu hình', () => {
  const rows = mergeRowsFromSources([src(withVideo(1, 'a.mp4')), src(withVideo(2, 'b.mp4'))])
  const fp = mergeFingerprint(rows, {}, true, DEFAULT_MERGE_FINISH)
  const done: MuseMergeResult = { status: 'done', inputPath: fp, filename: 'f.mp4', startedAt: 1, updatedAt: 2 }
  assert.equal(mergeState(rows, {}, true, DEFAULT_MERGE_FINISH, null), 'pending')
  assert.equal(mergeState(rows, {}, true, DEFAULT_MERGE_FINISH, done), 'done')
  assert.equal(mergeState(rows, { clip1: { start: 1, end: 0 } }, true, DEFAULT_MERGE_FINISH, done), 'stale')
  assert.equal(mergeState(rows, {}, false, DEFAULT_MERGE_FINISH, done), 'stale')
  assert.equal(mergeState(rows, {}, true, { ...DEFAULT_MERGE_FINISH, bgmTrackIds: ['t1'] }, done), 'stale')
  const regenerated = mergeRowsFromSources([src(withVideo(1, 'a2.mp4')), src(withVideo(2, 'b.mp4'))]) // tạo lại clip 1 ra file khác
  assert.equal(mergeState(regenerated, {}, true, DEFAULT_MERGE_FINISH, done), 'stale')
  assert.equal(mergeState(rows, {}, true, DEFAULT_MERGE_FINISH, { ...done, status: 'running' }), 'running')
  assert.equal(mergeState([], {}, true, DEFAULT_MERGE_FINISH, null), 'no_clips')
  assert.equal(mergeState(mergeRowsFromSources([src(withVideo(1, null))]), {}, true, DEFAULT_MERGE_FINISH, null), 'missing')
  assert.match(mergeSummary(rows, { clip1: { start: 1, end: 0 } }, true, DEFAULT_MERGE_FINISH), /^2 clip · xóa watermark Flow · cắt 1 clip · tắt tiếng gốc/)
})

test('merge: trạng thái job backend → kết quả trên node', () => {
  const prev: MuseMergeResult = { status: 'running', jobId: 'j', inputPath: 'x', step: 'Đang gửi…', startedAt: 1, updatedAt: 1 }
  const mid = mergeFromJob(prev, { status: 'running', step: 'Clip 2/3: xóa watermark Flow… 40%', clip: 2, total: 3 }, 5)
  assert.deepEqual([mid.status, mid.step, mid.clip, mid.total, mid.updatedAt], ['running', 'Clip 2/3: xóa watermark Flow… 40%', 2, 3, 5])
  const done = mergeFromJob(mid, { status: 'done', result: { filename: 'f.mp4', file_path: 'D:/f.mp4', title: 'T', duration_sec: 33.07 } }, 9)
  assert.deepEqual([done.status, done.filename, done.path, done.durationSec, done.error], ['done', 'f.mp4', 'D:/f.mp4', 33.07, undefined])
  const err = mergeFromJob(mid, { status: 'error', error: 'Clip 1: không xóa được watermark' }, 9)
  assert.deepEqual([err.status, err.error], ['error', 'Clip 1: không xóa được watermark'])
})

test('merge: "Ghép video" từ node Kịch bản tạo video nối sẵn mọi node Clip theo số k, không tạo trùng', () => {
  const script = createClipScriptNode({ x: 100, y: 50 }, 'P', 'cs')
  const c3 = withVideo(3, 'c.mp4')
  const c1 = withVideo(1, 'a.mp4')
  const nodes = [script, c3, c1, clip(2, {}, 'other-script-clip')]
  ;(nodes[3].data as any).origin = { clipScriptNodeId: 'khac', updatedAt: 1, k: 2 } // clip của node khác: bỏ qua
  const plan = planMergeNode({ ...script, width: 520 }, nodes)!
  assert.equal(plan.node.type, MUSE_NODE.clipMerge)
  assert.deepEqual(plan.edges.map((e) => [e.source, e.sourceHandle, e.targetHandle]), [['clip1', 'clipvideo', 'clipvideos'], ['clip3', 'clipvideo', 'clipvideos']])
  assert.equal(normalizeClipMergeData(plan.node.data).origin?.clipScriptNodeId, 'cs')
  assert.equal(planMergeNode({ ...script, width: 520 }, [...nodes, plan.node]), null) // đã có node ghép
  assert.equal(planMergeNode({ ...script, width: 520 }, [script]), null) // chưa có node Clip nào
})

test('merge: dây chỉ từ node Clip → cổng clipvideos của Ghép video; nối nhiều dây được, kéo thả trượt cổng tự chọn đúng', () => {
  const m = createClipMergeNode({ x: 0, y: 0 }, null, 'm1')
  const c1 = clip(1)
  const c2 = clip(2)
  const nodes = [m, c1, c2, createClipScriptNode({ x: 0, y: 0 }, 'P', 'cs')]
  const wire = (source: string, target: string, sourceHandle = 'clipvideo', targetHandle = 'clipvideos') => ({ source, target, sourceHandle, targetHandle })
  assert.equal(isValidMuseConnection(wire('clip1', 'm1'), nodes), true)
  assert.equal(isValidMuseConnection(wire('clip2', 'm1'), nodes, [{ source: 'clip1', target: 'm1' }]), true) // nhiều clip vào 1 node
  assert.equal(isValidMuseConnection(wire('clip1', 'm1'), nodes, [{ source: 'clip1', target: 'm1' }]), false) // trùng dây
  assert.equal(isValidMuseConnection(wire('cs', 'm1', 'clips'), nodes), false) // chỉ node Clip có video để ghép
  assert.equal(isValidMuseConnection(wire('clip1', 'm1', 'clips'), nodes), false) // sai cổng ra (cổng clips là Kịch bản → Clip)
  assert.equal(isValidMuseConnection(wire('m1', 'clip1'), nodes), false) // Ghép video là node cuối
  assert.match(explainMuseConnection('cs', 'source', 'm1', nodes, []), /chỉ nhận dây từ node Clip/)
  assert.match(explainMuseConnection('m1', 'source', 'clip1', nodes, []), /Node Clip chỉ nhận dây từ Kịch bản tạo video/)
  const auto = autoMuseConnection('clip1', 'source', 'sai', 'm1', nodes, [])
  assert.deepEqual([auto?.sourceHandle, auto?.targetHandle], ['clipvideo', 'clipvideos'])
})
