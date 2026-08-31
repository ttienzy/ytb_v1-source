import { API_URL } from '../../../shared/constants'
import type { PublisherDailySummary } from '../types'

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
