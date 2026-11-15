import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  AlarmClock,
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  ExternalLink,
  Film,
  HelpCircle,
  Loader2,
  RefreshCw,
  Search,
  SearchX,
  Settings,
  XCircle,
} from 'lucide-react'
import { API_URL } from '../../../shared/constants'
import {
  PLATFORM_LABEL,
  STATE_LABEL,
  STATE_ORDER,
  channelName,
  countByState,
  failedReasonLabel,
  filterScope,
  filterTasks,
  formatClock,
  formatDate,
  groupByDay,
  listChannels,
  pippitTaskState,
  platformOf,
  postLinkLabel,
  relativeTime,
  taskText,
  type PippitPlatform,
  type PippitTask,
  type PippitTaskState,
  type TaskFilter,
} from '../../../shared/pippit/taskState'
import './PippitHistoryTab.css'

interface SyncAccountStatus {
  account_id: string
  account_email: string
  ok: boolean
  error: string
  relogged: boolean
  task_count: number
}

interface TasksOverview {
  tasks: PippitTask[]
  accounts: SyncAccountStatus[]
  synced_at: string | null
}

const PAGE_SIZE = 30

export function FacebookIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
    </svg>
  )
}

export function TikTokIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64c.298-.002.595.042.88.13V9.4a6.33 6.33 0 0 0-1-.08A6.34 6.34 0 0 0 3 15.66a6.34 6.34 0 0 0 10.82 4.5 6.31 6.31 0 0 0 1.86-4.49V8.62a8.16 8.16 0 0 0 4.91 1.63v-3.56z" />
    </svg>
  )
}

function PlatformIcon({ platform, size = 14 }: { platform: PippitPlatform; size?: number }) {
  return platform === 'tiktok' ? <TikTokIcon size={size} /> : <FacebookIcon size={size} />
}

const STATE_ICON: Record<PippitTaskState, typeof Clock3> = {
  scheduled: Clock3,
  overdue: AlarmClock,
  published: CheckCircle2,
  failed: XCircle,
  missing: HelpCircle,
}

const STATE_HINT: Record<PippitTaskState, string> = {
  scheduled: 'Pippit sẽ tự đăng khi tới giờ hẹn.',
  overdue: 'Đã quá giờ hẹn nhưng chưa có xác nhận từ Pippit. Bấm "Đồng bộ" để cập nhật.',
  published: 'Pippit xác nhận đã đăng.',
  failed: 'Pippit báo đăng lỗi.',
  missing: 'Tài khoản đồng bộ được nhưng Pippit không còn bài này (đã bị xóa hoặc lúc lên lịch không tạo được task).',
}

function StateBadge({ state }: { state: PippitTaskState }) {
  const Icon = STATE_ICON[state]
  return (
    <span className={`pht-badge pht-badge--${state}`} title={STATE_HINT[state]}>
      <Icon size={12} /> {STATE_LABEL[state]}
    </span>
  )
}

function CopyButton({ text, label, withText = false }: { text: string; label: string; withText?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      className={withText ? 'pht-btn' : 'pht-icon-btn'}
      title={label}
      aria-label={label}
      onClick={async e => {
        e.stopPropagation()
        try {
          await navigator.clipboard.writeText(text)
          setDone(true)
          setTimeout(() => setDone(false), 1200)
        } catch {
          /* clipboard bị chặn: bỏ qua */
        }
      }}
    >
      {done ? <Check size={13} /> : <Copy size={13} />}
      {withText && (done ? 'Đã copy' : label)}
    </button>
  )
}

function syncedAgo(iso: string | null, now: number): string {
  if (!iso) return 'chưa đồng bộ'
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? 'chưa đồng bộ' : `đồng bộ ${relativeTime(ms, now)}`
}

interface Props {
  onOpenJob?: (jobId: string) => void
  onOpenSettings?: () => void
}

