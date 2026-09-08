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
} from 'lucide-react'
import type { VeoFlowStudioNodeData } from '../types'

interface VeoFlowStudioNodeProps {
  data: VeoFlowStudioNodeData
  selected?: boolean
}

export function VeoFlowStudioNode({ data, selected }: VeoFlowStudioNodeProps) {
  const scenes = data.scenes || []
  const activeIndex = Math.min(data.activeSceneIndex ?? 0, Math.max(0, scenes.length - 1))
  const currentScene = scenes[activeIndex] || {
    sceneNumber: 1,
    title: 'Phân cảnh 1',
    prompt: '',
    durationSec: 4,
    aspectRatio: '9:16' as const,
  }

  const [activeTab, setActiveTab] = useState<number>(activeIndex)
  const isRendering = currentScene.isRendering || (data.isRendering && data.activeSceneIndex === activeTab)
  const renderProgress = currentScene.renderProgress ?? (data.renderProgress ?? 0)

  const isExporting = data.isExporting ?? false
  const exportProgress = data.exportProgress ?? 0

  const handleTabClick = (idx: number) => {
    setActiveTab(idx)
    data.onSelectScene?.(idx)
  }

  const totalDuration = scenes.reduce((sum, s) => sum + (s.durationSec || 4), 0)

  return (
    <div className={`wf-node-card ${selected ? 'selected' : ''}`} style={{ width: 440 }}>
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
      <Handle
        type="target"
        position={Position.Left}
        id="scene-1-in"
        style={{ top: '55%' }}
        className="wf-handle wf-handle-target"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="scene-2-in"
        style={{ top: '65%' }}
        className="wf-handle wf-handle-target"
      />
      <Handle
        type="target"
        position={Position.Left}
        id="scene-3-in"
        style={{ top: '75%' }}
        className="wf-handle wf-handle-target"
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

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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
            const isActive = idx === activeTab
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
            height: 140,
            background: '#090d16',
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
            <video
              src={currentScene.videoUrl}
              controls
              style={{ width: '100%', height: '100%', objectFit: 'cover' }}
              poster={currentScene.thumbnailUrl || undefined}
            />
          ) : currentScene.thumbnailUrl ? (
            <div style={{ width: '100%', height: '100%', position: 'relative' }}>
              <img
                src={currentScene.thumbnailUrl}
                alt="Scene frame"
                style={{ width: '100%', height: '100%', objectFit: 'cover' }}
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
                Đang render Veo Cảnh #{activeTab + 1}... {renderProgress}%
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
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Chưa xuất clip cho Cảnh #{activeTab + 1}</span>
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
              Prompt mô tả cảnh #{activeTab + 1}:
            </label>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>
              {currentScene.title || 'Mô tả hình ảnh'}
            </span>
          </div>

          <textarea
            className="wf-input-textarea"
            rows={2}
            value={currentScene.prompt || ''}
            onChange={(e) => data.onUpdateScenePrompt?.(activeTab, e.target.value)}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, color: '#64748b' }}>Thời lượng:</span>
            <button
              type="button"
              onClick={() => data.onUpdateSceneDuration?.(activeTab, 4)}
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                border: currentScene.durationSec === 4 ? '1px solid #f43f5e' : '1px solid #e2e8f0',
                background: currentScene.durationSec === 4 ? '#fff1f2' : '#ffffff',
                color: currentScene.durationSec === 4 ? '#e11d48' : '#64748b',
                cursor: 'pointer',
              }}
            >
              4s
            </button>
            <button
              type="button"
              onClick={() => data.onUpdateSceneDuration?.(activeTab, 8)}
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                border: currentScene.durationSec === 8 ? '1px solid #f43f5e' : '1px solid #e2e8f0',
                background: currentScene.durationSec === 8 ? '#fff1f2' : '#ffffff',
                color: currentScene.durationSec === 8 ? '#e11d48' : '#64748b',
                cursor: 'pointer',
              }}
            >
              8s
            </button>
          </div>

          <button
            type="button"
            className="wf-btn wf-btn-accent"
            onClick={() => data.onRenderScene?.(activeTab)}
            disabled={isRendering}
            style={{ padding: '5px 12px', fontSize: 11 }}
          >
            <Video size={13} />
            {isRendering ? 'Đang tạo...' : `Tạo Clip Cảnh #${activeTab + 1}`}
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
                padding: '8px 12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
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
              <button
                type="button"
                className="wf-btn wf-btn-primary"
                style={{ padding: '4px 10px', fontSize: 11 }}
                onClick={() => alert('Đang chuẩn bị tải xuống video MP4!')}
              >
                <Download size={12} /> Tải MP4
              </button>
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
