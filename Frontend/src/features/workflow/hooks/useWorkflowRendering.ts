import { useCallback, useEffect, useRef, type MutableRefObject, type SetStateAction } from 'react'
import type { Edge, Node } from '@xyflow/react'
import type { VeoProject } from '../../veo-studio/types'
import * as veoApi from '../../veo-studio/services/veoApi'
import type { GeneratedSceneItem, VeoVideoConfig } from '../types'
import { RenderJobController } from '../services/renderJobService.ts'
import { resolveWorkflowAssetsInput } from '../services/graphResolver'
import { prepareChainedScene } from '../services/prepareChainedScene.ts'
import { stopWorkflowRender } from '../services/workflowRenderState.ts'
import { clearSceneOutput } from '../services/workflowState.ts'

export function useWorkflowRendering(options: {
  nodesRef: MutableRefObject<Node[]>
  edges: Edge[]
  project: VeoProject | null
  config: VeoVideoConfig
  ready: boolean
  setNodes: (update: SetStateAction<Node[]>) => void
  captureRevision: (id: string) => () => boolean
  onCompleted: () => void
}) {
  const active = useRef(new Map<string, RenderJobController | null>())
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      active.current.forEach(controller => controller?.cancel())
      active.current.clear()
    }
  }, [])

  const render = useCallback(async (nodeId: string, sceneIndex?: number) => {
    if (!options.ready || active.current.has(nodeId)) return
    active.current.set(nodeId, null)
    options.setNodes(nodes => nodes.map(node => node.id === nodeId
      ? { ...node, data: { ...node.data, renderError: null } } : node))
    const readNode = () => options.nodesRef.current.find(node => node.id === nodeId)
    const readScenes = () => (readNode()?.data.scenes as GeneratedSceneItem[]) || []
    const updateScene = (index: number, patch: Partial<GeneratedSceneItem>) => options.setNodes(nodes =>
      nodes.map(node => node.id === nodeId ? { ...node, data: { ...node.data,
        scenes: ((node.data.scenes as GeneratedSceneItem[]) || []).map((scene, i) => i === index ? { ...scene, ...patch } : scene),
      } } : node))
    try {
      if (!options.project) throw new Error('Hãy chọn dự án trong Cấu hình Veo trước khi render.')
      if (readNode()?.data.scriptSourceStale) throw new Error('Đầu vào đã thay đổi. Hãy sinh và đồng bộ lại kịch bản trước khi render.')
      const assets = resolveWorkflowAssetsInput({ nodes: options.nodesRef.current, edges: options.edges, targetNodeId: nodeId })
      if (!assets.ok || !assets.data) throw new Error(assets.error || 'Ảnh tham chiếu chưa sẵn sàng.')
      const indices = sceneIndex === undefined ? readScenes().map((_, i) => i) : [sceneIndex]
      if (!indices.length) throw new Error('Chưa có clip để render.')
      let stillCurrent = options.captureRevision(nodeId)
      const allDone = sceneIndex === undefined && readScenes().every(scene => scene.videoUrl || scene.outputFilePath)
      if (allDone) {
        if (!window.confirm('Các clip đã hoàn tất. Render lại toàn bộ sẽ tạo job mới. Tiếp tục?')) return
        options.setNodes(nodes => nodes.map(node => node.id === nodeId ? { ...node, data: { ...node.data,
          scenes: readScenes().map(scene => clearSceneOutput(scene, true)),
        } } : node))
        stillCurrent = options.captureRevision(nodeId)
      }
      for (const index of indices) {
        if (!mounted.current || !stillCurrent()) throw new Error('Đầu vào đã thay đổi; đã dừng nhận kết quả cũ.')
        let scene = readScenes()[index]
        if (!scene) throw new Error('Clip không còn tồn tại.')
        if (sceneIndex === undefined && (scene.videoUrl || scene.outputFilePath)) continue
        if (!scene.prompt.trim()) throw new Error(`Clip #${index + 1} chưa có prompt.`)
        options.setNodes(nodes => nodes.map(node => node.id === nodeId ? { ...node, data: { ...node.data, activeSceneIndex: index } } : node))
        scene = await prepareChainedScene(scene, index, readScenes()[index - 1], veoApi.extractLastFrame, veoApi.getImageFileUrl)
        if (!mounted.current || !stillCurrent()) throw new Error('Đầu vào đã thay đổi trong lúc lấy khung hình.')
        updateScene(index, { startFramePath: scene.startFramePath, startFramePreviewUrl: scene.startFramePreviewUrl, jobId: scene.jobId })
        stillCurrent = options.captureRevision(nodeId)
        const controller = new RenderJobController()
        active.current.set(nodeId, controller)
        updateScene(index, { isRendering: true, renderProgress: 15, renderStep: 'Đang chuẩn bị render...', errorMessage: null })
        const result = await controller.renderScene({
          scene: { ...scene, referenceAssets: assets.data.assets, jobId: scene.videoUrl || scene.outputFilePath ? null : scene.jobId },
          project: options.project,
          videoConfig: (readNode()?.data.videoConfig as VeoVideoConfig) || options.config,
          referenceAssets: assets.data.assets,
          onSubmitted: jobId => {
            if (mounted.current && stillCurrent()) updateScene(index, { jobId })
          },
          onProgress: (progress, step) => {
            if (mounted.current && stillCurrent()) updateScene(index, { renderProgress: progress, renderStep: step || null })
            else controller.cancel()
          },
        })
        if (!mounted.current || !stillCurrent()) throw new Error('Đầu vào đã thay đổi; kết quả cũ không được gắn vào clip mới.')
        updateScene(index, { isRendering: false, renderProgress: result.ok ? 100 : 0,
          renderStep: result.ok ? 'Hoàn tất' : null, renderStatus: result.ok ? 'done' : 'error',
          jobId: result.jobId || null, videoUrl: result.videoUrl || null,
          outputFilePath: result.outputFilePath || null, errorMessage: result.error || null })
        if (!result.ok) throw new Error(result.error)
        stillCurrent = options.captureRevision(nodeId)
        options.onCompleted()
      }
    } catch (error) {
      if (mounted.current) {
        const message = error instanceof Error ? error.message : 'Không thể render clip.'
        // A blocking alert prevents React from painting the stopped state.
        // Release every spinner owned by this node, including revision/extraction failures.
        options.setNodes(nodes => nodes.map(node => node.id === nodeId ? stopWorkflowRender(node, message) : node))
      }
    } finally {
      active.current.delete(nodeId)
    }
  }, [options])

  return {
    handleRenderFlowScene: (nodeId: string, index: number) => render(nodeId, index),
    handleRenderAllFlowScenes: (nodeId: string) => render(nodeId),
  }
}
