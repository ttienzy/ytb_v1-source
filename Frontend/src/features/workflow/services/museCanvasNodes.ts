/**
 * Muse Canvas — định nghĩa node (thuần TS, không React/DOM, để node:test chạy được).
 *
 *   [Trang phục] ──┐                                   ┌─> [Ảnh kết quả]
 *   [Trang phục] ──┼──images──> [Tách áo quần] ──extracted──┼─> [Ảnh kết quả]
 *   [Trang phục] ──┘                                   └─> …
 *   [Nhân vật tham chiếu] ──images──> [Bảng thiết kế nhân vật] ──extracted──> [Ảnh kết quả]
 *   [Ảnh kết quả (từ Tách áo quần)] ──outfits──┘   (tùy chọn: mỗi cặp nhân vật × trang phục = 1 bảng)
 *   [Ảnh kết quả | Nhân vật tham chiếu | Trang phục] × N ──boards──> [Kịch bản video]
 *       (mọi ảnh tham chiếu gửi chung 1 lần Muse → 1 kịch bản chữ; Muse tự gom ảnh cùng bộ)
 *   [Kịch bản video] ──script──> [Kịch bản]   (nút "Ra node": tách bản kịch bản ra node riêng, sửa được)
 *   [Ảnh kết quả | Nhân vật | Trang phục] ──boards──┘   (tham chiếu cho nút "Tạo video" của node Kịch bản)
 *   [Kịch bản] ──video──> [Video kết quả]   (nút "Ra node": tách video đã tạo ra node riêng)
 *
 * Hai họ node:
 * - Node ẢNH VÀO (INPUT_SPECS): đúng 1 ảnh/node (Trang phục, Nhân vật tham chiếu).
 * - Node CHẠY MUSE (JOB_SPECS): nhận dây từ nhiều node ảnh vào cùng loại; mỗi node nối vào chạy 1 lần Muse
 *   (prompt của node + ảnh đó) và cho 1 ảnh. Kết quả lưu theo id node nguồn.
 * - Node "Ảnh kết quả": tách 1 ảnh đã tạo ra node riêng (giữ ảnh, nhớ nguồn) để dùng / nối tiếp.
 * Mọi node độc lập, thêm / xóa tự do.
 */
import { museGenerateOptions, type MuseCanvasConfig } from './museCanvasConfig.ts'

/** Id type node — giữ nguyên các id đã có: đồ thị đã lưu tham chiếu tới chúng. */
export const MUSE_NODE = {
  outfit: 'museOutfitImage',
  extract: 'museOutfitPrompt',
  character: 'museCharacterImage',
  characterSheet: 'museCharacterSheet',
  output: 'museOutputImage',
  script: 'museVideoScript',
  scriptText: 'museScriptText',
  videoOutput: 'museVideoOutput',
  /** "Kịch bản tạo video" (ChatGPT): mỗi ảnh tham chiếu → 1 kịch bản clip ≤ 15 s, có mối nối giữa các clip */
  clipScript: 'gptClipScript',
  /** "Clip": 1 kịch bản clip tách từ Kịch bản tạo video (prompt video sửa được) */
  clipPrompt: 'gptClipPrompt',
  /** "Ghép video": ghép các clip Flow đã tạo (xóa watermark, nhạc, nhãn kênh) */
  clipMerge: 'gptClipMerge',
} as const

/** Loại dây (có nút X để gỡ) — đăng ký ở MUSE_EDGE_TYPES của workspace. */
export const MUSE_EDGE_TYPE = 'museLink'

/** Handle id — cũng giữ ổn định vì dây đã lưu tham chiếu tới chúng. */
export const MUSE_HANDLE = {
  /** node ảnh vào → node chạy Muse */
  imagesOut: 'images',
  imagesIn: 'images',
  /** node chạy Muse → node Ảnh kết quả */
  jobOut: 'extracted',
  /** node Ảnh kết quả (vào / ra) */
  imageIn: 'image',
  imageOut: 'image',
  /** Ảnh kết quả (trang phục đã tách) → cổng phụ của Bảng thiết kế nhân vật */
  outfitsIn: 'outfits',
  /** Mọi ảnh tham chiếu → cổng "Tham chiếu" của node Kịch bản video (nhiều dây, theo thứ tự). Id giữ 'boards'. */
  refsIn: 'boards',
  boardsIn: 'boards',
  /** Cổng "Nhân vật" riêng của bản đầu — dây cũ được chuyển sang cổng Tham chiếu (normalizeMuseEdges). */
  legacyIdentityIn: 'identity',
  /** Kịch bản video → node "Kịch bản" (bản kịch bản tách riêng; mỗi node 1 nguồn) */
  scriptOut: 'script',
  scriptIn: 'script',
  /** node Kịch bản → node "Video kết quả" (mỗi node video 1 nguồn) */
  videoOut: 'video',
  videoIn: 'video',
  /** Kịch bản tạo video → node Clip */
  clipOut: 'clips',
  clipIn: 'clip',
  /** node Clip (video đã tạo) → node Ghép video */
  clipVideoOut: 'clipvideo',
  clipVideoIn: 'clipvideos',
  // tên cũ (giữ cho code / test trước)
  outfitOut: 'images',
  extractIn: 'images',
  extractOut: 'extracted',
} as const

// ---------------------------------------------------------------- mô tả loại node

export interface InputNodeSpec {
  type: string
  title: string
  subtitle: string
  labelPlaceholder: string
  /** Tên dòng mặc định trong node chạy: "<rowLabel> N" */
  rowLabel: string
  /** Node chạy Muse nhận loại ảnh này */
  jobType: string
}

export interface JobNodeSpec {
  type: string
  title: string
  subtitle: string
  /** Tên prompt mặc định ở backend: GET /api/workflow/muse/prompts/{name} (file trong Backend/prompts/workflow) */
  promptName: string
  inputType: string
  /** Chèn vào tên chat Muse và nhãn ảnh trong thư viện */
  chatLabel: string
  /** Hậu tố tên file ảnh tải về: <filePrefix>_<fileSuffix>_... */
  fileSuffix: string
  emptyText: string
  runVerb: string
  /** Danh từ đếm trên nút chạy: "Tách 3 trang phục", "Tạo 2 bảng" */
  unitNoun: string
  doneText: string
  /** Tỉ lệ ảnh khi gạt sang GPT (ghi kèm request; ChatGPT lấy tỉ lệ chủ yếu từ prompt) */
  gptAspect: '16:9' | '9:16' | '1:1'
  /**
   * Prompt mặc định riêng khi gạt sang GPT (tùy chọn). Có thì node giữ prompt GPT riêng (gptPrompt) và KHÔNG ghép
   * prompt kết hợp vì prompt GPT tự gọi tên ảnh 1 / ảnh 2; không có thì GPT dùng chung prompt với Muse.
   */
  gptPromptName?: string
  /** Cổng vào phụ (tùy chọn): nhận ảnh từ node Ảnh kết quả; mỗi cặp ảnh chính × ảnh phụ = 1 dòng. */
  secondary?: {
    handle: string
    title: string
    rowLabel: string
    /** Chỉ nhận node Ảnh kết quả có nguồn là loại node chạy này */
    fromJobType: string
    /** Prompt ghép thêm khi dòng có ảnh phụ (file trong Backend/prompts/workflow) */
    promptName: string
  }
}

export const INPUT_SPECS: Record<string, InputNodeSpec> = {
  [MUSE_NODE.outfit]: {
    type: MUSE_NODE.outfit,
    title: 'Trang phục',
    subtitle: '1 ảnh người mặc bộ đồ cần tách',
    labelPlaceholder: 'Tên bộ đồ (tùy chọn), vd. Áo dài đỏ',
    rowLabel: 'Trang phục',
    jobType: MUSE_NODE.extract,
  },
  [MUSE_NODE.character]: {
    type: MUSE_NODE.character,
    title: 'Nhân vật tham chiếu',
    subtitle: '1 ảnh nhân vật (mặt, dáng, kiểu tóc)',
    labelPlaceholder: 'Tên nhân vật (tùy chọn), vd. Linh',
    rowLabel: 'Nhân vật',
    jobType: MUSE_NODE.characterSheet,
  },
}

export const JOB_SPECS: Record<string, JobNodeSpec> = {
  [MUSE_NODE.extract]: {
    type: MUSE_NODE.extract,
    title: 'Tách áo quần',
    subtitle: 'Mỗi trang phục nối vào → 1 ảnh sản phẩm nền trắng',
    promptName: 'outfit_extract',
    inputType: MUSE_NODE.outfit,
    chatLabel: 'Tách áo quần',
    fileSuffix: 'outfit',
    emptyText: 'Chưa có trang phục — nối dây từ một hoặc nhiều node “Trang phục” vào chấm bên trái.',
    runVerb: 'Tách',
    unitNoun: 'trang phục',
    doneText: 'Đã tách',
    gptAspect: '1:1',
  },
  [MUSE_NODE.characterSheet]: {
    type: MUSE_NODE.characterSheet,
    title: 'Bảng thiết kế nhân vật',
    subtitle: 'Mỗi nhân vật nối vào → 1 bảng character setting 16:9',
    promptName: 'character_sheet',
    inputType: MUSE_NODE.character,
    chatLabel: 'Bảng nhân vật',
    fileSuffix: 'character',
    emptyText: 'Chưa có nhân vật — nối dây từ một hoặc nhiều node “Nhân vật tham chiếu” vào chấm bên trái.',
    runVerb: 'Tạo',
    unitNoun: 'bảng',
    doneText: 'Đã tạo',
    gptAspect: '16:9',
    gptPromptName: 'character_sheet_gpt',
    secondary: {
      handle: 'outfits',
      title: 'Trang phục (tùy chọn)',
      rowLabel: 'Trang phục',
      fromJobType: 'museOutfitPrompt',
      promptName: 'character_outfit',
    },
  },
}

export const isInputType = (t?: string) => !!t && t in INPUT_SPECS
export const isJobType = (t?: string) => !!t && t in JOB_SPECS

/** Tên prompt mặc định của node Tách áo quần (giữ cho code cũ). */
export const OUTFIT_PROMPT_NAME = JOB_SPECS[MUSE_NODE.extract].promptName

/** Giới hạn ảnh của web Muse là 25 MB/ảnh. */
export const OUTFIT_MAX_BYTES = 25 * 1024 * 1024
export const OUTFIT_ACCEPT = ['image/png', 'image/jpeg', 'image/webp'] as const
const OUTFIT_EXT = ['.png', '.jpg', '.jpeg', '.webp']

// ---------------------------------------------------------------- kiểu dữ liệu

export interface MuseImageRef {
  id: string
  name: string
  /** Đường dẫn file trên máy — đây là thứ được gửi cho Muse. */
  path: string
  /** URL tương đối của backend để xem, vd. /api/ai/muse/preview?file=... hoặc /api/workflow/images/{id}/file */
  previewUrl: string
  size: number
}

/** Data của node ảnh vào (Trang phục / Nhân vật tham chiếu). */
export interface MuseInputData {
  title: string
  label: string
  image: MuseImageRef | null
  [key: string]: unknown
}
export type MuseOutfitData = MuseInputData

export type ExtractStatus = 'running' | 'done' | 'error' | 'interrupted'

/** Ai tạo ảnh cho node chạy: Muse (mặc định) hoặc tài khoản ChatGPT (Cài đặt → Tài khoản ChatGPT). */
export type MuseImageProvider = 'muse' | 'gpt'
export const IMAGE_PROVIDERS: { id: MuseImageProvider; label: string; title: string }[] = [
  { id: 'muse', label: 'Muse', title: 'Tạo ảnh bằng tài khoản Muse (Cài đặt → Muse AI)' },
  { id: 'gpt', label: 'GPT', title: 'Tạo ảnh bằng tài khoản ChatGPT (Cài đặt → Tài khoản ChatGPT)' },
]
export const PROVIDER_LABEL: Record<MuseImageProvider, string> = { muse: 'Muse', gpt: 'GPT' }
export const providerOf = (v: unknown): MuseImageProvider => (v === 'gpt' ? 'gpt' : 'muse')

export interface MuseExtractResult {
  sourceNodeId: string
  /** Ảnh đầu vào lúc chạy — khác ảnh hiện tại của node nguồn thì kết quả là "cũ". */
  inputPath: string
  status: ExtractStatus
  output?: MuseImageRef
  error?: string
  sessionId?: string | null
  /** Ai đã tạo ảnh của dòng này (thiếu = Muse, kết quả lưu trước khi có công tắc). */
  provider?: MuseImageProvider
  updatedAt: number
}

/** Data của node chạy Muse (Tách áo quần / Bảng thiết kế nhân vật). */
export interface MuseJobData {
  title: string
  prompt: string
  promptSource: 'default' | 'custom'
  /** Prompt ghép thêm khi dòng có ảnh phụ (vd. trang phục) — chỉ node có `secondary` */
  secondaryPrompt: string
  secondaryPromptSource: 'default' | 'custom'
  /** Prompt riêng của chế độ GPT (chỉ node có JobNodeSpec.gptPromptName); rỗng khi chưa nạp mặc định. */
  gptPrompt: string
  gptPromptSource: 'default' | 'custom'
  /** Công tắc tạo ảnh của node. Đổi công tắc không làm kết quả cũ thành "cũ"; chỉ áp cho lần chạy sau. */
  provider: MuseImageProvider
  results: Record<string, MuseExtractResult>
  [key: string]: unknown
}
export type MuseExtractData = MuseJobData

/** Data của node "Ảnh kết quả". */
export interface MuseOutputData {
  title: string
  label: string
  image: MuseImageRef | null
  origin: { jobNodeId: string; jobType: string; sourceNodeId: string; rowLabel: string } | null
  [key: string]: unknown
}

export interface XYPosition {
  x: number
  y: number
}

export interface MuseNodeLike {
  id: string
  type?: string
  position: XYPosition
  data: Record<string, unknown>
}

export interface MuseEdgeLike {
  id: string
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
  type?: string
  animated?: boolean
}

export interface MuseConnectionLike {
  source: string | null
  target: string | null
  sourceHandle?: string | null
  targetHandle?: string | null
}

let counter = 0
export function museNodeId(prefix: string): string {
  counter += 1
  return `${prefix}-${Date.now().toString(36)}-${counter}`
}

// ---------------------------------------------------------------- tạo node / dây

export function createInputNode(type: string, position: XYPosition, id = museNodeId(type === MUSE_NODE.character ? 'character' : 'outfit')): MuseNodeLike {
  const spec = INPUT_SPECS[type]
  if (!spec) throw new Error(`Không có loại node ảnh vào ${type}`)
  const data: MuseInputData = { title: spec.title, label: '', image: null }
  return { id, type, position, data }
}

export function createJobNode(
  type: string,
  position: XYPosition,
  prompt: string,
  id = museNodeId(type === MUSE_NODE.characterSheet ? 'charsheet' : 'extract'),
  secondaryPrompt = '',
): MuseNodeLike {
  const spec = JOB_SPECS[type]
  if (!spec) throw new Error(`Không có loại node chạy ${type}`)
  const data: MuseJobData = {
    title: spec.title,
    prompt,
    promptSource: 'default',
    secondaryPrompt,
    secondaryPromptSource: 'default',
    provider: 'muse',
    // gptPrompt để trống: node tự nạp prompt GPT mặc định khi gắn lên canvas (xem MuseJobNode)
    gptPrompt: '',
    gptPromptSource: 'default',
    results: {},
  }
  return { id, type, position, data }
}

