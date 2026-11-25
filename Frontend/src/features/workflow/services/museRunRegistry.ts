/**
 * Muse Canvas — lượt chạy đang chờ của các node (thuần TS, không React/DOM, để node:test chạy được).
 *
 * Node gửi request (Muse / ChatGPT / xuất video) rồi chờ ngay trong frontend. Node có thể bị gỡ khỏi màn hình giữa
 * chừng (đổi tab, đổi project Muse Canvas): request vẫn chạy, nhưng node không còn để nhận kết quả. Registry giữ:
 * - `running`: promise đang chờ — node hiện lại thì gắn tiếp, không gửi lại (mỗi lần gửi tốn lượt);
 * - `settled`: kết quả đã về mà node CHƯA nhận — giữ tới khi node hiện lại và nhận (`done`), lưu cả localStorage
 *   để F5 / mở lại app sau khi kết quả đã về vẫn còn (quá SETTLED_TTL_MS thì bỏ).
 * Khóa có tiền tố theo loại lượt: `job:<node>::<nguồn>`, `script:<node>`, `scriptVideo:<node>`, `clipScript:<node>`, `finish:<node>`.
 */

export interface RunStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface SettledEntry {
  value: unknown
  at: number
}

export type RunLookup<T> = { state: 'settled'; value: T } | { state: 'running'; promise: Promise<T> } | null

export interface RunRegistry {
  isRunning(key: string): boolean
  /** Ghi nhận lượt mới (thay kết quả cũ chưa nhận của cùng khóa); trả promise kết quả. */
  start<T>(key: string, job: Promise<T>): Promise<T>
  /** Kết quả chưa nhận được ưu tiên hơn promise (giữa lúc vừa có kết quả và lúc dọn promise). */
  lookup<T>(key: string): RunLookup<T>
  /** Node đã nhận kết quả: bỏ khỏi registry. */
  done(key: string): void
  /** Số lượt đang chờ có khóa thỏa điều kiện (vd. của các node trong project đang mở). */
  runningKeys(): string[]
}

export const SETTLED_STORAGE_KEY = 'muse_canvas_settled_v1'
export const SETTLED_TTL_MS = 7 * 24 * 60 * 60 * 1000

export function createRunRegistry(storage: RunStorage | null = null, now: () => number = Date.now): RunRegistry {
  const running = new Map<string, Promise<unknown>>()
  const settled: Record<string, SettledEntry> = {}

  try {
    const raw = storage?.getItem(SETTLED_STORAGE_KEY)
    const saved = raw ? JSON.parse(raw) : null
    if (saved && typeof saved === 'object') {
      for (const [k, e] of Object.entries(saved as Record<string, SettledEntry>)) {
        if (e && typeof e.at === 'number' && now() - e.at < SETTLED_TTL_MS) settled[k] = e
      }
    }
  } catch {
    /* bản lưu hỏng: bỏ qua */
  }

  const persist = () => {
    try {
      storage?.setItem(SETTLED_STORAGE_KEY, JSON.stringify(settled))
    } catch {
      /* localStorage đầy / bị chặn: vẫn còn trong bộ nhớ */
    }
  }

  return {
    isRunning: (key) => running.has(key),
    start<T>(key: string, job: Promise<T>): Promise<T> {
      if (key in settled) {
        delete settled[key]
        persist()
      }
      const tracked = job.then(
        (value) => {
          settled[key] = { value, at: now() }
          persist()
          running.delete(key)
          return value
        },
        (err) => {
          running.delete(key)
          throw err
        },
      )
      running.set(key, tracked)
      return tracked
    },
    lookup<T>(key: string): RunLookup<T> {
      if (key in settled) return { state: 'settled', value: settled[key].value as T }
      const p = running.get(key)
      return p ? { state: 'running', promise: p as Promise<T> } : null
    },
    done(key) {
      if (key in settled) {
        delete settled[key]
        persist()
      }
    },
    runningKeys: () => [...running.keys()],
  }
}

function browserStorage(): RunStorage | null {
  try {
    return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null
  } catch {
    return null
  }
}

/** Registry dùng chung của app — giữ trên globalThis để Vite nạp lại module không làm mất lượt đang chờ. */
const G = globalThis as unknown as { __museRunRegistry?: RunRegistry }
export const museRuns: RunRegistry = (G.__museRunRegistry ??= createRunRegistry(browserStorage()))

/** Khóa lượt chạy của từng loại node. */
export const runKey = {
  job: (nodeId: string, sourceId: string) => `job:${nodeId}::${sourceId}`,
  script: (nodeId: string) => `script:${nodeId}`,
  scriptVideo: (nodeId: string) => `scriptVideo:${nodeId}`,
  clipScript: (nodeId: string) => `clipScript:${nodeId}`,
  finish: (nodeId: string) => `finish:${nodeId}`,
  /** node Ingredients / Tạo video Flow: tải video tham chiếu lên Flow + gửi job (job Flow sau đó chạy ở backend) */
  videoIngr: (nodeId: string) => `videoIngr:${nodeId}`,
  /** node Cắt video: ghép các đoạn giữ lại thành 1 video mới (ffmpeg ở backend, vài giây) */
  videoCut: (nodeId: string) => `videoCut:${nodeId}`,
  /** node Tách khung hình: tách 1 khung PNG từ video bằng ffmpeg (0 credit) */
  frameExtract: (nodeId: string) => `frameExtract:${nodeId}`,
  /** node Tạo ảnh tự do: tạo 1 ảnh bằng Muse hoặc ChatGPT */
  freeImage: (nodeId: string) => `freeImage:${nodeId}`,
}

/** Id node trong một khóa lượt chạy (để biết lượt thuộc node nào / project nào). */
export function runKeyNodeId(key: string): string {
  const body = key.slice(key.indexOf(':') + 1)
  const cut = body.indexOf('::')
  return cut >= 0 ? body.slice(0, cut) : body
}
