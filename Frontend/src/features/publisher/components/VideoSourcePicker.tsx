import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Loader2, Search, UploadCloud } from 'lucide-react'
import * as api from '../services/publisherApi'
import type { PublishableVideo, SourceType } from '../types'
import type { TargetChannelRef } from '../scheduleChecks'
import { DriveSourcePanel } from './DriveSourcePanel'
import { FilterPills, SelectionBar, VideoRow, isPostedToAny, type PostedFilter } from './VideoRows'

const TAB_KEY = 'pippit_source_tab'
const PAGE = 60

const TABS: { id: SourceType; label: string }[] = [
  { id: 'campaign', label: 'Chiến dịch AI' },
  { id: 'ai_library', label: 'Thư viện AI' },
  { id: 'recap', label: 'Recap & Audio' },
  { id: 'local', label: 'Từ máy' },
  { id: 'drive', label: 'Google Drive' },
]

const GROUP_LABEL: Record<string, string> = {
  veo: 'Flow',
  muse_canvas: 'Muse Canvas',
  motion_long: 'Motion Long',
  muse_studio: 'Muse Studio',
  processed: 'Đã xử lý / xuất ra',
}

const EMPTY_HINT: Record<string, string> = {
  campaign: 'Chưa có video ghép nào trong Chiến dịch AI. Ghép video ở bước “Ghép & Xuất” của chiến dịch rồi quay lại.',
  ai_library: 'Chưa có video AI nào trong thư viện (Flow / Muse Canvas / Motion Long).',
  recap: 'Chưa có video Recap hoàn tất (final_studio.mp4 / final_recap.mp4).',
  local: 'Chưa có video nào. Kéo thả hoặc bấm nút bên trên để chọn file từ máy tính.',
}

function readTab(): SourceType {
  const v = localStorage.getItem(TAB_KEY)
  return TABS.some(t => t.id === v) ? (v as SourceType) : 'campaign'
}

interface Props {
  selectedUids: Set<string>
  targets: TargetChannelRef[]
  refreshKey: number
  onToggle: (video: PublishableVideo) => void
  onSetMany: (videos: PublishableVideo[], on: boolean) => void
  onRegister: (videos: PublishableVideo[]) => void
}

