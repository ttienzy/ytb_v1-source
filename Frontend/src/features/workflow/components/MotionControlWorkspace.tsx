import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Controls,
  Background,
  applyNodeChanges,
  applyEdgeChanges,
  addEdge,
  Connection,
  Edge,
  Node,
  NodeChange,
  EdgeChange,
  BackgroundVariant,
} from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import '../motionFlow.css'
import { RemovableEdge } from '../edges/RemovableEdge'
import {
  Image as ImageIcon,
  Video as VideoIcon,
  FileText,
  GitMerge,
  Sparkles,
  Play,
  RotateCw,
  Film,
  Sliders,
} from 'lucide-react'

// Custom Nodes for Motion Control Studio
import { MotionReferenceGroupNode } from '../nodes/motion/MotionReferenceGroupNode'
import { MotionCreativeDirectionNode } from '../nodes/motion/MotionCreativeDirectionNode'
import { MotionPromptPreviewNode } from '../nodes/motion/MotionPromptPreviewNode'
import { MotionOutputNode } from '../nodes/motion/MotionOutputNode'

// Services & Types
import { buildStructuredPrompt, DEFAULT_MOTION_CREATIVE_DIRECTION } from '../services/motionPromptBuilder'
import { fetchMotionDefaultPrompt } from '../services/workflowApi'
import { findMotionProfile, getMotionTrimDuration, getVideoEditProfiles } from '../services/motionProfiles'
import { motionRunErrorFromJob, motionRunErrorFromUnknown } from '../services/motionRunError'
import type {
  MotionReferenceAsset,
  MotionCreativeDirection,
  MotionOutputConfig,
  MotionRunError,
  MotionRunStage,
} from '../types'
import {
  getBridgeStatus,
  getActiveProject,
  getCapabilities,
  createProject,
  uploadImage,
  uploadVideoReference,
  submitJob,
  getJobStatus,
  getVideoStreamUrl,
} from '../../veo-studio/services/veoApi'
import type { VeoCapabilityProfile, VeoProject, VeoImageItem } from '../../veo-studio/types'
import { API_URL } from '../../../shared/constants'
import type { ExportedVideoItem, AssetRef } from '../contracts'
import { MotionInspectorPanel } from './MotionInspectorPanel'
import { VeoImagePickerModal } from './VeoImagePickerModal'
import { VeoVideoPickerModal } from './VeoVideoPickerModal'

interface MotionControlWorkspaceProps {
  projects?: VeoProject[]
  activeProject?: VeoProject | null
  onSelectProject?: (projectId: string) => Promise<void> | void
  onProjectCreated?: (project: VeoProject) => Promise<void> | void
  onOpenLibrary?: () => void
  onOpenPreviewModal?: (videoUrl: string, title?: string, prompt?: string, referenceVideoUrl?: string | null) => void
}

// Node types mapping for React Flow
const nodeTypes = {
  motionRefGroup: MotionReferenceGroupNode,
  motionCreative: MotionCreativeDirectionNode,
  motionPreview: MotionPromptPreviewNode,
  motionOutput: MotionOutputNode,
}

const edgeTypes = {
  removable: RemovableEdge,
}

