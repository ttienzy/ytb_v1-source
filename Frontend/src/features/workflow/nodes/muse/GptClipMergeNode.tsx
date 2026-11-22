/**
 * Node "Ghép video" của Muse Canvas — độc lập: nhận các node Clip đã có video (cổng "Clip"), xếp thứ tự, cắt đầu / cuối từng
 * clip (mặc định 0), rồi ghép CẮT CỨNG sau khi xóa watermark Flow từng clip. Nhạc nền, tiếng gốc, nhãn / logo kênh như node
 * "Video kết quả". Chạy nền ở backend (POST /api/workflow/muse/merge), kết quả vào Thư Viện Video → Hoàn chỉnh.
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Handle, Position, useNodeConnections, useNodesData, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Film,
  FolderOpen,
  Link2Off,
  Loader2,
  Scissors,
  Sparkles,
} from 'lucide-react'
import {
  CLIP_MERGE_SPEC,
  MERGE_MAX_TRIM,
  MUSE_HANDLE,
  buildMergeRequest,
  mergeBlockers,
  mergeFingerprint,
  mergeFromJob,
  mergeRowsFromSources,
  mergeState,
  mergeSummary,
  moveMergeRow,
  normalizeClipMergeData,
  type MergeClipRow,
  type MergeTrim,
  type MuseClipMergeData,
  type MuseMergeResult,
  type MuseFinishSettings,
} from '../../services/museCanvasNodes.ts'
import {
  exportVideoUrl,
  getMergeJob,
  mergeFrameUrl,
  notifyVideoLibraryChanged,
  openExportFolder,
  startMerge,
  type BgmTrackLite,
} from '../../services/museCanvasApi.ts'
import { FinishSettingsForm } from './FinishSettingsForm'
import { NodeDeleteButton } from './NodeDeleteButton'

type MergeNode = Node<Record<string, unknown>, string>

/**
 * Vòng hỏi đang chạy của từng job ghép: job -> token của vòng đang giữ quyền (giữ trên globalThis qua HMR).
 * Lần gọi poll mới (vd. node vừa hiện lại sau khi đổi tab / đổi project) giành quyền, vòng cũ — đang ghi vào canvas
 * đã gỡ — tự dừng. Nhờ vậy mỗi job chỉ có 1 vòng hỏi và luôn cập nhật node đang hiện.
 */
const G = globalThis as unknown as { __clipMergePollOwners?: Map<string, object> }
const pollers: Map<string, object> = (G.__clipMergePollOwners ??= new Map())
const POLL_MS = 2000

const STATUS_LABEL: Record<MergeClipRow['status'], string> = {
  ready: 'Có video',
  no_video: 'Chưa có video',
  running: 'Đang tạo',
  error: 'Tạo lỗi',
}

