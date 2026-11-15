/**
 * Node "Video kết quả": video của 1 lần "Tạo video" ở node Kịch bản (nút "Ra node").
 * - Giữ video riêng (không đổi khi node nguồn tạo lại); nguồn có video mới hơn thì báo + "Dùng video mới".
 * - "Hoàn thiện video": tắt tiếng gốc / chỉnh âm lượng, nhạc nền từ Thư viện nhạc, nhãn kênh (chữ + logo)
 *   → POST /api/workflow/muse/finish (ffmpeg, không tốn lượt Muse) → video hoàn chỉnh trong Thư Viện Video.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, useNodeConnections, useNodesData, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Film,
  FolderOpen,
  ImagePlus,
  Loader2,
  Music,
  RefreshCw,
  Save,
  Sparkles,
  Tag,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react'
import {
  DEFAULT_FINISH_SETTINGS,
  MUSE_CORNERS,
  MUSE_HANDLE,
  MUSE_NODE,
  buildFinishRequest,
  finishFingerprint,
  finishState,
  finishSummary,
  interruptFinal,
  mainVideoPath,
  museVideoStreamPath,
  newerVideoFor,
  normalizeFinishSettings,
  normalizeScriptTextData,
  normalizeVideoOutputData,
  type MuseFinalResult,
  type MuseFinishSettings,
} from '../../services/museCanvasNodes.ts'
import {
  channelLogoUrl,
  exportVideoUrl,
  fetchBgmTracks,
  finishMuseVideo,
  museMediaUrl,
  notifyVideoLibraryChanged,
  openExportFolder,
  openMuseVideoFolder,
  uploadChannelLogo,
  type BgmTrackLite,
} from '../../services/museCanvasApi.ts'
import { NodeDeleteButton } from './NodeDeleteButton'
import { BgmPicker } from './BgmPicker'

type VideoNode = Node<Record<string, unknown>, string>

const basename = (p: string) => p.split(/[\\/]/).pop() || p
const pct = (v: number) => `${Math.round(v * 100)}%`

/** Cấu hình hoàn thiện mặc định do người dùng "Lưu làm mặc định" (trên máy này). */
const DEFAULTS_KEY = 'muse_finish_defaults_v1'
function loadDefaults(): MuseFinishSettings {
  try {
    const raw = window.localStorage.getItem(DEFAULTS_KEY)
    return raw ? normalizeFinishSettings(JSON.parse(raw)) : { ...DEFAULT_FINISH_SETTINGS }
  } catch {
    return { ...DEFAULT_FINISH_SETTINGS }
  }
}
function saveDefaults(s: MuseFinishSettings): boolean {
  try {
    window.localStorage.setItem(DEFAULTS_KEY, JSON.stringify(s))
    return true
  } catch {
    return false
  }
}

/** Lượt xuất đang chạy (giữ qua đổi tab / HMR). */
const G = globalThis as unknown as { __museFinishInflight?: Map<string, Promise<MuseFinalResult>> }
const inflight: Map<string, Promise<MuseFinalResult>> = (G.__museFinishInflight ??= new Map())

