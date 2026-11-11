import { useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { suggestParams } from '../services/campaignApi.ts'
import { errorMessage } from '../services/campaignView.ts'
import type { CampaignState, SuggestResult } from '../types.ts'

interface Props {
  campaignId: string
  step: 'brief' | 'style'
  state: CampaignState
  onResult: (result: SuggestResult) => void
  onError: (message: string) => void
}

/** Nhờ Gemini xem ảnh áo (và hồ sơ áo nếu có) gợi ý giá trị cho form. Không lưu; form tự điền vào ô trống. */
export function SuggestButton({ campaignId, step, state, onResult, onError }: Props) {
  const [loading, setLoading] = useState(false)
  const garment = state.blocks.flatMap(b => b.steps).find(s => s.key === 'garment_source')?.elements[0]
  const noPhotos = !garment?.selected_artifact_id

  const click = async () => {
    setLoading(true)
    try { onResult(await suggestParams(campaignId, step)) } catch (e) { onError(errorMessage(e)) } finally { setLoading(false) }
  }

  return (
    <button type="button" className="btn-g cp-small" onClick={() => void click()} disabled={loading || noPhotos}
            title={noPhotos ? 'Cần tải ảnh áo ở khối 1 trước' : 'Gemini xem ảnh áo rồi điền vào các ô còn trống'}>
      {loading ? <Loader2 size={13} className="spinning" /> : <Sparkles size={13} />} Gợi ý bằng Gemini
    </button>
  )
}