export const createOutfitNode = (position: XYPosition, id?: string) => createInputNode(MUSE_NODE.outfit, position, id)
export const createExtractNode = (position: XYPosition, prompt: string, id?: string) => createJobNode(MUSE_NODE.extract, position, prompt, id)

export function createOutputNode(
  position: XYPosition,
  image: MuseImageRef,
  origin: MuseOutputData['origin'],
  label = '',
  id = museNodeId('output'),
): MuseNodeLike {
  const data: MuseOutputData = { title: 'Ảnh kết quả', label, image, origin }
  return { id, type: MUSE_NODE.output, position, data }
}

export function museEdge(
  source: string,
  target: string,
  sourceHandle: string = MUSE_HANDLE.imagesOut,
  targetHandle: string = MUSE_HANDLE.imagesIn,
): MuseEdgeLike {
  return {
    id: `e-${source}-${sourceHandle}-${target}-${targetHandle}`,
    source,
    target,
    sourceHandle,
    targetHandle,
    type: MUSE_EDGE_TYPE,
    animated: true,
  }
}

/** Dây node chạy → node Ảnh kết quả. */
export const museOutputEdge = (jobId: string, outputId: string) => museEdge(jobId, outputId, MUSE_HANDLE.jobOut, MUSE_HANDLE.imageIn)

/** Mẫu khởi đầu: 1 node ảnh vào nối sẵn vào 1 node chạy Muse cùng họ. */
export function createStarter(
  jobType: string,
  origin: XYPosition,
  prompt: string,
  secondaryPrompt = '',
): { nodes: MuseNodeLike[]; edges: MuseEdgeLike[] } {
  const spec = JOB_SPECS[jobType]
  const input = createInputNode(spec.inputType, { x: origin.x, y: origin.y })
  const job = createJobNode(jobType, { x: origin.x + 380, y: origin.y - 40 }, prompt, undefined, secondaryPrompt)
  return { nodes: [input, job], edges: [museEdge(input.id, job.id)] }
}
export const createOutfitStarter = (origin: XYPosition, prompt: string) => createStarter(MUSE_NODE.extract, origin, prompt)

/** Dây đã lưu từ bản cũ: type 'default' -> loại dây có nút gỡ; cổng "identity" cũ của Kịch bản video -> cổng Tham chiếu. */
export function normalizeMuseEdges<E extends { type?: string; targetHandle?: string | null }>(edges: E[]): E[] {
  return edges.map((e) => {
    let out = e.type === MUSE_EDGE_TYPE ? e : { ...e, type: MUSE_EDGE_TYPE, animated: true }
    if (out.targetHandle === MUSE_HANDLE.legacyIdentityIn) out = { ...out, targetHandle: MUSE_HANDLE.refsIn }
    return out
  })
}

/**
 * Quy tắc nối dây:
 * - node ảnh vào (cổng images) → node chạy CÙNG HỌ (cổng images); nhiều ảnh vào 1 node chạy được, 1 ảnh vào nhiều node chạy được;
 * - node chạy (cổng extracted) → node Ảnh kết quả (cổng image); mỗi node Ảnh kết quả chỉ có 1 nguồn;
 * - không trùng dây, không tự nối.
 */
type EdgeRef = Pick<MuseEdgeLike, 'source' | 'target'> & { targetHandle?: string | null }

export function isValidMuseConnection(
  c: MuseConnectionLike,
  nodes: (Pick<MuseNodeLike, 'id' | 'type'> & { data?: Record<string, unknown> })[],
  edges: EdgeRef[] = [],
): boolean {
  if (!c.source || !c.target || c.source === c.target) return false
  const src = nodes.find((n) => n.id === c.source)
  const dst = nodes.find((n) => n.id === c.target)
  if (!src?.type || !dst?.type) return false
  if (edges.some((e) => e.source === c.source && e.target === c.target)) return false
  const sh = c.sourceHandle ?? null
  const th = c.targetHandle ?? null
  // Node Kịch bản video: mọi node có ảnh (Ảnh kết quả / Nhân vật tham chiếu / Trang phục) → cổng Tham chiếu, nhiều dây
  // Kịch bản video (cổng script) → node Kịch bản (mỗi node Kịch bản 1 nguồn)
  if (dst.type === MUSE_NODE.scriptText && (th ?? MUSE_HANDLE.scriptIn) === MUSE_HANDLE.scriptIn) {
    return (
      src.type === MUSE_NODE.script &&
      (sh ?? MUSE_HANDLE.scriptOut) === MUSE_HANDLE.scriptOut &&
      !edges.some((e) => e.target === c.target && (e.targetHandle ?? MUSE_HANDLE.scriptIn) === MUSE_HANDLE.scriptIn)
    )
  }
  // node Kịch bản (cổng video) → node Video kết quả (mỗi node video 1 nguồn)
  if (dst.type === MUSE_NODE.videoOutput) {
    return (
      src.type === MUSE_NODE.scriptText &&
      (sh ?? MUSE_HANDLE.videoOut) === MUSE_HANDLE.videoOut &&
      (th ?? MUSE_HANDLE.videoIn) === MUSE_HANDLE.videoIn &&
      !edges.some((e) => e.target === c.target)
    )
  }
  if (dst.type === MUSE_NODE.clipPrompt) {
    return (
      src.type === MUSE_NODE.clipScript &&
      (sh ?? MUSE_HANDLE.clipOut) === MUSE_HANDLE.clipOut &&
      (th ?? MUSE_HANDLE.clipIn) === MUSE_HANDLE.clipIn &&
      !edges.some((e) => e.target === c.target)
    )
  }
  if (dst.type === MUSE_NODE.clipMerge) {
    return (
      src.type === MUSE_NODE.clipPrompt &&
      (sh ?? MUSE_HANDLE.clipVideoOut) === MUSE_HANDLE.clipVideoOut &&
      (th ?? MUSE_HANDLE.clipVideoIn) === MUSE_HANDLE.clipVideoIn
    )
  }
  if (src.type === MUSE_NODE.script || src.type === MUSE_NODE.scriptText || src.type === MUSE_NODE.videoOutput || src.type === MUSE_NODE.clipScript || src.type === MUSE_NODE.clipPrompt || src.type === MUSE_NODE.clipMerge) return false
  // Ảnh tham chiếu → cổng boards của Kịch bản video / Kịch bản tạo video hoặc của node Kịch bản (Tạo video)
  if (dst.type === MUSE_NODE.script || dst.type === MUSE_NODE.scriptText || dst.type === MUSE_NODE.clipScript) {
    if ((th ?? MUSE_HANDLE.refsIn) !== MUSE_HANDLE.refsIn) return false
    if (src.type === MUSE_NODE.output) return (sh ?? MUSE_HANDLE.imageOut) === MUSE_HANDLE.imageOut
    if (src.type === MUSE_NODE.character || src.type === MUSE_NODE.outfit) return (sh ?? MUSE_HANDLE.imagesOut) === MUSE_HANDLE.imagesOut
    return false
  }
  if (isInputType(src.type)) {
    return (
      INPUT_SPECS[src.type].jobType === dst.type &&
      (sh ?? MUSE_HANDLE.imagesOut) === MUSE_HANDLE.imagesOut &&
      (th ?? MUSE_HANDLE.imagesIn) === MUSE_HANDLE.imagesIn
    )
  }
  // Ảnh kết quả → cổng phụ của node chạy (vd. trang phục đã tách → Bảng thiết kế nhân vật)
  if (src.type === MUSE_NODE.output && isJobType(dst.type)) {
    const sec = JOB_SPECS[dst.type].secondary
    if (!sec || (th ?? '') !== sec.handle || (sh ?? MUSE_HANDLE.imageOut) !== MUSE_HANDLE.imageOut) return false
    const origin = normalizeOutputData(src.data).origin
    return origin?.jobType === sec.fromJobType
  }
  if (isJobType(src.type) && dst.type === MUSE_NODE.output) {
    return (
      (sh ?? MUSE_HANDLE.jobOut) === MUSE_HANDLE.jobOut &&
      (th ?? MUSE_HANDLE.imageIn) === MUSE_HANDLE.imageIn &&
      !edges.some((e) => e.target === c.target)
    )
  }
  return false
}

// ---------------------------------------------------------------- dữ liệu node

function titleOr(raw: unknown, fallback: string, legacy: string[] = []): string {
  return typeof raw === 'string' && raw && !legacy.includes(raw) ? raw : fallback
}

/** Đọc data node ảnh vào, kể cả bản lưu cũ (mảng `images`) -> lấy ảnh đầu. */
export function normalizeInputData(raw: Record<string, unknown> | undefined, type: string = MUSE_NODE.outfit): MuseInputData {
  const d = raw ?? {}
  const legacy = Array.isArray(d.images) ? (d.images as MuseImageRef[]) : []
  const image = (d.image as MuseImageRef | null | undefined) ?? legacy[0] ?? null
  return {
    title: titleOr(d.title, INPUT_SPECS[type]?.title ?? 'Ảnh', ['Ảnh tham chiếu trang phục']),
    label: typeof d.label === 'string' ? d.label : '',
    image,
  }
}
export const normalizeOutfitData = (raw: Record<string, unknown> | undefined) => normalizeInputData(raw, MUSE_NODE.outfit)

export function normalizeJobData(raw: Record<string, unknown> | undefined, type: string = MUSE_NODE.extract): MuseJobData {
  const d = raw ?? {}
  return {
    title: titleOr(d.title, JOB_SPECS[type]?.title ?? 'Muse', ['Prompt tách áo quần']),
    prompt: typeof d.prompt === 'string' ? d.prompt : '',
    promptSource: d.promptSource === 'custom' ? 'custom' : 'default',
    secondaryPrompt: typeof d.secondaryPrompt === 'string' ? d.secondaryPrompt : '',
    secondaryPromptSource: d.secondaryPromptSource === 'custom' ? 'custom' : 'default',
    provider: providerOf(d.provider),
    gptPrompt: typeof d.gptPrompt === 'string' ? d.gptPrompt : '',
    gptPromptSource: d.gptPromptSource === 'custom' ? 'custom' : 'default',
    results: d.results && typeof d.results === 'object' ? (d.results as Record<string, MuseExtractResult>) : {},
  }
}
export const normalizeExtractData = (raw: Record<string, unknown> | undefined) => normalizeJobData(raw, MUSE_NODE.extract)

export function normalizeOutputData(raw: Record<string, unknown> | undefined): MuseOutputData {
  const d = raw ?? {}
  return {
    title: titleOr(d.title, 'Ảnh kết quả'),
    label: typeof d.label === 'string' ? d.label : '',
    image: (d.image as MuseImageRef | null | undefined) ?? null,
    origin: (d.origin as MuseOutputData['origin']) ?? null,
  }
}

/** Kiểm tra file ảnh trước khi tải lên. Trả câu lỗi, hoặc null nếu hợp lệ. */
export function validateOutfitFile(file: { name: string; size: number; type?: string }): string | null {
  const name = file.name.toLowerCase()
  const okType = (file.type && (OUTFIT_ACCEPT as readonly string[]).includes(file.type)) || OUTFIT_EXT.some((e) => name.endsWith(e))
  if (!okType) return `“${file.name}”: chỉ nhận ảnh PNG, JPG hoặc WebP.`
  if (file.size > OUTFIT_MAX_BYTES) return `“${file.name}”: ảnh lớn hơn 25 MB.`
  if (file.size <= 0) return `“${file.name}”: file rỗng.`
  return null
}

// ---------------------------------------------------------------- đầu vào / kết quả của node chạy

export interface ExtractInput {
  /** Khóa dòng = id node nguồn; dòng tổ hợp: "<id ảnh chính>|<id ảnh phụ>" */
  sourceNodeId: string
  /** Tên hiển thị: tên do người dùng đặt, hoặc "<rowLabel> N" theo thứ tự nối dây. */
  label: string
  image: MuseImageRef | null
  /** Ảnh phụ gửi kèm sau ảnh chính (vd. trang phục) */
  extra?: { sourceNodeId: string; label: string; image: MuseImageRef | null }[]
}

/** Dấu vân tay ảnh vào của 1 dòng: đổi ảnh chính hoặc ảnh phụ thì kết quả cũ thành "cũ". */
export function rowFingerprint(input: ExtractInput): string {
  return [input.image?.path ?? '', ...(input.extra ?? []).map((x) => x.image?.path ?? '')].join('|')
}

/** Ảnh phụ (node Ảnh kết quả nối vào cổng phụ), theo thứ tự dây. */
export function secondaryInputsFromSources(
  sources: { id: string; type?: string; data?: Record<string, unknown> }[],
  rowLabel = 'Trang phục',
): ExtractInput[] {
  const seen = new Set<string>()
  const out: ExtractInput[] = []
  for (const s of sources) {
    if (!s || seen.has(s.id) || s.type !== MUSE_NODE.output) continue
    seen.add(s.id)
    const d = normalizeOutputData(s.data)
    out.push({ sourceNodeId: s.id, label: d.label.trim() || `${rowLabel} ${out.length + 1}`, image: d.image })
  }
  return out
}

/** Dòng chạy: không có ảnh phụ -> mỗi ảnh chính 1 dòng; có -> mỗi cặp ảnh chính × ảnh phụ 1 dòng. */
export function buildJobRows(primary: ExtractInput[], secondary: ExtractInput[]): ExtractInput[] {
  if (!secondary.length) return primary
  const rows: ExtractInput[] = []
  for (const p of primary) {
    for (const s of secondary) {
      rows.push({
        sourceNodeId: `${p.sourceNodeId}|${s.sourceNodeId}`,
        label: `${p.label} × ${s.label}`,
        image: p.image,
        extra: [{ sourceNodeId: s.sourceNodeId, label: s.label, image: s.image }],
      })
    }
  }
  return rows
}

/** Đầu vào của node chạy theo thứ tự dây nối: mỗi node ảnh vào là 1 dòng (chưa có ảnh vẫn hiện). */
export function extractInputsFromSources(
  sources: { id: string; type?: string; data?: Record<string, unknown> }[],
  rowLabel = 'Trang phục',
  onlyType?: string,
): ExtractInput[] {
  const seen = new Set<string>()
  const out: ExtractInput[] = []
  for (const s of sources) {
    if (!s || seen.has(s.id)) continue
    if (onlyType && s.type !== onlyType) continue // dây sai loại (vd. lưu từ bản lỗi) không thành dòng
    seen.add(s.id)
    const d = normalizeInputData(s.data, s.type ?? MUSE_NODE.outfit)
    out.push({ sourceNodeId: s.id, label: d.label.trim() || `${rowLabel} ${out.length + 1}`, image: d.image })
  }
  return out
}

/** Như trên nhưng tính từ toàn bộ đồ thị (dùng trong test / khi chạy theo canvas). */
export function collectExtractInputs(jobId: string, nodes: MuseNodeLike[], edges: Pick<MuseEdgeLike, 'source' | 'target'>[]): ExtractInput[] {
  const job = nodes.find((n) => n.id === jobId)
  const spec = JOB_SPECS[job?.type ?? MUSE_NODE.extract] ?? JOB_SPECS[MUSE_NODE.extract]
  const sources = edges
    .filter((e) => e.target === jobId)
    .map((e) => nodes.find((n) => n.id === e.source && n.type === spec.inputType))
    .filter((n): n is MuseNodeLike => Boolean(n))
  return extractInputsFromSources(sources, INPUT_SPECS[spec.inputType].rowLabel)
}

