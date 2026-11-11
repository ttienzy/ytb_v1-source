import { useEffect, useState } from 'react'
import {
  Sparkles,
  Download,
  Trash2,
  Maximize2,
  Film,
  Layers,
  ChevronDown,
  RefreshCw,
  Loader2,
  X,
  Copy,
  Check,
  Cpu,
  Wand2,
  Image as ImageIcon,
  CheckCircle2,
  Compass,
  AlertCircle,
} from 'lucide-react'
import type {
  ImageAspectRatio,
  ImageModelKey,
  StudioTask,
  VeoImageGenerateRequest,
  VeoImageItem,
  VeoProject,
} from '../types'
import * as api from '../services/veoApi'

export type ImageTask = StudioTask

interface Props {
  activeProject?: VeoProject | null
  onSendToVideo?: (imageItem: VeoImageItem) => void
  studioTasks?: StudioTask[]
  onRegisterTask?: (task: StudioTask) => void
  onUpdateTask?: (id: string, patch: Partial<StudioTask>) => void
  onRemoveTask?: (id: string) => void
  imageRefreshTrigger?: number
}

interface ModelOption {
  key: ImageModelKey
  name: string
  desc: string
  badge: 'PRO' | 'BALANCED' | 'FAST'
}

const MODELS: ModelOption[] = [
  {
    key: 'GEM_PIX_2',
    name: 'Nano Banana Pro',
    desc: 'Chất lượng cao nhất, độ chi tiết 4K, xử lý ánh sáng & bố cục phức tạp',
    badge: 'PRO',
  },
  {
    key: 'NARWHAL',
    name: 'Nano Banana 2',
    desc: 'Cân bằng lý tưởng giữa chất lượng hình ảnh sắc nét và tốc độ sinh ảnh',
    badge: 'BALANCED',
  },
  {
    key: 'HARBOR_SEAL',
    name: 'Nano Banana 2 Lite',
    desc: 'Tốc độ cực nhanh (1-2s), tối ưu phác thảo ý tưởng và số lượng lớn',
    badge: 'FAST',
  },
]

const ASPECT_RATIOS: { key: ImageAspectRatio; label: string; desc: string }[] = [
  { key: '16:9', label: '16:9', desc: 'Ngang chuẩn (1376×768)' },
  { key: '4:3', label: '4:3', desc: 'Màn ảnh truyền thống' },
  { key: '1:1', label: '1:1', desc: 'Vuông (1024×1024)' },
  { key: '3:4', label: '3:4', desc: 'Dọc chân dung' },
  { key: '9:16', label: '9:16', desc: 'Dọc Shorts/TikTok (768×1376)' },
]

const QUICK_PROMPTS = [
  'Cinematic shot of a cybernetic warrior in neon-lit rain, Tokyo alley reflections, ultra-detailed 8k.',
  'Hyper-realistic portrait of an astronaut floating in an alien crystal cavern, luminescent flora, studio lighting.',
  'Commercial product photography of a minimalist luxury watch, soft morning studio lighting, clean bokeh.',
]

function RatioIcon({ ratio }: { ratio: ImageAspectRatio }) {
  switch (ratio) {
    case '16:9':
      return <span className="veo-ratio-box ratio-16-9" />
    case '4:3':
      return <span className="veo-ratio-box ratio-4-3" />
    case '1:1':
      return <span className="veo-ratio-box ratio-1-1" />
    case '3:4':
      return <span className="veo-ratio-box ratio-3-4" />
    case '9:16':
      return <span className="veo-ratio-box ratio-9-16" />
    default:
      return <span className="veo-ratio-box ratio-16-9" />
  }
}

export function parseBatchPrompts(rawText: string): string[] {
  const lines = rawText.split('\n')
  const prompts: string[] = []
  let current = ''

  // Match patterns like: "1. Prompt", "1) Prompt", "[1] Prompt", "Cảnh 1: Prompt", "Scene 1: ...", "- Prompt", "* Prompt", "• Prompt"
  const itemHeaderRegex = /^(\d+[\.\)]|\[\d+\]|(?:cảnh|scene)\s*\d+[:.]?|[-*•])\s*(.+)/i
  const hasAnyHeader = lines.some((l) => itemHeaderRegex.test(l.trim()))

  if (hasAnyHeader) {
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      const match = line.match(itemHeaderRegex)
      if (match) {
        if (current.trim()) prompts.push(current.trim())
        current = match[2]
      } else {
        if (current) {
          current += ' ' + line
        } else {
          current = line
        }
      }
    }
    if (current.trim()) prompts.push(current.trim())
  } else {
    // If no numbered/bullet headers, treat each non-empty line as an independent prompt
    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (line) prompts.push(line)
    }
  }

  return prompts
}

