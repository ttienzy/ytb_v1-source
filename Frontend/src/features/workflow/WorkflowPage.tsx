import React, { useState, useCallback, useMemo } from 'react'
import {
  ReactFlow,
  Controls,
  Background,
  MiniMap,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeChange,
  EdgeChange,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './workflow.css'

import { AssetInputNode } from './nodes/AssetInputNode'
import { GeminiAnalysisNode } from './nodes/GeminiAnalysisNode'
import { GptScriptNode } from './nodes/GptScriptNode'
import { SceneVideoNode } from './nodes/SceneVideoNode'
import { ExportTimelineNode } from './nodes/ExportTimelineNode'
import { RemovableEdge } from './edges/RemovableEdge'
import { WorkflowToolbar } from './components/WorkflowToolbar'
import { initialNodes, initialEdges } from './initialElements'

function WorkflowCanvas() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)
  const [isRunning, setIsRunning] = useState(false)
  const { fitView } = useReactFlow()

  const nodeTypes = useMemo(
    () => ({
      assetInput: AssetInputNode,
      geminiAnalysis: GeminiAnalysisNode,
      gptScript: GptScriptNode,
      sceneVideo: SceneVideoNode,
      exportTimeline: ExportTimelineNode,
    }),
    []
  )

  const edgeTypes = useMemo(
    () => ({
      removable: RemovableEdge,
    }),
    []
  )

  // Delete an edge by ID
  const handleDeleteEdge = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId))
  }, [])

  // Delete a node by ID (and all its connected edges)
  const handleDeleteNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.filter((n) => n.id !== nodeId))
    setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId))
  }, [])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  )

  const onConnect = useCallback(
    (connection: Connection) =>
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: 'removable',
            animated: true,
            style: { stroke: '#6366f1', strokeWidth: 2.5 },
            data: { onDeleteEdge: handleDeleteEdge },
          },
          eds
        )
      ),
    [handleDeleteEdge]
  )

  // Update asset images inside node data
  const handleAssetChange = useCallback(
    (key: string, value: string | null) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === 'node-assets') {
            return {
              ...node,
              data: {
                ...node.data,
                [key]: value,
              },
            }
          }
          return node
        })
      )
    },
    []
  )

  // Add a new node dynamically
  const handleAddNode = useCallback(
    (type: 'assetInput' | 'geminiAnalysis' | 'gptScript' | 'sceneVideo' | 'exportTimeline') => {
      const id = `node-${type}-${Date.now()}`
      const x = 350 + Math.random() * 200
      const y = 200 + Math.random() * 150

      let newNode: Node
      if (type === 'assetInput') {
        newNode = {
          id,
          type,
          position: { x, y },
          data: {
            productName: 'Nguyên liệu mới',
            productImage: null,
            modelImage: null,
            sceneImage: null,
          },
        }
      } else if (type === 'geminiAnalysis') {
        newNode = {
          id,
          type,
          position: { x, y },
          data: {
            title: 'Gemini 2.5 • Vision Phân Tích',
            model: 'gemini-2.5-flash',
            provider: 'Google Gemini 2.5',
            analysisResult: {
              productFeatures: 'Chất vải dệt cao cấp, màu sắc trang nhã, form dáng tinh tế.',
              modelAttributes: 'Người mẫu thần thái tự tin, ánh mắt cuốn hút.',
              sceneVibe: 'Ánh sáng tự nhiên, tone màu hài hòa, bố cục chuẩn điện ảnh.',
              keySellingPoints: ['Chất liệu cao cấp', 'Thiết kế độc quyền', 'Số lượng có hạn'],
              suggestedAngles: ['Cận cảnh góc 45 độ', 'Toàn cảnh sải bước', 'Cận mặt nụ cười'],
            },
          },
        }
      } else if (type === 'gptScript') {
        newNode = {
          id,
          type,
          position: { x, y },
          data: {
            title: 'Kịch bản bổ sung',
            model: 'cx/gpt-5.5',
            prompt: '',
            totalScenes: 2,
            targetDuration: 10,
            scenes: [
              {
                sceneNumber: 1,
                title: 'Cảnh 1',
                prompt: 'Góc máy cinematic...',
                durationSec: 5,
                aspectRatio: '9:16',
              },
            ],
          },
        }
      } else if (type === 'sceneVideo') {
        newNode = {
          id,
          type,
          position: { x, y },
          data: {
            sceneNumber: 4,
            title: 'Phân cảnh mới',
            prompt: 'Mô tả chuyển động máy quay...',
            durationSec: 4,
            aspectRatio: '9:16',
            cameraMotion: 'Dynamic Zoom',
            refImages: {},
          },
        }
      } else {
        newNode = {
          id,
          type,
          position: { x, y },
          data: {
            title: 'Xuất video bổ sung',
            resolution: '1080p',
            format: 'mp4',
          },
        }
      }

      setNodes((nds) => [...nds, newNode])
    },
    []
  )

  // Reset to original layout & fit view
  const handleResetLayout = useCallback(() => {
    setNodes(initialNodes)
    setEdges(initialEdges)
    setTimeout(() => {
      fitView({ duration: 600, padding: 0.15 })
    }, 50)
  }, [fitView])

  // Interactive Simulation of full pipeline execution: Assets -> Gemini -> GPT -> Scenes -> Export
  const handleSimulateRun = useCallback(() => {
    if (isRunning) return
    setIsRunning(true)

    // Step 1: Gemini Vision starts analyzing
    setNodes((nds) =>
      nds.map((n) => (n.id === 'node-gemini' ? { ...n, data: { ...n.data, isAnalyzing: true } } : n))
    )

    setTimeout(() => {
      // Step 2: Gemini completes, GPT Script node starts generating
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === 'node-gemini') return { ...n, data: { ...n.data, isAnalyzing: false } }
          if (n.id === 'node-gpt') return { ...n, data: { ...n.data, isGenerating: true } }
          return n
        })
      )

      setTimeout(() => {
        // Step 3: GPT finishes, Scene 1 starts rendering
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === 'node-gpt') return { ...n, data: { ...n.data, isGenerating: false } }
            if (n.id === 'node-scene-1')
              return { ...n, data: { ...n.data, isRendering: true, renderProgress: 35 } }
            return n
          })
        )

        setTimeout(() => {
          // Step 4: Scene 1 finishes, Scene 2 & 3 render
          setNodes((nds) =>
            nds.map((n) => {
              if (n.id === 'node-scene-1')
                return {
                  ...n,
                  data: {
                    ...n.data,
                    isRendering: false,
                    renderProgress: 100,
                    thumbnailUrl:
                      'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=400&auto=format&fit=crop&q=80',
                  },
                }
              if (n.id === 'node-scene-2')
                return { ...n, data: { ...n.data, isRendering: true, renderProgress: 60 } }
              return n
            })
          )

          setTimeout(() => {
            // Step 5: Scene 2 & 3 complete, Export node triggers
            setNodes((nds) =>
              nds.map((n) => {
                if (n.id === 'node-scene-2' || n.id === 'node-scene-3')
                  return {
                    ...n,
                    data: {
                      ...n.data,
                      isRendering: false,
                      renderProgress: 100,
                      thumbnailUrl:
                        'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
                    },
                  }
                if (n.id === 'node-export')
                  return { ...n, data: { ...n.data, isExporting: true, exportProgress: 80 } }
                return n
              })
            )

            setTimeout(() => {
              // Step 6: Export completes successfully
              setNodes((nds) =>
                nds.map((n) => {
                  if (n.id === 'node-export')
                    return {
                      ...n,
                      data: {
                        ...n.data,
                        isExporting: false,
                        exportProgress: 100,
                        finalVideoUrl: 'completed',
                      },
                    }
                  return n
                })
              )
              setIsRunning(false)
            }, 1500)
          }, 1500)
        }, 1500)
      }, 1500)
    }, 1500)
  }, [isRunning])

  // Attach handlers to nodes (onDelete, onChange)
  const nodesWithHandlers = useMemo(() => {
    return nodes.map((node) => {
      const baseData = {
        ...node.data,
        onDelete: () => handleDeleteNode(node.id),
      }
      if (node.type === 'assetInput') {
        return {
          ...node,
          data: {
            ...baseData,
            onChange: handleAssetChange,
          },
        }
      }
      return {
        ...node,
        data: baseData,
      }
    })
  }, [nodes, handleAssetChange, handleDeleteNode])

  // Attach onDeleteEdge to edges data
  const edgesWithHandlers = useMemo(() => {
    return edges.map((edge) => ({
      ...edge,
      type: 'removable',
      data: {
        ...((edge.data as Record<string, unknown>) || {}),
        onDeleteEdge: handleDeleteEdge,
      },
    }))
  }, [edges, handleDeleteEdge])

  return (
    <div className="workflow-container">
      <WorkflowToolbar
        onAddNode={handleAddNode}
        onResetLayout={handleResetLayout}
        onSimulateRun={handleSimulateRun}
        isRunning={isRunning}
      />

      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        <ReactFlow
          nodes={nodesWithHandlers}
          edges={edgesWithHandlers}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.2}
          maxZoom={2}
          deleteKeyCode={['Backspace', 'Delete']}
          defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
        >
          <Background
            variant={BackgroundVariant.Dots}
            gap={20}
            size={1.2}
            color="#cbd5e1"
          />
          <Controls position="bottom-right" />
          <MiniMap
            position="bottom-left"
            nodeStrokeColor="#6366f1"
            nodeColor="#e2e8f0"
            maskColor="rgba(241, 245, 249, 0.8)"
            style={{ width: 140, height: 95 }}
          />
        </ReactFlow>
      </div>
    </div>
  )
}

export function WorkflowPage() {
  return (
    <ReactFlowProvider>
      <WorkflowCanvas />
    </ReactFlowProvider>
  )
}
