import { useEffect, useRef, useState } from 'react'
import {
  Loader2,
  Music,
  Pause,
  Play,
  Plus,
  Trash2,
  Upload,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import type { BgmOut } from './types'

export function BgmPage() {
  const [tracks, setTracks] = useState<BgmOut[]>([])
  const [name, setName] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [needsAttr, setNeedsAttr] = useState(false)
  const [description, setDescription] = useState('')
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [playing, setPlaying] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  function load() {
    fetch(`${API_URL}/api/bgm`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: BgmOut[]) => setTracks(d))
      .catch(() => setMessage('Không tải được thư viện nhạc.'))
  }
  useEffect(() => {
    load()
  }, []) // eslint-disable-line

  async function create() {
    if (!file || !name.trim()) {
      setMessage('Cần tên track và file audio.')
      return
    }
    setLoading(true)
    setMessage('')
    const form = new FormData()
    form.append('name', name.trim())
    form.append('audio', file)
    form.append('needs_attribution', String(needsAttr))
    if (needsAttr && description.trim())
      form.append('description', description.trim())
    try {
      const r = await fetch(`${API_URL}/api/bgm`, {
        method: 'POST',
        body: form,
      })
      if (!r.ok) {
        const e = await r.json().catch(() => null)
        throw new Error(e?.detail || `Lỗi ${r.status}`)
      }
      const t: BgmOut = await r.json()
      setTracks([t, ...tracks])
      setName('')
      setFile(null)
      setNeedsAttr(false)
      setDescription('')
      setMessage('Đã thêm track.')
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Thêm track thất bại.')
    } finally {
      setLoading(false)
    }
  }

  async function importFolder() {
    const folder = window.prompt(
      'Đường dẫn thư mục nhạc:',
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
      setMessage(`Đã nhập ${imported.length} track.`)
      load()
    } catch (e) {
      setMessage(e instanceof Error ? e.message : 'Nhập thất bại.')
    } finally {
      setImporting(false)
    }
  }

  async function remove(id: string) {
    try {
      const r = await fetch(`${API_URL}/api/bgm/${id}`, {
        method: 'DELETE',
      })
      if (!r.ok) throw new Error()
      setTracks(tracks.filter(t => t.track_id !== id))
    } catch {
      setMessage('Xoá thất bại.')
    }
  }

  function stopPreview() {
    audioRef.current?.pause()
    audioRef.current = null
    setPlaying(null)
  }

  function preview(id: string) {
    if (playing === id) {
      stopPreview()
      return
    }
    stopPreview()
    setPlaying(id)
    const a = new Audio(`${API_URL}/api/bgm/${id}/audio`)
    a.onended = () => {
      setPlaying(null)
    }
    a.onerror = () => {
      setPlaying(null)
      setMessage('Không phát được audio.')
    }
    audioRef.current = a
    a.play().catch(() => setPlaying(null))
  }

  return (
    <section className="settings-page">
      <div className="settings-heading">
        <div>
          <p className="overline">NHẠC NỀN</p>
          <h1>Thư viện nhạc</h1>
          <p className="page-subtitle">
            Nhạc không bản quyền — mix dưới VO khi tạo recap. Track cần ghi
            credit có badge CC BY.
          </p>
        </div>
      </div>

      <div className="settings-card">
        <div className="integration-title">
          <div className="gemini-icon">
            <Music size={17} />
          </div>
          <div>
            <h2>Thêm track</h2>
            <p>
              Tải file audio + tên. Tick “cần credit” nếu track yêu cầu
              attribution (CC BY…).
            </p>
          </div>
        </div>
        <label>Tên track</label>
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="vd: carefree-by-kevin-macleod"
        />
        <label style={{ marginTop: 18 }}>
          File audio <span>(mp3/wav)</span>
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
        <label
          style={{
            marginTop: 18,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            checked={needsAttr}
            onChange={e => setNeedsAttr(e.target.checked)}
            style={{ width: 16, height: 16 }}
          />
          Cần ghi credit (attribution)
        </label>
        {needsAttr && (
          <>
            <label style={{ marginTop: 14 }}>
              Credit text <span>(dán vào mô tả YouTube)</span>
            </label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              rows={3}
              placeholder="vd: Carefree by Kevin MacLeod (incompetech.com) — Licensed under Creative Commons: By Attribution 4.0…"
            />
          </>
        )}
        <div className="settings-actions">
          <button
            type="button"
            className="primary-button"
            onClick={create}
            disabled={loading}
          >
            {loading ? (
              <Loader2 size={16} className="spin" />
            ) : (
              <Plus size={16} />
            )}{' '}
            Thêm track
          </button>
          <button
            type="button"
            className="chrome-button"
            onClick={importFolder}
            disabled={importing}
          >
            {importing ? (
              <Loader2 size={15} className="spin" />
            ) : (
              <Upload size={15} />
            )}{' '}
            Nhập từ thư mục
          </button>
        </div>
        {message && <p className="settings-message">{message}</p>}
      </div>

      <div className="settings-card" style={{ marginTop: 22 }}>
        <div className="integration-title">
          <div className="gemini-icon">
            <Music size={17} />
          </div>
          <div>
            <h2>Danh sách track</h2>
            <p>{tracks.length} track. Bấm ▶ để nghe thử.</p>
          </div>
        </div>
        {tracks.length === 0 ? (
          <p className="settings-message">
            Chưa có track nào — thêm thủ công hoặc “Nhập từ thư mục”.
          </p>
        ) : (
          <div className="voices-list">
            {tracks.map(t => (
              <div key={t.track_id} className="voice-item">
                <div className="voice-item-info">
                  <strong>
                    {t.name}
                    {t.needs_attribution && (
                      <span
                        className="badge b-merged"
                        style={{
                          marginLeft: 8,
                          fontSize: 10,
                          padding: '2px 7px',
                        }}
                      >
                        CC BY
                      </span>
                    )}
                  </strong>
                  <span>
                    {t.duration_sec ? `${t.duration_sec.toFixed(0)}s` : '—'}
                    {t.needs_attribution && t.description
                      ? ' · cần credit'
                      : ' · không cần credit'}
                  </span>
                </div>
                <div className="voice-item-actions">
                  <button
                    type="button"
                    className="primary-button"
                    onClick={() => preview(t.track_id)}
                  >
                    {playing === t.track_id ? (
                      <Pause size={15} />
                    ) : (
                      <Play size={15} />
                    )}{' '}
                    {playing === t.track_id ? 'Dừng' : 'Nghe'}
                  </button>
                  <button
                    type="button"
                    className="chrome-button"
                    onClick={() => remove(t.track_id)}
                  >
                    <Trash2 size={15} /> Xoá
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
