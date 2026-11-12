import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle, Check, ChevronDown, Download, Eraser, Film, Layers, Loader2, Music2, Play, RotateCw, Square, X,
} from 'lucide-react'
import {
  cleanLongMotion, createLongMotion, deleteLongMotion, getLongMotion, listBgmTracks, longMotionFileUrl, mergeLongMotion,
  planLongMotion, runLongMotion, stopLongMotion, type BgmTrackLite,
} from '../services/longMotionApi.ts'
import {
  SEGMENT_STATE_LABEL, creditText, doneCount, driftWarning, formatRange, formatSeconds, isSegmentBusy, jobStorageKey, longActions,
  progressSummary, timelineBlocks,
  type LongAudioMode, type LongMotionJob, type LongMotionOptions, type LongPlan,
} from '../services/longMotionView.ts'
import './longMotion.css'
import { HelpHint } from '../../help/components/HelpHint'

interface Props {
  video: { file: File; fileName: string; durationSec: number }
  prompt: string
  aspectRatio: '9:16' | '16:9'
  /** Trả đường dẫn backend của các ảnh tham chiếu (nhân vật, bối cảnh), tải lên nếu chưa có. */
  getImagePaths: () => Promise<string[]>
  onClose: () => void
  onToast: (message: string) => void
}

const DEFAULT_OPTIONS: LongMotionOptions = {
  overlap: true, overlap_seconds: 1, audio: 'original', bgm_track_id: null, bgm_volume: 0.35, crossfade: 0.25, project_mode: 'new',
}

function triggerDownload(url: string) {
  const a = document.createElement('a')
  a.href = url
  document.body.appendChild(a)
  a.click()
  a.remove()
}

