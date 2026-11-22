/**
 * Motion Prompt Builder v2 (Omni 1.2 Flash, chỉnh video theo video mẫu). Thiết kế: docs/PLAN_motion_control_redesign.md.
 *
 * Prompt = [Thay đổi] (tự sinh theo ảnh đang có) → [Chỉ đạo] (người dùng) → [Tùy chọn] (chip) → [Điều cần tránh]
 *          → [Giữ nguyên] (tự sinh). Mỗi ràng buộc chỉ nói MỘT lần (bản v1 lặp "timing / input video" 3–4 lần).
 * - Theo Google: mẫu "Apply the pose and motion from input video to … this image", "Keep everything else the same";
 *   hướng dẫn chỉnh video: đổi một thứ, nói rõ vai trò từng ảnh, giữ prompt ngắn.
 * - Ảnh gửi Flow theo thứ tự: nhân vật 1…N rồi bối cảnh → prompt gọi "Image N (character/setting reference)".
 * - Chỉ có ảnh nhân vật: mặc định GIỮ NỀN VIDEO MẪU (thay người); "nền theo ảnh nhân vật" là tùy chọn (mẫu của Google).
 * - Không dùng "Avoid:" (Omni không có ô negative): điều cần tránh thành câu "Do not add …".
 */

import type { MotionCreativeDirection } from '../types'

export interface PromptSectionItem {
  id: string
  tag: string
  label: string
  content: string
  colorVar: string
  sourceType: 'director' | 'motion' | 'camera' | 'style' | 'negative' | 'reference' | 'keep' | 'option'
  /** Khối do app tự sinh từ ảnh tham chiếu (không sửa trực tiếp trong ô chỉ đạo). */
  auto?: boolean
}

export type MotionEditMode = 'replace_person' | 'animate_image' | 'replace_scene' | 'replace_both' | 'describe'
export type MotionBackgroundSource = 'video' | 'character_image'

export interface MotionPromptOptions {
  /** Dùng cả vóc dáng của người trong ảnh (người mới khác vóc người trong video mẫu). */
  keepBodyShape: boolean
  /** Khớp phối cảnh, ánh sáng và bóng đổ khi ghép người vào nền. */
  matchLighting: boolean
  /** Tóc và quần áo chuyển động tự nhiên. */
  hairFabric: boolean
  /** Hình ảnh chân thực. */
  photoreal: boolean
  /** Không thêm người, chữ, logo. */
  noExtras: boolean
}

export type MotionPromptOptionKey = keyof MotionPromptOptions

export const MOTION_OPTION_LABELS: Record<MotionPromptOptionKey, { label: string; hint: string }> = {
  keepBodyShape: { label: 'Giữ vóc dáng theo ảnh', hint: 'Lấy cả dáng người từ ảnh nhân vật, không theo người trong video mẫu' },
  matchLighting: { label: 'Khớp ánh sáng & bóng đổ', hint: 'Khớp phối cảnh, tỉ lệ, ánh sáng và bóng dưới chân khi ghép người vào nền' },
  hairFabric: { label: 'Tóc & vải tự nhiên', hint: 'Tóc và quần áo chuyển động tự nhiên theo động tác' },
  photoreal: { label: 'Chân thực', hint: 'Thêm "Photorealistic footage."' },
  noExtras: { label: 'Không thêm người/chữ', hint: 'Không thêm người, chữ hay logo' },
}

/** Ảnh tham chiếu đang nối vào Motion Control (video mẫu luôn có, là "input video"). */
export interface MotionReferenceRoles {
  character?: boolean
  scene?: boolean
  /** Ảnh nhân vật 1 là sheet do node "Tạo ảnh nhân vật mới" tạo: chân dung bên trái, áo xoay 3 góc bên phải. */
  characterSheet?: boolean
  /** Số ảnh nhân vật (mỗi ảnh một người). Bỏ trống = 1 nếu `character`. */
  characterCount?: number
  /** Ghi chú cho từng nhân vật: người nào trong video mẫu được thay (tiếng Anh, vd. "the man in the blue shirt"). */
  characterTargets?: (string | undefined)[]
}

