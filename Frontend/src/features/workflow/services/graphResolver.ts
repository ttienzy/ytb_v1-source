/**
 * Graph Resolver Engine
 * Chịu trách nhiệm duyệt đồ thị React Flow (Nodes & Edges), trích xuất và validate dữ liệu
 * đầu vào cho từng Node dựa trên Data Contracts.
 * 
 * NGUYÊN TẮC:
 * - Không hardcode Node ID (như node-gemini, node-gpt, node-products).
 * - Kiểm tra đúng targetHandle và kiểu node nguồn (WorkflowNodeType).
 * - Trả về kết quả rõ ràng dạng Result { ok, data, error }.
 */

import type { Node, Edge } from '@xyflow/react'
import type { WorkflowNodeType } from '../types'
import type {
  AssetRef,
  AssetBundle,
  ProductAnalysis,
  SalesScript,
} from '../contracts'

export interface ResolveInputParams {
  nodes: Node[]
  edges: Edge[]
  targetNodeId: string
  targetHandle?: string
  expectedSourceType?: WorkflowNodeType
}

export interface ResolveResult<T> {
  ok: boolean
  data?: T
  error?: string
  sourceNodeId?: string
}

/**
 * Tìm tất cả các source nodes kết nối tới targetNodeId (có thể lọc theo targetHandle và expectedSourceType)
 */
export function findConnectedSourceNodes(params: ResolveInputParams): Node[] {
  const { nodes, edges, targetNodeId, targetHandle, expectedSourceType } = params

  const incomingEdges = edges.filter((e) => {
    if (e.target !== targetNodeId) return false
    if (targetHandle && e.targetHandle !== targetHandle) return false
    return true
  })

  const byId = new Map(nodes.map((node) => [node.id, node]))
  const sourceNodes: Node[] = []
  const seen = new Set<string>()
  for (const edge of incomingEdges) {
    const src = byId.get(edge.source)
    if (src && !seen.has(src.id)) {
      if (!expectedSourceType || src.type === expectedSourceType) {
        sourceNodes.push(src)
        seen.add(src.id)
      }
    }
  }

  return sourceNodes
}

/**
 * Tìm 1 source node duy nhất kết nối tới targetNodeId
 */
export function findSingleConnectedSourceNode(params: ResolveInputParams): ResolveResult<Node> {
  const sources = findConnectedSourceNodes(params)
  if (sources.length > 1) {
    return { ok: false, error: `Ambiguous ${params.expectedSourceType || ''} input: ${sources.map((node) => node.id).join(', ')}` }
  }
  if (sources.length === 0) {
    const handleInfo = params.targetHandle ? ` (cổng '${params.targetHandle}')` : ''
    const typeInfo = params.expectedSourceType ? ` kiểu '${params.expectedSourceType}'` : ''
    return {
      ok: false,
      error: `Chưa có dây nối${typeInfo} vào node này${handleInfo}.`,
    }
  }

  return {
    ok: true,
    data: sources[0],
    sourceNodeId: sources[0].id,
  }
}

/**
 * Trích xuất ảnh sản phẩm (Product Assets) cấp cho Gemini hoặc GPT hoặc Veo
 */
export function resolveProductAssetsInput(params: {
  nodes: Node[]
  edges: Edge[]
  targetNodeId: string
  targetHandle?: string
}): ResolveResult<{ assets: AssetRef[]; rawImages: string[] }> {
  const res = findSingleConnectedSourceNode({
    ...params,
    expectedSourceType: 'productAssets',
  })

  if (!res.ok || !res.data) {
    return { ok: false, error: res.error || 'Thiếu nguồn ảnh sản phẩm.' }
  }

  const nodeData = res.data.data as Record<string, any>
  const rawAssets = (nodeData.assets as (AssetRef | null)[]) || []
  const assets: AssetRef[] = rawAssets.filter((a): a is AssetRef => Boolean(a))
  const rawImages: string[] = ((nodeData.images as (string | null)[]) || []).filter(Boolean) as string[]

  if (assets.length === 0 && rawImages.length === 0) {
    return {
      ok: false,
      error: 'Khối Ảnh Sản Phẩm chưa có ảnh nào được tải lên.',
      sourceNodeId: res.sourceNodeId,
    }
  }

  return {
    ok: true,
    data: { assets, rawImages },
    sourceNodeId: res.sourceNodeId,
  }
}

