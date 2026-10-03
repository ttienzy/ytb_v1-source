import assert from 'node:assert/strict'
import test from 'node:test'
import type { Node } from '@xyflow/react'
import type { AssetRef, ScenePlan } from '../contracts'
import type { VeoVideoConfig } from '../types'
import type { VeoJobOut, VeoJobRequest, VeoProject } from '../../veo-studio/types'
import { buildWorkflowVideoRequest, RenderJobController } from '../services/renderJobService.ts'
import { prepareChainedScene } from '../services/prepareChainedScene.ts'
import { reconcileWorkflowNodes } from '../services/workflowState.ts'
import { buildClipPlans } from '../services/buildScenePlan.ts'

const videoConfig: VeoVideoConfig = { model: 'Omni 1.1 Flash', aspectRatio: '9:16', duration: 10, resolution: '720p', variations: 1 }
const project = { id: 'project-local' } as VeoProject
const assets: AssetRef[] = ['product', 'model', 'scene'].map((kind, i) => ({
  id: `${i}`, kind: kind as AssetRef['kind'], previewUrl: `preview-${i}`, backendPath: `C:/images/${i}.jpg`, uploadStatus: 'uploaded',
}))
const plan = (number = 1): ScenePlan => ({ sceneNumber: number, title: `Clip ${number}`, prompt: `Prompt ${number}`, durationSec: 10,
  aspectRatio: '9:16', referenceAssets: assets, chainFromPrevious: number > 1 })
const policy = { intervalMs: 1, timeoutMs: 500, requestTimeoutMs: 100, maxConsecutiveErrors: 2 }
const request = (scene: ScenePlan, config = videoConfig) => buildWorkflowVideoRequest({ scene, project, videoConfig: config })

test('GPT plans render Ingredients then two single-frame continuations through state reconciliation', async () => {
  const scenes = buildClipPlans({
    scripts: [1, 2, 3].map(i => ({ angle: 'sequence', title: `Clip ${i}`, content: `Prompt ${i}`, visualDirection: `Prompt ${i}` })),
    sceneConfig: { count: 3, durations: [10, 8, 6], aspectRatio: '9:16', storyMode: 'sequential' }, assets,
  })
  let nodes: Node[] = [{ id: 'flow', type: 'veoFlowStudio', position: { x: 0, y: 0 }, data: { scenes } }]
  const read = () => nodes[0].data.scenes as ScenePlan[]
  const update = (index: number, patch: Partial<ScenePlan>) => {
    nodes = reconcileWorkflowNodes(nodes, nodes.map(n => ({ ...n, data: { ...n.data,
      scenes: read().map((s, i) => i === index ? { ...s, ...patch } : s) } })), [])
  }
  const sent: VeoJobRequest[] = [], extracted: string[] = []
  const api = {
    submitJob: async (r: VeoJobRequest) => { sent.push(r); return { job_id: `job-${sent.length}` } as VeoJobOut },
    getJobStatus: async (id: string) => ({ job_id: id, status: 'done', output_files: [`C:/videos/${id}.mp4`] }) as VeoJobOut,
    getVideoStreamUrl: (path: string) => path,
  }
  for (let i = 0; i < read().length; i++) {
    const scene = await prepareChainedScene(read()[i], i, read()[i - 1], async path => {
      extracted.push(path); return { ok: true, file_path: `C:/frames/${i}.jpg`, image_id: `frame-${i}` }
    }, id => id)
    update(i, { startFramePath: scene.startFramePath })
    const result = await new RenderJobController(api, policy).renderScene({ scene, project, videoConfig,
      onSubmitted: jobId => update(i, { jobId }) })
    assert.equal(result.ok, true)
    update(i, { outputFilePath: result.outputFilePath, videoUrl: result.videoUrl })
  }
  assert.deepEqual(sent.map(r => r.input_mode), ['ingredients', 'frames', 'frames'])
  assert.deepEqual(sent.map(r => r.prompt), ['Prompt 1', 'Prompt 2', 'Prompt 3'])
  assert.deepEqual(sent.map(r => r.duration_seconds), [10, 8, 6])
  assert.deepEqual(sent[0].ingredient_image_paths, assets.map(a => a.backendPath))
  assert.deepEqual(sent.map(r => r.image_path), [null, 'C:/frames/1.jpg', 'C:/frames/2.jpg'])
  assert.ok(sent.every(r => r.end_image_path === null && r.num_outputs === 1))
  assert.deepEqual(sent.slice(1).map(r => r.ingredient_image_paths), [[], []])
  assert.deepEqual(extracted, ['C:/videos/job-1.mp4', 'C:/videos/job-2.mp4'])
  assert.equal(read().filter(s => s.outputFilePath).length, 3)
})

