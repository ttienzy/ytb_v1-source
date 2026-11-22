/**
 * Node "Ô prompt" của Muse Canvas — độc lập: nhập / giữ 1 prompt chữ (thêm bao nhiêu ô cũng được), có tên, đếm ký tự,
 * chép, thu gọn. Chữ lưu cùng đồ thị của project. Cổng ra "prompt" để dành cho node dùng prompt sau này
 * (hiện chưa node nào nhận — dùng nút "Chép" để dán sang node khác).
 */
import { memo, useState } from 'react'
import { Handle, Position, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import { Check, ChevronsDownUp, ChevronsUpDown, Copy, Eraser, NotebookPen } from 'lucide-react'
import {
  MUSE_HANDLE,
  PROMPT_BOX_MAX_CHARS,
  normalizePromptBoxData,
  promptBoxPreview,
  promptBoxStats,
} from '../../services/museCanvasNodes.ts'
import { NodeDeleteButton } from './NodeDeleteButton'

type PromptBoxNode = Node<Record<string, unknown>, string>

function MusePromptBoxNodeImpl({ id, data: raw, selected }: NodeProps<PromptBoxNode>) {
  const { updateNodeData } = useReactFlow()
  const data = normalizePromptBoxData(raw)
  const [copied, setCopied] = useState(false)
  const [copyErr, setCopyErr] = useState('')
  const empty = !data.text.trim()

  async function copy() {
    try {
      await navigator.clipboard.writeText(data.text)
      setCopied(true)
      setCopyErr('')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopyErr('Không chép được vào clipboard.')
    }
  }

  function clear() {
    if (empty) return
    if (!window.confirm(`Xóa hết chữ trong “${data.label.trim() || data.title}”?`)) return
    updateNodeData(id, { text: '' })
  }

  return (
    <div className={`mc-node mc-node-promptbox ${selected ? 'selected' : ''}`}>
      <div className="mc-node-head">
        <span className="mc-node-icon mc-icon-promptbox">
          <NotebookPen size={14} />
        </span>
        <div className="mc-node-titles">
          <strong>{data.label.trim() || data.title}</strong>
          <small>{promptBoxStats(data.text)}</small>
        </div>
        <button
          type="button"
          className="mc-icon-btn nodrag"
          onClick={() => updateNodeData(id, { collapsed: !data.collapsed })}
          title={data.collapsed ? 'Mở rộng' : 'Thu gọn'}
        >
          {data.collapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
        </button>
        <NodeDeleteButton nodeId={id} confirmText={empty ? undefined : `Xóa “${data.label.trim() || data.title}”? Chữ trong ô sẽ mất.`} />
      </div>

      {data.collapsed ? (
        <div className="mc-node-body mc-collapsed-body">
          <span className="mc-promptbox-preview" title={data.text.slice(0, 400)}>
            {promptBoxPreview(data.text) || <em>Trống</em>}
          </span>
        </div>
      ) : (
        <div className="mc-node-body">
          <input
            className="mc-node-input nodrag"
            value={data.label}
            maxLength={60}
            placeholder="Tên ô (tùy chọn), vd. Prompt catwalk xoay váy"
            onChange={(e) => updateNodeData(id, { label: e.target.value })}
          />
          <textarea
            className="mc-prompt mc-promptbox-text nodrag nowheel"
            value={data.text}
            maxLength={PROMPT_BOX_MAX_CHARS}
            rows={10}
            spellCheck={false}
            placeholder="Nhập hoặc dán prompt…"
            onChange={(e) => updateNodeData(id, { text: e.target.value })}
          />
          <div className="mc-node-actions">
            <span className="mc-node-meta">
              {data.text.length.toLocaleString('vi-VN')} / {PROMPT_BOX_MAX_CHARS.toLocaleString('vi-VN')} ký tự
            </span>
            <button type="button" className="mc-mini-btn nodrag" onClick={clear} disabled={empty} title="Xóa hết chữ trong ô">
              <Eraser size={12} /> Xóa chữ
            </button>
            <button type="button" className="mc-mini-btn mc-mini-accent nodrag" onClick={copy} disabled={empty} title="Chép prompt vào clipboard">
              {copied ? <Check size={12} /> : <Copy size={12} />} {copied ? 'Đã chép' : 'Chép'}
            </button>
          </div>
          {copyErr && <div className="mc-node-error">{copyErr}</div>}
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.promptOut}
        className="mc-handle mc-handle-promptbox"
        title="Ô prompt — chưa có node nào nhận prompt từ ô"
      />
    </div>
  )
}

export const MusePromptBoxNode = memo(MusePromptBoxNodeImpl)
