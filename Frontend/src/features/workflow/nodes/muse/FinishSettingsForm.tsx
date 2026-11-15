/**
 * Biểu mẫu "Hoàn thiện" dùng cho node Ghép video: tiếng gốc, nhạc nền (Thư viện nhạc, nghe thử), nhãn kênh, logo kênh.
 * Cùng giao diện / cùng kiểu dữ liệu (MuseFinishSettings) với phần "Hoàn thiện video" của node Video kết quả.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { ImagePlus, Loader2, Music, Tag, Volume2, VolumeX, X } from 'lucide-react'
import { MUSE_CORNERS, type MuseFinishSettings } from '../../services/museCanvasNodes.ts'
import { channelLogoUrl, fetchBgmTracks, uploadChannelLogo, type BgmTrackLite } from '../../services/museCanvasApi.ts'
import { BgmPicker } from './BgmPicker'

const pct = (v: number) => `${Math.round(v * 100)}%`

export function FinishSettingsForm({
  settings,
  onChange,
  onTracksLoaded,
}: {
  settings: MuseFinishSettings
  onChange: (patch: Partial<MuseFinishSettings>) => void
  /** Cho node biết tên bài nhạc (để tóm tắt) */
  onTracksLoaded?: (tracks: BgmTrackLite[]) => void
}) {
  const [tracks, setTracks] = useState<BgmTrackLite[] | null>(null)
  const [tracksError, setTracksError] = useState('')
  const [logoBusy, setLogoBusy] = useState(false)
  const [logoError, setLogoError] = useState('')
  const logoInput = useRef<HTMLInputElement>(null)

  const loadTracks = useCallback(() => {
    setTracksError('')
    fetchBgmTracks()
      .then((t) => {
        setTracks(t)
        onTracksLoaded?.(t)
      })
      .catch((e) => {
        setTracks([])
        setTracksError(e?.message || 'Không tải được Thư viện nhạc')
      })
  }, [onTracksLoaded])
  useEffect(() => {
    if (tracks === null) loadTracks()
  }, [loadTracks, tracks])

  async function onLogoPicked(file: File | undefined) {
    if (!file) return
    setLogoBusy(true)
    setLogoError('')
    try {
      onChange({ logoId: await uploadChannelLogo(file) })
    } catch (e: any) {
      setLogoError(e?.message || 'Không tải được logo')
    } finally {
      setLogoBusy(false)
      if (logoInput.current) logoInput.current.value = ''
    }
  }

  const bgmId = settings.bgmTrackIds[0] ?? ''

  return (
    <div className="mc-finish nodrag">
      <div className="mc-finish-row">
        <span className="mc-finish-label">{settings.muteOriginal ? <VolumeX size={12} /> : <Volume2 size={12} />} Tiếng gốc</span>
        <label className="mc-check">
          <input type="checkbox" checked={settings.muteOriginal} onChange={(e) => onChange({ muteOriginal: e.target.checked })} />
          Tắt tiếng gốc
        </label>
      </div>
      {!settings.muteOriginal && (
        <div className="mc-finish-row">
          <span className="mc-finish-sub">Âm lượng gốc</span>
          <input type="range" className="mc-range nodrag" min={0} max={1.5} step={0.05} value={settings.originalVolume} onChange={(e) => onChange({ originalVolume: Number(e.target.value) })} />
          <span className="mc-finish-val">{pct(settings.originalVolume)}</span>
        </div>
      )}

      <div className="mc-finish-row mc-finish-top">
        <span className="mc-finish-label"><Music size={12} /> Nhạc nền</span>
        <BgmPicker tracks={tracks} error={tracksError} selectedId={bgmId} onSelect={(tid) => onChange({ bgmTrackIds: tid ? [tid] : [] })} onReload={loadTracks} />
      </div>
      {bgmId && (
        <div className="mc-finish-row">
          <span className="mc-finish-sub">Âm lượng nhạc</span>
          <input type="range" className="mc-range nodrag" min={0} max={1.5} step={0.05} value={settings.bgmVolume} onChange={(e) => onChange({ bgmVolume: Number(e.target.value) })} />
          <span className="mc-finish-val">{pct(settings.bgmVolume)}</span>
        </div>
      )}

      <div className="mc-finish-row">
        <span className="mc-finish-label"><Tag size={12} /> Nhãn kênh</span>
        <input className="mc-input mc-finish-text" value={settings.labelText} maxLength={60} placeholder="vd. @tenkenh" onChange={(e) => onChange({ labelText: e.target.value })} />
      </div>
      {settings.labelText.trim() && (
        <div className="mc-finish-row">
          <span className="mc-finish-sub">Vị trí / cỡ</span>
          <select className="mc-input mc-finish-select" value={settings.labelPosition} onChange={(e) => onChange({ labelPosition: e.target.value as MuseFinishSettings['labelPosition'] })}>
            {MUSE_CORNERS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <div className="mc-seg mc-seg-sm">
            {(['s', 'm', 'l'] as const).map((z) => (
              <button key={z} type="button" className={settings.labelSize === z ? 'on' : ''} onClick={() => onChange({ labelSize: z })}>
                {z === 's' ? 'Nhỏ' : z === 'm' ? 'Vừa' : 'Lớn'}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mc-finish-row">
        <span className="mc-finish-label"><ImagePlus size={12} /> Logo kênh</span>
        {settings.logoId ? (
          <span className="mc-logo-chip">
            <img src={channelLogoUrl(settings.logoId)} alt="Logo kênh" draggable={false} />
            <button type="button" className="mc-mini-btn" onClick={() => onChange({ logoId: '' })} title="Bỏ logo">
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
      {logoError && <div className="mc-node-error">{logoError}</div>}
      {settings.logoId && (
        <div className="mc-finish-row">
          <span className="mc-finish-sub">Vị trí / cỡ</span>
          <select className="mc-input mc-finish-select" value={settings.logoPosition} onChange={(e) => onChange({ logoPosition: e.target.value as MuseFinishSettings['logoPosition'] })}>
            {MUSE_CORNERS.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          <input type="range" className="mc-range nodrag" min={0.05} max={0.5} step={0.01} value={settings.logoSize} onChange={(e) => onChange({ logoSize: Number(e.target.value) })} />
          <span className="mc-finish-val">{pct(settings.logoSize)}</span>
        </div>
      )}
    </div>
  )
}
