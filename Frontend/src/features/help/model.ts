// Mô hình Tài liệu hướng dẫn v2 + hàm thuần (chuyển doc cũ, mục lục, tìm kiếm). Không import React/DOM để test bằng node:test.
import { isPageId, type PageId } from '../../shared/navModel.ts'
import type { SidebarDoc } from './types.ts'

export interface HelpRequirement {
  label: string
  /** Trang cần mở để thỏa điều kiện (ví dụ Cài đặt) */
  fixPage?: PageId
  fixHint?: string
}

export interface HelpStep {
  title: string
  /** Việc cần làm */
  do: string
  /** Kết quả mong đợi sau bước này */
  result?: string
}

export interface HelpArea {
  /** Neo cho deep-link `openHelp(pageId, areaId)` */
  id: string
  name: string
  what: string
  how?: string[]
  /** Luồng thao tác dạng chuỗi bước */
  flow?: string[]
  tip?: string
}

export interface HelpConcept {
  term: string
  meaning: string
}

export interface HelpProblem {
  symptom: string
  cause?: string
  fix: string
  link?: PageId
}

export interface HelpChange {
  /** YYYY-MM-DD */
  date: string
  text: string
}

export interface HelpDoc {
  pageId: PageId
  title: string
  summary: string
  /** Ngày đối chiếu lần cuối với app (YYYY-MM-DD). null = chưa đối chiếu (doc cũ chưa viết lại). */
  verifiedAt: string | null
  requires: HelpRequirement[]
  start: HelpStep[]
  areas: HelpArea[]
  concepts: HelpConcept[]
  problems: HelpProblem[]
  related: PageId[]
  changes: HelpChange[]
  /** Chỉ doc cũ chưa viết lại còn dùng; doc mới đưa mẹo vào areas/problems. */
  tips?: string[]
}

/** Bản đồ quy trình xuyên nhiều trang (không phải một trang sidebar). */
export interface HelpJourneyStep {
  page: PageId
  note: string
}

export interface HelpJourney {
  id: string
  name: string
  goal: string
  steps: HelpJourneyStep[]
}

export interface HelpGuide {
  title: string
  summary: string
  verifiedAt: string | null
  journeys: HelpJourney[]
  notes: string[]
}

export type SectionKey = 'requires' | 'start' | 'areas' | 'concepts' | 'problems' | 'changes' | 'related'

/** Nhãn ngắn cho mục lục (vừa một hàng). */
export const TOC_LABEL: Record<SectionKey, string> = {
  requires: 'Điều kiện',
  start: 'Bắt đầu',
  areas: 'Giao diện',
  concepts: 'Thuật ngữ',
  problems: 'Sự cố',
  changes: 'Mới',
  related: 'Liên quan',
}

export const SECTION_LABEL: Record<SectionKey, string> = {
  requires: 'Điều kiện cần',
  start: 'Bắt đầu nhanh',
  areas: 'Các khối giao diện',
  concepts: 'Thuật ngữ',
  problems: 'Xử lý sự cố',
  changes: 'Có gì mới',
  related: 'Trang liên quan',
}

/** Bỏ dấu tiếng Việt, hạ chữ thường — dùng cho so khớp tìm kiếm và tạo slug. */
export function fold(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\u0111/g, 'd')
}

export function slug(text: string): string {
  return fold(text).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'muc'
}

/** Chuyển doc kiểu cũ (3 tab cố định) sang mô hình v2, GIỮ NGUYÊN nội dung. */
export function legacyToHelpDoc(doc: SidebarDoc, pageId: PageId): HelpDoc {
  const used = new Set<string>()
  const uniqueId = (base: string): string => {
    let id = base
    for (let n = 2; used.has(id); n++) id = `${base}-${n}`
    used.add(id)
    return id
  }
  const areas: HelpArea[] = [
    ...(doc.subTabs ?? []).map(tab => ({
      id: uniqueId(slug(tab.id || tab.label)),
      name: tab.label,
      what: tab.desc,
      flow: tab.flowSteps,
    })),
    ...doc.features.map(feature => ({
      id: uniqueId(slug(feature.title)),
      name: feature.title,
      what: feature.desc,
      tip: feature.tip,
    })),
  ]
  return {
    pageId,
    title: doc.title,
    summary: doc.summary,
    verifiedAt: null,
    requires: [],
    start: doc.quickSteps.map(step => ({ title: step.title, do: step.desc })),
    areas,
    concepts: [],
    problems: (doc.troubleshooting ?? []).map(item => ({ symptom: item.issue, fix: item.solution })),
    related: (doc.relatedPages ?? []).filter(isPageId),
    changes: [],
    tips: doc.proTips,
  }
}

