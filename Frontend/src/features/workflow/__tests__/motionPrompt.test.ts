import assert from 'node:assert/strict'
import test from 'node:test'
import { buildStructuredPrompt } from '../services/motionPromptBuilder.ts'

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