export function VideoSourcePicker({ selectedUids, targets, refreshKey, onToggle, onSetMany, onRegister }: Props) {
  const [tab, setTab] = useState<SourceType>(readTab)
  const [query, setQuery] = useState('')
  const [debounced, setDebounced] = useState('')
  const [group, setGroup] = useState('')
  const [postedFilter, setPostedFilter] = useState<PostedFilter>('all')
  const [items, setItems] = useState<PublishableVideo[]>([])
  const [total, setTotal] = useState(0)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [groups, setGroups] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [uploading, setUploading] = useState(false)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)
  const requestId = useRef(0)

  const chooseTab = (next: SourceType) => {
    setTab(next)
    setGroup('')
    setQuery('')
    setPostedFilter('all')
    try { localStorage.setItem(TAB_KEY, next) } catch { /* bỏ qua */ }
  }

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query), 300)
    return () => window.clearTimeout(t)
  }, [query])

  const load = useCallback(async (offset: number) => {
    if (tab === 'drive') return
    const id = ++requestId.current
    setLoading(true)
    setError('')
    try {
      const res = await api.fetchSources(tab, { q: debounced, group, limit: PAGE, offset })
      if (id !== requestId.current) return
      onRegister(res.items)
      setItems(prev => (offset === 0 ? res.items : [...prev, ...res.items]))
      setTotal(res.total)
      setCounts(res.counts)
      setGroups(res.groups)
    } catch (err: any) {
      if (id === requestId.current) setError(err?.message || 'Không thể tải kho video')
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [tab, debounced, group, onRegister])

  useEffect(() => {
    void load(0)
  }, [load, refreshKey])

  const upload = async (files: File[]) => {
    const videos = files.filter(f => /\.(mp4|mov|webm|mkv|m4v)$/i.test(f.name) || f.type.startsWith('video/'))
    if (videos.length === 0) return setError('Chỉ nhận file video (.mp4, .mov, .webm, .mkv, .m4v).')
    setUploading(true)
    setError('')
    try {
      const res = await api.uploadLocalVideos(videos)
      onRegister(res.items)
      onSetMany(res.items, true)
      if (res.errors.length) setError(res.errors.join(' '))
      await load(0)
    } catch (err: any) {
      setError(err?.message || 'Không thể tải video lên')
    } finally {
      setUploading(false)
    }
  }

  const shown = useMemo(
    () => (postedFilter === 'unposted' ? items.filter(v => !isPostedToAny(v, targets)) : items),
    [items, postedFilter, targets],
  )
  const selectedInList = shown.filter(v => selectedUids.has(v.uid)).length
  const groupOptions = Object.entries(groups).map(([id, n]) => ({ id, label: `${GROUP_LABEL[id] || id} (${n})` }))

  return (
    <div className="pub2-picker">
      <div className="pub2-tabs" role="tablist">
        {TABS.map(t => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} className={`pub2-tab ${tab === t.id ? 'pub2-tab-active' : ''}`} onClick={() => chooseTab(t.id)}>
            {t.label}
            {t.id !== 'drive' && counts[t.id] !== undefined && <span className="pub2-tab-count">{counts[t.id]}</span>}
          </button>
        ))}
      </div>

      {tab === 'drive' ? (
        <DriveSourcePanel selectedUids={selectedUids} targets={targets} refreshKey={refreshKey} onToggle={onToggle} onSetMany={onSetMany} onRegister={onRegister} />
      ) : (
        <>
          {tab === 'local' && (
            <div
              className={`pub2-dropzone ${dragOver ? 'pub2-dropzone-over' : ''}`}
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => { e.preventDefault(); setDragOver(false); void upload(Array.from(e.dataTransfer.files)) }}
              onClick={() => fileInput.current?.click()}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInput.current?.click() }}
            >
              {uploading ? <Loader2 size={20} className="spin" /> : <UploadCloud size={20} />}
              <strong>{uploading ? 'Đang tải lên…' : 'Chọn hoặc kéo thả video từ máy tính'}</strong>
              <span>.mp4 .mov .webm .mkv — nhiều file một lúc, tự được chọn sau khi tải lên</span>
              <input
                ref={fileInput}
                type="file"
                accept="video/*,.mkv"
                multiple
                hidden
                data-testid="pippit-local-input"
                onChange={e => {
                  void upload(Array.from(e.target.files || []))
                  e.target.value = ''
                }}
              />
            </div>
          )}

          <div className="pub-search-box">
            <Search size={14} className="pub-search-icon" />
            <input type="text" placeholder="Tìm theo tên / nội dung video..." value={query} onChange={e => setQuery(e.target.value)} className="pub-search-input" />
          </div>
          {tab === 'ai_library' && groupOptions.length > 1 && (
            <FilterPills value={group} onChange={setGroup} options={[{ id: '', label: 'Tất cả' }, ...groupOptions]} />
          )}
          <FilterPills value={postedFilter} onChange={setPostedFilter} options={[{ id: 'all', label: `Tất cả (${total})` }, { id: 'unposted', label: '🆕 Chưa đăng' }]} />
          <SelectionBar
            total={shown.length}
            selectedInList={selectedInList}
            selectedTotal={selectedUids.size}
            onToggleAll={() => onSetMany(shown, selectedInList !== shown.length)}
            onSelectUnposted={() => onSetMany(shown.filter(v => !isPostedToAny(v, targets)), true)}
          />
          {error && <div className="pub2-inline-error">{error}</div>}

          <div className="pub-video-list">
            {loading && items.length === 0 ? (
              <div className="pub-empty-box"><Loader2 size={24} className="spin" /><p>Đang quét kho video…</p></div>
            ) : shown.length === 0 ? (
              <div className="pub-empty-box"><p>{debounced || group ? 'Không có video nào khớp bộ lọc.' : EMPTY_HINT[tab]}</p></div>
            ) : (
              shown.map(v => <VideoRow key={v.uid} video={v} selected={selectedUids.has(v.uid)} targets={targets} onToggle={() => onToggle(v)} />)
            )}
            {items.length < total && (
              <button type="button" className="pub2-mini-btn pub2-load-more" onClick={() => void load(items.length)} disabled={loading}>
                {loading ? <Loader2 size={12} className="spin" /> : null} Tải thêm ({total - items.length} video nữa)
              </button>
            )}
          </div>
        </>
      )}
    </div>
  )
}
