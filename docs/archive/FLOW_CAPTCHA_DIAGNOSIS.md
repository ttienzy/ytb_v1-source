# Chẩn đoán Flow: Captcha config not loaded

> **ĐÃ LƯU TRỮ (2026-11-12), chỉ để tham khảo lịch sử.** Chẩn đoán ngày 2026-09-05 với extension 1.0.2; "Flow adapter chưa triển khai" nay đã có. Hiện hành: [PLAN_flow_http_submit.md](../PLAN_flow_http_submit.md) và [Extensions/FlowsVeo-Clean/docs/](../../Extensions/FlowsVeo-Clean/docs/). Đường dẫn file và số dòng trong tài liệu phản ánh thời điểm viết.


Ngày kiểm tra: 2026-09-05. Đây là kết quả kiểm tra checkout sau khi người dùng bổ sung luồng Flow, thay cho các nhận xét về code chưa tồn tại trong audit trước.

## Cập nhật: đã test trực tiếp Chrome với extension 1.0.2

**Kết quả mới nhất:** job `add67f72-6a0` đã nhận token từ extension đang chạy trong Chrome, qua bước CAPTCHA rồi dừng tại placeholder **Flow adapter chưa triển khai**. Bộ đếm Bridge tăng lên 1, `last_captcha_at = 2026-09-05T09:34:34.250865+00:00` (16:34:34 giờ Việt Nam). Chưa có request tạo video, chưa có MP4 và chưa kiểm chứng Google chấp nhận token cho generation.

Chuỗi kiểm tra runtime:

| Lần thử | Bằng chứng | Kết quả |
|---|---|---|
| `e94cdf33-8c8` | Gọi `/api/veo/jobs` qua Backend thật, extension 1.0.1 | `Module not ready`. |
| Console trang chủ `/u/1/` | `window.grecaptcha` không tồn tại, không có script reCAPTCHA | Đăng nhập/đọc credits được không có nghĩa module đã nạp. |
| Console của trang | Lỗi `TrustedScriptURL` assignment bị chặn | Cách extension gán `script.src` để chèn `enterprise.js` bị chặn; code cũ nuốt lỗi. |
| Mở project có sẵn được ghi trong HAR | `grecaptcha.enterprise.execute` là function; script website có `render` | Website tự nạp module trên project. Không tạo project mới. |
| `7dd4b08c-5a3` | Extension 1.0.1 với project đã mở | Qua lỗi module, dừng `No site key found`; cách dò registry cũ không tìm thấy key. |
| `add67f72-6a0` | Reload extension 1.0.2, Backend/Bridge thật, 1 tài khoản kết nối | CAPTCHA thành công; dừng tại adapter placeholder. |

Sửa bổ sung trong [background.js](../../Extensions/FlowsVeo-Clean/background.js):

- Ưu tiên tab project trong các tab Flow/Labs, ưu tiên project đang active.
- Bỏ chèn script. Probe trong MAIN world chờ module do website nạp tối đa 8 giây; ở trang chủ thiếu module, báo rõ cần mở project.
- Đọc site key từ tham số `render` của script reCAPTCHA hiện có đúng host/path; bỏ qua `render=explicit`. Có fallback `data-sitekey` và registry cũ.
- Dùng cùng probe cho trạng thái popup và job; log tab/module/key source, không log giá trị key/token.
- Giới hạn chờ callback `ready` và `execute`; lỗi vẫn được trả về, không đổi trạng thái Ready thành kết luận generation thành công.
- Version extension **1.0.2**. Đã bấm Reload đúng card extension trong `chrome://extensions` và xác nhận version qua heartbeat Backend.
- Bỏ log tiền tố token trong [service.py](../../Backend/app/veo/service.py).

Kiểm tra mới: 11 Node tests (config + reCAPTCHA), 3 Python Bridge tests và JS syntax đều đạt. Test tự động không gọi Google; kết quả job nêu trên là kiểm tra riêng với Chrome thật. Backend đã dừng giữa phiên kiểm tra; đã khởi động lại bằng `Backend/.venv/Scripts/python.exe run_server.py` chạy ẩn, API 8000, Bridge 56526, và để chạy phục vụ người dùng.

**Trạng thái sử dụng hiện tại:** giữ tab project Flow mở và dùng extension 1.0.2. Số credits/Bridge Online không thay thế việc kiểm tra module/site key. Muốn sinh MP4 cần triển khai adapter; không cần tiếp tục sửa CAPTCHA dựa trên thông báo job cũ.

Các mục bên dưới lưu kết quả của đợt chẩn đoán 1.0.1 trước đó.

## Nguyên nhân đã tái hiện

Extension `syncRemoteConfig()` gọi `/api/v1/config/init` bằng GET vì không chỉ định method. Bridge ban đầu chỉ có route này trong `do_POST()`. GET rơi vào fallback HTTP 200 với `{status, service}`; response không chứa `payload`, extension không nạp được remote config.

Kiểm tra trực tiếp Bridge đang chạy:

| Địa chỉ | Request | Trước sửa |
|---|---|---|
| `127.0.0.1:56526` | GET `/api/v1/config/init` | HTTP 200, chỉ có `status/service`, không config |
| `127.0.0.1:56526` | POST cùng endpoint, có bridge key | HTTP 200, có `payload/v` và cấu hình `c` |

Không in bridge key, cookie hoặc token trong quá trình kiểm tra.

