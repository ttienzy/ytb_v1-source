import { useEffect, useState } from 'react'
import { Mic, Play, Plus, Trash2, Volume2 } from 'lucide-react'
import { API_URL } from '../../shared/constants'
import type { Preset, Voice } from './types'

export function VoicesPage() {
  const [voices, setVoices] = useState<Voice[]>([])
  const [presets, setPresets] = useState<Preset[]>([])
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [previewing, setPreviewing] = useState<string | null>(null)
  const [previewText, setPreviewText] = useState('')

  useEffect(() => {
    fetch(`${API_URL}/api/voices`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('not ok'))))
      .then(d => setVoices(d.voices ?? d ?? []))
      .catch(() =>
        setMessage('Voice service chưa kết nối. (BE chưa triển khai)')
      )
    fetch(`${API_URL}/api/voices/presets`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error('not ok'))))
      .then(setPresets)
      .catch(() => {
        /* preset là tuỳ chọn — không bắt buộc */
      })
  }, [])

  async function create() {
    if (!file || !name.trim()) {
      setMessage('Cần tên giọng và audio mẫu (3-8s).')
      return
    }
    setLoading(true)
    setMessage('')
    const form = new FormData()
    form.append('name', name.trim())
    form.append('ref_audio', file)
    try {
      const r = await fetch(`${API_URL}/api/voices`, {
        method: 'POST',
        body: form,
      })
      if (!r.ok) throw new Error()
      const v = await r.json()
      setVoices([v, ...voices])
      setName('')
      setFile(null)
      setMessage('Đã thêm giọng.')
    } catch {
      setMessage('Tạo giọng thất bại. (BE chưa triển khai?)')
    } finally {
      setLoading(false)
    }
  }

  async function remove(id: string) {
    try {
      const r = await fetch(`${API_URL}/api/voices/${id}`, {
        method: 'DELETE',
      })
      if (!r.ok) throw new Error()
      setVoices(voices.filter(v => v.voice_id !== id))
    } catch {
      setMessage('Xoá thất bại.')
    }
  }

  async function preview(id: string) {
    setPreviewing(id)
    setMessage('')
    try {
      const r = await fetch(
        `${API_URL}/api/voices/${encodeURIComponent(id)}/preview`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: previewText || undefined }),
        }
      )
      if (!r.ok) {
        const e = await r.json().catch(() => null)
        throw new Error(e?.detail || `Lỗi ${r.status}`)
      }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const audio = new Audio(url)
      audio.onended = () => URL.revokeObjectURL(url)
      await audio.play()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'TTS thất bại.')
    } finally {
      setPreviewing(null)
    }
  }

  return (
    <section className="settings-page">
      <div className="settings-heading">
        <div>
          <p className="overline">GIỌNG NÓI</p>
          <h1>Voices</h1>
          <p className="page-subtitle">
            Quản lý giọng đọc Việt cho recap — clone từ audio mẫu, chọn giọng khi
            TTS.
          </p>
        </div>
      </div>

      <div className="settings-card">
        <div className="integration-title">
          <div className="gemini-icon">
            <Mic size={17} />
          </div>
          <div>
            <h2>Thêm giọng (voice clone)</h2>
            <p>
              Tải audio mẫu 3-8 giây — VieNeu-TTS sẽ tự khử ồn rồi clone
              zero-shot.
            </p>
          </div>
        </div>
        <label>Tên giọng</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="vd: Giọng review hài"
        />
        <label style={{ marginTop: 18 }}>
          Audio mẫu <span>(3-8s, wav/mp3)</span>
        </label>
        <div className="voice-file-row">
          <input
            type="file"
            accept="audio/*"
            onChange={e => setFile(e.target.files?.[0] ?? null)}
          />
          <span className="voice-file-name">
            {file ? file.name : 'Chưa chọn file'}
          </span>
        </div>
        <div className="settings-actions">
          <button
            type="button"
            className="primary-button"
            onClick={create}
            disabled={loading}
          >
            <Plus size={16} /> Tạo giọng
          </button>
        </div>
        {message && <p className="settings-message">{message}</p>}
      </div>

      <div className="settings-card" style={{ marginTop: 22 }}>
        <div className="integration-title">
          <div className="gemini-icon">
            <Play size={17} />
          </div>
          <div>
            <h2>Nghe thử</h2>
            <p>Nhập text rồi bấm “Nghe thử” ở bất kỳ giọng nào dưới đây.</p>
          </div>
        </div>
        <label>
          Text nghe thử <span>(để trống → câu mặc định)</span>
        </label>
        <input
          value={previewText}
          onChange={e => setPreviewText(e.target.value)}
          placeholder="vd: Xin chào, đây là giọng đọc thử."
        />
      </div>

      <div className="settings-card" style={{ marginTop: 22 }}>
        <div className="integration-title">
          <div className="gemini-icon">
            <Volume2 size={17} />
          </div>
          <div>
            <h2>Danh sách giọng (đã clone)</h2>
            <p>Giọng bạn clone từ audio mẫu.</p>
          </div>
        </div>
        {voices.length === 0 ? (
          <p className="settings-message">Chưa có giọng nào.</p>
        ) : (
          <div className="voices-list">
            {voices.map(v => (
              <div key={v.voice_id} className="voice-item">
                <div className="voice-item-info">
                  <strong>{v.name}</strong>
                  <span>
                    {v.voice_id}
                    {v.created_at ? ` · ${v.created_at}` : ''}
                  </span>
                </div>
                <div className="voice-item-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => preview(v.voice_id)}
                    disabled={previewing === v.voice_id}
                  >
                    <Play size={15} />{' '}
                    {previewing === v.voice_id ? 'Đang tạo...' : 'Nghe thử'}
                  </button>
                  <button
                    type="button"
                    className="chrome-button"
                    onClick={() => remove(v.voice_id)}
                  >
                    <Trash2 size={15} /> Xoá
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="settings-card" style={{ marginTop: 22 }}>
        <div className="integration-title">
          <div className="gemini-icon">
            <Mic size={17} />
          </div>
          <div>
            <h2>Preset voices</h2>
            <p>20 giọng sẵn dùng của VieNeu — không cần clone.</p>
          </div>
        </div>
        {presets.length === 0 ? (
          <p className="settings-message">
            Chưa tải được preset (voice-service chưa chạy?).
          </p>
        ) : (
          <div className="voices-list">
            {presets.map(p => (
              <div key={p.name} className="voice-item">
                <div className="voice-item-info">
                  <strong>{p.name}</strong>
                  <span>{p.description}</span>
                </div>
                <div className="voice-item-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => preview(p.name)}
                    disabled={previewing === p.name}
                  >
                    <Play size={15} />{' '}
                    {previewing === p.name ? 'Đang tạo...' : 'Nghe thử'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  )
}
