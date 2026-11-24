import { useEffect, useRef, useState } from 'react'
import { Play, Save, Settings, SlidersHorizontal } from 'lucide-react'
import { API_URL } from '../../shared/constants'
import { listMuseAccounts } from './services/museApi'
import type { MuseAccountOption } from './types'
import { blankChannel, request, roleNames, roles, type Channel, type Episode } from './productionApi'

export function ProductionForm({ onCreated }: { onCreated: (ep: Episode) => void }) {
  const [presets, setPresets] = useState<Channel[]>([])
  const [channel, setChannel] = useState<Channel>(blankChannel)
  const [topic, setTopic] = useState('')
  const [sources, setSources] = useState('')
  const [rules, setRules] = useState('')
  const [accounts, setAccounts] = useState<MuseAccountOption[]>([])
  const [voices, setVoices] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)
  const [customizeChannel, setCustomizeChannel] = useState(false)
  const attempt = useRef({ key: '', id: '' })

  function load(c: Channel) {
    setChannel(c)
    setSources((c.sources || []).join('\n'))
    setRules((c.rules || []).join('\n'))
    setSaved(false)
  }

  useEffect(() => {
    let live = true
    request<Channel[]>('/channels')
      .then((p) => {
        if (live) {
          setPresets(p)
          if (p[0]) load(p[0])
        }
      })
      .catch((e) => live && setError(String(e)))
    listMuseAccounts()
      .then((v) => {
        if (live) setAccounts(v)
      })
      .catch(() => {})
    const list = async (path: string) => {
      const r = await fetch(API_URL + path)
      return r.ok ? r.json() : []
    }
    Promise.allSettled([list('/api/voices'), list('/api/voices/presets')]).then(([a, b]) => {
      if (live)
        setVoices([
          ...(a.status === 'fulfilled' ? a.value : []).map((v: { voice_id: string; name: string }) => ({
            id: v.voice_id,
            name: v.name,
          })),
          ...(b.status === 'fulfilled' ? b.value : []).map((v: { name: string }) => ({
            id: v.name,
            name: v.name,
          })),
        ])
    })
    return () => {
      live = false
    }
  }, [])

  function field<K extends keyof Channel>(k: K, v: Channel[K]) {
    setChannel((prev) => ({ ...prev, [k]: v }))
    setSaved(false)
  }

  async function submit(saveOnly: boolean) {
    setError('')
    if (!saveOnly && !topic.trim()) {
      setError('Vui lòng nhập ý tưởng hoặc mô tả nội dung video.')
      return
    }
    const channelName = channel.name.trim() || 'Kênh của tôi'
    const brandVoice = channel.brand_voice.trim() || 'Tự nhiên, lôi cuốn, gần gũi và truyền cảm hứng.'
    const payload = {
      ...channel,
      name: channelName,
      brand_voice: brandVoice,
      sources: sources
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean),
      rules: rules
        .split(/\r?\n/)
        .map((v) => v.trim())
        .filter(Boolean),
    }
    setBusy(true)
    try {
      if (saveOnly) {
        const c = await request<Channel>('/channels', 'PUT', payload)
        setPresets((p) => [...p.filter((x) => x.name !== c.name), c])
        load(c)
        setSaved(true)
      } else {
        const key = JSON.stringify([topic, payload])
        if (attempt.current.key !== key) attempt.current = { key, id: crypto.randomUUID() }
        const ep = await request<Episode>('/episodes', 'POST', {
          topic: topic.trim(),
          channel: payload,
          request_id: attempt.current.id,
        })
        onCreated(ep)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const scenesCount = Math.max(1, Math.ceil((channel.seconds || 45) / 10))

  return (
    <form
      className="mp-card mp-form"
      onSubmit={(e) => {
        e.preventDefault()
        void submit(false)
      }}
    >
      <div className="mp-title" style={{ marginBottom: 12 }}>
        <div>
          <h2>Tạo tập mới</h2>
          <small style={{ color: '#64748b' }}>
            Nhập ý tưởng và thời lượng, 3 Muse sẽ tự động nghiên cứu, viết kịch bản và sản xuất video hoàn chỉnh.
          </small>
        </div>
      </div>

      {/* Trọng tâm lớn nhất: Khung nhập mô tả ý tưởng & nội dung video */}
      <label style={{ display: 'grid', gap: 6 }}>
        <span style={{ fontWeight: 600, fontSize: 14 }}>
          Ý tưởng & Mô tả nội dung video <span style={{ color: '#e11d48' }}>*</span>
        </span>
        <textarea
          rows={4}
          value={topic}
          onChange={(e) => setTopic(e.target.value)}
          placeholder="Nhập ý tưởng, dàn ý, cốt truyện hoặc thông điệp bạn muốn truyền tải... Bạn có thể nhập từ 1 câu gợi ý đến cả đoạn văn miêu tả chi tiết."
          autoFocus
          style={{
            lineHeight: 1.55,
            fontSize: 14,
            padding: '10px 12px',
            borderColor: topic.trim() ? '#94a3b8' : undefined,
          }}
        />
      </label>

      {/* Hàng thông số chính: Thời lượng, Khung hình, Giọng đọc, Kênh */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        <label>
          Thời lượng mục tiêu (giây)
          <input
            type="number"
            min={10}
            max={180}
            value={channel.seconds}
            onChange={(e) => field('seconds', Number(e.target.value))}
          />
          <small style={{ color: '#64748b', marginTop: 2 }}>
            Clip AI max 10s/cảnh · Tự chia ~{scenesCount} cảnh
          </small>
        </label>

        <label>
          Khung hình
          <select
            value={channel.aspect}
            onChange={(e) => field('aspect', e.target.value as Channel['aspect'])}
          >
            <option value="9:16">9:16 (Dọc · Shorts, TikTok, Reels)</option>
            <option value="16:9">16:9 (Ngang · YouTube, Facebook)</option>
          </select>
        </label>

        <label>
          Giọng đọc AI
          <select value={channel.voice_id} onChange={(e) => field('voice_id', e.target.value)}>
            <option value="">Mặc định dịch vụ giọng đọc</option>
            {voices.map((v) => (
              <option value={v.id} key={v.id}>
                {v.name}
              </option>
            ))}
          </select>
        </label>

        {presets.length > 0 ? (
          <label>
            Kênh xuất bản
            <select
              value={presets.some((c) => c.name === channel.name) ? channel.name : ''}
              onChange={(e) => {
                if (!e.target.value) {
                  load(blankChannel)
                  setCustomizeChannel(true)
                } else {
                  load(presets.find((c) => c.name === e.target.value) ?? blankChannel)
                }
              }}
            >
              {presets.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
              <option value="">+ Tạo kênh mới</option>
            </select>
          </label>
        ) : (
          <label>
            Tên kênh
            <input
              maxLength={100}
              value={channel.name}
              onChange={(e) => field('name', e.target.value)}
              placeholder="Ví dụ: Kênh của tôi, Khoa học..."
            />
          </label>
        )}
      </div>

      {error && (
        <p role="alert" className="mp-error" style={{ margin: '4px 0' }}>
          {error}
        </p>
      )}

      {/* Thanh hành động chính */}
      <div className="mp-actions" style={{ justifyContent: 'space-between', marginTop: 6 }}>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="mp-primary" disabled={busy} type="submit">
            <Play size={16} className="mp-icon-mono" />
            Bắt đầu sản xuất
          </button>
          <button
            type="button"
            className="mp-btn-secondary-mono"
            onClick={() => setCustomizeChannel((v) => !v)}
          >
            <SlidersHorizontal size={15} className="mp-icon-mono" />
            {customizeChannel ? 'Thu gọn tùy chọn' : 'Tùy chọn thêm (nguồn tin, giọng văn...)'}
          </button>
        </div>
        {customizeChannel && (
          <button disabled={busy} type="button" onClick={() => void submit(true)}>
            <Save size={15} className="mp-icon-mono" />
            {saved ? 'Đã lưu cấu hình' : 'Lưu cấu hình kênh'}
          </button>
        )}
      </div>

      {/* Mục tùy chọn nâng cao: không bắt buộc URL, không bắt buộc phong cách */}
      {customizeChannel && (
        <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid #e2e8f0', display: 'grid', gap: 14 }}>
          <label>
            Nguồn tin tham khảo (URL) · Không bắt buộc
            <textarea
              rows={2}
              value={sources}
              onChange={(e) => {
                setSources(e.target.value)
                setSaved(false)
              }}
              placeholder="https://... (Mỗi dòng một URL. Để trống nếu muốn Muse tự do tìm kiếm dữ liệu và sáng tạo)"
            />
            <small style={{ color: '#64748b' }}>
              Để trống nếu muốn Muse tự biên soạn dữ kiện từ ý tưởng của bạn.
            </small>
          </label>

          <label>
            Giọng văn của kênh · Không bắt buộc
            <textarea
              rows={2}
              value={channel.brand_voice}
              onChange={(e) => field('brand_voice', e.target.value)}
              placeholder="Ví dụ: Hóm hỉnh, kịch tính, ngắn gọn, lôi cuốn... (Mặc định: Tự nhiên, lôi cuốn, gần gũi)"
            />
          </label>

          <details style={{ marginTop: 4 }}>
            <summary style={{ cursor: 'pointer', fontWeight: 600, color: '#475569' }}>
              Đội Muse và thiết lập chuyên sâu
            </summary>
            <div className="mp-fields" style={{ marginTop: 10 }}>
              <div className="mp-roles">
                {roles.map((role, i) => (
                  <label key={role}>
                    Muse {i + 1} · {roleNames[role]}
                    <select
                      value={channel.accounts[role] ?? ''}
                      onChange={(e) => field('accounts', { ...channel.accounts, [role]: e.target.value })}
                    >
                      <option value="">Gán theo đội hình</option>
                      {accounts.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.label}
                          {a.status !== 'active' ? ' · chưa sẵn sàng' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                ))}
              </div>
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: 'pointer', color: '#64748b' }}>Chỉ dẫn riêng cho từng vai</summary>
                <div className="mp-fields" style={{ marginTop: 8 }}>
                  {roles.map((role) => (
                    <label key={role}>
                      {roleNames[role]}
                      <textarea
                        rows={2}
                        maxLength={4000}
                        value={channel.instructions?.[role] ?? ''}
                        onChange={(e) =>
                          field('instructions', { ...channel.instructions, [role]: e.target.value })
                        }
                      />
                    </label>
                  ))}
                </div>
              </details>
              <label className="mp-check">
                <input
                  type="checkbox"
                  checked={channel.fallback}
                  onChange={(e) => field('fallback', e.target.checked)}
                />
                Dùng tài khoản dự phòng khi tài khoản của vai hết phiên
              </label>
              <label className="mp-check">
                <input
                  type="checkbox"
                  checked={channel.preview_first}
                  onChange={(e) => field('preview_first', e.target.checked)}
                />
                Duyệt cảnh đầu có giọng đọc trước khi dựng tiếp
              </label>
              <label>
                Quy tắc kênh · mỗi dòng một quy tắc
                <textarea
                  rows={2}
                  value={rules}
                  onChange={(e) => {
                    setRules(e.target.value)
                    setSaved(false)
                  }}
                  placeholder="Ví dụ: Không dùng từ ngữ giật gân, luôn có lời kêu gọi tương tác..."
                />
              </label>
              <div className="mp-pair">
                <label>
                  Giờ săn tin hằng ngày
                  <input
                    type="time"
                    value={channel.daily_at}
                    onChange={(e) => field('daily_at', e.target.value)}
                  />
                </label>
                <label>
                  Từ khóa theo lịch
                  <input
                    value={channel.daily_topic}
                    onChange={(e) => field('daily_topic', e.target.value)}
                    placeholder="Chủ đề mặc định khi chạy lịch"
                  />
                </label>
              </div>
            </div>
          </details>
        </div>
      )}
    </form>
  )
}
