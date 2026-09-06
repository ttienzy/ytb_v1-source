import React from 'react'
import { Cpu } from 'lucide-react'

interface Props {
  concurrency: number
  onChange: (value: number) => void
  disabled?: boolean
}

const CONCURRENCY_OPTIONS = [
  { value: 1, label: '1 Luồng', hint: 'Tuần tự — An toàn tuyệt đối, phù hợp mạng yếu' },
  { value: 2, label: '2 Luồng', hint: 'Khuyến nghị cho tài khoản Free — Ổn định và nhanh gấp đôi' },
  { value: 3, label: '3 Luồng', hint: 'Tối ưu tốc độ — Phù hợp khi tạo kịch bản 3-5 cảnh' },
  { value: 4, label: '4 Luồng', hint: 'Tốc độ cao — Thích hợp cho tài khoản Pro / Ultra' },
  { value: 5, label: '5 Luồng', hint: 'Tối đa — Xử lý song song cực nhanh' },
]

export function ConcurrencySelector({ concurrency, onChange, disabled }: Props) {
  const current = CONCURRENCY_OPTIONS.find((opt) => opt.value === concurrency) || CONCURRENCY_OPTIONS[1]

  return (
    <div className="veo-concurrency-box">
      <div className="veo-concurrency-head">
        <label className="veo-label">
          <Cpu size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 5 }} />
          Số luồng tạo đồng thời (Concurrency)
        </label>
        <span className="veo-concurrency-badge">
          {concurrency} {concurrency === 1 ? 'luồng' : 'luồng song song'}
        </span>
      </div>

      <div className="veo-concurrency-buttons">
        {CONCURRENCY_OPTIONS.map((opt) => {
          const isActive = opt.value === concurrency
          return (
            <button
              key={opt.value}
              type="button"
              className={`veo-concurrency-btn ${isActive ? 'active' : ''}`}
              onClick={() => onChange(opt.value)}
              disabled={disabled}
              title={opt.hint}
            >
              <span className="veo-concurrency-num">{opt.value}</span>
              <span className="veo-concurrency-txt">Luồng</span>
            </button>
          )
        })}
      </div>

      <p className="veo-concurrency-hint">
        💡 <strong>{current.label}:</strong> {current.hint}
      </p>
    </div>
  )
}
