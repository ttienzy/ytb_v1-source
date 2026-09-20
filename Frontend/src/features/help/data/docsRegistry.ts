import type { SidebarDoc } from '../types'
import { dashboardDoc } from './dashboardDoc'
import { discoverDoc } from './discoverDoc'
import { storiesDoc } from './storiesDoc'
import { aiWorkflowDoc } from './aiWorkflowDoc'
import { studioDoc } from './studioDoc'
import { veoStudioDoc } from './veoStudioDoc'
import { videoDoc } from './videoDoc'
import { voicesDoc } from './voicesDoc'
import { bgmDoc } from './bgmDoc'
import { watermarkDoc } from './watermarkDoc'
import { pippitDoc } from './pippitDoc'
import { youtubePublisherDoc } from './youtubePublisherDoc'
import { historyDoc } from './historyDoc'
import { settingsDoc } from './settingsDoc'

export const ALL_DOCS: Record<string, SidebarDoc> = {
  Dashboard: dashboardDoc,
  'Khám Phá Kênh': discoverDoc,
  'Crawl truyện': storiesDoc,
  'AI Workflow': aiWorkflowDoc,
  Workflow: studioDoc,
  'Veo Studio': veoStudioDoc,
  Video: videoDoc,
  Voices: voicesDoc,
  'Thư viện nhạc': bgmDoc,
  'Xóa Watermark': watermarkDoc,
  'Lên lịch Pippit': pippitDoc,
  'Lên lịch Youtube': youtubePublisherDoc,
  'Lịch sử': historyDoc,
  'Cài đặt': settingsDoc,
}

export const DOC_LIST: SidebarDoc[] = [
  dashboardDoc,
  discoverDoc,
  storiesDoc,
  aiWorkflowDoc,
  studioDoc,
  veoStudioDoc,
  videoDoc,
  voicesDoc,
  bgmDoc,
  watermarkDoc,
  pippitDoc,
  youtubePublisherDoc,
  historyDoc,
  settingsDoc,
]

export function getDocForSidebar(sidebarId: string): SidebarDoc {
  if (ALL_DOCS[sidebarId]) {
    return ALL_DOCS[sidebarId]
  }
  // Fallback tìm kiếm mềm
  const found = DOC_LIST.find(
    (d) => d.id.toLowerCase() === sidebarId.toLowerCase()
  )
  return found || dashboardDoc
}
