import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  Bookmark,
  BookmarkCheck,
  Check,
  CheckSquare,
  Clock,
  Compass,
  Copy,
  ExternalLink,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Send,
  Sparkles,
  Square,
  TrendingUp,
  Tv,
  Video,
  X,
} from 'lucide-react'
import * as api from './services/discoverApi'
import type { ChannelVideo, DiscoveredChannel, QuickCategory } from './types'

const QUICK_CATEGORIES: QuickCategory[] = [
  { id: 'street_food', label: 'Street Food Châu Á', query: 'Top English YouTube channels reviewing Asian street food Vietnam Thailand Pakistan India' },
  { id: 'challenge', label: 'Thử thách ăn khổng lồ', query: 'Famous food challenge eating massive burger pizza restaurant record YouTube channels' },
  { id: 'exotic', label: 'Ẩm thực độc lạ & Món cay', query: 'Crazy exotic food spicy challenge tribal food world travel review YouTube channels' },
  { id: 'chef', label: 'Bếp trưởng & Kỹ nghệ nấu ăn', query: 'Masterchef legendary cooking but better fast food recreate YouTube channels' },
  { id: 'legendary', label: 'Quán ăn huyền thoại US/EU', query: 'Iconic eats legendary street food best in town New York Europe YouTube channels' },
  { id: 'buffet', label: 'Buffet & Hải sản khổng lồ', query: 'Giant seafood buffet all you can eat night market food tour YouTube channels' },
]

const GRADIENT_PALETTES = [
  'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
  'linear-gradient(135deg, #0284c7 0%, #0369a1 100%)',
  'linear-gradient(135deg, #059669 0%, #047857 100%)',
  'linear-gradient(135deg, #d97706 0%, #b45309 100%)',
  'linear-gradient(135deg, #e11d48 0%, #be123c 100%)',
  'linear-gradient(135deg, #7c3aed 0%, #6d28d9 100%)',
  'linear-gradient(135deg, #0d9488 0%, #0f766e 100%)',
]

function getChannelColor(str: string): string {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  const idx = Math.abs(hash) % GRADIENT_PALETTES.length
  return GRADIENT_PALETTES[idx]
}

