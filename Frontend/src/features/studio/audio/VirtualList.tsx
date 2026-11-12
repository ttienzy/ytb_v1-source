import { useEffect, useRef, useState, type ReactNode } from 'react'

interface VirtualListProps<T> {
  items: T[]
  rowHeight: number
  renderRow: (item: T, index: number) => ReactNode
  getKey: (item: T) => string
  className?: string
  overscan?: number
  /** Cuộn tới mục có key này khi nó thay đổi (vd truyện đang chọn). */
  scrollToKey?: string | null
}

/** Danh sách ảo hóa theo chiều cao hàng cố định: chỉ render các hàng nhìn thấy — danh sách vài nghìn truyện vẫn mượt. */
export function VirtualList<T>({ items, rowHeight, renderRow, getKey, className, overscan = 6, scrollToKey }: VirtualListProps<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [height, setHeight] = useState(400)

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setHeight(el.clientHeight || 400)
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  // Đổi bộ lọc/tìm kiếm → về đầu danh sách.
  const firstKey = items.length ? getKey(items[0]) : ''
  useEffect(() => {
    if (ref.current) ref.current.scrollTop = 0
    setScrollTop(0)
  }, [firstKey, items.length])

  useEffect(() => {
    if (!scrollToKey || !ref.current) return
    const index = items.findIndex(item => getKey(item) === scrollToKey)
    if (index < 0) return
    const top = index * rowHeight
    const el = ref.current
    if (top < el.scrollTop || top + rowHeight > el.scrollTop + el.clientHeight) el.scrollTop = Math.max(0, top - el.clientHeight / 2 + rowHeight / 2)
  }, [scrollToKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan)
  const end = Math.min(items.length, Math.ceil((scrollTop + height) / rowHeight) + overscan)

  return (
    <div ref={ref} className={className} onScroll={event => setScrollTop(event.currentTarget.scrollTop)} role="listbox">
      <div style={{ height: items.length * rowHeight, position: 'relative' }}>
        {items.slice(start, end).map((item, offset) => (
          <div key={getKey(item)} style={{ position: 'absolute', top: (start + offset) * rowHeight, left: 0, right: 0, height: rowHeight }}>
            {renderRow(item, start + offset)}
          </div>
        ))}
      </div>
    </div>
  )
}
