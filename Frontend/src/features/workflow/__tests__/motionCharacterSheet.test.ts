import assert from 'node:assert/strict'
import test from 'node:test'
import {
  EMPTY_CHARACTER_SHEET,
  characterSheetFileError,
  characterSheetMissing,
  isSheetApplied,
  withSource,
} from '../services/motionCharacterSheet.ts'
import { buildStructuredPrompt, DEFAULT_MOTION_CREATIVE_DIRECTION, referenceOpening } from '../services/motionPromptBuilder.ts'

const file = { name: 'me.jpg' } as unknown as File

test('cần cả ảnh nhân vật và ảnh trang phục (file chưa tải hoặc đường dẫn đã tải đều được)', () => {
  assert.equal(characterSheetMissing(EMPTY_CHARACTER_SHEET).length, 2)
  const onlyFace = withSource(EMPTY_CHARACTER_SHEET, 'identity', { fileName: 'me.jpg', previewUrl: null, file })
  assert.deepEqual(characterSheetMissing(onlyFace), ['Thiếu ảnh trang phục muốn mặc'])
  const both = withSource(onlyFace, 'outfit', { fileName: 'ao.png', previewUrl: null, backendPath: 'C:/x/ao.png' })
  assert.deepEqual(characterSheetMissing(both), [])
  assert.equal(characterSheetMissing(withSource(both, 'outfit', { fileName: 'x', previewUrl: 'blob:1' })).length, 1)
})

test('chỉ nhận PNG/JPG/WebP tối đa 10 MB', () => {
  assert.equal(characterSheetFileError({ name: 'a.png', type: 'image/png', size: 1000 }), null)
  assert.equal(characterSheetFileError({ name: 'a.webp', type: '', size: 1000 }), null)
  assert.match(characterSheetFileError({ name: 'a.gif', type: 'image/gif', size: 1000 })!, /PNG, JPG hoặc WebP/)
  assert.match(characterSheetFileError({ name: 'a.mp4', type: 'video/mp4', size: 1000 })!, /PNG, JPG hoặc WebP/)
  assert.match(characterSheetFileError({ name: 'a.jpg', type: 'image/jpeg', size: 11 * 1024 * 1024 })!, /10 MB/)
})

test('đổi ảnh nguồn xóa lỗi cũ nhưng giữ ảnh kết quả đã tạo; đang chạy thì vẫn là đang chạy', () => {
  const result = { previewUrl: 'http://x/a', backendPath: 'C:/a.png', fileName: 'a.png', prompt: 'p', seconds: 50 }
  const failed = { ...EMPTY_CHARACTER_SHEET, status: 'error' as const, error: 'lỗi', result }
  const next = withSource(failed, 'outfit', { fileName: 'b.png', previewUrl: null, file })
  assert.equal(next.error, null)
  assert.equal(next.status, 'done')
  assert.equal(next.result, result)
  assert.equal(withSource({ ...EMPTY_CHARACTER_SHEET, status: 'running' }, 'identity', null).status, 'running')
  assert.equal(withSource({ ...EMPTY_CHARACTER_SHEET, status: 'error', error: 'x' }, 'identity', null).status, 'idle')
})

test('"đã dùng" chỉ khi ô Nhân Vật đang giữ đúng file kết quả dạng sheet', () => {
  const result = { backendPath: 'C:/a.png' }
  assert.equal(isSheetApplied(result, { filled: true, source: 'character_sheet', backendPath: 'C:/a.png' }), true)
  assert.equal(isSheetApplied(result, { filled: true, source: 'character_sheet', backendPath: 'C:/b.png' }), false)
  assert.equal(isSheetApplied(result, { filled: true, backendPath: 'C:/a.png' }), false)
  assert.equal(isSheetApplied(result, { filled: false, source: 'character_sheet', backendPath: 'C:/a.png' }), false)
  assert.equal(isSheetApplied(null, { filled: true, source: 'character_sheet', backendPath: 'C:/a.png' }), false)
})

test('ảnh nhân vật dạng sheet: prompt Motion nói rõ chỉ một người, mặt từ chân dung, áo từ các góc', () => {
  const sheetOnly = buildStructuredPrompt(DEFAULT_MOTION_CREATIVE_DIRECTION, { character: true, characterSheet: true }).fullPrompt
  assert.match(sheetOnly, /^Apply the pose and motion from the input video to the one person shown in the character sheet image/)
  assert.match(sheetOnly, /face and hairstyle from the portrait/)
  assert.match(sheetOnly, /The video shows only this one person/)
  assert.doesNotMatch(sheetOnly, /Image 2/)
  const withScene = referenceOpening({ character: true, characterSheet: true, scene: true })
  assert.match(withScene, /shown in Image 1, a character sheet/)
  assert.match(withScene, /setting shown in Image 2/)
  // Không có ảnh nhân vật thì cờ sheet bị bỏ qua.
  assert.equal(referenceOpening({ characterSheet: true, scene: true }), referenceOpening({ scene: true }))
  // Ảnh thường giữ nguyên câu cũ.
  assert.match(referenceOpening({ character: true }), /to the person in the image\./)
})
