import { test } from 'node:test'
import assert from 'node:assert/strict'

import { GEMINI_STATUS_MAP, geminiTemplateTitle } from '../components/geminiAccounts.ts'

test('mọi trạng thái tài khoản backend trả về đều có nhãn tiếng Việt (giống tài khoản ChatGPT)', () => {
  for (const status of ['active', 'exhausted', 'error']) {
    assert.ok(GEMINI_STATUS_MAP[status]?.label, status)
  }
  assert.equal(GEMINI_STATUS_MAP.active.label, 'Sẵn sàng')
  assert.match(GEMINI_STATUS_MAP.error.label, /đăng nhập lại/)
})

test('chú thích nút template: bản đóng gói vs bản bắt trên máy', () => {
  assert.match(geminiTemplateTitle({ template_source: 'bundled' }), /đóng gói theo app/)
  assert.match(geminiTemplateTitle({}), /đóng gói theo app/)
  assert.match(geminiTemplateTitle({ template_source: 'captured', template_saved_at: '2026-11-24T10:00:00Z' }), /bắt trên máy này lúc/)
})
