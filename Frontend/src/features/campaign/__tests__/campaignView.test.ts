import assert from 'node:assert/strict'
import test from 'node:test'
import {
  beatsFor, countSyllables, elementLabel, maxSyllables, sceneItems, sceneName,
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
  assert.equal(reasonText('inputs.scene_anchor[scene:2]'), 'khung chốt cảnh đã duyệt (cảnh 2)')
  assert.equal(describeElement(el({ state: 'missing' })).label, 'Chưa có')
  assert.equal(describeElement(el({ state: 'pinned', stale: true })).label, 'Ghim (đã cũ)')
  assert.equal(describeElement(el({ active_run: 'r1' })).tone, 'info')
  assert.equal(describeElement(undefined).label, 'Chưa có')
})

test('blocked shows what is missing', () => {
  const b = describeElement(el({ state: 'blocked', blockers: [{ dep: 'cast_sheet', reason: 'chưa duyệt' }] }))
  assert.equal(b.label, 'Chờ đầu vào')
  assert.equal(b.hint, 'cast_sheet: chưa duyệt')
})

test('gate badges', () => {
  assert.equal(describeGate('need_approval')?.label, 'Cần duyệt')
  assert.equal(describeGate('approved')?.tone, 'ok')
  assert.equal(describeGate('rejected')?.tone, 'bad')
  assert.equal(describeGate(null), null)
})

test('blockBadge ignores steps that are not implemented yet', () => {
  assert.equal(blockBadge(block(7, [{ key: 'clip_check', elements: [el({ state: 'blocked' })] }])).label, 'Sắp có')
  const look = block(4, [{ key: 'cast_sheet', elements: [el({ gate: 'need_approval' })] }])
  assert.equal(blockBadge(look).label, 'Cần duyệt')
  assert.equal(blockBadge(block(4, [{ key: 'cast_sheet', elements: [el({ state: 'stale' })] }])).label, 'Cũ')
  assert.equal(blockBadge(block(4, [{ key: 'cast_sheet', elements: [el({ active_run: 'r' })] }])).label, 'Đang chạy')
  assert.equal(blockBadge(block(4, [{ key: 'cast_sheet', elements: [el({ gate: 'approved' })] }])).label, 'Xong')
  assert.equal(blockBadge(block(1, [{ key: 'garment_source', elements: [el({ state: 'missing' })] }])).label, 'Chưa có')
})

test('blockBadge: khối chưa có phần tử nào không báo nhầm "Xong" (khung chốt cảnh khi chưa có cảnh)', () => {
  const b = blockBadge(block(4, [{ key: 'scene_anchor', elements: [] }]))
  assert.equal(b.label, 'Chờ đầu vào')
  assert.notEqual(b.tone, 'ok')
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
  const idle = { active_exec: null, blocks: [block(4, [{ key: 'cast_sheet', elements: [el()] }])] }
  assert.equal(isRunning(idle), false)
  assert.equal(isRunning({ ...idle, active_exec: 'e1' }), true)
  assert.equal(isRunning({ active_exec: null, blocks: [block(4, [{ key: 'cast_sheet', elements: [el({ active_run: 'r1' })] }])] }), true)
  assert.equal(isRunning(null), false)
})

