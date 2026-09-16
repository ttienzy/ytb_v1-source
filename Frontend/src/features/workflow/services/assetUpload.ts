import type { AssetRef } from '../contracts'

type Slot = string | number
type Upload = (file: File, kind: AssetRef['kind']) => Promise<AssetRef>

interface UploadOptions<S extends Slot> {
  upload: Upload
  onChange: (slot: S, previewUrl: string | null, asset: AssetRef | null) => void
  readPreview?: (file: File, signal: AbortSignal) => Promise<string>
}

interface Request {
  file: File
  asset: AssetRef
  controller: AbortController
  objectUrl?: string
}

function readPreview(file: File, signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    const abort = () => reader.abort()
    const cleanup = () => signal.removeEventListener('abort', abort)
    reader.onload = () => {
      cleanup()
      if (typeof reader.result === 'string') resolve(reader.result)
      else reject(new Error('Không thể đọc ảnh đã chọn.'))
    }
    reader.onerror = () => {
      cleanup()
      reject(reader.error || new Error('Không thể đọc ảnh đã chọn.'))
    }
    reader.onabort = () => {
      cleanup()
      reject(new Error('Đã hủy đọc ảnh.'))
    }
    if (signal.aborted) {
      reject(new Error('Đã hủy đọc ảnh.'))
      return
    }
    signal.addEventListener('abort', abort, { once: true })
    try {
      reader.readAsDataURL(file)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

/** Each slot owns its latest request. The API has no abort support, so late
 * responses are ignored; preview reads and object URLs are cleaned up locally. */
export function createAssetUploadManager<S extends Slot>(options: UploadOptions<S>) {
  const requests = new Map<S, Request>()
  let disposed = false

  const releasePreview = (request: Request) => {
    if (request.objectUrl) URL.revokeObjectURL(request.objectUrl)
    request.objectUrl = undefined
  }
  const invalidate = (slot: S) => {
    const previous = requests.get(slot)
    requests.delete(slot)
    if (previous) {
      previous.controller.abort()
      releasePreview(previous)
    }
  }
  const isCurrent = (slot: S, request: Request) => !disposed && requests.get(slot) === request
  const emit = (slot: S, request: Request) => {
    options.onChange(slot, request.asset.previewUrl, request.asset)
  }

  const start = async (slot: S, file: File, kind: AssetRef['kind']) => {
    if (disposed) return
    invalidate(slot)
    const request: Request = {
      file,
      controller: new AbortController(),
      // Never merge the prior asset: its backend path must disappear immediately.
      asset: {
        id: `upload-${crypto.randomUUID()}`,
        kind,
        fileName: file.name,
        previewUrl: '',
        backendPath: undefined,
        uploadStatus: 'uploading',
      },
    }
    requests.set(slot, request)
    try {
      request.objectUrl = URL.createObjectURL(file)
      request.asset.previewUrl = request.objectUrl
    } catch (error) {
      request.asset = { ...request.asset, uploadStatus: 'error', error: errorMessage(error) }
      emit(slot, request)
      return
    }
    emit(slot, request)
    try {
      const previewUrl = await (options.readPreview || readPreview)(file, request.controller.signal)
      if (!isCurrent(slot, request)) return
      request.asset = { ...request.asset, previewUrl }
      emit(slot, request)
      releasePreview(request)
      const uploaded = await options.upload(file, kind)
      if (!isCurrent(slot, request)) return
      if (!uploaded.id || !uploaded.backendPath?.trim()) {
        throw new Error('Máy chủ không trả về đường dẫn ảnh. Vui lòng thử lại.')
      }
      request.asset = { ...uploaded, kind, previewUrl, uploadStatus: 'uploaded', error: undefined }
    } catch (error) {
      if (!isCurrent(slot, request)) return
      releasePreview(request)
      request.asset = { ...request.asset, backendPath: undefined, uploadStatus: 'error', error: errorMessage(error) }
    }
    if (isCurrent(slot, request)) emit(slot, request)
  }

  return {
    start,
    retry(slot: S) {
      const request = requests.get(slot)
      if (request?.asset.uploadStatus === 'error') return start(slot, request.file, request.asset.kind)
    },
    replace(slot: S, previewUrl: string, asset: AssetRef) {
      if (disposed) return
      invalidate(slot)
      options.onChange(slot, previewUrl, asset)
    },
    remove(slot: S) {
      if (disposed) return
      invalidate(slot)
      options.onChange(slot, null, null)
    },
    canRetry(slot: S) {
      return requests.get(slot)?.asset.uploadStatus === 'error'
    },
    dispose() {
      disposed = true
      for (const slot of requests.keys()) invalidate(slot)
    },
  }
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Tải ảnh thất bại. Vui lòng thử lại.'
}
