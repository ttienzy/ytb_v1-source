/** Reachable DAG execution. Flow handlers build plans; they never submit video jobs. */
import type { Node, Edge } from '@xyflow/react'
import type { ScriptGenerationConfig } from '../contracts'
import type * as WorkflowApi from './workflowApi'
import {
  findConnectedSourceNodes,
  findSingleConnectedSourceNode,
  resolveGeminiAnalysisInput,
  resolveGptScriptsInput,
  resolveWorkflowAssetsInput,
} from './graphResolver.ts'
import { buildClipPlans, normalizeClipDuration, isScriptCollectionStale } from './buildScenePlan.ts'
import { getWorkflowConfig } from './workflowConfig.ts'
import type { WorkflowConfig } from './workflowConfig'
import { getWorkflowExecutionOrder, WorkflowGraphError } from './workflowGraph.ts'
import type { WorkflowStartType } from './workflowGraph'

export { SUPPORTED_WORKFLOW_START_TYPES, isSupportedWorkflowStartType } from './workflowGraph.ts'

export interface WorkflowRunCallbacks {
  onNodeStateChange: (nodeId: string, patch: Record<string, any>) => void
  onError: (nodeId: string, error: string) => void
  onSuccess: () => void
}

/** API imports are lazy, so tests can inject services without loading browser code. */
export interface WorkflowRunnerDependencies {
  callGeminiAnalysis: typeof WorkflowApi.callGeminiAnalysis
  callGptScriptGeneration: typeof WorkflowApi.callGptScriptGeneration
  buildClipPlans: typeof buildClipPlans
  getWorkflowConfig: typeof getWorkflowConfig
}

const defaultDependencies: WorkflowRunnerDependencies = {
  callGeminiAnalysis: async (...args) => (await import('./workflowApi.ts')).callGeminiAnalysis(...args),
  callGptScriptGeneration: async (...args) => (await import('./workflowApi.ts')).callGptScriptGeneration(...args),
  buildClipPlans,
  getWorkflowConfig,
}

interface RunContext {
  nodes: Node[]
  edges: Edge[]
  scheduled: Set<string>
  dependencies: WorkflowRunnerDependencies
  config: WorkflowConfig
  patch: (node: Node, patch: Record<string, any>) => void
}

interface NodeHandler {
  preflight: (context: RunContext, node: Node) => void
  execute: (context: RunContext, node: Node) => Promise<void>
  failurePatch?: (message: string) => Record<string, any>
}

function input(context: RunContext, node: Node) {
  return { nodes: context.nodes, edges: context.edges, targetNodeId: node.id }
}

function requireResult<T>(result: { ok: boolean; data?: T; error?: string }, node: Node): T {
  if (!result.ok || result.data === undefined) throw new WorkflowGraphError(node.id, result.error || 'Missing workflow input')
  return result.data
}

function flowDuration(context: RunContext, node: Node): number {
  const data = node.data as Record<string, any>
  return normalizeClipDuration(data.videoConfig?.duration ?? data.scenes?.[0]?.durationSec, context.config.defaultClipDurationSeconds)
}

function scriptConfig(context: RunContext, node: Node): ScriptGenerationConfig {
  const data = node.data as Record<string, any>
  const targets = new Set(context.edges.filter((edge) => edge.source === node.id).map((edge) => edge.target))
  const durations = new Set(context.nodes.filter((child) => targets.has(child.id) && child.type === 'veoFlowStudio')
    .map((child) => flowDuration(context, child)))
  // Shared GPT output uses the common downstream duration, or the runtime default
  // when branches have different durations. Each Flow still builds its own plans.
  const duration = normalizeClipDuration(data.clipDurationSeconds ?? (durations.size === 1 ? [...durations][0] : undefined),
    context.config.defaultClipDurationSeconds)
  return {
    count: typeof data.requestedCount === 'number' ? data.requestedCount : 3,
    batchSize: 8,
    contentMode: data.contentMode || 'custom',
    storyMode: data.storyMode || 'sequential',
    voiceId: data.voiceId,
    platform: 'auto',
    clipDurationSeconds: duration,
    minWords: Math.max(1, Math.round(duration * context.config.voiceoverWordsPerSecond.min)),
    maxWords: Math.max(1, Math.round(duration * context.config.voiceoverWordsPerSecond.max)),
  }
}