/**
 * Trích xuất Nhân vật & Bối cảnh (Character & Scene)
 */
export function resolveCharacterSceneInput(params: {
  nodes: Node[]
  edges: Edge[]
  targetNodeId: string
  targetHandle?: string
}): ResolveResult<AssetBundle> {
  if (findConnectedSourceNodes({ ...params, expectedSourceType: 'characterScene' }).length === 0) {
    return { ok: true, data: { products: [] } }
  }
  const res = findSingleConnectedSourceNode({
    ...params,
    expectedSourceType: 'characterScene',
  })

  if (!res.ok || !res.data) {
    return {
      ok: false,
      error: res.error,
    }
  }

  const nodeData = res.data.data as Record<string, any>
  const modelAsset = (nodeData.modelAsset as AssetRef | null | undefined) || undefined
  const sceneAsset = (nodeData.sceneAsset as AssetRef | null | undefined) || undefined
  const modelUrl = nodeData.modelImage as string | null
  const sceneUrl = nodeData.sceneImage as string | null
  const characterProfile = (nodeData.characterProfile as string) || undefined
  const sceneProfile = (nodeData.sceneProfile as string) || undefined

  const bundle: AssetBundle = {
    products: [],
    model: modelAsset
      ? modelAsset
      : modelUrl
      ? {
          id: `${res.sourceNodeId}-model-asset`,
          kind: 'model',
          previewUrl: modelUrl,
          uploadStatus: 'idle',
        }
      : undefined,
    scene: sceneAsset
      ? sceneAsset
      : sceneUrl
      ? {
          id: `${res.sourceNodeId}-scene-asset`,
          kind: 'scene',
          previewUrl: sceneUrl,
          uploadStatus: 'idle',
        }
      : undefined,
    characterProfile,
    sceneProfile,
  }

  return {
    ok: true,
    data: bundle,
    sourceNodeId: res.sourceNodeId,
  }
}

/**
 * Trích xuất kết quả phân tích sản phẩm từ Gemini
 */
export function resolveGeminiAnalysisInput(params: {
  nodes: Node[]
  edges: Edge[]
  targetNodeId: string
  targetHandle?: string
}): ResolveResult<ProductAnalysis> {
  const res = findSingleConnectedSourceNode({
    ...params,
    expectedSourceType: 'geminiAnalysis',
  })

  if (!res.ok || !res.data) {
    return {
      ok: false,
      error: res.error || 'Node này cần được nối dây với một khối Gemini Vision Phân Tích.',
    }
  }

  const nodeData = res.data.data as Record<string, any>
  const analysisResult = nodeData.analysisResult

  if (!analysisResult || nodeData.isAnalyzing || nodeData.analysisError) {
    return {
      ok: false,
      error: 'Khối Gemini Vision chưa hoàn thành phân tích sản phẩm.',
      sourceNodeId: res.sourceNodeId,
    }
  }

  // Chuẩn hóa sang ProductAnalysis contract
  let analysis: ProductAnalysis
  if (typeof analysisResult === 'string') {
    analysis = {
      rawText: analysisResult,
      features: [analysisResult],
      sellingPoints: [],
      suggestedAngles: [],
    }
  } else {
    analysis = {
      rawText: analysisResult.rawText || analysisResult.raw_text || analysisResult.productFeatures || '',
      features: analysisResult.features || (analysisResult.productFeatures ? [analysisResult.productFeatures] : []),
      sellingPoints: analysisResult.sellingPoints || analysisResult.keySellingPoints || analysisResult.key_selling_points || [],
      suggestedAngles: analysisResult.suggestedAngles || analysisResult.suggested_angles || [],
      classifications: analysisResult.classifications,
      modelAttributes: analysisResult.modelAttributes,
      sceneVibe: analysisResult.sceneVibe,
      providerUsed: analysisResult.providerUsed || nodeData.providerUsed,
    }
  }

  if (!analysis.rawText.trim() && ![analysis.features, analysis.sellingPoints, analysis.suggestedAngles]
    .some((values) => Array.isArray(values) && values.some((value) => typeof value === 'string' && value.trim()))) {
    return { ok: false, error: 'Gemini analysis output is empty or invalid.', sourceNodeId: res.sourceNodeId }
  }

  return {
    ok: true,
    data: analysis,
    sourceNodeId: res.sourceNodeId,
  }
}

