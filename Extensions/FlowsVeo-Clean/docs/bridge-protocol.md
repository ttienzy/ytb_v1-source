# Bridge protocol hiện tại

Định danh tài liệu: `flowsveo-legacy-http/1`. Không gửi trường/version/header mới cho BE. `config.v` là phiên bản cấu hình; manifest version là phiên bản extension.

Transport: HTTP loopback `http://127.0.0.1:<port>`. Port mặc định 60526, fallback 56526/46526/36526; có thể chỉnh port trong popup. Các project khác triển khai cùng giao thức không cần import `Backend/app/veo/bridge.py`.

## Kết nối

1. `GET /bridge/secret` trả `{ "secret": "..." }`.
2. `POST /api/v1/config/init`, header `X-Bridge-Key`, trả `{ "payload": "<base64 JSON>", "v": "..." }`.
3. Config chứa `t` (tab patterns/default URL), `h` (credential endpoints/fields), `c` (CAPTCHA module). `c.m` và `c.s` phải là chuỗi không rỗng; lỗi config giữ config đang hoạt động hoặc fallback theo logic cũ.
4. Poll `GET /captcha/request`: 204 khi rỗng, 200 với job, 403 để extension lấy lại secret và config. Không dùng response health thay config.

Base64 không phải mã hóa. Test bridge là fixture, không phải mẫu triển khai xác thực cho production.

## Endpoint

| Method | Path | Vai trò |
| --- | --- | --- |
| GET | `/bridge/secret` | Handshake legacy |
| POST | `/api/v1/config/init` | Config; BE hiện tại còn hỗ trợ GET cho client cũ |
| GET | `/captcha/request` | Nhận job |
| POST | `/captcha/response` | Token/error CAPTCHA |
| POST | `/flow/response` | Kết quả video hoặc recovery |
| POST | `/flow/image-response` | Kết quả ảnh |
| POST | `/flow/video-upload-response` | Kết quả upload |
| POST | `/flow/project-created` | Kết quả tạo project |
| POST | `/flow/project-switched` | Kết quả chuyển project |
| POST | `/credentials/push` | Danh sách tài khoản/cookie/token/credits |
| POST | `/ext/heartbeat` | Instance, version, tab list, user agent |
| POST | `/voice/cookies` | Cookie voice và email |
| POST | `/captcha/busy` | Trạng thái refresh |
| GET | `/refresh/pending` | `{ "requests": [...] }` |
| GET | `/captcha/health` | Health bridge |
| GET | `/token` | `{ "access_token": "..." }` |

Giữ nguyên header của từng caller. Phần lớn POST dùng `Content-Type: application/json`, `X-Bridge-Key`, `X-Ext-FP`. Config chỉ gửi key; một số call voice/health có header khác. Adapter không tự thêm header, không đổi method và không tự retry. Request timeout giữ tại từng flow.

## Job và response

Mỗi job có `request_id`, phải được echo đúng; không gắn kết quả theo thứ tự nhận. Các action đặc biệt: `CREATE_PROJECT`, `SWITCH_PROJECT`, `IMAGE_GENERATION`, `RELOAD_TAB`, `UPLOAD_VIDEO`. `flow_recovery` đi nhánh recovery. Các action còn lại giữ vai trò CAPTCHA action; `flow_request` kèm theo sẽ dispatch video sau khi có token. `reload: true` ở polling chính là hành vi reload legacy.

Video/recovery trả `{ request_id, result, error }`; thành công `result.ok=true`, thất bại `result=null`. Image thêm `logs`. Upload trả phẳng `{ request_id, ok, media_id, project_id, error, logs }`. Create trả `{ request_id, ok, flow_project_id, account_email, error }`. Switch trả `{ request_id, ok, flow_project_id, tab_id, error }`. Không chuẩn hóa tất cả về một envelope vì BE hiện tại đọc khác nhau.

Credentials: `{ ext_fp, credentials: [{ email, cookie, access_token, expiry, tier, credit, tab_id, incognito, user_agent, sec_ch_ua, sec_ch_ua_platform, sec_ch_ua_mobile }] }`. Dữ liệu thật chỉ được dùng khi người dùng kết nối project của họ; fixtures dùng giá trị giả.

Tham khảo `src/bridge/responses.js` cho serialization chính xác và `tests/contract/bridge.test.cjs` cho contract kiểm chứng. `tests/helpers/standalone-bridge.mjs` là consumer độc lập phục vụ test; nó không phụ thuộc BE và không chuyển tiếp ra Internet.

## Message trong Chrome

Giữ nguyên message popup/content: `GET_STATS`, `GET_ACCOUNTS`, `CHECK_STATUS`, `TEST_CAPTCHA`, `HARVEST_NOW`, `FORCE_PUSH`, `OPEN_LABS`, `REFRESH_TAB`, `CLEAR_CACHE_NOW`, `SET_AUTO_RELOAD`, `SET_AUTO_CLEAR_CACHE`, `SET_BRIDGE_PORT`, `GET_BRIDGE_PORT`, `GET_COOKIE_VOICE`, `SYNC_COOKIE_VOICE`, `GET_ACTIVITY_LOG`, `CREDITS_UPDATED`; content còn nhận `PROBE_CREDITS`. Port keep-alive vẫn là `veoflow-keepalive`, message `PING`.

## Bảo mật giao thức mới (chưa triển khai)

Pairing phải giải quyết cách trao khóa trước khi thêm HMAC. HMAC cần bao phủ method/path/body và nonce/thời hạn; bên nhận phải kiểm tra chống replay. Khóa không hard-code trong ZIP. Không tự downgrade một kết nối đã ghép nối an toàn về legacy. Đây là thay đổi phối hợp với bridge, không gộp vào bản refactor 1.0.10.
