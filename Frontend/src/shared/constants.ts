import {
  CalendarClock,
  BookOpen,
  Clapperboard,
  Clock3,
  Compass,
  Eraser,
  LayoutDashboard,
  Mic,
  Music,
  PlaySquare,
  Video,
  Settings,
  Sparkles,
  Tv,
  Workflow as WorkflowIcon,
} from 'lucide-react'

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

export const navGroups: NavGroup[] = [
  {
    title: 'Tổng Quan',
    collapsible: true,
    items: [
      { label: 'Dashboard', icon: LayoutDashboard },
    ],
  },
  {
    title: 'Tạo Video AI',
    collapsible: true,
    items: [
      { label: 'AI Workflow', icon: WorkflowIcon, badge: 'PRO', badgeVariant: 'pro' },
      { label: 'Veo Studio', icon: Clapperboard },
      { label: 'Muse Studio', icon: Sparkles, badge: 'NEW', badgeVariant: 'new' },
      { label: 'Workflow', icon: PlaySquare },
    ],
  },
  {
    title: 'Nguồn Nội Dung',
    collapsible: true,
    items: [
      { label: 'Khám Phá Kênh', icon: Compass },
      { label: 'Crawl truyện', icon: BookOpen },
      { label: 'Video', icon: Video },
    ],
  },
  {
    title: 'Tiện Ích Biên Tập',
    collapsible: true,
    items: [
      { label: 'Voices', icon: Mic },
      { label: 'Thư viện nhạc', icon: Music },
      { label: 'Xóa Watermark', icon: Eraser },
    ],
  },
  {
    title: 'Phân Phối & Hệ Thống',
    collapsible: true,
    items: [
      { label: 'Lên lịch Pippit', icon: CalendarClock },
      { label: 'Lên lịch Youtube', icon: Tv },
      { label: 'Lịch sử', icon: Clock3 },
      { label: 'Cài đặt', icon: Settings },
    ],
  },
]

export const navigation: NavItem[] = navGroups.flatMap(group => group.items)
