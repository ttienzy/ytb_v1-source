# Kiểm chứng refactor 1.0.10

Mốc ban đầu: 32 test extension và 5 test bridge Python pass trước khi tách module.

Kiểm tra bảo toàn bằng phân tích cú pháp so sánh 59 hàm top-level với snapshot: sau khi chuẩn hóa truy cập state (`runtime.x`) và chuyển tiếp URL bridge, cây cú pháp thân hàm khớp. Popup/content source byte-identical với bản cũ. Manifest chỉ đổi version/format. Báo cáo local: `.local/semantic-comparison.json`.

Bộ 49 test hiện tại kiểm tra cả phiên bản module thường và minify:

- Toàn bộ assertion cũ về config, CAPTCHA, model mapping, reference frames/ingredients/video, upload dedup và create project được giữ.
- Header/payload/envelope legacy, fallback port, storage/fingerprint, heartbeat/credentials và re-handshake khi 403.
- Video non-blocking; kết quả về khác thứ tự đúng request; lỗi giải phóng counter; image chờ kết quả; reload/cache được bảo vệ.
- Watchdog nhận job khác trong khi video của vòng polling vẫn đang chạy.
- Mất kết quả executeScript chuyển sang recovery scene, không gửi lại generation; recovery riêng không tạo CAPTCHA job mới.
- Không có import cycle hoặc runtime dependency ra ngoài package; page function không capture worker state/imports (ngoại lệ cũ được ghi ở architecture.md).

Chromium test chạy **artifact release thật** trên profile riêng với trang Flow/bridge giả, kiểm tra popup/content, MAIN-world injection, video/ảnh/upload, tạo/chuyển project và cold start. Proxy không forward bất kỳ kết nối nào ra mạng thật hoặc bridge thật. Báo cáo có browser version và kết quả từng nhóm ở `test-results/browser-smoke.json`.

`npm run test:standalone` sao chép riêng source/package sang thư mục thử nghiệm, cài dependency từ lockfile bằng cache offline rồi build. Hash toàn bộ runtime phải trùng bản build trong project. Lệnh này cần npm cache từ lần cài dependency; nếu cache đã dọn, dùng quy trình `npm ci` thông thường trong một bản sao package thay thế.

Giới hạn: chưa chạy generation/credits trên tài khoản Google thật, chưa đo tải dài hạn, chưa kiểm thử bản đã cài từ Store. Không dùng kết quả fixture để khẳng định thay đổi phía Google hoặc quy trình duyệt Store. Không sửa BE/FE hay triển khai pairing/HMAC trong bản này.
