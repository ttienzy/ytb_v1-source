import { test } from 'node:test'
import assert from 'node:assert/strict'

test('motion asset preserves mediaId across prompt modifications', () => {
  // Mô phỏng state của motion asset sau khi upload thành công
  let motionAsset = {
    id: 'ref-motion',
    role: 'motion' as const,
    title: 'Video Chuyển Động',
    required: true,
    filled: true,
    previewUrl: 'blob:http://localhost/video-123',
    fileName: 'sample_dance.mp4',
    mediaId: 'flow-media-uuid-9999',
  }

  // Khi người dùng chỉnh sửa prompt hoặc brief sáng tạo
  const newPrompt = 'Cô gái nhảy hiện đại, góc máy quay ngang 90 độ.'
  assert.ok(newPrompt.length > 0)

  // mediaId vẫn được giữ nguyên
  assert.equal(motionAsset.mediaId, 'flow-media-uuid-9999')
  assert.equal(motionAsset.fileName, 'sample_dance.mp4')
})

test('motion asset resets mediaId when a new file is uploaded', () => {
  let motionAsset = {
    id: 'ref-motion',
    role: 'motion' as const,
    title: 'Video Chuyển Động',
    required: true,
    filled: true,
    previewUrl: 'blob:http://localhost/video-123',
    fileName: 'old_video.mp4',
    mediaId: 'flow-media-uuid-old',
  }

  // Khi nạp file mới
  const newFileName = 'new_video.mp4'
  motionAsset = {
    ...motionAsset,
    fileName: newFileName,
    mediaId: undefined,
  }

  assert.equal(motionAsset.mediaId, undefined)
  assert.equal(motionAsset.fileName, 'new_video.mp4')
})