test('backendMismatch tells which parts of an old backend are missing', () => {
  const ok = { executors: ['fact_sheet', 'cast_sheet', 'scene_plate', 'script', 'scene_anchor', 'clip', 'voice', 'assemble', 'export_pack'], gated_steps: ['cast_sheet', 'scene_anchor', 'clip'] }
  assert.equal(backendMismatch(ok), null)
  const old = { executors: ['fact_sheet', 'angle', 'hook', 'shot_plan', 'script', 'look'], gated_steps: ['look', 'clip'] }
  const msg = backendMismatch(old) ?? ''
  assert.match(msg, /chưa có bước chạy: cast_sheet, scene_plate, scene_anchor, clip, voice, assemble, export_pack/)
  assert.match(msg, /chưa có cổng duyệt: cast_sheet, scene_anchor/)
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

test('v3: luật âm tiết tiếng Việt, số beat, cảnh', () => {
  assert.equal(countSyllables('Đồ tối giản nhưng thần thái street style không lẫn vào đâu được.'), 13)
  assert.equal(maxSyllables(4), 17)
  assert.equal(maxSyllables(6), 26)
  assert.deepEqual([beatsFor(4), beatsFor(8), beatsFor(12)], [2, 3, 4])
  assert.equal(elementLabel('scene:2'), 'cảnh 2')
  assert.equal(elementLabel('shot:3'), 'shot 3')
  const scenes = sceneItems({ items: [{ name: 'Phố', place: 'a street' }, null, { place: 'a cafe' }] })
  assert.deepEqual(scenes.map(s => s.key), ['scene:1', 'scene:2'])
  assert.equal(sceneName(scenes, 'scene:1'), 'Phố')
  assert.equal(sceneName(scenes, 'scene:2'), 'a cafe')
  assert.equal(sceneName(scenes, 'scene:9'), 'cảnh 9')
  assert.deepEqual(sceneItems(undefined), [])
})

// ── kịch bản: dạng cũ (v2) không được làm vỡ trang ───────────────────────────
test('adaptScriptDoc: kịch bản dạng cũ (v1/v2) → null để giao diện báo rõ thay vì trắng trang', async () => {
  const { adaptScriptDoc, LEGACY_SCRIPT_MSG } = await import('../services/campaignView.ts')
  // Đúng dạng artifact thật của chiến dịch v2.4 (5d27a03c3a42): shot chỉ có shot/voiceover/on_screen_text
  const legacy = { caption: 'c', cta: 'mua', hashtags: ['#a'], items: [{ shot: 'shot:1', voiceover: 'xin chào', on_screen_text: 'NY' }] }
  assert.equal(adaptScriptDoc(legacy), null)
  assert.equal(adaptScriptDoc(null), null)
  assert.equal(adaptScriptDoc('abc'), null)
  assert.match(LEGACY_SCRIPT_MSG, /Viết lại/)
})

test('adaptScriptDoc: kịch bản v3 thiếu trường được bù mặc định (không còn undefined.length)', async () => {
  const { adaptScriptDoc, beatsFor } = await import('../services/campaignView.ts')
  const doc = adaptScriptDoc({
    format_id: 'fit_check', angle_vi: 'ý', hook: { type: 'direct', on_screen_text: 'Hook' }, caption: '', hashtags: ['#x'], cta: '',
    motion_limit: 'gentle', total_seconds: 9,
    items: [
      { key: 'shot:1', role: 'hook', scene: 'scene:1', duration: 4, camera: { angle: 'eye-level', lens: '35mm', move: 'static' },
        needs_face: true, garment_ref: 'front', motion: 'gentle', beats: ['a', 'b'], expression: '', voiceover: 'v', on_screen_text: 't', max_syllables: 17 },
      { key: 'shot:2', beats: ['x'] }, // sửa tay/Gemini bỏ sót gần hết trường
    ],
  })
  assert.ok(doc)
  const s2 = doc!.items[1]
  assert.deepEqual(s2.camera, { angle: '', lens: '', move: '' })
  assert.equal(s2.voiceover, '')
  assert.equal(s2.on_screen_text, '')
  assert.equal(s2.needs_face, true)
  assert.equal(s2.garment_ref, 'front')
  assert.equal(s2.motion, 'gentle')
  assert.equal(s2.duration, 5)
  assert.equal(typeof beatsFor(s2.duration), 'number')
  assert.equal(doc!.items[0].camera.lens, '35mm') // trường có sẵn giữ nguyên
  assert.equal(doc!.motion_limit, 'gentle')
})

test('adaptScriptDoc: kịch bản v3 chưa có shot vẫn hợp lệ (giao diện hiện "chưa có shot")', async () => {
  const { adaptScriptDoc } = await import('../services/campaignView.ts')
  const doc = adaptScriptDoc({ format_id: 'grwm', items: [] })
  assert.ok(doc)
  assert.deepEqual(doc!.items, [])
  assert.deepEqual(doc!.hook, { type: 'direct', on_screen_text: '' })
})
