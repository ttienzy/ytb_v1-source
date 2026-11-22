import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  SETTLED_STORAGE_KEY,
  SETTLED_TTL_MS,
  createRunRegistry,
  runKey,
  runKeyNodeId,
  type RunStorage,
} from '../services/museRunRegistry.ts'

function memStorage(init: Record<string, string> = {}): RunStorage & { data: Record<string, string> } {
  const data = { ...init }
  return { data, getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = v) }
}

const deferred = <T,>() => {
  let resolve!: (v: T) => void
  let reject!: (e: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

test('lượt đang chờ: isRunning + lookup trả promise', async () => {
  const reg = createRunRegistry()
  const d = deferred<string>()
  const p = reg.start('script:a', d.promise)
  assert.equal(reg.isRunning('script:a'), true)
  assert.equal(reg.lookup('script:a')?.state, 'running')
  assert.deepEqual(reg.runningKeys(), ['script:a'])
  d.resolve('xong')
  assert.equal(await p, 'xong')
  assert.equal(reg.isRunning('script:a'), false)
})

test('kết quả về khi node đã bị gỡ: giữ lại tới khi node nhận (done)', async () => {
  const reg = createRunRegistry()
  const d = deferred<{ status: string }>()
  const p = reg.start('job:n1::s1', d.promise)
  d.resolve({ status: 'done' })
  await p
  // node hiện lại sau khi kết quả đã về: vẫn nhận được (trước đây bị đánh dấu "gián đoạn")
  assert.deepEqual(reg.lookup('job:n1::s1'), { state: 'settled', value: { status: 'done' } })
  reg.done('job:n1::s1')
  assert.equal(reg.lookup('job:n1::s1'), null)
})

test('kết quả chưa nhận được lưu localStorage: tạo lại registry (F5) vẫn còn', async () => {
  const storage = memStorage()
  const reg = createRunRegistry(storage)
  await reg.start('clipScript:x', Promise.resolve({ text: 'abc' }))
  const again = createRunRegistry(storage)
  assert.deepEqual(again.lookup('clipScript:x'), { state: 'settled', value: { text: 'abc' } })
  again.done('clipScript:x')
  assert.deepEqual(JSON.parse(storage.data[SETTLED_STORAGE_KEY]), {})
})

test('kết quả quá hạn trong localStorage bị bỏ khi nạp', () => {
  const now = 10 * SETTLED_TTL_MS
  const storage = memStorage({
    [SETTLED_STORAGE_KEY]: JSON.stringify({ 'script:old': { value: 1, at: now - SETTLED_TTL_MS - 1 }, 'script:new': { value: 2, at: now - 1000 } }),
  })
  const reg = createRunRegistry(storage, () => now)
  assert.equal(reg.lookup('script:old'), null)
  assert.deepEqual(reg.lookup('script:new'), { state: 'settled', value: 2 })
})

test('bản lưu hỏng không làm registry lỗi', () => {
  const reg = createRunRegistry(memStorage({ [SETTLED_STORAGE_KEY]: '{hỏng' }))
  assert.equal(reg.lookup('x'), null)
})

test('lượt mới thay kết quả cũ chưa nhận của cùng khóa', async () => {
  const reg = createRunRegistry()
  await reg.start('finish:v', Promise.resolve('cũ'))
  const d = deferred<string>()
  reg.start('finish:v', d.promise)
  assert.equal(reg.lookup('finish:v')?.state, 'running')
  d.resolve('mới')
  await d.promise
  await Promise.resolve()
  assert.deepEqual(reg.lookup('finish:v'), { state: 'settled', value: 'mới' })
})

test('promise bị reject: dọn lượt chờ, không giữ kết quả', async () => {
  const reg = createRunRegistry()
  await assert.rejects(reg.start('script:e', Promise.reject(new Error('x'))))
  assert.equal(reg.isRunning('script:e'), false)
  assert.equal(reg.lookup('script:e'), null)
})

test('runKey / runKeyNodeId', () => {
  assert.equal(runKey.job('job-1', 'outfit-2'), 'job:job-1::outfit-2')
  assert.equal(runKeyNodeId(runKey.job('job-1', 'outfit-2')), 'job-1')
  assert.equal(runKeyNodeId(runKey.script('script-abc-3')), 'script-abc-3')
  assert.equal(runKeyNodeId(runKey.finish('v')), 'v')
})
