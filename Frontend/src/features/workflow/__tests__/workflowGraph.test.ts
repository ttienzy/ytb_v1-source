import assert from 'node:assert/strict'
import test from 'node:test'
import type { Edge, Node } from '@xyflow/react'
import {
  getWorkflowExecutionOrder, isSupportedWorkflowStartType, isValidWorkflowConnection,
  validateWorkflowGraph, WORKFLOW_CONNECTION_RULES,
} from '../services/workflowGraph.ts'
import {
  findConnectedSourceNodes, findSingleConnectedSourceNode, resolveCharacterSceneInput,
  resolveGeminiAnalysisInput, resolveGptScriptsInput, resolveProductAssetsInput,
  resolveRenderAssetsInput, resolveWorkflowAssetsInput,
} from '../services/graphResolver.ts'
import type { AssetRef } from '../contracts.ts'

const node = (id: string, type: string, data = {}): Node => ({ id, type, data, position: { x: 0, y: 0 } })
const edge = (source: string, target: string, extra = {}): Edge => ({ id: `${source}-${target}`, source, target, ...extra })
const asset = (id: string, extra: Partial<AssetRef> = {}): AssetRef => ({
  id, kind: 'product', previewUrl: `preview:${id}`, backendPath: `/assets/${id}`, uploadStatus: 'uploaded', ...extra,
})

test('connections accept the initial graph ports and allow fanout', () => {
  for (const [sourceType, sourceHandle, targetType, targetHandle] of WORKFLOW_CONNECTION_RULES) {
    const nodes = [node('s', sourceType), node('t', targetType), node('other', targetType)]
    const connection = { source: 's', target: 't', sourceHandle, targetHandle }
    assert.equal(isValidWorkflowConnection(nodes, [edge('s', 'other', { sourceHandle, targetHandle })], connection), true)
    assert.equal(isValidWorkflowConnection(nodes, [], { ...connection, sourceHandle: 'wrong' }), false)
    assert.equal(isValidWorkflowConnection(nodes, [], { ...connection, targetHandle: 'wrong' }), false)
    assert.equal(isValidWorkflowConnection(nodes, [], { ...connection, targetHandle: null }), false)
    assert.equal(isValidWorkflowConnection(nodes, [], { ...connection, target: 'missing' }), false)
  }
})

test('shared asset handle accepts one product and one character, but not two of either', () => {
  const nodes = [node('p', 'productAssets'), node('p2', 'productAssets'), node('c', 'characterScene'), node('f', 'veoFlowStudio')]
  const edges = [edge('p', 'f', { sourceHandle: 'to-flow', targetHandle: 'from-assets' })]
  assert.equal(isValidWorkflowConnection(nodes, edges, { source: 'c', target: 'f', sourceHandle: 'to-flow', targetHandle: 'from-assets' }), true)
  assert.equal(isValidWorkflowConnection(nodes, edges, { source: 'p2', target: 'f', sourceHandle: 'to-flow', targetHandle: 'from-assets' }), false)
  assert.equal(isValidWorkflowConnection(nodes, edges, { source: 'p', target: 'f', sourceHandle: 'to-flow', targetHandle: 'from-assets' }), false)
})

test('execution order is deterministic, reachable, topological and deduplicated', () => {
  const nodes = [node('f', 'veoFlowStudio'), node('g2', 'gptScript'), node('p', 'productAssets'), node('a', 'geminiAnalysis'), node('g1', 'gptScript'), node('unrelated', 'geminiAnalysis')]
  const edges = [edge('p', 'f'), edge('p', 'g1'), edge('p', 'a'), edge('a', 'g2'), edge('a', 'g1'), edge('g1', 'f'), edge('g1', 'f', { id: 'duplicate' })]
  const expected = ['p', 'a', 'g1', 'g2', 'f']
  assert.deepEqual(getWorkflowExecutionOrder(nodes, edges, 'p').map((item) => item.id), expected)
  assert.deepEqual(getWorkflowExecutionOrder([...nodes].reverse(), [...edges].reverse(), 'p').map((item) => item.id), expected)
  assert.deepEqual(getWorkflowExecutionOrder(nodes, edges, 'f').map((item) => item.id), ['f'])
})

test('invalid topology and legacy starts are rejected', () => {
  const nodes = [node('a', 'geminiAnalysis'), node('a2', 'geminiAnalysis'), node('g', 'gptScript')]
  assert.throws(() => validateWorkflowGraph(nodes, [edge('a', 'g'), edge('g', 'a')]))
  assert.throws(() => validateWorkflowGraph(nodes, [edge('absent', 'g')]), /Dangling/)
  assert.throws(() => validateWorkflowGraph(nodes, [edge('a', 'g'), edge('a2', 'g')]), /Ambiguous/)
  assert.throws(() => validateWorkflowGraph([...nodes, nodes[0]], []), /Duplicate/)
  for (const type of ['sceneVideo', 'exportTimeline', 'assetInput']) {
    assert.equal(isSupportedWorkflowStartType(type), false)
    assert.throws(() => getWorkflowExecutionOrder([node('legacy', type)], [], 'legacy'), /Unsupported/)
  }
  assert.equal(isSupportedWorkflowStartType('veoFlowStudio'), true)
})

