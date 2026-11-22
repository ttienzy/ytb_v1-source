/**
 * Node "Cắt video" của Muse Canvas — cắt NHIỀU khúc như CapCut: nối 1 video vào cổng "Video", tách tại đầu phát, xóa /
 * khôi phục từng đoạn, kéo mép đoạn, phóng to timeline, xem trước kết quả (phát bỏ qua đoạn đã xóa) rồi "Cắt & lưu" thành
 * 1 video mới ở cổng ra (nối tiếp vào Ingredients hoặc node Cắt video khác). Xem trước chạy hoàn toàn ở frontend (không
 * mã hóa gì); chỉ "Cắt & lưu" gọi backend (ffmpeg, vài giây, không tốn credit). Mô hình thao tác: services/museVideoCut.ts.
 *
 * Phím tắt (khi bấm vào khung chỉnh sửa): Space phát / dừng · S tách tại đầu phát · Delete / X xóa-khôi phục đoạn đang chọn ·
 * ← → lùi / tiến 1 khung (Shift: 1 giây) · Home / End · Ctrl+Z hoàn tác · Ctrl+Shift+Z / Ctrl+Y làm lại.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Handle, Position, useNodeConnections, useNodesData, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import {
  AlertTriangle,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  Loader2,
  Pause,
  Play,
  Redo2,
  RotateCcw,
  Scissors,
  StepBack,
  StepForward,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from 'lucide-react'
import { MUSE_HANDLE, normalizeVideoRefData, type MuseVideoRef } from '../../services/museCanvasNodes.ts'
import {
  CUT_FRAME,
  CUT_MIN_PIECE,
  CUT_MIN_RESULT,
  cutFirstKeptStart,
  cutFlowHint,
  cutFormatTime,
  cutHasEdits,
  cutInitPieces,
  cutKeepOnly,
  cutKeptCount,
  cutKeptDuration,
  cutKeptSegments,
  cutMergeNext,
  cutMoveBoundary,
  cutNormalizePieces,
  cutPieceAt,
  cutRemovedDuration,
  cutResultKey,
  cutRestoreAll,
  cutRulerTicks,
  cutSkipTarget,
  cutSourceToResult,
  cutSplit,
  cutStripWidth,
  cutToggleRemoved,
  normalizeVideoCutData,
  type CutPiece,
} from '../../services/museVideoCut.ts'
import { cutMuseVideo, museMediaUrl, museVideoStripUrl } from '../../services/museCanvasApi.ts'
import { runKey } from '../../services/museRunRegistry.ts'
import { NodeDeleteButton } from './NodeDeleteButton'
import { useMuseRuns } from './useMuseRuns'

type CutNode = Node<Record<string, unknown>, string>

/** Kết quả "Cắt & lưu" (chờ ở frontend qua museRuns): video mới + dấu vân tay lúc cắt, hoặc lỗi. */
type CutOutcome = { video: MuseVideoRef; key: string } | { error: string }

const STRIP_H = 56
const MIN_ZOOM = 1
const MAX_ZOOM = 8
const HISTORY_MAX = 60
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

