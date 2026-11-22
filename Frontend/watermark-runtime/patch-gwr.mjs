// Vá gwr (@pilio/gemini-watermark-remover) cho video Flow dọc và cỡ nhỏ — chạy tự động sau `npm install` / `npm ci` (postinstall).
//
// 1. fE: tỉ lệ logo tính theo khung 1920x1080 nằm ngang -> video dọc (rộng < cao) tính theo 1080x1920.
// 2. Thêm vị trí / cỡ logo đo được cho 360x640 (Flow 360p dọc) và 576x1024 (video mẫu Flow) vào danh sách ứng viên.
//
// Bản vá sửa thẳng vào mã ĐÃ NÉN của dist/video-app.js (tên hàm fE, Fu, Qu, lo…) nên chỉ đúng với ĐÚNG phiên bản dưới đây:
// package.json khóa cứng phiên bản này. Đổi phiên bản gwr thì phải kiểm tra lại bản vá (script sẽ báo lỗi, không lặng lẽ bỏ qua).
// Chạy nhiều lần không sao: đã vá thì bỏ qua. Bản gốc giữ ở video-app.js.backup.
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const EXPECTED_VERSION = '1.0.46'
const MARKER = 'veo-360x640-portrait-relocated-24'

const here = dirname(fileURLToPath(import.meta.url))
const pkgDir = join(here, 'node_modules', '@pilio', 'gemini-watermark-remover')
const jsPath = join(pkgDir, 'dist', 'video-app.js')

function fail(message) {
  console.error(`[patch-gwr] LỖI: ${message}`)
  process.exit(1)
}

if (!existsSync(jsPath)) fail(`không thấy ${jsPath} — chạy npm install trong Frontend/watermark-runtime trước.`)
const version = JSON.parse(readFileSync(join(pkgDir, 'package.json'), 'utf8')).version
if (version !== EXPECTED_VERSION) {
  fail(`gwr đang là ${version}, bản vá viết cho ${EXPECTED_VERSION} (sửa mã đã nén). Khóa lại phiên bản trong package.json hoặc viết lại bản vá.`)
}

let js = readFileSync(jsPath, 'utf8')
if (js.includes(MARKER)) {
  console.log('[patch-gwr] đã vá từ trước — bỏ qua.')
  process.exit(0)
}

const backup = `${jsPath}.backup`
if (!existsSync(backup)) copyFileSync(jsPath, backup)

// 1. fE: khung chuẩn theo chiều video
const oldFE = 'function fE(t,e){let A=Math.min(t/1920,e/1080),'
const newFE = 'function fE(t,e){let P=t<e,W=P?1080:1920,H=P?1920:1080,A=Math.min(t/W,e/H),'
if (!js.includes(oldFE)) fail('không thấy hàm fE cần vá trong video-app.js.')
js = js.replace(oldFE, newFE)

// 2. pE: thêm ứng viên cho 360x640 và 576x1024 ngay sau danh sách đặc biệt của 720x1280
const anchor = '720x1280 compact, 44px, margin 29/40'
const at = js.indexOf(anchor)
if (at < 0) fail(`không thấy mốc "${anchor}" trong video-app.js.`)
const end = js.indexOf(':[]}', at)
if (end < 0) fail('không thấy ":[]}" sau mốc 720x1280.')
const variant = (list) =>
  `[${list.map((x) => JSON.stringify(x)).join(',')}]` +
  '.map(A=>Fu(Qu(A,t,e,1,{"referenceSize":!1,"scaledFromReference":!1,"sourceCandidateId":null,' +
  '"sourceFamily":A.sourceFamily||"exact-size-exception","evidenceGate":"required","exactSizeVariant":!0}),t,e)).filter(lo)'
const c360 = [
  { id: 'veo-360x640-portrait-relocated-24', label: '360x640 portrait relocated, 24px, margin 48', size: 24, marginRight: 48, marginBottom: 48, sourcePriority: 0, sourceFamily: 'binary-prior' },
  { id: 'veo-360x640-portrait-24', label: '360x640 portrait, 24px, margin 36', size: 24, marginRight: 36, marginBottom: 36, sourcePriority: 1, sourceFamily: 'binary-prior' },
  { id: 'veo-360x640-animated-compact-16', label: '360x640 animated compact, 16px, margin 24', size: 16, marginRight: 24, marginBottom: 24, sourcePriority: 0 },
  { id: 'veo-360x640-vertical-inset', label: '360x640 vertical inset, 18px, margin 51/48', size: 18, marginRight: 51, marginBottom: 48, sourcePriority: 1 },
  { id: 'veo-360x640-compact-22', label: '360x640 compact, 22px, margin 15/20', size: 22, marginRight: 15, marginBottom: 20, sourcePriority: 3, sourceFamily: 'binary-prior' },
]
const c576 = [
  { id: 'veo-576x1024-portrait-relocated-38', label: '576x1024 portrait relocated, 38px, margin 77', size: 38, marginRight: 77, marginBottom: 77, sourcePriority: 0, sourceFamily: 'binary-prior' },
  { id: 'veo-576x1024-portrait-38', label: '576x1024 portrait, 38px, margin 58', size: 38, marginRight: 58, marginBottom: 58, sourcePriority: 1, sourceFamily: 'binary-prior' },
]
const insert = `:t===360&&e===640?${variant(c360)}:t===576&&e===1024?${variant(c576)}:[]}`
js = js.slice(0, end) + insert + js.slice(end + 4)

if (!js.includes(MARKER)) fail('vá xong nhưng không thấy dấu hiệu bản vá — không ghi file.')
writeFileSync(jsPath, js, 'utf8')
console.log('[patch-gwr] đã vá video-app.js: khung dọc + 360x640 + 576x1024.')
