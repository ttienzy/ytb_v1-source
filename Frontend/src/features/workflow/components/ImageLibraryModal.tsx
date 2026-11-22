/**
 * Thư Viện Ảnh (Canvas AI): ảnh Muse tạo (tự lưu) + ảnh bạn tải lên, để dùng lại.
 * - Mở từ toolbar: xem / đặt tên / yêu thích / xóa / tải lên.
 * - Chế độ chọn (pickMode): node gọi để lấy 1 ảnh — "Dùng ảnh này" hoặc nháy đúp.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Check,
  Copy,
  ExternalLink,
  FolderOpen,
  ImageIcon,
  Loader2,
  RefreshCw,
  Search,
  Sparkles,
  Star,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import {
  deleteLibraryImage,
  formatBytes,
  libraryImageUrl,
  listLibraryImages,
  openLibraryFolder,
  updateLibraryImage,
  uploadLibraryImage,
  type LibraryImage,
} from '../services/imageLibraryApi'
import './imageLibrary.css'

type Filter = 'all' | 'muse' | 'chatgpt' | 'upload' | 'favorite'

interface ImageLibraryModalProps {
  isOpen: boolean
  onClose: () => void
  onCountChange?: (count: number) => void
  /** Chế độ chọn: có nút "Dùng ảnh này" */
  pickMode?: boolean
  pickTitle?: string
  onPick?: (item: LibraryImage) => void
  multiPick?: boolean
  onPickMulti?: (items: LibraryImage[]) => void
}

const FILTERS: { id: Filter; label: string }[] = [
  { id: 'all', label: 'Tất cả' },
  { id: 'muse', label: 'Muse tạo' },
  { id: 'chatgpt', label: 'GPT tạo' },
  { id: 'upload', label: 'Tải lên' },
  { id: 'favorite', label: 'Yêu thích' },
]

const SOURCE_LABEL: Record<string, string> = { muse: 'Muse', chatgpt: 'GPT', upload: 'Tải lên' }

function formatTime(sec: number): string {
  if (!sec) return '—'
  return new Date(sec * 1000).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit', year: 'numeric' })
}

