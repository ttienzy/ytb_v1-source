/**
 * Node "Clip" của Muse Canvas: 1 kịch bản clip tách từ node "Kịch bản tạo video" (nút "Ra node").
 * Giữ ảnh tham chiếu #k, số giây và prompt video — sửa được, kiểm tra lại mốc thời gian / số giây / độ dài
 * prompt (số ký tự chỉ để xem, không cảnh báo / không chặn) mỗi lần sửa. Nguồn viết lại thì báo và có "Dùng bản mới".
 */
import { memo, useCallback, useEffect, useMemo, useState } from 'react'
import { Handle, Position, useNodeConnections, useNodesData, useReactFlow, type Node, type NodeProps } from '@xyflow/react'
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Clapperboard,
  Copy,
  ExternalLink,
  Film,
  ImageOff,
  Loader2,
  RefreshCw,
  RotateCcw,
  Search,
} from 'lucide-react'
import {
  CLIP_MAX_SECONDS,
  CLIP_MIN_SECONDS,
  MUSE_HANDLE,
  MUSE_NODE,
  buildClipVideoRequest,
  checkClipPrompt,
  clipCredits720p,
  clipFlowCredits,
  clipFlowSettings,
  clipVideoBlockers,
  clipVideoFingerprint,
  clipVideoStalled,
  clipVideoState,
  isProjectHomeError,
  isSafeFlowError,
  stopWaitingVideo,
  type MuseClipVideo,
  newerClipFor,
  normalizeClipPromptData,
  normalizeClipScriptData,
  normalizeOutputData,
  promptBeats,
  type MuseImageRef,
} from '../../services/museCanvasNodes.ts'
import { getVeoJob, museMediaUrl, notifyVideoLibraryChanged, recoverVeoJob, submitVeoJob, veoVideoUrl, type VeoJobLite } from '../../services/museCanvasApi.ts'
import { useMuseCanvas } from '../../components/museCanvasContext'
import { NodeDeleteButton } from './NodeDeleteButton'

type ClipNode = Node<Record<string, unknown>, string>

/**
 * Vòng hỏi đang chạy của từng job Flow: job -> token của vòng đang giữ quyền (giữ trên globalThis qua HMR).
 * Lần gọi poll mới (vd. node vừa hiện lại sau khi đổi tab / đổi project) giành quyền, vòng cũ — đang ghi vào canvas
 * đã gỡ — tự dừng. Nhờ vậy mỗi job chỉ có 1 vòng hỏi và luôn cập nhật node đang hiện.
 */
const G = globalThis as unknown as { __clipVideoPollOwners?: Map<string, object> }
const pollers: Map<string, object> = (G.__clipVideoPollOwners ??= new Map())
const POLL_MS = 4000
const STEP_LABEL: Record<string, string> = {
  pending: 'Đang xếp hàng (một việc Flow mỗi lúc)',
  captcha: 'Đang giải reCAPTCHA',
  submitting: 'Đang gửi tới Flow',
  generating: 'Flow đang tạo video',
  downloading: 'Đang tải video về',
}

function videoFromJob(v: MuseClipVideo, job: VeoJobLite): MuseClipVideo {
  const status = job.status === 'done' ? 'done' : job.status === 'error' ? 'error' : 'running'
  return {
    ...v,
    jobId: job.job_id,
    status,
    step: job.status,
    detail: job.current_step || v.detail,
    backendUpdatedAt: job.updated_at ? Date.parse(job.updated_at) || v.backendUpdatedAt : v.backendUpdatedAt,
    files: job.output_files?.length ? job.output_files : v.files,
    error: status === 'error' ? job.error_message || 'Flow báo lỗi' : undefined,
    errorCode: status === 'error' ? job.error_code || undefined : undefined,
    updatedAt: Date.now(),
  }
}

