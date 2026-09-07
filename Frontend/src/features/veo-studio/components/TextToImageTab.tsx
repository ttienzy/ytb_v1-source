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
  X,
  Copy,
  Check,
} from 'lucide-react'
import type {
  ImageAspectRatio,
  ImageModelKey,
  VeoImageGenerateRequest,
  VeoImageItem,
  VeoProject,
} from '../types'
import * as api from '../services/veoApi'

interface Props {
  activeProject?: VeoProject | null
  onSendToVideo?: (imageItem: VeoImageItem) => void
}

interface ModelOption {
  key: ImageModelKey
  name: string
  desc: string
  badge: string
}

const MODELS: ModelOption[] = [
  {
    key: 'GEM_PIX_2',
    name: 'Nano Banana Pro',
    desc: 'Chất lượng cao, 4K texture, chi tiết ánh sáng & vật liệu phức tạp',
    badge: 'PRO',
  },
  {
    key: 'NARWHAL',
    name: 'Nano Banana 2',
    desc: 'Cân bằng giữa chất lượng cao và tốc độ sinh ảnh',
    badge: 'STANDARD',
  },
  {
    key: 'HARBOR_SEAL',
    name: 'Nano Banana 2 Lite',
    desc: 'Tốc độ cực nhanh (1-2s), tối ưu phác thảo ý tưởng và số lượng lớn',
    badge: 'LITE',
  },
]

const ASPECT_RATIOS: { key: ImageAspectRatio; label: string; iconRatio: string }[] = [
  { key: '16:9', label: '16:9 Ngang', iconRatio: 'landscape' },
  { key: '4:3', label: '4:3 Màn ảnh', iconRatio: 'standard' },
  { key: '1:1', label: '1:1 Vuông', iconRatio: 'square' },
  { key: '3:4', label: '3:4 Đứng', iconRatio: 'portrait-narrow' },
  { key: '9:16', label: '9:16 Shorts', iconRatio: 'portrait' },
]

