/**
 * Motion Prompt Builder (Omni 1.2 Flash, chỉnh video theo video mẫu).
 *
 * Theo hướng dẫn của Google cho Omni: mô tả ngắn, nói rõ cái gì lấy từ video mẫu, cái gì giữ nguyên, không ra lệnh quá chi tiết.
 * Mẫu chính thức: "Apply the pose and motion from the input video to the character in this image."
 * - Câu mở đầu được dựng theo ẢNH THẬT SỰ CÓ (nhân vật / bối cảnh), không bao giờ nhắc tới ảnh chưa nối.
 * - Ảnh được gửi theo thứ tự nhân vật rồi bối cảnh, nên prompt gọi đúng "Image 1"/"Image 2".
 * - Không dùng "Avoid:" (Omni không có ô negative): điều cần tránh thành một câu lệnh rõ ràng.
 */

import type { MotionCreativeDirection } from '../types'

export interface PromptSectionItem {
  id: string
  tag: string
  label: string
  content: string
  colorVar: string
  sourceType: 'director' | 'motion' | 'camera' | 'style' | 'negative' | 'reference'
}

export interface StructuredPromptResult {
  fullPrompt: string
  sections: PromptSectionItem[]
  charCount: number
  hasRequiredFields: boolean
}

/** Ảnh tham chiếu đang nối vào Motion Control (video mẫu luôn có, là "input video"). */
export interface MotionReferenceRoles {
  character?: boolean
  scene?: boolean
}

export const DEFAULT_MOTION_PROMPT =
  'Keep the movement natural and fluid, matching the timing and rhythm of the input video.'

export const DEFAULT_MOTION_CREATIVE_DIRECTION: MotionCreativeDirection = {
  creativeBrief: DEFAULT_MOTION_PROMPT,
  subjectAction: '',
  cameraMovement: 'Keep the camera path and framing of the input video.',
  sceneAtmosphere: '',
  styleDirection: 'Photorealistic, with lighting that matches the scene.',
  negativePrompt: '',
}

/** Mặc định cũ (Omni 1.1): bản nháp còn đúng nguyên văn này được coi là "chưa sửa" và chuyển sang mặc định mới. */
export const LEGACY_DEFAULT_BRIEFS = [
  "The subject from the image reference is the sole character in the video, performing the exact choreography from the motion reference video. Preserve the subject's complete identity, facial features, hair, glasses, clothing, and distinctive details consistently throughout. Transfer the choreography, poses, gestures, rhythm, camera angle, framing, and composition seamlessly from the motion video. Natural biomechanics, fluid body movement, photorealistic cinematic lighting.",
  "The subject from the image reference is the sole character in the video, performing the exact choreography from the motion reference video. Preserve the subject's complete identity, facial features, hair, glasses, clothing, and distinctive details consistently throughout.",
]

export function isLegacyDefaultBrief(brief: string | undefined | null): boolean {
  const b = (brief || '').trim()
  return !b || LEGACY_DEFAULT_BRIEFS.includes(b)
}

/** Ô chỉ đạo đã tự nói về vai trò ảnh (prompt cũ / người dùng tự viết) thì không chèn câu mở đầu tự sinh để tránh lặp. */
const MENTIONS_ROLES = /\b(image reference|reference image|image 1|image 2|motion reference video|from (this|the) image)\b/i

/** Câu mở đầu theo ảnh thật sự có. Ảnh gửi theo thứ tự: nhân vật (Image 1) rồi bối cảnh (Image 2 hoặc Image 1 nếu không có nhân vật). */
export function referenceOpening(roles: MotionReferenceRoles = {}): string {
  const { character, scene } = roles
  if (character && scene) {
    return 'Apply the pose and motion from the input video to the person in Image 1, placed in the setting shown in Image 2. '
      + 'Keep the face, hairstyle and outfit from Image 1 unchanged.'
  }
  if (character) {
    return 'Apply the pose and motion from the input video to the person in the image. '
      + 'Keep the face, hairstyle and outfit from the image unchanged.'
  }
  if (scene) return 'Keep the people and their motion from the input video, and move them into the setting shown in the image.'
  return 'Edit the input video, keeping its motion and timing.'
}

const sentence = (text: string) => {
  const t = text.trim().replace(/\s+/g, ' ')
  if (!t) return ''
  return /[.!?]$/.test(t) ? t : `${t}.`
}

