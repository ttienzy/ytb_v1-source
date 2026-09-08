import React from 'react'
import {
  BaseEdge,
  EdgeLabelRenderer,
  getBezierPath,
  type EdgeProps,
} from '@xyflow/react'
import { X } from 'lucide-react'

export function RemovableEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style = {},
  markerEnd,
  data,
  selected,
}: EdgeProps) {
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })

  const handleDelete = (evt: React.MouseEvent) => {
    evt.stopPropagation()
    const deleteFn = (data as Record<string, unknown>)?.onDeleteEdge as ((edgeId: string) => void) | undefined
    deleteFn?.(id)
  }

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{
            position: 'absolute',
            transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
            pointerEvents: 'all',
          }}
          className={`nodrag nopan wf-edge-btn-wrapper ${selected ? 'is-selected' : ''}`}
        >
          <button
            type="button"
            className="wf-edge-del-btn"
            onClick={handleDelete}
            title="Xóa dây liên kết này"
          >
            <X size={10} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
