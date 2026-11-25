import { useCallback, useEffect, useState } from 'react'
import { Download, Loader2, Layers, Sparkles, Check } from 'lucide-react'
import { getHookVariants, hookVariantFileUrl, renderHookVariants, suggestHookVariants } from '../services/campaignApi.ts'
import { errorMessage } from '../services/campaignView.ts'
import type { AudioMode, EndingMode, HookVariantItem, HookVariantsStatus } from '../types.ts'

interface Props {
  campaignId: string
  videoId: string
  hasVideo: boolean
  isFresh: boolean
  defaultAudioMode: AudioMode
  defaultEndingMode: EndingMode
  defaultCtaText: string
  onError: (message: string) => void
  onPreviewVideo?: (url: string) => void
}

const DEFAULT_ANGLES: HookVariantItem[] = [
  { id: 'hook_1', angle: 'Nỗi đau dáng người', opening_text: 'M55 mặc sao cho tôn dáng?', cta_text: 'Bấm giỏ cam xem đủ size', ending_mode: 'cta_overlay' },
  { id: 'hook_2', angle: 'Chất vải & Form thật', opening_text: 'Zoom cận chất vải & logo thật', cta_text: 'Xem chi tiết tại giỏ hàng', ending_mode: 'cta_overlay' },
  { id: 'hook_3', angle: 'Neo giá trị / Phối đồ', opening_text: '1 set mặc gọn 3 dịp mỗi tuần', cta_text: 'Chốt ngay trước khi hết size', ending_mode: 'cta_overlay' },
]