export function MotionControlWorkspace({
  projects = [],
  activeProject: selectedProject,
  onSelectProject,
  onProjectCreated,
  onOpenLibrary,
  onOpenPreviewModal,
}: MotionControlWorkspaceProps) {
  const [workflowName, setWorkflowName] = useState('Motion Control mới')
  const [searchQuery, setSearchQuery] = useState('')
  const [isRunning, setIsRunning] = useState(false)
  const [runningStageText, setRunningStageText] = useState('')
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const toastTimerRef = useRef<NodeJS.Timeout | null>(null)
  const [resultVideoUrl, setResultVideoUrl] = useState<string | null>(null)
  const [runError, setRunError] = useState<MotionRunError | null>(null)
  // State update không đồng bộ; ref này chặn double-click ngay trong cùng tick.
  const runLockRef = useRef(false)

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current)
    setToastMsg(msg)
    toastTimerRef.current = setTimeout(() => setToastMsg(null), 3000)
  }, [])

  // -------------------------------------------------------------
  // 1. Reference Assets State (Ingredients)
  // -------------------------------------------------------------
  const [characterAsset, setCharacterAsset] = useState<MotionReferenceAsset>({
    id: 'ref-char',
    role: 'character',
    title: 'Ảnh Nhân Vật',
    required: false,
    filled: false,
    previewUrl: null,
    fileName: '',
  })

  const [motionAsset, setMotionAsset] = useState<MotionReferenceAsset>({
    id: 'ref-motion',
    role: 'motion',
    title: 'Video Chuyển Động',
    required: true,
    filled: false,
    previewUrl: null,
    fileName: '',
    trimStartSec: 0,
    trimEndSec: 10,
  })

  const [sceneAsset, setSceneAsset] = useState<MotionReferenceAsset>({
    id: 'ref-scene',
    role: 'scene',
    title: 'Ảnh Bối Cảnh',
    required: false,
    filled: false,
    previewUrl: null,
    fileName: '',
  })

  // -------------------------------------------------------------
  // 2. Creative Direction State (Director's Brief)
  // -------------------------------------------------------------
  const [creativeDirection, setCreativeDirection] = useState<MotionCreativeDirection>(DEFAULT_MOTION_CREATIVE_DIRECTION)

  // -------------------------------------------------------------
  // 3. Output Format Config
  // -------------------------------------------------------------
  const [outputConfig, setOutputConfig] = useState<MotionOutputConfig>({
    aspectRatio: '9:16',
    durationSeconds: 10,
    resolution: '360p',
    numOutputs: 1,
    projectMode: 'new_per_run',
    projectNamePrefix: 'Motion Control',
    freshAssets: true,
    showReferenceComparison: true,
  })
  const [videoEditProfiles, setVideoEditProfiles] = useState<VeoCapabilityProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [profileError, setProfileError] = useState<string | null>(null)
  const [bridgeConnected, setBridgeConnected] = useState<boolean | null>(null)
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [lastRunProject, setLastRunProject] = useState<VeoProject | null>(null)

  const applyProfile = useCallback((profile: VeoCapabilityProfile) => {
    setSelectedProfileId(profile.id)
    setOutputConfig((previous) => ({
      ...previous,
      profileId: profile.id,
      modelDisplayName: profile.model_display_name,
      aspectRatio: profile.aspect_ratio,
      durationSeconds: previous.durationSeconds,
      resolution: profile.resolution as MotionOutputConfig['resolution'],
      numOutputs: profile.num_outputs,
      creditCost: profile.credit_cost,
    }))
  }, [])

  const handleCreateMotionProject = useCallback(async (name: string) => {
    const cleanName = name.trim()
    if (!cleanName) throw new Error('Tên Flow project không được để trống.')
    setIsCreatingProject(true)
    try {
      const created = await createProject(cleanName)
      setLastRunProject(created)
      await onProjectCreated?.(created)
      return created
    } finally {
      setIsCreatingProject(false)
    }
  }, [onProjectCreated])

  useEffect(() => {
    let cancelled = false

    const loadBackendState = async () => {
      const [capabilitiesResult, bridgeResult] = await Promise.allSettled([
        getCapabilities(),
        getBridgeStatus(),
      ])
      if (cancelled) return

      if (capabilitiesResult.status === 'fulfilled') {
        const profiles = getVideoEditProfiles(capabilitiesResult.value.profiles)
        setVideoEditProfiles(profiles)
        const preferredProfile = profiles.find((profile) => profile.runtime_verified) || profiles[0]
        if (preferredProfile) {
          applyProfile(preferredProfile)
          setProfileError(null)
        } else {
          setProfileError('Backend chưa công bố profile video_edit cho Motion Control.')
        }
      } else {
        setProfileError(capabilitiesResult.reason?.message || 'Không tải được cấu hình Motion Control từ Backend.')
      }

      if (bridgeResult.status === 'fulfilled') {
        setBridgeConnected(Boolean(bridgeResult.value.bridge_running && bridgeResult.value.extension.connected))
      } else {
        setBridgeConnected(false)
      }

      // Tự động đồng bộ prompt mặc định từ file Backend nếu có
      try {
        const defaultPrompt = await fetchMotionDefaultPrompt()
        if (!cancelled && defaultPrompt && defaultPrompt.trim()) {
          setCreativeDirection((prev) => {
            if (!prev.creativeBrief || prev.creativeBrief === DEFAULT_MOTION_CREATIVE_DIRECTION.creativeBrief) {
              return {
                ...prev,
                creativeBrief: defaultPrompt.trim(),
              }
            }
            return prev
          })
        }
      } catch (err) {
        console.debug('Không thể nạp prompt mặc định từ backend:', err)
      }
    }

    void loadBackendState()
    return () => {
      cancelled = true
    }
  }, [applyProfile])

  const handleResetDefaultPrompt = useCallback(async () => {
    try {
      const backendPrompt = await fetchMotionDefaultPrompt()
      if (backendPrompt && backendPrompt.trim()) {
        setCreativeDirection({
          ...DEFAULT_MOTION_CREATIVE_DIRECTION,
          creativeBrief: backendPrompt.trim(),
        })
      } else {
        setCreativeDirection(DEFAULT_MOTION_CREATIVE_DIRECTION)
      }
    } catch {
      setCreativeDirection(DEFAULT_MOTION_CREATIVE_DIRECTION)
    }
    setIsCustomPrompt(false)
    setCustomPromptText('')
    showToast('Đã khôi phục prompt Motion Control mặc định an toàn.')
  }, [showToast])

  const selectedProfile = useMemo(
    () => videoEditProfiles.find((profile) => profile.id === selectedProfileId) || null,
    [selectedProfileId, videoEditProfiles]
  )

  const selectProfileForSettings = useCallback((
    aspectRatio: MotionOutputConfig['aspectRatio'],
    resolution: MotionOutputConfig['resolution'],
  ) => {
    const profile = findMotionProfile(videoEditProfiles, aspectRatio, resolution)
    if (profile) {
      applyProfile(profile)
    } else {
      showToast(`Backend chưa hỗ trợ Motion Control ${aspectRatio} ở ${resolution}.`)
    }
  }, [applyProfile, showToast, videoEditProfiles])

  const handleSelectAspectRatio = useCallback((aspectRatio: MotionOutputConfig['aspectRatio']) => {
    selectProfileForSettings(aspectRatio, outputConfig.resolution)
  }, [outputConfig.resolution, selectProfileForSettings])

  const handleSelectResolution = useCallback((resolution: MotionOutputConfig['resolution']) => {
    selectProfileForSettings(outputConfig.aspectRatio, resolution)
  }, [outputConfig.aspectRatio, selectProfileForSettings])

  const handleSelectDuration = useCallback((durationSeconds: number) => {
    setOutputConfig((previous) => ({ ...previous, durationSeconds }))
    setMotionAsset((previous) => ({
      ...previous,
      trimEndSec: (previous.trimStartSec ?? 0) + durationSeconds,
    }))
  }, [])

  // -------------------------------------------------------------
  // 4. Inspector Drawer State
  // -------------------------------------------------------------
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)
  const [selectedNodeType, setSelectedNodeType] = useState<'reference' | 'creative' | 'preview' | 'output' | null>('creative')
  const [activeRole, setActiveRole] = useState<'character' | 'motion' | 'scene'>('motion')

  // -------------------------------------------------------------
  // 5. Prompt Preview & Custom Edit State
  // -------------------------------------------------------------
  const [isCustomPrompt, setIsCustomPrompt] = useState(false)
  const [customPromptText, setCustomPromptText] = useState('')

  const structuredPrompt = useMemo(() => {
    return buildStructuredPrompt(creativeDirection)
  }, [creativeDirection])

  const activePrompt = isCustomPrompt ? customPromptText : structuredPrompt.fullPrompt

  const referencePromptConflict = useMemo(() => {
    if (!characterAsset.filled || !activePrompt.trim()) return null
    const fileHint = characterAsset.fileName.toLowerCase()
    const promptText = activePrompt.toLowerCase()
    const animalHint = /(^|[-_ .])(cat|pig|dog|horse|bird|rabbit|m[eè]o|heo|l[oợ]n|ch[oó]|ng[uườ]i?o)([-_ .]|$)/i.test(fileHint)
    const humanPrompt = /\b(woman|man|girl|boy|person|human|people|ph[uụ] n[uữ]|ng[uườ]i)\b/i.test(promptText)
    if (animalHint && humanPrompt) {
      return `Tên ảnh tham chiếu "${characterAsset.fileName}" có dấu hiệu là động vật nhưng prompt lại mô tả người. Flow có thể trả status 4; hãy chọn đúng ảnh hoặc sửa prompt.`
    }
    return null
  }, [activePrompt, characterAsset.fileName, characterAsset.filled])

  // Readiness evaluation
  const missingReasons = useMemo(() => {
    const reasons: string[] = []
    if (!motionAsset.filled || (!motionAsset.file && !motionAsset.mediaId)) {
      reasons.push('Thiếu Video chuyển động mẫu (bắt buộc trong Motion Control)')
    }
    if (!activePrompt.trim()) {
      reasons.push('Thiếu ý tưởng chính (Creative Brief)')
    }
    if (referencePromptConflict) reasons.push(referencePromptConflict)
    if (!selectedProfile) {
      reasons.push(profileError || 'Chưa có profile video_edit từ Backend')
    }
    if ((outputConfig.projectMode || 'new_per_run') === 'selected' && !selectedProject) {
      reasons.push('Chưa chọn Flow project cho chế độ dùng project hiện có')
    }
    const trimStart = motionAsset.trimStartSec ?? 0
    const trimEnd = motionAsset.trimEndSec ?? outputConfig.durationSeconds
    if (getMotionTrimDuration(trimStart, trimEnd) === null) {
      reasons.push('Đoạn video tham chiếu phải dài 4–10 giây và dùng mốc giây nguyên')
    }
    return reasons
  }, [activePrompt, motionAsset, outputConfig.durationSeconds, outputConfig.projectMode, profileError, referencePromptConflict, selectedProfile, selectedProject])

  const isReadyToRun = missingReasons.length === 0

  // -------------------------------------------------------------
  // 6. Asset Handlers
  // -------------------------------------------------------------
  const handleUploadFile = useCallback((role: 'character' | 'motion' | 'scene', file: File) => {
    const extensionMatches = role === 'motion'
      ? /\.(mp4|mov|avi|wmv)$/i.test(file.name)
      : /\.(png|jpe?g|webp)$/i.test(file.name)
    const mimeMatches = role === 'motion'
      ? file.type.startsWith('video/')
      : file.type.startsWith('image/')
    if (!mimeMatches && !extensionMatches) {
      showToast(role === 'motion' ? 'Chỉ chấp nhận video MP4, MOV, AVI hoặc WMV.' : 'Chỉ chấp nhận ảnh PNG/JPG/WebP.')
      return
    }

    const maxBytes = role === 'motion' ? 1024 * 1024 * 1024 : 10 * 1024 * 1024
    if (file.size > maxBytes) {
      showToast(role === 'motion' ? 'Video vượt quá giới hạn 1 GB.' : 'Ảnh vượt quá giới hạn 10 MB.')
      return
    }

    const previewUrl = URL.createObjectURL(file)
    if (role === 'character') {
      setCharacterAsset((prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return { ...prev, filled: true, previewUrl, fileName: file.name, file, backendPath: undefined }
      })
      showToast(`Đã nạp ảnh nhân vật: ${file.name}`)
    } else if (role === 'motion') {
      const tempVideo = document.createElement('video')
      tempVideo.preload = 'metadata'
      tempVideo.src = previewUrl
      tempVideo.onloadedmetadata = () => {
        const dur = tempVideo.duration
        if (Number.isFinite(dur) && dur > 0) {
          if (dur < 4) {
            showToast(`Cảnh báo: Video chỉ dài ${dur.toFixed(1)}s (yêu cầu tối thiểu 4s).`)
          }
          const safeEnd = Math.min(10, Math.max(4, Math.floor(dur)))
          setMotionAsset((prev) => ({
            ...prev,
            trimStartSec: 0,
            trimEndSec: safeEnd,
          }))
          setOutputConfig((prev) => ({
            ...prev,
            durationSeconds: safeEnd,
          }))
        }
      }
      setMotionAsset((prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return { ...prev, filled: true, previewUrl, fileName: file.name, file, mediaId: undefined, mediaProjectId: undefined }
      })
      showToast(`Đã nạp video tham chiếu: ${file.name}`)
    } else if (role === 'scene') {
      setSceneAsset((prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return { ...prev, filled: true, previewUrl, fileName: file.name, file, backendPath: undefined }
      })
      showToast(`Đã nạp ảnh bối cảnh: ${file.name}`)
    }
  }, [showToast])

  const handleClearAsset = useCallback((role: 'character' | 'motion' | 'scene') => {
    if (role === 'character') {
      setCharacterAsset((prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return { ...prev, filled: false, previewUrl: null, fileName: '', file: undefined, backendPath: undefined }
      })
    } else if (role === 'motion') {
      setMotionAsset((prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return { ...prev, filled: false, previewUrl: null, fileName: '', file: undefined, mediaId: undefined, mediaProjectId: undefined }
      })
    } else if (role === 'scene') {
      setSceneAsset((prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return { ...prev, filled: false, previewUrl: null, fileName: '', file: undefined, backendPath: undefined }
      })
    }
    showToast(`Đã xóa nguyên liệu ${role}`)
  }, [showToast])

  const handleUpdateAssetMeta = useCallback((role: 'character' | 'motion' | 'scene', updates: Partial<MotionReferenceAsset>) => {
    if (role === 'character') setCharacterAsset((prev) => ({ ...prev, ...updates }))
    else if (role === 'motion') {
      setMotionAsset((prev) => {
        const next = { ...prev, ...updates }
        const duration = (next.trimEndSec ?? 10) - (next.trimStartSec ?? 0)
        if (Number.isFinite(duration) && duration > 0) {
          setOutputConfig((config) => ({ ...config, durationSeconds: duration }))
        }
        return next
      })
    }
    else if (role === 'scene') setSceneAsset((prev) => ({ ...prev, ...updates }))
  }, [])

  // -------------------------------------------------------------
  // Library Pickers State & Handlers
  // -------------------------------------------------------------
  const [imagePickerRole, setImagePickerRole] = useState<'character' | 'scene' | null>(null)
  const [isVideoPickerOpen, setIsVideoPickerOpen] = useState(false)

  const handleOpenLibrary = useCallback((role: 'character' | 'motion' | 'scene') => {
    if (role === 'character' || role === 'scene') {
      setImagePickerRole(role)
    } else if (role === 'motion') {
      setIsVideoPickerOpen(true)
    }
  }, [])

  const handleSelectImageFromLibrary = useCallback(async (
    dataUrl: string,
    assetRef: AssetRef,
    item: VeoImageItem
  ) => {
    const role = imagePickerRole
    if (!role) return
    const rawUrl = dataUrl || assetRef.previewUrl || assetRef.dataUrl || ''
    const previewUrl = rawUrl.startsWith('http') || rawUrl.startsWith('data:')
      ? rawUrl
      : `${API_URL}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`

    let file: File | undefined = undefined
    try {
      const res = await fetch(previewUrl)
      if (res.ok) {
        const blob = await res.blob()
        const ext = blob.type.includes('png') ? '.png' : '.jpg'
        const filename = assetRef.fileName || `${item.id}${ext}`
        file = new File([blob], filename, { type: blob.type || 'image/jpeg' })
      }
    } catch (err) {
      console.warn('Không thể tạo File từ ảnh thư viện:', err)
    }

    if (role === 'character') {
      setCharacterAsset((prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return {
          ...prev,
          filled: true,
          previewUrl,
          fileName: assetRef.fileName || `${item.id}.jpg`,
          backendPath: assetRef.backendPath,
          file,
        }
      })
      showToast(`Đã nạp ảnh nhân vật từ Thư viện Veo`)
    } else if (role === 'scene') {
      setSceneAsset((prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return {
          ...prev,
          filled: true,
          previewUrl,
          fileName: assetRef.fileName || `${item.id}.jpg`,
          backendPath: assetRef.backendPath,
          file,
        }
      })
      showToast(`Đã nạp ảnh bối cảnh từ Thư viện Veo`)
    }
  }, [imagePickerRole, showToast])

  const handleSelectVideoFromLibrary = useCallback(async (clip: ExportedVideoItem) => {
    showToast(`Đang nạp video tham chiếu: ${clip.title || clip.filename}...`)
    let file: File | undefined = undefined
    try {
      const rawUrl = clip.videoUrl || ''
      const streamUrl = rawUrl.startsWith('http') || rawUrl.startsWith('data:')
        ? rawUrl
        : `${API_URL}${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`
      const res = await fetch(streamUrl)
      if (res.ok) {
        const blob = await res.blob()
        file = new File([blob], clip.filename, { type: blob.type || 'video/mp4' })
      }
    } catch (err) {
      console.warn('Không thể tạo File từ video thư viện:', err)
    }

    const duration = clip.durationSec || 10
    const trimEnd = Math.min(10, Math.max(4, Math.round(duration)))

    setMotionAsset((prev) => {
      if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
      return {
        ...prev,
        filled: true,
        previewUrl: clip.videoUrl,
        fileName: clip.filename,
        file,
        mediaId: undefined,
        mediaProjectId: undefined,
        trimStartSec: 0,
        trimEndSec: trimEnd,
      }
    })

    setOutputConfig((config) => ({
      ...config,
      durationSeconds: trimEnd,
      aspectRatio: clip.aspectRatio === '16:9' ? '16:9' : '9:16',
    }))

    showToast(`Đã nạp video chuyển động từ Thư viện: ${clip.filename}`)
  }, [showToast])

  // -------------------------------------------------------------
  // -------------------------------------------------------------
  // 7. Delete Edge Handler
  // -------------------------------------------------------------
  const handleDeleteEdge = useCallback((edgeId: string) => {
    setEdges((eds) => eds.filter((e) => e.id !== edgeId))
  }, [])

  // -------------------------------------------------------------
  // 8. React Flow Nodes & Positions (NEVER RESET POSITIONS ON DATA CHANGE!)
  // -------------------------------------------------------------
  const [nodes, setNodes] = useState<Node[]>([
    {
      id: 'n-refs',
      type: 'motionRefGroup',
      position: { x: 40, y: 100 },
      data: {},
    },
    {
      id: 'n-creative',
      type: 'motionCreative',
      position: { x: 420, y: 100 },
      data: {},
    },
    {
      id: 'n-preview',
      type: 'motionPreview',
      position: { x: 800, y: 100 },
      data: {},
    },
    {
      id: 'n-output',
      type: 'motionOutput',
      position: { x: 1190, y: 100 },
      data: {},
    },
  ])

  // -------------------------------------------------------------
  // 9. Edges State (Neutral Dashed, Animated When Running)
  // -------------------------------------------------------------
  const [edges, setEdges] = useState<Edge[]>([
    {
      id: 'e-char-creative',
      source: 'n-refs',
      sourceHandle: 'out-character',
      target: 'n-creative',
      targetHandle: 'in-character',
      type: 'removable',
    },
    {
      id: 'e-motion-creative',
      source: 'n-refs',
      sourceHandle: 'out-motion',
      target: 'n-creative',
      targetHandle: 'in-motion',
      type: 'removable',
    },
    {
      id: 'e-scene-creative',
      source: 'n-refs',
      sourceHandle: 'out-scene',
      target: 'n-creative',
      targetHandle: 'in-scene',
      type: 'removable',
    },
    {
      id: 'e-creative-preview',
      source: 'n-creative',
      sourceHandle: 'out-creative',
      target: 'n-preview',
      targetHandle: 'in-creative',
      type: 'removable',
    },
    {
      id: 'e-preview-output',
      source: 'n-preview',
      sourceHandle: 'out-prompt',
      target: 'n-output',
      targetHandle: 'in-prompt',
      type: 'removable',
    },
  ])

  // Attach runtime data to nodes dynamically without triggering side-effect state loops
  const nodesWithData = useMemo(() => {
    return nodes.map((node) => {
      if (node.id === 'n-refs') {
        return {
          ...node,
          data: {
            character: characterAsset,
            motion: motionAsset,
            scene: sceneAsset,
            selectedRole: activeRole,
            isRunning,
            onSelectRole: (role: 'character' | 'motion' | 'scene') => {
              setActiveRole(role)
              setSelectedNodeType('reference')
              setIsInspectorOpen(true)
            },
            onUploadFile: handleUploadFile,
            onOpenLibrary: handleOpenLibrary,
          },
        }
      }
      if (node.id === 'n-creative') {
        return {
          ...node,
          data: {
            creative: creativeDirection,
            isRunning,
            onOpenInspector: () => {
              setSelectedNodeType('creative')
              setIsInspectorOpen(true)
            },
          },
        }
      }
      if (node.id === 'n-preview') {
        return {
          ...node,
          data: {
            fullPrompt: activePrompt,
            sections: structuredPrompt.sections,
            charCount: structuredPrompt.charCount,
            isRunning,
            onPromptChange: (text: string) => {
              setIsCustomPrompt(true)
              setCustomPromptText(text)
            },
            onOpenInspector: () => {
              setSelectedNodeType('preview')
              setIsInspectorOpen(true)
            },
          },
        }
      }
      if (node.id === 'n-output') {
        return {
          ...node,
          data: {
            config: outputConfig,
            projectLabel: (outputConfig.projectMode || 'new_per_run') === 'new_per_run'
              ? 'Project mới / lượt'
              : (selectedProject?.name || 'Chưa chọn project'),
            isReady: isReadyToRun,
            missingReasons,
            isRunning,
            runningStageText,
            runError,
            resultVideoUrl,
            referenceVideoUrl: motionAsset.previewUrl,
            showReferenceComparison: outputConfig.showReferenceComparison !== false,
            onRun: () => handleRunWorkflow(),
            onOpenPreviewModal: (url: string) => onOpenPreviewModal?.(
              url,
              workflowName,
              activePrompt,
              outputConfig.showReferenceComparison !== false ? motionAsset.previewUrl : null,
            ),
            onOpenInspector: () => {
              setSelectedNodeType('output')
              setIsInspectorOpen(true)
            },
          },
        }
      }
      return node
    })
  }, [
    nodes,
    characterAsset,
    motionAsset,
    sceneAsset,
    activeRole,
    isRunning,
    handleUploadFile,
    handleOpenLibrary,
    creativeDirection,
    activePrompt,
    structuredPrompt,
    outputConfig,
    isReadyToRun,
    missingReasons,
    runningStageText,
    runError,
    resultVideoUrl,
    workflowName,
    selectedProject,
    onOpenPreviewModal,
  ])

  // Attach styles & handlers to edges dynamically
  const edgesWithData = useMemo(() => {
    return edges.map((e) => ({
      ...e,
      type: 'removable',
      animated: isRunning,
      style: {
        stroke: isRunning ? '#4F46E5' : e.id === 'e-motion-creative' ? '#EA580C' : '#94A3B8',
        strokeWidth: e.id === 'e-preview-output' ? 2.5 : 2,
        strokeDasharray: '4 4',
      },
      data: {
        ...((e.data as Record<string, unknown>) || {}),
        onDeleteEdge: handleDeleteEdge,
      },
    }))
  }, [edges, isRunning, handleDeleteEdge])

  const onNodesChange = useCallback(
    (changes: NodeChange[]) => setNodes((nds) => applyNodeChanges(changes, nds)),
    []
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  )

  // Connection validation
  const isValidConnection = useCallback((connection: Connection) => {
    // 1. References can only connect to Creative Direction
    if (connection.source === 'n-refs' && connection.target !== 'n-creative') return false
    // 2. Creative Direction can only connect to Prompt Preview
    if (connection.source === 'n-creative' && connection.target !== 'n-preview') return false
    // 3. Prompt Preview can only connect to Output
    if (connection.source === 'n-preview' && connection.target !== 'n-output') return false
    return true
  }, [])

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!isValidConnection(connection)) {
        showToast('Kết nối không hợp lệ! Hãy nối theo đúng thứ tự luồng xử lý.')
        return
      }
      setEdges((eds) =>
        addEdge(
          {
            ...connection,
            type: 'removable',
            animated: isRunning,
            style: { stroke: isRunning ? '#4F46E5' : '#94A3B8', strokeWidth: 2, strokeDasharray: '4 4' },
            data: { onDeleteEdge: handleDeleteEdge },
          },
          eds
        )
      )
    },
    [handleDeleteEdge, isRunning, isValidConnection]
  )

  // -------------------------------------------------------------
  // 10. Real Veo Pipeline Runner (No setTimeout Mock!)
  // -------------------------------------------------------------
  const handleRunWorkflow = async () => {
    if (isRunning || runLockRef.current) return
    if (!isReadyToRun) {
      showToast(`Chưa thể chạy: ${missingReasons[0]}`)
      return
    }

    runLockRef.current = true
    const idempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `motion-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setIsRunning(true)
    setRunningStageText('Đang kiểm tra kết nối Veo Flow Studio...')
    setResultVideoUrl(null)
    setRunError(null)

    let currentStage: MotionRunStage = 'connection'
    let submittedJobId: string | undefined

    try {
      const bridgeStatus = await getBridgeStatus()
      const isBridgeReady = Boolean(bridgeStatus.bridge_running && bridgeStatus.extension.connected)
      setBridgeConnected(isBridgeReady)
      if (!isBridgeReady) {
        throw new Error('Extension Flow chưa kết nối với Backend. Hãy mở Flow và kiểm tra extension.')
      }

      currentStage = 'project'
      let runtimeProject: VeoProject | null = null
      if ((outputConfig.projectMode || 'new_per_run') === 'new_per_run') {
        setRunningStageText('Đang tạo Flow project mới, độc lập cho lượt render này...')
        const prefix = outputConfig.projectNamePrefix?.trim() || workflowName.trim() || 'Motion Control'
        const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19)
        runtimeProject = await handleCreateMotionProject(`${prefix} · ${timestamp}`)
      } else {
        runtimeProject = selectedProject || await getActiveProject()
      }

      const projectId = runtimeProject?.id
      const flowProjectId = runtimeProject?.flow_project_id
      if (!projectId) {
        throw new Error('Chưa có Flow project đang hoạt động. Hãy chọn project hoặc dùng chế độ tạo project mới mỗi lượt.')
      }
      if (!flowProjectId) {
        throw new Error('Project đang chọn chưa có Google Flow project id để upload video.')
      }
      if (!selectedProfile) {
        throw new Error(profileError || 'Backend chưa có profile video_edit phù hợp.')
      }

      const forceFreshAssets = outputConfig.freshAssets !== false
      const mediaBelongsToProject = motionAsset.mediaProjectId === flowProjectId
      let motionMediaId = mediaBelongsToProject ? motionAsset.mediaId : undefined
      if (motionAsset.file && (forceFreshAssets || !motionMediaId)) {
        currentStage = 'reference_upload'
        setRunningStageText(`Đang tải mới video mẫu (${motionAsset.fileName}) vào project của lượt này...`)
        const uploadRes = await uploadVideoReference(motionAsset.file, flowProjectId, { forceFresh: forceFreshAssets })
        motionMediaId = uploadRes.media_id
        setMotionAsset((prev) => ({ ...prev, mediaId: uploadRes.media_id, mediaProjectId: flowProjectId }))
      }
      if (!motionMediaId) {
        throw new Error('Video tham chiếu chưa có file gốc để upload vào Flow project mới. Hãy chọn lại video local.')
      }

      const ingredientImagePaths: string[] = []
      let characterPath = characterAsset.backendPath
      if (characterAsset.filled && characterAsset.file && !characterPath) {
        currentStage = 'image_upload'
        setRunningStageText(`Đang tải ảnh nhân vật (${characterAsset.fileName}) lên Backend...`)
        const uploaded = await uploadImage(characterAsset.file)
        characterPath = uploaded.file_path
        setCharacterAsset((prev) => ({ ...prev, backendPath: uploaded.file_path }))
      }
      if (characterPath) ingredientImagePaths.push(characterPath)

      let scenePath = sceneAsset.backendPath
      if (sceneAsset.filled && sceneAsset.file && !scenePath) {
        currentStage = 'image_upload'
        setRunningStageText(`Đang tải ảnh bối cảnh (${sceneAsset.fileName}) lên Backend...`)
        const uploaded = await uploadImage(sceneAsset.file)
        scenePath = uploaded.file_path
        setSceneAsset((prev) => ({ ...prev, backendPath: uploaded.file_path }))
      }
      if (scenePath) ingredientImagePaths.push(scenePath)

      currentStage = 'submission'
      setRunningStageText('Đang gửi job Motion Control thật tới Google Flow...')
      const jobRes = await submitJob({
        project_id: projectId,
        prompt: activePrompt.trim(),
        model_display_name: selectedProfile.model_display_name,
        input_mode: 'video_edit',
        aspect_ratio: selectedProfile.aspect_ratio,
        duration_seconds: outputConfig.durationSeconds,
        resolution: selectedProfile.resolution,
        num_outputs: selectedProfile.num_outputs,
        ingredient_image_paths: ingredientImagePaths,
        reference_video_id: motionMediaId,
        reference_video_start_seconds: motionAsset.trimStartSec ?? 0,
        reference_video_end_seconds: motionAsset.trimEndSec ?? (motionAsset.trimStartSec ?? 0) + outputConfig.durationSeconds,
        force_fresh_assets: forceFreshAssets,
        idempotency_key: idempotencyKey,
      })
      submittedJobId = jobRes.job_id
      if (jobRes.deduplicated) {
        showToast(`Đã dùng lại job ${jobRes.job_id}; không tạo render trùng.`)
      }

      currentStage = 'generation'
      setRunningStageText('Google Flow đang xử lý video Motion Control...')
      let outputFile: string | null = null
      for (let pollCount = 1; pollCount <= 120; pollCount += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        const status = await getJobStatus(jobRes.job_id)
        if (!status) continue

        setRunningStageText(status.current_step || `Google Flow: ${status.status} (${pollCount}/120)`)
        if (status.status === 'captcha') currentStage = 'captcha'
        else if (status.status === 'submitting') currentStage = 'submission'
        else if (status.status === 'generating') currentStage = 'generation'
        else if (status.status === 'downloading') currentStage = 'download'
        if (status.status === 'error') {
          const detailedError = motionRunErrorFromJob(status, currentStage)
          setRunError(detailedError)
          showToast(`${detailedError.title}: ${detailedError.message}`)
          return
        }
        if (status.status === 'done') {
          outputFile = status.output_files[0] || null
          break
        }
      }

      if (!outputFile) {
        throw new Error('Job chưa hoàn tất sau 5 phút hoặc không trả về file video.')
      }

      const streamUrl = getVideoStreamUrl(outputFile)
      setResultVideoUrl(streamUrl)
      onOpenPreviewModal?.(
        streamUrl,
        workflowName,
        activePrompt,
        outputConfig.showReferenceComparison !== false ? motionAsset.previewUrl : null,
      )
      showToast('Video Motion Control đã render thành công từ Google Flow.')
    } catch (err: unknown) {
      console.error('Error in handleRunWorkflow:', err)
      const detailedError = motionRunErrorFromUnknown(err, currentStage, submittedJobId)
      setRunError(detailedError)
      showToast(`${detailedError.title}: ${detailedError.message}`)
    } finally {
      setIsRunning(false)
      setRunningStageText('')
      runLockRef.current = false
    }
  }

  // -------------------------------------------------------------
  // 11. Left Palette Categories
  // -------------------------------------------------------------
  const paletteCategories = [
    {
      title: 'Nguyên Liệu Tham Chiếu',
      items: [
        {
          id: 'char',
          name: 'Ảnh Nhân Vật',
          desc: 'Nhận diện khuôn mặt & vóc dáng',
          icon: <ImageIcon size={16} />,
          onClick: () => {
            setActiveRole('character')
            setSelectedNodeType('reference')
            setIsInspectorOpen(true)
          },
        },
        {
          id: 'motion',
          name: 'Video Chuyển Động',
          desc: 'Động tác mẫu & nhịp máy quay',
          icon: <VideoIcon size={16} />,
          onClick: () => {
            setActiveRole('motion')
            setSelectedNodeType('reference')
            setIsInspectorOpen(true)
          },
        },
        {
          id: 'scene',
          name: 'Ảnh Bối Cảnh',
          desc: 'Không gian & ánh sáng môi trường',
          icon: <ImageIcon size={16} />,
          onClick: () => {
            setActiveRole('scene')
            setSelectedNodeType('reference')
            setIsInspectorOpen(true)
          },
        },
      ],
    },
    {
      title: 'Chỉ Đạo & Cấu Trúc',
      items: [
        {
          id: 'creative',
          name: 'Chỉ Dẫn Sáng Tạo',
          desc: 'Brief đạo diễn, camera & phong cách',
          icon: <FileText size={16} />,
          onClick: () => {
            setSelectedNodeType('creative')
            setIsInspectorOpen(true)
          },
        },
        {
          id: 'preview',
          name: 'Prompt Cấu Trúc',
          desc: 'Ghép nhãn nguồn Google Flow',
          icon: <GitMerge size={16} />,
          onClick: () => {
            setSelectedNodeType('preview')
            setIsInspectorOpen(true)
          },
        },
      ],
    },
    {
      title: 'Đầu Ra Video',
      items: [
        {
          id: 'output',
          name: 'Tạo Video (Veo)',
          desc: 'Cấu hình khung hình & xuất video',
          icon: <Sparkles size={16} />,
          onClick: () => {
            setSelectedNodeType('output')
            setIsInspectorOpen(true)
          },
        },
      ],
    },
  ]

  return (
    <div className="motion-flow-root">
      {/* Sub-header Bar */}
      <header className="mf-subbar">
        <div className="mf-subbar-left">
          <div className="mf-mark" title="Veo Motion Control Studio">
            <Film size={17} />
          </div>
          <input
            className="mf-wf-name"
            value={workflowName}
            onChange={(e) => setWorkflowName(e.target.value)}
            aria-label="Tên workflow"
          />
          <span className="mf-badge-draft">
            {bridgeConnected === null
              ? 'Đang kiểm tra Flow'
              : bridgeConnected && selectedProfile
                ? 'Flow đã kết nối'
                : 'Flow chưa sẵn sàng'}
          </span>
        </div>

        <div className="mf-subbar-right">
          {onOpenLibrary && (
            <button
              type="button"
              className="mf-btn"
              onClick={onOpenLibrary}
              title="Xem thư viện video"
            >
              Thư Viện Video
            </button>
          )}

          <button
            type="button"
            className="mf-btn"
            onClick={() => setIsInspectorOpen(!isInspectorOpen)}
            style={{
              borderColor: isInspectorOpen ? '#4F46E5' : undefined,
              color: isInspectorOpen ? '#4F46E5' : undefined,
            }}
          >
            <Sliders size={14} />
            <span>{isInspectorOpen ? 'Đóng Inspector' : 'Mở Inspector'}</span>
          </button>

          <button
            type="button"
            className="mf-btn primary"
            disabled={isRunning || !isReadyToRun}
            onClick={handleRunWorkflow}
            title={!isReadyToRun ? missingReasons[0] : 'Chạy quy trình Veo'}
          >
            {isRunning ? (
              <>
                <RotateCw size={15} className="animate-spin" />
                <span>Đang xử lý...</span>
              </>
            ) : (
              <>
                <Play size={15} fill="#ffffff" />
                <span>Chạy workflow</span>
              </>
            )}
          </button>
        </div>
      </header>

      {/* Main Studio Grid */}
      <div className="mf-main-grid">
        {/* Left Palette */}
        <aside className="mf-palette" aria-label="Thư viện node">
          <input
            className="mf-palette-search"
            type="search"
            placeholder="Tìm thành phần..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          {paletteCategories.map((group) => {
            const filtered = group.items.filter(
              (it) =>
                it.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                it.desc.toLowerCase().includes(searchQuery.toLowerCase())
            )
            if (filtered.length === 0) return null

            return (
              <section key={group.title} className="mf-pal-group">
                <h3>{group.title}</h3>
                {filtered.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="mf-pal-item"
                    onClick={item.onClick}
                  >
                    <span className="mf-chip">
                      {item.icon}
                    </span>
                    <div>
                      <b>{item.name}</b>
                      <small>{item.desc}</small>
                    </div>
                  </button>
                ))}
              </section>
            )
          })}
        </aside>

        {/* React Flow Canvas */}
        <div className="mf-canvas-wrap">
          <ReactFlowProvider>
            <ReactFlow
              id="rf-motion-flow"
              nodes={nodesWithData}
              edges={edgesWithData}
              onNodesChange={onNodesChange}
              onEdgesChange={onEdgesChange}
              onConnect={onConnect}
              nodeTypes={nodeTypes}
              edgeTypes={edgeTypes}
              onNodeClick={(_, node) => {
                if (node.id === 'n-refs') setSelectedNodeType('reference')
                else if (node.id === 'n-creative') setSelectedNodeType('creative')
                else if (node.id === 'n-preview') setSelectedNodeType('preview')
                else if (node.id === 'n-output') setSelectedNodeType('output')
                setIsInspectorOpen(true)
              }}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.3}
              maxZoom={2}
              deleteKeyCode={['Backspace', 'Delete']}
              defaultViewport={{ x: 0, y: 0, zoom: 0.8 }}
            >
              {/* Dot Grid Background */}
              <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />

              {/* Standard React Flow Controls */}
              <Controls position="bottom-right" />
            </ReactFlow>
          </ReactFlowProvider>

          {/* Floating Legend at bottom-left */}
          <div className="mf-legend" aria-label="Chú giải">
            <span><i style={{ borderColor: 'var(--img, #10B981)' }} /> Nguyên liệu ảnh</span>
            <span><i style={{ borderColor: 'var(--vid, #FF7A00)' }} /> Video chuyển động</span>
            <span><i style={{ borderColor: '#2563EB' }} /> Chỉ đạo sáng tạo</span>
            <span><i className="dash" /> Dây nối sợi đứt (Dashed)</span>
          </div>

          {/* Inspector Panel Drawer */}
          <MotionInspectorPanel
            isOpen={isInspectorOpen}
            onClose={() => setIsInspectorOpen(false)}
            selectedNodeType={selectedNodeType}
            activeRole={activeRole}
            setActiveRole={setActiveRole}
            character={characterAsset}
            motion={motionAsset}
            scene={sceneAsset}
            onUploadFile={handleUploadFile}
            onClearAsset={handleClearAsset}
            onUpdateAssetMeta={handleUpdateAssetMeta}
            onOpenLibrary={handleOpenLibrary}
            creative={creativeDirection}
            onUpdateCreative={(updates) => setCreativeDirection((prev) => ({ ...prev, ...updates }))}
            onResetDefaultPrompt={handleResetDefaultPrompt}
            structuredPrompt={structuredPrompt}
            isCustomPrompt={isCustomPrompt}
            customPromptText={customPromptText}
            onUpdateCustomPromptText={(t) => {
              setIsCustomPrompt(true)
              setCustomPromptText(t)
            }}
            onResetToAutoPrompt={() => {
              setIsCustomPrompt(false)
              setCustomPromptText('')
            }}
            outputConfig={outputConfig}
            projects={projects}
            activeProject={selectedProject || null}
            lastRunProject={lastRunProject}
            isCreatingProject={isCreatingProject}
            onUpdateProjectConfig={(updates) => setOutputConfig((previous) => ({ ...previous, ...updates }))}
            onSelectProject={onSelectProject}
            onCreateProject={async (name) => {
              const created = await handleCreateMotionProject(name)
              setOutputConfig((previous) => ({ ...previous, projectMode: 'selected' }))
              return created
            }}
            profiles={videoEditProfiles}
            selectedProfileId={selectedProfileId}
            onSelectAspectRatio={handleSelectAspectRatio}
            onSelectResolution={handleSelectResolution}
            onSelectDuration={handleSelectDuration}
            profileError={profileError}
            missingReasons={missingReasons}
            isReadyToRun={isReadyToRun}
            isRunning={isRunning}
            runError={runError}
            onRunWorkflow={handleRunWorkflow}
          />

          {/* Modal Chọn Ảnh từ Thư Viện Veo Studio (Nhân vật / Bối cảnh) */}
          {Boolean(imagePickerRole) && (
            <VeoImagePickerModal
              isOpen={Boolean(imagePickerRole)}
              onClose={() => setImagePickerRole(null)}
              targetLabel={imagePickerRole === 'character' ? 'Ảnh Nhân Vật' : 'Ảnh Bối Cảnh'}
              kind={imagePickerRole === 'character' ? 'model' : 'scene'}
              onSelect={(dataUrl, assetRef, item) => {
                handleSelectImageFromLibrary(dataUrl, assetRef, item)
              }}
            />
          )}

          {/* Modal Chọn Video từ Thư Viện Veo Studio / Exports */}
          {isVideoPickerOpen && (
            <VeoVideoPickerModal
              isOpen={isVideoPickerOpen}
              onClose={() => setIsVideoPickerOpen(false)}
              title="Chọn Video Tham Chiếu (Motion Reference)"
              subtitle="Chọn 1 video từ thư viện Veo Studio hoặc workflow để làm mẫu động tác và nhịp máy"
              onSelectClip={handleSelectVideoFromLibrary}
            />
          )}
        </div>
      </div>

      {/* Floating Toast Notification */}
      <div className={`mf-toast ${toastMsg ? 'show' : ''}`} role="status">
        {toastMsg}
      </div>
    </div>
  )
}
