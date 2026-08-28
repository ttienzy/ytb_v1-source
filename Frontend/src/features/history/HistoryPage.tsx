import { useEffect, useRef, useState } from 'react'
import {
  AlertCircle,
  Clock3,
  FileText,
  Film,
  Mic,
  Pause,
  Play,
  Scissors,
  Search,
  Sparkles,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import { fmtTime, fmtTs } from '../../shared/utils/formatters'
import { VideoResultCard } from '../studio/components/VideoResultCard'
import type { JobOut } from '../studio/types'

export function HistoryPage() {
  const [jobs, setJobs] = useState<JobOut[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<JobOut | null>(null)
  const [playingVo, setPlayingVo] = useState<number | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)

  async function loadJobs() {
    setLoading(true)
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs`)
      const data: JobOut[] = r.ok ? await r.json() : []
      setJobs(Array.isArray(data) ? data : [])
      if (data.length && !sel) setSel(data[0])
    } catch {
      setJobs([])
    } finally {
      setLoading(false)
    }
  }
  useEffect(() => {
    loadJobs()
  }, []) // eslint-disable-line

  const overallLabel: Record<string, string> = {
    merged: 'Hoàn tất',
    polished: 'BGM',
    running: 'Đang chạy',
    error: 'Lỗi',
    recap_done: 'Đã recap',
    idle: 'Chờ',
  }
  const overallBadge: Record<string, string> = {
    merged: 'b-merged',
    polished: 'b-merged',
    running: 'b-running',
    error: 'b-error',
    recap_done: 'b-idle',
    idle: 'b-idle',
  }

  const filtered = jobs.filter(
    j =>
      j.youtube_url?.toLowerCase().includes(search.toLowerCase()) ||
      j.job_id?.toLowerCase().includes(search.toLowerCase())
  )

  function stopVo() {
    audioRef.current?.pause()
    audioRef.current = null
    setPlayingVo(null)
  }
  async function toggleVo(job: JobOut, idx: number) {
    if (playingVo === idx) {
      stopVo()
      return
    }
    audioRef.current?.pause()
    setPlayingVo(idx)
    try {
      const r = await fetch(
        `${API_URL}/api/recap/jobs/${job.job_id}/voice/${idx}`
      )
      if (!r.ok) {
        setPlayingVo(null)
        return
      }
      const blob = await r.blob()
      const url = URL.createObjectURL(blob)
      const a = new Audio(url)
      a.onended = () => {
        URL.revokeObjectURL(url)
        setPlayingVo(null)
      }
      audioRef.current = a
      await a.play()
    } catch {
      setPlayingVo(null)
    }
  }

  const segsOf = (j: JobOut) =>
    (j.recap?.scenes ?? []).flatMap(s => s.segments)

  return (
    <section className="settings-page">
      <div className="settings-heading">
        <div>
          <h1>Lịch sử</h1>
          <p className="page-subtitle">
            Mọi job đã chạy — chi tiết recap, clips, voice và video cuối kèm dấu
            thời gian.
          </p>
        </div>
        <button
          type="button"
          className="chrome-button"
          onClick={loadJobs}
        >
          <Search size={15} /> Làm mới
        </button>
      </div>

      <div className="history-layout">
        {/* ── List ── */}
        <div>
          <div className="swrap">
            <Search size={14} />
            <input
              className="hsearch"
              placeholder="Tìm link hoặc job ID…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {loading && <p className="settings-message">Đang tải…</p>}
          <div className="hlist">
            {filtered.length === 0 && !loading && (
              <p className="settings-message">Không tìm thấy job nào.</p>
            )}
            {filtered.map(j => (
              <div
                key={j.job_id}
                className={`hitem${sel?.job_id === j.job_id ? ' sel' : ''}`}
                onClick={() => {
                  setSel(j)
                  stopVo()
                }}
              >
                <div className="hicon">
                  <Film size={16} />
                </div>
                <div className="hii">
                  <strong>
                    {j.youtube_url
                      ?.replace('https://www.youtube.com/watch?v=', 'yt/')
                      .replace('https://youtube.com/watch?v=', 'yt/') ||
                      j.job_id}
                  </strong>
                  <span>
                    {j.job_id} · {segsOf(j).length} đoạn · {j.voice_id ?? '—'}
                  </span>
                </div>
                <div className="hright">
                  <span
                    className={`badge ${
                      overallBadge[j.overall] ?? 'b-idle'
                    }`}
                  >
                    {overallLabel[j.overall] ?? j.overall}
                  </span>
                  <span className="ts">
                    {fmtTs(j.created_at).split(', ')[1] ?? '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Detail ── */}
        <div className="dpanel">
          {!sel ? (
            <div className="dempty">
              <Clock3 size={40} />
              <div>Chọn một job bên trái để xem chi tiết.</div>
            </div>
          ) : (
            <div
              className="card scroll"
              style={{ padding: 0, overflow: 'hidden' }}
            >
              <div className="dhead">
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    gap: 12,
                  }}
                >
                  <strong
                    style={{ wordBreak: 'break-all', fontSize: 13 }}
                  >
                    {sel.youtube_url}
                  </strong>
                  <span
                    className={`badge ${
                      overallBadge[sel.overall] ?? 'b-idle'
                    }`}
                    style={{ flexShrink: 0 }}
                  >
                    {overallLabel[sel.overall] ?? sel.overall}
                  </span>
                </div>
                <div className="dkv" style={{ marginTop: 12 }}>
                  <span className="k">Job ID</span>
                  <span className="v" style={{ fontFamily: 'monospace' }}>
                    {sel.job_id}
                  </span>
                  <span className="k">Voice</span>
                  <span className="v">{sel.voice_id ?? '—'}</span>
                  <span className="k">Số đoạn</span>
                  <span className="v">
                    {segsOf(sel).length} segment ·{' '}
                    {sel.recap?.scenes?.length ?? 0} cảnh
                  </span>
                  <span className="k">Tạo lúc</span>
                  <span className="v">{fmtTs(sel.created_at)}</span>
                  <span className="k">Cập nhật</span>
                  <span className="v">{fmtTs(sel.updated_at)}</span>
                </div>
              </div>

              {sel.error && (
                <div
                  className="err-block"
                  style={{ margin: '12px 20px 0' }}
                >
                  <AlertCircle size={14} style={{ flexShrink: 0 }} />
                  <span>{sel.error}</span>
                </div>
              )}

              <hr className="divider" style={{ margin: '16px 20px' }} />

              {/* Recap table */}
              <div className="dsec">
                <h3>
                  <Sparkles size={13} /> Recap — kịch bản VO
                </h3>
                {segsOf(sel).length === 0 ? (
                  <p className="settings-message">Chưa có recap.</p>
                ) : (
                  <div className="stw">
                    <table className="st">
                      <thead>
                        <tr>
                          <th>#</th>
                          <th>Cảnh</th>
                          <th>Giờ</th>
                          <th>Dài</th>
                          <th>Vietnamese VO</th>
                        </tr>
                      </thead>
                      <tbody>
                        {sel.recap?.scenes?.flatMap((sc, si) =>
                          sc.segments.map((seg, i) => {
                            const idx =
                              (
                                sel.recap?.scenes?.slice(0, si) ?? []
                              ).reduce(
                                (a, s) => a + s.segments.length,
                                0
                              ) + i
                            return (
                              <tr key={idx}>
                                <td>{idx}</td>
                                <td>
                                  {sc.scene_title ?? `Cảnh ${si + 1}`}
                                </td>
                                <td>
                                  {fmtTime(seg.start_time_sec)} →{' '}
                                  {fmtTime(seg.end_time_sec)}
                                </td>
                                <td>{seg.duration_sec.toFixed(1)}s</td>
                                <td style={{ maxWidth: 240 }}>
                                  {seg.vietnamese_vo}
                                </td>
                              </tr>
                            )
                          })
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Clips */}
              {sel.clips && sel.clips.length > 0 && (
                <div className="dsec mt">
                  <h3>
                    <Scissors size={13} /> Clips đã cắt
                  </h3>
                  <div className="chips">
                    {sel.clips.map(c => (
                      <span key={c} className="chip">
                        🎬 {c}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {/* Voice */}
              {sel.voice_status === 'done' && (
                <div className="dsec mt">
                  <h3>
                    <Mic size={13} /> Voice — nghe thử
                  </h3>
                  <div className="chips">
                    {segsOf(sel).map((_, idx) => {
                      const isOver = sel.overspeed?.includes(idx)
                      const isPlaying = playingVo === idx
                      return (
                        <button
                          type="button"
                          key={idx}
                          className={`chip chip-play${
                            isOver ? ' chip-warn' : ''
                          }`}
                          onClick={() => toggleVo(sel, idx)}
                        >
                          {isPlaying ? (
                            <Pause size={12} />
                          ) : (
                            <Play size={12} />
                          )}{' '}
                          vo_{idx}.wav{isOver ? ' ⚠' : ''}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Final video */}
              <div className="dsec mt">
                <h3>
                  <Film size={13} /> Video cuối
                </h3>
                {sel.job_id && (sel.final_studio || sel.final) ? (
                  <VideoResultCard
                    jobId={sel.job_id}
                    variant={sel.final_studio ? 'polished' : 'merged'}
                    segments={segsOf(sel).length}
                    scenes={sel.recap?.scenes?.length ?? 0}
                    credits={sel.final_studio ? sel.credits : null}
                    caption={sel.caption || sel.recap?.caption}
                    compact
                  />
                ) : (
                  <p className="settings-message">Chưa có video cuối.</p>
                )}
              </div>

              <div style={{ height: 20 }} />
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
