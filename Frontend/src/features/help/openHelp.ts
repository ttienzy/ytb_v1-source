import type { PageId } from '../../shared/navModel.ts'

export const HELP_OPEN_EVENT = 'creatorflow:open-help'

export interface HelpTarget {
  pageId: PageId
  /** id của khối (area) hoặc tên mục để cuộn tới */
  anchor?: string
}

/** Mở Tài liệu hướng dẫn đúng trang/khối. Dùng cho dấu "?" cạnh các khối khó. */
export function openHelp(pageId: PageId, anchor?: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent<HelpTarget>(HELP_OPEN_EVENT, { detail: { pageId, anchor } }))
}
