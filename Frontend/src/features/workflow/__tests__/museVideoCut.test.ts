import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  autoMuseConnection,
  createVideoIngrNode,
  createVideoRefNode,
  explainMuseConnection,
  isValidMuseConnection,
  museEdge,
} from '../services/museCanvasNodes.ts'
import {
  CUT_MIN_PIECE,
  cutFirstKeptStart,
  cutFlowHint,
  cutFormatTime,
  cutHasEdits,
  cutInitPieces,
  cutKeepOnly,
  cutKeptDuration,
  cutKeptSegments,
  cutMergeNext,
  cutMoveBoundary,
  cutNormalizePieces,
  cutPieceAt,
  cutRemovedDuration,
  cutResultKey,
  cutRestoreAll,
  cutRulerTicks,
  cutSkipTarget,
  cutSourceToResult,
  cutSplit,
  cutStripWidth,
  cutToggleRemoved,
  createVideoCutNode,
  normalizeVideoCutData,
  type CutPiece,
} from '../services/museVideoCut.ts'
import { copyGraph } from '../services/museProjects.ts'
import { runKey, runKeyNodeId } from '../services/museRunRegistry.ts'

const P = (start: number, end: number, removed = false): CutPiece => ({ start, end, removed })

test('tách: chia đoạn chứa đầu phát làm hai, giữ cờ xóa; quá gần mép thì không tách', () => {
  const one = cutInitPieces(10)
  assert.deepEqual(cutSplit(one, 4), [P(0, 4), P(4, 10)])
  assert.deepEqual(cutSplit([P(0, 4), P(4, 10, true)], 7), [P(0, 4), P(4, 7, true), P(7, 10, true)])
  assert.equal(cutSplit(one, 0.05), one)                       // sát đầu
  assert.equal(cutSplit(one, 9.95), one)                       // sát cuối
  const two = [P(0, 4), P(4, 10)]
  assert.equal(cutSplit(two, 4), two)                          // đúng vết tách: không tách thêm
  assert.equal(cutSplit(cutInitPieces(0), 1).length, 0)
  assert.equal(cutPieceAt([P(0, 4), P(4, 10)], 4), 1)          // đúng ranh giới thuộc đoạn sau
  assert.equal(cutPieceAt([P(0, 4), P(4, 10)], 10), 1)         // cuối video thuộc đoạn cuối
})

test('xóa nhiều khúc: tổng giữ lại / bỏ đi, đoạn giữ liền nhau gộp một, không xóa nổi đoạn cuối cùng', () => {
  let p = cutInitPieces(13.6)
  p = cutSplit(p, 2)
  p = cutSplit(p, 5)
  p = cutSplit(p, 9)
  assert.equal(p.length, 4)
  p = cutToggleRemoved(p, 1) // bỏ 2–5
  p = cutToggleRemoved(p, 3) // bỏ 9–13.6
  assert.deepEqual(cutKeptSegments(p), [{ start: 0, end: 2 }, { start: 5, end: 9 }])
  assert.equal(cutKeptDuration(p), 6)
  assert.equal(cutRemovedDuration(p), 7.6)
  assert.equal(cutHasEdits(p), true)
  // đoạn giữ liền nhau (vết tách không xóa gì) gộp lại thành một đoạn gửi backend
  assert.deepEqual(cutKeptSegments(cutSplit(cutInitPieces(10), 4)), [{ start: 0, end: 10 }])
  assert.equal(cutHasEdits(cutSplit(cutInitPieces(10), 4)), true)
  assert.equal(cutHasEdits(cutInitPieces(10)), false)
  // khôi phục lại
  assert.deepEqual(cutKeptSegments(cutToggleRemoved(p, 1)), [{ start: 0, end: 9 }])
  assert.equal(cutRestoreAll(p).some((x) => x.removed), false)
  // đoạn giữ cuối cùng không xóa được (video kết quả không thể rỗng)
  const last = cutKeepOnly(p, 2)
  assert.equal(cutToggleRemoved(last, 2), last)
  assert.deepEqual(cutKeepOnly(p, 2).map((x) => x.removed), [true, true, false, true])
})

