import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { PageSummary } from './useLibraryPage'
import './libraryPagination.css'

const number = new Intl.NumberFormat('vi-VN')

export function LibraryPagination({ data, label, loading, onPage, showRange = false }: {
  data: PageSummary | null
  label: string
  loading: boolean
  onPage: (page: number) => void
  showRange?: boolean
}) {
  if (!data) return null
  const pages = Math.ceil(data.total / data.page_size)
  if (pages <= 1) return null
  const start = (data.page - 1) * data.page_size + 1
  const end = Math.min(data.page * data.page_size, data.total)
  return (
    <nav className="library-pagination" aria-label={label}>
      {showRange && <span className="library-pagination-range" aria-live="polite">{number.format(start)}–{number.format(end)} / {number.format(data.total)}</span>}
      <button type="button" title="Trang trước" aria-label="Trang trước" disabled={loading || data.page === 1} onClick={() => onPage(data.page - 1)}><ChevronLeft size={16} /></button>
      <span>Trang {number.format(data.page)} / {number.format(pages)}</span>
      <button type="button" title="Trang sau" aria-label="Trang sau" disabled={loading || data.page >= pages} onClick={() => onPage(data.page + 1)}><ChevronRight size={16} /></button>
    </nav>
  )
}
