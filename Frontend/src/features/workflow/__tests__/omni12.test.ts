import assert from 'node:assert/strict'
import test from 'node:test'
import type { AssetRef, ScenePlan } from '../contracts'
import type { VeoVideoConfig } from '../types'
import type { VeoJobOut, VeoJobRequest, VeoProject } from '../../veo-studio/types'
import { buildWorkflowVideoRequest, RenderJobController } from '../services/renderJobService.ts'
import { prepareChainedScene } from '../services/prepareChainedScene.ts'
import {
  OMNI_12, clipCredit, droppedReferenceCount, durationOptionsFor, listingMode, pickReferencePaths,
} from '../services/veoModelPolicy.ts'

const omni12: VeoVideoConfig = { model: OMNI_12, aspectRatio: '9:16', duration: 8, resolution: '360p', variations: 1 }
const project = { id: 'p' } as VeoProject
const asset = (kind: AssetRef['kind'], n: number, extra: Partial<AssetRef> = {}): AssetRef => ({
  id: `${kind}${n}`, kind, previewUrl: '', backendPath: `C:/img/${kind}${n}.jpg`, uploadStatus: 'uploaded', ...extra,
})
const threeProducts = [asset('product', 1), asset('product', 2), asset('product', 3)]
const all = [...threeProducts, asset('model', 1), asset('scene', 1)]
const plan = (n: number, over: Partial<ScenePlan> = {}): ScenePlan => ({
  sceneNumber: n, title: `C${n}`, prompt: `P${n}`, durationSec: 8, aspectRatio: '9:16', referenceAssets: all, chainFromPrevious: n > 1, ...over,
})
const req = (scene: ScenePlan, config = omni12) => buildWorkflowVideoRequest({ scene, project, videoConfig: config })

test('references: one of each kind first so three product photos never push the model out', () => {
  assert.deepEqual(pickReferencePaths(null, all), ['C:/img/product1.jpg', 'C:/img/model1.jpg', 'C:/img/scene1.jpg'])
  assert.deepEqual(pickReferencePaths(null, threeProducts), threeProducts.map(a => a.backendPath))
  // nối clip: khung cuối đứng đầu, bối cảnh bị bỏ trước (khung cuối đã có nơi quay)
  assert.deepEqual(pickReferencePaths('C:/frames/last.jpg', all), ['C:/frames/last.jpg', 'C:/img/product1.jpg', 'C:/img/model1.jpg'])
  assert.equal(droppedReferenceCount('C:/frames/last.jpg', all), 3)
  assert.deepEqual(pickReferencePaths(null, [asset('product', 1), asset('product', 1)]), ['C:/img/product1.jpg'])
})

test('Omni 1.2 first clip goes Ingredients with up to 3 references and any 3–15s duration', () => {
  const r = req(plan(1, { durationSec: 13 }))
  assert.equal(r.model_display_name, OMNI_12)
  assert.equal(r.input_mode, 'ingredients')
  assert.equal(r.duration_seconds, 13)
  assert.equal(r.resolution, '360p')
  assert.deepEqual(r.ingredient_image_paths, ['C:/img/product1.jpg', 'C:/img/model1.jpg', 'C:/img/scene1.jpg'])
  assert.equal(r.image_path, null)
  for (const bad of [2, 16]) assert.throws(() => req(plan(1, { durationSec: bad })), /3–15 giây/)
})

test('Omni 1.2 chained clip uses the previous last frame as the first reference, never as a start frame', () => {
  const r = req(plan(2, { startFramePath: 'C:/frames/1.jpg' }))
  assert.equal(r.input_mode, 'ingredients')
  assert.equal(r.image_path, null)
  assert.equal(r.ingredient_image_paths?.[0], 'C:/frames/1.jpg')
  assert.equal(r.ingredient_image_paths?.length, 3)
  // clip nối tiếp mà chưa có khung cuối: vẫn dừng, không âm thầm tạo clip rời
  assert.throws(() => req(plan(2)), /Start Frame/)
})

test('Omni 1.2 without any reference is text-to-video and only 10 seconds', () => {
  const lone = plan(1, { referenceAssets: [] })
  assert.throws(() => req(lone), /10 giây/)
  const r = req({ ...lone, durationSec: 10 })
  assert.equal(r.input_mode, 'text_to_video')
  assert.deepEqual(r.ingredient_image_paths, [])
})

