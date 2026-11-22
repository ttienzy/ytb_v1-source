/**
 * Hook dùng `museRuns` (services/museRunRegistry.ts) trong node Muse Canvas: gửi 1 lượt, nhận kết quả kể cả khi
 * node đã bị gỡ rồi hiện lại (đổi tab / đổi project), không bao giờ gửi lại.
 *
 *   const runs = useMuseRuns<Result>((key, r) => setResult(r))
 *   // lúc node gắn lên: if (!runs.resume(key)) đánh dấu "bị gián đoạn"
 *   // lúc chạy:        if (runs.isRunning(key)) return; ... await runs.start(key, job)
 */
import { useCallback, useEffect, useMemo, useRef } from 'react'
import { museRuns } from '../../services/museRunRegistry.ts'

export function useMuseRuns<T>(apply: (key: string, value: T) => void) {
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  const applyRef = useRef(apply)
  applyRef.current = apply

  /** Node còn trên màn hình thì nhận ngay; đã bị gỡ thì để kết quả trong registry cho lần node hiện lại. */
  const deliver = useCallback((key: string, value: T) => {
    if (!mounted.current) return
    applyRef.current(key, value)
    museRuns.done(key)
  }, [])

  const start = useCallback(
    async (key: string, job: Promise<T>): Promise<T> => {
      const value = await museRuns.start(key, job)
      deliver(key, value)
      return value
    },
    [deliver],
  )

  /** Gọi lúc node gắn lên với lượt đang "running": true = đã nhận / đang gắn tiếp, false = không còn lượt nào (gián đoạn). */
  const resume = useCallback(
    (key: string): boolean => {
      const hit = museRuns.lookup<T>(key)
      if (!hit) return false
      if (hit.state === 'settled') {
        applyRef.current(key, hit.value)
        museRuns.done(key)
      } else {
        hit.promise.then((v) => deliver(key, v)).catch(() => {})
      }
      return true
    },
    [deliver],
  )

  const isRunning = useCallback((key: string) => museRuns.isRunning(key), [])

  return useMemo(() => ({ start, resume, isRunning }), [start, resume, isRunning])
}