export function LongMotionPanel({ video, prompt, aspectRatio, getImagePaths, onClose, onToast }: Props) {
  const storageKey = jobStorageKey({ name: video.fileName, size: video.file.size })
  const [options, setOptions] = useState<LongMotionOptions>(DEFAULT_OPTIONS)
  const [plan, setPlan] = useState<LongPlan | null>(null)
  const [planError, setPlanError] = useState('')
  const [job, setJob] = useState<LongMotionJob | null>(null)
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [tracks, setTracks] = useState<BgmTrackLite[]>([])
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmRun, setConfirmRun] = useState(false)
  const wantCleanDownload = useRef(false)
  const lastCleanState = useRef<string>('')

  const locked = job !== null

  // Mở lại: nếu đã có lượt cho đúng file này thì nối tiếp (không tạo lượt mới, không tốn credit).
  useEffect(() => {
    let cancelled = false
    try {
      const saved = localStorage.getItem(storageKey)
      if (saved) {
        getLongMotion(saved).then((j) => { if (!cancelled) { setJob(j); setOptions(j.options) } }).catch(() => localStorage.removeItem(storageKey))
      }
    } catch { /* localStorage bị chặn: bỏ qua */ }
    return () => { cancelled = true }
  }, [storageKey])

  useEffect(() => { listBgmTracks().then(setTracks).catch(() => setTracks([])) }, [])

  // Xem trước kế hoạch chia đoạn khi chưa tạo lượt (không tốn gì).
  useEffect(() => {
    if (locked) return
    let cancelled = false
    const timer = window.setTimeout(() => {
      planLongMotion(video.durationSec, options.overlap, options.overlap_seconds)
        .then((p) => { if (!cancelled) { setPlan(p); setPlanError('') } })
        .catch((e: Error) => { if (!cancelled) { setPlan(null); setPlanError(e.message) } })
    }, 200)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [locked, video.durationSec, options.overlap, options.overlap_seconds])

  // Theo dõi trạng thái khi có việc đang chạy (3 giây) hoặc nhẹ nhàng khi rảnh (10 giây).
  useEffect(() => {
    if (!job) return
    const active = job.worker_alive || job.merge.state === 'running' || job.exports.clean?.state === 'running'
      || job.segments.some((s) => isSegmentBusy(s.state))
    const timer = window.setTimeout(() => {
      getLongMotion(job.id).then(setJob).catch(() => { /* lần sau thử lại */ })
    }, active ? 3000 : 10000)
    return () => window.clearTimeout(timer)
  }, [job])

  // Bản xóa watermark vừa xong và người dùng đã bấm tải: tự tải.
  useEffect(() => {
    const state = job?.exports.clean?.state || ''
    if (state === 'done' && lastCleanState.current === 'running' && wantCleanDownload.current && job) {
      wantCleanDownload.current = false
      triggerDownload(longMotionFileUrl(job.id, 'clean', { attachment: true }))
    }
    if (state === 'error') wantCleanDownload.current = false
    lastCleanState.current = state
  }, [job])

  const run = useCallback(async (label: string, fn: () => Promise<LongMotionJob | void>) => {
    setBusy(label)
    setError('')
    try {
      const next = await fn()
      if (next) setJob(next)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy('')
    }
  }, [])

  const createPlan = () => run('Đang tạo kế hoạch…', async () => {
    const imagePaths = await getImagePaths()
    if (!imagePaths.length) throw new Error('Cần ít nhất một ảnh nhân vật hoặc bối cảnh.')
    const created = await createLongMotion({ video: video.file, prompt, imagePaths, aspectRatio, options })
    try { localStorage.setItem(storageKey, created.id) } catch { /* bỏ qua */ }
    onToast(`Đã chia thành ${created.segments.length} đoạn. Chưa tốn credit; bấm "Chạy lần lượt" khi sẵn sàng.`)
    return created
  })

  const startAll = () => run('Đang gửi…', async () => {
    setConfirmRun(false)
    return runLongMotion(job!.id)
  })

  const resetPlan = () => run('Đang xóa…', async () => {
    if (!job) return
    await deleteLongMotion(job.id)
    try { localStorage.removeItem(storageKey) } catch { /* bỏ qua */ }
    setJob(null)
    setPreviewIndex(null)
  })

  const blocks = useMemo(
    () => timelineBlocks(job ? job.segments : plan?.segments || [], job ? job.source.duration : video.durationSec),
    [job, plan, video.durationSec],
  )
  const segments = job ? job.segments : (plan?.segments || []).map((s) => ({
    ...s, state: 'idle' as const, attempts: 0, veo_job_id: null, error: null, note: null, output: null, out_duration: null,
  }))
  const actions = job ? longActions(job) : null
  const credits = job ? job.credits : plan?.credits || 0
  const remaining = job ? job.credits_remaining : credits
  const drift = job ? driftWarning(job.segments) : ''
  const cleanState = job?.exports.clean
  const missingPrompt = !prompt.trim()

  const downloadClean = () => {
    if (!job) return
    setMenuOpen(false)
    if (job.clean_ready && cleanState?.state !== 'running') {
      triggerDownload(longMotionFileUrl(job.id, 'clean', { attachment: true }))
      return
    }
    wantCleanDownload.current = true
    void run('Đang xóa watermark…', () => cleanLongMotion(job.id))
  }

  const setAudio = (audio: LongAudioMode) => setOptions((o) => ({ ...o, audio }))

  return (
    <div className="lm-overlay" role="dialog" aria-modal="true" aria-label="Motion video dài" data-testid="long-motion-panel">
      <div className="lm-modal">
        <header className="lm-head">
          <div className="lm-head-icon"><Layers size={18} /></div>
          <div className="lm-head-text">
            <h2>Motion video dài<HelpHint hint="canvas.longMotion" /></h2>
            <p>{video.fileName} · {formatSeconds(video.durationSec)} · {aspectRatio}</p>
          </div>
          <button type="button" className="lm-icon-btn" onClick={onClose} aria-label="Đóng"><X size={18} /></button>
        </header>

        <div className="lm-body">
          <p className="lm-lead">
            Flow chỉ nhận tối đa 10 giây mỗi lượt. Video mẫu sẽ được cắt thành {segments.length || '…'} đoạn, tạo lần lượt rồi ghép
            thành một video. Mỗi đoạn là một lượt tính phí: đoạn lỗi thì hàng đợi dừng lại và không tự gửi lại.
          </p>

          <section className="lm-settings" aria-label="Tùy chọn">
            <div className="lm-field">
              <label className="lm-check">
                <input type="checkbox" checked={options.overlap} disabled={locked}
                  onChange={(e) => setOptions((o) => ({ ...o, overlap: e.target.checked }))} data-testid="lm-overlap" />
                <span>Gối đoạn {options.overlap_seconds} giây</span>
              </label>
              <small>
                Mỗi đoạn lặp lại {options.overlap_seconds} giây cuối của đoạn trước. Khi ghép, app chọn khung giống nhau nhất trong phần gối để cắt và
                trộn mờ, nên mối nối mượt hơn. Tắt thì cắt thẳng, mối nối dễ thấy hơn nhưng ít đoạn hơn khi video vừa quá 10 giây.
              </small>
            </div>

            <div className="lm-field">
              <span className="lm-label">Âm thanh của video ghép</span>
              <div className="lm-radios" role="radiogroup" aria-label="Âm thanh">
                <label className="lm-radio"><input type="radio" name="lm-audio" checked={options.audio === 'original'} onChange={() => setAudio('original')} />
                  <span>Nhạc gốc của video mẫu</span></label>
                <label className="lm-radio"><input type="radio" name="lm-audio" checked={options.audio === 'bgm'} onChange={() => setAudio('bgm')} />
                  <span>Nhạc nền từ thư viện</span></label>
                <label className="lm-radio"><input type="radio" name="lm-audio" checked={options.audio === 'none'} onChange={() => setAudio('none')} />
                  <span>Không âm thanh</span></label>
              </div>
              {options.audio === 'bgm' && (
                <select className="lm-select" value={options.bgm_track_id || ''} data-testid="lm-bgm"
                  onChange={(e) => setOptions((o) => ({ ...o, bgm_track_id: e.target.value || null }))}>
                  <option value="">{tracks.length ? 'Chọn bài nhạc…' : 'Thư viện nhạc đang trống'}</option>
                  {tracks.map((t) => <option key={t.track_id} value={t.track_id}>{t.name}</option>)}
                </select>
              )}
              <small>Tiếng do Flow tạo trong từng đoạn luôn bị bỏ. Đăng TikTok thì nên chọn “Không âm thanh” rồi gắn sound trên TikTok để tránh bản quyền.</small>
            </div>

            <div className="lm-field">
              <span className="lm-label">Flow project</span>
              <div className="lm-radios">
                <label className="lm-radio"><input type="radio" name="lm-project" checked={options.project_mode === 'new'} disabled={locked}
                  onChange={() => setOptions((o) => ({ ...o, project_mode: 'new' }))} /><span>Tạo project mới cho lượt này</span></label>
                <label className="lm-radio"><input type="radio" name="lm-project" checked={options.project_mode === 'active'} disabled={locked}
                  onChange={() => setOptions((o) => ({ ...o, project_mode: 'active' }))} /><span>Dùng project đang chọn</span></label>
              </div>
            </div>
          </section>

          {planError && !job && <div className="lm-alert" role="alert"><AlertTriangle size={16} /><span>{planError}</span></div>}

          <section aria-label="Các đoạn">
            <div className="lm-sec-head">
              <h3>Các đoạn ({segments.length})</h3>
              <span className="lm-muted">{job ? progressSummary(job) : `Tổng ${creditText(credits)}`}</span>
            </div>

            <div className="lm-timeline" data-testid="lm-timeline" aria-hidden="true">
              {blocks.map((b) => (
                <div key={b.index} className={`lm-tl-seg lm-tl-${b.index % 2}`}
                  style={{ left: `${b.leftPct}%`, width: `${b.widthPct}%` }}>
                  {b.overlapPct > 0 && <i className="lm-tl-overlap" style={{ width: `${b.overlapPct}%` }} />}
                  <span>{b.index + 1}</span>
                </div>
              ))}
            </div>

            <ol className="lm-segments">
              {segments.map((s) => (
                <li key={s.index} className={`lm-seg lm-seg-${s.state}`} data-testid={`lm-seg-${s.index}`}>
                  <div className="lm-seg-main">
                    <span className="lm-seg-num">{s.index + 1}</span>
                    <div className="lm-seg-info">
                      <strong>Đoạn {s.index + 1} · {formatRange(s)}</strong>
                      <span className={`lm-badge lm-badge-${s.state}`}>
                        {isSegmentBusy(s.state) && <Loader2 size={12} className="lm-spin" />}
                        {s.state === 'done' && <Check size={12} />}
                        {SEGMENT_STATE_LABEL[s.state]}
                      </span>
                      {s.note && isSegmentBusy(s.state) && <span className="lm-muted lm-note">{s.note}</span>}
                    </div>
                    {job && (
                      <div className="lm-seg-actions">
                        {s.state === 'done' && (
                          <button type="button" className="lm-btn lm-btn-sm" onClick={() => setPreviewIndex(previewIndex === s.index ? null : s.index)}>
                            <Play size={12} /> Xem
                          </button>
                        )}
                        {!isSegmentBusy(s.state) && !job.worker_alive && (
                          <button type="button" className="lm-btn lm-btn-sm" disabled={!!busy}
                            title={s.state === 'done' ? 'Tạo lại đoạn này (tốn credit)' : 'Chỉ tạo đoạn này'}
                            onClick={() => void run('Đang gửi…', () => runLongMotion(job.id, [s.index]))} data-testid={`lm-run-${s.index}`}>
                            <RotateCw size={12} /> {s.state === 'done' ? 'Tạo lại' : s.state === 'error' ? 'Thử lại đoạn này' : 'Tạo đoạn này'}
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                  {s.error && (
                    <pre className="lm-seg-errtext" role="alert">{s.error}</pre>
                  )}
                  {job && previewIndex === s.index && s.state === 'done' && (
                    <video className="lm-video" controls src={longMotionFileUrl(job.id, 'segment', { index: s.index })} />
                  )}
                </li>
              ))}
            </ol>
          </section>

          {drift && <div className="lm-alert lm-alert-warn"><AlertTriangle size={16} /><span>{drift}</span></div>}
          {job?.merge.state === 'error' && <div className="lm-alert" role="alert"><AlertTriangle size={16} /><span>Ghép lỗi: {job.merge.error}</span></div>}
          {cleanState?.state === 'error' && <div className="lm-alert" role="alert"><AlertTriangle size={16} /><span>Xóa watermark lỗi: {cleanState.error}</span></div>}
          {error && <div className="lm-alert" role="alert"><AlertTriangle size={16} /><span>{error}</span></div>}
          {cleanState?.state === 'running' && (
            <div className="lm-alert lm-alert-info"><Loader2 size={16} className="lm-spin" /><span>{cleanState.message || 'Đang xóa watermark…'}</span></div>
          )}

          {job?.final_ready && job.merge.state === 'done' && (
            <section aria-label="Video đã ghép" className="lm-final">
              <div className="lm-sec-head"><h3>Video đã ghép · {formatSeconds(job.merge.duration || job.source.duration)}</h3></div>
              <video className="lm-video lm-video-final" controls src={longMotionFileUrl(job.id, 'final', { bust: job.updated_at ? 1 : 0 })} data-testid="lm-final-video" />
            </section>
          )}
        </div>

        <footer className="lm-foot">
          {!job ? (
            <>
              <div className="lm-foot-info">
                <strong>{segments.length} đoạn</strong>
                <span>{creditText(credits)} · chưa tốn credit cho đến khi bạn bấm chạy</span>
              </div>
              <button type="button" className="lm-btn lm-btn-primary" disabled={!!busy || !plan || missingPrompt} onClick={() => void createPlan()}
                title={missingPrompt ? 'Prompt Motion Control đang trống.' : undefined} data-testid="lm-create">
                {busy ? <Loader2 size={15} className="lm-spin" /> : <Film size={15} />} Tạo kế hoạch
              </button>
            </>
          ) : (
            <>
              <div className="lm-foot-info">
                <strong>{doneCount(job.segments)}/{job.segments.length} đoạn xong</strong>
                <span>Còn lại {creditText(remaining)}</span>
              </div>
              <div className="lm-foot-actions">
                <button type="button" className="lm-btn lm-btn-ghost" disabled={!!busy || job.worker_alive} onClick={() => void resetPlan()}
                  title="Xóa kế hoạch này và làm lại từ đầu">Làm lại từ đầu</button>
                {actions?.canStop && (
                  <button type="button" className="lm-btn" onClick={() => void run('Đang dừng…', () => stopLongMotion(job.id))} data-testid="lm-stop">
                    <Square size={13} /> Dừng hàng đợi
                  </button>
                )}
                {!confirmRun ? (
                  <button type="button" className="lm-btn lm-btn-primary" disabled={!actions?.canRunAll || !!busy}
                    title={actions?.runBlockedReason || undefined} onClick={() => setConfirmRun(true)} data-testid="lm-run-all">
                    <Play size={14} /> Chạy lần lượt
                  </button>
                ) : (
                  <button type="button" className="lm-btn lm-btn-danger" onClick={() => void startAll()} data-testid="lm-confirm-run" autoFocus>
                    Xác nhận tốn {creditText(remaining)}
                  </button>
                )}
                <button type="button" className="lm-btn lm-btn-primary" disabled={!actions?.canMerge || !!busy} data-testid="lm-merge"
                  title={actions?.canMerge ? undefined : 'Cần xong mọi đoạn.'}
                  onClick={() => void run('Đang ghép…', () => mergeLongMotion(job.id, {
                    audio: options.audio, bgm_track_id: options.bgm_track_id, bgm_volume: options.bgm_volume, crossfade: options.crossfade }))}>
                  {job.merge.state === 'running' ? <Loader2 size={14} className="lm-spin" /> : <Film size={14} />}
                  {job.merge.state === 'done' ? 'Ghép lại' : 'Ghép video'}
                </button>
                <div className="lm-menu">
                  <button type="button" className="lm-btn" disabled={job.merge.state !== 'done'} onClick={() => setMenuOpen((v) => !v)}
                    aria-haspopup="menu" aria-expanded={menuOpen} data-testid="lm-download">
                    <Download size={14} /> Tải xuống <ChevronDown size={13} />
                  </button>
                  {menuOpen && (
                    <div className="lm-menu-pop" role="menu">
                      <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); triggerDownload(longMotionFileUrl(job.id, 'final', { attachment: true })) }}>
                        <Music2 size={14} /><span><b>Video đã ghép</b><small>Bản có watermark của Flow.</small></span>
                      </button>
                      <button type="button" role="menuitem" onClick={downloadClean} disabled={cleanState?.state === 'running'} data-testid="lm-download-clean">
                        <Eraser size={14} /><span><b>Xóa watermark rồi tải</b><small>
                          {job.clean_ready ? 'Đã xử lý, tải ngay.' : 'Xóa một lần trên video đã ghép (không tốn credit).'}</small></span>
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </footer>
        {busy && <div className="lm-busy" aria-live="polite">{busy}</div>}
      </div>
    </div>
  )
}
