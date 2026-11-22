import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  buildStructuredPrompt,
  DEFAULT_MOTION_CREATIVE_DIRECTION,
  referenceOpening,
} from '../services/motionPromptBuilder.ts'
import {
  canAddMotionCharacter,
  canAddMotionScene,
  extraCharacterIndex,
  filledCharacterCount,
  isCharacterRole,
  MAX_MOTION_REFERENCE_IMAGES,
  newExtraCharacterId,
  orderedMotionImages,
} from '../services/motionReferences.ts'

test('Motion nhận tối đa 3 ảnh: thêm nhân vật/bối cảnh theo số ô còn lại', () => {
  assert.equal(MAX_MOTION_REFERENCE_IMAGES, 3)
  assert.equal(canAddMotionCharacter(0, false), true)  // 1 ô → thêm ô 2
  assert.equal(canAddMotionCharacter(1, false), true)  // 2 ô → thêm ô 3
  assert.equal(canAddMotionCharacter(2, false), false) // 3 nhân vật
  assert.equal(canAddMotionCharacter(1, true), false)  // 2 nhân vật + bối cảnh
  assert.equal(canAddMotionScene(1), true)
  assert.equal(canAddMotionScene(2), false)
})

test('vai trò ô nhân vật thêm', () => {
  assert.equal(extraCharacterIndex('character2'), 0)
  assert.equal(extraCharacterIndex('character3'), 1)
  assert.equal(extraCharacterIndex('character'), -1)
  assert.equal(isCharacterRole('character3'), true)
  assert.equal(isCharacterRole('scene'), false)
  assert.notEqual(newExtraCharacterId(), newExtraCharacterId())
})

test('ảnh gửi đi theo thứ tự nhân vật 1 → 3 rồi bối cảnh, bỏ ô trống', () => {
  const a = (id: string, filled: boolean) => ({ id, filled })
  const order = orderedMotionImages(a('c1', true), [a('c2', false), a('c3', true)], a('scene', true)).map((x) => x.id)
  assert.deepEqual(order, ['c1', 'c3', 'scene'])
  assert.equal(filledCharacterCount(a('c1', true), [a('c2', false), a('c3', true)]), 2)
})

test('prompt 2 nhân vật + bối cảnh: Image 1, 2 là người, Image 3 là bối cảnh, ghép trái → phải', () => {
  const opening = referenceOpening({ character: true, characterCount: 2, scene: true })
  assert.match(opening, /with the 2 people in Image 1 and Image 2 \(character references\), one person per image/)
  assert.match(opening, /the leftmost person becomes the person in Image 1/)
  assert.match(opening, /the second person from the left becomes the person in Image 2/)
  assert.match(opening, /setting shown in Image 3 \(setting reference\)/)
  assert.match(opening, /exactly these 2 people\./)
  assert.doesNotMatch(opening, /Image 4/)
})

test('prompt 3 nhân vật không bối cảnh', () => {
  const opening = referenceOpening({ character: true, characterCount: 3 })
  assert.match(opening, /Image 1, Image 2 and Image 3/)
  assert.match(opening, /the third person from the left becomes the person in Image 3/)
  assert.doesNotMatch(opening, /setting/)
})

test('nhân vật 1 là sheet + nhân vật 2: nói rõ Image 1 là sheet của một người', () => {
  const opening = referenceOpening({ character: true, characterCount: 2, characterSheet: true })
  assert.match(opening, /Image 1 is a character sheet of one person/)
  assert.match(opening, /exactly these 2 people/)
})

test('characterCount 1 = character true (không hồi quy)', () => {
  assert.equal(
    referenceOpening({ character: true, characterCount: 1, scene: true }),
    referenceOpening({ character: true, scene: true }),
  )
  const full = buildStructuredPrompt(DEFAULT_MOTION_CREATIVE_DIRECTION, { character: true, characterCount: 2 }).fullPrompt
  assert.ok(full.startsWith('Replace the people in the input video with the 2 people'))
})
