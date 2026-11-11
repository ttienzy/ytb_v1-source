import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildStructuredPrompt,
  DEFAULT_MOTION_CREATIVE_DIRECTION,
  DEFAULT_MOTION_PROMPT,
  LEGACY_DEFAULT_BRIEFS,
  migrateLegacyCreative,
  referenceOpening,
} from '../services/motionPromptBuilder.ts'

const empty = { creativeBrief: '', subjectAction: '', cameraMovement: '', sceneAtmosphere: '', styleDirection: '', negativePrompt: '' }

test('builds one prompt from explicit direction fields, negatives become a plain instruction (no "Avoid:")', () => {
  const result = buildStructuredPrompt({
    creativeBrief: 'A woman performs an upbeat dance in a bedroom.',
    subjectAction: 'Keep the hand choreography smooth and rhythmic',
    styleDirection: 'Photorealistic vertical smartphone video.',
    negativePrompt: 'No text or glitches.',
    cameraMovement: '', sceneAtmosphere: '',
  })
  assert.match(result.fullPrompt, /A woman performs/)
  assert.match(result.fullPrompt, /rhythmic\. Photorealistic/)
  assert.match(result.fullPrompt, /Do not add text or glitches\.$/)
  assert.doesNotMatch(result.fullPrompt, /Avoid:|undefined|\.\./)
})

test('does not invent text from reference assets when every field is empty', () => {
  const result = buildStructuredPrompt(empty, { character: true, scene: true })
  assert.deepEqual(result.sections, [])
  assert.equal(result.fullPrompt, '')
})

test('the opening names only the images that are really attached, in upload order', () => {
  const both = buildStructuredPrompt(DEFAULT_MOTION_CREATIVE_DIRECTION, { character: true, scene: true }).fullPrompt
  assert.match(both, /^Apply the pose and motion from the input video to the person in Image 1, placed in the setting shown in Image 2\./)
  assert.match(both, /Keep the face, hairstyle and outfit from Image 1 unchanged\./)
  const charOnly = buildStructuredPrompt(DEFAULT_MOTION_CREATIVE_DIRECTION, { character: true }).fullPrompt
  assert.match(charOnly, /to the person in the image\./)
  assert.doesNotMatch(charOnly, /Image 2|setting shown/)
  const none = buildStructuredPrompt(DEFAULT_MOTION_CREATIVE_DIRECTION, {}).fullPrompt
  assert.doesNotMatch(none, /\bimage\b/i)   // không ảnh nào thì prompt không nhắc tới ảnh
  assert.match(referenceOpening({ scene: true }), /setting shown in the image/)
})

test('a brief that already talks about the images is not given a second opening', () => {
  const legacy = buildStructuredPrompt({ ...empty, creativeBrief: LEGACY_DEFAULT_BRIEFS[0] }, { character: true })
  assert.equal(legacy.fullPrompt.match(/Apply the pose and motion/g), null)
  assert.equal(legacy.sections.some(s => s.id === 'roles'), false)
})

test('default direction is short, Omni-style and safe', () => {
  const result = buildStructuredPrompt(DEFAULT_MOTION_CREATIVE_DIRECTION, { character: true })
  assert.equal(result.hasRequiredFields, true)
  assert.match(result.fullPrompt, /timing and rhythm of the input video/)
  assert.match(result.fullPrompt, /Keep the camera path and framing of the input video/)
  assert.doesNotMatch(result.fullPrompt, /\.\.|anatomically correct|cinematic lighting/)
  assert.ok(result.fullPrompt.length < 520, String(result.fullPrompt.length))
  assert.equal(DEFAULT_MOTION_PROMPT, DEFAULT_MOTION_CREATIVE_DIRECTION.creativeBrief)
})

test('saved drafts that still hold the old Omni 1.1 defaults are upgraded; edited drafts are kept', () => {
  const old = migrateLegacyCreative({
    creativeBrief: LEGACY_DEFAULT_BRIEFS[1],
    subjectAction: 'Transfer the choreography, poses, gestures, rhythm, camera angle, framing, and composition seamlessly from the motion video.',
    sceneAtmosphere: 'Natural biomechanics, fluid body movement, photorealistic cinematic lighting.',
    negativePrompt: 'blurry',
  })
  assert.equal(old.creativeBrief, DEFAULT_MOTION_PROMPT)
  assert.equal(old.subjectAction, '')
  assert.equal(old.sceneAtmosphere, '')
  assert.equal(old.negativePrompt, 'blurry')
  const mine = migrateLegacyCreative({ creativeBrief: 'My own brief', sceneAtmosphere: 'Neon street' })
  assert.equal(mine.creativeBrief, 'My own brief')
  assert.equal(mine.sceneAtmosphere, 'Neon street')
})
