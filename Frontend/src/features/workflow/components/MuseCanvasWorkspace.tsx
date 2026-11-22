/**
 * Canvas AI → tab "Muse Canvas".
 * - MuseCanvasInner: cấu hình dùng chung, tài khoản Muse, Google Flow, danh sách project + panel cấu hình.
 * - MuseCanvasBoard (bọc ReactFlowProvider, key = id project): đồ thị của 1 project — đổi project thì board gắn lại
 *   từ đầu; lúc gỡ, board lưu ngay phần chưa kịp lưu. Lượt đang chạy của node không mất khi đổi project
 *   (services/museRunRegistry.ts, vòng hỏi job Flow / ghép tự giành quyền khi node hiện lại).
 * - Cài đặt riêng của project (project Flow, khung hình, chất lượng, tiền tố file) ghép đè lên cấu hình chung
 *   (`applyProjectSettings`) — node chỉ thấy cấu hình đã ghép qua context.
 * Node mới: thêm vào MUSE_NODE_TYPES + services/museCanvasNodes.ts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Background,
  BackgroundVariant,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  addEdge,
  useEdgesState,
  useNodesState,
  useReactFlow,
  type Connection,
  type Edge,
  type EdgeTypes,
  type IsValidConnection,
  type OnConnectEnd,
  type Node,
  type NodeTypes,
  type Viewport,
} from '@xyflow/react'
import type { MutableRefObject, ReactNode } from 'react'
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  MapPin,
  NotebookPen,
  FileText,
  Film,
  Search,
  Loader2,
  MessagesSquare,
  Plus,
  RefreshCw,
  RotateCcw,
  ChevronDown,
  ChevronsLeft,
  ChevronsRight,
  LayoutPanelLeft,
  Scissors,
  Settings2,
  Shirt,
  UserRound,
  Sparkles,
  Timer,
  Users,
} from 'lucide-react'
import {
  DEFAULT_MUSE_CANVAS_CONFIG,
  MUSE_CHAT_MODE_OPTIONS,
  FLOW_MAX_SECONDS,
  FLOW_MAX_VARIANTS,
  FLOW_MIN_SECONDS,
  MUSE_MAX_PARALLEL,
  MUSE_MIN_TIMEOUT,
  museConfigWarnings,
  museRunBlockers,
  type MuseAccountLite,
  type MuseCanvasConfig,
} from '../services/museCanvasConfig.ts'
import {
  createMuseProject,
  deleteMuseProject,
  fetchMuseAccounts,
  fetchMuseCanvasConfig,
  fetchMuseProjectGraph,
  fetchMuseProjects,
  loadLocalMuseCanvasConfig,
  loadLocalProjectGraph,
  loadLocalProjectIndex,
  openMuseProject,
  saveMuseCanvasConfig,
  saveMuseProjectGraph,
  updateMuseProject,
} from '../services/museCanvasApi.ts'
import {
  DEFAULT_PROJECT_SETTINGS,
  applyProjectSettings,
  copyGraph,
  countRunsFor,
  isProjectSettingKey,
  uniqueProjectName,
  type CopyMode,
  type GraphLike,
  type MuseProjectIndex,
  type MuseProjectSettings,
} from '../services/museProjects.ts'
import { museRuns, runKeyNodeId } from '../services/museRunRegistry.ts'
import { MuseProjectBar, type SaveState } from './MuseProjectBar'
import { useTextPrompt } from './TextPromptDialog'
import {
  MUSE_NODE,
  JOB_SPECS,
  createInputNode,
  createJobNode,
  createScriptNode,
  createClipScriptNode,
  createClipMergeNode,
  createVideoRefNode,
  createPromptBoxNode,
  createVideoIngrNode,
  flowClipCredits,
  VIDEO_INGR_SPEC,
  CLIP_SCRIPT_SPEC,
  createStarter,
  isValidMuseConnection,
  SCRIPT_SPEC,
  museEdge,
  normalizeMuseEdges,
  MUSE_EDGE_TYPE,
  autoMuseConnection,
  explainMuseConnection,
  type MuseEdgeLike,
  type MuseNodeLike,
} from '../services/museCanvasNodes.ts'
import { MuseLinkEdge } from '../edges/MuseLinkEdge'
import { fetchMusePrompt } from '../services/museCanvasApi.ts'
import {
  checkFlowProject,
  createFlowProject,
  fetchFlowAccounts,
  listFlowProjects,
  type FlowAccount,
  type FlowProject,
  type FlowProjectCheck,
} from '../services/museCanvasApi.ts'
import { MuseInputNode } from '../nodes/muse/MuseInputNode'
import { MuseVideoRefNode } from '../nodes/muse/MuseVideoRefNode'
import { MuseVideoCutNode } from '../nodes/muse/MuseVideoCutNode'
import { createVideoCutNode } from '../services/museVideoCut.ts'
import { MusePromptBoxNode } from '../nodes/muse/MusePromptBoxNode'
import { MuseVideoIngredientsNode } from '../nodes/muse/MuseVideoIngredientsNode'
import { MuseJobNode } from '../nodes/muse/MuseJobNode'
import { MuseOutputNode } from '../nodes/muse/MuseOutputNode'
import { MuseScriptNode } from '../nodes/muse/MuseScriptNode'
import { MuseScriptTextNode } from '../nodes/muse/MuseScriptTextNode'
import { MuseVideoOutputNode } from '../nodes/muse/MuseVideoOutputNode'
import { GptClipScriptNode } from '../nodes/muse/GptClipScriptNode'
import { GptClipPromptNode } from '../nodes/muse/GptClipPromptNode'
import { GptClipMergeNode } from '../nodes/muse/GptClipMergeNode'
import { MuseCanvasContext, type MuseCanvasContextValue } from './museCanvasContext'
import { ImageLibraryModal } from './ImageLibraryModal'
import type { LibraryImage } from '../services/imageLibraryApi'
import { VeoVideoPickerModal } from './VeoVideoPickerModal'
import type { ExportedVideoItem } from '../contracts'
import { HelpHint } from '../../help/components/HelpHint'
import './museCanvas.css'

/** Loại node của Muse Canvas (khai báo ngoài component để React Flow không vẽ lại). */
const MUSE_NODE_TYPES: NodeTypes = {
  [MUSE_NODE.outfit]: MuseInputNode,
  [MUSE_NODE.extract]: MuseJobNode,
  [MUSE_NODE.character]: MuseInputNode,
  [MUSE_NODE.characterSheet]: MuseJobNode,
  [MUSE_NODE.scene]: MuseInputNode,
  [MUSE_NODE.scenePlace]: MuseJobNode,
  [MUSE_NODE.videoRef]: MuseVideoRefNode,
  [MUSE_NODE.videoCut]: MuseVideoCutNode,
  [MUSE_NODE.promptBox]: MusePromptBoxNode,
  [MUSE_NODE.videoIngredients]: MuseVideoIngredientsNode,
  [MUSE_NODE.output]: MuseOutputNode,
  [MUSE_NODE.script]: MuseScriptNode,
  [MUSE_NODE.scriptText]: MuseScriptTextNode,
  [MUSE_NODE.videoOutput]: MuseVideoOutputNode,
  [MUSE_NODE.clipScript]: GptClipScriptNode,
  [MUSE_NODE.clipPrompt]: GptClipPromptNode,
  [MUSE_NODE.clipMerge]: GptClipMergeNode,
}
const MUSE_EDGE_TYPES: EdgeTypes = { [MUSE_EDGE_TYPE]: MuseLinkEdge }

