import assert from 'node:assert/strict'
import test from 'node:test'
import type { Edge, Node } from '@xyflow/react'
import { invalidateGraphTargets, reconcileWorkflowNodes } from '../services/workflowState.ts'

function flow(id: string, data: Record<string, unknown>): Node {
  return { id, type: 'veoFlowStudio', position: { x: 0, y: 0 }, data }
}

test('scene output changes advance the revision so stale frame/export results are rejected', () => {
  const previous = [flow('flow', {
    inputRevision: 4,
    scenes: [{ sceneNumber: 1, title: 'Clip', prompt: 'old', durationSec: 10, aspectRatio: '9:16', outputFilePath: 'old.mp4' }],
  })]
  const next = [flow('flow', {
    inputRevision: 4,
    scenes: [{ sceneNumber: 1, title: 'Clip', prompt: 'old', durationSec: 10, aspectRatio: '9:16', outputFilePath: null }],
  })]

  const result = reconcileWorkflowNodes(previous, next, [])
  const resultData = result[0].data as Record<string, any>
  assert.equal(resultData.inputRevision, 5)
  assert.equal(resultData.scenes[0].outputFilePath, null)
  assert.equal(resultData.isExporting, false)
})

test('graph edits invalidate the target and all downstream nodes', () => {
  const nodes = [
    { id: 'source', type: 'gptScript', position: { x: 0, y: 0 }, data: { salesScripts: ['cached'] } },
    flow('flow', { scenes: [{ sceneNumber: 1, title: 'Clip', prompt: 'cached', durationSec: 10, aspectRatio: '9:16', outputFilePath: 'cached.mp4' }] }),
    { id: 'export', type: 'exportTimeline', position: { x: 0, y: 0 }, data: { finalVideoUrl: 'cached.mp4' } },
  ] as Node[]
  const edges = [
    { id: 'source-flow', source: 'source', target: 'flow' },
    { id: 'flow-export', source: 'flow', target: 'export' },
  ] as Edge[]

  const result = invalidateGraphTargets(nodes, edges, ['flow'])
  const flowData = result.find(node => node.id === 'flow')?.data as Record<string, any>
  const exportData = result.find(node => node.id === 'export')?.data as Record<string, any>
  assert.equal(flowData.scriptSourceStale, true)
  assert.equal(flowData.scenes[0].outputFilePath, null)
  assert.equal(exportData.finalVideoUrl, null)
})
