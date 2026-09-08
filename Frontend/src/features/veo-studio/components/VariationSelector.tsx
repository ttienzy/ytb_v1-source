import React from 'react'
import { Copy } from 'lucide-react'

interface Props {
  value: number // 1, 2, 3, 4
  onChange: (value: number) => void
  disabled?: boolean
}

const VARIATION_OPTIONS = [1, 2, 3, 4]

export function VariationSelector({ value, onChange, disabled }: Props) {
  return (
    <div className="veo-ribbon-item">
      <span className="veo-ribbon-label">
        <Copy size={12} />
        Biến thể:
      </span>
      <div className="veo-segmented-control veo-variation-selector">
        {VARIATION_OPTIONS.map((num) => (
          <button
            key={num}
            type="button"
            className={`veo-segment-btn veo-variation-btn ${value === num ? 'active' : ''}`}
            onClick={() => onChange(num)}
            disabled={disabled}
            title={`${num} biến thể video khác nhau từ cùng một prompt / ảnh nguồn`}
          >
            x{num}
          </button>
        ))}
      </div>
    </div>
  )
}
