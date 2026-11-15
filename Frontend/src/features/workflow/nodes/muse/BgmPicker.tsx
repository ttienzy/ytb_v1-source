/**
 * Chọn nhạc nền từ Thư viện nhạc, có nghe thử từng bài ngay trong danh sách (▶ / ⏸) trước khi chọn.
 * Chỉ một bài phát thử một lúc trên toàn app (dùng chung 1 thẻ Audio); rời node thì dừng.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, Loader2, Music, Pause, Play, RefreshCw, Search } from 'lucide-react'
import { bgmAudioUrl, type BgmTrackLite } from '../../services/museCanvasApi.ts'

const G = globalThis as unknown as { __musePreviewAudio?: HTMLAudioElement }
function previewAudio(): HTMLAudioElement {
  if (!G.__musePreviewAudio) G.__musePreviewAudio = new Audio()
  return G.__musePreviewAudio
}

const fmt = (s: number) => {
  if (!Number.isFinite(s) || s < 0) return '0:00'
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

interface BgmPickerProps {
  tracks: BgmTrackLite[] | null
  error?: string
  selectedId: string
  onSelect: (id: string) => void
  onReload: () => void
}

export function BgmPicker({ tracks, error, selectedId, onSelect, onReload }: BgmPickerProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [playingId, setPlayingId] = useState('')
  const [loadingId, setLoadingId] = useState('')
  const [pos, setPos] = useState({ t: 0, d: 0 })
  const owner = useRef(Symbol('bgm-preview'))
  const box = useRef<HTMLDivElement>(null)

  const selected = tracks?.find((t) => t.id === selectedId)
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return (tracks ?? []).filter((t) => !q || t.name.toLowerCase().includes(q))
  }, [query, tracks])

  // Theo dõi thẻ Audio dùng chung: chỉ cập nhật khi chính picker này đang phát
  useEffect(() => {
    const a = previewAudio()
    const mine = () => (a as any).__owner === owner.current
    const onTime = () => mine() && setPos({ t: a.currentTime, d: a.duration || 0 })
    const onPlaying = () => mine() && setLoadingId('')
    const onStop = () => {
      if (!mine()) {
        setPlayingId('')
        setLoadingId('')
        return
      }
      if (a.paused || a.ended) setPlayingId('')
    }
    a.addEventListener('timeupdate', onTime)
    a.addEventListener('playing', onPlaying)
    a.addEventListener('pause', onStop)
    a.addEventListener('ended', onStop)
    a.addEventListener('play', onStop)
    return () => {
      a.removeEventListener('timeupdate', onTime)
      a.removeEventListener('playing', onPlaying)
      a.removeEventListener('pause', onStop)
      a.removeEventListener('ended', onStop)
      a.removeEventListener('play', onStop)
      if (mine()) a.pause()
    }
  }, [])

  // Đóng danh sách khi bấm ra ngoài
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as globalThis.Node)) setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [open])

  function togglePreview(id: string) {
    const a = previewAudio()
    if (playingId === id && !a.paused) {
      a.pause()
      setPlayingId('')
      return
    }
    ;(a as any).__owner = owner.current
    a.src = bgmAudioUrl(id)
    a.currentTime = 0
    setPos({ t: 0, d: 0 })
    setPlayingId(id)
    setLoadingId(id)
    a.play().catch(() => {
      setPlayingId('')
      setLoadingId('')
    })
  }

  const playBtn = (id: string, title: string) => (
    <button
      type="button"
      className={`mc-bgm-play ${playingId === id ? 'on' : ''}`}
      onClick={(e) => {
        e.stopPropagation()
        togglePreview(id)
      }}
      title={playingId === id ? 'Dừng nghe thử' : title}
    >
      {loadingId === id ? <Loader2 size={11} className="animate-spin" /> : playingId === id ? <Pause size={11} /> : <Play size={11} />}
    </button>
  )

  return (
    <div className="mc-bgm nodrag" ref={box}>
      <div className="mc-bgm-bar">
        <button type="button" className="mc-bgm-current" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          <Music size={11} />
          <span>{selected ? selected.name : selectedId ? '(bài đã chọn không còn trong thư viện)' : '— Không nhạc —'}</span>
          <ChevronDown size={12} />
        </button>
        {selected && playBtn(selected.id, 'Nghe thử bài đang chọn')}
        <button type="button" className="mc-mini-btn" onClick={onReload} title="Tải lại Thư viện nhạc">
          <RefreshCw size={11} />
        </button>
      </div>
      {playingId && (
        <div className="mc-bgm-progress" title="Đang nghe thử">
          <span>{tracks?.find((t) => t.id === playingId)?.name ?? ''}</span>
          <div className="mc-bgm-track">
            <div style={{ width: `${pos.d ? Math.min(100, (pos.t / pos.d) * 100) : 0}%` }} />
          </div>
          <small>
            {fmt(pos.t)} / {fmt(pos.d)}
          </small>
        </div>
      )}
      {open && (
        <div className="mc-bgm-list nowheel">
          {(tracks?.length ?? 0) > 6 && (
            <label className="mc-bgm-search">
              <Search size={11} />
              <input value={query} placeholder="Tìm bài…" onChange={(e) => setQuery(e.target.value)} autoFocus />
            </label>
          )}
          <button
            type="button"
            className={`mc-bgm-item ${!selectedId ? 'on' : ''}`}
            onClick={() => {
              onSelect('')
              setOpen(false)
            }}
          >
            <span className="mc-bgm-spacer" />
            <span className="mc-bgm-name">— Không nhạc —</span>
            {!selectedId && <Check size={12} />}
          </button>
          {tracks === null && <div className="mc-bgm-empty">Đang tải Thư viện nhạc…</div>}
          {error && <div className="mc-node-error">{error}</div>}
          {tracks && tracks.length === 0 && !error && <div className="mc-bgm-empty">Thư viện nhạc trống — thêm nhạc ở trang “Thư viện nhạc”.</div>}
          {shown.map((t) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              className={`mc-bgm-item ${t.id === selectedId ? 'on' : ''}`}
              onClick={() => {
                onSelect(t.id)
                setOpen(false)
              }}
              onKeyDown={(e) => e.key === 'Enter' && onSelect(t.id)}
              title="Bấm để chọn bài này; ▶ để nghe thử"
            >
              {playBtn(t.id, 'Nghe thử')}
              <span className="mc-bgm-name">{t.name}</span>
              {t.durationSec > 0 && <small>{fmt(t.durationSec)}</small>}
              {t.id === selectedId && <Check size={12} />}
            </div>
          ))}
          {tracks && tracks.length > 0 && shown.length === 0 && <div className="mc-bgm-empty">Không có bài khớp “{query}”.</div>}
        </div>
      )}
    </div>
  )
}
