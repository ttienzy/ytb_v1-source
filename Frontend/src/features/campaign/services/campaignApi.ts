/** Client cho /api/campaigns (Backend/app/campaign/router.py). */
import { API_URL } from '../../../shared/constants.ts'
import { toApiError } from '../../../shared/apiError.ts'
import { httpErrorMessage } from './campaignView.ts'
import {
  RunNeedsConfirmation,
  type ArtifactView,
  type CampaignState,
  type CampaignSummary,
  type CastItem,
  type ExportStatus,
  type ExportVariant,
  type Plan,
  type PromptPreview,
  type PromptTemplate,
  type RunResponse,
  type RunView,
  type SuggestResult,
  type Tier,
} from '../types.ts'

const BASE = `${API_URL}/api/campaigns`

async function request<T>(path: string, init: RequestInit | undefined, action: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${BASE}${path}`, init)
  } catch (error) {
    throw toApiError(error, action)
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    if (res.status === 409 && (body?.error === 'confirm_required' || body?.error === 'over_budget')) {
      throw new RunNeedsConfirmation(body.error, body.plan as Plan, body.detail || 'Cần xác nhận')
    }
    const detail = typeof body?.detail === 'string' ? body.detail : ''
    throw new Error(httpErrorMessage(res.status, detail, action))
  }
  return res.json() as Promise<T>
}

const json = (method: string, body?: unknown): RequestInit => ({
  method,
  headers: { 'Content-Type': 'application/json' },
  body: body === undefined ? undefined : JSON.stringify(body),
})

export const artifactUrl = (id: string) => `${BASE}/artifacts/${id}/file`

// ── chiến dịch ────────────────────────────────────────────────────────────────
export const listCampaigns = () =>
  request<{ campaigns: CampaignSummary[] }>('', undefined, 'tải danh sách chiến dịch').then(r => r.campaigns)

export const createCampaign = (name: string, creditCap: number | null = null) =>
  request<CampaignSummary>('', json('POST', { name, credit_cap: creditCap }), 'tạo chiến dịch')

export const updateCampaign = (id: string, fields: Partial<Pick<CampaignSummary, 'name' | 'credit_cap'>>) =>
  request<CampaignSummary>(`/${id}`, json('PATCH', fields), 'cập nhật chiến dịch')

export const deleteCampaign = (id: string) => request<{ ok: boolean }>(`/${id}`, { method: 'DELETE' }, 'xóa chiến dịch')

export const getState = (id: string, tier: Tier = 'draft') =>
  request<CampaignState>(`/${id}?tier=${tier}`, undefined, 'tải trạng thái chiến dịch')

// ── đầu vào / artifact ───────────────────────────────────────────────────────
export async function uploadImage(id: string, file: File): Promise<ArtifactView> {
  const form = new FormData()
  form.append('file', file)
  return request<ArtifactView>(`/${id}/artifacts/upload`, { method: 'POST', body: form }, 'tải ảnh lên')
}

export const setInputFiles = (id: string, step: string, files: { artifact_id: string; role: string }[]) =>
  request<ArtifactView>(`/${id}/steps/${step}/input`, json('POST', { files }), 'lưu ảnh đầu vào')

export const listArtifacts = (id: string) =>
  request<{ artifacts: ArtifactView[] }>(`/${id}/artifacts`, undefined, 'tải danh sách ảnh').then(r => r.artifacts)

export const setParams = (id: string, step: string, params: Record<string, unknown>, elementKey = '') =>
  request<{ params: Record<string, any> }>(`/${id}/steps/${step}/params`, json('PUT', { params, element_key: elementKey }), 'lưu tham số')

export const selectArtifact = (id: string, step: string, artifactId: string, elementKey = '') =>
  request<{ ok: boolean }>(`/${id}/steps/${step}/select`, json('POST', { artifact_id: artifactId, element_key: elementKey }), 'chọn ảnh')

export const reroll = (id: string, step: string, elementKey = '') =>
  request<{ nonce: number }>(`/${id}/steps/${step}/reroll`, json('POST', { element_key: elementKey }), 'đặt tạo lại')

export const setPin = (id: string, step: string, pinned: boolean, elementKey = '') =>
  request<{ ok: boolean }>(`/${id}/steps/${step}/${pinned ? 'pin' : 'unpin'}`, json('POST', { element_key: elementKey }), 'ghim')

// ── cổng duyệt ────────────────────────────────────────────────────────────────
export const decideGate = (id: string, step: string, decision: 'approve' | 'reject',
                           opts: { artifactId?: string; note?: string; elementKey?: string } = {}) =>
  request<{ state: string; artifact_id: string }>(
    `/${id}/gates/${step}/${decision}`,
    json('POST', { artifact_id: opts.artifactId ?? null, note: opts.note ?? '', element_key: opts.elementKey ?? '' }),
    decision === 'approve' ? 'duyệt' : 'từ chối',
  )

// ── kế hoạch / chạy ──────────────────────────────────────────────────────────
export const planRun = (id: string, target: string | null, tier: Tier = 'draft', elements?: string[]) =>
  request<Plan>(`/${id}/plan`, json('POST', { target, tier, elements: elements ?? null }), 'tính kế hoạch chạy')

export const runTarget = (id: string, target: string | null, tier: Tier = 'draft', confirmCredit = false, elements?: string[]) =>
  request<RunResponse>(`/${id}/run`, json('POST', { target, tier, confirm_credit: confirmCredit, elements: elements ?? null }), 'chạy')

export const cancelRun = (id: string) => request<{ cancelled: boolean }>(`/${id}/cancel`, json('POST'), 'hủy')

export const listRuns = (id: string) =>
  request<{ runs: RunView[]; active_exec: string | null }>(`/${id}/runs`, undefined, 'tải lịch sử chạy')

export const resolveRun = (runId: string) =>
  request<{ ok: boolean }>(`/runs/${runId}/resolve`, json('POST', { outcome: 'not_sent' }), 'xác nhận')

// ── prompt ────────────────────────────────────────────────────────────────────
export const listPrompts = (kind?: string) =>
  request<{ templates: PromptTemplate[] }>(`/prompts${kind ? `?kind=${encodeURIComponent(kind)}` : ''}`, undefined, 'tải mẫu prompt')
    .then(r => r.templates)

export const createPrompt = (body: { name: string; kind?: string; base_id?: string; body?: string }) =>
  request<PromptTemplate>('/prompts', json('POST', body), 'tạo mẫu prompt')

export const updatePrompt = (templateId: string, body: { name?: string; body?: string }) =>
  request<PromptTemplate>(`/prompts/${encodeURIComponent(templateId)}`, json('PUT', body), 'lưu mẫu prompt')

export const deletePrompt = (templateId: string) =>
  request<{ ok: boolean }>(`/prompts/${encodeURIComponent(templateId)}`, { method: 'DELETE' }, 'xóa mẫu prompt')

export const previewStepPrompt = <T = PromptPreview>(id: string, step: string, elementKey = '', tier: Tier = 'draft') =>
  request<T>(`/${id}/steps/${step}/prompt-preview`, json('POST', { element_key: elementKey, tier }), 'xem trước prompt')

// ── hồ sơ áo / sửa tay ───────────────────────────────────────────────────────
export const editArtifact = (id: string, step: string, content: unknown, elementKey = '') =>
  request<ArtifactView>(`/${id}/steps/${step}/artifact`, json('PUT', { content, element_key: elementKey }), 'lưu chỉnh sửa')

export async function fetchArtifactJson<T>(artifactId: string): Promise<T> {
  let res: Response
  try {
    res = await fetch(artifactUrl(artifactId))
  } catch (error) {
    throw toApiError(error, 'đọc kết quả')
  }
  if (!res.ok) throw new Error(`Không đọc được kết quả (HTTP ${res.status})`)
  return res.json() as Promise<T>
}

// ── thư viện nhân vật ────────────────────────────────────────────────────────
export const castFileUrl = (libraryId: string) => `${BASE}/cast-library/${libraryId}/file`

export const listCast = () =>
  request<{ items: CastItem[] }>('/cast-library', undefined, 'tải thư viện nhân vật').then(r => r.items)

export const addCast = (campaignId: string, artifactId: string, name: string) =>
  request<CastItem>('/cast-library', json('POST', { campaign_id: campaignId, artifact_id: artifactId, name }), 'lưu vào thư viện')

export const deleteCast = (libraryId: string) =>
  request<{ ok: boolean }>(`/cast-library/${libraryId}`, { method: 'DELETE' }, 'xóa khỏi thư viện')

export const useCast = (campaignId: string, libraryId: string) =>
  request<ArtifactView>(`/${campaignId}/cast/use-library`, json('POST', { library_id: libraryId }), 'dùng nhân vật')

// ── gợi ý điền form bằng Gemini ───────────────────────────────────────────────
export const suggestParams = (id: string, step: 'brief' | 'style') =>
  request<SuggestResult>(`/${id}/steps/${step}/suggest`, json('POST'), 'nhờ Gemini gợi ý')

// ── kiểm tra backend ──────────────────────────────────────────────────────────
/** null nếu backend không có /meta (bản rất cũ) hoặc không gọi được. */
export async function getBackendMeta(): Promise<{ executors: string[]; gated_steps: string[] } | null> {
  try {
    const res = await fetch(`${BASE}/meta`)
    return res.ok ? await res.json() : null
  } catch {
    return null
  }
}

// ── bản tải phụ của video đã ghép (xóa watermark / không nhạc nền) ─────────────
export const getExports = (id: string) => request<ExportStatus>(`/${id}/exports`, undefined, 'xem các bản tải')
export const startExport = (id: string, variant: ExportVariant) =>
  request<ExportStatus>(`/${id}/exports/${variant}`, json('POST'), 'tạo bản tải')
export const exportFileUrl = (id: string, variant: ExportVariant) => `${BASE}/${id}/exports/${variant}/file`
