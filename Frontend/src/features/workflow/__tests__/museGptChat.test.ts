import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  collectCanvasImages,
  formatPoolBadge,
  promptBoxLabelFromReply,
  trimChatHistory,
} from '../services/museGptChat.ts'
import { MUSE_NODE } from '../services/museCanvasNodes.ts'

test('collectCanvasImages gom ảnh từ các node ảnh trên canvas và khử trùng đường dẫn', () => {
  const imgA = { id: '1', name: 'ao.png', path: 'C:/img/ao.png', previewUrl: '/api/ai/muse/preview?file=ao.png', size: 10 }
  const imgB = { id: '2', name: 'linh.png', path: 'C:/img/linh.png', previewUrl: '/api/ai/muse/preview?file=linh.png', size: 10 }
  const nodes = [
    { id: 'n1', type: MUSE_NODE.outfit, position: { x: 0, y: 0 }, data: { label: 'Áo trắng', image: imgA } },
    { id: 'n2', type: MUSE_NODE.output, position: { x: 0, y: 0 }, data: { label: '', image: imgA } }, // trùng path
    { id: 'n3', type: MUSE_NODE.character, position: { x: 0, y: 0 }, data: { label: 'Linh', image: imgB } },
    { id: 'n4', type: MUSE_NODE.promptBox, position: { x: 0, y: 0 }, data: { text: 'abc' } },
  ]
  const res = collectCanvasImages(nodes)
  assert.equal(res.length, 2)
  assert.deepEqual(res.map((x) => x.label), ['Áo trắng', 'Linh'])
  assert.equal(res[0].sourceNodeId, 'n1')
})

test('trimChatHistory giữ cửa sổ lượt gần nhất và giới hạn ký tự', () => {
  const msgs = [
    { role: 'user' as const, content: 'Lượt 1 ' + 'x'.repeat(60) },
    { role: 'assistant' as const, content: 'Đáp 1 ' + 'y'.repeat(60) },
    { role: 'user' as const, content: 'Lượt 2' },
    { role: 'assistant' as const, content: 'Đáp 2' },
  ]
  const byTurns = trimChatHistory(msgs, 2, 1000)
  assert.deepEqual(byTurns.map((m) => m.content), ['Lượt 2', 'Đáp 2'])

  const byChars = trimChatHistory(msgs, 10, 40)
  assert.deepEqual(byChars.map((m) => m.content), ['Lượt 2', 'Đáp 2'])
})

test('formatPoolBadge phản ánh đúng rảnh / bận / cooldown / chưa có acc', () => {
  assert.deepEqual(formatPoolBadge(null), { text: 'GPT', tone: 'ok' })
  assert.deepEqual(formatPoolBadge({ total: 0, free: 0, busy: 0, cooldown: 0, retry_after_seconds: 0, accounts: [] }), {
    text: 'Chưa có acc GPT', tone: 'empty',
  })
  assert.deepEqual(formatPoolBadge({ total: 3, free: 2, busy: 1, cooldown: 0, retry_after_seconds: 0, accounts: [] }), {
    text: 'GPT · 2/3 rảnh', tone: 'ok',
  })
  assert.deepEqual(formatPoolBadge({ total: 1, free: 0, busy: 1, cooldown: 0, retry_after_seconds: 0, accounts: [] }), {
    text: 'GPT · 0/1 rảnh (1 đang bận)', tone: 'busy',
  })
  assert.deepEqual(formatPoolBadge({ total: 2, free: 0, busy: 0, cooldown: 2, retry_after_seconds: 125, accounts: [] }), {
    text: 'GPT · tạm giới hạn (~3p)', tone: 'warn',
  })
})

test('promptBoxLabelFromReply tách tiêu đề sạch cho Ô prompt', () => {
  assert.equal(promptBoxLabelFromReply('## **Kịch bản cảnh 1**\nNội dung chi tiết'), 'Kịch bản cảnh 1')
  assert.equal(promptBoxLabelFromReply('   \n  '), 'Kịch bản GPT')
  assert.ok(promptBoxLabelFromReply('a'.repeat(80)).endsWith('…'))
})
