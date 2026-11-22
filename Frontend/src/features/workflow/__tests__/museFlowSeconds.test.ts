import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  DEFAULT_MUSE_CANVAS_CONFIG,
  FLOW_MAX_VARIANTS,
  museCanvasConfigToApi,
  normalizeFlowSeconds,
  normalizeFlowVariants,
  normalizeMuseCanvasConfig,
} from '../services/museCanvasConfig.ts'
import {
  MUSE_NODE,
  buildClipScriptContext,
  buildClipScriptRequest,
  clipFlowCredits,
  clipsCredits,
  createOutputNode,
  fixedClipSeconds,
  flowClipCredits,
  scriptRefsFromSources,
  videoIngrTrim,
} from '../services/museCanvasNodes.ts'
import { applyProjectSettings, normalizeProjectSettings, projectSettingsToApi } from '../services/museProjects.ts'

test('giá Flow theo bậc khớp mọi mốc đã đo (10 giây đầu giá thường, phần vượt gấp đôi)', () => {
  // campaign/graph.FLOW_CREDIT_R2V + HAR: 720p 6/8/10/13 s; giao diện Flow: 15 s 720p = 60; 360p 10 s = 10, 15 s = 20
  const measured: [number, '720p' | '360p', number][] = [
    [6, '720p', 18], [8, '720p', 24], [10, '720p', 30], [13, '720p', 48], [15, '720p', 60],
    [10, '360p', 10], [15, '360p', 20],
  ]
  for (const [s, r, c] of measured) assert.equal(flowClipCredits(s, r), c, `${s}s ${r}`)
  assert.equal(clipFlowCredits(15, '720p'), 60) // trước đây báo 45
  // tổng nhiều clip = cộng giá từng clip (không cộng giây trước): 2 clip 8 s = 48, không phải 1 clip 16 s = 66
  assert.equal(clipsCredits([8, 8]), 48)
  assert.equal(clipsCredits([13, null, 6]), 66)
})

test('thời lượng cấu hình: 0 = Tự động, 3–15 giây, giá trị lạ -> Tự động', () => {
  assert.deepEqual([0, 3, 8, 15].map(normalizeFlowSeconds), [0, 3, 8, 15])
  assert.deepEqual([2, 16, -1, 'x', null, undefined, 7.6].map(normalizeFlowSeconds), [0, 0, 0, 0, 0, 0, 8])
  assert.equal(DEFAULT_MUSE_CANVAS_CONFIG.flowSeconds, 0)
  assert.equal(normalizeMuseCanvasConfig({ flow_seconds: 12 }).flowSeconds, 12)
  assert.equal(museCanvasConfigToApi({ ...DEFAULT_MUSE_CANVAS_CONFIG, flowSeconds: 9 }).flow_seconds, 9)
  const ps = normalizeProjectSettings({ flow_seconds: 10 })
  assert.equal(ps.flowSeconds, 10)
  assert.equal(projectSettingsToApi(ps).flow_seconds, 10)
  assert.equal(applyProjectSettings(DEFAULT_MUSE_CANVAS_CONFIG, ps).flowSeconds, 10)
  assert.deepEqual([fixedClipSeconds(0), fixedClipSeconds(8), fixedClipSeconds(16), fixedClipSeconds(null)], [0, 8, 0, 0])
})

test('Kịch bản tạo video: thời lượng cố định -> dặn ChatGPT mỗi clip đúng N giây; Tự động thì không dặn', () => {
  const img = (p: string) => ({ id: p, name: p, path: p, previewUrl: '/x', size: 1 })
  const refs = scriptRefsFromSources([
    createOutputNode({ x: 0, y: 0 }, img('D:/b1.png'), { jobNodeId: 'j', jobType: MUSE_NODE.characterSheet, sourceNodeId: 's', rowLabel: 'B1' }, '', 'b1'),
  ])
  assert.doesNotMatch(buildClipScriptContext(refs, ''), /Clip length is fixed/)
  const ctx = buildClipScriptContext(refs, '', 8)
  assert.match(ctx, /every clip is exactly 8 seconds \(D = 8 in every "=== SCRIPT" line\)/)
  assert.match(String(buildClipScriptRequest(DEFAULT_MUSE_CANVAS_CONFIG, 'P', refs, '', 12).prompt), /exactly 12 seconds/)
  assert.doesNotMatch(String(buildClipScriptRequest(DEFAULT_MUSE_CANVAS_CONFIG, 'P', refs, '', 0).prompt), /Clip length is fixed/)
})

test('Ingredients: đoạn cắt mặc định dài đúng thời lượng cấu hình, không vượt độ dài video', () => {
  const none = { trimStart: null, trimEnd: null }
  assert.deepEqual(videoIngrTrim({ ...none, targetSeconds: 0 }, 13.6), { start: 0, end: 13.6, length: 13.6 }) // Tự động = cả video
  assert.deepEqual(videoIngrTrim({ ...none, targetSeconds: 8 }, 13.6), { start: 0, end: 8, length: 8 })
  assert.deepEqual(videoIngrTrim({ trimStart: 4, trimEnd: null, targetSeconds: 8 }, 13.6), { start: 4, end: 12, length: 8 })
  assert.deepEqual(videoIngrTrim({ ...none, targetSeconds: 15 }, 13.6), { start: 0, end: 13.6, length: 13.6 }) // video ngắn hơn
  assert.deepEqual(videoIngrTrim({ trimStart: 1, trimEnd: 6, targetSeconds: 12 }, 13.6), { start: 1, end: 6, length: 5 }) // tự cắt thắng
})

test('biến thể 1–4: mặc định 1, giá trị lạ -> 1, đi qua cấu hình và cài đặt project', () => {
  assert.equal(FLOW_MAX_VARIANTS, 4)
  assert.deepEqual([1, 2, 3, 4].map(normalizeFlowVariants), [1, 2, 3, 4])
  assert.deepEqual([0, 5, -1, 'x', null, undefined, NaN, 2.6].map(normalizeFlowVariants), [1, 1, 1, 1, 1, 1, 1, 3])
  assert.equal(DEFAULT_MUSE_CANVAS_CONFIG.flowVariants, 1)
  assert.equal(normalizeMuseCanvasConfig({ flow_variants: 3 }).flowVariants, 3)
  assert.equal(museCanvasConfigToApi({ ...DEFAULT_MUSE_CANVAS_CONFIG, flowVariants: 4 }).flow_variants, 4)
  const ps = normalizeProjectSettings({ flow_variants: 2 })
  assert.equal(ps.flowVariants, 2)
  assert.equal(projectSettingsToApi(ps).flow_variants, 2)
  assert.equal(applyProjectSettings(DEFAULT_MUSE_CANVAS_CONFIG, ps).flowVariants, 2)
})