test('kéo mép và gộp vết tách', () => {
  const p = [P(0, 4), P(4, 10, true)]
  assert.deepEqual(cutMoveBoundary(p, 0, 6), [P(0, 6), P(6, 10, true)])
  // không cho đoạn nào ngắn hơn CUT_MIN_PIECE
  assert.deepEqual(cutMoveBoundary(p, 0, -3), [P(0, CUT_MIN_PIECE), P(CUT_MIN_PIECE, 10, true)])
  assert.deepEqual(cutMoveBoundary(p, 0, 99), [P(0, 9.9), P(9.9, 10, true)])
  assert.equal(cutMoveBoundary(p, 0, 4), p)                   // không đổi -> cùng tham chiếu (không ghi lịch sử)
  assert.equal(cutMoveBoundary(p, 5, 4), p)
  // gộp: chỉ coi là xóa khi cả hai đều xóa
  assert.deepEqual(cutMergeNext(p, 0), [P(0, 10, false)])
  assert.deepEqual(cutMergeNext([P(0, 4, true), P(4, 10, true)], 0), [P(0, 10, true)])
})

test('xem trước kết quả: nhảy qua đoạn đã xóa, hết phần giữ thì dừng', () => {
  const p = [P(0, 2), P(2, 5, true), P(5, 9), P(9, 13.6, true)]
  assert.equal(cutSkipTarget(p, 1), 1)                          // đang ở đoạn giữ
  assert.equal(cutSkipTarget(p, 2.4), 5)                        // vào đoạn xóa -> nhảy tới đầu đoạn giữ kế tiếp
  assert.equal(cutSkipTarget(p, 9.5), null)                     // đoạn xóa cuối: không còn gì để phát
  assert.equal(cutFirstKeptStart([P(0, 3, true), P(3, 8)]), 3)
  assert.equal(cutFirstKeptStart([]), 0)
  // đầu phát của video nguồn -> thời gian trong video kết quả
  assert.equal(cutSourceToResult(p, 1), 1)
  assert.equal(cutSourceToResult(p, 5), 2)                      // vừa qua đoạn xóa 2–5: kết quả mới tới giây 2
  assert.equal(cutSourceToResult(p, 7), 4)
  assert.equal(cutSourceToResult(p, 13.6), 6)
})

test('đọc bản lưu hỏng: sắp xếp, lấp khoảng hở, cắt vào độ dài, bỏ phần quá ngắn', () => {
  assert.deepEqual(cutNormalizePieces(null, 10), [P(0, 10)])
  assert.deepEqual(cutNormalizePieces([{ start: 6, end: 10, removed: true }, { start: 0, end: 4 }], 10), [P(0, 6), P(6, 10, true)]) // hở 4–6 -> nối dài đoạn trước
  assert.deepEqual(cutNormalizePieces([{ start: 2, end: 8 }], 10), [P(0, 2), P(2, 10)])  // phủ liền mạch cả hai đầu
  assert.deepEqual(cutNormalizePieces([P(0, 4), P(4, 30, true)], 10), [P(0, 4), P(4, 10, true)])      // cắt vào độ dài mới
  assert.deepEqual(cutNormalizePieces([P(0, 4), P(4, 4.02), P(4.02, 10)], 10), [P(0, 4.02), P(4.02, 10)])  // đoạn 0.02s quá ngắn: bỏ, đoạn trước nối dài
  assert.deepEqual(cutNormalizePieces(['x', null, { start: 'a' }], 10), [P(0, 10)])
  assert.deepEqual(cutNormalizePieces([P(0, 5)], 0), [])
  const many = Array.from({ length: 100 }, (_, i) => P(i, i + 1))
  assert.equal(cutNormalizePieces(many, 100).length, 60)       // tối đa 60 đoạn (giới hạn của backend)
})

