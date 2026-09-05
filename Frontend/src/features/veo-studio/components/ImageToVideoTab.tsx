import { useRef, useState } from 'react'
import { ImagePlus, Sparkles, Upload, X } from 'lucide-react'
import type { VeoCapabilities, VeoJobRequest } from '../types'
import { uploadImage } from '../services/veoApi'

interface Props {
  capabilities: VeoCapabilities | null
  onSubmit: (request: VeoJobRequest) => void
  busy: boolean
}

export function ImageToVideoTab({ capabilities, onSubmit, busy }: Props) {
  const [inputMode, setInputMode] = useState<'frames' | 'ingredients'>('frames')
  const [prompt, setPrompt] = useState('')
  const [modelName, setModelName] = useState('Veo 3.1 - Lite')
  const [aspect, setAspect] = useState<'16:9' | '9:16'>('16:9')
  const [duration, setDuration] = useState(8)
  const [resolution, setResolution] = useState('720p')
  const [imagePath, setImagePath] = useState<string | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [uploading, setUploading] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const models = (capabilities?.models || []).filter(
    (m) => m.group === 'video' && m.supported_modes.includes(inputMode),
  )
  const selectedModel = models.find((m) => m.display_name === modelName)
  const durations = selectedModel?.supported_durations || [4, 6, 8]

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
    if (!prompt.trim() || !imagePath) return
    onSubmit({
      prompt: prompt.trim(),
      model_display_name: modelName,
      input_mode: inputMode,
      aspect_ratio: aspect,
      duration_seconds: duration,
      resolution,
      num_outputs: 1,
      image_path: imagePath,
    })
  }

  return (
    <div className="veo-tab-content">
      {/* Mode toggle */}
      <label className="veo-label">Chế độ đầu vào</label>
      <div className="veo-aspect-row">
        <button
          className={`veo-aspect-btn ${inputMode === 'frames' ? 'active' : ''}`}
          onClick={() => setInputMode('frames')}
        >
          🖼️ Khung hình
        </button>
        <button
          className={`veo-aspect-btn ${inputMode === 'ingredients' ? 'active' : ''}`}
          onClick={() => setInputMode('ingredients')}
        >
          🧩 Thành phần
        </button>
      </div>

      {/* Image dropzone */}
      <label className="veo-label">
        {inputMode === 'frames' ? 'Ảnh frame đầu' : 'Ảnh tham chiếu'}
      </label>
      {imagePreview ? (
        <div className="veo-image-preview">
          <img src={imagePreview} alt="Preview" />
          <button
            className="veo-image-remove"
            onClick={() => {
              setImagePath(null)
              setImagePreview(null)
            }}
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <div
          className="veo-dropzone"
          onClick={() => fileInput.current?.click()}
        >
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

      {/* Model */}
      <label className="veo-label">Model</label>
      <select
        className="veo-select"
        value={modelName}
        onChange={(e) => setModelName(e.target.value)}
      >
        {models.map((m) => (
          <option key={m.display_name} value={m.display_name}>
            {m.display_name} {!m.verified ? '(chưa xác minh)' : ''}
          </option>
        ))}
      </select>

      {/* Aspect + Duration */}
      <label className="veo-label">Tỉ lệ · Thời lượng</label>
      <div className="veo-config-row">
        <select className="veo-select small" value={aspect} onChange={(e) => setAspect(e.target.value as '16:9' | '9:16')}>
          <option value="16:9">16:9</option>
          <option value="9:16">9:16</option>
        </select>
        <div className="veo-duration-row">
          {durations.map((d) => (
            <button key={d} className={`veo-duration-btn ${duration === d ? 'active' : ''}`} onClick={() => setDuration(d)}>
              {d}s
            </button>
          ))}
        </div>
      </div>

      {/* Submit */}
      <button
        className="veo-submit-btn"
        onClick={handleSubmit}
        disabled={busy || !prompt.trim() || !imagePath}
      >
        <Sparkles size={16} />
        {busy ? 'Đang xử lý...' : 'Tạo Video từ Ảnh'}
      </button>
    </div>
  )
}
