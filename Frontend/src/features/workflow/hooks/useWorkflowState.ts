import { useCallback, useEffect, useRef, useState, type SetStateAction } from 'react'
import type { Edge, Node } from '@xyflow/react'
import { invalidateGraphTargets, reconcileWorkflowNodes } from '../services/workflowState.ts'

export function useWorkflowState(initial: Node[], edges: Edge[]) {
  const [nodes, publish] = useState(initial)
  const nodesRef = useRef(nodes)
  const edgesRef = useRef(edges)
  const previousEdgesRef = useRef(edges)
  edgesRef.current = edges

  // Topology is an input too: adding/removing a connection invalidates the
  // target branch, otherwise an old analysis/script/video could be reused.
  useEffect(() => {
    const previousEdges = previousEdgesRef.current
    if (previousEdges === edges) return
    const previousById = new Map(previousEdges.map(edge => [edge.id, edge]))
    const currentById = new Map(edges.map(edge => [edge.id, edge]))
    const changedTargets = new Set<string>()
    for (const id of new Set([...previousById.keys(), ...currentById.keys()])) {
      const before = previousById.get(id)
      const after = currentById.get(id)
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        if (before?.target) changedTargets.add(before.target)
        if (after?.target) changedTargets.add(after.target)
      }
    }
    previousEdgesRef.current = edges
    if (changedTargets.size > 0) {
      nodesRef.current = invalidateGraphTargets(nodesRef.current, [...previousEdges, ...edges], [...changedTargets])
      publish(nodesRef.current)
    }
  }, [edges])

  const setNodes = useCallback((update: SetStateAction<Node[]>) => {
    const previous = nodesRef.current
    const next = typeof update === 'function' ? update(previous) : update
    nodesRef.current = reconcileWorkflowNodes(previous, next, edgesRef.current)
    publish(nodesRef.current)
  }, [])
  const captureRevision = useCallback((nodeId: string) => {
    const revision = nodesRef.current.find(node => node.id === nodeId)?.data.inputRevision
    return () => {
      const node = nodesRef.current.find(node => node.id === nodeId)
      return !!node && node.data.inputRevision === revision
    }
  }, [])
  return { nodes, setNodes, nodesRef, captureRevision }
}
