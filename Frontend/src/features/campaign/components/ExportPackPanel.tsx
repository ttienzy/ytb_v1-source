import { useEffect, useState } from 'react'
import { Check, Copy, Package } from 'lucide-react'
import { fetchArtifactJson } from '../services/campaignApi.ts'
import { describeElement, errorMessage } from '../services/campaignView.ts'
import type { CampaignState, ExportPack } from '../types.ts'
import { Badge } from './Common.tsx'

interface Props {
  campaignId: string
  state: CampaignState
  busy: boolean
  hasVideo: boolean
  onRun: (target: string) => Promise<void>
  onError: (message: string) => void
}

/** Gói đăng bài: caption + hashtag + CTA + dòng khai báo AI, kèm checklist theo nền tảng đăng. 0 credit, cục bộ. */
export function ExportPackPanel({ campaignId, state, busy, hasVideo, onRun, onError }: Props) {
  const el = state.blocks.flatMap(b => b.steps).find(s => s.key === 'export_pack')?.elements[0]
  const [pack, setPack] = useState<ExportPack | null>(null)
  const [copied, setCopied] = useState(false)
  const running = !!state.active_exec || !!el?.active_run
  useEffect(() => {
    let alive = true
    const id = el?.selected_artifact_id
    if (!id) { setPack(null); return }
    fetchArtifactJson<ExportPack>(id).then(p => { if (alive) setPack(p) }).catch(e => onError(errorMessage(e)))
    return () => { alive = false }
  }, [el?.selected_artifact_id, onError])

  const copy = async () => {
    if (!pack) return
    try { await navigator.clipboard.writeText(pack.post_text); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { /* bỏ qua */ }
  }
  const needsRun = !el?.selected_artifact_id || el.state === 'stale'

  return (
    <div className="cp-group" data-testid="export-pack">
      <h4 className="cp-group-title"><Package size={14} /> Gói đăng bài {el && <Badge badge={describeElement(el)} />}</h4>
      <div className="cp-row">
        <button type="button" className={`${needsRun ? 'btn-p' : 'btn-g'} cp-small`} data-testid="run-export-pack" disabled={busy || running || !hasVideo} onClick={() => void onRun('export_pack')}>
          <Package size={13} /> {pack ? 'Tạo lại gói đăng' : 'Tạo gói đăng'}
        </button>
        {!hasVideo && <span className="cp-note">Ghép video trước.</span>}
        {pack && <button type="button" className="btn-g cp-small" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />} {copied ? 'Đã chép' : 'Chép caption + hashtag'}</button>}
      </div>
      {pack && (
        <>
          <pre className="cp-pre" data-testid="post-text">{pack.post_text}</pre>
          <ul className="cp-checklist" aria-label={`Checklist ${pack.platform_label}`}>
            {pack.checklist.map((c, i) => <li key={i}><Check size={14} strokeWidth={3} /><span>{c}</span></li>)}
          </ul>
          <p className="cp-note">Nền tảng: {pack.platform_label} · dòng khai báo AI luôn kèm theo (luật AI Việt Nam từ 1/3/2026).</p>
        </>
      )}
    </div>
  )
}
