import { useCallback, useEffect, useRef, useState } from 'react'

export interface LibraryPage<T> {
  items: T[]
  total: number
  page: number
  page_size: number
}

export type PageSummary = Pick<LibraryPage<unknown>, 'total' | 'page' | 'page_size'>

export function useLibraryPage<P extends PageSummary>(
  fetchPage: (page: number, signal: AbortSignal) => Promise<P>,
  { enabled = true, refreshKey = 0 }: { enabled?: boolean; refreshKey?: number } = {},
) {
  const [data, setData] = useState<P | null>(null)
  const [loading, setLoading] = useState(enabled)
  const [error, setError] = useState('')
  const options = useRef({ fetchPage, enabled })
  const requestedPage = useRef(1)
  const inFlight = useRef<AbortController | null>(null)

  const load = useCallback(async (page = requestedPage.current) => {
    if (!options.current.enabled) return
    inFlight.current?.abort()
    const request = new AbortController()
    inFlight.current = request
    requestedPage.current = page
    setLoading(true)
    setError('')
    try {
      const result = await options.current.fetchPage(page, request.signal)
      if (request.signal.aborted) return
      requestedPage.current = result.page
      setData(result)
      return result
    } catch (e) {
      if (!request.signal.aborted) setError(e instanceof Error ? e.message : 'Không tải được danh sách.')
    } finally {
      if (!request.signal.aborted) setLoading(false)
    }
  }, [])

  useEffect(() => {
    const changed = options.current.fetchPage !== fetchPage
    options.current = { fetchPage, enabled }
    if (changed) {
      requestedPage.current = 1
      setData(null)
    }
    if (enabled) void load()
    return () => {
      options.current.enabled = false
      inFlight.current?.abort()
    }
  }, [enabled, fetchPage, load, refreshKey])

  return { data, loading, error, load }
}

export function useLibrarySearch(value: string): string {
  const [query, setQuery] = useState(value.trim())
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(value.trim()), 220)
    return () => window.clearTimeout(timer)
  }, [value])
  return query
}
