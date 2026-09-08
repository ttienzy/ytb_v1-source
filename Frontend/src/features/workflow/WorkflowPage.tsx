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

import { ProductAssetsNode } from './nodes/ProductAssetsNode'
import { CharacterSceneNode } from './nodes/CharacterSceneNode'
import { GeminiAnalysisNode } from './nodes/GeminiAnalysisNode'
import { GptScriptNode } from './nodes/GptScriptNode'
import { VeoFlowStudioNode } from './nodes/VeoFlowStudioNode'
import { SceneVideoNode } from './nodes/SceneVideoNode'
import { ExportTimelineNode } from './nodes/ExportTimelineNode'
import { RemovableEdge } from './edges/RemovableEdge'
import { WorkflowToolbar } from './components/WorkflowToolbar'
import { initialNodes, initialEdges } from './initialElements'
import type { GeneratedSceneItem } from './types'

function WorkflowCanvas() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)
  const [isRunning, setIsRunning] = useState(false)
  const { fitView } = useReactFlow()

  const nodeTypes = useMemo(
    () => ({
      productAssets: ProductAssetsNode,
      characterScene: CharacterSceneNode,
      geminiAnalysis: GeminiAnalysisNode,
      gptScript: GptScriptNode,
      veoFlowStudio: VeoFlowStudioNode,
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

  // Update product image slot inside productAssets node
  const handleProductImageChange = useCallback((nodeId: string, index: number, value: string | null) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          const prevImages = ((node.data?.images as (string | null)[]) || [null, null, null]).slice()
          prevImages[index] = value
          return {
            ...node,
            data: {
              ...node.data,
              images: prevImages,
            },
          }
        }
        return node
      })
    )
  }, [])

  // Update character & scene images
  const handleCharacterSceneChange = useCallback(
    (nodeId: string, key: 'modelImage' | 'sceneImage', value: string | null) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
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

  // Update prompt in GPT node
  const handleGptPromptChange = useCallback((nodeId: string, val: string) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, prompt: val } } : n))
    )
  }, [])

  // Update Flow Studio active scene index
  const handleFlowStudioSelectScene = useCallback((nodeId: string, index: number) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, activeSceneIndex: index } } : n))
    )
  }, [])

  // Update Flow Studio scene prompt
  const handleFlowStudioUpdatePrompt = useCallback((nodeId: string, index: number, prompt: string) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === nodeId) {
          const prevScenes = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
          if (prevScenes[index]) {
            prevScenes[index] = { ...prevScenes[index], prompt }
          }
          return { ...n, data: { ...n.data, scenes: prevScenes } }
        }
        return n
      })
    )
  }, [])

  // Update Flow Studio scene duration
  const handleFlowStudioUpdateDuration = useCallback((nodeId: string, index: number, durationSec: number) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === nodeId) {
          const prevScenes = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
          if (prevScenes[index]) {
            prevScenes[index] = { ...prevScenes[index], durationSec }
          }
          return { ...n, data: { ...n.data, scenes: prevScenes } }
        }
        return n
      })
    )
  }, [])

  // Trigger Gemini Analysis directly
  const handleAnalyzeGemini = useCallback((nodeId: string) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isAnalyzing: true } } : n))
    )
    setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            return {
              ...n,
              data: {
                ...n.data,
                isAnalyzing: false,
                analysisResult: {
                  productFeatures: 'Chất vải dệt cao cấp, thiết kế phom chuẩn tôn dáng, đường may tỉ mỉ.',
                  modelAttributes: 'Người mẫu trẻ trung, thần thái tự tin, nụ cười rạng rỡ.',
                  sceneVibe: 'Ánh sáng tự nhiên mềm mại, không gian hiện đại, chiều sâu trường ảnh tốt.',
                  keySellingPoints: ['Co giãn thoáng mát', 'Chống nhăn cao cấp', 'Phong cách năng động'],
                  suggestedAngles: ['Macro sợi vải & cúc', 'Toàn cảnh sải bước', 'Cận nụ cười tự tin'],
                },
              },
            }
          }
          return n
        })
      )
    }, 1200)
  }, [])

  // Trigger GPT Script generation directly
  const handleGenerateGptScript = useCallback((nodeId: string) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isGenerating: true } } : n))
    )
    setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            return {
              ...n,
              data: {
                ...n.data,
                isGenerating: false,
                scenes: [
                  {
                    sceneNumber: 1,
                    title: 'Cận cảnh chất liệu & Logo',
                    prompt: 'Macro cinematic close up shot of fabric texture and collar stitching, soft natural sunlight, slow tilt up, 4k ultra realistic',
                    durationSec: 4,
                    aspectRatio: '9:16',
                    cameraMotion: 'Slow Tilt Up',
                  },
                  {
                    sceneNumber: 2,
                    title: 'Người mẫu trải nghiệm sản phẩm',
                    prompt: 'Full body tracking shot of young handsome model walking gracefully through a bright modern setting, joyful smile, premium look',
                    durationSec: 8,
                    aspectRatio: '9:16',
                    cameraMotion: 'Tracking Shot',
                  },
                  {
                    sceneNumber: 3,
                    title: 'Tạo dáng chốt & Call To Action',
                    prompt: 'Medium close-up of model looking directly into camera with confident smile, pointing with finger to click shop now button, cinematic bokeh',
                    durationSec: 4,
                    aspectRatio: '9:16',
                    cameraMotion: 'Slow Push In',
                  },
                ],
              },
            }
          }
          return n
        })
      )
    }, 1200)
  }, [])

  // Render single scene inside Flow Studio
  const handleRenderFlowScene = useCallback((nodeId: string, sceneIndex: number) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === nodeId) {
          const scenes = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
          if (scenes[sceneIndex]) {
            scenes[sceneIndex] = { ...scenes[sceneIndex], isRendering: true, renderProgress: 30 }
          }
          return { ...n, data: { ...n.data, scenes } }
        }
        return n
      })
    )

    setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const scenes = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
            if (scenes[sceneIndex]) {
              scenes[sceneIndex] = {
                ...scenes[sceneIndex],
                isRendering: false,
                renderProgress: 100,
                thumbnailUrl:
                  sceneIndex === 0
                    ? 'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=400&auto=format&fit=crop&q=80'
                    : sceneIndex === 1
                    ? 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80'
                    : 'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&auto=format&fit=crop&q=80',
              }
            }
            return { ...n, data: { ...n.data, scenes } }
          }
          return n
        })
      )
    }, 1500)
  }, [])

  // Export complete stitched video in Flow Studio
  const handleExportFlowVideo = useCallback((nodeId: string) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isExporting: true, exportProgress: 40 } } : n))
    )
    setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            return {
              ...n,
              data: {
                ...n.data,
                isExporting: false,
                exportProgress: 100,
                finalVideoUrl: 'completed_video.mp4',
              },
            }
          }
          return n
        })
      )
    }, 1800)
  }, [])

  // Add a new node dynamically
  const handleAddNode = useCallback(
    (type: 'productAssets' | 'characterScene' | 'geminiAnalysis' | 'gptScript' | 'veoFlowStudio' | 'sceneVideo' | 'exportTimeline') => {
      const id = `node-${type}-${Date.now()}`
      const x = 300 + Math.random() * 200
      const y = 150 + Math.random() * 150

      let newNode: Node
      if (type === 'productAssets') {
        newNode = {
          id,
          type,
          position: { x, y },
          data: {
            title: 'Ảnh Sản Phẩm (Products)',
            images: [null, null, null],
          },
        }
      } else if (type === 'characterScene') {
        newNode = {
          id,
          type,
          position: { x, y },
          data: {
            title: 'Nhân Vật & Bối Cảnh',
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
            analysisResult: null,
          },
        }
      } else if (type === 'gptScript') {
        newNode = {
          id,
          type,
          position: { x, y },
          data: {
            title: 'ChatGPT • Kịch Bản Phân Cảnh',
            model: 'cx/gpt-5.5',
            provider: '9Router Gateway',
            prompt: '',
            totalScenes: 3,
            targetDuration: 15,
            scenes: [],
          },
        }
      } else {
        newNode = {
          id,
          type: 'veoFlowStudio',
          position: { x, y },
          data: {
            title: 'Google Veo 3.0 • Flow Studio',
            model: 'Google Veo 3.0',
            activeSceneIndex: 0,
            aspectRatio: '9:16',
            resolution: '1080p',
            scenes: [
              {
                sceneNumber: 1,
                title: 'Cận cảnh sản phẩm',
                prompt: '',
                durationSec: 4,
                aspectRatio: '9:16',
              },
              {
                sceneNumber: 2,
                title: 'Người mẫu & Bối cảnh',
                prompt: '',
                durationSec: 8,
                aspectRatio: '9:16',
              },
            ],
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
      fitView({ duration: 600, padding: 0.1 })
    }, 50)
  }, [fitView])

  // Interactive Simulation of full pipeline execution
  const handleSimulateRun = useCallback(() => {
    if (isRunning) return
    setIsRunning(true)

    // Step 1: Ensure Product and Character have test images loaded if empty
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === 'node-products') {
          return {
            ...n,
            data: {
              ...n.data,
              images: [
                'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=400&auto=format&fit=crop&q=80',
                'https://images.unsplash.com/photo-1618354691373-d851c5c3a990?w=400&auto=format&fit=crop&q=80',
                'https://images.unsplash.com/photo-1576566588028-4147f3842f27?w=400&auto=format&fit=crop&q=80',
              ],
            },
          }
        }
        if (n.id === 'node-character-scene') {
          return {
            ...n,
            data: {
              ...n.data,
              modelImage:
                'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
              sceneImage:
                'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&auto=format&fit=crop&q=80',
            },
          }
        }
        if (n.id === 'node-gemini') {
          return { ...n, data: { ...n.data, isAnalyzing: true } }
        }
        return n
      })
    )

    // Step 2: Gemini completes analysis, GPT starts generating script
    setTimeout(() => {
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === 'node-gemini') {
            return {
              ...n,
              data: {
                ...n.data,
                isAnalyzing: false,
                analysisResult: {
                  productFeatures: 'Áo polo dệt kim pique cotton 100%, thoáng khí, cúc áo khắc laser.',
                  modelAttributes: 'Nam giới 25-30 tuổi, phong thái lịch lãm, nụ cười tự tin.',
                  sceneVibe: 'Quán cafe hiện đại tone gỗ sáng, ánh nắng sớm mềm mại.',
                  keySellingPoints: ['Co giãn 4 chiều', 'Chống nhăn cao cấp', 'Thoáng khí mùa hè'],
                  suggestedAngles: ['Macro cổ áo & chất vải', 'Tracking shot sải bước', 'Cận mặt tự tin'],
                },
              },
            }
          }
          if (n.id === 'node-gpt') {
            return {
              ...n,
              data: {
                ...n.data,
                isGenerating: true,
                prompt: 'Tạo kịch bản video TikTok 15s tôn lên chất vải thoáng mát và phom dáng lịch lãm...',
              },
            }
          }
          return n
        })
      )

      // Step 3: GPT finishes script, populates 3 scenes into Flow Studio
      setTimeout(() => {
        const generatedScenes: GeneratedSceneItem[] = [
          {
            sceneNumber: 1,
            title: 'Cận cảnh chất liệu & Logo',
            prompt: 'Macro cinematic close up shot of polo shirt fabric texture, soft natural sunlight, slow tilt up',
            durationSec: 4,
            aspectRatio: '9:16',
            cameraMotion: 'Slow Tilt Up',
          },
          {
            sceneNumber: 2,
            title: 'Người mẫu sải bước tự tin',
            prompt: 'Full body tracking shot of model wearing polo walking gracefully in modern coffee shop',
            durationSec: 8,
            aspectRatio: '9:16',
            cameraMotion: 'Tracking Shot',
          },
          {
            sceneNumber: 3,
            title: 'Tạo dáng chốt & Kêu gọi (CTA)',
            prompt: 'Medium close-up of model looking directly into camera with confident smile, pointing to shop now',
            durationSec: 4,
            aspectRatio: '9:16',
            cameraMotion: 'Slow Push In',
          },
        ]

        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === 'node-gpt') {
              return { ...n, data: { ...n.data, isGenerating: false, scenes: generatedScenes } }
            }
            if (n.id === 'node-flow-studio') {
              return {
                ...n,
                data: {
                  ...n.data,
                  scenes: generatedScenes,
                  activeSceneIndex: 0,
                  isRendering: true,
                  renderProgress: 45,
                },
              }
            }
            return n
          })
        )

        // Step 4: Flow Studio renders Scene 1, then Scene 2, then Scene 3
        setTimeout(() => {
          setNodes((nds) =>
            nds.map((n) => {
              if (n.id === 'node-flow-studio') {
                const updated = generatedScenes.slice()
                updated[0] = {
                  ...updated[0],
                  thumbnailUrl:
                    'https://images.unsplash.com/photo-1581655353564-df123a1eb820?w=400&auto=format&fit=crop&q=80',
                }
                updated[1] = {
                  ...updated[1],
                  thumbnailUrl:
                    'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80',
                }
                updated[2] = {
                  ...updated[2],
                  thumbnailUrl:
                    'https://images.unsplash.com/photo-1441986300917-64674bd600d8?w=400&auto=format&fit=crop&q=80',
                }
                return {
                  ...n,
                  data: {
                    ...n.data,
                    scenes: updated,
                    isRendering: false,
                    isExporting: true,
                    exportProgress: 65,
                  },
                }
              }
              return n
            })
          )

          // Step 5: Complete stitched export
          setTimeout(() => {
            setNodes((nds) =>
              nds.map((n) => {
                if (n.id === 'node-flow-studio') {
                  return {
                    ...n,
                    data: {
                      ...n.data,
                      isExporting: false,
                      exportProgress: 100,
                      finalVideoUrl: 'completed_tiktok_polo.mp4',
                    },
                  }
                }
                return n
              })
            )
            setIsRunning(false)
          }, 1500)
        }, 1500)
      }, 1500)
    }, 1500)
  }, [isRunning])

  // Attach handlers to nodes (onDelete, onChangeImage, onChange, etc.)
  const nodesWithHandlers = useMemo(() => {
    return nodes.map((node) => {
      const baseData = {
        ...node.data,
        onDelete: () => handleDeleteNode(node.id),
      }
      if (node.type === 'productAssets') {
        return {
          ...node,
          data: {
            ...baseData,
            onChangeImage: (idx: number, url: string | null) => handleProductImageChange(node.id, idx, url),
          },
        }
      }
      if (node.type === 'characterScene') {
        return {
          ...node,
          data: {
            ...baseData,
            onChange: (key: 'modelImage' | 'sceneImage', val: string | null) =>
              handleCharacterSceneChange(node.id, key, val),
          },
        }
      }
      if (node.type === 'geminiAnalysis') {
        return {
          ...node,
          data: {
            ...baseData,
            onAnalyze: () => handleAnalyzeGemini(node.id),
          },
        }
      }
      if (node.type === 'gptScript') {
        return {
          ...node,
          data: {
            ...baseData,
            onChangePrompt: (val: string) => handleGptPromptChange(node.id, val),
            onGenerate: () => handleGenerateGptScript(node.id),
          },
        }
      }
      if (node.type === 'veoFlowStudio') {
        return {
          ...node,
          data: {
            ...baseData,
            onSelectScene: (idx: number) => handleFlowStudioSelectScene(node.id, idx),
            onUpdateScenePrompt: (idx: number, p: string) => handleFlowStudioUpdatePrompt(node.id, idx, p),
            onUpdateSceneDuration: (idx: number, d: number) => handleFlowStudioUpdateDuration(node.id, idx, d),
            onRenderScene: (idx: number) => handleRenderFlowScene(node.id, idx),
            onExportVideo: () => handleExportFlowVideo(node.id),
          },
        }
      }
      return {
        ...node,
        data: baseData,
      }
    })
  }, [
    nodes,
    handleProductImageChange,
    handleCharacterSceneChange,
    handleGptPromptChange,
    handleAnalyzeGemini,
    handleGenerateGptScript,
    handleFlowStudioSelectScene,
    handleFlowStudioUpdatePrompt,
    handleFlowStudioUpdateDuration,
    handleRenderFlowScene,
    handleExportFlowVideo,
    handleDeleteNode,
  ])

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
          fitViewOptions={{ padding: 0.1 }}
          minZoom={0.3}
          maxZoom={2}
          deleteKeyCode={['Backspace', 'Delete']}
          defaultViewport={{ x: 0, y: 0, zoom: 0.88 }}
        >
          <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
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
