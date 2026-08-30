import {
  CalendarClock,
  Clock3,
  Eraser,
  LayoutDashboard,
  Mic,
  Music,
  PlaySquare,
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
  { label: 'Studio', icon: PlaySquare },
  { label: 'Voices', icon: Mic },
  { label: 'Thư viện nhạc', icon: Music },
  { label: 'Xóa Watermark', icon: Eraser },
  { label: 'Lên lịch Pippit', icon: CalendarClock },
  { label: 'Lên lịch Youtube', icon: Tv },
  { label: 'Lịch sử', icon: Clock3 },
  { label: 'Cài đặt', icon: Settings },
]
