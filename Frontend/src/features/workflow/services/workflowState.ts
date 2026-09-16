import type { Edge, Node } from '@xyflow/react'
import type { GeneratedSceneItem } from '../types'

const INPUT_FIELDS: Record<string, string[]> = {
  productAssets: ['images', 'assets'],
  characterScene: ['modelImage', 'sceneImage', 'modelAsset', 'sceneAsset', 'characterProfile', 'sceneProfile'],
  geminiAnalysis: ['prompt', 'analysisProvider'],
  gptScript: ['prompt', 'model', 'requestedCount', 'contentMode', 'platform', 'storyMode', 'voiceId'],
}
const RENDER_FIELDS = ['model', 'aspectRatio', 'duration', 'resolution', 'variations']
const AUDIO_FIELDS = ['voiceEnabled', 'voiceId', 'bgmEnabled', 'bgmTrackIds', 'bgmVolume', 'keepVeoAmbient', 'veoAmbientVolume']
const SCENE_FIELDS = ['prompt', 'durationSec', 'aspectRatio', 'cameraMotion', 'chainFromPrevious', 'voiceover']
const changed = (a: Record<string, any>, b: Record<string, any>, keys: string[]) =>
  keys.some(key => JSON.stringify(a[key]) !== JSON.stringify(b[key]))

export const clearedExport = { finalVideoUrl: null, exportProgress: 0, isExporting: false }
export const clearedAudio = {
  ...clearedExport,
  voiceoverUrl: null,
  voiceoverFilePath: null,
  voiceoverDurationSec: 0,
  voiceoverSignature: null,
  isGeneratingVoiceover: false,
}

export function clearSceneOutput<T extends GeneratedSceneItem>(scene: T, clearFrame = false): T {
  return { ...scene, videoUrl: null, outputFilePath: null, thumbnailUrl: null, jobId: null,
    renderProgress: 0, renderStep: null, renderStatus: 'idle', errorMessage: null, isRendering: false,
    ...(clearFrame ? { startFramePath: null, startFramePreviewUrl: null } : {}) }
}

/** Invalidate only the dependent chain; independent clips keep their output. */
export function invalidateSceneChain<T extends GeneratedSceneItem>(scenes: T[], index: number): T[] {
  let dependent = true
  return scenes.map((scene, i) => {
    if (i < index) return scene
    if (i > index && scene.chainFromPrevious === false) dependent = false
    return dependent ? clearSceneOutput(scene, i > index) : scene
  })
}

function invalidateNode(node: Node): Node {
  let data: Record<string, any> = { ...node.data, inputRevision: Number(node.data.inputRevision || 0) + 1 }
  if (node.type === 'geminiAnalysis') data = { ...data, analysisResult: null, isAnalyzing: false }
  if (node.type === 'gptScript') data = { ...data, scriptInputStale: true, isGenerating: false }
  if (node.type === 'veoFlowStudio') data = { ...data, ...clearedAudio, scriptSourceStale: true,
    scenes: ((data.scenes as GeneratedSceneItem[]) || []).map(scene => clearSceneOutput(scene, true)) }
  if (node.type === 'exportTimeline') data = { ...data, ...clearedExport }
  if (node.type === 'sceneVideo') data = { ...data, videoUrl: null, outputFilePath: null, thumbnailUrl: null, isRendering: false, renderProgress: 0 }
  return { ...node, data }
}

/** All node writes pass through this pure boundary, including updates from async services. */
export function reconcileWorkflowNodes(previous: Node[], next: Node[], edges: Edge[]): Node[] {
  const old = new Map(previous.map(node => [node.id, node]))
  const roots = new Set<string>()
  let result = next.map(node => {
    const before = old.get(node.id)
    if (!before || before.data === node.data) return node
    let data = node.data
    if (changed(before.data, data, INPUT_FIELDS[node.type || ''] || [])) {
      roots.add(node.id)
      data = invalidateNode({ ...node, data }).data
    }
    if ((node.type === 'geminiAnalysis' && before.data.analysisResult !== data.analysisResult) ||
        (node.type === 'gptScript' && before.data.salesScripts !== data.salesScripts)) roots.add(node.id)
    if (node.type === 'gptScript' && before.data.salesScripts !== data.salesScripts) data = { ...data, scriptInputStale: false }
    if (node.type === 'veoFlowStudio') {
      const beforeScenes = (before.data.scenes as GeneratedSceneItem[]) || []
      let scenes = (data.scenes as GeneratedSceneItem[]) || []
      const renderChanged = changed((before.data.videoConfig as any) || {}, (data.videoConfig as any) || {}, RENDER_FIELDS)
      const audioChanged = changed((before.data.videoConfig as any) || {}, (data.videoConfig as any) || {}, AUDIO_FIELDS)
      let inputsChanged = renderChanged
      let outputsChanged = false
      for (let i = 0; i < scenes.length; i++) {
        const prev = beforeScenes[i]
        if (!prev) continue
        if (changed(prev, scenes[i], SCENE_FIELDS)) {
          scenes = invalidateSceneChain(scenes, i)
          inputsChanged = true
        } else if ((prev.outputFilePath || prev.videoUrl) !== (scenes[i].outputFilePath || scenes[i].videoUrl)) {
          outputsChanged = true
          if (scenes[i + 1]?.chainFromPrevious !== false && scenes[i + 1]) {
            scenes = invalidateSceneChain(scenes, i + 1)
            scenes[i + 1] = { ...scenes[i + 1], startFramePath: null, startFramePreviewUrl: null }
          }
        }
      }
      if (renderChanged) scenes = scenes.map(scene => clearSceneOutput(scene, true))
      if (inputsChanged || audioChanged || outputsChanged || beforeScenes.length !== scenes.length) {
        data = { ...data, ...clearedAudio, scenes,
          inputRevision: Number(before.data.inputRevision || 0) + (inputsChanged || audioChanged || outputsChanged ? 1 : 0) }
      }
    }
    return data === node.data ? node : { ...node, data }
  })
  const invalid = new Set<string>()
  const queue = [...roots]
  while (queue.length) {
    const source = queue.shift()!
    for (const edge of edges) {
      if (edge.source !== source || invalid.has(edge.target) || roots.has(edge.target)) continue
      invalid.add(edge.target)
      queue.push(edge.target)
    }
  }
  result = result.map(node => {
    if (!invalid.has(node.id)) return node
    const before = old.get(node.id)
    // A transaction may publish both new scripts and their new plans.
    const fresh = node.type === 'gptScript' ? before?.data.salesScripts !== node.data.salesScripts
      : node.type === 'veoFlowStudio' ? before?.data.scenes !== next.find(item => item.id === node.id)?.data.scenes
      : before?.data.analysisResult !== node.data.analysisResult
    return fresh ? node : invalidateNode(node)
  })
  return result
}

export function invalidateGraphTargets(nodes: Node[], edges: Edge[], targets: string[]): Node[] {
  const affected = new Set(targets)
  const queue = [...targets]
  while (queue.length) {
    const source = queue.shift()!
    for (const edge of edges) if (edge.source === source && !affected.has(edge.target)) {
      affected.add(edge.target)
      queue.push(edge.target)
    }
  }
  return nodes.map(node => affected.has(node.id) ? invalidateNode(node) : node)
}