/**
 * Trích xuất kịch bản từ ChatGPT
 */
export function resolveGptScriptsInput(params: {
  nodes: Node[]
  edges: Edge[]
  targetNodeId: string
  targetHandle?: string
}): ResolveResult<SalesScript[]> {
  const res = findSingleConnectedSourceNode({
    ...params,
    expectedSourceType: 'gptScript',
  })

  if (!res.ok || !res.data) {
    return {
      ok: false,
      error: res.error || 'Chưa có dây nối từ khối ChatGPT Kịch Bản sang.',
    }
  }

  const nodeData = res.data.data as Record<string, any>
  if (nodeData.scriptInputStale === true || nodeData.isGenerating || nodeData.scriptError) {
    return { ok: false, error: 'GPT scripts are stale, pending, or failed. Generate scripts again.', sourceNodeId: res.sourceNodeId }
  }
  const rawScripts = (nodeData.salesScripts as any[]) || []

  if (!Array.isArray(rawScripts) || rawScripts.length === 0 || rawScripts.some((script) =>
    !script || ![script.content, script.voiceover, script.voice_over, script.visualDirection, script.visual_direction]
      .some((value) => typeof value === 'string' && value.trim()),
  )) {
    return {
      ok: false,
      error: 'Khối ChatGPT chưa sinh kịch bản bán hàng nào.',
      sourceNodeId: res.sourceNodeId,
    }
  }

  // Chuẩn hóa dữ liệu sang camelCase SalesScript duy nhất
  const salesScripts: SalesScript[] = rawScripts.map((s: any, idx: number) => ({
    id: s.id || `script-${idx + 1}`,
    phase: s.phase,
    angle: s.angle || `Góc ${idx + 1}`,
    title: s.title || `Kịch bản ${idx + 1}`,
    content: s.content || s.voiceover || s.voice_over || '',
    voiceover: s.voiceover || s.voice_over || undefined,
    visualDirection: s.visualDirection || s.visual_direction || s.visual || undefined,
    onScreenText: s.onScreenText || s.on_screen_text || undefined,
    hook: s.hook,
    problem: s.problem,
    product: s.product,
    benefits: s.benefits,
    cta: s.cta,
    wordCount: s.wordCount ?? s.word_count,
  }))

  return {
    ok: true,
    data: salesScripts,
    sourceNodeId: res.sourceNodeId,
  }
}

export interface WorkflowAssetsInput extends AssetBundle {
  assets: AssetRef[]
  rawImages: string[]
}

export interface RenderAssetsInput extends WorkflowAssetsInput {
  referenceImagePaths: string[]
}

/**
 * Resolve each asset source type independently. A direct source (even empty) overrides
 * inherited sources of that type. Shared ancestors are deduplicated by node ID.
 * Planning may retain pending assets; rendering must use resolveRenderAssetsInput.
 */