export interface StructuredPromptResult {
  fullPrompt: string
  sections: PromptSectionItem[]
  charCount: number
  /** Đủ điều kiện gửi (không có lỗi chặn). */
  hasRequiredFields: boolean
  mode: MotionEditMode
  /** Tùy chọn đang có hiệu lực (sau khi áp mặc định theo kiểu chỉnh). */
  options: MotionPromptOptions
  /** Lỗi chặn chạy (vd. không ảnh mà không mô tả thay đổi). */
  blockers: string[]
  /** Cảnh báo không chặn. */
  warnings: string[]
}

/** Flow (Omni 1.2 chỉnh video) nhận tối đa 3 ảnh tham chiếu: các ảnh nhân vật + ảnh bối cảnh. */
export const MAX_MOTION_REFERENCE_IMAGES = 3
/** Ngưỡng cảnh báo độ dài (bản mặc định dài nhất — 3 người hoặc 2 người + bối cảnh — khoảng 770–800 ký tự). */
export const MOTION_PROMPT_SOFT_LIMIT = 900

export const MOTION_MODE_INFO: Record<MotionEditMode, { label: string; summary: string }> = {
  replace_person: { label: 'Thay người', summary: 'Thay người trong video mẫu bằng người trong ảnh; giữ nền, ánh sáng, máy quay của video mẫu.' },
  animate_image: { label: 'Làm sống ảnh nhân vật', summary: 'Áp động tác của video mẫu lên ảnh nhân vật; nền lấy theo ảnh nhân vật.' },
  replace_scene: { label: 'Thay bối cảnh', summary: 'Giữ người và động tác của video mẫu, đưa sang bối cảnh trong ảnh.' },
  replace_both: { label: 'Thay người + bối cảnh', summary: 'Đổi cả người lẫn nền trong một lượt (rủi ro lệch cao hơn đổi một thứ).' },
  describe: { label: 'Chỉnh theo mô tả', summary: 'Không có ảnh: chỉ đổi đúng điều bạn viết ở "Chỉ đạo chính", giữ nguyên phần còn lại.' },
}

export const DEFAULT_MOTION_CREATIVE_DIRECTION: MotionCreativeDirection = {
  creativeBrief: '',
  subjectAction: '',
  cameraMovement: '',
  sceneAtmosphere: '',
  styleDirection: '',
  negativePrompt: '',
  backgroundFrom: 'video',
  options: {},
}

/** Mặc định v1 (đã bỏ vì lặp với khối Giữ nguyên tự sinh). */
export const V1_DEFAULT_BRIEF = 'Keep the movement natural and fluid, matching the timing and rhythm of the input video.'
const V1_DEFAULT_CAMERA = 'Keep the camera path and framing of the input video.'
const V1_DEFAULT_STYLE = 'Photorealistic, with lighting that matches the scene.'

/** Mặc định Omni 1.1 cũ hơn nữa. */
export const LEGACY_DEFAULT_BRIEFS = [
  "The subject from the image reference is the sole character in the video, performing the exact choreography from the motion reference video. Preserve the subject's complete identity, facial features, hair, glasses, clothing, and distinctive details consistently throughout. Transfer the choreography, poses, gestures, rhythm, camera angle, framing, and composition seamlessly from the motion video. Natural biomechanics, fluid body movement, photorealistic cinematic lighting.",
  "The subject from the image reference is the sole character in the video, performing the exact choreography from the motion reference video. Preserve the subject's complete identity, facial features, hair, glasses, clothing, and distinctive details consistently throughout.",
  V1_DEFAULT_BRIEF,
]

export function isLegacyDefaultBrief(brief: string | undefined | null): boolean {
  const b = (brief || '').trim()
  return !b || LEGACY_DEFAULT_BRIEFS.includes(b)
}

const LEGACY_ACTION = 'Transfer the choreography, poses, gestures, rhythm, camera angle, framing, and composition seamlessly from the motion video.'
const LEGACY_SCENE = 'Natural biomechanics, fluid body movement, photorealistic cinematic lighting.'

