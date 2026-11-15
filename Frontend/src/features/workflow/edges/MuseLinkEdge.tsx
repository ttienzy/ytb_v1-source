/** Dây của Muse Canvas: có nút X ở giữa để gỡ (tự xóa qua useReactFlow, không cần hàm trong `data` — data được lưu xuống file). */
import { BaseEdge, EdgeLabelRenderer, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react'
import { X } from 'lucide-react'

export function MuseLinkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow()
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <div
          style={{ position: 'absolute', transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`, pointerEvents: 'all' }}
          className={`nodrag nopan wf-edge-btn-wrapper ${selected ? 'is-selected' : ''}`}
        >
          <button
            type="button"
            className="wf-edge-del-btn"
            title="Gỡ dây này"
            onClick={(e) => {
              e.stopPropagation()
              deleteElements({ edges: [{ id }] })
            }}
          >
            <X size={10} />
          </button>
        </div>
      </EdgeLabelRenderer>
    </>
  )
}
