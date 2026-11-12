import type { KeyboardEvent, MouseEvent } from 'react'
import { HelpCircle } from 'lucide-react'
import { HINTS, type HintKey } from '../hints'
import { openHelp } from '../openHelp'
import './HelpHint.css'

/**
 * Dấu "?" nhỏ mở Tài liệu hướng dẫn đúng khối. Dùng <span role="button"> để đặt được cả bên trong nút/nhãn
 * (HTML không cho lồng <button>); chặn sự kiện để không kích hoạt phần tử cha.
 */
export function HelpHint({ hint, className = '' }: { hint: HintKey; className?: string }) {
  const target = HINTS[hint]
  const open = (event: MouseEvent | KeyboardEvent) => {
    event.preventDefault()
    event.stopPropagation()
    openHelp(target.pageId, target.anchor)
  }
  return (
    <span
      role="button"
      tabIndex={0}
      className={`help-hint ${className}`.trim()}
      title={`Xem hướng dẫn: ${target.label}`}
      aria-label={`Xem hướng dẫn: ${target.label}`}
      onClick={open}
      onKeyDown={event => {
        if (event.key === 'Enter' || event.key === ' ') open(event)
      }}
    >
      <HelpCircle size={13} />
    </span>
  )
}