export function resolveWorkflowAssetsInput(params: ResolveInputParams): ResolveResult<WorkflowAssetsInput> {
  const { nodes, edges, targetNodeId } = params
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const incoming = new Map<string, Set<string>>()
  for (const edge of edges) {
    const parents = incoming.get(edge.target) ?? new Set<string>()
    parents.add(edge.source)
    incoming.set(edge.target, parents)
  }
  const memo = new Map<string, Map<string, Node>>()
  const visiting = new Set<string>()
  function sources(id: string, type: 'productAssets' | 'characterScene'): Map<string, Node> {
    const key = `${type}:${id}`
    if (visiting.has(key)) throw new Error(`Cycle in asset inputs at ${id}`)
    const cached = memo.get(key)
    if (cached) return cached
    const node = byId.get(id)
    if (!node) throw new Error(`Dangling asset input: ${id}`)
    if (node.type === type) return new Map([[id, node]])
    visiting.add(key)
    const parents = [...(incoming.get(id) ?? [])].map((parentId) => {
      const parent = byId.get(parentId)
      if (!parent) throw new Error(`Dangling asset input: ${parentId} -> ${id}`)
      return parent
    })
    const direct = parents.filter((parent) => parent.type === type)
    const found = new Map<string, Node>()
    if (direct.length) {
      for (const parent of direct) found.set(parent.id, parent)
    } else {
      for (const parent of parents) {
        for (const [sourceId, source] of sources(parent.id, type)) found.set(sourceId, source)
      }
    }
    if (found.size > 1) throw new Error(`Ambiguous ${type} input on ${id}: ${[...found.keys()].sort().join(', ')}`)
    visiting.delete(key)
    memo.set(key, found)
    return found
  }

  try {
    const product = [...sources(targetNodeId, 'productAssets').values()][0]
    const character = [...sources(targetNodeId, 'characterScene').values()][0]
    const bundle: WorkflowAssetsInput = { products: [], assets: [], rawImages: [] }
    if (product) {
      const data = product.data as Record<string, any>
      const images: (string | null)[] = Array.isArray(data.images) ? data.images : []
      const assets: (AssetRef | null)[] = Array.isArray(data.assets) ? data.assets : []
      for (let index = 0; index < Math.max(images.length, assets.length); index++) {
        const asset = assets[index]
        const image = images[index]
        if (asset) bundle.products.push(asset)
        else if (image) bundle.products.push({
          id: `${product.id}-product-${index}`, kind: 'product', previewUrl: image, uploadStatus: 'idle',
        })
        const raw = image || asset?.previewUrl
        if (raw) bundle.rawImages.push(raw)
      }
    }
    if (character) {
      // Use the same normalization as direct GPT inputs, without inventing an upload success.
      const result = resolveCharacterSceneInput({
        nodes: [character],
        edges: [{ id: '__asset_input__', source: character.id, target: '__target__' }],
        targetNodeId: '__target__',
      })
      Object.assign(bundle, result.data, { products: bundle.products })
    }
    const all = [...bundle.products, ...(bundle.model ? [bundle.model] : []), ...(bundle.scene ? [bundle.scene] : [])]
    bundle.assets = [...new Map(all.map((asset) => [asset.id, asset])).values()]
    bundle.rawImages = [...new Set(bundle.rawImages)]
    return { ok: true, data: bundle }
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) }
  }
}

/** A selected image must finish uploading; text-only is valid only with no selected images. */
export function resolveRenderAssetsInput(params: ResolveInputParams): ResolveResult<RenderAssetsInput> {
  const result = resolveWorkflowAssetsInput(params)
  if (!result.ok || !result.data) return { ok: false, error: result.error }
  const invalid = result.data.assets.find((asset) => asset.uploadStatus !== 'uploaded' || !asset.backendPath?.trim())
  if (invalid) {
    return {
      ok: false,
      error: `Asset ${invalid.fileName || invalid.id} is not ready for rendering (${invalid.uploadStatus || 'pending'}): ${invalid.error || 'upload required with a backendPath'}`,
    }
  }
  return {
    ok: true,
    data: { ...result.data, referenceImagePaths: [...new Set(result.data.assets.map((asset) => asset.backendPath!))] },
  }
}