function GptClipMergeNodeImpl({ id, data: raw, selected }: NodeProps<MergeNode>) {
  const { updateNodeData, getNode } = useReactFlow()
  const data = normalizeClipMergeData(raw)
  const [showSplice, setShowSplice] = useState(false)
  const [showSettings, setShowSettings] = useState(true)
  const [tracks, setTracks] = useState<BgmTrackLite[]>([])
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())

  // Các node Clip đang nối vào cổng "Clip"
  const conns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.clipVideoIn })
  const srcIds = useMemo(() => conns.map((c) => c.source), [conns])
  const srcNodes = useNodesData(srcIds)
  const orderKey = data.order.join(',')
  const rows = useMemo(
    () => mergeRowsFromSources(srcNodes.filter(Boolean).map((n) => ({ id: n!.id, type: n!.type, data: n!.data as Record<string, unknown> })), orderKey ? orderKey.split(',') : []),
    [srcNodes, orderKey],
  )

  const merge = data.merge
  const state = mergeState(rows, data.trims, data.removeWatermark, data.finish, merge)
  const blockers = useMemo(() => mergeBlockers(rows, data.trims), [rows, data.trims])
  const running = state === 'running'
  const trackName = useCallback((tid: string) => tracks.find((t) => t.id === tid)?.name ?? 'nhạc đã chọn', [tracks])
  const setFinish = (patch: Partial<MuseFinishSettings>) => updateNodeData(id, { finish: { ...data.finish, ...patch } })
  const setTrim = (nodeId: string, patch: Partial<MergeTrim>) =>
    updateNodeData(id, { trims: { ...data.trims, [nodeId]: { ...(data.trims[nodeId] ?? { start: 0, end: 0 }), ...patch } } })

  /** Hỏi tiến độ job ghép ở backend tới khi xong / lỗi. Node không còn running với job này (đã ghép lại / bị xóa) thì dừng. */
  const poll = useCallback(
    async (jobId: string) => {
      const me = {}
      pollers.set(jobId, me)
      try {
        for (;;) {
          await new Promise((r) => setTimeout(r, POLL_MS))
          if (pollers.get(jobId) !== me) return // vòng mới đã giành quyền
          const cur = normalizeClipMergeData(getNode(id)?.data as Record<string, unknown> | undefined).merge
          if (!cur || cur.jobId !== jobId || cur.status !== 'running') break
          let job
          try {
            job = await getMergeJob(jobId)
          } catch {
            continue // backend đang khởi động lại: hỏi tiếp
          }
          if (job === null) {
            updateNodeData(id, (node) => {
              const m = normalizeClipMergeData(node.data as Record<string, unknown>).merge
              if (!m || m.jobId !== jobId) return {}
              return { merge: { ...m, status: 'interrupted', error: 'Backend không còn job ghép này (đã khởi động lại) — bấm ghép lại, bản đã xóa watermark còn trong cache nên sẽ nhanh.', updatedAt: Date.now() } }
            })
            break
          }
          updateNodeData(id, (node) => {
            const m = normalizeClipMergeData(node.data as Record<string, unknown>).merge
            if (!m || m.jobId !== jobId || m.status !== 'running') return {}
            return { merge: mergeFromJob(m, job!) }
          })
          if (job.status !== 'running') {
            if (job.status === 'done') notifyVideoLibraryChanged()
            break
          }
        }
      } finally {
        if (pollers.get(jobId) === me) pollers.delete(jobId)
      }
    },
    [getNode, id, updateNodeData],
  )

  // Mở lại canvas khi job còn đang chạy: theo dõi tiếp (job chạy ở backend)
  useEffect(() => {
    const m = normalizeClipMergeData(raw).merge
    if (m?.status === 'running' && m.jobId) poll(m.jobId)
    // chỉ khi node gắn lên màn hình
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [running])

  async function runMerge() {
    if (busy || running || blockers.length) return
    const inputPath = mergeFingerprint(rows, data.trims, data.removeWatermark, data.finish)
    const base: MuseMergeResult = { status: 'running', inputPath, step: 'Đang gửi…', startedAt: Date.now(), updatedAt: Date.now() }
    setBusy(true)
    try {
      const body = buildMergeRequest(rows, data.trims, data.removeWatermark, data.finish, data.label)
      const jobId = await startMerge(body)
      updateNodeData(id, { merge: { ...base, jobId } })
      poll(jobId)
    } catch (e: any) {
      updateNodeData(id, { merge: { ...base, status: 'error', error: e?.message || 'Không ghép được', updatedAt: Date.now() } })
    } finally {
      setBusy(false)
    }
  }

  const finalUrl = merge?.status === 'done' && merge.filename ? exportVideoUrl(merge.filename) : ''
  const elapsed = running && merge ? Math.max(0, Math.round((now - merge.startedAt) / 1000)) : 0
  const summary = mergeSummary(rows, data.trims, data.removeWatermark, data.finish, trackName)
  const pairs = rows.slice(0, -1).map((a, i) => [a, rows[i + 1]] as const).filter(([a, b]) => a.file && b.file)

  return (
    <div className={`mc-node mc-node-clipmerge ${selected ? 'selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.clipVideoIn}
        className="mc-handle mc-handle-video"
        title="Clip: nối chấm xanh bên phải của các node Clip đã có video (nhiều dây). Xếp thứ tự trong node."
      />

      <div className="mc-node-head">
        <span className="mc-node-icon mc-icon-clipscript"><Film size={14} /></span>
        <div className="mc-node-titles">
          <strong>{data.label.trim() || data.title}</strong>
          <small>{CLIP_MERGE_SPEC.subtitle}</small>
        </div>
        <span className="mc-node-count" title="Số clip đang nối vào">{rows.length} clip</span>
        <NodeDeleteButton nodeId={id} confirmText={merge?.filename ? 'Xóa node Ghép video? Video đã ghép vẫn còn trong Thư Viện Video.' : undefined} />
      </div>

      <div className="mc-node-body">
        <input
          className="mc-node-input nodrag"
          value={data.label}
          maxLength={80}
          placeholder="Tên video (tùy chọn) — dùng làm tên trong Thư Viện Video"
          onChange={(e) => updateNodeData(id, { label: e.target.value })}
        />

        {/* Clip, theo thứ tự ghép */}
        {rows.length === 0 ? (
          <div className="mc-inputs-empty">
            <Link2Off size={12} /> Chưa có clip — nối chấm xanh bên phải của các node Clip vào chấm bên trái node này (hoặc bấm “Ghép video” ở node Kịch bản tạo video).
          </div>
        ) : (
          <div className="mc-merge-list">
            {rows.map((r, i) => {
              const t = data.trims[r.nodeId] ?? { start: 0, end: 0 }
              return (
                <div key={r.nodeId} className={`mc-merge-row mc-merge-${r.status}`}>
                  <span className="mc-script-no">#{i + 1}</span>
                  {r.file ? (
                    <img className="mc-merge-thumb" src={mergeFrameUrl(r.file, 'first', 120)} alt={`Clip ${r.k}`} draggable={false} loading="lazy" />
                  ) : (
                    <span className="mc-xph mc-merge-thumb" />
                  )}
                  <span className="mc-merge-info">
                    <b title={r.name}>Clip {r.k}{r.name ? ` · ${r.name}` : ''}</b>
                    <small>
                      {r.seconds != null ? `${r.seconds}s · ` : ''}
                      <span className={`mc-merge-chip mc-merge-chip-${r.status}`}>{STATUS_LABEL[r.status]}</span>
                    </small>
                  </span>
                  <span className="mc-merge-trims nodrag" title="Cắt bỏ N giây ở đầu / cuối clip khi ghép (mặc định 0)">
                    <Scissors size={11} />
                    <input type="number" min={0} max={MERGE_MAX_TRIM} step={0.1} value={t.start} aria-label={`Cắt đầu clip ${r.k} (giây)`} onChange={(e) => setTrim(r.nodeId, { start: Number(e.target.value) || 0 })} />
                    <span>đầu</span>
                    <input type="number" min={0} max={MERGE_MAX_TRIM} step={0.1} value={t.end} aria-label={`Cắt cuối clip ${r.k} (giây)`} onChange={(e) => setTrim(r.nodeId, { end: Number(e.target.value) || 0 })} />
                    <span>cuối</span>
                  </span>
                  <span className="mc-script-move">
                    <button type="button" className="mc-mini-btn nodrag" disabled={i === 0 || running} onClick={() => updateNodeData(id, { order: moveMergeRow(rows, r.nodeId, -1) })} title="Đưa lên trước">
                      <ArrowUp size={11} />
                    </button>
                    <button type="button" className="mc-mini-btn nodrag" disabled={i === rows.length - 1 || running} onClick={() => updateNodeData(id, { order: moveMergeRow(rows, r.nodeId, 1) })} title="Đưa xuống sau">
                      <ArrowDown size={11} />
                    </button>
                  </span>
                </div>
              )
            })}
          </div>
        )}

        {/* Xem điểm nối: khung cuối clip k cạnh khung đầu clip k+1 */}
        {pairs.length > 0 && (
          <>
            <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowSplice((v) => !v)}>
              {showSplice ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Xem điểm nối
              <small className="mc-xtoggle-hint">khung cuối clip trước ↔ khung đầu clip sau (chưa tính phần cắt)</small>
            </button>
            {showSplice && (
              <div className="mc-splice-list">
                {pairs.map(([a, b]) => (
                  <div key={`${a.nodeId}-${b.nodeId}`} className="mc-splice">
                    <span className="mc-node-meta">Clip {a.k} → Clip {b.k}</span>
                    <div className="mc-splice-frames">
                      <img src={mergeFrameUrl(a.file!, 'last', 200)} alt={`Khung cuối clip ${a.k}`} draggable={false} loading="lazy" />
                      <span aria-hidden>→</span>
                      <img src={mergeFrameUrl(b.file!, 'first', 200)} alt={`Khung đầu clip ${b.k}`} draggable={false} loading="lazy" />
                    </div>
                  </div>
                ))}
                <p className="mc-hint">Hai khung nên cùng một cảnh trống (hoặc đều bị che) để chỗ nối không lộ trang phục. Lệch thì cắt thêm đầu / cuối clip.</p>
              </div>
            )}
          </>
        )}

        {/* Cấu hình */}
        <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowSettings((v) => !v)}>
          {showSettings ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Watermark · nhạc · nhãn kênh
          <small className="mc-xtoggle-hint">tiếng gốc</small>
        </button>
        {showSettings && (
          <>
            <label className="mc-check nodrag">
              <input type="checkbox" checked={data.removeWatermark} onChange={(e) => updateNodeData(id, { removeWatermark: e.target.checked })} />
              Xóa watermark Flow từng clip trước khi ghép (lần đầu vài phút / clip, ghép lại dùng cache)
            </label>
            <FinishSettingsForm settings={data.finish} onChange={setFinish} onTracksLoaded={setTracks} />
          </>
        )}

        {blockers.map((b) => (
          <div key={b} className="mc-clip-warn"><AlertTriangle size={11} /> {b}</div>
        ))}
        <div className="mc-node-meta" title={summary}>{summary}</div>

        <button
          type="button"
          className="mc-run-btn mc-run-clipscript nodrag"
          disabled={busy || running || blockers.length > 0}
          onClick={runMerge}
          title="Ghép bằng ffmpeg trên máy (không tốn credit); kết quả vào Thư Viện Video → Hoàn chỉnh"
        >
          {running || busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
          {running ? `Đang ghép… ${elapsed}s` : state === 'done' || state === 'stale' ? 'Ghép lại' : `Ghép ${rows.length || ''} clip`.replace('  ', ' ')}
        </button>

        {running && merge && (
          <div className="mc-node-meta">
            <Loader2 size={12} className="animate-spin" /> {merge.step || 'Đang chạy…'}
          </div>
        )}
        {(state === 'error' || state === 'interrupted') && merge?.error && <div className="mc-node-error">{merge.error}</div>}

        {/* Kết quả */}
        {finalUrl && (
          <div className={`mc-script-result mc-x-${state}`}>
            <div className="mc-script-status">
              {state === 'stale' ? (
                <><AlertTriangle size={12} /> Clip / cắt / cấu hình đã đổi — bản dưới là bản cũ, bấm “Ghép lại”</>
              ) : (
                <><Check size={12} /> Đã lưu vào Thư Viện Video (Hoàn chỉnh){merge?.durationSec ? ` · ${Math.round(merge.durationSec)}s` : ''}</>
              )}
              {merge?.filename && (
                <span className="mc-script-tools">
                  <button type="button" className="mc-mini-btn nodrag" onClick={() => openExportFolder(merge.filename!)} title="Mở thư mục video hoàn chỉnh">
                    <FolderOpen size={11} />
                  </button>
                </span>
              )}
            </div>
            <video key={finalUrl} className={`mc-video mc-video-out nodrag ${state === 'stale' ? 'dim' : ''}`} src={finalUrl} controls preload="metadata" />
          </div>
        )}
        <p className="mc-hint">
          Không tốn credit Flow / Muse. Ghép cắt cứng (không làm mờ chuyển cảnh, vì điểm nối nằm ở khung không thấy trang phục). Xóa watermark chỉ
          chạy được trên clip gốc từ Flow nên làm từng clip trước khi ghép.
        </p>
      </div>
    </div>
  )
}

export const GptClipMergeNode = memo(GptClipMergeNodeImpl)
