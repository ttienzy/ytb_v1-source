import { useCallback, useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  AlertTriangle,
  Clock3,
  ExternalLink,
  KeyRound,
  Layers,
  Loader2,
  Music,
  Play,
  RotateCcw,
  Settings,
  Trash2,
  Upload,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import type { BgmOut } from '../bgm/types'
import type { Voice } from '../voices/types'
import { BatchQueuePanel } from './components/BatchQueuePanel'
import { PipelineDiagram } from './components/PipelineDiagram'
import { VideoResultCard } from './components/VideoResultCard'
import type { JobOut } from './types'

export function StudioPage({
  setActivePage,
}: {
  setActivePage: (p: string) => void
}) {
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [rawText, setRawText] = useState('')
  const [rawFile, setRawFile] = useState<File | null>(null)
  const [voiceId, setVoiceId] = useState('')
  const [clonedVoices, setClonedVoices] = useState<Voice[]>([])
  const [bgmList, setBgmList] = useState<BgmOut[]>([])
  const [bgmEnabled, setBgmEnabled] = useState(true)
  const [bgmIds, setBgmIds] = useState<string[]>([])
  const [bgmVolume, setBgmVolume] = useState(0.1)
  const [jobId, setJobId] = useState<string | null>(null)
  const [job, setJob] = useState<JobOut | null>(null)
  const [submitError, setSubmitError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [mode, setMode] = useState<'single' | 'batch'>('single')
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // YouTube Bot-Wall Login State
  const [ytLoggingIn, setYtLoggingIn] = useState(false)
  const [ytLoginMsg, setYtLoginMsg] = useState('')
  const [resumingJob, setResumingJob] = useState(false)

  function isYouTubeBotWallError(errorStr?: string): boolean {
    if (!errorStr) return false
    const low = errorStr.toLowerCase()
    return (
      low.includes('sign in to confirm') ||
      low.includes('not a bot') ||
      low.includes('exporting-youtube-cookies') ||
      low.includes('--cookies') ||
      low.includes('cookies-from-browser') ||
      low.includes('bot-wall')
    )
  }

  async function handleLoginYouTube() {
    setYtLoggingIn(true)
    setYtLoginMsg('Đang mở Chrome để bạn đăng nhập YouTube... Vui lòng đăng nhập trên cửa sổ Chrome vừa mở.')
    try {
      const response = await fetch(`${API_URL}/api/recap/yt/login`, {
        method: 'POST',
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.detail || 'Đăng nhập thất bại')
      setYtLoginMsg('✅ Đã đăng nhập và lưu Cookie YouTube thành công! Đang tự động tiếp tục tiến trình...')
      if (job?.job_id) {
        setTimeout(() => handleResumeJob(), 1200)
      }
    } catch (error: any) {
      setYtLoginMsg(`❌ ${error instanceof Error ? error.message : 'Đăng nhập thất bại.'}`)
    } finally {
      setYtLoggingIn(false)
    }
  }

  async function handleResumeJob() {
    if (!job?.job_id) return
    setResumingJob(true)
    try {
      const response = await fetch(`${API_URL}/api/recap/jobs/${job.job_id}/resume`, {
        method: 'POST',
      })
      if (!response.ok) {
        const err = await response.json()
        throw new Error(err.detail || 'Lỗi khi tiếp tục tiến trình')
      }
      if (pollRef.current) clearInterval(pollRef.current)
      pollRef.current = setInterval(() => pollJob(job.job_id), 1500)
      pollJob(job.job_id)
    } catch (error: any) {
      alert(error instanceof Error ? error.message : 'Lỗi khi thử lại tiến trình.')
    } finally {
      setResumingJob(false)
    }
  }

  // Load voices + bgm on mount
  useEffect(() => {
    fetch(`${API_URL}/api/voices`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then(d => {
        const list: Voice[] = d.voices ?? d ?? []
        setClonedVoices(list)
        if (!voiceId && list.length) setVoiceId(list[0].voice_id)
      })
      .catch(() => {})
    fetch(`${API_URL}/api/bgm`)
      .then(r => (r.ok ? r.json() : Promise.reject()))
      .then((d: BgmOut[]) => {
        const list = d ?? []
        setBgmList(list)
        if (list.length > 0) {
          setBgmIds(list.map(t => t.track_id))
        }
      })
      .catch(() => {})
  }, []) // eslint-disable-line

  // Poll loop
  const pollJob = useCallback(async (id: string) => {
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs/${id}`)
      if (!r.ok) return
      const data: JobOut = await r.json()
      setJob(data)
      // Stop polling when pipeline fully done or error
      if (
        data.overall === 'merged' ||
        data.overall === 'polished' ||
        data.overall === 'error'
      ) {
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
      }
    } catch {
      /* network hiccup — keep polling */
    }
  }, [])

  useEffect(() => {
    if (!jobId) return
    pollRef.current = setInterval(() => pollJob(jobId), 1500)
    pollJob(jobId)
    return () => {
      if (pollRef.current) clearInterval(pollRef.current)
    }
  }, [jobId, pollJob])

  async function startPipeline() {
    if (!youtubeUrl.trim()) {
      setSubmitError('Dán link YouTube.')
      return
    }
    if (!voiceId) {
      setSubmitError('Chọn giọng trước.')
      return
    }
    if (bgmEnabled && bgmIds.length === 0) {
      setSubmitError('Bật nhạc nền thì chọn ít nhất 1 track.')
      return
    }
    setSubmitError('')
    setSubmitting(true)
    setJob(null)
    try {
      const form = new FormData()
      form.append('youtube_url', youtubeUrl.trim())
      form.append('voice_id', voiceId)
      if (rawFile)
        form.append('raw_file', rawFile) // file đính kèm → skip auto-fetch (ưu tiên)
      else if (rawText.trim())
        form.append('raw_text', rawText) // dán text → skip auto-fetch
      if (bgmEnabled && bgmIds.length) {
        form.append('bgm_ids', JSON.stringify(bgmIds))
        form.append('bgm_volume', String(bgmVolume))
      }
      const r = await fetch(`${API_URL}/api/recap/run`, {
        method: 'POST',
        body: form,
      })
      const data = await r.json()
      if (!r.ok)
        throw new Error(data.detail || data.error || `Lỗi ${r.status}`)
      setJobId(data.job_id)
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : 'Khởi động pipeline thất bại.'
      )
    } finally {
      setSubmitting(false)
    }
  }

  function reset() {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setJobId(null)
    setJob(null)
    setSubmitError('')
    setRawText('')
    setRawFile(null)
    setYoutubeUrl('')
    setBgmEnabled(true)
    setBgmVolume(0.1)
    if (bgmList.length > 0) setBgmIds(bgmList.map(t => t.track_id))
  }

  const allSegs = (job?.recap?.scenes ?? []).flatMap(s => s.segments)

  return (
    <section className="settings-page studio-page">
      <div className="settings-heading">
        <div>
          <h1>Studio</h1>
          <p className="page-subtitle">
            Dán link YouTube — transcript tự lấy, <strong>1 click</strong>, Cut
            &amp; Voice chạy song song, ghép tự động.
          </p>
        </div>
      </div>

      {/* ── Input form ── */}
      <div className="settings-card" id="formCard">
        {/* Tab toggle: Đơn lẻ / Hàng loạt */}
        <div className="batch-tab-group">
          <button
            type="button"
            id="tab-single"
            className={`batch-tab-btn ${mode === 'single' ? 'active' : ''}`}
            onClick={() => setMode('single')}
          >
            <Play size={13} />
            Đơn lẻ (1 video)
          </button>
          <button
            type="button"
            id="tab-batch"
            className={`batch-tab-btn ${mode === 'batch' ? 'active' : ''}`}
            onClick={() => setMode('batch')}
          >
            <Layers size={13} />
            Hàng loạt (Queue tối đa 10)
          </button>
        </div>

        {mode === 'single' ? (
          <>
            {/* NGUỒN (Đơn lẻ) */}
            <div className="fsection">
              <p className="foverline">NGUỒN</p>
              <div className="fgrid">
                <div className="field">
                  <label>Link YouTube</label>
                  <input
                    value={youtubeUrl}
                    onChange={e => setYoutubeUrl(e.target.value)}
                    placeholder="https://www.youtube.com/watch?v=..."
                    disabled={Boolean(jobId)}
                  />
                </div>
                <div className="field field-full">
                  <label>
                    Raw transcript{' '}
                    <span>
                      (tùy chọn — đính kèm file hoặc dán text khi YouTube chặn tự
                      lấy; để trống → tự fetch)
                    </span>
                  </label>
                  <div className="raw-row">
                    <label
                      className="file-trig"
                      style={{
                        opacity: jobId ? 0.5 : 1,
                        pointerEvents: jobId ? 'none' : 'auto',
                      }}
                    >
                      <Upload size={15} />
                      <span className="fname">
                        {rawFile ? rawFile.name : 'Đính kèm raw.txt'}
                      </span>
                      {rawFile && (
                        <span className="fsize">
                          · {(rawFile.size / 1024).toFixed(0)} KB
                        </span>
                      )}
                      <input
                        type="file"
                        accept=".txt,.json"
                        style={{ display: 'none' }}
                        onChange={e => setRawFile(e.target.files?.[0] ?? null)}
                      />
                      <span
                        style={{
                          marginLeft: 'auto',
                          fontSize: 11,
                          color: 'var(--indigo2)',
                        }}
                      >
                        {rawFile ? 'Đổi ↑' : 'File ↑'}
                      </span>
                    </label>
                    {rawFile && (
                      <button
                        type="button"
                        className="raw-clear"
                        onClick={() => setRawFile(null)}
                      >
                        ✕ huỷ file
                      </button>
                    )}
                  </div>
                  <textarea
                    className="raw-input"
                    value={rawText}
                    onChange={e => setRawText(e.target.value)}
                    placeholder={
                      rawFile
                        ? 'Đã đính kèm file — text ở đây bị bỏ qua'
                        : 'Hoặc dán transcript tại đây (mỗi dòng [MM:SS] caption). Bỏ trống cả 2 → tự lấy từ YouTube.'
                    }
                    rows={3}
                    disabled={Boolean(jobId) || Boolean(rawFile)}
                  />
                  {(rawFile || rawText.trim()) && (
                    <span className="raw-hint">
                      {rawFile
                        ? `file ${rawFile.name} (${(
                            rawFile.size / 1024
                          ).toFixed(0)} KB)`
                        : `${rawText.length.toLocaleString()} ký tự`}{' '}
                      · sẽ skip auto-fetch
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* GIỌNG & NHẠC (Đơn lẻ) */}
            <div className="fsection">
              <p className="foverline">GIỌNG &amp; NHẠC</p>
              <div className="fgrid">
                <div className="field">
                  <label>Voice</label>
                  {clonedVoices.length === 0 ? (
                    <p className="settings-message" style={{ marginTop: 4 }}>
                      Chưa có giọng — tạo ở Voices trước.
                    </p>
                  ) : (
                    <select
                      value={voiceId}
                      onChange={e => setVoiceId(e.target.value)}
                      disabled={Boolean(jobId)}
                      style={{
                        width: '100%',
                        height: 44,
                        padding: '0 12px',
                        background: 'var(--bg3)',
                        border: '1px solid var(--border)',
                        borderRadius: 9,
                        color: 'var(--text)',
                        fontSize: 13,
                      }}
                    >
                      {clonedVoices.map(v => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="field field-full">
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={bgmEnabled}
                      onChange={e => setBgmEnabled(e.target.checked)}
                      disabled={Boolean(jobId)}
                      style={{ width: 16, height: 16 }}
                    />
                    <Music size={15} /> Nhạc nền (BGM){' '}
                    <span style={{ fontWeight: 400, color: 'var(--text2)' }}>
                      — mix dưới VO; chọn nhiều → tự nối theo thứ tự, video dài hơn
                      sẽ lặp
                    </span>
                  </label>
                  {bgmEnabled && (
                    <div className="bgm-body">
                      {bgmList.length === 0 ? (
                        <p className="bgm-empty">
                          Chưa có track — thêm ở “Thư viện nhạc”.
                        </p>
                      ) : (
                        <div className="chips">
                          {bgmList.map(t => {
                            const order = bgmIds.indexOf(t.track_id)
                            const on = order >= 0
                            return (
                              <button
                                key={t.track_id}
                                type="button"
                                className={`chip${on ? ' chip-active' : ''}`}
                                disabled={Boolean(jobId)}
                                onClick={() =>
                                  setBgmIds(prev =>
                                    on
                                      ? prev.filter(x => x !== t.track_id)
                                      : [...prev, t.track_id]
                                  )
                                }
                              >
                                {on && (
                                  <span className="chip-order">{order + 1}. </span>
                                )}
                                {t.name}
                                {t.duration_sec
                                  ? ` · ${t.duration_sec.toFixed(0)}s`
                                  : ''}
                                {t.needs_attribution ? ' · CC' : ''}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      <label className="bgm-vol">
                        <span className="bgm-vol-label">
                          Volume: {(bgmVolume * 100).toFixed(0)}%
                        </span>
                        <input
                          type="range"
                          className="bgm-range"
                          min={0}
                          max={0.5}
                          step={0.01}
                          value={bgmVolume}
                          onChange={e => setBgmVolume(parseFloat(e.target.value))}
                          disabled={Boolean(jobId)}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Footer buttons (Đơn lẻ) */}
            <div className="ff">
              {!jobId ? (
                <button
                  type="button"
                  className="btn-p"
                  onClick={startPipeline}
                  disabled={submitting}
                >
                  {submitting ? (
                    <Loader2 size={15} className="spin" />
                  ) : (
                    <Play size={15} />
                  )}
                  {submitting ? 'Đang khởi động…' : 'Tạo recap video'}
                </button>
              ) : (
                <button type="button" className="btn-g" onClick={reset}>
                  <Trash2 size={14} /> Bắt đầu lại
                </button>
              )}
              <button
                type="button"
                className="btn-g"
                onClick={() => setActivePage('Lịch sử')}
                style={{ gap: 6 }}
              >
                <Clock3 size={14} /> Xem Lịch sử
              </button>
              {submitError && (
                <span style={{ color: '#dc2626', fontSize: 12 }}>
                  <AlertCircle
                    size={13}
                    style={{ display: 'inline', marginRight: 4 }}
                  />
                  {submitError}
                </span>
              )}
              {job && !submitting && (
                <span
                  className="hint"
                  style={{
                    marginLeft: 'auto',
                    color:
                      job.overall === 'error'
                        ? '#dc2626'
                        : job.overall === 'merged' || job.overall === 'polished'
                        ? '#16a34a'
                        : '#6366f1',
                  }}
                >
                  {job.overall === 'polished'
                    ? '✅ Hoàn tất (có BGM)'
                    : job.overall === 'merged'
                    ? '✅ Hoàn tất'
                    : job.overall === 'error'
                    ? '❌ Có lỗi'
                    : '⟳ Đang chạy…'}
                </span>
              )}
            </div>
          </>
        ) : (
          <>
            {/* GIỌNG & NHẠC (Batch) */}
            <div className="fsection">
              <p className="foverline">GIỌNG &amp; NHẠC (DÙNG CHUNG BATCH)</p>
              <div className="fgrid">
                <div className="field">
                  <label>Voice</label>
                  {clonedVoices.length === 0 ? (
                    <p className="settings-message" style={{ marginTop: 4 }}>
                      Chưa có giọng — tạo ở Voices trước.
                    </p>
                  ) : (
                    <select
                      value={voiceId}
                      onChange={e => setVoiceId(e.target.value)}
                      style={{
                        width: '100%',
                        height: 44,
                        padding: '0 12px',
                        background: 'var(--bg3)',
                        border: '1px solid var(--border)',
                        borderRadius: 9,
                        color: 'var(--text)',
                        fontSize: 13,
                      }}
                    >
                      {clonedVoices.map(v => (
                        <option key={v.voice_id} value={v.voice_id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div className="field field-full">
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      cursor: 'pointer',
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={bgmEnabled}
                      onChange={e => setBgmEnabled(e.target.checked)}
                      style={{ width: 16, height: 16 }}
                    />
                    <Music size={15} /> Nhạc nền (BGM){' '}
                    <span style={{ fontWeight: 400, color: 'var(--text2)' }}>
                      — mix dưới VO; chọn nhiều → tự nối theo thứ tự
                    </span>
                  </label>
                  {bgmEnabled && (
                    <div className="bgm-body">
                      {bgmList.length === 0 ? (
                        <p className="bgm-empty">
                          Chưa có track — thêm ở “Thư viện nhạc”.
                        </p>
                      ) : (
                        <div className="chips">
                          {bgmList.map(t => {
                            const order = bgmIds.indexOf(t.track_id)
                            const on = order >= 0
                            return (
                              <button
                                key={t.track_id}
                                type="button"
                                className={`chip${on ? ' chip-active' : ''}`}
                                onClick={() =>
                                  setBgmIds(prev =>
                                    on
                                      ? prev.filter(x => x !== t.track_id)
                                      : [...prev, t.track_id]
                                  )
                                }
                              >
                                {on && (
                                  <span className="chip-order">{order + 1}. </span>
                                )}
                                {t.name}
                                {t.duration_sec
                                  ? ` · ${t.duration_sec.toFixed(0)}s`
                                  : ''}
                                {t.needs_attribution ? ' · CC' : ''}
                              </button>
                            )
                          })}
                        </div>
                      )}
                      <label className="bgm-vol">
                        <span className="bgm-vol-label">
                          Volume: {(bgmVolume * 100).toFixed(0)}%
                        </span>
                        <input
                          type="range"
                          className="bgm-range"
                          min={0}
                          max={0.5}
                          step={0.01}
                          value={bgmVolume}
                          onChange={e => setBgmVolume(parseFloat(e.target.value))}
                        />
                      </label>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Batch Panel (Textarea danh sách link + Nút chạy + Status list) */}
            <BatchQueuePanel
              voiceId={voiceId}
              bgmEnabled={bgmEnabled}
              bgmIds={bgmIds}
              bgmVolume={bgmVolume}
              disabled={false}
              setActivePage={setActivePage}
            />
          </>
        )}
      </div>

      {/* ── Pipeline diagram ── */}
      {job && (
        <div className="pc">
          <PipelineDiagram
            job={job}
            voiceId={voiceId}
            polishEnabled={bgmEnabled && bgmIds.length > 0}
          />

          {/* Error detail */}
          {job.overall === 'error' && job.error && (
            isYouTubeBotWallError(job.error) ? (
              <div
                style={{
                  marginTop: 16,
                  padding: 16,
                  background: '#fff1f2',
                  border: '1.5px solid #fecdd3',
                  borderRadius: 12,
                  color: '#9f1239',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 700, fontSize: 14 }}>
                  <AlertTriangle size={18} color="#e11d48" />
                  <span>YouTube yêu cầu xác thực tài khoản (Bot-Wall)</span>
                </div>
                <div style={{ marginTop: 6, fontSize: 12.5, color: '#475569', lineHeight: 1.5 }}>
                  YouTube phát hiện lưu lượng tải video tự động và chặn bằng yêu cầu <em>"Sign in to confirm you're not a bot"</em>. Bạn cần đăng nhập tài khoản YouTube để cập nhật Cookie.
                </div>

                {ytLoginMsg && (
                  <div
                    style={{
                      marginTop: 10,
                      padding: '8px 12px',
                      borderRadius: 8,
                      background: ytLoginMsg.startsWith('✅') ? '#f0fdf4' : '#fff',
                      border: '1px solid',
                      borderColor: ytLoginMsg.startsWith('✅') ? '#bbf7d0' : '#fecdd3',
                      fontSize: 12,
                      color: ytLoginMsg.startsWith('✅') ? '#166534' : '#be123c',
                    }}
                  >
                    {ytLoginMsg}
                  </div>
                )}

                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                  <button
                    type="button"
                    className="btn-p"
                    onClick={handleLoginYouTube}
                    disabled={ytLoggingIn}
                    style={{
                      background: '#e11d48',
                      height: 36,
                      padding: '0 14px',
                      fontSize: 12.5,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    {ytLoggingIn ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}
                    {ytLoggingIn ? 'Đang mở Chrome…' : 'Đăng nhập YouTube qua Chrome'}
                  </button>

                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={() => setActivePage('Cài đặt')}
                    style={{ height: 36, padding: '0 12px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    <Settings size={14} /> Chuyển đến trang Cài đặt
                  </button>

                  <button
                    type="button"
                    className="btn-cancel"
                    onClick={handleResumeJob}
                    disabled={resumingJob || ytLoggingIn}
                    style={{ height: 36, padding: '0 12px', fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 6 }}
                  >
                    {resumingJob ? <Loader2 size={14} className="spin" /> : <RotateCcw size={14} />}
                    Thử lại tiến trình
                  </button>
                </div>
              </div>
            ) : (
              <div className="err-block">
                <AlertCircle size={15} style={{ flexShrink: 0 }} />
                <span>{job.error}</span>
              </div>
            )
          )}

          {/* Final block — polished (BGM) */}
          {(job.overall === 'polished' || job.overall === 'merged') &&
            job.job_id && (
              <VideoResultCard
                jobId={job.job_id}
                variant={job.overall === 'polished' ? 'polished' : 'merged'}
                segments={allSegs.length}
                scenes={job.recap?.scenes?.length ?? 0}
                overspeedCount={job.overspeed?.length}
                credits={job.overall === 'polished' ? job.credits : null}
                caption={job.caption || job.recap?.caption}
                onReset={reset}
              />
            )}
        </div>
      )}
    </section>
  )
}
