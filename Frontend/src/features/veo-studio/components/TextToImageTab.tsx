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
  const [variationProgress, setVariationProgress] = useState<{ current: number; total: number } | null>(null)
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

    const total = variationCount
    let successCount = 0
    const baseSeed = Math.floor(Math.random() * 1000000000)

    try {
      for (let i = 0; i < total; i++) {
        setVariationProgress({ current: i + 1, total })

        const req: VeoImageGenerateRequest = {
          prompt: prompt.trim(),
          model_key: selectedModelKey,
          model_display_name: currentModel.name,
          aspect_ratio: aspectRatio,
          count: 1, // Tạo từng biến thể để cập nhật tiến trình trực tiếp & tránh timeout kết nối
          seed: baseSeed + i,
          project_id: activeProject?.id,
        }

        try {
          const res = await api.generateImages(req)
          if (res.ok && res.images.length > 0) {
            successCount += res.images.length
            // Ngay lập tức cập nhật ảnh mới vào thư viện để người dùng thấy kết quả thời gian thực
            setImages((prev) => [...res.images, ...prev])
          } else if (res.error) {
            setErrorMessage(`Biến thể #${i + 1}: ${res.error}`)
          }
        } catch (itemErr: any) {
          setErrorMessage(`Biến thể #${i + 1}: ${itemErr.message || 'Lỗi kết nối'}`)
        }
      }

      if (successCount > 0) {
        setSuccessMessage(`Đã tạo thành công ${successCount}/${total} hình ảnh với ${currentModel.name}`)
      }
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi kết nối khi tạo ảnh')
    } finally {
      setGenerating(false)
      setVariationProgress(null)
    }
  }

  // Handle batch generation
  const handleGenerateBatch = async () => {
    if (!batchText.trim()) {
      setErrorMessage('Vui lòng nhập danh sách kịch bản ảnh theo số thứ tự (1., 2., ...)')
      return
    }

    const lines = batchText.split('\n')
    const prompts: string[] = []
    let current = ''

    for (const rawLine of lines) {
      const line = rawLine.trim()
      if (!line) continue
      const match = line.match(/^(\d+)[\.\)]\s*(.+)/)
      if (match) {
        if (current) prompts.push(current)
        current = match[2]
      } else {
        if (current) {
          current += ' ' + line
        } else {
          current = line
        }
      }
    }
    if (current) prompts.push(current)

    if (prompts.length === 0) {
      setErrorMessage('Không nhận diện được prompt hợp lệ. Hãy bắt đầu mỗi cảnh bằng số thứ tự như "1. ", "2. "')
      return
    }

    setGenerating(true)
    setErrorMessage('')
    setSuccessMessage(`Đang bắt đầu tạo batch gồm ${prompts.length} cảnh ảnh qua Google Flow...`)

    let successCount = 0
    try {
      for (let i = 0; i < prompts.length; i++) {
        setVariationProgress({ current: i + 1, total: prompts.length })
        const p = prompts[i]
        const req: VeoImageGenerateRequest = {
          prompt: p,
          model_key: selectedModelKey,
          model_display_name: currentModel.name,
          aspect_ratio: aspectRatio,
          count: variationCount,
          project_id: activeProject?.id,
        }

        try {
          const res = await api.generateImages(req)
          if (res.ok && res.images.length > 0) {
            successCount += res.images.length
            setImages((prev) => [...res.images, ...prev])
          }
        } catch {
          // ignore single item error in batch
        }
      }
      setSuccessMessage(`Đã hoàn thành batch! Đã tạo thành công ${successCount} ảnh.`)
    } catch (err: any) {
      setErrorMessage(err.message || 'Lỗi khi thực thi batch ảnh')
    } finally {
      setGenerating(false)
      setVariationProgress(null)
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

        {/* Output Count (1 to 4) */}
        <div className="veo-ribbon-group">
          <span className="veo-ribbon-label">BIẾN THỂ</span>
          <div className="veo-pill-group">
            {[1, 2, 3, 4].map((cnt) => (
              <button
                key={cnt}
                type="button"
                className={`veo-pill-btn ${variationCount === cnt ? 'active' : ''}`}
                onClick={() => setVariationCount(cnt)}
                title={`Tạo đồng thời ${cnt} biến thể song song`}
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

        {mode === 'single' ? (
          <div className="veo-image-input-wrap">
            <textarea
              className="veo-image-textarea"
              placeholder="Nhập mô tả hình ảnh chi tiết: bối cảnh, ánh sáng, góc máy, nhân vật, chất liệu, độ phân giải 8K, cinematic..."
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={3}
              disabled={generating}
            />
            <div className="veo-image-action-bar">
              <div className="veo-engine-indicator">
                <span className={`veo-engine-dot ${generating ? 'busy' : 'online'}`} />
                <span className="veo-engine-label">
                  {generating && variationProgress
                    ? `Đang tạo biến thể ${variationProgress.current}/${variationProgress.total} qua Google Flow...`
                    : 'Google Flow Image Engine • Sẵn sàng'}
                </span>
              </div>
              <button
                type="button"
                className="veo-btn-generate"
                onClick={handleGenerateSingle}
                disabled={generating || !prompt.trim()}
              >
                {generating ? (
                  <>
                    <Loader2 size={15} className="veo-spin" />
                    <span>
                      {variationProgress
                        ? `Đang tạo ${variationProgress.current}/${variationProgress.total}...`
                        : 'Đang tạo ảnh qua Google Flow...'}
                    </span>
                  </>
                ) : (
                  <>
                    <Sparkles size={14} />
                    <span>Tạo {variationCount} Biến Thể ({currentModel.name})</span>
                  </>
                )}
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
              disabled={generating}
            />
            <div className="veo-image-action-bar">
              <span className="veo-helper-hint">Mỗi cảnh bắt đầu bằng số thứ tự (ví dụ: 1., 2., 3...)</span>
              <button
                type="button"
                className="veo-btn-generate"
                onClick={handleGenerateBatch}
                disabled={generating || !batchText.trim()}
              >
                {generating ? (
                  <>
                    <Loader2 size={15} className="veo-spin" />
                    <span>
                      {variationProgress
                        ? `Đang xử lý cảnh ${variationProgress.current}/${variationProgress.total}...`
                        : 'Đang xử lý batch ảnh...'}
                    </span>
                  </>
                ) : (
                  <>
                    <Layers size={14} />
                    <span>Chạy Kịch Bản Hàng Loạt</span>
                  </>
                )}
              </button>
            </div>
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
                    <a
                      href={api.getImageFileUrl(item.id)}
                      download={`flow_image_${item.id}.jpg`}
                      className="veo-overlay-action-btn"
                      title="Tải ảnh về máy"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Download size={14} />
                    </a>
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

                <a
                  href={api.getImageFileUrl(previewImage.id)}
                  download={`flow_${previewImage.id}.jpg`}
                  className="veo-btn-modal-secondary"
                >
                  <Download size={14} />
                  <span>Tải ảnh về máy</span>
                </a>

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
