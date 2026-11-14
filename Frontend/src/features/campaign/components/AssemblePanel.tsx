import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Circle, Film, Loader2, Mic, Square } from 'lucide-react'
import { API_URL } from '../../../shared/constants.ts'
import { artifactUrl, cancelRun, planRun, reroll, setParams } from '../services/campaignApi.ts'
import { describeElement, errorMessage, planBlocker, progressText } from '../services/campaignView.ts'
import type { ArtifactView, CampaignState, Plan, Tier } from '../types.ts'
import { Badge } from './Common.tsx'
import { DownloadMenu } from './DownloadMenu.tsx'
import { ExportPackPanel } from './ExportPackPanel.tsx'

interface Props {
  campaignId: string
  state: CampaignState
  artifacts: ArtifactView[]
  busy: boolean
  onChanged: () => Promise<void>
  onRun: (target: string, elements?: string[], tier?: Tier) => Promise<void>
  onError: (message: string) => void
  onPreview: (src: string) => void
}

interface VoiceOption { value: string; label: string }
interface BgmOption { id: string; name: string; seconds: number }

function CheckItem({ ok, children }: { ok: boolean; children: ReactNode }) {
  return (
    <li className={ok ? 'is-ok' : ''}>
      {ok ? <Check size={14} strokeWidth={3} /> : <Circle size={14} />}
      <span>{children}</span>
    </li>
  )
}

