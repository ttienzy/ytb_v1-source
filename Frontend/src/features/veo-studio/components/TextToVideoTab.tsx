import { useEffect, useRef, useState } from 'react'
import { Sparkles, ShieldCheck, Zap, Layers, FileEdit } from 'lucide-react'
import type { BatchSceneItem, VeoCapabilities, VeoJobOut, VeoJobRequest, VeoProject } from '../types'
import * as api from '../services/veoApi'
import { ConcurrencySelector } from './ConcurrencySelector'
import { BatchScriptEditor } from './BatchScriptEditor'
import { BatchQueueMonitor } from './BatchQueueMonitor'

interface Props {
  capabilities: VeoCapabilities | null
  onSubmit: (request: VeoJobRequest) => void
  busy: boolean
  activeProject?: VeoProject | null
  onBatchVideoDone?: () => void
  onPreviewJob?: (job: VeoJobOut) => void
}

type ModeKey = 'single' | 'batch'

export function TextToVideoTab({
  capabilities,
  onSubmit,
  busy,
  activeProject,
  onBatchVideoDone,
  onPreviewJob,
}: Props) {
  // Mode: Đơn lẻ vs Kịch bản đa luồng
  const [mode, setMode] = useState<ModeKey>('single')

  // Cấu hình đơn lẻ
  const [prompt, setPrompt] = useState('')
  const [profileId, setProfileId] = useState('')

  // Cấu hình đa luồng (Batch)
  const [concurrency, setConcurrency] = useState<number>(2)
  const [scenes, setScenes] = useState<BatchSceneItem[]>([])
  const [isBatchRunning, setIsBatchRunning] = useState(false)
  const [isBatchPaused, setIsBatchPaused] = useState(false)
  const [activeWorkers, setActiveWorkers] = useState<
    { workerId: number; sceneNumber?: number; step?: string }[]
  >([])

  // Refs điều khiển hàng đợi
  const stopRequestedRef = useRef(false)
  const pausedRef = useRef(false)
  const scenesRef = useRef<BatchSceneItem[]>([])
  scenesRef.current = scenes

  // Hiển thị tất cả profiles t2v
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

  const selectModel = (modelName: string) => {
    const first = profiles.find((p) => p.model_display_name === modelName)
    if (first) setProfileId(first.id)
  }

  // Submit đơn lẻ
  const handleSubmitSingle = () => {
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

  // ─── ĐIỀU PHỐI HÀNG ĐỢI ĐA LUỒNG (BATCH DISPATCHER) ───────────────────────

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const updateScene = (id: string, patch: Partial<BatchSceneItem>) => {
    setScenes((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...patch } : s)),
    )
  }

  const updateWorkerSlot = (workerId: number, sceneNumber?: number, step?: string) => {
    setActiveWorkers((prev) => {
      const filtered = prev.filter((w) => w.workerId !== workerId)
      return [...filtered, { workerId, sceneNumber, step }]
    })
  }

  const handleStartBatch = async () => {
    if (!activeProject || !selectedProfile || scenes.length === 0) return

    stopRequestedRef.current = false
    pausedRef.current = false
    setIsBatchRunning(true)
    setIsBatchPaused(false)

    // Đánh dấu các cảnh idle hoặc error thành queued
    setScenes((prev) =>
      prev.map((s) => (s.status === 'idle' || s.status === 'error' ? { ...s, status: 'queued', error: undefined } : s)),
    )

    // Khởi tạo active workers array
    setActiveWorkers(
      Array.from({ length: concurrency }).map((_, i) => ({ workerId: i + 1 })),
    )

    const runWorker = async (workerId: number) => {
      while (!stopRequestedRef.current) {
        if (pausedRef.current) {
          await sleep(1000)
          continue
        }

        // Tìm cảnh queued tiếp theo từ ref mới nhất
        const currentScenes = scenesRef.current
        const nextScene = currentScenes.find((s) => s.status === 'queued')

        if (!nextScene) {
          // Hết cảnh trong hàng đợi
          break
        }

        // Đánh dấu cảnh đang chạy trên worker này
        updateScene(nextScene.id, {
          status: 'running',
          workerId,
          progressStep: 'Đang gửi yêu cầu tạo video...',
        })
        updateWorkerSlot(workerId, nextScene.sceneNumber, 'Đang gửi yêu cầu...')

        try {
          const job = await api.submitJob({
            project_id: activeProject.id,
            prompt: nextScene.prompt,
            model_display_name: selectedProfile.model_display_name,
            input_mode: selectedProfile.input_mode,
            aspect_ratio: selectedProfile.aspect_ratio,
            duration_seconds: nextScene.durationSeconds,
            resolution: selectedProfile.resolution,
            num_outputs: selectedProfile.num_outputs,
          })

          updateScene(nextScene.id, {
            jobId: job.job_id,
            progressStep: job.current_step || 'Đã tạo job, đang giải CAPTCHA...',
          })
          updateWorkerSlot(workerId, nextScene.sceneNumber, job.current_step)

          // Polling job cho đến khi xong hoặc lỗi
          let finalJob: VeoJobOut = job
          while (!stopRequestedRef.current && finalJob.status !== 'done' && finalJob.status !== 'error') {
            await sleep(2500)
            const polled = await api.getJobStatus(job.job_id)
            if (polled) {
              finalJob = polled
              updateScene(nextScene.id, { progressStep: polled.current_step })
              updateWorkerSlot(workerId, nextScene.sceneNumber, polled.current_step)
            }
          }

          if (finalJob.status === 'done') {
            updateScene(nextScene.id, {
              status: 'done',
              progressStep: 'Hoàn tất',
              videoUrl: finalJob.output_files?.[0],
            })
            onBatchVideoDone?.()
          } else {
            updateScene(nextScene.id, {
              status: 'error',
              error: finalJob.error_message || 'Tạo video thất bại',
              progressStep: 'Lỗi',
            })
          }
        } catch (err: any) {
          updateScene(nextScene.id, {
            status: 'error',
            error: err.message || 'Lỗi kết nối API',
            progressStep: 'Lỗi',
          })
        } finally {
          updateWorkerSlot(workerId, undefined, undefined)
          // Delay an toàn 2s trước khi lấy cảnh tiếp theo
          await sleep(2000)
        }
      }
    }

    // Chạy song song N worker
    const workerPromises = Array.from({ length: concurrency }).map((_, i) => runWorker(i + 1))
    await Promise.all(workerPromises)

    setIsBatchRunning(false)
    setIsBatchPaused(false)
    setActiveWorkers([])
  }

  const handlePauseBatch = () => {
    pausedRef.current = true
    setIsBatchPaused(true)
  }

  const handleResumeBatch = () => {
    pausedRef.current = false
    setIsBatchPaused(false)
  }

  const handleStopBatch = () => {
    stopRequestedRef.current = true
    setIsBatchRunning(false)
    setIsBatchPaused(false)
    setActiveWorkers([])
    // Đưa các cảnh đang queued về idle
    setScenes((prev) =>
      prev.map((s) => (s.status === 'queued' ? { ...s, status: 'idle' } : s)),
    )
  }

  const handleRetryScene = (sceneId: string) => {
    updateScene(sceneId, { status: 'idle', error: undefined, progressStep: undefined })
  }

  const handlePreviewScene = (scene: BatchSceneItem) => {
    if (scene.jobId && onPreviewJob) {
      api.getJobStatus(scene.jobId).then((job) => {
        if (job) onPreviewJob(job)
      })
    }
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
      {/* Dual Mode Switcher: Tạo đơn vs Kịch bản đa luồng */}
      <div className="veo-mode-switch-bar">
        <button
          type="button"
          className={`veo-mode-btn ${mode === 'single' ? 'active' : ''}`}
          onClick={() => setMode('single')}
          disabled={isBatchRunning}
        >
          <FileEdit size={14} />
          <span>⚡ Tạo Đơn Lẻ</span>
        </button>
        <button
          type="button"
          className={`veo-mode-btn ${mode === 'batch' ? 'active' : ''}`}
          onClick={() => setMode('batch')}
          disabled={isBatchRunning}
        >
          <Layers size={14} />
          <span>📑 Kịch Bản Phân Cảnh (Đa Luồng)</span>
          {scenes.length > 0 && (
            <span className="veo-mode-counter">{scenes.length}</span>
          )}
        </button>
      </div>

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
                  disabled={isBatchRunning}
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

      {/* CHẾ ĐỘ 1: TẠO ĐƠN LẺ */}
      {mode === 'single' && (
        <>
          <label className="veo-label">Prompt mô tả cảnh</label>
          <textarea
            className="veo-textarea"
            rows={4}
            placeholder="A cinematic close-up of an ancient samurai standing in neon-lit cyberpunk Tokyo during rain, reflections on wet asphalt, 4K quality..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            disabled={busy}
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
                  disabled={!aspectRatios.includes('16:9') || busy}
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
                  disabled={!aspectRatios.includes('9:16') || busy}
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
                    disabled={busy}
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
                    disabled={busy}
                  >
                    {r}
                    {r === '360p' && <span className="veo-res-tag"> Draft</span>}
                  </button>
                ))}
              </div>

              {/* Status bar */}
              <div className="veo-profile-bar">
                <ProfileBadge />
                <span className="veo-credit-estimate">
                  {selectedProfile.credit_cost} credits
                </span>
              </div>

              {/* Submit Single */}
              <button
                className="veo-submit-btn"
                onClick={handleSubmitSingle}
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
        </>
      )}

      {/* CHẾ ĐỘ 2: KỊCH BẢN PHÂN CẢNH & ĐA LUỒNG */}
      {mode === 'batch' && selectedProfile && (
        <>
          {/* Cấu hình dùng chung: Tỉ lệ & Độ phân giải */}
          <div className="veo-batch-settings-grid">
            <div>
              <label className="veo-label">Tỉ lệ khung hình chung</label>
              <div className="veo-aspect-row">
                <button
                  type="button"
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
                  disabled={!aspectRatios.includes('16:9') || isBatchRunning}
                >
                  <span className="veo-aspect-icon landscape" /> 16:9
                </button>
                <button
                  type="button"
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
                  disabled={!aspectRatios.includes('9:16') || isBatchRunning}
                >
                  <span className="veo-aspect-icon portrait" /> 9:16
                </button>
              </div>
            </div>

            <div>
              <label className="veo-label">Độ phân giải</label>
              <div className="veo-duration-row">
                {resolutions.map((r) => (
                  <button
                    key={r}
                    type="button"
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
                    disabled={isBatchRunning}
                  >
                    {r}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Chọn số luồng (1 - 5 luồng) */}
          <ConcurrencySelector
            concurrency={concurrency}
            onChange={setConcurrency}
            disabled={isBatchRunning}
          />

          {/* Khung dán kịch bản và danh sách thẻ phân cảnh */}
          <BatchScriptEditor
            scenes={scenes}
            onScenesChange={setScenes}
            disabled={isBatchRunning}
            defaultDuration={selectedProfile.duration_seconds}
            onPreviewScene={handlePreviewScene}
            onRetryScene={handleRetryScene}
          />

          {/* Bộ giám sát tiến độ & điều khiển hàng đợi */}
          <BatchQueueMonitor
            scenes={scenes}
            concurrency={concurrency}
            isRunning={isBatchRunning}
            isPaused={isBatchPaused}
            creditPerScene={selectedProfile.credit_cost}
            activeWorkers={activeWorkers}
            onStart={handleStartBatch}
            onPause={handlePauseBatch}
            onResume={handleResumeBatch}
            onStop={handleStopBatch}
            disabled={!activeProject || isBatchRunning}
          />
        </>
      )}
    </div>
  )
}
