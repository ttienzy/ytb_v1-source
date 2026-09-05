import { useState } from 'react'
import { Sparkles, Wand2 } from 'lucide-react'
import type { VeoCapabilities, VeoJobRequest, VeoModelInfo } from '../types'

interface Props {
  capabilities: VeoCapabilities | null
  onSubmit: (request: VeoJobRequest) => void
  busy: boolean
}

export function TextToVideoTab({ capabilities, onSubmit, busy }: Props) {
  const [prompt, setPrompt] = useState('')
  const [modelName, setModelName] = useState('Omni 1.1 Flash')
  const [aspect, setAspect] = useState<'16:9' | '9:16'>('16:9')
  const [duration, setDuration] = useState(6)
  const [resolution, setResolution] = useState('720p')
  const [numOutputs, setNumOutputs] = useState(1)
  const [seed, setSeed] = useState('')

  const models = (capabilities?.models || []).filter(
    (m) => m.group === 'video' && m.supported_modes.includes('text_to_video'),
  )
  const selectedModel = models.find((m) => m.display_name === modelName)
  const durations = selectedModel?.supported_durations || [4, 6, 8]
  const resolutions = selectedModel?.supported_resolutions || ['360p', '720p']

  const handleSubmit = () => {
    if (!prompt.trim()) return
    onSubmit({
      prompt: prompt.trim(),
      model_display_name: modelName,
      input_mode: 'text_to_video',
      aspect_ratio: aspect,
      duration_seconds: duration,
      resolution,
      num_outputs: numOutputs,
      seed: seed ? parseInt(seed, 10) : null,
    })
  }

  return (
    <div className="veo-tab-content">
      {/* Prompt */}
      <label className="veo-label">Prompt mô tả cảnh</label>
      <textarea
        className="veo-textarea"
        rows={4}
        placeholder="A cinematic close-up of an ancient samurai standing in neon-lit cyberpunk Tokyo during rain, reflections on wet asphalt, 4K quality..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {/* Model */}
      <label className="veo-label">Model</label>
      <select
        className="veo-select"
        value={modelName}
        onChange={(e) => {
          setModelName(e.target.value)
          const m = models.find((x) => x.display_name === e.target.value)
          if (m && !m.supported_durations.includes(duration)) {
            setDuration(m.supported_durations[m.supported_durations.length - 1] || 8)
          }
        }}
      >
        {models.map((m) => (
          <option key={m.display_name} value={m.display_name}>
            {m.display_name}
            {!m.verified ? ' (chưa xác minh)' : ''}
          </option>
        ))}
      </select>

      {/* Aspect Ratio */}
      <label className="veo-label">Tỉ lệ khung hình</label>
      <div className="veo-aspect-row">
        <button
          className={`veo-aspect-btn ${aspect === '16:9' ? 'active' : ''}`}
          onClick={() => setAspect('16:9')}
        >
          <span className="veo-aspect-icon landscape" />
          16:9
        </button>
        <button
          className={`veo-aspect-btn ${aspect === '9:16' ? 'active' : ''}`}
          onClick={() => setAspect('9:16')}
        >
          <span className="veo-aspect-icon portrait" />
          9:16
        </button>
      </div>

      {/* Duration */}
      <label className="veo-label">Thời lượng</label>
      <div className="veo-duration-row">
        {durations.map((d) => (
          <button
            key={d}
            className={`veo-duration-btn ${duration === d ? 'active' : ''}`}
            onClick={() => setDuration(d)}
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
            className={`veo-duration-btn ${resolution === r ? 'active' : ''}`}
            onClick={() => setResolution(r)}
          >
            {r}
          </button>
        ))}
      </div>

      {/* Num Outputs */}
      <label className="veo-label">Số output</label>
      <div className="veo-duration-row">
        {[1, 2, 3, 4].map((n) => (
          <button
            key={n}
            className={`veo-duration-btn ${numOutputs === n ? 'active' : ''}`}
            onClick={() => setNumOutputs(n)}
          >
            x{n}
          </button>
        ))}
      </div>

      {/* Seed */}
      <label className="veo-label">
        Seed <span className="veo-label-hint">(không bảo đảm giống hệt)</span>
      </label>
      <div className="veo-seed-row">
        <input
          className="veo-input"
          type="number"
          placeholder="Tự động"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
        />
        <button className="veo-seed-random" onClick={() => setSeed(String(Math.floor(Math.random() * 999999999)))} title="Random seed">
          🎲
        </button>
      </div>

      {/* Submit */}
      <button
        className="veo-submit-btn"
        onClick={handleSubmit}
        disabled={busy || !prompt.trim()}
      >
        <Sparkles size={16} />
        {busy ? 'Đang xử lý...' : 'Tạo Video'}
      </button>
    </div>
  )
}