test('direct resolvers deduplicate edges, reject multiple sources and preserve analysis fields', () => {
  const analysis = { rawText: 'details', features: ['soft'], sellingPoints: ['durable'], suggestedAngles: [], providerUsed: '9router' }
  const nodes = [node('a', 'geminiAnalysis', { analysisResult: analysis }), node('a2', 'geminiAnalysis', { analysisResult: 'legacy text' }), node('g', 'gptScript')]
  const params = { nodes, edges: [edge('a', 'g'), edge('a', 'g', { id: 'again' })], targetNodeId: 'g' }
  assert.equal(findConnectedSourceNodes(params).length, 1)
  assert.deepEqual(resolveGeminiAnalysisInput(params).data?.sellingPoints, ['durable'])
  assert.equal(resolveGeminiAnalysisInput(params).data?.rawText, 'details')
  assert.equal(resolveGeminiAnalysisInput(params).data?.providerUsed, '9router')
  params.edges.push(edge('a2', 'g'))
  assert.equal(findSingleConnectedSourceNode(params).ok, false)
  assert.equal(resolveGeminiAnalysisInput(params).ok, false)
  assert.equal(resolveGeminiAnalysisInput({ ...params, edges: [edge('a2', 'g')] }).data?.rawText, 'legacy text')
})

test('optional character input rejects ambiguity and never labels a preview as uploaded', () => {
  const nodes = [node('c', 'characterScene', { modelImage: 'blob:photo' }), node('c2', 'characterScene'), node('g', 'gptScript')]
  assert.equal(resolveCharacterSceneInput({ nodes, edges: [], targetNodeId: 'g' }).ok, true)
  assert.equal(resolveCharacterSceneInput({ nodes, edges: [edge('c', 'g')], targetNodeId: 'g' }).data?.model?.uploadStatus, 'idle')
  assert.equal(resolveCharacterSceneInput({ nodes, edges: [edge('c', 'g'), edge('c2', 'g')], targetNodeId: 'g' }).ok, false)
})

test('script resolver rejects stale and empty cached output and retains phase', () => {
  const g = node('g', 'gptScript', { salesScripts: [{ content: 'hello', phase: 'Hook' }] })
  const params = { nodes: [g], edges: [edge('g', 'f')], targetNodeId: 'f' }
  assert.equal(resolveGptScriptsInput(params).data?.[0].phase, 'Hook')
  g.data.scriptInputStale = true
  assert.equal(resolveGptScriptsInput(params).ok, false)
  g.data.scriptInputStale = false
  g.data.salesScripts = [{}]
  assert.equal(resolveGptScriptsInput(params).ok, false)
})

test('render assets inherit recursively and deduplicate converging paths', () => {
  const nodes = [node('p', 'productAssets', { assets: [asset('p')] }), node('c', 'characterScene', { modelAsset: asset('m', { kind: 'model' }) }), node('a', 'geminiAnalysis'), node('g', 'gptScript'), node('f', 'veoFlowStudio')]
  const edges = [edge('p', 'a'), edge('p', 'g'), edge('a', 'g'), edge('c', 'g'), edge('g', 'f')]
  const result = resolveRenderAssetsInput({ nodes, edges, targetNodeId: 'f' })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data?.referenceImagePaths, ['/assets/p', '/assets/m'])
  assert.equal(result.data?.products.length, 1)
})

test('direct source overrides inherited source per type, including an explicitly empty source', () => {
  const nodes = [node('old', 'productAssets', { assets: [asset('pending', { uploadStatus: 'uploading' })] }), node('direct', 'productAssets', { assets: [asset('new')] }), node('c', 'characterScene', { sceneAsset: asset('scene', { kind: 'scene' }) }), node('g', 'gptScript'), node('f', 'veoFlowStudio')]
  const edges = [edge('old', 'g'), edge('c', 'g'), edge('g', 'f'), edge('direct', 'f')]
  const params = { nodes, edges, targetNodeId: 'f' }
  assert.deepEqual(resolveRenderAssetsInput(params).data?.referenceImagePaths, ['/assets/new', '/assets/scene'])
  nodes[1].data.assets = []
  assert.deepEqual(resolveRenderAssetsInput(params).data?.referenceImagePaths, ['/assets/scene'])
})

test('selected missing/pending/failed uploads remain visible and block rendering', () => {
  for (const upload of [asset('idle', { uploadStatus: 'idle' }), asset('pending', { uploadStatus: 'uploading' }), asset('failed', { uploadStatus: 'error', previewUrl: '', backendPath: undefined }), asset('missing', { backendPath: undefined })]) {
    const params = { nodes: [node('p', 'productAssets', { assets: [upload] }), node('f', 'veoFlowStudio')], edges: [edge('p', 'f')], targetNodeId: 'f' }
    assert.equal(resolveProductAssetsInput(params).data?.assets.length, 1)
    assert.equal(resolveWorkflowAssetsInput(params).data?.assets.length, 1)
    assert.equal(resolveRenderAssetsInput(params).ok, false)
  }
  for (const selected of [{ images: ['blob:pending'], assets: [null] }, { images: ['one', 'two'], assets: [asset('one'), null] }]) {
    const params = { nodes: [node('p', 'productAssets', selected), node('f', 'veoFlowStudio')], edges: [edge('p', 'f')], targetNodeId: 'f' }
    assert.equal(resolveRenderAssetsInput(params).ok, false)
  }
  assert.deepEqual(resolveRenderAssetsInput({ nodes: [node('f', 'veoFlowStudio')], edges: [], targetNodeId: 'f' }).data?.referenceImagePaths, [])
})

test('render resolver rejects ambiguous ancestors, dangling inputs and cycles', () => {
  const nodes = [node('p', 'productAssets'), node('p2', 'productAssets'), node('g', 'gptScript'), node('g2', 'gptScript'), node('f', 'veoFlowStudio')]
  for (const edges of [
    [edge('p', 'g'), edge('p2', 'g2'), edge('g', 'f'), edge('g2', 'f')],
    [edge('missing', 'f')], [edge('g', 'f'), edge('f', 'g')],
  ]) assert.equal(resolveRenderAssetsInput({ nodes, edges, targetNodeId: 'f' }).ok, false)
})