test('Omni 1.2 refuses to send while a needed reference is still uploading, but ignores an extra one', () => {
  assert.throws(() => req(plan(1, { referenceAssets: [asset('product', 1), asset('model', 1, { uploadStatus: 'uploading' })] })), /chưa tải xong/)
  // đã đủ 3 ảnh gửi được thì ảnh thứ 4 đang lỗi không chặn
  const ok = req(plan(1, { referenceAssets: [...all.slice(0, 3), asset('model', 1), asset('scene', 9, { uploadStatus: 'error' })] }))
  assert.equal(ok.ingredient_image_paths?.length, 3)
  assert.throws(() => req(plan(1), { ...omni12, resolution: '1080p' }), /360p hoặc 720p/)
  assert.throws(() => req(plan(1), { ...omni12, variations: 2 }), /1 biến thể/)
})

test('a 3-clip Omni 1.2 chain submits Ingredients each time with the right first reference', async () => {
  const sent: VeoJobRequest[] = []
  const api = {
    submitJob: async (r: VeoJobRequest) => { sent.push(r); return { job_id: `job-${sent.length}` } as VeoJobOut },
    getJobStatus: async (id: string) => ({ job_id: id, status: 'done', output_files: [`C:/videos/${id}.mp4`] }) as VeoJobOut,
    getVideoStreamUrl: (p: string) => p,
  }
  const policy = { intervalMs: 1, timeoutMs: 500, requestTimeoutMs: 100, maxConsecutiveErrors: 2 }
  const scenes = [plan(1), plan(2), plan(3)]
  for (let i = 0; i < scenes.length; i++) {
    const scene = await prepareChainedScene(scenes[i], i, scenes[i - 1], async () => ({ ok: true, file_path: `C:/frames/${i}.jpg`, image_id: `f${i}` }), id => id)
    const out = await new RenderJobController(api, policy).renderScene({ scene, project, videoConfig: omni12 })
    assert.equal(out.ok, true)
    scenes[i] = { ...scene, outputFilePath: out.outputFilePath }
  }
  assert.deepEqual(sent.map(r => r.input_mode), ['ingredients', 'ingredients', 'ingredients'])
  assert.deepEqual(sent.map(r => r.ingredient_image_paths?.[0]), ['C:/img/product1.jpg', 'C:/frames/1.jpg', 'C:/frames/2.jpg'])
  assert.ok(sent.every(r => r.model_display_name === OMNI_12 && r.image_path === null && r.num_outputs === 1))
})

test('Omni 1.1 is gone from AI Workflow: any other model is refused with a clear message', () => {
  assert.throws(() => req(plan(2, { startFramePath: 'C:/frames/1.jpg' }), { ...omni12, model: 'Omni 1.1 Flash', resolution: '720p' }), /chỉ tạo clip bằng Omni 1.2/)
})

test('durations and price follow the Ingredients profiles for Omni 1.2, text-to-video for others', () => {
  const profiles = [
    ...[3, 8, 13, 15].map(d => ({ model_display_name: OMNI_12, input_mode: 'ingredients', aspect_ratio: '9:16', resolution: '720p', duration_seconds: d,
      credit_cost: d === 13 ? 48 : 3 * Math.min(d, 10) + 6 * Math.max(d - 10, 0), runtime_verified: d === 8 || d === 13,
      note: d === 13 ? 'Giá đã đo · HTTP' : 'Giá dự kiến theo công thức · HTTP' })),
    { model_display_name: OMNI_12, input_mode: 'text_to_video', aspect_ratio: '9:16', resolution: '720p', duration_seconds: 10, credit_cost: 30 },
    ...[4, 6, 8, 10].map(d => ({ model_display_name: 'Veo 3.1 - Fast', input_mode: 'text_to_video', aspect_ratio: '9:16', resolution: '720p', duration_seconds: d })),
  ]
  assert.equal(listingMode(OMNI_12), 'ingredients')
  assert.deepEqual(durationOptionsFor(profiles, OMNI_12, '9:16', '720p'), [3, 8, 13, 15])
  assert.deepEqual(durationOptionsFor(profiles, 'Veo 3.1 - Fast', '9:16', '720p'), [4, 6, 8, 10])
  assert.deepEqual(clipCredit(profiles, OMNI_12, '9:16', '720p', 13), { credit: 48, verified: true })
  // 8s đã chạy thật nhưng giá chưa đo -> vẫn là giá dự kiến
  assert.deepEqual(clipCredit(profiles, OMNI_12, '9:16', '720p', 8), { credit: 24, verified: false })
  assert.deepEqual(clipCredit(profiles, OMNI_12, '9:16', '720p', 15), { credit: 60, verified: false })
  assert.deepEqual(clipCredit(profiles, OMNI_12, '9:16', '360p', 15), { credit: null, verified: false })
})
