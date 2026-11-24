import { Handle, useNodeId, useStore, type HandleProps } from '@xyflow/react'
import { Film, Image, Type } from 'lucide-react'
import type { ComponentProps } from 'react'

export const MUSE_MEDIA_ICON = {
  Text: Type,
  Image,
  Video: Film,
}

type MediaKind = keyof typeof MUSE_MEDIA_ICON
type MediaPortProps = Omit<ComponentProps<typeof Handle>, 'id' | 'type'> & {
  id: string
  type: NonNullable<HandleProps['type']>
  kind: MediaKind
  label: string
}

export function MuseMediaIcon({ kind }: { kind: MediaKind }) {
  const Icon = MUSE_MEDIA_ICON[kind]
  return (
    <span className="mc-node-icon mc-media-kind" data-media={kind} title={kind} role="img" aria-label={kind}>
      <Icon size={14} aria-hidden="true" />
    </span>
  )
}

export function MuseMediaPort({ kind, label, type, id, title, ...props }: MediaPortProps) {
  const nodeId = useNodeId()
  const from = useStore((state) => state.connection.fromHandle ?? state.connectionClickStartHandle)
  const validate = useStore((state) => state.isValidConnection)
  const Icon = MUSE_MEDIA_ICON[kind]
  const description = `${type === 'source' ? 'Đầu ra' : 'Đầu vào'} · ${kind} · ${label}`
  let state = 'idle'
  if (from && nodeId) {
    state = 'unavailable'
    if (from.nodeId === nodeId && from.type === type && from.id === id) {
      state = 'active'
    } else if (from.type !== type && from.nodeId !== nodeId) {
      const start = { node: from.nodeId, handle: from.id ?? null }
      const end = { node: nodeId, handle: id }
      const [source, target] = type === 'target' ? [start, end] : [end, start]
      if (validate?.({
        source: source.node,
        target: target.node,
        sourceHandle: source.handle,
        targetHandle: target.handle,
      })) state = 'compatible'
    }
  }

  return (
    <Handle
      {...props}
      id={id}
      type={type}
      className="mc-handle mc-media-kind mc-media-port"
      data-media={kind}
      data-port-state={state}
      title={title ? `${description}\n${title}` : description}
      aria-label={description}
    >
      {type === 'target' && <Icon className="mc-media-port-icon" size={13} aria-hidden="true" />}
      <span className="mc-media-port-label" aria-hidden="true">
        {type === 'source' && <Icon size={12} />}
        {label}
      </span>
    </Handle>
  )
}