function requiredParent(context: RunContext, node: Node, type: 'geminiAnalysis' | 'gptScript'): Node {
  return requireResult(findSingleConnectedSourceNode({ ...input(context, node), expectedSourceType: type }), node)
}

function optionalParent(context: RunContext, node: Node, type: 'geminiAnalysis' | 'gptScript'): Node | null {
  const sources = findConnectedSourceNodes({ ...input(context, node), expectedSourceType: type })
  if (sources.length > 1) {
    throw new WorkflowGraphError(node.id, `Nhiều hơn 1 node nguồn kiểu ${type} kết nối vào node này.`)
  }
  return sources[0] || null
}

function providerFor(node: Node): 'gemini' | 'chatgpt' {
  const value = node.data.analysisProvider ?? node.data.providerUsed ?? 'gemini'
  if (value === '9router') return 'chatgpt'          // sơ đồ cũ đã lưu: 9router được thay bằng tài khoản ChatGPT web
  if (value !== 'gemini' && value !== 'chatgpt') throw new WorkflowGraphError(node.id, `Unsupported analysis provider: ${value}`)
  return value
}

const passthrough: NodeHandler = { preflight: () => {}, execute: async () => {} }

/** One handler per executable type; legacy video/export nodes deliberately have none. */
const handlers: Record<WorkflowStartType, NodeHandler> = {
  productAssets: passthrough,
  characterScene: passthrough,
  geminiAnalysis: {
    preflight(context, node) {
      requiredProduct(context, node)
      providerFor(node)
    },
    async execute(context, node) {
      const assets = requiredProduct(context, node)
      const provider = providerFor(node)
      context.patch(node, { isAnalyzing: true, analysisError: null })
      const analysisResult = await context.dependencies.callGeminiAnalysis(assets.rawImages, String(node.data.prompt || ''), provider)
      requireResult(resolveGeminiAnalysisInput({
        nodes: [{ ...node, data: { ...node.data, analysisResult, isAnalyzing: false, analysisError: null } }],
        edges: [{ id: '__result__', source: node.id, target: '__consumer__' }], targetNodeId: '__consumer__',
      }), node)
      context.patch(node, { isAnalyzing: false, analysisResult, analysisError: null, providerUsed: analysisResult.providerUsed || provider })
    },
    failurePatch: (message) => ({ isAnalyzing: false, analysisError: message }),
  },
  gptScript: {
    preflight(context, node) {
      const geminiParent = optionalParent(context, node, 'geminiAnalysis')
      if (geminiParent && !context.scheduled.has(geminiParent.id)) {
        requireResult(resolveGeminiAnalysisInput(input(context, node)), node)
      }
      const assets = requireResult(resolveWorkflowAssetsInput(input(context, node)), node)
      if (!assets.rawImages || assets.rawImages.length === 0) {
        throw new WorkflowGraphError(node.id, 'Cần kết nối với khối Ảnh Sản Phẩm và tải lên ít nhất 1 ảnh.')
      }
      const config = scriptConfig(context, node)
      if (!Number.isInteger(config.count) || config.count < 1) throw new WorkflowGraphError(node.id, 'Số lượng kịch bản yêu cầu phải là số nguyên dương.')
    },
    async execute(context, node) {
      const geminiParent = optionalParent(context, node, 'geminiAnalysis')
      const productAnalysis = geminiParent ? requireResult(resolveGeminiAnalysisInput(input(context, node)), node) : undefined
      const assets = requireResult(resolveWorkflowAssetsInput(input(context, node)), node)
      context.patch(node, { isGenerating: true, scriptError: null })
      const result = await context.dependencies.callGptScriptGeneration({
        productAnalysis, images: assets.rawImages, assets,
        scriptConfig: { ...scriptConfig(context, node), characterProfile: assets.characterProfile, sceneProfile: assets.sceneProfile },
        promptTemplate: String(node.data.prompt || ''),
        model: String(node.data.model || context.config.defaultScriptModel),
      })
      requireResult(resolveGptScriptsInput({
        nodes: [{ ...node, data: { ...node.data, salesScripts: result.scripts, scriptInputStale: false, isGenerating: false, scriptError: null } }],
        edges: [{ id: '__result__', source: node.id, target: '__consumer__' }], targetNodeId: '__consumer__',
      }), node)
      context.patch(node, {
        isGenerating: false, salesScripts: result.scripts, scriptCollection: result.collection,
        scriptError: null, scriptInputStale: false,
      })
    },
    failurePatch: (message) => ({ isGenerating: false, scriptError: message }),
  },
  veoFlowStudio: {
    preflight(context, node) {
      const parent = requiredParent(context, node, 'gptScript')
      if (!context.scheduled.has(parent.id)) {
        requireResult(resolveGptScriptsInput(input(context, node)), node)
        const data = parent.data as Record<string, any>
        if (isScriptCollectionStale(data.scriptCollection, {
          ...scriptConfig(context, parent), promptTemplate: data.prompt || '', model: data.model || context.config.defaultScriptModel,
        })) throw new WorkflowGraphError(node.id, 'Kịch bản ChatGPT đã cũ so với cấu hình mới. Vui lòng bấm tạo lại kịch bản.')
      }
      requireResult(resolveWorkflowAssetsInput(input(context, node)), node)
    },
    async execute(context, node) {
      const scripts = requireResult(resolveGptScriptsInput(input(context, node)), node)
      const assets = requireResult(resolveWorkflowAssetsInput(input(context, node)), node)
      const parent = requiredParent(context, node, 'gptScript')
      const data = node.data as Record<string, any>
      const scenes = context.dependencies.buildClipPlans({
        scripts,
        sceneConfig: {
          count: scripts.length,
          durations: scripts.map(() => flowDuration(context, node)),
          aspectRatio: data.videoConfig?.aspectRatio || data.aspectRatio || '9:16',
          storyMode: parent.data.storyMode === 'independent' ? 'independent' : 'sequential',
        },
        assets: assets.assets,
      })
      context.patch(node, { scenes, activeSceneIndex: 0, scriptSourceStale: false })
    },
  },
}

