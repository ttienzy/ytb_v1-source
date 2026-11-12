import { useCallback, useEffect, useRef, useState } from 'react'
import { API_URL } from '../../shared/constants'
import {
  normalizeOptions,
  type Aspect,
  type BlurOptions,
  type DoneItem,
  type MergedItem,
  type Options,
  type ProcessProgress,
  type SavedState,
  type VideoItem,
} from './videoModel'

const PRESET_KEY = 'video-preset'
const FOLDER_KEY = 'video-custom-output-folder'

async function errorDetail(response: Response, fallback: string): Promise<string> {
  try {
    const data = await response.json()
    return data.detail || fallback
  } catch {
    return fallback // phản hồi không phải JSON
  }
}

function readStoredOptions(): Options {
  try {
    return normalizeOptions(JSON.parse(localStorage.getItem(PRESET_KEY) || '{}'))
  } catch {
    return normalizeOptions(null)
  }
}

export interface MergeRequest {
  aspect: Aspect
  seconds: number
  /** random: chọn ngẫu nhiên từ kho hoàn tất; manual: dùng đúng các video đã chọn. */
  mode: 'random' | 'manual'
  doneIds: string[]
}

export interface MergeResult {
  file_name: string
  duration_sec: number
  source_count: number
}

/** Toàn bộ trạng thái + thao tác gọi API của trang Video (kho nguồn, chỉnh sửa/xử lý, kho hoàn tất, gộp). */
export function useVideoWorkspace(onLibraryChanged?: () => void) {
  const changedRef = useRef(onLibraryChanged)
  changedRef.current = onLibraryChanged

  const [videos, setVideos] = useState<VideoItem[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [options, setOptions] = useState<Options>(readStoredOptions)
  const [done, setDone] = useState<DoneItem[]>([])
  const [merged, setMerged] = useState<MergedItem[]>([])
  const [savedStates, setSavedStates] = useState<SavedState[]>([])
  const [outputFolder, setOutputFolder] = useState(() => localStorage.getItem(FOLDER_KEY) || '')
  const [busy, setBusy] = useState(false)
  const [youtubeBusy, setYoutubeBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState<Record<string, ProcessProgress>>({})
  const [mergeBusy, setMergeBusy] = useState(false)
  const [mergeMessage, setMergeMessage] = useState('')
  const [mergeResult, setMergeResult] = useState<MergeResult | null>(null)

  const setOption = useCallback(<K extends keyof Options>(key: K, value: Options[K]) => setOptions(current => ({ ...current, [key]: value })), [])
  const setBlur = useCallback((key: keyof BlurOptions, value: number | boolean) => setOptions(current => ({ ...current, blur: { ...current.blur, [key]: value } })), [])

  const load = useCallback(() => fetch(`${API_URL}/api/video/library`).then(r => r.json()).then((items: VideoItem[]) => {
    setVideos(items)
    changedRef.current?.()
  }).catch(() => setMessage('Không kết nối được Backend.')), [])
  const loadDone = useCallback(() => fetch(`${API_URL}/api/video/done`).then(r => r.json()).then(setDone).catch(() => {}), [])
  const loadMerged = useCallback(() => fetch(`${API_URL}/api/video/merge`).then(r => r.json()).then(setMerged).catch(() => {}), [])
  const loadStates = useCallback(() => fetch(`${API_URL}/api/video/presets`).then(r => r.json()).then(setSavedStates).catch(() => {}), [])

  useEffect(() => {
    load(); loadDone(); loadMerged(); loadStates()
    if (!localStorage.getItem(PRESET_KEY)) {
      fetch(`${API_URL}/api/video/preset`).then(r => (r.ok ? r.json() : {})).then(p => { if (p.aspect) setOptions(normalizeOptions(p)) }).catch(() => {})
    }
  }, [load, loadDone, loadMerged, loadStates])

  // ── Kho video nguồn ────────────────────────────────────────────────────────
  const upload = useCallback(async (files: FileList | File[] | null) => {
    const list = files ? Array.from(files) : []
    if (!list.length) return
    setBusy(true)
    const body = new FormData()
    list.forEach(file => body.append('files', file))
    try {
      const response = await fetch(`${API_URL}/api/video/library`, { method: 'POST', body })
      if (!response.ok) throw new Error(await errorDetail(response, `Lỗi ${response.status}`))
      await load()
      setMessage(`Đã nhập ${list.length} video vào kho.`)
    } catch (error) {
      setMessage(`Nhập video thất bại: ${error instanceof Error ? error.message : 'không rõ lỗi'}`)
    } finally {
      setBusy(false)
    }
  }, [load])

  const importYoutube = useCallback(async (url: string): Promise<boolean> => {
    if (!url.trim()) { setMessage('Hãy nhập link YouTube.'); return false }
    setYoutubeBusy(true)
    setMessage('Đang tải video YouTube…')
    const body = new FormData()
    body.append('url', url.trim())
    try {
      const response = await fetch(`${API_URL}/api/video/youtube`, { method: 'POST', body })
      if (!response.ok) throw new Error(await errorDetail(response, `Lỗi ${response.status}`))
      const item = await response.json()
      await load()
      setSelected(current => [...current, item.video_id])
      setMessage('Đã tải video YouTube vào kho.')
      return true
    } catch (error) {
      setMessage(`Tải YouTube thất bại: ${error instanceof Error ? error.message : 'kiểm tra link, yt-dlp hoặc đăng nhập YouTube'}`)
      return false
    } finally {
      setYoutubeBusy(false)
    }
  }, [load])

  const remove = useCallback(async (id: string) => {
    await fetch(`${API_URL}/api/video/library/${id}`, { method: 'DELETE' })
    setSelected(current => current.filter(value => value !== id))
    load()
  }, [load])

  const toggleSelected = useCallback((id: string) => setSelected(current => (current.includes(id) ? current.filter(value => value !== id) : [...current, id])), [])
  const toggleAll = useCallback(() => setSelected(current => (current.length === videos.length ? [] : videos.map(video => video.video_id))), [videos])

  // ── Chỉnh sửa / xử lý ──────────────────────────────────────────────────────
  const uploadBackground = useCallback(async (file: File | undefined): Promise<boolean> => {
    if (!file) return false
    setBusy(true)
    const body = new FormData()
    body.append('file', file)
    try {
      const response = await fetch(`${API_URL}/api/video/background`, { method: 'POST', body })
      if (!response.ok) throw new Error(await errorDetail(response, `Lỗi ${response.status}`))
      const item = await response.json()
      setOption('background_image', item.background_id)
      setMessage(`Đã chọn ảnh nền: ${file.name}`)
      return true
    } catch (error) {
      setMessage(`Không tải được ảnh nền: ${error instanceof Error ? error.message : 'không rõ lỗi'}`)
      return false
    } finally {
      setBusy(false)
    }
  }, [setOption])

  const chooseFolder = useCallback(async () => {
    try {
      if (!window.desktop?.chooseVideoFolder) { setMessage('Chức năng chọn thư mục chỉ hoạt động trong Electron.'); return }
      const folder = await window.desktop.chooseVideoFolder()
      if (folder) { setOutputFolder(folder); localStorage.setItem(FOLDER_KEY, folder); setMessage(`Đã chọn nơi lưu thêm: ${folder}`) }
      else setMessage('Bạn đã hủy chọn nơi lưu thêm.')
    } catch (error) {
      setMessage(`Không mở được hộp chọn thư mục: ${error instanceof Error ? error.message : 'không rõ lỗi'}`)
    }
  }, [])

  const process = useCallback(async () => {
    if (!selected.length) { setMessage('Hãy chọn ít nhất một video.'); return }
    setBusy(true)
    setProgress(Object.fromEntries(selected.map(id => [id, { percent: 0, status: 'processing' as const }])))
    setMessage(`Đang xử lý 0/${selected.length} video…`)
    try {
      for (let index = 0; index < selected.length; index += 1) {
        const id = selected[index]
        const body = new FormData()
        body.append('video_ids', id)
        body.append('options', JSON.stringify(options))
        try {
          const response = await fetch(`${API_URL}/api/video/process`, { method: 'POST', body })
          if (!response.ok) throw new Error(await errorDetail(response, `Backend trả về lỗi ${response.status}`))
          const { job_id: jobId } = await response.json() as { job_id: string }
          const deadline = Date.now() + 30 * 60 * 1000
          let status: { status: string; progress: number; phase?: string; error?: string } | null = null
          while (Date.now() < deadline) {
            const statusResponse = await fetch(`${API_URL}/api/video/process/${jobId}`)
            if (!statusResponse.ok) throw new Error(`Không đọc được tiến trình (HTTP ${statusResponse.status}).`)
            status = await statusResponse.json()
            const percent = Math.max(0, Math.min(100, status?.progress || 0))
            setProgress(current => ({ ...current, [id]: { percent, phase: status?.phase, status: status?.status === 'completed' ? 'done' : 'processing' } }))
            setMessage(`Video ${index + 1}/${selected.length} · ${status?.phase || 'Đang xử lý…'} · ${percent}%`)
            if (status?.status === 'completed') break
            if (status?.status === 'error') throw new Error(status.error || 'FFmpeg xử lý thất bại.')
            await new Promise(resolve => window.setTimeout(resolve, 700))
          }
          if (!status || status.status !== 'completed') throw new Error('Xử lý quá lâu (hơn 30 phút), đã tự dừng để tránh treo ứng dụng.')
          const fileResponse = await fetch(`${API_URL}/api/video/process/${jobId}/file`)
          if (!fileResponse.ok) throw new Error(`Không tải được video đầu ra (HTTP ${fileResponse.status}).`)
          const blob = await fileResponse.blob()
          if (outputFolder && window.desktop) {
            const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17)
            const name = `video_${stamp}_${id}_${options.aspect.replace(':', 'x')}.mp4`
            try { await window.desktop.saveVideoFile(outputFolder, name, await blob.arrayBuffer()) }
            catch (error) { throw new Error(`Không ghi được vào nơi lưu thêm: ${error instanceof Error ? error.message : 'không rõ lỗi'}`) }
          }
          setProgress(current => ({ ...current, [id]: { percent: 100, phase: 'Hoàn tất', status: 'done' } }))
          await loadDone()
          setMessage(`Đang xử lý ${index + 1}/${selected.length} video…`)
        } catch (error) {
          const detail = error instanceof Error ? error.message : 'Xử lý video thất bại.'
          setProgress(current => ({ ...current, [id]: { percent: current[id]?.percent || 0, phase: 'Đã xảy ra lỗi', status: 'error', error: detail } }))
          throw error
        }
      }
      await loadDone()
      setMessage(`Đã hoàn tất ${selected.length} video trong Data/media/videos/processed${outputFolder ? ' và nơi lưu thêm' : ''}.`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Xử lý video thất bại.'
      setMessage(`Lỗi: ${detail}`)
      window.alert(`Xử lý video thất bại\n\n${detail}`)
    } finally {
      setBusy(false)
    }
  }, [selected, options, outputFolder, loadDone])

  // ── State (preset) đã lưu ──────────────────────────────────────────────────
  const savePreset = useCallback(async (name: string): Promise<boolean> => {
    const trimmed = name.trim()
    if (!trimmed) { setMessage('Hãy nhập tên state trước khi lưu.'); return false }
    localStorage.setItem(PRESET_KEY, JSON.stringify(options))
    try {
      const response = await fetch(`${API_URL}/api/video/presets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: trimmed, options }) })
      if (!response.ok) throw new Error()
      await loadStates()
      setMessage(`Đã lưu state “${trimmed}”.`)
      return true
    } catch {
      setMessage('Không lưu được state.')
      return false
    }
  }, [options, loadStates])

  const applyPreset = useCallback((state: SavedState) => {
    setOptions(normalizeOptions(state.options))
    localStorage.setItem(PRESET_KEY, JSON.stringify(state.options))
    setMessage(`Đã áp dụng state “${state.name}”.`)
  }, [])

  // ── Gộp ────────────────────────────────────────────────────────────────────
  const runMerge = useCallback(async (request: MergeRequest) => {
    if (!request.seconds) { setMergeMessage('Hãy nhập thời lượng muốn gộp.'); return }
    if (request.mode === 'manual' && !request.doneIds.length) { setMergeMessage('Hãy chọn ít nhất một video để gộp.'); return }
    setMergeBusy(true)
    setMergeMessage('Đang chọn video và gộp…')
    setMergeResult(null)
    try {
      const response = await fetch(`${API_URL}/api/video/merge`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_seconds: request.seconds, done_ids: request.mode === 'manual' ? request.doneIds : [], randomize: request.mode === 'random', aspect: request.aspect }),
      })
      if (!response.ok) throw new Error(await errorDetail(response, `Backend trả về lỗi ${response.status}`))
      const result = await response.json() as MergeResult
      setMergeResult(result)
      await loadMerged()
      setMergeMessage(`Đã gộp ${result.source_count} video · ${Math.round(result.duration_sec)} giây.`)
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Gộp video thất bại.'
      setMergeMessage(`Lỗi: ${detail}`)
      window.alert(`Gộp video thất bại\n\n${detail}`)
    } finally {
      setMergeBusy(false)
    }
  }, [loadMerged])

  return {
    videos, selected, toggleSelected, toggleAll, upload, importYoutube, remove,
    options, setOption, setBlur, uploadBackground, chooseFolder, outputFolder, process, progress,
    savedStates, savePreset, applyPreset,
    done, merged, runMerge, mergeBusy, mergeMessage, mergeResult,
    busy, youtubeBusy, message,
  }
}

export type VideoWorkspace = ReturnType<typeof useVideoWorkspace>
