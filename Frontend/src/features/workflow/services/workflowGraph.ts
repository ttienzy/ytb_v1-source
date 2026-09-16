import type { Connection, Edge, Node } from '@xyflow/react'

/** Keep these ports aligned with initialElements and the node components. */
export const WORKFLOW_CONNECTION_RULES = [
  ['productAssets', 'to-gemini', 'geminiAnalysis', 'from-products'],
  ['productAssets', 'to-gpt', 'gptScript', 'from-products'],
  ['productAssets', 'to-flow', 'veoFlowStudio', 'from-assets'],
  ['characterScene', 'to-gpt', 'gptScript', 'from-charscene'],
  ['characterScene', 'to-flow', 'veoFlowStudio', 'from-assets'],
  ['geminiAnalysis', 'to-gpt', 'gptScript', 'from-gemini'],
  ['gptScript', 'to-flow', 'veoFlowStudio', 'from-gpt'],
] as const

export const SUPPORTED_WORKFLOW_START_TYPES = [
  'productAssets', 'characterScene', 'geminiAnalysis', 'gptScript', 'veoFlowStudio',
] as const
export type WorkflowStartType = typeof SUPPORTED_WORKFLOW_START_TYPES[number]

export function isSupportedWorkflowStartType(type: string | undefined): type is WorkflowStartType {
  return SUPPORTED_WORKFLOW_START_TYPES.some((candidate) => candidate === type)
}

export class WorkflowGraphError extends Error {
  readonly nodeId: string
  constructor(nodeId: string, message: string) {
    super(message)
    this.name = 'WorkflowGraphError'
    this.nodeId = nodeId
  }
}

type Link = {
  source: string
  target: string
  sourceHandle?: string | null
  targetHandle?: string | null
}

function validPorts(source: Node, target: Node, edge: Link, allowMissing: boolean): boolean {
  return WORKFLOW_CONNECTION_RULES.some(([sourceType, sourceHandle, targetType, targetHandle]) =>
    source.type === sourceType && target.type === targetType &&
    (edge.sourceHandle === sourceHandle || (allowMissing && edge.sourceHandle == null)) &&
    (edge.targetHandle === targetHandle || (allowMissing && edge.targetHandle == null)),
  )
}

/** Validate the persisted graph once; missing legacy handles are inferred by node type. */
export function validateWorkflowGraph(nodes: Node[], edges: Edge[]): void {
  const byId = new Map<string, Node>()
  for (const node of nodes) {
    if (byId.has(node.id)) throw new WorkflowGraphError(node.id, `Duplicate node ID: ${node.id}`)
    byId.set(node.id, node)
  }
  const inputs = new Map<string, Map<string, string>>()
  const outgoing = new Map<string, Set<string>>()
  const indegree = new Map(nodes.map((node) => [node.id, 0]))
  for (const edge of edges) {
    const source = byId.get(edge.source)
    const target = byId.get(edge.target)
    if (!source || !target) {
      throw new WorkflowGraphError(target?.id ?? source?.id ?? edge.target, `Dangling connection: ${edge.source} -> ${edge.target}`)
    }
    if (!validPorts(source, target, edge, true)) {
      throw new WorkflowGraphError(target.id, `Invalid node types or handles: ${source.id} -> ${target.id}`)
    }
    const targetInputs = inputs.get(target.id) ?? new Map<string, string>()
    const previous = targetInputs.get(source.type!)
    if (previous && previous !== source.id) {
      throw new WorkflowGraphError(target.id, `Ambiguous ${source.type} input on ${target.id}: ${previous}, ${source.id}`)
    }
    targetInputs.set(source.type!, source.id)
    inputs.set(target.id, targetInputs)
    const children = outgoing.get(source.id) ?? new Set<string>()
    if (!children.has(target.id)) indegree.set(target.id, indegree.get(target.id)! + 1)
    children.add(target.id)
    outgoing.set(source.id, children)
  }
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id)
  let visited = 0
  for (let i = 0; i < queue.length; i++) {
    visited++
    for (const id of outgoing.get(queue[i]) ?? []) {
      indegree.set(id, indegree.get(id)! - 1)
      if (indegree.get(id) === 0) queue.push(id)
    }
  }
  if (visited !== nodes.length) {
    const id = nodes.find((node) => indegree.get(node.id)! > 0)!.id
    throw new WorkflowGraphError(id, `Workflow contains a cycle at ${id}`)
  }
}

/** UI connection predicate: one source per type on a target, unlimited fanout. */
export function isValidWorkflowConnection(nodes: Node[], edges: Edge[], connection: Link): boolean {
  const source = nodes.find((node) => node.id === connection.source)
  const target = nodes.find((node) => node.id === connection.target)
  if (!source || !target || !validPorts(source, target, connection, false)) return false
  if (edges.some((edge) => edge.source === connection.source && edge.target === connection.target)) return false
  try {
    validateWorkflowGraph(nodes, [...edges, { ...connection, id: '__candidate__' }])
    return true
  } catch {
    return false
  }
}

/** Stable topological order of descendants only. External parents are never executed. */
export function getWorkflowExecutionOrder(nodes: Node[], edges: Edge[], startNodeId: string): Node[] {
  validateWorkflowGraph(nodes, edges)
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const start = byId.get(startNodeId)
  if (!start) throw new WorkflowGraphError(startNodeId, `Start node not found: ${startNodeId}`)
  if (!isSupportedWorkflowStartType(start.type)) {
    throw new WorkflowGraphError(startNodeId, `Unsupported workflow start type: ${start.type}`)
  }
  const outgoing = new Map<string, Set<string>>()
  for (const edge of edges) {
    const children = outgoing.get(edge.source) ?? new Set<string>()
    children.add(edge.target)
    outgoing.set(edge.source, children)
  }
  const reachable = new Set([startNodeId])
  const queue = [startNodeId]
  for (let i = 0; i < queue.length; i++) {
    for (const id of outgoing.get(queue[i]) ?? []) {
      if (!reachable.has(id)) { reachable.add(id); queue.push(id) }
    }
  }
  const indegree = new Map([...reachable].map((id) => [id, 0]))
  for (const id of reachable) {
    for (const child of outgoing.get(id) ?? []) indegree.set(child, indegree.get(child)! + 1)
  }
  // Sorting each independent level by ID makes order independent of canvas/edge array order.
  let ready = [...reachable].filter((id) => indegree.get(id) === 0).sort()
  const ordered: Node[] = []
  while (ready.length) {
    const next: string[] = []
    for (const id of ready) {
      ordered.push(byId.get(id)!)
      for (const child of outgoing.get(id) ?? []) {
        indegree.set(child, indegree.get(child)! - 1)
        if (indegree.get(child) === 0) next.push(child)
      }
    }
    ready = next.sort()
  }
  return ordered
}
