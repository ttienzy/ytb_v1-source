/**
 * Canvas AI → tab "Muse Canvas".
 * - Giai đoạn 1: canvas (lưu nodes/edges/viewport) + panel cấu hình dùng chung.
 * - Giai đoạn 2: nhiều node "Trang phục" (1 ảnh/node) --dây--> node "Tách áo quần" (chạy Muse, mỗi trang phục
 *   ra 1 ảnh sản phẩm nền trắng). Mọi node độc lập, thêm/xóa tự do.
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
import {
  AlertTriangle,
  CheckCircle2,
  Clapperboard,
  Cloud,
  FileText,
  CloudOff,
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
  MUSE_MAX_PARALLEL,
  MUSE_MIN_TIMEOUT,
  museConfigWarnings,
  museRunBlockers,
  type MuseAccountLite,
  type MuseCanvasConfig,
} from '../services/museCanvasConfig.ts'
import {
  fetchMuseAccounts,
  fetchMuseCanvasConfig,
  fetchMuseCanvasGraph,
  loadLocalMuseCanvasConfig,
  loadLocalMuseCanvasGraph,
  saveMuseCanvasConfig,
  saveMuseCanvasGraph,
} from '../services/museCanvasApi.ts'
import {
  MUSE_NODE,
  JOB_SPECS,
  createInputNode,
  createJobNode,
  createScriptNode,
  createStarter,
  isValidMuseConnection,
  SCRIPT_SPEC,
  museEdge,
  normalizeMuseEdges,
  MUSE_EDGE_TYPE,
  autoMuseConnection,
  explainMuseConnection,
} from '../services/museCanvasNodes.ts'
import { MuseLinkEdge } from '../edges/MuseLinkEdge'
import { fetchMusePrompt } from '../services/museCanvasApi.ts'
import { MuseInputNode } from '../nodes/muse/MuseInputNode'
import { MuseJobNode } from '../nodes/muse/MuseJobNode'
import { MuseOutputNode } from '../nodes/muse/MuseOutputNode'
import { MuseScriptNode } from '../nodes/muse/MuseScriptNode'
import { MuseScriptTextNode } from '../nodes/muse/MuseScriptTextNode'
import { MuseVideoOutputNode } from '../nodes/muse/MuseVideoOutputNode'
import { MuseCanvasContext, type MuseCanvasContextValue } from './museCanvasContext'
import { ImageLibraryModal } from './ImageLibraryModal'
import type { LibraryImage } from '../services/imageLibraryApi'
import { HelpHint } from '../../help/components/HelpHint'
import './museCanvas.css'

/** Loại node của Muse Canvas (khai báo ngoài component để React Flow không vẽ lại). */
const MUSE_NODE_TYPES: NodeTypes = {
  [MUSE_NODE.outfit]: MuseInputNode,
  [MUSE_NODE.extract]: MuseJobNode,
  [MUSE_NODE.character]: MuseInputNode,
  [MUSE_NODE.characterSheet]: MuseJobNode,
  [MUSE_NODE.output]: MuseOutputNode,
  [MUSE_NODE.script]: MuseScriptNode,
  [MUSE_NODE.scriptText]: MuseScriptTextNode,
  [MUSE_NODE.videoOutput]: MuseVideoOutputNode,
}
const MUSE_EDGE_TYPES: EdgeTypes = { [MUSE_EDGE_TYPE]: MuseLinkEdge }

type SaveState = 'idle' | 'saving' | 'saved' | 'error'
const PANEL_KEY = 'muse_canvas_panel_collapsed'

interface MuseCanvasWorkspaceProps {
  onOpenSettings?: () => void
}

