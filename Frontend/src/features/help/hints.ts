// Dấu "?" theo ngữ cảnh: mỗi mục trỏ tới một trang và một khối (area id hoặc tên mục) trong tài liệu.
// Test help.test.ts kiểm tra neo còn tồn tại, nên đổi id khối mà quên sửa ở đây sẽ đỏ.
import type { PageId } from '../../shared/navModel.ts'

export interface HelpHintTarget {
  pageId: PageId
  anchor: string
  /** Tên khối, dùng cho aria-label/tooltip */
  label: string
}

export const HINTS = {
  'audio.queue': { pageId: 'Recap & Audio', anchor: 'hang-doi', label: 'Kiểu video, bố cục và hàng đợi' },
  'audio.style': { pageId: 'Recap & Audio', anchor: 'am-thanh-hieu-ung', label: 'Âm thanh & hiệu ứng' },
  'recap.raw': { pageId: 'Recap & Audio', anchor: 'raw-transcript', label: 'Raw transcript' },
  'recap.botwall': { pageId: 'Recap & Audio', anchor: 'youtube-botwall', label: 'YouTube Bot-Wall' },
  'campaign.credit': { pageId: 'Chiến dịch AI', anchor: 'khoi-5-clip', label: 'Credit Flow và trần credit' },
  'campaign.cast': { pageId: 'Chiến dịch AI', anchor: 'khoi-2-nhan-vat-canh', label: 'Cast sheet và các cảnh' },
  'campaign.clip': { pageId: 'Chiến dịch AI', anchor: 'khoi-5-clip', label: 'Tạo clip' },
  'canvas.longMotion': { pageId: 'Canvas AI', anchor: 'motion-video-dai', label: 'Motion video dài' },
  'youtube.schedule': { pageId: 'Lên lịch Youtube', anchor: 'khung-gio-vang', label: 'Khung giờ vàng và hạn mức' },
  'muse.connect': { pageId: 'Muse Studio', anchor: 'trang-thai-ket-noi', label: 'Kết nối Muse' },
} as const satisfies Record<string, HelpHintTarget>

export type HintKey = keyof typeof HINTS