function requiredProduct(context: RunContext, node: Node) {
  requireResult(findSingleConnectedSourceNode({ ...input(context, node), expectedSourceType: 'productAssets' }), node)
  const assets = requireResult(resolveWorkflowAssetsInput(input(context, node)), node)
  if (!assets.rawImages.length) throw new WorkflowGraphError(node.id, 'Vui lòng tải lên ít nhất 1 ảnh sản phẩm vào khối Ảnh Sản Phẩm trước khi chạy phân tích.')
  return assets
}

export async function runRealWorkflow(params: {
  startNodeId: string
  nodes: Node[]
  edges: Edge[]
  callbacks: WorkflowRunCallbacks
  dependencies?: Partial<WorkflowRunnerDependencies>
  config?: Partial<WorkflowConfig>
}): Promise<void> {
  const { startNodeId, edges, callbacks } = params
  if (!params.nodes.some((node) => node.id === startNodeId)) throw new Error(`Không tìm thấy node khởi đầu: ${startNodeId}`)
  const dependencies = { ...defaultDependencies, ...params.dependencies }
  const nodes = params.nodes.map((node) => ({ ...node, data: { ...node.data } }))
  let activeId = startNodeId
  try {
    const ordered = getWorkflowExecutionOrder(nodes, edges, startNodeId)
    const context: RunContext = {
      nodes, edges, scheduled: new Set(ordered.map((node) => node.id)), dependencies,
      config: { ...dependencies.getWorkflowConfig(), ...params.config },
      patch(node, patch) {
        Object.assign(node.data, patch)
        callbacks.onNodeStateChange(node.id, patch)
      },
    }
    // Preflight every branch and external dependency before the first paid API call.
    for (const node of ordered) {
      activeId = node.id
      const handler = handlers[node.type as WorkflowStartType]
      if (!handler) throw new WorkflowGraphError(node.id, `Khối quy trình không được hỗ trợ khởi chạy: ${node.type}`)
      handler.preflight(context, node)
    }
    for (const node of ordered) {
      activeId = node.id
      await handlers[node.type as WorkflowStartType].execute(context, node)
    }
  } catch (error) {
    const nodeId = error instanceof WorkflowGraphError ? error.nodeId : activeId
    const message = error instanceof Error ? error.message : String(error)
    const node = nodes.find((candidate) => candidate.id === nodeId)
    const patch = node && handlers[node.type as WorkflowStartType]?.failurePatch?.(message)
    if (patch) callbacks.onNodeStateChange(nodeId, patch)
    callbacks.onError(nodeId, message)
    return
  }
  callbacks.onSuccess()
}
