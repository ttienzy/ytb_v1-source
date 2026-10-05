import { useEffect, useRef, useState } from 'react'
import { Sparkles, ShieldCheck, Zap, Layers, FileEdit } from 'lucide-react'
import type { BatchSceneItem, VeoCapabilities, VeoJobOut, VeoJobRequest, VeoProject, VideoTask } from '../types'
import * as api from '../services/veoApi'
import { ConcurrencySelector } from './ConcurrencySelector'
import { VariationSelector } from './VariationSelector'
import { BatchScriptEditor } from './BatchScriptEditor'
import { BatchQueueMonitor } from './BatchQueueMonitor'
import { ActiveVideoTasksQueue } from './ActiveVideoTasksQueue'

interface Props {
  capabilities: VeoCapabilities | null
  onSubmit: (request: VeoJobRequest) => Promise<VeoJobOut | null> | void
  busy: boolean
  activeProject?: VeoProject | null
  studioTasks?: VideoTask[]
  onRegisterTask?: (task: VideoTask) => void
  onUpdateTask?: (id: string, patch: Partial<VideoTask>) => void
  onRemoveTask?: (id: string) => void
  onBatchVideoDone?: (job?: VeoJobOut) => void
  onVideoDone?: () => void
  onPreviewJob?: (job: VeoJobOut) => void
}

type ModeKey = 'single' | 'batch'

