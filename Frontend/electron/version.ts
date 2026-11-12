/** So sánh phiên bản dạng semver "2.1.0" / "v2.1.0" / "2.1.0-beta.1". Hàm thuần, không import Electron nên test được bằng node:test. */
interface Parsed {
  nums: number[]
  pre: string
}

function parse(version: string): Parsed | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/.exec((version || '').trim())
  if (!m) return null
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' }
}

/** Dương nếu a > b, âm nếu a < b, 0 nếu bằng nhau. Chuỗi không hợp lệ trả NaN. Bản có hậu tố (-beta) nhỏ hơn bản chính thức. */
export function compareVersions(a: string, b: string): number {
  const pa = parse(a)
  const pb = parse(b)
  if (!pa || !pb) return Number.NaN
  for (let i = 0; i < 3; i++) {
    if (pa.nums[i] !== pb.nums[i]) return pa.nums[i] - pb.nums[i]
  }
  if (pa.pre === pb.pre) return 0
  if (!pa.pre) return 1
  if (!pb.pre) return -1
  return pa.pre < pb.pre ? -1 : 1
}

/** Chỉ true khi `latest` thật sự MỚI HƠN `current` (không báo "có bản mới" khi bản trên GitHub cũ hơn hoặc không đọc được). */
export function isNewerVersion(latest: string, current: string): boolean {
  const c = compareVersions(latest, current)
  return Number.isFinite(c) && c > 0
}
