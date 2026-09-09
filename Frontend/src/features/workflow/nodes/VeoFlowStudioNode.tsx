import React, { useState } from 'react'
import { Handle, Position } from '@xyflow/react'
import {
  Film,
  Sparkles,
  Play,
  Video,
  Download,
  CheckCircle2,
  Clock,
  Layers,
  Camera,
  Trash2,
  Sliders,
  ChevronRight,
  ExternalLink,
  Maximize2,
} from 'lucide-react'
import type { VeoFlowStudioNodeData } from '../types'

interface VeoFlowStudioNodeProps {
  data: VeoFlowStudioNodeData
  selected?: boolean
}

export function VeoFlowStudioNode({ data, selected }: VeoFlowStudioNodeProps) {
  const scenes = data.scenes || []
  const [activeTab, setActiveTab] = useState<number>(data.activeSceneIndex ?? 0)

  // Sync activeTab when data.activeSceneIndex changes from parent
  React.useEffect(() => {
    if (data.activeSceneIndex !== undefined && data.activeSceneIndex >= 0 && data.activeSceneIndex < scenes.length) {
      setActiveTab(data.activeSceneIndex)
    }
  }, [data.activeSceneIndex, scenes.length])

  // Ensure activeTab is within valid bounds
  const safeTab = Math.min(Math.max(0, activeTab), Math.max(0, scenes.length - 1))
  const currentScene = scenes[safeTab] || scenes[0] || {
    sceneNumber: 1,
    title: 'Phân cảnh 1',
    prompt: '',
    durationSec: 4,
    aspectRatio: '9:16' as const,
  }

  const isRendering = currentScene.isRendering || (data.isRendering && data.activeSceneIndex === safeTab)
  const renderProgress = currentScene.renderProgress ?? (data.renderProgress ?? 0)

  const isExporting = data.isExporting ?? false
  const exportProgress = data.exportProgress ?? 0

  const handleTabClick = (idx: number) => {
    setActiveTab(idx)
    data.onSelectScene?.(idx)
  }

  const totalDuration = scenes.reduce((sum, s) => sum + (s.durationSec || 4), 0)
  const isStartNode = data.isStartNode ?? false
  const isOrphan = data.isOrphan ?? false

  return (
    <div
      className={`wf-node-card ${selected ? 'selected' : ''} ${isStartNode ? 'is-start-node' : ''} ${isOrphan ? 'is-orphan' : ''}`}
      style={{ width: 440 }}
    >
      {isStartNode && (
        <div className="wf-start-banner">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span className="wf-start-dot" />
            <span>⭐ NODE CHÍNH (ĐIỂM KHỞI ĐẦU)</span>
          </div>
          <span style={{ fontSize: 9, opacity: 0.9 }}>Root Trigger</span>
        </div>
      )}

      {/* Top handles receiving asset wires from Product and Character nodes */}
      <Handle
        type="target"
        position={Position.Top}
        id="from-assets"
        style={{ left: '30%' }}
        className="wf-handle wf-handle-target"
        title="Nhận ảnh sản phẩm & nhân vật"
      />


      {/* Left handle receiving script wires from GPT node */}
      <Handle
        type="target"
        position={Position.Left}
        id="from-gpt"
        style={{ top: '35%' }}
        className="wf-handle wf-handle-target"
        title="Nhận kịch bản từ ChatGPT"
      />


      {/* Header */}
      <div className="wf-node-header" style={{ background: '#fdf2f8', borderBottom: '1px solid #fce7f3' }}>
        <div className="wf-node-title-group">
          <div
            className="wf-node-icon"
            style={{
              background: 'linear-gradient(135deg, #f43f5e, #e11d48)',
              color: '#ffffff',
              boxShadow: '0 2px 6px rgba(244, 63, 94, 0.3)',
            }}
          >
            <Film size={15} />
          </div>
          <div>
            <div className="wf-node-title" style={{ color: '#881337' }}>
              {data.title || 'Google Veo 3.0 • Flow Studio'}
            </div>
            <div style={{ fontSize: 10, color: '#e11d48', fontWeight: 600 }}>
              Sinh Clip Tự Động & Ghép Nối Timeline
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          {isOrphan && (
            <span className="wf-orphan-badge" title="Node này chưa được nối dây với quy trình">
              Chưa nối
            </span>
          )}

          <button
            type="button"
            className={`wf-node-star-btn ${isStartNode ? 'is-active' : ''}`}
            onClick={(e) => {
              e.stopPropagation()
              data.onSetStartNode?.()
            }}
            title={isStartNode ? 'Node chính bắt đầu quy trình' : 'Nhấp để đặt làm Node chính'}
          >
            <span style={{ fontSize: 13 }}>{isStartNode ? '⭐' : '☆'}</span>
          </button>

          <span
            className="wf-node-badge"
            style={{
              background: '#ffffff',
              color: '#e11d48',
              border: '1px solid #fbcfe8',
              boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
            }}
          >
            {scenes.length} Cảnh • {totalDuration}s
          </span>
          <button
            type="button"
            className="wf-node-del-btn"
            onClick={(e) => {
              e.stopPropagation()
              data.onDelete?.()
            }}
            title="Xóa Flow Studio"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>


      {/* Body */}
      <div className="wf-node-body" style={{ padding: '12px 14px' }}>
        {/* Veo Project & Config Status Bar */}
        <div
          style={{
            marginBottom: 10,
            padding: '7px 10px',
            background: data.activeProject ? '#f0fdf4' : '#fffbeb',
            border: data.activeProject ? '1px solid #bbf7d0' : '1px solid #fde68a',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, overflow: 'hidden' }}>
            <span style={{ fontWeight: 700, color: data.activeProject ? '#166534' : '#b45309', whiteSpace: 'nowrap' }}>
              {data.activeProject ? `📁 ${data.activeProject.name}` : '⚠️ Chưa chọn Project'}
            </span>
            <span style={{ fontSize: 10, color: '#64748b', whiteSpace: 'nowrap' }}>
              • {data.videoConfig?.model || 'Omni 1.1 Flash'} • {data.videoConfig?.aspectRatio || '9:16'} • {data.videoConfig?.resolution || '720p'}
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              data.onOpenVeoSetup?.()
            }}
            style={{
              background: '#ffffff',
              border: '1px solid #cbd5e1',
              borderRadius: 6,
              padding: '3px 8px',
              fontSize: 10,
              fontWeight: 700,
              color: '#334155',
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
              whiteSpace: 'nowrap',
            }}
            title="Mở Modal thiết lập Project và thông số video"
          >
            <Sliders size={11} style={{ color: '#e11d48' }} />
            Cấu hình Veo
          </button>
        </div>

        {/* GPT Script Sync Status */}
        {data.availableGptScripts && data.availableGptScripts.length > 0 && (
          <div
            style={{
              marginBottom: 10,
              padding: '6px 10px',
              background: '#faf5ff',
              border: '1px solid #f3e8ff',
              borderRadius: 8,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              fontSize: 11,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, color: '#6b21a8' }}>
              <Sparkles size={12} style={{ color: '#9333ea' }} />
              <span style={{ fontWeight: 600 }}>
                {data.selectedGptScriptAngle || 'Kịch bản ChatGPT'}
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                type="button"
                onClick={() => data.onApplyAllGptScripts?.()}
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  padding: '2px 7px',
                  borderRadius: 4,
                  border: '1px solid #c084fc',
                  background: '#f3e8ff',
                  color: '#6b21a8',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
                title={`Đẩy ${data.availableGptScripts.length} kịch bản đầy đủ vào ${data.availableGptScripts.length} cảnh tương ứng`}
              >
                ⚡ Đồng bộ {data.availableGptScripts.length} Cảnh
              </button>
              <select
                style={{
                  fontSize: 10,
                  fontWeight: 600,
                  padding: '2px 5px',
                  borderRadius: 4,
                  border: '1px solid #d8b4fe',
                  background: '#ffffff',
                  color: '#7e22ce',
                  cursor: 'pointer',
                }}
                onChange={(e) => {
                  const val = e.target.value
                  if (val === 'all') {
                    data.onApplyAllGptScripts?.()
                  } else {
                    data.onApplyGptScript?.(Number(val))
                  }
                }}
                defaultValue=""
              >
                <option value="" disabled>Nạp kịch bản vào Cảnh #{safeTab + 1}...</option>
                {data.availableGptScripts.map((s, i) => (
                  <option key={i} value={i}>
                    {`#${i + 1} — ${s.angle || s.title || `Kịch bản ${i + 1}`}`}
                  </option>
                ))}
              </select>
            </div>
          </div>
        )}

        {/* Scene Navigation Tabs */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            background: '#f1f5f9',
            padding: 3,
            borderRadius: 8,
            marginBottom: 10,
          }}
        >
          {scenes.map((scene, idx) => {
            const isActive = idx === safeTab
            return (
              <button
                key={scene.sceneNumber || idx}
                type="button"
                onClick={() => handleTabClick(idx)}
                style={{
                  flex: 1,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 4,
                  padding: '5px 8px',
                  borderRadius: 6,
                  fontSize: 11,
                  fontWeight: isActive ? 700 : 500,
                  border: 'none',
                  background: isActive ? '#ffffff' : 'transparent',
                  color: isActive ? '#0f172a' : '#64748b',
                  boxShadow: isActive ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: '50%',
                    background: scene.thumbnailUrl ? '#10b981' : isActive ? '#6366f1' : '#cbd5e1',
                  }}
                />
                Cảnh #{idx + 1}
              </button>
            )
          })}
        </div>

        {/* Cinema Video Preview Window */}
        <div
          style={{
            width: '100%',
            height: 170,
            background: '#050811',
            borderRadius: 8,
            overflow: 'hidden',
            position: 'relative',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1px solid #1e293b',
            marginBottom: 10,
          }}
        >
          {currentScene.videoUrl ? (
            <>
              <video
                src={currentScene.videoUrl}
                controls
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                poster={currentScene.thumbnailUrl || undefined}
              />
              <button
                type="button"
                onClick={() =>
                  data.onOpenPreviewModal?.(
                    currentScene.videoUrl!,
                    `Cảnh #${safeTab + 1}: ${currentScene.title || 'Phân cảnh'}`,
                    currentScene.prompt
                  )
                }
                style={{
                  position: 'absolute',
                  top: 8,
                  right: 8,
                  zIndex: 5,
                  padding: '3px 7px',
                  borderRadius: 6,
                  border: 'none',
                  background: 'rgba(15, 23, 42, 0.75)',
                  backdropFilter: 'blur(4px)',
                  color: '#f8fafc',
                  fontSize: 10,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  boxShadow: '0 2px 6px rgba(0,0,0,0.3)',
                }}
                title="Mở xem video toàn cảnh chất lượng cao"
              >
                <Maximize2 size={11} />
                Toàn cảnh
              </button>
            </>
          ) : currentScene.thumbnailUrl ? (
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <img
                src={currentScene.thumbnailUrl}
                alt="Scene frame"
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
              <div
                style={{
                  position: 'absolute',
                  inset: 0,
                  background: 'rgba(0,0,0,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <div
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: '50%',
                    background: 'rgba(255,255,255,0.9)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: '#0f172a',
                    cursor: 'pointer',
                  }}
                >
                  <Play size={16} fill="#0f172a" style={{ marginLeft: 2 }} />
                </div>
              </div>
            </div>
          ) : isRendering ? (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(15, 23, 42, 0.92)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                padding: '0 20px',
              }}
            >
              <Sparkles size={22} color="#f43f5e" className="animate-spin" />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc' }}>
                Đang render Veo Cảnh #{safeTab + 1}... {renderProgress}%
              </div>
              <div
                style={{
                  width: '80%',
                  height: 6,
                  background: 'rgba(255,255,255,0.15)',
                  borderRadius: 3,
                  overflow: 'hidden',
                }}
              >
                <div
                  style={{
                    height: '100%',
                    width: `${renderProgress}%`,
                    background: 'linear-gradient(90deg, #f43f5e, #8b5cf6)',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          ) : (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 6,
                color: '#64748b',
              }}
            >
              <Film size={28} color="#475569" />
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Chưa xuất clip cho Cảnh #{safeTab + 1}</span>
            </div>
          )}

          {/* Quick overlay badges */}
          <div
            style={{
              position: 'absolute',
              bottom: 8,
              left: 8,
              display: 'flex',
              gap: 4,
              zIndex: 2,
            }}
          >
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: 'rgba(15, 23, 42, 0.75)',
                color: '#f8fafc',
                padding: '2px 6px',
                borderRadius: 4,
                backdropFilter: 'blur(4px)',
              }}
            >
              {currentScene.aspectRatio || '9:16'}
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: 'rgba(15, 23, 42, 0.75)',
                color: '#f8fafc',
                padding: '2px 6px',
                borderRadius: 4,
                backdropFilter: 'blur(4px)',
              }}
            >
              {currentScene.cameraMotion || 'Cinematic Motion'}
            </span>
          </div>
        </div>

        {/* Scene Prompt & Parameters */}
        <div style={{ marginBottom: 10 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 4,
            }}
          >
            <label style={{ fontSize: 11, fontWeight: 700, color: '#475569' }}>
              Prompt mô tả cảnh #{safeTab + 1}:
            </label>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>
              {currentScene.title || 'Mô tả hình ảnh'}
            </span>
          </div>

          <textarea
            className="wf-input-textarea"
            rows={2}
            value={currentScene.prompt || ''}
            onChange={(e) => data.onUpdateScenePrompt?.(safeTab, e.target.value)}
            placeholder="Mô tả chi tiết góc quay điện ảnh, hành động của nhân vật, ánh sáng bối cảnh..."
            style={{ minHeight: 50 }}
          />
        </div>

        {/* Quick Scene Controls: Duration & Render Button */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            marginBottom: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>Thời lượng:</span>
            {[4, 6, 8, 10].map((sec) => (
              <button
                key={sec}
                type="button"
                onClick={() => data.onUpdateSceneDuration?.(safeTab, sec)}
                style={{
                  padding: '3px 7px',
                  borderRadius: 4,
                  fontSize: 10,
                  fontWeight: 700,
                  border: currentScene.durationSec === sec ? '1px solid #f43f5e' : '1px solid #e2e8f0',
                  background: currentScene.durationSec === sec ? '#fff1f2' : '#ffffff',
                  color: currentScene.durationSec === sec ? '#e11d48' : '#64748b',
                  cursor: 'pointer',
                }}
              >
                {sec}s
              </button>
            ))}
          </div>

          <button
            type="button"
            className="wf-btn wf-btn-accent"
            onClick={() => {
              if (!data.activeProject) {
                data.onOpenVeoSetup?.()
              } else {
                data.onRenderScene?.(safeTab)
              }
            }}
            disabled={isRendering}
            style={{ padding: '5px 12px', fontSize: 11 }}
            title={!data.activeProject ? 'Bấm để cấu hình và chọn Project trước' : `Tạo clip cảnh #${safeTab + 1}`}
          >
            <Video size={13} />
            {isRendering ? 'Đang tạo...' : !data.activeProject ? 'Cấu hình Project' : `Tạo Clip Cảnh #${safeTab + 1}`}
          </button>
        </div>

        {/* Timeline Stitching & Export Section */}
        <div
          style={{
            borderTop: '1px solid #f1f5f9',
            paddingTop: 10,
            background: '#f8fafc',
            margin: '0 -14px -12px -14px',
            padding: '10px 14px',
            borderBottomLeftRadius: 14,
            borderBottomRightRadius: 14,
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 8,
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 700, color: '#334155', display: 'flex', alignItems: 'center', gap: 5 }}>
              <Layers size={13} color="#6366f1" />
              Timeline Ghép Nối ({scenes.length} cảnh • {totalDuration}s):
            </div>
            <span style={{ fontSize: 10, color: '#64748b' }}>Định dạng: MP4 1080p</span>
          </div>

          {/* Timeline Sequence strip */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              marginBottom: 10,
            }}
          >
            {scenes.map((sc, i) => (
              <React.Fragment key={i}>
                <div
                  style={{
                    flex: sc.durationSec || 4,
                    height: 28,
                    borderRadius: 6,
                    background: sc.thumbnailUrl ? '#ecfdf5' : '#ffffff',
                    border: sc.thumbnailUrl ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: 10,
                    fontWeight: 600,
                    color: sc.thumbnailUrl ? '#059669' : '#64748b',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    padding: '0 4px',
                  }}
                >
                  #{i + 1} ({sc.durationSec || 4}s)
                </div>
                {i < scenes.length - 1 && (
                  <ChevronRight size={12} color="#cbd5e1" style={{ flexShrink: 0 }} />
                )}
              </React.Fragment>
            ))}
          </div>

          {/* Export Button & Progress */}
          {isExporting ? (
            <div
              style={{
                background: '#e0e7ff',
                borderRadius: 8,
                padding: '8px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  fontSize: 11,
                  fontWeight: 700,
                  color: '#3730a3',
                }}
              >
                <span>Đang kết xuất và ghép nối video...</span>
                <span>{exportProgress}%</span>
              </div>
              <div style={{ height: 4, background: '#c7d2fe', borderRadius: 2, overflow: 'hidden' }}>
                <div
                  style={{
                    height: '100%',
                    width: `${exportProgress}%`,
                    background: '#4f46e5',
                    transition: 'width 0.3s ease',
                  }}
                />
              </div>
            </div>
          ) : data.finalVideoUrl ? (
            <div
              style={{
                background: '#ecfdf5',
                border: '1px solid #a7f3d0',
                borderRadius: 8,
                padding: '10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#065f46',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <CheckCircle2 size={14} color="#059669" /> Video hoàn chỉnh đã sẵn sàng!
                </span>
                <span style={{ fontSize: 10, color: '#047857', fontWeight: 600 }}>MP4 • 1080p</span>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="wf-btn"
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    padding: '5px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                    background: '#ffffff',
                    color: '#065f46',
                    border: '1px solid #a7f3d0',
                  }}
                  onClick={() =>
                    data.onOpenPreviewModal?.(
                      data.finalVideoUrl!,
                      'Video hoàn chỉnh (Ghép nối timeline)',
                      undefined
                    )
                  }
                >
                  <Play size={12} fill="#065f46" /> Phát Video
                </button>

                <button
                  type="button"
                  className="wf-btn"
                  style={{
                    flex: 1,
                    justifyContent: 'center',
                    padding: '5px 8px',
                    fontSize: 11,
                    fontWeight: 700,
                    background: '#ffffff',
                    color: '#4338ca',
                    border: '1px solid #c7d2fe',
                  }}
                  onClick={() => data.onOpenLibrary?.()}
                >
                  <Film size={12} color="#6366f1" /> Thư viện
                </button>

                <a
                  href={data.finalVideoUrl}
                  download="workflow_final_video.mp4"
                  className="wf-btn wf-btn-primary"
                  style={{
                    padding: '5px 10px',
                    fontSize: 11,
                    textDecoration: 'none',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Download size={12} /> Tải MP4
                </a>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="wf-btn wf-btn-primary"
              style={{ width: '100%', justifyContent: 'center', padding: '8px' }}
              onClick={() => data.onExportVideo?.()}
            >
              <Download size={14} />
              Xuất Video Hoàn Chỉnh (MP4 • 1080p)
            </button>
          )}
        </div>
      </div>

      {/* Right Output handle */}
      <Handle
        type="source"
        position={Position.Right}
        id="video-output"
        style={{ top: '50%' }}
        className="wf-handle wf-handle-source"
        title="Dòng xuất video hoàn chỉnh"
      />
    </div>
  )
}