export function TextToVideoTab({
  capabilities,
  onSubmit,
  busy,
  activeProject,
  studioTasks,
  onRegisterTask,
  onUpdateTask,
  onRemoveTask,
  onBatchVideoDone,
  onVideoDone,
  onPreviewJob,
}: Props) {
  // Mode: Đơn lẻ vs Kịch bản đa luồng
  const [mode, setMode] = useState<ModeKey>('single')

  // Cấu hình đơn lẻ
  const [prompt, setPrompt] = useState('')
  const [profileId, setProfileId] = useState('')
  const [variationCount, setVariationCount] = useState<number>(1)
  const [isSubmittingSingle, setIsSubmittingSingle] = useState(false)

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

  const handleGlobalDurationChange = (d: number) => {
    if (!selectedProfile) return
    selectProfile(
      (p) =>
        p.model_display_name === selectedProfile.model_display_name &&
        p.aspect_ratio === selectedProfile.aspect_ratio &&
        p.duration_seconds === d &&
        p.resolution === selectedProfile.resolution,
    )
    setScenes((prev) => prev.map((s) => ({ ...s, durationSeconds: d })))
  }

  // ─── Active Background Video Tasks Queue (Đơn Lẻ) ───
  const [localTasks, setLocalTasks] = useState<VideoTask[]>([])
  const tasksToDisplay = studioTasks || localTasks

  const handleRegisterTask = (task: VideoTask) => {
    if (onRegisterTask) {
      onRegisterTask(task)
    } else {
      setLocalTasks((prev) => [task, ...prev])
    }
  }

  const handleUpdateTask = (id: string, patch: Partial<VideoTask>) => {
    if (onUpdateTask) {
      onUpdateTask(id, patch)
    } else {
      setLocalTasks((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    }
  }

  const handleRemoveTask = (id: string) => {
    if (onRemoveTask) {
      onRemoveTask(id)
    } else {
      setLocalTasks((prev) => prev.filter((t) => t.id !== id))
    }
  }

  const pollJob = (taskId: string, jobId: string) => {
    const interval = setInterval(async () => {
      try {
        const job = await api.getJobStatus(jobId)
        if (!job) return

        if (job.status === 'done') {
          clearInterval(interval)
          handleUpdateTask(taskId, {
            status: 'completed',
            statusText: 'Đã hoàn tất video!',
            jobOut: job,
          })
          onVideoDone?.()
          onBatchVideoDone?.()
          setTimeout(() => handleRemoveTask(taskId), 10000)
        } else if (job.status === 'error') {
          clearInterval(interval)
          handleUpdateTask(taskId, {
            status: 'error',
            statusText: 'Lỗi tạo video',
            error: job.error_message || 'Google Flow từ chối tạo video',
            jobOut: job,
          })
        } else {
          handleUpdateTask(taskId, {
            status: job.status as any,
            statusText: job.current_step || 'Đang tạo video...',
            jobOut: job,
          })
        }
      } catch {
        // ignore polling error
      }
    }, 2000)
  }

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  // Submit đơn lẻ hoặc đa biến thể (Non-blocking worker queue với luồng song song)
  const handleSubmitSingle = async () => {
    if (!prompt.trim() || !activeProject || !selectedProfile || isSubmittingSingle) return

    setIsSubmittingSingle(true)
    const totalVariants = variationCount

    const variantTasks: { index: number; taskId: string }[] = []
    for (let i = 1; i <= totalVariants; i++) {
      const taskId = `t2v-${Date.now()}-${i}`
      const newTask: VideoTask = {
        id: taskId,
        type: 'video',
        prompt: prompt.trim(),
        modelName: selectedProfile.model_display_name,
        aspectRatio: selectedProfile.aspect_ratio,
        duration: selectedProfile.duration_seconds,
        modeLabel: totalVariants > 1 ? `Văn bản (Biến thể ${i}/${totalVariants})` : 'Văn bản sang Video',
        variationIndex: i,
        variationTotal: totalVariants,
        status: 'queued',
        statusText: totalVariants > 1 ? `Chờ khởi tạo biến thể ${i}/${totalVariants}...` : 'Đang gửi yêu cầu khởi tạo job...',
        createdAt: Date.now() + i,
      }
      handleRegisterTask(newTask)
      variantTasks.push({ index: i, taskId })
    }

    const queue = [...variantTasks]
    const effectiveConcurrency = 1

    const worker = async () => {
      while (queue.length > 0) {
        const item = queue.shift()
        if (!item) break

        handleUpdateTask(item.taskId, {
          status: 'submitting',
          statusText: totalVariants > 1 ? `Đang gửi biến thể ${item.index}/${totalVariants}...` : 'Đang gửi yêu cầu...',
        })

        try {
          const seed = Math.floor(Math.random() * 2147483647)
          const job = await onSubmit({
            project_id: activeProject.id,
            prompt: prompt.trim(),
            model_display_name: selectedProfile.model_display_name,
            input_mode: selectedProfile.input_mode,
            aspect_ratio: selectedProfile.aspect_ratio,
            duration_seconds: selectedProfile.duration_seconds,
            resolution: selectedProfile.resolution,
            num_outputs: selectedProfile.num_outputs,
            seed,
          })

          if (job?.job_id) {
            handleUpdateTask(item.taskId, {
              jobId: job.job_id,
              status: 'captcha',
              statusText: job.current_step || (totalVariants > 1 ? `Biến thể ${item.index} đang render...` : 'Đang xử lý reCAPTCHA...'),
              jobOut: job,
            })
            if (!onRegisterTask) {
              pollJob(item.taskId, job.job_id)
            }
          } else {
            handleUpdateTask(item.taskId, {
              status: 'error',
              statusText: 'Không nhận được job_id từ server',
              error: 'Flow bridge không phản hồi',
            })
          }
        } catch (err: any) {
          handleUpdateTask(item.taskId, {
            status: 'error',
            statusText: 'Lỗi gửi biến thể',
            error: err.message || 'Lỗi kết nối',
          })
        }

        // Delay 1.5s giữa các lần xin token reCAPTCHA để bảo vệ an toàn tài khoản
        if (queue.length > 0) {
          await sleep(1500)
        }
      }
    }

    try {
      const workers = Array.from({ length: effectiveConcurrency }, () => worker())
      await Promise.all(workers)
    } finally {
      setIsSubmittingSingle(false)
    }
  }

  // ─── ĐIỀU PHỐI HÀNG ĐỢI ĐA LUỒNG (BATCH DISPATCHER) ───────────────────────

  const updateScene = (id: string, patch: Partial<BatchSceneItem>) => {
    scenesRef.current = scenesRef.current.map((s) => (s.id === id ? { ...s, ...patch } : s))
    setScenes([...scenesRef.current])
  }

  const updateWorkerSlot = (workerId: number, sceneNumber?: number, step?: string) => {
    setActiveWorkers((prev) => {
      const filtered = prev.filter((w) => w.workerId !== workerId)
      return [...filtered, { workerId, sceneNumber, step }].sort((a, b) => a.workerId - b.workerId)
    })
  }

  const handleStartBatch = async () => {
    if (!activeProject) {
      alert('Vui lòng chọn hoặc tạo một Project trước khi chạy kịch bản!')
      return
    }
    if (!selectedProfile) {
      alert('Vui lòng chọn cấu hình Model trước khi chạy kịch bản!')
      return
    }
    if (scenes.length === 0) {
      alert('Kịch bản chưa có phân cảnh nào để chạy. Hãy dán kịch bản hoặc bấm Tải mẫu kịch bản.')
      return
    }

    stopRequestedRef.current = false
    pausedRef.current = false
    setIsBatchRunning(true)
    setIsBatchPaused(false)

    // Đánh dấu các cảnh idle hoặc error thành queued, đồng bộ ngay lập tức vào scenesRef.current
    const queuedScenes = scenesRef.current.map((s) =>
      s.status === 'idle' || s.status === 'error'
        ? { ...s, status: 'queued' as const, error: undefined, progressStep: undefined, workerId: undefined }
        : s,
    )
    scenesRef.current = queuedScenes
    setScenes(queuedScenes)

    // Khởi tạo các slot worker (1 .. concurrency)
    setActiveWorkers(
      Array.from({ length: concurrency }).map((_, i) => ({ workerId: i + 1 })),
    )

    // Quản lý các slot đang xử lý trên Cloud (workerId -> sceneId)
    const activeSlots = new Map<number, string>()

    const getFreeWorkerSlot = (): number | null => {
      for (let i = 1; i <= concurrency; i++) {
        if (!activeSlots.has(i)) return i
      }
      return null
    }

    // ── TRACKER BẤT ĐỒNG BỘ: Theo dõi tiến độ render của từng cảnh độc lập ──
    const trackScene = async (sceneId: string, sceneNumber: number, jobId: string, workerId: number) => {
      try {
        let finalJob: VeoJobOut | null = null
        while (!stopRequestedRef.current) {
          if (pausedRef.current) {
            await sleep(1500)
            continue
          }

          await sleep(2500)
          const polled = await api.getJobStatus(jobId)
          if (polled) {
            finalJob = polled
            updateScene(sceneId, { progressStep: polled.current_step })
            updateWorkerSlot(workerId, sceneNumber, polled.current_step)

            if (polled.status === 'done' || polled.status === 'error') {
              break
            }
          }
        }

        if (finalJob?.status === 'done') {
          updateScene(sceneId, {
            status: 'done',
            progressStep: 'Hoàn tất',
            videoUrl: finalJob.output_files?.[0],
          })
          if (finalJob) onBatchVideoDone?.(finalJob)
        } else if (finalJob?.status === 'error') {
          updateScene(sceneId, {
            status: 'error',
            error: finalJob.error_message || 'Tạo video thất bại',
            progressStep: 'Lỗi',
          })
        }
      } catch (err: any) {
        updateScene(sceneId, {
          status: 'error',
          error: err.message || 'Lỗi kiểm tra trạng thái video',
          progressStep: 'Lỗi',
        })
      } finally {
        // Giải phóng slot ngay lập tức khi job hoàn tất hoặc lỗi
        activeSlots.delete(workerId)
        updateWorkerSlot(workerId, undefined, undefined)
      }
    }

    // ── DISPATCHER: Điều phối gửi lệnh theo mô hình cửa sổ trượt (Sliding Window) ──
    const trackingPromises: Promise<void>[] = []

    while (!stopRequestedRef.current) {
      if (pausedRef.current) {
        await sleep(1000)
        continue
      }

      // Tìm cảnh queued tiếp theo từ ref mới nhất
      const currentScenes = scenesRef.current
      const nextScene = currentScenes.find((s) => s.status === 'queued')

      // Nếu không còn cảnh nào queued
      if (!nextScene) {
        // Nếu tất cả các job đang render trên Cloud cũng đã xong -> Kết thúc toàn bộ batch!
        if (activeSlots.size === 0) {
          break
        }
        // Còn job đang render trên Cloud -> Đợi 1s rồi kiểm tra lại
        await sleep(1000)
        continue
      }

      // Tìm slot luồng còn trống (dựa theo concurrency)
      const freeWorkerId = getFreeWorkerSlot()
      if (freeWorkerId === null) {
        // Các slot Cloud đều đang bận render -> Chờ 1s cho có slot giải phóng
        await sleep(1000)
        continue
      }

      // Giữ chỗ slot cho cảnh này ngay lập tức để không bị tranh chấp
      activeSlots.set(freeWorkerId, nextScene.id)

      updateScene(nextScene.id, {
        status: 'running',
        workerId: freeWorkerId,
        progressStep: 'Đang gửi yêu cầu (giải CAPTCHA)...',
      })
      updateWorkerSlot(freeWorkerId, nextScene.sceneNumber, 'Đang gửi yêu cầu...')

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
          progressStep: job.current_step || 'Flow đã nhận token; đang tạo video...',
        })
        updateWorkerSlot(freeWorkerId, nextScene.sceneNumber, job.current_step || 'Đang tạo video trên Cloud...')

        // Kích hoạt theo dõi bất đồng bộ trong background (Không chặn vòng lặp gửi lệnh)
        const trackerPromise = trackScene(nextScene.id, nextScene.sceneNumber, job.job_id, freeWorkerId)
        trackingPromises.push(trackerPromise)

        // Giãn cách an toàn 2.5s trước khi gửi cảnh tiếp theo để tránh rate-limit reCAPTCHA
        await sleep(2500)
      } catch (err: any) {
        activeSlots.delete(freeWorkerId)
        updateWorkerSlot(freeWorkerId, undefined, undefined)
        updateScene(nextScene.id, {
          status: 'error',
          error: err.message || 'Lỗi kết nối API khi gửi job',
          progressStep: 'Lỗi',
        })
        await sleep(2000)
      }
    }

    // Chờ tất cả các tracker còn lại hoàn tất
    await Promise.allSettled(trackingPromises)

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
          <span>Tạo Đơn Lẻ</span>
        </button>
        <button
          type="button"
          className={`veo-mode-btn ${mode === 'batch' ? 'active' : ''}`}
          onClick={() => setMode('batch')}
          disabled={isBatchRunning}
        >
          <Layers size={14} />
          <span>Soạn Thảo Kịch Bản (Batch Studio)</span>
          {scenes.length > 0 && (
            <span className="veo-mode-counter">{scenes.length}</span>
          )}
        </button>
      </div>

      {/* Model selector (Dropdown) */}
      {modelNames.length > 0 && (
        <div className="veo-model-select-row">
          <div className="veo-model-select-header">
            <label className="veo-label" htmlFor="veo-t2v-model-select">Model Video</label>
            {selectedProfile?.credit_cost != null && (
              <span className="veo-credit-tag">
                {selectedProfile.credit_cost} credits / lần tạo
              </span>
            )}
          </div>
          <select
            id="veo-t2v-model-select"
            className="veo-select veo-model-dropdown"
            value={selectedProfile?.model_display_name || ''}
            onChange={(e) => selectModel(e.target.value)}
            disabled={isBatchRunning}
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

              {/* Variations Ribbon */}
              <div className="veo-studio-ribbon single-ribbon">
                <VariationSelector
                  value={variationCount}
                  onChange={setVariationCount}
                  disabled={isSubmittingSingle}
                />
              </div>

              {/* Status bar */}
              <div className="veo-profile-bar">
                <ProfileBadge />
                <span className="veo-credit-estimate">
                  {selectedProfile.credit_cost * variationCount} credits {variationCount > 1 ? `(${variationCount} biến thể)` : ''}
                </span>
              </div>

              {/* Submit Single */}
              <button
                className="veo-submit-btn"
                onClick={handleSubmitSingle}
                disabled={!prompt.trim() || !activeProject || !selectedProfile || isSubmittingSingle}
              >
                <Sparkles size={16} />
                {!activeProject
                  ? 'Vui lòng chọn Project'
                  : isSubmittingSingle
                    ? `Đang gửi ${variationCount} biến thể...`
                    : variationCount > 1
                      ? `Tạo ${variationCount} Biến Thể · ${selectedProfile.credit_cost * variationCount} credits`
                      : `Tạo Video · ${selectedProfile.credit_cost} credits`}
              </button>

              {/* Active Tasks Queue */}
              <ActiveVideoTasksQueue
                tasks={tasksToDisplay}
                onRemoveTask={handleRemoveTask}
                onPreviewJob={onPreviewJob}
              />
            </>
          )}
        </>
      )}

      {/* CHẾ ĐỘ 2: KỊCH BẢN PHÂN CẢNH & ĐA LUỒNG */}
      {mode === 'batch' && selectedProfile && (
        <>
          {/* Studio Control Ribbon: Tỉ lệ, Độ phân giải, Concurrency */}
          <div className="veo-studio-ribbon">
            <div className="veo-ribbon-item">
              <span className="veo-ribbon-label">Tỉ lệ:</span>
              <div className="veo-segmented-control">
                {aspectRatios.map((ar) => (
                  <button
                    key={ar}
                    type="button"
                    className={`veo-segment-btn ${selectedProfile.aspect_ratio === ar ? 'active' : ''}`}
                    onClick={() =>
                      selectProfile(
                        (p) =>
                          p.model_display_name === selectedProfile.model_display_name &&
                          p.aspect_ratio === ar &&
                          p.duration_seconds === selectedProfile.duration_seconds &&
                          p.resolution === selectedProfile.resolution,
                      )
                    }
                    disabled={isBatchRunning}
                  >
                    {ar}
                  </button>
                ))}
              </div>
            </div>

            {durations.length > 0 && (
              <div className="veo-ribbon-item">
                <span className="veo-ribbon-label">Thời lượng:</span>
                <div className="veo-segmented-control">
                  {durations.map((d) => (
                    <button
                      key={d}
                      type="button"
                      className={`veo-segment-btn ${selectedProfile.duration_seconds === d ? 'active' : ''}`}
                      onClick={() => handleGlobalDurationChange(d)}
                      disabled={isBatchRunning}
                    >
                      {d}s
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="veo-ribbon-item">
              <span className="veo-ribbon-label">Độ phân giải:</span>
              <div className="veo-segmented-control">
                {resolutions.map((r) => (
                  <button
                    key={r}
                    type="button"
                    className={`veo-segment-btn ${selectedProfile.resolution === r ? 'active' : ''}`}
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

            <ConcurrencySelector
              concurrency={concurrency}
              onChange={setConcurrency}
              disabled={isBatchRunning}
            />
          </div>

          {/* Khung dán kịch bản và danh sách thẻ phân cảnh */}
          <BatchScriptEditor
            scenes={scenes}
            onScenesChange={setScenes}
            disabled={isBatchRunning}
            defaultDuration={selectedProfile.duration_seconds}
            activeProject={activeProject}
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
            activeProject={activeProject}
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