export function TextToImageTab({ activeProject, onSendToVideo }: Props) {
  // Config state
  const [selectedModelKey, setSelectedModelKey] = useState<ImageModelKey>('GEM_PIX_2')
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false)
  const [aspectRatio, setAspectRatio] = useState<ImageAspectRatio>('16:9')
  const [variationCount, setVariationCount] = useState<number>(1)

  // Prompt state
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const [prompt, setPrompt] = useState('')
  const [batchText, setBatchText] = useState('')

  // Execution state
  const [generating, setGenerating] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')
  const [successMessage, setSuccessMessage] = useState('')

  // Gallery state
  const [images, setImages] = useState<VeoImageItem[]>([])
  const [loadingImages, setLoadingImages] = useState(false)
  const [previewImage, setPreviewImage] = useState<VeoImageItem | null>(null)
  const [copiedPromptId, setCopiedPromptId] = useState<string | null>(null)

  const currentModel = MODELS.find((m) => m.key === selectedModelKey) || MODELS[0]

  // Load images
  const loadImages = async () => {
    setLoadingImages(true)
    try {
      const list = await api.getImages(activeProject?.id)
      setImages(list)
    } catch {
      // ignore
    } finally {
      setLoadingImages(false)
    }
  }

  useEffect(() => {
    loadImages()
  }, [activeProject?.id])

  // Handle single generation
  const handleGenerateSingle = async () => {
    if (!prompt.trim()) {
      setErrorMessage('Vui lòng nhập mô tả hình ảnh (prompt)')
      return
    }

    setGenerating(true)
    setErrorMessage('')
    setSuccessMessage('')

    try {
      const req: VeoImageGenerateRequest = {
        prompt: prompt.trim(),
        model_key: selectedModelKey,
        model_display_name: currentModel.name,
        aspect_ratio: aspectRatio,
        count: variationCount,
        project_id: activeProject?.id,
      }

      const res = await api.generateImages(req)
      if (res.ok && res.images.length > 0) {
        setSuccessMessage(`Đã tạo thành công ${res.images.length} ảnh với 🍌 ${currentModel.name}`)
        setImages((prev) => [...res.images, ...prev])
      } else {
        setErrorMessage(res.error || 'Tạo ảnh thất bại')
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi kết nối khi tạo ảnh')
    } finally {
      setGenerating(false)
    }
  }

  // Handle batch generation
  const handleGenerateBatch = async () => {
    if (!batchText.trim()) {
      setErrorMessage('Vui lòng nhập danh sách kịch bản ảnh theo số thứ tự (1., 2., ...)')
      return
    }

    // Split lines by numbered prompts: 1., 2., etc.
    const lines = batchText.split('\n')
    const promptList: string[] = []
    let currentBuffer = ''

    for (const line of lines) {
      const match = line.trim().match(/^(\d+)[\.\)]\s*(.*)/)
      if (match) {
        if (currentBuffer.trim()) {
          promptList.push(currentBuffer.trim())
        }
        currentBuffer = match[2] || ''
      } else {
        currentBuffer += (currentBuffer ? '\n' : '') + line
      }
    }
    if (currentBuffer.trim()) {
      promptList.push(currentBuffer.trim())
    }

    if (!promptList.length) {
      setErrorMessage('Không nhận diện được phân cảnh nào. Hãy định dạng: 1. Prompt một, 2. Prompt hai...')
      return
    }

    setGenerating(true)
    setErrorMessage('')
    setSuccessMessage(`Bắt đầu chạy batch ${promptList.length} ảnh...`)

    let successCount = 0
    try {
      for (let i = 0; i < promptList.length; i++) {
        const p = promptList[i]
        setSuccessMessage(`Đang tạo ảnh ${i + 1}/${promptList.length}: "${p.slice(0, 40)}..."`)
        const req: VeoImageGenerateRequest = {
          prompt: p,
          model_key: selectedModelKey,
          model_display_name: currentModel.name,
          aspect_ratio: aspectRatio,
          count: variationCount,
          project_id: activeProject?.id,
        }
        const res = await api.generateImages(req)
        if (res.ok && res.images.length > 0) {
          successCount += res.images.length
          setImages((prev) => [...res.images, ...prev])
        }
      }
      setSuccessMessage(`Hoàn tất batch! Đã tạo thành công ${successCount} ảnh.`)
    } catch (err: any) {
      setErrorMessage(`Lỗi trong quá trình chạy batch: ${err.message}`)
    } finally {
      setGenerating(false)
    }
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
      {/* ─── Studio Ribbon Bar (Top Controls) ─── */}
      <div className="veo-studio-ribbon">
        {/* Model Selector Dropdown */}
        <div className="veo-ribbon-group">
          <span className="veo-ribbon-label">MODEL ẢNH</span>
          <div className="veo-model-dropdown-wrap">
            <button
              type="button"
              className={`veo-model-trigger ${modelDropdownOpen ? 'open' : ''}`}
              onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
            >
              <div className="veo-model-trigger-left">
                <span className="veo-banana-icon">🍌</span>
                <span className="veo-model-trigger-name">{currentModel.name}</span>
                <span className="veo-model-badge">{currentModel.badge}</span>
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
                      <span className="veo-banana-icon">🍌</span>
                      <span className="veo-model-option-name">{m.name}</span>
                      <span className="veo-model-badge">{m.badge}</span>
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
              >
                {r.key}
              </button>
            ))}
          </div>
        </div>

        <div className="veo-ribbon-divider" />

        {/* Output Count (x1 to x4) */}
        <div className="veo-ribbon-group">
          <span className="veo-ribbon-label">SỐ LƯỢNG BIẾN THỂ</span>
          <div className="veo-pill-group">
            {[1, 2, 3, 4].map((cnt) => (
              <button
                key={cnt}
                type="button"
                className={`veo-pill-btn ${variationCount === cnt ? 'active' : ''}`}
                onClick={() => setVariationCount(cnt)}
              >
                x{cnt}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ─── Prompt Workspace ─── */}
      <div className="veo-image-prompt-box">
        <div className="veo-image-prompt-header">
          <div className="veo-image-mode-switch">
            <button
              type="button"
              className={`veo-mode-btn ${mode === 'single' ? 'active' : ''}`}
              onClick={() => setMode('single')}
            >
              Prompt Đơn lẻ
            </button>
            <button
              type="button"
              className={`veo-mode-btn ${mode === 'batch' ? 'active' : ''}`}
              onClick={() => setMode('batch')}
            >
              <Layers size={13} style={{ marginRight: 4 }} />
              Kịch bản Batch (1., 2., 3...)
            </button>
          </div>

          <div className="veo-image-active-summary">
            🍌 {currentModel.name} · Tỉ lệ {aspectRatio} · {variationCount} ảnh/lần
          </div>
        </div>

        {mode === 'single' ? (
          <div className="veo-image-input-wrap">
            <textarea
              className="veo-image-textarea"
              placeholder="Bạn muốn tạo những gì? Ví dụ: Chú gấu phi hành gia khám phá sao Hỏa rực rỡ, góc máy điện ảnh 4K..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              disabled={generating}
            />
            <div className="veo-image-action-bar">
              <span className="veo-credit-hint">Chi phí: 0 tín dụng Google Flow</span>
              <button
                type="button"
                className="veo-btn-primary"
                onClick={handleGenerateSingle}
                disabled={generating || !prompt.trim()}
              >
                {generating ? (
                  <>
                    <RefreshCw size={15} className="veo-spin" />
                    <span>Đang tạo ảnh qua Google Flow...</span>
                  </>
                ) : (
                  <>
                    <Sparkles size={15} />
                    <span>Tạo {variationCount} Ảnh (🍌 {currentModel.name})</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <div className="veo-image-input-wrap">
            <textarea
              className="veo-image-textarea"
              placeholder={'1. Phong cảnh hoàng hôn trên biển nhiệt đới\n2. Phi thuyền lơ lửng trên thành phố cyberpunk tương lai\n3. Chân dung cô gái ánh mắt lấp lánh dưới tán lá mùa thu'}
              value={batchText}
              onChange={(e) => setBatchText(e.target.value)}
              rows={5}
              disabled={generating}
            />
            <div className="veo-image-action-bar">
              <span className="veo-credit-hint">Nhập mỗi dòng bắt đầu bằng số thứ tự (1., 2., 3...)</span>
              <button
                type="button"
                className="veo-btn-primary"
                onClick={handleGenerateBatch}
                disabled={generating || !batchText.trim()}
              >
                {generating ? (
                  <>
                    <RefreshCw size={15} className="veo-spin" />
                    <span>Đang chạy batch ảnh...</span>
                  </>
                ) : (
                  <>
                    <Layers size={15} />
                    <span>Chạy Batch Kịch Bản</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {/* Notifications */}
        {errorMessage && <div className="veo-error-banner">{errorMessage}</div>}
        {successMessage && <div className="veo-success-banner">{successMessage}</div>}
      </div>

      {/* ─── Gallery Section ─── */}
      <div className="veo-image-gallery-section">
        <div className="veo-image-gallery-header">
          <div className="veo-gallery-title">
            <span>BỘ SƯU TẬP ẢNH ĐÃ TẠO</span>
            <span className="veo-gallery-count">({images.length})</span>
          </div>
          <button type="button" className="veo-btn-ghost" onClick={loadImages} disabled={loadingImages}>
            <RefreshCw size={14} className={loadingImages ? 'veo-spin' : ''} />
            <span>Làm mới</span>
          </button>
        </div>

        {images.length === 0 ? (
          <div className="veo-image-empty">
            <Sparkles size={36} className="veo-empty-icon" />
            <p>Chưa có hình ảnh nào được tạo trong dự án này.</p>
            <span>Nhập prompt phía trên và bấm <strong>"Tạo Ảnh"</strong> để bắt đầu.</span>
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
                      className="veo-overlay-btn"
                      title="Phóng to"
                      onClick={(e) => {
                        e.stopPropagation()
                        setPreviewImage(item)
                      }}
                    >
                      <Maximize2 size={15} />
                    </button>
                    {onSendToVideo && (
                      <button
                        type="button"
                        className="veo-overlay-btn highlight"
                        title="Chuyển sang làm Video (Image-to-Video)"
                        onClick={(e) => {
                          e.stopPropagation()
                          onSendToVideo(item)
                        }}
                      >
                        <Film size={15} />
                      </button>
                    )}
                  </div>
                  <div className="veo-image-card-badges">
                    <span className="veo-badge-chip">🍌 {item.model_display_name.replace('Nano Banana', '').trim() || 'Pro'}</span>
                    <span className="veo-badge-chip">{item.aspect_ratio}</span>
                  </div>
                </div>

                <div className="veo-image-card-footer">
                  <p className="veo-image-card-prompt" title={item.prompt}>
                    {item.prompt}
                  </p>
                  <div className="veo-image-card-actions">
                    <button
                      type="button"
                      className="veo-icon-btn"
                      title="Sao chép prompt"
                      onClick={() => handleCopyPrompt(item)}
                    >
                      {copiedPromptId === item.id ? <Check size={13} color="#4ade80" /> : <Copy size={13} />}
                    </button>
                    <a
                      href={api.getImageFileUrl(item.id)}
                      download={`nano-banana-${item.id}.jpg`}
                      className="veo-icon-btn"
                      title="Tải ảnh về máy"
                    >
                      <Download size={13} />
                    </a>
                    <button
                      type="button"
                      className="veo-icon-btn danger"
                      title="Xóa ảnh"
                      onClick={() => handleDelete(item.id)}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ─── Full-screen Lightbox Modal ─── */}
      {previewImage && (
        <div className="veo-lightbox-backdrop" onClick={() => setPreviewImage(null)}>
          <div className="veo-lightbox-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="veo-lightbox-close" onClick={() => setPreviewImage(null)}>
              <X size={20} />
            </button>

            <div className="veo-lightbox-media">
              <img
                src={api.getImageFileUrl(previewImage.id)}
                alt={previewImage.prompt}
                onError={(e) => {
                  if (previewImage.image_url) {
                    ;(e.target as HTMLImageElement).src = previewImage.image_url
                  }
                }}
              />
            </div>

            <div className="veo-lightbox-info">
              <div className="veo-lightbox-meta">
                <span className="veo-badge-chip">🍌 {previewImage.model_display_name}</span>
                <span className="veo-badge-chip">{previewImage.aspect_ratio}</span>
                {previewImage.seed && <span className="veo-badge-chip">Seed: {previewImage.seed}</span>}
              </div>

              <p className="veo-lightbox-prompt">{previewImage.prompt}</p>

              <div className="veo-lightbox-actions">
                {onSendToVideo && (
                  <button
                    type="button"
                    className="veo-btn-primary"
                    onClick={() => {
                      onSendToVideo(previewImage)
                      setPreviewImage(null)
                    }}
                  >
                    <Film size={15} />
                    <span>Dùng ảnh này tạo Video (I2V)</span>
                  </button>
                )}
                <a
                  href={api.getImageFileUrl(previewImage.id)}
                  download={`nano-banana-${previewImage.id}.jpg`}
                  className="veo-btn-secondary"
                >
                  <Download size={15} />
                  <span>Tải ảnh gốc</span>
                </a>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
