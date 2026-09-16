import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createAssetUploadManager } from '../services/assetUpload.ts'

const file = (name = 'photo.png') => new File(['image'], name, { type: 'image/png' })
const asset = (id = 'server', kind = 'product') => ({
  id, kind, previewUrl: `/assets/${id}`, backendPath: `/storage/${id}.png`, uploadStatus: 'uploaded',
})
const deferred = () => {
  let resolve, reject
  const promise = new Promise((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function setup(t, options = {}) {
  const changes = []
  const manager = createAssetUploadManager({
    readPreview: async () => 'data:image/png;base64,aW1hZ2U=',
    upload: async () => asset(),
    ...options,
    onChange: (slot, url, value) => changes.push({ slot, url, asset: value }),
  })
  t.after(() => manager.dispose())
  return { manager, changes }
}

test('emits a fresh uploading asset synchronously, then a persistent preview and uploaded path', async (t) => {
  const pending = deferred()
  const { manager, changes } = setup(t, { upload: () => pending.promise })
  manager.replace(0, '/old.png', asset('old'))
  const work = manager.start(0, file(), 'product')
  const placeholder = changes.at(-1).asset
  assert.equal(placeholder.uploadStatus, 'uploading')
  assert.match(placeholder.id, /^upload-/)
  assert.match(placeholder.previewUrl, /^blob:/)
  assert.equal(placeholder.backendPath, undefined)
  assert.equal(placeholder.fileName, 'photo.png')
  await Promise.resolve()
  assert.match(changes.at(-1).url, /^data:image/)
  assert.equal(changes.at(-1).asset.id, placeholder.id)
  pending.resolve(asset('new'))
  await work
  assert.equal(changes.at(-1).asset.uploadStatus, 'uploaded')
  assert.equal(changes.at(-1).asset.backendPath, '/storage/new.png')
  assert.equal(changes.at(-1).url, changes.at(-1).asset.previewUrl)
})

for (const outcome of ['resolve', 'reject']) {
  test(`replacement ignores stale upload ${outcome}`, async (t) => {
    const old = deferred()
    const current = deferred()
    const { manager, changes } = setup(t, { upload: (value) => value.name === 'old.png' ? old.promise : current.promise })
    const first = manager.start(0, file('old.png'), 'product')
    await Promise.resolve()
    const second = manager.start(0, file('new.png'), 'product')
    await Promise.resolve()
    current.resolve(asset('new'))
    await second
    const count = changes.length
    old[outcome](outcome === 'resolve' ? asset('old') : new Error('old failed'))
    await first
    assert.equal(changes.length, count)
    assert.equal(changes.at(-1).asset.id, 'new')
  })

  test(`remove ignores stale upload ${outcome} and emits explicit null asset`, async (t) => {
    const pending = deferred()
    const { manager, changes } = setup(t, { upload: () => pending.promise })
    const work = manager.start('sceneImage', file(), 'scene')
    await Promise.resolve()
    manager.remove('sceneImage')
    const count = changes.length
    pending[outcome](outcome === 'resolve' ? asset() : new Error('late failure'))
    await work
    assert.equal(changes.length, count)
    assert.deepEqual(changes.at(-1), { slot: 'sceneImage', url: null, asset: null })
    assert.equal(manager.canRetry('sceneImage'), false)
  })

  test(`unmount disposal suppresses upload ${outcome} and any later actions`, async (t) => {
    const pending = deferred()
    const { manager, changes } = setup(t, { upload: () => pending.promise })
    const work = manager.start(0, file(), 'product')
    await Promise.resolve()
    manager.dispose()
    const count = changes.length
    pending[outcome](outcome === 'resolve' ? asset() : new Error('late failure'))
    await work
    await manager.start(1, file(), 'product')
    manager.replace(0, '/library.png', asset('library'))
    manager.remove(0)
    assert.equal(changes.length, count)
  })
}

test('library replacement invalidates a pending upload', async (t) => {
  const pending = deferred()
  const { manager, changes } = setup(t, { upload: () => pending.promise })
  const work = manager.start(0, file(), 'product')
  await Promise.resolve()
  manager.replace(0, '/library.png', asset('library'))
  const count = changes.length
  pending.resolve(asset('obsolete'))
  await work
  assert.equal(changes.length, count)
  assert.equal(changes.at(-1).asset.id, 'library')
})

test('slots complete independently with the correct product/model/scene kind', async (t) => {
  const pending = [deferred(), deferred(), deferred()]
  const kinds = ['product', 'model', 'scene']
  const received = []
  const { manager, changes } = setup(t, {
    upload: (value, kind) => { received.push(kind); return pending[Number(value.name)].promise },
  })
  const work = kinds.map((kind, slot) => manager.start(slot, file(String(slot)), kind))
  await Promise.resolve()
  for (const slot of [2, 0, 1]) pending[slot].resolve(asset(String(slot), kinds[slot]))
  await Promise.all(work)
  assert.deepEqual(received, kinds)
  for (const [slot, kind] of kinds.entries()) {
    const last = changes.filter(change => change.slot === slot).at(-1).asset
    assert.equal(last.kind, kind)
    assert.equal(last.uploadStatus, 'uploaded')
  }
})

test('failure emits error without an old path; retry reuses the file with a new placeholder', async (t) => {
  const uploadedFiles = []
  const { manager, changes } = setup(t, {
    upload: async (value) => {
      uploadedFiles.push(value)
      if (uploadedFiles.length === 1) throw new Error('HTTP 503: unavailable')
      return asset('recovered')
    },
  })
  const selected = file()
  await manager.start('modelImage', selected, 'model')
  const failed = changes.at(-1).asset
  assert.equal(failed.uploadStatus, 'error')
  assert.equal(failed.error, 'HTTP 503: unavailable')
  assert.equal(failed.backendPath, undefined)
  assert.equal(manager.canRetry('modelImage'), true)
  const retry = manager.retry('modelImage')
  assert.equal(changes.at(-1).asset.uploadStatus, 'uploading')
  assert.notEqual(changes.at(-1).asset.id, failed.id)
  assert.equal(changes.at(-1).asset.error, undefined)
  await retry
  assert.deepEqual(uploadedFiles, [selected, selected])
  assert.equal(changes.at(-1).asset.uploadStatus, 'uploaded')
  assert.equal(manager.canRetry('modelImage'), false)
})

for (const action of ['remove', 'replace', 'dispose']) {
  test(`${action} aborts preview reading, releases the blob and ignores its late completion`, async (t) => {
    const reading = deferred()
    let signal
    let uploads = 0
    const revoke = t.mock.method(URL, 'revokeObjectURL')
    const { manager, changes } = setup(t, {
      readPreview: (_file, value) => { signal = value; return reading.promise },
      upload: async () => { uploads++; return asset() },
    })
    const work = manager.start(0, file(), 'product')
    const blob = changes.at(-1).url
    if (action === 'replace') manager.replace(0, '/library.png', asset('library'))
    else manager[action](0)
    assert.equal(signal.aborted, true)
    assert.ok(revoke.mock.calls.some(call => call.arguments[0] === blob))
    const count = changes.length
    reading.resolve('data:image/png;base64,b2xk')
    await work
    assert.equal(uploads, 0)
    assert.equal(changes.length, count)
  })
}

test('slow preview from the previous file cannot overwrite its replacement', async (t) => {
  const reading = deferred()
  const uploadedFiles = []
  const { manager, changes } = setup(t, {
    readPreview: (value) => value.name === 'old.png' ? reading.promise : Promise.resolve('data:new'),
    upload: async (value) => { uploadedFiles.push(value.name); return asset('new') },
  })
  const old = manager.start(0, file('old.png'), 'product')
  await manager.start(0, file('new.png'), 'product')
  const count = changes.length
  reading.resolve('data:old')
  await old
  assert.deepEqual(uploadedFiles, ['new.png'])
  assert.equal(changes.length, count)
  assert.equal(changes.at(-1).url, 'data:new')
})

test('preview read failure is visible and retryable without starting an upload', async (t) => {
  let uploads = 0
  const { manager, changes } = setup(t, {
    readPreview: async () => { throw new Error('Cannot read image') },
    upload: async () => { uploads++; return asset() },
  })
  await manager.start(0, file(), 'product')
  assert.equal(uploads, 0)
  assert.equal(changes.at(-1).asset.uploadStatus, 'error')
  assert.equal(changes.at(-1).asset.error, 'Cannot read image')
  assert.equal(manager.canRetry(0), true)
})

test('malformed upload success is surfaced as an error', async (t) => {
  const { manager, changes } = setup(t, { upload: async () => ({ ...asset(), backendPath: ' ' }) })
  await manager.start(0, file(), 'product')
  assert.equal(changes.at(-1).asset.uploadStatus, 'error')
  assert.ok(changes.at(-1).asset.error)
  assert.equal(changes.at(-1).asset.backendPath, undefined)
})

test('non-Error rejection still emits an actionable error', async (t) => {
  const { manager, changes } = setup(t, { upload: async () => { throw null } })
  await manager.start(0, file(), 'product')
  assert.equal(changes.at(-1).asset.uploadStatus, 'error')
  assert.ok(changes.at(-1).asset.error)
})