test('dữ liệu node: mặc định, đọc hỏng, kết quả cùng dạng video tham chiếu', () => {
  const n = createVideoCutNode({ x: 0, y: 0 }, 'vcut-1')
  assert.equal(n.type, MUSE_NODE.videoCut)
  const d = normalizeVideoCutData(n.data)
  assert.deepEqual([d.title, d.sourcePath, d.duration, d.pieces, d.video, d.status], ['Cắt video', '', 0, [], null, 'idle'])
  const bad = normalizeVideoCutData({ duration: 'x', pieces: 5, video: { path: '' }, status: 'weird', resultKey: 3 })
  assert.deepEqual([bad.duration, bad.pieces, bad.video, bad.status, bad.resultKey], [0, [], null, 'idle', ''])
  const ok = normalizeVideoCutData({ duration: 13.6, pieces: [P(0, 5), P(5, 13.6, true)], video: { path: 'D:/u/cut_ab.mp4', name: 'a.mp4', previewUrl: '/p', size: 10, durationSec: 5, source: 'upload' } })
  assert.equal(ok.video?.path, 'D:/u/cut_ab.mp4')
  assert.equal(ok.pieces.length, 2)
})

test('dấu vân tay kết quả: cùng nguồn + cùng đoạn giữ = cùng video; tách thêm mà không xóa gì thì không đổi', () => {
  const a = cutResultKey('D:/v.mp4', [P(0, 2), P(2, 5, true), P(5, 9)])
  assert.equal(a, 'D:/v.mp4|0.00-2.00;5.00-9.00')
  assert.equal(cutResultKey('D:/v.mp4', [P(0, 1), P(1, 2), P(2, 5, true), P(5, 9)]), a)      // thêm vết tách trong đoạn giữ: không đổi
  assert.notEqual(cutResultKey('D:/v.mp4', [P(0, 2), P(2, 5.5, true), P(5.5, 9)]), a)
  assert.notEqual(cutResultKey('D:/other.mp4', [P(0, 2), P(2, 5, true), P(5, 9)]), a)
})

test('hiển thị: thời gian, thước, dải khung hình, nhắc giới hạn Flow', () => {
  assert.deepEqual([cutFormatTime(0), cutFormatTime(3.24), cutFormatTime(65), cutFormatTime(-2)], ['0:00.0', '0:03.2', '1:05.0', '0:00.0'])
  // thước: bước nhỏ nhất mà hai vạch cách nhau ≥ 54px
  const t = cutRulerTicks(13.6, 500)
  assert.deepEqual(t.map((x) => x.time), [0, 2, 4, 6, 8, 10, 12])  // 500/13.6 ≈ 36.8 px/s -> bước 2 s
  assert.equal(cutRulerTicks(13.6, 500 * 8)[1].time, 0.2)           // phóng to ×8 -> bước 0.2 s
  assert.deepEqual(cutRulerTicks(0, 500), [])
  assert.deepEqual([1, 2, 4, 8].map(cutStripWidth), [960, 1920, 3840, 3840])
  assert.equal(cutFlowHint(12), '')
  assert.match(cutFlowHint(16.4), /bỏ thêm 1\.4s/)
  assert.match(cutFlowHint(2), /tối thiểu 3s/)
})

