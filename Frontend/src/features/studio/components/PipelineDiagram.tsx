import {
  CheckCircle2,
  Film,
  Loader2,
  Mic,
  Music,
  Scissors,
  Sparkles,
  XCircle,
} from 'lucide-react'
import type { JobOut, NodeState } from '../types'

export function NodeIcon({
  state,
  icon: Icon,
}: {
  state: NodeState
  icon: React.ElementType
}) {
  if (state === 'running') return <Loader2 size={22} className="spin" />
  if (state === 'done') return <CheckCircle2 size={22} />
  if (state === 'error') return <XCircle size={22} />
  if (state === 'skipped') return <span className="n-skip">—</span>
  return <Icon size={20} />
}

export function PipelineNode({
  label,
  subLabel,
  state: st,
  icon: Icon,
  progress,
}: {
  label: string
  subLabel?: string
  state: NodeState
  icon: React.ElementType
  progress?: { done: number; total: number }
}) {
  const pct =
    progress && progress.total > 0
      ? Math.round((progress.done / progress.total) * 100)
      : null
  return (
    <div className={`node ${st}`}>
      <div className="n-icon">
        <NodeIcon state={st} icon={Icon} />
      </div>
      <span className="n-label">{label}</span>
      <span className="n-sub">
        {subLabel ||
          (st === 'idle'
            ? 'Chờ…'
            : st === 'running'
            ? 'Đang chạy…'
            : st === 'done'
            ? 'Hoàn tất'
            : st === 'skipped'
            ? 'Bỏ qua'
            : 'Lỗi')}
      </span>
      {st === 'running' && pct !== null && (
        <div className="n-pbar">
          <i style={{ width: `${pct}%` }} />
        </div>
      )}
    </div>
  )
}

