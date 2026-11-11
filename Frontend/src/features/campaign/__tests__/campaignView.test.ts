import assert from 'node:assert/strict'
import test from 'node:test'
import {
  blockBadge, bundleMembers, describeElement, describeGate, backendMismatch, errorMessage, fillEmpty, httpErrorMessage, isRunning, nothingToRunMessage, planBlocker, progressText, linesToList, listToLines, planSummary, reasonText, riskBadge,
  runStateBadge,
} from '../services/campaignView.ts'
import type { BlockView, ElementState, Plan } from '../types.ts'

const el = (over: Partial<ElementState> = {}): ElementState => ({
  step_key: 'look', element_key: '', state: 'fresh', reasons: [], blockers: [], selected_artifact_id: null,
  fingerprint: null, cached_artifact_id: null, pinned: false, stale: false, gate: null, active_run: null,
  last_run: null, ...over,
})

const block = (n: number, steps: { key: string; elements: ElementState[] }[]): BlockView => ({
  block: n, title: 'x', state: 'fresh',
  steps: steps.map(s => ({ ...s, title: s.key, kind: 'compute', lane: 'local', paid: false, gate: false,
    advisory: false, map: false, params: {} })),
})

test('describeElement explains why a step is stale in Vietnamese', () => {
  const b = describeElement(el({ state: 'stale', stale: true, reasons: ['prompt', 'inputs.cast'] }))
  assert.equal(b.label, 'Cũ')
  assert.equal(b.hint, 'Đổi: prompt, ảnh nhân vật')
  assert.equal(describeElement(el({ state: 'missing' })).label, 'Chưa có')
  assert.equal(describeElement(el({ state: 'pinned', stale: true })).label, 'Ghim (đã cũ)')
  assert.equal(describeElement(el({ active_run: 'r1' })).tone, 'info')
  assert.equal(describeElement(undefined).label, 'Chưa có')
})

test('blocked shows what is missing', () => {
  const b = describeElement(el({ state: 'blocked', blockers: [{ dep: 'look', reason: 'chưa duyệt' }] }))
  assert.equal(b.label, 'Chờ đầu vào')
  assert.equal(b.hint, 'look: chưa duyệt')
})

test('gate badges', () => {
  assert.equal(describeGate('need_approval')?.label, 'Cần duyệt')
  assert.equal(describeGate('approved')?.tone, 'ok')
  assert.equal(describeGate('rejected')?.tone, 'bad')
  assert.equal(describeGate(null), null)
})

test('blockBadge ignores steps that are not implemented yet', () => {
  assert.equal(blockBadge(block(7, [{ key: 'clip_check', elements: [el({ state: 'blocked' })] }])).label, 'Sắp có (GĐ8)')
  const look = block(4, [{ key: 'look', elements: [el({ gate: 'need_approval' })] }])
  assert.equal(blockBadge(look).label, 'Cần duyệt')
  assert.equal(blockBadge(block(4, [{ key: 'look', elements: [el({ state: 'stale' })] }])).label, 'Cũ')
  assert.equal(blockBadge(block(4, [{ key: 'look', elements: [el({ active_run: 'r' })] }])).label, 'Đang chạy')
  assert.equal(blockBadge(block(4, [{ key: 'look', elements: [el({ gate: 'approved' })] }])).label, 'Xong')
  assert.equal(blockBadge(block(1, [{ key: 'garment_source', elements: [el({ state: 'missing' })] }])).label, 'Chưa có')
})

test('planSummary', () => {
  const plan = { images: 2, llm_calls: 0, total_credit: 0, unknown_cost_items: 0, runnable: 1 } as Plan
  assert.equal(planSummary(plan), 'Sẽ chạy: 2 ảnh ChatGPT · 0 credit Flow')
  assert.equal(planSummary({ ...plan, runnable: 0 }), 'Không có gì cần chạy')
  assert.match(planSummary({ ...plan, unknown_cost_items: 3 }), /3 việc chưa rõ giá/)
  assert.equal(planSummary(null), '')
})

test('bundleMembers keeps order and role', () => {
  const members = bundleMembers({ meta: { members: [{ artifact_id: 'a', role: 'front' }, { artifact_id: 'b' }] } } as any)
  assert.deepEqual(members, [{ artifact_id: 'a', role: 'front' }, { artifact_id: 'b', role: '' }])
  assert.deepEqual(bundleMembers(undefined), [])
})

test('misc helpers', () => {
  assert.equal(reasonText('params.count'), 'số ảnh')
  assert.equal(reasonText('params.xyz'), 'params.xyz')
  assert.equal(errorMessage(new Error('hỏng')), 'hỏng')
  assert.equal(errorMessage(42), 'Có lỗi không xác định.')
  assert.equal(runStateBadge('unknown').tone, 'warn')
  assert.equal(runStateBadge('done').label, 'Xong')
})

test('riskBadge and line helpers', () => {
  assert.equal(riskBadge('low').tone, 'ok')
  assert.equal(riskBadge('medium').tone, 'warn')
  assert.equal(riskBadge('high').label, 'Rủi ro cao')
  assert.equal(riskBadge(undefined).label, 'Chưa tính')
  assert.deepEqual(linesToList([' a ', '', ' b', ''].join(String.fromCharCode(10))), ['a', 'b'])
  assert.equal(listToLines(['x', 'y']), ['x', 'y'].join(String.fromCharCode(10)))
  assert.equal(listToLines(undefined), '')
})

