import type { PollingPolicy } from './workflowConfig.ts'

export class PollingStoppedError extends Error {}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(new PollingStoppedError('Đã dừng theo dõi job.')) }
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve() }, ms)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

/** One request at a time; stalled HTTP cannot bypass the overall deadline. */
export async function pollJob<T>(options: {
  read: (signal: AbortSignal) => Promise<T | null>
  isTerminal: (value: T) => boolean
  onUpdate?: (value: T) => void
  policy: PollingPolicy
  signal: AbortSignal
}): Promise<T> {
  const { policy, signal } = options
  const deadline = Date.now() + policy.timeoutMs
  let consecutiveErrors = 0
  while (Date.now() < deadline) {
    if (signal.aborted) throw new PollingStoppedError('Đã dừng theo dõi job.')
    const controller = new AbortController()
    const abort = () => controller.abort()
    signal.addEventListener('abort', abort, { once: true })
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    try {
      const stopped = new Promise<never>((_, reject) => {
        onAbort = () => reject(new Error('Hết thời gian chờ phản hồi trạng thái job.'))
        controller.signal.addEventListener('abort', onAbort, { once: true })
        timer = setTimeout(abort, Math.min(policy.requestTimeoutMs, deadline - Date.now()))
      })
      const status = await Promise.race([options.read(controller.signal), stopped])
      if (signal.aborted) throw new PollingStoppedError('Đã dừng theo dõi job.')
      if (!status) throw new Error('Không đọc được trạng thái job.')
      consecutiveErrors = 0
      options.onUpdate?.(status)
      if (options.isTerminal(status)) return status
    } catch (error) {
      if (signal.aborted) throw new PollingStoppedError('Đã dừng theo dõi job.')
      if (++consecutiveErrors >= policy.maxConsecutiveErrors) throw error
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (onAbort) controller.signal.removeEventListener('abort', onAbort)
    }
    await delay(Math.max(0, Math.min(policy.intervalMs, deadline - Date.now())), signal)
  }
  throw new PollingStoppedError('Hết thời gian theo dõi; job có thể vẫn đang chạy. Kiểm tra Thư viện trước khi tạo lại.')
}
