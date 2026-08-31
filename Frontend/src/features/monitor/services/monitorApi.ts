import { API_URL } from '../../../shared/constants'
import type { CalendarEventsResponse, PublisherDailySummary } from '../types'

export async function getDailyPublishingSummary(forceSync = false): Promise<PublisherDailySummary> {
  const url = forceSync
    ? `${API_URL}/api/publisher-monitor/daily-status?sync=true`
    : `${API_URL}/api/publisher-monitor/daily-status`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`Failed to fetch daily status: ${res.statusText}`)
  }
  return res.json()
}

export async function fetchCalendarEvents(
  month = '',
  forceSync = false
): Promise<CalendarEventsResponse> {
  const params = new URLSearchParams()
  if (month) params.append('month', month)
  if (forceSync) params.append('sync', 'true')

  const query = params.toString() ? `?${params.toString()}` : ''
  const res = await fetch(`${API_URL}/api/publisher-monitor/calendar-events${query}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch calendar events: ${res.statusText}`)
  }
  return res.json()
}
