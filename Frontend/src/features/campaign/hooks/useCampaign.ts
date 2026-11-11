import { useCallback, useEffect, useRef, useState } from 'react'
import { getState, listArtifacts, listRuns } from '../services/campaignApi.ts'
import { errorMessage, isRunning } from '../services/campaignView.ts'
import type { ArtifactView, CampaignState, RunView, Tier } from '../types.ts'

const POLL_MS = 1500

/** Tải trạng thái chiến dịch + ảnh + sổ chạy; tự cập nhật khi đang có lượt chạy. */
export function useCampaign(campaignId: string | null, tier: Tier = 'draft') {
  const [state, setState] = useState<CampaignState | null>(null)
  const [artifacts, setArtifacts] = useState<ArtifactView[]>([])
  const [runs, setRuns] = useState<RunView[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const currentId = useRef(campaignId)
  currentId.current = campaignId
  const currentTier = useRef(tier)
  currentTier.current = tier
  const loadFailed = useRef(false)

  const refresh = useCallback(async () => {
    const id = currentId.current
    if (!id) return
    try {
      const [s, a, r] = await Promise.all([getState(id, currentTier.current), listArtifacts(id), listRuns(id)])
      if (currentId.current !== id) return            // đã đổi chiến dịch trong lúc chờ
      setState(s)
      setArtifacts(a)
      setRuns(r.runs)
      // Chỉ xóa lỗi do chính việc tải gây ra; lỗi của thao tác (bấm chạy, duyệt...) phải ở lại đến khi người dùng đóng.
      if (loadFailed.current) { loadFailed.current = false; setError('') }
    } catch (e) {
      if (currentId.current === id) { loadFailed.current = true; setError(errorMessage(e)) }
    }
  }, [])

  useEffect(() => {
    setState(null)
    setArtifacts([])
    setRuns([])
    setError('')
    if (!campaignId) return
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [campaignId, refresh])

  // Đổi tier (nháp/chốt) -> tải lại trạng thái theo vân tay của tier đó (không xóa màn hình đang hiện)
  useEffect(() => { if (currentId.current) void refresh() }, [tier, refresh])

  const running = isRunning(state)
  useEffect(() => {
    if (!running) return
    const timer = setInterval(() => { void refresh() }, POLL_MS)
    return () => clearInterval(timer)
  }, [running, refresh])

  return { state, artifacts, runs, loading, error, setError, refresh }
}