function getChannelInitials(name: string): string {
  if (!name) return 'YT'
  const words = name.trim().split(/\s+/)
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

interface DiscoverPageProps {
  onSendToStudioBatch?: (urls: string[]) => void
  setActivePage?: (page: string) => void
}

export function DiscoverPage({ onSendToStudioBatch, setActivePage }: DiscoverPageProps) {
  // Channels State
  const [presetChannels, setPresetChannels] = useState<DiscoveredChannel[]>([])
  const [savedChannels, setSavedChannels] = useState<DiscoveredChannel[]>([])
  const [searchResults, setSearchResults] = useState<DiscoveredChannel[]>([])
  const [activeCategory, setActiveCategory] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<DiscoveredChannel | null>(null)
  const [failedAvatars, setFailedAvatars] = useState<Record<string, boolean>>({})

  // Videos State
  const [videos, setVideos] = useState<ChannelVideo[]>([])
  const [loadingVideos, setLoadingVideos] = useState(false)
  const [videoFilter, setVideoFilter] = useState<'all' | 'golden' | 'views' | 'unprocessed' | 'completed'>('all')
  const [selectedVideoUrls, setSelectedVideoUrls] = useState<string[]>([])
  const [addChannelModalOpen, setAddChannelModalOpen] = useState(false)
  const [newChannelInput, setNewChannelInput] = useState('')
  const [addingChannel, setAddingChannel] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)

  function showToast(text: string) {
    setToastMsg(text)
    setTimeout(() => setToastMsg(null), 4000)
  }

  // Load initial preset and saved channels
  const loadInitialData = useCallback(async () => {
    try {
      const [presets, saved] = await Promise.all([
        api.fetchPresetChannels().catch(() => []),
        api.fetchSavedChannels().catch(() => []),
      ])
      setPresetChannels(presets)
      setSavedChannels(saved)
      if (presets.length > 0 && !selectedChannel) {
        setSelectedChannel(presets[0])
      }
    } catch (err) {
      console.error(err)
    }
  }, [selectedChannel])

  useEffect(() => {
    loadInitialData()
  }, []) // eslint-disable-line

  // Load videos whenever selectedChannel changes
  const loadVideosForChannel = useCallback(async (channel: DiscoveredChannel) => {
    setLoadingVideos(true)
    setVideos([])
    setSelectedVideoUrls([])
    try {
      const res = await api.fetchChannelVideos(channel.channel_url || channel.handle, 30)
      setVideos(res.videos || [])
      // Update avatar if missing
      if (res.avatar_url && (!channel.avatar_url || failedAvatars[channel.handle])) {
        channel.avatar_url = res.avatar_url
        setFailedAvatars(prev => ({ ...prev, [channel.handle]: false }))
      }
    } catch (err: any) {
      showToast(`Lỗi quét video: ${err.message || 'Không tải được video kênh'}`)
    } finally {
      setLoadingVideos(false)
    }
  }, [failedAvatars])

  useEffect(() => {
    if (selectedChannel) {
      loadVideosForChannel(selectedChannel)
    }
  }, [selectedChannel, loadVideosForChannel])

  // Handle Gemini AI Channel Search
  async function handleGeminiSearch(customQuery?: string) {
    const q = (customQuery !== undefined ? customQuery : searchQuery).trim()
    if (!q) {
      showToast('Vui lòng nhập từ khóa tìm kiếm')
      return
    }
    setSearching(true)
    try {
      const data = await api.searchChannelsWithGemini(q, activeCategory || undefined)
      setSearchResults(data.results || [])
      if (data.results && data.results.length > 0) {
        setSelectedChannel(data.results[0])
        showToast(`Gemini đã gợi ý ${data.results.length} kênh phù hợp!`)
      } else {
        showToast('Không tìm thấy kênh phù hợp.')
      }
    } catch (err: any) {
      showToast(`Lỗi tìm kiếm: ${err.message || 'Gemini không phản hồi'}`)
    } finally {
      setSearching(false)
    }
  }

  // Handle Quick Category Click
  function handleCategoryClick(cat: QuickCategory) {
    if (activeCategory === cat.id) {
      setActiveCategory(null)
      setSearchQuery('')
      setSearchResults([])
    } else {
      setActiveCategory(cat.id)
      setSearchQuery(cat.label)
      handleGeminiSearch(cat.query)
    }
  }

  // Add Custom Channel
  async function handleAddCustomChannel() {
    const raw = newChannelInput.trim()
    if (!raw) {
      showToast('Vui lòng nhập link hoặc @handle kênh YouTube')
      return
    }
    setAddingChannel(true)
    try {
      const res = await api.saveCustomChannel({ handle: raw })
      if (res.channel) {
        setSavedChannels(prev => [res.channel, ...prev.filter(c => c.handle !== res.channel.handle)])
        setSelectedChannel(res.channel)
        setAddChannelModalOpen(false)
        setNewChannelInput('')
        showToast(`Đã thêm thành công kênh "${res.channel.name}"!`)
      }
    } catch (err: any) {
      showToast(`Không thể thêm kênh: ${err.message || 'Lỗi kết nối'}`)
    } finally {
      setAddingChannel(false)
    }
  }

  // Toggle Save Channel
  async function handleToggleSaveChannel(channel: DiscoveredChannel) {
    const isSaved = savedChannels.some(c => c.handle === channel.handle || c.channel_url === channel.channel_url)
    try {
      if (isSaved) {
        await api.deleteSavedChannel(channel.handle)
        setSavedChannels(prev => prev.filter(c => c.handle !== channel.handle && c.channel_url !== channel.channel_url))
        showToast(`Đã xóa kênh "${channel.name}" khỏi danh sách lưu`)
      } else {
        await api.saveCustomChannel(channel)
        setSavedChannels(prev => [channel, ...prev])
        showToast(`Đã lưu kênh "${channel.name}" vào danh sách yêu thích!`)
      }
    } catch (err: any) {
      showToast(err.message || 'Lỗi thao tác lưu kênh')
    }
  }

  // Video Selection
  function toggleSelectVideo(url: string) {
    const target = videos.find(v => v.url === url)
    if (target && target.processed_status === 'completed' && !selectedVideoUrls.includes(url)) {
      showToast(`ℹ️ Video "${target.title.slice(0, 28)}..." đã làm recap (${target.processed_date || 'Trước đó'}). Bạn vẫn có thể chọn để làm lại.`)
    }
    setSelectedVideoUrls(prev =>
      prev.includes(url) ? prev.filter(u => u !== url) : [...prev, url]
    )
  }

  function handleSelectAll() {
    if (selectedVideoUrls.length === displayedVideos.length) {
      setSelectedVideoUrls([])
    } else {
      setSelectedVideoUrls(displayedVideos.map(v => v.url))
    }
  }

  // Completed & Unprocessed Counts
  const completedCount = useMemo(() => videos.filter(v => v.processed_status === 'completed').length, [videos])
  const unprocessedCount = useMemo(() => videos.filter(v => v.processed_status !== 'completed' && v.processed_status !== 'processing').length, [videos])

  // Filtered & Sorted Videos
  const displayedVideos = useMemo(() => {
    let list = [...videos]
    if (videoFilter === 'golden') {
      list = list.filter(v => v.is_golden_duration || (v.duration_sec && v.duration_sec >= 300 && v.duration_sec <= 1080))
    } else if (videoFilter === 'views') {
      list.sort((a, b) => (b.view_count || 0) - (a.view_count || 0))
    } else if (videoFilter === 'unprocessed') {
      list = list.filter(v => v.processed_status !== 'completed' && v.processed_status !== 'processing')
    } else if (videoFilter === 'completed') {
      list = list.filter(v => v.processed_status === 'completed')
    }
    return list
  }, [videos, videoFilter])

  // Transfer selected videos to Studio Batch Queue
  function handleSendToStudio() {
    if (selectedVideoUrls.length === 0) {
      showToast('Vui lòng tích chọn ít nhất 1 video để chuyển sang Studio')
      return
    }
    if (onSendToStudioBatch) {
      onSendToStudioBatch(selectedVideoUrls)
    } else if (setActivePage) {
      setActivePage('Workflow')
    }
  }

  // Copy Links
  function handleCopyLinks() {
    if (selectedVideoUrls.length === 0) return
    navigator.clipboard.writeText(selectedVideoUrls.join('\n'))
    showToast(`Đã sao chép ${selectedVideoUrls.length} link video vào Clipboard!`)
  }

  // Combined channels list for Left Column
  const channelsToDisplay = useMemo(() => {
    if (searchResults.length > 0) return searchResults
    return [...savedChannels, ...presetChannels.filter(p => !savedChannels.some(s => s.handle === p.handle))]
  }, [searchResults, savedChannels, presetChannels])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, maxWidth: 1400, margin: '0 auto', paddingBottom: 90 }}>
      {/* Toast Notification */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            top: 20,
            right: 24,
            zIndex: 99999,
            background: '#0f172a',
            color: '#fff',
            padding: '10px 16px',
            borderRadius: 10,
            fontSize: 13,
            fontWeight: 600,
            boxShadow: '0 10px 25px rgba(0,0,0,0.2)',
            display: 'flex',
            alignItems: 'center',
            gap: 8,
          }}
        >
          <Sparkles size={15} color="#38bdf8" />
          <span>{toastMsg}</span>
        </div>
      )}

      {/* Header Banner */}
      <div
        className="card"
        style={{
          padding: 20,
          background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #311042 100%)',
          color: '#fff',
          borderRadius: 16,
          boxShadow: '0 8px 30px rgba(15, 23, 42, 0.25)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div
                style={{
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  background: 'rgba(255,255,255,0.12)',
                  backdropFilter: 'blur(8px)',
                  display: 'grid',
                  placeItems: 'center',
                }}
              >
                <Compass size={20} color="#38bdf8" />
              </div>
              <h1 style={{ fontSize: 19, fontWeight: 800, margin: 0, letterSpacing: '-0.02em' }}>
                Khám Phá Kênh &amp; Săn Video Ẩm Thực
              </h1>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: '#94a3b8' }}>
              Dùng <strong>AI Gemini</strong> rà soát các kênh ẩm thực tiếng Anh nổi tiếng thế giới ➔ Quét video tự động ➔ Đẩy 1-chạm sang Studio Recap.
            </p>
          </div>

          <div style={{ display: 'flex', gap: 8 }}>
            <button
              type="button"
              className="btn-p"
              onClick={() => setAddChannelModalOpen(true)}
              style={{ background: 'rgba(255,255,255,0.15)', backdropFilter: 'blur(8px)', border: '1px solid rgba(255,255,255,0.2)', fontSize: 12.5 }}
            >
              <Plus size={14} /> Thêm Kênh YouTube
            </button>
          </div>
        </div>

        {/* AI Gemini Search Input */}
        <div style={{ marginTop: 16, display: 'flex', gap: 8 }}>
          <div style={{ position: 'relative', flex: 1 }}>
            <input
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleGeminiSearch()}
              placeholder="Nhập yêu cầu: vd 'Kênh review đồ ăn đường phố Châu Á hài hước', 'Thử thách ăn khổng lồ ở Mỹ'..."
              style={{
                width: '100%',
                height: 42,
                borderRadius: 10,
                border: '1px solid rgba(255,255,255,0.2)',
                background: 'rgba(255,255,255,0.08)',
                color: '#fff',
                padding: '0 14px 0 38px',
                fontSize: 13,
                outline: 'none',
              }}
            />
            <Search size={16} style={{ position: 'absolute', left: 12, top: 13, color: '#94a3b8' }} />
          </div>

          <button
            type="button"
            className="btn-p"
            onClick={() => handleGeminiSearch()}
            disabled={searching}
            style={{
              height: 42,
              padding: '0 18px',
              background: 'linear-gradient(135deg, #0284c7 0%, #4f46e5 100%)',
              fontWeight: 700,
              fontSize: 13,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              boxShadow: '0 4px 14px rgba(79, 70, 229, 0.4)',
            }}
          >
            {searching ? <Loader2 size={15} className="spin" /> : <Sparkles size={15} />}
            {searching ? 'Gemini đang quét…' : 'Gemini Quét Kênh'}
          </button>
        </div>

        {/* Professional Quick Category Tags (No Childish Icons) */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {QUICK_CATEGORIES.map(cat => {
            const active = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                type="button"
                onClick={() => handleCategoryClick(cat)}
                style={{
                  height: 30,
                  padding: '0 12px',
                  borderRadius: 6,
                  border: active ? '1.5px solid #38bdf8' : '1px solid rgba(255,255,255,0.15)',
                  background: active ? 'rgba(56, 189, 248, 0.2)' : 'rgba(255,255,255,0.05)',
                  color: active ? '#38bdf8' : '#cbd5e1',
                  fontSize: 12,
                  fontWeight: active ? 700 : 500,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  whiteSpace: 'nowrap',
                  transition: 'all 0.15s ease',
                }}
              >
                {cat.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* Main 2-Column Split View */}
      <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: 16, alignItems: 'flex-start' }}>
        {/* Left Column: Channels Hub */}
        <div className="card" style={{ padding: 14, background: '#fff', borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8, borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: '#0f172a', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Tv size={15} color="#4f46e5" />
              <span>{searchResults.length > 0 ? `Kết quả Gemini (${searchResults.length})` : `Kênh Ẩm Thực (${channelsToDisplay.length})`}</span>
            </div>

            {searchResults.length > 0 && (
              <button
                type="button"
                className="btn-cancel"
                onClick={() => {
                  setSearchResults([])
                  setSearchQuery('')
                  setActiveCategory(null)
                }}
                style={{ padding: '2px 6px', fontSize: 11 }}
              >
                Đặt lại
              </button>
            )}
          </div>

          {/* Channel List */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 'calc(100vh - 360px)', overflowY: 'auto', paddingRight: 2 }}>
            {channelsToDisplay.map((c, idx) => {
              const isSelected = selectedChannel?.handle === c.handle || selectedChannel?.channel_url === c.channel_url
              const isSaved = savedChannels.some(s => s.handle === c.handle || s.channel_url === c.channel_url)
              const hasAvatarFailed = failedAvatars[c.handle]
              const showImg = Boolean(c.avatar_url && !hasAvatarFailed)

              return (
                <div
                  key={c.id || c.handle || idx}
                  onClick={() => setSelectedChannel(c)}
                  style={{
                    padding: 10,
                    borderRadius: 10,
                    border: isSelected ? '2px solid #4f46e5' : '1px solid #e2e8f0',
                    background: isSelected ? '#f5f3ff' : '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    gap: 10,
                    alignItems: 'center',
                    transition: 'all 0.15s ease',
                  }}
                >
                  {/* Channel Avatar with Graceful Gradient Fallback */}
                  <div style={{ width: 42, height: 42, borderRadius: 999, overflow: 'hidden', flexShrink: 0, border: '1px solid #e2e8f0', background: '#f8fafc' }}>
                    {showImg ? (
                      <img
                        src={c.avatar_url}
                        alt=""
                        onError={() => setFailedAvatars(prev => ({ ...prev, [c.handle]: true }))}
                        style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                      />
                    ) : (
                      <div
                        style={{
                          width: '100%',
                          height: '100%',
                          display: 'grid',
                          placeItems: 'center',
                          background: getChannelColor(c.name),
                          color: '#fff',
                          fontSize: 13,
                          fontWeight: 700,
                          letterSpacing: '0.04em',
                        }}
                      >
                        {getChannelInitials(c.name)}
                      </div>
                    )}
                  </div>

                  {/* Channel Details */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <strong style={{ fontSize: 12.5, color: '#0f172a', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={c.name}>
                        {c.name}
                      </strong>
                      <button
                        type="button"
                        onClick={e => {
                          e.stopPropagation()
                          handleToggleSaveChannel(c)
                        }}
                        title={isSaved ? 'Bỏ lưu kênh' : 'Lưu kênh vào yêu thích'}
                        style={{ border: 'none', background: 'transparent', padding: 2, cursor: 'pointer', color: isSaved ? '#4f46e5' : '#94a3b8' }}
                      >
                        {isSaved ? <BookmarkCheck size={15} /> : <Bookmark size={15} />}
                      </button>
                    </div>

                    <div style={{ fontSize: 11, color: '#64748b', display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                      <span>{c.handle}</span>
                      {c.subscribers && <span>· <strong>{c.subscribers}</strong></span>}
                    </div>

                    {c.category_label && (
                      <span
                        style={{
                          display: 'inline-block',
                          marginTop: 4,
                          fontSize: 10,
                          fontWeight: 600,
                          padding: '1px 6px',
                          borderRadius: 4,
                          background: isSelected ? '#ede9fe' : '#f1f5f9',
                          color: isSelected ? '#5b21b6' : '#475569',
                        }}
                      >
                        {c.category_label}
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Right Column: Videos Grid */}
        <div className="card" style={{ padding: 16, background: '#fff', borderRadius: 14, display: 'flex', flexDirection: 'column', gap: 14 }}>
          {/* Channel Header Info & Filters */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12, paddingBottom: 12, borderBottom: '1px solid #f1f5f9' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {selectedChannel && (
                <div style={{ width: 34, height: 34, borderRadius: 999, overflow: 'hidden', border: '1px solid #e2e8f0', flexShrink: 0 }}>
                  {selectedChannel.avatar_url && !failedAvatars[selectedChannel.handle] ? (
                    <img
                      src={selectedChannel.avatar_url}
                      alt=""
                      onError={() => setFailedAvatars(prev => ({ ...prev, [selectedChannel.handle]: true }))}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                    />
                  ) : (
                    <div
                      style={{
                        width: '100%',
                        height: '100%',
                        display: 'grid',
                        placeItems: 'center',
                        background: getChannelColor(selectedChannel.name),
                        color: '#fff',
                        fontSize: 12,
                        fontWeight: 700,
                      }}
                    >
                      {getChannelInitials(selectedChannel.name)}
                    </div>
                  )}
                </div>
              )}
              <div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <strong style={{ fontSize: 15, color: '#0f172a' }}>{selectedChannel?.name || 'Chọn một kênh'}</strong>
                  {selectedChannel?.channel_url && (
                    <a
                      href={selectedChannel.channel_url}
                      target="_blank"
                      rel="noreferrer"
                      title="Mở kênh trên YouTube"
                      style={{ color: '#64748b', display: 'inline-flex', alignItems: 'center' }}
                    >
                      <ExternalLink size={13} />
                    </a>
                  )}
                </div>
                <div style={{ fontSize: 11.5, color: '#64748b' }}>
                  {loadingVideos ? 'Đang quét danh sách video…' : `Tìm thấy ${videos.length} video mới nhất`}
                </div>
              </div>
            </div>

            {/* Filter Pills */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => setVideoFilter('all')}
                style={{
                  height: 28,
                  padding: '0 10px',
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  border: videoFilter === 'all' ? 'none' : '1px solid #e2e8f0',
                  background: videoFilter === 'all' ? '#0f172a' : '#fff',
                  color: videoFilter === 'all' ? '#fff' : '#475569',
                  cursor: 'pointer',
                }}
              >
                Tất cả ({videos.length})
              </button>

              <button
                type="button"
                onClick={() => setVideoFilter('unprocessed')}
                title="Chỉ hiển thị các video mới tinh chưa từng được tạo recap"
                style={{
                  height: 28,
                  padding: '0 10px',
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  border: videoFilter === 'unprocessed' ? 'none' : '1px solid #bae6fd',
                  background: videoFilter === 'unprocessed' ? '#0284c7' : '#f0f9ff',
                  color: videoFilter === 'unprocessed' ? '#fff' : '#0369a1',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <Sparkles size={12} /> Chưa làm ({unprocessedCount})
              </button>

              {completedCount > 0 && (
                <button
                  type="button"
                  onClick={() => setVideoFilter('completed')}
                  title="Các video đã từng được tạo recap thành công"
                  style={{
                    height: 28,
                    padding: '0 10px',
                    borderRadius: 6,
                    fontSize: 11.5,
                    fontWeight: 600,
                    border: videoFilter === 'completed' ? 'none' : '1px solid #ddd6fe',
                    background: videoFilter === 'completed' ? '#7c3aed' : '#f5f3ff',
                    color: videoFilter === 'completed' ? '#fff' : '#6d28d9',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 5,
                  }}
                >
                  <Check size={12} strokeWidth={3} /> Đã làm ({completedCount})
                </button>
              )}

              <button
                type="button"
                onClick={() => setVideoFilter('golden')}
                title="Lọc video từ 5 đến 18 phút — độ dài chuẩn nhất để Recap"
                style={{
                  height: 28,
                  padding: '0 10px',
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  border: videoFilter === 'golden' ? 'none' : '1px solid #86efac',
                  background: videoFilter === 'golden' ? '#16a34a' : '#f0fdf4',
                  color: videoFilter === 'golden' ? '#fff' : '#15803d',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <Clock size={13} /> 5–18 phút (Chuẩn Recap)
              </button>

              <button
                type="button"
                onClick={() => setVideoFilter('views')}
                title="Sắp xếp theo số lượng lượt xem cao nhất"
                style={{
                  height: 28,
                  padding: '0 10px',
                  borderRadius: 6,
                  fontSize: 11.5,
                  fontWeight: 600,
                  border: videoFilter === 'views' ? 'none' : '1px solid #fde047',
                  background: videoFilter === 'views' ? '#ca8a04' : '#fefce8',
                  color: videoFilter === 'views' ? '#fff' : '#854d0e',
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                }}
              >
                <TrendingUp size={13} /> Lượt xem cao nhất
              </button>

              {selectedChannel && (
                <button
                  type="button"
                  className="btn-cancel"
                  onClick={() => loadVideosForChannel(selectedChannel)}
                  disabled={loadingVideos}
                  title="Quét lại video mới nhất"
                  style={{ height: 28, padding: '0 8px', display: 'inline-flex', alignItems: 'center' }}
                >
                  <RefreshCw size={12} className={loadingVideos ? 'spin' : ''} />
                </button>
              )}
            </div>
          </div>

          {/* Quick Select All Header */}
          {displayedVideos.length > 0 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px' }}>
              <button
                type="button"
                onClick={handleSelectAll}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  color: '#4f46e5',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                }}
              >
                {selectedVideoUrls.length === displayedVideos.length ? <CheckSquare size={15} /> : <Square size={15} />}
                {selectedVideoUrls.length === displayedVideos.length ? 'Bỏ chọn tất cả' : 'Chọn tất cả video trong danh sách'}
              </button>

              <span style={{ fontSize: 11.5, color: '#64748b' }}>
                Đã tích chọn <strong>{selectedVideoUrls.length}</strong> video
              </span>
            </div>
          )}

          {/* Videos Grid */}
          {loadingVideos ? (
            <div style={{ padding: 60, textAlign: 'center', color: '#64748b' }}>
              <Loader2 size={28} className="spin" style={{ margin: '0 auto 10px', color: '#4f46e5' }} />
              <div style={{ fontSize: 13, fontWeight: 600 }}>Đang quét nhanh video của kênh…</div>
              <div style={{ fontSize: 11.5, color: '#94a3b8', marginTop: 4 }}>Không tiêu tốn quota Google API</div>
            </div>
          ) : displayedVideos.length === 0 ? (
            <div style={{ padding: 50, textAlign: 'center', color: '#94a3b8', fontSize: 13 }}>
              Không có video nào khớp với bộ lọc hiện tại.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 14 }}>
              {displayedVideos.map(v => {
                const isSelected = selectedVideoUrls.includes(v.url)
                const isCompleted = v.processed_status === 'completed'
                const isProcessing = v.processed_status === 'processing'
                return (
                  <div
                    key={v.id}
                    onClick={() => toggleSelectVideo(v.url)}
                    style={{
                      borderRadius: 10,
                      border: isSelected ? '2px solid #4f46e5' : isCompleted ? '1px solid #cbd5e1' : '1px solid #e2e8f0',
                      background: isSelected ? '#faf5ff' : '#fff',
                      overflow: 'hidden',
                      cursor: 'pointer',
                      display: 'flex',
                      flexDirection: 'column',
                      boxShadow: isSelected ? '0 4px 12px rgba(79, 70, 229, 0.15)' : 'none',
                      opacity: isCompleted && !isSelected ? 0.88 : 1,
                      transition: 'all 0.15s ease',
                    }}
                  >
                    {/* Thumbnail & Badges */}
                    <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: '#0f172a' }}>
                      {v.thumbnail_url ? (
                        <img src={v.thumbnail_url} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      ) : (
                        <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', color: '#94a3b8' }}>
                          <Video size={24} />
                        </div>
                      )}

                      {/* Checkbox badge on top-left */}
                      <div
                        style={{
                          position: 'absolute',
                          top: 8,
                          left: 8,
                          width: 24,
                          height: 24,
                          borderRadius: 6,
                          background: isSelected ? '#4f46e5' : 'rgba(15, 23, 42, 0.65)',
                          backdropFilter: 'blur(4px)',
                          color: '#fff',
                          display: 'grid',
                          placeItems: 'center',
                          border: isSelected ? 'none' : '1px solid rgba(255,255,255,0.4)',
                        }}
                      >
                        {isSelected && <Check size={14} strokeWidth={3} />}
                      </div>

                      {/* History Status Badge on top-right */}
                      {isCompleted && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: 'rgba(124, 58, 237, 0.94)',
                            backdropFilter: 'blur(6px)',
                            color: '#fff',
                            fontSize: 10.5,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                          }}
                          title={`Đã hoàn thành recap ${v.processed_date ? `(${v.processed_date})` : ''}`}
                        >
                          <Check size={11} strokeWidth={3} /> Đã làm {v.processed_date ? `(${v.processed_date})` : ''}
                        </div>
                      )}

                      {isProcessing && (
                        <div
                          style={{
                            position: 'absolute',
                            top: 8,
                            right: 8,
                            padding: '3px 8px',
                            borderRadius: 6,
                            background: 'rgba(217, 119, 6, 0.94)',
                            backdropFilter: 'blur(6px)',
                            color: '#fff',
                            fontSize: 10.5,
                            fontWeight: 700,
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
                          }}
                        >
                          <Loader2 size={11} className="spin" /> Đang render
                        </div>
                      )}

                      {/* Duration badge on bottom-right */}
                      <div
                        style={{
                          position: 'absolute',
                          bottom: 8,
                          right: 8,
                          padding: '2px 6px',
                          borderRadius: 4,
                          background: v.is_golden_duration ? '#16a34a' : 'rgba(15, 23, 42, 0.8)',
                          color: '#fff',
                          fontSize: 11,
                          fontWeight: 700,
                          letterSpacing: '0.02em',
                        }}
                      >
                        {v.duration_formatted}
                      </div>
                    </div>

                    {/* Content Details */}
                    <div style={{ padding: 10, flex: 1, display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                      <div
                        style={{
                          fontSize: 12.5,
                          fontWeight: 700,
                          color: '#0f172a',
                          lineHeight: 1.35,
                          display: '-webkit-box',
                          WebkitLineClamp: 2,
                          WebkitBoxOrient: 'vertical',
                          overflow: 'hidden',
                        }}
                        title={v.title}
                      >
                        {v.title}
                      </div>

                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 8, fontSize: 11, color: '#64748b' }}>
                        <span>{v.view_count_formatted}</span>
                        <a
                          href={v.url}
                          target="_blank"
                          rel="noreferrer"
                          onClick={e => e.stopPropagation()}
                          title="Xem trên YouTube"
                          style={{ color: '#64748b', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 2 }}
                        >
                          <ExternalLink size={12} />
                        </a>
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {/* Sticky Bottom Action Bar */}
      {/* Sleek & Compact Floating Action Bar */}
      {selectedVideoUrls.length > 0 && (
        <div
          style={{
            position: 'fixed',
            bottom: 22,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 9999,
            background: 'rgba(15, 23, 42, 0.94)',
            color: '#f8fafc',
            padding: '6px 14px',
            borderRadius: 999,
            boxShadow: '0 12px 32px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(255, 255, 255, 0.12)',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            backdropFilter: 'blur(16px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <span
              style={{
                padding: '2px 8px',
                borderRadius: 999,
                background: '#4f46e5',
                color: '#fff',
                fontSize: 11.5,
                fontWeight: 700,
                display: 'grid',
                placeItems: 'center',
              }}
            >
              {selectedVideoUrls.length}
            </span>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#e2e8f0', whiteSpace: 'nowrap' }}>video đã chọn</span>
          </div>

          <div style={{ height: 16, width: 1, background: 'rgba(255, 255, 255, 0.18)' }} />

          <button
            type="button"
            onClick={handleCopyLinks}
            style={{
              height: 30,
              padding: '0 12px',
              fontSize: 11.5,
              fontWeight: 500,
              color: '#f8fafc',
              background: 'rgba(255, 255, 255, 0.08)',
              border: '1px solid rgba(255, 255, 255, 0.18)',
              borderRadius: 999,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 5,
              whiteSpace: 'nowrap',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.16)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)')}
          >
            <Copy size={12} /> Sao chép {selectedVideoUrls.length} link
          </button>

          <button
            type="button"
            onClick={handleSendToStudio}
            style={{
              height: 30,
              padding: '0 14px',
              fontSize: 12,
              fontWeight: 700,
              color: '#ffffff',
              background: 'linear-gradient(135deg, #4f46e5 0%, #6366f1 100%)',
              border: 'none',
              borderRadius: 999,
              cursor: 'pointer',
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              whiteSpace: 'nowrap',
              boxShadow: '0 2px 10px rgba(79, 70, 229, 0.4)',
              transition: 'all 0.15s ease',
            }}
            onMouseEnter={e => (e.currentTarget.style.filter = 'brightness(1.1)')}
            onMouseLeave={e => (e.currentTarget.style.filter = 'none')}
          >
            <Send size={12} /> Đưa vào Studio Recap ➔
          </button>
        </div>
      )}

      {/* Add Custom Channel Modal */}
      {addChannelModalOpen && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 10000,
            background: 'rgba(15, 23, 42, 0.65)',
            backdropFilter: 'blur(4px)',
            display: 'grid',
            placeItems: 'center',
            padding: 16,
          }}
        >
          <div
            className="card"
            style={{
              width: '100%',
              maxWidth: 480,
              background: '#fff',
              borderRadius: 16,
              padding: 22,
              boxShadow: '0 20px 40px rgba(0,0,0,0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: '#ede9fe', color: '#6d28d9', display: 'grid', placeItems: 'center' }}>
                  <Plus size={18} />
                </div>
                <strong style={{ fontSize: 15, color: '#0f172a' }}>Thêm Kênh YouTube Mới</strong>
              </div>
              <button
                type="button"
                onClick={() => setAddChannelModalOpen(false)}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: '#64748b' }}
              >
                <X size={18} />
              </button>
            </div>

            <p style={{ fontSize: 12.5, color: '#64748b', margin: '0 0 12px', lineHeight: 1.4 }}>
              Dán URL kênh (vd: <code>https://youtube.com/@BestEverFoodReviewShow</code>) hoặc <code>@handle</code> của kênh. Hệ thống sẽ tự động quét thông tin và lưu vào mục yêu thích.
            </p>

            <input
              value={newChannelInput}
              onChange={e => setNewChannelInput(e.target.value)}
              placeholder="vd: @MarkWiens hoặc link kênh..."
              style={{ width: '100%', height: 40, fontSize: 13, padding: '0 12px', borderRadius: 8, border: '1px solid #cbd5e1', marginBottom: 16 }}
            />

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setAddChannelModalOpen(false)}
                style={{ fontSize: 12.5 }}
              >
                Hủy
              </button>
              <button
                type="button"
                className="btn-p"
                onClick={handleAddCustomChannel}
                disabled={addingChannel || !newChannelInput.trim()}
                style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                {addingChannel ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                {addingChannel ? 'Đang kiểm tra kênh…' : 'Lưu & Quét Video'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
