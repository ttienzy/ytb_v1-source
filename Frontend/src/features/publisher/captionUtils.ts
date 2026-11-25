// Soạn caption cho Lên lịch Pippit. Module thuần (node:test nạp được), không phụ thuộc React/DOM.
import type { CaptionOverride } from './types.ts'

export type CaptionMode = 'smart' | 'template'
export type CaptionPlatform = 'facebook' | 'tiktok'

export const AI_DISCLOSURE = 'Hình ảnh trong video được tạo bằng AI.'
export const TIKTOK_CAPTION_MAX = 2200
export const FACEBOOK_CAPTION_SOFT_MAX = 500
export const BIG_FILE_BYTES = 250 * 1024 * 1024
export const TITLE_MAX = 90

export interface CaptionVideo {
  title: string
  file_name: string
  default_title?: string
  default_caption?: string
  default_hashtags?: string[]
  default_cta?: string
}

/** Tên file → tiêu đề dễ đọc (bỏ đuôi, hậu tố clean/final…, dấu gạch, dãy số cuối). */
export function cleanTitleFromName(filename: string): string {
  if (!filename) return ''
  return filename
    .replace(/\.[^/.]+$/, '')
    .replace(/[_-]?(clean|final|studio|recap|watermark_removed)[_-]?/gi, ' ')
    .replace(/[_\s-]+[0-9]{6,14}$/, '')
    .replace(/[_\s-]+[0-9]{4,8}[_\s-]+[0-9]{4,8}$/, '')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Tiêu đề có nghĩa với người xem? Mã băm / uuid / tên file kỹ thuật thì không (không được lộ ra bài đăng công khai). */
export function isMeaningfulTitle(title: string): boolean {
  const t = (title || '').trim()
  if (t.length < 3) return false
  if (/^[a-f0-9]{6,}(-[a-f0-9]+)*$/i.test(t)) return false
  if (/^[\w-]+$/.test(t) && !/\s/.test(t) && /\d{4,}/.test(t)) return false
  if (/^(cut|clip|seg|video|muse[_-]?final|final|draft)[\w-]*$/i.test(t) && /\d/.test(t)) return false
  return true
}

export function smartTruncate(text: string, max: number): string {
  const t = (text || '').trim()
  if (t.length <= max) return t
  let cut = t.slice(0, max - 1)
  const space = cut.lastIndexOf(' ')
  if (space >= Math.floor(max / 2)) cut = cut.slice(0, space)
  return cut.replace(/[ ,;:\-·]+$/, '') + '…'
}

export function normalizeTag(raw: string): string {
  const t = (raw || '').trim().replace(/\s+/g, '')
  if (!t || t === '#') return ''
  return t.startsWith('#') ? t : `#${t}`
}

export function uniqueTags(tags: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of tags) {
    const tag = normalizeTag(raw)
    if (tag && !seen.has(tag.toLowerCase())) {
      seen.add(tag.toLowerCase())
      out.push(tag)
    }
  }
  return out
}

/** `{a|b|c}` → một lựa chọn, xác định theo `seed` (mỗi bài một seed → bài nào cũng khác nhau mà không nhảy khi vẽ lại). */
export function resolveSpintax(text: string, seed: number): string {
  let occurrence = 0
  return text.replace(/\{([^{}|]+(?:\|[^{}|]*)+)\}/g, (_m, body: string) => {
    const options = body.split('|')
    const pick = options[Math.abs(seed + occurrence * 7) % options.length]
    occurrence++
    return pick.trim()
  })
}

export interface TemplateVars {
  title: string
  caption?: string
  hashtags: string[]
  cta?: string
  index: number
  date: string
  /** Tương thích mẫu cũ `{filename}`: luôn là tiêu đề đã làm sạch, không bao giờ là tên file thô. */
  filename?: string
}

