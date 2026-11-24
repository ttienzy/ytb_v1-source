/** Dây của Muse Canvas: icon loại nội dung (Text / Image / Video) sát cổng vào, nút X ở giữa để gỡ (tự xóa qua useReactFlow, không cần hàm trong `data` — data được lưu xuống file). */
import { BaseEdge, EdgeLabelRenderer, Position, getBezierPath, useReactFlow, type EdgeProps } from '@xyflow/react'
import { X } from 'lucide-react'
import { MUSE_MEDIA_ICON } from '../nodes/muse/MuseMediaPort'
import { museHandleKind } from '../services/museCanvasNodes.ts'

/** Khoảng cách từ tâm cổng vào tới tâm icon trên dây (px): cổng rộng 20, icon rộng 18, chừa 7px hở. */
const KIND_OFFSET = 26

const kindOffset = (position: Position) =>
  position === Position.Left ? { x: -KIND_OFFSET, y: 0 }
    : position === Position.Right ? { x: KIND_OFFSET, y: 0 }
      : position === Position.Top ? { x: 0, y: -KIND_OFFSET }
        : { x: 0, y: KIND_OFFSET }

export function MuseLinkEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  sourceHandleId,
  targetHandleId,
  style,
  markerEnd,
  selected,
}: EdgeProps) {
  const { deleteElements } = useReactFlow()
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition })
  const kind = museHandleKind(sourceHandleId ?? targetHandleId)
  const Icon = MUSE_MEDIA_ICON[kind]
  const off = kindOffset(targetPosition)
  return (
    <>
      <BaseEdge path={path} markerEnd={markerEnd} style={style} />
      <EdgeLabelRenderer>
        <span
          className="mc-edge-kind mc-media-kind nodrag nopan"
          data-media={kind}
          aria-hidden="true"
          style={{ transform: `translate(-50%, -50%) translate(${targetX + off.x}px,${targetY + off.y}px)` }}
        >
          <Icon size={11} />
        </span>
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