export function PippitHistoryTab({ onOpenJob, onOpenSettings }: Props) {
  const [tasks, setTasks] = useState<PippitTask[]>([])
  const [accounts, setAccounts] = useState<SyncAccountStatus[]>([])
  const [syncedAt, setSyncedAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [now, setNow] = useState(() => Date.now())

  const [filter, setFilter] = useState<TaskFilter>({ state: 'all', platform: 'all', channel: 'all', query: '' })
  const [limit, setLimit] = useState(PAGE_SIZE)
  const [expanded, setExpanded] = useState<string | null>(null)
  const syncSeq = useRef(0)

  const applyOverview = useCallback((data: TasksOverview) => {
    setTasks(Array.isArray(data.tasks) ? data.tasks : [])
    setSyncedAt(data.synced_at ?? null)
    setNow(Date.now())
  }, [])

  const sync = useCallback(async () => {
    const seq = ++syncSeq.current
    setSyncing(true)
    try {
      const res = await fetch(`${API_URL}/api/pippit/tasks?sync=true`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: TasksOverview = await res.json()
      if (seq !== syncSeq.current) return
      applyOverview(data)
      setAccounts(data.accounts || [])
      setLoadError('')
    } catch (e) {
      if (seq === syncSeq.current) {
        setLoadError(`Không đồng bộ được với Pippit (${e instanceof Error ? e.message : e}). Đang hiện dữ liệu đã lưu.`)
      }
    } finally {
      if (seq === syncSeq.current) setSyncing(false)
    }
  }, [applyOverview])

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${API_URL}/api/pippit/tasks`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data: TasksOverview = await res.json()
        if (!cancelled) applyOverview(data)
      } catch (e) {
        if (!cancelled) setLoadError(`Không tải được lịch sử đăng bài (${e instanceof Error ? e.message : e}).`)
      } finally {
        if (!cancelled) setLoading(false)
      }
      // Hiện cache ngay, rồi đồng bộ live ở nền.
      if (!cancelled) sync()
    })()
    return () => {
      cancelled = true
    }
  }, [applyOverview, sync])

  // Cập nhật "x phút trước" mỗi phút.
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    setLimit(PAGE_SIZE)
  }, [filter])

  const platformCounts = useMemo(() => {
    const scoped = filterScope(tasks, { platform: 'all', channel: 'all', query: filter.query })
    return {
      all: scoped.length,
      facebook: scoped.filter(t => platformOf(t) === 'facebook').length,
      tiktok: scoped.filter(t => platformOf(t) === 'tiktok').length,
    }
  }, [tasks, filter.query])

  const channels = useMemo(
    () => listChannels(filter.platform === 'all' ? tasks : tasks.filter(t => platformOf(t) === filter.platform)),
    [tasks, filter.platform]
  )

  const stateCounts = useMemo(() => countByState(filterScope(tasks, filter), now), [tasks, filter, now])
  const filtered = useMemo(() => filterTasks(tasks, filter, now), [tasks, filter, now])
  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit])
  const groups = useMemo(() => groupByDay(visible, now), [visible, now])

  const failedAccounts = accounts.filter(a => !a.ok)
  const hasFilter = filter.state !== 'all' || filter.platform !== 'all' || filter.channel !== 'all' || !!filter.query.trim()

  const setF = (patch: Partial<TaskFilter>) => setFilter(f => ({ ...f, ...patch }))

  return (
    <div className="pht">
      <div className="pht-toolbar">
        <div className="pht-toolbar-row">
          <div className="pht-chips" role="tablist" aria-label="Lọc theo trạng thái">
            <button
              type="button"
              className={`pht-chip${filter.state === 'all' ? ' is-active' : ''}`}
              onClick={() => setF({ state: 'all' })}
            >
              Tất cả <span className="pht-chip-count">{stateCounts.all}</span>
            </button>
            {STATE_ORDER.map(st =>
              stateCounts[st] > 0 || filter.state === st || st === 'scheduled' || st === 'published' ? (
                <button
                  key={st}
                  type="button"
                  className={`pht-chip pht-chip--${st}${filter.state === st ? ' is-active' : ''}`}
                  onClick={() => setF({ state: st })}
                  title={STATE_HINT[st]}
                >
                  {STATE_LABEL[st]} <span className="pht-chip-count">{stateCounts[st]}</span>
                </button>
              ) : null
            )}
          </div>
          <div className="pht-sync">
            <span className="pht-sync-time">
              {syncing ? 'Đang đồng bộ với Pippit…' : syncedAgo(syncedAt, now)}
            </span>
            <button type="button" className="pht-btn" onClick={sync} disabled={syncing} title="Lấy trạng thái mới nhất từ Pippit">
              <RefreshCw size={13} className={syncing ? 'spin' : ''} /> Đồng bộ
            </button>
          </div>
        </div>

        <div className="pht-toolbar-row">
          <div className="pht-seg" role="group" aria-label="Nền tảng">
            {(['all', 'facebook', 'tiktok'] as const).map(p => (
              <button
                key={p}
                type="button"
                className={filter.platform === p ? 'is-active' : ''}
                onClick={() => setF({ platform: p, channel: 'all' })}
              >
                {p !== 'all' && <PlatformIcon platform={p} size={12} />}
                {p === 'all' ? 'Tất cả' : PLATFORM_LABEL[p]}
                <span className="pht-chip-count">{platformCounts[p]}</span>
              </button>
            ))}
          </div>

          <select
            className="pht-select"
            value={filter.channel}
            onChange={e => setF({ channel: e.target.value })}
            aria-label="Lọc theo Page / kênh"
          >
            <option value="all">Mọi Page / kênh ({channels.length})</option>
            {channels.map(c => (
              <option key={c.key} value={c.key}>
                {PLATFORM_LABEL[c.platform]} · {c.name} ({c.count})
              </option>
            ))}
          </select>

          <label className="pht-search">
            <Search size={13} />
            <input
              value={filter.query}
              onChange={e => setF({ query: e.target.value })}
              placeholder="Tìm tiêu đề, caption, kênh, Task ID…"
            />
          </label>
        </div>
      </div>

      {loadError && (
        <div className="pht-alert pht-alert--error">
          <AlertTriangle size={14} />
          <span>{loadError}</span>
        </div>
      )}

      {failedAccounts.length > 0 && (
        <div className="pht-alert">
          <AlertTriangle size={14} />
          <div>
            <strong>Chưa đồng bộ được {failedAccounts.length} tài khoản Pippit</strong> — trạng thái các bài của
            tài khoản này có thể đã cũ.
            <ul>
              {failedAccounts.map(a => (
                <li key={a.account_id}>
                  {a.account_email || a.account_id}: {a.error}
                </li>
              ))}
            </ul>
          </div>
          {onOpenSettings && (
            <button type="button" className="pht-btn" onClick={onOpenSettings}>
              <Settings size={13} /> Mở Cài đặt
            </button>
          )}
        </div>
      )}

      {loading && tasks.length === 0 ? (
        <div className="pht-empty">
          <Loader2 size={22} className="spin" />
          <p>Đang tải lịch sử đăng bài…</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="pht-empty">
          {hasFilter ? <SearchX size={24} /> : <FacebookIcon size={24} />}
          <h4>{hasFilter ? 'Không có bài nào khớp bộ lọc' : 'Chưa có bài đăng nào qua Pippit'}</h4>
          {hasFilter ? (
            <button
              type="button"
              className="pht-btn"
              onClick={() => setFilter({ state: 'all', platform: 'all', channel: 'all', query: '' })}
            >
              Xóa bộ lọc
            </button>
          ) : (
            <p>Bài lên lịch từ Recap &amp; Audio, Video hoặc "Lên lịch Pippit" sẽ hiện ở đây.</p>
          )}
        </div>
      ) : (
        <div className="pht-list">
          {groups.map(g => (
            <section key={g.key} className="pht-day">
              <header className="pht-day-head">
                <span>{g.label}</span>
                <span className="pht-day-count">{g.items.length} bài</span>
              </header>
              {g.items.map((t, i) => {
                const rowKey = t.task_id || `${t.page_id}-${t.schedule_time_ms}-${i}`
                const state = pippitTaskState(t, now)
                const platform = platformOf(t)
                const text = taskText(t)
                const isOpen = expanded === rowKey
                const at = t.schedule_time_ms || 0
                return (
                  <article key={rowKey} className={`pht-row${isOpen ? ' is-open' : ''}`}>
                    <div
                      className="pht-row-main"
                      role="button"
                      tabIndex={0}
                      aria-expanded={isOpen}
                      onClick={() => setExpanded(isOpen ? null : rowKey)}
                      onKeyDown={e => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault()
                          setExpanded(isOpen ? null : rowKey)
                        }
                      }}
                    >
                      <span className={`pht-plat pht-plat--${platform}`} title={PLATFORM_LABEL[platform]}>
                        <PlatformIcon platform={platform} size={14} />
                      </span>
                      <span className="pht-time" title={at ? `${formatClock(at)} · ${formatDate(at)}` : ''}>
                        {at ? formatClock(at) : '--:--'}
                      </span>
                      <div className="pht-text">
                        <div className="pht-title" title={text.title}>
                          {text.title || <em>(Không có tiêu đề)</em>}
                        </div>
                        <div className="pht-sub">
                          <span className="pht-channel">{channelName(t)}</span>
                          {t.handle && platform === 'tiktok' && <span>@{t.handle}</span>}
                          {text.hashtags.length > 0 && (
                            <span className="pht-tags-inline">{text.hashtags.slice(0, 4).join(' ')}</span>
                          )}
                        </div>
                      </div>
                      <span className="pht-rel">{relativeTime(at, now)}</span>
                      <StateBadge state={state} />
                      <div className="pht-actions" onClick={e => e.stopPropagation()}>
                        {t.post_url ? (
                          <a
                            className="pht-icon-btn"
                            href={t.post_url}
                            target="_blank"
                            rel="noreferrer"
                            title={postLinkLabel(t)}
                            aria-label={postLinkLabel(t)}
                          >
                            <ExternalLink size={13} />
                          </a>
                        ) : (
                          <span className="pht-icon-btn is-placeholder" />
                        )}
                        <ChevronDown size={14} className="pht-chevron" />
                      </div>
                    </div>

                    {isOpen && (
                      <div className="pht-detail">
                        {state === 'failed' && (
                          <div className="pht-alert pht-alert--error">
                            <XCircle size={14} />
                            <span>{failedReasonLabel(t)}</span>
                          </div>
                        )}
                        {(state === 'missing' || state === 'overdue') && (
                          <div className="pht-alert">
                            <AlertTriangle size={14} />
                            <span>{STATE_HINT[state]}</span>
                          </div>
                        )}
                        {text.body && <p className="pht-body">{text.body}</p>}
                        {text.hashtags.length > 0 && (
                          <div className="pht-tags">
                            {text.hashtags.map(tag => (
                              <span key={tag}>{tag}</span>
                            ))}
                          </div>
                        )}
                        <dl className="pht-meta">
                          <dt>Giờ đăng</dt>
                          <dd>{at ? `${formatClock(at)} · ${formatDate(at)} (${relativeTime(at, now)})` : '—'}</dd>
                          <dt>Kênh</dt>
                          <dd>
                            {PLATFORM_LABEL[platform]} · {channelName(t)}
                            {t.page_id ? <code>{t.page_id}</code> : null}
                          </dd>
                          <dt>Tài khoản</dt>
                          <dd>{t.account_email || t.account_id || '—'}</dd>
                          <dt>Task ID</dt>
                          <dd>
                            {t.task_id ? (
                              <>
                                <code>{t.task_id}</code>
                                <CopyButton text={t.task_id} label="Copy Task ID" />
                              </>
                            ) : (
                              <span className="pht-muted">Không có (Pippit không trả task id khi lên lịch)</span>
                            )}
                          </dd>
                          {t.synced_at && (
                            <>
                              <dt>Đồng bộ</dt>
                              <dd>{syncedAgo(t.synced_at, now)}</dd>
                            </>
                          )}
                        </dl>
                        <div className="pht-detail-actions">
                          {t.post_url && (
                            <a className="pht-btn" href={t.post_url} target="_blank" rel="noreferrer">
                              <ExternalLink size={13} /> {postLinkLabel(t)}
                            </a>
                          )}
                          {(t.description || t.title) && (
                            <CopyButton text={t.description || t.title || ''} label="Copy caption" withText />
                          )}
                          {t.job_id && onOpenJob && (
                            <button type="button" className="pht-btn" onClick={() => onOpenJob(t.job_id as string)}>
                              <Film size={13} /> Mở video gốc
                            </button>
                          )}
                        </div>
                      </div>
                    )}
                  </article>
                )
              })}
            </section>
          ))}

          <footer className="pht-footer">
            <span>
              Hiển thị {visible.length} / {filtered.length} bài
            </span>
            {visible.length < filtered.length && (
              <button type="button" className="pht-btn" onClick={() => setLimit(l => l + PAGE_SIZE)}>
                Tải thêm {Math.min(PAGE_SIZE, filtered.length - visible.length)} bài
              </button>
            )}
          </footer>
        </div>
      )}
    </div>
  )
}