/** Bản nháp còn đúng mặc định cũ (Omni 1.1, v1) → mặc định v2; phần người dùng đã tự sửa được giữ nguyên. */
export function migrateLegacyCreative(saved: Partial<MotionCreativeDirection>): MotionCreativeDirection {
  const merged: MotionCreativeDirection = { ...DEFAULT_MOTION_CREATIVE_DIRECTION, ...saved }
  const clear = (v: string | undefined, ...olds: string[]) => (olds.includes((v || '').trim()) ? '' : v || '')
  return {
    ...merged,
    creativeBrief: isLegacyDefaultBrief(merged.creativeBrief) ? '' : merged.creativeBrief,
    subjectAction: clear(merged.subjectAction, LEGACY_ACTION),
    sceneAtmosphere: clear(merged.sceneAtmosphere, LEGACY_SCENE),
    cameraMovement: clear(merged.cameraMovement, V1_DEFAULT_CAMERA),
    styleDirection: clear(merged.styleDirection, V1_DEFAULT_STYLE),
    backgroundFrom: merged.backgroundFrom === 'character_image' ? 'character_image' : 'video',
    options: { ...(merged.options || {}) },
  }
}

function characterCountOf(roles: MotionReferenceRoles): number {
  return Math.max(0, Math.floor(roles.characterCount ?? (roles.character ? 1 : 0)))
}

/** Kiểu chỉnh suy ra từ ảnh đang có. "Nền theo ảnh nhân vật" chỉ áp cho đúng 1 nhân vật, không có ảnh bối cảnh. */
export function motionEditMode(roles: MotionReferenceRoles, backgroundFrom: MotionBackgroundSource = 'video'): MotionEditMode {
  const count = characterCountOf(roles)
  if (count === 0) return roles.scene ? 'replace_scene' : 'describe'
  if (roles.scene) return 'replace_both'
  return backgroundFrom === 'character_image' && count === 1 ? 'animate_image' : 'replace_person'
}

/** Tùy chọn mặc định theo kiểu chỉnh (người dùng bật/tắt thì ghi đè). */
export function defaultMotionOptions(mode: MotionEditMode): MotionPromptOptions {
  const personSwap = mode === 'replace_person' || mode === 'replace_both'
  return {
    keepBodyShape: personSwap,
    matchLighting: mode === 'replace_scene' || mode === 'replace_both',
    hairFabric: false,
    photoreal: false,
    noExtras: false,
  }
}

export function effectiveMotionOptions(mode: MotionEditMode, overrides?: Partial<MotionPromptOptions>): MotionPromptOptions {
  const base = defaultMotionOptions(mode)
  const out = { ...base }
  for (const key of Object.keys(base) as MotionPromptOptionKey[]) {
    if (typeof overrides?.[key] === 'boolean') out[key] = overrides[key] as boolean
  }
  return out
}

/** Chữ ký của bộ ảnh: đổi ảnh sau khi sửa tay prompt thì chữ ký khác → cảnh báo "prompt sửa tay có thể gọi sai Image N". */
export function motionPromptSignature(roles: MotionReferenceRoles, backgroundFrom: MotionBackgroundSource = 'video'): string {
  const count = characterCountOf(roles)
  return [motionEditMode(roles, backgroundFrom), count, roles.scene ? 1 : 0, roles.characterSheet && count > 0 ? 1 : 0].join(':')
}

const imageList = (from: number, n: number) => {
  const names = Array.from({ length: n }, (_, i) => `Image ${from + i}`)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]
}
const ORDINAL = ['leftmost', 'second', 'third']
const sentence = (text: string) => {
  const t = text.trim().replace(/\s+/g, ' ')
  if (!t) return ''
  return /[.!?]$/.test(t) ? t : `${t}.`
}
const cleanTarget = (t?: string) => (t || '').trim().replace(/[.]+$/, '')

