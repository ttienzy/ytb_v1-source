import { useEffect, useState } from 'react'
import {
  AlertCircle,
  Check,
  ChevronRight,
  Circle,
  Clock,
  Download,
  ExternalLink,
  FolderOpen,
  Loader2,
  MessageSquare,
  Newspaper,
  Plus,
  RefreshCw,
  Send,
} from 'lucide-react'
import { ProductionForm } from './ProductionForm'
import { openMuseBrowser } from './services/museApi'
import {
  base,
  request,
  stages,
  statusText,
  type Episode,
  type EpisodeRow,
  type History,
} from './productionApi'
import { openMuseProject } from '../workflow/services/museCanvasApi'
import { LibraryPagination } from '../../shared/LibraryPagination'
import type { PageSummary } from '../../shared/useLibraryPage'
import './production.css'

const STAGE_ROLE_NAMES: Record<string, string> = {
  scout: 'Săn tin',
  brief_review: 'Showrunner (Duyệt tin)',
  script: 'Biên kịch',
  manifest: 'Sản xuất hình ảnh',
  assets: 'Sản xuất hình ảnh',
  assemble: 'Dựng phim',
  visual_review: 'Showrunner (Duyệt bản dựng)',
  draft: 'Bản dựng',
}

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`
}

interface SubStep {
  label: string
  status: 'done' | 'running' | 'pending'
}

function getSubSteps(ep: Episode): SubStep[] {
  const isRunning = ep.status === 'running'
  const hasReceipt = Boolean(ep.receipt)

  if (ep.stage === 'scout') {
    const sources = ep.channel.sources || []
    const sourceLabel =
      sources.length > 0
        ? `Gửi yêu cầu săn tin nguồn ${sources
            .map((s) => {
              try {
                return new URL(s).hostname.replace(/^www\./, '')
              } catch {
                return s
              }
            })
            .slice(0, 2)
            .join(', ')}`
        : 'Gửi yêu cầu nghiên cứu nội dung & phát triển ý tưởng'

    const researchLabel =
      sources.length > 0
        ? 'Muse đang duyệt bài gốc & trích xuất dữ kiện kiểm chứng'
        : 'Muse đang tổng hợp dữ kiện & phát triển 3 góc tiếp cận (hooks)'

    return [
      {
        label: 'Kết nối máy ảo Muse & tạo phiên chat riêng',
        status: hasReceipt || ep.brief ? 'done' : isRunning ? 'running' : 'pending',
      },
      {
        label: sourceLabel,
        status: hasReceipt || ep.brief ? 'done' : 'pending',
      },
      {
        label: researchLabel,
        status: ep.brief ? 'done' : isRunning && hasReceipt ? 'running' : 'pending',
      },
      {
        label: 'Tổng hợp cấu trúc kịch bản JSON (summary, facts, hooks)',
        status: ep.brief ? 'done' : 'pending',
      },
    ]
  }
  if (ep.stage === 'brief_review') {
    return [
      { label: 'Đọc bản tin & 3 góc khai thác', status: 'done' },
      { label: 'Showrunner phản biện & duyệt góc khai thác', status: isRunning ? 'running' : 'done' },
    ]
  }
  if (ep.stage === 'script') {
    const targetScenes = Math.max(1, Math.ceil((ep.channel.seconds || 45) / 10))
    return [
      { label: 'Chuẩn bị góc khai thác đã duyệt', status: 'done' },
      {
        label: `Muse viết kịch bản chi tiết (${ep.channel.seconds}s · ~${targetScenes} phân cảnh)`,
        status: ep.script ? 'done' : isRunning ? 'running' : 'pending',
      },
      {
        label: `Kiểm duyệt thời lượng khớp chuẩn ${ep.channel.seconds}s (mỗi cảnh <= 10s)`,
        status: ep.script ? 'done' : 'pending',
      },
    ]
  }
  if (ep.stage === 'manifest') {
    return [
      { label: 'Lập danh sách prompt ảnh & chuyển động', status: ep.manifest ? 'done' : isRunning ? 'running' : 'pending' },
      { label: 'Khớp tính liên tục hình ảnh cho các cảnh', status: ep.manifest ? 'done' : 'pending' },
    ]
  }
  if (ep.stage === 'assets') {
    const totalScenes = ep.script?.scenes.length || 1
    const finishedScenes = Object.values(ep.media).filter((m) => m.clip || m.segment).length
    return [
      {
        label: `Sản xuất hình ảnh & video chuyển động (${finishedScenes}/${totalScenes} cảnh)`,
        status: finishedScenes >= totalScenes ? 'done' : isRunning ? 'running' : 'pending',
      },
      { label: 'Thu âm giọng đọc narration', status: finishedScenes >= totalScenes ? 'done' : isRunning ? 'running' : 'pending' },
      { label: 'Ghép từng phân đoạn cảnh có tiếng', status: finishedScenes >= totalScenes ? 'done' : 'pending' },
    ]
  }
  if (ep.stage === 'assemble' || ep.stage === 'visual_review' || ep.stage === 'draft') {
    return [
      { label: 'Ghép nối toàn bộ phân cảnh thành bản dựng draft.mp4', status: ep.draft ? 'done' : isRunning ? 'running' : 'pending' },
      { label: 'Showrunner kiểm duyệt chất lượng bản dựng cuối', status: ep.review ? 'done' : isRunning ? 'running' : 'pending' },
    ]
  }
  return []
}

function LiveConsole({
  ep,
  elapsed,
  onOpenChat,
}: {
  ep: Episode
  elapsed: number
  onOpenChat: () => void
}) {
  const subSteps = getSubSteps(ep)
  const role = STAGE_ROLE_NAMES[ep.stage] || stages[ep.stage] || ep.stage
  const accId =
    (ep.receipt as { account?: string } | null)?.account ||
    (ep.channel.accounts as Record<string, string> | undefined)?.[
      ep.stage === 'script' ? 'showrunner' : ep.stage === 'assets' ? 'producer' : 'scout'
    ]
  const sessionId = (ep.receipt as { session?: string } | null)?.session

  return (
    <div className="mp-live-console" role="region" aria-label="Tiến trình đang chạy">
      <div className="mp-console-header">
        <div className="mp-console-title">
          <Clock size={16} className="mp-icon-mono" />
          <strong>Đang {stages[ep.stage]?.toLowerCase() || ep.stage}...</strong>
          <span className="mp-timer">{formatSeconds(elapsed)} / 10:00</span>
        </div>
        <button type="button" className="mp-btn-sm" onClick={onOpenChat} title="Mở Chrome Muse để xem trực tiếp tiến độ">
          <ExternalLink size={14} className="mp-icon-mono" />
          Mở chat Muse
        </button>
      </div>

      <div className="mp-pulse-bar" aria-hidden="true">
        <div className="mp-pulse-track" />
      </div>

      {subSteps.length > 0 && (
        <ul className="mp-substeps">
          {subSteps.map((st, i) => (
            <li key={i} className={`mp-substep mp-substep-${st.status}`}>
              {st.status === 'done' ? (
                <Check size={14} className="mp-icon-mono" />
              ) : st.status === 'running' ? (
                <Loader2 size={14} className="mp-icon-mono mp-spin" />
              ) : (
                <Circle size={10} className="mp-icon-mono mp-dot" />
              )}
              <span>{st.label}</span>
            </li>
          ))}
        </ul>
      )}

      {ep.live_message && (
        <div className="mp-live-message-box" role="status">
          <MessageSquare size={14} className="mp-icon-mono mp-live-msg-icon" />
          <div className="mp-live-message-content">
            <span className="mp-live-msg-label">Phản hồi trực tiếp từ Muse:</span>
            <p>{ep.live_message}</p>
          </div>
        </div>
      )}

      <div className="mp-console-footer">
        <small>
          Vai trò: <strong>{role}</strong>
          {accId && <> · Tài khoản: <code>{accId}</code></>}
          {sessionId && <> · Phiên: <code>{sessionId.slice(0, 8)}</code></>}
        </small>
      </div>
    </div>
  )
}

function AttentionCard({
  ep,
  busy,
  resubmit,
  setResubmit,
  onRetry,
  onResubmit,
  onOpenChat,
  onApproveBrief,
}: {
  ep: Episode
  busy: boolean
  resubmit: boolean
  setResubmit: (v: boolean | ((prev: boolean) => boolean)) => void
  onRetry: () => void
  onResubmit: () => void
  onOpenChat: () => void
  onApproveBrief?: () => void
}) {
  return (
    <div className="mp-attention-card" role="alert">
      <div className="mp-attention-header">
        <div className="mp-attention-title">
          <AlertCircle size={17} className="mp-icon-mono" />
          <strong>Cần chú ý · {stages[ep.stage] || ep.stage}</strong>
        </div>
        <button type="button" className="mp-btn-sm" onClick={onOpenChat}>
          <ExternalLink size={14} className="mp-icon-mono" />
          Mở chat Muse
        </button>
      </div>

      <p className="mp-attention-msg">{ep.error || 'Muse đang xử lý hoặc cần người dùng xác nhận.'}</p>

      <div className="mp-attention-actions">
        {ep.brief && !ep.script && onApproveBrief && (
          <button type="button" disabled={busy} onClick={onApproveBrief} className="mp-btn-primary-mono">
            <Check size={14} className="mp-icon-mono" />
            Duyệt brief & Viết kịch bản
          </button>
        )}

        <button type="button" disabled={busy} onClick={onRetry} className="mp-btn-secondary-mono">
          <RefreshCw size={14} className="mp-icon-mono" />
          {ep.receipt ? 'Đọc lại kết quả (Không tốn lượt)' : 'Thử lại bước này'}
        </button>

        {ep.receipt && (
          <button type="button" disabled={busy} onClick={() => setResubmit((v) => !v)} className="mp-btn-secondary-mono">
            <Send size={14} className="mp-icon-mono" />
            Gửi lượt mới…
          </button>
        )}
      </div>

      {resubmit && (
        <div className="mp-resubmit-confirm">
          <span>Hệ thống sẽ tạo phiên chat mới và gửi lại prompt (sẽ tính thêm 1 lượt Muse).</span>
          <button type="button" disabled={busy} onClick={onResubmit} className="mp-btn-sm">
            Xác nhận gửi lại
          </button>
        </div>
      )}
    </div>
  )
}

function EpisodeView({
  ep,
  onChange,
  onCanvas,
}: {
  ep: Episode
  onChange: (ep: Episode) => void
  onCanvas: () => void
}) {
  const [note, setNote] = useState('')
  const [chosen, setChosen] = useState<number[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [history, setHistory] = useState<History[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [archive, setArchive] = useState<unknown>(null)
  const [resubmit, setResubmit] = useState(false)
  const [elapsedSeconds, setElapsedSeconds] = useState(0)
  const path = '/episodes/' + ep.id

  useEffect(() => {
    if (ep.status !== 'running') {
      setElapsedSeconds(0)
      return
    }
    const start = ep.updated ? Math.floor(Date.now() / 1000 - ep.updated) : 0
    setElapsedSeconds(Math.max(0, start))
    const timer = setInterval(() => {
      setElapsedSeconds((prev) => prev + 1)
    }, 1000)
    return () => clearInterval(timer)
  }, [ep.status, ep.updated, ep.stage])

  async function handleOpenChat() {
    try {
      const accId =
        (ep.receipt as { account?: string } | null)?.account ||
        (ep.channel.accounts as Record<string, string> | undefined)?.[
          ep.stage === 'script' ? 'showrunner' : ep.stage === 'assets' ? 'producer' : 'scout'
        ]
      await openMuseBrowser(accId)
      setNotice('Đã mở cửa sổ Chrome Muse trên màn hình.')
    } catch (e) {
      setError((e as Error).message)
    }
  }
  useEffect(() => {
    if (!historyOpen) return
    const controller = new AbortController()
    request<History[]>(path + '/history', 'GET', undefined, controller.signal)
      .then(setHistory)
      .catch((e) => {
        if (!controller.signal.aborted) setError(e.message)
      })
    return () => controller.abort()
  }, [path, ep.version, historyOpen, notice])
  async function act(action: string) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const next = await request<Episode>(path + '/actions', 'POST', {
        action,
        version: ep.version,
        feedback: note,
        scenes: chosen,
      })
      onChange(next)
      if (action === 'canvas' && next.project) {
        await openMuseProject(next.project)
        sessionStorage.setItem('muse.production.openCanvas', '1')
        onCanvas()
      }
      if (action === 'pin') setNotice('Đã ghim quy tắc cho các tập sau.')
      else {
        setNote('')
        setChosen([])
        setResubmit(false)
      }
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  const idle = !['queued', 'running'].includes(ep.status)
  const reviewable = ['script_gate', 'draft_gate', 'sample_gate'].includes(ep.status)
  const assetUrl = (n: number, kind: string) =>
    base +
    path +
    '/assets/' +
    n +
    '/' +
    kind +
    '?v=' +
    encodeURIComponent(ep.media[String(n)]?.[kind as 'clip']?.split(/[/\\]/).pop() ?? '')
  const current = ['scout', 'brief_review', 'script'].includes(ep.stage)
    ? ep.stage === 'script'
      ? 1
      : 0
    : ['draft', 'visual_review'].includes(ep.stage)
      ? 3
      : 2
  let elapsed = 0
  return (
    <article className="mp-card mp-episode">
      <div className="mp-title">
        <div>
          <small>{ep.channel.name}</small>
          <h2>{ep.script?.title || ep.brief?.topic || ep.topic}</h2>
        </div>
        <span className={'mp-status ' + (idle ? 'mp-wait' : '')}>{statusText(ep)}</span>
      </div>
      <ol aria-label="Tiến độ" className="mp-steps">
        {['Săn tin', 'Kịch bản', 'Sản xuất', 'Bản dựng'].map((s, i) => (
          <li key={s} className={i === current ? 'current' : i < current ? 'past' : ''}>
            {i < current && <Check size={13} className="mp-icon-mono" />} {s}
          </li>
        ))}
      </ol>
      {ep.status === 'running' && (
        <LiveConsole ep={ep} elapsed={elapsedSeconds} onOpenChat={() => void handleOpenChat()} />
      )}
      {ep.status === 'attention' && (
        <AttentionCard
          ep={ep}
          busy={busy}
          resubmit={resubmit}
          setResubmit={setResubmit}
          onRetry={() => void act('retry')}
          onResubmit={() => void act('resubmit')}
          onOpenChat={() => void handleOpenChat()}
          onApproveBrief={() => void act('approve')}
        />
      )}
      {ep.review && (
        <p className="mp-review">
          <strong>Phản biện · {ep.review.score}/10</strong> {ep.review.feedback}
        </p>
      )}
      {ep.draft && (
        <video
          key={ep.draft}
          className="mp-player"
          controls
          preload="metadata"
          src={base + path + '/files/draft.mp4?v=' + ep.version}
        />
      )}
      {ep.status === 'sample_gate' && (
        <video className="mp-player" controls preload="metadata" src={assetUrl(1, 'segment')} />
      )}
      {ep.brief && (
        <details open={!ep.script}>
          <summary>Nguồn tin và 3 góc khai thác</summary>
          <p>{ep.brief.summary}</p>
          <ol className="mp-facts">
            {ep.brief.facts.map((f, i) => (
              <li key={i}>
                <strong>{f.claim}</strong>
                <blockquote>{f.evidence}</blockquote>
                <a href={f.url} target="_blank" rel="noreferrer">
                  {f.source_title}
                </a>{' '}
                {f.published && <small>· {f.published}</small>}
              </li>
            ))}
          </ol>
          <ol>
            {ep.brief.hooks.map((h, i) => (
              <li key={i}>
                <strong>{h.angle}</strong> · {h.hook}{' '}
                {ep.script?.hook === i + 1 && <small>· Góc đã chọn</small>}
              </li>
            ))}
          </ol>
          <a href={base + path + '/files/trend_brief.json'} download>
            Tải trend_brief.json
          </a>
        </details>
      )}
      {ep.script && (
        <section>
          <div className="mp-title">
            <h3>Phân cảnh</h3>
            <a href={base + path + '/files/production_script.json'} download>
              Kịch bản JSON
            </a>
          </div>
          <div className="mp-scenes">
            {ep.script.scenes.map((s) => {
              const start = elapsed
              elapsed += s.seconds
              const a = ep.media[String(s.scene)]
              const shot = ep.manifest?.scenes.find((item) => item.scene === s.scene)
              return (
                <div className="mp-scene" key={s.scene}>
                  <div>
                    <strong>Cảnh {s.scene}</strong>
                    <small>
                      {start}–{elapsed}s
                    </small>
                  </div>
                  <div>
                    <p>{s.narration}</p>
                    <details>
                      <summary>Chỉ dẫn cảnh</summary>
                      <p>{s.visual}</p>
                      <p>
                        {s.mood} · {s.cut}
                      </p>
                      {s.fact_ids.length > 0 && <small>Dữ kiện {s.fact_ids.join(', ')}</small>}
                      {shot && (
                        <>
                          <p>{shot.image_prompt}</p>
                          <p>{shot.motion_prompt}</p>
                        </>
                      )}
                    </details>
                    {a && (
                      <div className="mp-links">
                        {Object.entries({
                          image: 'Ảnh',
                          clip: 'Clip',
                          voice: 'Giọng đọc',
                          segment: 'Cảnh có tiếng',
                        })
                          .filter(([k]) => a[k as 'clip'])
                          .map(([k, label]) => (
                            <a key={k} href={assetUrl(s.scene, k)} target="_blank" rel="noreferrer">
                              {label}
                            </a>
                          ))}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </section>
      )}
      {ep.manifest && (
        <div className="mp-actions">
          <a href={base + path + '/files/render_manifest.json'} download>
            Danh sách prompt JSON
          </a>
          {idle && (
            <button disabled={busy} onClick={() => void act('canvas')}>
              <FolderOpen size={15} />
              Mở trong Muse Canvas
            </button>
          )}
        </div>
      )}
      {(reviewable || ep.status === 'attention') && (
        <div className="mp-decision">
          <label>
            Góp ý cho đội Muse
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Nêu điều cần sửa hoặc quy tắc muốn lưu cho kênh."
            />
          </label>
          {(ep.status === 'draft_gate' || (ep.status === 'attention' && ep.stage === 'visual_review')) && (
            <div className="mp-links">
              {ep.script?.scenes.map((s) => (
                <label className="mp-check" key={s.scene}>
                  <input
                    type="checkbox"
                    checked={chosen.includes(s.scene)}
                    onChange={(e) =>
                      setChosen((v) => (e.target.checked ? [...v, s.scene] : v.filter((i) => i !== s.scene)))
                    }
                  />
                  Cảnh {s.scene}
                </label>
              ))}
            </div>
          )}
          <div className="mp-actions">
            {reviewable && (
              <button className="mp-primary" disabled={busy} onClick={() => void act('approve')}>
                <Check size={16} className="mp-icon-mono" />
                {ep.status === 'script_gate'
                  ? 'Duyệt kịch bản'
                  : ep.status === 'sample_gate'
                    ? 'Duyệt cảnh mẫu'
                    : 'Duyệt bản dựng'}
              </button>
            )}
            {ep.status === 'attention' && ep.brief && !ep.script && (
              <button className="mp-primary" disabled={busy} onClick={() => void act('approve')}>
                <Check size={16} className="mp-icon-mono" />
                Duyệt brief & Viết kịch bản
              </button>
            )}
            {!ep.receipt && (
              <button disabled={busy || !note.trim()} onClick={() => void act('revise')}>
                {ep.status === 'draft_gate' || ep.status === 'sample_gate' ? 'Dựng lại cảnh' : 'Yêu cầu sửa'}
              </button>
            )}
            {ep.script && !ep.receipt && ep.status !== 'script_gate' && (
              <button disabled={busy || !note.trim()} onClick={() => void act('revise_script')}>
                Sửa lời và duyệt lại kịch bản
              </button>
            )}
            <button disabled={busy || !note.trim()} onClick={() => void act('pin')}>
              Ghim quy tắc kênh
            </button>
          </div>
          {resubmit && (
            <div className="mp-actions">
              <span>Muse có thể đã xử lý lượt trước.</span>
              <button disabled={busy} onClick={() => void act('resubmit')}>
                Xác nhận gửi lại
              </button>
            </div>
          )}
        </div>
      )}
      {ep.draft && (
        <a className="mp-download" href={base + path + '/package'} download>
          <Download size={16} />
          Tải bộ asset và bản dựng
        </a>
      )}
      {error && (
        <p className="mp-error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      <details onToggle={(e) => setHistoryOpen(e.currentTarget.open)}>
        <summary>Nhật ký bàn giao</summary>
        {history.map((h) => (
          <div key={h.seq} className="mp-event">
            <small>
              {new Date(h.at * 1000).toLocaleTimeString('vi-VN')} · {stages[h.stage]}
            </small>
            <span>{h.message}</span>
            {!!h.has_artifact && (
              <button
                onClick={() =>
                  request(path + '/history/' + h.seq)
                    .then(setArchive)
                    .catch((e) => setError(e.message))
                }
              >
                Xem bản lưu
              </button>
            )}
          </div>
        ))}
        {archive != null && <pre>{JSON.stringify(archive, null, 2)}</pre>}
      </details>
    </article>
  )
}

export function ProductionDesk({ onCanvas }: { onCanvas: () => void }) {
  const [list, setList] = useState<EpisodeRow[]>([])
  const [page, setPage] = useState(1)
  const [paging, setPaging] = useState<PageSummary | null>(null)
  const [id, setId] = useState<string | null>(null)
  const [ep, setEp] = useState<Episode | null>(null)
  const [newForm, setNewForm] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const control = new AbortController()
    let timer: ReturnType<typeof setTimeout>
    async function poll() {
      try {
        const result = await request<PageSummary & { items: EpisodeRow[] }>(
          '/episodes?page=' + page,
          'GET',
          undefined,
          control.signal,
        )
        const rows = result.items
        const target = id ?? rows[0]?.id
        const next =
          target && !newForm
            ? await request<Episode>('/episodes/' + target, 'GET', undefined, control.signal)
            : null
        if (control.signal.aborted) return
        setList(rows)
        setPaging(result)
        setLoaded(true)
        setError('')
        if (next) {
          setId(next.id)
          setEp((prev) => (prev?.id === next.id && prev.version > next.version ? prev : next))
        }
      } catch (e) {
        if (!control.signal.aborted) setError((e as Error).message)
      }
      if (!control.signal.aborted) timer = setTimeout(poll, 2500)
    }
    void poll()
    return () => {
      control.abort()
      clearTimeout(timer)
    }
  }, [id, newForm, page])
  return (
    <div className="mp">
      <header className="mp-title">
        <div>
          <h1>Dây chuyền 3 Muse</h1>
          <p>Săn tin, viết kịch bản và dựng video theo từng tập.</p>
        </div>
        <button onClick={() => setNewForm(true)}>
          <Plus size={16} />
          Tập mới
        </button>
      </header>
      {error && (
        <p className="mp-error" role="alert">
          {error}
        </p>
      )}
      <div className="mp-layout">
        <aside className="mp-card">
          <h3>
            <Newspaper size={16} />
            Các tập sản xuất
          </h3>
          {!list.length && <p>{loaded ? 'Chưa có tập nào.' : 'Đang tải…'}</p>}
          {list.map((row) => (
            <button
              key={row.id}
              className={'mp-row ' + (id === row.id && !newForm ? 'selected' : '')}
              onClick={() => {
                setNewForm(false)
                setId(row.id)
              }}
            >
              <span>
                <strong>{row.topic}</strong>
                <small>{statusText(row)}</small>
              </span>
              <ChevronRight size={15} />
            </button>
          ))}
          <LibraryPagination
            data={paging}
            label="Các trang tập sản xuất"
            loading={false}
            onPage={(p) => {
              setPage(p)
              setId(null)
              setEp(null)
              setNewForm(false)
            }}
          />
        </aside>
        {newForm || (loaded && !list.length && !ep) ? (
          <ProductionForm
            onCreated={(v) => {
              setNewForm(false)
              setPage(1)
              setId(v.id)
              setEp(v)
            }}
          />
        ) : ep && ep.id === id ? (
          <EpisodeView key={ep.id} ep={ep} onChange={setEp} onCanvas={onCanvas} />
        ) : (
          <div className="mp-card">Đang tải tập…</div>
        )}
      </div>
    </div>
  )
}
