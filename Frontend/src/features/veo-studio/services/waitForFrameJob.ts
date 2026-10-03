import type { VeoJobOut } from '../types'

interface Options {
  getJob: (id: string, signal: AbortSignal) => Promise<VeoJobOut | null>
  onProgress?: (job: VeoJobOut) => void
  onConnectionLost?: () => void
  timeoutMs?: number
  intervalMs?: number
  now?: () => number
  sleep?: (ms: number) => Promise<void>
}

// Poll one existing job. Network failures never submit another generation.
export async function waitForFrameJob(jobId: string, options: Options): Promise<VeoJobOut> {
  const now = options.now || Date.now
  const sleep = options.sleep || ((ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)))
  const deadline = now() + (options.timeoutMs ?? 810_000)
  while (now() < deadline) {
    await sleep(Math.min(options.intervalMs ?? 2500, deadline - now()))
    if (now() >= deadline) break
    let job: VeoJobOut | null
    try {
      job = await options.getJob(jobId, AbortSignal.timeout(Math.max(1, Math.min(15_000, deadline - now()))))
    } catch {
      options.onConnectionLost?.()
      continue
    }
    if (!job) {
      options.onConnectionLost?.()
      continue
    }
    if (job.job_id !== jobId) throw new Error('Phản hồi không đúng tác vụ đang theo dõi; kiểm tra lịch sử trước khi tạo lại.')
    if (job.status === 'error') throw new Error(job.error_message || 'Flow không tạo được video')
    if (job.status === 'done') return job
    options.onProgress?.(job)
  }
  throw new Error(`Chưa xác nhận được kết quả job ${jobId}; kiểm tra lịch sử và Flow trước khi tạo lại.`)
}
