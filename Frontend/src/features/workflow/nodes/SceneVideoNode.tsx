import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { Clapperboard, Play, Video, Sparkles, Clock, Film, Image as ImageIcon, Trash2 } from 'lucide-react'
import type { SceneVideoNodeData } from '../types'

interface SceneVideoNodeProps {
  data: SceneVideoNodeData
  selected?: boolean
}

export function SceneVideoNode({ data, selected }: SceneVideoNodeProps) {
  const isRendering = data.isRendering ?? false
  const progress = data.renderProgress ?? 0

  return (
    <div className={`wf-node-card ${selected ? 'selected' : ''}`} style={{ width: 350 }}>
      {/* Target handle from GPT Script or Assets */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="wf-handle wf-handle-target"
      />

      {/* Header */}
      <div className="wf-node-header">
        <div className="wf-node-title-group">
          <div className="wf-node-icon wf-icon-rose">
            <Film size={15} />
          </div>
          <div>
            <div className="wf-node-title">
              Cảnh #{data.sceneNumber}: {data.title || 'Phân cảnh'}
            </div>
            <div style={{ fontSize: 10, color: '#fb7185', fontWeight: 600 }}>
              Google Veo 3.0 • Flow Engine
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="wf-node-badge wf-badge-veo">
            {data.durationSec || 5}s • {data.aspectRatio || '9:16'}
          </span>
          <button
            type="button"
            className="wf-node-del-btn"
            onClick={(e) => {
              e.stopPropagation()
              data.onDelete?.()
            }}
            title="Xóa phân cảnh này"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="wf-node-body">
        {/* Video Preview / Render Area */}
        <div className="wf-scene-preview-container">
          {data.videoUrl ? (
            <video
              src={data.videoUrl}
              controls
              className="wf-scene-preview-video"
              poster={data.thumbnailUrl || undefined}
            />
          ) : isRendering ? (
            <div className="wf-render-overlay">
              <Sparkles size={24} color="#ec4899" className="animate-spin" />
              <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc' }}>
                Đang render Veo Clip... {progress}%
              </div>
              <div className="wf-render-progress-bar">
                <div className="wf-render-progress-fill" style={{ width: `${progress}%` }} />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#475569' }}>
              <Clapperboard size={32} />
              <span style={{ fontSize: 11, color: '#64748b' }}>Chưa xuất clip</span>
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
            <span className="wf-badge-duration">{data.aspectRatio}</span>
            <span className="wf-badge-duration">{data.cameraMotion || 'Cinematic Pan'}</span>
          </div>
        </div>

        {/* Reference images slots preview */}
        <div style={{ marginBottom: 8 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
            <ImageIcon size={11} />
            Ảnh tham chiếu ({[data.refImages?.productUrl, data.refImages?.modelUrl, data.refImages?.sceneUrl].filter(Boolean).length}/3):
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            {/* Slot 1 */}
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 6,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Ảnh sản phẩm"
            >
              {data.refImages?.productUrl ? (
                <img src={data.refImages.productUrl} alt="Prod" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 9, color: '#94a3b8' }}>SP</span>
              )}
            </div>

            {/* Slot 2 */}
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 6,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Ảnh người mẫu"
            >
              {data.refImages?.modelUrl ? (
                <img src={data.refImages.modelUrl} alt="Model" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 9, color: '#94a3b8' }}>Mẫu</span>
              )}
            </div>

            {/* Slot 3 */}
            <div
              style={{
                width: 38,
                height: 38,
                borderRadius: 6,
                background: '#f8fafc',
                border: '1px solid #e2e8f0',
                overflow: 'hidden',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
              title="Ảnh bối cảnh"
            >
              {data.refImages?.sceneUrl ? (
                <img src={data.refImages.sceneUrl} alt="Scene" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
              ) : (
                <span style={{ fontSize: 9, color: '#94a3b8' }}>Cảnh</span>
              )}
            </div>
          </div>
        </div>

        {/* Scene Prompt */}
        <div style={{ marginBottom: 10 }}>
          <label style={{ fontSize: 10, fontWeight: 700, color: '#64748b', display: 'block', marginBottom: 2 }}>
            Veo Prompt phân cảnh:
          </label>
          <textarea
            className="wf-input-textarea"
            rows={2}
            value={data.prompt}
            onChange={(e) => data.onPromptChange?.(e.target.value)}
            placeholder="Mô tả chuyển động máy quay và hành động của nhân vật..."
          />
        </div>

        {/* Bottom action row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 4 }}>
            <button
              type="button"
              onClick={() => data.onDurationChange?.(4)}
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                border: data.durationSec === 4 ? '1px solid #c084fc' : '1px solid #e2e8f0',
                background: data.durationSec === 4 ? '#f5f3ff' : '#ffffff',
                color: data.durationSec === 4 ? '#7c3aed' : '#64748b',
                cursor: 'pointer',
              }}
            >
              4s
            </button>
            <button
              type="button"
              onClick={() => data.onDurationChange?.(8)}
              style={{
                padding: '3px 8px',
                borderRadius: 4,
                fontSize: 10,
                fontWeight: 700,
                border: data.durationSec === 8 ? '1px solid #c084fc' : '1px solid #e2e8f0',
                background: data.durationSec === 8 ? '#f5f3ff' : '#ffffff',
                color: data.durationSec === 8 ? '#7c3aed' : '#64748b',
                cursor: 'pointer',
              }}
            >
              8s
            </button>
          </div>

          <button
            type="button"
            className="wf-btn wf-btn-accent"
            onClick={() => data.onRender?.()}
            disabled={isRendering}
          >
            <Video size={13} />
            {isRendering ? 'Đang tạo...' : 'Tạo Veo Clip'}
          </button>
        </div>
      </div>

      {/* Source handle to timeline node */}
      <Handle
        type="source"
        position={Position.Right}
        id="to-export"
        className="wf-handle wf-handle-source"
      />
    </div>
  )
}