function MuseVideoCutNodeImpl({ id, data: raw, selected }: NodeProps<CutNode>) {
  const { updateNodeData } = useReactFlow()
  const data = normalizeVideoCutData(raw)

  // ---------------------------------------------------------------- nguồn: node nối vào cổng "Video"
  const conns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.refVideoIn })
  const srcNode = useNodesData(conns[0]?.source ? [conns[0].source] : [])[0]
  const source: MuseVideoRef | null = srcNode ? normalizeVideoRefData(srcNode.data as Record<string, unknown>).video : null
  const sourceName = source?.name ?? ''

  const dur = data.duration
  const pieces = data.pieces
  const ready = !!source && dur > 0 && pieces.length > 0 && data.sourcePath === source.path

  // ---------------------------------------------------------------- trạng thái giao diện
  const videoEl = useRef<HTMLVideoElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const trackRef = useRef<HTMLDivElement>(null)
  const [time, setTime] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [skip, setSkip] = useState(true) // xem trước kết quả: bỏ qua đoạn đã xóa
  const [muted, setMuted] = useState(true)
  const [sel, setSel] = useState(0)
  const [zoom, setZoom] = useState(1)
  const [baseWidth, setBaseWidth] = useState(480)
  const [stripOk, setStripOk] = useState(true)
  const [histTick, setHistTick] = useState(0)

  // bản mới nhất của đoạn / cờ cho vòng phát và thao tác kéo (tránh dữ liệu cũ trong closure)
  const piecesRef = useRef(pieces)
  piecesRef.current = pieces
  const skipRef = useRef(skip)
  skipRef.current = skip
  const history = useRef<{ past: CutPiece[][]; future: CutPiece[][] }>({ past: [], future: [] })

  const selIdx = clamp(sel, 0, Math.max(0, pieces.length - 1))
  const selPiece = pieces[selIdx]
  const kept = cutKeptDuration(pieces)
  const removed = cutRemovedDuration(pieces)
  const keptSegs = cutKeptSegments(pieces)
  const edited = cutHasEdits(pieces)
  const canCut = ready && kept >= CUT_MIN_RESULT && data.status !== 'cutting'
  const key = source ? cutResultKey(source.path, pieces) : ''
  const resultFresh = !!data.video && data.resultKey === key
  const flowHint = ready ? cutFlowHint(kept) : ''

  // ---------------------------------------------------------------- lưu đoạn + lịch sử hoàn tác
  const writePieces = useCallback((next: CutPiece[]) => updateNodeData(id, { pieces: next }), [id, updateNodeData])

  /** Thao tác rời rạc (tách / xóa / khôi phục…): ghi vào lịch sử rồi lưu. */
  const commit = useCallback(
    (next: CutPiece[]) => {
      if (next === piecesRef.current) return
      history.current.past = [...history.current.past, piecesRef.current].slice(-HISTORY_MAX)
      history.current.future = []
      piecesRef.current = next
      writePieces(next)
      setHistTick((n) => n + 1)
    },
    [writePieces],
  )
  const undo = useCallback(() => {
    const prev = history.current.past[history.current.past.length - 1]
    if (!prev) return
    history.current.past = history.current.past.slice(0, -1)
    history.current.future = [...history.current.future, piecesRef.current]
    piecesRef.current = prev
    writePieces(prev)
    setHistTick((n) => n + 1)
  }, [writePieces])
  const redo = useCallback(() => {
    const next = history.current.future[history.current.future.length - 1]
    if (!next) return
    history.current.future = history.current.future.slice(0, -1)
    history.current.past = [...history.current.past, piecesRef.current]
    piecesRef.current = next
    writePieces(next)
    setHistTick((n) => n + 1)
  }, [writePieces])
  const canUndo = history.current.past.length > 0
  const canRedo = history.current.future.length > 0
  void histTick

  // ---------------------------------------------------------------- video nguồn: đọc độ dài, dựng đoạn ban đầu
  function onMeta(e: React.SyntheticEvent<HTMLVideoElement>) {
    const d = e.currentTarget.duration
    if (!source || !Number.isFinite(d) || d <= 0) return
    const rd = Math.round(d * 100) / 100
    if (data.sourcePath !== source.path || !pieces.length) {
      // nguồn mới (hoặc lần đầu): bắt đầu lại, không mang vết cắt của video khác sang
      history.current = { past: [], future: [] }
      updateNodeData(id, { sourcePath: source.path, duration: rd, pieces: cutInitPieces(rd) })
      setSel(0)
    } else if (Math.abs(rd - data.duration) > 0.05) {
      updateNodeData(id, { duration: rd, pieces: cutNormalizePieces(pieces, rd) })
    }
    setStripOk(true)
  }

  // ---------------------------------------------------------------- phát / tua
  const seek = useCallback(
    (t: number) => {
      const v = videoEl.current
      const to = clamp(t, 0, dur || 0)
      if (v) v.currentTime = to
      setTime(to)
      return to
    },
    [dur],
  )

  function togglePlay() {
    const v = videoEl.current
    if (!v || !ready) return
    if (v.paused) {
      let t = v.currentTime
      if (skipRef.current) {
        const target = cutSkipTarget(piecesRef.current, t)
        t = target ?? cutFirstKeptStart(piecesRef.current) // đang ở cuối phần giữ: phát lại từ đầu
        if (target !== null && t >= dur - 0.05) t = cutFirstKeptStart(piecesRef.current)
      } else if (t >= dur - 0.05) t = 0
      v.currentTime = t
      void v.play()
    } else {
      v.pause()
    }
  }

  // vòng phát: nhảy qua đoạn đã xóa (khi bật "Xem kết quả") và cập nhật đầu phát mượt
  useEffect(() => {
    if (!playing) return
    let raf = 0
    const tick = () => {
      const v = videoEl.current
      if (!v) return
      let t = v.currentTime
      if (skipRef.current) {
        const target = cutSkipTarget(piecesRef.current, t)
        if (target === null) {
          v.pause() // hết phần giữ lại
          setTime(t)
          return
        }
        if (target !== t) {
          v.currentTime = target
          t = target
        }
      }
      setTime(t)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing])

  // timeline phóng to: giữ đầu phát trong vùng nhìn thấy
  useEffect(() => {
    const sc = scrollRef.current
    if (!sc || zoom <= 1 || !dur) return
    const x = (time / dur) * sc.scrollWidth
    if (x < sc.scrollLeft + 24 || x > sc.scrollLeft + sc.clientWidth - 24) sc.scrollLeft = Math.max(0, x - sc.clientWidth * 0.35)
  }, [time, zoom, dur])

  useEffect(() => {
    const sc = scrollRef.current
    if (!sc || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setBaseWidth(sc.clientWidth || 480))
    ro.observe(sc)
    setBaseWidth(sc.clientWidth || 480)
    return () => ro.disconnect()
  }, [source?.path])

  // ---------------------------------------------------------------- thao tác chỉnh sửa
  const splitHere = () => {
    if (!ready) return
    const next = cutSplit(piecesRef.current, time)
    if (next === piecesRef.current) return
    commit(next)
    setSel(cutPieceAt(next, time + CUT_MIN_PIECE / 2)) // chọn đoạn bên phải vết tách (đoạn đầu phát đang đứng)
  }
  const toggleSel = () => ready && commit(cutToggleRemoved(piecesRef.current, selIdx))
  const keepOnlySel = () => ready && commit(cutKeepOnly(piecesRef.current, selIdx))
  const restoreAll = () => ready && commit(cutRestoreAll(piecesRef.current))
  const resetAll = () => ready && commit(cutInitPieces(dur))

  /** Đầu phát (giây) từ vị trí chuột trên timeline. */
  const timeAt = (clientX: number) => {
    const r = trackRef.current?.getBoundingClientRect()
    if (!r || !r.width) return 0
    return clamp(((clientX - r.left) / r.width) * dur, 0, dur)
  }

  // kéo đầu phát / bấm chọn đoạn
  const scrubbing = useRef(false)
  function onTrackDown(e: React.PointerEvent) {
    if (!ready || e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    scrubbing.current = true
    const t = timeAt(e.clientX)
    seek(t)
    setSel(cutPieceAt(piecesRef.current, t))
  }
  function onTrackMove(e: React.PointerEvent) {
    if (scrubbing.current) seek(timeAt(e.clientX))
  }
  function onTrackUp(e: React.PointerEvent) {
    scrubbing.current = false
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
  }

  // kéo mép giữa hai đoạn
  const dragEdge = useRef<{ i: number; start: CutPiece[] } | null>(null)
  function onEdgeDown(e: React.PointerEvent, i: number) {
    e.stopPropagation()
    if (e.button !== 0) return
    e.currentTarget.setPointerCapture(e.pointerId)
    dragEdge.current = { i, start: piecesRef.current }
  }
  function onEdgeMove(e: React.PointerEvent) {
    const d = dragEdge.current
    if (!d) return
    const t = timeAt(e.clientX)
    const next = cutMoveBoundary(piecesRef.current, d.i, t)
    if (next !== piecesRef.current) {
      piecesRef.current = next
      writePieces(next)
    }
    seek(piecesRef.current[d.i]?.end ?? t) // hiện đúng khung tại mép đang kéo
  }
  function onEdgeUp(e: React.PointerEvent) {
    const d = dragEdge.current
    dragEdge.current = null
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId)
    if (d && d.start !== piecesRef.current) {
      history.current.past = [...history.current.past, d.start].slice(-HISTORY_MAX)
      history.current.future = []
      setHistTick((n) => n + 1)
    }
  }

  // Ctrl + cuộn = phóng to / thu nhỏ; cuộn thường = trượt ngang khi đã phóng to
  function onWheel(e: React.WheelEvent) {
    const sc = scrollRef.current
    if (!sc) return
    if (e.ctrlKey || e.metaKey) setZoom((z) => clamp(Math.round((z * (e.deltaY < 0 ? 1.25 : 0.8)) * 100) / 100, MIN_ZOOM, MAX_ZOOM))
    else if (zoom > 1) sc.scrollLeft += e.deltaY + e.deltaX
  }

  // phím tắt (chỉ khi khung chỉnh sửa đang có tiêu điểm; chặn lan lên React Flow để Delete không xóa cả node)
  function onKeyDown(e: React.KeyboardEvent) {
    const tag = (e.target as HTMLElement).tagName
    if (!ready || tag === 'INPUT' || tag === 'TEXTAREA') return
    const mod = e.ctrlKey || e.metaKey
    const k = e.key.toLowerCase()
    let handled = true
    if (k === ' ') togglePlay()
    else if (mod && k === 'z') (e.shiftKey ? redo : undo)()
    else if (mod && k === 'y') redo()
    else if (!mod && k === 's') splitHere()
    else if (!mod && (k === 'delete' || k === 'backspace' || k === 'x')) toggleSel()
    else if (k === 'arrowleft') seek(time - (e.shiftKey ? 1 : CUT_FRAME))
    else if (k === 'arrowright') seek(time + (e.shiftKey ? 1 : CUT_FRAME))
    else if (k === 'home') seek(0)
    else if (k === 'end') seek(dur)
    else handled = false
    if (handled) {
      e.preventDefault()
      e.stopPropagation()
    }
  }

  // ---------------------------------------------------------------- cắt & lưu (backend, ffmpeg)
  const apply = useCallback(
    (_k: string, out: CutOutcome) => {
      if ('error' in out) updateNodeData(id, { status: 'error', error: out.error })
      else updateNodeData(id, { video: out.video, resultKey: out.key, status: 'idle', error: '' })
    },
    [id, updateNodeData],
  )
  const runs = useMuseRuns<CutOutcome>(apply)
  const flight = runKey.videoCut(id)

  // node gắn lên giữa lúc đang cắt: nhận kết quả (hoặc báo gián đoạn nếu lượt không còn)
  useEffect(() => {
    if (normalizeVideoCutData(raw).status === 'cutting' && !runs.resume(flight)) {
      updateNodeData(id, { status: 'error', error: 'Bị gián đoạn khi đang cắt (đóng app / tải lại trang) — bấm “Cắt & lưu” lại (không tốn credit).' })
    }
    // chỉ khi node gắn lên màn hình
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function doCut() {
    if (!canCut || !source || runs.isRunning(flight)) return
    const segs = keptSegs
    const k = key
    const name = data.label.trim() ? `${data.label.trim()}.mp4` : ''
    updateNodeData(id, { status: 'cutting', error: '' })
    const job: Promise<CutOutcome> = cutMuseVideo(source.path, segs)
      .then((r): CutOutcome => ({
        key: k,
        video: {
          id: `cut-${r.file_path.split(/[\\/]/).pop()?.replace(/\.mp4$/i, '') ?? Date.now().toString(36)}`,
          name: name || r.file_name,
          path: r.file_path,
          previewUrl: r.preview_url,
          size: r.file_size,
          durationSec: r.duration,
          source: 'upload',
        },
      }))
      .catch((e: any): CutOutcome => ({ error: e?.message || 'Không cắt được video' }))
    void runs.start(flight, job)
  }

  const cutting = data.status === 'cutting'
  const ticks = useMemo(() => cutRulerTicks(dur, baseWidth * zoom), [dur, baseWidth, zoom])
  const pct = (t: number) => `${dur > 0 ? clamp((t / dur) * 100, 0, 100) : 0}%`
  const stripUrl = source && ready && stripOk ? museVideoStripUrl(source.path, cutStripWidth(zoom), STRIP_H) : ''
  const resultTime = cutSourceToResult(pieces, time)
  const tools: { key: string; label: string; title: string; on: () => void; disabled?: boolean; icon: React.ReactNode; danger?: boolean }[] = [
    { key: 'split', label: 'Tách', title: 'Tách đoạn tại đầu phát (S)', on: splitHere, icon: <Scissors size={13} />, disabled: !ready },
    {
      key: 'del',
      label: selPiece?.removed ? 'Khôi phục' : 'Xóa đoạn',
      title: selPiece?.removed ? 'Khôi phục đoạn đang chọn (Delete)' : 'Xóa đoạn đang chọn — không đưa vào video kết quả (Delete)',
      on: toggleSel,
      icon: selPiece?.removed ? <RotateCcw size={13} /> : <Trash2 size={13} />,
      disabled: !ready || (!selPiece?.removed && cutKeptCount(pieces) <= 1),
      danger: !selPiece?.removed,
    },
    { key: 'only', label: 'Chỉ giữ', title: 'Chỉ giữ đoạn đang chọn — xóa mọi đoạn khác', on: keepOnlySel, icon: <Check size={13} />, disabled: !ready || pieces.length < 2 },
  ]

  return (
    <div className={`mc-node mc-node-vcut ${resultFresh ? 'complete' : ''} ${selected ? 'selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.refVideoIn}
        className="mc-handle mc-handle-videoref"
        style={{ top: 82 }}
        title="Video: nối từ node “Video tham chiếu” hoặc một node “Cắt video” khác"
      />
      <span className="mc-port-label" style={{ top: 72 }}>Video</span>

      <div className="mc-node-head">
        <span className="mc-node-icon mc-icon-videoref"><Scissors size={14} /></span>
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small>cắt nhiều khúc · xem trước · lưu video mới</small>
        </div>
        {resultFresh && (
          <span className="mc-vcut-done" title="Đã cắt & lưu, chưa chỉnh gì sau đó — node phía sau (Ingredients, Ghép video) dùng video này">
            <Check size={11} /> Hoàn chỉnh
          </span>
        )}
        <NodeDeleteButton nodeId={id} confirmText={data.video ? `Xóa node “${data.label.trim() || data.title}”? Video đã cắt vẫn còn trên máy.` : undefined} />
      </div>

      <div className="mc-node-body">
        <input
          className="mc-node-input nodrag"
          value={data.label}
          maxLength={60}
          placeholder="Tên video sau khi cắt (tùy chọn)"
          onChange={(e) => updateNodeData(id, { label: e.target.value })}
        />

        {!source ? (
          <div className="mc-vcut-empty">
            <Scissors size={18} />
            <span>Nối node “Video tham chiếu” (hoặc “Cắt video” khác) vào cổng Video bên trái</span>
            <small>Rồi tách, xóa các khúc không cần và lưu thành video mới</small>
          </div>
        ) : (
          <div
            ref={rootRef}
            className="mc-vcut-editor nodrag"
            tabIndex={0}
            onKeyDown={onKeyDown}
            onPointerDownCapture={(e) => {
              const t = e.target as HTMLElement
              if (t.tagName !== 'INPUT' && t.tagName !== 'BUTTON') rootRef.current?.focus({ preventScroll: true })
            }}
          >
            {/* ---- màn hình xem trước ---- */}
            <div className="mc-vcut-stage">
              <video
                key={source.path}
                ref={videoEl}
                src={museMediaUrl(source.previewUrl)}
                muted={muted}
                playsInline
                preload="auto"
                className="nowheel"
                onLoadedMetadata={onMeta}
                onPlay={() => setPlaying(true)}
                onPause={() => {
                  setPlaying(false)
                  if (videoEl.current) setTime(videoEl.current.currentTime)
                }}
                onEnded={() => setPlaying(false)}
                onSeeked={() => videoEl.current && setTime(videoEl.current.currentTime)}
                onClick={togglePlay}
              />
              {selPiece?.removed && ready && time >= selPiece.start && time < selPiece.end && (
                <div className="mc-vcut-cutmark" title="Đầu phát đang ở đoạn đã xóa">Đoạn đã xóa</div>
              )}
              {!ready && <div className="mc-vcut-cutmark loading"><Loader2 size={13} className="animate-spin" /> Đang đọc video…</div>}
            </div>

            {/* ---- thanh điều khiển ---- */}
            <div className="mc-vcut-controls">
              <button type="button" className="mc-vcut-play" onClick={togglePlay} disabled={!ready} title="Phát / dừng (Space)">
                {playing ? <Pause size={15} /> : <Play size={15} />}
              </button>
              <button type="button" className="mc-icon-btn" onClick={() => seek(time - CUT_FRAME)} disabled={!ready} title="Lùi 1 khung (←)"><StepBack size={13} /></button>
              <button type="button" className="mc-icon-btn" onClick={() => seek(time + CUT_FRAME)} disabled={!ready} title="Tiến 1 khung (→)"><StepForward size={13} /></button>
              <span className="mc-vcut-time" title="Đầu phát / độ dài video gốc">
                <strong>{cutFormatTime(time)}</strong> / {cutFormatTime(dur)}
              </span>
              {edited && skip && (
                <span className="mc-vcut-time result" title="Vị trí trong video KẾT QUẢ (đã bỏ các đoạn xóa)">
                  kết quả {cutFormatTime(resultTime)} / {cutFormatTime(kept)}
                </span>
              )}
              <span className="mc-vcut-spacer" />
              <button
                type="button"
                className={`mc-vcut-toggle ${skip ? 'on' : ''}`}
                onClick={() => setSkip((v) => !v)}
                title={skip ? 'Đang xem trước KẾT QUẢ: phát bỏ qua đoạn đã xóa. Bấm để xem video gốc.' : 'Đang xem video gốc. Bấm để xem trước kết quả (bỏ qua đoạn đã xóa).'}
              >
                {skip ? <Eye size={13} /> : <EyeOff size={13} />} Xem kết quả
              </button>
              <button type="button" className="mc-icon-btn" onClick={() => setMuted((m) => !m)} title={muted ? 'Bật tiếng' : 'Tắt tiếng'}>
                {muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
              </button>
            </div>

            {/* ---- công cụ ---- */}
            <div className="mc-vcut-tools">
              {tools.map((t) => (
                <button key={t.key} type="button" className={`mc-vcut-tool ${t.danger ? 'danger' : ''}`} onClick={t.on} disabled={t.disabled} title={t.title}>
                  {t.icon} {t.label}
                </button>
              ))}
              <span className="mc-vcut-sep" />
              <button type="button" className="mc-icon-btn" onClick={undo} disabled={!canUndo} title="Hoàn tác (Ctrl+Z)"><Undo2 size={13} /></button>
              <button type="button" className="mc-icon-btn" onClick={redo} disabled={!canRedo} title="Làm lại (Ctrl+Shift+Z)"><Redo2 size={13} /></button>
              <button type="button" className="mc-icon-btn" onClick={restoreAll} disabled={!ready || !pieces.some((p) => p.removed)} title="Khôi phục mọi đoạn đã xóa"><RotateCcw size={13} /></button>
              <span className="mc-vcut-spacer" />
              <button type="button" className="mc-icon-btn" onClick={() => setZoom((z) => clamp(z / 1.5, MIN_ZOOM, MAX_ZOOM))} disabled={zoom <= MIN_ZOOM} title="Thu nhỏ timeline"><ZoomOut size={13} /></button>
              <input
                type="range"
                className="mc-vcut-zoom nodrag"
                min={MIN_ZOOM}
                max={MAX_ZOOM}
                step={0.25}
                value={zoom}
                onChange={(e) => setZoom(Number(e.target.value))}
                title={`Phóng to timeline ×${zoom.toFixed(1)} (Ctrl + cuộn)`}
              />
              <button type="button" className="mc-icon-btn" onClick={() => setZoom((z) => clamp(z * 1.5, MIN_ZOOM, MAX_ZOOM))} disabled={zoom >= MAX_ZOOM} title="Phóng to timeline"><ZoomIn size={13} /></button>
            </div>

            {/* ---- timeline ---- */}
            <div ref={scrollRef} className="mc-vcut-scroll nowheel" onWheel={onWheel}>
              <div
                ref={trackRef}
                className={`mc-vcut-timeline ${ready ? '' : 'disabled'}`}
                style={{ width: `${zoom * 100}%` }}
                onPointerDown={onTrackDown}
                onPointerMove={onTrackMove}
                onPointerUp={onTrackUp}
                onPointerCancel={onTrackUp}
              >
                <div className="mc-vcut-ruler">
                  {ticks.map((t) => (
                    <span key={t.time} className="mc-vcut-tick" style={{ left: pct(t.time) }}>
                      <i />
                      <em>{cutFormatTime(t.time).replace(/\.0$/, '')}</em>
                    </span>
                  ))}
                </div>
                <div className="mc-vcut-track" style={{ height: STRIP_H }}>
                  {stripUrl && <img className="mc-vcut-strip" src={stripUrl} alt="" draggable={false} onError={() => setStripOk(false)} />}
                  {ready &&
                    pieces.map((p, i) => (
                      <div
                        key={`${p.start}-${i}`}
                        className={`mc-vcut-piece ${p.removed ? 'removed' : ''} ${i === selIdx ? 'sel' : ''}`}
                        style={{ left: pct(p.start), width: `${((p.end - p.start) / dur) * 100}%` }}
                        title={`Đoạn ${i + 1}: ${cutFormatTime(p.start)} – ${cutFormatTime(p.end)} (${(p.end - p.start).toFixed(1)}s)${p.removed ? ' · đã xóa' : ''}`}
                      >
                        <span>{p.removed ? `Đã xóa · ${(p.end - p.start).toFixed(1)}s` : `${(p.end - p.start).toFixed(1)}s`}</span>
                      </div>
                    ))}
                  {ready &&
                    pieces.slice(0, -1).map((p, i) => (
                      <div
                        key={`edge-${p.end}-${i}`}
                        className="mc-vcut-edge"
                        style={{ left: pct(p.end) }}
                        onPointerDown={(e) => onEdgeDown(e, i)}
                        onPointerMove={onEdgeMove}
                        onPointerUp={onEdgeUp}
                        onPointerCancel={onEdgeUp}
                        onDoubleClick={(e) => {
                          e.stopPropagation()
                          commit(cutMergeNext(piecesRef.current, i))
                        }}
                        title="Kéo để chỉnh mép · bấm đúp để bỏ vết tách"
                      />
                    ))}
                </div>
                {ready && (
                  <div className="mc-vcut-playhead" style={{ left: pct(time) }}>
                    <b />
                  </div>
                )}
              </div>
            </div>
            <div className="mc-vcut-help">
              Bấm timeline để đặt đầu phát · <b>S</b> tách · <b>Delete</b> xóa đoạn đang chọn · kéo mép để chỉnh · bấm đúp mép để bỏ vết tách · Ctrl + cuộn để phóng to
            </div>

            {/* ---- tóm tắt ---- */}
            <div className={`mc-vcut-summary ${flowHint ? 'warn' : ''}`}>
              <strong>{cutFormatTime(kept)}</strong>
              <span>
                giữ {keptSegs.length} đoạn{removed > 0 ? ` · bỏ ${removed.toFixed(1)}s` : ''} · gốc {cutFormatTime(dur)}
              </span>
              {flowHint && <small title="Chỉ nhắc khi dùng cho node Ingredients (Flow)">{flowHint}</small>}
            </div>
          </div>
        )}

        {/* ---- kết quả ---- */}
        {source && (
          <div className="mc-vcut-result">
            <button type="button" className="mc-run-btn mc-clipvideo-run mc-vcut-save nodrag" onClick={doCut} disabled={!canCut} title="Ghép các đoạn giữ lại thành 1 video mới (không tốn credit)">
              {cutting ? <Loader2 size={13} className="animate-spin" /> : <Scissors size={13} />}
              {cutting ? 'Đang cắt…' : data.video ? (resultFresh ? 'Cắt lại' : 'Cắt & lưu bản mới') : 'Cắt & lưu video'}
            </button>
            {data.status === 'error' && data.error && <div className="mc-node-error">{data.error}</div>}
            {data.video && (
              <div className={`mc-vcut-out ${resultFresh ? '' : 'stale'}`}>
                <div className="mc-vcut-out-head">
                  <strong>Video đã cắt</strong>
                  <span className={`mc-vingr-var-chip ${resultFresh ? 'chip-done' : 'chip-stale'}`}>{resultFresh ? 'Mới nhất' : 'Bản cũ'}</span>
                  <small>{data.video.durationSec > 0 ? `${data.video.durationSec.toFixed(1)}s` : ''}</small>
                  <a className="mc-mini-btn nodrag" href={museMediaUrl(data.video.previewUrl)} target="_blank" rel="noreferrer" title="Mở video đã cắt trong tab mới">
                    <ExternalLink size={11} /> Mở
                  </a>
                </div>
                <video key={data.video.path} src={museMediaUrl(data.video.previewUrl)} controls muted playsInline preload="metadata" className="nodrag nowheel" />
                {!resultFresh && (
                  <div className="mc-clip-warn">
                    <AlertTriangle size={11} /> Đã chỉnh sau lần cắt này — node phía sau vẫn đang dùng bản cũ. Bấm “Cắt & lưu bản mới” để cập nhật.
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.refVideoOut}
        className="mc-handle mc-handle-videoref"
        title={resultFresh
          ? 'Video hoàn chỉnh: nối vào cổng “Clip” của node Ghép video, cổng “Video” của node Ingredients hoặc một node Cắt video khác'
          : 'Chưa có video hoàn chỉnh — bấm “Cắt & lưu video”. Nối được trước vào Ghép video / Ingredients / Cắt video khác'}
      />
    </div>
  )
}

export const MuseVideoCutNode = memo(MuseVideoCutNodeImpl)
