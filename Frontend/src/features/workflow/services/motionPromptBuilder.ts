/**
 * Motion Prompt Builder Service
 * Chuẩn hóa mô hình prompt theo chuẩn Google Flow:
 * - Media đóng vai trò là "Nguyên liệu tham chiếu (Ingredients/References)".
 * - Prompt là "Chỉ dẫn sáng tạo (Creative Direction)" điều phối hành động, góc máy và phong cách.
 * - Tránh lặp lại mô tả ngoại hình đã có trong ảnh/video.
 */

import type { MotionCreativeDirection } from '../types'

export interface PromptSectionItem {
  id: string
  tag: string
  label: string
  content: string
  colorVar: string
  sourceType: 'director' | 'motion' | 'camera' | 'style' | 'negative'
}

export interface StructuredPromptResult {
  fullPrompt: string
  sections: PromptSectionItem[]
  charCount: number
  hasRequiredFields: boolean
}

/**
 * Xây dựng danh sách các phân đoạn prompt có cấu trúc kèm nhãn nguồn trực quan
 */
export function buildStructuredPrompt(
  creative?: Partial<MotionCreativeDirection>,
): StructuredPromptResult {
  const c = {
    creativeBrief: (creative?.creativeBrief || '').trim(),
    subjectAction: (creative?.subjectAction || '').trim(),
    cameraMovement: (creative?.cameraMovement || '').trim(),
    sceneAtmosphere: (creative?.sceneAtmosphere || '').trim(),
    styleDirection: (creative?.styleDirection || '').trim(),
    negativePrompt: (creative?.negativePrompt || '').trim(),
  }

  const sections: PromptSectionItem[] = []

  // 1. Creative Brief (Chỉ đạo chính của đạo diễn)
  if (c.creativeBrief) {
    sections.push({
      id: 'brief',
      tag: 'Chỉ đạo chính',
      label: 'Ý tưởng đạo diễn',
      content: c.creativeBrief,
      colorVar: 'var(--txt, #2F5BFF)',
      sourceType: 'director',
    })
  }

  // 2. Subject Action & Motion (Hành động & chuyển động nhân vật)
  if (c.subjectAction) {
    sections.push({
      id: 'action',
      tag: 'Chuyển động',
      label: 'Hành động chủ thể',
      content: c.subjectAction,
      colorVar: 'var(--vid, #FF7A00)',
      sourceType: 'motion',
    })
  }

  // 3. Camera Movement (Góc quay & chuyển động máy quay)
  if (c.cameraMovement) {
    sections.push({
      id: 'camera',
      tag: 'Camera',
      label: 'Góc máy & chuyển động',
      content: c.cameraMovement,
      colorVar: '#8B5CF6',
      sourceType: 'camera',
    })
  }

  // 4. Scene & Lighting (Bối cảnh & ánh sáng)
  if (c.sceneAtmosphere) {
    sections.push({
      id: 'scene',
      tag: 'Bối cảnh',
      label: 'Không gian & Ánh sáng',
      content: c.sceneAtmosphere,
      colorVar: 'var(--img, #10B981)',
      sourceType: 'director',
    })
  }

  // 5. Look & Style (Phong cách hình ảnh)
  if (c.styleDirection) {
    sections.push({
      id: 'style',
      tag: 'Phong cách',
      label: 'Thẩm mỹ & Điện ảnh',
      content: c.styleDirection,
      colorVar: '#EC4899',
      sourceType: 'style',
    })
  }

  // 6. Negative Prompt (Điều cần tránh)
  if (c.negativePrompt) {
    sections.push({
      id: 'negative',
      tag: 'Điều cần tránh',
      label: 'Tránh (Negative)',
      content: c.negativePrompt,
      colorVar: '#EF4444',
      sourceType: 'negative',
    })
  }

  // Ghép thành chuỗi prompt chuẩn cho Veo / Google Flow
  const textParts: string[] = []

  const mainParts = [
    c.creativeBrief,
    c.subjectAction,
    c.cameraMovement,
    c.sceneAtmosphere,
    c.styleDirection,
  ].filter(Boolean)

  if (mainParts.length > 0) {
    textParts.push(mainParts.join('. '))
  }

  if (c.negativePrompt) {
    textParts.push(`Avoid: ${c.negativePrompt}`)
  }

  const fullPrompt = textParts.join('\n\n').trim()

  return {
    fullPrompt,
    sections,
    charCount: fullPrompt.length,
    hasRequiredFields: Boolean(c.creativeBrief || c.subjectAction),
  }
}
