/**
 * Quy tắc chọn chế độ Veo cho clip của Canvas AI (thuần TS, test được bằng node:test).
 *
 * - Omni 1.2 Flash (đi HTTP, nhanh): clip có ảnh tham chiếu -> Ingredients 3–15 giây, tối đa 3 ảnh. Clip nối tiếp dùng khung
 *   cuối của clip trước làm ảnh tham chiếu ĐẦU TIÊN (Omni 1.2 chưa có chế độ chỉ-khung-đầu: clip sau giống clip trước nhưng
 *   không bắt đầu đúng khung đó). Không có ảnh nào -> tạo từ chữ, chỉ 10 giây.
 * - Omni 1.1 đã bỏ (2026-11-11): workflow chỉ dùng Omni 1.2.
 */
import type { AssetRef } from '../contracts'

export const OMNI_12 = 'Omni 1.2 Flash'
export const MAX_REFERENCES = 3

export const isOmni12 = (model: string | null | undefined) => model === OMNI_12

export interface ProfileLike {
  model_display_name: string
  input_mode: string
  aspect_ratio: string
  resolution: string
  duration_seconds: number
  credit_cost?: number | null
  runtime_verified?: boolean
  note?: string | null
}

/** Chế độ quyết định thời lượng/giá hiển thị cho clip thường của workflow (clip có ảnh tham chiếu). */
export function listingMode(model: string): 'ingredients' | 'text_to_video' {
  return isOmni12(model) ? 'ingredients' : 'text_to_video'
}

export function durationOptionsFor(profiles: ProfileLike[], model: string, aspect: string, resolution: string): number[] {
  const mode = listingMode(model)
  return [...new Set(profiles
    .filter(p => p.model_display_name === model && p.input_mode === mode && p.aspect_ratio === aspect && p.resolution === resolution)
    .map(p => p.duration_seconds))].sort((a, b) => a - b)
}

/** Giá một clip theo profile. `verified` = giá đã đo thật (chế độ đã chạy thật VÀ ghi chú không nói "dự kiến");
 * ngược lại là giá dự kiến theo công thức Flow, giao diện phải ghi "khoảng". */
export function clipCredit(profiles: ProfileLike[], model: string, aspect: string, resolution: string, duration: number):
  { credit: number | null; verified: boolean } {
  const mode = listingMode(model)
  const p = profiles.find(x => x.model_display_name === model && x.input_mode === mode && x.aspect_ratio === aspect
    && x.resolution === resolution && x.duration_seconds === duration)
  return { credit: p?.credit_cost ?? null, verified: !!p?.runtime_verified && !/dự kiến/i.test(p?.note ?? '') }
}

/** Ảnh tham chiếu cho Omni 1.2 (tối đa 3, bỏ trùng). Mỗi loại một ảnh trước: khung cuối clip trước (nếu nối), ảnh sản phẩm
 * đầu tiên, người mẫu, bối cảnh; sau đó mới tới các ảnh sản phẩm còn lại. Nhờ vậy 3 ảnh sản phẩm không đẩy mất người mẫu,
 * và khi nối clip thì bối cảnh bị bỏ trước (khung cuối đã chứa sẵn nơi quay). */
export function pickReferencePaths(startFramePath: string | null | undefined, assets: AssetRef[]): string[] {
  const path = (a?: AssetRef) => a?.backendPath?.trim() || ''
  const products = assets.filter(a => a.kind === 'product')
  const first = [products[0], assets.find(a => a.kind === 'model'), assets.find(a => a.kind === 'scene')]
  const paths = [startFramePath?.trim() || '', ...first.map(path), ...products.slice(1).map(path)].filter(Boolean)
  return [...new Set(paths)].slice(0, MAX_REFERENCES)
}

/** Số ảnh đã nối vào node nhưng không gửi được vì Omni 1.2 chỉ nhận 3 ảnh (để báo cho người dùng). */
export function droppedReferenceCount(startFramePath: string | null | undefined, assets: AssetRef[]): number {
  const all = new Set([startFramePath?.trim() || '', ...assets.map(a => a.backendPath?.trim() || '')].filter(Boolean))
  return Math.max(0, all.size - pickReferencePaths(startFramePath, assets).length)
}
