import React, { useState } from 'react'
import {
  Download,
  FileText,
  Sparkles,
  Trash2,
  Copy,
  Plus,
  Play,
  RotateCcw,
  CheckCircle2,
  AlertCircle,
  Settings2,
  FileCode,
  Loader2,
  Clock,
} from 'lucide-react'
import type { BatchSceneItem, ScriptParseOptions, VeoProject } from '../types'
import { parseScript, getSampleScript } from '../utils/scriptParser'
import { getVideoStreamUrl } from '../services/veoApi'

interface Props {
  scenes: BatchSceneItem[]
  onScenesChange: (scenes: BatchSceneItem[]) => void
  disabled?: boolean
  defaultDuration?: number
  activeProject?: VeoProject | null
  onPreviewScene?: (scene: BatchSceneItem) => void
  onRetryScene?: (sceneId: string) => void
}

export function BatchScriptEditor({
  scenes,
  onScenesChange,
  disabled,
  defaultDuration = 4,
  activeProject,
  onPreviewScene,
  onRetryScene,
}: Props) {
  const [rawText, setRawText] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  const [options, setOptions] = useState<ScriptParseOptions>({
    splitMode: 'by_video',
    autoDuration: true,
    ignoreAudioText: false,
    includeTitlePrefix: true,
  })

  // Thực hiện phân tách kịch bản
  const handleParse = (textToParse = rawText, currentOpts = options) => {
    if (!textToParse.trim()) return
    const result = parseScript(textToParse, defaultDuration, currentOpts)
    if (result.scenes.length > 0) {
      onScenesChange(result.scenes)
    }
  }

  // Chuyển đổi nhanh chế độ phân tách
  const handleModeChange = (mode: 'by_video' | 'by_scene') => {
    const nextOpts: ScriptParseOptions = { ...options, splitMode: mode }
    setOptions(nextOpts)
    if (rawText.trim()) {
      handleParse(rawText, nextOpts)
    }
  }

  // Tải mẫu kịch bản từ ảnh người dùng
  const handleLoadSample = () => {
    const sample = getSampleScript()
    setRawText(sample)
    handleParse(sample, options)
  }

  // Xóa trắng
  const handleClear = () => {
    setRawText('')
    onScenesChange([])
  }

  // Thêm một cảnh trống mới
  const handleAddEmptyScene = () => {
    const newScene: BatchSceneItem = {
      id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      sceneNumber: scenes.length + 1,
      prompt: '',
      durationSeconds: defaultDuration,
      status: 'idle',
    }
    onScenesChange([...scenes, newScene])
  }

  // Sửa nội dung prompt của cảnh
  const handlePromptChange = (id: string, newPrompt: string) => {
    onScenesChange(
      scenes.map((s) => (s.id === id ? { ...s, prompt: newPrompt } : s)),
    )
  }

  // Đổi thời lượng của cảnh
  const handleDurationChange = (id: string, duration: number) => {
    onScenesChange(
      scenes.map((s) => (s.id === id ? { ...s, durationSeconds: duration } : s)),
    )
  }

  // Xóa cảnh
  const handleDeleteScene = (id: string) => {
    const remaining = scenes.filter((s) => s.id !== id)
    // Cập nhật lại số thứ tự
    onScenesChange(
      remaining.map((s, idx) => ({ ...s, sceneNumber: idx + 1 })),
    )
  }

  // Nhân bản cảnh
  const handleDuplicateScene = (scene: BatchSceneItem) => {
    const index = scenes.findIndex((s) => s.id === scene.id)
    const cloned: BatchSceneItem = {
      ...scene,
      id: `scene-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      status: 'idle',
      jobId: undefined,
      workerId: undefined,
      videoUrl: undefined,
      error: undefined,
      progressStep: undefined,
    }
    const next = [...scenes]
    next.splice(index + 1, 0, cloned)
    onScenesChange(next.map((s, idx) => ({ ...s, sceneNumber: idx + 1 })))
  }

  return (
    <div className="veo-batch-editor">
      {/* Khung dán kịch bản thô */}
      <div className="veo-raw-script-box">
        <div className="veo-raw-script-head">
          <label className="veo-label">
            <FileText size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
            Dán kịch bản phân cảnh
            {activeProject ? (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: 'var(--color-primary, #6366f1)' }}>
                (Project: <strong>{activeProject.name}</strong>)
              </span>
            ) : (
              <span style={{ marginLeft: 8, fontSize: 12, fontWeight: 500, color: 'var(--color-danger, #ef4444)' }}>
                (⚠️ Chưa chọn Project)
              </span>
            )}
          </label>
          <div className="veo-raw-script-actions">
            <button
              type="button"
              className="veo-text-action-btn"
              onClick={handleLoadSample}
              disabled={disabled}
              title="Điền mẫu kịch bản phân cảnh món ăn tương tự ảnh"
            >
              <FileCode size={13} />
              Tải mẫu kịch bản
            </button>
            <button
              type="button"
              className="veo-text-action-btn"
              onClick={() => setShowOptions(!showOptions)}
            >
              <Settings2 size={13} />
              Cài đặt phân tách
            </button>
            {rawText && (
              <button
                type="button"
                className="veo-text-action-btn danger"
                onClick={handleClear}
                disabled={disabled}
              >
                <Trash2 size={13} />
                Xóa
              </button>
            )}
          </div>
        </div>

        {/* Thanh chọn nhanh chế độ phân tách */}
        <div className="veo-split-mode-bar">
          <span className="veo-split-mode-label">Chế độ phân tách:</span>
          <div className="veo-split-mode-options">
            <button
              type="button"
              className={`veo-mode-btn ${options.splitMode !== 'by_scene' ? 'active' : ''}`}
              onClick={() => handleModeChange('by_video')}
              title="Mỗi món/mục kịch bản thành 1 video hoàn chỉnh (giữ nguyên toàn bộ text mô tả)"
            >
              Video hoàn chỉnh (1 Prompt / video)
            </button>
            <button
              type="button"
              className={`veo-mode-btn ${options.splitMode === 'by_scene' ? 'active' : ''}`}
              onClick={() => handleModeChange('by_scene')}
              title="Tách từng mốc thời gian (0:00-0:02, 0:02-0:08) thành từng cảnh riêng biệt"
            >
              Phân cảnh Timeline (1 Prompt / shot)
            </button>
          </div>
        </div>

        {showOptions && (
          <div className="veo-parser-options">
            <label className="veo-option-checkbox">
              <input
                type="checkbox"
                checked={options.ignoreAudioText}
                onChange={(e) => {
                  const next = { ...options, ignoreAudioText: e.target.checked }
                  setOptions(next)
                  if (rawText.trim()) handleParse(rawText, next)
                }}
              />
              <span>Lọc bỏ các dòng Text:, Music: (Mặc định tắt để giữ nguyên 100% text kịch bản)</span>
            </label>
            <label className="veo-option-checkbox">
              <input
                type="checkbox"
                checked={options.autoDuration}
                onChange={(e) => {
                  const next = { ...options, autoDuration: e.target.checked }
                  setOptions(next)
                  if (rawText.trim()) handleParse(rawText, next)
                }}
              />
              <span>Tự động khớp thời lượng (4s/6s/8s/10s) theo mốc timestamp kịch bản</span>
            </label>
            {options.splitMode === 'by_scene' && (
              <label className="veo-option-checkbox">
                <input
                  type="checkbox"
                  checked={options.includeTitlePrefix}
                  onChange={(e) => {
                    const next = { ...options, includeTitlePrefix: e.target.checked }
                    setOptions(next)
                    if (rawText.trim()) handleParse(rawText, next)
                  }}
                />
                <span>Gắn tên món/chủ đề vào đầu mỗi prompt phân cảnh</span>
              </label>
            )}
          </div>
        )}

        <textarea
          className="veo-textarea veo-script-textarea"
          rows={5}
          placeholder="// Dán kịch bản vào đây (Mỗi video bắt đầu bằng số thứ tự như: 1., 2., 49., 50...)"
          value={rawText}
          onChange={(e) => setRawText(e.target.value)}
          disabled={disabled}
        />

        <div className="veo-raw-script-footer">
          <button
            type="button"
            className="veo-parse-btn"
            onClick={() => handleParse()}
            disabled={disabled || !rawText.trim()}
          >
            <Sparkles size={14} />
            {options.splitMode === 'by_scene'
              ? `Phân tách phân cảnh (${scenes.length} cảnh)`
              : `Phân tách kịch bản (${scenes.length} video)`}
          </button>
        </div>
      </div>

      {/* Danh sách các thẻ phân cảnh (Scene Cards) */}
      <div className="veo-scenes-container">
        <div className="veo-scenes-head">
          <span className="veo-scenes-title">
            {options.splitMode === 'by_scene'
              ? `Danh sách phân cảnh (${scenes.length} cảnh)`
              : `Danh sách video kịch bản (${scenes.length} video)`}
          </span>
          <button
            type="button"
            className="veo-add-scene-btn"
            onClick={handleAddEmptyScene}
            disabled={disabled}
          >
            <Plus size={13} />
            Thêm cảnh
          </button>
        </div>

        {scenes.length === 0 ? (
          <div className="veo-empty-scenes">
            <p>Chưa có phân cảnh nào. Hãy dán kịch bản vào khung trên hoặc bấm <strong>"Tải mẫu kịch bản"</strong> để thử nghiệm.</p>
          </div>
        ) : (
          <div className="veo-scene-list">
            {scenes.map((scene) => {
              const isRunning = scene.status === 'running' || scene.status === 'queued'
              const isDone = scene.status === 'done'
              const isError = scene.status === 'error'

              return (
                <div
                  key={scene.id}
                  className={`veo-scene-card ${isRunning ? 'running' : ''} ${isDone ? 'done' : ''} ${isError ? 'error' : ''}`}
                >
                  {/* Card Header */}
                  <div className="veo-scene-card-header">
                    <div className="veo-scene-badge-group">
                      <span className="veo-scene-num">#{scene.sceneNumber}</span>
                    </div>

                    {/* Trạng thái card */}
                    <div className="veo-scene-status-box">
                      {scene.status === 'idle' && (
                        <span className="veo-status-tag idle">Sẵn sàng</span>
                      )}
                      {scene.status === 'queued' && (
                        <span className="veo-status-tag queued">
                          <Clock size={11} /> Đang chờ luồng
                        </span>
                      )}
                      {scene.status === 'running' && (
                        <span className="veo-status-tag running">
                          <Loader2 size={11} className="spin" /> Luồng #{scene.workerId || 1}
                        </span>
                      )}
                      {scene.status === 'done' && (
                        <span className="veo-status-tag done">
                          <CheckCircle2 size={12} /> Đã xong
                        </span>
                      )}
                      {scene.status === 'error' && (
                        <span className="veo-status-tag error">
                          <AlertCircle size={12} /> Lỗi
                        </span>
                      )}
                    </div>

                    {/* Nút hành động trên thẻ */}
                    <div className="veo-scene-actions">
                      {isDone && onPreviewScene && (
                        <button
                          type="button"
                          className="veo-scene-act-btn play"
                          title="Xem video của cảnh này"
                          onClick={() => onPreviewScene(scene)}
                        >
                          <Play size={12} />
                        </button>
                      )}
                      {isError && onRetryScene && (
                        <button
                          type="button"
                          className="veo-scene-act-btn retry"
                          title="Thử lại cảnh này"
                          onClick={() => onRetryScene(scene.id)}
                        >
                          <RotateCcw size={12} />
                        </button>
                      )}
                      <button
                        type="button"
                        className="veo-scene-act-btn"
                        title="Nhân bản cảnh"
                        onClick={() => handleDuplicateScene(scene)}
                        disabled={disabled || isRunning}
                      >
                        <Copy size={12} />
                      </button>
                      <button
                        type="button"
                        className="veo-scene-act-btn danger"
                        title="Xóa cảnh"
                        onClick={() => handleDeleteScene(scene.id)}
                        disabled={disabled || isRunning}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>

                  {/* Card Body: Prompt textarea */}
                  <div className="veo-scene-card-body">
                    <textarea
                      className="veo-scene-textarea"
                      rows={options.splitMode === 'by_scene' ? 2 : 5}
                      value={scene.prompt}
                      placeholder={options.splitMode === 'by_scene' ? 'Mô tả cảnh quay video...' : 'Mô tả toàn bộ video (giữ nguyên kịch bản gốc)...'}
                      onChange={(e) => handlePromptChange(scene.id, e.target.value)}
                      disabled={disabled || isRunning}
                    />
                  </div>

                  {/* Video thành phẩm hiển thị tức thì ngay khi cảnh này hoàn tất */}
                  {isDone && scene.videoUrl && (
                    <div style={{
                      padding: '8px 12px',
                      background: 'rgba(16, 185, 129, 0.06)',
                      borderTop: '1px solid rgba(16, 185, 129, 0.2)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 10,
                    }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <video
                          src={getVideoStreamUrl(scene.videoUrl)}
                          style={{ width: 80, height: 46, borderRadius: 4, objectFit: 'cover', background: '#000', cursor: 'pointer' }}
                          muted
                          onClick={() => onPreviewScene?.(scene)}
                        />
                        <div>
                          <div style={{ fontSize: 12, color: 'var(--color-success, #10b981)', fontWeight: 600 }}>
                            ✓ Đã gửi về App!
                          </div>
                          <div style={{ fontSize: 11, color: 'var(--color-text-muted, #94a3b8)' }}>
                            {scene.videoUrl}
                          </div>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        {onPreviewScene && (
                          <button
                            type="button"
                            className="veo-text-action-btn"
                            onClick={() => onPreviewScene(scene)}
                            title="Xem video trên màn hình lớn"
                          >
                            <Play size={12} /> Xem
                          </button>
                        )}
                        <a
                          href={getVideoStreamUrl(scene.videoUrl)}
                          download={scene.videoUrl}
                          className="veo-text-action-btn"
                          title="Tải video này về máy"
                        >
                          <Download size={12} /> Tải về
                        </a>
                      </div>
                    </div>
                  )}

                  {/* Card Footer: hiển thị bước đang chạy hoặc lỗi */}
                  {(scene.progressStep || scene.error || scene.status === 'queued') && (
                    <div className="veo-scene-card-footer">
                      {scene.status === 'queued' && (
                        <span className="veo-scene-step-text" style={{ color: '#d97706' }}>
                          ⏳ Đang trong hàng đợi (Tự động kích hoạt khi có luồng trống)...
                        </span>
                      )}
                      {scene.status !== 'queued' && scene.progressStep && (
                        <span className="veo-scene-step-text">{scene.progressStep}</span>
                      )}
                      {scene.error && (
                        <span className="veo-scene-error-text" title={scene.error}>
                          {scene.error}
                        </span>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
