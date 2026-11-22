/**
 * Hộp nhập chữ trong app — thay cho window.prompt(), thứ Electron KHÔNG hỗ trợ (gọi là báo lỗi
 * "prompt() is and will not be supported", nút bấm như không làm gì).
 *
 *   const [askText, promptDialog] = useTextPrompt()
 *   const name = await askText({ title: 'Project mới', label: 'Tên project', defaultValue: 'Áo xanh' })  // null = hủy
 *   return <>{promptDialog} …</>
 */
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'

export interface TextPromptOptions {
  title: string
  /** Câu giải thích dưới tiêu đề (tùy chọn) */
  message?: ReactNode
  label?: string
  defaultValue?: string
  placeholder?: string
  confirmLabel?: string
  maxLength?: number
}

interface Pending extends TextPromptOptions {
  resolve: (value: string | null) => void
}

export function useTextPrompt(): [(opts: TextPromptOptions) => Promise<string | null>, ReactNode] {
  const [pending, setPending] = useState<Pending | null>(null)
  const ask = useCallback(
    (opts: TextPromptOptions) =>
      new Promise<string | null>((resolve) => {
        setPending((prev) => {
          prev?.resolve(null) // hộp cũ còn mở: coi như hủy
          return { ...opts, resolve }
        })
      }),
    [],
  )
  const close = useCallback(
    (value: string | null) => {
      pending?.resolve(value)
      setPending(null)
    },
    [pending],
  )
  return [ask, pending ? <TextPromptDialog key={pending.title} {...pending} onClose={close} /> : null]
}

function TextPromptDialog({
  title,
  message,
  label,
  defaultValue = '',
  placeholder,
  confirmLabel = 'OK',
  maxLength = 80,
  onClose,
}: TextPromptOptions & { onClose: (value: string | null) => void }) {
  const [value, setValue] = useState(defaultValue)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    input.current?.focus()
    input.current?.select()
  }, [])
  const trimmed = value.trim()
  const submit = () => trimmed && onClose(trimmed)

  return (
    <div
      className="mc-dialog-backdrop"
      onMouseDown={(e) => e.target === e.currentTarget && onClose(null)}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation()
          onClose(null)
        }
      }}
    >
      <form
        className="mc-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <h3>{title}</h3>
        {message && <p className="mc-dialog-msg">{message}</p>}
        <label className="mc-field">
          {label && <span>{label}</span>}
          <input
            ref={input}
            className="mc-input"
            value={value}
            maxLength={maxLength}
            placeholder={placeholder}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
        <div className="mc-dialog-actions">
          <button type="button" className="mc-mini-btn" onClick={() => onClose(null)}>
            Hủy
          </button>
          <button type="submit" className="mc-mini-btn mc-mini-accent" disabled={!trimmed}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
