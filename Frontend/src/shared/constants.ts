import {
  CalendarClock,
  BookOpen,
  Clapperboard,
  Layers,
  Clock3,
  Compass,
  Eraser,
  LayoutDashboard,
  Mic,
  Music,
  AudioLines,
  Video,
  Settings,
  Sparkles,
  Tv,
  Workflow as WorkflowIcon,
} from 'lucide-react'
import { NAV_STRUCTURE, type PageId } from './navModel.ts'

const configuredApiUrl = import.meta.env?.VITE_API_URL?.trim()
export const API_URL = (configuredApiUrl || 'http://127.0.0.1:8000').replace(/\/+$/, '')

export type NavItem = {
  label: string
  icon: typeof LayoutDashboard
  badge?: string
  badgeVariant?: 'pro' | 'new'
}

export type NavGroup = {
  title: string
  collapsible?: boolean
  items: NavItem[]
}

const NAV_ICONS: Record<PageId, typeof LayoutDashboard> = {
  'Dashboard': LayoutDashboard,
  'Canvas AI': WorkflowIcon,
  'Chiến dịch AI': Layers,
  'Veo Studio': Clapperboard,
  'Muse Studio': Sparkles,
  'Recap & Audio': AudioLines,
  'Khám Phá Kênh': Compass,
  'Crawl truyện': BookOpen,
  'Video': Video,
  'Voices': Mic,
  'Thư viện nhạc': Music,
  'Xóa Watermark': Eraser,
  'Lên lịch Pippit': CalendarClock,
  'Lên lịch Youtube': Tv,
  'Lịch sử': Clock3,
  'Cài đặt': Settings,
}

export const navGroups: NavGroup[] = NAV_STRUCTURE.map(group => ({
  title: group.title,
  collapsible: true,
  items: group.items.map((item): NavItem => ({
    label: item.label,
    icon: NAV_ICONS[item.label],
    ...('badge' in item ? { badge: item.badge, badgeVariant: item.badgeVariant } : {}),
  })),
}))

export const navigation: NavItem[] = navGroups.flatMap(group => group.items)
