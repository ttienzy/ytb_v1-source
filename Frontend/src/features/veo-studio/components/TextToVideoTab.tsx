import { useEffect, useState } from 'react'
import { Sparkles, ShieldCheck, Zap } from 'lucide-react'
import type { VeoCapabilities, VeoJobRequest, VeoProject } from '../types'

interface Props {
  capabilities: VeoCapabilities | null
  onSubmit: (request: VeoJobRequest) => void
  busy: boolean
  activeProject?: VeoProject | null
}

export function TextToVideoTab({ capabilities, onSubmit, busy, activeProject }: Props) {
  const [prompt, setPrompt] = useState('')
  const [profileId, setProfileId] = useState('')

  // Hiển thị tất cả profiles t2v — cả documented lẫn verified
  const profiles = (capabilities?.profiles || []).filter(
    (profile) => profile.input_mode === 'text_to_video',
  )
  const selectedProfile = profiles.find((profile) => profile.id === profileId) || profiles[0]

  useEffect(() => {
    if (profiles.length && !profiles.some((profile) => profile.id === profileId)) {
      setProfileId(profiles[0].id)
    }
  }, [capabilities, profileId, profiles])

  const modelNames = [...new Set(profiles.map((profile) => profile.model_display_name))]

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

  const selectProfile = (predicate: (profile: typeof profiles[number]) => boolean) => {
    const next = profiles.find(predicate)
    if (next) setProfileId(next.id)
  }

  // Khi chọn model mới → reset về tổ hợp đầu tiên của model đó
  const selectModel = (modelName: string) => {
    const first = profiles.find((p) => p.model_display_name === modelName)
    if (first) setProfileId(first.id)
  }

  const handleSubmit = () => {
    if (!prompt.trim() || !activeProject || !selectedProfile) return
    onSubmit({
      project_id: activeProject.id,
      prompt: prompt.trim(),
      model_display_name: selectedProfile.model_display_name,
      input_mode: selectedProfile.input_mode,
      aspect_ratio: selectedProfile.aspect_ratio,
      duration_seconds: selectedProfile.duration_seconds,
      resolution: selectedProfile.resolution,
      num_outputs: selectedProfile.num_outputs,
    })
  }

  // Badge trạng thái profile
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
      {/* Model selector */}
      {modelNames.length > 0 && (
        <>
          <label className="veo-label">Model Video</label>
          <div className="veo-model-grid">
            {modelNames.map((modelName) => {
              const repProfile = profiles.find(
                (p) => p.model_display_name === modelName && p.resolution === '720p',
              ) || profiles.find((p) => p.model_display_name === modelName)
              const isActive = selectedProfile?.model_display_name === modelName
              return (
                <button
                  key={modelName}
                  type="button"
                  className={`veo-model-btn ${isActive ? 'active' : ''}`}
                  aria-pressed={isActive}
                  onClick={() => selectModel(modelName)}
                >
                  <span>{modelName}</span>
                  <small>
                    {repProfile?.credit_cost != null ? `${repProfile.credit_cost} credits` : '—'}
                  </small>
                </button>
              )
            })}
          </div>
        </>
      )}

      {/* Prompt */}
      <label className="veo-label">Prompt mô tả cảnh</label>
      <textarea
        className="veo-textarea"
        rows={4}
        placeholder="A cinematic close-up of an ancient samurai standing in neon-lit cyberpunk Tokyo during rain, reflections on wet asphalt, 4K quality..."
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />

      {!selectedProfile ? (
        <div className="veo-notice">
          <span>⚠️</span>
          <div>
            <strong>Chưa có cấu hình T2V nào</strong>
            <p>Backend chưa trả về profiles. Kiểm tra kết nối API.</p>
          </div>
        </div>
      ) : (
        <>
          {/* Aspect Ratio */}
          <label className="veo-label">Tỉ lệ khung hình</label>
          <div className="veo-aspect-row">
            <button
              className={`veo-aspect-btn ${selectedProfile.aspect_ratio === '16:9' ? 'active' : ''}`}
              onClick={() =>
                selectProfile(
                  (p) =>
                    p.model_display_name === selectedProfile.model_display_name &&
                    p.aspect_ratio === '16:9' &&
                    p.duration_seconds === selectedProfile.duration_seconds &&
                    p.resolution === selectedProfile.resolution,
                )
              }
              disabled={!aspectRatios.includes('16:9')}
            >
              <span className="veo-aspect-icon landscape" />
              16:9
            </button>
            <button
              className={`veo-aspect-btn ${selectedProfile.aspect_ratio === '9:16' ? 'active' : ''}`}
              onClick={() =>
                selectProfile(
                  (p) =>
                    p.model_display_name === selectedProfile.model_display_name &&
                    p.aspect_ratio === '9:16' &&
                    p.duration_seconds === selectedProfile.duration_seconds &&
                    p.resolution === selectedProfile.resolution,
                )
              }
              disabled={!aspectRatios.includes('9:16')}
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

          {/* Status bar: badge + credit estimate */}
          <div className="veo-profile-bar">
            <ProfileBadge />
            <span className="veo-credit-estimate">
              {selectedProfile.credit_cost} credits
            </span>
          </div>

          {/* Submit */}
          <button
            className="veo-submit-btn"
            onClick={handleSubmit}
            disabled={busy || !prompt.trim() || !activeProject || !selectedProfile}
          >
            <Sparkles size={16} />
            {!activeProject
              ? 'Vui lòng chọn Project'
              : busy
                ? 'Đang xử lý...'
                : `Tạo Video · ${selectedProfile.credit_cost} credits`}
          </button>
        </>
      )}
    </div>
  )
}
