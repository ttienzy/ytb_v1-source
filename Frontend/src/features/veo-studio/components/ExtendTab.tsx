import { useState } from 'react'
import { Film, SkipForward } from 'lucide-react'
import type { VeoCapabilities, VeoHistoryItem, VeoJobRequest } from '../types'

interface Props {
  capabilities: VeoCapabilities | null
  history: VeoHistoryItem[]
  onSubmit: (request: VeoJobRequest) => void
  busy: boolean
}

export function ExtendTab({ capabilities, history, onSubmit, busy }: Props) {
  const [selectedVideo, setSelectedVideo] = useState('')
  const [prompt, setPrompt] = useState('')
  const [duration, setDuration] = useState(8)

  // Chỉ model hỗ trợ extend
  const extendModels = (capabilities?.models || []).filter(
    (m) => m.extend_supported === true,
  )
  const hasExtendSupport = extendModels.length > 0

  const handleSubmit = () => {
    if (!selectedVideo || !prompt.trim()) return
    onSubmit({
      prompt: prompt.trim(),
      model_display_name: extendModels[0]?.display_name || 'Veo 3.1 - Lite',
      input_mode: 'extend',
      aspect_ratio: '16:9',
      duration_seconds: duration,
      resolution: '720p',
      num_outputs: 1,
      source_video_id: selectedVideo,
      continuation_prompt: prompt.trim(),
    })
  }

  return (
    <div className="veo-tab-content">
      {!hasExtendSupport && (
        <div className="veo-notice">
          <span>⚠️</span>
          <div>
            <strong>Extend chưa sẵn sàng</strong>
            <p>Theo Flow Help, chỉ Veo 3.1 Lite hỗ trợ Extend. Cần xác minh runtime trước khi bật.</p>
          </div>
        </div>
      )}

      {/* Source Video */}
      <label className="veo-label">Video nguồn</label>
      {history.length > 0 ? (
        <select
          className="veo-select"
          value={selectedVideo}
          onChange={(e) => setSelectedVideo(e.target.value)}
        >
          <option value="">— Chọn video —</option>
          {history.map((v) => (
            <option key={v.video_id} value={v.video_id}>
              {v.file_name} ({v.duration_seconds}s · {v.aspect_ratio})
            </option>
          ))}
        </select>
      ) : (
        <div className="veo-empty-hint">
          <Film size={16} />
          Chưa có video nào. Tạo video ở tab Text hoặc Image trước.
        </div>
      )}

      {/* Continuation prompt */}
      <label className="veo-label">Mô tả diễn biến tiếp theo</label>
      <textarea
        className="veo-textarea"
        rows={3}
        placeholder="The camera pans right revealing a distant mountain range as the sun sets..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {/* Duration */}
      <label className="veo-label">Thời lượng nối thêm</label>
      <div className="veo-duration-row">
        {[4, 6, 8].map((d) => (
          <button
            key={d}
            className={`veo-duration-btn ${duration === d ? 'active' : ''}`}
            onClick={() => setDuration(d)}
          >
            +{d}s
          </button>
        ))}
      </div>

      {/* Submit */}
      <button
        className="veo-submit-btn"
        onClick={handleSubmit}
        disabled={busy || !selectedVideo || !prompt.trim() || !hasExtendSupport}
      >
        <SkipForward size={16} />
        {busy ? 'Đang xử lý...' : 'Nối dài video'}
      </button>
    </div>
  )
}
