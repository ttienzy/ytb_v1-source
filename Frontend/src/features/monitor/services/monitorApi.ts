import { API_URL } from '../../../shared/constants'
import type { CalendarEventsResponse, PublisherDailySummary } from '../types'

const REQUEST_CACHE_MS = 1500

let dailySummaryCache: { value: PublisherDailySummary; timestamp: number } | null = null
let dailySummaryInFlight: Promise<PublisherDailySummary> | null = null

const calendarCache = new Map<string, { value: CalendarEventsResponse; timestamp: number }>()
const calendarInFlight = new Map<string, Promise<CalendarEventsResponse>>()

function isFresh(timestamp: number): boolean {
  return Date.now() - timestamp < REQUEST_CACHE_MS
}

export async function getDailyPublishingSummary(forceSync = false): Promise<PublisherDailySummary> {
  if (!forceSync && dailySummaryCache && isFresh(dailySummaryCache.timestamp)) {
    return dailySummaryCache.value
  }

  if (!forceSync && dailySummaryInFlight) {
    return dailySummaryInFlight
  }

  const url = forceSync
    ? `${API_URL}/api/publisher-monitor/daily-status?sync=true`
    : `${API_URL}/api/publisher-monitor/daily-status`

  const request = fetch(url).then(async (res) => {
    if (!res.ok) {
      throw new Error(`Failed to fetch daily status: ${res.statusText}`)
    }
    const value = await res.json() as PublisherDailySummary
    dailySummaryCache = { value, timestamp: Date.now() }
    return value
  })

  dailySummaryInFlight = request
  try {
    return await request
  } finally {
    if (dailySummaryInFlight === request) {
      dailySummaryInFlight = null
    }
  }
}

export async function fetchCalendarEvents(
  month = '',
  forceSync = false
): Promise<CalendarEventsResponse> {
  const cacheKey = month || 'all'
  const cached = calendarCache.get(cacheKey)
  if (!forceSync && cached && isFresh(cached.timestamp)) {
    return cached.value
  }

  const existingRequest = calendarInFlight.get(cacheKey)
  if (!forceSync && existingRequest) {
    return existingRequest
  }

  const params = new URLSearchParams()
  if (month) params.append('month', month)
  if (forceSync) params.append('sync', 'true')

  const query = params.toString() ? `?${params.toString()}` : ''
  const request = fetch(`${API_URL}/api/publisher-monitor/calendar-events${query}`).then(async (res) => {
    if (!res.ok) {
      throw new Error(`Failed to fetch calendar events: ${res.statusText}`)
    }
    const value = await res.json() as CalendarEventsResponse
    calendarCache.set(cacheKey, { value, timestamp: Date.now() })
    return value
  })

  calendarInFlight.set(cacheKey, request)
  try {
    return await request
  } finally {
    if (calendarInFlight.get(cacheKey) === request) {
      calendarInFlight.delete(cacheKey)
    }
  }
}
