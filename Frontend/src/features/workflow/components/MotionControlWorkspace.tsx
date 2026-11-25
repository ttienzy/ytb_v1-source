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
  type ReactFlowInstance,
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
  Layers,
  UserPlus,
} from 'lucide-react'

// Custom Nodes for Motion Control Studio
import { MotionReferenceGroupNode } from '../nodes/motion/MotionReferenceGroupNode'
import { MotionCreativeDirectionNode } from '../nodes/motion/MotionCreativeDirectionNode'
import { MotionPromptPreviewNode } from '../nodes/motion/MotionPromptPreviewNode'
import { MotionOutputNode } from '../nodes/motion/MotionOutputNode'
import { MotionCharacterSheetNode } from '../nodes/motion/MotionCharacterSheetNode'

// Services & Types
import {
  buildStructuredPrompt,
  DEFAULT_MOTION_CREATIVE_DIRECTION,
  motionPromptSignature,
  type MotionReferenceRoles,
} from '../services/motionPromptBuilder'
import {
  canAddMotionCharacter,
  canAddMotionScene,
  extraCharacterIndex,
  filledCharacterCount,
  MAX_MOTION_REFERENCE_IMAGES,
  newExtraCharacterId,
  orderedMotionImages,
  type MotionAssetRole,
} from '../services/motionReferences'
import { fetchMotionPresets, generateMotionCharacterSheet } from '../services/workflowApi'
import {
  CHARACTER_SHEET_EDGE_ID,
  CHARACTER_SHEET_NODE_ID,
  CHARACTER_SHEET_TARGET_HANDLE,
  EMPTY_CHARACTER_SHEET,
  characterSheetFileError,
  characterSheetMissing,
  isSheetApplied,
  withSource,
  type CharacterSheetRole,
  type CharacterSheetState,
} from '../services/motionCharacterSheet'
import {
  MOTION_MAX_DURATION_SECONDS,
  MOTION_MIN_DURATION_SECONDS,
  estimateMotionCreditCost,
  findMotionProfile,
  getMotionTrimDuration,
  getVideoEditProfiles,
  resolveBestProfile,
} from '../services/motionProfiles'
import {
  loadStoredMotionConfig,
  saveStoredMotionConfig,
  loadStoredCreativeDirection,
  saveStoredCreativeDirection,
} from '../services/motionStorage'
import { LongMotionPanel } from './LongMotionPanel'
import { needsLongMotion } from '../services/longMotionView'
import { motionRunErrorFromJob, motionRunErrorFromUnknown } from '../services/motionRunError'
import type {
  MotionReferenceAsset,
  MotionCreativeDirection,
  MotionOutputConfig,
  MotionRunError,
  MotionRunStage,
  MotionPresetItem,
  MotionVariantSlot,
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
  motionCharacterSheet: MotionCharacterSheetNode,
}

const edgeTypes = {
  removable: RemovableEdge,
}

