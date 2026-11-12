// Registry tài liệu: danh sách và thứ tự trang SINH TỪ NAV_STRUCTURE (cùng nhóm với sidebar).
import { NAV_STRUCTURE, isPageId, type PageId } from '../../shared/navModel.ts'
import type { HelpDoc, HelpGuide } from './model.ts'
import { overviewGuide } from './data/overviewGuide.ts'
import { recapAudioDoc } from './data/recapAudioDoc.ts'
import { videoPageDoc } from './data/videoPageDoc.ts'
import { campaignDoc } from './data/campaignDoc.ts'
import { museStudioDoc } from './data/museStudioDoc.ts'
import { discoverPageDoc } from './data/discoverPageDoc.ts'
import { settingsPageDoc } from './data/settingsPageDoc.ts'
import { dashboardPageDoc } from './data/dashboardPageDoc.ts'
import { canvasAiDoc } from './data/canvasAiDoc.ts'
import { veoStudioPageDoc } from './data/veoStudioPageDoc.ts'
import { storiesPageDoc } from './data/storiesPageDoc.ts'
import { voicesPageDoc } from './data/voicesPageDoc.ts'
import { bgmPageDoc } from './data/bgmPageDoc.ts'
import { watermarkPageDoc } from './data/watermarkPageDoc.ts'
import { pippitPageDoc } from './data/pippitPageDoc.ts'
import { youtubePublisherPageDoc } from './data/youtubePublisherPageDoc.ts'
import { historyPageDoc } from './data/historyPageDoc.ts'

/** Mỗi trang sidebar có đúng một doc, viết theo mô hình v2 và có verifiedAt. */
export const HELP_DOCS: Record<PageId, HelpDoc> = {
  'Dashboard': dashboardPageDoc,
  'Canvas AI': canvasAiDoc,
  'Chiến dịch AI': campaignDoc,
  'Veo Studio': veoStudioPageDoc,
  'Muse Studio': museStudioDoc,
  'Recap & Audio': recapAudioDoc,
  'Khám Phá Kênh': discoverPageDoc,
  'Crawl truyện': storiesPageDoc,
  'Video': videoPageDoc,
  'Voices': voicesPageDoc,
  'Thư viện nhạc': bgmPageDoc,
  'Xóa Watermark': watermarkPageDoc,
  'Lên lịch Pippit': pippitPageDoc,
  'Lên lịch Youtube': youtubePublisherPageDoc,
  'Lịch sử': historyPageDoc,
  'Cài đặt': settingsPageDoc,
}

export interface HelpGroup {
  title: string
  pages: Array<{ pageId: PageId; hasDoc: boolean }>
}

/** Nhóm và thứ tự đúng như sidebar. */
export const HELP_GROUPS: HelpGroup[] = NAV_STRUCTURE.map(group => ({
  title: group.title,
  pages: group.items.map(item => ({ pageId: item.label as PageId, hasDoc: !!HELP_DOCS[item.label as PageId] })),
}))

/** id lạ trả null (KHÔNG rơi về doc khác). */
export function getHelpDoc(pageId: string): HelpDoc | null {
  return isPageId(pageId) ? (HELP_DOCS[pageId] ?? null) : null
}

export function allHelpDocs(): HelpDoc[] {
  return HELP_GROUPS.flatMap(group => group.pages).map(page => HELP_DOCS[page.pageId])
}

export const OVERVIEW_GUIDE: HelpGuide = overviewGuide
