import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_FINISH_SETTINGS,
  buildFinishRequest,
  finishClips,
  finishFingerprint,
  finishState,
  finishSummary,
  interruptFinal,
  normalizeFinishSettings,
  normalizeVideoOutputData,
} from '../services/museCanvasNodes.ts'

const paths = ['D:/v_01.mp4', 'D:/v_02.mp4']

test('hoàn thiện video: chuẩn hóa cấu hình, chặn giá trị lạ', () => {
  assert.deepEqual(normalizeFinishSettings(undefined), DEFAULT_FINISH_SETTINGS)
  const s = normalizeFinishSettings({
    muteOriginal: true,
    originalVolume: 9,
    bgmTrackIds: ['a', 1, ''],
    bgmVolume: -1,
    labelText: 'x'.repeat(80),
    labelPosition: 'middle',
    labelSize: 'xl',
    logoId: '../../etc',
    logoPosition: 'bl',
    logoSize: 0.01,
    joinClips: 'yes',
  })
  assert.equal(s.muteOriginal, true)
  assert.equal(s.originalVolume, 2)
  assert.deepEqual(s.bgmTrackIds, ['a'])
  assert.equal(s.bgmVolume, 0)
  assert.equal(s.labelText.length, 60)
  assert.equal(s.labelPosition, 'br')
  assert.equal(s.labelSize, 'm')
  assert.equal(s.logoId, '') // logo_id chỉ nhận 12 ký tự hex
  assert.equal(s.logoPosition, 'bl')
  assert.equal(s.logoSize, 0.05)
  assert.equal(s.joinClips, false)
  assert.equal(normalizeFinishSettings({ logoId: 'abcdef123456' }).logoId, 'abcdef123456')
  // node cũ chưa có cấu hình -> null (UI lấy mặc định đã lưu)
  assert.equal(normalizeVideoOutputData({ paths }).finish, null)
  assert.equal(normalizeVideoOutputData({ paths, final: { bad: 1 } }).final, null)
})

test('hoàn thiện video: chỉ bản chính hoặc ghép cả clip; request đúng trường backend', () => {
  assert.deepEqual(finishClips(paths, DEFAULT_FINISH_SETTINGS), ['D:/v_02.mp4'])
  assert.deepEqual(finishClips(paths, { ...DEFAULT_FINISH_SETTINGS, joinClips: true }), paths)
  assert.deepEqual(finishClips(['D:/one.mp4'], { ...DEFAULT_FINISH_SETTINGS, joinClips: true }), ['D:/one.mp4'])
  const s = { ...DEFAULT_FINISH_SETTINGS, muteOriginal: true, bgmTrackIds: ['t1'], bgmVolume: 0.4, labelText: ' @kenh ', logoId: 'abcdef123456' }
  assert.deepEqual(buildFinishRequest(paths, s, '  3 bộ xanh '), {
    video_paths: ['D:/v_02.mp4'],
    title: '3 bộ xanh',
    mute_original: true,
    original_volume: 1,
    bgm_track_ids: ['t1'],
    bgm_volume: 0.4,
    label_text: '@kenh',
    label_position: 'br',
    label_size: 'm',
    logo_id: 'abcdef123456',
    logo_position: 'tr',
    logo_size: 0.16,
  })
  assert.equal(buildFinishRequest(paths, DEFAULT_FINISH_SETTINGS).logo_id, null)
  assert.throws(() => buildFinishRequest([], DEFAULT_FINISH_SETTINGS), /chưa có video/)
  assert.equal(
    finishSummary(s, (id) => (id === 't1' ? 'Lofi' : id)),
    'tắt tiếng gốc · nhạc: Lofi (40%) · nhãn @kenh · logo kênh',
  )
  assert.equal(finishSummary(DEFAULT_FINISH_SETTINGS), 'giữ tiếng gốc')
})

test('hoàn thiện video: bản xuất thành "cũ" khi đổi cấu hình có ảnh hưởng, không đổi khi chỉnh thứ bị tắt', () => {
  const s = { ...DEFAULT_FINISH_SETTINGS, labelText: '@kenh' }
  assert.equal(finishState([], s, null), 'no_video')
  assert.equal(finishState(paths, s, null), 'pending')
  const done = { inputPath: finishFingerprint(paths, s), status: 'done' as const, filename: 'muse_final_1.mp4', updatedAt: 1 }
  assert.equal(finishState(paths, s, done), 'done')
  assert.equal(finishState(paths, { ...s, labelPosition: 'tl' }, done), 'stale')
  assert.equal(finishState(paths, { ...s, muteOriginal: true }, done), 'stale')
  // âm lượng nhạc không tính khi chưa chọn nhạc; vị trí logo không tính khi không có logo
  assert.equal(finishState(paths, { ...s, bgmVolume: 0.9, logoPosition: 'bl' }, done), 'done')
  assert.equal(finishState(paths, s, { ...done, status: 'running' }), 'running')
  const intr = interruptFinal({ ...done, status: 'running' }, 5)
  assert.equal(intr?.status, 'interrupted')
  assert.match(intr!.error!, /không tốn lượt Muse/)
  assert.equal(interruptFinal(done), null)
})
