import { useReactFlow } from '@xyflow/react'
import { Trash2 } from 'lucide-react'

/** Nút xóa node (xóa luôn các dây nối với node). `confirmText` có giá trị thì hỏi trước khi xóa. */
export function NodeDeleteButton({ nodeId, confirmText }: { nodeId: string; confirmText?: string }) {
  const { deleteElements } = useReactFlow()
  return (
    <button
      type="button"
      className="mc-node-del nodrag"
      title="Xóa node (và các dây nối với nó)"
      onClick={(e) => {
        e.stopPropagation()
        if (confirmText && !window.confirm(confirmText)) return
        deleteElements({ nodes: [{ id: nodeId }] })
      }}
    >
      <Trash2 size={13} />
    </button>
  )
}