/** Khối [Thay đổi] tự sinh. Rỗng ở kiểu "describe" (thay đổi do người dùng viết). */
export function changeBlock(roles: MotionReferenceRoles, backgroundFrom: MotionBackgroundSource = 'video',
  options?: Partial<MotionPromptOptions>): string {
  const mode = motionEditMode(roles, backgroundFrom)
  const opts = effectiveMotionOptions(mode, options)
  const count = Math.min(characterCountOf(roles), MAX_MOTION_REFERENCE_IMAGES - (roles.scene ? 1 : 0))
  const sheet = Boolean(roles.characterSheet) && count > 0
  const targets = roles.characterTargets || []
  const traits = opts.keepBodyShape ? 'face, hairstyle, body shape and outfit' : 'face, hairstyle and outfit'
  const lighting = opts.matchLighting ? "Match the setting's perspective, scale and lighting, with natural contact shadows." : ''
  const sheetNote = sheet
    ? 'Image 1 is a character sheet of one person: take the face and hairstyle from the portrait and the outfit from the front, side and back views.'
    : ''

  const personSwap = (): string[] => {
    if (count === 1) {
      const target = cleanTarget(targets[0]) || 'the person'
      return [
        `Replace ${target} in the input video with the person in Image 1 (character reference), performing the same pose, motion and timing.`,
        sheetNote,
        `Use the ${traits} from Image 1; do not keep the original person's face or clothes.`,
        sheet ? 'The video shows only this one person.' : '',
      ]
    }
    const mapping = Array.from({ length: count }, (_, i) => {
      const who = cleanTarget(targets[i]) || `the ${ORDINAL[i]} person${i === 0 ? '' : ' from the left'}`
      return `${who} becomes the person in Image ${i + 1}`
    }).join(', ')
    return [
      `Replace the people in the input video with the ${count} people in ${imageList(1, count)} (character references), one person per image, performing the same poses, motion and timing.`,
      `Match them from left to right as they appear at the start of the input video: ${mapping}.`,
      sheetNote,
      `Use each person's ${traits} from their own image; do not keep the original people's faces or clothes.`,
      `The video shows exactly these ${count} people.`,
    ]
  }

  let parts: string[] = []
  if (mode === 'replace_person') {
    parts = personSwap()
  } else if (mode === 'animate_image') {
    parts = [
      'Apply the pose and motion from the input video to the person in Image 1 (character reference), in the setting shown in Image 1.',
      sheetNote,
      `Keep the ${traits} from Image 1.`,
      sheet ? 'The video shows only this one person.' : '',
    ]
  } else if (mode === 'replace_scene') {
    parts = [
      'Move the people from the input video into the setting shown in Image 1 (setting reference), with the same pose, motion and timing; do not keep the original background.',
      lighting,
    ]
  } else if (mode === 'replace_both') {
    parts = [
      ...personSwap(),
      `Place them in the setting shown in Image ${count + 1} (setting reference); do not keep the original background.`,
      lighting,
    ]
  }
  return parts.filter(Boolean).join(' ')
}

/** Giữ tên cũ cho code/test cũ: câu mở đầu = khối [Thay đổi]. */
export function referenceOpening(roles: MotionReferenceRoles = {}, backgroundFrom: MotionBackgroundSource = 'video'): string {
  return changeBlock(roles, backgroundFrom)
}

/** Khối [Giữ nguyên] tự sinh: một câu duy nhất theo kiểu chỉnh. `cameraChanged`: người dùng tự chỉ đạo máy quay. */
export function keepBlock(mode: MotionEditMode, cameraChanged: boolean): string {
  const cam = cameraChanged ? [] : ['camera path', 'framing']
  const list = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items[0] || '')
  switch (mode) {
    case 'replace_person':
      return `Keep everything else the same as the input video: ${list(['background', 'lighting', ...cam])}.`
    case 'animate_image':
      return `Keep the ${list(['timing', ...cam])} of the input video.`
    case 'replace_scene':
      return `Keep the people's faces, hair and outfits${cam.length ? ', and the camera path and framing,' : ''} the same as the input video.`
    case 'replace_both':
      return cam.length ? 'Keep the camera path and framing of the input video.' : ''
    case 'describe':
      return 'Keep everything else the same as the input video, including the motion and timing.'
  }
}

const OPTION_SENTENCES: Partial<Record<MotionPromptOptionKey, string>> = {
  hairFabric: 'Hair and clothing move naturally with each motion.',
  photoreal: 'Photorealistic footage.',
  noExtras: 'Do not add extra people, text or logos.',
}

