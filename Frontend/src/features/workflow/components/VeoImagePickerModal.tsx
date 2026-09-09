import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  FolderOpen,
  Image as ImageIcon,
  Loader2,
  X,
  Search,
  Film,
  Sparkles,
  Info,
} from 'lucide-react'
import * as veoApi from '../../veo-studio/services/veoApi'
import type { VeoImageItem } from '../../veo-studio/types'
import type { AssetRef } from '../contracts'

interface Props {
  isOpen: boolean
  onClose: () => void
  onSelect: (dataUrl: string, assetRef: AssetRef, item: VeoImageItem) => void
  targetLabel?: string
  kind?: 'product' | 'model' | 'scene'
}

async function fetchImageAsDataUrl(url: string): Promise<string> {
  const resp = await fetch(url)
  const blob = await resp.blob()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function VeoImagePickerModal({
  isOpen,
  onClose,
  onSelect,
  targetLabel,
  kind = 'product',
}: Props) {
  const [images, setImages] = useState<VeoImageItem[]>([])
  const [loading, setLoading] = useState(false)
  const [selectingId, setSelectingId] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [filterType, setFilterType] = useState<'all' | 'frames' | 'nano'>('all')

  useEffect(() => {
    if (!isOpen) return
    setLoading(true)
    setSearchQuery('')
    setFilterType('all')
    veoApi
      .getImages()
      .then((list) => setImages(list || []))
      .catch((err) => {
        console.error('Lỗi khi tải thư viện ảnh Veo:', err)
        setImages([])
      })
      .finally(() => setLoading(false))
  }, [isOpen])

  // Lắng nghe phím ESC để đóng modal
  useEffect(() => {
    if (!isOpen) return
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  const filteredImages = useMemo(() => {
    return images.filter((item) => {
      const isFrame = item.prompt?.includes('[Frame cuối]')
      if (filterType === 'frames' && !isFrame) return false
      if (filterType === 'nano' && isFrame) return false

      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase().trim()
        const matchPrompt = item.prompt?.toLowerCase().includes(query)
        const matchRatio = item.aspect_ratio?.toLowerCase().includes(query)
        return matchPrompt || matchRatio
      }
      return true
    })
  }, [images, filterType, searchQuery])

  if (!isOpen) return null

  const handlePick = async (item: VeoImageItem) => {
    setSelectingId(item.id)
    try {
      const fileUrl = veoApi.getImageFileUrl(item.id)
      const dataUrl = await fetchImageAsDataUrl(fileUrl)

      const assetRef: AssetRef = {
        id: `veo_${item.id}`,
        kind,
        previewUrl: fileUrl,
        backendPath: item.local_path || `Data/media/veo_images/${item.id}.jpg`,
        fileName: `${item.id}.jpg`,
        uploadStatus: 'uploaded',
      }

      onSelect(dataUrl, assetRef, item)
      onClose()
    } catch (err) {
      console.error('Lỗi khi nạp ảnh từ thư viện Veo:', err)
      alert('Không thể nạp ảnh từ thư viện Veo. Vui lòng thử lại.')
    } finally {
      setSelectingId(null)
    }
  }

  const modalContent = (
    <div className="wf-veo-picker-backdrop" onClick={onClose}>
      <div
        className="wf-veo-picker-modal"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="wf-veo-picker-header">
          <div className="wf-veo-picker-header-left">
            <div className="wf-veo-picker-icon-badge">
              <FolderOpen size={16} />
            </div>
            <div className="wf-veo-picker-title-group">
              <div className="wf-veo-picker-title">
                <span>Thư Viện Veo Studio</span>
                {targetLabel && <span className="wf-veo-picker-target-tag">{targetLabel}</span>}
              </div>
              <span className="wf-veo-picker-sub">
                {loading ? 'Đang kiểm tra thư viện...' : `${images.length} hình ảnh sẵn có`}
              </span>
            </div>
          </div>
          <button
            type="button"
            className="wf-veo-picker-close-btn"
            onClick={onClose}
            title="Đóng (ESC)"
          >
            <X size={15} />
          </button>
        </div>

        {/* Toolbar: Tìm kiếm & Lọc nhanh */}
        <div className="wf-veo-picker-toolbar">
          <div className="wf-veo-picker-search-box">
            <Search size={13} color="#94a3b8" />
            <input
              type="text"
              className="wf-veo-picker-search-input"
              placeholder="Tìm kiếm theo mô tả, từ khóa..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: '#94a3b8' }}
              >
                <X size={12} />
              </button>
            )}
          </div>

          <div className="wf-veo-picker-filter-tabs">
            <button
              type="button"
              className={`wf-veo-picker-filter-btn ${filterType === 'all' ? 'active' : ''}`}
              onClick={() => setFilterType('all')}
            >
              Tất cả ({images.length})
            </button>
            <button
              type="button"
              className={`wf-veo-picker-filter-btn ${filterType === 'frames' ? 'active' : ''}`}
              onClick={() => setFilterType('frames')}
            >
              <Film size={11} />
              Frame cuối
            </button>
            <button
              type="button"
              className={`wf-veo-picker-filter-btn ${filterType === 'nano' ? 'active' : ''}`}
              onClick={() => setFilterType('nano')}
            >
              <Sparkles size={11} />
              Ảnh AI
            </button>
          </div>
        </div>

        {/* Body: Lưới ảnh thumbnail nhỏ gọn */}
        <div className="wf-veo-picker-body">
          {loading ? (
            <div className="veo-picker-loading" style={{ padding: '60px 20px', textAlign: 'center' }}>
              <Loader2 size={24} className="spinning" style={{ margin: '0 auto 10px', color: '#475569' }} />
              <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>Đang tải danh sách ảnh Veo Studio...</p>
            </div>
          ) : images.length === 0 ? (
            <div className="veo-picker-empty" style={{ padding: '60px 20px', textAlign: 'center' }}>
              <ImageIcon size={36} color="#94a3b8" style={{ margin: '0 auto 10px' }} />
              <h4 style={{ margin: '0 0 6px', color: '#1e293b', fontSize: 14 }}>Chưa có hình ảnh nào trong Thư viện Veo</h4>
              <p style={{ color: '#64748b', fontSize: 12, margin: 0, maxWidth: 380, lineHeight: 1.4 }}>
                Bạn có thể tạo video và bấm <strong>[ Lưu frame cuối ]</strong> hoặc sinh ảnh bằng <strong>Nano Banana Pro</strong> trong Veo Studio.
              </p>
            </div>
          ) : filteredImages.length === 0 ? (
            <div className="veo-picker-empty" style={{ padding: '60px 20px', textAlign: 'center' }}>
              <Search size={32} color="#94a3b8" style={{ margin: '0 auto 8px' }} />
              <p style={{ color: '#64748b', fontSize: 13, margin: 0 }}>Không tìm thấy ảnh phù hợp với điều kiện tìm kiếm.</p>
            </div>
          ) : (
            <div className="wf-veo-picker-grid">
              {filteredImages.map((item) => {
                const isSelected = selectingId === item.id
                const isFrame = item.prompt?.includes('[Frame cuối]')
                const cleanPrompt = item.prompt
                  ? item.prompt.replace(/^\[Frame cuối\]\s*/i, '')
                  : 'Hình ảnh Veo Studio'

                return (
                  <div
                    key={item.id}
                    className="wf-veo-picker-card"
                    onClick={() => !selectingId && handlePick(item)}
                    title={item.prompt || 'Nhấp để chọn ảnh'}
                    style={{ cursor: selectingId ? 'wait' : 'pointer' }}
                  >
                    <div className="wf-veo-picker-thumb">
                      <img
                        src={veoApi.getImageFileUrl(item.id)}
                        alt={cleanPrompt}
                        loading="lazy"
                        onError={(e) => {
                          if (item.image_url && (e.target as HTMLImageElement).src !== item.image_url) {
                            ;(e.target as HTMLImageElement).src = item.image_url
                          }
                        }}
                      />
                      <span className="wf-veo-picker-badge-ratio">{item.aspect_ratio || '16:9'}</span>
                      {isFrame ? (
                        <span className="wf-veo-picker-badge-type">
                          <Film size={8} />
                          Frame
                        </span>
                      ) : (
                        <span className="wf-veo-picker-badge-type" style={{ color: '#a78bfa' }}>
                          <Sparkles size={8} />
                          AI
                        </span>
                      )}

                      {isSelected && (
                        <div
                          style={{
                            position: 'absolute',
                            inset: 0,
                            background: 'rgba(15, 23, 42, 0.75)',
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            justifyContent: 'center',
                            color: '#fff',
                            fontSize: 11,
                            fontWeight: 600,
                            gap: 4,
                            zIndex: 3,
                          }}
                        >
                          <Loader2 size={16} className="spinning" />
                          <span>Đang nạp...</span>
                        </div>
                      )}
                    </div>
                    <div className="wf-veo-picker-card-info">
                      <p className="wf-veo-picker-card-prompt">
                        {cleanPrompt}
                      </p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="wf-veo-picker-footer">
          <div className="wf-veo-picker-hint">
            <Info size={13} color="#64748b" />
            <span>Nhấp vào ảnh để chọn nạp vào luồng • Nhấn ESC để đóng</span>
          </div>
          <button
            type="button"
            className="wf-veo-picker-cancel-btn"
            onClick={onClose}
          >
            Đóng
          </button>
        </div>
      </div>
    </div>
  )

  return createPortal(modalContent, document.body)
}