export function TextToImageTab({
  activeProject,
  onSendToVideo,
  studioTasks,
  onRegisterTask,
  onUpdateTask,
  onRemoveTask,
  imageRefreshTrigger,
}: Props) {
  // Config state
  const [selectedModelKey, setSelectedModelKey] = useState<ImageModelKey>('GEM_PIX_2')
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>('16:9')
  const [variationCount, setVariationCount] = useState<number>(1)

  // Prompt state
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [prompt, setPrompt] = useState('')
  const [batchText, setBatchText] = useState('')
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  const handleReusePrompt = (text: string) => {
    setPrompt(text)
    setMode('single')
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setSuccessMessage('Đã nạp prompt lên ô nhập.')
    setTimeout(() => setSuccessMessage(''), 2500)
  }

  // Active background generation tasks (Preserved across tab switches)
  const [localTasks, setLocalTasks] = useState<StudioTask[]>([])
  const tasksToDisplay = studioTasks || localTasks
  const imageGenerationActive = tasksToDisplay.some((task) => task.type === 'image' && task.status === 'generating')

  const handleRegisterTask = (task: StudioTask) => {
    if (onRegisterTask) {
      onRegisterTask(task)
    } else {
      setLocalTasks((prev) => [task, ...prev])
    }
  }

  const handleUpdateTask = (id: string, patch: Partial<StudioTask>) => {
    if (onUpdateTask) {
      onUpdateTask(id, patch)
    } else {
      setLocalTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    }
  }

  const handleRemoveTask = (id: string) => {
    if (onRemoveTask) {
      onRemoveTask(id)
    } else {
      setLocalTasks((prev) => prev.filter((t) => t.id !== id))
    }
  }

  // Gallery state
  const [images, setImages] = useState<VeoImageItem[]>([])
  const [loadingImages, setLoadingImages] = useState(false)
  const [previewImage, setPreviewImage] = useState<VeoImageItem | null>(null)
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null)
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const currentModel = MODELS.find((m) => m.key === selectedModelKey) || MODELS[0]

  // Download clean image (watermark removed) via fetch + blob
  const handleDownloadClean = async (imageId: string, e?: React.MouseEvent) => {
    e?.stopPropagation()
    if (downloadingId) return
    setDownloadingId(imageId)
    setErrorMessage('')
    setSuccessMessage('')
    try {
      const blob = await api.downloadCleanImage(imageId)
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = `veo_${imageId}_clean.jpg`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      setSuccessMessage('Đã xóa watermark và tải ảnh về máy.')
      setTimeout(() => setSuccessMessage(''), 4000)
    } catch (err) {
      console.error('[download clean]', err)
      setErrorMessage(err instanceof Error ? err.message : 'Xóa watermark thất bại. Vui lòng thử lại.')
      setTimeout(() => setErrorMessage(''), 4000)
    } finally {
      setDownloadingId(null)
    }
  }

  // Load images
  const loadImages = async () => {
    setLoadingImages(true)
    try {
      let list = await api.getImages(activeProject?.id)
      if ((!list || list.length === 0) && !activeProject?.id) {
        list = await api.getImages()
      }
      setImages(list || [])
    } catch {
      // ignore
    } finally {
      setLoadingImages(false)
    }
  }

  useEffect(() => {
    loadImages()
  }, [activeProject?.id, imageRefreshTrigger])

  // Handle single generation (Non-blocking async task)
  const handleGenerateSingle = () => {
    if (imageGenerationActive) return
    const text = prompt.trim()
    if (!text) {
      setErrorMessage('Vui lòng nhập mô tả hình ảnh (prompt)')
      return
    }

    setErrorMessage('')
    setSuccessMessage('')

    const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
    const total = variationCount
    const taskModelName = currentModel.name
    const taskRatio = aspectRatio
    const taskModelKey = selectedModelKey

    const newTask: ImageTask = {
      id: taskId,
      type: 'image',
      prompt: text,
      modelName: taskModelName,
      aspectRatio: taskRatio,
      total,
      completedCount: 0,
      status: 'generating',
      statusText: total > 1
        ? `Đang tạo ${total} biến thể đồng thời trên Google Flow...`
        : 'Đang gửi yêu cầu sinh ảnh qua Google Flow...',
      createdAt: Date.now(),
    }

    // Đẩy task vào hàng đợi
    handleRegisterTask(newTask)

    ;(async () => {
      const req: VeoImageGenerateRequest = {
        prompt: text,
        model_key: taskModelKey,
        model_display_name: taskModelName,
        aspect_ratio: taskRatio,
        count: total,
        project_id: activeProject?.id,
      }

      try {
        const res = await api.generateImages(req)
        if (res.ok && res.images.length > 0) {
          setImages((prev) => [...res.images, ...prev])
          handleUpdateTask(taskId, {
            status: 'completed',
            completedCount: res.images.length,
            statusText: `Đã tạo xong ${res.images.length}/${total} ảnh thành công!`,
            imageItems: res.images,
          })
          setTimeout(() => handleRemoveTask(taskId), 8000)
        } else {
          handleUpdateTask(taskId, {
            status: 'error',
            statusText: 'Tạo ảnh thất bại',
            error: res.error || 'Không nhận được ảnh từ Google Flow',
          })
        }
      } catch (itemErr: any) {
        handleUpdateTask(taskId, {
          status: 'error',
          statusText: 'Tạo ảnh thất bại',
          error: itemErr.message || 'Lỗi kết nối tới Backend',
        })
      }
    })()
  }

  // Handle batch generation (Non-blocking async task)
  const handleGenerateBatch = () => {
    if (imageGenerationActive) return
    if (!batchText.trim()) {
      setErrorMessage('Vui lòng nhập danh sách kịch bản ảnh (mỗi cảnh một dòng hoặc đánh số 1., 2., ...)')
      return
    }

    const prompts = parseBatchPrompts(batchText)

    if (prompts.length === 0) {
      setErrorMessage('Không nhận diện được cảnh hợp lệ trong kịch bản. Hãy nhập ít nhất 1 cảnh.')
      return
    }

    setErrorMessage('')
    setSuccessMessage('')

    const taskId = `batch-${Date.now()}`
    const totalPrompts = prompts.length
    const totalImages = totalPrompts * variationCount
    const taskModelName = currentModel.name
    const taskRatio = aspectRatio
    const taskModelKey = selectedModelKey

    const newTask: ImageTask = {
      id: taskId,
      type: 'image',
      prompt: `[Kịch bản hàng loạt] ${totalPrompts} cảnh ảnh (${totalImages} ảnh)`,
      modelName: taskModelName,
      aspectRatio: taskRatio,
      total: totalImages,
      completedCount: 0,
      status: 'generating',
      statusText: `Đang chuẩn bị cảnh 1/${totalPrompts}...`,
      createdAt: Date.now(),
    }

    handleRegisterTask(newTask)

    ;(async () => {
      let completedImages = 0
      const batchErrors: string[] = []
      const allBatchImages: VeoImageItem[] = []

      for (let p = 0; p < prompts.length; p++) {
        if (p > 0) {
          handleUpdateTask(taskId, {
            statusText: `Nghỉ ngắn chuẩn bị cảnh ${p + 1}/${totalPrompts}...`,
          })
          await new Promise((resolve) => setTimeout(resolve, 1500))
        }

        handleUpdateTask(taskId, {
          statusText: `Đang xử lý cảnh ${p + 1}/${totalPrompts}: "${prompts[p].slice(0, 30)}..."`,
        })

        const req: VeoImageGenerateRequest = {
          prompt: prompts[p],
          model_key: taskModelKey,
          model_display_name: taskModelName,
          aspect_ratio: taskRatio,
          count: variationCount,
          project_id: activeProject?.id,
        }

        try {
          const res = await api.generateImages(req)
          if (res.ok && res.images.length > 0) {
            completedImages += res.images.length
            allBatchImages.push(...res.images)
            setImages((prev) => [...res.images, ...prev])
            handleUpdateTask(taskId, { completedCount: completedImages, imageItems: allBatchImages })
          }
          if (res.error || !res.images.length) {
            batchErrors.push(`Cảnh ${p + 1}: ${res.error || 'Flow không trả về ảnh'}`)
            if (/PUBLIC_ERROR_UNUSUAL_ACTIVITY|FLOW_UI:|Timeout/.test(res.error || '')) break
          }
        } catch (error) {
          batchErrors.push(`Cảnh ${p + 1}: ${error instanceof Error ? error.message : String(error)}`)
          break
        }
      }

      if (completedImages > 0) {
        handleUpdateTask(taskId, {
          status: 'completed',
          completedCount: completedImages,
          statusText: `Đã hoàn thành ${completedImages}/${totalImages} ảnh${batchErrors.length ? `; ${batchErrors.length} cảnh bị lỗi` : ' cho kịch bản hàng loạt!'}`,
          error: batchErrors.length ? batchErrors.join('\n') : undefined,
          imageItems: allBatchImages,
        })
        if (!batchErrors.length) setTimeout(() => handleRemoveTask(taskId), 8000)
      } else {
        handleUpdateTask(taskId, {
          status: 'error',
          statusText: 'Batch thất bại',
          error: batchErrors.join('\n') || 'Không tạo được ảnh nào trong kịch bản',
        })
      }
    })()
  }

  const handleDelete = async (id: string) => {
    try {
      await api.deleteImage(id)
      setImages((prev) => prev.filter((img) => img.id !== id))
      if (previewImage?.id === id) setPreviewImage(null)
    } catch {
      // ignore
    }
  }

  const handleCopyPrompt = (img: VeoImageItem) => {
    navigator.clipboard.writeText(img.prompt)
    setCopiedPromptId(img.id)
    setTimeout(() => setCopiedPromptId(null), 2000)
  }

  return (
    <div className="veo-image-studio">
      {/* ─── Studio Ribbon Toolbar ─── */}
      <div className="veo-studio-ribbon">
        {/* Model Selector Dropdown */}
        <div className="veo-ribbon-group">
          <span className="veo-ribbon-label">MODEL AI</span>
          <div className="veo-model-dropdown-wrap">
            <button
              type="button"
              className={`veo-model-trigger ${modelDropdownOpen ? 'open' : ''}`}
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            >
              <div className="veo-model-trigger-left">
                <Cpu size={14} className="veo-model-icon" />
                <span className="veo-model-trigger-name">{currentModel.name}</span>
                <span className={`veo-model-badge badge-${currentModel.badge.toLowerCase()}`}>
                  {currentModel.badge}
                </span>
              </div>
              <ChevronDown size={14} className="veo-model-chevron" />
            </button>

            {modelDropdownOpen && (
              <div className="veo-model-menu">
                {MODELS.map((m) => (
                  <button
                    key={m.key}
                    type="button"
                    className={`veo-model-option ${m.key === selectedModelKey ? 'selected' : ''}`}
                    onClick={() => {
                      setSelectedModelKey(m.key)
                      setModelDropdownOpen(false)
                    }}
                  >
                    <div className="veo-model-option-head">
                      <div className="veo-model-option-title">
                        <Cpu size={14} className="veo-model-icon" />
                        <span className="veo-model-option-name">{m.name}</span>
                      </div>
                      <span className={`veo-model-badge badge-${m.badge.toLowerCase()}`}>
                        {m.badge}
                      </span>
                    </div>
                    <div className="veo-model-option-desc">{m.desc}</div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="veo-ribbon-divider" />

        {/* Aspect Ratio Selector */}
        <div className="veo-ribbon-group">
          <span className="veo-ribbon-label">TỈ LỆ KHUNG HÌNH</span>
          <div className="veo-pill-group">
            {ASPECT_RATIOS.map((r) => (
              <button
                key={r.key}
                type="button"
                className={`veo-pill-btn ${aspectRatio === r.key ? 'active' : ''}`}
                onClick={() => setAspectRatio(r.key)}
                title={r.desc}
              >
                <RatioIcon ratio={r.key} />
                <span>{r.label}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="veo-ribbon-divider" />

        {/* Output Count (Flow chỉ có x1/x2/x4; chọn 3 thì Flow tạo 4 và app giữ 3) */}
        <div className="veo-ribbon-group">
          <span className="veo-ribbon-label">BIẾN THỂ</span>
          <div className="veo-pill-group">
            {[1, 2, 3, 4].map((cnt) => (
              <button
                key={cnt}
                type="button"
                className={`veo-pill-btn ${variationCount === cnt ? 'active' : ''}`}
                onClick={() => setVariationCount(cnt)}
                title={`Tạo đồng thời ${cnt} biến thể trên Google Flow`}
              >
                <span>{cnt}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Prompt Workspace Card ─── */}
      <div className="veo-image-prompt-box">
        <div className="veo-image-prompt-header">
          <div className="veo-image-mode-switch">
            <button
              type="button"
              className={`veo-mode-btn ${mode === 'single' ? 'active' : ''}`}
              onClick={() => setMode('single')}
            >
              <Wand2 size={13} style={{ marginRight: 6 }} />
              Prompt Đơn Lẻ
            </button>
            <button
              type="button"
              className={`veo-mode-btn ${mode === 'batch' ? 'active' : ''}`}
              onClick={() => setMode('batch')}
            >
              <Layers size={13} style={{ marginRight: 6 }} />
              Kịch Bản Hàng Loạt (Batch)
            </button>
          </div>

          <div className="veo-image-active-summary">
            <span className="veo-summary-dot" />
            <span>{currentModel.name}</span>
            <span className="veo-summary-sep">•</span>
            <span>Tỉ lệ {aspectRatio}</span>
            <span className="veo-summary-sep">•</span>
            <span>{variationCount} biến thể/lần</span>
          </div>
        </div>

        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--text-secondary)' }}>
          Giữ Chrome mở và chờ tab Flow xử lý. Không sửa prompt hoặc bấm tạo thêm trên Flow trong lúc app đang tạo ảnh.
        </p>
        {mode === 'single' ? (
          <div className="veo-image-input-wrap">
            <textarea
              className="veo-image-textarea"
              placeholder="Nhập mô tả hình ảnh chi tiết: bối cảnh, ánh sáng, góc máy, nhân vật, chất liệu, độ phân giải 8K, cinematic..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
            />
            <div className="veo-image-action-bar">
              <div className="veo-engine-indicator">
                <span className={`veo-engine-dot ${tasksToDisplay.some((t) => t.status === 'generating') ? 'busy' : 'online'}`} />
                <span className="veo-engine-label">
                  {tasksToDisplay.some((t) => t.status === 'generating')
                    ? 'Đang tạo ảnh trên tab Flow…'
                    : 'Tạo ảnh qua giao diện Google Flow'}
                </span>
              </div>
              <button
                type="button"
                className="veo-btn-generate"
                onClick={handleGenerateSingle}
                disabled={!prompt.trim() || imageGenerationActive}
              >
                <Sparkles size={14} />
                <span>Tạo {variationCount} Biến Thể ({currentModel.name})</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="veo-image-input-wrap">
            <textarea
              className="veo-image-textarea"
              placeholder={'1. Phong cảnh hoàng hôn trên biển nhiệt đới, ánh nắng vàng rực rỡ\n2. Phi thuyền lơ lửng trên bầu trời thành phố tương lai cyberpunk, mưa rơi phản chiếu đèn neon\n3. Chân dung chiến binh cổ trang ánh mắt kiên định, góc máy điện ảnh 8K'}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              rows={5}
            />
            <div className="veo-image-action-bar">
              <span className="veo-helper-hint">Mỗi cảnh một dòng (đánh số 1., 2. hoặc gạch đầu dòng - )</span>
              <button
                type="button"
                className="veo-btn-generate"
                onClick={handleGenerateBatch}
                disabled={!batchText.trim() || imageGenerationActive}
              >
                <Layers size={14} />
                <span>Chạy Kịch Bản Hàng Loạt</span>
              </button>
            </div>
          </div>
        )}

        {/* ─── Active Background Tasks Progress Queue ─── */}
        {tasksToDisplay.length > 0 && (
          <div className="veo-image-tasks-container">
            {tasksToDisplay.map((task) => {
              const total = task.total || 1
              const percent = total > 0 ? Math.min(100, Math.round(((task.completedCount || 0) / total) * 100)) : 0
              return (
                <div key={task.id} className={`veo-image-task-card ${task.status}`}>
                  <div className="veo-image-task-header">
                    <div className="veo-image-task-info">
                      <span className="veo-image-task-prompt" title={task.prompt}>
                        "{task.prompt}"
                      </span>
                      <div className="veo-image-task-meta">
                        <span className="veo-image-task-badge model">{task.modelName}</span>
                        <span className="veo-image-task-badge">{task.aspectRatio}</span>
                        {total > 1 && (
                          <span className="veo-image-task-badge">{total} ảnh</span>
                        )}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="veo-image-task-close"
                      onClick={() => handleRemoveTask(task.id)}
                      title="Đóng tiến trình này"
                    >
                      <X size={14} />
                    </button>
                  </div>

                  <div className="veo-image-task-body">
                    <div className={`veo-image-task-status ${task.status}`}>
                      {task.status === 'generating' && <Loader2 size={13} className="veo-spin" />}
                      {task.status === 'completed' && <CheckCircle2 size={13} />}
                      {task.status === 'error' && <AlertCircle size={13} />}
                      <span>{task.statusText}</span>
                      {task.error && <span style={{ color: '#ef4444', marginLeft: 4 }}>({task.error})</span>}
                    </div>
                    {task.total != null && task.total > 1 && task.status === 'generating' && (
                      <span style={{ fontSize: 11, fontWeight: 600, color: '#6366f1' }}>
                        {task.completedCount}/{task.total}
                      </span>
                    )}
                  </div>

                  <div className="veo-image-task-bar-wrap">
                    <div
                      className={`veo-image-task-bar ${
                        task.status === 'completed'
                          ? 'completed'
                          : task.status === 'error'
                          ? 'error'
                          : task.total != null && task.total > 1
                          ? ''
                          : 'indeterminate'
                      }`}
                      style={task.total != null && task.total > 1 && task.status === 'generating' ? { width: `${percent}%` } : undefined}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Notifications */}
        {errorMessage && (
          <div className="veo-banner-error">
            <span>{errorMessage}</span>
          </div>
        )}
        {successMessage && (
          <div className="veo-banner-success">
            <CheckCircle2 size={15} />
            <span>{successMessage}</span>
          </div>
        )}
      </div>

      {/* ─── Gallery Section ─── */}
      <div className="veo-image-gallery-section">
        <div className="veo-image-gallery-header">
          <div className="veo-gallery-title-wrap">
            <ImageIcon size={16} className="veo-gallery-icon" />
            <span className="veo-gallery-title">THƯ VIỆN HÌNH ẢNH ĐÃ TẠO</span>
            <span className="veo-gallery-badge">{images.length}</span>
          </div>
          <button type="button" className="veo-btn-refresh" onClick={loadImages} disabled={loadingImages}>
            <RefreshCw size={13} className={loadingImages ? 'veo-spin' : ''} />
            <span>Làm mới</span>
          </button>
        </div>

        {images.length === 0 ? (
          <div className="veo-image-empty-pro">
            <div className="veo-empty-icon-wrap">
              <Compass size={28} />
            </div>
            <h4>Chưa có hình ảnh nào trong dự án</h4>
            <p>Nhập mô tả phía trên và bấm <strong>"Tạo Biến Thể"</strong> hoặc thử ngay một trong các ý tưởng mẫu:</p>

            <div className="veo-quick-prompts">
              {QUICK_PROMPTS.map((qp, idx) => (
                <button
                  key={idx}
                  type="button"
                  className="veo-quick-prompt-btn"
                  onClick={() => {
                    setPrompt(qp)
                    setMode('single')
                  }}
                >
                  <Sparkles size={12} className="veo-quick-icon" />
                  <span>{qp}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="veo-image-grid">
            {images.map((item) => (
              <div key={item.id} className="veo-image-card">
                <div className="veo-image-card-thumb" onClick={() => setPreviewImage(item)}>
                  <img
                    src={api.getImageFileUrl(item.id)}
                    alt={item.prompt}
                    loading="lazy"
                    onError={(e) => {
                      if (item.image_url && (e.target as HTMLImageElement).src !== item.image_url) {
                        ;(e.target as HTMLImageElement).src = item.image_url
                      }
                    }}
                  />
                  <div className="veo-image-card-overlay">
                    <button
                      type="button"
                      className="veo-overlay-action-btn"
                      title="Xem phóng to"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPreviewImage(item)
                      }}
                    >
                      <Maximize2 size={14} />
                    </button>
                    {onSendToVideo && (
                      <button
                        type="button"
                        className="veo-overlay-action-btn highlight"
                        title="Tạo video từ ảnh này (I2V)"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSendToVideo(item)
                        }}
                      >
                        <Film size={14} />
                      </button>
                    )}
                    <button
                      type="button"
                      className="veo-overlay-action-btn"
                      title="Tải ảnh về máy (không watermark)"
                      disabled={downloadingId === item.id}
                      onClick={(e) => handleDownloadClean(item.id, e)}
                    >
                      {downloadingId === item.id ? <Loader2 size={14} className="spin" /> : <Download size={14} />}
                    </button>
                    <button
                      type="button"
                      className="veo-overlay-action-btn danger"
                      title="Xóa ảnh"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(item.id)
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>

                  <div className="veo-card-tags">
                    <span className="veo-card-tag ratio">{item.aspect_ratio}</span>
                    <span className="veo-card-tag model">{item.model_display_name || 'Nano Banana'}</span>
                  </div>
                </div>

                <div className="veo-image-card-footer">
                  <p className="veo-image-card-prompt" title={item.prompt}>
                    {item.prompt}
                  </p>
                  <div className="veo-image-card-actions">
                    <button
                      type="button"
                      className="veo-card-action-btn"
                      onClick={() => handleCopyPrompt(item)}
                      title="Sao chép prompt"
                    >
                      {copiedPromptId === item.id ? (
                        <>
                          <Check size={12} color="#10b981" />
                          <span style={{ color: '#10b981' }}>Đã chép</span>
                        </>
                      ) : (
                        <>
                          <Copy size={12} />
                          <span>Chép prompt</span>
                        </>
                      )}
                    </button>
                    <button
                      type="button"
                      className="veo-card-action-btn"
                      onClick={() => handleReusePrompt(item.prompt)}
                      title="Nạp prompt này lên ô nhập"
                    >
                      <Sparkles size={12} />
                      <span>Dùng lại</span>
                    </button>
                    {onSendToVideo && (
                      <button
                        type="button"
                        className="veo-card-action-btn video-btn"
                        onClick={() => onSendToVideo(item)}
                        title="Chuyển sang làm Video (I2V)"
                      >
                        <Film size={12} />
                        <span>Tạo Video</span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Lightbox Modal ─── */}
      {previewImage && (
        <div className="veo-lightbox-backdrop" onClick={() => setPreviewImage(null)}>
          <div className="veo-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              className="veo-lightbox-close"
              onClick={() => setPreviewImage(null)}
              title="Đóng"
            >
              <X size={18} />
            </button>

            <div className="veo-lightbox-media">
              <img
                src={api.getImageFileUrl(previewImage.id)}
                alt={previewImage.prompt}
                onError={(e) => {
                  if (previewImage.image_url && (e.target as HTMLImageElement).src !== previewImage.image_url) {
                    ;(e.target as HTMLImageElement).src = previewImage.image_url
                  }
                }}
              />
            </div>

            <div className="veo-lightbox-info">
              <div className="veo-lightbox-meta">
                <span className="veo-lightbox-tag ratio">{previewImage.aspect_ratio}</span>
                <span className="veo-lightbox-tag model">{previewImage.model_display_name}</span>
                {previewImage.width && previewImage.height && (
                  <span className="veo-lightbox-tag dim">
                    {previewImage.width}×{previewImage.height}
                  </span>
                )}
              </div>

              <p className="veo-lightbox-prompt">{previewImage.prompt}</p>

              <div className="veo-lightbox-actions">
                <button
                  type="button"
                  className="veo-btn-modal-secondary"
                  onClick={() => handleCopyPrompt(previewImage)}
                >
                  {copiedPromptId === previewImage.id ? (
                    <>
                      <Check size={14} color="#10b981" />
                      <span>Đã sao chép prompt</span>
                    </>
                  ) : (
                    <>
                      <Copy size={14} />
                      <span>Sao chép prompt</span>
                    </>
                  )}
                </button>

                <button
                  type="button"
                  className="veo-btn-modal-secondary"
                  disabled={downloadingId === previewImage.id}
                  onClick={() => handleDownloadClean(previewImage.id)}
                >
                  {downloadingId === previewImage.id ? (
                    <>
                      <Loader2 size={14} className="spin" />
                      <span>Đang xóa watermark…</span>
                    </>
                  ) : (
                    <>
                      <Download size={14} />
                      <span>Tải ảnh về máy</span>
                    </>
                  )}
                </button>

                {onSendToVideo && (
                  <button
                    type="button"
                    className="veo-btn-modal-primary"
                    onClick={() => {
                      onSendToVideo(previewImage)
                      setPreviewImage(null)
                    }}
                  >
                    <Film size={14} />
                    <span>Tạo Video Từ Ảnh Này</span>
                  </button>
                )}

                <button
                  type="button"
                  className="veo-btn-modal-danger"
                  onClick={() => handleDelete(previewImage.id)}
                  title="Xóa ảnh"
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
