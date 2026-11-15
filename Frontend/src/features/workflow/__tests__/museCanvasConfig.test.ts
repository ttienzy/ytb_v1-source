import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_MUSE_CANVAS_CONFIG,
  buildMuseInstruction,
  museCanvasConfigToApi,
  museConfigWarnings,
  museGenerateOptions,
  normalizeMuseCanvasConfig,
} from '../services/museCanvasConfig.ts'

test('muse canvas: chuẩn hóa nhận cả snake_case (backend) lẫn camelCase, ép giá trị hợp lệ', () => {
  const c = normalizeMuseCanvasConfig({
    account_mode: 'fixed',
    account_id: 'abc',
    chat_mode: 'continue',
    duration_seconds: 7,
    aspect_ratio: '4:3',
    timeout_seconds: 60,
    max_parallel: 99,
    style_preset: 'khong-co',
    file_prefix: 'a b/c',
  })
  assert.equal(c.accountMode, 'fixed')
  assert.equal(c.accountId, 'abc')
  assert.equal(c.chatMode, 'continue')
  assert.equal(c.durationSeconds, 5)
  assert.equal(c.aspectRatio, '9:16')
  assert.equal(c.timeoutSeconds, 600)
  assert.equal(c.maxParallel, 4)
  assert.equal(c.stylePreset, 'none')
  assert.equal(c.filePrefix, 'a_b_c')
  assert.deepEqual(normalizeMuseCanvasConfig(null), DEFAULT_MUSE_CANVAS_CONFIG)
  assert.deepEqual(normalizeMuseCanvasConfig(museCanvasConfigToApi(c)), { ...c })
})

test('muse canvas: chỉ dẫn video ghi rõ thời lượng, tỉ lệ, phong cách, âm thanh, điều cần tránh', () => {
  const c = {
    ...DEFAULT_MUSE_CANVAS_CONFIG,
    durationSeconds: 10,
    aspectRatio: '16:9' as const,
    stylePreset: 'cinematic',
    audioMode: 'voiceover' as const,
    language: 'en' as const,
    promptPrefix: 'Brand X.',
    avoid: 'logos, text artifacts',
  }
  const s = buildMuseInstruction(c, '  a cat jumps onto a sofa ')
  assert.match(s, /^Create a 10-second horizontal 16:9 video: Brand X\. a cat jumps onto a sofa$/m)
  assert.match(s, /Style: cinematic look/)
  assert.match(s, /natural voiceover in English/)
  assert.match(s, /Avoid: logos, text artifacts\./)
  assert.match(s, /do not ask follow-up questions/)
})

test('muse canvas: chỉ dẫn ảnh không nhắc thời lượng / âm thanh; tiếng Việt yêu cầu chữ tiếng Việt', () => {
  const s = buildMuseInstruction({ ...DEFAULT_MUSE_CANVAS_CONFIG, outputKind: 'image', aspectRatio: '1:1', audioMode: 'silent' }, 'hoa sen')
  assert.match(s, /^Create a square 1:1 image: hoa sen$/m)
  assert.doesNotMatch(s, /second|Audio/)
  assert.match(s, /Vietnamese/)
})

test('muse canvas: tham số gọi generate theo chế độ chat và tài khoản', () => {
  assert.deepEqual(museGenerateOptions(DEFAULT_MUSE_CANVAS_CONFIG), {
    use_side_chat: true,
    continuation: false,
    timeout_seconds: 600,
  })
  const o = museGenerateOptions({ ...DEFAULT_MUSE_CANVAS_CONFIG, accountMode: 'fixed', accountId: 'x', chatMode: 'continue' })
  assert.deepEqual(o, { account_id: 'x', use_side_chat: false, continuation: true, timeout_seconds: 600 })
  assert.equal(museGenerateOptions({ ...DEFAULT_MUSE_CANVAS_CONFIG, chatMode: 'main' }).use_side_chat, false)
})

test('muse canvas: cảnh báo cấu hình', () => {
  assert.match(museConfigWarnings(DEFAULT_MUSE_CANVAS_CONFIG, []).join(' '), /Chưa có tài khoản Muse/)
  const accounts = [
    { id: 'a', label: 'A', status: 'active' },
    { id: 'b', label: 'B', status: 'error' },
  ]
  assert.deepEqual(museConfigWarnings(DEFAULT_MUSE_CANVAS_CONFIG, accounts), [])
  assert.match(
    museConfigWarnings({ ...DEFAULT_MUSE_CANVAS_CONFIG, accountMode: 'fixed', accountId: 'b' }, accounts).join(' '),
    /hết phiên/,
  )
  assert.match(museConfigWarnings({ ...DEFAULT_MUSE_CANVAS_CONFIG, maxParallel: 3 }, accounts).join(' '), /chỉ có 1 tài khoản/)
  assert.match(
    museConfigWarnings({ ...DEFAULT_MUSE_CANVAS_CONFIG, chatMode: 'continue', maxParallel: 2 }, [...accounts, { id: 'c', label: 'C', status: 'active' }]).join(' '),
    /tuần tự/,
  )
})
