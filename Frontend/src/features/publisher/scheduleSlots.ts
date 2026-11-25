// Tính giờ đăng cho từng video (khung giờ vàng nhiều ngày hoặc giãn cách đều). Module thuần, không phụ thuộc React.

export interface GoldenSlot {
  id: string
  time: string // "07:15"
  label: string // "Sáng" | "Trưa" | "Tối" | ...
}

export const GOLDEN_PRESETS: Record<string, { label: string; desc: string; slots: GoldenSlot[] }> = {
  '1_per_day': {
    label: '1 bài / ngày',
    desc: 'Đăng vào khung giờ vàng tối (19:45)',
    slots: [{ id: 'evening', time: '19:45', label: 'Tối' }],
  },
  '2_per_day': {
    label: '2 bài / ngày',
    desc: 'Trưa (11:45) + Tối (19:45)',
    slots: [
      { id: 'lunch', time: '11:45', label: 'Trưa' },
      { id: 'evening', time: '19:45', label: 'Tối' },
    ],
  },
  '3_per_day': {
    label: '3 bài / ngày (Khuyên dùng)',
    desc: 'Sáng (07:15) + Trưa (11:45) + Tối (19:45)',
    slots: [
      { id: 'morning', time: '07:15', label: 'Sáng' },
      { id: 'lunch', time: '11:45', label: 'Trưa' },
      { id: 'evening', time: '19:45', label: 'Tối' },
    ],
  },
}

export function getSlotPeriodName(time: string): string {
  const [hh] = time.split(':').map(Number)
  if (hh >= 5 && hh < 11) return 'Sáng'
  if (hh >= 11 && hh < 15) return 'Trưa'
  if (hh >= 15 && hh < 18) return 'Chiều'
  return 'Tối'
}

export type ScheduleMode = 'golden_hours' | 'interval'

export interface PlanInput<V extends { uid: string }, P extends { page_id: string }> {
  videos: V[]
  pages: P[]
  mode: ScheduleMode
  /** yyyy-mm-dd */
  startDate: string
  /** hh:mm (chỉ dùng khi mode = interval) */
  startTime: string
  intervalMinutes: number
  goldenSlots: GoldenSlot[]
  jitter: boolean
  customTimes: Record<string, number>
  customPages: Record<string, string>
  now: number
}

export interface SlotPlan<V, P> {
  video: V
  page: P
  schedule_time_ms: number
}

const MIN_LEAD_MS = 5 * 60 * 1000

/** Độ lệch cố định theo (video, ngày, mốc) trong -5…+10 phút: vẽ lại không làm giờ nhảy. */
function jitterMs(seed: string, enabled: boolean): number {
  if (!enabled) return 0
  let hash = 0
  for (let i = 0; i < seed.length; i++) {
    hash = (hash << 5) - hash + seed.charCodeAt(i)
    hash |= 0
  }
  return (-5 + (Math.abs(hash) % 16)) * 60 * 1000
}

export function planSlots<V extends { uid: string }, P extends { page_id: string }>(input: PlanInput<V, P>): SlotPlan<V, P>[] {
  const { videos, pages, mode, startDate, startTime, intervalMinutes, goldenSlots, jitter, customTimes, customPages, now } = input
  if (videos.length === 0 || pages.length === 0) return []
  const [yyyy, mm, dd] = startDate.split('-').map(Number)
  const pageFor = (video: V, idx: number): P => pages.find(p => p.page_id === customPages[video.uid]) || pages[idx % pages.length] || pages[0]

  if (mode === 'interval') {
    const [hh, min] = startTime.split(':').map(Number)
    let baseMs = new Date(yyyy, mm - 1, dd, hh, min, 0, 0).getTime()
    if (baseMs < now) baseMs = Math.ceil(now / 60000) * 60000 + MIN_LEAD_MS
    return videos.map((video, idx) => ({
      video,
      page: pageFor(video, idx),
      schedule_time_ms: customTimes[video.uid] ?? baseMs + idx * intervalMinutes * 60 * 1000,
    }))
  }

  const sorted = [...goldenSlots].sort((a, b) => a.time.localeCompare(b.time))
  if (sorted.length === 0) return []
  let dayOffset = 0
  let slotIdx = 0
  const today = new Date(now)
  if (today.getFullYear() === yyyy && today.getMonth() === mm - 1 && today.getDate() === dd) {
    while (slotIdx < sorted.length) {
      const [sh, sm] = sorted[slotIdx].time.split(':').map(Number)
      if (new Date(yyyy, mm - 1, dd, sh, sm, 0, 0).getTime() > now + MIN_LEAD_MS) break
      slotIdx++
    }
    if (slotIdx >= sorted.length) {
      dayOffset = 1
      slotIdx = 0
    }
  }

  return videos.map((video, idx) => {
    const page = pageFor(video, idx)
    if (customTimes[video.uid] !== undefined) return { video, page, schedule_time_ms: customTimes[video.uid] }
    const day = new Date(yyyy, mm - 1, dd + dayOffset)
    const [sh, sm] = sorted[slotIdx].time.split(':').map(Number)
    let ms = new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm, 0, 0).getTime() + jitterMs(`${video.uid}_${dayOffset}_${slotIdx}`, jitter)
    if (ms < now + MIN_LEAD_MS) ms = now + (idx + 1) * 15 * 60 * 1000
    slotIdx++
    if (slotIdx >= sorted.length) {
      slotIdx = 0
      dayOffset++
    }
    return { video, page, schedule_time_ms: ms }
  })
}
