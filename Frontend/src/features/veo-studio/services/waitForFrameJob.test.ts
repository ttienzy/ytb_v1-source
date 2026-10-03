import { test } from 'node:test'
import assert from 'node:assert/strict'
import { waitForFrameJob } from './waitForFrameJob.ts'
import type { VeoJobOut } from '../types'

const job = (status: string, id = 'job-1') => ({ job_id: id, status, error_message: 'provider rejected' }) as VeoJobOut
function clock() {
  let time = 0
  return { now: () => time, sleep: async (ms: number) => { time += ms }, intervalMs: 1, timeoutMs: 10 }
}
test('keeps polling the same job after network failure and null response', async () => {
  let calls = 0, lost = 0
  const ids: string[] = [], progress: string[] = []
  const result = await waitForFrameJob('job-1', {
    ...clock(),
    getJob: async (id, signal) => {
      ids.push(id)
      assert.ok(signal instanceof AbortSignal)
      calls++
      if (calls === 1) throw new Error('offline')
      if (calls === 2) return null
      return job(calls === 3 ? 'generating' : 'done')
    },
    onConnectionLost: () => { lost++ },
    onProgress: j => progress.push(j.status),
  })
  assert.equal(result.status, 'done')
  assert.deepEqual(ids, Array(4).fill('job-1'))
  assert.equal(lost, 2)
  assert.deepEqual(progress, ['generating'])
})
test('provider error stops polling immediately', async () => {
  let calls = 0
  await assert.rejects(waitForFrameJob('job-1', {
    ...clock(), getJob: async () => { calls++; return job('error') },
  }), /provider rejected/)
  assert.equal(calls, 1)
})
test('timeout reports the job id without claiming provider failure', async () => {
  await assert.rejects(waitForFrameJob('job-1', {
    ...clock(), getJob: async () => { throw new Error('offline') },
  }), /job-1/)
})
test('does not accept another job result', async () => {
  await assert.rejects(waitForFrameJob('job-1', {
    ...clock(), getJob: async () => job('done', 'job-2'),
  }))
})