// Node tùy chọn "Tạo Ảnh Nhân Vật Mới": bên trái khối Nguyên Liệu Tham Chiếu, ngang ô Nhân Vật.
const CHARACTER_SHEET_POSITION = { x: -400, y: 230 }
const CHARACTER_SHEET_EDGE: Edge = {
  id: CHARACTER_SHEET_EDGE_ID,
  source: CHARACTER_SHEET_NODE_ID,
  sourceHandle: 'out-sheet',
  target: 'n-refs',
  targetHandle: CHARACTER_SHEET_TARGET_HANDLE,
  type: 'removable',
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
  const [resultVideoUrls, setResultVideoUrls] = useState<string[]>([])
  const [activeVariantIndex, setActiveVariantIndex] = useState<number>(0)
  const [variantSlots, setVariantSlots] = useState<MotionVariantSlot[]>([])
  const [runError, setRunError] = useState<MotionRunError | null>(null)
  // State update không đồng bộ; ref này chặn double-click ngay trong cùng tick.
  const runLockRef = useRef(false)
  const flowInstanceRef = useRef<ReactFlowInstance | null>(null)

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

  const [motionAsset, setMotionAsset] = useState<MotionReferenceAsset>(() => {
    const stored = loadStoredMotionConfig()
    return {
      id: 'ref-motion',
      role: 'motion',
      title: 'Video Chuyển Động',
      required: true,
      filled: false,
      previewUrl: null,
      fileName: '',
      trimStartSec: 0,
      trimEndSec: stored.durationSeconds,
    }
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

  // Ô nhân vật thêm (nhân vật 2, 3). Tổng ảnh nhân vật + bối cảnh tối đa 3 (giới hạn của Flow cho chỉnh video).
  const [extraCharacters, setExtraCharacters] = useState<MotionReferenceAsset[]>([])
  const updateExtraCharacter = useCallback((id: string, fn: (prev: MotionReferenceAsset) => MotionReferenceAsset) => {
    setExtraCharacters((prev) => prev.map((a) => (a.id === id ? fn(a) : a)))
  }, [])
  const characterCount = filledCharacterCount(characterAsset, extraCharacters)
  const canAddCharacter = canAddMotionCharacter(extraCharacters.length, sceneAsset.filled)

  // -------------------------------------------------------------
  // 2. Creative Direction State (Director's Brief)
  // -------------------------------------------------------------
  const [creativeDirection, setCreativeDirection] = useState<MotionCreativeDirection>(() => loadStoredCreativeDirection())

  // -------------------------------------------------------------
  // 3. Output Format Config
  // -------------------------------------------------------------
  const [outputConfig, setOutputConfig] = useState<MotionOutputConfig>(() => loadStoredMotionConfig())
  const outputConfigRef = useRef(outputConfig)
  useEffect(() => {
    outputConfigRef.current = outputConfig
  }, [outputConfig])
  const [motionPresets, setMotionPresets] = useState<MotionPresetItem[]>([])
  const [videoEditProfiles, setVideoEditProfiles] = useState<VeoCapabilityProfile[]>([])
  const [selectedProfileId, setSelectedProfileId] = useState('')
  const [profileError, setProfileError] = useState<string | null>(null)
  const [bridgeConnected, setBridgeConnected] = useState<boolean | null>(null)
  const [isCreatingProject, setIsCreatingProject] = useState(false)
  const [lastRunProject, setLastRunProject] = useState<VeoProject | null>(null)

  // applyProfile đọc chỉ đạo hiện tại qua ref để giữ hàm ổn định: nếu phụ thuộc creativeDirection,
  // effect nạp dữ liệu bên dưới (deps [applyProfile]) sẽ chạy lại mỗi khi prompt đổi -> gọi API lặp vô hạn.
  const creativeDirectionRef = useRef(creativeDirection)
  useEffect(() => {
    creativeDirectionRef.current = creativeDirection
  }, [creativeDirection])

  const applyProfile = useCallback((profile: VeoCapabilityProfile) => {
    setSelectedProfileId(profile.id)
    setOutputConfig((previous) => {
      const next = {
        ...previous,
        profileId: profile.id,
        modelDisplayName: profile.model_display_name,
        aspectRatio: profile.aspect_ratio,
        durationSeconds: previous.durationSeconds,
        resolution: profile.resolution as MotionOutputConfig['resolution'],
        numOutputs: profile.num_outputs,
        creditCost: estimateMotionCreditCost(previous.durationSeconds, profile.resolution as '360p' | '720p'),
      }
      saveStoredMotionConfig(next, creativeDirectionRef.current)
      return next
    })
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
        const saved = loadStoredMotionConfig()
        const preferredProfile = resolveBestProfile(profiles, saved.aspectRatio, saved.resolution)
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

      // Tải danh mục mẫu phong cách chuyển động từ Backend
      fetchMotionPresets()
        .then((presets) => {
          if (!cancelled && presets && presets.length > 0) {
            setMotionPresets(presets)
          }
        })
        .catch((err) => console.debug('Cannot load motion presets:', err))
      // Prompt v2: KHÔNG nạp "chỉ đạo chính mặc định" từ file backend nữa (câu đó lặp với khối "Giữ nguyên" tự sinh).
    }

    void loadBackendState()
    return () => {
      cancelled = true
    }
  }, [applyProfile])

  const handleResetDefaultPrompt = useCallback(() => {
    setCreativeDirection(() => {
      const next = { ...DEFAULT_MOTION_CREATIVE_DIRECTION, options: {} }
      saveStoredCreativeDirection(next, outputConfigRef.current)
      return next
    })
    setIsCustomPrompt(false)
    setCustomPromptText('')
    showToast('Đã đưa chỉ đạo về mặc định: chỉ còn phần tự sinh theo ảnh (Thay đổi + Giữ nguyên).')
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
    setOutputConfig((previous) => {
      const next = {
        ...previous,
        durationSeconds,
        creditCost: estimateMotionCreditCost(durationSeconds, previous.resolution),
      }
      saveStoredMotionConfig(next, creativeDirection)
      return next
    })
    setMotionAsset((previous) => ({
      ...previous,
      trimEndSec: (previous.trimStartSec ?? 0) + durationSeconds,
    }))
  }, [creativeDirection])

  const handleUpdateCreative = useCallback((updates: Partial<MotionCreativeDirection>) => {
    setCreativeDirection((prev) => {
      const next = { ...prev, ...updates }
      saveStoredCreativeDirection(next, outputConfig)
      return next
    })
  }, [outputConfig])

  const handleUpdateProjectConfig = useCallback((updates: Partial<MotionOutputConfig>) => {
    setOutputConfig((prev) => {
      const next = { ...prev, ...updates }
      saveStoredMotionConfig(next, creativeDirection)
      return next
    })
  }, [creativeDirection])

  const handleSelectPreset = useCallback((presetId: string) => {
    const p = motionPresets.find((item) => item.id === presetId)
    if (!p) return
    setOutputConfig((prev) => {
      const next = { ...prev, activePresetId: presetId }
      saveStoredMotionConfig(next, creativeDirection)
      return next
    })
    setCreativeDirection((prev) => {
      const next = {
        ...prev,
        creativeBrief: p.creative_brief,
        subjectAction: p.subject_action,
        cameraMovement: p.camera_movement,
        sceneAtmosphere: p.scene_atmosphere,
        styleDirection: p.style_direction,
        negativePrompt: p.negative_prompt,
      }
      saveStoredCreativeDirection(next, outputConfig)
      return next
    })
    setIsCustomPrompt(false)
    setCustomPromptText('')
    showToast(`Đã áp dụng mẫu: ${p.name}`)
  }, [motionPresets, outputConfig, creativeDirection, showToast])

  // -------------------------------------------------------------
  // 4. Inspector Drawer State
  // -------------------------------------------------------------
  const [isInspectorOpen, setIsInspectorOpen] = useState(false)
  const [isLongOpen, setIsLongOpen] = useState(false)
  const [selectedNodeType, setSelectedNodeType] = useState<'reference' | 'creative' | 'preview' | 'output' | null>('creative')
  const [activeRole, setActiveRole] = useState<'character' | 'motion' | 'scene'>('motion')

  // -------------------------------------------------------------
  // 5. Prompt Preview & Custom Edit State
  // -------------------------------------------------------------
  const [isCustomPrompt, setIsCustomPrompt] = useState(false)
  const [customPromptText, setCustomPromptText] = useState('')
  /** Chữ ký bộ ảnh lúc bắt đầu sửa tay; khác chữ ký hiện tại = prompt sửa tay có thể gọi sai "Image N". */
  const [customPromptSignature, setCustomPromptSignature] = useState('')

  // Ảnh gửi theo thứ tự nhân vật có ảnh (ô chính trước) rồi bối cảnh; ghi chú "thay người nào" đi theo đúng thứ tự đó.
  const promptRoles = useMemo<MotionReferenceRoles>(() => ({
    character: characterCount > 0,
    characterCount,
    scene: sceneAsset.filled,
    characterSheet: characterAsset.filled && characterAsset.source === 'character_sheet',
    characterTargets: [characterAsset, ...extraCharacters].filter((a) => a.filled).map((a) => a.target),
  }), [characterAsset, characterCount, extraCharacters, sceneAsset.filled])

  const structuredPrompt = useMemo(
    () => buildStructuredPrompt(creativeDirection, promptRoles),
    [creativeDirection, promptRoles],
  )
  const currentPromptSignature = motionPromptSignature(promptRoles, creativeDirection.backgroundFrom)
  const customPromptStale = isCustomPrompt && customPromptSignature !== currentPromptSignature

  const activePrompt = isCustomPrompt ? customPromptText : structuredPrompt.fullPrompt

  const handleEditCustomPrompt = useCallback((text: string) => {
    if (!isCustomPrompt) setCustomPromptSignature(currentPromptSignature)
    setIsCustomPrompt(true)
    setCustomPromptText(text)
  }, [currentPromptSignature, isCustomPrompt])

  const handleResetToAutoPrompt = useCallback(() => {
    setIsCustomPrompt(false)
    setCustomPromptText('')
  }, [])

  /** Người dùng xác nhận prompt sửa tay vẫn đúng với bộ ảnh mới. */
  const handleKeepCustomPrompt = useCallback(() => {
    setCustomPromptSignature(currentPromptSignature)
  }, [currentPromptSignature])

  /**
   * Đường dẫn backend của các ảnh tham chiếu theo đúng thứ tự gửi Flow (nhân vật 1, 2, 3 rồi bối cảnh); ảnh chưa có
   * trên backend thì tải lên trước. Dùng chung cho lượt chạy thường và Motion dài.
   */
  const ensureMotionImagePaths = useCallback(async (onStage?: (text: string) => void): Promise<string[]> => {
    const paths: string[] = []
    for (const asset of orderedMotionImages(characterAsset, extraCharacters, sceneAsset)) {
      let path = asset.backendPath
      if (asset.file && !path) {
        onStage?.(`Đang tải ${asset.role === 'scene' ? 'ảnh bối cảnh' : 'ảnh nhân vật'} (${asset.fileName}) lên Backend...`)
        const uploaded = await uploadImage(asset.file)
        path = uploaded.file_path
        const save = (prev: MotionReferenceAsset) => ({ ...prev, backendPath: uploaded.file_path })
        if (asset.id === characterAsset.id) setCharacterAsset(save)
        else if (asset.id === sceneAsset.id) setSceneAsset(save)
        else updateExtraCharacter(asset.id, save)
      }
      if (path) paths.push(path)
    }
    return paths
  }, [characterAsset, extraCharacters, sceneAsset, updateExtraCharacter])

  const getLongMotionImagePaths = useCallback(() => ensureMotionImagePaths(), [ensureMotionImagePaths])

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
    if (isCustomPrompt) {
      if (!activePrompt.trim()) reasons.push('Prompt sửa tay đang trống')
      if (customPromptStale) {
        reasons.push('Ảnh tham chiếu đã đổi sau khi bạn sửa tay prompt: bấm “Dựng lại prompt” hoặc “Giữ bản sửa tay” ở node Prompt / Inspector.')
      }
    } else {
      reasons.push(...structuredPrompt.blockers)
      if (!activePrompt.trim() && structuredPrompt.blockers.length === 0) reasons.push('Prompt đang trống')
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
      reasons.push('Đoạn video tham chiếu phải dài 3–15 giây và dùng mốc giây nguyên')
    }
    return reasons
  }, [activePrompt, customPromptStale, isCustomPrompt, motionAsset, outputConfig.durationSeconds, outputConfig.projectMode, profileError,
    referencePromptConflict, selectedProfile, selectedProject, structuredPrompt.blockers])

  const isReadyToRun = missingReasons.length === 0

  // -------------------------------------------------------------
  // 6. Asset Handlers
  // -------------------------------------------------------------
  const handleUploadFile = useCallback((role: MotionAssetRole, file: File) => {
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
    if (role === 'scene' && !canAddMotionScene(extraCharacters.length)) {
      showToast(`Flow nhận tối đa ${MAX_MOTION_REFERENCE_IMAGES} ảnh tham chiếu: bỏ bớt một ô nhân vật trước khi thêm bối cảnh.`)
      return
    }
    const extraIdx = extraCharacterIndex(role)
    const extra = extraIdx >= 0 ? extraCharacters[extraIdx] : undefined
    if (extraIdx >= 0 && !extra) return

    const previewUrl = URL.createObjectURL(file)
    if (extra) {
      updateExtraCharacter(extra.id, (prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return { ...prev, filled: true, previewUrl, fileName: file.name, file, backendPath: undefined, source: undefined }
      })
      showToast(`Đã nạp ảnh nhân vật ${extraIdx + 2}: ${file.name}`)
    } else if (role === 'character') {
      setCharacterAsset((prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return { ...prev, filled: true, previewUrl, fileName: file.name, file, backendPath: undefined, source: undefined }
      })
      showToast(`Đã nạp ảnh nhân vật: ${file.name}`)
    } else if (role === 'motion') {
      const tempVideo = document.createElement('video')
      tempVideo.preload = 'metadata'
      tempVideo.src = previewUrl
      tempVideo.onloadedmetadata = () => {
        const dur = tempVideo.duration
        if (Number.isFinite(dur) && dur > 0) {
          if (dur < 3) {
            showToast(`Cảnh báo: Video chỉ dài ${dur.toFixed(1)}s (yêu cầu tối thiểu 3s).`)
          }
          const safeEnd = Math.min(MOTION_MAX_DURATION_SECONDS, Math.max(MOTION_MIN_DURATION_SECONDS, Math.floor(dur)))
          setMotionAsset((prev) => ({
            ...prev,
            trimStartSec: 0,
            trimEndSec: safeEnd,
            durationSec: dur,
          }))
          setOutputConfig((prev) => {
            const next = {
              ...prev,
              durationSeconds: safeEnd,
              creditCost: estimateMotionCreditCost(safeEnd, prev.resolution),
            }
            saveStoredMotionConfig(next, creativeDirectionRef.current)
            return next
          })
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
  }, [extraCharacters, showToast, updateExtraCharacter])

  const handleAddCharacter = useCallback(() => {
    if (!canAddMotionCharacter(extraCharacters.length, sceneAsset.filled)) {
      showToast(`Flow nhận tối đa ${MAX_MOTION_REFERENCE_IMAGES} ảnh tham chiếu (nhân vật + bối cảnh).`)
      return
    }
    const n = extraCharacters.length + 2
    setExtraCharacters((prev) => [...prev, {
      id: newExtraCharacterId(),
      role: 'character',
      title: `Ảnh Nhân Vật ${n}`,
      required: false,
      filled: false,
      previewUrl: null,
      fileName: '',
    }])
  }, [extraCharacters.length, sceneAsset.filled, showToast])

  const handleClearAsset = useCallback((role: MotionAssetRole) => {
    const extraIdx = extraCharacterIndex(role)
    if (extraIdx >= 0) {
      // Ô nhân vật thêm: xóa luôn ô (ô sau dồn lên), để thứ tự Image 1…N không bị lỗ.
      setExtraCharacters((prev) => prev.filter((a, i) => {
        if (i === extraIdx && a.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(a.previewUrl)
        return i !== extraIdx
      }))
      showToast(`Đã bỏ ô nhân vật ${extraIdx + 2}`)
      return
    }
    if (role === 'character') {
      setCharacterAsset((prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return { ...prev, filled: false, previewUrl: null, fileName: '', file: undefined, backendPath: undefined, source: undefined }
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

  /** Ghi chú "thay người nào trong video" của ô nhân vật thứ `index` (0 = ô chính). */
  const handleUpdateCharacterTarget = useCallback((index: number, target: string) => {
    if (index === 0) setCharacterAsset((prev) => ({ ...prev, target }))
    else {
      const extra = extraCharacters[index - 1]
      if (extra) updateExtraCharacter(extra.id, (prev) => ({ ...prev, target }))
    }
  }, [extraCharacters, updateExtraCharacter])

  const handleUpdateAssetMeta = useCallback((role: MotionAssetRole, updates: Partial<MotionReferenceAsset>) => {
    if (role === 'character') setCharacterAsset((prev) => ({ ...prev, ...updates }))
    else if (role === 'motion') {
      setMotionAsset((prev) => {
        const next = { ...prev, ...updates }
        const trimStart = next.trimStartSec ?? 0
        const trimEnd = next.trimEndSec ?? outputConfigRef.current.durationSeconds ?? 10
        const duration = trimEnd - trimStart
        if (Number.isFinite(duration) && duration > 0) {
          setOutputConfig((config) => {
            const updated = {
              ...config,
              durationSeconds: duration,
              creditCost: estimateMotionCreditCost(duration, config.resolution),
            }
            if (getMotionTrimDuration(trimStart, trimEnd) !== null) {
              saveStoredMotionConfig(updated, creativeDirectionRef.current)
            }
            return updated
          })
        }
        return next
      })
    }
    else if (role === 'scene') setSceneAsset((prev) => ({ ...prev, ...updates }))
  }, [])

  // -------------------------------------------------------------
  // Library Pickers State & Handlers
  // -------------------------------------------------------------
  const [imagePickerRole, setImagePickerRole] = useState<Exclude<MotionAssetRole, 'motion'> | null>(null)
  const [isVideoPickerOpen, setIsVideoPickerOpen] = useState(false)

  const handleOpenLibrary = useCallback((role: MotionAssetRole) => {
    if (role === 'motion') {
      setIsVideoPickerOpen(true)
    } else if (role === 'scene' && !canAddMotionScene(extraCharacters.length)) {
      showToast(`Flow nhận tối đa ${MAX_MOTION_REFERENCE_IMAGES} ảnh tham chiếu: bỏ bớt một ô nhân vật trước khi thêm bối cảnh.`)
    } else {
      setImagePickerRole(role)
    }
  }, [extraCharacters.length, showToast])

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

    const extraIdx = extraCharacterIndex(role)
    const extra = extraIdx >= 0 ? extraCharacters[extraIdx] : undefined
    if (extra) {
      updateExtraCharacter(extra.id, (prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return {
          ...prev,
          filled: true,
          previewUrl,
          fileName: assetRef.fileName || `${item.id}.jpg`,
          backendPath: assetRef.backendPath,
          file,
          source: undefined,
        }
      })
      showToast(`Đã nạp ảnh nhân vật ${extraIdx + 2} từ Thư Viện Ảnh`)
    } else if (role === 'character') {
      setCharacterAsset((prev) => {
        if (prev.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(prev.previewUrl)
        return {
          ...prev,
          filled: true,
          previewUrl,
          fileName: assetRef.fileName || `${item.id}.jpg`,
          backendPath: assetRef.backendPath,
          file,
          source: undefined,
        }
      })
      showToast(`Đã nạp ảnh nhân vật từ Thư Viện Ảnh`)
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
      showToast(`Đã nạp ảnh bối cảnh từ Thư Viện Ảnh`)
    }
  }, [extraCharacters, imagePickerRole, showToast, updateExtraCharacter])

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
    const trimEnd = Math.min(MOTION_MAX_DURATION_SECONDS, Math.max(MOTION_MIN_DURATION_SECONDS, Math.round(duration)))

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
        durationSec: clip.durationSec || undefined,
      }
    })

    setOutputConfig((config) => {
      const next: MotionOutputConfig = {
        ...config,
        durationSeconds: trimEnd,
        aspectRatio: clip.aspectRatio === '16:9' ? '16:9' : '9:16',
        creditCost: estimateMotionCreditCost(trimEnd, config.resolution),
      }
      saveStoredMotionConfig(next, creativeDirectionRef.current)
      return next
    })

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
    // Node tùy chọn: hiện sẵn bên trái ô Nhân Vật (nút X để ẩn, mở lại từ thanh bên trái). Không ảnh hưởng luồng tạo video.
    {
      id: CHARACTER_SHEET_NODE_ID,
      type: 'motionCharacterSheet',
      position: CHARACTER_SHEET_POSITION,
      data: {},
    },
    {
      id: 'n-refs',
      type: 'motionRefGroup',
      position: { x: 40, y: 80 },
      data: {},
    },
    {
      id: 'n-creative',
      type: 'motionCreative',
      position: { x: 480, y: 80 },
      data: {},
    },
    {
      id: 'n-preview',
      type: 'motionPreview',
      position: { x: 860, y: 80 },
      data: {},
    },
    {
      id: 'n-output',
      type: 'motionOutput',
      position: { x: 1250, y: 80 },
      data: {},
    },
  ])

  // -------------------------------------------------------------
  // 9. Edges State (Neutral Dashed, Animated When Running)
  // -------------------------------------------------------------
  const [edges, setEdges] = useState<Edge[]>([
    CHARACTER_SHEET_EDGE,
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

  // -------------------------------------------------------------
  // 9b. Node tùy chọn "Tạo Ảnh Nhân Vật Mới": ảnh người + trang phục -> ảnh tham chiếu nhân vật (ChatGPT).
  //     Chỉ ghi vào ô Nhân Vật khi người dùng bấm "Dùng làm Ảnh Nhân Vật"; luồng tạo video không đọc node này.
  // -------------------------------------------------------------
  const [characterSheet, setCharacterSheet] = useState<CharacterSheetState>(EMPTY_CHARACTER_SHEET)
  const sheetRunningRef = useRef(false)
  const sheetApplied = isSheetApplied(characterSheet.result, characterAsset)

  const revokeBlob = (url?: string | null) => {
    if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
  }

  const openCharacterSheetNode = useCallback(() => {
    setNodes((nds) => nds.some((n) => n.id === CHARACTER_SHEET_NODE_ID)
      ? nds
      : [...nds, { id: CHARACTER_SHEET_NODE_ID, type: 'motionCharacterSheet', position: CHARACTER_SHEET_POSITION, data: {} }])
    setEdges((eds) => eds.some((e) => e.id === CHARACTER_SHEET_EDGE_ID) ? eds : [...eds, CHARACTER_SHEET_EDGE])
    // Node nằm bên trái canvas, có thể ngoài khung nhìn hiện tại: căn lại khung nhìn sau khi node được vẽ.
    setTimeout(() => {
      void flowInstanceRef.current?.fitView({ padding: 0.15, duration: 300 })
    }, 60)
  }, [])

  const closeCharacterSheetNode = useCallback(() => {
    if (sheetRunningRef.current) return
    setNodes((nds) => nds.filter((n) => n.id !== CHARACTER_SHEET_NODE_ID))
    setEdges((eds) => eds.filter((e) => e.source !== CHARACTER_SHEET_NODE_ID))
  }, [])

  const handleSheetFile = useCallback((role: CharacterSheetRole, file: File) => {
    const problem = characterSheetFileError(file)
    if (problem) {
      showToast(problem)
      return
    }
    const previewUrl = URL.createObjectURL(file)
    setCharacterSheet((prev) => {
      revokeBlob(prev[role]?.previewUrl)
      return withSource(prev, role, { fileName: file.name, previewUrl, file })
    })
  }, [showToast])

  const handleSheetClear = useCallback((role: CharacterSheetRole) => {
    setCharacterSheet((prev) => {
      revokeBlob(prev[role]?.previewUrl)
      return withSource(prev, role, null)
    })
  }, [])

  const handleSheetUseCharacterSlot = useCallback(() => {
    if (!characterAsset.filled || characterAsset.source === 'character_sheet') return
    // URL blob riêng: ô Nhân Vật đổi ảnh (và thu hồi URL của nó) không làm hỏng ảnh xem trước ở node này.
    const previewUrl = characterAsset.file ? URL.createObjectURL(characterAsset.file) : characterAsset.previewUrl
    setCharacterSheet((prev) => {
      revokeBlob(prev.identity?.previewUrl)
      return withSource(prev, 'identity', {
        fileName: characterAsset.fileName,
        previewUrl,
        file: characterAsset.file,
        backendPath: characterAsset.backendPath,
      })
    })
  }, [characterAsset])

  const handleSheetChangeText = useCallback((text: string) => {
    setCharacterSheet((prev) => ({ ...prev, changes: text }))
  }, [])

  const handleGenerateSheet = useCallback(async () => {
    if (sheetRunningRef.current) return
    const snapshot = characterSheet
    const missing = characterSheetMissing(snapshot)
    if (missing.length > 0) {
      showToast(missing[0])
      return
    }
    sheetRunningRef.current = true
    setCharacterSheet((prev) => ({ ...prev, status: 'running', error: null }))
    try {
      const paths: Record<CharacterSheetRole, string> = { identity: '', outfit: '' }
      for (const role of ['identity', 'outfit'] as const) {
        const source = snapshot[role]!
        let path = source.backendPath
        if (!path && source.file) {
          const uploaded = await uploadImage(source.file)
          path = uploaded.file_path
          setCharacterSheet((prev) => (prev[role]?.file === source.file
            ? { ...prev, [role]: { ...prev[role]!, backendPath: uploaded.file_path } }
            : prev))
        }
        paths[role] = path || ''
      }
      const result = await generateMotionCharacterSheet(paths.identity, paths.outfit, snapshot.changes.trim())
      setCharacterSheet((prev) => ({ ...prev, status: 'done', error: null, result }))
      showToast(`Đã tạo ảnh nhân vật mới (${result.seconds}s). Bấm “Dùng làm Ảnh Nhân Vật” để đưa vào ô Nhân Vật.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setCharacterSheet((prev) => ({ ...prev, status: 'error', error: message }))
      showToast(`Không tạo được ảnh nhân vật: ${message}`)
    } finally {
      sheetRunningRef.current = false
    }
  }, [characterSheet, showToast])

  const handleApplySheet = useCallback(() => {
    const result = characterSheet.result
    if (!result || isRunning) return
    setCharacterAsset((prev) => {
      revokeBlob(prev.previewUrl)
      return {
        ...prev,
        filled: true,
        previewUrl: result.previewUrl,
        fileName: result.fileName,
        file: undefined,
        backendPath: result.backendPath,
        source: 'character_sheet',
      }
    })
    setActiveRole('character')
    showToast('Đã đưa ảnh nhân vật mới vào ô Nhân Vật. Prompt tự đổi câu mở đầu cho ảnh dạng sheet.')
  }, [characterSheet.result, isRunning, showToast])

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
            extraCharacters,
            canAddCharacter,
            maxImages: MAX_MOTION_REFERENCE_IMAGES,
            onAddCharacter: handleAddCharacter,
            selectedRole: activeRole,
            isRunning,
            onSelectRole: (role: 'character' | 'motion' | 'scene') => {
              setActiveRole(role)
              setSelectedNodeType('reference')
              setIsInspectorOpen(true)
            },
            onUploadFile: handleUploadFile,
            onOpenLibrary: handleOpenLibrary,
            onRemoveAsset: handleClearAsset,
            onPreviewMedia: (url: string, title?: string, isVideo?: boolean) => {
              if (isVideo && onOpenPreviewModal) {
                onOpenPreviewModal(url, title || 'Video Tham Chiếu')
              }
            },
          },
        }
      }
      if (node.id === CHARACTER_SHEET_NODE_ID) {
        return {
          ...node,
          data: {
            sheet: characterSheet,
            canUseCharacterSlot: characterAsset.filled && characterAsset.source !== 'character_sheet',
            applied: sheetApplied,
            isMotionRunning: isRunning,
            onPickFile: handleSheetFile,
            onClearSource: handleSheetClear,
            onUseCharacterSlot: handleSheetUseCharacterSlot,
            onChangeText: handleSheetChangeText,
            onGenerate: handleGenerateSheet,
            onApply: handleApplySheet,
            onClose: closeCharacterSheetNode,
          },
        }
      }
      if (node.id === 'n-creative') {
        return {
          ...node,
          data: {
            creative: creativeDirection,
            mode: structuredPrompt.mode,
            options: structuredPrompt.options,
            characterCount,
            hasScene: sceneAsset.filled,
            isRunning,
            onUpdateCreative: handleUpdateCreative,
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
            charCount: activePrompt.length,
            isCustom: isCustomPrompt,
            isStale: customPromptStale,
            blockers: isCustomPrompt ? [] : structuredPrompt.blockers,
            warnings: isCustomPrompt ? [] : structuredPrompt.warnings,
            isRunning,
            onPromptChange: handleEditCustomPrompt,
            onRebuild: handleResetToAutoPrompt,
            onKeepCustom: handleKeepCustomPrompt,
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
            resultVideoUrl: resultVideoUrls[activeVariantIndex] || resultVideoUrl,
            resultVideoUrls,
            activeVariantIndex,
            onSelectVariantIndex: (idx: number) => setActiveVariantIndex(idx),
            variants: variantSlots,
            onRetryVariant: (vIdx: number) => handleRetryVariant(vIdx),
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
    extraCharacters,
    canAddCharacter,
    handleAddCharacter,
    activeRole,
    isRunning,
    handleUploadFile,
    handleOpenLibrary,
    creativeDirection,
    activePrompt,
    structuredPrompt,
    characterCount,
    handleUpdateCreative,
    isCustomPrompt,
    customPromptStale,
    handleEditCustomPrompt,
    handleResetToAutoPrompt,
    handleKeepCustomPrompt,
    outputConfig,
    isReadyToRun,
    missingReasons,
    runningStageText,
    runError,
    resultVideoUrl,
    resultVideoUrls,
    activeVariantIndex,
    variantSlots,
    workflowName,
    selectedProject,
    onOpenPreviewModal,
    characterSheet,
    sheetApplied,
    handleSheetFile,
    handleSheetClear,
    handleSheetUseCharacterSlot,
    handleSheetChangeText,
    handleGenerateSheet,
    handleApplySheet,
    closeCharacterSheetNode,
  ])

  // Attach styles & handlers to edges dynamically
  const edgesWithData = useMemo(() => {
    return edges.map((e) => ({
      ...e,
      type: 'removable',
      animated: isRunning,
      style: {
        stroke: e.id === CHARACTER_SHEET_EDGE_ID
          ? '#10B981'
          : isRunning ? '#4F46E5' : e.id === 'e-motion-creative' ? '#EA580C' : '#94A3B8',
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
    (changes: NodeChange[]) => {
      // Không cho xóa node tạo ảnh nhân vật (phím Delete) khi đang chờ ChatGPT trả ảnh.
      const allowed = changes.filter(
        (c) => !(c.type === 'remove' && c.id === CHARACTER_SHEET_NODE_ID && sheetRunningRef.current)
      )
      setNodes((nds) => applyNodeChanges(allowed, nds))
    },
    []
  )

  const onEdgesChange = useCallback(
    (changes: EdgeChange[]) => setEdges((eds) => applyEdgeChanges(changes, eds)),
    []
  )

  // Connection validation
  const isValidConnection = useCallback((connection: Connection) => {
    // 0. Node "Tạo Ảnh Nhân Vật Mới" chỉ nối vào cổng của ô Nhân Vật, và cổng đó chỉ nhận từ node này
    if (connection.source === CHARACTER_SHEET_NODE_ID) {
      return connection.target === 'n-refs' && connection.targetHandle === CHARACTER_SHEET_TARGET_HANDLE
    }
    if (connection.targetHandle === CHARACTER_SHEET_TARGET_HANDLE) return false
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
    const requestedVariants = Math.min(4, Math.max(1, outputConfig.numOutputs || 1))
    const idempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `motion-${Date.now()}-${Math.random().toString(36).slice(2)}`
    setIsRunning(true)
    setRunningStageText('Đang kiểm tra kết nối Veo Flow Studio...')
    setResultVideoUrl(null)
    setResultVideoUrls([])
    setActiveVariantIndex(0)
    setRunError(null)

    const initialSlots: MotionVariantSlot[] = Array.from({ length: requestedVariants }, (_, i) => ({
      index: i + 1,
      status: 'idle',
      videoUrl: null,
      error: null,
    }))
    setVariantSlots(initialSlots)

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
        const uploadRes = await uploadVideoReference(motionAsset.file, flowProjectId, { forceFresh: forceFreshAssets, nativeUi: false })
        motionMediaId = uploadRes.media_id
        setMotionAsset((prev) => ({ ...prev, mediaId: uploadRes.media_id, mediaProjectId: flowProjectId }))
      }
      if (!motionMediaId) {
        throw new Error('Video tham chiếu chưa có file gốc để upload vào Flow project mới. Hãy chọn lại video local.')
      }

      // Nhân vật 1, 2, 3 rồi bối cảnh — đúng thứ tự "Image N" trong prompt.
      const ingredientImagePaths = await ensureMotionImagePaths((text) => {
        currentStage = 'image_upload'
        setRunningStageText(text)
      })
      if (ingredientImagePaths.length > MAX_MOTION_REFERENCE_IMAGES) {
        throw new Error(`Flow nhận tối đa ${MAX_MOTION_REFERENCE_IMAGES} ảnh tham chiếu (đang có ${ingredientImagePaths.length}).`)
      }

      const finishedUrls: string[] = []

      for (let variantIdx = 1; variantIdx <= requestedVariants; variantIdx++) {
        const currentSlotIndex = variantIdx - 1
        currentStage = 'submission'
        const stagePrefix = requestedVariants > 1 ? `[Biến thể ${variantIdx}/${requestedVariants}] ` : ''
        setRunningStageText(`${stagePrefix}Đang gửi job Motion Control tới Google Flow...`)

        setVariantSlots((prev) => {
          const next = [...prev]
          if (next[currentSlotIndex]) {
            next[currentSlotIndex] = {
              ...next[currentSlotIndex],
              status: 'submitting',
              progressText: `${stagePrefix}Đang gửi job...`,
            }
          }
          return next
        })

        const variantKey = requestedVariants > 1 ? `${idempotencyKey}-v${variantIdx}` : idempotencyKey
        let jobRes
        try {
          jobRes = await submitJob({
            project_id: projectId,
            prompt: activePrompt.trim(),
            model_display_name: selectedProfile.model_display_name,
            input_mode: 'video_edit',
            aspect_ratio: selectedProfile.aspect_ratio,
            duration_seconds: outputConfig.durationSeconds,
            resolution: selectedProfile.resolution,
            num_outputs: 1,
            ingredient_image_paths: ingredientImagePaths,
            reference_video_id: motionMediaId,
            reference_video_start_seconds: motionAsset.trimStartSec ?? 0,
            reference_video_end_seconds: motionAsset.trimEndSec ?? (motionAsset.trimStartSec ?? 0) + outputConfig.durationSeconds,
            force_fresh_assets: forceFreshAssets,
            idempotency_key: variantKey,
          })
        } catch (submitErr) {
          const detailedError = motionRunErrorFromUnknown(submitErr, 'submission')
          setVariantSlots((prev) => {
            const next = [...prev]
            if (next[currentSlotIndex]) {
              next[currentSlotIndex] = {
                ...next[currentSlotIndex],
                status: 'error',
                error: detailedError,
              }
            }
            return next
          })
          showToast(`Biến thể #${variantIdx} không thể gửi job: ${detailedError.title}`)
          continue
        }

        submittedJobId = jobRes.job_id
        if (jobRes.deduplicated) {
          showToast(`Đã dùng lại job ${jobRes.job_id}; không tạo render trùng.`)
        }

        setVariantSlots((prev) => {
          const next = [...prev]
          if (next[currentSlotIndex]) {
            next[currentSlotIndex] = {
              ...next[currentSlotIndex],
              jobId: jobRes.job_id,
              status: 'generating',
              progressText: `${stagePrefix}Flow đang xử lý video...`,
            }
          }
          return next
        })

        currentStage = 'generation'
        let outputFile: string | null = null
        let variantError: MotionRunError | null = null

        for (let pollCount = 1; pollCount <= 240; pollCount += 1) {
          await new Promise((resolve) => setTimeout(resolve, 2500))
          const status = await getJobStatus(jobRes.job_id)
          if (!status) continue

          const stepDetail = status.current_step || `Google Flow: ${status.status} (${pollCount}/240)`
          setRunningStageText(`${stagePrefix}${stepDetail}`)
          setVariantSlots((prev) => {
            const next = [...prev]
            if (next[currentSlotIndex]) {
              next[currentSlotIndex] = {
                ...next[currentSlotIndex],
                progressText: stepDetail,
              }
            }
            return next
          })

          if (status.status === 'captcha') currentStage = 'captcha'
          else if (status.status === 'submitting') currentStage = 'submission'
          else if (status.status === 'generating') currentStage = 'generation'
          else if (status.status === 'downloading') currentStage = 'download'

          if (status.status === 'error') {
            variantError = motionRunErrorFromJob(status, currentStage)
            setVariantSlots((prev) => {
              const next = [...prev]
              if (next[currentSlotIndex]) {
                next[currentSlotIndex] = {
                  ...next[currentSlotIndex],
                  status: 'error',
                  error: variantError,
                }
              }
              return next
            })
            showToast(`Biến thể #${variantIdx} gặp lỗi: ${variantError.title}`)
            break
          }
          if (status.status === 'done') {
            outputFile = status.output_files[0] || null
            break
          }
        }

        if (outputFile) {
          const streamUrl = getVideoStreamUrl(outputFile)
          finishedUrls.push(streamUrl)
          setVariantSlots((prev) => {
            const next = [...prev]
            if (next[currentSlotIndex]) {
              next[currentSlotIndex] = {
                ...next[currentSlotIndex],
                status: 'done',
                videoUrl: streamUrl,
                error: null,
              }
            }
            return next
          })
          setResultVideoUrls([...finishedUrls])
          setResultVideoUrl(streamUrl)
          setActiveVariantIndex(currentSlotIndex)
          showToast(
            requestedVariants > 1
              ? `✓ Đã tạo xong biến thể ${variantIdx}/${requestedVariants}!`
              : 'Video Motion Control đã render thành công từ Google Flow.'
          )
        } else if (!variantError) {
          const timeoutErr: MotionRunError = {
            code: 'FLOW_TIMEOUT',
            title: 'Quá thời gian chờ phản hồi',
            stage: 'generation',
            stageLabel: 'Tạo Video Flow',
            message: `Biến thể #${variantIdx} không hoàn thành trong thời gian quy định.`,
            hint: 'Hãy kiểm tra tab Google Flow hoặc bấm thử lại riêng biến thể này.',
            jobId: jobRes.job_id,
            retryable: true,
          }
          setVariantSlots((prev) => {
            const next = [...prev]
            if (next[currentSlotIndex]) {
              next[currentSlotIndex] = {
                ...next[currentSlotIndex],
                status: 'error',
                error: timeoutErr,
              }
            }
            return next
          })
        }
      }

      if (finishedUrls.length > 0) {
        onOpenPreviewModal?.(
          finishedUrls[0],
          workflowName,
          activePrompt,
          outputConfig.showReferenceComparison !== false ? motionAsset.previewUrl : null,
        )
        if (finishedUrls.length < requestedVariants) {
          showToast(`Đã hoàn tất ${finishedUrls.length}/${requestedVariants} biến thể. Biến thể bị lỗi có thể bấm Thử lại.`)
        }
      } else {
        const failureErr: MotionRunError = {
          code: 'ALL_VARIANTS_FAILED',
          title: 'Tất cả biến thể đều gặp sự cố',
          stage: 'generation',
          stageLabel: 'Tạo Video Flow',
          message: 'Không có biến thể nào hoàn tất thành công từ Google Flow.',
          hint: 'Hãy xem chi tiết lỗi của từng biến thể trên tab và bấm Thử lại.',
          retryable: true,
        }
        setRunError(failureErr)
      }
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
  // 10b. Thử lại riêng một biến thể lỗi (Retry Single Variant)
  // -------------------------------------------------------------
  const handleRetryVariant = useCallback(async (variantIndex: number) => {
    if (isRunning || runLockRef.current) return
    const slotIdx = variantIndex - 1
    runLockRef.current = true
    setIsRunning(true)
    setActiveVariantIndex(slotIdx)

    const retryIdempotencyKey = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? `${crypto.randomUUID()}-retry-v${variantIndex}`
      : `motion-retry-${Date.now()}-v${variantIndex}`

    setRunningStageText(`Đang thử lại riêng biến thể #${variantIndex}...`)
    setVariantSlots((prev) => {
      const next = [...prev]
      if (next[slotIdx]) {
        next[slotIdx] = {
          ...next[slotIdx],
          status: 'submitting',
          error: null,
          progressText: 'Đang gửi lại job tới Google Flow...',
        }
      }
      return next
    })

    let currentStage: MotionRunStage = 'submission'
    let submittedJobId: string | undefined

    try {
      const bridgeStatus = await getBridgeStatus()
      if (!bridgeStatus.bridge_running || !bridgeStatus.extension.connected) {
        throw new Error('Extension Flow chưa kết nối với Backend. Hãy mở Flow và kiểm tra extension.')
      }

      const runtimeProject = selectedProject || await getActiveProject()
      const projectId = runtimeProject?.id
      const flowProjectId = runtimeProject?.flow_project_id
      if (!projectId || !flowProjectId) {
        throw new Error('Chưa có thông tin Flow project. Hãy chạy lại toàn bộ lượt tạo.')
      }
      if (!selectedProfile) {
        throw new Error('Chưa có profile video_edit phù hợp.')
      }

      let motionMediaId = motionAsset.mediaId
      if (!motionMediaId && motionAsset.file) {
        currentStage = 'reference_upload'
        setRunningStageText(`Đang tải video mẫu (${motionAsset.fileName}) vào project...`)
        const uploadRes = await uploadVideoReference(motionAsset.file, flowProjectId, { forceFresh: false, nativeUi: false })
        motionMediaId = uploadRes.media_id
        setMotionAsset((prev) => ({ ...prev, mediaId: uploadRes.media_id, mediaProjectId: flowProjectId }))
      }
      if (!motionMediaId) {
        throw new Error('Không tìm thấy video tham chiếu để thử lại. Hãy chọn lại video local.')
      }

      const ingredientImagePaths = orderedMotionImages(characterAsset, extraCharacters, sceneAsset)
        .map((a) => a.backendPath)
        .filter((p): p is string => Boolean(p))

      const jobRes = await submitJob({
        project_id: projectId,
        prompt: activePrompt.trim(),
        model_display_name: selectedProfile.model_display_name,
        input_mode: 'video_edit',
        aspect_ratio: selectedProfile.aspect_ratio,
        duration_seconds: outputConfig.durationSeconds,
        resolution: selectedProfile.resolution,
        num_outputs: 1,
        ingredient_image_paths: ingredientImagePaths,
        reference_video_id: motionMediaId,
        reference_video_start_seconds: motionAsset.trimStartSec ?? 0,
        reference_video_end_seconds: motionAsset.trimEndSec ?? (motionAsset.trimStartSec ?? 0) + outputConfig.durationSeconds,
        force_fresh_assets: false,
        idempotency_key: retryIdempotencyKey,
      })

      submittedJobId = jobRes.job_id
      setVariantSlots((prev) => {
        const next = [...prev]
        if (next[slotIdx]) {
          next[slotIdx] = {
            ...next[slotIdx],
            jobId: jobRes.job_id,
            status: 'generating',
            progressText: 'Flow đang xử lý video...',
          }
        }
        return next
      })

      currentStage = 'generation'
      let outputFile: string | null = null

      for (let pollCount = 1; pollCount <= 240; pollCount += 1) {
        await new Promise((resolve) => setTimeout(resolve, 2500))
        const status = await getJobStatus(jobRes.job_id)
        if (!status) continue

        const stepDetail = status.current_step || `Google Flow: ${status.status} (${pollCount}/240)`
        setRunningStageText(`[Thử lại #${variantIndex}] ${stepDetail}`)
        setVariantSlots((prev) => {
          const next = [...prev]
          if (next[slotIdx]) {
            next[slotIdx] = {
              ...next[slotIdx],
              progressText: stepDetail,
            }
          }
          return next
        })

        if (status.status === 'captcha') currentStage = 'captcha'
        else if (status.status === 'submitting') currentStage = 'submission'
        else if (status.status === 'generating') currentStage = 'generation'
        else if (status.status === 'downloading') currentStage = 'download'

        if (status.status === 'error') {
          const detailedError = motionRunErrorFromJob(status, currentStage)
          setVariantSlots((prev) => {
            const next = [...prev]
            if (next[slotIdx]) {
              next[slotIdx] = {
                ...next[slotIdx],
                status: 'error',
                error: detailedError,
              }
            }
            return next
          })
          showToast(`Thử lại biến thể #${variantIndex} thất bại: ${detailedError.title}`)
          return
        }

        if (status.status === 'done') {
          outputFile = status.output_files[0] || null
          break
        }
      }

      if (outputFile) {
        const streamUrl = getVideoStreamUrl(outputFile)
        setVariantSlots((prev) => {
          const next = [...prev]
          if (next[slotIdx]) {
            next[slotIdx] = {
              ...next[slotIdx],
              status: 'done',
              videoUrl: streamUrl,
              error: null,
            }
          }
          return next
        })
        setResultVideoUrls((prev) => {
          const updated = [...prev]
          while (updated.length < variantIndex) updated.push('')
          updated[slotIdx] = streamUrl
          return updated
        })
        setResultVideoUrl(streamUrl)
        setRunError(null)
        showToast(`✓ Đã tạo thành công biến thể #${variantIndex}!`)
      }
    } catch (err: unknown) {
      const detailedError = motionRunErrorFromUnknown(err, currentStage, submittedJobId)
      setVariantSlots((prev) => {
        const next = [...prev]
        if (next[slotIdx]) {
          next[slotIdx] = {
            ...next[slotIdx],
            status: 'error',
            error: detailedError,
          }
        }
        return next
      })
      showToast(`Thử lại biến thể #${variantIndex} thất bại: ${detailedError.title}`)
    } finally {
      setIsRunning(false)
      setRunningStageText('')
      runLockRef.current = false
    }
  }, [
    activePrompt,
    characterAsset,
    extraCharacters,
    sceneAsset,
    isRunning,
    motionAsset.file,
    motionAsset.fileName,
    motionAsset.mediaId,
    motionAsset.trimEndSec,
    motionAsset.trimStartSec,
    outputConfig.durationSeconds,
    selectedProfile,
    selectedProject,
  ])

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
        {
          id: 'character-sheet',
          name: 'Tạo Ảnh Nhân Vật Mới',
          desc: 'Tùy chọn: ảnh của bạn + trang phục → ảnh nhân vật mới (ChatGPT)',
          icon: <UserPlus size={16} />,
          onClick: () => {
            openCharacterSheetNode()
            showToast('Đã mở node “Tạo Ảnh Nhân Vật Mới” bên trái ô Nhân Vật.')
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
          name: 'Tạo Video (Flow · Omni 1.2)',
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
          {motionAsset.file && needsLongMotion(motionAsset.durationSec) && (
            <button
              type="button"
              className="mf-btn"
              onClick={() => setIsLongOpen(true)}
              title={`Video mẫu dài ${(motionAsset.durationSec ?? 0).toFixed(1)} giây: cắt thành nhiều đoạn, tạo lần lượt rồi ghép`}
              data-testid="open-long-motion"
            >
              <Layers size={14} />
              <span>Mở rộng video dài</span>
            </button>
          )}
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
                if (node.id === CHARACTER_SHEET_NODE_ID) return   // node tự chứa, không có trang Inspector
                if (node.id === 'n-refs') setSelectedNodeType('reference')
                else if (node.id === 'n-creative') setSelectedNodeType('creative')
                else if (node.id === 'n-preview') setSelectedNodeType('preview')
                else if (node.id === 'n-output') setSelectedNodeType('output')
                setIsInspectorOpen(true)
              }}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              onInit={(instance) => {
                flowInstanceRef.current = instance
              }}
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
            presets={motionPresets}
            activePresetId={outputConfig.activePresetId || 'choreography'}
            onSelectPreset={handleSelectPreset}
            character={characterAsset}
            motion={motionAsset}
            scene={sceneAsset}
            onUploadFile={handleUploadFile}
            onClearAsset={handleClearAsset}
            onUpdateAssetMeta={handleUpdateAssetMeta}
            onOpenLibrary={handleOpenLibrary}
            creative={creativeDirection}
            onUpdateCreative={handleUpdateCreative}
            onResetDefaultPrompt={handleResetDefaultPrompt}
            structuredPrompt={structuredPrompt}
            isCustomPrompt={isCustomPrompt}
            customPromptText={customPromptText}
            onUpdateCustomPromptText={handleEditCustomPrompt}
            onResetToAutoPrompt={handleResetToAutoPrompt}
            isCustomPromptStale={customPromptStale}
            onKeepCustomPrompt={handleKeepCustomPrompt}
            extraCharacters={extraCharacters}
            canAddCharacter={canAddCharacter}
            onAddCharacter={handleAddCharacter}
            onUpdateCharacterTarget={handleUpdateCharacterTarget}
            outputConfig={outputConfig}
            projects={projects}
            activeProject={selectedProject || null}
            lastRunProject={lastRunProject}
            isCreatingProject={isCreatingProject}
            onUpdateProjectConfig={handleUpdateProjectConfig}
            onSelectProject={onSelectProject}
            onCreateProject={async (name) => {
              const created = await handleCreateMotionProject(name)
              handleUpdateProjectConfig({ projectMode: 'selected' })
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
            variants={variantSlots}
            activeVariantIndex={activeVariantIndex}
            onSelectVariantIndex={setActiveVariantIndex}
            onRetryVariant={handleRetryVariant}
            onRunWorkflow={handleRunWorkflow}
          />

          {/* Modal Chọn Ảnh từ Thư Viện Veo Studio (Nhân vật / Bối cảnh) */}
          {Boolean(imagePickerRole) && (
            <VeoImagePickerModal
              isOpen={Boolean(imagePickerRole)}
              onClose={() => setImagePickerRole(null)}
              targetLabel={imagePickerRole === 'scene'
                ? 'Ảnh Bối Cảnh'
                : extraCharacterIndex(imagePickerRole!) >= 0
                  ? `Ảnh Nhân Vật ${extraCharacterIndex(imagePickerRole!) + 2}`
                  : 'Ảnh Nhân Vật'}
              kind={imagePickerRole === 'scene' ? 'scene' : 'model'}
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

      {isLongOpen && motionAsset.file && (
        <LongMotionPanel
          video={{ file: motionAsset.file, fileName: motionAsset.fileName, durationSec: motionAsset.durationSec ?? 0 }}
          prompt={activePrompt}
          aspectRatio={outputConfig.aspectRatio === '16:9' ? '16:9' : '9:16'}
          getImagePaths={getLongMotionImagePaths}
          onClose={() => setIsLongOpen(false)}
          onToast={showToast}
        />
      )}

      {/* Floating Toast Notification */}
      <div className={`mf-toast ${toastMsg ? 'show' : ''}`} role="status">
        {toastMsg}
      </div>
    </div>
  )
}