function MuseVideoOutputNodeImpl({ id, data: raw, selected }: NodeProps<VideoNode>) {
  const { updateNodeData } = useReactFlow()
  const data = normalizeVideoOutputData(raw)
  const [copied, setCopied] = useState(false)
  const [current, setCurrent] = useState<string>('')
  const [showFinish, setShowFinish] = useState(true)
  const [tracks, setTracks] = useState<BgmTrackLite[] | null>(null)
  const [tracksError, setTracksError] = useState('')
  const [logoBusy, setLogoBusy] = useState(false)
  const [note, setNote] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [now, setNow] = useState(Date.now())
  const [viewFinal, setViewFinal] = useState(true)
  const logoInput = useRef<HTMLInputElement>(null)

  // Node Kịch bản nguồn — để biết có video mới hơn không.
  const conns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.videoIn })
  const parentId = conns[0]?.source ?? ''
  const parent = useNodesData(parentId)
  const newer = useMemo(
    () =>
      parent && parent.type === MUSE_NODE.scriptText
        ? newerVideoFor(data, normalizeScriptTextData(parent.data as Record<string, unknown>))
        : null,
    [data, parent],
  )
  const main = mainVideoPath(data.paths)
  const playing = current && data.paths.includes(current) ? current : main
  const when = data.origin ? new Date(data.origin.updatedAt).toLocaleString('vi-VN') : ''

  // Cấu hình hoàn thiện: node mới lấy mặc định đã lưu trên máy
  useEffect(() => {
    if (!normalizeVideoOutputData(raw).finish) updateNodeData(id, { finish: loadDefaults() })
    const f = normalizeVideoOutputData(raw).final
    if (f?.status === 'running') {
      const p = inflight.get(id)
      if (p) p.then((r) => updateNodeData(id, { final: r }))
      else {
        const fixed = interruptFinal(f)
        if (fixed) updateNodeData(id, { final: fixed })
      }
    }
    // chỉ chạy khi node gắn lên màn hình
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const settings = data.finish ?? DEFAULT_FINISH_SETTINGS
  const setSettings = (patch: Partial<MuseFinishSettings>) => updateNodeData(id, { finish: { ...settings, ...patch } })

  // Thư viện nhạc
  const loadTracks = useCallback(() => {
    setTracksError('')
    fetchBgmTracks()
      .then(setTracks)
      .catch((e) => {
        setTracks([])
        setTracksError(e?.message || 'Không tải được Thư viện nhạc')
      })
  }, [])
  useEffect(() => {
    if (showFinish && tracks === null) loadTracks()
  }, [loadTracks, showFinish, tracks])
  const trackName = (tid: string) => tracks?.find((t) => t.id === tid)?.name ?? 'nhạc đã chọn'
  const bgmId = settings.bgmTrackIds[0] ?? ''

  const final = data.final
  const fState = finishState(data.paths, settings, final)
  const fRunning = fState === 'running'
  useEffect(() => {
    if (!fRunning) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [fRunning])

  const runFinish = useCallback(async () => {
    if (inflight.has(id)) return
    setNote(null)
    const inputPath = finishFingerprint(data.paths, settings)
    let body: Record<string, unknown>
    try {
      body = buildFinishRequest(data.paths, settings, data.label)
    } catch (e: any) {
      updateNodeData(id, { final: { inputPath, status: 'error', error: e?.message, updatedAt: Date.now() } })
      return
    }
    updateNodeData(id, { final: { inputPath, status: 'running', updatedAt: Date.now() } })
    const job: Promise<MuseFinalResult> = finishMuseVideo(body)
      .then((r) => ({
        inputPath,
        status: 'done' as const,
        filename: r.filename,
        path: r.path,
        title: r.title,
        durationSec: r.durationSec,
        updatedAt: Date.now(),
      }))
      .catch((e: any) => ({ inputPath, status: 'error' as const, error: e?.message || 'Lỗi xuất video', updatedAt: Date.now() }))
      .finally(() => inflight.delete(id))
    inflight.set(id, job)
    const r = await job
    updateNodeData(id, { final: r })
    if (r.status === 'done') {
      setViewFinal(true)
      notifyVideoLibraryChanged()
    }
  }, [data.label, data.paths, id, settings, updateNodeData])

  async function onLogoPicked(file: File | undefined) {
    if (!file) return
    setLogoBusy(true)
    setNote(null)
    try {
      setSettings({ logoId: await uploadChannelLogo(file) })
    } catch (e: any) {
      setNote({ kind: 'err', text: e?.message || 'Không tải được logo' })
    } finally {
      setLogoBusy(false)
      if (logoInput.current) logoInput.current.value = ''
    }
  }

  const finalUrl = final?.status === 'done' && final.filename ? exportVideoUrl(final.filename) : ''
  const showingFinal = !!finalUrl && viewFinal
  const elapsed = fRunning ? Math.max(0, Math.round((now - (final?.updatedAt || now)) / 1000)) : 0

  return (
    <div className={`mc-node mc-node-video ${selected ? 'selected' : ''}`}>
      <Handle type="target" position={Position.Left} id={MUSE_HANDLE.videoIn} className="mc-handle mc-handle-video" title="Từ node Kịch bản (Tạo video)" />

      <div className="mc-node-head">
        <span className="mc-node-icon mc-icon-video"><Film size={14} /></span>
        <div className="mc-node-titles">
          <strong>{data.label.trim() || data.title}</strong>
          <small title={when}>{parentId ? `Từ Kịch bản · ${when}` : `Kịch bản · ${when} (đã gỡ dây nguồn)`}</small>
        </div>
        {data.paths.length > 1 && <span className="mc-node-count" title="Số clip">{data.paths.length} clip</span>}
        <NodeDeleteButton nodeId={id} />
      </div>

      <div className="mc-node-body">
        <input
          className="mc-node-input nodrag"
          value={data.label}
          maxLength={80}
          placeholder="Tên video (tùy chọn) — dùng làm tên trong Thư Viện Video"
          onChange={(e) => updateNodeData(id, { label: e.target.value })}
        />

        {finalUrl && (
          <div className="mc-seg mc-video-tabs nodrag">
            <button type="button" className={!showingFinal ? 'on' : ''} onClick={() => setViewFinal(false)}>Video Muse</button>
            <button type="button" className={showingFinal ? 'on' : ''} onClick={() => setViewFinal(true)}>Bản hoàn chỉnh</button>
          </div>
        )}
        {showingFinal ? (
          <video key={finalUrl} className={`mc-video mc-video-out nodrag ${fState === 'stale' ? 'dim' : ''}`} src={finalUrl} controls preload="metadata" />
        ) : playing ? (
          <video key={playing} className="mc-video mc-video-out nodrag" src={museMediaUrl(museVideoStreamPath(playing))} controls preload="metadata" />
        ) : (
          <div className="mc-inputs-empty">Node chưa có video.</div>
        )}

        {!showingFinal && data.paths.length > 1 && (
          <div className="mc-clip-list">
            {data.paths.map((p, i) => (
              <button
                key={p}
                type="button"
                className={`mc-mini-btn nodrag ${p === playing ? 'mc-mini-accent' : ''}`}
                onClick={() => setCurrent(p)}
                title={p}
              >
                {i === data.paths.length - 1 ? 'Bản chính' : `Clip ${i + 1}`}
              </button>
            ))}
          </div>
        )}

        {newer && (
          <div className="mc-output-newer">
            <span>Node Kịch bản vừa tạo video mới hơn.</span>
            <button
              type="button"
              className="mc-mini-btn mc-mini-accent nodrag"
              onClick={() => {
                setCurrent('')
                updateNodeData(id, { paths: [...(newer.paths ?? [])], origin: { scriptTextNodeId: parentId, updatedAt: newer.updatedAt } })
              }}
            >
              <RefreshCw size={11} /> Dùng video mới
            </button>
          </div>
        )}

        {!showingFinal && playing && (
          <div className="mc-node-actions">
            <span className="mc-node-meta" title={playing}>{basename(playing)}</span>
            <button
              type="button"
              className="mc-mini-btn nodrag"
              onClick={() => {
                navigator.clipboard?.writeText(playing)
                setCopied(true)
                setTimeout(() => setCopied(false), 1500)
              }}
              title="Chép đường dẫn file"
            >
              {copied ? <Check size={11} /> : <Copy size={11} />}
            </button>
            <a className="mc-mini-btn nodrag" href={museMediaUrl(museVideoStreamPath(playing))} target="_blank" rel="noreferrer" title="Mở video trong tab mới">
              <ExternalLink size={11} />
            </a>
            <button type="button" className="mc-mini-btn nodrag" onClick={() => openMuseVideoFolder()} title="Mở thư mục video Muse">
              <FolderOpen size={11} />
            </button>
          </div>
        )}

        {/* ===== Hoàn thiện video ===== */}
        <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowFinish((v) => !v)}>
          {showFinish ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Hoàn thiện video
          <small className="mc-xtoggle-hint">nhạc · nhãn kênh · tiếng gốc</small>
        </button>
        {showFinish && (
          <div className="mc-finish nodrag">
            {/* Âm thanh gốc */}
            <div className="mc-finish-row">
              <span className="mc-finish-label">{settings.muteOriginal ? <VolumeX size={12} /> : <Volume2 size={12} />} Tiếng gốc</span>
              <label className="mc-check">
                <input type="checkbox" checked={settings.muteOriginal} onChange={(e) => setSettings({ muteOriginal: e.target.checked })} />
                Tắt tiếng gốc
              </label>
            </div>
            {!settings.muteOriginal && (
              <div className="mc-finish-row">
                <span className="mc-finish-sub">Âm lượng gốc</span>
                <input
                  type="range"
                  className="mc-range nodrag"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={settings.originalVolume}
                  onChange={(e) => setSettings({ originalVolume: Number(e.target.value) })}
                />
                <span className="mc-finish-val">{pct(settings.originalVolume)}</span>
              </div>
            )}

            {/* Nhạc nền: chọn từ Thư viện nhạc, nghe thử từng bài */}
            <div className="mc-finish-row mc-finish-top">
              <span className="mc-finish-label"><Music size={12} /> Nhạc nền</span>
              <BgmPicker
                tracks={tracks}
                error={tracksError}
                selectedId={bgmId}
                onSelect={(tid) => setSettings({ bgmTrackIds: tid ? [tid] : [] })}
                onReload={loadTracks}
              />
            </div>
            {bgmId && (
              <div className="mc-finish-row">
                <span className="mc-finish-sub">Âm lượng nhạc</span>
                <input
                  type="range"
                  className="mc-range nodrag"
                  min={0}
                  max={1.5}
                  step={0.05}
                  value={settings.bgmVolume}
                  onChange={(e) => setSettings({ bgmVolume: Number(e.target.value) })}
                />
                <span className="mc-finish-val">{pct(settings.bgmVolume)}</span>
              </div>
            )}

            {/* Nhãn kênh */}
            <div className="mc-finish-row">
              <span className="mc-finish-label"><Tag size={12} /> Nhãn kênh</span>
              <input
                className="mc-input mc-finish-text"
                value={settings.labelText}
                maxLength={60}
                placeholder="vd. @tenkenh"
                onChange={(e) => setSettings({ labelText: e.target.value })}
              />
            </div>
            {settings.labelText.trim() && (
              <div className="mc-finish-row">
                <span className="mc-finish-sub">Vị trí / cỡ</span>
                <select className="mc-input mc-finish-select" value={settings.labelPosition} onChange={(e) => setSettings({ labelPosition: e.target.value as MuseFinishSettings['labelPosition'] })}>
                  {MUSE_CORNERS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
                <div className="mc-seg mc-seg-sm">
                  {(['s', 'm', 'l'] as const).map((z) => (
                    <button key={z} type="button" className={settings.labelSize === z ? 'on' : ''} onClick={() => setSettings({ labelSize: z })}>
                      {z === 's' ? 'Nhỏ' : z === 'm' ? 'Vừa' : 'Lớn'}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Logo kênh */}
            <div className="mc-finish-row">
              <span className="mc-finish-label"><ImagePlus size={12} /> Logo kênh</span>
              {settings.logoId ? (
                <span className="mc-logo-chip">
                  <img src={channelLogoUrl(settings.logoId)} alt="Logo kênh" draggable={false} />
                  <button type="button" className="mc-mini-btn" onClick={() => setSettings({ logoId: '' })} title="Bỏ logo">
                    <X size={11} />
                  </button>
                </span>
              ) : (
                <button type="button" className="mc-mini-btn" onClick={() => logoInput.current?.click()} disabled={logoBusy}>
                  {logoBusy ? <Loader2 size={11} className="animate-spin" /> : <ImagePlus size={11} />} Tải logo (PNG/JPG/WebP ≤ 5 MB)
                </button>
              )}
              <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={(e) => onLogoPicked(e.target.files?.[0])} />
            </div>
            {settings.logoId && (
              <div className="mc-finish-row">
                <span className="mc-finish-sub">Vị trí / cỡ</span>
                <select className="mc-input mc-finish-select" value={settings.logoPosition} onChange={(e) => setSettings({ logoPosition: e.target.value as MuseFinishSettings['logoPosition'] })}>
                  {MUSE_CORNERS.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
                <input
                  type="range"
                  className="mc-range nodrag"
                  min={0.05}
                  max={0.5}
                  step={0.01}
                  value={settings.logoSize}
                  onChange={(e) => setSettings({ logoSize: Number(e.target.value) })}
                />
                <span className="mc-finish-val">{pct(settings.logoSize)}</span>
              </div>
            )}

            {data.paths.length > 1 && (
              <label className="mc-check">
                <input type="checkbox" checked={settings.joinClips} onChange={(e) => setSettings({ joinClips: e.target.checked })} />
                Ghép cả {data.paths.length} clip (bỏ chọn = chỉ dùng bản chính)
              </label>
            )}

            <div className="mc-node-actions">
              <span className="mc-node-meta" title={finishSummary(settings, trackName)}>{finishSummary(settings, trackName)}</span>
              <button
                type="button"
                className="mc-mini-btn"
                onClick={() => setNote(saveDefaults(settings) ? { kind: 'ok', text: 'Đã lưu làm mặc định cho các node Video kết quả mới.' } : { kind: 'err', text: 'Không lưu được trên máy này.' })}
                title="Dùng cấu hình này cho các node Video kết quả mới (lưu trên máy)"
              >
                <Save size={11} /> Lưu làm mặc định
              </button>
            </div>
            {note && <div className={note.kind === 'ok' ? 'mc-node-ok' : 'mc-node-error'}>{note.text}</div>}

            <button
              type="button"
              className="mc-run-btn mc-run-finish"
              disabled={fRunning || !data.paths.length}
              onClick={runFinish}
              title="Ghép bằng ffmpeg trên máy (không tốn lượt Muse); kết quả vào Thư Viện Video → Hoàn chỉnh"
            >
              {fRunning ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
              {fRunning ? `Đang xuất… ${elapsed}s` : fState === 'done' ? 'Xuất lại video hoàn chỉnh' : 'Xuất video hoàn chỉnh'}
            </button>

            {final && !fRunning && (
              <div className={`mc-script-status mc-x-${fState}`}>
                {fState === 'done' && (
                  <><Check size={12} /> Đã lưu vào Thư Viện Video (Hoàn chỉnh){final.durationSec ? ` · ${Math.round(final.durationSec)}s` : ''}</>
                )}
                {fState === 'stale' && <><AlertTriangle size={12} /> Cấu hình đã đổi — bấm xuất lại để có bản mới</>}
                {(fState === 'error' || fState === 'interrupted') && <><AlertTriangle size={12} /> {final.error || 'Lỗi xuất video'}</>}
                {final.filename && (fState === 'done' || fState === 'stale') && (
                  <span className="mc-script-tools">
                    <button type="button" className="mc-mini-btn" onClick={() => openExportFolder(final.filename!)} title="Mở thư mục video hoàn chỉnh">
                      <FolderOpen size={11} />
                    </button>
                  </span>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export const MuseVideoOutputNode = memo(MuseVideoOutputNodeImpl)
