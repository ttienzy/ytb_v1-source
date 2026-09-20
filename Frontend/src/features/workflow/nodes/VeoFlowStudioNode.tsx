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
  Mic,
  Music,
  Loader2,
  FolderOpen,
  Star,
  Zap,
  Link2,
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
  const primaryRefLabel = validProductImages[0] ? 'Sản phẩm' : modelImage ? 'Người mẫu' : sceneImage ? 'Bối cảnh' : null
  const totalRefImagesCount = validProductImages.length + (modelImage ? 1 : 0) + (sceneImage ? 1 : 0)
  const hasAnyRefImages = totalRefImagesCount > 0

  const allClipsCompleted = scenes.length > 0 && scenes.every((s) => Boolean(s.videoUrl || s.outputFilePath))
  const completedScenes = scenes.filter((s) => Boolean(s.videoUrl || s.outputFilePath))
  const completedCount = completedScenes.length
  const completedDuration = completedScenes.reduce(
    (sum, s) => sum + (s.durationSec || data.videoConfig?.duration || DEFAULT_CLIP_DURATION_SECONDS),
    0
  )
  const canExport = completedCount >= 2
  const firstPendingIdx = scenes.findIndex((s) => !s.videoUrl && !s.outputFilePath)
  const chainButtonLabel = allClipsCompleted
    ? `Render Lại Toàn Bộ (${scenes.length})`
    : completedCount > 0
    ? `Tiếp tục Chuỗi (Clip #${firstPendingIdx + 1} → #${scenes.length})`
    : `Render Chuỗi Liên Hoàn (${scenes.length})`
  const chainButtonTitle = allClipsCompleted
    ? 'Tất cả clip đã hoàn thành. Bấm để render lại toàn bộ từ đầu.'
    : completedCount > 0
    ? `Đã xong ${completedCount}/${scenes.length} clip. Bấm để tự động tiếp tục render từ Clip #${firstPendingIdx + 1} đến hết.`
    : 'Tự động render Clip 1 -> cắt End Frame -> render Clip 2 nối tiếp -> tiếp tục đến hết.'

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
            <span>NODE CHÍNH (ĐIỂM KHỞI ĐẦU)</span>
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
      <div className="wf-node-header">
        <div className="wf-node-title-group">
          <div className="wf-node-icon">
            <Film size={16} />
          </div>
          <div>
            <div className="wf-node-title" style={{ color: '#0f172a', fontSize: 13.5 }}>
              {data.title || 'Veo AI • Đạo Diễn Video'}
            </div>
            <div style={{ fontSize: 10, color: '#64748b', fontWeight: 500 }}>
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
            <Star size={13} fill={isStartNode ? '#f59e0b' : 'none'} color={isStartNode ? '#f59e0b' : '#94a3b8'} />
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
              color: data.activeProject ? '#0f172a' : '#64748b',
              background: '#ffffff',
              border: '1px solid #cbd5e1',
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
            style={{ padding: '3px 8px', fontSize: 10.5, fontWeight: 600, color: '#475569' }}
            title="Thư viện video đã xuất"
          >
            <Layers size={11} />
            Thư viện ({data.exportedCount ?? 0})
          </button>

          <span
            className="wf-node-badge"
            style={{
              background: '#f1f5f9',
              color: '#475569',
              border: '1px solid #e2e8f0',
            }}
          >
            {scenes.length} Clip • {durationLabel}
          </span>

          {data.voiceId && (
            <span
              className="wf-node-badge"
              style={{
                background: '#f1f5f9',
                color: '#475569',
                border: '1px solid #e2e8f0',
                fontWeight: 600,
                fontSize: 10,
                display: 'flex',
                alignItems: 'center',
                gap: 4,
              }}
              title={`Brand Voice được gán từ ChatGPT: ${data.voiceId}`}
            >
              <Mic size={10} />
              <span>{data.voiceId}</span>
            </span>
          )}

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
            <Package size={12} color="#64748b" />
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
                      background: '#334155',
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
                      background: '#475569',
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

              <span style={{ fontSize: 9.5, color: '#64748b', fontWeight: 600, marginLeft: 2 }}>
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
          <span style={{ color: '#334155', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 4 }}>
            <Sparkles size={12} color="#64748b" />
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
                border: '1px solid #cbd5e1',
                background: '#f8fafc',
                color: '#334155',
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
            <Film size={12} color="#475569" />
            <span style={{ fontSize: 11, fontWeight: 700, color: '#1e293b' }}>
              TRỤC PHÂN CẢNH LIÊN HOÀN
            </span>
            <span
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: '#0f172a',
                background: '#f1f5f9',
                padding: '1px 6px',
                borderRadius: 4,
                border: '1px solid #e2e8f0',
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
                padding: '3px 10px',
                fontSize: 10.5,
                fontWeight: 600,
                background: '#4f46e5',
                border: '1px solid #4338ca',
                color: '#ffffff',
                cursor: isRendering ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 4,
                borderRadius: 5,
                boxShadow: '0 1px 2px rgba(79, 70, 229, 0.2)',
              }}
              title={chainButtonTitle}
            >
              <Sparkles size={11} color="#ffffff" />
              {chainButtonLabel}
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
                    <span style={{ fontSize: 11, fontWeight: 700, color: isSelected ? '#0f172a' : '#334155' }}>
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
                        <Sparkles size={10} className="animate-spin" /> {scene.renderProgress ?? 0}%
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
                          {scene.renderProgress ?? 0}%
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
                              width: `${scene.renderProgress ?? 0}%`,
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
                              background: 'rgba(15, 23, 42, 0.85)',
                              color: '#ffffff',
                              padding: '1px 5px',
                              borderRadius: 3,
                              display: 'flex',
                              alignItems: 'center',
                              gap: 3,
                            }}
                          >
                            <Link2 size={9} /> Start Frame
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
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            data.onOpenVideoPicker?.(idx)
                          }}
                          style={{
                            background: '#f1f5f9',
                            border: '1px solid #cbd5e1',
                            borderRadius: 4,
                            color: '#475569',
                            fontSize: 9.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            padding: '1px 5px',
                          }}
                          title="Đổi clip Veo khác từ thư viện 51 clip có sẵn"
                        >
                          <FolderOpen size={10} /> Đổi
                        </button>
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
                      </div>
                    ) : (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            data.onOpenVideoPicker?.(idx)
                          }}
                          style={{
                            background: '#f8fafc',
                            border: '1px solid #cbd5e1',
                            borderRadius: 4,
                            color: '#334155',
                            fontSize: 9.5,
                            fontWeight: 600,
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                            padding: '1px 5px',
                          }}
                          title="Chọn clip Veo có sẵn từ thư viện (Không tốn credit)"
                        >
                          <FolderOpen size={10} /> Thư viện
                        </button>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation()
                            handleTabClick(idx)
                            data.onRenderScene?.(idx)
                          }}
                          disabled={isClipRendering || (isChained && !prevClipReady)}
                          style={{
                            background: isChained && !prevClipReady ? 'transparent' : '#4f46e5',
                            border: isChained && !prevClipReady ? 'none' : '1px solid #4338ca',
                            color: isChained && !prevClipReady ? '#94a3b8' : '#ffffff',
                            borderRadius: 4,
                            fontSize: 9.5,
                            fontWeight: 600,
                            cursor: isChained && !prevClipReady ? 'not-allowed' : 'pointer',
                            padding: isChained && !prevClipReady ? '1px 3px' : '1px 6px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 2,
                          }}
                        >
                          {isChained && !prevClipReady ? (
                            'Chờ clip trước'
                          ) : (
                            <>
                              <Play size={8} fill="currentColor" />
                              <span>Tạo</span>
                            </>
                          )}
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Handover Arrow Connector between Clips */}
                {idx < scenes.length - 1 && (
                  <div className="wf-storyboard-connector" title="Frame cuối của clip này sẽ nối sang làm Start Frame của clip tiếp theo">
                    <span style={{ fontSize: 8, color: '#64748b', fontWeight: 600 }}>End Frame</span>
                    <ArrowRight size={13} color="#94a3b8" />
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
            <span style={{ color: '#0f172a' }}>●</span>
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
                  {currentScene.renderStep && (
                    <div
                      title={currentScene.renderStep}
                      style={{
                        maxWidth: '85%',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        fontSize: 9,
                        color: '#cbd5e1',
                      }}
                    >
                      {currentScene.renderStep}
                    </div>
                  )}
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
                      background: 'rgba(15, 23, 42, 0.85)',
                      color: '#ffffff',
                      fontSize: 9.5,
                      fontWeight: 700,
                      padding: '2px 6px',
                      borderRadius: 4,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Link2 size={10} />
                    <span>Start Frame (từ Clip #{safeTab})</span>
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
                    <span>Clip Khởi Đầu (#1)</span>
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
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: 4,
                          fontSize: 9,
                          color: '#334155',
                          fontWeight: 600,
                        }}
                      >
                        <img src={modelImage} alt="Model" style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover' }} />
                        <span>Người mẫu</span>
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
                          background: '#ffffff',
                          border: '1px solid #cbd5e1',
                          borderRadius: 4,
                          fontSize: 9,
                          color: '#334155',
                          fontWeight: 600,
                        }}
                      >
                        <img src={sceneImage} alt="Scene" style={{ width: 16, height: 16, borderRadius: 2, objectFit: 'cover' }} />
                        <span>Bối cảnh</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ) : (
              <div
                style={{
                  padding: '7px 10px',
                  background: currentScene.chainFromPrevious !== false ? '#f8fafc' : '#ffffff',
                  border: currentScene.chainFromPrevious !== false ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
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
                      color: currentScene.chainFromPrevious !== false ? '#0f172a' : '#64748b',
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={currentScene.chainFromPrevious !== false}
                      onChange={(e) => data.onToggleChainFrames?.(safeTab, e.target.checked)}
                      style={{ width: 14, height: 14, accentColor: '#0f172a', cursor: 'pointer' }}
                    />
                    <span>Nối tiếp từ End Frame Clip #{safeTab}</span>
                  </label>

                  {currentScene.chainFromPrevious !== false && prevScene?.videoUrl && (
                    <button
                      type="button"
                      onClick={() => data.onExtractLastFrame?.(safeTab - 1)}
                      disabled={currentScene.isExtractingFrame}
                      style={{
                        background: '#ffffff',
                        border: '1px solid #cbd5e1',
                        borderRadius: 4,
                        padding: '2px 7px',
                        fontSize: 10,
                        fontWeight: 700,
                        color: '#0f172a',
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
                        border: currentScene.durationSec === sec ? '1px solid #4f46e5' : '1px solid #e2e8f0',
                        background: currentScene.durationSec === sec ? '#4f46e5' : '#ffffff',
                        color: currentScene.durationSec === sec ? '#ffffff' : '#64748b',
                        cursor: 'pointer',
                      }}
                    >
                      {sec}s
                    </button>
                  )
                )}
              </div>

              {/* Button Chọn từ thư viện */}
              <button
                type="button"
                className="wf-btn"
                onClick={() => data.onOpenVideoPicker?.(safeTab)}
                style={{
                  padding: '5px 10px',
                  fontSize: 11,
                  background: '#f8fafc',
                  color: '#0f172a',
                  border: '1px solid #cbd5e1',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 4,
                  cursor: 'pointer',
                  borderRadius: 6,
                }}
                title="Chọn clip Veo có sẵn từ thư viện (Không tốn credit)"
              >
                <FolderOpen size={13} color="#475569" />
                {currentScene.videoUrl ? 'Đổi từ Thư viện' : 'Chọn từ Thư viện'}
              </button>

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
            flexDirection: 'column',
            gap: 8,
          }}
        >
          {/* Voiceover Row if Brand Voice is active */}
          {data.voiceId && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '6px 10px',
                background: '#f8fafc',
                borderRadius: 8,
                border: '1px solid #e2e8f0',
                fontSize: 11,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Mic size={13} color="#64748b" />
                <span style={{ fontWeight: 700, color: '#0f172a' }}>
                  Lồng tiếng VieNeu-TTS:
                </span>
                <span style={{ color: '#475569', fontWeight: 600 }}>
                  {data.voiceId}
                </span>
                {data.voiceoverUrl && (
                  <span style={{ fontSize: 9.5, color: '#059669', background: '#ecfdf5', border: '1px solid #a7f3d0', padding: '1px 5px', borderRadius: 4, fontWeight: 700 }}>
                    ✓ Audio sẵn sàng ({data.voiceoverDurationSec ? `${Math.round(data.voiceoverDurationSec)}s` : 'OK'})
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {data.voiceoverUrl ? (
                  <>
                    <audio src={data.voiceoverUrl} controls style={{ height: 26, maxWidth: 170 }} />
                    <span style={{ fontSize: 10, color: '#475569', background: '#f1f5f9', border: '1px solid #e2e8f0', padding: '2px 6px', borderRadius: 4, fontWeight: 600 }}>
                      Đồng bộ chuẩn theo clip
                    </span>
                  </>
                ) : (
                  <button
                    type="button"
                    className="wf-btn"
                    onClick={() => data.onGenerateVoiceover?.()}
                    disabled={data.isGeneratingVoiceover}
                    style={{
                      padding: '3px 10px',
                      fontSize: 10.5,
                      fontWeight: 700,
                      background: '#4f46e5',
                      color: '#ffffff',
                      border: '1px solid #4338ca',
                      borderRadius: 5,
                      display: 'flex',
                      alignItems: 'center',
                      gap: 4,
                    }}
                  >
                    <Mic size={11} className={data.isGeneratingVoiceover ? 'animate-spin' : ''} />
                    {data.isGeneratingVoiceover ? 'Đang đọc TTS...' : 'Tạo Audio Lồng Tiếng'}
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Stitch Concat Export Row */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Layers size={14} color="#64748b" />
              <span style={{ fontSize: 11, fontWeight: 700, color: '#334155' }}>
                {completedCount >= 2 && completedCount < scenes.length
                  ? `Ghép ${completedCount}/${scenes.length} clip (${completedDuration}s)`
                  : `Ghép ${scenes.length} clip (${totalDuration}s)`}
              </span>
              <span style={{ fontSize: 10, color: '#94a3b8' }}>
                • MP4 {data.videoConfig?.resolution || data.resolution || '720p'} {data.voiceoverUrl ? '+ Voiceover' : ''}
              </span>
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
                  disabled={isExporting || !canExport}
                  style={{
                    padding: '5px 14px',
                    fontSize: 11,
                    opacity: !canExport ? 0.6 : 1,
                    cursor: !canExport ? 'not-allowed' : 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                  }}
                  title={
                    !canExport
                      ? 'Cần tạo thành công ít nhất 2 clip trước khi ghép'
                      : completedCount < scenes.length
                      ? `Ghép ${completedCount} clip đã hoàn thành thành 1 file MP4`
                      : 'Ghép toàn bộ clip thành 1 file MP4'
                  }
                >
                  {isExporting ? (
                    <>
                      <Loader2 size={13} className="animate-spin" />
                      <span>Đang xuất video... {exportProgress}%</span>
                    </>
                  ) : (
                    <>
                      <Download size={13} />
                      <span>
                        {data.voiceoverUrl
                          ? (completedCount < scenes.length ? `Ghép ${completedCount} Clip + Lồng Tiếng` : 'Ghép Video + Lồng Tiếng (MP4)')
                          : (completedCount < scenes.length ? `Ghép ${completedCount} Clip (MP4)` : 'Ghép Video Hoàn Chỉnh (MP4)')}
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* Thanh Loading Tiến Trình Ghép Video Động */}
          {isExporting && (
            <div
              style={{
                marginTop: 2,
                padding: '8px 12px',
                background: '#eef2ff',
                borderRadius: 8,
                border: '1px solid #c7d2fe',
                display: 'flex',
                flexDirection: 'column',
                gap: 5,
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, fontWeight: 700, color: '#4338ca' }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Loader2 size={13} className="animate-spin" color="#4f46e5" />
                  {exportProgress < 30
                    ? '1/3 Đang chuẩn bị kịch bản & khởi động FFmpeg...'
                    : exportProgress < 65
                    ? '2/3 Đang ghép nối các clip Veo thành một luồng video...'
                    : '3/3 Đang hòa âm VieNeu-TTS Voiceover & Nhạc nền BGM...'}
                </span>
                <span style={{ fontSize: 12, fontWeight: 800, color: '#4f46e5' }}>{exportProgress}%</span>
              </div>
              <div style={{ width: '100%', height: 6, background: '#cbd5e1', borderRadius: 3, overflow: 'hidden' }}>
                <div
                  style={{
                    width: `${exportProgress}%`,
                    height: '100%',
                    background: 'linear-gradient(90deg, #4f46e5, #06b6d4, #10b981)',
                    borderRadius: 3,
                    transition: 'width 0.5s ease',
                  }}
                />
              </div>
            </div>
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