export type ExtractRowState = 'no_image' | 'pending' | 'running' | 'done' | 'error' | 'interrupted' | 'stale'

export function extractRowState(input: ExtractInput, results: Record<string, MuseExtractResult>): ExtractRowState {
  if (!input.image || (input.extra ?? []).some((x) => !x.image)) return 'no_image'
  const r = results[input.sourceNodeId]
  if (!r) return 'pending'
  if (r.status === 'running') return 'running'
  if (r.inputPath !== rowFingerprint(input)) return 'stale'
  return r.status
}

/**
 * Các dòng "chạy tất cả" sẽ chạy: chưa có kết quả, hoặc ảnh vào đã đổi.
 * Dòng lỗi / bị gián đoạn KHÔNG tự chạy lại (prompt có thể đã gửi, tốn lượt) — phải bấm "Chạy lại" từng dòng.
 */
export function inputsToRun(inputs: ExtractInput[], results: Record<string, MuseExtractResult>): ExtractInput[] {
  return inputs.filter((i) => {
    const s = extractRowState(i, results)
    return s === 'pending' || s === 'stale'
  })
}

/** Khi mở lại canvas: kết quả còn 'running' nghĩa là lần chạy trước đã bị cắt (đóng app / F5). */
export function markInterrupted(results: Record<string, MuseExtractResult>, now = Date.now()): Record<string, MuseExtractResult> | null {
  let changed = false
  const next: Record<string, MuseExtractResult> = {}
  for (const [k, r] of Object.entries(results)) {
    if (r.status === 'running') {
      changed = true
      const where = r.provider === 'gpt' ? 'xem lịch sử chat trên ChatGPT' : 'xem chat trên Muse'
      next[k] = {
        ...r,
        status: 'interrupted',
        error: `Lần chạy bị gián đoạn (đóng app / tải lại trang). Prompt có thể ĐÃ gửi — ${where} trước khi chạy lại.`,
        updatedAt: now,
      }
    } else next[k] = r
  }
  return changed ? next : null
}

/** Bỏ kết quả của các node nguồn không còn nối dây. */
export function pruneResults(results: Record<string, MuseExtractResult>, connectedSourceIds: string[]): Record<string, MuseExtractResult> | null {
  const keep = new Set(connectedSourceIds)
  const next = Object.fromEntries(Object.entries(results).filter(([k, r]) => keep.has(k) || r.status === 'running'))
  return Object.keys(next).length === Object.keys(results).length ? null : next
}

/** Ảnh đầu ra hợp lệ của node chạy (theo thứ tự đầu vào). */
export function extractOutputs(inputs: ExtractInput[], results: Record<string, MuseExtractResult>): MuseImageRef[] {
  return inputs
    .filter((i) => extractRowState(i, results) === 'done')
    .map((i) => results[i.sourceNodeId].output)
    .filter((o): o is MuseImageRef => Boolean(o))
}

/** Body gọi POST /api/ai/muse/generate cho 1 đầu vào. Prompt gửi nguyên văn (không ghép tiền tố chung). */
/** Prompt đầy đủ + ảnh tham chiếu theo thứ tự (ảnh chính trước, ảnh phụ sau) của 1 dòng. Thiếu ảnh -> throw. */
function rowPromptAndRefs(input: ExtractInput, prompt: string, secondaryPrompt: string): { prompt: string; refs: string[] } {
  if (!input.image) throw new Error(`${input.label}: chưa có ảnh.`)
  const extra = (input.extra ?? []).map((x) => {
    if (!x.image) throw new Error(`${input.label}: ${x.label} chưa có ảnh.`)
    return x.image.path
  })
  const full = extra.length && secondaryPrompt.trim() ? `${prompt.trim()}\n\n${secondaryPrompt.trim()}` : prompt.trim()
  return { prompt: full, refs: [input.image.path, ...extra] }
}

export function buildJobRequest(
  spec: JobNodeSpec,
  config: MuseCanvasConfig,
  prompt: string,
  input: ExtractInput,
  secondaryPrompt = '',
): Record<string, unknown> {
  const row = rowPromptAndRefs(input, prompt, secondaryPrompt)
  return {
    prompt: row.prompt,
    reference_images: row.refs,
    output_kind: 'image',
    apply_prefix: false,
    chat_title: `${config.chatTitlePrefix} · ${spec.chatLabel} · ${input.label}`.slice(0, 80),
    file_prefix: `${config.filePrefix}_${spec.fileSuffix}`.slice(0, 40),
    ...museGenerateOptions(config),
  }
}

/** Prompt node đang dùng theo công tắc: trường nào hiển thị/sửa, tên prompt mặc định, có ghép prompt kết hợp không. */
export interface ActivePrompt {
  text: string
  source: 'default' | 'custom'
  promptName: string
  field: 'prompt' | 'gptPrompt'
  sourceField: 'promptSource' | 'gptPromptSource'
  /** Ghép prompt kết hợp (ảnh phụ) sau prompt chính? GPT có prompt riêng thì không. */
  useSecondary: boolean
  /** Prompt riêng của GPT (true) hay prompt chung Muse/GPT (false) */
  gptOwn: boolean
}

export function activePrompt(spec: JobNodeSpec, data: MuseJobData): ActivePrompt {
  if (data.provider === 'gpt' && spec.gptPromptName) {
    return {
      text: data.gptPrompt, source: data.gptPromptSource, promptName: spec.gptPromptName,
      field: 'gptPrompt', sourceField: 'gptPromptSource', useSecondary: false, gptOwn: true,
    }
  }
  return {
    text: data.prompt, source: data.promptSource, promptName: spec.promptName,
    field: 'prompt', sourceField: 'promptSource', useSecondary: true, gptOwn: false,
  }
}

/** Body POST /api/workflow/muse/gpt-image: cùng prompt + ảnh tham chiếu như Muse, tạo bằng tài khoản ChatGPT. */
export function buildGptJobRequest(
  spec: JobNodeSpec,
  config: MuseCanvasConfig,
  prompt: string,
  input: ExtractInput,
  secondaryPrompt = '',
): Record<string, unknown> {
  const row = rowPromptAndRefs(input, prompt, secondaryPrompt)
  return {
    prompt: row.prompt,
    reference_images: row.refs,
    chat_title: `${config.chatTitlePrefix} · ${spec.chatLabel} · ${input.label}`.slice(0, 80),
    file_prefix: `${config.filePrefix}_${spec.fileSuffix}`.slice(0, 40),
    aspect: spec.gptAspect,
  }
}
export const buildExtractRequest = (config: MuseCanvasConfig, prompt: string, input: ExtractInput) =>
  buildJobRequest(JOB_SPECS[MUSE_NODE.extract], config, prompt, input)

// ---------------------------------------------------------------- tách kết quả ra node "Ảnh kết quả"

/** Node "Ảnh kết quả" đã tách từ 1 dòng của node chạy (nếu có). */
export function findOutputNodeFor(nodes: MuseNodeLike[], jobNodeId: string, sourceNodeId: string): MuseNodeLike | undefined {
  return nodes.find((n) => {
    if (n.type !== MUSE_NODE.output) return false
    const o = normalizeOutputData(n.data).origin
    return o?.jobNodeId === jobNodeId && o.sourceNodeId === sourceNodeId
  })
}

/** Vị trí đặt node Ảnh kết quả: cột bên phải node chạy, xếp chồng theo thứ tự dòng. */
export function outputNodePosition(job: { position: XYPosition; width?: number }, rowIndex: number): XYPosition {
  return { x: job.position.x + (job.width || 440) + 90, y: job.position.y + rowIndex * 300 }
}

/**
 * Tạo node + dây cho các dòng đã xong mà chưa có node Ảnh kết quả.
 * Trả rỗng nếu không có gì để tạo.
 */
export function planOutputNodes(
  job: MuseNodeLike & { width?: number },
  inputs: ExtractInput[],
  results: Record<string, MuseExtractResult>,
  nodes: MuseNodeLike[],
  only?: string,
): { nodes: MuseNodeLike[]; edges: MuseEdgeLike[] } {
  const out: { nodes: MuseNodeLike[]; edges: MuseEdgeLike[] } = { nodes: [], edges: [] }
  inputs.forEach((input, idx) => {
    if (only && input.sourceNodeId !== only) return
    if (extractRowState(input, results) !== 'done') return
    if (findOutputNodeFor(nodes, job.id, input.sourceNodeId)) return
    const output = results[input.sourceNodeId].output
    if (!output) return
    const node = createOutputNode(
      outputNodePosition(job, idx),
      output,
      { jobNodeId: job.id, jobType: job.type ?? '', sourceNodeId: input.sourceNodeId, rowLabel: input.label },
      input.label,
    )
    out.nodes.push(node)
    out.edges.push(museOutputEdge(job.id, node.id))
  })
  return out
}

/** Node Ảnh kết quả có ảnh mới hơn ở node chạy nguồn (dòng đó vừa chạy lại)? Trả ảnh mới hoặc null. */
export function newerOutputFor(output: MuseOutputData, jobData: (Partial<MuseJobData> & Pick<MuseJobData, 'results'>) | null | undefined): MuseImageRef | null {
  if (!output.origin || !jobData) return null
  const r = jobData.results[output.origin.sourceNodeId]
  if (!r || r.status !== 'done' || !r.output) return null
  return r.output.path !== output.image?.path ? r.output : null
}

// ---------------------------------------------------------------- nối dây "thông minh"

/** Cổng có thể có của mỗi loại node (để tự chọn cổng khi thả dây vào thân node). */
const SOURCE_HANDLES = [MUSE_HANDLE.imagesOut, MUSE_HANDLE.jobOut, MUSE_HANDLE.imageOut, MUSE_HANDLE.scriptOut, MUSE_HANDLE.videoOut, MUSE_HANDLE.clipOut, MUSE_HANDLE.clipVideoOut]
const TARGET_HANDLES = [
  MUSE_HANDLE.imagesIn,
  MUSE_HANDLE.outfitsIn,
  MUSE_HANDLE.imageIn,
  MUSE_HANDLE.refsIn,
  MUSE_HANDLE.scriptIn,
  MUSE_HANDLE.videoIn,
  MUSE_HANDLE.clipIn,
  MUSE_HANDLE.clipVideoIn,
]

/**
 * Người dùng kéo dây từ 1 cổng và thả lên node `otherId` (trúng cổng sai hoặc trúng thân node):
 * thử mọi cổng của node kia, trả kết nối hợp lệ đầu tiên (đã chuẩn hóa nguồn → đích) hoặc null.
 */
export function autoMuseConnection(
  fromNodeId: string,
  fromHandleType: 'source' | 'target',
  fromHandleId: string | null,
  otherId: string,
  nodes: (Pick<MuseNodeLike, 'id' | 'type'> & { data?: Record<string, unknown> })[],
  edges: EdgeRef[],
): { source: string; target: string; sourceHandle: string; targetHandle: string } | null {
  if (!otherId || otherId === fromNodeId) return null
  const asSource = (handles: string[]) =>
    handles.flatMap((sh) => TARGET_HANDLES.map((th) => ({ source: fromNodeId, target: otherId, sourceHandle: sh, targetHandle: th })))
  const asTarget = (handles: string[]) =>
    handles.flatMap((th) => SOURCE_HANDLES.map((sh) => ({ source: otherId, target: fromNodeId, sourceHandle: sh, targetHandle: th })))
  // Ưu tiên: 1) đúng cổng đã kéo; 2) cổng khác của node đó, GIỮ chiều (vd. thả nhầm cổng Nhân vật / Trang phục);
  // 3) cuối cùng mới đổi chiều (kéo nhầm chấm, vd. chấm vào của Ảnh kết quả).
  const candidates =
    fromHandleType === 'source'
      ? [...asSource([fromHandleId ?? '']), ...asSource(SOURCE_HANDLES), ...asTarget(TARGET_HANDLES)]
      : [...asTarget([fromHandleId ?? '']), ...asTarget(TARGET_HANDLES), ...asSource(SOURCE_HANDLES)]
  return candidates.find((c) => isValidMuseConnection(c, nodes, edges)) ?? null
}

const NODE_NAME: Record<string, string> = {
  [MUSE_NODE.outfit]: 'Trang phục',
  [MUSE_NODE.extract]: 'Tách áo quần',
  [MUSE_NODE.character]: 'Nhân vật tham chiếu',
  [MUSE_NODE.characterSheet]: 'Bảng thiết kế nhân vật',
  [MUSE_NODE.output]: 'Ảnh kết quả',
  [MUSE_NODE.script]: 'Kịch bản video',
  [MUSE_NODE.scriptText]: 'Kịch bản',
  [MUSE_NODE.videoOutput]: 'Video kết quả',
  [MUSE_NODE.clipScript]: 'Kịch bản tạo video',
  [MUSE_NODE.clipPrompt]: 'Clip',
  [MUSE_NODE.clipMerge]: 'Ghép video',
}