export function MuseCanvasWorkspace(props: MuseCanvasWorkspaceProps) {
  return (
    <ReactFlowProvider>
      <MuseCanvasInner {...props} />
    </ReactFlowProvider>
  )
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
  const localGraph = useMemo(() => loadLocalMuseCanvasGraph(), [])
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>(localGraph.nodes as Node[])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(normalizeMuseEdges(localGraph.edges as Edge[]))
  const viewportRef = useRef<Viewport | null>(localGraph.viewport ?? null)
  const [viewportTick, setViewportTick] = useState(0)

  const [config, setConfig] = useState<MuseCanvasConfig>(() => loadLocalMuseCanvasConfig())
  const [accounts, setAccounts] = useState<MuseAccountLite[]>([])
  const [accountsLoading, setAccountsLoading] = useState(false)
  const [accountsLoaded, setAccountsLoaded] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const [configSave, setConfigSave] = useState<SaveState>('idle')
  const [graphSave, setGraphSave] = useState<SaveState>('idle')
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

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true)
    try {
      setAccounts(await fetchMuseAccounts())
    } catch {
      setAccounts([])
    } finally {
      setAccountsLoading(false)
      setAccountsLoaded(true)
    }
  }, [])

  // Nạp bản backend (bền vững) rồi mới bật tự lưu, để không ghi đè bằng bản cục bộ cũ.
  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [cfg, graph] = await Promise.all([fetchMuseCanvasConfig(), fetchMuseCanvasGraph()])
        if (!alive) return
        setConfig(cfg)
        setNodes(graph.nodes as Node[])
        setEdges(normalizeMuseEdges(graph.edges as Edge[]))
        viewportRef.current = graph.viewport ?? null
      } catch (e: any) {
        if (alive) setSaveError(e?.message || 'Không tải được dữ liệu Muse Canvas từ backend — đang dùng bản lưu trên máy.')
      } finally {
        if (alive) setLoaded(true)
      }
    })()
    loadAccounts()
    return () => {
      alive = false
    }
  }, [loadAccounts, setEdges, setNodes])

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

  useDebounced(
    () => {
      setGraphSave('saving')
      saveMuseCanvasGraph({ nodes, edges, viewport: viewportRef.current })
        .then(() => setGraphSave('saved'))
        .catch((e) => {
          setGraphSave('error')
          setSaveError(e?.message || 'Lỗi lưu canvas')
        })
    },
    [nodes, edges, viewportTick],
    800,
    loaded,
  )

  const { screenToFlowPosition } = useReactFlow()
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

  /**
   * Thêm node: 'input' (node ảnh vào), 'job' (node chạy Muse — nạp prompt mặc định từ backend),
   * 'starter' (ảnh vào nối sẵn vào node chạy cùng họ). `type` là id type node (MUSE_NODE).
   */
  const addNode = useCallback(
    async (kind: 'input' | 'job' | 'starter' | 'script', type: string) => {
      setAddError('')
      setMenuOpen(false)
      const pos = centerPosition()
      if (kind === 'input') {
        setNodes((ns) => [...ns, createInputNode(type, pos) as Node])
        return
      }
      setAdding(true)
      try {
        if (kind === 'script') {
          const { prompt } = await fetchMusePrompt(SCRIPT_SPEC.promptName)
          setNodes((ns) => [...ns, createScriptNode(pos, prompt) as Node])
          return
        }
        const spec = JOB_SPECS[type]
        const [{ prompt }, secondary] = await Promise.all([
          fetchMusePrompt(spec.promptName),
          spec.secondary ? fetchMusePrompt(spec.secondary.promptName) : Promise.resolve(null),
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

  const update = useCallback(<K extends keyof MuseCanvasConfig>(key: K, value: MuseCanvasConfig[K]) => {
    setConfig((prev) => ({ ...prev, [key]: value }))
  }, [])

  // chưa tải xong danh sách tài khoản thì chưa cảnh báo (tránh báo nhầm “Chưa có tài khoản”)
  const warnings = useMemo(() => (accountsLoaded ? museConfigWarnings(config, accounts) : []), [config, accounts, accountsLoaded])
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
  const ctx: MuseCanvasContextValue = useMemo(
    () => ({
      config,
      accounts,
      // chưa tải xong danh sách tài khoản thì đừng báo "Chưa có tài khoản" (chỉ chặn chạy tạm)
      blockers: accountsLoaded ? museRunBlockers(config, accounts) : ['Đang tải tài khoản Muse…'],
      pickLibraryImage,
    }),
    [config, accounts, accountsLoaded, pickLibraryImage],
  )
  const readyCount = accounts.filter((a) => a.status === 'active').length
  const saveState: SaveState =
    configSave === 'error' || graphSave === 'error'
      ? 'error'
      : configSave === 'saving' || graphSave === 'saving'
        ? 'saving'
        : configSave === 'saved' || graphSave === 'saved'
          ? 'saved'
          : 'idle'

  return (
    <div className="mc-workspace">
      {/* ===== Canvas ===== */}
      <div className="mc-canvas" ref={canvasRef}>
        <div className="mc-canvas-status">
          <Clapperboard size={13} />
          <span>Muse Canvas</span>
          <span className="mc-dot" />
          <span>{nodes.length} node · {edges.length} dây</span>
          <span className={`mc-save mc-save-${saveState}`} title={saveError || undefined}>
            {saveState === 'saving' && <Loader2 size={12} className="animate-spin" />}
            {saveState === 'saved' && <Cloud size={12} />}
            {saveState === 'error' && <CloudOff size={12} />}
            {saveState === 'saving' ? 'Đang lưu…' : saveState === 'saved' ? 'Đã lưu' : saveState === 'error' ? 'Lỗi lưu' : ''}
          </span>
        </div>

        <div className="mc-addbar" ref={menuRef}>
          <button type="button" className="primary" onClick={() => setMenuOpen((v) => !v)} disabled={adding} aria-expanded={menuOpen}>
            {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Thêm node <ChevronDown size={12} />
          </button>
          {menuOpen && (
            <div className="mc-addmenu" role="menu">
              <div className="mc-addmenu-group">Trang phục</div>
              <button type="button" role="menuitem" onClick={() => addNode('input', MUSE_NODE.outfit)}>
                <Shirt size={13} /> Trang phục <small>1 ảnh người mặc bộ đồ</small>
              </button>
              <button type="button" role="menuitem" onClick={() => addNode('job', MUSE_NODE.extract)}>
                <Scissors size={13} /> Tách áo quần <small>nhiều trang phục → ảnh sản phẩm</small>
              </button>
              <button type="button" role="menuitem" onClick={() => addNode('starter', MUSE_NODE.extract)}>
                <Plus size={13} /> Mẫu: Trang phục → Tách áo quần
              </button>
              <div className="mc-addmenu-group">Nhân vật</div>
              <button type="button" role="menuitem" onClick={() => addNode('input', MUSE_NODE.character)}>
                <UserRound size={13} /> Nhân vật tham chiếu <small>1 ảnh nhân vật</small>
              </button>
              <button type="button" role="menuitem" onClick={() => addNode('job', MUSE_NODE.characterSheet)}>
                <LayoutPanelLeft size={13} /> Bảng thiết kế nhân vật <small>character setting 16:9</small>
              </button>
              <button type="button" role="menuitem" onClick={() => addNode('starter', MUSE_NODE.characterSheet)}>
                <Plus size={13} /> Mẫu: Nhân vật → Bảng thiết kế
              </button>
              <div className="mc-addmenu-group">Video</div>
              <button type="button" role="menuitem" onClick={() => addNode('script', MUSE_NODE.script)}>
                <FileText size={13} /> Kịch bản video <small>bảng thiết kế → kịch bản + prompt</small>
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

        <MuseCanvasContext.Provider value={ctx}>
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
        </MuseCanvasContext.Provider>
        {picker && (
          <ImageLibraryModal isOpen pickMode pickTitle={picker.title} onClose={() => closePicker(null)} onPick={(it) => closePicker(it)} />
        )}

        {nodes.length === 0 && (
          <div className="mc-empty">
            <Sparkles size={22} />
            <strong>Canvas Muse đang trống</strong>
            <p>
              Thêm node “Trang phục” → “Tách áo quần” (ảnh sản phẩm nền trắng) hoặc “Nhân vật tham chiếu” → “Bảng thiết kế nhân
              vật” (character setting 16:9). Mỗi node chạy nhận nhiều ảnh vào; kết quả tách ra node “Ảnh kết quả” được.
              Cấu hình bên phải áp dụng chung cho mọi node.
            </p>
            <button type="button" className="mc-empty-btn" onClick={() => addNode('starter', MUSE_NODE.extract)} disabled={adding}>
              {adding ? <Loader2 size={13} className="animate-spin" /> : <Plus size={13} />} Thêm mẫu (trang phục → tách)
            </button>
          </div>
        )}
      </div>

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
              if (window.confirm('Khôi phục cấu hình Muse Canvas về mặc định?')) setConfig({ ...DEFAULT_MUSE_CANVAS_CONFIG })
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
            <button type="button" className={config.accountMode === 'auto' ? 'on' : ''} onClick={() => update('accountMode', 'auto')}>
              Tự động
            </button>
            <button type="button" className={config.accountMode === 'fixed' ? 'on' : ''} onClick={() => update('accountMode', 'fixed')}>
              Cố định
            </button>
          </div>
          {config.accountMode === 'fixed' && (
            <select className="mc-input" value={config.accountId} onChange={(e) => update('accountId', e.target.value)}>
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
            {config.accountMode === 'auto' ? 'Mỗi job lấy tài khoản sẵn sàng, lâu chưa dùng nhất.' : 'Mọi job dùng tài khoản đã chọn.'}{' '}
            {onOpenSettings && (
              <button type="button" className="mc-inline-link" onClick={onOpenSettings}>
                Quản lý tài khoản
              </button>
            )}
          </p>
        </section>

        {/* Hội thoại */}
        <section className="mc-section">
          <div className="mc-section-title">
            <MessagesSquare size={13} /> Hội thoại trên Muse
          </div>
          <select className="mc-input" value={config.chatMode} onChange={(e) => update('chatMode', e.target.value as MuseCanvasConfig['chatMode'])}>
            {MUSE_CHAT_MODE_OPTIONS.map((o) => (
              <option key={o.id} value={o.id}>{o.label}</option>
            ))}
          </select>
          <p className="mc-hint">{MUSE_CHAT_MODE_OPTIONS.find((o) => o.id === config.chatMode)?.hint}</p>
          {config.chatMode === 'new_per_run' && (
            <label className="mc-field">
              <span>Tiền tố tên chat</span>
              <input className="mc-input" value={config.chatTitlePrefix} maxLength={60} onChange={(e) => update('chatTitlePrefix', e.target.value)} />
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
                <button key={r} type="button" className={config.aspectRatio === r ? 'on' : ''} onClick={() => update('aspectRatio', r)}>
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
                value={config.timeoutSeconds}
                onChange={(e) => update('timeoutSeconds', Number(e.target.value))}
                onBlur={() => update('timeoutSeconds', Math.max(MUSE_MIN_TIMEOUT, config.timeoutSeconds || 0))}
              />
            </label>
            <label className="mc-field">
              <span>Job song song</span>
              <input
                className="mc-input"
                type="number"
                min={1}
                max={MUSE_MAX_PARALLEL}
                value={config.maxParallel}
                onChange={(e) => update('maxParallel', Math.min(MUSE_MAX_PARALLEL, Math.max(1, Number(e.target.value) || 1)))}
              />
            </label>
          </div>
          <label className="mc-field">
            <span>Tiền tố tên file tải về</span>
            <input className="mc-input" maxLength={40} value={config.filePrefix}
              onChange={(e) => update('filePrefix', e.target.value.replace(/[^A-Za-z0-9_-]/g, '_'))} />
          </label>
          <p className="mc-hint">Đã gửi prompt thì không bao giờ tự gửi lại (mỗi lần gửi tốn một lượt Muse).</p>
        </section>
      </aside>
      )}
    </div>
  )
}
