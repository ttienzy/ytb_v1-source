/**
 * Lỗi phân tích sản phẩm (Gemini web / ChatGPT web).
 *
 * Backend trả 401 CHỈ khi lỗi đăng nhập/cookie Gemini (chưa đăng nhập, cookie hết hạn và tự làm mới thất bại). Node chỉ
 * gợi ý "Làm mới Cookie" cho đúng loại này: trước 2026-11-24 node gợi ý cho MỌI lỗi, nên lỗi không liên quan cookie
 * (vd. máy cài mới thiếu template Gemini) khiến người dùng làm mới cookie mãi mà không hết.
 */
export class AnalysisError extends Error {
  readonly needsLogin: boolean

  constructor(message: string, needsLogin: boolean) {
    super(message)
    this.name = 'AnalysisError'
    this.needsLogin = needsLogin
  }
}

export function analysisErrorFromResponse(status: number, detail: unknown, provider: string): AnalysisError {
  const message = typeof detail === 'string' && detail.trim() ? detail : `Lỗi phân tích ${provider} (HTTP ${status})`
  return new AnalysisError(message, status === 401)
}

/** Lỗi này có nên gợi ý đăng nhập / làm mới cookie Gemini không. */
export function analysisNeedsLogin(error: unknown): boolean {
  return error instanceof AnalysisError ? error.needsLogin : false
}
