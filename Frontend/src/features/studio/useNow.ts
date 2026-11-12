import { useEffect, useState } from 'react'

/**
 * Trả về `Date.now()` và tự cập nhật mỗi `intervalMs` khi `active`.
 *
 * Đồng hồ hiển thị chạy theo nhịp riêng này, KHÔNG phụ thuộc nhịp poll job (1.5s): khi poll chậm/bị trễ
 * (cửa sổ Chrome bật lên làm Electron bị throttle, backend bận…) số giây vẫn nhảy đều thay vì đứng im.
 */
export function useNow(active: boolean, intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(id)
  }, [active, intervalMs])
  return now
}
