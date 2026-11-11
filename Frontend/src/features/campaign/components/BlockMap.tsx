import { Check } from 'lucide-react'
import { blockBadge } from '../services/campaignView.ts'
import type { BlockView } from '../types.ts'

interface Props {
  blocks: BlockView[]
  active: number
  onSelect: (block: number) => void
}

/** Thanh 8 bước gọn trên một hàng: số thứ tự (dấu tích khi xong), tên khối và trạng thái ngắn. */
export function BlockMap({ blocks, active, onSelect }: Props) {
  return (
    <nav className="cp-steps" aria-label="Sơ đồ 8 khối">
      {blocks.map(b => {
        const badge = blockBadge(b)
        const done = badge.tone === 'ok'
        return (
          <button key={b.block} type="button" title={badge.hint || badge.label}
                  className={`cp-step cp-step-${badge.tone} ${active === b.block ? 'is-active' : ''}`}
                  aria-current={active === b.block ? 'step' : undefined} onClick={() => onSelect(b.block)}>
            <span className="cp-step-num">{done ? <Check size={13} strokeWidth={3} /> : b.block}</span>
            <span className="cp-step-text">
              <span className="cp-step-title">{b.title}</span>
              <span className="cp-step-status">{badge.label}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