test('never fall back to Ingredients when a chained clip lacks its start frame', async () => {
  assert.throws(() => request(plan(2)), /Start Frame/)
  let called = false
  await assert.rejects(prepareChainedScene(plan(2), 1, plan(1), async () => {
    called = true; return { ok: true, file_path: 'x', image_id: 'x' }
  }, id => id), /clip #1/)
  assert.equal(called, false)
  await assert.rejects(prepareChainedScene(plan(2), 1, { ...plan(), outputFilePath: 'previous.mp4' }, async () => (
    { ok: false, file_path: '', image_id: '' }
  ), id => id), /Chuỗi đã dừng/)
})

test('first and independent clips discard legacy start frames and use Ingredients', async () => {
  for (const [index, scene] of [[0, plan()], [1, { ...plan(2), chainFromPrevious: false }]] as const) {
    const prepared = await prepareChainedScene({ ...scene, startFramePath: 'stale.jpg' }, index, undefined,
      async () => { throw new Error('must not extract') }, id => id)
    assert.equal(request(prepared).input_mode, 'ingredients')
  }
})

test('continued clip refreshes stale frame and ignores unused product upload state', async () => {
  const prepared = await prepareChainedScene({ ...plan(2), startFramePath: 'old.jpg' }, 1,
    { ...plan(), outputFilePath: 'new.mp4' }, async path => {
      assert.equal(path, 'new.mp4'); return { ok: true, file_path: 'new-last.jpg', image_id: 'last' }
    }, id => id)
  assert.equal(request({ ...prepared, referenceAssets: [{ ...assets[0], uploadStatus: 'error' }] }).image_path, 'new-last.jpg')
})

test('validate reference count, upload state, model, resolution and variants before submitting', () => {
  assert.throws(() => request({ ...plan(), referenceAssets: [...assets, { ...assets[0], backendPath: 'fourth.jpg' }] }), /tối đa 3/)
  assert.equal(request({ ...plan(), referenceAssets: [...assets, assets[0]] }).ingredient_image_paths?.length, 3)
  assert.throws(() => request({ ...plan(), referenceAssets: [{ ...assets[0], uploadStatus: 'uploading' }] }), /chưa tải xong/)
  for (const config of [{ ...videoConfig, model: 'Veo 3.1 Fast' }, { ...videoConfig, resolution: '1080p' }, { ...videoConfig, variations: 2 }]) {
    assert.throws(() => request(plan(), config))
  }
})

test('lost polling preserves job id and resumes without another submission or extraction', async () => {
  let submits = 0, healthy = false
  const api = {
    submitJob: async () => { submits++; return { job_id: 'existing' } as VeoJobOut },
    getJobStatus: async () => {
      if (!healthy) throw new Error('network disconnected')
      return { status: 'done', output_files: ['existing.mp4'] } as VeoJobOut
    }, getVideoStreamUrl: (path: string) => path,
  }
  const failed = await new RenderJobController(api, policy).renderScene({ scene: plan(), project, videoConfig })
  assert.equal(failed.ok, false); assert.equal(failed.jobId, 'existing')
  healthy = true
  const resumed = await prepareChainedScene({ ...plan(2), jobId: failed.jobId }, 1, undefined,
    async () => { throw new Error('must not extract') }, id => id)
  const result = await new RenderJobController(api, policy).renderScene({ scene: resumed, project, videoConfig })
  assert.equal(result.ok, true); assert.equal(submits, 1)
})
