export interface QuickStep {
  step: number
  title: string
  desc: string
  badge?: string
}

export interface FeatureItem {
  title: string
  desc: string
  tip?: string
  tag?: string
}

export interface TroubleshootingItem {
  issue: string
  solution: string
}

export interface SubTabGuide {
  id: string
  label: string
  iconName?: 'video' | 'sparkles' | 'film' | 'activity' | 'bot' | 'mail' | 'hard-drive' | 'youtube' | 'mic' | 'settings' | 'layers'
  desc: string
  flowSteps?: string[] // Chuỗi các bước kèm mũi tên chuyển hướng: ví dụ ["Chọn ảnh", "Chỉnh Motion", "Render"]
}

export interface SidebarDoc {
  id: string
  title: string
  category: string
  badge: string
  summary: string
  subTabs?: SubTabGuide[]
  quickSteps: QuickStep[]
  features: FeatureItem[]
  proTips: string[]
  troubleshooting: TroubleshootingItem[]
  relatedPages?: string[]
}
