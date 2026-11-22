import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildStructuredPrompt,
  changeBlock,
  DEFAULT_MOTION_CREATIVE_DIRECTION,
  effectiveMotionOptions,
  keepBlock,
  LEGACY_DEFAULT_BRIEFS,
  migrateLegacyCreative,
  motionEditMode,
  motionPromptSignature,
  V1_DEFAULT_BRIEF,
} from '../services/motionPromptBuilder.ts'

const D = DEFAULT_MOTION_CREATIVE_DIRECTION
const count = (text: string, re: RegExp) => (text.match(re) || []).length

test('kiểu chỉnh suy ra từ ảnh; chỉ ảnh nhân vật thì mặc định GIỮ NỀN VIDEO (thay người)', () => {
  assert.equal(motionEditMode({}), 'describe')
  assert.equal(motionEditMode({ character: true }), 'replace_person')
  assert.equal(motionEditMode({ character: true }, 'character_image'), 'animate_image')
  assert.equal(motionEditMode({ characterCount: 2 }, 'character_image'), 'replace_person') // nhiều người: luôn giữ nền video
  assert.equal(motionEditMode({ scene: true }), 'replace_scene')
  assert.equal(motionEditMode({ character: true, scene: true }, 'character_image'), 'replace_both')
})

test('thay người: nói rõ bỏ người gốc + giữ nền/ánh sáng/máy quay của video, mỗi ý một lần', () => {
  const p = buildStructuredPrompt(D, { character: true }).fullPrompt
  assert.match(p, /^Replace the person in the input video with the person in Image 1 \(character reference\), performing the same pose, motion and timing\./)
  assert.match(p, /Use the face, hairstyle, body shape and outfit from Image 1; do not keep the original person's face or clothes\./)
  assert.match(p, /Keep everything else the same as the input video: background, lighting, camera path and framing\.$/)
  assert.equal(count(p, /timing/g), 1)
  assert.equal(count(p, /camera path/g), 1)
  assert.ok(p.length < 420, String(p.length))
})

test('nền theo ảnh nhân vật: đúng mẫu "Apply the pose and motion … to the person in Image 1" của Google', () => {
  const p = buildStructuredPrompt({ ...D, backgroundFrom: 'character_image' }, { character: true }).fullPrompt
  assert.match(p, /^Apply the pose and motion from the input video to the person in Image 1 \(character reference\), in the setting shown in Image 1\./)
  assert.doesNotMatch(p, /background, lighting/)
})

test('thay bối cảnh: khớp ánh sáng + bóng đổ bật sẵn, giữ người và máy quay', () => {
  const p = buildStructuredPrompt(D, { scene: true }).fullPrompt
  assert.match(p, /setting shown in Image 1 \(setting reference\).*do not keep the original background\./)
  assert.match(p, /natural contact shadows/)
  assert.match(p, /Keep the people's faces, hair and outfits, and the camera path and framing, the same as the input video\.$/)
})

test('thay người + bối cảnh: Image 1 người, Image 2 nền, có cảnh báo đổi 2 thứ', () => {
  const r = buildStructuredPrompt(D, { character: true, scene: true })
  assert.match(r.fullPrompt, /person in Image 1 \(character reference\)/)
  assert.match(r.fullPrompt, /setting shown in Image 2 \(setting reference\)/)
  assert.equal(r.mode, 'replace_both')
  assert.equal(r.warnings.length, 1)
})

test('không ảnh: bắt buộc mô tả thay đổi; có mô tả thì "Keep everything else the same"', () => {
  const empty = buildStructuredPrompt(D, {})
  assert.equal(empty.hasRequiredFields, false)
  assert.equal(empty.blockers.length, 1)
  const ok = buildStructuredPrompt({ ...D, creativeBrief: 'Turn it into a snowy winter evening' }, {})
  assert.equal(ok.hasRequiredFields, true)
  assert.equal(ok.fullPrompt, 'Turn it into a snowy winter evening. Keep everything else the same as the input video, including the motion and timing.')
})

test('người dùng tự chỉ đạo camera thì khối Giữ nguyên không còn "camera path"', () => {
  const p = buildStructuredPrompt({ ...D, cameraMovement: 'Slow push-in on the face' }, { character: true }).fullPrompt
  assert.match(p, /Slow push-in on the face\./)
  assert.doesNotMatch(p, /camera path/)
  assert.equal(keepBlock('replace_both', true), '')
})

test('chip tùy chọn: mặc định theo kiểu chỉnh, người dùng ghi đè được; câu negative không dùng "Avoid:"', () => {
  assert.equal(effectiveMotionOptions('replace_person').keepBodyShape, true)
  assert.equal(effectiveMotionOptions('replace_scene').matchLighting, true)
  assert.equal(effectiveMotionOptions('replace_person', { keepBodyShape: false }).keepBodyShape, false)
  const p = buildStructuredPrompt({ ...D, negativePrompt: 'Avoid: blurry hands.', options: { hairFabric: true, photoreal: true, keepBodyShape: false } },
    { character: true }).fullPrompt
  assert.match(p, /Use the face, hairstyle and outfit from Image 1/)
  assert.match(p, /Hair and clothing move naturally with each motion\. Photorealistic footage\. Do not add blurry hands\./)
  assert.doesNotMatch(p, /Avoid:|undefined|\.\./)
})

test('ghi chú nhân vật thay cho "the person" / thứ tự trái → phải', () => {
  const one = changeBlock({ character: true, characterTargets: ['the woman in the red dress'] })
  assert.match(one, /^Replace the woman in the red dress in the input video with the person in Image 1/)
  const two = changeBlock({ characterCount: 2, characterTargets: [undefined, 'the man on the bike.'] })
  assert.match(two, /the leftmost person becomes the person in Image 1, the man on the bike becomes the person in Image 2/)
})

test('khối tự sinh được đánh dấu auto; sections đúng thứ tự Thay đổi → … → Giữ nguyên', () => {
  const r = buildStructuredPrompt({ ...D, creativeBrief: 'Energetic and joyful' }, { character: true })
  assert.deepEqual(r.sections.map((s) => s.id), ['roles', 'brief', 'keep'])
  assert.deepEqual(r.sections.map((s) => Boolean(s.auto)), [true, false, true])
})

test('chữ ký bộ ảnh đổi khi thêm/bỏ ảnh hoặc đổi nguồn nền (để cảnh báo prompt sửa tay)', () => {
  const a = motionPromptSignature({ character: true })
  assert.notEqual(a, motionPromptSignature({ character: true, scene: true }))
  assert.notEqual(a, motionPromptSignature({ characterCount: 2 }))
  assert.notEqual(a, motionPromptSignature({ character: true }, 'character_image'))
  assert.equal(a, motionPromptSignature({ character: true, characterTargets: ['x'] }))
})

test('bản nháp còn mặc định cũ (Omni 1.1 / v1) được dọn; phần tự viết giữ nguyên', () => {
  const old = migrateLegacyCreative({
    creativeBrief: LEGACY_DEFAULT_BRIEFS[1],
    subjectAction: 'Transfer the choreography, poses, gestures, rhythm, camera angle, framing, and composition seamlessly from the motion video.',
    cameraMovement: 'Keep the camera path and framing of the input video.',
    styleDirection: 'Photorealistic, with lighting that matches the scene.',
    negativePrompt: 'blurry',
  })
  assert.equal(old.creativeBrief, '')
  assert.equal(old.subjectAction, '')
  assert.equal(old.cameraMovement, '')
  assert.equal(old.styleDirection, '')
  assert.equal(old.negativePrompt, 'blurry')
  assert.equal(old.backgroundFrom, 'video')
  assert.equal(migrateLegacyCreative({ creativeBrief: V1_DEFAULT_BRIEF }).creativeBrief, '')
  const mine = migrateLegacyCreative({ creativeBrief: 'My own brief', sceneAtmosphere: 'Neon street', backgroundFrom: 'character_image' })
  assert.equal(mine.creativeBrief, 'My own brief')
  assert.equal(mine.sceneAtmosphere, 'Neon street')
  assert.equal(mine.backgroundFrom, 'character_image')
})
