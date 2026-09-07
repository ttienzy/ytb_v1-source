import React from 'react'
import { Cpu } from 'lucide-react'

interface Props {
  concurrency: number
  onChange: (value: number) => void
  disabled?: boolean
}

const CONCURRENCY_OPTIONS = [1, 2, 3, 4, 5]

export function ConcurrencySelector({ concurrency, onChange, disabled }: Props) {
  return (
    <div className="veo-ribbon-item">
      <span className="veo-ribbon-label">
        <Cpu size={12} />
        Luồng:
      </span>
      <div className="veo-segmented-control">
        {CONCURRENCY_OPTIONS.map((num) => (
          <button
            key={num}
            type="button"
            className={`veo-segment-btn ${concurrency === num ? 'active' : ''}`}
            onClick={() => onChange(num)}
            disabled={disabled}
            title={`${num} luồng tạo đồng thời song song`}
          >
            {num}x
          </button>
        ))}
      </div>
    </div>
  )
}