`Captcha config not loaded` được tạo tại đầu `solveRecaptcha()`, trước khi tìm tab và trước `grecaptcha.enterprise.execute()`. Do đó thông báo này không phải lỗi từ Google đánh giá CAPTCHA.

**Điểm cần phân biệt:** file extension hiện trên ổ đĩa đã có `DEFAULT_HARVEST_CFG.c` và `ensureHarvestCfg()` bổ sung `c` nếu thiếu. Với bản đó, thiếu response config không đủ để tái tạo đúng chuỗi lỗi này. Extension đang chạy bản cũ/bản ở thư mục khác hoặc UI đang hiển thị lỗi job cũ là các khả năng cần kiểm tra, chưa được xác nhận trực tiếp trong Chrome. Lỗi GET/POST là lỗi contract đã chứng minh độc lập.

## Những gì HAR xác nhận

File thực tế tìm thấy là `flow.google.com.har` tại gốc repo, không phải `flow/.google.com.har`.

- 25 entries: 21 tới `flow.google.com`, 2 tới `www.google.com`, 2 tới `play.google.com`.
- Phiên Flow dùng đường dẫn `/u/1/_/AiSandboxAngularFrontend/data/batchexecute`; request dạng form có `f.req` và `at`. Đây không phải endpoint Labs NextAuth/tRPC trong cấu hình cũ.
- Entry 2: POST `/recaptcha/enterprise/reload`, HTTP 200. HTTP 200 tự nó chưa chứng minh token được chấp nhận trong lần chạy tự động.
- Entry 3: RPC `YhhmEf`; field `[0][0][1]` của JSON argument bên trong `f.req` có giá trị `abra_t2v_6s`. Đây là giá trị quan sát được, chưa có bằng chứng ánh xạ sang tên model trong dropdown.
- Các RPC `jwpduf` xuất hiện lặp lại; entry 21 (`as29s`) trả dữ liệu chứa URL tại `flow-content.google` có tham số chữ ký. Không ghi URL có chữ ký vào báo cáo.
- HAR không chứa request tải file từ `flow-content.google`; chưa xác nhận file MP4 tải về/phát được từ HAR này.
- Không thấy request Bridge trong HAR. HAR của tab Flow không chứng minh trạng thái service worker extension.

**Hệ quả:** cấu hình session `labs.google/fx/api/auth/session` chưa được HAR này chứng minh phù hợp với Flow hiện tại. Cần kiểm chứng riêng auth, account index, model mapping và dispatch của adapter; không chỉ thay domain hoặc dùng lại token đã ghi trong HAR.

## Sửa đổi đã thực hiện

- [background.js](../../Extensions/FlowsVeo-Clean/background.js): gửi POST khi lấy config; kiểm tra HTTP status, envelope và CAPTCHA module trước khi nhận config. Response health HTTP 200 không còn bị bỏ qua im lặng. Config lỗi không ghi đè config đang dùng.
- Hàm kiểm tra CAPTCHA readiness khởi tạo fallback config trước khi đọc trạng thái.
- [bridge.py](../../Backend/app/veo/bridge.py): dùng chung handler config có xác thực cho POST và GET tương thích client cũ; endpoint không tồn tại trả 404 thay vì health giả.
- [manifest.json](../../Extensions/FlowsVeo-Clean/manifest.json): version `1.0.1` để phân biệt extension đã reload.

## Kiểm chứng

- `python -m unittest Backend.tests.test_veo_bridge -v`: 3 tests đạt, dùng server loopback cổng ngẫu nhiên, không tác động Bridge đang chạy.
- `node --test Extensions/FlowsVeo-Clean/tests/config.test.cjs`: 4 tests đạt.
- `node --check Extensions/FlowsVeo-Clean/background.js`: đạt.
- Chạy chính hàm config mới trong Node với Bridge thật cổng 56526: `configLoaded=true`, module `grecaptcha`, namespace `enterprise`, `fallback=false`. Đây là kiểm tra handshake, không phải E2E trong Chrome.
- Chưa restart Backend đang chạy, chưa điều khiển Chrome để reload extension, chưa gọi tạo video.

## Cách kiểm tra tiếp trên Chrome

1. Trong `chrome://extensions`, Reload đúng extension unpacked từ `Extensions/FlowsVeo-Clean`; xác nhận version **1.0.1**. Nếu có nhiều bản, kiểm tra đúng bản đang kết nối Bridge.
2. Refresh tab Flow để content script của bản mới được nạp. Khởi động lại Backend để áp dụng handler Bridge đã sửa; cổng thực tế cần xem trong status, không mặc định luôn là 60526.
3. Mở popup kiểm tra trạng thái/log: phải có `Remote config loaded v1.0`, Core là OK. Nếu chưa có, xem lỗi HTTP/payload mới được ghi rõ.
4. Kiểm tra lại ở lần chạy mới; lỗi trong job đã lưu không tự biến mất sau Reload. Nếu CAPTCHA vẫn lỗi, ghi đúng thông báo mới để phân biệt config, tab, module readiness, site key hoặc bước execute.

## Phần tạo video còn thiếu trong checkout

[service.py](../../Backend/app/veo/service.py), `_process_job()`, vẫn có placeholder sau CAPTCHA và trả lỗi **Flow adapter chưa triển khai**. Chưa có dispatch/poll/download thực tế tại bước này. Vì vậy sửa config không có nghĩa luồng tạo MP4 đã hoàn tất; đây là điểm dừng tiếp theo cần triển khai dựa trên HAR và kiểm chứng riêng.