test('blockBadge counts fact_sheet and style as implemented', () => {
  assert.equal(blockBadge(block(1, [{ key: 'fact_sheet', elements: [el({ state: 'stale' })] }])).label, 'Cũ')
  assert.equal(blockBadge(block(2, [{ key: 'style', elements: [el()] }, { key: 'cast', elements: [el({ state: 'missing' })] }])).label, 'Chưa có')
})

test('fillEmpty only fills blank fields and reports which', () => {
  const r = fillEmpty({ audience: 'tự gõ', occasion: '  ' }, { audience: 'AI', occasion: 'đi học', price: '', promo: '99k' }, ['audience', 'occasion', 'price', 'promo'])
  assert.deepEqual(r.next, { audience: 'tự gõ', occasion: 'đi học', promo: '99k' })
  assert.deepEqual(r.filled, ['occasion', 'promo'])
  assert.deepEqual(fillEmpty({}, {}, ['a']).filled, [])
})

test('httpErrorMessage explains a missing route instead of a bare Not Found', () => {
  assert.match(httpErrorMessage(404, 'Not Found', 'nhờ Gemini gợi ý'), /khởi động lại Backend/)
  assert.equal(httpErrorMessage(404, 'Không tìm thấy chiến dịch: x', 'tải'), 'Không tìm thấy chiến dịch: x')
  assert.equal(httpErrorMessage(500, '', 'lưu'), 'lưu thất bại (HTTP 500)')
  assert.equal(httpErrorMessage(400, 'Chưa có ảnh sản phẩm.', 'x'), 'Chưa có ảnh sản phẩm.')
})

test('progressText shows the phase and elapsed time', () => {
  assert.equal(progressText(null), '')
  assert.equal(progressText({ message: 'Khung đầu: đang tạo…', started_at: 1000 }, 1042_000), 'Khung đầu: đang tạo… · đã 42 giây')
  assert.equal(progressText({ message: 'Khung cuối', started_at: 1000 }, 1125_000), 'Khung cuối · đã 2 phút 5 giây')
  assert.equal(progressText({ message: 'x', started_at: 5000 }, 1000_000), 'x · đã 0 giây')
})

test('isRunning also trusts element run state so polling never stops on an inconsistent snapshot', () => {
  const idle = { active_exec: null, blocks: [block(4, [{ key: 'look', elements: [el()] }])] }
  assert.equal(isRunning(idle), false)
  assert.equal(isRunning({ ...idle, active_exec: 'e1' }), true)
  assert.equal(isRunning({ active_exec: null, blocks: [block(4, [{ key: 'look', elements: [el({ active_run: 'r1' })] }])] }), true)
  assert.equal(isRunning(null), false)
})

test('backendMismatch tells which parts of an old backend are missing', () => {
  const ok = { executors: ['fact_sheet', 'angle', 'hook', 'shot_plan', 'script', 'look', 'anchor_frame', 'storyboard', 'clip', 'voice', 'assemble'], gated_steps: ['look', 'anchor_frame', 'storyboard', 'clip'] }
  assert.equal(backendMismatch(ok), null)
  const old = { executors: ['fact_sheet', 'angle', 'hook', 'shot_plan', 'script', 'look'], gated_steps: ['look', 'clip'] }
  const msg = backendMismatch(old) ?? ''
  assert.match(msg, /chưa có bước chạy: anchor_frame, storyboard, clip, voice, assemble/)
  assert.match(msg, /chưa có cổng duyệt: anchor_frame, storyboard/)
  assert.match(msg, /đã chạy sẵn/)
  assert.match(backendMismatch(null) ?? '', /bản cũ/)
})

test('planBlocker and nothingToRunMessage explain a run that cannot start', () => {
  const item = (element_key: string, action: string, reason: string) => ({
    step_key: 'clip', element_key, action, reason, fingerprint: null, lane: 'flow', credit: 0, images: 0, llm_calls: 0, estimate: false, blockers: [],
  })
  const plan = { items: [item('shot:1', 'waiting', 'chờ duyệt: keyframe'), item('shot:2', 'run', 'chưa có kết quả')], total_credit: 10, unknown_cost_items: 0,
    images: 0, llm_calls: 0, credit_cap: null, spent_credit: 0, over_budget: false, needs_confirm: true, runnable: 1 } as Plan
  assert.equal(planBlocker(plan, 'clip', 'shot:1')?.action, 'waiting')
  assert.equal(planBlocker(plan, 'clip', 'shot:2'), null)
  assert.equal(planBlocker(plan, 'clip', 'shot:9'), null)
  assert.equal(planBlocker(null, 'clip', 'shot:1'), null)
  assert.equal(nothingToRunMessage(plan, 'clip'), 'Chưa chạy được (chờ duyệt: keyframe).')
  assert.match(nothingToRunMessage({ ...plan, items: [item('shot:2', 'fresh', '')] }, 'clip'), /Không có gì cần chạy/)
})
