import { useEffect, useRef, useState } from 'react'
import { ImagePlus, Sparkles, X, ShieldCheck, Zap } from 'lucide-react'
import type { VeoCapabilities, VeoJobRequest, VeoProject } from '../types'
import { uploadImage } from '../services/veoApi'

interface Props {
  capabilities: VeoCapabilities | null
  onSubmit: (request: VeoJobRequest) => void
  busy: boolean
  activeProject?: VeoProject | null
}

export function ImageToVideoTab({ capabilities, onSubmit, busy, activeProject }: Props) {
  const [inputMode, setInputMode] = useState<'frames' | 'ingredients'>('frames')
  const [profileId, setProfileId] = useState('')
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  // Lọc profiles theo chế độ đầu vào hiện tại
  const profiles = (capabilities?.profiles || []).filter(
    (p) => p.input_mode === inputMode,
  )
  const selectedProfile = profiles.find((p) => p.id === profileId) || profiles[0]

  useEffect(() => {
    if (profiles.length && !profiles.some((p) => p.id === profileId)) {
      setProfileId(profiles[0].id)
    }
  }, [capabilities, inputMode, profileId, profiles])

  const modelNames = [...new Set(profiles.map((p) => p.model_display_name))]

  const aspectRatios = selectedProfile
    ? [...new Set(profiles
        .filter((p) => p.model_display_name === selectedProfile.model_display_name)
        .map((p) => p.aspect_ratio))]
    : []

  const durations = selectedProfile
    ? [...new Set(profiles
        .filter((p) =>
          p.model_display_name === selectedProfile.model_display_name &&
          p.aspect_ratio === selectedProfile.aspect_ratio,
        )
        .map((p) => p.duration_seconds))]
        .sort((a, b) => a - b)
    : []

  const resolutions = selectedProfile
    ? [...new Set(profiles
        .filter((p) =>
          p.model_display_name === selectedProfile.model_display_name &&
          p.aspect_ratio === selectedProfile.aspect_ratio &&
          p.duration_seconds === selectedProfile.duration_seconds,
        )
        .map((p) => p.resolution))]
    : []

  const selectProfile = (predicate: (p: typeof profiles[number]) => boolean) => {
    const next = profiles.find(predicate)
    if (next) setProfileId(next.id)
  }

  const selectModel = (modelName: string) => {
    const first = profiles.find((p) => p.model_display_name === modelName)
    if (first) setProfileId(first.id)
  }

  // Khi đổi mode → reset profile
  const handleModeChange = (mode: 'frames' | 'ingredients') => {
    setInputMode(mode)
    setProfileId('') // sẽ tự reset trong useEffect
  }

  const handleUpload = async (file: File | undefined) => {
    if (!file) return
    setUploading(true)
    try {
      const result = await uploadImage(file)
      setImagePath(result.file_path)
      setImagePreview(URL.createObjectURL(file))
    } catch {
      alert('Upload ảnh thất bại')
    } finally {
      setUploading(false)
    }
  }

  const handleSubmit = () => {
    if (!prompt.trim() || !imagePath || !activeProject || !selectedProfile) return
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
    })
  }

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
      {/* Mode toggle: frames vs ingredients */}
      <label className="veo-label">Chế độ đầu vào</label>
      <div className="veo-aspect-row">
        <button
          className={`veo-aspect-btn ${inputMode === 'frames' ? 'active' : ''}`}
          onClick={() => handleModeChange('frames')}
        >
          🖼️ Khung hình
        </button>
        <button
          className={`veo-aspect-btn ${inputMode === 'ingredients' ? 'active' : ''}`}
          onClick={() => handleModeChange('ingredients')}
        >
          🧩 Thành phần
        </button>
      </div>

      {/* Image upload */}
      <label className="veo-label">
        {inputMode === 'frames' ? 'Ảnh frame đầu' : 'Ảnh tham chiếu'}
      </label>
      {imagePreview ? (
        <div className="veo-image-preview">
          <img src={imagePreview} alt="Preview" />
          <button
            className="veo-image-remove"
            onClick={() => { setImagePath(null); setImagePreview(null) }}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div className="veo-dropzone" onClick={() => fileInput.current?.click()}>
          <ImagePlus size={28} />
          <span>{uploading ? 'Đang tải...' : 'Kéo thả hoặc bấm để chọn ảnh'}</span>
          <small>PNG, JPG, WEBP</small>
        </div>
      )}
      <input
        ref={fileInput}
        hidden
        type="file"
        accept="image/*"
        onChange={(e) => handleUpload(e.target.files?.[0])}
      />

      {/* Prompt */}
      <label className="veo-label">
        {inputMode === 'frames' ? 'Mô tả chuyển động' : 'Mô tả cảnh với thành phần'}
      </label>
      <textarea
        className="veo-textarea"
        rows={3}
        placeholder={
          inputMode === 'frames'
            ? 'Camera slowly zooms in as rain starts falling...'
            : 'A person wearing the outfit walks through a cyberpunk city...'
        }
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {/* Model selector (Dropdown) */}
      {modelNames.length > 0 && (
        <div className="veo-model-select-row">
          <div className="veo-model-select-header">
            <label className="veo-label" htmlFor="veo-i2v-model-select">Model Video</label>
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
              const repProfile = profiles.find(
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

      {/* Submit */}
      <button
        className="veo-submit-btn"
        onClick={handleSubmit}
        disabled={busy || !prompt.trim() || !imagePath || !activeProject || !selectedProfile}
      >
        <Sparkles size={16} />
        {!activeProject
          ? 'Vui lòng chọn Project'
          : !imagePath
            ? 'Chưa chọn ảnh'
            : busy
              ? 'Đang xử lý...'
              : `Tạo Video từ Ảnh · ${selectedProfile?.credit_cost ?? '?'} credits`}
      </button>
    </div>
  )
}
