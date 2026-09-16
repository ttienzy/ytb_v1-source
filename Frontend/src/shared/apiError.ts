import { API_URL } from './constants.ts'

/** Convert browser/network failures into an actionable message for the UI. */
export function toApiError(error: unknown, action = 'thao tác'): Error {
  if (error instanceof TypeError && /fetch/i.test(error.message)) {
    return new Error(
      `Không kết nối được Backend tại ${API_URL} khi ${action}. ` +
      'Hãy kiểm tra Backend đã khởi động và thử lại.',
    )
  }
  if (error instanceof Error && error.message) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error(`Không thể hoàn tất ${action}. Vui lòng thử lại.`)
}
