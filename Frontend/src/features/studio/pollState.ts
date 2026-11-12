// Quyết định thuần cho vòng poll job (không import React/DOM → test được bằng node:test).

/** Số lần poll liên tiếp không có phản hồi (≈ 1.5s/lần) thì coi là mất kết nối backend. */
export const OFFLINE_AFTER_FAILS = 4

export const JOB_LOST_MSG =
  'Backend đã khởi động lại và không còn dữ liệu của job này (chưa kịp lưu kịch bản). Bấm "Bắt đầu lại" để chạy lại.'

/** Backend trả 404 = job không còn trong bộ nhớ và cũng không dựng lại được từ đĩa → dừng poll, báo rõ. */
export function isJobLost(httpStatus: number): boolean {
  return httpStatus === 404
}

/** Poll liên tục thất bại (mạng/backend tắt) → hiện cảnh báo mất kết nối, nhưng vẫn thử lại. */
export function isOffline(consecutiveFails: number): boolean {
  return consecutiveFails >= OFFLINE_AFTER_FAILS
}
