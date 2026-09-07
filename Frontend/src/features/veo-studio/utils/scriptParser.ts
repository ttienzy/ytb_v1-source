/**
 * Smart Script Parser for Veo Studio
 *
 * Hỗ trợ 2 chế độ phân tách:
 * 1. by_video: Gom toàn bộ kịch bản của từng món/video thành 1 prompt duy nhất (giữ nguyên văn bản gốc).
 * 2. by_scene: Tách từng mốc thời gian (0:00-0:02, ...) thành từng phân cảnh riêng biệt.
 *
 * Tính năng:
 * - Giữ nguyên nội dung văn bản gốc người dùng nhập vào.
 * - Tự động nhận diện mốc thời gian tổng (0:00-0:10) hoặc từng phân cảnh.
 * - Tự động ánh xạ thời lượng sang 4s, 6s, 8s, 10s chuẩn Google Veo.
 * - Tùy chọn lọc bỏ hoặc giữ lại các dòng Text, Music, Audio.
 */

import type { BatchSceneItem, ScriptParseOptions } from '../types'

/**
 * Đổi chuỗi mm:ss thành số giây (vd: 0:08 -> 8, 1:15 -> 75)
 */
export function parseTimeToSeconds(timeStr: string): number {
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
 * Đổi số giây thành chuỗi mm:ss (vd: 10 -> 0:10, 75 -> 1:15)
 */
export function formatSecondsToTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
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
export function isIgnoredLine(line: string): boolean {
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
 * Kiểm tra xem dòng có phải là tiêu đề món / mục video (vd: "49. Cá Kho Tộ...", "Video 1: ...")
 */
export function isItemHeaderLine(line: string): { isHeader: boolean; title?: string; number?: number } {
  const trimmed = line.trim()
  if (!trimmed) return { isHeader: false }

  // Dạng số thứ tự đầu dòng: "1.", "2.", "29.", "49. Cá Kho Tộ...", "50) Thịt heo...", "# 49. ..."
  const numMatch = trimmed.match(/^(?:#+\s*)?(\d+)[\.\)](?:\s+(.*)|$)/i)
  if (numMatch) {
    return {
      isHeader: true,
      number: parseInt(numMatch[1], 10),
      title: (numMatch[2] || '').trim(),
    }
  }

  // Dạng tiền tố: "Video 1: ...", "Món 1: ...", "Part 1: ..."
  const prefixMatch = trimmed.match(/^(?:video|món|item|part|phần|cảnh|scene)\s*(\d+)[:\.\-]?\s*(.*)$/i)
  if (prefixMatch) {
    return {
      isHeader: true,
      number: parseInt(prefixMatch[1], 10),
      title: prefixMatch[2].trim() || `Item ${prefixMatch[1]}`,
    }
  }

  return { isHeader: false }
}

interface VideoBlock {
  headerTitle?: string
  lines: string[]
  timestamps: { startSec: number; endSec: number }[]
}

/**
 * Phân tách theo Video hoàn chỉnh:
 * - CHỈ CẮT khi gặp dòng số thứ tự: 1., 2., ... 29., 49., 50...
 * - GIỮ NGUYÊN 100% toàn bộ text kịch bản (không lược bỏ Text:, Music:, dòng trống hay mốc thời gian).
 */
function parseByVideo(
  rawText: string,
  defaultDuration = 10,
  options: ScriptParseOptions = {
    splitMode: 'by_video',
    autoDuration: true,
    ignoreAudioText: false,
    includeTitlePrefix: true,
  },
): { scenes: BatchSceneItem[]; detectedTitle?: string } {
  const allLines = rawText.split(/\r?\n/)
  const timestampRegex =
    /^[•\-\*\+]?\s*(\d{1,2}:\d{2})\s*[-–—~]\s*(\d{1,2}:\d{2})\s*:\s*(.+)$/i

  // Kiểm tra xem kịch bản có cấu trúc header số thứ tự (1., 2., 29., 49., 50...) không
  const hasNumberedHeaders = allLines.some((l) => isItemHeaderLine(l).isHeader)

  const rawBlocks: VideoBlock[] = []
  let currentBlock: VideoBlock | null = null

  const finishBlock = () => {
    if (!currentBlock) return
    const joined = currentBlock.lines.join('\n').trim()
    if (joined.length > 0) {
      rawBlocks.push(currentBlock)
    }
    currentBlock = null
  }

  for (let i = 0; i < allLines.length; i++) {
    const rawLine = allLines[i]
    const trimmedLine = rawLine.trim()

    // Bỏ qua đường kẻ phân cách hoặc ghi chú kết thúc sau phân cách (ví dụ: "----- \n chưa code...")
    if (/^[-=_*~]{3,}$/.test(trimmedLine)) {
      finishBlock()
      continue
    }

    const headerInfo = isItemHeaderLine(rawLine)

    if (hasNumberedHeaders) {
      // Khi kịch bản có số thứ tự: CHỈ CẮT KHI GẶP DÒNG SỐ THỨ TỰ (1., 2., 29., 49., 50...)
      if (headerInfo.isHeader) {
        finishBlock()
        currentBlock = {
          headerTitle: headerInfo.title,
          lines: [rawLine],
          timestamps: [],
        }
        continue
      }

      // Nếu chưa bắt đầu block nào (chưa gặp số thứ tự đầu tiên), bỏ qua các lời chào mở đầu
      if (!currentBlock) {
        continue
      }
    } else {
      // Nếu không có số thứ tự, khởi tạo block đầu tiên
      if (!currentBlock) {
        currentBlock = {
          lines: [],
          timestamps: [],
        }
      }
    }

    // Nếu người dùng bật tuỳ chọn lọc audio/text thì mới lọc, mặc định GIỮ NGUYÊN 100% TEXT
    if (options.ignoreAudioText && isIgnoredLine(trimmedLine)) {
      continue
    }

    // Quét timestamp để tự động tính thời lượng nhưng KHÔNG XÓA DÒNG
    const tsMatch = trimmedLine.match(timestampRegex)
    if (tsMatch) {
      const startSec = parseTimeToSeconds(tsMatch[1])
      const endSec = parseTimeToSeconds(tsMatch[2])
      currentBlock.timestamps.push({ startSec, endSec })
    }

    // Thêm nguyên vẹn dòng này (kể cả Text:, Music:, dòng trống, mô tả...)
    currentBlock.lines.push(rawLine)
  }

  // Đẩy block cuối cùng
  finishBlock()

  const scenes: BatchSceneItem[] = []
  let firstDetectedTitle = ''

  for (let idx = 0; idx < rawBlocks.length; idx++) {
    const block = rawBlocks[idx]
    if (!firstDetectedTitle && block.headerTitle) {
      firstDetectedTitle = block.headerTitle
    }

    let timecode: string | undefined = undefined
    let duration = defaultDuration

    if (block.timestamps.length > 0) {
      const minStart = Math.min(...block.timestamps.map((t) => t.startSec))
      const maxEnd = Math.max(...block.timestamps.map((t) => t.endSec))
      timecode = `${formatSecondsToTime(minStart)}–${formatSecondsToTime(maxEnd)}`
      const delta = Math.max(1, maxEnd - minStart)
      if (options.autoDuration) {
        duration = mapDeltaToVeoDuration(delta)
      }
    } else {
      duration = Math.max(defaultDuration, 10)
    }

    // Prompt giữ nguyên vẹn 100% text ban đầu của block
    const fullPrompt = block.lines.join('\n').trim()
    if (!fullPrompt) continue

    scenes.push({
      id: `scene-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
      sceneNumber: scenes.length + 1,
      timecode,
      prompt: fullPrompt,
      durationSeconds: duration,
      status: 'idle',
    })
  }

  return { scenes, detectedTitle: firstDetectedTitle }
}

/**
 * Phân tách theo Phân cảnh: Mỗi mốc thời gian (0:00-0:02) thành 1 Cảnh riêng
 */
function parseByScene(
  rawText: string,
  defaultDuration = 4,
  options: ScriptParseOptions,
): { scenes: BatchSceneItem[]; detectedTitle?: string } {
  const lines = rawText.split(/\r?\n/)
  const scenes: BatchSceneItem[] = []
  let currentTitle = ''
  let firstDetectedTitle = ''

  const timestampRegex =
    /^[•\-\*\+]?\s*(\d{1,2}:\d{2})\s*[-–—~]\s*(\d{1,2}:\d{2})\s*:\s*(.+)$/i

  const hasAnyTimestamps = lines.some((l) => timestampRegex.test(l.trim()))

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (!line) continue

    if (/^[-=_*~]{3,}$/.test(line)) {
      continue
    }

    if (options.ignoreAudioText && isIgnoredLine(line)) {
      continue
    }

    // Nhận diện header món (49. Cá Kho Tộ...)
    const headerInfo = isItemHeaderLine(line)
    if (headerInfo.isHeader) {
      currentTitle = headerInfo.title || ''
      if (!firstDetectedTitle) firstDetectedTitle = currentTitle
      continue
    }

    // Bắt mốc thời gian (0:00–0:02: ...)
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

      if (options.includeTitlePrefix && currentTitle) {
        if (!promptText.toLowerCase().includes(currentTitle.toLowerCase())) {
          promptText = `${currentTitle}: ${promptText}`
        }
      }

      scenes.push({
        id: `scene-${Date.now()}-${scenes.length}-${Math.random().toString(36).slice(2, 6)}`,
        sceneNumber: scenes.length + 1,
        timecode: `${startTime}–${endTime}`,
        prompt: promptText,
        durationSeconds: duration,
        status: 'idle',
      })
      continue
    }

    // Nếu văn bản đã có mốc thời gian (timestamp), các dòng không có timestamp chỉ là phụ/chú thích, không tạo card
    if (hasAnyTimestamps) {
      continue
    }

    // Nhận diện tiêu đề phụ nếu không có timestamps
    const isTitleCandidate =
      !line.startsWith('•') &&
      !line.startsWith('-') &&
      !line.startsWith('*') &&
      !line.includes(':') &&
      line.length < 80

    if (isTitleCandidate) {
      currentTitle = line.replace(/^\d+[\.\)]\s*/, '').trim()
      if (!firstDetectedTitle) firstDetectedTitle = currentTitle
      continue
    }

    // Dòng cảnh thông thường (chỉ dùng khi không có timestamps)
    let cleanText = line.replace(/^[•\-\*\+]\s*/, '').trim()
    if (cleanText.length < 3) continue

    if (options.includeTitlePrefix && currentTitle) {
      if (!cleanText.toLowerCase().includes(currentTitle.toLowerCase())) {
        cleanText = `${currentTitle}: ${cleanText}`
      }
    }

    scenes.push({
      id: `scene-${Date.now()}-${scenes.length}-${Math.random().toString(36).slice(2, 6)}`,
      sceneNumber: scenes.length + 1,
      prompt: cleanText,
      durationSeconds: defaultDuration,
      status: 'idle',
    })
  }

  return { scenes, detectedTitle: firstDetectedTitle }
}

/**
 * Bóc tách kịch bản thô thành danh sách các phân cảnh (BatchSceneItem)
 * Mặc định: tách theo từng video hoàn chỉnh (by_video)
 */
export function parseScript(
  rawText: string,
  defaultDuration = 10,
  options: ScriptParseOptions = {
    splitMode: 'by_video',
    autoDuration: true,
    ignoreAudioText: false,
    includeTitlePrefix: true,
  },
): { scenes: BatchSceneItem[]; detectedTitle?: string } {
  if (!rawText || !rawText.trim()) {
    return { scenes: [] }
  }

  const mode = options.splitMode || 'by_video'

  if (mode === 'by_scene') {
    return parseByScene(rawText, defaultDuration, options)
  }

  return parseByVideo(rawText, defaultDuration, options)
}

/**
 * Mẫu kịch bản mẫu nhiều món tương thích cấu trúc kịch bản người dùng
 */
export function getSampleScript(): string {
  return `49. Cá Kho Tộ (Caramelized Fish in Clay Pot)
0:00–0:02: Fish steaks and sliced pork fat placed beside a clay pot with sugar and fish sauce.
0:02–0:08: Sugar melted into deep amber caramel in the pot → fish laid in carefully, coated in the caramel, sizzling → fish sauce, pepper, and pork fat added → pot covered, simmering broth bubbling and reducing (time-lapse) → lid lifted revealing glossy dark-red fish, sauce thickened and glistening.
0:08–0:10: Bowl of steaming rice placed beside the pot, a piece of fish scooped on top with sauce drizzled over, chopsticks lifting a flaky bite.
Text: "Cá Kho Tộ 🐟" → "Ready in 35 min"
Music: warm nostalgic Vietnamese acoustic guitar, caramel-sizzle and simmering bubble sounds layered throughout

50. Crispy Pork Belly (Thịt Heo Quay)
0:00–0:02: Pork belly scored in a crosshatch pattern on the skin, salt rubbed generously into the cuts → placed on a roasting rack.
0:02–0:08: Pork slid into a hot oven, skin blistering and bubbling (time-lapse) → pulled out halfway, extra salt brushed off, oven temperature raised → skin puffing up and turning deep golden with audible crackling → pulled out fully crisped.
0:08–0:10: Pork chopped into pieces with a heavy knife, dramatic crackling sound on each cut, cross-section showing crispy skin over tender meat.
Text: "Crispy Pork Belly 🐖" → "Ready in 1 hr"
Music: bold percussive beat building anticipation, crackling skin sound emphasized throughout

51. Seafood Paella
0:00–0:02: Rice, saffron threads, shrimp, mussels, and chorizo placed beside a wide paella pan over open flame.
0:02–0:08: Chorizo and onions sautéed in the pan until fragrant → rice stirred in, coated in oil and saffron-infused broth poured over, spreading evenly → shrimp and mussels nestled into the rice, simmering uncovered (time-lapse) as broth absorbs and a crispy socarrat crust forms on the bottom → pan tilted slightly to show the golden crust forming at the edges.
0:08–0:10: Lemon wedges and parsley scattered on top, spoon scraping up a crispy bottom piece alongside a mussel.
Text: "Seafood Paella 🥘" → "Ready in 35 min"
Music: lively Spanish guitar and castanets, simmering broth sound layered throughout`
}