function GptClipPromptNodeImpl({ id, data: raw, selected }: NodeProps<ClipNode>) {
  const { updateNodeData, getNode, getNodes } = useReactFlow()
  const { config, flowProject } = useMuseCanvas()
  const data = normalizeClipPromptData(raw)
  const flow = clipFlowSettings(config)
  const [videoBusy, setVideoBusy] = useState<'' | 'submit' | 'recover'>('')
  const [now, setNow] = useState(Date.now())
  const [showBody, setShowBody] = useState(false)
  const [copied, setCopied] = useState(false)
  const [copyErr, setCopyErr] = useState('')

  // Node nguồn (Kịch bản tạo video) đang nối vào -> biết có bản viết mới hơn không
  const conns = useNodeConnections({ handleType: 'target', handleId: MUSE_HANDLE.clipIn })
  const srcId = conns[0]?.source
  const src = useNodesData(srcId ? [srcId] : [])[0]
  const newer = useMemo(
    () => (src && src.type === MUSE_NODE.clipScript ? newerClipFor(data, normalizeClipScriptData(src.data as Record<string, unknown>)) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [src, data.origin?.updatedAt, data.k],
  )

  const beats = useMemo(() => promptBeats(data.prompt), [data.prompt])
  const warnings = useMemo(() => checkClipPrompt(data.prompt, data.seconds), [data.prompt, data.seconds])
  const promptEdited = data.prompt !== data.originalPrompt
  const secondsEdited = data.seconds !== data.originalSeconds
  const collapsed = data.collapsed

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(data.prompt)
      setCopied(true)
      setCopyErr('')
      setTimeout(() => setCopied(false), 1500)
    } catch {
      setCopyErr('Không chép được vào clipboard.')
    }
  }

  /** Ảnh của node Ảnh kết quả có đường dẫn này (để gắn ảnh #k của bản viết mới). */
  function imageForPath(path: string | null): MuseImageRef | null {
    if (!path) return null
    for (const n of getNodes()) {
      if (n.type !== MUSE_NODE.output) continue
      const img = normalizeOutputData(n.data as Record<string, unknown>).image
      if (img?.path === path) return img
    }
    return data.image?.path === path ? data.image : null
  }

  function useNewer() {
    if (!newer) return
    if ((promptEdited || secondsEdited) && !window.confirm('Thay prompt / số giây bạn đã sửa bằng bản ChatGPT mới viết?')) return
    const c = newer.clip
    updateNodeData(id, {
      title: `Clip ${c.k}/${c.n}`,
      name: c.name,
      n: c.n,
      seconds: c.seconds,
      originalSeconds: c.seconds,
      prompt: c.videoPrompt,
      originalPrompt: c.videoPrompt,
      body: c.body,
      image: imageForPath(newer.imagePath) ?? data.image,
      origin: { clipScriptNodeId: data.origin!.clipScriptNodeId, updatedAt: newer.updatedAt, k: c.k },
    })
  }

  // ---------------------------------------------------------------- Tạo video (Omni 1.2 trên Flow)
  const vstate = clipVideoState(data, flow)
  const video = data.video
  const vBlockers = useMemo(() => {
    const b = clipVideoBlockers(data, flow)
    if (flow.projectId && !flowProject) b.unshift('Project Flow đã chọn không còn trong app — chọn hoặc tạo project ở Cấu hình → Google Flow.')
    return b
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data.prompt, data.seconds, data.image, flow.projectId, flow.aspect, flow.resolution, flowProject])

  /** Hỏi trạng thái job tới khi xong / lỗi (job Flow chạy ở backend, đóng / mở lại canvas vẫn theo dõi tiếp được). */
  const poll = useCallback(
    async (jobId: string) => {
      const me = {}
      pollers.set(jobId, me)
      try {
        for (;;) {
          await new Promise((r) => setTimeout(r, POLL_MS))
          if (pollers.get(jobId) !== me) return // vòng mới đã giành quyền
          let job: VeoJobLite | null
          try {
            job = await getVeoJob(jobId)
          } catch {
            continue // backend đang khởi động lại: hỏi tiếp
          }
          const missing = job === null
          // Node đã dừng chờ / đã gửi job khác / đã bị xóa: thôi theo dõi job này
          const cur = normalizeClipPromptData(getNode(id)?.data as Record<string, unknown> | undefined).video
          if (!cur || cur.jobId !== jobId || cur.status !== 'running') break
          updateNodeData(id, (node) => {
            const v = normalizeClipPromptData(node.data as Record<string, unknown>).video
            if (!v || v.jobId !== jobId || v.status !== 'running') return {}
            if (missing) return { video: { ...v, status: 'error', error: 'Backend không còn job này — xem Thư Viện Video / Veo Studio.', updatedAt: Date.now() } }
            return { video: videoFromJob(v, job!) }
          })
          if (missing || job!.status === 'done' || job!.status === 'error') {
            if (job?.status === 'done') notifyVideoLibraryChanged()
            break
          }
        }
      } finally {
        if (pollers.get(jobId) === me) pollers.delete(jobId)
      }
    },
    [getNode, id, updateNodeData],
  )

  // Mở lại canvas khi job còn đang chạy: theo dõi tiếp (không gửi lại)
  useEffect(() => {
    const v = normalizeClipPromptData(raw).video
    if (v?.status === 'running' && v.jobId) poll(v.jobId)
    // chỉ khi node gắn lên màn hình
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (vstate !== 'running') return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [vstate])

  async function createVideo() {
    if (videoBusy || vstate === 'running' || vBlockers.length) return
    // Bấm là gửi ngay (không hộp xác nhận). An toàn nằm ở chỗ khác: nút hiện sẵn credit ước tính, khóa chống trùng theo
    // lần gửi, không bao giờ tự gửi lại, và lỗi "Flow có thể đã nhận lệnh" có chữ nhắc + nút "Tìm lại video".
    const attempt = (video?.attempt ?? 0) + 1
    let body: Record<string, unknown>
    try {
      body = buildClipVideoRequest(id, data, flow, attempt)
    } catch (e: any) {
      updateNodeData(id, { video: { status: 'error', fingerprint: '', attempt, error: e?.message, errorCode: 'NOT_SUBMITTED', startedAt: Date.now(), updatedAt: Date.now() } })
      return
    }
    const base: MuseClipVideo = { status: 'running', fingerprint: clipVideoFingerprint(data, flow), attempt, step: 'pending', startedAt: Date.now(), updatedAt: Date.now() }
    updateNodeData(id, { video: base })
    setVideoBusy('submit')
    try {
      const job = await submitVeoJob(body)
      updateNodeData(id, { video: videoFromJob(base, job) })
      if (job.status !== 'done' && job.status !== 'error') poll(job.job_id)
    } catch (e: any) {
      // backend từ chối trước khi tạo job (kiểm tra đầu vào): chưa gửi gì lên Flow
      updateNodeData(id, { video: { ...base, status: 'error', error: e?.message || 'Không gửi được job', errorCode: 'NOT_SUBMITTED', updatedAt: Date.now() } })
    } finally {
      setVideoBusy('')
    }
  }

  async function recoverVideo() {
    if (!video?.jobId || videoBusy) return
    setVideoBusy('recover')
    try {
      const job = await recoverVeoJob(video.jobId)
      updateNodeData(id, { video: videoFromJob(video, job) })
      if (job.status !== 'done' && job.status !== 'error') poll(job.job_id)
      else if (job.status === 'done') notifyVideoLibraryChanged()
    } catch (e: any) {
      updateNodeData(id, { video: { ...video, error: `Chưa tìm lại được: ${e?.message || 'lỗi'}`, updatedAt: Date.now() } })
    } finally {
      setVideoBusy('')
    }
  }

  const stalled = clipVideoStalled(video, now)
  const stalledMin = stalled && video ? Math.round((now - (video.backendUpdatedAt ?? video.startedAt)) / 60000) : 0
  function stopWaiting() {
    if (video?.status === 'running') updateNodeData(id, { video: stopWaitingVideo(video) })
  }

  const videoFile = video?.files?.[video.files.length - 1]
  const elapsedVideo = vstate === 'running' && video ? Math.max(0, Math.round((now - video.startedAt) / 1000)) : 0
  const safeErr = vstate === 'error' && (isSafeFlowError(video?.errorCode) || isProjectHomeError(video?.error))

  const total = data.seconds || beats[beats.length - 1]?.to || 0
  const thumb = data.image ? (
    <a href={museMediaUrl(data.image.previewUrl)} target="_blank" rel="noreferrer" className="nodrag" title={`Ảnh tham chiếu #${data.k} — gửi kèm prompt khi tạo clip`}>
      <img src={museMediaUrl(data.image.previewUrl)} alt={`Tham chiếu #${data.k}`} draggable={false} />
    </a>
  ) : (
    <span className="mc-xph" title="Chưa có ảnh tham chiếu (ảnh đã đổi sau lần viết)"><ImageOff size={14} /></span>
  )

  return (
    <div className={`mc-node mc-node-clipprompt ${collapsed ? 'mc-collapsed' : ''} ${selected ? 'selected' : ''}`}>
      <Handle
        type="target"
        position={Position.Left}
        id={MUSE_HANDLE.clipIn}
        className="mc-handle mc-handle-clip"
        title="Clip — nối từ node Kịch bản tạo video (hoặc bấm “Ra node” ở từng clip)"
      />
      <Handle
        type="source"
        position={Position.Right}
        id={MUSE_HANDLE.clipVideoOut}
        className="mc-handle mc-handle-video"
        title="Video đã tạo — nối tới node “Ghép video”"
      />
      <div className="mc-node-head">
        <span className="mc-node-icon mc-icon-clipscript"><Film size={14} /></span>
        <div className="mc-node-titles">
          <strong>{data.title}{data.name ? ` · ${data.name}` : ''}</strong>
          <small>Prompt video Omni 1.2 (Flow) · ảnh tham chiếu #{data.k}</small>
        </div>
        <span className="mc-node-count" title="Độ dài / credit Flow ước tính (720p)">
          {data.seconds ?? '?'}s{data.seconds ? ` · ≈${clipCredits720p(data.seconds)}cr` : ''}
        </span>
        <button type="button" className="mc-collapse-btn nodrag" onClick={() => updateNodeData(id, { collapsed: !collapsed })} title={collapsed ? 'Mở rộng node' : 'Thu gọn node'}>
          {collapsed ? <ChevronsUpDown size={13} /> : <ChevronsDownUp size={13} />}
        </button>
        <NodeDeleteButton nodeId={id} confirmText={promptEdited ? 'Xóa node Clip? Phần prompt bạn đã sửa sẽ mất.' : undefined} />
      </div>

      {collapsed ? (
        <div className="mc-node-body mc-collapsed-body">
          <div className="mc-collapsed-row">
            <span className="mc-thumbs">{thumb}</span>
            <span className="mc-collapsed-meta">
              {data.prompt.length.toLocaleString('vi-VN')} ký tự
              <small className={warnings.length ? 'mc-vstat mc-vstat-error' : 'mc-vstat mc-vstat-done'}>
                {warnings.length ? `${warnings.length} cảnh báo` : 'Hợp lệ'}
              </small>
            </span>
            <span className="mc-script-tools">
              <button type="button" className="mc-mini-btn nodrag" onClick={copyPrompt} title="Chép prompt video">
                {copied ? <Check size={11} /> : <Copy size={11} />}
              </button>
            </span>
          </div>
        </div>
      ) : (
        <div className="mc-node-body">
          {newer && (
            <div className="mc-output-newer">
              <span><RefreshCw size={12} /> Kịch bản nguồn đã viết lại — có bản mới cho clip {data.k}.</span>
              <button type="button" className="mc-mini-btn mc-mini-accent nodrag" onClick={useNewer}>Dùng bản mới</button>
            </div>
          )}

          <div className="mc-clipnode-top">
            {thumb}
            <div className="mc-clipnode-meta">
              <label className="mc-clipnode-sec nodrag" title={`Độ dài clip: số giây nguyên ${CLIP_MIN_SECONDS}–${CLIP_MAX_SECONDS} (Omni 1.2)`}>
                Độ dài
                <input
                  type="number"
                  min={CLIP_MIN_SECONDS}
                  max={CLIP_MAX_SECONDS}
                  step={1}
                  value={data.seconds ?? ''}
                  onChange={(e) => updateNodeData(id, { seconds: e.target.value === '' ? null : Number(e.target.value) })}
                />
                giây
                {secondsEdited && <span className="mc-node-badge custom">Đã sửa</span>}
              </label>
              <span className="mc-node-meta">
                {data.seconds ? `≈ ${clipCredits720p(data.seconds)} credit (720p, ước tính)` : ''}
              </span>
            </div>
          </div>

          {beats.length > 0 && total > 0 && (
            <div className="mc-clip-timeline" title={beats.map((b) => `${b.from}–${b.to}s`).join(' · ')}>
              {beats.map((b, i) => (
                <span key={i} className={`mc-clip-seg ${i === 0 ? 'in' : i === beats.length - 1 ? 'out' : ''}`} style={{ flexGrow: Math.max(0.1, b.to - b.from) }}>
                  {b.from}–{b.to}s
                </span>
              ))}
            </div>
          )}
          {warnings.map((w) => (
            <div key={w} className="mc-clip-warn"><AlertTriangle size={11} /> {w}</div>
          ))}

          <textarea
            className="mc-prompt nodrag nowheel"
            rows={10}
            value={data.prompt}
            spellCheck={false}
            onChange={(e) => updateNodeData(id, { prompt: e.target.value })}
            placeholder="Prompt video tiếng Anh cho Flow (Omni 1.2)…"
          />
          <div className="mc-node-actions">
            <span className="mc-node-meta">{data.prompt.length.toLocaleString('vi-VN')} ký tự</span>
            {promptEdited && <span className="mc-node-badge custom">Đã sửa</span>}
            {(promptEdited || secondsEdited) && (
              <button
                type="button"
                className="mc-mini-btn nodrag"
                onClick={() => updateNodeData(id, { prompt: data.originalPrompt, seconds: data.originalSeconds })}
                title="Quay về prompt và số giây ChatGPT viết"
              >
                <RotateCcw size={11} /> Bản gốc
              </button>
            )}
            <button type="button" className="mc-mini-btn mc-mini-accent nodrag" onClick={copyPrompt} disabled={!data.prompt.trim()} title="Chép prompt (dán vào Flow kèm ảnh tham chiếu này)">
              {copied ? <Check size={11} /> : <Copy size={11} />} Chép prompt
            </button>
          </div>
          {copyErr && <div className="mc-node-error">{copyErr}</div>}

          {/* Video Flow */}
          <div className={`mc-clipvideo mc-cv-${vstate}`}>
            <div className="mc-clipvideo-head">
              <Clapperboard size={13} /> Video Flow
              <small>
                Omni 1.2 · {flow.aspect} · {flow.resolution} · {flowProject ? flowProject.name : 'chưa chọn project'}
                {flowProject?.account_email ? ` · ${flowProject.account_email}` : ''}
              </small>
            </div>
            {vstate === 'running' && (
              <>
                <div className="mc-node-meta">
                  <Loader2 size={12} className="animate-spin" /> {STEP_LABEL[video?.step || ''] || video?.step || 'Đang chạy'} · {elapsedVideo}s
                </div>
                {video?.detail && <div className="mc-node-meta" title={video.detail}>{video.detail}</div>}
                {stalled && (
                  <div className="mc-clip-warn">
                    <AlertTriangle size={11} /> Backend không báo gì thêm về job này đã {stalledMin} phút — có thể job đã chết (vd. backend khởi động lại). Bấm “Dừng chờ”.
                  </div>
                )}
              </>
            )}
            {(vstate === 'done' || vstate === 'stale') && videoFile && (
              <>
                <video className={`mc-clipvideo-player nodrag ${vstate === 'stale' ? 'dim' : ''}`} src={veoVideoUrl(videoFile)} controls preload="metadata" />
                {vstate === 'stale' && (
                  <div className="mc-clip-warn"><AlertTriangle size={11} /> Prompt / số giây / ảnh / cấu hình đã đổi — video này là bản cũ.</div>
                )}
              </>
            )}
            {vstate === 'error' && video?.error && (
              <div className="mc-node-error">
                {video.error}
                <div className="mc-clipvideo-hint">
                  {isProjectHomeError(video.error)
                    ? 'Tab Flow bị đẩy về trang chủ: project này không mở được với tài khoản Google đang đăng nhập (thường do đã đổi tài khoản). Chưa mất credit — vào Cấu hình → Google Flow → “Tạo project mới”, rồi bấm “Tạo lại”.'
                    : isSafeFlowError(video.errorCode)
                      ? 'Lỗi xảy ra trước khi gửi lên Flow — chưa mất credit, có thể tạo lại.'
                      : 'Flow có thể đã nhận lệnh (và trừ credit). Bấm “Tìm lại video” trước khi tạo lại.'}
                </div>
              </div>
            )}
            {vstate !== 'running' &&
              vBlockers.map((b) => (
                <div key={b} className="mc-clip-warn"><AlertTriangle size={11} /> {b}</div>
              ))}
            <div className="mc-node-actions">
              {vstate === 'running' && (
                <button type="button" className="mc-mini-btn nodrag" onClick={stopWaiting} title="Thôi theo dõi job này và mở lại nút Tạo lại (job vẫn có thể chạy ở backend)">
                  Dừng chờ
                </button>
              )}
              {vstate === 'error' && video?.jobId && !safeErr && (
                <button type="button" className="mc-mini-btn nodrag" onClick={recoverVideo} disabled={!!videoBusy} title="Đọc video đã tạo trong project Flow (khớp mediaId) — không gửi lại">
                  {videoBusy === 'recover' ? <Loader2 size={11} className="animate-spin" /> : <Search size={11} />} Tìm lại video
                </button>
              )}
              {(vstate === 'done' || vstate === 'stale') && videoFile && (
                <a className="mc-mini-btn nodrag" href={veoVideoUrl(videoFile)} target="_blank" rel="noreferrer" title="Mở video trong tab mới">
                  <ExternalLink size={11} /> Mở
                </a>
              )}
              <button
                type="button"
                className="mc-run-btn mc-run-clipscript mc-clipvideo-run nodrag"
                disabled={!!videoBusy || vstate === 'running' || vBlockers.length > 0}
                onClick={createVideo}
                title="Gửi Omni 1.2 Ingredients (ảnh tham chiếu này + prompt) lên Google Flow — tốn credit, bấm là gửi ngay; không bao giờ tự gửi lại"
              >
                {vstate === 'running' || videoBusy === 'submit' ? <Loader2 size={12} className="animate-spin" /> : <Clapperboard size={12} />}
                {vstate === 'none' ? 'Tạo video' : 'Tạo lại'}
                {data.seconds && Number.isInteger(data.seconds) ? ` · ≈${clipFlowCredits(data.seconds, flow.resolution)} credit` : ''}
              </button>
            </div>
          </div>

          {data.body && (
            <>
              <button type="button" className="mc-xtoggle nodrag" onClick={() => setShowBody((v) => !v)}>
                {showBody ? <ChevronDown size={12} /> : <ChevronRight size={12} />} Chi tiết (style, timeline)
              </button>
              {showBody && <pre className="mc-script-text nodrag nowheel">{data.body}</pre>}
            </>
          )}
        </div>
      )}
    </div>
  )
}

export const GptClipPromptNode = memo(GptClipPromptNodeImpl)
