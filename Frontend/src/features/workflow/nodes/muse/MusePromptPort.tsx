import { Position, useNodeConnections, useNodesData } from '@xyflow/react'
import { MuseMediaPort } from './MuseMediaPort'
import { EMPTY_LINKED_PROMPT, MUSE_HANDLE, MUSE_NODE, MUSE_PORT_FIRST_TOP, normalizePromptBoxData } from '../../services/museCanvasNodes.ts'

export function useLinkedPrompt() {
  const connections = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.promptIn })
  const source = useNodesData(connections[0]?.source ?? '')
  if (source?.type !== MUSE_NODE.promptBox) return null
  const { text, label, title } = normalizePromptBoxData(source.data)
  return { text, label: label.trim() || title }
}

/** Cổng Prompt (Text) ở cạnh trái, trên các cổng ảnh / video; `top` lấy từ museInputPortTops của node. */
export function MusePromptPort({ linked, label = 'Prompt', top = MUSE_PORT_FIRST_TOP }: {
  linked: ReturnType<typeof useLinkedPrompt>
  label?: string
  top?: number
}) {
  const empty = linked && !linked.text.trim()
  const hint = linked
    ? empty ? EMPTY_LINKED_PROMPT : `Đang dùng nội dung từ “${linked.label}”.`
    : `Nối Ô prompt vào cổng ${label} để ưu tiên nội dung từ ô.`
  return (
    <>
      <MuseMediaPort type="target" position={Position.Left} id={MUSE_HANDLE.promptIn} kind="Text" label={label} style={{ top }} title={hint} />
      {empty && (
        <span className="mc-prompt-port is-empty" title={hint}>
          {EMPTY_LINKED_PROMPT}
        </span>
      )}
    </>
  )
}
