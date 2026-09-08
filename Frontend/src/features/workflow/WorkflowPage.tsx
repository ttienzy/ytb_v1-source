import React, { useState, useCallback, useMemo, useEffect } from 'react'
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

import { API_URL } from '../../shared/constants'
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
import { VeoSetupModal } from './components/VeoSetupModal'
import * as veoApi from '../veo-studio/services/veoApi'
import type { VeoCapabilities, VeoProject } from '../veo-studio/types'
import type { GeneratedSceneItem, GptSalesScriptItem, VeoVideoConfig } from './types'

function WorkflowCanvas() {
  const [nodes, setNodes] = useState<Node[]>(initialNodes)
  const [edges, setEdges] = useState<Edge[]>(initialEdges)
  const [startNodeId, setStartNodeId] = useState<string>('node-gemini')
  const [isRunning, setIsRunning] = useState(false)
  const { fitView } = useReactFlow()

  // Veo Studio Setup & Configuration state
  const [isVeoModalOpen, setIsVeoModalOpen] = useState(false)
  const [veoProjects, setVeoProjects] = useState<VeoProject[]>([])
  const [activeVeoProject, setActiveVeoProject] = useState<VeoProject | null>(null)
  const [veoCapabilities, setVeoCapabilities] = useState<VeoCapabilities | null>(null)
  const [veoVideoConfig, setVeoVideoConfig] = useState<VeoVideoConfig>({
    model: 'Omni 1.1 Flash',
    aspectRatio: '9:16',
    duration: 4,
    resolution: '720p',
    variations: 1,
    creditCost: 7,
  })

  // Track connected nodes to identify loose/orphan nodes
  const connectedNodeIds = useMemo(() => {
    const set = new Set<string>()
    edges.forEach((e) => {
      set.add(e.source)
      set.add(e.target)
    })
    return set
  }, [edges])

  const orphanCount = useMemo(() => {
    return nodes.filter((n) => !connectedNodeIds.has(n.id)).length
  }, [nodes, connectedNodeIds])

  const handleCleanOrphans = useCallback(() => {
    setNodes((nds) => nds.filter((n) => connectedNodeIds.has(n.id)))
  }, [connectedNodeIds])

  const handleSetStartNode = useCallback((nodeId: string) => {
    setStartNodeId(nodeId)
  }, [])


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

  // Tự động lấy prompt mặc định từ Backend khi mở trang
  useEffect(() => {
    fetch(`${API_URL}/api/workflow/prompts/gemini`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.prompt) {
          setNodes((nds) =>
            nds.map((n) => {
              if (n.type === 'geminiAnalysis' && !n.data?.prompt) {
                return { ...n, data: { ...n.data, prompt: data.prompt } }
              }
              return n
            })
          )
        }
      })
      .catch((err) => console.warn('Could not load Gemini prompt from Backend:', err))

    fetch(`${API_URL}/api/workflow/prompts/gpt`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.prompt) {
          setNodes((nds) =>
            nds.map((n) => {
              if (n.type === 'gptScript' && !n.data?.prompt) {
                return { ...n, data: { ...n.data, prompt: data.prompt } }
              }
              return n
            })
          )
        }
      })
      .catch((err) => console.warn('Could not load GPT prompt from Backend:', err))

    // Tự động load danh sách projects và capabilities cho Veo
    veoApi.getProjects().then(setVeoProjects).catch(console.warn)
    veoApi.getActiveProject().then(setActiveVeoProject).catch(console.warn)
    veoApi.getCapabilities().then(setVeoCapabilities).catch(console.warn)
  }, [])

  const handleSelectVeoProject = useCallback(async (projectId: string) => {
    try {
      const selected = await veoApi.selectProject(projectId)
      setActiveVeoProject(selected)
      const list = await veoApi.getProjects()
      setVeoProjects(list)
    } catch (err) {
      console.error('Error selecting Veo project:', err)
    }
  }, [])

  const handleCreateVeoProject = useCallback(async (name: string) => {
    try {
      const created = await veoApi.createProject(name)
      setActiveVeoProject(created)
      const list = await veoApi.getProjects()
      setVeoProjects(list)
    } catch (err) {
      console.error('Error creating Veo project:', err)
      throw err
    }
  }, [])

  const handleDeleteVeoProject = useCallback(async (projectId: string) => {
    try {
      await veoApi.deleteProject(projectId)
      if (activeVeoProject?.id === projectId) {
        setActiveVeoProject(null)
      }
      const list = await veoApi.getProjects()
      setVeoProjects(list)
    } catch (err) {
      console.error('Error deleting Veo project:', err)
    }
  }, [activeVeoProject])

  // Map kịch bản GPT trực tiếp vào 3 cảnh của Veo Flow Studio
  // Helper lấy toàn bộ nội dung text không cắt bớt của 1 kịch bản
  const getFullScriptContent = useCallback((s?: GptSalesScriptItem): string => {
    if (!s) return ''
    if (s.content && s.content.trim()) return s.content.trim()
    const parts = [
      s.hook ? `Hook: ${s.hook}` : '',
      s.problem ? `Vấn đề: ${s.problem}` : '',
      s.product ? `Sản phẩm: ${s.product}` : '',
      s.benefits ? `Lợi ích: ${s.benefits}` : '',
      s.cta ? `CTA: ${s.cta}` : '',
    ].filter(Boolean)
    return parts.join('\n\n')
  }, [])

  // 1. Đẩy CẢ 3 kịch bản vào 3 cảnh của Veo Flow Studio:
  // Cảnh 1 = Toàn bộ Kịch bản 1 (Góc 1: Problem → Solution) - ĐẦY ĐỦ TEXT KHÔNG CẮT BỚT!
  // Cảnh 2 = Toàn bộ Kịch bản 2 (Góc 2: USP → Benefit) - ĐẦY ĐỦ TEXT KHÔNG CẮT BỚT!
  // Cảnh 3 = Toàn bộ Kịch bản 3 (Góc 3: Situation/Experience → Desire) - ĐẦY ĐỦ TEXT KHÔNG CẮT BỚT!
  const handleApplyAllGptScriptsToVeo = useCallback(() => {
    setNodes((nds) => {
      const gptNode = nds.find((n) => n.id === 'node-gpt')
      const scripts = (gptNode?.data?.salesScripts as GptSalesScriptItem[]) || []
      if (scripts.length === 0) {
        alert('⚠️ Chưa có kịch bản nào từ ChatGPT! Vui lòng nhấn "Sinh 3 Kịch Bản Bán Hàng" trước.')
        return nds
      }

      const currentFlow = nds.find((n) => n.id === 'node-flow-studio')
      const flowConfig = (currentFlow?.data?.videoConfig as VeoVideoConfig) || veoVideoConfig

      const script1 = scripts[0]
      const script2 = scripts[1] || scripts[0]
      const script3 = scripts[2] || scripts[1] || scripts[0]

      const newScenes: GeneratedSceneItem[] = [
        {
          sceneNumber: 1,
          title: script1.title ? `Cảnh 1: ${script1.title}` : (script1.angle || 'Cảnh 1: Góc 1 (Problem → Solution)'),
          prompt: getFullScriptContent(script1),
          durationSec: flowConfig.duration || 6,
          aspectRatio: flowConfig.aspectRatio || '9:16',
          cameraMotion: 'Cận cảnh chi tiết',
        },
        {
          sceneNumber: 2,
          title: script2.title ? `Cảnh 2: ${script2.title}` : (script2.angle || 'Cảnh 2: Góc 2 (USP → Benefit)'),
          prompt: getFullScriptContent(script2),
          durationSec: flowConfig.duration ? Math.min(10, Math.max(6, flowConfig.duration * 2)) : 8,
          aspectRatio: flowConfig.aspectRatio || '9:16',
          cameraMotion: 'Tracking Shot',
        },
        {
          sceneNumber: 3,
          title: script3.title ? `Cảnh 3: ${script3.title}` : (script3.angle || 'Cảnh 3: Góc 3 (Experience → Desire)'),
          prompt: getFullScriptContent(script3),
          durationSec: flowConfig.duration || 6,
          aspectRatio: flowConfig.aspectRatio || '9:16',
          cameraMotion: 'Slow Push In',
        },
      ]

      return nds.map((n) => {
        if (n.id === 'node-flow-studio') {
          return {
            ...n,
            data: {
              ...n.data,
              scenes: newScenes,
              activeSceneIndex: 0,
              selectedGptScriptAngle: 'Đồng bộ cả 3 Kịch bản đầy đủ (3 Cảnh)',
            },
          }
        }
        return n
      })
    })
  }, [veoVideoConfig, getFullScriptContent])

  // 2. Đẩy riêng kịch bản thứ scriptIdx vào cảnh hiện tại của Flow Studio (toàn bộ text, không cắt bớt)
  const handleApplySingleScriptToCurrentScene = useCallback((scriptIdx: number) => {
    setNodes((nds) => {
      const gptNode = nds.find((n) => n.id === 'node-gpt')
      const scripts = (gptNode?.data?.salesScripts as GptSalesScriptItem[]) || []
      const targetScript = scripts[scriptIdx]
      if (!targetScript) return nds

      const fullPrompt = getFullScriptContent(targetScript)

      return nds.map((n) => {
        if (n.id === 'node-gpt') {
          return {
            ...n,
            data: {
              ...n.data,
              activeScriptIndex: scriptIdx,
            },
          }
        }
        if (n.id === 'node-flow-studio') {
          const currentActive = n.data?.activeSceneIndex ?? 0
          const prevScenes = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
          if (prevScenes[currentActive]) {
            prevScenes[currentActive] = {
              ...prevScenes[currentActive],
              title: `${targetScript.title || targetScript.angle}`,
              prompt: fullPrompt,
            }
          }
          return {
            ...n,
            data: {
              ...n.data,
              scenes: prevScenes,
              selectedGptScriptAngle: targetScript.angle,
            },
          }
        }
        return n
      })
    })
  }, [getFullScriptContent])

  // 3. Phân rã 1 kịch bản thành 3 cảnh (Hook+Vấn đề, Sản phẩm+Lợi ích, CTA) nhưng ĐẦY ĐỦ TEXT, KHÔNG CẮT BỚT
  const handleSplitSingleScriptToThreeScenes = useCallback((scriptIdx: number) => {
    setNodes((nds) => {
      const gptNode = nds.find((n) => n.id === 'node-gpt')
      const scripts = (gptNode?.data?.salesScripts as GptSalesScriptItem[]) || []
      const targetScript = scripts[scriptIdx]
      if (!targetScript) return nds

      const scene1Prompt = [
        targetScript.hook ? `Hook: ${targetScript.hook}` : '',
        targetScript.problem ? `Vấn đề: ${targetScript.problem}` : '',
      ].filter(Boolean).join('\n\n') || targetScript.content

      const scene2Prompt = [
        targetScript.product ? `Sản phẩm: ${targetScript.product}` : '',
        targetScript.benefits ? `Lợi ích: ${targetScript.benefits}` : '',
      ].filter(Boolean).join('\n\n') || targetScript.content

      const scene3Prompt = targetScript.cta
        ? `Kêu gọi hành động (CTA): ${targetScript.cta}`
        : targetScript.content

      const currentFlow = nds.find((n) => n.id === 'node-flow-studio')
      const flowConfig = (currentFlow?.data?.videoConfig as VeoVideoConfig) || veoVideoConfig

      const newScenes: GeneratedSceneItem[] = [
        {
          sceneNumber: 1,
          title: 'Cảnh 1: Mở đầu & Vấn đề',
          prompt: scene1Prompt,
          durationSec: flowConfig.duration || 4,
          aspectRatio: flowConfig.aspectRatio || '9:16',
          cameraMotion: 'Cận cảnh chi tiết',
        },
        {
          sceneNumber: 2,
          title: 'Cảnh 2: Sản phẩm & Lợi ích',
          prompt: scene2Prompt,
          durationSec: flowConfig.duration ? Math.min(10, Math.max(6, flowConfig.duration * 2)) : 8,
          aspectRatio: flowConfig.aspectRatio || '9:16',
          cameraMotion: 'Tracking Shot',
        },
        {
          sceneNumber: 3,
          title: 'Cảnh 3: Chốt đơn & Kêu gọi (CTA)',
          prompt: scene3Prompt,
          durationSec: flowConfig.duration || 4,
          aspectRatio: flowConfig.aspectRatio || '9:16',
          cameraMotion: 'Slow Push In',
        },
      ]

      return nds.map((n) => {
        if (n.id === 'node-gpt') {
          return {
            ...n,
            data: {
              ...n.data,
              activeScriptIndex: scriptIdx,
            },
          }
        }
        if (n.id === 'node-flow-studio') {
          return {
            ...n,
            data: {
              ...n.data,
              scenes: newScenes,
              activeSceneIndex: 0,
              selectedGptScriptAngle: `${targetScript.angle} (Chia 3 phân đoạn)`,
            },
          }
        }
        return n
      })
    })
  }, [veoVideoConfig])

  // handleApplyGptScriptToVeo: mặc định đẩy cả 3 kịch bản đầy đủ text
  const handleApplyGptScriptToVeo = useCallback((scriptIdx?: number) => {
    handleApplyAllGptScriptsToVeo()
  }, [handleApplyAllGptScriptsToVeo])

  const handleSaveVeoConfig = useCallback((config: VeoVideoConfig, scriptIdx?: number) => {
    setVeoVideoConfig(config)
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === 'node-flow-studio') {
          const currentScenes = ((n.data?.scenes as GeneratedSceneItem[]) || []).map((sc) => ({
            ...sc,
            aspectRatio: config.aspectRatio || sc.aspectRatio,
            durationSec: config.duration || sc.durationSec,
          }))
          return {
            ...n,
            data: {
              ...n.data,
              videoConfig: config,
              aspectRatio: config.aspectRatio,
              resolution: config.resolution,
              scenes: currentScenes,
            },
          }
        }
        return n
      })
    )
    if (scriptIdx !== undefined) {
      handleApplyAllGptScriptsToVeo()
    }
  }, [handleApplyAllGptScriptsToVeo])

  // Update prompt in Gemini node
  const handleGeminiPromptChange = useCallback((nodeId: string, prompt: string) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, prompt } } : n))
    )
  }, [])

  // Reset prompt to backend default
  const handleResetGeminiPrompt = useCallback((nodeId: string) => {
    fetch(`${API_URL}/api/workflow/prompts/gemini`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.prompt) {
          setNodes((nds) =>
            nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, prompt: data.prompt } } : n))
          )
        }
      })
      .catch((err) => console.error(err))
  }, [])

  // Reset GPT prompt to backend default
  const handleResetGptPrompt = useCallback((nodeId: string) => {
    fetch(`${API_URL}/api/workflow/prompts/gpt`)
      .then((r) => r.json())
      .then((data) => {
        if (data?.prompt) {
          setNodes((nds) =>
            nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, prompt: data.prompt } } : n))
          )
        }
      })
      .catch((err) => console.error(err))
  }, [])

  // Trigger Gemini Analysis directly via Backend API
  const handleAnalyzeGemini = useCallback(async (nodeId: string) => {
    let validImages: string[] = []
    let promptToSend = ''

    setNodes((nds) => {
      const targetNode = nds.find((n) => n.id === nodeId)
      promptToSend = (targetNode?.data?.prompt as string) || ''
      const connectedEdge = edges.find((e) => e.target === nodeId)
      const sourceNode = connectedEdge ? nds.find((n) => n.id === connectedEdge.source) : null
      const rawImgs = (sourceNode?.data?.images as (string | null)[]) || []
      validImages = rawImgs.filter(Boolean) as string[]

      return nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isAnalyzing: true } } : n))
    })

    try {
      const res = await fetch(`${API_URL}/api/workflow/gemini/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          images: validImages,
          prompt: promptToSend,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Lỗi phân tích Gemini (HTTP ${res.status})`)
      }

      const data = await res.json()
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            return {
              ...n,
              data: {
                ...n.data,
                isAnalyzing: false,
                analysisResult: {
                  raw_text: data.raw_text,
                  productFeatures: data.product_features,
                  classifications: data.classifications,
                  keySellingPoints: data.key_selling_points,
                  suggestedAngles: data.suggested_angles,
                },
              },
            }
          }
          return n
        })
      )
    } catch (err: any) {
      console.error('Gemini Analysis error:', err)
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isAnalyzing: false } } : n))
      )
      alert(err?.message || 'Có lỗi xảy ra khi phân tích bằng Gemini')
    }
  }, [edges])


  // Trigger GPT Script generation via Backend API
  const handleGenerateGptScript = useCallback(async (nodeId: string) => {
    let productDataToSend = ''
    let validImages: string[] = []
    let promptToSend = ''
    let modelToSend = ''

    setNodes((nds) => {
      const gptNode = nds.find((n) => n.id === nodeId)
      promptToSend = (gptNode?.data?.prompt as string) || ''
      modelToSend = (gptNode?.data?.model as string) || 'cx/gpt-5.5'

      // 1. Lấy dữ liệu phân tích từ Gemini (qua edge kết nối hoặc mặc định node-gemini)
      const geminiEdge = edges.find((e) => e.target === nodeId && (e.source === 'node-gemini' || e.targetHandle === 'from-gemini'))
      const geminiNode = geminiEdge ? nds.find((n) => n.id === geminiEdge.source) : nds.find((n) => n.id === 'node-gemini')
      const analysisRes = geminiNode?.data?.analysisResult as any
      if (analysisRes) {
        productDataToSend = typeof analysisRes === 'string'
          ? analysisRes
          : (analysisRes.raw_text || analysisRes.productFeatures || '')
      }

      // 2. Lấy ảnh sản phẩm từ Products node (qua edge kết nối hoặc mặc định node-products)
      const prodEdge = edges.find((e) => e.target === nodeId && (e.source === 'node-products' || e.targetHandle === 'from-products'))
      const productsNode = prodEdge ? nds.find((n) => n.id === prodEdge.source) : nds.find((n) => n.id === 'node-products')
      const rawImgs = (productsNode?.data?.images as (string | null)[]) || []
      validImages = rawImgs.filter(Boolean) as string[]

      return nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isGenerating: true } } : n))
    })

    try {
      const res = await fetch(`${API_URL}/api/workflow/gpt/generate-script`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          product_data: productDataToSend,
          images: validImages,
          prompt_template: promptToSend,
          model: modelToSend,
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.detail || `Lỗi tạo kịch bản GPT (HTTP ${res.status})`)
      }

      const data = await res.json()
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            return {
              ...n,
              data: {
                ...n.data,
                isGenerating: false,
                salesScripts: data.scripts || [],
                rawOutput: data.raw_text,
                activeScriptIndex: 0,
              },
            }
          }
          return n
        })
      )
    } catch (err: any) {
      console.error('GPT Script generation error:', err)
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isGenerating: false } } : n))
      )
      alert(err?.message || 'Có lỗi xảy ra khi tạo kịch bản bằng ChatGPT')
    }
  }, [edges])

  const fallbackRender = useCallback((nodeId: string, sceneIndex: number) => {
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

  // Render single scene inside Flow Studio
  const handleRenderFlowScene = useCallback(async (nodeId: string, sceneIndex: number) => {
    let targetPrompt = ''
    let targetDuration = 4

    setNodes((nds) => {
      const targetNode = nds.find((n) => n.id === nodeId)
      const scenes = ((targetNode?.data?.scenes as GeneratedSceneItem[]) || [])
      const sc = scenes[sceneIndex]
      targetPrompt = sc?.prompt?.trim() || ''
      targetDuration = sc?.durationSec || 4

      return nds.map((n) => {
        if (n.id === nodeId) {
          const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
          if (scs[sceneIndex]) {
            scs[sceneIndex] = { ...scs[sceneIndex], isRendering: true, renderProgress: 20 }
          }
          return { ...n, data: { ...n.data, scenes: scs } }
        }
        return n
      })
    })

    if (!targetPrompt) {
      alert(`⚠️ Cảnh #${sceneIndex + 1} chưa có nội dung prompt! Vui lòng nhập prompt hoặc bấm "Đẩy Kịch Bản Này Sang Veo Flow Studio" trước.`)
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
            if (scs[sceneIndex]) {
              scs[sceneIndex] = { ...scs[sceneIndex], isRendering: false, renderProgress: 0 }
            }
            return { ...n, data: { ...n.data, scenes: scs } }
          }
          return n
        })
      )
      return
    }

    if (activeVeoProject) {
      try {
        const job = await veoApi.submitJob({
          project_id: activeVeoProject.id,
          prompt: targetPrompt,
          model_display_name: veoVideoConfig.model || 'Omni 1.1 Flash',
          input_mode: 'text_to_video',
          aspect_ratio: (veoVideoConfig.aspectRatio || '9:16') as any,
          duration_seconds: targetDuration,
          resolution: veoVideoConfig.resolution || '720p',
          num_outputs: veoVideoConfig.variations || 1,
        })

        let attempts = 0
        const interval = setInterval(async () => {
          attempts++
          try {
            const status = await veoApi.getJobStatus(job.job_id)
            if (!status) return

            if (status.status === 'done') {
              clearInterval(interval)
              const videoUrl = status.output_files?.[0] ? veoApi.getVideoStreamUrl(status.output_files[0]) : ''
              setNodes((nds) =>
                nds.map((n) => {
                  if (n.id === nodeId) {
                    const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
                    if (scs[sceneIndex]) {
                      scs[sceneIndex] = {
                        ...scs[sceneIndex],
                        isRendering: false,
                        renderProgress: 100,
                        videoUrl: videoUrl,
                      }
                    }
                    return { ...n, data: { ...n.data, scenes: scs } }
                  }
                  return n
                })
              )
            } else if (status.status === 'error' || attempts > 20) {
              clearInterval(interval)
              fallbackRender(nodeId, sceneIndex)
            } else {
              setNodes((nds) =>
                nds.map((n) => {
                  if (n.id === nodeId) {
                    const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
                    if (scs[sceneIndex]) {
                      const prog = Math.min(90, (scs[sceneIndex].renderProgress || 20) + 12)
                      scs[sceneIndex] = { ...scs[sceneIndex], renderProgress: prog }
                    }
                    return { ...n, data: { ...n.data, scenes: scs } }
                  }
                  return n
                })
              )
            }
          } catch {
            clearInterval(interval)
            fallbackRender(nodeId, sceneIndex)
          }
        }, 2500)
      } catch (err) {
        console.warn('Veo API error, using simulation fallback:', err)
        fallbackRender(nodeId, sceneIndex)
      }
    } else {
      fallbackRender(nodeId, sceneIndex)
    }
  }, [activeVeoProject, veoVideoConfig, fallbackRender])

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

  // Attach handlers to nodes (onDelete, onChangeImage, onChange, onSetStartNode, etc.)
  const nodesWithHandlers = useMemo(() => {
    return nodes.map((node) => {
      const isStartNode = node.id === startNodeId
      const isOrphan = !connectedNodeIds.has(node.id)
      const baseData = {
        ...node.data,
        isStartNode,
        isOrphan,
        onSetStartNode: () => handleSetStartNode(node.id),
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
        const geminiEdge = edges.find((e) => e.target === node.id)
        const sourceProductNode = geminiEdge ? nodes.find((n) => n.id === geminiEdge.source) : null
        const connectedProductImages = ((sourceProductNode?.data?.images as (string | null)[]) || [])

        return {
          ...node,
          data: {
            ...baseData,
            isConnectedToImages: !!geminiEdge,
            connectedImages: connectedProductImages,
            onChangePrompt: (prompt: string) => handleGeminiPromptChange(node.id, prompt),
            onResetPrompt: () => handleResetGeminiPrompt(node.id),
            onAnalyze: () => handleAnalyzeGemini(node.id),
          },
        }
      }
      if (node.type === 'gptScript') {
        const prodEdge = edges.find((e) => e.target === node.id && (e.source === 'node-products' || e.targetHandle === 'from-products'))
        const sourceProductNode = prodEdge ? nodes.find((n) => n.id === prodEdge.source) : nodes.find((n) => n.id === 'node-products')
        const connectedProductImages = ((sourceProductNode?.data?.images as (string | null)[]) || [])

        const geminiEdge = edges.find((e) => e.target === node.id && (e.source === 'node-gemini' || e.targetHandle === 'from-gemini'))
        const sourceGeminiNode = geminiEdge ? nodes.find((n) => n.id === geminiEdge.source) : nodes.find((n) => n.id === 'node-gemini')
        const hasProductData = !!(sourceGeminiNode?.data?.analysisResult)
        const geminiRes = sourceGeminiNode?.data?.analysisResult as any
        const productDataPreview = geminiRes ? (typeof geminiRes === 'string' ? geminiRes : (geminiRes.raw_text || geminiRes.productFeatures || '')) : ''

        return {
          ...node,
          data: {
            ...baseData,
            connectedImages: connectedProductImages,
            hasProductData,
            productDataPreview,
            onChangePrompt: (val: string) => handleGptPromptChange(node.id, val),
            onResetPrompt: () => handleResetGptPrompt(node.id),
            onGenerate: () => handleGenerateGptScript(node.id),
            onPushToVeo: () => handleApplyAllGptScriptsToVeo(),
            onPushAllToVeo: () => handleApplyAllGptScriptsToVeo(),
            onPushSingleToVeo: (idx: number) => handleApplySingleScriptToCurrentScene(idx),
            onSplitScriptToVeo: (idx: number) => handleSplitSingleScriptToThreeScenes(idx),
          },
        }
      }
      if (node.type === 'veoFlowStudio') {
        const gptNode = nodes.find((n) => n.id === 'node-gpt')
        const availableGptScripts = (gptNode?.data?.salesScripts as GptSalesScriptItem[]) || []

        return {
          ...node,
          data: {
            ...baseData,
            activeProject: activeVeoProject,
            videoConfig: veoVideoConfig,
            availableGptScripts,
            onOpenVeoSetup: () => setIsVeoModalOpen(true),
            onApplyGptScript: (idx: number) => handleApplySingleScriptToCurrentScene(idx),
            onApplyAllGptScripts: () => handleApplyAllGptScriptsToVeo(),
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
    edges,
    startNodeId,
    connectedNodeIds,
    activeVeoProject,
    veoVideoConfig,
    handleProductImageChange,
    handleCharacterSceneChange,
    handleGeminiPromptChange,
    handleResetGeminiPrompt,
    handleGptPromptChange,
    handleResetGptPrompt,
    handleAnalyzeGemini,
    handleGenerateGptScript,
    handleApplyGptScriptToVeo,
    handleApplyAllGptScriptsToVeo,
    handleApplySingleScriptToCurrentScene,
    handleSplitSingleScriptToThreeScenes,
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

  const startNode = nodes.find((n) => n.id === startNodeId)
  const startNodeTitle = (startNode?.data?.title as string) || 'Gemini 2.5'

  const gptNode = nodes.find((n) => n.id === 'node-gpt')
  const availableGptScripts = (gptNode?.data?.salesScripts as GptSalesScriptItem[]) || []

  return (
    <div className="workflow-container">
      <WorkflowToolbar
        onAddNode={handleAddNode}
        onResetLayout={handleResetLayout}
        onSimulateRun={handleSimulateRun}
        onCleanOrphans={handleCleanOrphans}
        orphanCount={orphanCount}
        startNodeTitle={startNodeTitle}
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

      {/* Modal Cấu Hình Google Veo & Flow Project */}
      <VeoSetupModal
        isOpen={isVeoModalOpen}
        onClose={() => setIsVeoModalOpen(false)}
        projects={veoProjects}
        activeProject={activeVeoProject}
        capabilities={veoCapabilities}
        currentConfig={veoVideoConfig}
        availableScripts={availableGptScripts}
        onSelectProject={handleSelectVeoProject}
        onCreateProject={handleCreateVeoProject}
        onDeleteProject={handleDeleteVeoProject}
        onSaveConfig={handleSaveVeoConfig}
      />
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
