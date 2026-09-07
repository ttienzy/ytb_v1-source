import { useEffect, useState } from 'react'
import { Film, SkipForward, ShieldCheck, Zap } from 'lucide-react'
import type { VeoCapabilities, VeoHistoryItem, VeoJobRequest, VeoProject } from '../types'

interface Props {
  capabilities: VeoCapabilities | null
  history: VeoHistoryItem[]
  onSubmit: (request: VeoJobRequest) => void
  busy: boolean
  activeProject?: VeoProject | null
}

export function ExtendTab({ capabilities, history, onSubmit, busy, activeProject }: Props) {
  const [selectedVideo, setSelectedVideo] = useState('')
  const [prompt, setPrompt] = useState('')
  const [profileId, setProfileId] = useState('')

  // Chỉ profiles có input_mode === 'extend'
  const profiles = (capabilities?.profiles || []).filter((p) => p.input_mode === 'extend')
  const selectedProfile = profiles.find((p) => p.id === profileId) || profiles[0]

  useEffect(() => {
    if (profiles.length && !profiles.some((p) => p.id === profileId)) {
      setProfileId(profiles[0].id)
    }
  }, [capabilities, profileId, profiles])

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

  const handleSubmit = () => {
    if (!selectedVideo || !prompt.trim() || !activeProject || !selectedProfile) return
    onSubmit({
      project_id: activeProject.id,
      prompt: prompt.trim(),
      model_display_name: selectedProfile.model_display_name,
      input_mode: 'extend',
      aspect_ratio: selectedProfile.aspect_ratio,
      duration_seconds: selectedProfile.duration_seconds,
      resolution: selectedProfile.resolution,
      num_outputs: 1,
      source_video_id: selectedVideo,
      continuation_prompt: prompt.trim(),
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
      {/* Info notice về Extend */}
      <div className="veo-notice veo-notice--info">
        <span>ℹ️</span>
        <div>
          <strong>Chỉ Veo 3.1 - Lite hỗ trợ Extend</strong>
          <p>Nối thêm 4–8 giây vào video đã tạo. Chi phí: 10 credits/lần.</p>
        </div>
      </div>

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

      {selectedProfile && (
        <>
          {/* Aspect Ratio */}
          <label className="veo-label">Tỉ lệ khung hình</label>
          <div className="veo-aspect-row">
            {(['16:9', '9:16'] as const).map((ar) => {
              const available = profiles
                .filter((p) => p.model_display_name === selectedProfile.model_display_name)
                .some((p) => p.aspect_ratio === ar)
              return (
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
                  disabled={!available}
                >
                  <span className={`veo-aspect-icon ${ar === '16:9' ? 'landscape' : 'portrait'}`} />
                  {ar}
                </button>
              )
            })}
          </div>

          {/* Duration */}
          <label className="veo-label">Thời lượng nối thêm</label>
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
                +{d}s
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
        disabled={busy || !selectedVideo || !prompt.trim() || !activeProject || !selectedProfile}
      >
        <SkipForward size={16} />
        {!activeProject
          ? 'Vui lòng chọn Project'
          : !selectedVideo
            ? 'Chưa chọn video nguồn'
            : busy
              ? 'Đang xử lý...'
              : `Nối dài video · ${selectedProfile?.credit_cost ?? '?'} credits`}
      </button>
    </div>
  )
}

