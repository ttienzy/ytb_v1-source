/**
 * Smart Script Parser for Veo Studio
 *
 * Chuyên bóc tách kịch bản phân cảnh từ văn bản:
 * - Tự động nhận diện mốc thời gian (0:00-0:02, 0:02-0:08, ...)
 * - Tự động ánh xạ thời lượng sang 4s, 6s, 8s, 10s chuẩn Google Flow
 * - Lọc bỏ các dòng Text, Music, Audio, SFX
 * - Hỗ trợ gán tiêu đề chủ đề vào từng prompt cảnh
 */

import type { BatchSceneItem, ScriptParseOptions } from '../types'

/**
 * Đổi chuỗi mm:ss thành số giây (vd: 0:08 -> 8, 1:15 -> 75)
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.trim().split(':').map(Number)
  if (parts.length === 2) {
    return (parts[0] || 0) * 60 + (parts[1] || 0)
  }
  if (parts.length === 3) {
    return (parts[0] || 0) * 3600 + (parts[1] || 0) * 60 + (parts[2] || 0)
  }
  return 0
}

/**
 * Ánh xạ khoảng thời gian (giây) sang thời lượng Veo gần nhất (4, 6, 8, 10s)
 */
export function mapDeltaToVeoDuration(deltaSeconds: number): number {
  if (deltaSeconds <= 4) return 4
  if (deltaSeconds <= 6) return 6
  if (deltaSeconds <= 8) return 8
  return 10
}

/**
 * Kiểm tra xem một dòng có phải là metadata âm thanh / chữ hiển thị không
 */
function isIgnoredLine(line: string): boolean {
  const cleaned = line.replace(/^[•\-\*\+]\s*/, '').trim().toLowerCase()
  return (
    cleaned.startsWith('text:') ||
    cleaned.startsWith('music:') ||
    cleaned.startsWith('audio:') ||
    cleaned.startsWith('sfx:') ||
    cleaned.startsWith('sound:') ||
    cleaned.startsWith('voice:') ||
    cleaned.startsWith('caption:') ||
    cleaned.startsWith('sub:') ||
    cleaned.startsWith('subtitle:')
  )
}

/**
 * Bóc tách kịch bản thô thành danh sách các phân cảnh (BatchSceneItem)
 */
export function parseScript(
  rawText: string,
  defaultDuration = 4,
  options: ScriptParseOptions = {
    autoDuration: true,
    ignoreAudioText: true,
    includeTitlePrefix: true,
  },
): { scenes: BatchSceneItem[]; detectedTitle?: string } {
  if (!rawText || !rawText.trim()) {
    return { scenes: [] }
  }

  const lines = rawText.split(/\r?\n/)
  const scenes: BatchSceneItem[] = []
  let detectedTitle = ''

  // Regex nhận diện mốc thời gian dạng: [• -]? 0:00–0:02: nội dung
  const timestampRegex =
    /^[•\-\*\+]?\s*(\d{1,2}:\d{2})\s*[-–—~]\s*(\d{1,2}:\d{2})\s*:\s*(.+)$/i

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    // 1. Kiểm tra nếu là dòng metadata cần lọc bỏ
    if (options.ignoreAudioText && isIgnoredLine(line)) {
      continue
    }

    // 2. Thử bắt pattern Timestamp (0:00–0:02: ...)
    const match = line.match(timestampRegex)
    if (match) {
      const startTime = match[1]
      const endTime = match[2]
      let promptText = match[3].trim()

      const startSec = parseTimeToSeconds(startTime)
      const endSec = parseTimeToSeconds(endTime)
      const delta = Math.max(1, endSec - startSec)

      const duration = options.autoDuration
        ? mapDeltaToVeoDuration(delta)
        : defaultDuration

      // Gắn tiền tố tiêu đề nếu có bật tùy chọn
      if (options.includeTitlePrefix && detectedTitle) {
        // Chỉ thêm nếu prompt chưa có chứa tiêu đề
        if (!promptText.toLowerCase().includes(detectedTitle.toLowerCase())) {
          promptText = `${detectedTitle}: ${promptText}`
        }
      }

      scenes.push({
        id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        sceneNumber: scenes.length + 1,
        timecode: `${startTime}–${endTime}`,
        prompt: promptText,
        durationSeconds: duration,
        status: 'idle',
      })
      continue
    }

    // 3. Nếu chưa có tiêu đề và dòng hiện tại trông giống tên món / tiêu đề cảnh (vd: "48. Grilled Lamb Chops")
    const isTitleCandidate =
      !line.startsWith('•') &&
      !line.startsWith('-') &&
      !line.startsWith('*') &&
      !line.includes(':') &&
      line.length < 80

    if (isTitleCandidate && !detectedTitle) {
      // Bỏ số thứ tự đầu dòng (48. ) nếu có
      detectedTitle = line.replace(/^\d+[\.\)]\s*/, '').trim()
      continue
    }

    // 4. Nếu là dòng mô tả cảnh thông thường (gạch đầu dòng hoặc câu văn độc lập)
    let cleanText = line.replace(/^[•\-\*\+]\s*/, '').trim()
    // Bỏ qua nếu dòng quá ngắn hoặc là heading phụ
    if (cleanText.length < 3) continue

    if (options.includeTitlePrefix && detectedTitle) {
      if (!cleanText.toLowerCase().includes(detectedTitle.toLowerCase())) {
        cleanText = `${detectedTitle}: ${cleanText}`
      }
    }

    scenes.push({
      id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      sceneNumber: scenes.length + 1,
      prompt: cleanText,
      durationSeconds: defaultDuration,
      status: 'idle',
    })
  }

  return { scenes, detectedTitle }
}

/**
 * Mẫu kịch bản tương thích ảnh người dùng cung cấp
 */
export function getSampleScript(): string {
  return `48. Grilled Lamb Chops
• 0:00–0:02: Lamb chops seasoned with rosemary, garlic, salt and pepper, rubbed in by hand -> placed beside a hot grill pan.
• 0:02–0:08: Chops dropped onto the sizzling grill, hard sear forming grill marks -> flipped, fat rendering and crisping at the edges -> butter and rosemary sprig added, basted over the chops repeatedly -> chops tilted upright briefly to crisp the fat cap -> pulled off and rested on a board.
• 0:08–0:10: Chops sliced between the bones, pink juicy center revealed, resting juices pooling, close-up steam rising.
• Text: "Grilled Lamb Chops 🥩" -> "Ready in 15 min"
• Music: rich orchestral strings with a slow build, sear sizzle and basting sound layered throughout`
}