test('dây: Video tham chiếu / Cắt video -> cổng Video của Cắt video; Cắt video -> Ingredients; không vòng, mỗi cổng 1 nguồn', () => {
  const ref = createVideoRefNode({ x: 0, y: 0 }, 'ref')
  const a = createVideoCutNode({ x: 0, y: 0 }, 'cutA')
  const b = createVideoCutNode({ x: 0, y: 0 }, 'cutB')
  const ingr = createVideoIngrNode({ x: 0, y: 0 }, 'P', 'ingr')
  const nodes = [ref, a, b, ingr]
  const conn = (source: string, target: string) => ({ source, target, sourceHandle: MUSE_HANDLE.refVideoOut, targetHandle: MUSE_HANDLE.refVideoIn })
  assert.equal(isValidMuseConnection(conn('ref', 'cutA'), nodes, []), true)
  assert.equal(isValidMuseConnection(conn('cutA', 'cutB'), nodes, []), true)       // nối tiếp
  assert.equal(isValidMuseConnection(conn('cutA', 'ingr'), nodes, []), true)       // kết quả vào Ingredients
  assert.equal(isValidMuseConnection(conn('ingr', 'cutA'), nodes, []), false)
  assert.equal(isValidMuseConnection({ ...conn('ref', 'cutA'), targetHandle: MUSE_HANDLE.refsIn }, nodes, []), false)
  const e1 = museEdge('ref', 'cutA', MUSE_HANDLE.refVideoOut, MUSE_HANDLE.refVideoIn)
  assert.equal(isValidMuseConnection(conn('cutB', 'cutA'), nodes, [e1]), false)    // cổng Video đã có nguồn
  const e2 = museEdge('cutA', 'cutB', MUSE_HANDLE.refVideoOut, MUSE_HANDLE.refVideoIn)
  assert.equal(isValidMuseConnection(conn('cutB', 'cutA'), nodes, [e2]), false)     // vòng A -> B -> A
  const c = createVideoCutNode({ x: 0, y: 0 }, 'cutC')
  const chain = [museEdge('cutA', 'cutB', MUSE_HANDLE.refVideoOut, MUSE_HANDLE.refVideoIn), museEdge('cutB', 'cutC', MUSE_HANDLE.refVideoOut, MUSE_HANDLE.refVideoIn)]
  assert.equal(isValidMuseConnection(conn('cutC', 'cutA'), [...nodes, c], chain), false) // vòng dài A -> B -> C -> A
  // Ingredients vẫn chỉ nhận 1 video (từ Video tham chiếu hoặc Cắt video)
  const toIngr = museEdge('ref', 'ingr', MUSE_HANDLE.refVideoOut, MUSE_HANDLE.refVideoIn)
  assert.equal(isValidMuseConnection(conn('cutA', 'ingr'), nodes, [toIngr]), false)
  // thả dây lên thân node: tự chọn đúng cổng
  assert.deepEqual(autoMuseConnection('cutA', 'source', MUSE_HANDLE.refVideoOut, 'ingr', nodes, []), conn('cutA', 'ingr'))
  assert.deepEqual(autoMuseConnection('ref', 'source', MUSE_HANDLE.refVideoOut, 'cutA', nodes, []), conn('ref', 'cutA'))
  // câu giải thích khi không nối được
  assert.match(explainMuseConnection('ingr', 'source', 'cutA', nodes, []), /Cắt video nhận 1 video/)
  assert.match(explainMuseConnection('cutB', 'source', 'cutA', nodes, [e2]), /vòng|chỉ nhận 1 video/)
  assert.match(explainMuseConnection('cutA', 'source', 'ingr', nodes, [toIngr]), /chỉ nhận 1 video/)
})

test('làm mẫu project giữ vết cắt, bỏ video đã cắt; khóa lượt chạy theo node', () => {
  const n = createVideoCutNode({ x: 0, y: 0 }, 'cutA')
  const withResult = { ...n, data: { ...n.data, sourcePath: 'D:/v.mp4', duration: 10, pieces: [P(0, 4), P(4, 10, true)], video: { path: 'D:/cut_x.mp4' }, resultKey: 'k', status: 'error', error: 'x' } }
  const tpl = copyGraph({ nodes: [withResult], edges: [] }, 'template')
  const d = tpl.nodes[0].data as Record<string, unknown>
  assert.deepEqual([d.video, d.resultKey, d.status, d.error], [null, '', 'idle', ''])
  assert.deepEqual(d.pieces, [P(0, 4), P(4, 10, true)])
  const copy = copyGraph({ nodes: [withResult], edges: [] }, 'copy')
  assert.equal((copy.nodes[0].data as Record<string, unknown>).resultKey, 'k')
  assert.equal(runKey.videoCut('vcut-1'), 'videoCut:vcut-1')
  assert.equal(runKeyNodeId(runKey.videoCut('vcut-1')), 'vcut-1')
})