function tidy(text: string): string {
  return text
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Thay biến một lượt (giá trị thay vào không bị thay lại), rồi spintax. Mẫu không có `{hashtags}` thì hashtag được nối cuối. */
export function renderCaptionTemplate(template: string, vars: TemplateVars, seed: number): string {
  const hasTagVar = /\{hashtags\}/.test(template)
  const values: Record<string, string> = {
    title: vars.title,
    filename: vars.filename ?? vars.title,
    caption: vars.caption ?? '',
    hashtags: vars.hashtags.join(' '),
    cta: vars.cta ?? '',
    index: String(vars.index),
    date: vars.date,
  }
  let out = template.replace(/\{(title|filename|caption|hashtags|cta|index|date)\}/g, (_m, k: string) => values[k])
  out = resolveSpintax(out, seed)
  if (!hasTagVar && vars.hashtags.length) out = `${out.trimEnd()}\n\n${vars.hashtags.join(' ')}`
  return tidy(out)
}

export interface ResolveInput {
  mode: CaptionMode
  video: CaptionVideo
  override?: CaptionOverride
  template: string
  /** Hashtag đang chọn trong mẫu (dùng khi nguồn không có hashtag riêng). */
  tags: string[]
  index: number
  date: string
  appendDisclosure?: boolean
}

export function displayTitle(video: CaptionVideo): string {
  if (video.default_title?.trim()) return video.default_title.trim()
  const cleaned = cleanTitleFromName(video.file_name) || video.title
  return isMeaningfulTitle(cleaned) ? cleaned : isMeaningfulTitle(video.title) ? video.title : ''
}

/**
 * Thứ tự ưu tiên: (1) người dùng sửa tay / AI vừa viết cho đúng bài này →
 * (2) chế độ "smart": caption có sẵn từ nguồn (Chiến dịch AI, Recap) →
 * (3) mẫu chung (biến + spintax).
 */
export function resolveSlotCaption(input: ResolveInput): string {
  const { mode, video, override, template, tags, index, date } = input
  let text: string
  if (override?.caption !== undefined) {
    text = override.caption.trim()
  } else if (mode === 'smart' && video.default_caption?.trim()) {
    const own = uniqueTags(video.default_hashtags?.length ? video.default_hashtags : tags)
    text = tidy([video.default_caption.trim(), video.default_cta?.trim() || '', own.join(' ')].filter(Boolean).join('\n\n'))
  } else {
    text = renderCaptionTemplate(
      template,
      {
        title: displayTitle(video),
        caption: video.default_caption,
        hashtags: uniqueTags([...(video.default_hashtags || []), ...tags]),
        cta: video.default_cta,
        index,
        date,
      },
      index,
    )
  }
  if (input.appendDisclosure && text && !text.includes(AI_DISCLOSURE)) text = `${text}\n\n${AI_DISCLOSURE}`
  return text
}

export function resolveSlotTitle(video: CaptionVideo, override: CaptionOverride | undefined, caption: string): string {
  if (override?.title !== undefined) return smartTruncate(override.title, TITLE_MAX)
  const own = displayTitle(video)
  if (own) return smartTruncate(own, TITLE_MAX)
  const firstLine = caption.split('\n').find(l => l.trim() && !l.trim().startsWith('#')) || ''
  return smartTruncate(firstLine, TITLE_MAX)
}

export function getCaptionWarnings(caption: string, platform: CaptionPlatform, sizeBytes: number, fileName = ''): string[] {
  const out: string[] = []
  const text = caption.trim()
  if (!text) out.push('Caption đang trống.')
  if (platform === 'tiktok' && text.length > TIKTOK_CAPTION_MAX) out.push(`Caption dài ${text.length} ký tự, vượt giới hạn ${TIKTOK_CAPTION_MAX} của TikTok.`)
  if (platform === 'facebook' && text.length > FACEBOOK_CAPTION_SOFT_MAX) {
    out.push(`Caption dài ${text.length} ký tự (> ${FACEBOOK_CAPTION_SOFT_MAX}): Facebook Reels hay báo lỗi kỹ thuật với caption quá dài.`)
  }
  if (sizeBytes > BIG_FILE_BYTES) out.push('File > 250 MB: upload lâu và dễ lỗi mạng, nên dùng video ngắn hơn.')
  const stem = fileName.replace(/\.[^/.]+$/, '')
  if (stem.length >= 6 && text.includes(stem)) out.push('Caption đang chứa tên file thô.')
  return out
}
