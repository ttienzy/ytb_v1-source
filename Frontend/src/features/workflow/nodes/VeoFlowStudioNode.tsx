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
  Scissors,
  ArrowRight,
  Image as ImageIcon,
  Package,
  User,
  AlertCircle,
  Eye,
} from 'lucide-react'
import type { VeoFlowStudioNodeData } from '../types'
import { DEFAULT_CLIP_DURATION_SECONDS } from '../services/buildScenePlan'

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
    title: 'Clip 1',
    prompt: '',
    durationSec: data.videoConfig?.duration || DEFAULT_CLIP_DURATION_SECONDS,
    aspectRatio: '9:16' as const,
  }
  const prevScene = safeTab > 0 ? scenes[safeTab - 1] : null

  const isRendering = currentScene.isRendering || (data.isRendering && data.activeSceneIndex === safeTab)
  const renderProgress = currentScene.renderProgress ?? (data.renderProgress ?? 0)

  const isExporting = data.isExporting ?? false
  const exportProgress = data.exportProgress ?? 0

  const handleTabClick = (idx: number) => {
    setActiveTab(idx)
    data.onSelectScene?.(idx)
  }

  const totalDuration = scenes.reduce(
    (sum, s) => sum + (s.durationSec || data.videoConfig?.duration || DEFAULT_CLIP_DURATION_SECONDS),
    0
  )
  const clipDurations = [...new Set(scenes.map((scene) => scene.durationSec).filter(Boolean))]
  const durationLabel = clipDurations.length === 1 ? `${clipDurations[0]}s/clip` : 'thời lượng linh hoạt'
  const isStartNode = data.isStartNode ?? false
  const isOrphan = data.isOrphan ?? false

  const validProductImages = (data.refImages?.productUrls || []).filter((u): u is string => Boolean(u && u.trim()))
  const modelImage = data.refImages?.modelUrl
  const sceneImage = data.refImages?.sceneUrl

  const primaryRefImage = validProductImages[0] || modelImage || sceneImage || null
  const primaryRefLabel = validProductImages[0] ? '📦 Sản phẩm' : modelImage ? '👤 Người mẫu' : sceneImage ? '🌄 Bối cảnh' : null
  const totalRefImagesCount = validProductImages.length + (modelImage ? 1 : 0) + (sceneImage ? 1 : 0)
  const hasAnyRefImages = totalRefImagesCount > 0

  const allClipsCompleted = scenes.length > 0 && scenes.every((s) => Boolean(s.videoUrl || s.outputFilePath))
  const completedCount = scenes.filter((s) => Boolean(s.videoUrl || s.outputFilePath)).length

  return (
    <div
      className={`wf-node-card wf-veo-studio-card ${selected ? 'selected' : ''} ${isStartNode ? 'is-start-node' : ''} ${
        isOrphan ? 'is-orphan' : ''
      }`}
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

      {/* Target Handle: Assets from Product and Character Nodes */}
      <Handle
        type="target"
        position={Position.Left}
        id="from-assets"
        style={{ top: 78 }}
        className="wf-handle wf-handle-target"
        title="Nhận ảnh sản phẩm & nhân vật (Assets)"
      />

      {/* Target Handle: Scripts from ChatGPT Node */}
      <Handle
        type="target"
        position={Position.Left}
        id="from-gpt"
        style={{ top: 155 }}
        className="wf-handle wf-handle-target"
        title="Nhận kịch bản từ ChatGPT (Scripts)"
      />

      {/* ─── 1. HEADER SECTION ──────────────────────────────────────────────── */}
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
            <Film size={16} />
          </div>
          <div>
            <div className="wf-node-title" style={{ color: '#881337', fontSize: 13.5 }}>
              {data.title || 'Veo AI • Đạo Diễn Video'}
            </div>
            <div style={{ fontSize: 10, color: '#e11d48', fontWeight: 600 }}>
              Chuỗi kịch bản & phân cảnh liên hoàn (Multi-Clip Chaining)
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
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

          {/* Project setup button */}
          <button
            type="button"
            className="wf-btn"
            onClick={() => data.onOpenVeoSetup?.()}
            style={{
              padding: '3px 9px',
              fontSize: 10.5,
              fontWeight: 600,
              color: data.activeProject ? '#065f46' : '#b45309',
              background: data.activeProject ? '#ecfdf5' : '#fffbeb',
              border: data.activeProject ? '1px solid #a7f3d0' : '1px solid #fde68a',
            }}
            title="Mở cấu hình Dự án Google Flow"
          >
            <Sliders size={11} />
            {data.activeProject ? data.activeProject.name : 'Chọn Dự Án'}
          </button>

          {/* Video Library Modal trigger */}
          <button
            type="button"
            className="wf-btn"
            onClick={() => data.onOpenLibrary?.()}
            style={{ padding: '3px 8px', fontSize: 10.5, fontWeight: 600, color: '#4338ca' }}
            title="Thư viện video đã xuất"
          >
            <Layers size={11} />
            Thư viện ({data.exportedCount ?? 0})
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
            {scenes.length} Clip • {durationLabel}
          </span>

          <button
            type="button"
            className="wf-node-del-btn"
            onClick={(e) => {
              e.stopPropagation()
              data.onDelete?.()
            }}
            title="Xóa node"
          >
            <Trash2 size={13} />
          </button>
        </div>
      </div>

      {/* ─── 2. INPUT ASSET RIBBON ────────────────────────────────────────── */}
      <div className="wf-asset-ribbon">
        <div className="wf-asset-ribbon-left">
          <span style={{ fontWeight: 700, color: '#475569', display: 'flex', alignItems: 'center', gap: 4 }}>
            <Package size={12} color="#6366f1" />
            Nguyên liệu đầu vào:
          </span>

          {hasAnyRefImages ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              {validProductImages.map((imgUrl, i) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img
                    src={imgUrl}
                    alt={`Sản phẩm ${i + 1}`}
                    className="wf-asset-mini-thumb"
                    title={`Ảnh sản phẩm #${i + 1}`}
                  />
                  <span
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      background: '#1e293b',
                      color: '#ffffff',
                      fontSize: 8,
                      fontWeight: 700,
                      padding: '1px 3px',
                      borderRadius: 3,
                    }}
                  >
                    SP{i + 1}
                  </span>
                </div>
              ))}

              {modelImage && (
                <div style={{ position: 'relative' }}>
                  <img
                    src={modelImage}
                    alt="Nhân vật"
                    className="wf-asset-mini-thumb"
                    title="Người mẫu / MC / KOL"
                  />
                  <span
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      background: '#7c3aed',
                      color: '#ffffff',
                      fontSize: 8,
                      fontWeight: 700,
                      padding: '1px 3px',
                      borderRadius: 3,
                    }}
                  >
                    Model
                  </span>
                </div>
              )}

              {sceneImage && (
                <div style={{ position: 'relative' }}>
                  <img
                    src={sceneImage}
                    alt="Bối cảnh"
                    className="wf-asset-mini-thumb"
                    title="Bối cảnh / Không gian quay"
                  />
                  <span
                    style={{
                      position: 'absolute',
                      bottom: -2,
                      right: -2,
                      background: '#059669',
                      color: '#ffffff',
                      fontSize: 8,
                      fontWeight: 700,
                      padding: '1px 3px',
                      borderRadius: 3,
                    }}
                  >
                    Cảnh
                  </span>
                </div>
              )}

              <span style={{ fontSize: 9.5, color: '#059669', fontWeight: 600, marginLeft: 2 }}>
                ({totalRefImagesCount} ảnh tham chiếu)
              </span>
            </div>
          ) : (
            <span style={{ color: '#94a3b8', fontStyle: 'italic', fontSize: 10 }}>
              (Chưa nối ảnh tham chiếu — tạo thuần từ văn bản)
            </span>
          )}
        </div>

        {/* ChatGPT Angle & Sync Status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ color: '#6b21a8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={12} color="#9333ea" />
            {data.isSourceScriptStale
              ? 'Kịch bản cũ (cần sinh lại)'
              : data.selectedGptScriptAngle || 'Kịch bản ChatGPT'}
          </span>
          {data.availableGptScripts && data.availableGptScripts.length > 0 && (
            <button
              type="button"
              onClick={() => data.onApplyAllGptScripts?.()}
              disabled={data.isSourceScriptStale}
              style={{
                fontSize: 10,
                fontWeight: 700,
                padding: '2px 7px',
                borderRadius: 4,
                border: '1px solid #c084fc',
                background: '#f3e8ff',
                color: '#6b21a8',
                cursor: data.isSourceScriptStale ? 'not-allowed' : 'pointer',
                opacity: data.isSourceScriptStale ? 0.55 : 1,
              }}
              title="Đồng bộ lại toàn bộ kịch bản sang các clip"
            >
              Đồng bộ lại ({scenes.length})
            </button>
          )}
        </div>
      </div>

      {/* ─── 3. STORYBOARD SEQUENCE TRACK (TRỤC PHÂN CẢNH LIÊN HOÀN) ────────── */}
      <div className="wf-storyboard-container">
        <div className="wf-storyboard-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#1e293b' }}>
              🎬 TRỤC PHÂN CẢNH LIÊN HOÀN
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#059669',
                background: '#ecfdf5',
                padding: '1px 6px',
                borderRadius: 4,
                border: '1px solid #a7f3d0',
              }}
            >
              {completedCount}/{scenes.length} Hoàn thành
            </span>
            <span style={{ fontSize: 10, color: '#64748b' }}>
              (Click từng clip để đạo diễn & xem trước)
            </span>
          </div>

          {/* Sequential Chain Run Button */}
          {scenes.length > 1 && data.onRenderAllScenes && (
            <button
              type="button"
              className="wf-btn"
              onClick={() => {
                if (!data.activeProject) {
                  data.onOpenVeoSetup?.()
                } else {
                  data.onRenderAllScenes?.()
                }
              }}
              disabled={isRendering}
              style={{
                padding: '3px 9px',
                fontSize: 10.5,
                fontWeight: 700,
                background: '#fdf2f8',
                border: '1px solid #fbcfe8',
                color: '#db2777',
                cursor: isRendering ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
              title="Tự động render Clip 1 -> cắt End Frame -> render Clip 2 nối tiếp -> tiếp tục đến hết"
            >
              <Sparkles size={11} color="#db2777" />
              ⚡ Render Chuỗi Liên Hoàn ({scenes.length})
            </button>
          )}
        </div>

        {/* Horizontal Storyboard Track */}
        <div className="wf-storyboard-track">
          {scenes.map((scene, idx) => {
            const isSelected = safeTab === idx
            const isClipRendering = scene.isRendering || (isRendering && safeTab === idx)
            const isDone = Boolean(scene.videoUrl || scene.outputFilePath)
            const isChained = idx > 0 && scene.chainFromPrevious !== false
            const prevClipReady = idx > 0 ? Boolean(scenes[idx - 1]?.videoUrl || scenes[idx - 1]?.outputFilePath) : true

            return (
              <React.Fragment key={idx}>
                {/* Individual Clip Storyboard Card */}
                <div
                  className={`wf-clip-card ${isSelected ? 'active' : ''}`}
                  onClick={() => handleTabClick(idx)}
                >
                  {/* Card Header */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: isSelected ? '#be123c' : '#334155' }}>
                      #{idx + 1} ({scene.durationSec || 10}s)
                    </span>
                    {isDone ? (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          color: '#059669',
                          background: '#ecfdf5',
                          padding: '1px 5px',
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <CheckCircle2 size={10} /> Đã xong
                      </span>
                    ) : isClipRendering ? (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 700,
                          color: '#be123c',
                          background: '#fff1f2',
                          padding: '1px 5px',
                          borderRadius: 4,
                          display: 'flex',
                          alignItems: 'center',
                          gap: 3,
                        }}
                      >
                        <Sparkles size={10} className="animate-spin" /> {scene.renderProgress ?? 20}%
                      </span>
                    ) : (
                      <span
                        style={{
                          fontSize: 9.5,
                          fontWeight: 600,
                          color: '#64748b',
                          background: '#f1f5f9',
                          padding: '1px 5px',
                          borderRadius: 4,
                        }}
                      >
                        Chưa tạo
                      </span>
                    )}
                  </div>

                  {/* Visual Slot: Video thumbnail OR Input Asset preview */}
                  <div
                    style={{
                      height: 74,
                      borderRadius: 6,
                      background: '#0f172a',
                      position: 'relative',
                      overflow: 'hidden',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {isDone ? (
                      <>
                        {scene.thumbnailUrl ? (
                          <img
                            src={scene.thumbnailUrl}
                            alt={`Clip ${idx + 1}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        ) : (
                          <video
                            src={scene.videoUrl || undefined}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                        )}
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'rgba(0,0,0,0.3)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                          }}
                        >
                          <div
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: '50%',
                              background: 'rgba(255,255,255,0.9)',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              boxShadow: '0 2px 5px rgba(0,0,0,0.3)',
                            }}
                          >
                            <Play size={12} fill="#0f172a" style={{ marginLeft: 2 }} />
                          </div>
                        </div>
                      </>
                    ) : isClipRendering ? (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          justifyContent: 'center',
                          padding: '0 10px',
                          gap: 5,
                        }}
                      >
                        <Sparkles size={16} color="#f43f5e" className="animate-spin" />
                        <div style={{ fontSize: 9.5, color: '#f8fafc', fontWeight: 600 }}>
                          {scene.renderProgress ?? 20}%
                        </div>
                        <div
                          style={{
                            width: '100%',
                            height: 4,
                            background: 'rgba(255,255,255,0.2)',
                            borderRadius: 2,
                            overflow: 'hidden',
                          }}
                        >
                          <div
                            style={{
                              height: '100%',
                              width: `${scene.renderProgress ?? 20}%`,
                              background: 'linear-gradient(90deg, #f43f5e, #8b5cf6)',
                              transition: 'width 0.3s ease',
                            }}
                          />
                        </div>
                      </div>
                    ) : idx === 0 ? (
                      /* Clip 1: Show primary reference image */
                      primaryRefImage ? (
                        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                          <img
                            src={primaryRefImage}
                            alt="Ảnh tham chiếu"
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                          <span
                            style={{
                              position: 'absolute',
                              bottom: 4,
                              left: 4,
                              fontSize: 8.5,
                              fontWeight: 700,
                              background: 'rgba(15, 23, 42, 0.8)',
                              color: '#f8fafc',
                              padding: '1px 5px',
                              borderRadius: 3,
                            }}
                          >
                            {primaryRefLabel}
                          </span>
                        </div>
                      ) : (
                        <div style={{ color: '#64748b', fontSize: 10, textAlign: 'center', padding: 4 }}>
                          <Film size={20} color="#475569" style={{ margin: '0 auto 2px auto' }} />
                          <span>Từ Text Prompt</span>
                        </div>
                      )
                    ) : isChained ? (
                      /* Clip 2+: Show Start Frame inherited from previous clip */
                      scene.startFramePreviewUrl ? (
                        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                          <img
                            src={scene.startFramePreviewUrl}
                            alt={`Start frame clip ${idx + 1}`}
                            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                          />
                          <span
                            style={{
                              position: 'absolute',
                              bottom: 4,
                              left: 4,
                              fontSize: 8.5,
                              fontWeight: 700,
                              background: 'rgba(124, 58, 237, 0.85)',
                              color: '#ffffff',
                              padding: '1px 5px',
                              borderRadius: 3,
                            }}
                          >
                            🔗 Start Frame
                          </span>
                        </div>
                      ) : (
                        <div style={{ color: '#94a3b8', fontSize: 9.5, textAlign: 'center', padding: 4 }}>
                          <Scissors size={16} color="#64748b" style={{ margin: '0 auto 2px auto' }} />
                          <span>Chờ End Frame Clip #{idx}</span>
                        </div>
                      )
                    ) : (
                      <div style={{ color: '#64748b', fontSize: 10, textAlign: 'center' }}>
                        <span>Độc lập (Không nối)</span>
                      </div>
                    )}
                  </div>

                  {/* Prompt Preview (2 lines) */}
                  <div
                    style={{
                      fontSize: 9.5,
                      color: '#475569',
                      lineHeight: 1.3,
                      height: 25,
                      overflow: 'hidden',
                      display: '-webkit-box',
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: 'vertical',
                    }}
                    title={scene.prompt}
                  >
                    {scene.prompt || '(Chưa có nội dung prompt)'}
                  </div>

                  {/* Card Quick Action */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 }}>
                    <span style={{ fontSize: 9, color: '#94a3b8' }}>{scene.aspectRatio || '9:16'}</span>
                    {isDone ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          data.onOpenPreviewModal?.(
                            scene.videoUrl!,
                            `Clip #${idx + 1}: ${scene.title || 'Video'}`,
                            scene.prompt
                          )
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#2563eb',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          gap: 2,
                          padding: 0,
                        }}
                      >
                        <Eye size={10} /> Xem to
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          handleTabClick(idx)
                          data.onRenderScene?.(idx)
                        }}
                        disabled={isClipRendering || (isChained && !prevClipReady)}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: isChained && !prevClipReady ? '#94a3b8' : '#be123c',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: isChained && !prevClipReady ? 'not-allowed' : 'pointer',
                          padding: 0,
                        }}
                      >
                        {isChained && !prevClipReady ? 'Chờ clip trước' : '▶️ Tạo'}
                      </button>
                    )}
                  </div>
                </div>

                {/* Handover Arrow Connector between Clips */}
                {idx < scenes.length - 1 && (
                  <div className="wf-storyboard-connector" title="Frame cuối của clip này sẽ nối sang làm Start Frame của clip tiếp theo">
                    <span style={{ color: '#7c3aed', fontSize: 11 }}>🔗</span>
                    <span style={{ fontSize: 8, color: '#7c3aed' }}>End Frame</span>
                    <ArrowRight size={14} color="#a855f7" />
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>

      {/* ─── 4. INSPECTOR & DIRECTOR MONITOR (CHI TIẾT CLIP ĐANG CHỌN) ──────── */}
      <div style={{ background: '#ffffff' }}>
        <div
          style={{
            padding: '8px 14px',
            background: '#fafafa',
            borderBottom: '1px solid #f1f5f9',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ fontSize: 11.5, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ color: '#e11d48' }}>●</span>
            <span>ĐANG ĐẠO DIỄN: CLIP #{safeTab + 1} — {currentScene.title || 'Phân cảnh'}</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span style={{ fontSize: 10, color: '#64748b' }}>Định dạng:</span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 700,
                background: '#f1f5f9',
                padding: '2px 6px',
                borderRadius: 4,
                color: '#334155',
              }}
            >
              {currentScene.aspectRatio || '9:16'}
            </span>
          </div>
        </div>

        <div className="wf-inspector-grid">
          {/* Left Column: Video Player / Monitor View */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div
              style={{
                width: '100%',
                height: 220,
                background: '#090d16',
                borderRadius: 10,
                overflow: 'hidden',
                position: 'relative',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                boxShadow: 'inset 0 0 10px rgba(0,0,0,0.5)',
                border: '1px solid #1e293b',
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
                        `Clip #${safeTab + 1}: ${currentScene.title || 'Video'}`,
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
                      background: 'rgba(15, 23, 42, 0.8)',
                      color: '#f8fafc',
                      fontSize: 10,
                      fontWeight: 600,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                    title="Mở xem video toàn cảnh chất lượng cao"
                  >
                    <Maximize2 size={11} />
                    Toàn cảnh
                  </button>
                </>
              ) : isRendering ? (
                <div
                  style={{
                    position: 'absolute',
                    inset: 0,
                    background: 'rgba(15, 23, 42, 0.95)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: 8,
                    padding: '0 20px',
                  }}
                >
                  <Sparkles size={24} color="#f43f5e" className="animate-spin" />
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#f8fafc' }}>
                    Đang tạo Clip #{safeTab + 1}... {renderProgress}%
                  </div>
                  <div
                    style={{
                      width: '85%',
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
              ) : currentScene.startFramePreviewUrl ? (
                <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                  <img
                    src={currentScene.startFramePreviewUrl}
                    alt="Start Frame"
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      background: 'rgba(124, 58, 237, 0.85)',
                      color: '#ffffff',
                      fontSize: 9.5,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                    }}
                  >
                    🔗 Start Frame (từ Clip #{safeTab})
                  </div>
                </div>
              ) : safeTab === 0 && primaryRefImage ? (
                <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                  <img
                    src={primaryRefImage}
                    alt={primaryRefLabel || 'Ảnh tham chiếu'}
                    style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                  />
                  <div
                    style={{
                      position: 'absolute',
                      top: 8,
                      left: 8,
                      background: 'rgba(15, 23, 42, 0.85)',
                      color: '#ffffff',
                      fontSize: 9.5,
                      fontWeight: 700,
                      padding: '2px 7px',
                      borderRadius: 4,
                      backdropFilter: 'blur(4px)',
                      boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                    }}
                  >
                    {primaryRefLabel || 'Ảnh tham chiếu'}
                  </div>
                </div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#64748b' }}>
                  <Film size={30} color="#475569" />
                  <span style={{ fontSize: 11, color: '#94a3b8' }}>Chưa tạo Clip #{safeTab + 1}</span>
                </div>
              )}
            </div>

            {/* Sub badges below player */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 10, color: '#64748b' }}>
              <span>Tỉ lệ: <b>{currentScene.aspectRatio || '9:16'}</b></span>
              <span>Chuyển động: <b>{currentScene.cameraMotion || 'Cinematic Motion'}</b></span>
            </div>
          </div>

          {/* Right Column: Continuity Strip, Prompt Editor & Action Buttons */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {/* Continuity Box */}
            {safeTab === 0 ? (
              <div
                style={{
                  padding: '7px 10px',
                  background: '#f8fafc',
                  border: '1px solid #e2e8f0',
                  borderRadius: 6,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10.5, fontWeight: 700, color: '#0f172a' }}>
                    <span>🎬 Clip Khởi Đầu (#1)</span>
                    <span style={{ fontSize: 9.5, fontWeight: 500, color: '#64748b' }}>
                      (Render từ Prompt & Ảnh tham chiếu, End Frame ➔ Start Clip #2)
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      color: hasAnyRefImages ? '#059669' : '#64748b',
                      background: hasAnyRefImages ? '#ecfdf5' : '#f1f5f9',
                      padding: '2px 6px',
                      borderRadius: 4,
                      border: hasAnyRefImages ? '1px solid #a7f3d0' : '1px solid #e2e8f0',
                    }}
                  >
                    {hasAnyRefImages ? `✓ Nạp ${totalRefImagesCount} ảnh` : 'Chỉ Text Prompt'}
                  </span>
                </div>

                {/* Compact mini thumbnails of all input assets */}
                {hasAnyRefImages && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', paddingTop: 2 }}>
                    <span style={{ fontSize: 9.5, color: '#64748b', fontWeight: 600 }}>Ảnh nạp vào:</span>
                    {validProductImages.map((img, idx) => (
                      <div
                        key={`sp-${idx}`}
                        title={`Sản phẩm #${idx + 1}`}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 5px',
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: 4,
                          fontSize: 9,
                          color: '#334155',
                        }}
                      >
                        <img src={img} alt={`SP ${idx + 1}`} style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover' }} />
                        <span>SP #{idx + 1}</span>
                      </div>
                    ))}
                    {modelImage && (
                      <div
                        title="Người mẫu / MC"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 5px',
                          background: '#fff7ed',
                          border: '1px solid #fed7aa',
                          borderRadius: 4,
                          fontSize: 9,
                          color: '#9a3412',
                          fontWeight: 600,
                        }}
                      >
                        <img src={modelImage} alt="Model" style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover' }} />
                        <span>👤 Người mẫu</span>
                      </div>
                    )}
                    {sceneImage && (
                      <div
                        title="Bối cảnh"
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 4,
                          padding: '2px 5px',
                          background: '#f0fdf4',
                          border: '1px solid #bbf7d0',
                          borderRadius: 4,
                          fontSize: 9,
                          color: '#166534',
                          fontWeight: 600,
                        }}
                      >
                        <img src={sceneImage} alt="Scene" style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover' }} />
                        <span>🌄 Bối cảnh</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  padding: '7px 10px',
                  background: currentScene.chainFromPrevious !== false ? '#f5f3ff' : '#f8fafc',
                  border: currentScene.chainFromPrevious !== false ? '1px solid #ddd6fe' : '1px solid #e2e8f0',
                  borderRadius: 6,
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      fontSize: 11,
                      fontWeight: 700,
                      color: currentScene.chainFromPrevious !== false ? '#6b21a8' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={currentScene.chainFromPrevious !== false}
                      onChange={(e) => data.onToggleChainFrames?.(safeTab, e.target.checked)}
                      style={{ width: 14, height: 14, accentColor: '#7c3aed', cursor: 'pointer' }}
                    />
                    <span>🔗 Nối tiếp từ End Frame Clip #{safeTab}</span>
                  </label>

                  {currentScene.chainFromPrevious !== false && prevScene?.videoUrl && (
                    <button
                      type="button"
                      onClick={() => data.onExtractLastFrame?.(safeTab - 1)}
                      disabled={currentScene.isExtractingFrame}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #c084fc',
                        borderRadius: 4,
                        padding: '2px 7px',
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#7e22ce',
                        cursor: currentScene.isExtractingFrame ? 'wait' : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        gap: 4,
                      }}
                      title={`Cắt lại frame cuối cùng của Clip #${safeTab}`}
                    >
                      <Scissors size={11} />
                      {currentScene.isExtractingFrame ? 'Đang cắt...' : 'Cắt lại Frame'}
                    </button>
                  )}
                </div>

                {currentScene.chainFromPrevious !== false && (
                  <div style={{ marginTop: 5, fontSize: 10, color: currentScene.startFramePreviewUrl ? '#059669' : '#b45309' }}>
                    {currentScene.startFramePreviewUrl
                      ? '✅ Start Frame đã sẵn sàng từ Clip trước'
                      : prevScene?.videoUrl
                      ? '⚠️ Chưa cắt frame cuối từ Clip trước. Bấm "Cắt lại Frame" hoặc hệ thống sẽ tự cắt khi bấm Tạo.'
                      : `⏳ Clip #${safeTab} chưa tạo. Cần render Clip #${safeTab} trước để lấy End Frame.`}
                  </div>
                )}
              </div>
            )}

            {/* Prompt Editor */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <label style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>
                  📝 Prompt kịch bản Clip #{safeTab + 1}:
                </label>
                <span style={{ fontSize: 10, color: '#64748b' }}>
                  {(currentScene.prompt || '').trim().split(/\s+/).filter(Boolean).length} từ
                </span>
              </div>
              <textarea
                value={currentScene.prompt || ''}
                onChange={(e) => data.onUpdateScenePrompt?.(safeTab, e.target.value)}
                placeholder="Mô tả chuyển động máy quay, nhân vật, ánh sáng bối cảnh..."
                rows={3}
                style={{
                  width: '100%',
                  fontSize: 11,
                  lineHeight: 1.4,
                  padding: '7px 9px',
                  borderRadius: 6,
                  border: '1px solid #cbd5e1',
                  resize: 'vertical',
                  fontFamily: 'inherit',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            {/* Duration Selector & Render Button */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 10.5, color: '#64748b', fontWeight: 600 }}>Thời lượng:</span>
                {(data.durationOptions && data.durationOptions.length > 0 ? data.durationOptions : [4, 6, 8, 10]).map(
                  (sec) => (
                    <button
                      key={sec}
                      type="button"
                      onClick={() => data.onUpdateSceneDuration?.(safeTab, sec)}
                      style={{
                        padding: '2px 7px',
                        fontSize: 10.5,
                        fontWeight: 700,
                        borderRadius: 4,
                        border: currentScene.durationSec === sec ? '1px solid #f43f5e' : '1px solid #e2e8f0',
                        background: currentScene.durationSec === sec ? '#fff1f2' : '#ffffff',
                        color: currentScene.durationSec === sec ? '#e11d48' : '#64748b',
                        cursor: 'pointer',
                      }}
                    >
                      {sec}s
                    </button>
                  )
                )}
              </div>

              {/* Single Clip Render Button */}
              {(() => {
                const isChained = safeTab > 0 && currentScene.chainFromPrevious !== false
                const prevNotReady = isChained && !prevScene?.videoUrl
                return (
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
                    disabled={isRendering || prevNotReady}
                    style={{
                      padding: '5px 12px',
                      fontSize: 11,
                      opacity: prevNotReady ? 0.6 : 1,
                      cursor: prevNotReady ? 'not-allowed' : 'pointer',
                    }}
                    title={
                      !data.activeProject
                        ? 'Bấm để cấu hình và chọn Project trước'
                        : prevNotReady
                        ? `Cần tạo Clip #${safeTab} trước để có End Frame nối tiếp`
                        : `Tạo clip #${safeTab + 1}`
                    }
                  >
                    <Video size={13} />
                    {isRendering
                      ? 'Đang tạo...'
                      : !data.activeProject
                      ? 'Cấu hình Project'
                      : prevNotReady
                      ? `Chờ Clip #${safeTab}`
                      : isChained
                      ? `Tạo Clip #${safeTab + 1} (Nối tiếp)`
                      : `Tạo Clip #${safeTab + 1}`}
                  </button>
                )
              })()}
            </div>
          </div>
        </div>

        {/* ─── 5. MASTER BOTTOM TIMELINE & STITCH EXPORT BAR ────────────────── */}
        <div
          style={{
            borderTop: '1px solid #f1f5f9',
            padding: '10px 14px',
            background: '#f8fafc',
            borderBottomLeftRadius: 16,
            borderBottomRightRadius: 16,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Layers size={14} color="#6366f1" />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>
              Ghép {scenes.length} clip ({totalDuration}s)
            </span>
            <span style={{ fontSize: 10, color: '#94a3b8' }}>• Định dạng MP4 1080p</span>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {data.finalVideoUrl ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  type="button"
                  className="wf-btn"
                  onClick={() =>
                    data.onOpenPreviewModal?.(data.finalVideoUrl!, 'Video Hoàn Chỉnh Ghép Nối', 'Toàn bộ quy trình')
                  }
                  style={{ padding: '4px 10px', fontSize: 10.5, fontWeight: 600, color: '#059669', background: '#ecfdf5', border: '1px solid #a7f3d0' }}
                >
                  <Eye size={12} /> Xem Video Hoàn Chỉnh
                </button>
                <a
                  href={data.finalVideoUrl}
                  download="workflow_final_video.mp4"
                  className="wf-btn wf-btn-primary"
                  style={{ padding: '4px 10px', fontSize: 10.5, textDecoration: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                >
                  <Download size={12} /> Tải MP4
                </a>
              </div>
            ) : (
              <button
                type="button"
                className="wf-btn wf-btn-primary"
                onClick={() => data.onExportVideo?.()}
                disabled={isExporting || !allClipsCompleted}
                style={{
                  padding: '5px 14px',
                  fontSize: 11,
                  opacity: !allClipsCompleted ? 0.6 : 1,
                  cursor: !allClipsCompleted ? 'not-allowed' : 'pointer',
                }}
                title={!allClipsCompleted ? 'Cần render đủ tất cả clip trước khi ghép' : 'Ghép toàn bộ clip thành 1 file MP4'}
              >
                <Download size={13} />
                {isExporting ? `Đang ghép... ${exportProgress}%` : 'Ghép Video Hoàn Chỉnh (MP4)'}
              </button>
            )}
          </div>
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