/** Khối 8: đọc lời thoại → ghép các clip ĐÃ DUYỆT + tiếng + chữ trên màn hình thành một video hoàn chỉnh (0 credit). */
export function AssemblePanel({ campaignId, state, artifacts, busy, onChanged, onRun, onError }: Props) {
  const steps = useMemo(() => state.blocks.flatMap(b => b.steps), [state])
  const voiceStep = steps.find(s => s.key === 'voice')
  const assembleStep = steps.find(s => s.key === 'assemble')
  const voiceEl = voiceStep?.elements[0]
  const assembleEl = assembleStep?.elements[0]
  const voiceId = String(voiceStep?.params.voice_id ?? '')
  const running = !!state.active_exec || !!voiceEl?.active_run || !!assembleEl?.active_run

  const [options, setOptions] = useState<VoiceOption[]>([])
  const [voiceNote, setVoiceNote] = useState('')
  const [plans, setPlans] = useState<Record<Tier, Plan | null>>({ draft: null, final: null })
  const [tracks, setTracks] = useState<BgmOption[]>([])
  const [wmTool, setWmTool] = useState<{ ok: boolean; message: string } | null>(null)
  const bgmId = Array.isArray(assembleStep?.params.bgm) ? String(assembleStep?.params.bgm[0] ?? '') : ''
  const savedVolume = Number(assembleStep?.params.bgm_volume ?? 0.12)
  const [volume, setVolume] = useState(savedVolume)
  useEffect(() => { setVolume(savedVolume) }, [savedVolume])

  useEffect(() => {
    let alive = true
    // Công cụ xóa watermark có sẵn của app (trang "Xóa Watermark"): cần cả trình duyệt xử lý video.
    fetch(`${API_URL}/api/watermark/check`)
      .then(r => (r.ok ? r.json() : null))
      .then((s: { gwr_available?: boolean; video_available?: boolean; message?: string } | null) => {
        if (alive) setWmTool(s ? { ok: !!(s.gwr_available && s.video_available), message: s.message ?? '' } : { ok: false, message: 'Không kiểm tra được công cụ xóa watermark.' })
      })
      .catch(() => { if (alive) setWmTool({ ok: false, message: 'Không kiểm tra được công cụ xóa watermark.' }) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    fetch(`${API_URL}/api/bgm`)
      .then(r => (r.ok ? r.json() : []))
      .then((list: { track_id: string; name: string; duration_sec?: number }[]) => {
        if (alive) setTracks(list.map(t => ({ id: t.track_id, name: t.name, seconds: Number(t.duration_sec ?? 0) })))
      })
      .catch(() => { if (alive) setTracks([]) })
    return () => { alive = false }
  }, [])

  useEffect(() => {
    let alive = true
    // Giọng của bạn nằm trong DB của backend; giọng mẫu cần voice-service (cổng 8001). Hai nguồn độc lập: thiếu một nguồn vẫn hiện nguồn còn lại.
    const load = async (path: string): Promise<any | null> => {
      try { const r = await fetch(`${API_URL}${path}`); return r.ok ? await r.json() : null } catch { return null }
    }
    Promise.all([load('/api/voices'), load('/api/voices/presets')]).then(([custom, presets]) => {
      if (!alive) return
      const list: VoiceOption[] = [
        ...((custom?.voices ?? custom ?? []) as { voice_id: string; name: string }[]).map(v => ({ value: v.voice_id, label: `${v.name} (giọng của bạn)` })),
        ...((presets ?? []) as { name: string; description: string }[]).map(p => ({ value: p.name, label: `${p.name} · ${p.description}` })),
      ]
      setOptions(list)
      setVoiceNote(presets === null ? 'Chưa kết nối được dịch vụ giọng đọc (cổng 8001): chỉ hiện giọng của bạn. Đọc lời thoại cần dịch vụ này; khởi động lại bằng npm start.' : '')
    })
    return () => { alive = false }
  }, [])

  const approvedClipsKey = (steps.find(x => x.key === 'clip')?.elements ?? []).map(e => `${e.gate}${e.state}`).join(',')
  const refreshKey = JSON.stringify([voiceEl?.state, assembleEl?.state, voiceEl?.gate, assembleEl?.selected_artifact_id, voiceId, JSON.stringify(assembleStep?.params ?? {}), approvedClipsKey])
  useEffect(() => {
    let alive = true
    // Ghép là bước cục bộ trên các clip ĐÃ DUYỆT và không tốn credit: không phụ thuộc độ phân giải đang xem ở khối 6, nên thử cả hai và dùng tier nào chạy được.
    Promise.all([planRun(campaignId, 'assemble', 'final').catch(() => null), planRun(campaignId, 'assemble', 'draft').catch(() => null)])
      .then(([final, draft]) => { if (alive) setPlans({ final, draft }) })
    return () => { alive = false }
  }, [campaignId, refreshKey])

  const finalVideo = artifacts.find(a => a.id === assembleEl?.selected_artifact_id && a.kind === 'video')
  const clipEls = steps.find(s => s.key === 'clip')?.elements.filter(e => e.element_key) ?? []
  const approvedClips = clipEls.filter(e => e.gate === 'approved').length
  const finalBlocker = planBlocker(plans.final, 'assemble', '')
  const draftBlocker = planBlocker(plans.draft, 'assemble', '')
  const runTier: Tier = !finalBlocker || draftBlocker ? 'final' : 'draft'
  const blocker = runTier === 'final' ? finalBlocker : draftBlocker
  const meta = finalVideo?.meta ?? {}
  const voiceReady = !!voiceEl?.selected_artifact_id && voiceEl.state !== 'stale'

  const setOpt = (params: Record<string, unknown>) => void setParams(campaignId, 'assemble', params).then(onChanged).catch(e => onError(errorMessage(e)))
  const captionStyle = String(assembleStep?.params.caption_style ?? 'pop')
  const captionColor = String(assembleStep?.params.caption_color ?? 'white')
  const transition = String(assembleStep?.params.transition ?? 'cut')
  const editStyle = String(assembleStep?.params.edit_style ?? 'shots')
  const cutSeconds = Number(assembleStep?.params.cut_seconds ?? 2.2)
  const flag = (key: string) => { const v = assembleStep?.params[key]; return v == null ? true : !['0', 'false', 'no', 'off', ''].includes(String(v).toLowerCase()) }
  // Video đã mới nhất mà bấm "Ghép lại": tạo lượt mới (nonce) rồi chạy, giống nút "Tạo lại" ở các khối khác.
  const rerunAssemble = async () => {
    try {
      if (finalVideo && assembleEl?.state === 'fresh') await reroll(campaignId, 'assemble')
      await onRun('assemble', undefined, runTier)
    } catch (e) { onError(errorMessage(e)) }
  }
  const pickBgm = (value: string) => void setParams(campaignId, 'assemble', { bgm: value ? [value] : null }).then(onChanged).catch(e => onError(errorMessage(e)))
  const saveVolume = () => {
    if (Math.abs(volume - savedVolume) < 0.004) return
    void setParams(campaignId, 'assemble', { bgm_volume: Number(volume.toFixed(2)) }).then(onChanged).catch(e => onError(errorMessage(e)))
  }
  const pickVoice = (value: string) => void setParams(campaignId, 'voice', { voice_id: value || null }).then(onChanged).catch(e => onError(errorMessage(e)))

  return (
    <div className="cp-split cp-split-r cp-split-r-wide" data-testid="assemble-panel">
      <section className="cp-card">
        <header className="cp-card-head">
          <div className="cp-head-title">
            <h3>Ghép & Xuất <span className="cp-tag">0 credit</span></h3>
            <span className="cp-head-sub">Đọc lời thoại rồi ghép các clip đã duyệt theo thứ tự shot, kèm chữ trên màn hình và nhạc nền thành một file mp4.</span>
          </div>
        </header>

        <div className="cp-group">
          <h4 className="cp-group-title"><Mic size={14} /> Giọng đọc</h4>
          <div className="cp-row">
            <select id="voice-pick" aria-label="Giọng đọc" className="cp-grow" value={voiceId} disabled={running} onChange={e => pickVoice(e.target.value)}>
              <option value="">— chọn giọng —</option>
              {voiceId && !options.some(o => o.value === voiceId) && <option value={voiceId}>{voiceId} (đã lưu)</option>}
              {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            {voiceEl && <Badge badge={describeElement(voiceEl)} />}
            <button type="button" className="btn-g cp-small" data-testid="run-voice" disabled={busy || running || !voiceId} onClick={() => void onRun('voice')}>
              {voiceEl?.active_run ? <Loader2 size={13} className="spinning" /> : <Mic size={13} />} Đọc lời thoại
            </button>
          </div>
          {voiceNote && <p className="cp-warn"><AlertTriangle size={13} /> {voiceNote}</p>}
          {voiceEl?.last_run?.state === 'error' && <p className="cp-error-inline">Giọng đọc lỗi: {voiceEl.last_run.error}</p>}
          {voiceEl?.active_run && <p className="cp-running-note"><Loader2 size={13} className="spinning" /> {progressText(voiceEl.progress) || 'Đang đọc…'}</p>}
        </div>

        <div className="cp-group" data-testid="look-row">
          <h4 className="cp-group-title"><Film size={14} /> Phụ đề và kiểu dựng</h4>
          <div className="cp-form cp-form-3">
            <label className="cp-field"><span>Phụ đề</span>
              <select id="caption-style" value={captionStyle} disabled={running} onChange={e => setOpt({ caption_style: e.target.value })}>
                <option value="pop">Chữ viền + đổ bóng (khuyên dùng)</option>
                <option value="box">Hộp đen</option>
                <option value="none">Không phụ đề</option>
              </select></label>
            {captionStyle === 'pop' && (
              <label className="cp-field"><span>Màu chữ</span>
                <select id="caption-color" value={captionColor} disabled={running} onChange={e => setOpt({ caption_color: e.target.value })}>
                  <option value="white">Chữ trắng</option>
                  <option value="yellow">Chữ vàng</option>
                </select></label>
            )}
            <label className="cp-field"><span>Kiểu dựng</span>
              <select id="edit-style" value={editStyle} disabled={running} onChange={e => setOpt({ edit_style: e.target.value })}>
                <option value="shots">Giữ trọn từng shot (đúng thời lượng)</option>
                <option value="micro">Cắt nhanh theo nhịp nhạc</option>
              </select></label>
            {editStyle === 'micro' ? (
              <label className="cp-field"><span>Độ dài mỗi cú cắt</span>
                <select id="cut-seconds" value={String(cutSeconds)} disabled={running} onChange={e => setOpt({ cut_seconds: Number(e.target.value) })}>
                  <option value="1.6">Rất nhanh (1,6 giây)</option>
                  <option value="2.2">Nhanh (2,2 giây)</option>
                  <option value="3">Vừa (3 giây)</option>
                </select></label>
            ) : (
              <label className="cp-field"><span>Chuyển cảnh</span>
                <select id="transition" value={transition} disabled={running} onChange={e => setOpt({ transition: e.target.value })}>
                  <option value="cut">Cắt cứng (kiểu TikTok)</option>
                  <option value="fade">Mờ chồng</option>
                  <option value="slide">Trượt</option>
                  <option value="zoom">Phóng</option>
                </select></label>
            )}
          </div>
          <p className="cp-note">
            {editStyle === 'micro'
              ? 'Cắt nhanh: mỗi shot chỉ giữ vài cú ngắn (nhiều chuyển động nhất) theo nhịp nhạc, nên video cuối NGẮN HƠN tổng thời lượng clip đã trả credit.'
              : 'Giữ trọn: video cuối dài bằng tổng thời lượng các clip (mặc định, vì bạn đã trả credit theo giây).'} Chữ nằm trong vùng an toàn của TikTok/Reels.
          </p>
          <div className="cp-row" data-testid="assemble-extras">
            <label className="cp-switch"><input type="checkbox" checked={flag('opening_text')} disabled={running} onChange={e => setOpt({ opening_text: e.target.checked })} /> Chữ hook mở màn (giây 0–1,2)</label>
            <label className="cp-switch"><input type="checkbox" checked={flag('end_card')} disabled={running} onChange={e => setOpt({ end_card: e.target.checked })} /> Thẻ kết với CTA (1,8 giây)</label>
            <label className="cp-switch"><input type="checkbox" checked={flag('ai_label')} disabled={running} onChange={e => setOpt({ ai_label: e.target.checked })} /> Nhãn “Hình ảnh tạo bằng AI”</label>
          </div>
        </div>

        <div className="cp-group" data-testid="bgm-row">
          <h4 className="cp-group-title">Nhạc nền</h4>
          <div className="cp-row">
            <select id="bgm-pick" aria-label="Nhạc nền" className="cp-grow" value={bgmId} disabled={running} onChange={e => pickBgm(e.target.value)}>
              <option value="">Không dùng nhạc nền</option>
              {bgmId && !tracks.some(t => t.id === bgmId) && <option value={bgmId}>{bgmId} (đã lưu)</option>}
              {tracks.map(t => <option key={t.id} value={t.id}>{t.name}{t.seconds ? ` (${Math.round(t.seconds)} giây)` : ''}</option>)}
            </select>
            {bgmId && (
              <label className="cp-range">
                <span>Âm lượng {Math.round(volume * 100)}%</span>
                <input id="bgm-volume" type="range" min={0.02} max={0.4} step={0.01} value={volume} disabled={running}
                       onChange={e => setVolume(Number(e.target.value))} onMouseUp={saveVolume} onKeyUp={saveVolume} onBlur={saveVolume} />
              </label>
            )}
          </div>
          <p className="cp-note">
            {tracks.length === 0 ? 'Thư viện nhạc đang trống hoặc chưa kết nối: thêm nhạc ở mục “Thư viện nhạc”.'
              : 'Nhạc tự lặp cho đủ độ dài, tự nhỏ đi khi có tiếng đọc và mờ dần ở cuối.'}
          </p>
        </div>
      </section>

      <section className="cp-card cp-export">
        <header className="cp-card-head">
          <h3>Video hoàn chỉnh</h3>
          {assembleEl && <Badge badge={describeElement(assembleEl)} />}
        </header>
        <ul className="cp-checklist" aria-label="Điều kiện để ghép">
          <CheckItem ok={clipEls.length > 0 && approvedClips === clipEls.length}>Clip đã duyệt: {approvedClips}/{clipEls.length} (khối 6)</CheckItem>
          <CheckItem ok={!!voiceId}>Đã chọn giọng đọc</CheckItem>
          <CheckItem ok={voiceReady}>Lời thoại đã đọc xong{voiceEl?.state === 'stale' ? ' (lời đã đổi, cần đọc lại)' : ''}</CheckItem>
        </ul>

        {running ? (
          <div className="cp-row">
            <span className="cp-running"><Loader2 size={15} className="spinning" /> {progressText(assembleEl?.progress) || 'Đang xử lý…'}</span>
            <button type="button" className="btn-g cp-small" onClick={() => void cancelRun(campaignId).then(onChanged)}><Square size={13} /> Hủy</button>
          </div>
        ) : (
          <button type="button" className="btn-p cp-wide-btn" data-testid="run-assemble" disabled={busy || !!blocker || !voiceId} onClick={() => void rerunAssemble()}>
            <Film size={15} /> {finalVideo ? 'Ghép lại video' : 'Ghép video hoàn chỉnh'}
          </button>
        )}
        {blocker && !running && <p className="cp-note">{blocker.reason}</p>}
        {!voiceId && !running && <p className="cp-note">Chọn một giọng đọc để ghép (video luôn kèm tiếng đọc).</p>}
        {assembleEl?.last_run?.state === 'error' && <p className="cp-error-inline">Ghép lỗi: {assembleEl.last_run.error}</p>}

        {finalVideo ? (
          <div className="cp-final" data-testid="final-video">
            <video key={finalVideo.id} src={artifactUrl(finalVideo.id)} controls preload="metadata" playsInline />
            <div className="cp-final-meta">
              <span>{String(meta.size ?? '')} · {String(meta.seconds ?? '')} giây{meta.edit_style === 'micro' ? ` · cắt nhanh ${meta.cuts ?? ''} cú` : ''}</span>
              <span>{meta.with_voice ? 'có tiếng đọc' : 'không có tiếng đọc'}{Array.isArray(meta.bgm) && meta.bgm.length ? ` · nhạc: ${(meta.bgm as string[]).join(', ')}` : ' · không nhạc nền'}</span>
            </div>
            <DownloadMenu campaignId={campaignId} videoId={finalVideo.id} fileName={`${state.campaign?.name ?? 'video'}.mp4`} watermarkTool={wmTool} onError={onError} />
          </div>
        ) : (
          <div className="cp-placeholder cp-final-empty">Video sẽ hiện ở đây sau khi ghép.</div>
        )}
        <ExportPackPanel campaignId={campaignId} state={state} busy={busy} hasVideo={!!finalVideo} onRun={t => onRun(t, undefined, runTier)} onError={onError} />
      </section>
    </div>
  )
}
