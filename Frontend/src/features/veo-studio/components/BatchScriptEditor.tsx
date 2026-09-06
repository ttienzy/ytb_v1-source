import React, { useState } from 'react'
import {
  FileText,
  Sparkles,
  Trash2,
  Copy,
  Plus,
  Play,
  RotateCcw,
  CheckCircle2,
  Clock,
  AlertCircle,
  Settings2,
  FileCode,
} from 'lucide-react'
import type { BatchSceneItem, ScriptParseOptions } from '../types'
import { parseScript, getSampleScript } from '../utils/scriptParser'

interface Props {
  scenes: BatchSceneItem[]
  onScenesChange: (scenes: BatchSceneItem[]) => void
  disabled?: boolean
  defaultDuration?: number
  onPreviewScene?: (scene: BatchSceneItem) => void
  onRetryScene?: (sceneId: string) => void
}

export function BatchScriptEditor({
  scenes,
  onScenesChange,
  disabled,
  defaultDuration = 4,
  onPreviewScene,
  onRetryScene,
}: Props) {
  const [rawText, setRawText] = useState('')
  const [showOptions, setShowOptions] = useState(false)
  const [options, setOptions] = useState<ScriptParseOptions>({
    autoDuration: true,
    ignoreAudioText: true,
    includeTitlePrefix: true,
  })

  // Thực hiện phân tách kịch bản
  const handleParse = (textToParse = rawText) => {
    if (!textToParse.trim()) return
    const result = parseScript(textToParse, defaultDuration, options)
    if (result.scenes.length > 0) {
      onScenesChange(result.scenes)
    }
  }

  // Tải mẫu kịch bản từ ảnh người dùng
  const handleLoadSample = () => {
    const sample = getSampleScript()
    setRawText(sample)
    handleParse(sample)
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

        {showOptions && (
          <div className="veo-parser-options">
            <label className="veo-option-checkbox">
              <input
                type="checkbox"
                checked={options.autoDuration}
                onChange={(e) => setOptions({ ...options, autoDuration: e.target.checked })}
              />
              <span>Tự động khớp thời lượng (4s/6s/8s/10s) theo mốc timestamp (0:00-0:02)</span>
            </label>
            <label className="veo-option-checkbox">
              <input
                type="checkbox"
                checked={options.ignoreAudioText}
                onChange={(e) => setOptions({ ...options, ignoreAudioText: e.target.checked })}
              />
              <span>Tự động bỏ qua các dòng mô tả âm thanh/chữ (Text:, Music:, Audio:)</span>
            </label>
            <label className="veo-option-checkbox">
              <input
                type="checkbox"
                checked={options.includeTitlePrefix}
                onChange={(e) => setOptions({ ...options, includeTitlePrefix: e.target.checked })}
              />
              <span>Gắn tiêu đề chủ đề (vd: "Grilled Lamb Chops:") vào đầu mỗi prompt</span>
            </label>
          </div>
        )}

        <textarea
          className="veo-textarea veo-script-textarea"
          rows={5}
          placeholder={`Dán kịch bản của bạn vào đây, ví dụ:\n48. Grilled Lamb Chops\n• 0:00–0:02: Lamb chops seasoned with rosemary, garlic...\n• 0:02–0:08: Chops dropped onto the sizzling grill...`}
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
            Phân tách thành các cảnh ({scenes.length} cảnh)
          </button>
        </div>
      </div>

      {/* Danh sách các thẻ phân cảnh (Scene Cards) */}
      <div className="veo-scenes-container">
        <div className="veo-scenes-head">
          <span className="veo-scenes-title">
            Danh sách phân cảnh ({scenes.length} cảnh)
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
                      {scene.timecode && (
                        <span className="veo-scene-timecode" title="Mốc thời gian trong kịch bản">
                          <Clock size={11} /> {scene.timecode}
                        </span>
                      )}
                    </div>

                    {/* Chọn thời lượng riêng cho cảnh */}
                    <div className="veo-scene-duration-pills">
                      {[4, 6, 8, 10].map((dur) => (
                        <button
                          key={dur}
                          type="button"
                          className={`veo-scene-dur-pill ${scene.durationSeconds === dur ? 'active' : ''}`}
                          onClick={() => handleDurationChange(scene.id, dur)}
                          disabled={disabled || isRunning}
                        >
                          {dur}s
                        </button>
                      ))}
                    </div>

                    {/* Trạng thái card */}
                    <div className="veo-scene-status-box">
                      {scene.status === 'idle' && (
                        <span className="veo-status-tag idle">Sẵn sàng</span>
                      )}
                      {scene.status === 'queued' && (
                        <span className="veo-status-tag queued">Đang chờ...</span>
                      )}
                      {scene.status === 'running' && (
                        <span className="veo-status-tag running">
                          <span className="spin">🔄</span> Luồng #{scene.workerId || 1}
                        </span>
                      )}
                      {scene.status === 'done' && (
                        <span className="veo-status-tag done">
                          <CheckCircle2 size={12} /> Xong
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
                      rows={2}
                      value={scene.prompt}
                      placeholder="Mô tả cảnh quay video..."
                      onChange={(e) => handlePromptChange(scene.id, e.target.value)}
                      disabled={disabled || isRunning}
                    />
                  </div>

                  {/* Card Footer: hiển thị bước đang chạy hoặc lỗi */}
                  {(scene.progressStep || scene.error) && (
                    <div className="veo-scene-card-footer">
                      {scene.progressStep && (
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