export function buildStructuredPrompt(
  creative?: Partial<MotionCreativeDirection>,
  roles?: MotionReferenceRoles,
): StructuredPromptResult {
  const c = {
    creativeBrief: (creative?.creativeBrief || '').trim(),
    subjectAction: (creative?.subjectAction || '').trim(),
    cameraMovement: (creative?.cameraMovement || '').trim(),
    sceneAtmosphere: (creative?.sceneAtmosphere || '').trim(),
    styleDirection: (creative?.styleDirection || '').trim(),
    negativePrompt: (creative?.negativePrompt || '').trim(),
  }
  const anyText = Object.values(c).some(Boolean)
  // roles === undefined: gọi kiểu cũ (không biết ảnh nào có) -> không tự sinh câu mở đầu.
  const opening = roles && anyText && !MENTIONS_ROLES.test(Object.values(c).join(' ')) ? referenceOpening(roles) : ''

  const defs: [keyof typeof c | 'opening', string, string, string, PromptSectionItem['sourceType']][] = [
    ['opening', 'Vai trò tham chiếu', 'Lấy gì từ video mẫu và ảnh', '#0EA5E9', 'reference'],
    ['creativeBrief', 'Chỉ đạo chính', 'Ý tưởng đạo diễn', 'var(--txt, #2F5BFF)', 'director'],
    ['subjectAction', 'Chuyển động', 'Hành động chủ thể', 'var(--vid, #FF7A00)', 'motion'],
    ['cameraMovement', 'Camera', 'Góc máy & chuyển động', '#8B5CF6', 'camera'],
    ['sceneAtmosphere', 'Bối cảnh', 'Không gian & Ánh sáng', 'var(--img, #10B981)', 'director'],
    ['styleDirection', 'Phong cách', 'Thẩm mỹ & Điện ảnh', '#EC4899', 'style'],
    ['negativePrompt', 'Điều cần tránh', 'Không được thêm', '#EF4444', 'negative'],
  ]
  const valueOf = (k: keyof typeof c | 'opening') => (k === 'opening' ? opening : c[k])
  const ids: Record<string, string> = { opening: 'roles', creativeBrief: 'brief', subjectAction: 'action', cameraMovement: 'camera',
    sceneAtmosphere: 'scene', styleDirection: 'style', negativePrompt: 'negative' }

  const sections: PromptSectionItem[] = defs
    .filter(([k]) => valueOf(k))
    .map(([k, tag, label, colorVar, sourceType]) => ({ id: ids[k], tag, label, content: valueOf(k), colorVar, sourceType }))

  const parts = [opening, c.creativeBrief, c.subjectAction, c.cameraMovement, c.sceneAtmosphere, c.styleDirection].map(sentence).filter(Boolean)
  const negative = c.negativePrompt.replace(/^(avoid|no|do not add|don't add)\s*:?\s*/i, '').replace(/[.]+$/, '')
  if (negative) parts.push(`Do not add ${negative}.`)
  const fullPrompt = parts.join(' ').trim()

  return {
    fullPrompt,
    sections,
    charCount: fullPrompt.length,
    hasRequiredFields: Boolean(c.creativeBrief || c.subjectAction),
  }
}

const LEGACY_ACTION = 'Transfer the choreography, poses, gestures, rhythm, camera angle, framing, and composition seamlessly from the motion video.'
const LEGACY_SCENE = 'Natural biomechanics, fluid body movement, photorealistic cinematic lighting.'

/** Bản nháp còn đúng mặc định cũ (Omni 1.1) -> mặc định mới; phần người dùng đã tự sửa được giữ nguyên. */
export function migrateLegacyCreative(saved: Partial<MotionCreativeDirection>): MotionCreativeDirection {
  const merged = { ...DEFAULT_MOTION_CREATIVE_DIRECTION, ...saved }
  if (!isLegacyDefaultBrief(saved.creativeBrief)) return merged
  return {
    ...merged,
    creativeBrief: DEFAULT_MOTION_CREATIVE_DIRECTION.creativeBrief,
    subjectAction: saved.subjectAction?.trim() === LEGACY_ACTION ? DEFAULT_MOTION_CREATIVE_DIRECTION.subjectAction : merged.subjectAction,
    sceneAtmosphere: saved.sceneAtmosphere?.trim() === LEGACY_SCENE ? DEFAULT_MOTION_CREATIVE_DIRECTION.sceneAtmosphere : merged.sceneAtmosphere,
    cameraMovement: merged.cameraMovement || DEFAULT_MOTION_CREATIVE_DIRECTION.cameraMovement,
    styleDirection: merged.styleDirection || DEFAULT_MOTION_CREATIVE_DIRECTION.styleDirection,
  }
}
