# FlowsVeo Clean

Extension Google Flow độc lập, Manifest V3. Giao thức localhost hiện tại được giữ nguyên để dùng với project đang chạy. Project khác chỉ cần triển khai cùng [giao thức bridge](docs/bridge-protocol.md); không cần import Backend của repository này.

## Phát triển

Yêu cầu Node.js >= 22 và npm. Chạy lệnh trong thư mục này:

```powershell
npm ci
npm run build
npm test
npm run test:minify
```

Sửa `src/` và `public/`. Các file `background.js`, `content.js`, `popup.js`, `popup.html`, `manifest.json`, `icons/` ở thư mục gốc là runtime tương thích được build/copy từ source. Không sửa trực tiếp file generated. `npm run build` cập nhật chúng để đường dẫn **Load unpacked hiện tại vẫn hoạt động**, đồng thời tạo `dist/dev/`.

Không tự reload extension đang chạy job. Chờ tác vụ kết thúc trước khi reload. Không bật đồng thời bản cũ và bản mới trên cùng bridge.

## Build release và kiểm thử trình duyệt

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = Join-Path (Get-Location) '.local\browsers'
npx playwright install chromium --no-shell
npm run verify
```

`verify` build development, chạy bộ test ở hai chế độ thường/minify, build release, chạy Chromium headless với bridge và trang Flow giả lập, rồi tạo ZIP. Browser test dùng profile riêng trong `.local/`, proxy không chuyển tiếp ra ngoài, không dùng tài khoản/cookie thật và không gọi Google thật.

Đầu ra:

- `dist/release/`: bản minify có thể Load unpacked để kiểm tra.
- `release/FlowsVeo-Clean-v1.0.10.zip` và `.sha256`: gói runtime và checksum.
- `test-results/browser-smoke.json`: kết quả kiểm thử Chromium.
- `dist/*-build.json`: hash từng file runtime; không nằm trong ZIP.

Nếu chỉ cần build và đóng gói (không thay cho verification): `npm run build:release` rồi `npm run package`. Package dùng danh sách file runtime, kiểm tra hash bản build và đọc lại ZIP; không đóng gói toàn bộ thư mục dự án.

Có thể sao chép package này sang project/repository khác, bỏ `node_modules`, `.local`, `dist`, `release`, `test-results`, rồi chạy `npm ci && npm run build`. Build và test không phụ thuộc thư mục cha, Backend hoặc Frontend.

## Phạm vi bảo toàn

Đợt refactor giữ endpoint/header/payload, khóa storage `_vf_*`, timeout/retry, chọn tab/project, model mapping, recovery và cách phối hợp polling/watchdog. Video tiếp tục chạy nền; image/upload/project giữ cách chờ hiện tại. Không có migration database hay thay đổi BE/FE.

Version tăng từ 1.0.9 lên 1.0.10. Query API key không dùng trong URL credits mặc định được loại bỏ: luồng cũ vốn đã gọi `hcfg.cu.split('?')[0]` trước khi fetch. Request tới credits không đổi.

Minify không giữ bí mật logic trên máy người dùng. Pairing/HMAC, thay đổi cấp bridge secret, chỉnh permission và xử lý logging credential là đợt bảo mật riêng; chưa triển khai trong refactor này. Bản build chưa tự được publish lên Store.

Xem [kiến trúc](docs/architecture.md), [kiểm chứng](docs/verification.md) và [phát hành/quay lui](docs/release-checklist.md).
