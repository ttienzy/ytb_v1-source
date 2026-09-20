import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildStructuredPrompt,
  DEFAULT_MOTION_CREATIVE_DIRECTION,
  DEFAULT_MOTION_PROMPT,
} from '../services/motionPromptBuilder.ts'

test('builds one prompt from explicit direction fields', () => {
  const result = buildStructuredPrompt({
    creativeBrief: 'A woman performs an upbeat dance in a bedroom.',
    subjectAction: 'Keep the hand choreography smooth and rhythmic.',
    cameraMovement: '',
    sceneAtmosphere: '',
    styleDirection: 'Photorealistic vertical smartphone video.',
    negativePrompt: 'No text or glitches.',
  })

  assert.match(result.fullPrompt, /A woman performs/)
  assert.match(result.fullPrompt, /Keep the hand choreography/)
  assert.match(result.fullPrompt, /Photorealistic/)
  assert.match(result.fullPrompt, /Avoid: No text or glitches/)
  assert.doesNotMatch(result.fullPrompt, /undefined/)
})

test('does not invent text from reference assets', () => {
  const result = buildStructuredPrompt({
    creativeBrief: '',
    subjectAction: '',
    cameraMovement: '',
    sceneAtmosphere: '',
    styleDirection: '',
    negativePrompt: '',
  })
  assert.deepEqual(result.sections, [])
  assert.equal(result.fullPrompt, '')
})

test('default motion creative direction generates a complete and safe prompt without double dots or forbidden tokens', () => {
  const result = buildStructuredPrompt(DEFAULT_MOTION_CREATIVE_DIRECTION)

  assert.equal(result.hasRequiredFields, true)
  assert.ok(result.fullPrompt.length > 50)
  assert.match(result.fullPrompt, /choreography/)
  assert.match(result.fullPrompt, /Natural biomechanics/)
  // Must never have duplicate periods
  assert.doesNotMatch(result.fullPrompt, /\.\./)
  // Must never have the forbidden trigger phrase
  assert.doesNotMatch(result.fullPrompt.toLowerCase(), /anatomically correct/)
  assert.doesNotMatch(DEFAULT_MOTION_PROMPT.toLowerCase(), /anatomically correct/)
})
