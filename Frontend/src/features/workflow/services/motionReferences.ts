/**
 * Ảnh tham chiếu của Motion Control: nhiều nhân vật + một bối cảnh.
 *
 * Flow (Omni 1.2 `macaron_cookie_edit`) nhận 1–3 ảnh tham chiếu cùng video mẫu; extension (`motionImageOrder`) và
 * backend (`_motion_image_order`) đều kiểm giới hạn này. Ảnh gửi theo thứ tự: nhân vật 1, nhân vật 2, nhân vật 3 rồi
 * bối cảnh — prompt (`motionPromptBuilder.referenceOpening`) gọi "Image N" theo đúng thứ tự đó.
 */
import { MAX_MOTION_REFERENCE_IMAGES } from './motionPromptBuilder.ts'

export { MAX_MOTION_REFERENCE_IMAGES }

/** Ô nhân vật thêm (ngoài ô "Nhân Vật" chính): character2 = ô thêm thứ nhất, character3 = ô thêm thứ hai. */
export type ExtraCharacterRole = 'character2' | 'character3'
export type MotionAssetRole = 'character' | ExtraCharacterRole | 'motion' | 'scene'

export const EXTRA_CHARACTER_ROLES: ExtraCharacterRole[] = ['character2', 'character3']

export function extraCharacterIndex(role: MotionAssetRole | string): number {
  return EXTRA_CHARACTER_ROLES.indexOf(role as ExtraCharacterRole)
}

export function isCharacterRole(role: MotionAssetRole | string): boolean {
  return role === 'character' || extraCharacterIndex(role) >= 0
}

/** Còn thêm được ô nhân vật không: (ô chính + ô thêm) + bối cảnh đã có ảnh < 3. */
export function canAddMotionCharacter(extraSlots: number, sceneFilled: boolean): boolean {
  return 1 + extraSlots + (sceneFilled ? 1 : 0) < MAX_MOTION_REFERENCE_IMAGES
}

/** Nạp ảnh bối cảnh được không: chỉ bị chặn khi đã mở đủ 3 ô nhân vật. */
export function canAddMotionScene(extraSlots: number): boolean {
  return 1 + extraSlots < MAX_MOTION_REFERENCE_IMAGES
}

interface FilledLike {
  filled: boolean
}

/** Ảnh sẽ gửi đi theo đúng thứ tự: các nhân vật có ảnh (ô chính trước) rồi bối cảnh. */
export function orderedMotionImages<T extends FilledLike>(primary: T, extras: T[], scene: T): T[] {
  return [primary, ...extras, scene].filter((a) => a.filled)
}

export function filledCharacterCount(primary: FilledLike, extras: FilledLike[]): number {
  return [primary, ...extras].filter((a) => a.filled).length
}

let seq = 0
/** Ô nhân vật thêm rỗng; id duy nhất để cập nhật đúng ô kể cả khi người dùng xóa ô khác giữa chừng. */
export function newExtraCharacterId(): string {
  seq += 1
  return `ref-char-extra-${Date.now().toString(36)}-${seq}`
}
