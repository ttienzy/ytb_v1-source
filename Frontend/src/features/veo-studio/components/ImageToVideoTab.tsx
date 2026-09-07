import { useEffect, useRef, useState } from 'react'
import {
  ImagePlus,
  Sparkles,
  X,
  ShieldCheck,
  Zap,
  User,
  Image as ImageIcon,
  Palette,
  FolderOpen,
  Upload,
  ArrowRight,
  Check,
  Layers,
  HelpCircle,
} from 'lucide-react'
import type { VeoCapabilities, VeoImageItem, VeoJobRequest, VeoProject } from '../types'
import * as api from '../services/veoApi'

interface Props {
  capabilities: VeoCapabilities | null
  onSubmit: (request: VeoJobRequest) => void
  busy: boolean
  activeProject?: VeoProject | null
  initialImagePath?: string | null
  initialImagePreview?: string | null
  initialPrompt?: string
}

interface ImageSlotData {
  path: string
  preview: string
  name?: string
}

type SlotTarget = 'first_frame' | 'end_frame' | 'subject' | 'scene' | 'style'

export function ImageToVideoTab({
  capabilities,
  onSubmit,
  busy,
  activeProject,
  initialImagePath,
  initialImagePreview,
  initialPrompt,
}: Props) {
  const [inputMode, setInputMode] = useState<'frames' | 'ingredients'>('frames')
  const [profileId, setProfileId] = useState('')
  const [prompt, setPrompt] = useState(initialPrompt || '')

  // ─── Frames Mode (Tối đa 2 ảnh: Frame đầu & Frame cuối) ───
  const [firstFrame, setFirstFrame] = useState<ImageSlotData | null>(
    initialImagePath && initialImagePreview
      ? { path: initialImagePath, preview: initialImagePreview, name: 'Frame đầu' }
      : null,
  )
  const [endFrame, setEndFrame] = useState<ImageSlotData | null>(null)

  // ─── Ingredients Mode (Tối đa 3 ảnh: Subject, Scene, Style) ───
  const [ingredientSlots, setIngredientSlots] = useState<{
    subject: ImageSlotData | null
    scene: ImageSlotData | null
    style: ImageSlotData | null
  }>({
    subject:
      initialImagePath && initialImagePreview
        ? { path: initialImagePath, preview: initialImagePreview, name: 'Chủ thể' }
        : null,
    scene: null,
    style: null,
  })

  // ─── Upload & Library State ───
  const [uploadingSlot, setUploadingSlot] = useState<SlotTarget | null>(null)
  const [activeSlotTarget, setActiveSlotTarget] = useState<SlotTarget | null>(null)
  const [libraryModalOpen, setLibraryModalOpen] = useState(false)
  const [libraryImages, setLibraryImages] = useState<VeoImageItem[]>([])
  const [loadingLibrary, setLoadingLibrary] = useState(false)

  const fileInputRef = useRef<HTMLInputElement>(null)

  // Đồng bộ khi nhận props forwarded từ tab Tạo Ảnh
  useEffect(() => {
    if (initialImagePath && initialImagePreview) {
      if (inputMode === 'frames') {
        setFirstFrame({ path: initialImagePath, preview: initialImagePreview, name: 'Ảnh đã chọn' })
      } else {
        setIngredientSlots((prev) => ({
          ...prev,
          subject: { path: initialImagePath, preview: initialImagePreview, name: 'Chủ thể' },
        }))
      }
    }
    if (initialPrompt) setPrompt(initialPrompt)
  }, [initialImagePath, initialImagePreview, initialPrompt])

  // Lọc profiles theo chế độ đầu vào hiện tại
  const profiles = (capabilities?.profiles || []).filter((p) => p.input_mode === inputMode)
  const selectedProfile = profiles.find((p) => p.id === profileId) || profiles[0]

  useEffect(() => {
    if (profiles.length && !profiles.some((p) => p.id === profileId)) {
      setProfileId(profiles[0].id)
    }
  }, [capabilities, inputMode, profileId, profiles])

  const modelNames = [...new Set(profiles.map((p) => p.model_display_name))]

  const aspectRatios = selectedProfile
    ? [
        ...new Set(
          profiles
            .filter((p) => p.model_display_name === selectedProfile.model_display_name)
            .map((p) => p.aspect_ratio),
        ),
      ]
    : []

  const durations = selectedProfile
    ? [
        ...new Set(
          profiles
            .filter(
              (p) =>
                p.model_display_name === selectedProfile.model_display_name &&
                p.aspect_ratio === selectedProfile.aspect_ratio,
            )
            .map((p) => p.duration_seconds),
        ),
      ].sort((a, b) => a - b)
    : []

  const resolutions = selectedProfile
    ? [
        ...new Set(
          profiles
            .filter(
              (p) =>
                p.model_display_name === selectedProfile.model_display_name &&
                p.aspect_ratio === selectedProfile.aspect_ratio &&
                p.duration_seconds === selectedProfile.duration_seconds,
            )
            .map((p) => p.resolution),
        ),
      ]
    : []

  const selectProfile = (predicate: (p: typeof profiles[number]) => boolean) => {
    const next = profiles.find(predicate)
    if (next) setProfileId(next.id)
  }

  const selectModel = (modelName: string) => {
    const first = profiles.find((p) => p.model_display_name === modelName)
    if (first) setProfileId(first.id)
  }

  const handleModeChange = (mode: 'frames' | 'ingredients') => {
    setInputMode(mode)
    setProfileId('')
  }

  // ─── Slot Actions ───
  const triggerUpload = (target: SlotTarget) => {
    setActiveSlotTarget(target)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
      fileInputRef.current.click()
    }
  }

  const handleFileUpload = async (file: File | undefined) => {
    if (!file || !activeSlotTarget) return
    setUploadingSlot(activeSlotTarget)
    try {
      const result = await api.uploadImage(file)
      const data: ImageSlotData = {
        path: result.file_path,
        preview: URL.createObjectURL(file),
        name: file.name,
      }
      applySlotImage(activeSlotTarget, data)
    } catch {
      alert('Upload ảnh thất bại')
    } finally {
      setUploadingSlot(null)
      setActiveSlotTarget(null)
    }
  }

  const openLibraryPicker = async (target: SlotTarget) => {
    setActiveSlotTarget(target)
    setLibraryModalOpen(true)
    setLoadingLibrary(true)
    try {
      let list = await api.getImages(activeProject?.id)
      if ((!list || list.length === 0) && !activeProject?.id) {
        list = await api.getImages()
      }
      setLibraryImages(list || [])
    } catch {
      // ignore
    } finally {
      setLoadingLibrary(false)
    }
  }

  const selectLibraryImage = (item: VeoImageItem) => {
    if (!activeSlotTarget) return
    const data: ImageSlotData = {
      path: item.local_path || item.image_url,
      preview: api.getImageFileUrl(item.id),
      name: item.prompt.slice(0, 30),
    }
    applySlotImage(activeSlotTarget, data)
    setLibraryModalOpen(false)
    setActiveSlotTarget(null)
  }

  const applySlotImage = (target: SlotTarget, data: ImageSlotData) => {
    if (target === 'first_frame') setFirstFrame(data)
    else if (target === 'end_frame') setEndFrame(data)
    else if (target === 'subject') setIngredientSlots((prev) => ({ ...prev, subject: data }))
    else if (target === 'scene') setIngredientSlots((prev) => ({ ...prev, scene: data }))
    else if (target === 'style') setIngredientSlots((prev) => ({ ...prev, style: data }))
  }

  const removeSlotImage = (target: SlotTarget) => {
    if (target === 'first_frame') setFirstFrame(null)
    else if (target === 'end_frame') setEndFrame(null)
    else if (target === 'subject') setIngredientSlots((prev) => ({ ...prev, subject: null }))
    else if (target === 'scene') setIngredientSlots((prev) => ({ ...prev, scene: null }))
    else if (target === 'style') setIngredientSlots((prev) => ({ ...prev, style: null }))
  }

  // ─── Submit ───
  const handleSubmit = () => {
    if (!prompt.trim() || !activeProject || !selectedProfile) return

    let imagePath: string | null = null
    let endImagePath: string | null = null
    const ingredientPaths: string[] = []

    if (inputMode === 'frames') {
      if (!firstFrame) return
      imagePath = firstFrame.path
      endImagePath = endFrame ? endFrame.path : null
    } else {
      if (ingredientSlots.subject) ingredientPaths.push(ingredientSlots.subject.path)
      if (ingredientSlots.scene) ingredientPaths.push(ingredientSlots.scene.path)
      if (ingredientSlots.style) ingredientPaths.push(ingredientSlots.style.path)
      if (ingredientPaths.length === 0) return
      imagePath = ingredientPaths[0] // fallback
    }

    onSubmit({
      project_id: activeProject.id,
      prompt: prompt.trim(),
      model_display_name: selectedProfile.model_display_name,
      input_mode: selectedProfile.input_mode,
      aspect_ratio: selectedProfile.aspect_ratio,
      duration_seconds: selectedProfile.duration_seconds,
      resolution: selectedProfile.resolution,
      num_outputs: selectedProfile.num_outputs,
      image_path: imagePath,
      end_image_path: endImagePath,
      ingredient_image_paths: ingredientPaths,
    })
  }

  // Đếm số lượng ảnh đã chọn
  const ingredientCount = [
    ingredientSlots.subject,
    ingredientSlots.scene,
    ingredientSlots.style,
  ].filter(Boolean).length

  const ProfileBadge = () => {
    if (!selectedProfile) return null
    if (selectedProfile.runtime_verified) {
      return (
        <span className="veo-badge veo-badge--verified">
          <ShieldCheck size={12} />
          Đã xác minh runtime
        </span>
      )
    }
    return (
      <span className="veo-badge veo-badge--documented">
        <Zap size={12} />
        Theo chuẩn Google Flow
      </span>
    )
  }

  return (
    <div className="veo-tab-content">
      {/* Ẩn input file chung để kích hoạt theo slot */}
      <input
        ref={fileInputRef}
        hidden
        type="file"
        accept="image/*"
        onChange={(e) => handleFileUpload(e.target.files?.[0])}
      />

      {/* Mode toggle: frames vs ingredients */}
      <div className="veo-ref-mode-header">
        <label className="veo-label" style={{ marginBottom: 0 }}>Chế độ đầu vào</label>
        <span className="veo-ref-mode-hint">
          {inputMode === 'frames'
            ? 'Tối đa 2 ảnh (Frame đầu & Frame cuối)'
            : 'Tối đa 3 ảnh thành phần (Chủ thể, Bối cảnh, Phong cách)'}
        </span>
      </div>

      <div className="veo-aspect-row">
        <button
          className={`veo-aspect-btn ${inputMode === 'frames' ? 'active' : ''}`}
          onClick={() => handleModeChange('frames')}
        >
          🖼️ Khung hình (Frames)
        </button>
        <button
          className={`veo-aspect-btn ${inputMode === 'ingredients' ? 'active' : ''}`}
          onClick={() => handleModeChange('ingredients')}
        >
          🧩 Thành phần (Ingredients)
        </button>
      </div>

      {/* ─── PHẦN 1: GIAO DIỆN CHẾ ĐỘ KHUNG HÌNH (FRAMES - TỐI ĐA 2 ẢNH) ─── */}
      {inputMode === 'frames' && (
        <div className="veo-frames-container">
          <div className="veo-frames-grid">
            {/* Slot 1: First Frame (Bắt buộc) */}
            <div className="veo-frame-slot-card">
              <div className="veo-slot-header">
                <div className="veo-slot-title">
                  <span className="veo-slot-badge required">Frame 1</span>
                  <strong>Khung hình bắt đầu</strong>
                </div>
                <span className="veo-slot-tag">Bắt buộc</span>
              </div>

              {firstFrame ? (
                <div className="veo-slot-preview-box">
                  <img src={firstFrame.preview} alt="Frame đầu" />
                  <div className="veo-slot-overlay">
                    <button
                      type="button"
                      className="veo-slot-action-btn"
                      onClick={() => openLibraryPicker('first_frame')}
                      title="Đổi ảnh khác"
                    >
                      <FolderOpen size={13} />
                      Đổi ảnh
                    </button>
                    <button
                      type="button"
                      className="veo-slot-action-btn danger"
                      onClick={() => removeSlotImage('first_frame')}
                      title="Xóa ảnh"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="veo-slot-empty-box">
                  <div className="veo-slot-empty-icon">
                    <ImagePlus size={22} />
                  </div>
                  <span className="veo-slot-empty-title">
                    {uploadingSlot === 'first_frame' ? 'Đang tải lên...' : 'Chọn khung hình đầu'}
                  </span>
                  <div className="veo-slot-btn-group">
                    <button
                      type="button"
                      className="veo-slot-btn-upload"
                      onClick={() => triggerUpload('first_frame')}
                    >
                      <Upload size={12} />
                      <span>Tải từ máy</span>
                    </button>
                    <button
                      type="button"
                      className="veo-slot-btn-library"
                      onClick={() => openLibraryPicker('first_frame')}
                    >
                      <FolderOpen size={12} />
                      <span>Thư viện Veo</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Transition Arrow */}
            <div className="veo-frames-connector">
              <ArrowRight size={18} />
              <span>Nội suy</span>
            </div>

            {/* Slot 2: End Frame (Tùy chọn) */}
            <div className="veo-frame-slot-card">
              <div className="veo-slot-header">
                <div className="veo-slot-title">
                  <span className="veo-slot-badge optional">Frame 2</span>
                  <strong>Khung hình kết thúc</strong>
                </div>
                <span className="veo-slot-tag optional">Tùy chọn</span>
              </div>

              {endFrame ? (
                <div className="veo-slot-preview-box">
                  <img src={endFrame.preview} alt="Frame cuối" />
                  <div className="veo-slot-overlay">
                    <button
                      type="button"
                      className="veo-slot-action-btn"
                      onClick={() => openLibraryPicker('end_frame')}
                      title="Đổi ảnh khác"
                    >
                      <FolderOpen size={13} />
                      Đổi ảnh
                    </button>
                    <button
                      type="button"
                      className="veo-slot-action-btn danger"
                      onClick={() => removeSlotImage('end_frame')}
                      title="Xóa ảnh"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="veo-slot-empty-box">
                  <div className="veo-slot-empty-icon">
                    <ImagePlus size={22} />
                  </div>
                  <span className="veo-slot-empty-title">
                    {uploadingSlot === 'end_frame' ? 'Đang tải lên...' : 'Thêm khung hình kết thúc'}
                  </span>
                  <div className="veo-slot-btn-group">
                    <button
                      type="button"
                      className="veo-slot-btn-upload"
                      onClick={() => triggerUpload('end_frame')}
                    >
                      <Upload size={12} />
                      <span>Tải từ máy</span>
                    </button>
                    <button
                      type="button"
                      className="veo-slot-btn-library"
                      onClick={() => openLibraryPicker('end_frame')}
                    >
                      <FolderOpen size={12} />
                      <span>Thư viện Veo</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── PHẦN 2: GIAO DIỆN CHẾ ĐỘ THÀNH PHẦN (INGREDIENTS - TỐI ĐA 3 ẢNH) ─── */}
      {inputMode === 'ingredients' && (
        <div className="veo-ingredients-container">
          <div className="veo-ingredients-header">
            <div className="veo-ingredients-title-wrap">
              <Layers size={14} className="veo-ingr-icon" />
              <span>CÁC THÀNH PHẦN THAM CHIẾU</span>
              <span className="veo-ingr-badge">{ingredientCount}/3</span>
            </div>
            <span className="veo-ingr-help">
              Google Flow kết hợp tối đa 3 thành phần để tạo tính nhất quán cho cảnh
            </span>
          </div>

          <div className="veo-ingredients-grid">
            {/* Slot 1: Chủ thể (Subject) */}
            <div className="veo-ingredient-slot-card">
              <div className="veo-slot-header">
                <div className="veo-slot-title">
                  <User size={13} className="veo-slot-role-icon subject" />
                  <strong>1. Chủ thể / Nhân vật</strong>
                </div>
                {ingredientSlots.subject && <Check size={13} className="veo-slot-check" />}
              </div>
              <p className="veo-slot-desc">Giữ khuôn mặt, nhận diện hoặc trang phục nhân vật</p>

              {ingredientSlots.subject ? (
                <div className="veo-slot-preview-box">
                  <img src={ingredientSlots.subject.preview} alt="Chủ thể" />
                  <div className="veo-slot-overlay">
                    <button
                      type="button"
                      className="veo-slot-action-btn"
                      onClick={() => openLibraryPicker('subject')}
                      title="Đổi ảnh khác"
                    >
                      <FolderOpen size={13} />
                      Đổi ảnh
                    </button>
                    <button
                      type="button"
                      className="veo-slot-action-btn danger"
                      onClick={() => removeSlotImage('subject')}
                      title="Xóa ảnh"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="veo-slot-empty-box compact">
                  <div className="veo-slot-btn-group">
                    <button
                      type="button"
                      className="veo-slot-btn-upload"
                      onClick={() => triggerUpload('subject')}
                    >
                      <Upload size={12} />
                      <span>Tải ảnh</span>
                    </button>
                    <button
                      type="button"
                      className="veo-slot-btn-library"
                      onClick={() => openLibraryPicker('subject')}
                    >
                      <FolderOpen size={12} />
                      <span>Thư viện</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Slot 2: Bối cảnh (Scene) */}
            <div className="veo-ingredient-slot-card">
              <div className="veo-slot-header">
                <div className="veo-slot-title">
                  <ImageIcon size={13} className="veo-slot-role-icon scene" />
                  <strong>2. Bối cảnh / Không gian</strong>
                </div>
                {ingredientSlots.scene && <Check size={13} className="veo-slot-check" />}
              </div>
              <p className="veo-slot-desc">Địa điểm, môi trường xung quanh hoặc khung cảnh</p>

              {ingredientSlots.scene ? (
                <div className="veo-slot-preview-box">
                  <img src={ingredientSlots.scene.preview} alt="Bối cảnh" />
                  <div className="veo-slot-overlay">
                    <button
                      type="button"
                      className="veo-slot-action-btn"
                      onClick={() => openLibraryPicker('scene')}
                      title="Đổi ảnh khác"
                    >
                      <FolderOpen size={13} />
                      Đổi ảnh
                    </button>
                    <button
                      type="button"
                      className="veo-slot-action-btn danger"
                      onClick={() => removeSlotImage('scene')}
                      title="Xóa ảnh"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="veo-slot-empty-box compact">
                  <div className="veo-slot-btn-group">
                    <button
                      type="button"
                      className="veo-slot-btn-upload"
                      onClick={() => triggerUpload('scene')}
                    >
                      <Upload size={12} />
                      <span>Tải ảnh</span>
                    </button>
                    <button
                      type="button"
                      className="veo-slot-btn-library"
                      onClick={() => openLibraryPicker('scene')}
                    >
                      <FolderOpen size={12} />
                      <span>Thư viện</span>
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Slot 3: Phong cách / Vật thể (Style / Object) */}
            <div className="veo-ingredient-slot-card">
              <div className="veo-slot-header">
                <div className="veo-slot-title">
                  <Palette size={13} className="veo-slot-role-icon style" />
                  <strong>3. Phong cách / Vật thể</strong>
                </div>
                {ingredientSlots.style && <Check size={13} className="veo-slot-check" />}
              </div>
              <p className="veo-slot-desc">Tông màu mỹ thuật, ánh sáng hoặc đạo cụ chi tiết</p>

              {ingredientSlots.style ? (
                <div className="veo-slot-preview-box">
                  <img src={ingredientSlots.style.preview} alt="Phong cách" />
                  <div className="veo-slot-overlay">
                    <button
                      type="button"
                      className="veo-slot-action-btn"
                      onClick={() => openLibraryPicker('style')}
                      title="Đổi ảnh khác"
                    >
                      <FolderOpen size={13} />
                      Đổi ảnh
                    </button>
                    <button
                      type="button"
                      className="veo-slot-action-btn danger"
                      onClick={() => removeSlotImage('style')}
                      title="Xóa ảnh"
                    >
                      <X size={13} />
                    </button>
                  </div>
                </div>
              ) : (
                <div className="veo-slot-empty-box compact">
                  <div className="veo-slot-btn-group">
                    <button
                      type="button"
                      className="veo-slot-btn-upload"
                      onClick={() => triggerUpload('style')}
                    >
                      <Upload size={12} />
                      <span>Tải ảnh</span>
                    </button>
                    <button
                      type="button"
                      className="veo-slot-btn-library"
                      onClick={() => openLibraryPicker('style')}
                    >
                      <FolderOpen size={12} />
                      <span>Thư viện</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ─── PROMPT ─── */}
      <div className="veo-prompt-header-row">
        <label className="veo-label" style={{ marginBottom: 0 }}>
          {inputMode === 'frames' ? 'Mô tả chuyển động (Motion Prompt)' : 'Mô tả cảnh với thành phần'}
        </label>
        {inputMode === 'ingredients' && (
          <div className="veo-prompt-shortcuts">
            <span className="veo-shortcut-label">Chèn nhanh:</span>
            <button
              type="button"
              className="veo-shortcut-btn"
              onClick={() => setPrompt((p) => (p ? `${p} [Chủ thể]` : '[Chủ thể]'))}
            >
              + [Chủ thể]
            </button>
            <button
              type="button"
              className="veo-shortcut-btn"
              onClick={() => setPrompt((p) => (p ? `${p} [Bối cảnh]` : '[Bối cảnh]'))}
            >
              + [Bối cảnh]
            </button>
            <button
              type="button"
              className="veo-shortcut-btn"
              onClick={() => setPrompt((p) => (p ? `${p} [Phong cách]` : '[Phong cách]'))}
            >
              + [Phong cách]
            </button>
          </div>
        )}
      </div>

      <textarea
        className="veo-textarea"
        rows={3}
        placeholder={
          inputMode === 'frames'
            ? 'Camera từ từ phóng to khi nhân vật quay đầu nhìn lại, mưa rơi phản chiếu ánh đèn neon...'
            : 'Nhân vật trong [Chủ thể] đang bước đi tự tin giữa khung cảnh [Bối cảnh] với phong cách điện ảnh [Phong cách]...'
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {/* Model selector (Dropdown) */}
      {modelNames.length > 0 && (
        <div className="veo-model-select-row">
          <div className="veo-model-select-header">
            <label className="veo-label" htmlFor="veo-i2v-model-select">
              Model Video
            </label>
            {selectedProfile?.credit_cost != null && (
              <span className="veo-credit-tag">
                {selectedProfile.credit_cost} credits / lần tạo
              </span>
            )}
          </div>
          <select
            id="veo-i2v-model-select"
            className="veo-select veo-model-dropdown"
            value={selectedProfile?.model_display_name || ''}
            onChange={(e) => selectModel(e.target.value)}
          >
            {modelNames.map((modelName) => {
              const repProfile =
                profiles.find(
                  (p) => p.model_display_name === modelName && p.resolution === '720p',
                ) || profiles.find((p) => p.model_display_name === modelName)
              const cost = repProfile?.credit_cost != null ? `${repProfile.credit_cost} credits` : '—'
              return (
                <option key={modelName} value={modelName}>
                  {modelName} ({cost})
                </option>
              )
            })}
          </select>
        </div>
      )}

      {selectedProfile && (
        <>
          {/* Aspect Ratio */}
          <label className="veo-label">Tỉ lệ khung hình</label>
          <div className="veo-aspect-row">
            {(['16:9', '9:16'] as const).map((ar) => (
              <button
                key={ar}
                className={`veo-aspect-btn ${selectedProfile.aspect_ratio === ar ? 'active' : ''}`}
                onClick={() =>
                  selectProfile(
                    (p) =>
                      p.model_display_name === selectedProfile.model_display_name &&
                      p.aspect_ratio === ar &&
                      p.duration_seconds === selectedProfile.duration_seconds &&
                      p.resolution === selectedProfile.resolution,
                  )
                }
                disabled={!aspectRatios.includes(ar)}
              >
                <span className={`veo-aspect-icon ${ar === '16:9' ? 'landscape' : 'portrait'}`} />
                {ar}
              </button>
            ))}
          </div>

          {/* Duration */}
          <label className="veo-label">Thời lượng</label>
          <div className="veo-duration-row">
            {durations.map((d) => (
              <button
                key={d}
                className={`veo-duration-btn ${selectedProfile.duration_seconds === d ? 'active' : ''}`}
                onClick={() =>
                  selectProfile(
                    (p) =>
                      p.model_display_name === selectedProfile.model_display_name &&
                      p.aspect_ratio === selectedProfile.aspect_ratio &&
                      p.duration_seconds === d &&
                      p.resolution === selectedProfile.resolution,
                  )
                }
              >
                {d}s
              </button>
            ))}
          </div>

          {/* Resolution */}
          <label className="veo-label">Độ phân giải</label>
          <div className="veo-duration-row">
            {resolutions.map((r) => (
              <button
                key={r}
                className={`veo-duration-btn ${selectedProfile.resolution === r ? 'active' : ''}`}
                onClick={() =>
                  selectProfile(
                    (p) =>
                      p.model_display_name === selectedProfile.model_display_name &&
                      p.aspect_ratio === selectedProfile.aspect_ratio &&
                      p.duration_seconds === selectedProfile.duration_seconds &&
                      p.resolution === r,
                  )
                }
              >
                {r}
                {r === '360p' && <span className="veo-res-tag"> Draft</span>}
              </button>
            ))}
          </div>

          {/* Status bar */}
          <div className="veo-profile-bar">
            <ProfileBadge />
            <span className="veo-credit-estimate">{selectedProfile.credit_cost} credits</span>
          </div>
        </>
      )}

      {/* Submit button */}
      <button
        className="veo-submit-btn"
        onClick={handleSubmit}
        disabled={
          busy ||
          !prompt.trim() ||
          !activeProject ||
          !selectedProfile ||
          (inputMode === 'frames' && !firstFrame) ||
          (inputMode === 'ingredients' && ingredientCount === 0)
        }
      >
        <Sparkles size={16} />
        {!activeProject
          ? 'Vui lòng chọn Project'
          : inputMode === 'frames' && !firstFrame
            ? 'Vui lòng chọn Frame bắt đầu'
            : inputMode === 'ingredients' && ingredientCount === 0
              ? 'Vui lòng chọn ít nhất 1 ảnh thành phần'
              : busy
                ? 'Đang xử lý...'
                : inputMode === 'frames'
                  ? `Tạo Video Khung Hình ${endFrame ? '(Start → End)' : '(Start)'} · ${selectedProfile?.credit_cost ?? '?'} credits`
                  : `Tạo Video từ ${ingredientCount} Thành Phần · ${selectedProfile?.credit_cost ?? '?'} credits`}
      </button>

      {/* ─── MODAL CHỌN ẢNH TỪ THƯ VIỆN VEO STUDIO ─── */}
      {libraryModalOpen && (
        <div className="veo-lightbox-backdrop" onClick={() => setLibraryModalOpen(false)}>
          <div
            className="veo-lightbox-card veo-library-picker-modal"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="veo-picker-modal-header">
              <div className="veo-picker-title">
                <FolderOpen size={16} color="#4f46e5" />
                <strong>Chọn Ảnh Từ Thư Viện Veo Studio</strong>
                <span className="veo-picker-target-tag">
                  {activeSlotTarget === 'first_frame'
                    ? 'Khung hình bắt đầu'
                    : activeSlotTarget === 'end_frame'
                      ? 'Khung hình kết thúc'
                      : activeSlotTarget === 'subject'
                        ? 'Thành phần: Chủ thể'
                        : activeSlotTarget === 'scene'
                          ? 'Thành phần: Bối cảnh'
                          : 'Thành phần: Phong cách'}
                </span>
              </div>
              <button
                type="button"
                className="veo-lightbox-close"
                onClick={() => setLibraryModalOpen(false)}
                title="Đóng"
              >
                <X size={16} />
              </button>
            </div>

            <div className="veo-picker-modal-body">
              {loadingLibrary ? (
                <div className="veo-picker-loading">
                  <span>Đang tải thư viện ảnh...</span>
                </div>
              ) : libraryImages.length === 0 ? (
                <div className="veo-picker-empty">
                  <ImageIcon size={32} color="#94a3b8" />
                  <h4>Chưa có hình ảnh nào trong Thư viện</h4>
                  <p>Hãy qua tab <strong>Tạo Ảnh (Studio)</strong> để sinh các ảnh nhân vật / bối cảnh với Nano Banana Pro.</p>
                </div>
              ) : (
                <div className="veo-picker-grid">
                  {libraryImages.map((item) => (
                    <div
                      key={item.id}
                      className="veo-picker-item-card"
                      onClick={() => selectLibraryImage(item)}
                      title={item.prompt}
                    >
                      <div className="veo-picker-thumb">
                        <img
                          src={api.getImageFileUrl(item.id)}
                          alt={item.prompt}
                          onError={(e) => {
                            if (item.image_url && (e.target as HTMLImageElement).src !== item.image_url) {
                              ;(e.target as HTMLImageElement).src = item.image_url
                            }
                          }}
                        />
                        <span className="veo-picker-ratio-tag">{item.aspect_ratio}</span>
                      </div>
                      <p className="veo-picker-prompt">{item.prompt}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
