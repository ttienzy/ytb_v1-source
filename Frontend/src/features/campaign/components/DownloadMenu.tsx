import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Download, Eraser, Loader2, Music2, RotateCw } from 'lucide-react'
import { artifactUrl, exportFileUrl, getExports, startExport } from '../services/campaignApi.ts'
import { errorMessage } from '../services/campaignView.ts'
import type { ExportStatus, ExportVariant } from '../types.ts'

interface Props {
  campaignId: string
  videoId: string
  fileName: string
  /** Công cụ xóa watermark có sẵn trên máy không (null = chưa biết). */
  watermarkTool: { ok: boolean; message: string } | null
  onError: (message: string) => void
}

const ITEMS: { key: ExportVariant; title: string; hint: string; needsBgm?: boolean; watermark?: boolean }[] = [
  { key: 'clean', title: 'Bản xóa watermark', hint: 'Xóa logo Gemini/Veo, giữ nguyên phần còn lại.', watermark: true },
  { key: 'no_bgm', title: 'Bản tách nhạc nền', hint: 'Không nhạc nền, giữ tiếng đọc và phụ đề (để gắn nhạc trên TikTok).', needsBgm: true },
  { key: 'clean_no_bgm', title: 'Xóa watermark + không nhạc nền', hint: 'Gộp cả hai.', needsBgm: true, watermark: true },
]

/** Bấm một đường dẫn tải (Electron/Chrome đều tải file vì backend gửi Content-Disposition). */
function triggerDownload(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}

/** Nút tải video cuối + menu các bản phụ. Bản phụ tạo một lần sau khi ghép (0 credit), lần sau tải ngay. */
export function DownloadMenu({ campaignId, videoId, fileName, watermarkTool, onError }: Props) {
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<ExportStatus | null>(null)
  const [unsupported, setUnsupported] = useState(false)
  const wanted = useRef<Set<ExportVariant>>(new Set())        // bản user vừa yêu cầu: xong thì tự tải
  const boxRef = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try { setStatus(await getExports(campaignId)); setUnsupported(false) } catch { setUnsupported(true) }
  }, [campaignId])
  useEffect(() => { void load() }, [load, videoId])

  const running = Object.values(status?.variants ?? {}).some(v => v?.state === 'running')
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => { void load() }, 1500)
    return () => clearInterval(t)
  }, [running, load])

  // Bản vừa yêu cầu đã xong -> tự tải; lỗi -> bỏ khỏi danh sách chờ.
  useEffect(() => {
    for (const key of [...wanted.current]) {
      const st = status?.variants[key]?.state
      if (st === 'ready') { wanted.current.delete(key); triggerDownload(exportFileUrl(campaignId, key), '') }
      else if (st === 'error') wanted.current.delete(key)
    }
  }, [status, campaignId])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const make = async (key: ExportVariant) => {
    wanted.current.add(key)
    try { setStatus(await startExport(campaignId, key)) } catch (e) { wanted.current.delete(key); onError(errorMessage(e)) }
  }

  const sameVideo = status?.artifact_id === videoId
  const runningItem = ITEMS.find(i => status?.variants[i.key]?.state === 'running')

  return (
    <div className="cp-dl" ref={boxRef} data-testid="download-menu">
      <div className="cp-dl-split">
        <a className="btn-g cp-small cp-dl-main" href={artifactUrl(videoId)} download={fileName}><Download size={13} /> Tải video về</a>
        <button type="button" className="btn-g cp-small cp-dl-caret" aria-haspopup="menu" aria-expanded={open} aria-label="Các bản tải khác"
                onClick={() => { setOpen(o => !o); void load() }}>
          <ChevronDown size={14} />
        </button>
      </div>
      {runningItem && (
        <p className="cp-running-note" data-testid="export-progress">
          <Loader2 size={13} className="spinning" /> {runningItem.title}: {status?.variants[runningItem.key]?.message || 'đang tạo…'}
        </p>
      )}

      {open && (
        <div className="cp-menu-pop cp-dl-pop" role="menu">
          <a role="menuitem" className="cp-dl-item" href={artifactUrl(videoId)} download={fileName} onClick={() => setOpen(false)}>
            <Download size={15} />
            <span><strong>Video đã ghép</strong><small>Đúng như đang xem{status?.watermark_removed ? '' : ' (còn watermark gốc)'}.</small></span>
          </a>
          {unsupported && <p className="cp-note cp-dl-note">Backend đang chạy là bản cũ, chưa có bản tải phụ. Khởi động lại bằng npm start.</p>}
          {!unsupported && status && !status.fresh && sameVideo && <p className="cp-note cp-dl-note"><AlertTriangle size={12} /> {status.reason}</p>}
          {!unsupported && ITEMS.filter(i => !i.needsBgm || status?.has_bgm).map(i => {
            const v = status?.variants[i.key]
            const toolMissing = i.watermark && watermarkTool?.ok === false
            const blocked = !status || !sameVideo || !status.fresh || toolMissing
            const Icon = i.watermark ? Eraser : Music2
            if (v?.state === 'ready' && sameVideo) {
              return (
                <a key={i.key} role="menuitem" className="cp-dl-item" href={exportFileUrl(campaignId, i.key)} download onClick={() => setOpen(false)} data-testid={`dl-${i.key}`}>
                  <Icon size={15} />
                  <span><strong>{i.title}</strong><small>{i.hint}</small></span>
                  <span className="cp-dl-state is-ok"><Check size={12} /> Sẵn sàng</span>
                </a>
              )
            }
            return (
              <button key={i.key} type="button" role="menuitem" className="cp-dl-item" data-testid={`dl-${i.key}`}
                      disabled={blocked || v?.state === 'running'} onClick={() => void make(i.key)}
                      title={toolMissing ? watermarkTool?.message : undefined}>
                <Icon size={15} />
                <span>
                  <strong>{i.title}</strong>
                  <small>{v?.state === 'error' ? `Lỗi: ${v.error}` : toolMissing ? watermarkTool?.message : i.hint}</small>
                </span>
                <span className={`cp-dl-state ${v?.state === 'error' ? 'is-bad' : ''}`}>
                  {v?.state === 'running' ? <><Loader2 size={12} className="spinning" /> Đang tạo</>
                    : v?.state === 'error' ? <><RotateCw size={12} /> Thử lại</>
                      : i.watermark ? 'Tạo & tải · ~2 phút' : 'Tạo & tải · vài giây'}
                </span>
              </button>
            )
          })}
          <p className="cp-note cp-dl-note">Bản phụ dựng lại đúng video này, tạo một lần (0 credit), lần sau tải ngay.</p>
        </div>
      )}
    </div>
  )
}