export function PipelineDiagram({
  job,
  voiceId,
  polishEnabled,
}: {
  job: JobOut
  voiceId: string
  polishEnabled: boolean
}) {
  const segs = (job.recap?.scenes ?? []).reduce(
    (a, s) => a + (s.segments?.length ?? 0),
    0
  )
  const p = job.progress ?? {
    cut: { done: 0, total: 0 },
    voice: { done: 0, total: 0 },
    merge: { done: 0, total: 0 },
  }

  const recapState: NodeState =
    job.recap_status === 'done'
      ? 'done'
      : job.recap_status === 'running' ||
        job.recap_status === 'refreshing_cookie' ||
        job.recap_status === 'rate_limited'
      ? 'running'
      : job.recap_status === 'error'
      ? 'error'
      : 'idle'
  const cutState: NodeState =
    job.cut_status === 'done'
      ? 'done'
      : job.cut_status === 'running'
      ? 'running'
      : job.cut_status === 'error'
      ? 'error'
      : 'idle'
  const voiceState: NodeState =
    job.voice_status === 'done'
      ? 'done'
      : job.voice_status === 'running'
      ? 'running'
      : job.voice_status === 'error'
      ? 'error'
      : 'idle'
  const mergeState: NodeState =
    job.merge_status === 'done'
      ? 'done'
      : job.merge_status === 'running'
      ? 'running'
      : job.merge_status === 'error'
      ? 'error'
      : 'idle'
  const polishState: NodeState = !polishEnabled
    ? 'skipped'
    : job.polish_status === 'done'
    ? 'done'
    : job.polish_status === 'running'
    ? 'running'
    : job.polish_status === 'error'
    ? 'error'
    : 'idle'

  const afterRecapDone = recapState === 'done'
  const bothDone = cutState === 'done' && voiceState === 'done'
  const mergeDone = mergeState === 'done'

  const connCls = (active: boolean, done: boolean) =>
    `conn${done ? ' done' : active ? ' active' : ''}`
  const forkCls = (active: boolean, done: boolean) =>
    `fork-lines${done ? ' done' : active ? ' active' : ''}`
  const joinCls = (active: boolean, done: boolean) =>
    `join-lines${done ? ' done' : active ? ' active' : ''}`

  const subRecap =
    recapState === 'done'
      ? `${segs} đoạn · ${job.recap?.scenes?.length ?? 0} cảnh`
      : job.recap_status === 'rate_limited'
      ? '⏳ Quá tải 429 — tạm nghỉ 30s…'
      : job.recap_status === 'refreshing_cookie'
      ? 'Làm mới cookie Gemini…'
      : p.recap && p.recap.total > 0
      ? `Chunk ${p.recap.done}/${p.recap.total}`
      : undefined

  const isBotWall =
    !!job.error &&
    (job.error.toLowerCase().includes('sign in to confirm') ||
      job.error.toLowerCase().includes('not a bot') ||
      job.error.toLowerCase().includes('exporting-youtube-cookies') ||
      job.error.toLowerCase().includes('--cookies') ||
      job.error.toLowerCase().includes('bot-wall'))

  const subCut =
    cutState === 'running'
      ? 'Đang tải 1080p…'
      : cutState === 'done'
      ? '1080p sẵn sàng'
      : cutState === 'error' && isBotWall
      ? '🔒 Cần Login YouTube'
      : undefined
  const subVoice =
    voiceState === 'running'
      ? p.voice.phase === 'unpack'
        ? `Giải nén ${p.voice.done}/${p.voice.total}`
        : 'TTS đang tổng hợp…'
      : voiceState === 'done'
      ? `${p.voice.total} VO`
      : undefined
  const subMerge =
    mergeState === 'running' && p.merge.total > 0
      ? `Mux ${p.merge.done}/${p.merge.total}`
      : mergeState === 'done'
      ? 'final_recap.mp4'
      : undefined
  const subPolish =
    polishState === 'running'
      ? p.polish && p.polish.total > 0
        ? `Mix BGM ${Math.round(
            (p.polish.done / p.polish.total) * 100
          )}% (${Math.round(p.polish.done)}s/${Math.round(
            p.polish.total
          )}s)`
        : 'Đang mix BGM…'
      : polishState === 'done'
      ? 'final_studio.mp4'
      : polishState === 'skipped'
      ? 'Không dùng'
      : undefined

  const statusText = (() => {
    if (job.overall === 'error') return `Lỗi: ${job.error ?? 'không xác định'}`
    if (polishState === 'done')
      return '✅ Hoàn tất — final_studio.mp4 sẵn sàng tải về'
    if (polishState === 'running') {
      const pct =
        p.polish && p.polish.total > 0
          ? Math.round((p.polish.done / p.polish.total) * 100)
          : null
      return pct !== null
        ? `Polish — đang hòa âm nhạc nền BGM (${pct}% — ${Math.round(
            p.polish?.done ?? 0
          )}s/${Math.round(p.polish?.total ?? 0)}s)…`
        : 'Polish — đang mix nhạc nền dưới VO…'
    }
    if (mergeState === 'done')
      return '✅ Hoàn tất — final_recap.mp4 sẵn sàng tải về'
    if (mergeState === 'running')
      return 'Ghép video — mux clip + VO → concat final…'
    if (cutState === 'running' || voiceState === 'running')
      return 'Cut & Voice đang chạy song song…'
    if (job.recap_status === 'rate_limited')
      return '⏳ Gemini đang giới hạn tốc độ (429 Rate Limit) — tự động tạm nghỉ 30s trước khi tiếp tục…'
    if (job.recap_status === 'refreshing_cookie')
      return '🔄 Cookie Gemini hết hạn — đang tự động làm mới (Chrome)…'
    if (recapState === 'running')
      return 'Recap — đang lấy & phân tích transcript (YouTube → Gemini)…'
    return 'Đang khởi động pipeline…'
  })()

  const dotCls =
    polishState === 'done'
      ? 'dot done'
      : mergeState === 'done'
      ? 'dot done'
      : job.overall === 'error'
      ? 'dot err'
      : 'dot run'

  const overallPct = (() => {
    const sc = (s: NodeState) => (s === 'done' ? 1 : s === 'running' ? 0.5 : 0)
    const denom = polishEnabled ? 5 : 4
    const pts =
      sc(recapState) +
      sc(cutState) +
      sc(voiceState) +
      sc(mergeState) +
      (polishEnabled ? sc(polishState) : 0)
    return Math.round((pts / denom) * 100)
  })()

  return (
    <>
      <div className="pc-hdr">
        <div className="pc-title-wrap">
          <span className="title">Tiến trình pipeline</span>
          <span className="jid">job: {job.job_id}</span>
        </div>
        <div className="pc-progress">
          <span className="pc-pct">{overallPct}%</span>
          <div className="pc-pbar">
            <i style={{ width: `${overallPct}%` }} />
          </div>
        </div>
      </div>
      <div className="flow">
        <PipelineNode
          label="Recap LLM"
          state={recapState}
          icon={Sparkles}
          subLabel={subRecap}
          progress={recapState === 'running' ? p.recap : undefined}
        />
        <div className={connCls(afterRecapDone, afterRecapDone)} />
        <div className={forkCls(afterRecapDone, bothDone)} />
        <div className="pcol">
          <span className="pbadge">↕ song song</span>
          <PipelineNode
            label="Tải video"
            state={cutState}
            icon={Scissors}
            subLabel={subCut}
            progress={cutState === 'running' ? p.cut : undefined}
          />
          <PipelineNode
            label="Tạo voice"
            state={voiceState}
            icon={Mic}
            subLabel={subVoice}
            progress={
              voiceState === 'running' && p.voice.phase === 'unpack'
                ? p.voice
                : undefined
            }
          />
        </div>
        <div className={joinCls(afterRecapDone, bothDone)} />
        <div className={connCls(bothDone, mergeDone)} />
        <PipelineNode
          label="Ghép video"
          state={mergeState}
          icon={Film}
          subLabel={subMerge}
          progress={mergeState === 'running' ? p.merge : undefined}
        />
        <div
          className={connCls(
            mergeDone,
            polishState !== 'idle' && polishState !== 'skipped'
          )}
        />
        <PipelineNode
          label="Polish"
          state={polishState}
          icon={Music}
          subLabel={subPolish}
          progress={
            polishState === 'running' && p.polish && p.polish.total > 0
              ? p.polish
              : undefined
          }
        />
      </div>
      <div className="sbar">
        <span className={dotCls} />
        <span>{statusText}</span>
      </div>
    </>
  )
}