/** Xưởng biến thể Hook 0 credit: 1 bộ clip Flow -> đẻ 3-5 bản mở màn & CTA khác nhau để test GMV Max. */
export function HookMultiplierPanel({
  campaignId,
  videoId,
  hasVideo,
  isFresh,
  defaultAudioMode,
  defaultEndingMode,
  defaultCtaText,
  onError,
  onPreviewVideo,
}: Props) {
  const [variants, setVariants] = useState<HookVariantItem[]>(() =>
    DEFAULT_ANGLES.map((v) => ({ ...v, audio_mode: defaultAudioMode, ending_mode: defaultEndingMode, cta_text: defaultCtaText || v.cta_text })),
  )
  const [status, setStatus] = useState<HookVariantsStatus | null>(null)
  const [suggesting, setSuggesting] = useState(false)
  const [rendering, setRendering] = useState(false)
  const [cleanWm, setCleanWm] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const st = await getHookVariants(campaignId)
      setStatus(st)
      if (st.variants.length > 0 && st.artifact_id === videoId) {
        setVariants(st.variants)
      }
    } catch {
      /* backend chưa có route hoặc chưa có video */
    }
  }, [campaignId, videoId])

  useEffect(() => {
    if (hasVideo) void loadStatus()
  }, [hasVideo, loadStatus])

  const activeRunning = status?.state === 'running'
  useEffect(() => {
    if (!activeRunning) return
    const timer = setInterval(() => { void loadStatus() }, 1500)
    return () => clearInterval(timer)
  }, [activeRunning, loadStatus])

  const handleSuggest = async () => {
    setSuggesting(true)
    try {
      const res = await suggestHookVariants(campaignId)
      if (res.variants.length > 0) {
        setVariants(res.variants.map((v) => ({
          ...v,
          audio_mode: (v.audio_mode || defaultAudioMode) as AudioMode,
          ending_mode: (v.ending_mode || defaultEndingMode) as EndingMode,
        })))
      }
    } catch (e) {
      onError(errorMessage(e))
    } finally {
      setSuggesting(false)
    }
  }

  const handleRender = async () => {
    setRendering(true)
    try {
      const next = await renderHookVariants(campaignId, variants, cleanWm)
      setStatus(next)
    } catch (e) {
      onError(errorMessage(e))
    } finally {
      setRendering(false)
    }
  }

  const updateItem = (idx: number, patch: Partial<HookVariantItem>) => {
    setVariants((list) => list.map((it, i) => (i === idx ? { ...it, ...patch } : it)))
  }

  const statusMap = new Map((status?.variants ?? []).map((v) => [v.id, v]))

  return (
    <div className="cp-group cp-hook-lab" data-testid="hook-multiplier-panel">
      <div className="cp-row">
        <h4 className="cp-group-title"><Layers size={14} /> Hook Multiplier · Nhân bản biến thể test GMV Max <span className="cp-tag">0 credit</span></h4>
        <div className="cp-row cp-push">
          <button
            type="button"
            className="btn-g cp-small"
            data-testid="suggest-hook-variants"
            disabled={suggesting || activeRunning || !hasVideo}
            onClick={() => void handleSuggest()}
          >
            {suggesting ? <Loader2 size={13} className="spinning" /> : <Sparkles size={13} />} Gợi ý 3 Hook bán hàng
          </button>
          <button
            type="button"
            className="btn-p cp-small"
            data-testid="render-hook-variants"
            disabled={rendering || activeRunning || !hasVideo || !isFresh || variants.length === 0}
            onClick={() => void handleRender()}
          >
            {activeRunning || rendering ? <Loader2 size={13} className="spinning" /> : <Layers size={13} />} Tạo {variants.length} biến thể (0 credit)
          </button>
        </div>
      </div>
      <p className="cp-note">
        Giữ nguyên các clip Flow đã duyệt (không tốn thêm credit), chỉ thay câu hook mở màn 0–1,2s, thẻ CTA và chế độ âm thanh để tạo bộ video A/B test.
      </p>
      <label className="cp-switch">
        <input type="checkbox" checked={cleanWm} disabled={activeRunning} onChange={(e) => setCleanWm(e.target.checked)} />
        Tự động xóa watermark Flow trên các biến thể (lâu hơn, 0 credit)
      </label>

      {status?.state === 'running' && (
        <p className="cp-running-note" data-testid="hook-render-progress">
          <Loader2 size={13} className="spinning" /> {status.message || 'Đang dựng các biến thể…'}
        </p>
      )}
      {status?.state === 'error' && status.error && (
        <p className="cp-error-inline">Tạo biến thể lỗi: {status.error}</p>
      )}

      <div className="cp-hook-grid">
        {variants.map((v, i) => {
          const st = statusMap.get(v.id)
          const ready = st?.state === 'ready' && status?.artifact_id === videoId
          const fileUrl = hookVariantFileUrl(campaignId, v.id)
          return (
            <div key={v.id} className="cp-hook-card" data-testid={`hook-card-${v.id}`}>
              <div className="cp-row">
                <strong>#{i + 1} · {v.angle}</strong>
                {ready && <span className="cp-badge cp-tone-ok"><Check size={11} /> Sẵn sàng</span>}
              </div>
              <label className="cp-field">
                <span>Hook mở màn (0–1,2s)</span>
                <input
                  className="cp-input"
                  value={v.opening_text}
                  disabled={activeRunning}
                  onChange={(e) => updateItem(i, { opening_text: e.target.value })}
                />
              </label>
              <label className="cp-field">
                <span>CTA cuối video</span>
                <input
                  className="cp-input"
                  value={v.cta_text}
                  disabled={activeRunning}
                  onChange={(e) => updateItem(i, { cta_text: e.target.value })}
                />
              </label>
              <label className="cp-field">
                <span>Âm thanh biến thể</span>
                <select
                  value={v.audio_mode || defaultAudioMode}
                  disabled={activeRunning}
                  onChange={(e) => updateItem(i, { audio_mode: e.target.value as AudioMode })}
                >
                  <option value="voice_bgm">Giọng đọc + Nhạc</option>
                  <option value="music_only">Chỉ nhạc nền (Lookbook)</option>
                  <option value="silent">Tắt tiếng (Gắn Sound TikTok)</option>
                </select>
              </label>
              {ready && (
                <div className="cp-row">
                  <a className="btn-g cp-small" href={fileUrl} download data-testid={`dl-hook-${v.id}`}>
                    <Download size={12} /> Tải #{i + 1}
                  </a>
                  {onPreviewVideo && (
                    <button type="button" className="btn-g cp-small" onClick={() => onPreviewVideo(fileUrl)}>
                      Xem thử
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