export function sectionsOf(doc: HelpDoc): SectionKey[] {
  const keys: SectionKey[] = []
  if (doc.requires.length) keys.push('requires')
  if (doc.start.length) keys.push('start')
  if (doc.areas.length || doc.tips?.length) keys.push('areas')
  if (doc.concepts.length) keys.push('concepts')
  if (doc.problems.length) keys.push('problems')
  if (doc.changes.length) keys.push('changes')
  if (doc.related.length) keys.push('related')
  return keys
}

export interface SearchHit {
  pageId: PageId
  section: SectionKey
  /** Neo trong trang (id của area, hoặc tên section) */
  anchor: string
  title: string
  snippet: string
}

interface Entry {
  section: SectionKey
  anchor: string
  title: string
  body: string
}

function entriesOf(doc: HelpDoc): Entry[] {
  const out: Entry[] = []
  for (const r of doc.requires) out.push({ section: 'requires', anchor: 'requires', title: r.label, body: r.fixHint ?? '' })
  for (const s of doc.start) out.push({ section: 'start', anchor: 'start', title: s.title, body: `${s.do} ${s.result ?? ''}` })
  for (const a of doc.areas) {
    out.push({
      section: 'areas',
      anchor: a.id,
      title: a.name,
      body: [a.what, ...(a.how ?? []), ...(a.flow ?? []), a.tip ?? ''].join(' '),
    })
  }
  for (const c of doc.concepts) out.push({ section: 'concepts', anchor: 'concepts', title: c.term, body: c.meaning })
  for (const p of doc.problems) out.push({ section: 'problems', anchor: 'problems', title: p.symptom, body: `${p.cause ?? ''} ${p.fix}` })
  for (const c of doc.changes) out.push({ section: 'changes', anchor: 'changes', title: c.date, body: c.text })
  for (const tip of doc.tips ?? []) out.push({ section: 'areas', anchor: 'tips', title: 'Mẹo', body: tip })
  return out
}

function snippetOf(text: string, needle: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  const at = fold(flat).indexOf(needle)
  if (at < 0) return flat.slice(0, 110)
  const from = Math.max(0, at - 30)
  return `${from > 0 ? '…' : ''}${flat.slice(from, from + 120)}${from + 120 < flat.length ? '…' : ''}`
}

/** Tìm không dấu, mọi từ phải khớp (AND). Tiêu đề khớp xếp trước nội dung khớp. */
export function searchDocs(docs: HelpDoc[], query: string, limit = 30): SearchHit[] {
  const terms = fold(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return []
  const scored: Array<{ score: number; hit: SearchHit }> = []
  for (const doc of docs) {
    for (const entry of entriesOf(doc)) {
      const title = fold(`${doc.pageId} ${entry.title}`)
      const all = `${title} ${fold(entry.body)}`
      if (!terms.every(t => all.includes(t))) continue
      const entryTitle = fold(entry.title)
      const inTitle = terms.every(t => entryTitle.includes(t))
      scored.push({
        score: inTitle ? 0 : 1,
        hit: {
          pageId: doc.pageId,
          section: entry.section,
          anchor: entry.anchor,
          title: entry.title,
          snippet: snippetOf(entry.body || entry.title, terms[0]),
        },
      })
    }
  }
  return scored.sort((a, b) => a.score - b.score).slice(0, limit).map(s => s.hit)
}

/** Mọi chuỗi chữ của một doc (dùng cho test từ cấm). Bỏ qua mục “Có gì mới” vì nó được phép nhắc tên cũ. */
export function allText(doc: HelpDoc): string {
  return [doc.title, doc.summary, ...entriesOf(doc).filter(e => e.section !== 'changes').flatMap(e => [e.title, e.body])].join('\n')
}

export function allGuideText(guide: HelpGuide): string {
  return [
    guide.title,
    guide.summary,
    ...guide.notes,
    ...guide.journeys.flatMap(j => [j.name, j.goal, ...j.steps.map(step => `${step.page} ${step.note}`)]),
  ].join('\n')
}

export interface RecentChange {
  pageId: PageId
  date: string
  text: string
}

/** Thay đổi gần đây gom từ mục “Có gì mới” của mọi trang, mới nhất trước. */
export function recentChanges(docs: HelpDoc[], limit = 10): RecentChange[] {
  const all = docs.flatMap(doc => doc.changes.map(change => ({ pageId: doc.pageId, date: change.date, text: change.text })))
  return all.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)).slice(0, limit)
}
