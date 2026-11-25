/**
 * Node "Tách khung hình" của Muse Canvas: nhận 1 video từ Video tham chiếu, Cắt video hoặc Clip (Flow),
 * tách khung đầu / khung cuối / mốc giây bất kỳ thành 1 ảnh PNG độ phân giải gốc qua ffmpeg (0 credit).
 * Cổng ra "image" nối sang Tạo video Flow (Khung đầu–cuối / Thành phần), Tạo ảnh tự do hoặc Kịch bản.
 */
import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { Position, useNodeConnections, useNodesData, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import { Camera, ExternalLink, Link2Off, Loader2, LocateFixed } from 'lucide-react'
import { MuseMediaIcon, MuseMediaPort } from './MuseMediaPort'
import { NodeDeleteButton } from './NodeDeleteButton'
import { useMuseRuns } from './useMuseRuns'
import { runKey } from '../../services/museRunRegistry.ts'
import { cutCompleteVideo } from '../../services/museVideoCutKey.ts'
import {
  MUSE_HANDLE,
  MUSE_NODE,
  MUSE_PORT_FIRST_TOP,
  frameExtractKey,
  normalizeClipPromptData,
  normalizeFrameExtractData,
  normalizeVideoRefData,
  type MuseFrameExtractMode,
  type MuseImageRef,
} from '../../services/museCanvasNodes.ts'
import { extractMuseFrame, museMediaUrl, veoVideoUrl } from '../../services/museCanvasApi.ts'

type FrameNode = Node<Record<string, unknown>, string>

interface SourceVideo {
  path: string
  previewUrl: string
  name: string
  durationSec: number
}

type FrameOutcome =
  | { image: MuseImageRef; resultKey: string; duration: number; timeSec: number }
  | { error: string }

function resolveSourceVideo(node: { type?: string; data?: Record<string, unknown> } | null | undefined): SourceVideo | null {
  if (!node?.type) return null
  if (node.type === MUSE_NODE.videoRef) {
    const { label, video } = normalizeVideoRefData(node.data)
    if (!video?.path) return null
    return { path: video.path, previewUrl: video.previewUrl, name: label.trim() || video.name, durationSec: video.durationSec }
  }
  if (node.type === MUSE_NODE.videoCut) {
    const cut = cutCompleteVideo(node.data)
    if (!cut?.path) return null
    const label = typeof node.data?.label === 'string' && node.data.label.trim() ? node.data.label.trim() : ''
    return {
      path: cut.path,
      previewUrl: cut.previewUrl,
      name: label || cut.path.split(/[\\/]/).pop() || 'Video đã cắt',
      durationSec: cut.durationSec,
    }
  }
  if (node.type === MUSE_NODE.clipPrompt) {
    const clip = normalizeClipPromptData(node.data)
    const file = clip.video?.status === 'done' && clip.video.files?.length ? clip.video.files[clip.video.files.length - 1] : ''
    if (!file) return null
    return { path: file, previewUrl: veoVideoUrl(file), name: `Clip ${clip.k}: ${clip.name}`.trim(), durationSec: clip.seconds ?? 0 }
  }
  return null
}

function MuseFrameExtractNodeImpl({ id, data: raw, selected }: NodeProps<FrameNode>) {
  const { updateNodeData } = useReactFlow()
  const data = normalizeFrameExtractData(raw)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [note, setNote] = useState('')

  const conns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.refVideoIn })
  const srcNode = useNodesData(conns[0]?.source ? [conns[0].source] : [])[0]
  const srcVideo = resolveSourceVideo(srcNode ? { type: srcNode.type, data: srcNode.data as Record<string, unknown> } : null)
  const key = srcVideo ? frameExtractKey(srcVideo.path, data.mode, data.timeSec) : ''
  const isStale = !!data.image && (!srcVideo || data.resultKey !== key)

  const applyOutcome = useCallback(
    (res: FrameOutcome) => {
      if ('error' in res) {
        updateNodeData(id, { status: 'error', error: res.error })
        return
      }
      updateNodeData(id, {
        status: 'idle',
        error: '',
        image: res.image,
        resultKey: res.resultKey,
        sourceDuration: res.duration,
      })
    },
    [id, updateNodeData],
  )
  const runs = useMuseRuns<FrameOutcome>((_k, res) => applyOutcome(res))
  const flight = runKey.frameExtract(id)
  const running = data.status === 'extracting' || runs.isRunning(flight)

  useEffect(() => {
    if (data.status === 'extracting' && !runs.resume(flight)) {
      updateNodeData(id, { status: 'idle' })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function extract() {
    if (!srcVideo || running) return
    setNote('')
    const reqKey = frameExtractKey(srcVideo.path, data.mode, data.timeSec)
    updateNodeData(id, { status: 'extracting', error: '' })
    const job: Promise<FrameOutcome> = extractMuseFrame(srcVideo.path, data.mode, data.timeSec)
      .then((res) => ({
        image: {
          id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
          name: res.file_name,
          path: res.file_path,
          previewUrl: res.preview_url,
          size: res.file_size,
        },
        resultKey: reqKey,
        duration: res.duration,
        timeSec: res.time_sec,
      }))
      .catch((e: any) => ({ error: e?.message || 'Không tách được khung hình' }))
    void runs.start(flight, job)
  }

  function grabCurrentTime() {
    const el = videoRef.current
    if (!el || !Number.isFinite(el.currentTime)) return
    const sec = Math.max(0, Math.round(el.currentTime * 100) / 100)
    updateNodeData(id, { mode: 'time', timeSec: sec })
    setNote(`Đã lấy mốc ${sec}s từ trình phát`)
  }

  const maxDur = srcVideo?.durationSec || data.sourceDuration || 0

  return (
    <div className={`mc-node mc-node-frame ${selected ? 'selected' : ''}`}>
      <MuseMediaPort
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.refVideoIn}
        kind="Video"
        label="Video nguồn"
        style={{ top: MUSE_PORT_FIRST_TOP }}
        title="Nối từ Video tham chiếu, Cắt video hoặc node Clip"
      />
      <MuseMediaPort
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.imageOut}
        kind="Image"
        label="Khung hình"
        title="Nối sang Tạo video Flow (Khung đầu–cuối / Thành phần), Tạo ảnh tự do hoặc Kịch bản"
      />

      <div className="mc-node-head">
        <MuseMediaIcon kind="Image" />
        <div className="mc-node-titles">
          <strong>{data.title}</strong>
          <small>Tách 1 khung PNG từ video · 0 credit</small>
        </div>
        {data.image && (
          <span className={`mc-node-badge ${isStale ? 'custom' : ''}`}>{isStale ? 'Bản cũ' : 'Sẵn sàng'}</span>
        )}
        <NodeDeleteButton nodeId={id} />
      </div>

      <div className="mc-node-body">
        <input
          className="mc-node-input nodrag"
          value={data.label}
          maxLength={60}
          placeholder="Tên khung hình (tùy chọn), vd. Khung cuối clip 1"
          onChange={(e) => updateNodeData(id, { label: e.target.value })}
        />

        {srcVideo ? (
          <div className="mc-frame-video nodrag">
            <video
              ref={videoRef}
              key={srcVideo.path}
              src={museMediaUrl(srcVideo.previewUrl)}
              controls
              muted
              playsInline
              preload="metadata"
              className="nowheel"
              onLoadedMetadata={(e) => {
                const d = e.currentTarget.duration
                if (Number.isFinite(d) && d > 0 && Math.abs(d - data.sourceDuration) > 0.05) {
                  updateNodeData(id, { sourceDuration: Math.round(d * 100) / 100 })
                }
              }}
            />
            <span className="mc-outfit-name" title={srcVideo.path}>
              {srcVideo.name}
              {maxDur > 0 ? ` · ${maxDur}s` : ''}
            </span>
          </div>
        ) : (
          <div className="mc-inputs-empty">
            <Link2Off size={12} /> Nối Video tham chiếu, Cắt video hoặc Clip vào cổng Video bên trái.
          </div>
        )}

        <div className="mc-seg mc-seg-sm nodrag" role="group" aria-label="Vị trí khung hình">
          {([
            { id: 'first', label: 'Khung đầu' },
            { id: 'last', label: 'Khung cuối' },
            { id: 'time', label: 'Mốc giây' },
          ] as { id: MuseFrameExtractMode; label: string }[]).map((m) => (
            <button
              key={m.id}
              type="button"
              className={data.mode === m.id ? 'on' : ''}
              onClick={() => updateNodeData(id, { mode: m.id })}
            >
              {m.label}
            </button>
          ))}
        </div>

        {data.mode === 'time' && (
          <div className="mc-frame-time nodrag">
            <label>
              <span>Giây</span>
              <input
                className="mc-input"
                type="number"
                min={0}
                max={maxDur > 0 ? maxDur : undefined}
                step={0.1}
                value={data.timeSec}
                onChange={(e) => updateNodeData(id, { timeSec: Math.max(0, Number(e.target.value) || 0) })}
              />
            </label>
            <button
              type="button"
              className="mc-mini-btn"
              disabled={!srcVideo}
              onClick={grabCurrentTime}
              title="Lấy đúng giây đang dừng trên video xem trước"
            >
              <LocateFixed size={11} /> Lấy mốc đang xem
            </button>
          </div>
        )}

        <button
          type="button"
          className="mc-run-btn mc-run-clipscript nodrag"
          disabled={!srcVideo || running}
          onClick={extract}
        >
          {running ? <Loader2 size={12} className="animate-spin" /> : <Camera size={12} />}
          {running ? 'Đang tách khung hình…' : data.image ? 'Tách lại khung hình · 0 credit' : 'Tách khung hình · 0 credit'}
        </button>

        {note && <div className="mc-node-ok">{note}</div>}
        {data.error && <div className="mc-node-error">{data.error}</div>}

        {data.image && (
          <div className="mc-frame-out nodrag">
            <a href={museMediaUrl(data.image.previewUrl)} target="_blank" rel="noreferrer" title="Mở ảnh PNG gốc">
              <img src={museMediaUrl(data.image.previewUrl)} alt={data.label || data.title} draggable={false} />
            </a>
            <div className="mc-node-actions">
              <span className="mc-node-meta" title={data.image.path}>{data.image.name}</span>
              <a className="mc-mini-btn" href={museMediaUrl(data.image.previewUrl)} target="_blank" rel="noreferrer" title="Mở ảnh">
                <ExternalLink size={11} /> Mở
              </a>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export const MuseFrameExtractNode = memo(MuseFrameExtractNodeImpl)
