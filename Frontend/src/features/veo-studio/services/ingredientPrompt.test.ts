import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ingredientPrompt } from './ingredientPrompt.ts'
test('placeholder references follow uploaded order, including empty slots', () => {
  assert.equal(ingredientPrompt('[Bối cảnh], [Phong cách]', { subject: false, scene: true, style: true }),
    'ảnh tham chiếu 1 (bối cảnh), ảnh tham chiếu 2 (phong cách)')
})
test('missing referenced image stops submission', () => {
  assert.throws(() => ingredientPrompt('[Chủ thể]', { subject: false, scene: true, style: false }), /đang trống/)
})
test('plain prompts are preserved', () => {
  assert.equal(ingredientPrompt('Slow camera orbit', { subject: true, scene: true, style: true }), 'Slow camera orbit')
})
