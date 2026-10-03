import type { Node } from '@xyflow/react'
import type { GeneratedSceneItem } from '../types'

/** Release UI ownership without discarding an in-flight job or completed clips. */
export function stopWorkflowRender(node: Node, message: string): Node {
  return { ...node, data: {
    ...node.data, isRendering: false, renderError: message,
    scenes: ((node.data.scenes as GeneratedSceneItem[]) || []).map(scene => scene.isRendering
      ? { ...scene, isRendering: false, renderProgress: 0, renderStep: null } : scene),
  } }
}
