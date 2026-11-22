import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText, Camera, ExternalLink, Sparkles, Check } from 'lucide-react'
import type { MotionCreativeDirection } from '../../types'
import {
  MOTION_MODE_INFO,
  MOTION_OPTION_LABELS,
  type MotionEditMode,
  type MotionPromptOptionKey,
  type MotionPromptOptions,
} from '../../services/motionPromptBuilder.ts'

export interface MotionCreativeDirectionNodeData {
  creative: MotionCreativeDirection
  /** Kiểu chỉnh tự nhận theo ảnh (thay người / thay bối cảnh / …). */
  mode?: MotionEditMode
  /** Tùy chọn đang có hiệu lực. */
  options?: MotionPromptOptions
  characterCount?: number
  hasScene?: boolean
  isRunning?: boolean
  onUpdateCreative?: (updates: Partial<MotionCreativeDirection>) => void
  onOpenInspector?: () => void
}

const EMPTY: MotionCreativeDirection = {
  creativeBrief: '',
  subjectAction: '',
  cameraMovement: '',
  sceneAtmosphere: '',
  styleDirection: '',
  negativePrompt: '',
}

export function MotionCreativeDirectionNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as MotionCreativeDirectionNodeData
  const creative = nodeData.creative || EMPTY
  const mode = nodeData.mode || 'describe'
  const info = MOTION_MODE_INFO[mode]
  const isDescribe = mode === 'describe'
  const brief = creative.creativeBrief.trim()
  const activeOptions = (Object.keys(MOTION_OPTION_LABELS) as MotionPromptOptionKey[]).filter((k) => nodeData.options?.[k])
  const canChooseBackground = (nodeData.characterCount ?? 0) === 1 && !nodeData.hasScene
  const background = creative.backgroundFrom === 'character_image' ? 'character_image' : 'video'

  return (
    <div
      className={`mf-node ${selected ? 'selected' : ''} ${nodeData.isRunning ? 'running' : ''}`}
      data-type="txt"
      style={{ width: 330, padding: 0 }}
    >
      <Handle type="target" position={Position.Left} id="in-character" className="mf-rf-handle img" style={{ left: -7, top: 40 }} />
      <Handle type="target" position={Position.Left} id="in-motion" className="mf-rf-handle vid" style={{ left: -7, top: 80 }} />
      <Handle type="target" position={Position.Left} id="in-scene" className="mf-rf-handle img" style={{ left: -7, top: 120 }} />
      <Handle
        type="source"
        position={Position.Right}
        id="out-creative"
        className="mf-rf-handle txt on"
        style={{ right: -7, top: '50%', transform: 'translateY(-50%)' }}
      />

      <header className="mf-node-h" style={{ borderBottom: '1px solid #E2E8F0' }}>
        <span className="mf-chip" style={{ background: '#EFF6FF', color: '#2563EB' }}>
          <FileText size={15} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <h2 style={{ fontSize: '13px', margin: 0, fontWeight: 700 }}>Chỉ Dẫn Sáng Tạo</h2>
          <small style={{ fontSize: '11px', color: '#64748B' }}>Kiểu chỉnh + chỉ đạo thêm</small>
        </div>
        <span
          className="mf-tag"
          style={isDescribe && !brief
            ? { background: '#FEF2F2', color: '#DC2626', fontWeight: 600 }
            : { background: '#F1F5F9', color: '#475569', fontWeight: 600 }}
        >
          {isDescribe ? (brief ? 'Đã mô tả' : 'Cần mô tả') : 'Tùy chọn'}
        </span>
      </header>

      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div className="mf-mode-badge">
          <b>{info.label}</b>
          <span>{info.summary}</span>
        </div>

        {canChooseBackground && nodeData.onUpdateCreative && (
          <div className="mf-insp-seg nodrag" role="radiogroup" aria-label="Nền lấy từ">
            <span>Nền</span>
            <button
              type="button"
              className={background === 'video' ? 'on' : ''}
              onClick={() => nodeData.onUpdateCreative?.({ backgroundFrom: 'video' })}
              disabled={nodeData.isRunning}
            >
              Video mẫu
            </button>
            <button
              type="button"
              className={background === 'character_image' ? 'on' : ''}
              onClick={() => nodeData.onUpdateCreative?.({ backgroundFrom: 'character_image' })}
              disabled={nodeData.isRunning}
            >
              Ảnh nhân vật
            </button>
          </div>
        )}

        <div
          style={{
            background: '#F8FAFC',
            border: `1px solid ${isDescribe && !brief ? '#FECACA' : '#E2E8F0'}`,
            borderRadius: '6px',
            padding: '7px 9px',
            fontSize: '11.5px',
            color: brief ? '#1E293B' : '#94A3B8',
            lineHeight: 1.45,
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
          title={brief || undefined}
        >
          {brief || (isDescribe
            ? 'Chưa có ảnh: hãy viết điều muốn thay đổi trong Inspector.'
            : 'Không có chỉ đạo thêm — chỉ dùng phần tự sinh theo ảnh.')}
        </div>

        {(creative.cameraMovement.trim() || activeOptions.length > 0) && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
            {creative.cameraMovement.trim() && (
              <span className="mf-insp-pill" title={creative.cameraMovement} style={{ maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                <Camera size={10} /> {creative.cameraMovement}
              </span>
            )}
            {activeOptions.map((k) => (
              <span key={k} className="mf-insp-pill" style={{ background: '#F0FDFA', color: '#0F766E' }}>
                <Check size={10} /> {MOTION_OPTION_LABELS[k].label}
              </span>
            ))}
          </div>
        )}

        <button
          type="button"
          className="mf-insp-btn nodrag"
          onClick={() => nodeData.onOpenInspector?.()}
          style={{ justifyContent: 'center', width: '100%' }}
        >
          <Sparkles size={13} color="#2563EB" />
          <span>Chỉnh chi tiết trong Inspector</span>
          <ExternalLink size={12} color="#64748B" />
        </button>
      </div>
    </div>
  )
}
