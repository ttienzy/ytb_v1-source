/**
 * Production Workflow Orchestrator (DAG Runner)
 * Duyệt đồ thị từ startNodeId, điều phối tuần tự qua các Service thật (Gemini -> GPT -> Veo)
 * KHÔNG sử dụng mock hay fake timeouts.
 */

import type { Node, Edge } from '@xyflow/react'
import {
  resolveProductAssetsInput,
  resolveCharacterSceneInput,
  resolveGeminiAnalysisInput,
  findConnectedSourceNodes,
} from './graphResolver'
import { callGeminiAnalysis, callGptScriptGeneration } from './workflowApi'
import { buildClipPlans, normalizeClipDuration } from './buildScenePlan'
import type { AssetRef, ProductAnalysis, SalesScript } from '../contracts'

export interface WorkflowRunCallbacks {
  onNodeStateChange: (nodeId: string, patch: Record<string, any>) => void
  onError: (nodeId: string, error: string) => void
  onSuccess: () => void
}

export async function runRealWorkflow(params: {
  startNodeId: string
  nodes: Node[]
  edges: Edge[]
  callbacks: WorkflowRunCallbacks
}): Promise<void> {
  const { startNodeId, nodes, edges, callbacks } = params

  const startNode = nodes.find((n) => n.id === startNodeId)
  if (!startNode) {
    throw new Error(`Không tìm thấy node bắt đầu với ID: ${startNodeId}`)
  }

  // Xác định node bắt đầu và kiểm tra quan hệ theo DAG
  let geminiNode: Node | undefined

  if (startNode.type === 'geminiAnalysis') {
    geminiNode = startNode
  } else if (startNode.type === 'productAssets') {
    // Tìm node Gemini được nối dây từ productAssets
    const outEdges = edges.filter((e) => e.source === startNode.id)
    geminiNode = nodes.find((n) => outEdges.some((e) => e.target === n.id && n.type === 'geminiAnalysis'))

    if (!geminiNode) {
      const errMsg = 'Khối [Ảnh Sản Phẩm] này chưa được nối dây tới khối Gemini Vision nào trong sơ đồ.'
      callbacks.onError(startNode.id, errMsg)
      return
    }
  } else if (startNode.type === 'gptScript') {
    // Chạy từ GPT node trực tiếp nếu Gemini đã phân tích
    const geminiInput = resolveGeminiAnalysisInput({ nodes, edges, targetNodeId: startNode.id })
    if (!geminiInput.ok || !geminiInput.data) {
      const errMsg = geminiInput.error || 'Khối ChatGPT cần được nối dây và nhận kết quả phân tích từ Gemini Vision.'
      callbacks.onError(startNode.id, errMsg)
      return
    }
    // Thực thi trực tiếp bước GPT
    return executeGptAndDownstream({
      gptNode: startNode,
      analysisResult: geminiInput.data,
      nodes,
      edges,
      callbacks,
    })
  } else {
    callbacks.onError(startNode.id, `Loại node '${startNode.type}' hiện không hỗ trợ làm điểm bắt đầu chạy tự động.`)
    return
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BƯỚC 1: Phân tích sản phẩm qua Gemini Vision
  // ──────────────────────────────────────────────────────────────────────────
  callbacks.onNodeStateChange(geminiNode.id, { isAnalyzing: true, analysisError: null })

  const productRes = resolveProductAssetsInput({
    nodes,
    edges,
    targetNodeId: geminiNode.id,
  })

  if (!productRes.ok || !productRes.data) {
    const errMsg = productRes.error || 'Thiếu ảnh sản phẩm hợp lệ để phân tích.'
    callbacks.onNodeStateChange(geminiNode.id, { isAnalyzing: false, analysisError: errMsg })
    callbacks.onError(geminiNode.id, errMsg)
    return
  }

  const validImages = productRes.data.rawImages.filter(Boolean)
  if (validImages.length === 0) {
    const errMsg = 'Vui lòng tải ít nhất 1 ảnh sản phẩm vào khối Ảnh Sản Phẩm.'
    callbacks.onNodeStateChange(geminiNode.id, { isAnalyzing: false, analysisError: errMsg })
    callbacks.onError(geminiNode.id, errMsg)
    return
  }

  const geminiPrompt = (geminiNode.data?.prompt as string) || ''
  let analysisResult: ProductAnalysis

  try {
    analysisResult = await callGeminiAnalysis(validImages, geminiPrompt)
    callbacks.onNodeStateChange(geminiNode.id, {
      isAnalyzing: false,
      analysisResult,
      analysisError: null,
    })
  } catch (err: any) {
    const errMsg = err?.message || 'Lỗi không xác định khi phân tích bằng Gemini.'
    callbacks.onNodeStateChange(geminiNode.id, { isAnalyzing: false, analysisError: errMsg })
    callbacks.onError(geminiNode.id, errMsg)
    return
  }

  // Cập nhật bản sao nodes trong bộ nhớ để bước tiếp theo đọc được kết quả Gemini vừa xong
  const currentNodes = nodes.map((n) =>
    n.id === geminiNode!.id ? { ...n, data: { ...n.data, analysisResult } } : n
  )

  // ──────────────────────────────────────────────────────────────────────────
  // BƯỚC 2: Duyệt theo cạnh nối từ Gemini sang GPT (DAG traversal)
  // ──────────────────────────────────────────────────────────────────────────
  const gptEdges = edges.filter((e) => e.source === geminiNode!.id)
  const gptNode = currentNodes.find((n) => gptEdges.some((e) => e.target === n.id && n.type === 'gptScript'))

  if (!gptNode) {
    // Kết thúc hợp lệ nếu quy trình chỉ dừng ở phân tích Gemini
    callbacks.onSuccess()
    return
  }

  await executeGptAndDownstream({
    gptNode,
    analysisResult,
    nodes: currentNodes,
    edges,
    callbacks,
    productImages: validImages,
    productAssets: productRes.data.assets,
  })
}

async function executeGptAndDownstream(params: {
  gptNode: Node
  analysisResult: ProductAnalysis
  nodes: Node[]
  edges: Edge[]
  callbacks: WorkflowRunCallbacks
  productImages?: string[]
  productAssets?: AssetRef[]
}): Promise<void> {
  const { gptNode, analysisResult, nodes, edges, callbacks } = params

  callbacks.onNodeStateChange(gptNode.id, { isGenerating: true, scriptError: null })

  const charSceneRes = resolveCharacterSceneInput({
    nodes,
    edges,
    targetNodeId: gptNode.id,
  })

  const prodRes = resolveProductAssetsInput({
    nodes,
    edges,
    targetNodeId: gptNode.id,
  })
  const validImages = params.productImages || (prodRes.ok && prodRes.data ? prodRes.data.rawImages : [])
  const productAssets = params.productAssets || (prodRes.ok && prodRes.data ? prodRes.data.assets : [])

  const gptPromptTemplate = (gptNode.data?.prompt as string) || ''
  const gptModel = (gptNode.data?.model as string) || 'cx/gpt-5.5'
  const gptData = (gptNode.data || {}) as Record<string, any>
  const scriptCount = typeof gptData.requestedCount === 'number' ? gptData.requestedCount : 3
  const scriptMode = gptData.contentMode || 'sales'
  const platform = gptData.platform || 'auto'
  const flowEdges = edges.filter((e) => e.source === gptNode.id)
  const flowStudioNode = nodes.find((n) => flowEdges.some((e) => e.target === n.id && n.type === 'veoFlowStudio'))
  const flowData = (flowStudioNode?.data || {}) as Record<string, any>
  const clipDurationSeconds = normalizeClipDuration(
    flowData.videoConfig?.duration ?? flowData.scenes?.[0]?.durationSec,
  )
  let salesScripts: SalesScript[] = []

  try {
    const gptRes = await callGptScriptGeneration({
      images: validImages,
      productAnalysis: analysisResult,
      assets: charSceneRes.data,
      scriptConfig: {
        count: scriptCount,
        contentMode: scriptMode,
        platform,
        clipDurationSeconds,
      },
      promptTemplate: gptPromptTemplate,
      model: gptModel,
    })

    salesScripts = gptRes.scripts
    callbacks.onNodeStateChange(gptNode.id, {
      isGenerating: false,
      salesScripts,
      scriptCollection: gptRes.collection,
      scriptError: null,
    })
  } catch (err: any) {
    const errMsg = err?.message || 'Lỗi khi tạo kịch bản bán hàng bằng ChatGPT.'
    callbacks.onNodeStateChange(gptNode.id, { isGenerating: false, scriptError: errMsg })
    callbacks.onError(gptNode.id, errMsg)
    return
  }

  // ──────────────────────────────────────────────────────────────────────────
  // BƯỚC 3: Duyệt theo cạnh nối từ GPT sang Veo Flow Studio (DAG traversal)
  // ──────────────────────────────────────────────────────────────────────────
  if (flowStudioNode && salesScripts.length > 0) {
    const allAssets: AssetRef[] = [
      ...productAssets,
      ...(charSceneRes.data?.model ? [charSceneRes.data.model] : []),
      ...(charSceneRes.data?.scene ? [charSceneRes.data.scene] : []),
    ]

    try {
      const targetCount = salesScripts.length
      const clipDurations = Array.from({ length: targetCount }, () => clipDurationSeconds)
      const newClips = buildClipPlans({
        scripts: salesScripts,
        sceneConfig: {
          count: targetCount,
          durations: clipDurations,
          aspectRatio: flowData.aspectRatio || '9:16',
        },
        assets: allAssets,
      })

      callbacks.onNodeStateChange(flowStudioNode.id, {
        scenes: newClips,
        activeSceneIndex: 0,
      })
    } catch (err: any) {
      callbacks.onError(flowStudioNode.id, err?.message || 'Lỗi phân phối clip sang Google Flow.')
      return
    }
  }

  callbacks.onSuccess()
}
