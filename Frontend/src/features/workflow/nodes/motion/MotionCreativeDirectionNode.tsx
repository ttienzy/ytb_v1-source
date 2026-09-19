import React from 'react'
import { Handle, Position, type NodeProps } from '@xyflow/react'
import { FileText, Camera, Palette, ExternalLink, Sparkles } from 'lucide-react'
import type { MotionCreativeDirection } from '../../types'

export interface MotionCreativeDirectionNodeData {
  creative: MotionCreativeDirection
  isRunning?: boolean
  onOpenInspector?: () => void
}

export function MotionCreativeDirectionNode({ data, selected }: NodeProps) {
  const nodeData = data as unknown as MotionCreativeDirectionNodeData
  const creative = nodeData.creative || {
    creativeBrief: '',
    subjectAction: '',
    cameraMovement: '',
    sceneAtmosphere: '',
    styleDirection: '',
    negativePrompt: '',
  }

  const briefSnippet = creative.creativeBrief.trim() || 'Chưa nhập ý tưởng chính...'

  return (
    <div
      className={`mf-node ${selected ? 'selected' : ''} ${nodeData.isRunning ? 'running' : ''}`}
      data-type="txt"
      style={{ width: 330, padding: 0 }}
    >
      {/* Input Handles on the Left */}
      <Handle
        type="target"
        position={Position.Left}
        id="in-character"
        className="mf-rf-handle img"
        style={{ left: -7, top: 40 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="in-motion"
        className="mf-rf-handle vid"
        style={{ left: -7, top: 80 }}
      />
      <Handle
        type="target"
        position={Position.Left}
        id="in-scene"
        className="mf-rf-handle img"
        style={{ left: -7, top: 120 }}
      />

      {/* Output Handle on the Right */}
      <Handle
        type="source"
        position={Position.Right}
        id="out-creative"
        className="mf-rf-handle txt on"
        style={{ right: -7, top: '50%', transform: 'translateY(-50%)' }}
      />

      {/* Header */}
      <header className="mf-node-h" style={{ borderBottom: '1px solid #E2E8F0' }}>
        <span className="mf-chip" style={{ background: '#EFF6FF', color: '#2563EB' }}>
          <FileText size={15} />
        </span>
        <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
          <h2 style={{ fontSize: '13px', margin: 0, fontWeight: 700 }}>Chỉ Dẫn Sáng Tạo</h2>
          <small style={{ fontSize: '11px', color: '#64748B' }}>Creative Direction (Director Brief)</small>
        </div>
        <span className="mf-tag" style={{ background: '#EFF6FF', color: '#2563EB', fontWeight: 600 }}>
          Bắt buộc
        </span>
      </header>

      {/* Body Content */}
      <div style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        {/* Creative Brief Preview */}
        <div
          style={{
            background: '#F8FAFC',
            border: '1px solid #E2E8F0',
            borderRadius: '6px',
            padding: '8px 10px',
            fontSize: '12px',
            color: creative.creativeBrief ? '#1E293B' : '#94A3B8',
            lineHeight: 1.45,
            maxHeight: '60px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            display: '-webkit-box',
            WebkitLineClamp: 3,
            WebkitBoxOrient: 'vertical',
          }}
        >
          {briefSnippet}
        </div>

        {/* Direction Key Attributes */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
          {/* Camera movement */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#F5F3FF',
              border: '1px solid #DDD6FE',
              padding: '6px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#6D28D9',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={creative.cameraMovement || 'Chưa nhập chỉ dẫn camera'}
          >
            <Camera size={13} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {creative.cameraMovement || 'Chưa nhập camera'}
            </span>
          </div>

          {/* Style */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              background: '#FDF2F8',
              border: '1px solid #FBCFE8',
              padding: '6px 8px',
              borderRadius: '6px',
              fontSize: '11px',
              color: '#BE185D',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
              gridColumn: 'span 2',
            }}
            title={creative.styleDirection || 'Chưa nhập phong cách'}
          >
            <Palette size={13} />
            <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
              Style: {creative.styleDirection || 'Chưa nhập'}
            </span>
          </div>
        </div>

        {/* Quick Button to Open Inspector */}
        <button
          type="button"
          onClick={() => nodeData.onOpenInspector?.()}
          style={{
            width: '100%',
            padding: '7px 10px',
            borderRadius: '6px',
            border: '1px solid #CBD5E1',
            background: '#FFFFFF',
            color: '#334155',
            fontSize: '11.5px',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '6px',
            transition: 'all 0.15s ease',
          }}
          onMouseOver={(e) => (e.currentTarget.style.borderColor = '#94A3B8')}
          onMouseOut={(e) => (e.currentTarget.style.borderColor = '#CBD5E1')}
        >
          <Sparkles size={13} color="#2563EB" />
          <span>Tùy chỉnh chi tiết trong Inspector</span>
          <ExternalLink size={12} color="#64748B" />
        </button>
      </div>
    </div>
  )
}
