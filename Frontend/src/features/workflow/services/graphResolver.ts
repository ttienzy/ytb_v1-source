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
    if (targetHandle && e.targetHandle && e.targetHandle !== targetHandle) return false
    return true
  })

  const sourceNodes: Node[] = []
  for (const edge of incomingEdges) {
    const src = nodes.find((n) => n.id === edge.source)
    if (src) {
      if (!expectedSourceType || src.type === expectedSourceType) {
        sourceNodes.push(src)
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
  const assets: AssetRef[] = rawAssets.filter((a): a is AssetRef => Boolean(a && (a.backendPath || a.previewUrl)))
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
  const res = findSingleConnectedSourceNode({
    ...params,
    expectedSourceType: 'characterScene',
  })

  if (!res.ok || !res.data) {
    return {
      ok: true,
      data: { products: [] }, // Bối cảnh/nhân vật là tùy chọn, không báo lỗi cứng
    }
  }

  const nodeData = res.data.data as Record<string, any>
  const modelAsset = (nodeData.modelAsset as AssetRef | null | undefined) || undefined
  const sceneAsset = (nodeData.sceneAsset as AssetRef | null | undefined) || undefined
  const modelUrl = nodeData.modelImage as string | null
  const sceneUrl = nodeData.sceneImage as string | null

  const bundle: AssetBundle = {
    products: [],
    model: modelAsset
      ? modelAsset
      : modelUrl
      ? {
          id: 'model-asset',
          kind: 'model',
          previewUrl: modelUrl,
          uploadStatus: 'uploaded',
        }
      : undefined,
    scene: sceneAsset
      ? sceneAsset
      : sceneUrl
      ? {
          id: 'scene-asset',
          kind: 'scene',
          previewUrl: sceneUrl,
          uploadStatus: 'uploaded',
        }
      : undefined,
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
      error: 'Node này cần được nối dây với một khối Gemini Vision Phân Tích.',
    }
  }

  const nodeData = res.data.data as Record<string, any>
  const analysisResult = nodeData.analysisResult

  if (!analysisResult) {
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
      rawText: analysisResult.raw_text || analysisResult.productFeatures || '',
      features: analysisResult.features || (analysisResult.productFeatures ? [analysisResult.productFeatures] : []),
      sellingPoints: analysisResult.keySellingPoints || [],
      suggestedAngles: analysisResult.suggestedAngles || [],
      classifications: analysisResult.classifications,
      modelAttributes: analysisResult.modelAttributes,
      sceneVibe: analysisResult.sceneVibe,
    }
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
      error: 'Chưa có dây nối từ khối ChatGPT Kịch Bản sang.',
    }
  }

  const nodeData = res.data.data as Record<string, any>
  const rawScripts = (nodeData.salesScripts as any[]) || []

  if (rawScripts.length === 0) {
    return {
      ok: false,
      error: 'Khối ChatGPT chưa sinh kịch bản bán hàng nào.',
      sourceNodeId: res.sourceNodeId,
    }
  }

  // Chuẩn hóa dữ liệu sang camelCase SalesScript duy nhất
  const salesScripts: SalesScript[] = rawScripts.map((s: any, idx: number) => ({
    id: s.id || `script-${idx + 1}`,
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