export function buildStructuredPrompt(
  creative?: Partial<MotionCreativeDirection>,
  roles: MotionReferenceRoles = {},
): StructuredPromptResult {
  const c = {
    creativeBrief: (creative?.creativeBrief || '').trim(),
    subjectAction: (creative?.subjectAction || '').trim(),
    cameraMovement: (creative?.cameraMovement || '').trim(),
    sceneAtmosphere: (creative?.sceneAtmosphere || '').trim(),
    styleDirection: (creative?.styleDirection || '').trim(),
    negativePrompt: (creative?.negativePrompt || '').trim(),
  }
  const backgroundFrom: MotionBackgroundSource = creative?.backgroundFrom === 'character_image' ? 'character_image' : 'video'
  const mode = motionEditMode(roles, backgroundFrom)
  const options = effectiveMotionOptions(mode, creative?.options)
  const change = changeBlock(roles, backgroundFrom, options)
  const optionText = (Object.keys(OPTION_SENTENCES) as MotionPromptOptionKey[])
    .filter((k) => options[k]).map((k) => OPTION_SENTENCES[k]!).join(' ')
  const negative = c.negativePrompt.replace(/^(avoid|no|do not add|don't add)\s*:?\s*/i, '').replace(/[.]+$/, '')
  const keep = keepBlock(mode, Boolean(c.cameraMovement))

  const S = (id: string, tag: string, label: string, content: string, colorVar: string,
    sourceType: PromptSectionItem['sourceType'], auto = false): PromptSectionItem => ({ id, tag, label, content, colorVar, sourceType, auto })
  const sections: PromptSectionItem[] = [
    S('roles', 'Thay đổi', mode === 'describe' ? 'Điều cần đổi (bạn viết)' : 'Tự sinh theo ảnh tham chiếu', mode === 'describe' ? sentence(c.creativeBrief) : change, '#0EA5E9', 'reference', mode !== 'describe'),
    S('brief', 'Chỉ đạo chính', 'Ý tưởng đạo diễn', mode === 'describe' ? '' : sentence(c.creativeBrief), 'var(--txt, #2F5BFF)', 'director'),
    S('action', 'Chuyển động', 'Hành động chủ thể', sentence(c.subjectAction), 'var(--vid, #FF7A00)', 'motion'),
    S('scene', 'Không khí', 'Không gian & ánh sáng', sentence(c.sceneAtmosphere), 'var(--img, #10B981)', 'director'),
    S('camera', 'Camera', 'Góc máy (đổi so với video mẫu)', sentence(c.cameraMovement), '#8B5CF6', 'camera'),
    S('style', 'Phong cách', 'Thẩm mỹ', sentence(c.styleDirection), '#EC4899', 'style'),
    S('options', 'Tùy chọn', 'Các chip đang bật', optionText, '#0D9488', 'option', true),
    S('negative', 'Điều cần tránh', 'Không được thêm', negative ? `Do not add ${negative}.` : '', '#EF4444', 'negative'),
    S('keep', 'Giữ nguyên', 'Tự sinh theo kiểu chỉnh', keep, '#64748B', 'keep', true),
  ].filter((s) => s.content)

  const fullPrompt = sections.map((s) => s.content).join(' ').trim()

  const blockers: string[] = []
  const warnings: string[] = []
  if (mode === 'describe' && !c.creativeBrief) {
    blockers.push('Chưa có ảnh nhân vật/bối cảnh: hãy viết điều muốn thay đổi ở “Chỉ đạo chính” (không thì video ra giống hệt video mẫu mà vẫn tốn credit).')
  }
  if (mode === 'replace_both') {
    warnings.push('Đổi cả người lẫn bối cảnh trong một lượt dễ lệch hơn đổi một thứ. Nếu kết quả lệch, thử chỉ thay người trước.')
  }
  if (fullPrompt.length > MOTION_PROMPT_SOFT_LIMIT) {
    warnings.push(`Prompt dài ${fullPrompt.length} ký tự: hướng dẫn chỉnh video khuyên viết ngắn, nhiều chi tiết dễ làm đổi cả phần không muốn đổi.`)
  }

  return {
    fullPrompt,
    sections,
    charCount: fullPrompt.length,
    hasRequiredFields: blockers.length === 0,
    mode,
    options,
    blockers,
    warnings,
  }
}
