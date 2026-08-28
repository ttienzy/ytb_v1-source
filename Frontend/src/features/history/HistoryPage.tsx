import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  Calendar,
  ChevronLeft,
  ChevronRight,
  Clock3,
  ExternalLink,
  FileText,
  Film,
  Hash,
  Layers,
  Mic,
  Music,
  Pause,
  Play,
  RefreshCw,
  Scissors,
  Search,
  Share2,
  Sparkles,
  Trash2,
} from 'lucide-react'
import { API_URL } from '../../shared/constants'
import { fmtTime, fmtTs } from '../../shared/utils/formatters'
import { VideoResultCard } from '../studio/components/VideoResultCard'
import { PippitHistoryTab } from './components/PippitHistoryTab'
import type { JobOut } from '../studio/types'

function FacebookIcon({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

export function HistoryPage() {

  const [historyTab, setHistoryTab] = useState<'studio' | 'pippit'>('studio')
  const [jobs, setJobs] = useState<JobOut[]>([])

  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [sel, setSel] = useState<JobOut | null>(null)
  const [playingVo, setPlayingVo] = useState<number | null>(null)
  const [activeTab, setActiveTab] = useState<'recap' | 'media'>('recap')
  const [selectedScene, setSelectedScene] = useState<number | 'all'>('all')
  const [page, setPage] = useState(1)
  const [jobToDelete, setJobToDelete] = useState<JobOut | null>(null)
  const [deleting, setDeleting] = useState(false)
  const PAGE_SIZE = 6

  const audioRef = useRef<HTMLAudioElement | null>(null)

  async function loadJobs() {
    setLoading(true)
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs`)
      const data: JobOut[] = r.ok ? await r.json() : []
      setJobs(Array.isArray(data) ? data : [])
      if (data.length) {
        if (!sel || !data.some(d => d.job_id === sel.job_id)) {
          setSel(data[0])
        } else {
          // Cập nhật lại job đang chọn nếu có dữ liệu mới
          const updated = data.find(d => d.job_id === sel.job_id)
          if (updated) setSel(updated)
        }
      }
    } catch {
      setJobs([])
    } finally {
      setLoading(false)
    }
  }

  async function handleDeleteJob(job: JobOut) {
    setDeleting(true)
    try {
      const r = await fetch(`${API_URL}/api/recap/jobs/${job.job_id}`, {
        method: 'DELETE',
      })
      if (r.ok) {
        setJobs(prev => {
          const next = prev.filter(j => j.job_id !== job.job_id)
          if (sel?.job_id === job.job_id) {
            setSel(next.length > 0 ? next[0] : null)
          }
          return next
        })
        setJobToDelete(null)
      } else {
        alert('Xóa video thất bại. Vui lòng thử lại!')
      }
    } catch (e) {
      alert('Đã xảy ra lỗi khi xóa video.')
    } finally {
      setDeleting(false)
    }
  }


  useEffect(() => {
    loadJobs()
  }, []) // eslint-disable-line

  // Reset trang và filter cảnh khi đổi job
  useEffect(() => {
    setPage(1)
    setSelectedScene('all')
    stopVo()
  }, [sel?.job_id]) // eslint-disable-line

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

  const filtered = jobs.filter(j => {
    const q = search.toLowerCase().trim()
    if (!q) return true
    const title = (j.caption?.title || j.recap?.caption?.title || '').toLowerCase()
    const url = (j.youtube_url || '').toLowerCase()
    const id = (j.job_id || '').toLowerCase()
    const hasFb = j.pippit_tasks && j.pippit_tasks.length > 0
    const fbText = hasFb
      ? `facebook fb đã đăng ${j.pippit_tasks?.map((t: any) => `${t.page_name} ${t.page_id}`).join(' ')}`.toLowerCase()
      : ''
    return title.includes(q) || url.includes(q) || id.includes(q) || fbText.includes(q)
  })


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
      const r = await fetch(`${API_URL}/api/recap/jobs/${job.job_id}/voice/${idx}`)
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

  const segsOf = (j: JobOut) => (j.recap?.scenes ?? []).flatMap(s => s.segments)

  // Danh sách segments kèm scene metadata
  const allSegmentsWithMeta = useMemo(() => {
    if (!sel?.recap?.scenes) return []
    let globalIdx = 0
    return sel.recap.scenes.flatMap((sc, sceneIdx) =>
      sc.segments.map(seg => {
        const item = {
          ...seg,
          globalIdx,
          sceneIdx,
          sceneTitle: sc.scene_title || `Cảnh ${sceneIdx + 1}`,
        }
        globalIdx++
        return item
      })
    )
  }, [sel])

  // Lọc theo cảnh
  const displayedSegments = useMemo(() => {
    if (selectedScene === 'all') return allSegmentsWithMeta
    return allSegmentsWithMeta.filter(s => s.sceneIdx === selectedScene)
  }, [allSegmentsWithMeta, selectedScene])

  // Phân trang
  const totalPages = Math.max(1, Math.ceil(displayedSegments.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginatedSegments = displayedSegments.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  )

  const completedCount = jobs.filter(
    j => j.overall === 'polished' || j.overall === 'merged'
  ).length

  function getJobTitle(j: JobOut): string {
    if (j.caption?.title) return j.caption.title
    if (j.recap?.caption?.title) return j.recap.caption.title
    if (j.youtube_url) {
      return j.youtube_url
        .replace('https://www.youtube.com/watch?v=', 'yt/')
        .replace('https://youtube.com/watch?v=', 'yt/')
    }
    return `Job ${j.job_id}`
  }

  return (
    <section className="settings-page">
      {/* ── Compact Header Bar with Tab Switcher ── */}
      <div className="history-header-bar">
        <div className="history-header-left">
          <h1>Lịch sử</h1>
          <div className="history-tab-group">
            <button
              type="button"
              className={`htab-btn ${historyTab === 'studio' ? 'active' : ''}`}
              onClick={() => setHistoryTab('studio')}
            >
              <Film size={13} /> Video Studio ({jobs.length})
            </button>
            <button
              type="button"
              className={`htab-btn ${historyTab === 'pippit' ? 'active' : ''}`}
              onClick={() => setHistoryTab('pippit')}
            >
              <Share2 size={13} /> Đăng Facebook (Pippit)
            </button>
          </div>
          {historyTab === 'studio' && completedCount > 0 && (
            <span className="history-done-badge">{completedCount} hoàn tất</span>
          )}
        </div>
        <div className="history-header-actions">
          {historyTab === 'studio' && (
            <button
              type="button"
              className="chrome-button"
              onClick={loadJobs}
              disabled={loading}
              style={{ minHeight: 34, height: 34, padding: '0 12px', fontSize: 12 }}
            >
              <RefreshCw size={13} className={loading ? 'spin' : ''} />
              {loading ? 'Đang tải...' : 'Làm mới'}
            </button>
          )}
        </div>
      </div>

      {historyTab === 'pippit' ? (
        <PippitHistoryTab />
      ) : (
        <div className="history-layout">
          <div>
            <div className="swrap">
              <Search size={14} />
              <input
                className="hsearch"
                placeholder="Tìm tiêu đề, link hoặc ID…"

              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>

          <div className="hlist">
            {loading && jobs.length === 0 && (
              <p className="settings-message">Đang tải danh sách...</p>
            )}
            {filtered.length === 0 && !loading && (
              <p className="settings-message">Không tìm thấy video nào.</p>
            )}
            {filtered.map(j => {
              const title = getJobTitle(j)
              const segCount = segsOf(j).length
              const isSelected = sel?.job_id === j.job_id
              return (
                <div
                  key={j.job_id}
                  className={`hitem${isSelected ? ' sel' : ''}`}
                  onClick={() => {
                    setSel(j)
                    stopVo()
                  }}
                >
                  <div className="hicon">
                    <Film size={15} />
                  </div>
                  <div className="hii">
                    <strong title={title}>{title}</strong>
                    <span>
                      {j.job_id} · {segCount} đoạn · {fmtTs(j.created_at).split(', ')[1] || '—'}
                    </span>
                  </div>
                  <div className="hright">
                    <div className="hitem-actions">
                      {j.pippit_tasks && j.pippit_tasks.length > 0 && (
                        <span
                          className="badge"
                          style={{
                            background: '#e0f2fe',
                            color: '#0369a1',
                            borderColor: '#bae6fd',
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 4,
                            padding: '2px 7px',
                            fontSize: 10,
                            fontWeight: 700,
                          }}
                          title={`Đã lên lịch/đăng Facebook lên Fanpage: ${j.pippit_tasks.map((t: any) => t.page_name || t.page_id).join(', ')}`}
                        >
                          <FacebookIcon size={10} /> Đã đăng FB
                        </span>
                      )}
                      <span className={`badge ${overallBadge[j.overall] ?? 'b-idle'}`}>
                        {overallLabel[j.overall] ?? j.overall}
                      </span>
                      <button
                        type="button"
                        className="hitem-del"
                        title="Xóa video & giải phóng dung lượng"
                        onClick={e => {
                          e.stopPropagation()
                          setJobToDelete(j)
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* ── Right Detail Panel ── */}
        <div className="dpanel">
          {!sel ? (
            <div className="dempty">
              <Clock3 size={36} />
              <div>Chọn một video bên trái để xem chi tiết.</div>
            </div>
          ) : (
            <div className="card scroll" style={{ padding: 0, overflow: 'hidden' }}>
              {/* ── Detail Header Banner ── */}
              <div className="dhead-banner">
                <div className="dhead-top">
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <h2 className="dhead-title" title={getJobTitle(sel)}>
                      {getJobTitle(sel)}
                    </h2>
                    {sel.youtube_url && (
                      <a
                        href={sel.youtube_url}
                        target="_blank"
                        rel="noreferrer"
                        className="dhead-link"
                        title="Mở link YouTube"
                      >
                        <ExternalLink size={11} /> YouTube
                      </a>
                    )}
                  </div>
                  <div className="dhead-top-right">
                    <span className={`badge ${overallBadge[sel.overall] ?? 'b-idle'}`}>
                      {overallLabel[sel.overall] ?? sel.overall}
                    </span>
                    <button
                      type="button"
                      className="btn-del-job"
                      onClick={() => setJobToDelete(sel)}
                      title="Xóa video và giải phóng dung lượng ổ đĩa"
                    >
                      <Trash2 size={11} /> Xóa
                    </button>
                  </div>
                </div>

                {/* Metadata Pills */}
                <div className="hmeta-pills">
                  <span className="hmeta-pill">
                    <Hash size={11} /> ID: <strong>{sel.job_id}</strong>
                  </span>
                  <span className="hmeta-pill">
                    <Mic size={11} /> Voice: <strong>{sel.voice_id ?? '—'}</strong>
                  </span>
                  <span className="hmeta-pill">
                    <Layers size={11} /> <strong>{segsOf(sel).length}</strong> đoạn ·{' '}
                    <strong>{sel.recap?.scenes?.length ?? 0}</strong> cảnh
                  </span>
                  <span className="hmeta-pill">
                    <Calendar size={11} /> {fmtTs(sel.created_at)}
                  </span>
                  {sel.pippit_tasks && sel.pippit_tasks.length > 0 && (
                    <span
                      className="hmeta-pill"
                      style={{
                        background: '#e0f2fe',
                        color: '#0369a1',
                        borderColor: '#bae6fd',
                        fontWeight: 600,
                      }}
                      title={`Đã lên lịch/đăng lên: ${sel.pippit_tasks.map((t: any) => t.page_name || t.page_id).join(', ')}`}
                    >
                      <FacebookIcon size={12} /> Đã đăng FB ({sel.pippit_tasks.length} lần: <strong>{sel.pippit_tasks.map((t: any) => t.page_name || t.page_id).join(', ')}</strong>)
                    </span>
                  )}
                </div>
              </div>

              {sel.error && (
                <div className="err-block" style={{ margin: '12px 20px 0' }}>
                  <AlertCircle size={14} style={{ flexShrink: 0 }} />
                  <span>{sel.error}</span>
                </div>
              )}

              {/* ── Prominent Video Result & Caption Box ── */}
              <div style={{ padding: '0 16px 12px' }}>
                {sel.job_id && (sel.final_studio || sel.final) ? (
                  <VideoResultCard
                    jobId={sel.job_id}
                    variant={sel.final_studio ? 'polished' : 'merged'}
                    segments={segsOf(sel).length}
                    scenes={sel.recap?.scenes?.length ?? 0}
                    credits={sel.final_studio ? sel.credits : null}
                    caption={sel.caption || sel.recap?.caption}
                    pippitTasks={sel.pippit_tasks}
                    compact
                  />
                ) : sel.recap ? (
                  <div style={{ marginTop: 12 }}>
                    {/* Nếu chưa có video cuối nhưng đã có recap/caption */}
                    {Boolean(sel.caption || sel.recap?.caption) && (
                      <div className="vrc-caption">
                        <div className="vrc-caption-hdr">
                          <div className="vrc-caption-title-wrap">
                            <FileText size={14} /> Caption &amp; Tiêu đề đăng bài
                          </div>
                        </div>
                        {(sel.caption?.title || sel.recap?.caption?.title) && (
                          <p className="caption-title-text">

                            {sel.caption?.title || sel.recap?.caption?.title}
                          </p>
                        )}
                        {(sel.caption?.description || sel.recap?.caption?.description) && (
                          <p className="caption-desc-text">
                            {sel.caption?.description || sel.recap?.caption?.description}
                          </p>
                        )}
                        {((sel.caption?.hashtags || sel.recap?.caption?.hashtags)?.length ?? 0) > 0 && (
                          <div className="caption-tags">
                            {(sel.caption?.hashtags || sel.recap?.caption?.hashtags)?.map(
                              (tag, idx) => (
                                <span key={idx} className="caption-tag">
                                  {tag.startsWith('#') ? tag : `#${tag}`}
                                </span>
                              )
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                ) : null}
              </div>

              {/* ── Content Sub-Tabs ── */}
              <div className="detail-nav-tabs">
                <button
                  type="button"
                  className={`dtab-btn${activeTab === 'recap' ? ' active' : ''}`}
                  onClick={() => setActiveTab('recap')}
                >
                  <Sparkles size={13} /> Kịch bản Recap ({allSegmentsWithMeta.length})
                </button>
                <button
                  type="button"
                  className={`dtab-btn${activeTab === 'media' ? ' active' : ''}`}
                  onClick={() => setActiveTab('media')}
                >
                  <Mic size={13} /> Voice &amp; Clips ({allSegmentsWithMeta.length} đoạn)
                </button>
              </div>

              {/* ── Tab 1: Recap VO with Scene Filter & Pagination ── */}
              {activeTab === 'recap' && (
                <div className="dsec">
                  {allSegmentsWithMeta.length === 0 ? (
                    <p className="settings-message">Chưa có kịch bản recap.</p>
                  ) : (
                    <>
                      {/* Scene Filter Bar */}
                      {sel.recap?.scenes && sel.recap.scenes.length > 1 && (
                        <div className="scene-filter-bar">
                          <button
                            type="button"
                            className={`scene-chip${selectedScene === 'all' ? ' active' : ''}`}
                            onClick={() => {
                              setSelectedScene('all')
                              setPage(1)
                            }}
                          >
                            Tất cả ({allSegmentsWithMeta.length})
                          </button>
                          {sel.recap.scenes.map((sc, sIdx) => {
                            const count = sc.segments.length
                            const scName = sc.scene_title || `Cảnh ${sIdx + 1}`
                            return (
                              <button
                                key={sIdx}
                                type="button"
                                className={`scene-chip${
                                  selectedScene === sIdx ? ' active' : ''
                                }`}
                                onClick={() => {
                                  setSelectedScene(sIdx)
                                  setPage(1)
                                }}
                                title={scName}
                              >
                                Cảnh {sIdx + 1} ({count})
                              </button>
                            )
                          })}
                        </div>
                      )}

                      {selectedScene !== 'all' && sel.recap?.scenes && (
                        <div className="scene-active-title">
                          <Sparkles size={12} color="#6366f1" />
                          <span>
                            Cảnh {selectedScene + 1}:{' '}
                            {sel.recap.scenes[selectedScene]?.scene_title ||
                              `Cảnh ${selectedScene + 1}`}
                          </span>
                        </div>
                      )}

                      {/* Paginated Recap Table */}
                      <div className="stw">
                        <table className="st">
                          <thead>
                            <tr>
                              <th style={{ width: 28, textAlign: 'center' }}>#</th>
                              <th style={{ width: 84 }}>Thời gian</th>
                              <th style={{ width: 44 }}>Dài</th>
                              <th>Kịch bản lồng tiếng (VO)</th>
                            </tr>
                          </thead>
                          <tbody>
                            {paginatedSegments.map(seg => (
                              <tr key={seg.globalIdx}>
                                <td
                                  style={{
                                    fontWeight: 700,
                                    color: '#64748b',
                                    textAlign: 'center',
                                    fontSize: '10.5px',
                                  }}
                                >
                                  {seg.globalIdx + 1}
                                </td>
                                <td
                                  style={{
                                    whiteSpace: 'nowrap',
                                    color: '#64748b',
                                    fontSize: '10px',
                                  }}
                                >
                                  {fmtTime(seg.start_time_sec)} →{' '}
                                  {fmtTime(seg.end_time_sec)}
                                </td>
                                <td style={{ fontWeight: 600, fontSize: '10px' }}>
                                  {seg.duration_sec.toFixed(1)}s
                                </td>
                                <td style={{ lineHeight: 1.45, color: '#1e293b' }}>
                                  {selectedScene === 'all' && (
                                    <span className="seg-tag">
                                      {seg.sceneTitle}
                                    </span>
                                  )}
                                  <div>{seg.vietnamese_vo}</div>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Pagination Controls */}
                      {totalPages > 1 && (
                        <div className="pagination-bar">
                          <span className="page-info">
                            Hiển thị {(currentPage - 1) * PAGE_SIZE + 1}–
                            {Math.min(currentPage * PAGE_SIZE, displayedSegments.length)} trên{' '}
                            {displayedSegments.length} đoạn
                          </span>
                          <div className="page-controls">
                            <button
                              type="button"
                              className="page-btn"
                              onClick={() => setPage(p => Math.max(1, p - 1))}
                              disabled={currentPage <= 1}
                              title="Trang trước"
                            >
                              <ChevronLeft size={13} />
                            </button>
                            {Array.from({ length: totalPages }, (_, i) => i + 1).map(p => (
                              <button
                                key={p}
                                type="button"
                                className={`page-btn${currentPage === p ? ' active' : ''}`}
                                onClick={() => setPage(p)}
                              >
                                {p}
                              </button>
                            ))}
                            <button
                              type="button"
                              className="page-btn"
                              onClick={() => setPage(p => Math.min(totalPages, p + 1))}
                              disabled={currentPage >= totalPages}
                              title="Trang tiếp"
                            >
                              <ChevronRight size={13} />
                            </button>
                          </div>
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}

              {/* ── Tab 2: Voice & Clips ── */}
              {activeTab === 'media' && (
                <div className="dsec">
                  {/* Voice Audio Listen */}
                  <div>
                    <h3>
                      <Mic size={13} /> Voice — Nghe thử từng đoạn audio
                    </h3>
                    {allSegmentsWithMeta.length === 0 ? (
                      <p className="settings-message">Chưa có voice.</p>
                    ) : (
                      <div className="chips">
                        {allSegmentsWithMeta.map((_, idx) => {
                          const isOver = sel.overspeed?.includes(idx)
                          const isPlaying = playingVo === idx
                          return (
                            <button
                              type="button"
                              key={idx}
                              className={`chip chip-play${isOver ? ' chip-warn' : ''}`}
                              onClick={() => toggleVo(sel, idx)}
                            >
                              {isPlaying ? <Pause size={12} /> : <Play size={12} />} #
                              {idx + 1} ({fmtTime(allSegmentsWithMeta[idx]?.duration_sec || 0)})
                              {isOver ? ' ⚠' : ''}
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>

                  {/* Cut Clips */}
                  {sel.clips && sel.clips.length > 0 && (
                    <div style={{ marginTop: 18 }}>
                      <h3>
                        <Scissors size={13} /> Clips video đã cắt ({sel.clips.length})
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
                </div>
              )}

              <div style={{ height: 16 }} />
            </div>
          )}
        </div>
      </div>
      )}


      {/* ── Confirm Delete Modal ── */}
      {jobToDelete && (
        <div
          className="modal-backdrop"
          onClick={() => !deleting && setJobToDelete(null)}
        >
          <div className="confirm-modal" onClick={e => e.stopPropagation()}>
            <div className="confirm-modal-icon">
              <Trash2 size={20} />
            </div>
            <h3 className="confirm-modal-title">
              Xác nhận xóa video &amp; giải phóng dữ liệu?
            </h3>
            <p className="confirm-modal-desc">
              Hành động này sẽ xóa vĩnh viễn video gốc, các clip đã cắt, file thu
              âm và video thành phẩm trên ổ đĩa để giải phóng dung lượng lưu trữ.
            </p>
            <div className="confirm-modal-box">
              <div>
                <strong>Tiêu đề:</strong> {getJobTitle(jobToDelete)}
              </div>
              <div style={{ marginTop: 4 }}>
                <strong>Job ID:</strong> <code>{jobToDelete.job_id}</code>
              </div>
            </div>
            <div className="confirm-modal-actions">
              <button
                type="button"
                className="btn-cancel"
                onClick={() => setJobToDelete(null)}
                disabled={deleting}
              >
                Hủy bỏ
              </button>
              <button
                type="button"
                className="btn-danger-confirm"
                onClick={() => handleDeleteJob(jobToDelete)}
                disabled={deleting}
              >
                <Trash2 size={13} />
                {deleting
                  ? 'Đang xóa...'
                  : 'Xóa vĩnh viễn (Giải phóng dung lượng)'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