/** Câu giải thích vì sao 2 node không nối được (hiện cho người dùng thay vì dây biến mất). */
export function explainMuseConnection(
  fromNodeId: string,
  fromHandleType: 'source' | 'target',
  otherId: string,
  nodes: (Pick<MuseNodeLike, 'id' | 'type'> & { data?: Record<string, unknown> })[],
  edges: EdgeRef[],
): string {
  const [srcId, dstId] = fromHandleType === 'source' ? [fromNodeId, otherId] : [otherId, fromNodeId]
  const src = nodes.find((n) => n.id === srcId)
  const dst = nodes.find((n) => n.id === dstId)
  if (!src || !dst || srcId === dstId) return 'Thả dây lên một node khác.'
  const sName = NODE_NAME[src.type ?? ''] ?? 'node'
  const dName = NODE_NAME[dst.type ?? ''] ?? 'node'
  if (edges.some((e) => e.source === srcId && e.target === dstId)) return `Hai node này đã được nối.`
  if (dst.type === MUSE_NODE.output && edges.some((e) => e.target === dstId))
    return 'Node Ảnh kết quả chỉ có 1 nguồn — gỡ dây cũ trước.'
  if (dst.type === MUSE_NODE.videoOutput)
    return src.type === MUSE_NODE.scriptText
      ? 'Node Video kết quả chỉ có 1 nguồn — gỡ dây cũ trước.'
      : 'Node Video kết quả chỉ nhận dây từ node Kịch bản (dùng nút “Ra node” ở phần video).'
  if (dst.type === MUSE_NODE.scriptText)
    return src.type === MUSE_NODE.script
      ? 'Node Kịch bản chỉ có 1 nguồn kịch bản — gỡ dây cũ trước.'
      : 'Node Kịch bản nhận kịch bản từ Kịch bản video và ảnh tham chiếu (Ảnh kết quả, Nhân vật, Trang phục) ở cổng “Tham chiếu”.'
  if (dst.type === MUSE_NODE.script)
    return 'Kịch bản video nhận node có ảnh: Ảnh kết quả, Nhân vật tham chiếu, Trang phục (nối vào cổng “Tham chiếu”).'
  if (dst.type === MUSE_NODE.clipScript)
    return 'Kịch bản tạo video nhận node có ảnh: Ảnh kết quả (bảng thiết kế), Nhân vật tham chiếu, Trang phục (nối vào cổng “Tham chiếu”).'
  if (dst.type === MUSE_NODE.clipPrompt)
    return src.type === MUSE_NODE.clipScript
      ? 'Node Clip chỉ có 1 nguồn — gỡ dây cũ trước.'
      : 'Node Clip chỉ nhận dây từ Kịch bản tạo video (dùng nút “Ra node” ở từng clip).'
  if (dst.type === MUSE_NODE.clipMerge) return 'Ghép video chỉ nhận dây từ node Clip (chấm xanh bên phải node Clip).'
  if (src.type === MUSE_NODE.clipScript) return 'Kịch bản tạo video chỉ nối ra node Clip — dùng nút “Ra node” ở từng clip.'
  if (src.type === MUSE_NODE.clipPrompt) return 'Node Clip chỉ nối ra node Ghép video (hoặc để trống).'
  if (src.type === MUSE_NODE.clipMerge) return 'Node Ghép video là node cuối — chưa nối ra node nào.'

  if (src.type === MUSE_NODE.script) return 'Kịch bản video chỉ nối ra node Kịch bản — dùng nút “Ra node”.'
  if (src.type === MUSE_NODE.scriptText) return 'Node Kịch bản chỉ nối ra node Video kết quả — dùng nút “Ra node” ở phần video.'
  if (src.type === MUSE_NODE.videoOutput) return 'Node Video kết quả là node cuối — chưa nối ra node nào.'
  if (src.type === MUSE_NODE.output && dst.type === MUSE_NODE.characterSheet) {
    const origin = normalizeOutputData(src.data).origin
    return origin
      ? `Cổng “Trang phục” chỉ nhận Ảnh kết quả của node Tách áo quần (ảnh này từ ${NODE_NAME[origin.jobType] ?? 'node khác'}).`
      : 'Ảnh kết quả này không rõ nguồn — chỉ nhận ảnh tách từ node Tách áo quần.'
  }
  if (src.type === MUSE_NODE.output)
    return `Ảnh kết quả chỉ nối vào cổng “Trang phục” của Bảng thiết kế nhân vật hoặc cổng “Tham chiếu” của Kịch bản video.`
  if (src.type === MUSE_NODE.outfit) return `Node Trang phục chỉ nối vào Tách áo quần hoặc Kịch bản video (không nối vào ${dName}).`
  if (src.type === MUSE_NODE.character)
    return `Node Nhân vật tham chiếu chỉ nối vào Bảng thiết kế nhân vật hoặc Kịch bản video (không nối vào ${dName}).`
  if (isJobType(src.type)) return `${sName} chỉ nối ra node Ảnh kết quả — dùng nút “Ra node”.`
  return `Không nối được ${sName} → ${dName}.`
}

// ---------------------------------------------------------------- node "Kịch bản video" (Muse trả lời chữ)

/**
 * 1 node = 1 lần Muse: gửi prompt kịch bản + TẤT CẢ ảnh tham chiếu đang nối (bảng thiết kế, ảnh sản phẩm,
 * ảnh trang phục, nhân vật — theo thứ tự người dùng xếp) → Muse đọc hết rồi viết 1 kịch bản (chữ, lưu .md).
 * Không ép "1 ảnh = 1 bộ đồ": Muse tự gom các ảnh cùng bộ và tự đếm số bộ.
 */
export const SCRIPT_SPEC = {
  type: MUSE_NODE.script,
  title: 'Kịch bản video',
  subtitle: 'Mọi ảnh tham chiếu nối vào → 1 kịch bản + prompt video từng đoạn',
  promptName: 'video_script',
  chatLabel: 'Kịch bản',
  fileSuffix: 'script',
} as const

/** Số ảnh tham chiếu tối đa gửi trong 1 tin Muse. */
export const SCRIPT_MAX_REFS = 16

export interface MuseScriptResult {
  status: ExtractStatus
  /** Dấu vân tay ảnh vào lúc chạy — khác hiện tại thì kịch bản là "cũ". */
  inputPath: string
  text?: string
  /** File .md backend đã lưu */
  path?: string
  /** Muse trả bài nhưng có thể chưa đủ (hết thời gian chờ) */
  warning?: string
  error?: string
  sessionId?: string | null
  /** Tài khoản ChatGPT đã viết (node Kịch bản tạo video) */
  accountLabel?: string | null
  updatedAt: number
}

export interface MuseScriptData {
  title: string
  prompt: string
  promptSource: 'default' | 'custom'
  /** Ghi chú thêm gửi kèm (tùy chọn), vd. ảnh nào cùng một bộ, bộ nào để cuối */
  notes: string
  /** Thứ tự ảnh do người dùng xếp (id node nguồn); ảnh mới nối chưa có ở đây thì xếp sau theo thứ tự dây */
  order: string[]
  result: MuseScriptResult | null
  /** Thu gọn node (chỉ còn đầu + 1 dòng tóm tắt) */
  collapsed: boolean
  [key: string]: unknown
}

/** Vai trò của 1 ảnh tham chiếu — suy ra từ loại node nguồn, để Muse biết ảnh là gì. */
export type ScriptRefKind = 'character' | 'board' | 'product' | 'outfit_photo' | 'image'

export const SCRIPT_REF_KINDS: Record<ScriptRefKind, { vi: string; en: string }> = {
  character: { vi: 'Nhân vật', en: 'character reference photo (identity: face, hairstyle, body)' },
  board: { vi: 'Bảng thiết kế', en: 'character design board (portrait + three-views + details + palette of one look)' },
  product: { vi: 'Ảnh sản phẩm', en: 'outfit product photo (garments only)' },
  outfit_photo: { vi: 'Ảnh trang phục', en: 'outfit photo (a person wearing the outfit)' },
  image: { vi: 'Ảnh', en: 'reference image' },
}

export interface ScriptRef {
  sourceNodeId: string
  kind: ScriptRefKind
  label: string
  image: MuseImageRef | null
}

export function createScriptNode(position: XYPosition, prompt: string, id = museNodeId('script')): MuseNodeLike {
  const data: MuseScriptData = {
    title: SCRIPT_SPEC.title,
    prompt,
    promptSource: 'default',
    notes: '',
    order: [],
    result: null,
    collapsed: false,
  }
  return { id, type: MUSE_NODE.script, position, data }
}

