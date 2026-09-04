import {
  CalendarClock,
  BookOpen,
  Clock3,
  Compass,
  Eraser,
  LayoutDashboard,
  Mic,
  Music,
  PlaySquare,
  Video,
  Settings,
  Tv,
} from 'lucide-react'

export const API_URL = 'http://127.0.0.1:8000'

export type NavItem = {
  label: string
  icon: typeof LayoutDashboard
}

export const navigation: NavItem[] = [
  { label: 'Dashboard', icon: LayoutDashboard },
  { label: 'Khám Phá Kênh', icon: Compass },
  { label: 'Crawl truyện', icon: BookOpen },
  { label: 'Studio', icon: PlaySquare },
  { label: 'Video', icon: Video },
  { label: 'Voices', icon: Mic },
  { label: 'Thư viện nhạc', icon: Music },
  { label: 'Xóa Watermark', icon: Eraser },
  { label: 'Lên lịch Pippit', icon: CalendarClock },
  { label: 'Lên lịch Youtube', icon: Tv },
  { label: 'Lịch sử', icon: Clock3 },
  { label: 'Cài đặt', icon: Settings },
]
