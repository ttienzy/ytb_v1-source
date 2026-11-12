import { useState, type ReactNode } from 'react'
import { Check, CheckCircle2, Film, Layers, Loader2, Play } from 'lucide-react'
import { API_URL } from '../../shared/constants'
import { groupMergedByAspect, mergeTotalSeconds, type Aspect, type DoneItem } from './videoModel'
import type { VideoWorkspace } from './useVideoWorkspace'

type Tab = 'done' | 'merge' | 'merged'

type ResultProps = Pick<VideoWorkspace, 'done' | 'merged' | 'runMerge' | 'mergeBusy' | 'mergeMessage' | 'mergeResult'> & {
  onOpenDone: (item: DoneItem) => void
}

function Empty({ children }: { children: ReactNode }) {
  return <div className="vp-empty">{children}</div>
}

/** Ba khu vực kết quả gom vào MỘT thẻ có tab (trước đây là 3 khối xếp dọc): kho hoàn tất · gộp · video đã gộp. */
export function ResultTabs({ done, merged, runMerge, mergeBusy, mergeMessage, mergeResult, onOpenDone }: ResultProps) {
  const [tab, setTab] = useState<Tab>('done')
  const [aspect, setAspect] = useState<Aspect>('9:16')
  const [minutes, setMinutes] = useState(1)
  const [seconds, setSeconds] = useState(0)
  const [mode, setMode] = useState<'random' | 'manual'>('random')
  const [picked, setPicked] = useState<string[]>([])

  const candidates = done.filter(item => item.aspect === aspect)
  const groups = groupMergedByAspect(merged)

  return (
    <section className="vp-card vp-results">
      <div className="vp-tabs wide" role="tablist" aria-label="Kết quả">
        <button type="button" role="tab" aria-selected={tab === 'done'} className={tab === 'done' ? 'active' : ''} onClick={() => setTab('done')}><CheckCircle2 size={14} /> Hoàn tất <span className="vp-count">{done.length}</span></button>
        <button type="button" role="tab" aria-selected={tab === 'merge'} className={tab === 'merge' ? 'active' : ''} onClick={() => setTab('merge')}><Layers size={14} /> Gộp video</button>
        <button type="button" role="tab" aria-selected={tab === 'merged'} className={tab === 'merged' ? 'active' : ''} onClick={() => setTab('merged')}><Film size={14} /> Đã gộp <span className="vp-count">{merged.length}</span></button>
      </div>

      <div className="vp-results-body">
        {tab === 'done' && (
          done.length ? (
            <div className="vp-grid">
              {done.map(item => (
                <button type="button" className="vp-card-item" key={item.done_id} onClick={() => onOpenDone(item)} title="Bấm để xem">
                  <video src={`${API_URL}/api/video/done/${item.done_id}/file#t=0.5`} muted preload="metadata" />
                  <span><strong>{item.name}</strong><small>{item.aspect} · {item.source_name}</small></span>
                </button>
              ))}
            </div>
          ) : <Empty>Chưa có video hoàn tất. Chọn video ở kho rồi bấm “Xử lý” — kết quả lưu tại <code>Data/media/videos/processed</code>.</Empty>
        )}

        {tab === 'merge' && (
          <div className="vp-merge">
            <div className="vp-merge-row">
              <div className="vp-field">
                <span>Khổ xuất</span>
                <div className="vp-seg" role="radiogroup" aria-label="Khổ xuất">
                  {(['9:16', '16:9'] as const).map(value => (
                    <button key={value} type="button" role="radio" aria-checked={aspect === value} className={aspect === value ? 'active' : ''} onClick={() => { setAspect(value); setPicked([]) }}>{value}</button>
                  ))}
                </div>
              </div>
              <div className="vp-field">
                <span>Thời lượng</span>
                <div className="vp-time">
                  <input type="number" min={0} max={999} value={minutes} onChange={event => setMinutes(Math.max(0, Number(event.target.value)) || 0)} aria-label="Phút" /><em>phút</em>
                  <input type="number" min={0} max={59} value={seconds} onChange={event => setSeconds(Math.min(59, Math.max(0, Number(event.target.value))) || 0)} aria-label="Giây" /><em>giây</em>
                </div>
              </div>
              <div className="vp-field">
                <span>Cách chọn video</span>
                <div className="vp-seg" role="radiogroup" aria-label="Cách chọn video">
                  <button type="button" role="radio" aria-checked={mode === 'random'} className={mode === 'random' ? 'active' : ''} onClick={() => setMode('random')}>Ngẫu nhiên</button>
                  <button type="button" role="radio" aria-checked={mode === 'manual'} className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>Tự chọn</button>
                </div>
              </div>
              <button type="button" className="vp-primary" onClick={() => runMerge({ aspect, seconds: mergeTotalSeconds(minutes, seconds), mode, doneIds: picked })} disabled={mergeBusy || !candidates.length} title={candidates.length ? undefined : `Chưa có video hoàn tất khổ ${aspect}`}>
                {mergeBusy ? <Loader2 size={15} className="spin" /> : <Play size={14} fill="currentColor" />} {mergeBusy ? 'Đang gộp…' : 'Gộp video'}
              </button>
            </div>

            {(mergeMessage || mergeResult) && (
              <div className="vp-merge-status">
                {mergeMessage && <span className="vp-message"><Check size={13} /> {mergeMessage}</span>}
                {mergeResult && <a className="vp-ghost" href={`${API_URL}/api/video/merge-file/${encodeURIComponent(mergeResult.file_name)}`} download={mergeResult.file_name}>Tải video gộp</a>}
              </div>
            )}

            {mode === 'manual' && (
              candidates.length ? (
                <>
                  <div className="vp-list-tools"><strong>Video hoàn tất khổ {aspect}</strong><span>{picked.length} đã chọn</span></div>
                  <div className="vp-grid">
                    {candidates.map(item => (
                      <label key={item.done_id} className={`vp-card-item pick ${picked.includes(item.done_id) ? 'selected' : ''}`}>
                        <input type="checkbox" checked={picked.includes(item.done_id)} onChange={() => setPicked(current => (current.includes(item.done_id) ? current.filter(id => id !== item.done_id) : [...current, item.done_id]))} />
                        <video src={`${API_URL}/api/video/done/${item.done_id}/file#t=0.5`} muted preload="metadata" />
                        <span><strong>{item.name}</strong></span>
                      </label>
                    ))}
                  </div>
                </>
              ) : <Empty>Chưa có video hoàn tất khổ {aspect} để chọn.</Empty>
            )}
          </div>
        )}

        {tab === 'merged' && (
          merged.length ? (
            <div className="vp-merged-cols">
              {(['9:16', '16:9'] as const).map(value => (
                <div key={value}>
                  <h4>Khổ {value} <span className="vp-count">{groups[value].length}</span></h4>
                  {groups[value].length ? (
                    <div className="vp-grid compact">
                      {groups[value].map(item => (
                        <a className="vp-card-item" key={item.file_name} href={`${API_URL}/api/video/merge-preview/${encodeURIComponent(item.file_name)}`} target="_blank" rel="noreferrer" title="Mở xem video">
                          <video src={`${API_URL}/api/video/merge-preview/${encodeURIComponent(item.file_name)}#t=0.5`} muted preload="metadata" />
                          <span><strong>{item.name}</strong></span>
                        </a>
                      ))}
                    </div>
                  ) : <Empty>Chưa có video khổ {value}.</Empty>}
                </div>
              ))}
            </div>
          ) : <Empty>Chưa có video gộp. Gộp ở tab “Gộp video” — lưu tại <code>Data/media/videos/MergeVideo</code>.</Empty>
        )}
      </div>
    </section>
  )
}
