// Phần thuần (không React) của thẻ tài khoản Gemini — để node:test nạp được.
import type { GeminiState } from '../types.ts'

export const GEMINI_STATUS_MAP: Record<string, { color: string; label: string }> = {
  active: { color: '#10b981', label: 'Sẵn sàng' },
  exhausted: { color: '#f59e0b', label: 'Đang bị giới hạn tốc độ (tự thử lại sau ít phút)' },
  error: { color: '#ef4444', label: 'Hết phiên — làm mới hoặc đăng nhập lại' },
}

/** Chú thích nút “Cập nhật template Gemini”: đang dùng bản đóng gói hay bản bắt trên máy này. */
export function geminiTemplateTitle(state: Pick<GeminiState, 'template_source' | 'template_saved_at'>): string {
  if (state.template_source === 'captured') {
    const when = state.template_saved_at ? ` lúc ${new Date(state.template_saved_at).toLocaleString('vi-VN')}` : ''
    return `Template bắt trên máy này${when}. Bấm để bắt lại khi Gemini đổi giao thức.`
  }
  return 'Đang dùng template đóng gói theo app. Chỉ cần bấm khi gọi Gemini báo lỗi lạ dù cookie còn tốt (Gemini đổi giao thức).'
}
