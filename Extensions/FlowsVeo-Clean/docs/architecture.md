# Kiến trúc và quy tắc mở rộng

## Ranh giới module

| Thư mục | Trách nhiệm |
| --- | --- |
| `src/background/index.js` | Đăng ký listener đồng bộ theo thứ tự cũ, sau đó khởi động polling |
| `src/background/runtime` | State duy nhất trong worker, polling, watchdog, heartbeat, bảo trì |
| `src/background/jobs/dispatch.js` | Điều phối action và bảo toàn cơ chế chờ/chạy nền |
| `src/bridge/client.js` | Giao diện request bridge, cấu hình port và auth headers |
| `src/bridge/legacy-http.js` | Ghép URL localhost, chuyển nguyên options sang fetch |
| `src/bridge/config.js`, `responses.js` | Handshake/config và serialize response đúng wire format |
| `src/contracts/bridge.js` | Endpoint, định danh giao thức và mô tả envelope |
| `src/providers/google-flow` | Tab, tài khoản, CAPTCHA, generation, upload, project, voice |
| `src/providers/google-flow/page` | Hàm chạy trong MAIN world, không import runtime worker |
| `src/platform` | Chrome storage và đăng ký các sự kiện/message của Chrome |
| `src/popup`, `src/content` | Giao diện và content script, giữ logic ban đầu |
| `public` | Template manifest/HTML/icons |

Module không có side effect đăng ký listener khi import. `background/index.js` là nơi duy nhất gọi các hàm đăng ký rồi `startPolling()`. Dependency graph có test cấm vòng import và dependency runtime ra ngoài package. `recaptcha-probe.js` nằm dưới cả tab management và CAPTCHA solving để tránh vòng import.

`runtime/state.js` giữ một object cho toàn bộ worker. Không destructure giá trị mutable ra biến dài hạn vì sẽ tạo state cũ. Không nhân bản bộ đếm, khóa refresh hoặc state kết nối theo module. Storage vẫn giữ nguyên tên `_vf_*` và hành vi khôi phục; đặc biệt giá trị cache seconds khi chưa lưu vẫn theo hành vi cũ.

## Tính đồng thời phải giữ

- Polling chính và watchdog đều có thể nhận job theo cơ chế hiện tại.
- Video trả CAPTCHA response trước, rồi chạy generation nền; kết quả giữ `request_id` riêng.
- Image chờ generation và trả image response; upload/project có endpoint và envelope riêng.
- `activeGenerationCount` và các `finally` phải tiếp tục bảo vệ auto reload/cache cho luồng đang được bảo vệ hiện tại.
- Không thêm retry POST, auto retry job hoặc hàng đợi chung vào transport: có thể tạo tác vụ tính phí trùng hoặc làm tuần tự hóa video.
- Chưa có định tuyến nhiều ứng dụng đồng thời. Tái sử dụng ở nhiều project không đồng nghĩa một extension chia sẻ hàng đợi giữa nhiều BE đang chạy cùng lúc.

## Hàm chạy trong trang

Chrome serialize function rồi chạy trong context khác. Không tham chiếu import, state worker hoặc helper bị bundler đưa ra ngoài function. Helper cần cho page phải nằm trong function hoặc được truyền bằng dữ liệu serializable. Không tải code từ bridge.

Build giữ property names, không bật minifySyntax/keepNames hay transpile xuống runtime cũ cần helper bên ngoài. Bộ test nạp các page function sau bundle, serialize bằng `toString()` rồi chạy lại trong context độc lập; browser test chạy chính `dist/release`.

## Mở rộng

Thêm chức năng vào provider/job tương ứng; cập nhật tài liệu wire format và contract test nếu có dữ liệu mới. Giao thức mới phải có adapter riêng và cơ chế tương thích được kiểm thử, không thay endpoint hiện tại âm thầm. Config version hiện tại không phải protocol version. Không thêm validation chặt hơn vào legacy adapter nếu chưa kiểm tra dữ liệu các client cũ.

Một provider mới phải có code đóng gói cục bộ; config chỉ là dữ liệu, không phải JavaScript/lệnh để eval. Chỉ tách abstraction khi có hành vi chung thật, không thêm framework hoặc service container cho một provider.

## Vấn đề có sẵn, giữ riêng khỏi refactor

- Hai nhánh fallback thiếu ảnh đầu vào trong `page/video.js` gọi `logActivity` không tồn tại trong MAIN world. Đây là tham chiếu có sẵn trong source 1.0.9; chưa đổi sang logger mới để tránh gộp sửa hành vi. Các nhánh có reference hợp lệ được test. Test kiến trúc ghi rõ ngoại lệ này, không cho phép thêm capture khác.
- Cấp `/bridge/secret` không xác thực, CORS rộng, lưu token/cookie và log prefix credential vẫn theo cơ chế cũ. Refactor không phải bản nâng cấp bảo mật. Pairing và HMAC phải thiết kế đồng bộ với BE trong một đợt riêng.
- Bộ đếm hiện không mở rộng sang các loại job vốn không được đếm. Thay scheduler/locking phải là thay đổi riêng với regression test.
