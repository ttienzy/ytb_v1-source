import { Check } from 'lucide-react'
import { CAMPAIGN_STAGES, stageBadge } from '../services/campaignView.ts'
import type { BlockView } from '../types.ts'

interface Props {
  blocks: BlockView[]
  active: 1 | 2 | 3
  onSelect: (stage: 1 | 2 | 3) => void
}

/** Thanh 3 Chặng theo dòng tư duy Marketing Thời trang: Sản phẩm & Chiến lược -> Look & Kịch bản -> Clip & Biến thể. */
export function BlockMap({ blocks, active, onSelect }: Props) {
  return (
    <nav className="cp-steps cp-steps-3" aria-label="Sơ đồ 3 chặng Chiến dịch AI">
      {CAMPAIGN_STAGES.map(stage => {
        const badge = stageBadge(blocks, stage)
        const done = badge.tone === 'ok'
        return (
          <button
            key={stage.id}
            type="button"
            title={stage.subtitle}
            className={`cp-step cp-step-${badge.tone} ${active === stage.id ? 'is-active' : ''}`}
            aria-current={active === stage.id ? 'step' : undefined}
            data-testid={`stage-tab-${stage.id}`}
            onClick={() => onSelect(stage.id)}
          >
            <span className="cp-step-num">{done ? <Check size={13} strokeWidth={3} /> : stage.id}</span>
            <span className="cp-step-text">
              <span className="cp-step-title">{stage.title}</span>
              <span className="cp-step-status">{badge.label} · {stage.subtitle}</span>
            </span>
          </button>
        )
      })}
    </nav>
  )
}
