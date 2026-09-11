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
import { VideoLibraryModal } from './components/VideoLibraryModal'
import { VideoPlayerModal } from './components/VideoPlayerModal'
import { VeoVideoPickerModal } from './components/VeoVideoPickerModal'
import * as veoApi from '../veo-studio/services/veoApi'
import type { VeoCapabilities, VeoProject } from '../veo-studio/types'
import type { GeneratedSceneItem, GptSalesScriptItem, VeoVideoConfig } from './types'
import type { AssetRef, ExportedVideoItem, ProductAnalysis, SalesScript, ScriptCollection } from './contracts'
import {
  resolveProductAssetsInput,
  resolveCharacterSceneInput,
  resolveGeminiAnalysisInput,
  resolveGptScriptsInput,
} from './services/graphResolver'
import {
  callGeminiAnalysis,
  callRefreshGeminiCookie,
  callCheckGeminiCookieStatus,
  callGptScriptGeneration,
  callWorkflowVideoExport,
  callExtractProfiles,
  callGenerateVoiceover,
  fetchGeminiDefaultPrompt,
  fetchGptDefaultPrompt,
  fetchExportedVideos,
} from './services/workflowApi'
import {
  buildClipPlans,
  DEFAULT_CLIP_DURATION_SECONDS,
  getFullScriptContent,
  isScriptCollectionStale,
  normalizeClipDuration,
} from './services/buildScenePlan'
import { RenderJobController } from './services/renderJobService'
import { runRealWorkflow } from './services/workflowRunner'

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
    duration: DEFAULT_CLIP_DURATION_SECONDS,
    resolution: '720p',
    variations: 1,
    creditCost: 7,
    bgmEnabled: true,
    bgmVolume: 0.10,
  })

  // Exported video library and player modal states
  const [isLibraryOpen, setIsLibraryOpen] = useState(false)
  const [exportedCount, setExportedCount] = useState<number>(0)
  const [previewModalData, setPreviewModalData] = useState<{
    isOpen: boolean
    videoUrl: string
    title?: string
    prompt?: string
  } | null>(null)
  const [videoPickerState, setVideoPickerState] = useState<{
    isOpen: boolean
    nodeId: string
    sceneIndex: number
  } | null>(null)

  // Load exported video count & default BGM tracks on mount
  useEffect(() => {
    fetchExportedVideos().then((items) => {
      setExportedCount(items.length)
    })
    fetch(`${API_URL}/api/bgm`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (Array.isArray(data) && data.length > 0) {
          setVeoVideoConfig((prev) => ({
            ...prev,
            bgmTrackIds: prev.bgmTrackIds && prev.bgmTrackIds.length > 0 ? prev.bgmTrackIds : [data[0].track_id],
          }))
        }
      })
      .catch(() => {})
  }, [])

  const handleOpenPreviewModal = useCallback((videoUrl: string, title?: string, prompt?: string) => {
    setPreviewModalData({ isOpen: true, videoUrl, title, prompt })
  }, [])

  const handleClosePreviewModal = useCallback(() => {
    setPreviewModalData(null)
  }, [])

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
  const handleProductImageChange = useCallback((nodeId: string, index: number, value: string | null, asset?: AssetRef | null) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === nodeId) {
          const prevImages = ((node.data?.images as (string | null)[]) || [null, null, null]).slice()
          prevImages[index] = value
          const prevAssets = ((node.data?.assets as (AssetRef | null)[]) || [null, null, null]).slice()
          if (asset !== undefined) {
            prevAssets[index] = asset
          } else if (value === null) {
            prevAssets[index] = null
          }
          return {
            ...node,
            data: {
              ...node.data,
              images: prevImages,
              assets: prevAssets,
            },
          }
        }
        return node
      })
    )
  }, [])

  // Update character & scene images
  const handleCharacterSceneChange = useCallback(
    (nodeId: string, key: 'modelImage' | 'sceneImage', value: string | null, asset?: AssetRef | null) => {
      setNodes((nds) =>
        nds.map((node) => {
          if (node.id === nodeId) {
            const assetKey = key === 'modelImage' ? 'modelAsset' : 'sceneAsset'
            return {
              ...node,
              data: {
                ...node.data,
                [key]: value,
                [assetKey]: asset !== undefined ? asset : value === null ? null : (node.data as any)?.[assetKey],
              },
            }
          }
          return node
        })
      )
    },
    []
  )

  // Update character & scene canonical profiles (English)
  const handleCharacterSceneProfileChange = useCallback(
    (nodeId: string, key: 'characterProfile' | 'sceneProfile', value: string) => {
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

  // Auto extract profiles using AI
  const handleAutoExtractProfiles = useCallback(
    async (nodeId: string) => {
      const targetNode = nodes.find((n) => n.id === nodeId)
      if (!targetNode) return
      const modelImage = targetNode.data?.modelImage as string | null
      const sceneImage = targetNode.data?.sceneImage as string | null
      if (!modelImage && !sceneImage) {
        alert('Vui lòng tải lên ảnh người mẫu hoặc bối cảnh trước khi trích xuất profile.')
        return
      }

      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isExtractingProfile: true } } : n))
      )

      try {
        const { characterProfile, sceneProfile } = await callExtractProfiles({ modelImage, sceneImage })
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === nodeId) {
              return {
                ...n,
                data: {
                  ...n.data,
                  isExtractingProfile: false,
                  characterProfile: characterProfile || (n.data?.characterProfile as string) || '',
                  sceneProfile: sceneProfile || (n.data?.sceneProfile as string) || '',
                },
              }
            }
            return n
          })
        )
      } catch (err: any) {
        setNodes((nds) =>
          nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isExtractingProfile: false } } : n))
        )
        alert(err?.message || 'Có lỗi khi AI trích xuất profile nhân vật/bối cảnh.')
      }
    },
    [nodes]
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

  // Thời lượng là cấu hình chung để prompt GPT và toàn bộ clip luôn nhất quán.
  const handleFlowStudioUpdateDuration = useCallback((nodeId: string, _index: number, durationSec: number) => {
    setVeoVideoConfig((current) => ({ ...current, duration: durationSec }))
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === nodeId) {
          const clips = ((n.data?.scenes as GeneratedSceneItem[]) || []).map((clip) => ({
            ...clip,
            durationSec,
          }))
          return {
            ...n,
            data: {
              ...n.data,
              videoConfig: { ...(n.data?.videoConfig as VeoVideoConfig | undefined), duration: durationSec },
              scenes: clips,
            },
          }
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

  // Đẩy toàn bộ kịch bản vào các clip Flow theo ánh xạ 1:1.
  const handleApplyAllGptScriptsToVeo = useCallback((sourceGptNodeId?: string) => {
    setNodes((nds) => {
      const gptNode = sourceGptNodeId ? nds.find((n) => n.id === sourceGptNodeId) : nds.find((n) => n.type === 'gptScript')
      const scripts = (gptNode?.data?.salesScripts as GptSalesScriptItem[]) || []
      if (scripts.length === 0) {
        alert('⚠️ Chưa có kịch bản nào từ ChatGPT! Vui lòng nhấn "Sinh Kịch Bản" trước.')
        return nds
      }

      // Tìm node flow studio đích: ưu tiên qua edge nối từ gptNode
      const outgoingEdges = gptNode ? edges.filter((e) => e.source === gptNode.id) : []
      const targetFlow = nds.find((n) => outgoingEdges.some((e) => e.target === n.id && n.type === 'veoFlowStudio')) || nds.find((n) => n.type === 'veoFlowStudio')
      const targetFlowId = targetFlow?.id

      const flowConfig = (targetFlow?.data?.videoConfig as VeoVideoConfig) || veoVideoConfig
      const clipDuration = normalizeClipDuration(flowConfig.duration)
      const collection = gptNode?.data?.scriptCollection as ScriptCollection | undefined
      const outputIsStale = isScriptCollectionStale(collection, {
        count: Number(gptNode?.data?.requestedCount || scripts.length),
        contentMode: (gptNode?.data?.contentMode || 'sales') as any,
        platform: (gptNode?.data?.platform || 'auto') as any,
        clipDurationSeconds: clipDuration,
        promptTemplate: (gptNode?.data?.prompt as string) || '',
        model: (gptNode?.data?.model as string) || 'cx/gpt-5.5',
      })
      if (outputIsStale) {
        alert('⚠️ Cấu hình đã thay đổi sau lần sinh kịch bản. Vui lòng sinh lại kịch bản trước khi đồng bộ sang Google Flow.')
        return nds
      }

      const prodInput = resolveProductAssetsInput({ nodes: nds, edges, targetNodeId: gptNode?.id || '' })
      const charInput = resolveCharacterSceneInput({ nodes: nds, edges, targetNodeId: gptNode?.id || '' })

      const refAssets: AssetRef[] = [
        ...(prodInput.ok && prodInput.data ? prodInput.data.assets : []),
        ...(charInput.ok && charInput.data?.model ? [charInput.data.model] : []),
        ...(charInput.ok && charInput.data?.scene ? [charInput.data.scene] : []),
      ]

      const targetCount = scripts.length
      const clipDurations = Array.from({ length: targetCount }, () => clipDuration)

      const newClips = buildClipPlans({
        scripts: scripts as any,
        sceneConfig: {
          count: targetCount,
          durations: clipDurations,
          aspectRatio: (flowConfig.aspectRatio || '9:16') as any,
        },
        assets: refAssets,
      })

      return nds.map((n) => {
        if (targetFlowId && n.id === targetFlowId) {
          return {
            ...n,
            data: {
              ...n.data,
              scenes: newClips,
              activeSceneIndex: 0,
              selectedGptScriptAngle: `${targetCount} kịch bản → ${targetCount} clip độc lập`,
            },
          }
        }
        return n
      })
    })
  }, [edges, veoVideoConfig])

  // Nạp riêng một kịch bản vào clip đang mở.
  const handleApplySingleScriptToCurrentScene = useCallback((scriptIdx: number, sourceGptNodeId?: string) => {
    setNodes((nds) => {
      const gptNode = sourceGptNodeId ? nds.find((n) => n.id === sourceGptNodeId) : nds.find((n) => n.type === 'gptScript')
      const scripts = (gptNode?.data?.salesScripts as GptSalesScriptItem[]) || []
      const targetScript = scripts[scriptIdx]
      if (!targetScript) return nds

      const fullPrompt = getFullScriptContent(targetScript as SalesScript)
      const outgoingEdges = gptNode ? edges.filter((e) => e.source === gptNode.id) : []
      const targetFlow = nds.find((n) => outgoingEdges.some((e) => e.target === n.id && n.type === 'veoFlowStudio')) || nds.find((n) => n.type === 'veoFlowStudio')
      const targetFlowId = targetFlow?.id
      const targetDuration = normalizeClipDuration(
        (targetFlow?.data?.videoConfig as VeoVideoConfig | undefined)?.duration ?? veoVideoConfig.duration,
      )
      const collection = gptNode?.data?.scriptCollection as ScriptCollection | undefined
      if (isScriptCollectionStale(collection, {
        count: Number(gptNode?.data?.requestedCount || scripts.length),
        contentMode: (gptNode?.data?.contentMode || 'sales') as any,
        platform: (gptNode?.data?.platform || 'auto') as any,
        clipDurationSeconds: targetDuration,
        promptTemplate: (gptNode?.data?.prompt as string) || '',
        model: (gptNode?.data?.model as string) || 'cx/gpt-5.5',
      })) {
        alert('⚠️ Cấu hình đã thay đổi sau lần sinh kịch bản. Vui lòng sinh lại trước khi nạp clip.')
        return nds
      }

      return nds.map((n) => {
        if (gptNode && n.id === gptNode.id) {
          return {
            ...n,
            data: {
              ...n.data,
              activeScriptIndex: scriptIdx,
            },
          }
        }
        if (targetFlowId && n.id === targetFlowId) {
          const currentActive = typeof n.data?.activeSceneIndex === 'number' ? n.data.activeSceneIndex : 0
          const prevScenes = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
          if (prevScenes[currentActive]) {
            prevScenes[currentActive] = {
              ...prevScenes[currentActive],
              title: `${targetScript.title || targetScript.angle}`,
              prompt: fullPrompt,
              videoUrl: null,
              outputFilePath: null,
              thumbnailUrl: null,
              renderStatus: 'idle',
              renderProgress: 0,
              jobId: null,
              errorMessage: null,
              isRendering: false,
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
  }, [edges, veoVideoConfig.duration])

  const handleSaveVeoConfig = useCallback((config: VeoVideoConfig) => {
    setVeoVideoConfig(config)
    setNodes((nds) =>
      nds.map((n) => {
        if (n.type === 'veoFlowStudio') {
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
  }, [])

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

  // Trigger Gemini or 9Router Analysis directly via Backend API (Sử dụng graphResolver & workflowApi)
  const handleAnalyzeGemini = useCallback(async (nodeId: string, provider: 'gemini' | '9router' = 'gemini') => {
    const targetNode = nodes.find((n) => n.id === nodeId)
    const promptToSend = (targetNode?.data?.prompt as string) || ''

    const productRes = resolveProductAssetsInput({
      nodes,
      edges,
      targetNodeId: nodeId,
    })

    if (!productRes.ok || !productRes.data || productRes.data.rawImages.length === 0) {
      const errMsg = productRes.error || 'Vui lòng nạp ít nhất 1 ảnh sản phẩm để phân tích.'
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isAnalyzing: false, analysisError: errMsg } } : n))
      )
      return
    }

    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isAnalyzing: true, analysisError: null } } : n))
    )

    try {
      const data = await callGeminiAnalysis(productRes.data.rawImages, promptToSend, provider)
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            return {
              ...n,
              data: {
                ...n.data,
                isAnalyzing: false,
                analysisResult: data,
                providerUsed: data.providerUsed || provider,
                analysisError: null,
              },
            }
          }
          return n
        })
      )
    } catch (err: any) {
      console.error('Analysis error:', err)
      const errMsg = err?.message || `Có lỗi xảy ra khi phân tích bằng ${provider}`
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isAnalyzing: false, analysisError: errMsg } } : n))
      )
    }
  }, [nodes, edges])

  // Làm mới cookie Gemini ngầm và tự động retry phân tích ngay lập tức
  const handleRefreshGeminiCookie = useCallback(async (nodeId: string) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isRefreshingCookie: true, analysisError: null } } : n))
    )
    try {
      await callRefreshGeminiCookie()
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isRefreshingCookie: false, cookieValid: true } } : n))
      )
      // Tự động retry phân tích với cookie mới!
      await handleAnalyzeGemini(nodeId, 'gemini')
    } catch (err: any) {
      const errMsg = err?.message || 'Làm mới cookie Gemini thất bại'
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isRefreshingCookie: false, analysisError: errMsg } } : n))
      )
    }
  }, [handleAnalyzeGemini])


  // Trigger GPT Script generation via Backend API (Sử dụng graphResolver & Object payload)
  const handleGenerateGptScript = useCallback(async (nodeId: string) => {
    const gptNode = nodes.find((n) => n.id === nodeId)
    const promptToSend = (gptNode?.data?.prompt as string) || ''
    const modelToSend = (gptNode?.data?.model as string) || 'cx/gpt-5.5'

    // 1. Lấy kết quả Gemini phân tích qua graphResolver (KHÔNG hardcode node ID)
    const geminiRes = resolveGeminiAnalysisInput({
      nodes,
      edges,
      targetNodeId: nodeId,
    })

    // 2. Lấy ảnh sản phẩm từ node Products qua graphResolver
    const prodRes = resolveProductAssetsInput({
      nodes,
      edges,
      targetNodeId: nodeId,
    })

    // 3. Lấy bối cảnh & nhân vật (nếu có)
    const charSceneRes = resolveCharacterSceneInput({
      nodes,
      edges,
      targetNodeId: nodeId,
    })

    if (!geminiRes.ok && (!prodRes.ok || !prodRes.data || prodRes.data.rawImages.length === 0)) {
      const errMsg = 'Khối ChatGPT cần kết nối với khối Gemini Vision đã phân tích hoặc khối Ảnh Sản Phẩm.'
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isGenerating: false, scriptError: errMsg } } : n))
      )
      return
    }

    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isGenerating: true, scriptError: null } } : n))
    )

    const gptData = (gptNode?.data || {}) as Record<string, any>
    const requestedCount = typeof gptData.requestedCount === 'number' ? gptData.requestedCount : 3
    const contentMode = gptData.contentMode || 'sales'
    const platform = gptData.platform || 'auto'
    const outgoingFlowEdges = edges.filter((edge) => edge.source === nodeId)
    const targetFlowNode = nodes.find((node) =>
      outgoingFlowEdges.some((edge) => edge.target === node.id && node.type === 'veoFlowStudio')
    )
    const targetFlowConfig = targetFlowNode?.data?.videoConfig as VeoVideoConfig | undefined
    const clipDurationSeconds = normalizeClipDuration(
      targetFlowConfig?.duration ?? veoVideoConfig.duration,
    )

    try {
      const gptRes = await callGptScriptGeneration({
        images: prodRes.ok && prodRes.data ? prodRes.data.rawImages : [],
        productAnalysis: geminiRes.ok ? geminiRes.data : undefined,
        assets: charSceneRes.data,
        scriptConfig: {
          count: requestedCount,
          contentMode: contentMode,
          storyMode: (gptData.storyMode as any) || 'sequential',
          voiceId: gptData.voiceId,
          characterProfile: charSceneRes.data?.characterProfile,
          sceneProfile: charSceneRes.data?.sceneProfile,
          platform,
          clipDurationSeconds,
        },
        promptTemplate: promptToSend,
        model: modelToSend,
      })

      let newClips: GeneratedSceneItem[] | null = null
      if (targetFlowNode && gptRes.scripts?.length > 0) {
        const prodInput = resolveProductAssetsInput({ nodes, edges, targetNodeId: targetFlowNode.id })
        const charInput = resolveCharacterSceneInput({ nodes, edges, targetNodeId: targetFlowNode.id })
        const refAssets: AssetRef[] = [
          ...(prodInput.ok && prodInput.data ? prodInput.data.assets : []),
          ...(charInput.ok && charInput.data?.model ? [charInput.data.model] : []),
          ...(charInput.ok && charInput.data?.scene ? [charInput.data.scene] : []),
        ]
        const targetCount = gptRes.scripts.length
        const clipDurations = Array.from({ length: targetCount }, () => clipDurationSeconds)
        newClips = buildClipPlans({
          scripts: gptRes.scripts,
          sceneConfig: {
            count: targetCount,
            durations: clipDurations,
            aspectRatio: (targetFlowConfig?.aspectRatio || '9:16') as any,
          },
          assets: refAssets,
        })
      }

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            return {
              ...n,
              data: {
                ...n.data,
                isGenerating: false,
                salesScripts: gptRes.scripts,
                scriptCollection: gptRes.collection,
                rawOutput: gptRes.rawText,
                activeScriptIndex: 0,
                scriptError: null,
              },
            }
          }
          if (targetFlowNode && n.id === targetFlowNode.id && newClips) {
            return {
              ...n,
              data: {
                ...n.data,
                scenes: newClips,
                activeSceneIndex: 0,
                selectedGptScriptAngle: `${gptRes.scripts.length} kịch bản → ${gptRes.scripts.length} clip độc lập`,
              },
            }
          }
          return n
        })
      )
    } catch (err: any) {
      console.error('GPT Script generation error:', err)
      const errMsg = err?.message || 'Có lỗi xảy ra khi tạo kịch bản bằng ChatGPT'
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isGenerating: false, scriptError: errMsg } } : n))
      )
    }
  }, [nodes, edges, veoVideoConfig.duration])

  // Toggle Frame Continuity (🔗 Nối tiếp từ End Frame Clip trước)
  const handleToggleChainFrames = useCallback((nodeId: string, sceneIndex: number, enabled: boolean) => {
    setNodes((nds) =>
      nds.map((n) => {
        if (n.id === nodeId) {
          const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
          if (scs[sceneIndex]) {
            scs[sceneIndex] = {
              ...scs[sceneIndex],
              chainFromPrevious: enabled,
            }
          }
          return { ...n, data: { ...n.data, scenes: scs } }
        }
        return n
      })
    )
  }, [])

  // Manual extract last frame (✂️ Cắt lại End Frame của Clip trước)
  const handleExtractSceneLastFrame = useCallback(
    async (nodeId: string, sourceSceneIndex: number) => {
      const targetSceneIndex = sourceSceneIndex + 1
      const targetNode = nodes.find((n) => n.id === nodeId)
      const scenes = (targetNode?.data?.scenes as GeneratedSceneItem[]) || []
      const prevScene = scenes[sourceSceneIndex]
      const targetScene = scenes[targetSceneIndex]

      if (!prevScene) return
      const videoIdOrPath = prevScene.outputFilePath || prevScene.videoUrl
      if (!videoIdOrPath) {
        alert(`⚠️ Clip #${sourceSceneIndex + 1} chưa được tạo video! Vui lòng render Clip #${sourceSceneIndex + 1} trước.`)
        return
      }

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
            if (scs[targetSceneIndex]) {
              scs[targetSceneIndex] = { ...scs[targetSceneIndex], isExtractingFrame: true }
            }
            return { ...n, data: { ...n.data, scenes: scs } }
          }
          return n
        })
      )

      try {
        const frameRes = await veoApi.extractLastFrame(videoIdOrPath)
        if (frameRes.ok) {
          const previewUrl = veoApi.getImageFileUrl(frameRes.image_id)
          setNodes((nds) =>
            nds.map((n) => {
              if (n.id === nodeId) {
                const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
                if (scs[targetSceneIndex]) {
                  scs[targetSceneIndex] = {
                    ...scs[targetSceneIndex],
                    startFramePath: frameRes.file_path,
                    startFramePreviewUrl: previewUrl,
                    chainFromPrevious: true,
                    isExtractingFrame: false,
                  }
                }
                return { ...n, data: { ...n.data, scenes: scs } }
              }
              return n
            })
          )
          return { ok: true, filePath: frameRes.file_path, previewUrl }
        } else {
          throw new Error('Không trích xuất được frame cuối từ video')
        }
      } catch (err: any) {
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === nodeId) {
              const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
              if (scs[targetSceneIndex]) {
                scs[targetSceneIndex] = { ...scs[targetSceneIndex], isExtractingFrame: false }
              }
              return { ...n, data: { ...n.data, scenes: scs } }
            }
            return n
          })
        )
        alert(`Lỗi trích xuất frame cuối của Clip #${sourceSceneIndex + 1}: ${err?.message || err}`)
        return { ok: false, error: err?.message }
      }
    },
    [nodes]
  )

  // Render single scene inside Flow Studio (Hỗ trợ Start Frame chaining nối tiếp giữa các clip)
  const handleRenderFlowScene = useCallback(
    async (nodeId: string, sceneIndex: number) => {
      const targetNode = nodes.find((n) => n.id === nodeId)
      const scenes = (targetNode?.data?.scenes as GeneratedSceneItem[]) || []
      const sc = scenes[sceneIndex]

      if (!sc?.prompt?.trim()) {
        alert(`⚠️ Clip #${sceneIndex + 1} chưa có nội dung prompt! Vui lòng nhập prompt hoặc đồng bộ kịch bản sang Google Flow trước.`)
        return
      }

      if (!activeVeoProject) {
        alert('⚠️ Chưa có Dự án Veo được kích hoạt! Vui lòng chọn hoặc tạo dự án trong "Cấu hình Veo".')
        return
      }

      let activeStartFramePath = sc.startFramePath || null

      // Tự động kiểm tra và cắt start frame nếu là Clip #2+ và tùy chọn nối tiếp đang bật
      if (sceneIndex > 0 && sc.chainFromPrevious !== false) {
        if (!activeStartFramePath) {
          const prevScene = scenes[sceneIndex - 1]
          const prevVideoId = prevScene?.outputFilePath || prevScene?.videoUrl
          if (!prevVideoId) {
            alert(
              `⚠️ Clip #${sceneIndex} chưa được tạo video! Hãy tạo Clip #${sceneIndex} trước để lấy Start Frame nối tiếp, hoặc tắt tùy chọn "Nối tiếp từ End Frame Clip #${sceneIndex}".`
            )
            return
          }

          // Cắt frame từ clip trước
          try {
            const frameRes = await veoApi.extractLastFrame(prevVideoId)
            if (frameRes.ok) {
              activeStartFramePath = frameRes.file_path
              const previewUrl = veoApi.getImageFileUrl(frameRes.image_id)
              setNodes((nds) =>
                nds.map((n) => {
                  if (n.id === nodeId) {
                    const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
                    if (scs[sceneIndex]) {
                      scs[sceneIndex] = {
                        ...scs[sceneIndex],
                        startFramePath: frameRes.file_path,
                        startFramePreviewUrl: previewUrl,
                      }
                    }
                    return { ...n, data: { ...n.data, scenes: scs } }
                  }
                  return n
                })
              )
            }
          } catch (err: any) {
            console.error('Lỗi tự động cắt start frame:', err)
          }
        }
      }

      const prodRes = resolveProductAssetsInput({ nodes, edges, targetNodeId: nodeId })
      const charSceneRes = resolveCharacterSceneInput({ nodes, edges, targetNodeId: nodeId })
      const refAssets: AssetRef[] = [
        ...(prodRes.ok && prodRes.data ? prodRes.data.assets : []),
        ...(charSceneRes.data?.model ? [charSceneRes.data.model] : []),
        ...(charSceneRes.data?.scene ? [charSceneRes.data.scene] : []),
      ]

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
            if (scs[sceneIndex]) {
              scs[sceneIndex] = { ...scs[sceneIndex], isRendering: true, renderProgress: 20 }
            }
            return { ...n, data: { ...n.data, scenes: scs } }
          }
          return n
        })
      )

      const jobController = new RenderJobController()
      const result = await jobController.renderScene({
        scene: {
          sceneNumber: sc.sceneNumber,
          title: sc.title,
          prompt: sc.prompt,
          durationSec: sc.durationSec,
          aspectRatio: sc.aspectRatio,
          cameraMotion: sc.cameraMotion,
          referenceAssets: refAssets,
          startFramePath: activeStartFramePath || undefined,
          startFramePreviewUrl: sc.startFramePreviewUrl || undefined,
        },
        project: activeVeoProject,
        videoConfig: veoVideoConfig,
        referenceAssets: refAssets,
        onProgress: (prog) => {
          setNodes((nds) =>
            nds.map((n) => {
              if (n.id === nodeId) {
                const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
                if (scs[sceneIndex]) {
                  scs[sceneIndex] = { ...scs[sceneIndex], renderProgress: prog }
                }
                return { ...n, data: { ...n.data, scenes: scs } }
              }
              return n
            })
          )
        },
      })

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
            if (scs[sceneIndex]) {
              scs[sceneIndex] = {
                ...scs[sceneIndex],
                isRendering: false,
                renderProgress: result.ok ? 100 : 0,
                videoUrl: result.videoUrl || null,
                outputFilePath: result.outputFilePath || null,
              }
            }
            return { ...n, data: { ...n.data, scenes: scs } }
          }
          return n
        })
      )

      if (result.ok) {
        setExportedCount((prev) => prev + 1)

        // Tự động cắt frame cuối cho clip kế tiếp nếu có và đang bật nối tiếp
        const nextSceneIndex = sceneIndex + 1
        const completedVideoId = result.outputFilePath || result.videoUrl
        if (completedVideoId && nextSceneIndex < scenes.length) {
          const nextScene = scenes[nextSceneIndex]
          if (nextScene && nextScene.chainFromPrevious !== false) {
            try {
              const autoFrameRes = await veoApi.extractLastFrame(completedVideoId)
              if (autoFrameRes.ok) {
                const nextPreviewUrl = veoApi.getImageFileUrl(autoFrameRes.image_id)
                setNodes((nds) =>
                  nds.map((n) => {
                    if (n.id === nodeId) {
                      const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
                      if (scs[nextSceneIndex]) {
                        scs[nextSceneIndex] = {
                          ...scs[nextSceneIndex],
                          startFramePath: autoFrameRes.file_path,
                          startFramePreviewUrl: nextPreviewUrl,
                        }
                      }
                      return { ...n, data: { ...n.data, scenes: scs } }
                    }
                    return n
                  })
                )
              }
            } catch (frameErr) {
              console.warn('Tự động trích xuất frame cho clip kế tiếp thất bại:', frameErr)
            }
          }
        }
      } else {
        alert(`Lỗi tạo Clip #${sceneIndex + 1}: ${result.error}`)
      }
    },
    [nodes, edges, activeVeoProject, veoVideoConfig]
  )

  // Gán trực tiếp clip Veo có sẵn từ thư viện vào một phân cảnh Flow Studio
  const handleAssignVideoToScene = useCallback(
    async (nodeId: string, sceneIndex: number, clip: ExportedVideoItem) => {
      const clipDuration = clip.durationSec && clip.durationSec > 0 ? clip.durationSec : 10
      const clipPath = clip.filePath || clip.videoUrl

      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
            if (scs[sceneIndex]) {
              scs[sceneIndex] = {
                ...scs[sceneIndex],
                videoUrl: clip.videoUrl,
                outputFilePath: clip.filePath,
                durationSec: clipDuration,
                isRendering: false,
                renderProgress: 100,
              }
            }
            return { ...n, data: { ...n.data, scenes: scs } }
          }
          return n
        })
      )

      // Tự động kiểm tra và trích xuất frame cuối cho clip tiếp theo nếu clip sau bật nối tiếp
      const targetNode = nodes.find((n) => n.id === nodeId)
      const scenes = (targetNode?.data?.scenes as GeneratedSceneItem[]) || []
      const nextSceneIndex = sceneIndex + 1

      if (clipPath && nextSceneIndex < scenes.length) {
        const nextScene = scenes[nextSceneIndex]
        if (nextScene && nextScene.chainFromPrevious !== false) {
          try {
            const autoFrameRes = await veoApi.extractLastFrame(clipPath)
            if (autoFrameRes.ok) {
              const nextPreviewUrl = veoApi.getImageFileUrl(autoFrameRes.image_id)
              setNodes((nds) =>
                nds.map((n) => {
                  if (n.id === nodeId) {
                    const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
                    if (scs[nextSceneIndex]) {
                      scs[nextSceneIndex] = {
                        ...scs[nextSceneIndex],
                        startFramePath: autoFrameRes.file_path,
                        startFramePreviewUrl: nextPreviewUrl,
                      }
                    }
                    return { ...n, data: { ...n.data, scenes: scs } }
                  }
                  return n
                })
              )
            }
          } catch (frameErr) {
            console.warn('Tự động trích xuất frame từ clip thư viện cho cảnh kế tiếp thất bại:', frameErr)
          }
        }
      }
    },
    [nodes]
  )

  // Render toàn bộ các clip tuần tự theo chuỗi liên hoàn (Sequential Chain Runner)
  const handleRenderAllFlowScenes = useCallback(
    async (nodeId: string) => {
      const targetNode = nodes.find((n) => n.id === nodeId)
      const initialScenes = ((targetNode?.data?.scenes as GeneratedSceneItem[]) || []).map((s) => ({ ...s }))

      if (initialScenes.length === 0) {
        alert('⚠️ Không có clip nào để render.')
        return
      }

      if (!activeVeoProject) {
        alert('⚠️ Chưa có Dự án Veo được kích hoạt! Vui lòng chọn hoặc tạo dự án trong "Cấu hình Veo".')
        return
      }

      const allDone = initialScenes.length > 0 && initialScenes.every((s) => Boolean(s.videoUrl || s.outputFilePath))
      let forceReRenderAll = false
      if (allDone) {
        const confirmReRender = window.confirm(
          'Tất cả các clip đều đã được tạo thành công! Bạn có muốn render lại toàn bộ từ đầu không?'
        )
        if (!confirmReRender) return
        forceReRenderAll = true
      }

      const prodRes = resolveProductAssetsInput({ nodes, edges, targetNodeId: nodeId })
      const charSceneRes = resolveCharacterSceneInput({ nodes, edges, targetNodeId: nodeId })
      const refAssets: AssetRef[] = [
        ...(prodRes.ok && prodRes.data ? prodRes.data.assets : []),
        ...(charSceneRes.data?.model ? [charSceneRes.data.model] : []),
        ...(charSceneRes.data?.scene ? [charSceneRes.data.scene] : []),
      ]

      let previousVideoOutputFile: string | null = null

      for (let idx = 0; idx < initialScenes.length; idx++) {
        const currentSc = initialScenes[idx]
        const isDone = Boolean(currentSc.videoUrl || currentSc.outputFilePath)

        // 1. Nếu clip này ĐÃ HOÀN THÀNH và không phải chế độ force re-render toàn bộ:
        if (isDone && !forceReRenderAll) {
          previousVideoOutputFile = currentSc.outputFilePath || currentSc.videoUrl || null

          // Tự động kiểm tra và trích xuất frame cho clip kế tiếp nếu clip sau chưa có Start Frame
          const nextIdx = idx + 1
          if (nextIdx < initialScenes.length && previousVideoOutputFile) {
            const nextSc = initialScenes[nextIdx]
            if (nextSc && nextSc.chainFromPrevious !== false && !nextSc.startFramePath) {
              try {
                const frameRes = await veoApi.extractLastFrame(previousVideoOutputFile)
                if (frameRes.ok) {
                  const nextPreviewUrl = veoApi.getImageFileUrl(frameRes.image_id)
                  initialScenes[nextIdx].startFramePath = frameRes.file_path
                  initialScenes[nextIdx].startFramePreviewUrl = nextPreviewUrl
                  setNodes((nds) =>
                    nds.map((n) => {
                      if (n.id === nodeId) {
                        const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
                        if (scs[nextIdx]) {
                          scs[nextIdx] = {
                            ...scs[nextIdx],
                            startFramePath: frameRes.file_path,
                            startFramePreviewUrl: nextPreviewUrl,
                            chainFromPrevious: true,
                          }
                        }
                        return { ...n, data: { ...n.data, scenes: scs } }
                      }
                      return n
                    })
                  )
                }
              } catch (frameErr) {
                console.warn(`Tự động trích xuất frame từ clip #${idx + 1} cho clip #${nextIdx + 1} thất bại:`, frameErr)
              }
            }
          }
          // Bỏ qua clip đã hoàn thành, tiếp tục sang clip tiếp theo
          continue
        }

        // 2. Chuyển tab hiển thị sang clip cần render
        handleFlowStudioSelectScene(nodeId, idx)

        if (!currentSc?.prompt?.trim()) {
          alert(`⚠️ Clip #${idx + 1} chưa có nội dung prompt! Tiến trình liên hoàn dừng lại.`)
          break
        }

        let activeStartFramePath = currentSc.startFramePath || null
        let activePreviewUrl = currentSc.startFramePreviewUrl || null

        // Nếu là clip #2+ và tùy chọn nối tiếp bật, tự động lấy start frame từ video của clip trước nếu chưa có
        if (idx > 0 && currentSc.chainFromPrevious !== false) {
          if (!activeStartFramePath && previousVideoOutputFile) {
            try {
              const frameRes = await veoApi.extractLastFrame(previousVideoOutputFile)
              if (frameRes.ok) {
                activeStartFramePath = frameRes.file_path
                activePreviewUrl = veoApi.getImageFileUrl(frameRes.image_id)
                initialScenes[idx].startFramePath = frameRes.file_path
                initialScenes[idx].startFramePreviewUrl = activePreviewUrl
                setNodes((nds) =>
                  nds.map((n) => {
                    if (n.id === nodeId) {
                      const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
                      if (scs[idx]) {
                        scs[idx] = {
                          ...scs[idx],
                          startFramePath: frameRes.file_path,
                          startFramePreviewUrl: activePreviewUrl,
                          chainFromPrevious: true,
                        }
                      }
                      return { ...n, data: { ...n.data, scenes: scs } }
                    }
                    return n
                  })
                )
              }
            } catch (extractErr) {
              console.error(`Trích xuất frame cho Clip #${idx + 1} thất bại:`, extractErr)
            }
          }
        }

        // Đánh dấu clip đang render
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === nodeId) {
              const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
              if (scs[idx]) {
                scs[idx] = { ...scs[idx], isRendering: true, renderProgress: 20 }
              }
              return { ...n, data: { ...n.data, scenes: scs } }
            }
            return n
          })
        )

        const jobController = new RenderJobController()
        const result = await jobController.renderScene({
          scene: {
            sceneNumber: currentSc.sceneNumber,
            title: currentSc.title,
            prompt: currentSc.prompt,
            durationSec: currentSc.durationSec,
            aspectRatio: currentSc.aspectRatio,
            cameraMotion: currentSc.cameraMotion,
            referenceAssets: refAssets,
            startFramePath: activeStartFramePath || undefined,
            startFramePreviewUrl: activePreviewUrl || undefined,
          },
          project: activeVeoProject,
          videoConfig: veoVideoConfig,
          referenceAssets: refAssets,
          onProgress: (prog) => {
            setNodes((nds) =>
              nds.map((n) => {
                if (n.id === nodeId) {
                  const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
                  if (scs[idx]) {
                    scs[idx] = { ...scs[idx], renderProgress: prog }
                  }
                  return { ...n, data: { ...n.data, scenes: scs } }
                }
                return n
              })
            )
          },
        })

        initialScenes[idx] = {
          ...initialScenes[idx],
          isRendering: false,
          renderProgress: result.ok ? 100 : 0,
          videoUrl: result.videoUrl || null,
          outputFilePath: result.outputFilePath || null,
        }

        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === nodeId) {
              const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
              if (scs[idx]) {
                scs[idx] = {
                  ...scs[idx],
                  isRendering: false,
                  renderProgress: result.ok ? 100 : 0,
                  videoUrl: result.videoUrl || null,
                  outputFilePath: result.outputFilePath || null,
                }
              }
              return { ...n, data: { ...n.data, scenes: scs } }
            }
            return n
          })
        )

        if (!result.ok) {
          alert(`⚠️ Lỗi khi render Clip #${idx + 1}: ${result.error}. Tiến trình liên hoàn tạm dừng.`)
          break
        }

        setExportedCount((prev) => prev + 1)
        previousVideoOutputFile = result.outputFilePath || result.videoUrl || null

        // Tự động cắt frame cuối cho clip kế tiếp nếu có
        const nextIdx = idx + 1
        if (nextIdx < initialScenes.length && previousVideoOutputFile) {
          const nextSc = initialScenes[nextIdx]
          if (nextSc && nextSc.chainFromPrevious !== false) {
            try {
              const autoFrameRes = await veoApi.extractLastFrame(previousVideoOutputFile)
              if (autoFrameRes.ok) {
                const nextPreviewUrl = veoApi.getImageFileUrl(autoFrameRes.image_id)
                initialScenes[nextIdx].startFramePath = autoFrameRes.file_path
                initialScenes[nextIdx].startFramePreviewUrl = nextPreviewUrl
                setNodes((nds) =>
                  nds.map((n) => {
                    if (n.id === nodeId) {
                      const scs = ((n.data?.scenes as GeneratedSceneItem[]) || []).slice()
                      if (scs[nextIdx]) {
                        scs[nextIdx] = {
                          ...scs[nextIdx],
                          startFramePath: autoFrameRes.file_path,
                          startFramePreviewUrl: nextPreviewUrl,
                        }
                      }
                      return { ...n, data: { ...n.data, scenes: scs } }
                    }
                    return n
                  })
                )
              }
            } catch (autoErr) {
              console.warn(`Tự động trích xuất frame cho Clip #${nextIdx + 1} thất bại:`, autoErr)
            }
          }
        }
      }
    },
    [nodes, edges, activeVeoProject, veoVideoConfig, handleFlowStudioSelectScene]
  )

  // Export complete stitched video in Flow Studio (Sử dụng backend FFmpeg concat)
  const handleExportFlowVideo = useCallback(async (nodeId: string) => {
    const targetNode = nodes.find((n) => n.id === nodeId)
    const scenes = (targetNode?.data?.scenes as GeneratedSceneItem[]) || []

    const validVideoPaths = scenes
      .map((s) => s.outputFilePath || s.videoUrl)
      .filter((p): p is string => Boolean(p && p.trim()))

    if (validVideoPaths.length < 2) {
      alert('⚠️ Chưa thể ghép video! Cần ít nhất 2 clip đã tạo thành công trước khi ghép.')
      return
    }

    let currentProg = 12
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isExporting: true, exportProgress: currentProg } } : n))
    )

    const interval = setInterval(() => {
      currentProg = Math.min(currentProg + Math.floor(Math.random() * 8 + 4), 92)
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, exportProgress: currentProg } } : n))
      )
    }, 700)

    try {
      let voiceoverAudioPath = (targetNode?.data?.voiceoverFilePath as string) || (targetNode?.data?.voiceoverUrl as string) || undefined
      const voiceEnabled = veoVideoConfig?.voiceEnabled !== false
      const voiceId = veoVideoConfig?.voiceId || (targetNode?.data?.voiceId as string) || 'bf4bed06c671'

      // Tự động tạo lồng tiếng nếu được bật trong config và chưa có file voiceover
      if (voiceEnabled && !voiceoverAudioPath) {
        try {
          const incomingEdges = edges.filter((e) => e.target === nodeId)
          const sourceGptNode = nodes.find((n) => incomingEdges.some((e) => e.source === n.id && n.type === 'gptScript'))
          const gptScripts = (sourceGptNode?.data?.salesScripts as GptSalesScriptItem[]) || []
          const textsToSpeak: string[] = []
          scenes.forEach((sc, scIdx) => {
            if (sc.outputFilePath || sc.videoUrl) {
              const s = gptScripts[scIdx]
              const txt = s ? (s.voiceover || s.content) : sc.prompt
              if (txt && txt.trim()) textsToSpeak.push(txt.trim())
            }
          })

          if (textsToSpeak.length > 0) {
            const voRes = await callGenerateVoiceover({
              voiceId,
              scripts: textsToSpeak,
              combineAll: true,
            })
            voiceoverAudioPath = voRes.combinedFilePath || voRes.combinedAudioUrl || undefined
            setNodes((nds) =>
              nds.map((n) =>
                n.id === nodeId
                  ? {
                      ...n,
                      data: {
                        ...n.data,
                        voiceId,
                        voiceoverUrl: voRes.combinedAudioUrl,
                        voiceoverFilePath: voRes.combinedFilePath,
                        voiceoverDurationSec: voRes.totalDurationSec,
                      },
                    }
                  : n
              )
            )
          }
        } catch (voErr) {
          console.warn('Auto voiceover generation during export failed, proceeding with video export:', voErr)
        }
      }

      const mixOriginalAudio = false
      const veoAmbientVolume = 0.0
      let bgmTrackIds = veoVideoConfig?.bgmEnabled !== false ? (veoVideoConfig?.bgmTrackIds || []) : []
      if (veoVideoConfig?.bgmEnabled !== false && bgmTrackIds.length === 0) {
        try {
          const bgmRes = await fetch(`${API_URL}/api/bgm`)
          if (bgmRes.ok) {
            const bgmData = await bgmRes.json()
            if (Array.isArray(bgmData) && bgmData.length > 0) {
              bgmTrackIds = [bgmData[0].track_id]
            }
          }
        } catch (e) {
          console.warn('Không thể tự động nạp BGM mặc định:', e)
        }
      }
      const bgmVolume = veoVideoConfig?.bgmVolume ?? 0.10

      const res = await callWorkflowVideoExport(
        validVideoPaths,
        undefined,
        undefined,
        voiceoverAudioPath,
        mixOriginalAudio,
        bgmTrackIds,
        bgmVolume,
        veoAmbientVolume
      )
      clearInterval(interval)
      setExportedCount((prev) => prev + 1)
      setNodes((nds) =>
        nds.map((n) => {
          if (n.id === nodeId) {
            return {
              ...n,
              data: {
                ...n.data,
                isExporting: false,
                exportProgress: 100,
                finalVideoUrl: res.finalVideoUrl,
              },
            }
          }
          return n
        })
      )
    } catch (err: any) {
      clearInterval(interval)
      console.error('Export video error:', err)
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isExporting: false, exportProgress: 0 } } : n))
      )
      alert(err?.message || 'Có lỗi xảy ra khi xuất video hoàn chỉnh bằng FFmpeg.')
    }
  }, [nodes, edges, veoVideoConfig])

  // Generate voiceover from VieNeu-TTS for Flow Studio
  const handleGenerateFlowVoiceover = useCallback(
    async (nodeId: string) => {
      const targetNode = nodes.find((n) => n.id === nodeId)
      if (!targetNode) return

      // Find incoming GPT node to extract voiceover scripts & voiceId
      const incomingEdges = edges.filter((e) => e.target === nodeId)
      const sourceGptNode = nodes.find((n) => incomingEdges.some((e) => e.source === n.id && n.type === 'gptScript'))
      const voiceId = (sourceGptNode?.data?.voiceId as string) || (targetNode.data?.voiceId as string) || 'Ads_Female'

      const gptScripts = (sourceGptNode?.data?.salesScripts as GptSalesScriptItem[]) || []
      const scenes = (targetNode.data?.scenes as GeneratedSceneItem[]) || []

      const completedScenes = scenes.filter((s) => Boolean((s.outputFilePath || s.videoUrl)?.trim()))
      const filterToCompleted = completedScenes.length >= 2 && completedScenes.length < scenes.length

      // Lấy lời thoại từ kịch bản hoặc phân cảnh
      const textsToSpeak: string[] = []
      scenes.forEach((sc, scIdx) => {
        if (!filterToCompleted || Boolean((sc.outputFilePath || sc.videoUrl)?.trim())) {
          const s = gptScripts[scIdx]
          const txt = s ? (s.voiceover || s.content) : sc.prompt
          if (txt && txt.trim()) textsToSpeak.push(txt.trim())
        }
      })

      if (textsToSpeak.length === 0) {
        alert('⚠️ Chưa có nội dung lời thoại (Voiceover) để đọc! Hãy tạo kịch bản bán hàng bằng ChatGPT trước.')
        return
      }

      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isGeneratingVoiceover: true } } : n))
      )

      try {
        const res = await callGenerateVoiceover({
          voiceId,
          scripts: textsToSpeak,
          combineAll: true,
        })
        setNodes((nds) =>
          nds.map((n) => {
            if (n.id === nodeId) {
              return {
                ...n,
                data: {
                  ...n.data,
                  isGeneratingVoiceover: false,
                  voiceId,
                  voiceoverUrl: res.combinedAudioUrl,
                  voiceoverFilePath: res.combinedFilePath,
                  voiceoverDurationSec: res.totalDurationSec,
                },
              }
            }
            return n
          })
        )
      } catch (err: any) {
        setNodes((nds) =>
          nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, isGeneratingVoiceover: false } } : n))
        )
        alert(err?.message || 'Có lỗi khi tạo giọng đọc từ VieNeu-TTS.')
      }
    },
    [nodes, edges]
  )

  const handleToggleFlowMixAudio = useCallback((nodeId: string, mix: boolean) => {
    setNodes((nds) =>
      nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, mixOriginalAudio: mix } } : n))
    )
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
            title: 'Sản Phẩm',
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
            title: 'Gemini • Phân Tích',
            model: 'gemini-2.5-flash',
            provider: 'Trích xuất chi tiết & bao bì',
            analysisResult: null,
          },
        }
      } else if (type === 'gptScript') {
        newNode = {
          id,
          type,
          position: { x, y },
          data: {
            title: 'ChatGPT • Kịch Bản',
            model: 'cx/gpt-5.5',
            provider: 'Viết phân cảnh & lời thoại',
            prompt: '',
            requestedCount: 3,
            contentMode: 'sales',
            platform: 'auto',
            salesScripts: [],
          },
        }
      } else {
        newNode = {
          id,
          type: 'veoFlowStudio',
          position: { x, y },
          data: {
            title: 'Veo AI • Tạo Video',
            model: 'Omni 1.1 Flash',
            activeSceneIndex: 0,
            aspectRatio: '9:16',
            resolution: '1080p',
            scenes: [
              {
                sceneNumber: 1,
                title: 'Clip #1',
                prompt: '',
                durationSec: DEFAULT_CLIP_DURATION_SECONDS,
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

  // Real Workflow Execution using DAG traversal & Data Contracts
  const handleExecuteWorkflow = useCallback(async () => {
    if (isRunning) return
    setIsRunning(true)
    try {
      await runRealWorkflow({
        startNodeId,
        nodes,
        edges,
        callbacks: {
          onNodeStateChange: (nodeId, patch) => {
            setNodes((prevNodes) =>
              prevNodes.map((n) =>
                n.id === nodeId
                  ? { ...n, data: { ...n.data, ...patch } }
                  : n
              )
            )
          },
          onError: (nodeId, errMsg) => {
            alert(`Lỗi tại node [${nodeId}]: ${errMsg}`)
          },
          onSuccess: () => {
            console.log('Workflow execution completed successfully.')
          },
        },
      })
    } catch (err: any) {
      alert(err?.message || 'Có lỗi xảy ra khi chạy workflow.')
    } finally {
      setIsRunning(false)
    }
  }, [isRunning, startNodeId, nodes, edges])

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
            onChangeImage: (idx: number, url: string | null, asset?: AssetRef) =>
              handleProductImageChange(node.id, idx, url, asset),
          },
        }
      }
      if (node.type === 'characterScene') {
        return {
          ...node,
          data: {
            ...baseData,
            onChange: (key: 'modelImage' | 'sceneImage', val: string | null, asset?: AssetRef) =>
              handleCharacterSceneChange(node.id, key, val, asset),
            onChangeProfile: (key: 'characterProfile' | 'sceneProfile', val: string) =>
              handleCharacterSceneProfileChange(node.id, key, val),
            onAutoExtractProfile: () => handleAutoExtractProfiles(node.id),
          },
        }
      }
      if (node.type === 'geminiAnalysis') {
        const prodRes = resolveProductAssetsInput({ nodes, edges, targetNodeId: node.id })
        const isConnectedToImages = prodRes.ok
        const connectedProductImages = prodRes.ok && prodRes.data ? prodRes.data.rawImages : []

        return {
          ...node,
          data: {
            ...baseData,
            isConnectedToImages,
            connectedImages: connectedProductImages,
            onChangePrompt: (prompt: string) => handleGeminiPromptChange(node.id, prompt),
            onResetPrompt: () => handleResetGeminiPrompt(node.id),
            onAnalyze: () => handleAnalyzeGemini(node.id, 'gemini'),
            onRefreshCookie: () => handleRefreshGeminiCookie(node.id),
            onAnalyze9Router: () => handleAnalyzeGemini(node.id, '9router'),
          },
        }
      }
      if (node.type === 'gptScript') {
        const prodRes = resolveProductAssetsInput({ nodes, edges, targetNodeId: node.id })
        const connectedProductImages = prodRes.ok && prodRes.data ? prodRes.data.rawImages : []
        const outgoingFlowEdges = edges.filter((edge) => edge.source === node.id)
        const targetFlowNode = nodes.find((candidate) =>
          outgoingFlowEdges.some((edge) => edge.target === candidate.id && candidate.type === 'veoFlowStudio')
        )
        const targetFlowConfig = targetFlowNode?.data?.videoConfig as VeoVideoConfig | undefined
        const clipDurationSeconds = normalizeClipDuration(
          targetFlowConfig?.duration ?? veoVideoConfig.duration,
        )
        const scriptCollection = node.data?.scriptCollection as ScriptCollection | undefined
        const isScriptOutputStale = isScriptCollectionStale(scriptCollection, {
          count: Number(node.data?.requestedCount || 3),
          contentMode: (node.data?.contentMode || 'sales') as any,
          platform: (node.data?.platform || 'auto') as any,
          clipDurationSeconds,
          promptTemplate: (node.data?.prompt as string) || '',
          model: (node.data?.model as string) || 'cx/gpt-5.5',
        })

        const geminiRes = resolveGeminiAnalysisInput({ nodes, edges, targetNodeId: node.id })
        const hasProductData = geminiRes.ok && !!geminiRes.data
        const productDataPreview =
          geminiRes.ok && geminiRes.data
            ? geminiRes.data.rawText || (geminiRes.data.features || []).join(', ') || ''
            : ''

        return {
          ...node,
          data: {
            ...baseData,
            connectedImages: connectedProductImages,
            hasProductData,
            productDataPreview,
            clipDurationSeconds,
            isScriptOutputStale,
            onChangePrompt: (val: string) => handleGptPromptChange(node.id, val),
            onResetPrompt: () => handleResetGptPrompt(node.id),
            onGenerate: () => handleGenerateGptScript(node.id),
            onChangeScriptConfig: (cfg: { count?: number; contentMode?: any; platform?: any }) => {
              setNodes((nds) =>
                nds.map((n) =>
                  n.id === node.id
                    ? {
                        ...n,
                        data: {
                          ...n.data,
                          requestedCount: cfg.count ?? n.data?.requestedCount,
                          contentMode: cfg.contentMode ?? n.data?.contentMode,
                          platform: cfg.platform ?? n.data?.platform,
                        },
                      }
                    : n
                )
              )
            },
            onPushToVeo: () => handleApplyAllGptScriptsToVeo(node.id),
            onPushAllToVeo: () => handleApplyAllGptScriptsToVeo(node.id),
            onPushSingleToVeo: (idx: number) => handleApplySingleScriptToCurrentScene(idx, node.id),
          },
        }
      }
      if (node.type === 'veoFlowStudio') {
        const gptRes = resolveGptScriptsInput({ nodes, edges, targetNodeId: node.id })
        const availableGptScripts = gptRes.ok && gptRes.data ? (gptRes.data as GptSalesScriptItem[]) : []
        const sourceGptNode = nodes.find((candidate) =>
          candidate.type === 'gptScript' &&
          edges.some((edge) => edge.target === node.id && edge.source === candidate.id)
        )
        const sourceCollection = sourceGptNode?.data?.scriptCollection as ScriptCollection | undefined
        const isSourceScriptStale = sourceGptNode
          ? isScriptCollectionStale(sourceCollection, {
              count: Number(sourceGptNode.data?.requestedCount || availableGptScripts.length),
              contentMode: (sourceGptNode.data?.contentMode || 'sales') as any,
              platform: (sourceGptNode.data?.platform || 'auto') as any,
              clipDurationSeconds: veoVideoConfig.duration,
              promptTemplate: (sourceGptNode.data?.prompt as string) || '',
              model: (sourceGptNode.data?.model as string) || 'cx/gpt-5.5',
            })
          : false
        const durationOptions = [...new Set(
          (veoCapabilities?.profiles || [])
            .filter((profile) =>
              profile.input_mode === 'text_to_video' &&
              profile.model_display_name === veoVideoConfig.model &&
              profile.aspect_ratio === veoVideoConfig.aspectRatio &&
              profile.resolution === veoVideoConfig.resolution
            )
            .map((profile) => profile.duration_seconds)
        )].sort((a, b) => a - b)

        const prodRes = resolveProductAssetsInput({ nodes, edges, targetNodeId: node.id })
        const prodNode = nodes.find(
          (n) =>
            n.type === 'productAssets' &&
            (edges.some((e) => e.target === node.id && e.source === n.id) ||
              (sourceGptNode && edges.some((e) => e.target === sourceGptNode.id && e.source === n.id)))
        )
        const productUrls = (
          prodRes.ok && prodRes.data?.rawImages?.length
            ? prodRes.data.rawImages
            : ((prodNode?.data?.images as (string | null)[]) || [])
        ).filter((u): u is string => Boolean(u && u.trim()))

        const charRes = resolveCharacterSceneInput({ nodes, edges, targetNodeId: node.id })
        const charNode = nodes.find(
          (n) =>
            n.type === 'characterScene' &&
            (edges.some((e) => e.target === node.id && e.source === n.id) ||
              (sourceGptNode && edges.some((e) => e.target === sourceGptNode.id && e.source === n.id)))
        )
        const modelUrl =
          (charRes.data?.model as any)?.previewUrl ||
          (charNode?.data?.modelAsset as any)?.previewUrl ||
          (charNode?.data?.modelImage as string) ||
          (charRes.data?.model as any)?.url ||
          null
        const sceneUrl =
          (charRes.data?.scene as any)?.previewUrl ||
          (charNode?.data?.sceneAsset as any)?.previewUrl ||
          (charNode?.data?.sceneImage as string) ||
          (charRes.data?.scene as any)?.url ||
          null

        const refImages = {
          productUrls,
          modelUrl,
          sceneUrl,
        }

        const voiceId = (sourceGptNode?.data?.voiceId as string) || (node.data?.voiceId as string) || undefined
        const voiceoverUrl = node.data?.voiceoverUrl as string | null | undefined
        const voiceoverFilePath = node.data?.voiceoverFilePath as string | null | undefined
        const voiceoverDurationSec = node.data?.voiceoverDurationSec as number | undefined
        const isGeneratingVoiceover = Boolean(node.data?.isGeneratingVoiceover)
        const mixOriginalAudio = false

        return {
          ...node,
          data: {
            ...baseData,
            activeProject: activeVeoProject,
            videoConfig: veoVideoConfig,
            durationOptions: durationOptions.length > 0 ? durationOptions : [veoVideoConfig.duration],
            isSourceScriptStale,
            availableGptScripts,
            refImages,
            exportedCount,
            voiceId,
            voiceoverUrl,
            voiceoverFilePath,
            voiceoverDurationSec,
            isGeneratingVoiceover,
            mixOriginalAudio,
            onOpenVeoSetup: () => setIsVeoModalOpen(true),
            onOpenLibrary: () => setIsLibraryOpen(true),
            onOpenPreviewModal: handleOpenPreviewModal,
            onApplyGptScript: (idx: number) => handleApplySingleScriptToCurrentScene(idx),
            onApplyAllGptScripts: () => handleApplyAllGptScriptsToVeo(),
            onSelectScene: (idx: number) => handleFlowStudioSelectScene(node.id, idx),
            onUpdateScenePrompt: (idx: number, p: string) => handleFlowStudioUpdatePrompt(node.id, idx, p),
            onUpdateSceneDuration: (idx: number, d: number) => handleFlowStudioUpdateDuration(node.id, idx, d),
            onRenderScene: (idx: number) => handleRenderFlowScene(node.id, idx),
            onRenderAllScenes: () => handleRenderAllFlowScenes(node.id),
            onExtractLastFrame: (idx: number) => handleExtractSceneLastFrame(node.id, idx),
            onToggleChainFrames: (idx: number, enabled: boolean) => handleToggleChainFrames(node.id, idx, enabled),
            onGenerateVoiceover: () => handleGenerateFlowVoiceover(node.id),
            onToggleMixAudio: (mix: boolean) => handleToggleFlowMixAudio(node.id, mix),
            onExportVideo: () => handleExportFlowVideo(node.id),
            onOpenVideoPicker: (idx: number) => {
              setVideoPickerState({
                isOpen: true,
                nodeId: node.id,
                sceneIndex: idx,
              })
            },
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
    veoCapabilities,
    handleProductImageChange,
    handleCharacterSceneChange,
    handleCharacterSceneProfileChange,
    handleAutoExtractProfiles,
    handleGeminiPromptChange,
    handleResetGeminiPrompt,
    handleGptPromptChange,
    handleResetGptPrompt,
    handleAnalyzeGemini,
    handleRefreshGeminiCookie,
    handleGenerateGptScript,
    handleApplyAllGptScriptsToVeo,
    handleApplySingleScriptToCurrentScene,
    handleFlowStudioSelectScene,
    handleFlowStudioUpdatePrompt,
    handleFlowStudioUpdateDuration,
    handleRenderFlowScene,
    handleRenderAllFlowScenes,
    handleExtractSceneLastFrame,
    handleToggleChainFrames,
    handleGenerateFlowVoiceover,
    handleToggleFlowMixAudio,
    handleExportFlowVideo,
    handleDeleteNode,
    handleSetStartNode,
    handleOpenPreviewModal,
    handleAssignVideoToScene,
    exportedCount,
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
  const rawTitle = (startNode?.data?.title as string) || 'Gemini'
  const startNodeTitle = rawTitle.includes('•')
    ? rawTitle.split('•')[0].trim()
    : rawTitle.replace(/\s*\(.*\)/, '').trim()

  const gptNode = nodes.find((n) => n.type === 'gptScript')
  const availableGptScripts = (gptNode?.data?.salesScripts as GptSalesScriptItem[]) || []

  return (
    <div className="workflow-container">
      <WorkflowToolbar
        onResetLayout={handleResetLayout}
        onSimulateRun={handleExecuteWorkflow}
        onCleanOrphans={handleCleanOrphans}
        orphanCount={orphanCount}
        startNodeTitle={startNodeTitle}
        isRunning={isRunning}
        onOpenLibrary={() => setIsLibraryOpen(true)}
        exportedCount={exportedCount}
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
      {isVeoModalOpen && (
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
      )}

      {/* Modal Thư Viện Video Đã Xuất */}
      {isLibraryOpen && (
        <VideoLibraryModal
          isOpen={isLibraryOpen}
          onClose={() => setIsLibraryOpen(false)}
          onVideoCountChange={(count) => setExportedCount(count)}
        />
      )}

      {/* Modal Chọn Video từ Thư Viện để Gán vào Phân Cảnh Flow Studio */}
      {Boolean(videoPickerState?.isOpen) && (
        <VeoVideoPickerModal
          isOpen={Boolean(videoPickerState?.isOpen)}
          onClose={() => setVideoPickerState(null)}
          targetSceneIndex={videoPickerState?.sceneIndex ?? 0}
          onSelectClip={(clip) => {
            if (videoPickerState) {
              handleAssignVideoToScene(videoPickerState.nodeId, videoPickerState.sceneIndex, clip)
              setVideoPickerState(null)
            }
          }}
        />
      )}

      {/* Modal Toàn Cảnh Xem Video (Không bị cắt/crop) */}
      {Boolean(previewModalData?.isOpen) && (
        <VideoPlayerModal
          isOpen={Boolean(previewModalData?.isOpen)}
          onClose={handleClosePreviewModal}
          videoUrl={previewModalData?.videoUrl || ''}
          title={previewModalData?.title}
          prompt={previewModalData?.prompt}
        />
      )}
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
