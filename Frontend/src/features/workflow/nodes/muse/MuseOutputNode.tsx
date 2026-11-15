/**
 * Node "Ảnh kết quả": 1 ảnh đã tạo, tách ra từ 1 dòng của node chạy Muse (Tách áo quần / Bảng nhân vật).
 * Giữ ảnh riêng (không đổi khi node nguồn chạy lại) và nhớ nguồn; nếu nguồn có ảnh mới hơn thì báo + nút cập nhật.
 * Cổng ra "image" để nối tiếp sang node sau.
 */
import { memo, useMemo, useState } from 'react'
import { Handle, Position, useNodeConnections, useNodesData, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import { Check, Copy, ExternalLink, ImageIcon, RefreshCw } from 'lucide-react'
import {
  JOB_SPECS,
  MUSE_HANDLE,
  newerOutputFor,
  normalizeJobData,
  normalizeOutputData,
} from '../../services/museCanvasNodes.ts'
import { museMediaUrl } from '../../services/museCanvasApi.ts'
import { NodeDeleteButton } from './NodeDeleteButton'

type OutputNode = Node<Record<string, unknown>, 'museOutputImage'>

function MuseOutputNodeImpl({ id, data: raw, selected }: NodeProps<OutputNode>) {
  const { updateNodeData } = useReactFlow()
  const data = normalizeOutputData(raw)
  const [copied, setCopied] = useState(false)

  // Node nguồn (node chạy nối vào cổng image) — để biết có ảnh mới hơn không.
  const conns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.imageIn })
  const parentId = conns[0]?.source ?? ''
  const parent = useNodesData(parentId)
  const newer = useMemo(
    () => (parent && parent.type && JOB_SPECS[parent.type] ? newerOutputFor(data, normalizeJobData(parent.data as Record<string, unknown>, parent.type)) : null),
    [data, parent],
  )
  const fromText = data.origin
    ? `${JOB_SPECS[data.origin.jobType]?.title ?? 'Muse'} · ${data.origin.rowLabel}`
    : 'Ảnh kết quả'

  return (
    <div className={`mc-node mc-node-output ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} id={MUSE_HANDLE.imageIn} className="mc-handle mc-handle-prompt" title="Từ node chạy Muse" />

      <div className="mc-node-head">
        <span className="mc-node-icon mc-icon-output"><ImageIcon size={14} /></span>
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small title={fromText}>{parentId ? fromText : `${fromText} (đã gỡ dây nguồn)`}</small>
        </div>
        <NodeDeleteButton nodeId={id} />
      </div>

      <div className="mc-node-body">
        <input
          className="mc-node-input nodrag"
          value={data.label}
          maxLength={60}
          placeholder="Tên ảnh (tùy chọn)"
          onChange={(e) => updateNodeData(id, { label: e.target.value })}
        />
        {data.image ? (
          <a className="mc-output-preview nodrag" href={museMediaUrl(data.image.previewUrl)} target="_blank" rel="noreferrer" title="Mở ảnh gốc">
            <img src={museMediaUrl(data.image.previewUrl)} alt={data.label || data.title} draggable={false} />
          </a>
        ) : (
          <div className="mc-inputs-empty">Node chưa có ảnh.</div>
        )}

        {newer && (
          <div className="mc-output-newer">
            <span>Nguồn vừa chạy lại, có ảnh mới hơn.</span>
            <button type="button" className="mc-mini-btn mc-mini-accent nodrag" onClick={() => updateNodeData(id, { image: newer })}>
              <RefreshCw size={11} /> Dùng ảnh mới
            </button>
          </div>
        )}

        {data.image && (
          <div className="mc-node-actions">
            <span className="mc-node-meta" title={data.image.path}>{data.image.name}</span>
            <button
              type="button"
              className="mc-mini-btn nodrag"
              onClick={() => {
                navigator.clipboard?.writeText(data.image!.path)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              title="Chép đường dẫn file"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
            <a className="mc-mini-btn nodrag" href={museMediaUrl(data.image.previewUrl)} target="_blank" rel="noreferrer" title="Mở ảnh">
              <ExternalLink size={11} />
            </a>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} id={MUSE_HANDLE.imageOut} className="mc-handle mc-handle-output" title="Ảnh này — nối sang node sau" />
    </div>
  )
}

export const MuseOutputNode = memo(MuseOutputNodeImpl)
