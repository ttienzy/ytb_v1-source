import React, { useEffect, useMemo, useRef, useState } from 'react'
import {
  Check,
  Compass,
  Copy,
  FolderOpen,
  HelpCircle,
  Info,
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  Search,
  Sparkles,
  Trash2,
  Upload,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import type { BgmOut } from './types'
import './BgmPage.css'

export function BgmPage() {
  const [tracks, setTracks] = useState<BgmOut[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')

  // Search & Filter state
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<'all' | 'free' | 'attribution'>('all')

  // Audio Playback state
  const [playingTrackId, setPlayingTrackId] = useState<string | null>(null)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [volume, setVolume] = useState(0.8)
  const [isMuted, setIsMuted] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  // Copy credit feedback
  const [copiedTrackId, setCopiedTrackId] = useState<string | null>(null)

  // Upload Modal State
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [uploadName, setUploadName] = useState('')
  const [uploadFile, setUploadFile] = useState<File | null>(null)
  const [uploadNeedsAttr, setUploadNeedsAttr] = useState(false)
  const [uploadDescription, setUploadDescription] = useState('')
  const [uploadLoading, setUploadLoading] = useState(false)
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  // 1. Load tracks
  function load() {
    setLoading(true)
    fetch(`${API_URL}/api/bgm`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: BgmOut[]) => {
        setTracks(d)
        setLoading(false)
      })
      .catch(() => {
        setMessage('Không thể kết nối máy chủ để tải thư viện nhạc.')
        setLoading(false)
      })
  }

  useEffect(() => {
    load()
    return () => {
      stopPreview()
    }
  }, []) // eslint-disable-line

  // 2. Audio playback helpers
  function stopPreview() {
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current = null
    }
    setPlayingTrackId(null)
    setCurrentTime(0)
    setDuration(0)
  }

  function handleTogglePlay(track: BgmOut) {
    if (playingTrackId === track.track_id) {
      if (audioRef.current && !audioRef.current.paused) {
        audioRef.current.pause()
        setPlayingTrackId(null)
      } else if (audioRef.current && audioRef.current.paused) {
        audioRef.current.play().catch(() => setPlayingTrackId(null))
        setPlayingTrackId(track.track_id)
      }
      return
    }

    stopPreview()
    const a = new Audio(`${API_URL}/api/bgm/${track.track_id}/audio`)
    a.volume = isMuted ? 0 : volume

    a.onloadedmetadata = () => {
      setDuration(a.duration || track.duration_sec || 0)
    }

    a.ontimeupdate = () => {
      setCurrentTime(a.currentTime || 0)
    }

    a.onended = () => {
      setPlayingTrackId(null)
      setCurrentTime(0)
    }

    a.onerror = () => {
      setPlayingTrackId(null)
      setMessage('Không phát được bài hát này.')
    }

    audioRef.current = a
    setPlayingTrackId(track.track_id)
    setDuration(track.duration_sec || 0)
    a.play().catch(() => setPlayingTrackId(null))
  }

  function handleScrub(e: React.MouseEvent<HTMLDivElement>) {
    if (!audioRef.current || !duration) return
    const rect = e.currentTarget.getBoundingClientRect()
    const clickX = e.clientX - rect.left
    const percent = Math.max(0, Math.min(1, clickX / rect.width))
    const newTime = percent * duration
    audioRef.current.currentTime = newTime
    setCurrentTime(newTime)
  }

  function handleVolumeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseFloat(e.target.value)
    setVolume(val)
    if (audioRef.current) {
      audioRef.current.volume = val
    }
    if (val === 0) setIsMuted(true)
    else if (isMuted) setIsMuted(false)
  }

  function toggleMute() {
    if (!audioRef.current) return
    if (isMuted) {
      audioRef.current.volume = volume || 0.8
      setIsMuted(false)
    } else {
      audioRef.current.volume = 0
      setIsMuted(true)
    }
  }

  // 3. Format seconds -> MM:SS
  function formatDuration(sec: number | null | undefined): string {
    if (!sec || isNaN(sec)) return '00:00'
    const m = Math.floor(sec / 60)
    const s = Math.floor(sec % 60)
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
  }

  // 4. Copy Credit Text
  function copyCredit(track: BgmOut) {
    const creditStr =
      track.description?.trim() ||
      `Music: ${track.name} — Licensed under Creative Commons Attribution (CC BY)`
    navigator.clipboard.writeText(creditStr).then(() => {
      setCopiedTrackId(track.track_id)
      setTimeout(() => setCopiedTrackId(null), 2000)
    })
  }

  // 5. Delete Track
  async function removeTrack(t: BgmOut) {
    if (!window.confirm(`Bạn có chắc muốn xoá bài "${t.name}" khỏi thư viện?`)) return
    if (playingTrackId === t.track_id) {
      stopPreview()
    }
    try {
      const r = await fetch(`${API_URL}/api/bgm/${t.track_id}`, { method: 'DELETE' })
      if (!r.ok) throw new Error()
      setTracks(prev => prev.filter(item => item.track_id !== t.track_id))
    } catch {
      setMessage('Xoá bài hát thất bại.')
    }
  }

  // 6. Import Folder
  async function importFolder() {
    const folder = window.prompt(
      'Nhập đường dẫn thư mục nhạc trên máy tính:',
      'C:\\Users\\nguye\\Music\\music_no_copyright'
    )
    if (!folder) return
    setImporting(true)
    setMessage('')
    try {
      const r = await fetch(`${API_URL}/api/bgm/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ folder }),
      })
      if (!r.ok) {
        const e = await r.json().catch(() => null)
        throw new Error(e?.detail || `Lỗi ${r.status}`)
      }
      const imported: BgmOut[] = await r.json()
      setMessage(`Đã nhập thành công ${imported.length} bài hát mới.`)
      load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Nhập thư mục thất bại.')
    } finally {
      setImporting(false)
    }
  }

  // 7. Handle File Selection for Upload
  function onFileSelected(f: File) {
    setUploadFile(f)
    // Tự động điền tên bài hát từ file name (loại bỏ đuôi .mp3, .wav)
    if (!uploadName.trim()) {
      const cleanName = f.name.replace(/\.[^/.]+$/, '')
      setUploadName(cleanName)
    }
  }

  // 8. Submit Upload Modal
  async function handleUploadSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!uploadFile || !uploadName.trim()) {
      alert('Vui lòng chọn file âm thanh và nhập tên bài hát.')
      return
    }
    setUploadLoading(true)
    const form = new FormData()
    form.append('name', uploadName.trim())
    form.append('audio', uploadFile)
    form.append('needs_attribution', String(uploadNeedsAttr))
    if (uploadNeedsAttr && uploadDescription.trim()) {
      form.append('description', uploadDescription.trim())
    }

    try {
      const r = await fetch(`${API_URL}/api/bgm`, {
        method: 'POST',
        body: form,
      })
      if (!r.ok) {
        const err = await r.json().catch(() => null)
        throw new Error(err?.detail || `Lỗi ${r.status}`)
      }
      const newTrack: BgmOut = await r.json()
      setTracks(prev => [newTrack, ...prev])
      setIsModalOpen(false)
      setUploadName('')
      setUploadFile(null)
      setUploadNeedsAttr(false)
      setUploadDescription('')
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Thêm bài hát thất bại.')
    } finally {
      setUploadLoading(false)
    }
  }

  // 9. Computed Metrics & Filtering
  const totalTracks = tracks.length
  const totalDurationSec = useMemo(() => {
    return tracks.reduce((acc, t) => acc + (t.duration_sec || 0), 0)
  }, [tracks])
  const totalMinutes = Math.round(totalDurationSec / 60)
  const freeTracksCount = useMemo(() => tracks.filter(t => !t.needs_attribution).length, [tracks])
  const attrTracksCount = useMemo(() => tracks.filter(t => t.needs_attribution).length, [tracks])

  const filteredTracks = useMemo(() => {
    return tracks.filter(t => {
      // Filter by tab
      if (filterTab === 'free' && t.needs_attribution) return false
      if (filterTab === 'attribution' && !t.needs_attribution) return false

      // Filter by search query
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase().trim()
        const matchName = t.name.toLowerCase().includes(q)
        const matchDesc = t.description?.toLowerCase().includes(q)
        if (!matchName && !matchDesc) return false
      }
      return true
    })
  }, [tracks, filterTab, searchQuery])

  const currentlyPlayingTrack = useMemo(() => {
    return tracks.find(t => t.track_id === playingTrackId) || null
  }, [tracks, playingTrackId])

  return (
    <div className="bgm-studio-page">
      {/* --------------------------------------------------------------------
          1. Hero Studio Banner (Harmonized Light Mode)
          -------------------------------------------------------------------- */}
      <section className="bgm-hero-banner">
        <div className="bgm-hero-top">
          <div className="bgm-hero-brand">
            <div className="bgm-badge-pill">
              <Sparkles size={11} />
              <span>Audio Studio Hub</span>
            </div>
            <div className="bgm-hero-title-row">
              <div className="bgm-hero-icon-box">
                <Music size={20} />
              </div>
              <h1 className="bgm-hero-title">Thư Viện Nhạc Nền Sáng Tạo</h1>
            </div>
            <p className="bgm-hero-desc">
              Kho nhạc nền không bản quyền (Royalty-free) tự động phối trộn dưới giọng đọc AI khi dựng video recap & shorts.
            </p>
          </div>

          <div className="bgm-hero-actions">
            <button
              type="button"
              className="bgm-btn-import"
              onClick={importFolder}
              disabled={importing}
              title="Quét toàn bộ tệp nhạc từ thư mục máy tính"
            >
              {importing ? <Loader2 size={14} className="spinning" /> : <FolderOpen size={14} />}
              <span>{importing ? 'Đang nhập...' : 'Nhập Thư Mục'}</span>
            </button>

            <button
              type="button"
              className="bgm-btn-primary"
              onClick={() => setIsModalOpen(true)}
              title="Mở hộp thoại tải lên bài hát mới"
            >
              <Plus size={15} />
              <span>Thêm Track Mới</span>
            </button>
          </div>
        </div>

        {/* Quick Metrics Bar */}
        <div className="bgm-metrics-row">
          <div className="bgm-metric-pill">
            <span>Tổng số:</span>
            <strong>{totalTracks} bài hát</strong>
          </div>
          <div className="bgm-metric-pill">
            <span>Thời lượng dự trữ:</span>
            <strong>~{totalMinutes} phút nhạc</strong>
          </div>
          <div className="bgm-metric-pill">
            <span>Miễn credit:</span>
            <strong style={{ color: '#059669' }}>{freeTracksCount} bài</strong>
          </div>
          <div className="bgm-metric-pill">
            <span>Cần ghi nguồn CC BY:</span>
            <strong style={{ color: '#b45309' }}>{attrTracksCount} bài</strong>
          </div>
        </div>
      </section>

      {message && (
        <div
          style={{
            padding: '10px 14px',
            borderRadius: 8,
            background: '#f8fafc',
            border: '1px solid #cbd5e1',
            fontSize: 12.5,
            color: '#334155',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage('')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#94a3b8' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* --------------------------------------------------------------------
          2. Search Toolbar & Filter Tabs
          -------------------------------------------------------------------- */}
      <section className="bgm-toolbar">
        <div className="bgm-search-wrap">
          <Search size={15} className="bgm-search-icon" />
          <input
            type="text"
            className="bgm-search-input"
            placeholder="Tìm bài hát theo tên hoặc mô tả bản quyền..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="bgm-search-clear"
              onClick={() => setSearchQuery('')}
              title="Xóa tìm kiếm"
            >
              <X size={14} />
            </button>
          )}
        </div>

        <div className="bgm-filter-tabs">
          <button
            type="button"
            className={`bgm-filter-btn ${filterTab === 'all' ? 'active' : ''}`}
            onClick={() => setFilterTab('all')}
          >
            Tất cả ({totalTracks})
          </button>
          <button
            type="button"
            className={`bgm-filter-btn ${filterTab === 'free' ? 'active' : ''}`}
            onClick={() => setFilterTab('free')}
          >
            Miễn credit ({freeTracksCount})
          </button>
          <button
            type="button"
            className={`bgm-filter-btn ${filterTab === 'attribution' ? 'active' : ''}`}
            onClick={() => setFilterTab('attribution')}
          >
            Cần ghi nguồn ({attrTracksCount})
          </button>
        </div>
      </section>

      {/* --------------------------------------------------------------------
          3. Interactive Track List Table
          -------------------------------------------------------------------- */}
      <section className="bgm-list-card">
        <div className="bgm-table-head">
          <span style={{ textAlign: 'center', color: '#94a3b8' }}>#</span>
          <span>Tên Bài Hát</span>
          <span>Thời Lượng</span>
          <span>Bản Quyền</span>
          <span className="bgm-col-credit">Trích Dẫn Credit</span>
          <span style={{ textAlign: 'right' }}>Thao Tác</span>
        </div>

        <div className="bgm-table-body">
          {loading ? (
            <div className="bgm-empty-state">
              <Loader2 size={24} className="spinning" style={{ color: '#6366f1' }} />
              <p>Đang tải danh sách bài hát từ kho lưu trữ...</p>
            </div>
          ) : filteredTracks.length === 0 ? (
            <div className="bgm-empty-state">
              <Music size={32} style={{ opacity: 0.35, marginBottom: 4 }} />
              <p>
                {searchQuery || filterTab !== 'all'
                  ? 'Không tìm thấy bài hát nào phù hợp với bộ lọc.'
                  : 'Thư viện nhạc hiện đang trống. Bấm "+ Thêm Track Mới" hoặc "Nhập Thư Mục" để bắt đầu.'}
              </p>
            </div>
          ) : (
            filteredTracks.map(track => {
              const isPlayingThis = playingTrackId === track.track_id
              const isCopied = copiedTrackId === track.track_id

              return (
                <div
                  key={track.track_id}
                  className={`bgm-track-row ${isPlayingThis ? 'is-playing' : ''}`}
                >
                  {/* Play / Pause / Equalizer Button */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className="bgm-play-btn"
                      onClick={() => handleTogglePlay(track)}
                      title={isPlayingThis ? 'Tạm dừng bài hát' : 'Nghe thử bài hát'}
                    >
                      {isPlayingThis ? <Pause size={14} /> : <Play size={13} style={{ marginLeft: 1 }} />}
                    </button>
                  </div>

                  {/* Track Title */}
                  <div className="bgm-track-title-col">
                    <div className="bgm-track-name-row">
                      <span className="bgm-track-name" title={track.name}>
                        {track.name}
                      </span>
                      {isPlayingThis && (
                        <div className="bgm-eq-bars" title="Đang phát">
                          <span className="bgm-eq-bar" />
                          <span className="bgm-eq-bar" />
                          <span className="bgm-eq-bar" />
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Duration */}
                  <div>
                    <span className="bgm-duration-txt">
                      {formatDuration(track.duration_sec)}
                    </span>
                  </div>

                  {/* Attribution Badge */}
                  <div>
                    {track.needs_attribution ? (
                      <span className="bgm-license-badge cc" title="Bắt buộc ghi nguồn tác giả trong mô tả video">
                        CC BY 4.0
                      </span>
                    ) : (
                      <span className="bgm-license-badge free" title="Tự do sử dụng không cần ghi nguồn">
                        Free to use
                      </span>
                    )}
                  </div>

                  {/* Copy Credit Button */}
                  <div className="bgm-col-credit">
                    {track.needs_attribution ? (
                      <button
                        type="button"
                        className={`bgm-copy-credit-btn ${isCopied ? 'copied' : ''}`}
                        onClick={() => copyCredit(track)}
                        title="Sao chép đoạn trích dẫn để dán vào mô tả YouTube"
                      >
                        {isCopied ? <Check size={12} /> : <Copy size={12} />}
                        <span>{isCopied ? 'Đã sao chép!' : 'Copy credit'}</span>
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: '#94a3b8' }}>—</span>
                    )}
                  </div>

                  {/* Delete Action */}
                  <div style={{ textAlign: 'right' }}>
                    <button
                      type="button"
                      className="bgm-btn-delete"
                      onClick={() => removeTrack(track)}
                      title="Xoá bài hát này khỏi kho"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* --------------------------------------------------------------------
          4. Floating Bottom Audio Player (Active Playback Scrub Bar)
          -------------------------------------------------------------------- */}
      {currentlyPlayingTrack && (
        <div className="bgm-floating-player">
          <div className="bgm-player-track-info">
            <div className="bgm-player-icon">
              <Music size={16} color="#ffffff" />
            </div>
            <div style={{ minWidth: 0 }}>
              <div className="bgm-player-title" title={currentlyPlayingTrack.name}>
                {currentlyPlayingTrack.name}
              </div>
              <div style={{ fontSize: 10.5, color: '#94a3b8' }}>
                {currentlyPlayingTrack.needs_attribution ? 'Bản quyền CC BY' : 'Miễn phí bản quyền'}
              </div>
            </div>
          </div>

          <div className="bgm-player-center">
            <button
              type="button"
              className="bgm-player-ctrl-btn"
              onClick={() => handleTogglePlay(currentlyPlayingTrack)}
              title={playingTrackId ? 'Tạm dừng' : 'Tiếp tục phát'}
            >
              {playingTrackId ? <Pause size={15} /> : <Play size={15} style={{ marginLeft: 2 }} />}
            </button>

            <span className="bgm-player-time">{formatDuration(currentTime)}</span>

            <div className="bgm-player-scrub-wrap" onClick={handleScrub} title="Bấm để tua vị trí">
              <div className="bgm-player-scrub-track">
                <div
                  className="bgm-player-scrub-fill"
                  style={{
                    width: `${duration > 0 ? (currentTime / duration) * 100 : 0}%`,
                  }}
                />
              </div>
            </div>

            <span className="bgm-player-time">{formatDuration(duration)}</span>
          </div>

          <div className="bgm-player-right">
            {currentlyPlayingTrack.needs_attribution && (
              <button
                type="button"
                className="bgm-copy-credit-btn"
                onClick={() => copyCredit(currentlyPlayingTrack)}
                style={{ background: 'rgba(255,255,255,0.1)', color: '#fff', border: '1px solid rgba(255,255,255,0.2)' }}
                title="Sao chép văn bản credit"
              >
                {copiedTrackId === currentlyPlayingTrack.track_id ? <Check size={12} /> : <Copy size={12} />}
                <span>{copiedTrackId === currentlyPlayingTrack.track_id ? 'Đã copy!' : 'Credit'}</span>
              </button>
            )}

            <button
              type="button"
              onClick={toggleMute}
              style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', display: 'flex' }}
              title={isMuted ? 'Bật tiếng' : 'Tắt tiếng'}
            >
              {isMuted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>

            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={isMuted ? 0 : volume}
              onChange={handleVolumeChange}
              className="bgm-vol-slider"
              title="Âm lượng"
            />

            <button
              type="button"
              className="bgm-player-close-btn"
              onClick={stopPreview}
              title="Đóng trình phát nhạc"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}

      {/* --------------------------------------------------------------------
          5. Smart Drag & Drop Upload Modal
          -------------------------------------------------------------------- */}
      {isModalOpen && (
        <div className="bgm-modal-overlay" onClick={() => !uploadLoading && setIsModalOpen(false)}>
          <div className="bgm-modal-box" onClick={e => e.stopPropagation()}>
            <div className="bgm-modal-header">
              <h3>
                <Music size={18} color="#6366f1" />
                <span>Thêm Bài Hát Mới</span>
              </h3>
              <button
                type="button"
                className="bgm-modal-close"
                onClick={() => !uploadLoading && setIsModalOpen(false)}
                title="Đóng"
              >
                <X size={16} />
              </button>
            </div>

            <form onSubmit={handleUploadSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              {/* Drag and Drop Zone */}
              <div
                className={`bgm-dropzone ${isDragging ? 'dragging' : ''}`}
                onDragOver={e => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => {
                  e.preventDefault()
                  setIsDragging(false)
                  const f = e.dataTransfer.files?.[0]
                  if (f) onFileSelected(f)
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const f = e.target.files?.[0]
                    if (f) onFileSelected(f)
                  }}
                />
                <div className="bgm-dropzone-icon">
                  <Upload size={22} />
                </div>
                {uploadFile ? (
                  <>
                    <p className="bgm-dropzone-title" style={{ color: '#4f46e5' }}>
                      Đã chọn: {uploadFile.name}
                    </p>
                    <p className="bgm-dropzone-sub">Bấm vào đây để chọn tệp âm thanh khác</p>
                  </>
                ) : (
                  <>
                    <p className="bgm-dropzone-title">Kéo &amp; thả tệp nhạc vào đây, hoặc nhấn để chọn</p>
                    <p className="bgm-dropzone-sub">Hỗ trợ định dạng MP3, WAV, AAC, OGG</p>
                  </>
                )}
              </div>

              {/* Track Name */}
              <div className="bgm-field-group">
                <label className="bgm-field-label">Tên bài hát</label>
                <input
                  type="text"
                  className="bgm-modal-input"
                  placeholder="Ví dụ: carefree-by-kevin-macleod"
                  value={uploadName}
                  onChange={e => setUploadName(e.target.value)}
                  required
                />
              </div>

              {/* Attribution Toggle */}
              <label className="bgm-toggle-label">
                <input
                  type="checkbox"
                  checked={uploadNeedsAttr}
                  onChange={e => setUploadNeedsAttr(e.target.checked)}
                  style={{ width: 16, height: 16, accentColor: '#6366f1', cursor: 'pointer' }}
                />
                <span>Bắt buộc ghi nguồn credit (Creative Commons CC BY)</span>
              </label>

              {/* Credit Description */}
              {uploadNeedsAttr && (
                <div className="bgm-field-group">
                  <label className="bgm-field-label">
                    Đoạn văn bản ghi nguồn <span>(dán vào mô tả video YouTube)</span>
                  </label>
                  <textarea
                    rows={3}
                    className="bgm-modal-textarea"
                    placeholder="Ví dụ: Carefree by Kevin MacLeod (incompetech.com) — Licensed under Creative Commons: By Attribution 4.0..."
                    value={uploadDescription}
                    onChange={e => setUploadDescription(e.target.value)}
                  />
                </div>
              )}

              {/* Modal Footer Buttons */}
              <div className="bgm-modal-footer">
                <button
                  type="button"
                  className="bgm-btn-import"
                  onClick={() => setIsModalOpen(false)}
                  disabled={uploadLoading}
                >
                  Hủy
                </button>
                <button
                  type="submit"
                  className="bgm-btn-primary"
                  disabled={uploadLoading || !uploadFile || !uploadName.trim()}
                >
                  {uploadLoading ? <Loader2 size={15} className="spinning" /> : <Plus size={15} />}
                  <span>{uploadLoading ? 'Đang tải lên...' : 'Lưu Vào Kho Nhạc'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
