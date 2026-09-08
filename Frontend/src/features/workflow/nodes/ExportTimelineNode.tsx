import React from 'react'
import { Handle, Position } from '@xyflow/react'
import { Film, Download, CheckCircle2, Music, Sparkles, Share2, Layers, Trash2 } from 'lucide-react'
import type { ExportTimelineNodeData } from '../types'

interface ExportTimelineNodeProps {
  data: ExportTimelineNodeData
  selected?: boolean
}

export function ExportTimelineNode({ data, selected }: ExportTimelineNodeProps) {
  const isExporting = data.isExporting ?? false
  const progress = data.exportProgress ?? 0

  return (
    <div className={`wf-node-card ${selected ? 'selected' : ''}`} style={{ width: 340 }}>
      {/* Target handle receiving from Scene nodes */}
      <Handle
        type="target"
        position={Position.Left}
        id="input"
        className="wf-handle wf-handle-target"
      />

      {/* Header */}
      <div className="wf-node-header">
        <div className="wf-node-title-group">
          <div className="wf-node-icon wf-icon-emerald">
            <Film size={15} />
          </div>
          <div>
            <div className="wf-node-title">{data.title || 'Xuất Video Hoàn Chỉnh'}</div>
            <div style={{ fontSize: 10, color: '#34d399', fontWeight: 600 }}>
              Timeline & Ghép Clip
            </div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className="wf-node-badge wf-badge-gpt" style={{ background: 'rgba(52, 211, 153, 0.18)', color: '#34d399' }}>
            {data.resolution || '1080p'} • MP4
          </span>
          <button
            type="button"
            className="wf-node-del-btn"
            onClick={(e) => {
              e.stopPropagation()
              data.onDelete?.()
            }}
            title="Xóa khối xuất video này"
          >
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* Body */}
      <div className="wf-node-body">
        {/* Sequence Preview Strip */}
        <div style={{ marginBottom: 10 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>
            Thứ tự phân cảnh (3 clips):
          </div>
          <div className="wf-timeline-strip">
            <div className="wf-timeline-item" style={{ borderColor: '#ec4899', color: '#ec4899' }}>
              Cảnh #1
            </div>
            <span style={{ color: '#94a3b8', fontSize: 11 }}>➔</span>
            <div className="wf-timeline-item" style={{ borderColor: '#8b5cf6', color: '#8b5cf6' }}>
              Cảnh #2
            </div>
            <span style={{ color: '#94a3b8', fontSize: 11 }}>➔</span>
            <div className="wf-timeline-item" style={{ borderColor: '#3b82f6', color: '#3b82f6' }}>
              Cảnh #3
            </div>
          </div>
        </div>

        {/* Video Preview / Export status */}
        <div
          style={{
            height: 110,
            borderRadius: 8,
            background: '#0f172a',
            border: '1px solid #e2e8f0',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 10,
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {data.finalVideoUrl ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#10b981' }}>
              <CheckCircle2 size={28} />
              <span style={{ fontSize: 11, fontWeight: 700 }}>Đã xuất video thành công!</span>
            </div>
          ) : isExporting ? (
            <div className="wf-render-overlay">
              <Sparkles size={22} color="#10b981" className="animate-spin" />
              <div style={{ fontSize: 11, fontWeight: 700, color: '#f8fafc' }}>
                Đang ghép video... {progress}%
              </div>
              <div className="wf-render-progress-bar">
                <div className="wf-render-progress-fill" style={{ width: `${progress}%`, background: 'linear-gradient(90deg, #10b981, #06b6d4)' }} />
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, color: '#94a3b8' }}>
              <Film size={26} />
              <span style={{ fontSize: 11, color: '#94a3b8' }}>Sẵn sàng ghép & xuất bản</span>
            </div>
          )}
        </div>

        {/* Settings row */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11, color: '#64748b', marginBottom: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Music size={12} />
            <span>BGM: Tự động ghép</span>
          </div>
          <span style={{ color: '#10b981', fontWeight: 600 }}>Tỷ lệ: 9:16</span>
        </div>

        {/* Action Button */}
        <button
          type="button"
          className="wf-btn wf-btn-primary"
          style={{ width: '100%', justifyContent: 'center', padding: '8px 14px' }}
          onClick={() => data.onExport?.()}
          disabled={isExporting}
        >
          <Download size={14} />
          {isExporting ? 'Đang xuất MP4...' : 'Xuất Video Hoàn Chỉnh'}
        </button>
      </div>

      {/* Output Handle if further published */}
      <Handle
        type="source"
        position={Position.Right}
        id="output"
        className="wf-handle wf-handle-source"
      />
    </div>
  )
}