export function ImageLibraryModal({ isOpen, onClose, onCountChange, pickMode, pickTitle, onPick, multiPick, onPickMulti }: ImageLibraryModalProps) {
  const [items, setItems] = useState<LibraryImage[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedMultiImages, setSelectedMultiImages] = useState<Map<string, LibraryImage>>(new Map())
  const [uploading, setUploading] = useState(0)
  const [dragOver, setDragOver] = useState(false)
  const [labelDraft, setLabelDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const all = await listLibraryImages()
      setItems(all)
      onCountChange?.(all.length)
      setSelectedId((cur) => (cur && all.some((i) => i.id === cur) ? cur : all[0]?.id ?? null))
      setSelectedMultiImages(new Map())
    } catch (e: any) {
      setError(e?.message || 'Không tải được Thư Viện Ảnh')
    } finally {
      setLoading(false)
    }
  }, [onCountChange])

  useEffect(() => {
    if (isOpen) load()
  }, [isOpen, load])

  useEffect(() => {
    if (!isOpen) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [isOpen, onClose])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return items.filter((i) => {
      if (filter === 'favorite' && !i.favorite) return false
      if ((filter === 'muse' || filter === 'chatgpt' || filter === 'upload') && i.source !== filter) return false
      if (!q) return true
      return [i.label, i.file_name, i.meta?.chat_title, i.meta?.prompt?.slice(0, 400), ...(i.tags || [])]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q)
    })
  }, [items, filter, query])

  const selected = items.find((i) => i.id === selectedId) || null
  useEffect(() => setLabelDraft(selected?.label || ''), [selected?.id, selected?.label])

  const replaceItem = (it: LibraryImage) => setItems((xs) => xs.map((x) => (x.id === it.id ? it : x)))

  async function upload(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => /\.(png|jpe?g|webp|gif)$/i.test(f.name))
    if (!list.length) {
      setError('Chỉ nhận ảnh PNG, JPG, WebP hoặc GIF.')
      return
    }
    setError('')
    setUploading((n) => n + list.length)
    let last: LibraryImage | null = null
    for (const f of list) {
      try {
        last = await uploadLibraryImage(f)
      } catch (e: any) {
        setError(`“${f.name}”: ${e?.message || 'tải lên thất bại'}`)
      } finally {
        setUploading((n) => n - 1)
      }
    }
    await load()
    if (last) setSelectedId(last.id)
  }

  async function saveLabel() {
    if (!selected || labelDraft.trim() === selected.label) return
    try {
      replaceItem(await updateLibraryImage(selected.id, { label: labelDraft }))
    } catch (e: any) {
      setError(e?.message || 'Không đổi được tên')
      setLabelDraft(selected.label)
    }
  }

  async function toggleFavorite(it: LibraryImage) {
    try {
      replaceItem(await updateLibraryImage(it.id, { favorite: !it.favorite }))
    } catch (e: any) {
      setError(e?.message || 'Không cập nhật được')
    }
  }

  async function remove(it: LibraryImage) {
    const where = it.source === 'muse' || it.source === 'chatgpt' ? 'File ảnh trong Data/media/muse_outputs cũng bị xóa.' : 'File ảnh tải lên cũng bị xóa.'
    if (!window.confirm(`Xóa “${it.label}” khỏi Thư Viện Ảnh? ${where} Node đang dùng ảnh này sẽ mất ảnh.`)) return
    try {
      await deleteLibraryImage(it.id)
      await load()
    } catch (e: any) {
      setError(e?.message || 'Không xóa được')
    }
  }

  if (!isOpen) return null

  return createPortal(
    <div className="il-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className={`il-panel ${dragOver ? 'drag' : ''}`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={(e) => e.currentTarget === e.target && setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files?.length) upload(e.dataTransfer.files)
        }}
      >
        {/* Header */}
        <header className="il-head">
          <div className="il-title">
            <ImageIcon size={17} />
            <strong>{pickMode ? pickTitle || 'Chọn ảnh từ Thư Viện Ảnh' : 'Thư Viện Ảnh'}</strong>
            <span className="il-pill">{items.length}</span>
          </div>
          <div className="il-search">
            <Search size={13} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Tìm theo tên, prompt, chat…" />
          </div>
          <div className="il-filters">
            {FILTERS.map((f) => (
              <button key={f.id} type="button" className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
                {f.id === 'favorite' && <Star size={11} />} {f.label}
              </button>
            ))}
          </div>
          <div className="il-actions">
            {multiPick && (
              <button
                type="button"
                className="il-primary"
                disabled={selectedMultiImages.size === 0}
                onClick={() => {
                  onPickMulti?.(Array.from(selectedMultiImages.values()))
                  onClose()
                }}
                style={{
                  height: 30,
                  padding: '0 12px',
                  borderRadius: 6,
                  border: 'none',
                  background: selectedMultiImages.size === 0 ? '#94a3b8' : '#2563eb',
                  color: '#ffffff',
                  fontSize: 12,
                  fontWeight: 700,
                  cursor: selectedMultiImages.size === 0 ? 'not-allowed' : 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <Check size={13} /> Thêm {selectedMultiImages.size} ảnh đã chọn
              </button>
            )}
            <button type="button" onClick={() => fileRef.current?.click()} disabled={uploading > 0} title="Tải ảnh của bạn vào thư viện (hoặc kéo thả vào cửa sổ)">
              {uploading > 0 ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />} Tải ảnh lên
            </button>
            <button type="button" onClick={() => openLibraryFolder().catch((e) => setError(e.message))} title="Mở thư mục ảnh">
              <FolderOpen size={13} />
            </button>
            <button type="button" onClick={load} title="Tải lại">
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
            <button type="button" className="il-close" onClick={onClose} title="Đóng (Esc)">
              <X size={16} />
            </button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) upload(e.target.files)
              e.target.value = ''
            }}
          />
        </header>
        {error && <div className="il-error">{error}</div>}

        <div className="il-body">
          {/* Lưới ảnh */}
          <div className="il-grid-wrap">
            {loading && items.length === 0 ? (
              <div className="il-empty"><Loader2 size={20} className="animate-spin" /> Đang tải…</div>
            ) : visible.length === 0 ? (
              <div className="il-empty">
                <Sparkles size={20} />
                <strong>{items.length === 0 ? 'Thư viện đang trống' : 'Không có ảnh khớp bộ lọc'}</strong>
                <span>
                  Ảnh do Muse tạo (vd. node “Tách áo quần”) tự lưu vào đây. Bạn cũng có thể kéo thả ảnh vào cửa sổ này hoặc bấm “Tải ảnh lên”.
                </span>
              </div>
            ) : (
              <div className="il-grid">
                {visible.map((it) => {
                  const isMulti = multiPick && selectedMultiImages.has(it.id)
                  return (
                    <button
                      key={it.id}
                      type="button"
                      className={`il-card ${it.id === selectedId || isMulti ? 'on' : ''}`}
                      onClick={() => {
                        setSelectedId(it.id)
                        if (multiPick) {
                          setSelectedMultiImages((prev) => {
                            const next = new Map(prev)
                            if (next.has(it.id)) next.delete(it.id)
                            else next.set(it.id, it)
                            return next
                          })
                        }
                      }}
                      onDoubleClick={() => pickMode && !multiPick && onPick?.(it)}
                      title={multiPick ? (isMulti ? 'Bấm để bỏ chọn' : 'Bấm để chọn') : pickMode ? 'Nháy đúp để dùng ảnh này' : it.label}
                    >
                      {multiPick && (
                        <span
                          style={{
                            position: 'absolute',
                            top: 6,
                            left: 6,
                            width: 20,
                            height: 20,
                            borderRadius: 4,
                            background: isMulti ? '#2563eb' : 'rgba(0,0,0,0.4)',
                            border: isMulti ? '2px solid #fff' : '1px solid rgba(255,255,255,0.8)',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            zIndex: 2,
                            boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                          }}
                        >
                          {isMulti && <Check size={12} strokeWidth={3} />}
                        </span>
                      )}
                      <span className="il-thumb">
                        <img src={libraryImageUrl(it)} alt={it.label} loading="lazy" draggable={false} />
                      </span>
                      <span className="il-card-meta">
                        <span className="il-card-label">{it.label}</span>
                        <span className={`il-src il-src-${it.source}`}>{SOURCE_LABEL[it.source] || it.source}</span>
                      </span>
                      {it.favorite && <Star size={12} className="il-star" />}
                    </button>
                  )
                })}
              </div>
            )}
          </div>

          {/* Chi tiết */}
          <aside className="il-detail">
            {selected ? (
              <>
                <a className="il-big" href={libraryImageUrl(selected)} target="_blank" rel="noreferrer" title="Mở ảnh gốc">
                  <img src={libraryImageUrl(selected)} alt={selected.label} draggable={false} />
                </a>
                <div className="il-label-row">
                  <input
                    value={labelDraft}
                    maxLength={120}
                    onChange={(e) => setLabelDraft(e.target.value)}
                    onBlur={saveLabel}
                    onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                    title="Đổi tên ảnh"
                  />
                  <button type="button" className={`il-fav ${selected.favorite ? 'on' : ''}`} onClick={() => toggleFavorite(selected)} title="Yêu thích">
                    <Star size={14} />
                  </button>
                </div>
                <dl className="il-info">
                  <dt>Nguồn</dt>
                  <dd>{selected.source === 'muse' ? 'Muse tạo' : selected.source === 'chatgpt' ? 'ChatGPT tạo' : 'Bạn tải lên'}</dd>
                  <dt>Tạo lúc</dt>
                  <dd>{formatTime(selected.created_at)}</dd>
                  <dt>Kích thước</dt>
                  <dd>
                    {selected.width && selected.height ? `${selected.width}×${selected.height}px · ` : ''}
                    {formatBytes(selected.size)}
                  </dd>
                  {selected.meta?.account_label && (
                    <>
                      <dt>Tài khoản</dt>
                      <dd>{selected.meta.account_label}</dd>
                    </>
                  )}
                  {selected.meta?.chat_title && (
                    <>
                      <dt>Chat Muse</dt>
                      <dd>{selected.meta.chat_title}</dd>
                    </>
                  )}
                </dl>
                {selected.meta?.prompt && (
                  <details className="il-prompt">
                    <summary>Prompt đã dùng</summary>
                    <pre>{selected.meta.prompt}</pre>
                  </details>
                )}
                <div className="il-path" title={selected.path}>{selected.path}</div>
                <div className="il-detail-actions">
                  {pickMode && !multiPick && (
                    <button type="button" className="il-primary" onClick={() => onPick?.(selected)}>
                      <Check size={14} /> Dùng ảnh này
                    </button>
                  )}
                  {multiPick && (
                    <button
                      type="button"
                      className="il-primary"
                      onClick={() => {
                        setSelectedMultiImages((prev) => {
                          const next = new Map(prev)
                          if (next.has(selected.id)) next.delete(selected.id)
                          else next.set(selected.id, selected)
                          return next
                        })
                      }}
                    >
                      <Check size={14} /> {selectedMultiImages.has(selected.id) ? 'Bỏ chọn ảnh này' : 'Chọn ảnh này'}
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(selected.path)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 1500)
                    }}
                  >
                    {copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Đã chép' : 'Chép đường dẫn'}
                  </button>
                  <a className="il-btn-link" href={libraryImageUrl(selected)} target="_blank" rel="noreferrer">
                    <ExternalLink size={13} /> Mở
                  </a>
                  <button type="button" className="il-danger" onClick={() => remove(selected)} title="Xóa khỏi thư viện">
                    <Trash2 size={13} />
                  </button>
                </div>
              </>
            ) : (
              <div className="il-empty small">Chọn một ảnh để xem chi tiết.</div>
            )}
          </aside>
        </div>
        {dragOver && <div className="il-drop">Thả ảnh để thêm vào thư viện</div>}
      </div>
    </div>,
    document.body,
  )
}