export function normalizeScriptData(raw: Record<string, unknown> | undefined): MuseScriptData {
  const d = raw ?? {}
  const r = d.result as MuseScriptResult | null | undefined
  return {
    title: titleOr(d.title, SCRIPT_SPEC.title),
    prompt: typeof d.prompt === 'string' ? d.prompt : '',
    promptSource: d.promptSource === 'custom' ? 'custom' : 'default',
    notes: typeof d.notes === 'string' ? d.notes : '',
    order: Array.isArray(d.order) ? (d.order as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    result: r && typeof r === 'object' && typeof r.status === 'string' ? r : null,
    collapsed: d.collapsed === true,
  }
}

/** Loại node được nối vào cổng Tham chiếu của Kịch bản video. */
export const SCRIPT_REF_SOURCE_TYPES: string[] = [MUSE_NODE.output, MUSE_NODE.character, MUSE_NODE.outfit]

function refOf(s: { id: string; type?: string; data?: Record<string, unknown> }): ScriptRef | null {
  if (s.type === MUSE_NODE.output) {
    const d = normalizeOutputData(s.data)
    const job = d.origin?.jobType
    const kind: ScriptRefKind = job === MUSE_NODE.characterSheet ? 'board' : job === MUSE_NODE.extract ? 'product' : 'image'
    return { sourceNodeId: s.id, kind, label: d.label.trim() || d.origin?.rowLabel || '', image: d.image }
  }
  if (s.type === MUSE_NODE.character || s.type === MUSE_NODE.outfit) {
    const d = normalizeInputData(s.data, s.type)
    return { sourceNodeId: s.id, kind: s.type === MUSE_NODE.character ? 'character' : 'outfit_photo', label: d.label.trim(), image: d.image }
  }
  return null
}

/** Ảnh tham chiếu đang nối, xếp theo `order` rồi tới thứ tự dây; tên trống -> "<vai trò> N". */
export function scriptRefsFromSources(
  sources: { id: string; type?: string; data?: Record<string, unknown> }[],
  order: string[] = [],
): ScriptRef[] {
  const seen = new Set<string>()
  const wired: ScriptRef[] = []
  for (const s of sources) {
    if (!s || seen.has(s.id)) continue
    const r = refOf(s)
    if (!r) continue
    seen.add(s.id)
    wired.push(r)
  }
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  const sorted = wired
    .map((r, i) => ({ r, i }))
    .sort((x, y) => rank(x.r.sourceNodeId) - rank(y.r.sourceNodeId) || x.i - y.i)
    .map((x) => x.r)
  const count: Partial<Record<ScriptRefKind, number>> = {}
  return sorted.map((r) => {
    count[r.kind] = (count[r.kind] ?? 0) + 1
    return { ...r, label: r.label || `${SCRIPT_REF_KINDS[r.kind].vi} ${count[r.kind]}` }
  })
}

/** Đổi chỗ ảnh `id` lên (-1) / xuống (+1); trả thứ tự mới (đủ mọi ảnh đang nối). */
export function moveScriptRef(refs: ScriptRef[], id: string, dir: -1 | 1): string[] {
  const ids = refs.map((b) => b.sourceNodeId)
  const i = ids.indexOf(id)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return ids
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  return ids
}

export function scriptFingerprint(refs: ScriptRef[]): string {
  return refs.map((r) => r.image?.path ?? '').join('|')
}

export type ScriptState = 'no_refs' | 'too_many' | 'no_image' | 'pending' | 'running' | 'done' | 'error' | 'interrupted' | 'stale'

export function scriptState(refs: ScriptRef[], result: MuseScriptResult | null, maxRefs: number = SCRIPT_MAX_REFS): ScriptState {
  if (result?.status === 'running') return 'running'
  if (!refs.length) return 'no_refs'
  if (refs.length > maxRefs) return 'too_many'
  if (refs.some((r) => !r.image)) return 'no_image'
  if (!result) return 'pending'
  if (result.status === 'done' && result.inputPath !== scriptFingerprint(refs)) return 'stale'
  return result.status
}

/**
 * Đoạn tự sinh gửi sau prompt: danh sách ảnh (đúng thứ tự đính kèm, kèm vai trò) + ghi chú.
 * Prompt mặc định có chỗ [điền] — đoạn này bảo Muse tự rút ra nhân vật, danh sách / số bộ đồ từ ảnh
 * (nhiều ảnh có thể cùng một bộ) và viết luôn, không hỏi lại (mỗi lượt tốn hạn mức).
 */
export function buildScriptContext(refs: ScriptRef[], notes = ''): string {
  const lines = ['## Attached reference images (sent with this message, in this exact order)']
  refs.forEach((r, i) => lines.push(`- Image ${i + 1}: ${SCRIPT_REF_KINDS[r.kind].en} — "${r.label}".`))
  const charNo = refs.findIndex((r) => r.kind === 'character') + 1
  lines.push(
    '',
    'Treat these images as my inputs and work everything out from them:',
    charNo > 0
      ? `- Identity anchor: Image ${charNo} (the character reference photo). In the generation prompts, refer to it as "Image 1 (identity anchor)" as my format says.`
      : '- Identity anchor: no separate character photo is attached — use the face and hairstyle of the person in the references (the portrait on the design boards if present) and call it Image 1 in the generation prompts.',
    '- Outfits: one image does NOT have to be one outfit. Several images may show the same outfit (e.g. a design board and a product photo of the same look) — group them into one outfit. Decide the outfit list, their order (keep my image order unless a stronger outfit should go last) and the number of outfits yourself.',
    '- Fill every [bracketed placeholder] in my inputs from these images (exact garments, colors, fabric details, one signature detail per outfit).',
    'Do not ask me questions — write the complete output now.',
  )
  const extra = notes.trim()
  if (extra) lines.push('', '## Extra notes from me', extra)
  return lines.join('\n')
}

/** Body POST /api/ai/muse/generate (output_kind=text): mọi ảnh tham chiếu theo thứ tự trong 1 tin. */
export function buildScriptRequest(
  config: MuseCanvasConfig,
  prompt: string,
  refs: ScriptRef[],
  notes = '',
): Record<string, unknown> {
  if (!prompt.trim()) throw new Error('Prompt kịch bản đang trống.')
  if (!refs.length) throw new Error('Chưa nối ảnh tham chiếu nào.')
  if (refs.length > SCRIPT_MAX_REFS) throw new Error(`Tối đa ${SCRIPT_MAX_REFS} ảnh tham chiếu mỗi lần gửi.`)
  const images = refs.map((r) => {
    if (!r.image) throw new Error(`${r.label}: chưa có ảnh.`)
    return r.image.path
  })
  return {
    prompt: `${prompt.trim()}\n\n${buildScriptContext(refs, notes)}`,
    reference_images: images,
    output_kind: 'text',
    apply_prefix: false,
    chat_title: `${config.chatTitlePrefix} · ${SCRIPT_SPEC.chatLabel} · ${refs.length} ảnh`.slice(0, 80),
    file_prefix: `${config.filePrefix}_${SCRIPT_SPEC.fileSuffix}`.slice(0, 40),
    ...museGenerateOptions(config),
  }
}

/** Mở lại canvas: kịch bản còn 'running' mà không còn request chờ -> gián đoạn. */
export function interruptScript(result: MuseScriptResult | null, now = Date.now()): MuseScriptResult | null {
  if (!result || result.status !== 'running') return null
  return {
    ...result,
    status: 'interrupted',
    error: 'Lần chạy bị gián đoạn (đóng app / tải lại trang). Prompt có thể ĐÃ gửi — xem chat trên Muse trước khi chạy lại.',
    updatedAt: now,
  }
}

// ---------------------------------------------------------------- node "Kịch bản tạo video" (ChatGPT)

/**
 * 1 node = 1 lượt ChatGPT: gửi prompt + mọi ảnh tham chiếu theo thứ tự (#1..#N). ChatGPT viết N kịch bản clip
 * (mỗi tham chiếu 1 clip, tự chọn độ dài ≤ 15 s, thiết kế mối nối "hinge" giữa clip k và k+1), tách bằng dòng
 * "=== SCRIPT k/N — REF #k — <tên> — <D>s ===" … "=== END SCRIPT k ===". App tách và kiểm tra (không nhờ GPT đếm).
 */
export const CLIP_SCRIPT_SPEC = {
  type: MUSE_NODE.clipScript,
  title: 'Kịch bản tạo video',
  subtitle: 'ChatGPT · mỗi tham chiếu → 1 clip ≤ 15 s, có mối nối giữa các clip',
  promptName: 'clip_script',
  chatLabel: 'Kịch bản clip',
  fileSuffix: 'clipscript',
} as const

/** Ảnh tối đa mỗi lượt ChatGPT (giới hạn thật của ChatGPT web chưa kiểm chứng). */
export const CLIP_SCRIPT_MAX_REFS = 10
/** Omni 1.2 (Flow Ingredients): clip 3–15 s; giá đo được ở 720p ≈ 3 credit/giây (6 s = 18, 8 s = 24, 10 s = 30). */
export const CLIP_MIN_SECONDS = 3
export const CLIP_MAX_SECONDS = 15
export const CLIP_CREDIT_PER_SECOND_720P = 3

export function createClipScriptNode(position: XYPosition, prompt: string, id = museNodeId('clipscript')): MuseNodeLike {
  const data: MuseScriptData = {
    title: CLIP_SCRIPT_SPEC.title,
    prompt,
    promptSource: 'default',
    notes: '',
    order: [],
    result: null,
    collapsed: false,
  }
  return { id, type: MUSE_NODE.clipScript, position, data }
}

export function normalizeClipScriptData(raw: Record<string, unknown> | undefined): MuseScriptData {
  const d = normalizeScriptData(raw)
  return { ...d, title: titleOr((raw ?? {}).title, CLIP_SCRIPT_SPEC.title) }
}

/** Đoạn app tự gửi sau prompt: danh sách ảnh #k (vai trò + tên), số kịch bản bắt buộc, ghi chú của người dùng. */
export function buildClipScriptContext(refs: ScriptRef[], notes = ''): string {
  const n = refs.length
  const lines = ['## Reference images attached to this message (in this exact order)']
  refs.forEach((r, i) => lines.push(`- #${i + 1}: ${SCRIPT_REF_KINDS[r.kind].en} — "${r.label}".`))
  lines.push(
    '',
    `N = ${n}. Write exactly ${n} script${n === 1 ? '' : 's'} (=== SCRIPT 1/${n} … === SCRIPT ${n}/${n}), one per reference image, in this order.`,
  )
  const extra = notes.trim()
  lines.push('', '## User note', extra || '(none)')
  lines.push('', 'Do not ask me questions — write the complete output now.')
  return lines.join('\n')
}

/** Body POST /api/workflow/muse/gpt-script. */
export function buildClipScriptRequest(
  config: MuseCanvasConfig,
  prompt: string,
  refs: ScriptRef[],
  notes = '',
): Record<string, unknown> {
  if (!prompt.trim()) throw new Error('Prompt kịch bản đang trống.')
  if (!refs.length) throw new Error('Chưa nối ảnh tham chiếu nào.')
  if (refs.length > CLIP_SCRIPT_MAX_REFS) throw new Error(`Tối đa ${CLIP_SCRIPT_MAX_REFS} ảnh tham chiếu mỗi lượt ChatGPT.`)
  const images = refs.map((r) => {
    if (!r.image) throw new Error(`${r.label}: chưa có ảnh.`)
    return r.image.path
  })
  return {
    prompt: `${prompt.trim()}\n\n${buildClipScriptContext(refs, notes)}`,
    reference_images: images,
    chat_title: `${config.chatTitlePrefix} · ${CLIP_SCRIPT_SPEC.chatLabel} · ${refs.length} ảnh`.slice(0, 80),
    file_prefix: `${config.filePrefix}_${CLIP_SCRIPT_SPEC.fileSuffix}`.slice(0, 40),
  }
}

/** Mở lại canvas: còn 'running' mà không còn request chờ -> gián đoạn (chỗ xem lại là ChatGPT). */
export function interruptClipScript(result: MuseScriptResult | null, now = Date.now()): MuseScriptResult | null {
  if (!result || result.status !== 'running') return null
  return {
    ...result,
    status: 'interrupted',
    error: 'Lần chạy bị gián đoạn (đóng app / tải lại trang). Prompt có thể ĐÃ gửi — xem lịch sử chat trên ChatGPT trước khi chạy lại.',
    updatedAt: now,
  }
}

export interface ClipBeat {
  from: number
  to: number
}

export interface ParsedClip {
  /** Số thứ tự clip (k) và tổng (N) ghi ở dòng tiêu đề */
  k: number
  n: number
  /** REF #… ghi ở tiêu đề (null nếu không ghi) */
  ref: number | null
  name: string
  /** Độ dài ghi ở tiêu đề (giây) */
  seconds: number | null
  /** Toàn bộ phần của clip (bảng timeline, lý do…) — Markdown */
  body: string
  /** Prompt video tiếng Anh để dán vào Flow */
  videoPrompt: string
  /** Các mốc [a–bs] trong prompt video */
  beats: ClipBeat[]
  warnings: string[]
}

export interface ParsedClipScript {
  /** Phần trước clip đầu: tổng quan, IDENTITY LOCK, bảng chuyển cảnh */
  intro: string
  clips: ParsedClip[]
  /** Phần sau clip cuối: hướng dẫn ghép */
  outro: string
  totalSeconds: number
  warnings: string[]
}

const CLIP_HEAD = /^\s*(?:#+\s*)?\**\s*={3}\s*SCRIPT\s+(\d+)\s*\/\s*(\d+)\s*(.*?)\s*={3}\s*\**\s*$/i
const CLIP_END = /^\s*(?:#+\s*)?\**\s*={3}\s*END\s+SCRIPT\b.*={3}\s*\**\s*$/i
const BEAT = /\[\s*(\d+(?:[.,]\d+)?)\s*s?\s*[–—-]\s*(\d+(?:[.,]\d+)?)\s*s?\s*\]/g
const num = (x: string) => Number(x.replace(',', '.'))

function parseHeadRest(rest: string): { ref: number | null; name: string; seconds: number | null } {
  const refM = rest.match(/REF\s*#?\s*(\d+)/i)
  const secAll = [...rest.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:s|giây)\b/gi)]
  const secM = secAll.length ? secAll[secAll.length - 1] : null
  let name = rest
  if (secM && secM.index != null) name = name.slice(0, secM.index) + name.slice(secM.index + secM[0].length)
  if (refM) name = name.replace(refM[0], ' ')
  name = name
    .split(/\s*[—–|]\s*|\s+-\s+/) // " - " là dấu tách; "T-shirt" (không có khoảng trắng) giữ nguyên
    .map((x) => x.replace(/^[\s\-:·]+|[\s\-:·]+$/g, '').trim())
    .filter(Boolean)
    .join(' — ')
  return { ref: refM ? Number(refM[1]) : null, name, seconds: secM ? num(secM[1]) : null }
}

function extractVideoPrompt(body: string): string {
  const lines = body.split('\n')
  const at = lines.findIndex((l) => /VIDEO\s*PROMPT/i.test(l))
  if (at < 0) return ''
  const after = lines.slice(at + 1)
  const open = after.findIndex((l) => l.trim().startsWith('```'))
  if (open >= 0) {
    const close = after.findIndex((l, i) => i > open && l.trim().startsWith('```'))
    return after.slice(open + 1, close > open ? close : undefined).join('\n').trim()
  }
  // không có khối ``` : lấy phần chữ ngay sau dòng VIDEO PROMPT
  const inline = lines[at].replace(/^.*VIDEO\s*PROMPT\s*:?\**\s*/i, '').trim()
  return [inline, ...after].join('\n').trim()
}

/** Kiểm tra mốc [a–bs] của 1 clip: bắt đầu từ 0, liền nhau, kết thúc đúng độ dài. */
export function checkClipBeats(beats: ClipBeat[], seconds: number | null): string[] {
  const w: string[] = []
  if (!beats.length) return ['Prompt video không có mốc thời gian [a–bs].']
  if (Math.abs(beats[0].from) > 0.05) w.push(`Mốc đầu bắt đầu ở ${beats[0].from}s, không phải 0s.`)
  for (let i = 1; i < beats.length; i++) {
    const gap = beats[i].from - beats[i - 1].to
    if (Math.abs(gap) > 0.05) w.push(`Mốc ${beats[i - 1].to}s → ${beats[i].from}s ${gap > 0 ? 'bị hở' : 'bị chồng'}.`)
  }
  if (beats.some((b) => b.to <= b.from)) w.push('Có mốc kết thúc sớm hơn lúc bắt đầu.')
  const last = beats[beats.length - 1].to
  if (seconds != null && Math.abs(last - seconds) > 0.25) w.push(`Mốc cuối ${last}s khác độ dài clip ${seconds}s.`)
  return w
}

/** Tách bài ChatGPT theo dòng "=== SCRIPT k/N … ===" và kiểm tra từng clip. `expected` = số ảnh tham chiếu. */
export function parseClipScript(text: string, expected: number): ParsedClipScript {
  const intro: string[] = []
  const outro: string[] = []
  const clips: ParsedClip[] = []
  let head: RegExpMatchArray | null = null
  let lines: string[] = []
  const flush = () => {
    if (!head) return
    const [, k, n, rest] = head
    const h = parseHeadRest(rest)
    const body = lines.join('\n').trim()
    const videoPrompt = extractVideoPrompt(body)
    const beats = [...videoPrompt.matchAll(BEAT)].map((m) => ({ from: num(m[1]), to: num(m[2]) }))
    const warnings: string[] = []
    const kk = Number(k)
    if (h.seconds == null) warnings.push('Tiêu đề không ghi số giây.')
    else if (h.seconds > CLIP_MAX_SECONDS) warnings.push(`Dài ${h.seconds}s — Omni 1.2 tối đa ${CLIP_MAX_SECONDS}s.`)
    else if (h.seconds < CLIP_MIN_SECONDS) warnings.push(`Ngắn ${h.seconds}s — Omni 1.2 tối thiểu ${CLIP_MIN_SECONDS}s.`)
    else if (!Number.isInteger(h.seconds)) warnings.push(`${h.seconds}s không phải số giây nguyên (Flow chỉ có mốc nguyên).`)
    if (h.ref != null && h.ref !== kk) warnings.push(`Tiêu đề ghi REF #${h.ref} nhưng là clip ${kk}.`)
    if (!videoPrompt) warnings.push('Không tìm thấy VIDEO PROMPT.')
    else warnings.push(...checkClipBeats(beats, h.seconds))
    clips.push({ k: kk, n: Number(n), ref: h.ref, name: h.name, seconds: h.seconds, body, videoPrompt, beats, warnings })
    head = null
    lines = []
  }
  for (const line of text.split('\n')) {
    const m = line.match(CLIP_HEAD)
    if (m) {
      flush()
      outro.length = 0
      head = m
      continue
    }
    if (CLIP_END.test(line)) {
      flush()
      continue
    }
    if (head) lines.push(line)
    else if (clips.length) outro.push(line)
    else intro.push(line)
  }
  flush()
  const warnings: string[] = []
  if (!clips.length) warnings.push('Không tách được kịch bản nào theo dòng “=== SCRIPT k/N … ===” — xem bài đầy đủ.')
  else if (clips.length !== expected) warnings.push(`ChatGPT viết ${clips.length} kịch bản, cần ${expected} (1 kịch bản / ảnh tham chiếu).`)
  clips.forEach((c, i) => {
    if (c.k !== i + 1) warnings.push(`Kịch bản thứ ${i + 1} ghi số ${c.k}.`)
  })
  const totalSeconds = clips.reduce((a, c) => a + (c.seconds ?? 0), 0)
  return { intro: intro.join('\n').trim(), clips, outro: outro.join('\n').trim(), totalSeconds, warnings }
}

/** Ước tính credit Flow ở 720p (theo số giây ghi ở tiêu đề). */
export const clipCredits720p = (seconds: number) => Math.round(seconds * CLIP_CREDIT_PER_SECOND_720P)

// ---------------------------------------------------------------- node "Clip" (1 clip tách từ Kịch bản tạo video)

/**
 * Node "Clip": 1 kịch bản clip tách từ node Kịch bản tạo video (nút "Ra node"). Giữ ảnh tham chiếu #k, số giây,
 * prompt video (sửa được) và phần chi tiết; nguồn viết lại thì báo + "Dùng bản mới".
 */
export interface MuseClipPromptData {
  title: string
  name: string
  k: number
  n: number
  /** Độ dài clip (giây) — sửa được */
  seconds: number | null
  originalSeconds: number | null
  /** Prompt video đang dùng — sửa được */
  prompt: string
  /** Bản ChatGPT viết, để "Bản gốc" */
  originalPrompt: string
  /** Phần chi tiết của clip (style, timeline) — Markdown */
  body: string
  /** Ảnh tham chiếu #k lúc tách */
  image: MuseImageRef | null
  origin: { clipScriptNodeId: string; updatedAt: number; k: number } | null
  /** Lần "Tạo video" gần nhất (Omni 1.2 trên Flow) */
  video: MuseClipVideo | null
  collapsed: boolean
  [key: string]: unknown
}

export function createClipPromptNode(
  position: XYPosition,
  clip: Pick<ParsedClip, 'k' | 'n' | 'name' | 'seconds' | 'videoPrompt' | 'body'>,
  image: MuseImageRef | null,
  origin: MuseClipPromptData['origin'],
  id = museNodeId('clip'),
): MuseNodeLike {
  const data: MuseClipPromptData = {
    title: `Clip ${clip.k}/${clip.n}`,
    name: clip.name,
    k: clip.k,
    n: clip.n,
    seconds: clip.seconds,
    originalSeconds: clip.seconds,
    prompt: clip.videoPrompt,
    originalPrompt: clip.videoPrompt,
    body: clip.body,
    image,
    origin,
    video: null,
    collapsed: false,
  }
  return { id, type: MUSE_NODE.clipPrompt, position, data }
}

export function normalizeClipPromptData(raw: Record<string, unknown> | undefined): MuseClipPromptData {
  const d = raw ?? {}
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  const k = n(d.k) ?? 1
  const total = n(d.n) ?? k
  const o = d.origin as MuseClipPromptData['origin'] | undefined
  return {
    title: titleOr(d.title, `Clip ${k}/${total}`),
    name: typeof d.name === 'string' ? d.name : '',
    k,
    n: total,
    seconds: n(d.seconds),
    originalSeconds: n(d.originalSeconds),
    prompt: typeof d.prompt === 'string' ? d.prompt : '',
    originalPrompt: typeof d.originalPrompt === 'string' ? d.originalPrompt : '',
    body: typeof d.body === 'string' ? d.body : '',
    image: (d.image as MuseImageRef | null | undefined) ?? null,
    origin: o && typeof o === 'object' && typeof o.clipScriptNodeId === 'string' ? o : null,
    video: d.video && typeof d.video === 'object' && typeof (d.video as MuseClipVideo).status === 'string' ? (d.video as MuseClipVideo) : null,
    collapsed: d.collapsed === true,
  }
}

/** Mốc [a–bs] trong 1 prompt video. */
export function promptBeats(prompt: string): ClipBeat[] {
  return [...prompt.matchAll(BEAT)].map((m) => ({ from: num(m[1]), to: num(m[2]) }))
}

/** Kiểm tra 1 clip (dùng cả khi người dùng đã sửa số giây / prompt). */
export function checkClipPrompt(prompt: string, seconds: number | null): string[] {
  const w: string[] = []
  if (seconds == null) w.push('Chưa có số giây.')
  else if (seconds > CLIP_MAX_SECONDS) w.push(`Dài ${seconds}s — Omni 1.2 tối đa ${CLIP_MAX_SECONDS}s.`)
  else if (seconds < CLIP_MIN_SECONDS) w.push(`Ngắn ${seconds}s — Omni 1.2 tối thiểu ${CLIP_MIN_SECONDS}s.`)
  else if (!Number.isInteger(seconds)) w.push(`${seconds}s không phải số giây nguyên (Flow chỉ có mốc nguyên).`)
  if (!prompt.trim()) return [...w, 'Prompt video đang trống.']
  return [...w, ...checkClipBeats(promptBeats(prompt), seconds)] // độ dài prompt chỉ hiển thị, không cảnh báo / không chặn
}

export function findClipPromptNodeFor(nodes: MuseNodeLike[], clipScriptNodeId: string, updatedAt: number, k: number): MuseNodeLike | undefined {
  return nodes.find((n) => {
    if (n.type !== MUSE_NODE.clipPrompt) return false
    const o = normalizeClipPromptData(n.data).origin
    return o?.clipScriptNodeId === clipScriptNodeId && o.updatedAt === updatedAt && o.k === k
  })
}

export const museClipEdge = (clipScriptId: string, clipNodeId: string) =>
  museEdge(clipScriptId, clipNodeId, MUSE_HANDLE.clipOut, MUSE_HANDLE.clipIn)

/**
 * Tạo node Clip + dây cho các clip của lần viết hiện tại chưa có node (only = 1 clip). Ảnh tham chiếu #k chỉ gắn khi
 * vẫn đúng ảnh lúc viết (so đường dẫn). Không tạo gì nếu chưa có bài.
 */
export function planClipPromptNodes(
  script: MuseNodeLike & { width?: number },
  refs: ScriptRef[],
  nodes: MuseNodeLike[],
  only?: number,
): { nodes: MuseNodeLike[]; edges: MuseEdgeLike[] } {
  const out = { nodes: [] as MuseNodeLike[], edges: [] as MuseEdgeLike[] }
  const r = normalizeClipScriptData(script.data).result
  if (!r || r.status !== 'done' || !r.text) return out
  const sentPaths = r.inputPath ? r.inputPath.split('|') : []
  const parsed = parseClipScript(r.text, sentPaths.length || refs.length)
  for (const c of parsed.clips) {
    if (only != null && c.k !== only) continue
    if (findClipPromptNodeFor(nodes, script.id, r.updatedAt, c.k)) continue
    const ref = refs[c.k - 1]
    const image = ref?.image && ref.image.path === sentPaths[c.k - 1] ? ref.image : null
    // node của cùng clip ở lần viết trước (nếu còn) -> đặt lệch một chút để không chồng lên
    const older = nodes.filter((n) => n.type === MUSE_NODE.clipPrompt && normalizeClipPromptData(n.data).origin?.clipScriptNodeId === script.id && normalizeClipPromptData(n.data).k === c.k).length
    const position = { x: script.position.x + (script.width || 520) + 90 + older * 40, y: script.position.y + (c.k - 1) * 1080 + older * 40 }
    const node = createClipPromptNode(position, c, image, { clipScriptNodeId: script.id, updatedAt: r.updatedAt, k: c.k })
    out.nodes.push(node)
    out.edges.push(museClipEdge(script.id, node.id))
  }
  return out
}

/** Nguồn đã viết lại và bài mới có clip cùng số k? Trả clip mới + lần viết, hoặc null. */
export function newerClipFor(
  clip: MuseClipPromptData,
  scriptData: MuseScriptData | null | undefined,
): { clip: ParsedClip; updatedAt: number; imagePath: string | null } | null {
  const r = scriptData?.result
  if (!clip.origin || !r || r.status !== 'done' || !r.text || r.updatedAt === clip.origin.updatedAt) return null
  const sent = r.inputPath ? r.inputPath.split('|') : []
  const c = parseClipScript(r.text, sent.length).clips.find((x) => x.k === clip.k)
  return c ? { clip: c, updatedAt: r.updatedAt, imagePath: sent[clip.k - 1] ?? null } : null
}

// ---------------------------------------------------------------- "Tạo video" của node Clip (Omni 1.2 trên Flow)

/** Model Omni 1.2 (tên hiển thị backend map sang macaron_cookie_r2v_<D>s[_360p]). */
export const CLIP_FLOW_MODEL = 'Omni 1.2 Flash'
/** Lỗi chắc chắn xảy ra TRƯỚC khi Flow nhận lệnh (không mất credit) — khớp SAFE_ERROR_CODES của Chiến dịch AI. */
export const FLOW_SAFE_ERROR_CODES = ['BRIDGE_OFFLINE', 'EXTENSION_DISCONNECTED', 'FLOW_AUTH_REQUIRED', 'CAPTCHA_QUEUE_BUSY', 'CAPTCHA_FAILED', 'REFERENCE_INVALID', 'NOT_SUBMITTED']

export interface ClipFlowSettings {
  projectId: string
  aspect: '9:16' | '16:9'
  resolution: '720p' | '360p'
}

export interface MuseClipVideo {
  status: 'running' | 'done' | 'error'
  jobId?: string
  /** Prompt / số giây / ảnh / khung hình / chất lượng / project lúc gửi — khác hiện tại thì video là "cũ" */
  fingerprint: string
  /** Lần gửi thứ mấy (vào khóa chống trùng; "Tạo lại" tăng lên) */
  attempt: number
  files?: string[]
  step?: string
  /** Câu mô tả bước hiện tại do backend ghi (vd. "Đang xếp hàng chờ Flow (1 việc phía trước)...") */
  detail?: string
  /** Lần cập nhật cuối của job TRONG BACKEND (ms) — job im lặng quá lâu thì có thể đã chết */
  backendUpdatedAt?: number
  error?: string
  errorCode?: string
  startedAt: number
  updatedAt: number
}

/**
 * Job đang chạy mà backend không cập nhật gì quá lâu = nghi đã chết (vd. backend khởi động lại làm mất luồng xử lý).
 * Một job Flow tối đa chờ ~18 phút (1080 s) và hàng đợi tự cập nhật khi vị trí đổi, nên 25 phút là ngưỡng an toàn.
 */
export const CLIP_VIDEO_STALL_MS = 25 * 60 * 1000

export function clipVideoStalled(v: MuseClipVideo | null | undefined, now: number): boolean {
  if (!v || v.status !== 'running' || !v.jobId) return false
  return now - (v.backendUpdatedAt ?? v.startedAt) > CLIP_VIDEO_STALL_MS
}

/** Người dùng bấm "Dừng chờ": thôi theo dõi, mở lại nút Tạo lại. Job vẫn có thể chạy ở backend nên KHÔNG coi là "chưa gửi". */
export function stopWaitingVideo(v: MuseClipVideo, now = Date.now()): MuseClipVideo {
  return {
    ...v,
    status: 'error',
    errorCode: 'STOPPED_WAITING',
    error: 'Đã dừng chờ. Job vẫn có thể đang chạy ở backend — xem Thư Viện Video / Veo Studio trước khi tạo lại.',
    updatedAt: now,
  }
}

export const clipFlowSettings = (c: { flowProjectId: string; flowAspect: '9:16' | '16:9'; flowResolution: '720p' | '360p' }): ClipFlowSettings => ({
  projectId: c.flowProjectId,
  aspect: c.flowAspect,
  resolution: c.flowResolution,
})

/** Tên file không đuôi từ đường dẫn Windows (\) hoặc POSIX (/) — id video của /api/veo/history/{id}/file. */
export const fileStem = (path: string) => (path.split(/[\\/]/).pop() || path).replace(/\.[^.]+$/, '')

/** Credit Flow ước tính: ~3/giây ở 720p (đo được), 360p ≈ 1/3. */
export const clipFlowCredits = (seconds: number, resolution: '720p' | '360p') =>
  Math.round(seconds * (resolution === '360p' ? CLIP_CREDIT_PER_SECOND_720P / 3 : CLIP_CREDIT_PER_SECOND_720P))

function hashText(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function clipVideoFingerprint(d: Pick<MuseClipPromptData, 'prompt' | 'seconds' | 'image'>, flow: ClipFlowSettings): string {
  return [hashText(d.prompt.trim()), d.seconds ?? '', d.image?.path ?? '', flow.aspect, flow.resolution, flow.projectId].join('|')
}

/** Lỗi chặn "Tạo video" (kiểm tra TRƯỚC khi gửi — không tốn credit). Rỗng = gửi được. */
export function clipVideoBlockers(d: Pick<MuseClipPromptData, 'prompt' | 'seconds' | 'image'>, flow: ClipFlowSettings): string[] {
  const b: string[] = []
  if (!flow.projectId) b.push('Chưa chọn project Flow — mở Cấu hình → Google Flow để chọn hoặc tạo project.')
  if (!d.image) b.push('Chưa có ảnh tham chiếu cho clip này.')
  const s = d.seconds
  if (s == null || !Number.isInteger(s) || s < CLIP_MIN_SECONDS || s > CLIP_MAX_SECONDS)
    b.push(`Độ dài phải là số giây nguyên ${CLIP_MIN_SECONDS}–${CLIP_MAX_SECONDS}.`)
  if (!d.prompt.trim()) b.push('Prompt video đang trống.')
  return b
}

/** Body POST /api/veo/jobs: Omni 1.2 Ingredients, 1 ảnh tham chiếu (#k), khóa chống trùng theo node + nội dung + lần gửi. */
export function buildClipVideoRequest(
  nodeId: string,
  d: Pick<MuseClipPromptData, 'prompt' | 'seconds' | 'image'>,
  flow: ClipFlowSettings,
  attempt: number,
): Record<string, unknown> {
  const blockers = clipVideoBlockers(d, flow)
  if (blockers.length) throw new Error(blockers[0])
  return {
    prompt: d.prompt.trim(),
    model_display_name: CLIP_FLOW_MODEL,
    input_mode: 'ingredients',
    aspect_ratio: flow.aspect,
    duration_seconds: d.seconds,
    resolution: flow.resolution,
    num_outputs: 1,
    project_id: flow.projectId,
    ingredient_image_paths: [d.image!.path],
    idempotency_key: `musecanvas-${nodeId}-${hashText(clipVideoFingerprint(d, flow))}-a${attempt}`.slice(0, 128),
  }
}

export type ClipVideoState = 'none' | 'running' | 'done' | 'stale' | 'error'

export function clipVideoState(d: MuseClipPromptData, flow: ClipFlowSettings): ClipVideoState {
  const v = d.video
  if (!v) return 'none'
  if (v.status === 'running') return 'running'
  if (v.status === 'error') return 'error'
  return v.fingerprint === clipVideoFingerprint(d, flow) ? 'done' : 'stale'
}

/** Lỗi xảy ra trước khi Flow nhận lệnh (chưa mất credit, gửi lại an toàn)? */
export const isSafeFlowError = (code?: string | null) => !!code && FLOW_SAFE_ERROR_CODES.includes(code)

/** Tab Flow bị đẩy về trang chủ — thường do project thuộc tài khoản Google khác (đã đổi tài khoản). */
export const isProjectHomeError = (message?: string | null) => !!message && /home page|reCAPTCHA is not loaded|Open a Flow project/i.test(message)

// ---------------------------------------------------------------- node "Ghép video" (các clip Flow đã tạo → 1 video)

/**
 * Node độc lập: nhận các node Clip đã có video (cổng "clips"), xếp thứ tự, cắt đầu / cuối từng clip (mặc định 0), rồi
 * POST /api/workflow/muse/merge (chạy nền): xóa watermark Flow TỪNG clip (trước khi ghép — gwr chỉ làm đúng trên clip
 * gốc; có cache) → chuẩn hóa / cắt → ghép CẮT CỨNG (điểm nối nằm ở khung không thấy trang phục) → tiếng gốc / nhạc nền /
 * nhãn / logo như node "Video kết quả" → Thư Viện Video, mục "Hoàn chỉnh". Không tốn credit Flow / Muse.
 */
export const CLIP_MERGE_SPEC = {
  type: MUSE_NODE.clipMerge,
  title: 'Ghép video',
  subtitle: 'Các clip Flow đã tạo → 1 video: xóa watermark, nhạc, nhãn kênh',
} as const

export const MERGE_MAX_CLIPS = 20
export const MERGE_MIN_SECONDS = 0.5
export const MERGE_MAX_TRIM = 60

export interface MergeTrim {
  /** giây cắt bỏ ở đầu clip */
  start: number
  /** giây cắt bỏ ở cuối clip */
  end: number
}

export interface MuseMergeResult {
  status: 'running' | 'done' | 'error' | 'interrupted'
  /** Job ở backend (chạy nền; đóng / mở lại canvas vẫn theo dõi tiếp) */
  jobId?: string
  /** Dấu vân tay clip + cắt + cấu hình lúc ghép — khác hiện tại thì bản ghép là "cũ" */
  inputPath: string
  step?: string
  clip?: number
  total?: number
  filename?: string
  path?: string
  title?: string
  durationSec?: number
  error?: string
  startedAt: number
  updatedAt: number
}

export interface MuseClipMergeData {
  title: string
  /** Tên video (tùy chọn) — dùng làm tên trong Thư Viện Video */
  label: string
  /** Thứ tự clip do người dùng xếp (id node Clip); clip mới nối chưa có ở đây thì xếp theo số k */
  order: string[]
  trims: Record<string, MergeTrim>
  removeWatermark: boolean
  finish: MuseFinishSettings
  merge: MuseMergeResult | null
  /** Tạo từ nút "Ghép video" của node Kịch bản tạo video nào (chống tạo trùng) */
  origin: { clipScriptNodeId: string } | null
  collapsed: boolean
  [key: string]: unknown
}

export function createClipMergeNode(position: XYPosition, origin: MuseClipMergeData['origin'] = null, id = museNodeId('merge')): MuseNodeLike {
  const data: MuseClipMergeData = {
    title: CLIP_MERGE_SPEC.title,
    label: '',
    order: [],
    trims: {},
    removeWatermark: true,
    finish: { ...DEFAULT_MERGE_FINISH },
    merge: null,
    origin,
    collapsed: false,
  }
  return { id, type: MUSE_NODE.clipMerge, position, data }
}

const trimNum = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(MERGE_MAX_TRIM, Math.max(0, Math.round(v * 100) / 100)) : 0)

export function normalizeClipMergeData(raw: Record<string, unknown> | undefined): MuseClipMergeData {
  const d = raw ?? {}
  const trims: Record<string, MergeTrim> = {}
  if (d.trims && typeof d.trims === 'object') {
    for (const [k, v] of Object.entries(d.trims as Record<string, unknown>)) {
      const t = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
      trims[k] = { start: trimNum(t.start), end: trimNum(t.end) }
    }
  }
  const m = d.merge as MuseMergeResult | null | undefined
  const o = d.origin as MuseClipMergeData['origin'] | undefined
  return {
    title: titleOr(d.title, CLIP_MERGE_SPEC.title),
    label: typeof d.label === 'string' ? d.label.slice(0, 120) : '',
    order: Array.isArray(d.order) ? (d.order as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    trims,
    removeWatermark: d.removeWatermark !== false,
    finish: d.finish ? normalizeFinishSettings(d.finish) : { ...DEFAULT_MERGE_FINISH },
    merge: m && typeof m === 'object' && typeof m.status === 'string' && typeof m.inputPath === 'string' ? m : null,
    origin: o && typeof o === 'object' && typeof o.clipScriptNodeId === 'string' ? o : null,
    collapsed: d.collapsed === true,
  }
}

export type MergeClipStatus = 'ready' | 'no_video' | 'running' | 'error'

export interface MergeClipRow {
  nodeId: string
  k: number
  name: string
  seconds: number | null
  /** File video của lần tạo gần nhất đã xong (tên file Veo hoặc đường dẫn); null = chưa có */
  file: string | null
  status: MergeClipStatus
}

/** Các node Clip đang nối vào, xếp theo `order` rồi số k. */
export function mergeRowsFromSources(
  sources: { id: string; type?: string; data?: Record<string, unknown> }[],
  order: string[] = [],
): MergeClipRow[] {
  const seen = new Set<string>()
  const rows: MergeClipRow[] = []
  for (const s of sources) {
    if (!s || s.type !== MUSE_NODE.clipPrompt || seen.has(s.id)) continue
    seen.add(s.id)
    const d = normalizeClipPromptData(s.data)
    const v = d.video
    const done = v?.status === 'done' && v.files?.length ? v.files[v.files.length - 1] : null
    rows.push({
      nodeId: s.id,
      k: d.k,
      name: d.name,
      seconds: d.seconds,
      file: done,
      status: done ? 'ready' : v?.status === 'running' ? 'running' : v?.status === 'error' ? 'error' : 'no_video',
    })
  }
  const rank = (id: string) => {
    const i = order.indexOf(id)
    return i < 0 ? Number.MAX_SAFE_INTEGER : i
  }
  return rows.sort((a, b) => rank(a.nodeId) - rank(b.nodeId) || a.k - b.k || a.nodeId.localeCompare(b.nodeId))
}

/** Đổi chỗ clip lên (-1) / xuống (+1); trả thứ tự mới (đủ mọi clip đang nối). */
export function moveMergeRow(rows: MergeClipRow[], nodeId: string, dir: -1 | 1): string[] {
  const ids = rows.map((r) => r.nodeId)
  const i = ids.indexOf(nodeId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= ids.length) return ids
  ;[ids[i], ids[j]] = [ids[j], ids[i]]
  return ids
}

const trimOf = (trims: Record<string, MergeTrim>, id: string): MergeTrim => trims[id] ?? { start: 0, end: 0 }

/** Lỗi chặn "Ghép" (kiểm tra TRƯỚC khi chạy). Rỗng = ghép được. Backend vẫn kiểm tra lại theo độ dài thật của file. */
export function mergeBlockers(rows: MergeClipRow[], trims: Record<string, MergeTrim>): string[] {
  if (!rows.length) return ['Chưa nối clip nào — nối các node Clip vào chấm “Clip” bên trái.']
  const b: string[] = []
  if (rows.length > MERGE_MAX_CLIPS) b.push(`Tối đa ${MERGE_MAX_CLIPS} clip mỗi bản ghép.`)
  for (const r of rows) {
    if (!r.file) {
      b.push(r.status === 'running' ? `Clip ${r.k}: video đang tạo — chờ xong rồi ghép.` : `Clip ${r.k}: chưa có video — tạo video ở node Clip trước.`)
      continue
    }
    const t = trimOf(trims, r.nodeId)
    if (r.seconds != null && r.seconds - t.start - t.end < MERGE_MIN_SECONDS)
      b.push(`Clip ${r.k}: cắt đầu ${t.start}s + cuối ${t.end}s làm clip ${r.seconds}s chỉ còn dưới ${MERGE_MIN_SECONDS}s.`)
  }
  return b
}

export function mergeFingerprint(rows: MergeClipRow[], trims: Record<string, MergeTrim>, removeWatermark: boolean, s: MuseFinishSettings): string {
  return JSON.stringify([
    rows.map((r) => [r.file, trimOf(trims, r.nodeId).start, trimOf(trims, r.nodeId).end]),
    removeWatermark,
    s.muteOriginal, s.muteOriginal ? 0 : s.originalVolume,
    s.bgmTrackIds, s.bgmTrackIds.length ? s.bgmVolume : 0,
    s.labelText.trim(), s.labelText.trim() ? [s.labelPosition, s.labelSize] : 0,
    s.logoId, s.logoId ? [s.logoPosition, s.logoSize] : 0,
  ])
}

export type MergeState = 'no_clips' | 'missing' | 'pending' | 'running' | 'done' | 'stale' | 'error' | 'interrupted'

export function mergeState(rows: MergeClipRow[], trims: Record<string, MergeTrim>, removeWatermark: boolean, s: MuseFinishSettings, merge: MuseMergeResult | null): MergeState {
  if (merge?.status === 'running') return 'running'
  if (!rows.length) return 'no_clips'
  if (rows.some((r) => !r.file)) return 'missing'
  if (!merge) return 'pending'
  if (merge.status === 'done' && merge.inputPath !== mergeFingerprint(rows, trims, removeWatermark, s)) return 'stale'
  return merge.status
}

/** Body POST /api/workflow/muse/merge. */
export function buildMergeRequest(
  rows: MergeClipRow[],
  trims: Record<string, MergeTrim>,
  removeWatermark: boolean,
  s: MuseFinishSettings,
  title = '',
): Record<string, unknown> {
  const blockers = mergeBlockers(rows, trims)
  if (blockers.length) throw new Error(blockers[0])
  return {
    clips: rows.map((r) => ({ path: r.file, trim_start: trimOf(trims, r.nodeId).start, trim_end: trimOf(trims, r.nodeId).end })),
    remove_watermark: removeWatermark,
    title: title.trim().slice(0, 120),
    mute_original: s.muteOriginal,
    original_volume: s.originalVolume,
    bgm_track_ids: s.bgmTrackIds,
    bgm_volume: s.bgmVolume,
    label_text: s.labelText.trim(),
    label_position: s.labelPosition,
    label_size: s.labelSize,
    logo_id: s.logoId || null,
    logo_position: s.logoPosition,
    logo_size: s.logoSize,
  }
}

/** Tóm tắt 1 dòng các bước sẽ chạy. */
export function mergeSummary(rows: MergeClipRow[], trims: Record<string, MergeTrim>, removeWatermark: boolean, s: MuseFinishSettings, trackName: (id: string) => string = (id) => id): string {
  const cut = rows.filter((r) => trimOf(trims, r.nodeId).start || trimOf(trims, r.nodeId).end).length
  const parts = [`${rows.length} clip`]
  if (removeWatermark) parts.push('xóa watermark Flow')
  if (cut) parts.push(`cắt ${cut} clip`)
  parts.push(finishSummary(s, trackName))
  return parts.join(' · ')
}

/** Tạo node Ghép video + dây từ mọi node Clip của 1 node Kịch bản tạo video (chưa có thì mới tạo). */
export function planMergeNode(
  script: MuseNodeLike & { width?: number },
  nodes: MuseNodeLike[],
): { node: MuseNodeLike; edges: MuseEdgeLike[] } | null {
  const clips = nodes
    .filter((n) => n.type === MUSE_NODE.clipPrompt && normalizeClipPromptData(n.data).origin?.clipScriptNodeId === script.id)
    .sort((a, b) => normalizeClipPromptData(a.data).k - normalizeClipPromptData(b.data).k)
  if (!clips.length) return null
  if (nodes.some((n) => n.type === MUSE_NODE.clipMerge && normalizeClipMergeData(n.data).origin?.clipScriptNodeId === script.id)) return null
  const position = { x: script.position.x + (script.width || 520) + 90 + 520 + 90, y: script.position.y }
  const node = createClipMergeNode(position, { clipScriptNodeId: script.id })
  return { node, edges: clips.map((c) => museEdge(c.id, node.id, MUSE_HANDLE.clipVideoOut, MUSE_HANDLE.clipVideoIn)) }
}

/** Trạng thái job ở backend → kết quả lưu trên node. */
export function mergeFromJob(
  prev: MuseMergeResult,
  job: { status: string; step?: string; clip?: number; total?: number; error?: string | null; result?: { filename?: string; file_path?: string; title?: string; duration_sec?: number } | null },
  now = Date.now(),
): MuseMergeResult {
  const status = job.status === 'done' ? 'done' : job.status === 'error' ? 'error' : 'running'
  return {
    ...prev,
    status,
    step: job.step || prev.step,
    clip: job.clip ?? prev.clip,
    total: job.total ?? prev.total,
    filename: status === 'done' ? job.result?.filename : prev.filename,
    path: status === 'done' ? job.result?.file_path : prev.path,
    title: status === 'done' ? job.result?.title : prev.title,
    durationSec: status === 'done' ? job.result?.duration_sec : prev.durationSec,
    error: status === 'error' ? job.error || 'Lỗi ghép video' : undefined,
    updatedAt: now,
  }
}

// ---------------------------------------------------------------- node "Kịch bản" (bản kịch bản tách riêng)

/**
 * Node "Kịch bản": 1 bản kịch bản tách từ node Kịch bản video (nút "Ra node"). Giữ chữ riêng — sửa được,
 * không đổi khi node nguồn viết lại; nguồn có bản mới hơn thì báo + nút "Dùng bản mới".
 */
export interface MuseScriptTextData {
  title: string
  label: string
  /** Nội dung đang dùng (người dùng sửa được) */
  text: string
  /** Bản Muse trả, để "Khôi phục bản gốc" */
  originalText: string
  /** File .md backend đã lưu */
  path: string
  /** Nguồn: node Kịch bản video + lần viết (updatedAt của kết quả) */
  origin: { scriptNodeId: string; updatedAt: number } | null
  /** Thứ tự ảnh tham chiếu (cổng boards) do người dùng xếp */
  order: string[]
  /** Lần "Tạo video" gần nhất */
  video: MuseScriptVideo | null
  collapsed: boolean
  [key: string]: unknown
}

export interface MuseScriptVideo {
  status: ExtractStatus
  /** Dấu vân tay kịch bản + ảnh lúc chạy — khác hiện tại thì video là "cũ" */
  inputPath: string
  /** Mọi file video đã tải (cuối = bản chính) */
  paths?: string[]
  /** Câu trả lời chữ Muse gửi kèm */
  reply?: string
  error?: string
  sessionId?: string | null
  updatedAt: number
}

export function createScriptTextNode(
  position: XYPosition,
  result: Pick<MuseScriptResult, 'text' | 'path' | 'updatedAt'>,
  scriptNodeId: string,
  label = '',
  id = museNodeId('scripttext'),
): MuseNodeLike {
  const text = result.text ?? ''
  const data: MuseScriptTextData = {
    title: 'Kịch bản',
    label,
    text,
    originalText: text,
    path: result.path ?? '',
    origin: { scriptNodeId, updatedAt: result.updatedAt },
    order: [],
    video: null,
    collapsed: false,
  }
  return { id, type: MUSE_NODE.scriptText, position, data }
}

export function normalizeScriptTextData(raw: Record<string, unknown> | undefined): MuseScriptTextData {
  const d = raw ?? {}
  const text = typeof d.text === 'string' ? d.text : ''
  const o = d.origin as MuseScriptTextData['origin'] | undefined
  return {
    title: titleOr(d.title, 'Kịch bản'),
    label: typeof d.label === 'string' ? d.label : '',
    text,
    originalText: typeof d.originalText === 'string' ? d.originalText : text,
    path: typeof d.path === 'string' ? d.path : '',
    origin: o && typeof o.scriptNodeId === 'string' && typeof o.updatedAt === 'number' ? o : null,
    order: Array.isArray(d.order) ? (d.order as unknown[]).filter((x): x is string => typeof x === 'string') : [],
    video: d.video && typeof d.video === 'object' && typeof (d.video as MuseScriptVideo).status === 'string' ? (d.video as MuseScriptVideo) : null,
    collapsed: d.collapsed === true,
  }
}

/** Đã sửa so với bản Muse trả? */
export const scriptTextEdited = (d: MuseScriptTextData) => d.text !== d.originalText

/** Dây Kịch bản video → node Kịch bản. */
export const museScriptTextEdge = (scriptId: string, textId: string) => museEdge(scriptId, textId, MUSE_HANDLE.scriptOut, MUSE_HANDLE.scriptIn)

/** Node Kịch bản đã tách từ ĐÚNG lần viết này của node Kịch bản video (nếu có). */
export function findScriptTextNodeFor(nodes: MuseNodeLike[], scriptNodeId: string, updatedAt: number): MuseNodeLike | undefined {
  return nodes.find((n) => {
    if (n.type !== MUSE_NODE.scriptText) return false
    const o = normalizeScriptTextData(n.data).origin
    return o?.scriptNodeId === scriptNodeId && o.updatedAt === updatedAt
  })
}

/**
 * Tạo node Kịch bản + dây cho kết quả hiện tại của node Kịch bản video.
 * null nếu chưa có bài hoặc lần viết này đã có node. Viết lại rồi "Ra node" lần nữa -> thêm node mới (giữ cả bản cũ).
 */
export function planScriptTextNode(
  script: MuseNodeLike & { width?: number },
  nodes: MuseNodeLike[],
  label = '',
): { node: MuseNodeLike; edge: MuseEdgeLike } | null {
  const r = normalizeScriptData(script.data).result
  if (!r || r.status !== 'done' || !r.text) return null
  if (findScriptTextNodeFor(nodes, script.id, r.updatedAt)) return null
  const siblings = nodes.filter((n) => n.type === MUSE_NODE.scriptText && normalizeScriptTextData(n.data).origin?.scriptNodeId === script.id).length
  const position = { x: script.position.x + (script.width || 460) + 90, y: script.position.y + siblings * 60 }
  const node = createScriptTextNode(position, r, script.id, label)
  return { node, edge: museScriptTextEdge(script.id, node.id) }
}

/** Nguồn đã viết lại (bài mới khác lần đã tách)? Trả kết quả mới hoặc null. */
export function newerScriptFor(text: MuseScriptTextData, scriptData: MuseScriptData | null | undefined): MuseScriptResult | null {
  const r = scriptData?.result
  if (!text.origin || !r || r.status !== 'done' || !r.text) return null
  return r.updatedAt !== text.origin.updatedAt ? r : null
}

// ---------------------------------------------------------------- "Tạo video" từ node Kịch bản

/** Muse có thể làm nhiều clip liên tiếp (từng đoạn rồi bản ghép): có video rồi vẫn chờ chat im lặng chừng này giây. */
export const SCRIPT_VIDEO_SETTLE_SECONDS = 90

/** Băm ngắn (djb2) để so kịch bản đã đổi chưa mà không lưu cả bài vào dấu vân tay. */
function shortHash(text: string): string {
  let h = 5381
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0
  return (h >>> 0).toString(36)
}

export function scriptVideoFingerprint(text: string, refs: ScriptRef[]): string {
  return [shortHash(text.trim()), ...refs.map((r) => r.image?.path ?? '')].join('|')
}

export type ScriptVideoState = 'no_text' | 'too_many' | 'no_image' | 'pending' | 'running' | 'done' | 'error' | 'interrupted' | 'stale'

export function scriptVideoState(text: string, refs: ScriptRef[], video: MuseScriptVideo | null): ScriptVideoState {
  if (video?.status === 'running') return 'running'
  if (!text.trim()) return 'no_text'
  if (refs.length > SCRIPT_MAX_REFS) return 'too_many'
  if (refs.some((r) => !r.image)) return 'no_image'
  if (!video) return 'pending'
  if (video.status === 'done' && video.inputPath !== scriptVideoFingerprint(text, refs)) return 'stale'
  return video.status
}

/** Câu dặn đặt trước kịch bản: ảnh nào là gì, làm đủ các đoạn + bản ghép, tỉ lệ, không hỏi lại. */
export function buildScriptVideoInstruction(refs: ScriptRef[], aspectRatio: string): string {
  const lines = ['Create the video described in my script below.']
  if (refs.length) {
    lines.push('', 'Attached reference images (in this exact order):')
    refs.forEach((r, i) => lines.push(`- Image ${i + 1}: ${SCRIPT_REF_KINDS[r.kind].en} — "${r.label}".`))
    const charNo = refs.findIndex((r) => r.kind === 'character') + 1
    lines.push(
      charNo > 0
        ? `Identity anchor: Image ${charNo} — the same person in every segment.`
        : 'Identity anchor: the person shown in the references (the portrait on the design boards) — the same person in every segment.',
    )
  } else {
    lines.push('', 'No reference images are attached — follow the descriptions in the script.')
  }
  lines.push(
    '',
    'Follow the script exactly: identity lock, the single locked background, every segment with its beats and timings, the board-cover transitions.',
    'Generate every segment, then the final stitched video as described in the stitching instructions.',
    `Aspect ratio: ${aspectRatio}. No text overlays, no captions, no watermark.`,
    'Do not ask me questions — start generating now.',
    '',
    '## My script',
  )
  return lines.join('\n')
}

/** Body POST /api/ai/muse/generate: video từ kịch bản + ảnh tham chiếu; tải mọi clip Muse trả. */
export function buildScriptVideoRequest(config: MuseCanvasConfig, text: string, refs: ScriptRef[], label = ''): Record<string, unknown> {
  if (!text.trim()) throw new Error('Kịch bản đang trống.')
  if (refs.length > SCRIPT_MAX_REFS) throw new Error(`Tối đa ${SCRIPT_MAX_REFS} ảnh tham chiếu mỗi lần gửi.`)
  const images = refs.map((r) => {
    if (!r.image) throw new Error(`${r.label}: chưa có ảnh.`)
    return r.image.path
  })
  return {
    prompt: `${buildScriptVideoInstruction(refs, config.aspectRatio)}\n${text.trim()}`,
    reference_images: images,
    output_kind: 'video',
    apply_prefix: false,
    settle_seconds: SCRIPT_VIDEO_SETTLE_SECONDS,
    collect_all: true,
    chat_title: `${config.chatTitlePrefix} · Video · ${label.trim() || 'Kịch bản'}`.slice(0, 80),
    file_prefix: `${config.filePrefix}_video`.slice(0, 40),
    ...museGenerateOptions(config),
  }
}

/** Mở lại canvas: video còn 'running' mà không còn request chờ -> gián đoạn. */
export function interruptScriptVideo(video: MuseScriptVideo | null, now = Date.now()): MuseScriptVideo | null {
  if (!video || video.status !== 'running') return null
  return {
    ...video,
    status: 'interrupted',
    error: 'Lần tạo video bị gián đoạn (đóng app / tải lại trang). Prompt có thể ĐÃ gửi — xem chat trên Muse trước khi chạy lại.',
    updatedAt: now,
  }
}

/** URL phát video Muse đã tải (GET /api/ai/muse/stream?path=…). */
export const museVideoStreamPath = (path: string) => `/api/ai/muse/stream?path=${encodeURIComponent(path)}`

// ---------------------------------------------------------------- node "Video kết quả" (video tách riêng)

/**
 * Node "Video kết quả": video của 1 lần "Tạo video" ở node Kịch bản (nút "Ra node").
 * Giữ đường dẫn riêng (không đổi khi node nguồn tạo lại); nguồn có video mới hơn thì báo + "Dùng video mới".
 */
export interface MuseVideoOutputData {
  title: string
  label: string
  /** Mọi clip của lần tạo (cuối = bản chính) */
  paths: string[]
  /** Nguồn: node Kịch bản + lần tạo (updatedAt của video) */
  origin: { scriptTextNodeId: string; updatedAt: number } | null
  /** Cấu hình hoàn thiện (null = chưa đặt: node lấy mặc định đã lưu trên máy) */
  finish: MuseFinishSettings | null
  /** Lần xuất video hoàn chỉnh gần nhất */
  final: MuseFinalResult | null
  [key: string]: unknown
}

export function createVideoOutputNode(
  position: XYPosition,
  video: Pick<MuseScriptVideo, 'paths' | 'updatedAt'>,
  scriptTextNodeId: string,
  label = '',
  id = museNodeId('video'),
): MuseNodeLike {
  const data: MuseVideoOutputData = {
    title: 'Video kết quả',
    label,
    paths: [...(video.paths ?? [])],
    origin: { scriptTextNodeId, updatedAt: video.updatedAt },
    finish: null,
    final: null,
  }
  return { id, type: MUSE_NODE.videoOutput, position, data }
}

export function normalizeVideoOutputData(raw: Record<string, unknown> | undefined): MuseVideoOutputData {
  const d = raw ?? {}
  const o = d.origin as MuseVideoOutputData['origin'] | undefined
  return {
    title: titleOr(d.title, 'Video kết quả'),
    label: typeof d.label === 'string' ? d.label : '',
    paths: Array.isArray(d.paths) ? (d.paths as unknown[]).filter((x): x is string => typeof x === 'string' && !!x) : [],
    origin: o && typeof o.scriptTextNodeId === 'string' && typeof o.updatedAt === 'number' ? o : null,
    finish: d.finish && typeof d.finish === 'object' ? normalizeFinishSettings(d.finish) : null,
    final: normalizeFinalResult(d.final),
  }
}

/** Bản chính = clip cuối. */
export const mainVideoPath = (paths: string[]) => paths[paths.length - 1] ?? ''

export const museVideoOutputEdge = (textId: string, videoId: string) => museEdge(textId, videoId, MUSE_HANDLE.videoOut, MUSE_HANDLE.videoIn)

/** Node Video kết quả đã tách từ ĐÚNG lần tạo này của node Kịch bản (nếu có). */
export function findVideoNodeFor(nodes: MuseNodeLike[], scriptTextNodeId: string, updatedAt: number): MuseNodeLike | undefined {
  return nodes.find((n) => {
    if (n.type !== MUSE_NODE.videoOutput) return false
    const o = normalizeVideoOutputData(n.data).origin
    return o?.scriptTextNodeId === scriptTextNodeId && o.updatedAt === updatedAt
  })
}

/**
 * Tạo node Video kết quả + dây cho video hiện tại của node Kịch bản.
 * null nếu chưa có video xong hoặc lần tạo này đã có node. Tạo lại rồi "Ra node" -> thêm node mới (giữ video cũ).
 */
export function planVideoOutputNode(
  text: MuseNodeLike & { width?: number },
  nodes: MuseNodeLike[],
): { node: MuseNodeLike; edge: MuseEdgeLike } | null {
  const d = normalizeScriptTextData(text.data)
  const v = d.video
  if (!v || v.status !== 'done' || !v.paths?.length) return null
  if (findVideoNodeFor(nodes, text.id, v.updatedAt)) return null
  const siblings = nodes.filter(
    (n) => n.type === MUSE_NODE.videoOutput && normalizeVideoOutputData(n.data).origin?.scriptTextNodeId === text.id,
  ).length
  const position = { x: text.position.x + (text.width || 440) + 90, y: text.position.y + siblings * 60 }
  const node = createVideoOutputNode(position, v, text.id, d.label.trim())
  return { node, edge: museVideoOutputEdge(text.id, node.id) }
}

/** Nguồn đã tạo video mới hơn lần đã tách? Trả video mới hoặc null. */
export function newerVideoFor(out: MuseVideoOutputData, text: MuseScriptTextData | null | undefined): MuseScriptVideo | null {
  const v = text?.video
  if (!out.origin || !v || v.status !== 'done' || !v.paths?.length) return null
  return v.updatedAt !== out.origin.updatedAt ? v : null
}

// ---------------------------------------------------------------- "Hoàn thiện video" (node Video kết quả)

export type MuseCorner = 'tl' | 'tc' | 'tr' | 'bl' | 'bc' | 'br'
export const MUSE_CORNERS: { id: MuseCorner; label: string }[] = [
  { id: 'tl', label: 'Trên trái' },
  { id: 'tc', label: 'Trên giữa' },
  { id: 'tr', label: 'Trên phải' },
  { id: 'bl', label: 'Dưới trái' },
  { id: 'bc', label: 'Dưới giữa' },
  { id: 'br', label: 'Dưới phải' },
]
const CORNER_IDS = MUSE_CORNERS.map((c) => c.id)

/** Cấu hình hoàn thiện: tiếng gốc, nhạc nền (Thư viện nhạc), nhãn kênh (chữ + logo). */
export interface MuseFinishSettings {
  muteOriginal: boolean
  /** 0–2 (1 = giữ nguyên) */
  originalVolume: number
  bgmTrackIds: string[]
  /** 0–2 */
  bgmVolume: number
  labelText: string
  labelPosition: MuseCorner
  labelSize: 's' | 'm' | 'l'
  /** logo_id từ POST /api/audio/logo; '' = không logo */
  logoId: string
  logoPosition: MuseCorner
  /** bề rộng logo / bề rộng khung (0.05–0.5) */
  logoSize: number
  /** Có nhiều clip: ghép tất cả (true) hay chỉ bản chính (false) */
  joinClips: boolean
}

export const DEFAULT_FINISH_SETTINGS: MuseFinishSettings = {
  muteOriginal: false,
  originalVolume: 1,
  bgmTrackIds: [],
  bgmVolume: 0.3,
  labelText: '',
  labelPosition: 'br',
  labelSize: 'm',
  logoId: '',
  logoPosition: 'tr',
  logoSize: 0.16,
  joinClips: false,
}

/** Ghép clip Omni: mặc định tắt tiếng gốc (Omni chỉ sinh tiếng nền phòng thu) và để nhạc nền lo phần âm thanh. */
export const DEFAULT_MERGE_FINISH: MuseFinishSettings = { ...DEFAULT_FINISH_SETTINGS, muteOriginal: true, originalVolume: 0.2 }

const clampNum =(v: unknown, lo: number, hi: number, dflt: number) => {
  const n = typeof v === 'number' && Number.isFinite(v) ? v : dflt
  return Math.min(hi, Math.max(lo, n))
}

export function normalizeFinishSettings(raw: unknown): MuseFinishSettings {
  const d = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const corner = (v: unknown, dflt: MuseCorner) => (CORNER_IDS.includes(v as MuseCorner) ? (v as MuseCorner) : dflt)
  return {
    muteOriginal: d.muteOriginal === true,
    originalVolume: clampNum(d.originalVolume, 0, 2, DEFAULT_FINISH_SETTINGS.originalVolume),
    bgmTrackIds: Array.isArray(d.bgmTrackIds) ? (d.bgmTrackIds as unknown[]).filter((x): x is string => typeof x === 'string' && !!x).slice(0, 10) : [],
    bgmVolume: clampNum(d.bgmVolume, 0, 2, DEFAULT_FINISH_SETTINGS.bgmVolume),
    labelText: typeof d.labelText === 'string' ? d.labelText.slice(0, 60) : '',
    labelPosition: corner(d.labelPosition, DEFAULT_FINISH_SETTINGS.labelPosition),
    labelSize: d.labelSize === 's' || d.labelSize === 'l' ? d.labelSize : 'm',
    logoId: typeof d.logoId === 'string' && /^[a-f0-9]{12}$/.test(d.logoId) ? d.logoId : '',
    logoPosition: corner(d.logoPosition, DEFAULT_FINISH_SETTINGS.logoPosition),
    logoSize: clampNum(d.logoSize, 0.05, 0.5, DEFAULT_FINISH_SETTINGS.logoSize),
    joinClips: d.joinClips === true,
  }
}

/** Lần "Xuất video hoàn chỉnh" gần nhất của node Video kết quả. */
export interface MuseFinalResult {
  status: 'running' | 'done' | 'error' | 'interrupted'
  /** Dấu vân tay clip + cấu hình lúc xuất — khác hiện tại thì bản xuất là "cũ" */
  inputPath: string
  filename?: string
  path?: string
  title?: string
  durationSec?: number
  error?: string
  updatedAt: number
}

export function normalizeFinalResult(raw: unknown): MuseFinalResult | null {
  const r = raw as MuseFinalResult | null | undefined
  return r && typeof r === 'object' && typeof r.status === 'string' && typeof r.inputPath === 'string' ? r : null
}

/** Clip đưa vào bản hoàn chỉnh: ghép tất cả hoặc chỉ bản chính. */
export function finishClips(paths: string[], s: MuseFinishSettings): string[] {
  if (!paths.length) return []
  return s.joinClips && paths.length > 1 ? [...paths] : [paths[paths.length - 1]]
}

export function finishFingerprint(paths: string[], s: MuseFinishSettings): string {
  return JSON.stringify([finishClips(paths, s), s.muteOriginal, s.muteOriginal ? 0 : s.originalVolume, s.bgmTrackIds,
    s.bgmTrackIds.length ? s.bgmVolume : 0, s.labelText.trim(), s.labelText.trim() ? [s.labelPosition, s.labelSize] : 0,
    s.logoId, s.logoId ? [s.logoPosition, s.logoSize] : 0])
}

export type FinishState = 'no_video' | 'pending' | 'running' | 'done' | 'stale' | 'error' | 'interrupted'

export function finishState(paths: string[], s: MuseFinishSettings, final: MuseFinalResult | null): FinishState {
  if (final?.status === 'running') return 'running'
  if (!paths.length) return 'no_video'
  if (!final) return 'pending'
  if (final.status === 'done' && final.inputPath !== finishFingerprint(paths, s)) return 'stale'
  return final.status
}

/** Body POST /api/workflow/muse/finish. */
export function buildFinishRequest(paths: string[], s: MuseFinishSettings, title = ''): Record<string, unknown> {
  const clips = finishClips(paths, s)
  if (!clips.length) throw new Error('Node chưa có video.')
  return {
    video_paths: clips,
    title: title.trim().slice(0, 120),
    mute_original: s.muteOriginal,
    original_volume: s.originalVolume,
    bgm_track_ids: s.bgmTrackIds,
    bgm_volume: s.bgmVolume,
    label_text: s.labelText.trim(),
    label_position: s.labelPosition,
    label_size: s.labelSize,
    logo_id: s.logoId || null,
    logo_position: s.logoPosition,
    logo_size: s.logoSize,
  }
}

/** Tóm tắt 1 dòng (hiện ở node thu gọn / nút xuất). */
export function finishSummary(s: MuseFinishSettings, trackName: (id: string) => string = (id) => id): string {
  const parts = [s.muteOriginal ? 'tắt tiếng gốc' : s.originalVolume !== 1 ? `tiếng gốc ${Math.round(s.originalVolume * 100)}%` : 'giữ tiếng gốc']
  if (s.bgmTrackIds.length) parts.push(`nhạc: ${s.bgmTrackIds.map(trackName).join(', ')} (${Math.round(s.bgmVolume * 100)}%)`)
  if (s.labelText.trim()) parts.push(`nhãn ${s.labelText.trim()}`)
  if (s.logoId) parts.push('logo kênh')
  return parts.join(' · ')
}

/** Mở lại canvas: bản xuất còn 'running' mà không còn request chờ -> gián đoạn (xuất lại được, không tốn lượt Muse). */
export function interruptFinal(final: MuseFinalResult | null, now = Date.now()): MuseFinalResult | null {
  if (!final || final.status !== 'running') return null
  return { ...final, status: 'interrupted', error: 'Lần xuất bị gián đoạn (đóng app / tải lại trang) — bấm xuất lại (không tốn lượt Muse).', updatedAt: now }
}
