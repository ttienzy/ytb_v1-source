import { useCallback, useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import './campaign.css'
import {
  createCampaign, deleteCampaign, getBackendMeta, listCampaigns, listFormats, runTarget, updateCampaign,
} from './services/campaignApi.ts'
import { backendMismatch, errorMessage, nothingToRunMessage } from './services/campaignView.ts'
import { RunNeedsConfirmation, type CampaignSummary, type FormatSummary, type Tier } from './types.ts'
import { useCampaign } from './hooks/useCampaign.ts'
import { BlockMap } from './components/BlockMap.tsx'
import { CampaignHeader } from './components/CampaignHeader.tsx'
import { CampaignRail } from './components/CampaignRail.tsx'
import { ErrorBanner, Fold, Lightbox, PanelBoundary } from './components/Common.tsx'
import { CastLibrary } from './components/CastLibrary.tsx'
import { CastSheetPanel } from './components/CastSheetPanel.tsx'
import { FactSheetPanel } from './components/FactSheetPanel.tsx'
import { ImageInputPanel } from './components/ImageInputPanel.tsx'
import { AssemblePanel } from './components/AssemblePanel.tsx'
import { ClipPanel } from './components/ClipPanel.tsx'
import { BriefPanel, FormatPanel } from './components/FormatPanel.tsx'
import { RunsPanel } from './components/RunsPanel.tsx'
import { SceneAnchorPanel } from './components/SceneAnchorPanel.tsx'
import { ScenesPanel } from './components/ScenesPanel.tsx'
import { ScriptPanel } from './components/ScriptPanel.tsx'
import { StepList } from './components/StepList.tsx'

const LAST_KEY = 'campaign:lastId'
const readLast = (): string | null => { try { return localStorage.getItem(LAST_KEY) } catch { return null } }
const writeLast = (id: string | null) => { try { id ? localStorage.setItem(LAST_KEY, id) : localStorage.removeItem(LAST_KEY) } catch { /* bỏ qua */ } }

const GARMENT_ROLES = [
  { value: 'front', label: 'Mặt trước' },
  { value: 'back', label: 'Mặt sau' },
  { value: 'detail', label: 'Chi tiết / logo' },
  { value: 'label', label: 'Nhãn / tag' },
]
const CAST_ROLES = [{ value: 'identity', label: 'Nhân dạng (mặt, tóc)' }]

export function CampaignPage() {
  const [campaigns, setCampaigns] = useState<CampaignSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(readLast)
  const [listError, setListError] = useState('')
  const [loadingList, setLoadingList] = useState(true)
  const [backendWarning, setBackendWarning] = useState<string | null>(null)
  const [formats, setFormats] = useState<FormatSummary[]>([])

  const checkBackend = useCallback(async () => { setBackendWarning(backendMismatch(await getBackendMeta())) }, [])
  useEffect(() => { void checkBackend() }, [checkBackend])
  useEffect(() => { listFormats().then(setFormats).catch(() => setFormats([])) }, [])

  const reloadList = useCallback(async () => {
    try {
      const list = await listCampaigns()
      setCampaigns(list)
      setSelectedId(cur => (cur && list.some(c => c.id === cur) ? cur : list[0]?.id ?? null))
      setListError('')
    } catch (e) { setListError(errorMessage(e)) } finally { setLoadingList(false) }
  }, [])
  useEffect(() => { void reloadList() }, [reloadList])
  useEffect(() => { writeLast(selectedId) }, [selectedId])

  const create = async (name: string): Promise<boolean> => {
    try {
      const c = await createCampaign(name)
      await reloadList()
      setSelectedId(c.id)
      return true
    } catch (e) { setListError(errorMessage(e)); return false }
  }

  return (
    <>
    {backendWarning && (
      <div className="cp-backend-warning" role="alert">
        <strong>Backend chưa cập nhật.</strong> {backendWarning}
        <button type="button" className="btn-g cp-small" onClick={() => void checkBackend()}>Kiểm tra lại</button>
      </div>
    )}
    <div className="cp-page">
      <CampaignRail campaigns={campaigns} selectedId={selectedId} loading={loadingList} error={listError} onClearError={() => setListError('')}
                    onSelect={setSelectedId} onCreate={create} />

      <div className="cp-main">
        {selectedId
          ? <Workspace key={selectedId} campaignId={selectedId} formats={formats} onDeleted={reloadList} onRenamed={reloadList} />
          : <section className="cp-card"><p className="cp-empty">Chọn hoặc tạo một chiến dịch để bắt đầu.</p></section>}
      </div>
    </div>
    </>
  )
}

function Workspace({ campaignId, formats, onDeleted, onRenamed }: { campaignId: string; formats: FormatSummary[]; onDeleted: () => Promise<void>; onRenamed: () => Promise<void> }) {
  const [tier, setTier] = useState<Tier>('draft')
  const { state, artifacts, runs, loading, error, setError, refresh } = useCampaign(campaignId, tier)
  const [activeBlock, setActiveBlock] = useState(1)
  const [busy, setBusy] = useState(false)
  const [lightbox, setLightbox] = useState<string | null>(null)

  const onRun = useCallback(async (target: string, elements?: string[], tierOverride?: Tier) => {
    const runTier = tierOverride ?? tier
    setBusy(true)
    setError('')
    try {
      let started
      try {
        started = await runTarget(campaignId, target, runTier, false, elements)
      } catch (e) {
        if (!(e instanceof RunNeedsConfirmation)) throw e
        if (e.kind === 'over_budget') throw new Error(`Vượt trần credit của chiến dịch (cần khoảng ${e.plan.estimated_credit ?? e.plan.total_credit}, đã dùng ${e.plan.spent_credit}, trần ${e.plan.credit_cap}).`)
        const ok = window.confirm(`Lần chạy này tốn khoảng ${e.plan.estimated_credit ?? e.plan.total_credit} credit Flow` +
          (e.plan.unknown_cost_items ? ` (trong đó ${e.plan.unknown_cost_items} việc chưa đo được giá, số này là dự kiến)` : '') + '. Tiếp tục?')
        if (!ok) return
        started = await runTarget(campaignId, target, runTier, true, elements)
      }
      if (!started.exec_id) setError(nothingToRunMessage(started.plan, target))
    } catch (e) { setError(errorMessage(e)) } finally {
      setBusy(false)
      await refresh()
    }
  }, [campaignId, refresh, setError, tier])

  const saveCap = async (value: number | null): Promise<boolean> => {
    try { await updateCampaign(campaignId, { credit_cap: value }); await refresh(); return true } catch (e) { setError(errorMessage(e)); return false }
  }
  const rename = async (name: string): Promise<boolean> => {
    try { await updateCampaign(campaignId, { name }); await refresh(); await onRenamed(); return true } catch (e) { setError(errorMessage(e)); return false }
  }
  const remove = async () => {
    if (!state?.campaign || !window.confirm(`Xóa chiến dịch “${state.campaign.name}” cùng toàn bộ ảnh và kết quả? Không hoàn tác được.`)) return
    try { await deleteCampaign(campaignId); await onDeleted() } catch (e) { setError(errorMessage(e)) }
  }

  if (loading && !state) return <p className="cp-note"><Loader2 size={14} className="spinning" /> Đang tải chiến dịch…</p>
  if (!state?.campaign) return <ErrorBanner message={error || 'Không tải được chiến dịch.'} onClose={() => setError('')} />

  const block = state.blocks.find(b => b.block === activeBlock) ?? state.blocks[0]
  const common = { campaignId, state, artifacts, onChanged: refresh, onError: setError, onPreview: setLightbox }
  const unknownRuns = runs.filter(r => r.state === 'unknown').length

  return (
    <>
      <CampaignHeader campaign={state.campaign} spent={state.spent_credit} onRename={rename} onSetCap={saveCap} onDelete={() => void remove()} />

      <ErrorBanner message={error} onClose={() => setError('')} />
      <BlockMap blocks={state.blocks} active={activeBlock} onSelect={setActiveBlock} />

      <div className="cp-panels">
        <PanelBoundary key={activeBlock} label={block?.title ?? `Khối ${activeBlock}`}>
        {activeBlock === 1 && (
          <div className="cp-split cp-split-sticky">
            <ImageInputPanel {...common} stepKey="garment_source" title="Ảnh sản phẩm" roles={GARMENT_ROLES} maxImages={4}
              hint="Ảnh áo thật: mặt trước (dùng cho cast sheet và khung chốt), chi tiết/logo (dùng cho shot cận), mặt sau, nhãn. Gemini xem tất cả." />
            <FactSheetPanel {...common} busy={busy} onRun={onRun} />
          </div>
        )}
        {activeBlock === 2 && (
          <>
            <div className="cp-split">
              <div className="cp-col">
                <ImageInputPanel {...common} stepKey="cast" title="Ảnh nhân vật" roles={CAST_ROLES} maxImages={1}
                  hint="Một ảnh rõ mặt và tóc, nền càng sạch càng tốt. Ảnh có chữ/phụ đề đóng cứng có thể lọt vào ảnh tạo ra." />
                <CastLibrary {...common} />
              </div>
              <CastSheetPanel {...common} busy={busy} onRun={onRun} />
            </div>
            <ScenesPanel {...common} formats={formats} busy={busy} onRun={onRun} />
          </>
        )}
        {activeBlock === 3 && (
          <>
            <div className="cp-split">
              <BriefPanel campaignId={campaignId} state={state} onChanged={refresh} onError={setError} />
              <FormatPanel campaignId={campaignId} state={state} formats={formats} busy={busy} onChanged={refresh} onError={setError} />
            </div>
            <ScriptPanel {...common} busy={busy} onRun={onRun} />
          </>
        )}
        {activeBlock === 4 && <SceneAnchorPanel {...common} busy={busy} onRun={onRun} />}
        {activeBlock === 5 && <ClipPanel {...common} busy={busy} onRun={onRun} tier={tier} onTier={setTier} />}
        {activeBlock === 6 && <AssemblePanel {...common} busy={busy} onRun={onRun} />}
        </PanelBoundary>
        <Fold className="cp-fold-card" key={`tech-${unknownRuns > 0}`} defaultOpen={unknownRuns > 0} testId="tech-details"
              title="Chi tiết kỹ thuật"
              meta={unknownRuns > 0 ? `${unknownRuns} lần chạy chưa rõ kết quả cần kiểm tra` : `các bước của khối “${block?.title ?? ''}” · sổ chạy (${runs.length})`}>
          {block && <StepList block={block} />}
          <RunsPanel runs={runs} onChanged={refresh} onError={setError} />
        </Fold>
      </div>
      <Lightbox src={lightbox} onClose={() => setLightbox(null)} />
    </>
  )
}

export default CampaignPage
