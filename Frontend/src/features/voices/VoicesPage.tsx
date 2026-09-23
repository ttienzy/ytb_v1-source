import { useEffect, useMemo, useRef, useState } from 'react'
import {
  FileAudio,
  Loader2,
  Mic,
  Pause,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import type { Preset, Voice } from './types'
import { PcmPreviewPlayer } from './pcmPreview'
import './VoicesPage.css'

interface UnifiedVoice {
  id: string
  name: string
  description?: string
  gender?: 'male' | 'female' | string
  isClone: boolean
  createdAt?: string
}

const QUICK_PROMPTS = [
  {
    label: 'Review phim',
    text: 'Đừng bao giờ đánh giá một con người chỉ qua vẻ bề ngoài của họ.',
  },
  {
    label: 'Tin tức',
    text: 'Bản tin hôm nay cập nhật những diễn biến nóng hổi và bất ngờ nhất vừa diễn ra.',
  },
  {
    label: 'Hài hước',
    text: 'Cười không nhặt được mồm với màn giải cứu đỉnh cao không thể ngờ tới của anh bạn này.',
  },
  {
    label: 'Kể chuyện',
    text: 'Trong một thị trấn nhỏ yên bình, có một bí mật đã bị chôn vùi suốt hai mươi năm.',
  },
  {
    label: 'Triết lý',
    text: 'Cuộc sống không phải là chờ đợi cơn bão đi qua, mà là học cách nhảy múa dưới cơn mưa.',
  },
]

export function VoicesPage() {
  const [voices, setVoices] = useState<Voice[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [name, setName] = useState('')
  const [cloneConsent, setCloneConsent] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [messageType, setMessageType] = useState<'success' | 'info' | 'error'>('info')
  const [serviceReady, setServiceReady] = useState(false)
  const [engineLabel, setEngineLabel] = useState('VieNeu-TTS')
  const [engineWarning, setEngineWarning] = useState('')
  const [serviceMessage, setServiceMessage] = useState(
    'Đang khởi động Voice Service hoặc tải model lần đầu…'
  )
  const [generatingVoiceId, setGeneratingVoiceId] = useState<string | null>(null)
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [filterTab, setFilterTab] = useState<'all' | 'cloned' | 'preset-male' | 'preset-female'>('all')
  const [isDragging, setIsDragging] = useState(false)
  const [showCloneForm, setShowCloneForm] = useState(false)
  const [sampleAudioPlaying, setSampleAudioPlaying] = useState(false)

  const audioRef = useRef<HTMLAudioElement | null>(null)
  const sampleAudioRef = useRef<HTMLAudioElement | null>(null)
  const currentUrlRef = useRef<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const previewPlayerRef = useRef<PcmPreviewPlayer | null>(null)

  function stopAudio() {
    previewPlayerRef.current?.stop()
    previewPlayerRef.current = null
    setGeneratingVoiceId(null)
    if (audioRef.current) {
      audioRef.current.pause()
      audioRef.current.currentTime = 0
      audioRef.current = null
    }
    if (sampleAudioRef.current) {
      sampleAudioRef.current.pause()
      sampleAudioRef.current.currentTime = 0
      sampleAudioRef.current = null
      setSampleAudioPlaying(false)
    }
    if (currentUrlRef.current) {
      URL.revokeObjectURL(currentUrlRef.current)
      currentUrlRef.current = null
    }
    setPlayingVoiceId(null)
  }

  // Kết nối và nạp danh sách voices / presets
  useEffect(() => {
    let stopped = false
    let retryTimer: ReturnType<typeof setTimeout> | undefined

    const pollVoiceService = async (attempt = 0) => {
      if (stopped) return

      try {
        const healthResponse = await fetch(`${API_URL}/api/voices/health`)
        if (healthResponse.ok) {
          const health = await healthResponse.json()
          if (!health.model_loaded) {
            setServiceReady(false)
            setServiceMessage(
              health.error
                ? `Voice Service không khởi tạo được: ${health.error}`
                : 'Voice Service chưa tải xong model.'
            )
            if (attempt < 180) retryTimer = setTimeout(() => void pollVoiceService(attempt + 1), 2000)
            return
          }
          setEngineLabel(health.profile === 'nano' ? 'VieNeu Nano · Tiết kiệm tài nguyên'
            : health.profile === 'turbo-gpu' ? 'VieNeu Turbo · Tăng tốc GPU' : 'VieNeu Turbo · Chất lượng cao')
          setEngineWarning(health.warning || '')

          const [voicesResponse, presetsResponse] = await Promise.all([
            fetch(`${API_URL}/api/voices`),
            fetch(`${API_URL}/api/voices/presets`),
          ])
          if (!voicesResponse.ok || !presetsResponse.ok) {
            throw new Error('Voice API chưa sẵn sàng')
          }

          const [voicesData, presetsData] = await Promise.all([
            voicesResponse.json(),
            presetsResponse.json(),
          ])
          if (stopped) return
          setVoices(voicesData.voices ?? voicesData ?? [])
          setPresets(presetsData ?? [])
          setServiceReady(true)
          setServiceMessage('')
          return
        }
      } catch {
        // Tiếp tục thử lại nếu backend/voice-service đang khởi động
      }

      if (attempt < 180) {
        setServiceReady(false)
        setServiceMessage('Đang kết nối Voice Service và nạp model VieNeu-TTS…')
        retryTimer = setTimeout(() => void pollVoiceService(attempt + 1), 2000)
      } else {
        setServiceReady(false)
        setServiceMessage(
          'Voice Service chưa sẵn sàng sau 6 phút. Hãy kiểm tra lại terminal voice-service.'
        )
      }
    }

    void pollVoiceService()

    return () => {
      stopped = true
      if (retryTimer) clearTimeout(retryTimer)
      stopAudio()
    }
  }, [])

  // Tạo giọng clone từ audio mẫu
  async function create() {
    if (!file || !name.trim()) {
      setMessage('Vui lòng nhập tên giọng và chọn audio mẫu (3-8 giây).')
      setMessageType('error')
      return
    }
    if (!cloneConsent) {
      setMessage('Vui lòng xác nhận quyền sử dụng giọng mẫu.')
      setMessageType('error')
      return
    }
    setLoading(true)
    setMessage('')
    const form = new FormData()
    form.append('name', name.trim())
    form.append('ref_audio', file)
    form.append('consent', String(cloneConsent))
    try {
      const r = await fetch(`${API_URL}/api/voices`, {
        method: 'POST',
        body: form,
      })
      if (!r.ok) {
        const errJson = await r.json().catch(() => null)
        throw new Error(errJson?.detail || `Lỗi máy chủ (${r.status})`)
      }
      const v = await r.json()
      setVoices([v, ...voices])
      setName('')
      setFile(null)
      setCloneConsent(false)
      setShowCloneForm(false)
      setMessage(`Đã tạo thành công giọng clone "${name.trim()}".`)
      setMessageType('success')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Tạo giọng thất bại. Hãy kiểm tra voice-service.')
      setMessageType('error')
    } finally {
      setLoading(false)
    }
  }

  // Xóa giọng clone
  async function remove(id: string, voiceName: string) {
    if (!window.confirm(`Bạn có chắc chắn muốn xoá giọng "${voiceName}" khỏi danh sách không?`)) {
      return
    }

    if (playingVoiceId === id) {
      stopAudio()
    }
    try {
      const r = await fetch(`${API_URL}/api/voices/${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!r.ok) throw new Error()
      setVoices(voices.filter(v => v.voice_id !== id))
      setMessage(`Đã xoá giọng "${voiceName}".`)
      setMessageType('info')
    } catch {
      setMessage('Xoá giọng thất bại.')
      setMessageType('error')
    }
  }

  // Nghe thử giọng (TTS Preview)
  async function togglePreview(id: string) {
    // Nếu đang phát chính giọng này -> Dừng lại
    if (playingVoiceId === id || generatingVoiceId === id) {
      stopAudio()
      return
    }

    // Dừng âm thanh khác đang phát
    stopAudio()
    setGeneratingVoiceId(id)
    setMessage('')
    const player = new PcmPreviewPlayer()
    previewPlayerRef.current = player
    try {
      await player.play(`${API_URL}/api/voices/${encodeURIComponent(id)}/preview/stream`, previewText.trim(), () => {
        if (previewPlayerRef.current === player) {
          setGeneratingVoiceId(null)
          setPlayingVoiceId(id)
        }
      })
    } catch (error) {
      if (previewPlayerRef.current === player) {
        setMessage(error instanceof Error ? error.message : 'Tổng hợp giọng đọc thất bại.')
        setMessageType('error')
      }
    } finally {
      player.stop()
      if (previewPlayerRef.current === player) stopAudio()
    }
  }

  // Nghe thử file audio mẫu do người dùng tải lên
  function toggleSampleAudio() {
    if (!file) return

    if (sampleAudioPlaying && sampleAudioRef.current) {
      sampleAudioRef.current.pause()
      sampleAudioRef.current = null
      setSampleAudioPlaying(false)
      return
    }

    stopAudio()
    const url = URL.createObjectURL(file)
    const audio = new Audio(url)
    sampleAudioRef.current = audio
    setSampleAudioPlaying(true)

    audio.onended = () => {
      setSampleAudioPlaying(false)
      URL.revokeObjectURL(url)
    }
    audio.onerror = () => {
      setSampleAudioPlaying(false)
      URL.revokeObjectURL(url)
    }

    void audio.play()
  }

  // Hợp nhất danh sách giọng để lọc và hiển thị
  const unifiedVoices: UnifiedVoice[] = useMemo(() => {
    const list: UnifiedVoice[] = []

    // 1. Giọng clone
    voices.forEach(v => {
      list.push({
        id: v.voice_id,
        name: v.name,
        description: `Giọng clone người dùng · ID: ${v.voice_id.slice(0, 8)}`,
        isClone: true,
        createdAt: v.created_at,
      })
    })

    // 2. Preset voices
    presets.forEach(p => {
      const g = (p.gender || '').toLowerCase()
      list.push({
        id: p.name,
        name: p.name,
        description: p.description || 'Preset giọng chuẩn VieNeu-TTS',
        gender: g.includes('nữ') || g.includes('female') ? 'female' : 'male',
        isClone: false,
      })
    })

    return list
  }, [voices, presets])

  // Lọc theo tabs & từ khóa tìm kiếm
  const filteredVoices = useMemo(() => {
    const query = searchQuery.trim().toLowerCase()

    return unifiedVoices.filter(v => {
      // Lọc tab
      if (filterTab === 'cloned' && !v.isClone) return false
      if (filterTab === 'preset-male' && (v.isClone || v.gender !== 'male')) return false
      if (filterTab === 'preset-female' && (v.isClone || v.gender !== 'female')) return false

      // Lọc tìm kiếm
      if (query) {
        const matchName = v.name.toLowerCase().includes(query)
        const matchDesc = (v.description || '').toLowerCase().includes(query)
        if (!matchName && !matchDesc) return false
      }

      return true
    })
  }, [unifiedVoices, filterTab, searchQuery])

  // Thống kê
  const totalVoicesCount = unifiedVoices.length
  const clonedCount = voices.length
  const maleCount = presets.filter(p => {
    const g = (p.gender || '').toLowerCase()
    return !g.includes('nữ') && !g.includes('female')
  }).length
  const femaleCount = presets.filter(p => {
    const g = (p.gender || '').toLowerCase()
    return g.includes('nữ') || g.includes('female')
  }).length

  return (
    <div className="voice-studio-page">
      {/* --------------------------------------------------------------------
          1. Compact Hero Studio Banner
          -------------------------------------------------------------------- */}
      <section className="voice-hero-banner">
        <div className="voice-hero-top">
          <div className="voice-hero-brand">
            <div className="voice-hero-title-row">
              <h1 className="voice-hero-title">Quản Lý & Thử Nghiệm Giọng Đọc AI</h1>
            </div>
            <p className="voice-hero-desc">
              Giọng đọc recap tiếng Việt qua VieNeu-TTS v3 — clone từ audio mẫu 3–8s và thử giọng trực tiếp.
            </p>
          </div>

          <div className="voice-hero-actions">
            {/* Trạng thái Voice Engine */}
            <div className={`voice-engine-status ${serviceReady ? 'ready' : 'loading'}`}>
              <span className="voice-status-dot" />
              <span>
                {serviceReady ? engineLabel : 'Đang nạp Model...'}
              </span>
            </div>

            {/* Nút bật/tắt form tạo giọng */}
            <button
              type="button"
              className="voice-btn-primary"
              onClick={() => setShowCloneForm(!showCloneForm)}
              title="Mở bảng tạo giọng clone từ audio mẫu"
            >
              <Plus size={14} />
              <span>{showCloneForm ? 'Đóng tạo giọng' : 'Tạo giọng mới'}</span>
            </button>
          </div>
        </div>

        {/* Quick Metrics Bar */}
        <div className="voice-metrics-row">
          <div className="voice-metric-pill">
            <span>Tổng:</span>
            <strong>{totalVoicesCount} giọng</strong>
          </div>
          <div className="voice-metric-pill">
            <span>Giọng clone:</span>
            <strong>{clonedCount}</strong>
          </div>
          <div className="voice-metric-pill">
            <span>Preset:</span>
            <strong>{presets.length} ({maleCount} Nam / {femaleCount} Nữ)</strong>
          </div>
          <div className="voice-metric-pill">
            <span>Mô hình:</span>
            <strong>VieNeu v3 ONNX</strong>
          </div>
        </div>
      </section>

      {engineWarning && <p className="voice-section-sub">{engineWarning}</p>}

      {/* Thông báo trạng thái hệ thống */}
      {serviceMessage && (
        <div className="voice-toast info">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Loader2 size={14} className="spinning" />
            <span>{serviceMessage}</span>
          </div>
        </div>
      )}

      {/* Thông báo tương tác (Thêm / Xóa / Lỗi) */}
      {message && (
        <div className={`voice-toast ${messageType}`}>
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage('')}
            style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'inherit', display: 'flex' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* --------------------------------------------------------------------
          2. Voice Clone Creator Form (Compact Card)
          -------------------------------------------------------------------- */}
      {showCloneForm && (
        <section className="voice-clone-card">
          <div className="voice-clone-header">
            <div>
              <h3 className="voice-section-title">Thêm Giọng Clone Từ Audio Mẫu</h3>
              <p className="voice-section-sub">
                Tải đoạn ghi âm 3–8 giây — hệ thống sẽ tự động khử tạp âm và trích xuất đặc trưng giọng.
              </p>
            </div>

            <button
              type="button"
              className="voice-btn-del"
              onClick={() => setShowCloneForm(false)}
              title="Đóng form"
            >
              <X size={15} />
            </button>
          </div>

          <div className="voice-clone-form-grid">
            {/* Cột 1: Tên giọng */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="voice-field-group">
                <label className="voice-field-label">
                  Tên giọng đọc <span>(bắt buộc)</span>
                </label>
                <input
                  type="text"
                  className="voice-input-text"
                  placeholder="Ví dụ: Giọng Review Hài Hước, Giọng Tin Tức..."
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>

              <div className="voice-protips">
                Khuyến nghị audio <strong>3 đến 8 giây</strong>, giọng đọc rõ ràng, không lẫn nhạc nền để đạt chất lượng tốt nhất.
              </div>
              <label className="voice-section-sub">
                <input type="checkbox" checked={cloneConsent} onChange={e => setCloneConsent(e.target.checked)} />
                {' '}Đây là giọng của tôi hoặc tôi được chủ giọng cho phép sử dụng.
              </label>

              <div>
                <button
                  type="button"
                  className="voice-btn-primary"
                  onClick={create}
                  disabled={loading || !serviceReady || !name.trim() || !file || !cloneConsent}
                  style={{ width: '100%', justifyContent: 'center' }}
                >
                  {loading ? (
                    <>
                      <Loader2 size={14} className="spinning" />
                      <span>Đang tạo giọng...</span>
                    </>
                  ) : (
                    <>
                      <Plus size={14} />
                      <span>Tạo Giọng Clone</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {/* Cột 2: Dropzone */}
            <div className="voice-field-group">
              <label className="voice-field-label">
                Audio mẫu <span>(3–8s, WAV/MP3)</span>
              </label>

              <div
                className={`voice-dropzone ${isDragging ? 'dragging' : ''}`}
                onDragOver={e => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={e => {
                  e.preventDefault()
                  setIsDragging(false)
                  const droppedFile = e.dataTransfer.files?.[0]
                  if (droppedFile) setFile(droppedFile)
                }}
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="audio/*"
                  style={{ display: 'none' }}
                  onChange={e => {
                    const selected = e.target.files?.[0]
                    if (selected) setFile(selected)
                  }}
                />

                <Upload size={16} style={{ color: '#64748b' }} />

                {file ? (
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 5 }}>
                    <div className="voice-file-badge">
                      <FileAudio size={13} />
                      <span>{file.name}</span>
                      <small>({(file.size / 1024).toFixed(0)} KB)</small>
                    </div>
                    <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                      <button
                        type="button"
                        className="voice-chip"
                        onClick={e => {
                          e.stopPropagation()
                          toggleSampleAudio()
                        }}
                      >
                        {sampleAudioPlaying ? 'Dừng phát' : 'Nghe thử mẫu'}
                      </button>

                      <button
                        type="button"
                        className="voice-chip"
                        onClick={e => {
                          e.stopPropagation()
                          setFile(null)
                          if (sampleAudioRef.current) {
                            sampleAudioRef.current.pause()
                            setSampleAudioPlaying(false)
                          }
                        }}
                        style={{ color: '#dc2626' }}
                      >
                        Đổi file
                      </button>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="voice-dropzone-title">Kéo &amp; thả file audio mẫu vào đây, hoặc bấm để chọn</p>
                    <p className="voice-dropzone-sub">Định dạng .wav, .mp3 (độ dài khuyên dùng 3 - 8s)</p>
                  </>
                )}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* --------------------------------------------------------------------
          3. Slim Voice Testing Strip (Gọn nhẹ, không icon màu)
          -------------------------------------------------------------------- */}
      <section className="voice-testing-strip">
        <div className="voice-testing-input-row">
          <input
            type="text"
            className="voice-testing-input"
            placeholder="Nhập câu văn bản muốn nghe thử (để trống: dùng câu mặc định của hệ thống)..."
            value={previewText}
            onChange={e => setPreviewText(e.target.value)}
          />
          {previewText && (
            <button
              type="button"
              className="voice-testing-clear"
              onClick={() => setPreviewText('')}
              title="Xóa câu nghe thử"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Chips không icon màu */}
        <div className="voice-chips-row">
          <span className="voice-chips-label">Mẫu câu:</span>
          {QUICK_PROMPTS.map((item, idx) => {
            const isActive = previewText === item.text
            return (
              <button
                key={idx}
                type="button"
                className={`voice-chip ${isActive ? 'active' : ''}`}
                onClick={() => setPreviewText(item.text)}
                title={item.text}
              >
                {item.label}
              </button>
            )
          })}
          {['[cười]', '[thở dài]', '[hắng giọng]'].map(cue => (
            <button key={cue} type="button" className="voice-chip"
              title="Biểu cảm thử nghiệm — kết quả phụ thuộc giọng"
              onClick={() => setPreviewText(text => `${text.trim()} ${cue} `.trimStart())}>
              {cue}
            </button>
          ))}
        </div>
      </section>

      {/* --------------------------------------------------------------------
          4. Toolbar: Search Input & Category Filter Tabs
          -------------------------------------------------------------------- */}
      <section className="voice-toolbar">
        {/* Search */}
        <div className="voice-search-wrap">
          <Search size={14} className="voice-search-icon" />
          <input
            type="text"
            className="voice-search-input"
            placeholder="Tìm theo tên giọng hoặc phong cách..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="voice-search-clear"
              onClick={() => setSearchQuery('')}
              title="Xoá tìm kiếm"
            >
              <X size={13} />
            </button>
          )}
        </div>

        {/* Filter Tabs */}
        <div className="voice-filter-tabs">
          <button
            type="button"
            className={`voice-filter-btn ${filterTab === 'all' ? 'active' : ''}`}
            onClick={() => setFilterTab('all')}
          >
            Tất cả ({totalVoicesCount})
          </button>
          <button
            type="button"
            className={`voice-filter-btn ${filterTab === 'cloned' ? 'active' : ''}`}
            onClick={() => setFilterTab('cloned')}
          >
            Giọng Clone ({clonedCount})
          </button>
          <button
            type="button"
            className={`voice-filter-btn ${filterTab === 'preset-male' ? 'active' : ''}`}
            onClick={() => setFilterTab('preset-male')}
          >
            Giọng Nam ({maleCount})
          </button>
          <button
            type="button"
            className={`voice-filter-btn ${filterTab === 'preset-female' ? 'active' : ''}`}
            onClick={() => setFilterTab('preset-female')}
          >
            Giọng Nữ ({femaleCount})
          </button>
        </div>
      </section>

      {/* --------------------------------------------------------------------
          5. Compact Voice Table (Chuẩn Audio Matrix, Tinh Gọn)
          -------------------------------------------------------------------- */}
      <section className="voice-table-card">
        <div className="voice-table-head">
          <span style={{ textAlign: 'center', color: '#94a3b8' }}>#</span>
          <span>Tên Giọng</span>
          <span>Phân Loại</span>
          <span className="voice-col-desc">Phong Cách / Mô Tả</span>
          <span style={{ textAlign: 'right' }}>Thao Tác</span>
        </div>

        <div className="voice-table-body">
          {filteredVoices.length === 0 ? (
            <div className="voice-empty-box">
              <p>
                {searchQuery || filterTab !== 'all'
                  ? 'Không tìm thấy giọng nào phù hợp với bộ lọc.'
                  : 'Chưa có giọng nào trong danh sách. Bấm "Tạo giọng mới" để bắt đầu.'}
              </p>
            </div>
          ) : (
            filteredVoices.map(item => {
              const isGenerating = generatingVoiceId === item.id
              const isPlaying = playingVoiceId === item.id

              return (
                <div
                  key={item.id}
                  className={`voice-row ${isPlaying ? 'is-playing' : ''}`}
                >
                  {/* Cột 1: Nút Play tròn */}
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <button
                      type="button"
                      className={`voice-play-btn ${isPlaying ? 'playing' : ''}`}
                      onClick={() => togglePreview(item.id)}
                      disabled={!serviceReady}
                      title={isPlaying ? 'Dừng phát' : 'Nghe thử giọng này'}
                    >
                      {isGenerating ? (
                        <Loader2 size={13} className="spinning" />
                      ) : isPlaying ? (
                        <Pause size={13} />
                      ) : (
                        <Play size={12} style={{ marginLeft: 1 }} />
                      )}
                    </button>
                  </div>

                  {/* Cột 2: Tên giọng */}
                  <div className="voice-name-txt" title={item.name}>
                    <span>{item.name}</span>
                    {isPlaying && (
                      <div className="voice-mini-eq" title="Đang phát">
                        <span className="voice-mini-eq-bar" />
                        <span className="voice-mini-eq-bar" />
                        <span className="voice-mini-eq-bar" />
                      </div>
                    )}
                  </div>

                  {/* Cột 3: Tag phân loại neutral */}
                  <div>
                    {item.isClone ? (
                      <span className="voice-tag clone">Clone</span>
                    ) : item.gender === 'female' ? (
                      <span className="voice-tag">Nữ</span>
                    ) : (
                      <span className="voice-tag">Nam</span>
                    )}
                  </div>

                  {/* Cột 4: Mô tả phong cách */}
                  <div className="voice-col-desc voice-desc-txt" title={item.description}>
                    {item.description}
                  </div>

                  {/* Cột 5: Nút Xóa (cho giọng clone) */}
                  <div style={{ textAlign: 'right' }}>
                    {item.isClone ? (
                      <button
                        type="button"
                        className="voice-btn-del"
                        onClick={() => remove(item.id, item.name)}
                        title={`Xoá giọng "${item.name}"`}
                      >
                        <Trash2 size={14} />
                      </button>
                    ) : (
                      <span style={{ fontSize: 11, color: '#cbd5e1' }}>—</span>
                    )}
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>
    </div>
  )
}