const PANEL_KEY = 'muse_canvas_panel_collapsed'
const SAVE_DEBOUNCE_MS = 800

interface MuseCanvasWorkspaceProps {
  onOpenSettings?: () => void
}

export function MuseCanvasWorkspace(props: MuseCanvasWorkspaceProps) {
  return <MuseCanvasInner {...props} />
}

function useDebounced(fn: () => void, deps: unknown[], ms: number, enabled: boolean) {
  useEffect(() => {
    if (!enabled) return
    const t = setTimeout(fn, ms)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled])
}

function MuseCanvasInner({ onOpenSettings }: MuseCanvasWorkspaceProps) {
  const [config, setConfig] = useState<MuseCanvasConfig>(() => loadLocalMuseCanvasConfig())
  const [accounts, setAccounts] = useState<MuseAccountLite[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [accountsError, setAccountsError] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [configSave, setConfigSave] = useState<SaveState>('idle')
  const [saveError, setSaveError] = useState('')
  // Panel cấu hình thu nhỏ (nhớ trên máy này)
  const [panelCollapsed, setPanelCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(PANEL_KEY) === '1'
    } catch {
      return false
    }
  })
  const togglePanel = useCallback((v: boolean) => {
    setPanelCollapsed(v)
    try {
      window.localStorage.setItem(PANEL_KEY, v ? '1' : '0')
    } catch {
      /* bỏ qua */
    }
  }, [])

  // ---------------------------------------------------------------- project
  const [index, setIndex] = useState<MuseProjectIndex>(() => loadLocalProjectIndex())
  const [projectsLoaded, setProjectsLoaded] = useState(false)
  const [projectBusy, setProjectBusy] = useState(false)
  const [projectNotice, setProjectNotice] = useState<{ kind: 'info' | 'err'; text: string } | null>(null)
  const activeId = index.activeId
  const project = index.projects.find((p) => p.id === activeId) ?? null
  /** Đồ thị mới nhất của board đang mở (để nhân bản / đếm lượt đang chạy khi đổi project). */
  const graphRef = useRef<(() => GraphLike) | null>(null)
  // Hỏi tên trong app: Electron không hỗ trợ window.prompt() (gọi là lỗi, nút bấm như không làm gì)
  const [askText, promptDialog] = useTextPrompt()

  const loadProjects = useCallback(async () => {
    try {
      setIndex(await fetchMuseProjects())
      setProjectNotice(null)
    } catch (e: any) {
      setProjectNotice({ kind: 'err', text: e?.message || 'Không tải được danh sách project' })
    } finally {
      setProjectsLoaded(true)
    }
  }, [])

  // Cài đặt riêng của project: ghi ngay vào state, gửi backend sau 600 ms (gõ tiền tố file không gửi từng phím);
  // đổi / tạo / xóa project thì gửi luôn phần còn chờ.
  const settingsTimer = useRef<{ id: string; settings: MuseProjectSettings; t: ReturnType<typeof setTimeout> } | null>(null)
  const flushSettings = useCallback(() => {
    const pending = settingsTimer.current
    if (!pending) return
    clearTimeout(pending.t)
    settingsTimer.current = null
    updateMuseProject(pending.id, { settings: pending.settings }).catch((e: any) =>
      setProjectNotice({ kind: 'err', text: e?.message || 'Không lưu được cài đặt của project' }),
    )
  }, [])
  useEffect(() => flushSettings, [flushSettings])
  const updateProjectSettings = useCallback(
    (patch: Partial<MuseProjectSettings>) => {
      if (!project) return
      const settings = { ...project.settings, ...patch }
      setIndex((ix) => ({ ...ix, projects: ix.projects.map((p) => (p.id === project.id ? { ...p, settings } : p)) }))
      if (settingsTimer.current) clearTimeout(settingsTimer.current.t)
      settingsTimer.current = { id: project.id, settings, t: setTimeout(flushSettings, 600) }
    },
    [flushSettings, project],
  )

  /** Cấu hình node thấy: cấu hình chung + cài đặt của project đang mở. */
  const cfg = useMemo(() => applyProjectSettings(config, project?.settings), [config, project?.settings])

  // Google Flow (Omni 1.2) cho node Clip: project gắn với 1 tài khoản Google
  const [flowProjects, setFlowProjects] = useState<FlowProject[]>([])
  const [flowAccounts, setFlowAccounts] = useState<FlowAccount[]>([])
  const [flowLoading, setFlowLoading] = useState(false)
  const [flowBusy, setFlowBusy] = useState<'' | 'create' | 'check'>('')
  const [flowCheck, setFlowCheck] = useState<FlowProjectCheck | null>(null)
  const [flowError, setFlowError] = useState('')
  const loadFlow = useCallback(async () => {
    setFlowLoading(true)
    setFlowError('')
    try {
      const [projects, accs] = await Promise.all([listFlowProjects(), fetchFlowAccounts().catch(() => [])])
      setFlowProjects(projects)
      setFlowAccounts(accs)
    } catch (e: any) {
      setFlowError(e?.message || 'Không tải được project Flow')
    } finally {
      setFlowLoading(false)
    }
  }, [])
  // Kết quả "Kiểm tra" thuộc project Flow của project Muse Canvas trước
  useEffect(() => setFlowCheck(null), [activeId])

  // Lỗi tải danh sách ≠ "chưa có tài khoản": trước đây lỗi mạng (backend đang khởi động lại) làm danh sách thành rỗng
  // và hiện nhầm "Chưa có tài khoản Muse" giữa lúc đang tạo. Giờ thử lại vài lần, lỗi hẳn thì giữ danh sách cũ + báo rõ.
  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true)
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          setAccounts(await fetchMuseAccounts())
          setAccountsError('')
          return
        } catch {
          if (attempt >= 6) {
            setAccountsError('Không tải được danh sách tài khoản Muse (backend chưa phản hồi — có thể đang khởi động lại). Bấm ⟳ để tải lại.')
            return
          }
          await new Promise((r) => setTimeout(r, 2000))
        }
      }
    } finally {
      setAccountsLoading(false)
      setAccountsLoaded(true)
    }
  }, [])

  // Nạp cấu hình bản backend (bền vững) rồi mới bật tự lưu, để không ghi đè bằng bản cục bộ cũ.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const remote = await fetchMuseCanvasConfig()
        if (alive) setConfig(remote)
      } catch (e: any) {
        if (alive) setSaveError(e?.message || 'Không tải được cấu hình Muse Canvas từ backend — đang dùng bản lưu trên máy.')
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    loadProjects()
    loadAccounts()
    loadFlow()
    return () => {
      alive = false
    }
  }, [loadAccounts, loadFlow, loadProjects])

  useDebounced(
    () => {
      setConfigSave('saving')
      saveMuseCanvasConfig(config)
        .then(() => {
          setConfigSave('saved')
          setSaveError('')
        })
        .catch((e) => {
          setConfigSave('error')
          setSaveError(e?.message || 'Lỗi lưu cấu hình')
        })
    },
    [config],
    600,
    loaded,
  )

  /** Sửa 1 ô cấu hình: ô thuộc project (Flow, tiền tố file) ghi vào project đang mở, còn lại vào cấu hình chung. */
  const update = useCallback(
    <K extends keyof MuseCanvasConfig>(key: K, value: MuseCanvasConfig[K]) => {
      if (isProjectSettingKey(key)) updateProjectSettings({ [key]: value } as Partial<MuseProjectSettings>)
      else setConfig((prev) => ({ ...prev, [key]: value }))
    },
    [updateProjectSettings],
  )

  // ---------------------------------------------------------------- thao tác project
  const names = index.projects.map((p) => p.name)

  function switchProject(id: string) {
    if (id === activeId || projectBusy) return
    flushSettings()
    const g = graphRef.current?.()
    const running = g ? countRunsFor(g.nodes.map((n) => n.id), museRuns.runningKeys(), runKeyNodeId) : 0
    setProjectNotice(
      running && project
        ? { kind: 'info', text: `“${project.name}” còn ${running} lượt Muse / ChatGPT đang chạy — kết quả được giữ, mở lại project đó sẽ thấy.` }
        : null,
    )
    setIndex((ix) => ({ ...ix, activeId: id }))
    openMuseProject(id).catch(() => {}) // chỉ để mở lại app vào đúng project; lỗi không chặn gì
  }

  async function createProject(mode: 'empty' | CopyMode) {
    if (projectBusy) return
    const base = mode === 'empty' || !project ? 'Project mới' : `${project.name} (${mode === 'template' ? 'mẫu' : 'bản sao'})`
    const name = await askText({
      title: mode === 'empty' ? 'Project mới' : mode === 'template' ? 'Làm mẫu từ project này' : 'Nhân bản project này',
      message:
        mode === 'empty'
          ? 'Canvas trống, dùng cùng project Flow với project đang mở.'
          : mode === 'template'
            ? `Giữ node, dây, prompt và ảnh vào của “${project?.name}”; bỏ mọi ảnh / kịch bản / video đã tạo.`
            : `Bản sao đầy đủ của “${project?.name}”, giữ cả kết quả đã tạo.`,
      label: 'Tên project',
      defaultValue: uniqueProjectName(base, names),
      confirmLabel: 'Tạo project',
    })
    if (!name) return
    let graph: GraphLike | undefined
    if (mode !== 'empty') {
      const cur = graphRef.current?.()
      if (!cur) return
      graph = copyGraph(cur, mode)
    }
    flushSettings()
    setProjectBusy(true)
    try {
      const meta = await createMuseProject({ name: name.trim(), graph, settings: project?.settings })
      setIndex((ix) => ({ activeId: meta.id, projects: [...ix.projects, meta] }))
      setProjectNotice(null)
    } catch (e: any) {
      setProjectNotice({ kind: 'err', text: e?.message || 'Không tạo được project' })
    } finally {
      setProjectBusy(false)
    }
  }

  async function renameProject() {
    if (!project || projectBusy) return
    const name = await askText({ title: 'Đổi tên project', label: 'Tên mới', defaultValue: project.name, confirmLabel: 'Đổi tên' })
    if (!name || name === project.name) return
    try {
      const meta = await updateMuseProject(project.id, { name: name.trim() })
      setIndex((ix) => ({ ...ix, projects: ix.projects.map((p) => (p.id === meta.id ? { ...p, name: meta.name } : p)) }))
    } catch (e: any) {
      setProjectNotice({ kind: 'err', text: e?.message || 'Không đổi được tên' })
    }
  }

  async function deleteProject() {
    if (!project || projectBusy || index.projects.length <= 1) return
    const ok = window.confirm(
      `Xóa project “${project.name}”?\n\nĐồ thị được bỏ vào thùng rác (Data/muse_canvas_projects/trash). Ảnh, kịch bản, video đã tạo vẫn còn trong Thư Viện Ảnh / Thư Viện Video.`,
    )
    if (!ok) return
    flushSettings()
    setProjectBusy(true)
    try {
      setIndex(await deleteMuseProject(project.id))
      setProjectNotice(null)
    } catch (e: any) {
      setProjectNotice({ kind: 'err', text: e?.message || 'Không xóa được project' })
    } finally {
      setProjectBusy(false)
    }
  }

  // chưa tải xong danh sách tài khoản thì chưa cảnh báo (tránh báo nhầm “Chưa có tài khoản”)
  const warnings = useMemo(() => {
    if (!accountsLoaded) return []
    if (accountsError && accounts.length === 0) return [accountsError]
    return [...(accountsError ? [accountsError] : []), ...museConfigWarnings(cfg, accounts)]
  }, [cfg, accounts, accountsLoaded, accountsError])
  // Thư Viện Ảnh ở chế độ chọn — node gọi pickLibraryImage() và chờ kết quả.
  const [picker, setPicker] = useState<{ title?: string; resolve: (it: LibraryImage | null) => void } | null>(null)
  const pickLibraryImage = useCallback(
    (title?: string) => new Promise<LibraryImage | null>((resolve) => setPicker({ title, resolve })),
    [],
  )
  const closePicker = (it: LibraryImage | null) => {
    picker?.resolve(it)
    setPicker(null)
  }
  // Thư Viện Video ở chế độ chọn — node Video tham chiếu gọi pickLibraryVideo() và chờ kết quả.
  const [videoPicker, setVideoPicker] = useState<{ title?: string; resolve: (it: ExportedVideoItem | null) => void } | null>(null)
  const pickLibraryVideo = useCallback(
    (title?: string) => new Promise<ExportedVideoItem | null>((resolve) => setVideoPicker({ title, resolve })),
    [],
  )
  const closeVideoPicker = (it: ExportedVideoItem | null) => {
    videoPicker?.resolve(it)
    setVideoPicker(null)
  }
  const flowProject = useMemo(() => flowProjects.find((p) => p.id === cfg.flowProjectId) ?? null, [flowProjects, cfg.flowProjectId])
  const ctx: MuseCanvasContextValue = useMemo(
    () => ({
      config: cfg,
      accounts,
      // chưa tải xong danh sách tài khoản thì đừng báo "Chưa có tài khoản" (chỉ chặn chạy tạm)
      blockers: !accountsLoaded
        ? ['Đang tải tài khoản Muse…']
        : accountsError && accounts.length === 0
          ? [accountsError]
          : museRunBlockers(cfg, accounts),
      pickLibraryImage,
      pickLibraryVideo,
      flowProject,
    }),
    [cfg, accounts, accountsLoaded, accountsError, pickLibraryImage, pickLibraryVideo, flowProject],
  )

  async function createFlowProjectAction() {
    const stamp = new Date().toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
    const name = await askText({
      title: 'Tạo project Google Flow',
      message: 'Project được tạo trên tài khoản Google đang đăng nhập ở tab Flow và chọn cho node Clip của project này.',
      label: 'Tên project Flow',
      defaultValue: `${project?.name ?? 'Muse Canvas'} ${stamp}`,
      maxLength: 120,
      confirmLabel: 'Tạo trên Flow',
    })
    if (!name) return
    setFlowBusy('create')
    setFlowError('')
    setFlowCheck(null)
    try {
      const p = await createFlowProject(name.trim())
      await loadFlow()
      update('flowProjectId', p.id)
      setFlowCheck({
        ok: true,
        state: 'open',
        message: `Đã tạo “${p.name}”${p.account_email ? ` trên ${p.account_email}` : ''} và chọn cho node Clip của project này.`,
        accounts: flowAccounts,
      })
    } catch (e: any) {
      setFlowError(e?.message || 'Không tạo được project Flow')
    } finally {
      setFlowBusy('')
    }
  }

  async function checkProject() {
    if (!cfg.flowProjectId) return
    setFlowBusy('check')
    setFlowError('')
    setFlowCheck(null)
    try {
      const r = await checkFlowProject(cfg.flowProjectId)
      setFlowCheck(r)
      if (r.accounts?.length) setFlowAccounts(r.accounts)
    } catch (e: any) {
      setFlowError(e?.message || 'Không kiểm tra được project')
    } finally {
      setFlowBusy('')
    }
  }
  const readyCount = accounts.filter((a) => a.status === 'active').length

  return (
    <div className="mc-workspace">
      {/* ===== Canvas của project đang mở (gắn lại từ đầu khi đổi project) ===== */}
      {activeId ? (
        <MuseCanvasContext.Provider value={ctx}>
          <ReactFlowProvider key={activeId}>
            <MuseCanvasBoard
              projectId={activeId}
              configSave={configSave}
              configError={saveError}
              graphRef={graphRef}
              overlay={
                projectNotice && (
                  <div className={`mc-project-notice${projectNotice.kind === 'err' ? ' err' : ''}`} role="status">
                    <span>{projectNotice.text}</span>
                    <button type="button" onClick={() => setProjectNotice(null)} title="Đóng">
                      ×
                    </button>
                  </div>
                )
              }
              renderBar={(s) => (
                <MuseProjectBar
                  projects={index.projects}
                  activeId={activeId}
                  nodeCount={s.nodeCount}
                  edgeCount={s.edgeCount}
                  saveState={s.saveState}
                  saveError={s.saveError}
                  busy={projectBusy}
                  onSwitch={switchProject}
                  onCreate={createProject}
                  onRename={renameProject}
                  onDelete={deleteProject}
                />
              )}
            />
          </ReactFlowProvider>
        </MuseCanvasContext.Provider>
      ) : (
        <div className="mc-canvas">
          <div className="mc-project-loading">
            {projectsLoaded ? (
              <>
                <AlertTriangle size={20} />
                <span>{projectNotice?.text || 'Chưa có project Muse Canvas nào.'}</span>
                <button type="button" className="mc-mini-btn" onClick={loadProjects}>
                  <RefreshCw size={12} /> Thử lại
                </button>
              </>
            ) : (
              <>
                <Loader2 size={20} className="animate-spin" />
                <span>Đang tải project Muse Canvas…</span>
              </>
            )}
          </div>
        </div>
      )}
      {picker && (
        <ImageLibraryModal isOpen pickMode pickTitle={picker.title} onClose={() => closePicker(null)} onPick={(it) => closePicker(it)} />
      )}
      {videoPicker && (
        <VeoVideoPickerModal
          isOpen
          title={videoPicker.title || 'Chọn video tham chiếu'}
          subtitle="Chọn 1 video từ Thư Viện Video — node chỉ giữ đường dẫn file, không chép."
          onClose={() => closeVideoPicker(null)}
          onSelectClip={(clip) => closeVideoPicker(clip)}
        />
      )}
      {promptDialog}

      {/* ===== Panel cấu hình (gọn: chỉ các mục node Muse thật sự dùng; thu nhỏ được) ===== */}
      {panelCollapsed ? (
        <aside className="mc-panel mc-panel-mini" aria-label="Cấu hình Muse Canvas (thu nhỏ)">
          <button type="button" className="mc-panel-open" onClick={() => togglePanel(false)} title="Mở panel cấu hình Muse Canvas">
            <ChevronsLeft size={14} />
            <Settings2 size={15} />
            {warnings.length > 0 && <span className="mc-panel-badge" title={warnings.join('\n')}>{warnings.length}</span>}
            <span className="mc-panel-vtext">Cấu hình</span>
          </button>
        </aside>
      ) : (
      <aside className="mc-panel mc-panel-compact" aria-label="Cấu hình Muse Canvas">
        <div className="mc-panel-head">
          <Settings2 size={15} />
          <h3>Cấu hình Muse Canvas</h3>
          <HelpHint hint="canvas.muse" />
          <button
            type="button"
            className="mc-icon-btn"
            title="Khôi phục toàn bộ cấu hình mặc định"
            onClick={() => {
              if (!window.confirm('Khôi phục cấu hình Muse Canvas về mặc định? (project Flow đang chọn của project này được giữ)')) return
              setConfig({ ...DEFAULT_MUSE_CANVAS_CONFIG })
              updateProjectSettings({ ...DEFAULT_PROJECT_SETTINGS, flowProjectId: cfg.flowProjectId })
            }}
          >
            <RotateCcw size={12} />
          </button>
          <button type="button" className="mc-icon-btn" onClick={() => togglePanel(true)} title="Thu nhỏ panel">
            <ChevronsRight size={13} />
          </button>
        </div>

        {warnings.length > 0 ? (
          <div className="mc-warn">
            {warnings.map((w) => (
              <div key={w}>
                <AlertTriangle size={13} /> <span>{w}</span>
              </div>
            ))}
          </div>
        ) : accountsLoaded ? (
          <div className="mc-ok">
            <CheckCircle2 size={13} /> Sẵn sàng cho các node.
          </div>
        ) : (
          <div className="mc-ok mc-loading">
            <Loader2 size={13} className="animate-spin" /> Đang tải tài khoản Muse…
          </div>
        )}
        {saveError && <div className="mc-error">{saveError}</div>}

        {/* Tài khoản */}
        <section className="mc-section">
          <div className="mc-section-title">
            <Users size={13} /> Tài khoản Muse
            <span className="mc-pill">{readyCount}/{accounts.length} sẵn sàng</span>
            <button type="button" className="mc-icon-btn" onClick={loadAccounts} title="Tải lại danh sách tài khoản">
              <RefreshCw size={12} className={accountsLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          <div className="mc-seg">
            <button type="button" className={cfg.accountMode === 'auto' ? 'on' : ''} onClick={() => update('accountMode', 'auto')}>
              Tự động
            </button>
            <button type="button" className={cfg.accountMode === 'fixed' ? 'on' : ''} onClick={() => update('accountMode', 'fixed')}>
              Cố định
            </button>
          </div>
          {cfg.accountMode === 'fixed' && (
            <select className="mc-input" value={cfg.accountId} onChange={(e) => update('accountId', e.target.value)}>
              <option value="">— Chọn tài khoản —</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                  {a.status === 'active' ? '' : ' — hết phiên'}
                </option>
              ))}
            </select>
          )}
          <p className="mc-hint">
            {cfg.accountMode === 'auto' ? 'Mỗi job lấy tài khoản sẵn sàng, lâu chưa dùng nhất.' : 'Mọi job dùng tài khoản đã chọn.'}{' '}
            {onOpenSettings && (
              <button type="button" className="mc-inline-link" onClick={onOpenSettings}>
                Quản lý tài khoản
              </button>
            )}
          </p>
        </section>

        {/* Google Flow (Omni 1.2) — nút "Tạo video" của node Clip */}
        <section className="mc-section">
          <div className="mc-section-title">
            <Film size={13} /> Google Flow (Omni 1.2)
            <span className="mc-pill" title="Project Flow, khung hình và chất lượng lưu riêng cho từng project Muse Canvas">riêng project</span>
            <button type="button" className="mc-icon-btn" onClick={loadFlow} title="Tải lại project / tài khoản Flow">
              <RefreshCw size={12} className={flowLoading ? 'animate-spin' : ''} />
            </button>
          </div>
          {flowAccounts[0] && (
            <p className="mc-hint">
              Tài khoản Flow vừa thấy: <b>{flowAccounts[0].email}</b>
              {flowAccounts[0].credits != null ? ` · ${flowAccounts[0].credits} credit` : ''}
            </p>
          )}
          <select
            className="mc-input"
            value={cfg.flowProjectId}
            onChange={(e) => {
              update('flowProjectId', e.target.value)
              setFlowCheck(null)
            }}
          >
            <option value="">— Chọn project Flow cho node Clip —</option>
            {flowProjects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.account_email ? ` · ${p.account_email}` : ''}
              </option>
            ))}
          </select>
          {cfg.flowProjectId && !flowProject && !flowLoading && (
            <p className="mc-hint mc-text-danger">Project đã chọn không còn trong app — chọn hoặc tạo project khác.</p>
          )}
          {flowProject?.account_email && flowAccounts[0]?.email && flowProject.account_email !== flowAccounts[0].email && (
            <div className="mc-warn">
              <div>
                <AlertTriangle size={13} />{' '}
                <span>
                  Project này thuộc {flowProject.account_email}, còn tài khoản Flow vừa thấy là {flowAccounts[0].email}. Nếu tab Flow đang ở tài
                  khoản mới, bấm “Tạo project mới” (hoặc “Kiểm tra” để chắc chắn).
                </span>
              </div>
            </div>
          )}
          <div className="mc-flow-actions">
            <button type="button" className="mc-mini-btn" onClick={createFlowProjectAction} disabled={!!flowBusy} title="Tạo project trên tài khoản Google đang đăng nhập ở tab Flow">
              {flowBusy === 'create' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Tạo project mới
            </button>
            <button
              type="button"
              className="mc-mini-btn"
              onClick={checkProject}
              disabled={!!flowBusy || !flowProject}
              title="Mở project trên tab Flow và xác nhận mở được (không tạo video, không tốn credit)"
            >
              {flowBusy === 'check' ? <Loader2 size={12} className="animate-spin" /> : <Search size={12} />} Kiểm tra
            </button>
          </div>
          {flowBusy === 'check' && <p className="mc-hint">Đang mở project trên tab Flow… có thể mất tới ~45 giây.</p>}
          {flowCheck &&
            (flowCheck.ok ? (
              <div className="mc-ok"><CheckCircle2 size={13} /> {flowCheck.message}</div>
            ) : (
              <div className="mc-warn"><div><AlertTriangle size={13} /> <span>{flowCheck.message}</span></div></div>
            ))}
          {flowError && <div className="mc-error">{flowError}</div>}
          <div className="mc-row">
            <span className="mc-label">Khung hình</span>
            <div className="mc-seg">
              {(['9:16', '16:9'] as const).map((r) => (
                <button key={r} type="button" className={cfg.flowAspect === r ? 'on' : ''} onClick={() => update('flowAspect', r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="mc-row">
            <span className="mc-label" title="360p ≈ 1/3 credit, để thử nháp">Chất lượng</span>
            <div className="mc-seg">
              {(['720p', '360p'] as const).map((r) => (
                <button key={r} type="button" className={cfg.flowResolution === r ? 'on' : ''} onClick={() => update('flowResolution', r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="mc-row">
            <span className="mc-label" title="Độ dài video Flow cho project này">Thời lượng</span>
            <select
              className="mc-input mc-seconds-select"
              value={cfg.flowSeconds}
              onChange={(e) => update('flowSeconds', Number(e.target.value))}
              aria-label="Thời lượng video Flow"
            >
              <option value={0}>Tự động</option>
              {Array.from({ length: FLOW_MAX_SECONDS - FLOW_MIN_SECONDS + 1 }, (_, i) => FLOW_MIN_SECONDS + i).map((s) => (
                <option key={s} value={s}>
                  {s} giây · ≈{flowClipCredits(s, cfg.flowResolution)} credit
                </option>
              ))}
            </select>
          </div>
          <div className="mc-row">
            <span className="mc-label" title="Số video tạo mỗi lần bấm Tạo video (node Ingredients)">Biến thể</span>
            <div className="mc-seg">
              {Array.from({ length: FLOW_MAX_VARIANTS }, (_, i) => i + 1).map((n) => (
                <button key={n} type="button" className={cfg.flowVariants === n ? 'on' : ''} onClick={() => update('flowVariants', n)}>
                  {n}
                </button>
              ))}
            </div>
          </div>
          {cfg.flowVariants > 1 && (
            <p className="mc-hint">
              Mỗi lần bấm “Tạo video” ở node Ingredients gửi MỘT lệnh Flow ra {cfg.flowVariants} video (như chọn x{cfg.flowVariants} trên Flow):
              video tham chiếu tải lên 1 lần, mỗi video có kết quả riêng. Flow tính credit từng video — tổng ghi sẵn trên nút. Node Clip vẫn tạo 1 video.
            </p>
          )}
          <p className="mc-hint">
            {cfg.flowSeconds
              ? `Mỗi clip dài đúng ${cfg.flowSeconds} giây (≈${flowClipCredits(cfg.flowSeconds, cfg.flowResolution)} credit ở ${cfg.flowResolution}): “Kịch bản tạo video” viết mọi clip ${cfg.flowSeconds} giây, “Ingredients” cắt ${cfg.flowSeconds} giây đầu video tham chiếu.`
              : 'Tự động: “Kịch bản tạo video” để ChatGPT chọn 3–15 giây theo từng bộ; “Ingredients” gửi cả video tham chiếu (tối đa 15 giây).'}{' '}
            Phần vượt 10 giây Flow tính giá gấp đôi.
          </p>
          <p className="mc-hint">
            Lưu riêng cho project Muse Canvas đang mở. Project Flow gắn với 1 tài khoản Google: đổi tài khoản trên Flow (vd. hết credit)
            thì bấm “Tạo project mới” — project cũ không mở được nữa. 360p ≈ 1/3 credit, để thử nháp.
          </p>
        </section>

        {/* Hội thoại */}
        <section className="mc-section">
          <div className="mc-section-title">
            <MessagesSquare size={13} /> Hội thoại trên Muse
          </div>
          <select className="mc-input" value={cfg.chatMode} onChange={(e) => update('chatMode', e.target.value as MuseCanvasConfig['chatMode'])}>
            {MUSE_CHAT_MODE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <p className="mc-hint">{MUSE_CHAT_MODE_OPTIONS.find((o) => o.id === cfg.chatMode)?.hint}</p>
          {cfg.chatMode === 'new_per_run' && (
            <label className="mc-field">
              <span>Tiền tố tên chat</span>
              <input className="mc-input" value={cfg.chatTitlePrefix} maxLength={60} onChange={(e) => update('chatTitlePrefix', e.target.value)} />
            </label>
          )}
        </section>

        {/* Chạy */}
        <section className="mc-section">
          <div className="mc-section-title">
            <Timer size={13} /> Chạy
          </div>
          <div className="mc-row">
            <span className="mc-label" title="Tỉ lệ video của nút “Tạo video” (node Kịch bản)">Tỉ lệ video</span>
            <div className="mc-seg">
              {(['9:16', '16:9', '1:1'] as const).map((r) => (
                <button key={r} type="button" className={cfg.aspectRatio === r ? 'on' : ''} onClick={() => update('aspectRatio', r)}>
                  {r}
                </button>
              ))}
            </div>
          </div>
          <div className="mc-grid2">
            <label className="mc-field">
              <span>Chờ mỗi job (giây)</span>
              <input
                className="mc-input"
                type="number"
                min={MUSE_MIN_TIMEOUT}
                step={60}
                value={cfg.timeoutSeconds}
                onChange={(e) => update('timeoutSeconds', Number(e.target.value))}
                onBlur={() => update('timeoutSeconds', Math.max(MUSE_MIN_TIMEOUT, cfg.timeoutSeconds || 0))}
              />
            </label>
            <label className="mc-field">
              <span>Job song song</span>
              <input
                className="mc-input"
                type="number"
                min={1}
                max={MUSE_MAX_PARALLEL}
                value={cfg.maxParallel}
                onChange={(e) => update('maxParallel', Math.min(MUSE_MAX_PARALLEL, Math.max(1, Number(e.target.value) || 1)))}
              />
            </label>
          </div>
          <label className="mc-field">
            <span title="Lưu riêng cho project Muse Canvas đang mở">Tiền tố tên file tải về (riêng project)</span>
            <input className="mc-input" maxLength={40} value={cfg.filePrefix}
              onChange={(e) => update('filePrefix', e.target.value.replace(/[^A-Za-z0-9_-]/g, '_'))} />
          </label>
          <p className="mc-hint">Đã gửi prompt thì không bao giờ tự gửi lại (mỗi lần gửi tốn một lượt Muse).</p>
        </section>
      </aside>
      )}
    </div>
  )
}

// ---------------------------------------------------------------- board: đồ thị của 1 project

interface BoardBarState {
  nodeCount: number
  edgeCount: number
  saveState: SaveState
  saveError: string
}

interface MuseCanvasBoardProps {
  projectId: string
  /** Trạng thái lưu cấu hình chung (gộp vào ô "Đã lưu") */
  configSave: SaveState
  configError: string
  /** Board ghi vào đây hàm trả đồ thị mới nhất (nhân bản / đếm lượt đang chạy) */
  graphRef: MutableRefObject<(() => GraphLike) | null>
  renderBar: (s: BoardBarState) => ReactNode
  overlay?: ReactNode
}

function MuseCanvasBoard({ projectId, configSave, configError, graphRef, renderBar, overlay }: MuseCanvasBoardProps) {
  // board gắn lại mỗi khi đổi project (key) nên chỉ cần đọc bản trên máy 1 lần
  const [localGraph] = useState(() => loadLocalProjectGraph(projectId))
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(localGraph.nodes as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(normalizeMuseEdges(localGraph.edges as Edge[]))
  const viewportRef = useRef<Viewport | null>(localGraph.viewport ?? null)
  const [viewportTick, setViewportTick] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [graphSave, setGraphSave] = useState<SaveState>('idle')
  const [graphError, setGraphError] = useState('')
  const { screenToFlowPosition, setViewport } = useReactFlow()

  // Đồ thị mới nhất cho phần ngoài (nhân bản / đổi project) và cho lần lưu lúc board bị gỡ
  const latest = useRef({ nodes, edges })
  latest.current = { nodes, edges }
  graphRef.current = () => ({
    nodes: latest.current.nodes as unknown as MuseNodeLike[],
    edges: latest.current.edges as unknown as MuseEdgeLike[],
    viewport: viewportRef.current,
  })

  // Nạp bản backend (bền vững) rồi mới bật tự lưu, để không ghi đè bằng bản cục bộ cũ.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const graph = await fetchMuseProjectGraph(projectId)
        if (!alive) return
        setNodes(graph.nodes as Node[])
        setEdges(normalizeMuseEdges(graph.edges as Edge[]))
        if (graph.viewport && !localGraph.viewport) setViewport(graph.viewport)
        viewportRef.current = graph.viewport ?? viewportRef.current
      } catch (e: any) {
        if (alive) setGraphError(e?.message || 'Không tải được canvas từ backend — đang dùng bản lưu trên máy.')
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    return () => {
      alive = false
    }
  }, [localGraph.viewport, projectId, setEdges, setNodes, setViewport])

  // Tự lưu (chờ 800 ms sau lần sửa cuối). Board bị gỡ (đổi project / đổi tab) khi còn phần chưa lưu thì lưu ngay.
  const pending = useRef(false)
  useEffect(() => {
    if (!loaded) return
    pending.current = true
    const t = setTimeout(() => {
      pending.current = false
      setGraphSave('saving')
      saveMuseProjectGraph(projectId, { nodes, edges, viewport: viewportRef.current })
        .then(() => {
          setGraphSave('saved')
          setGraphError('')
        })
        .catch((e) => {
          setGraphSave('error')
          setGraphError(e?.message || 'Lỗi lưu canvas')
        })
    }, SAVE_DEBOUNCE_MS)
    return () => clearTimeout(t)
  }, [edges, loaded, nodes, projectId, viewportTick])
  useEffect(
    () => () => {
      if (!pending.current) return
      pending.current = false
      saveMuseProjectGraph(projectId, { ...latest.current, viewport: viewportRef.current }).catch(() => {})
    },
    [projectId],
  )

  const canvasRef = useRef<HTMLDivElement>(null)
  const [adding, setAdding] = useState(false)
  const [addError, setAddError] = useState('')

  const onConnect = useCallback(
    (c: Connection) => {
      if (!c.source || !c.target) return
      // giữ đúng cổng người dùng kéo (images / extracted / image / outfits)
      setEdges((eds) =>
        addEdge(museEdge(c.source!, c.target!, c.sourceHandle ?? undefined, c.targetHandle ?? undefined), eds),
      )
    },
    [setEdges],
  )
  const isValidConnection: IsValidConnection = useCallback(
    (c) => isValidMuseConnection(c, nodes, edges),
    [nodes, edges],
  )

  /**
   * Dây thả trượt cổng / thả vào thân node / bắt nhầm cổng sai loại: tự chọn đúng cổng của node dưới con trỏ
   * (kể cả kéo ngược từ cổng vào). Không có cách nối hợp lệ thì báo lý do thay vì để dây biến mất.
   */
  const [connectHint, setConnectHint] = useState('')
  useEffect(() => {
    if (!connectHint) return
    const t = setTimeout(() => setConnectHint(''), 4000)
    return () => clearTimeout(t)
  }, [connectHint])
  const onConnectEnd: OnConnectEnd = useCallback(
    (event, state) => {
      if (state.isValid || !state.fromNode || !state.fromHandle) return
      const pt = 'changedTouches' in event ? event.changedTouches[0] : (event as MouseEvent)
      const under = pt ? document.elementFromPoint(pt.clientX, pt.clientY)?.closest('.react-flow__node') : null
      const otherId = state.toNode?.id ?? under?.getAttribute('data-id') ?? ''
      if (!otherId || otherId === state.fromNode.id) return // thả ra chỗ trống: bỏ qua như bình thường
      const fromType = state.fromHandle.type === 'target' ? 'target' : 'source'
      const conn = autoMuseConnection(state.fromNode.id, fromType, state.fromHandle.id ?? null, otherId, nodes, edges)
      if (conn) {
        setEdges((eds) => addEdge(museEdge(conn.source, conn.target, conn.sourceHandle, conn.targetHandle), eds))
        setConnectHint('')
      } else {
        setConnectHint(explainMuseConnection(state.fromNode.id, fromType, otherId, nodes, edges))
      }
    },
    [edges, nodes, setEdges],
  )

  /** Điểm giữa khung canvas (toạ độ flow) để đặt node mới, lệch nhẹ để không chồng lên nhau. */
  const centerPosition = useCallback(() => {
    const r = canvasRef.current?.getBoundingClientRect()
    const p = r ? screenToFlowPosition({ x: r.left + r.width / 2, y: r.top + r.height / 2 }) : { x: 0, y: 0 }
    const jitter = (nodes.length % 5) * 30
    return { x: p.x - 160 + jitter, y: p.y - 150 + jitter }
  }, [nodes.length, screenToFlowPosition])

  // Menu "Thêm node": đóng khi bấm ra ngoài
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as globalThis.Node)) setMenuOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [menuOpen])

  /**
   * Thêm node: 'input' (node ảnh vào), 'job' (node chạy Muse — nạp prompt mặc định từ backend),
   * 'starter' (ảnh vào nối sẵn vào node chạy cùng họ). `type` là id type node (MUSE_NODE).
   */
  const addNode = useCallback(
    async (kind: 'input' | 'job' | 'starter' | 'script' | 'clipScript' | 'clipMerge' | 'videoRef' | 'videoCut' | 'promptBox' | 'videoIngr', type: string) => {
      setAddError('')
      setMenuOpen(false)
      const pos = centerPosition()
      if (kind === 'input') {
        setNodes((ns) => [...ns, createInputNode(type, pos) as Node])
        return
      }
      if (kind === 'videoRef') {
        setNodes((ns) => [...ns, createVideoRefNode(pos) as Node])
        return
      }
      if (kind === 'videoCut') {
        setNodes((ns) => [...ns, createVideoCutNode(pos) as Node])
        return
      }
      if (kind === 'promptBox') {
        setNodes((ns) => [...ns, createPromptBoxNode(pos) as Node])
        return
      }
      setAdding(true)
      try {
        if (kind === 'script') {
          const { prompt } = await fetchMusePrompt(SCRIPT_SPEC.promptName)
          setNodes((ns) => [...ns, createScriptNode(pos, prompt) as Node])
          return
        }
        if (kind === 'clipMerge') {
          setNodes((ns) => [...ns, createClipMergeNode(pos) as Node])
          return
        }
        if (kind === 'videoIngr') {
          const { prompt } = await fetchMusePrompt(VIDEO_INGR_SPEC.promptName)
          setNodes((ns) => [...ns, createVideoIngrNode(pos, prompt) as Node])
          return
        }
        if (kind === 'clipScript') {
          const { prompt } = await fetchMusePrompt(CLIP_SCRIPT_SPEC.promptName)
          setNodes((ns) => [...ns, createClipScriptNode(pos, prompt) as Node])
          return
        }
        const spec = JOB_SPECS[type]
        const [{ prompt }, secondary] = await Promise.all([
          fetchMusePrompt(spec.promptName),
          spec.secondary?.promptName ? fetchMusePrompt(spec.secondary.promptName) : Promise.resolve(null),
        ])
        const secondaryPrompt = secondary?.prompt ?? ''
        if (kind === 'job') {
          setNodes((ns) => [...ns, createJobNode(type, pos, prompt, undefined, secondaryPrompt) as Node])
        } else {
          const pair = createStarter(type, { x: pos.x - 180, y: pos.y }, prompt, secondaryPrompt)
          setNodes((ns) => [...ns, ...(pair.nodes as Node[])])
          setEdges((es) => [...es, ...(pair.edges as Edge[])])
        }
      } catch (e: any) {
        setAddError(e?.message || 'Không tải được prompt mặc định')
      } finally {
        setAdding(false)
      }
    },
    [centerPosition, setEdges, setNodes],
  )

  const saveState: SaveState =
    configSave === 'error' || graphSave === 'error'
      ? 'error'
      : configSave === 'saving' || graphSave === 'saving'
        ? 'saving'
        : configSave === 'saved' || graphSave === 'saved'
          ? 'saved'
          : 'idle'

  return (
    <div className="mc-canvas" ref={canvasRef}>
      {renderBar({ nodeCount: nodes.length, edgeCount: edges.length, saveState, saveError: graphError || configError })}
      {overlay}

      <div className="mc-addbar" ref={menuRef}>
        <button type="button" className="primary" onClick={() => setMenuOpen((v) => !v)} disabled={adding} aria-expanded={menuOpen}>
          {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Thêm node <ChevronDown size={12} />
        </button>
        {menuOpen && (
          <div className="mc-addmenu" role="menu">
            <div className="mc-addmenu-group">Prompt</div>
            <button type="button" role="menuitem" onClick={() => addNode('promptBox', MUSE_NODE.promptBox)}>
              <NotebookPen size={13} /> Ô prompt <small title="nhập / giữ prompt (độc lập)">nhập / giữ prompt (độc lập)</small>
            </button>
            <div className="mc-addmenu-group">Trang phục</div>
            <button type="button" role="menuitem" onClick={() => addNode('input', MUSE_NODE.outfit)}>
              <Shirt size={13} /> Trang phục <small title="1 ảnh người mặc bộ đồ">1 ảnh người mặc bộ đồ</small>
            </button>
            <button type="button" role="menuitem" onClick={() => addNode('job', MUSE_NODE.extract)}>
              <Scissors size={13} /> Tách áo quần <small title="nhiều trang phục → ảnh sản phẩm">nhiều trang phục → ảnh sản phẩm</small>
            </button>
            <button type="button" role="menuitem" onClick={() => addNode('starter', MUSE_NODE.extract)}>
              <Plus size={13} /> Mẫu: Trang phục → Tách áo quần
            </button>
            <div className="mc-addmenu-group">Nhân vật</div>
            <button type="button" role="menuitem" onClick={() => addNode('input', MUSE_NODE.character)}>
              <UserRound size={13} /> Nhân vật tham chiếu <small title="1 ảnh nhân vật">1 ảnh nhân vật</small>
            </button>
            <button type="button" role="menuitem" onClick={() => addNode('job', MUSE_NODE.characterSheet)}>
              <LayoutPanelLeft size={13} /> Bảng thiết kế nhân vật <small title="character setting 16:9">character setting 16:9</small>
            </button>
            <button type="button" role="menuitem" onClick={() => addNode('starter', MUSE_NODE.characterSheet)}>
              <Plus size={13} /> Mẫu: Nhân vật → Bảng thiết kế
            </button>
            <div className="mc-addmenu-group">Bối cảnh</div>
            <button type="button" role="menuitem" onClick={() => addNode('input', MUSE_NODE.scene)}>
              <MapPin size={13} /> Tham chiếu bối cảnh <small title="1 ảnh địa điểm / phông nền">1 ảnh địa điểm / phông nền</small>
            </button>
            <button type="button" role="menuitem" onClick={() => addNode('job', MUSE_NODE.scenePlace)}>
              <UserRound size={13} /> Nhân vật trong bối cảnh <small title="nhân vật × bối cảnh → ảnh 9:16">nhân vật × bối cảnh → ảnh 9:16</small>
            </button>
            <div className="mc-addmenu-group">Video</div>
            <button type="button" role="menuitem" onClick={() => addNode('videoRef', MUSE_NODE.videoRef)}>
              <Film size={13} /> Video tham chiếu <small title="1 video mẫu">1 video mẫu</small>
            </button>
            <button type="button" role="menuitem" onClick={() => addNode('videoCut', MUSE_NODE.videoCut)}>
              <Scissors size={13} /> Cắt video <small title="cắt nhiều khúc như CapCut, xem trước rồi lưu">cắt nhiều khúc, xem trước, lưu video mới</small>
            </button>
            <button type="button" role="menuitem" onClick={() => addNode('videoIngr', MUSE_NODE.videoIngredients)}>
              <Clapperboard size={13} /> Ingredients (video + ảnh) <small title="video mẫu + 1–5 ảnh → video Flow">video mẫu + 1–5 ảnh → video Flow</small>
            </button>
            <button type="button" role="menuitem" onClick={() => addNode('script', MUSE_NODE.script)}>
              <FileText size={13} /> Kịch bản video <small title="bảng thiết kế → kịch bản + prompt">bảng thiết kế → kịch bản + prompt</small>
            </button>
            <button type="button" role="menuitem" onClick={() => addNode('clipScript', MUSE_NODE.clipScript)}>
              <Clapperboard size={13} /> Kịch bản tạo video <small title="ChatGPT · mỗi ảnh 1 clip ≤ 15 s, có mối nối">ChatGPT · mỗi ảnh 1 clip ≤ 15 s, có mối nối</small>
            </button>
            <button type="button" role="menuitem" onClick={() => addNode('clipMerge', MUSE_NODE.clipMerge)}>
              <Film size={13} /> Ghép video <small title="các clip Flow đã tạo → 1 video + nhạc">các clip Flow đã tạo → 1 video + nhạc</small>
            </button>
          </div>
        )}
      </div>
      {addError && <div className="mc-add-error">{addError}</div>}
      {connectHint && (
        <div className="mc-connect-hint" role="status">
          {connectHint}
        </div>
      )}

      <ReactFlow
        id="rf-muse-flow"
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onConnectEnd={onConnectEnd}
        connectionRadius={36}
        isValidConnection={isValidConnection}
        nodeTypes={MUSE_NODE_TYPES}
        edgeTypes={MUSE_EDGE_TYPES}
        defaultViewport={viewportRef.current ?? { x: 0, y: 0, zoom: 0.9 }}
        onMoveEnd={(_, vp) => {
          viewportRef.current = vp
          setViewportTick((t) => t + 1)
        }}
        minZoom={0.3}
        maxZoom={2}
        deleteKeyCode={['Backspace', 'Delete']}
      >
        <Background variant={BackgroundVariant.Dots} gap={20} size={1.2} color="#cbd5e1" />
        <Controls position="bottom-right" />
        <MiniMap
          position="bottom-left"
          nodeStrokeColor="#0f172a"
          nodeColor="#e2e8f0"
          maskColor="rgba(241, 245, 249, 0.8)"
          style={{ width: 140, height: 95 }}
        />
      </ReactFlow>

      {loaded && nodes.length === 0 && (
        <div className="mc-empty">
          <Sparkles size={22} />
          <strong>Project này đang trống</strong>
          <p>
            Thêm node “Trang phục” → “Tách áo quần” (ảnh sản phẩm nền trắng) hoặc “Nhân vật tham chiếu” → “Bảng thiết kế nhân
            vật” (character setting 16:9). Mỗi node chạy nhận nhiều ảnh vào; kết quả tách ra node “Ảnh kết quả” được.
            Muốn dùng lại một pipeline đã chỉnh, mở project đó rồi chọn “Làm mẫu từ project này” ở góc trên trái.
          </p>
          <button type="button" className="mc-empty-btn" onClick={() => addNode('starter', MUSE_NODE.extract)} disabled={adding}>
            {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Thêm mẫu (trang phục → tách)
          </button>
        </div>
      )}
    </div>
  )
}
