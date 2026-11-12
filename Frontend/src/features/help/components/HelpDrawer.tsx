import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  CheckCircle2,
  Compass,
  Lightbulb,
  Search,
  TriangleAlert,
  X,
} from 'lucide-react'
import { HELP_GROUPS, OVERVIEW_GUIDE, allHelpDocs, getHelpDoc } from '../registry'
import { SECTION_LABEL, TOC_LABEL, recentChanges, searchDocs, sectionsOf, type HelpDoc, type HelpGuide, type RecentChange, type SectionKey } from '../model'
import { isPageId, type PageId } from '../../../shared/navModel'
import type { HelpTarget } from '../openHelp'
import './HelpDrawer.css'

interface HelpDrawerProps {
  onClose: () => void
  currentSidebar: string
  /** Mở thẳng một trang/khối (từ dấu "?" hoặc F1 tại khối) */
  target?: HelpTarget | null
  onNavigate?: (page: string) => void
}

const anchorId = (anchor: string) => `help-a-${anchor}`

export function HelpDrawer({ onClose, currentSidebar, target, onNavigate }: HelpDrawerProps) {
  const initial = target?.pageId ?? (isPageId(currentSidebar) ? currentSidebar : 'Dashboard')
  const [pageId, setPageId] = useState<PageId>(initial)
  const [overview, setOverview] = useState(false)
  const [query, setQuery] = useState('')
  const [pendingAnchor, setPendingAnchor] = useState<string | undefined>(target?.anchor)
  const bodyRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  // Mở lại với đích mới (dấu "?" bấm khi drawer đang mở)
  useEffect(() => {
    if (!target) return
    setPageId(target.pageId)
    setPendingAnchor(target.anchor)
    setOverview(false)
    setQuery('')
  }, [target])

  const doc = useMemo<HelpDoc | null>(() => getHelpDoc(pageId), [pageId])
  const hits = useMemo(() => searchDocs(allHelpDocs(), query), [query])
  const changes = useMemo(() => recentChanges(allHelpDocs(), 8), [])
  const searching = query.trim().length > 0
  const isCurrentPage = pageId === currentSidebar

  // Cuộn tới khối được yêu cầu; đổi trang (không kèm khối) thì về đầu. Nhớ trang đã xử lý để không reset cuộn sau khi đã tới khối.
  const lastPageRef = useRef<PageId | null>(null)
  useEffect(() => {
    const body = bodyRef.current
    if (!body) return
    if (pendingAnchor) {
      const el = body.querySelector<HTMLElement>(`#${CSS.escape(anchorId(pendingAnchor))}`)
      if (el) {
        lastPageRef.current = pageId
        el.scrollIntoView({ block: 'start', behavior: 'smooth' })
        el.classList.add('help-flash')
        window.setTimeout(() => el.classList.remove('help-flash'), 1600)
        setPendingAnchor(undefined)
        return
      }
    }
    if (lastPageRef.current !== pageId) {
      lastPageRef.current = pageId
      body.scrollTop = 0
    }
  }, [pageId, pendingAnchor, doc])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (query) setQuery('')
        else onClose()
      } else if (event.key === '/' && document.activeElement?.tagName !== 'INPUT') {
        event.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose, query])

  const openPage = (next: PageId, anchor?: string) => {
    setOverview(false)
    setPageId(next)
    setPendingAnchor(anchor)
    setQuery('')
  }

  const jumpTo = (key: string) => {
    bodyRef.current?.querySelector<HTMLElement>(`#${CSS.escape(anchorId(key))}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }

  return (
    <div className="help-overlay" onClick={onClose}>
      <aside className="help-panel" onClick={event => event.stopPropagation()} aria-label="Tài liệu hướng dẫn" role="dialog">
        <nav className="help-nav" aria-label="Danh sách trang">
          <div className="help-nav-head">
            <BookOpen size={15} />
            <strong>Hướng dẫn</strong>
          </div>
          <label className="help-search">
            <Search size={13} />
            <input
              ref={searchRef}
              value={query}
              onChange={event => setQuery(event.target.value)}
              placeholder="Tìm trong hướng dẫn"
              aria-label="Tìm trong tài liệu"
            />
            {query ? (
              <button type="button" onClick={() => setQuery('')} aria-label="Xóa tìm kiếm">
                <X size={12} />
              </button>
            ) : (
              <kbd className="help-search-kbd" title="Nhấn / để tìm nhanh">/</kbd>
            )}
          </label>
          <div className="help-nav-scroll">
            <button
              type="button"
              className={`help-nav-item help-nav-overview${!searching && overview ? ' active' : ''}`}
              onClick={() => {
                setOverview(true)
                setQuery('')
              }}
            >
              <Compass size={13} />
              <span>Tổng quan quy trình</span>
            </button>
            {HELP_GROUPS.map(group => (
              <div key={group.title} className="help-nav-group">
                <div className="help-nav-title">{group.title}</div>
                {group.pages.map(page => (
                  <button
                    key={page.pageId}
                    type="button"
                    className={`help-nav-item${!searching && !overview && page.pageId === pageId ? ' active' : ''}`}
                    onClick={() => openPage(page.pageId)}
                  >
                    <span>{page.pageId}</span>
                    {page.pageId === currentSidebar && <em>đang xem</em>}
                    {!page.hasDoc && <i title="Chưa có tài liệu">chưa có</i>}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </nav>

        <section className="help-main">
          <header className="help-top">
            <label className="help-select-mobile">
              <span className="sr-only">Chọn trang</span>
              <select
                value={overview ? '__overview' : pageId}
                onChange={event => (event.target.value === '__overview' ? setOverview(true) : openPage(event.target.value as PageId))}
              >
                <option value="__overview">Tổng quan quy trình</option>
                {HELP_GROUPS.map(group => (
                  <optgroup key={group.title} label={group.title}>
                    {group.pages.map(page => (
                      <option key={page.pageId} value={page.pageId}>
                        {page.pageId}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
            <span className="help-crumb">{searching ? `Kết quả cho “${query.trim()}”` : overview ? 'Tổng quan quy trình' : pageId}</span>
            <div className="help-close-group">
              <span className="help-esc-hint">Esc</span>
              <button type="button" className="help-close" onClick={onClose} title="Đóng (Esc)" aria-label="Đóng hướng dẫn">
                <X size={17} />
              </button>
            </div>
          </header>

          <div className="help-body" ref={bodyRef}>
            {searching ? (
              <SearchResults hits={hits} onPick={hit => openPage(hit.pageId, hit.section === 'areas' ? hit.anchor : hit.section)} />
            ) : overview ? (
              <GuideView guide={OVERVIEW_GUIDE} changes={changes} onOpenPage={openPage} />
            ) : doc ? (
              <DocView
                doc={doc}
                isCurrentPage={isCurrentPage}
                onJump={jumpTo}
                onOpenPage={openPage}
                onGo={
                  onNavigate && !isCurrentPage
                    ? () => {
                        onNavigate(doc.pageId)
                        onClose()
                      }
                    : undefined
                }
              />
            ) : (
              <div className="help-empty">
                <TriangleAlert size={22} />
                <h3>Chưa có tài liệu cho “{pageId}”</h3>
                <p>Trang này đã có trong ứng dụng nhưng tài liệu hướng dẫn chưa được viết. Chọn một trang khác trong danh sách.</p>
              </div>
            )}
          </div>
        </section>
      </aside>
    </div>
  )
}

function SearchResults({ hits, onPick }: { hits: ReturnType<typeof searchDocs>; onPick: (hit: ReturnType<typeof searchDocs>[number]) => void }) {
  if (!hits.length) {
    return (
      <div className="help-empty">
        <Search size={22} />
        <h3>Không tìm thấy</h3>
        <p>Thử từ khóa ngắn hơn, ví dụ “nền”, “giọng”, “cookie”, “lỗi tải”. Tìm không phân biệt dấu.</p>
      </div>
    )
  }
  return (
    <ul className="help-hits">
      {hits.map((hit, index) => (
        <li key={`${hit.pageId}-${hit.anchor}-${index}`}>
          <button type="button" onClick={() => onPick(hit)}>
            <span className="help-hit-meta">
              {hit.pageId} · {SECTION_LABEL[hit.section]}
            </span>
            <strong>{hit.title}</strong>
            <span className="help-hit-snippet">{hit.snippet}</span>
          </button>
        </li>
      ))}
    </ul>
  )
}

interface DocViewProps {
  doc: HelpDoc
  isCurrentPage: boolean
  onJump: (key: string) => void
  onOpenPage: (pageId: PageId, anchor?: string) => void
  onGo?: () => void
}

function DocView({ doc, onJump, onOpenPage, onGo }: DocViewProps) {
  const sections = sectionsOf(doc)
  return (
    <article className="help-doc">
      <h2>{doc.title}</h2>
      <p className="help-summary">{doc.summary}</p>

      {doc.verifiedAt ? (
        <div className="help-verified">
          <CheckCircle2 size={13} /> Đã đối chiếu với phiên bản hiện tại ngày {doc.verifiedAt}
        </div>
      ) : (
        <div className="help-unverified">
          <TriangleAlert size={14} />
          <span>Tài liệu này chưa được đối chiếu với phiên bản hiện tại. Một số chi tiết có thể đã thay đổi.</span>
        </div>
      )}

      {onGo && (
        <button type="button" className="help-go" onClick={onGo}>
          Đi đến trang {doc.pageId} <ArrowRight size={13} />
        </button>
      )}

      {sections.length > 1 && (
        <div className="help-toc" role="navigation" aria-label="Mục lục">
          {sections.map(key => (
            <button key={key} type="button" onClick={() => onJump(key)}>
              {TOC_LABEL[key]}
            </button>
          ))}
        </div>
      )}

      {sections.map(key => (
        <Section key={key} sectionKey={key} doc={doc} onOpenPage={onOpenPage} />
      ))}
    </article>
  )
}

function Section({ sectionKey, doc, onOpenPage }: { sectionKey: SectionKey; doc: HelpDoc; onOpenPage: (pageId: PageId, anchor?: string) => void }) {
  return (
    <section id={anchorId(sectionKey)} className="help-section">
      <h3>{SECTION_LABEL[sectionKey]}</h3>
      {sectionKey === 'requires' && (
        <ul className="help-requires">
          {doc.requires.map(req => (
            <li key={req.label}>
              <strong>{req.label}</strong>
              {req.fixHint && <span>{req.fixHint}</span>}
              {req.fixPage && (
                <button type="button" onClick={() => onOpenPage(req.fixPage as PageId)}>
                  Xem hướng dẫn {req.fixPage}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      {sectionKey === 'start' && (
        <ol className="help-steps">
          {doc.start.map((step, index) => (
            <li key={index}>
              <span className="help-step-n">{index + 1}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.do}</p>
                {step.result && <p className="help-result">→ {step.result}</p>}
              </div>
            </li>
          ))}
        </ol>
      )}

      {sectionKey === 'areas' && (
        <div className="help-areas">
          {doc.areas.map(area => (
            <div key={area.id} id={anchorId(area.id)} className="help-area">
              <strong>{area.name}</strong>
              <p>{area.what}</p>
              {area.how && (
                <ul>
                  {area.how.map((line, index) => (
                    <li key={index}>{line}</li>
                  ))}
                </ul>
              )}
              {area.flow && (
                <ol className="help-flow">
                  {area.flow.map((step, index) => (
                    <li key={index}>{step}</li>
                  ))}
                </ol>
              )}
              {area.tip && (
                <p className="help-tip">
                  <Lightbulb size={12} /> {area.tip}
                </p>
              )}
            </div>
          ))}
          {!!doc.tips?.length && (
            <div id={anchorId('tips')} className="help-area">
              <strong>Mẹo</strong>
              <ul>
                {doc.tips.map((tip, index) => (
                  <li key={index}>{tip}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {sectionKey === 'concepts' && (
        <dl className="help-concepts">
          {doc.concepts.map(concept => (
            <div key={concept.term}>
              <dt>{concept.term}</dt>
              <dd>{concept.meaning}</dd>
            </div>
          ))}
        </dl>
      )}

      {sectionKey === 'problems' && (
        <div className="help-problems">
          {doc.problems.map((problem, index) => (
            <div key={index} className="help-problem">
              <div className="help-symptom">
                <AlertCircle size={13} /> {problem.symptom}
              </div>
              {problem.cause && <p className="help-cause">Nguyên nhân: {problem.cause}</p>}
              <p>{problem.fix}</p>
              {problem.link && (
                <button type="button" onClick={() => onOpenPage(problem.link as PageId)}>
                  Xem {problem.link}
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {sectionKey === 'changes' && (
        <ul className="help-changes">
          {doc.changes.map((change, index) => (
            <li key={index}>
              <time>{change.date}</time> {change.text}
            </li>
          ))}
        </ul>
      )}

      {sectionKey === 'related' && (
        <div className="help-related">
          {doc.related.map(related => (
            <button key={related} type="button" onClick={() => onOpenPage(related)}>
              {related}
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function GuideView({ guide, changes, onOpenPage }: { guide: HelpGuide; changes: RecentChange[]; onOpenPage: (pageId: PageId) => void }) {
  return (
    <article className="help-doc">
      <h2>{guide.title}</h2>
      <p className="help-summary">{guide.summary}</p>
      {guide.verifiedAt && (
        <div className="help-verified">
          <CheckCircle2 size={13} /> Đã đối chiếu với phiên bản hiện tại ngày {guide.verifiedAt}
        </div>
      )}
      <div className="help-journeys">
        {guide.journeys.map(journey => (
          <section key={journey.id} className="help-journey">
            <h3>{journey.name}</h3>
            <p className="help-journey-goal">{journey.goal}</p>
            <ol>
              {journey.steps.map((step, index) => (
                <li key={`${journey.id}-${index}`}>
                  <span className="help-step-n">{index + 1}</span>
                  <div>
                    <button type="button" className="help-page-chip" onClick={() => onOpenPage(step.page)}>
                      {step.page}
                    </button>
                    <p>{step.note}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
      {changes.length > 0 && (
        <section className="help-section">
          <h3>Có gì mới</h3>
          <ul className="help-changes">
            {changes.map((change, index) => (
              <li key={index}>
                <time>{change.date}</time>{' '}
                <button type="button" className="help-page-chip" onClick={() => onOpenPage(change.pageId)}>
                  {change.pageId}
                </button>{' '}
                {change.text}
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="help-section">
        <h3>Cần nhớ</h3>
        <ul className="help-notes">
          {guide.notes.map((note, index) => (
            <li key={index}>{note}</li>
          ))}
        </ul>
      </section>
    </article>
  )
}
