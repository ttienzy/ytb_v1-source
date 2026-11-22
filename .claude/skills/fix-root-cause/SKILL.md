---
name: fix-root-cause
description: Sửa lỗi trong CreatorFlow bằng cách tìm nguyên nhân gốc rồi chặn tái diễn bằng code (kiến trúc, test, typecheck, CI) thay vì thêm một dòng nhắc vào CLAUDE.md / memory. Dùng khi sửa bug, khi người dùng chỉ ra một lỗi lặp lại, hoặc khi định ghi thêm một "lưu ý" mới. Không dùng cho thay đổi tính năng thuần không có lỗi.
---

# Sửa tận gốc, chặn bằng code

## Thứ tự ưu tiên (cao → thấp)

1. **Thiết kế / API:** làm cho cách sai không viết ra được (vd. extension báo `capabilities` để backend chặn bản cũ; hằng số dùng chung thay vì số viết tay ở hai nơi).
2. **Test / typecheck / CI:** máy kiểm tra mỗi lần chạy, thông báo lỗi phải nói **cách sửa đúng**.
3. **Kiểm chứng chạy thật:** kịch bản e2e (`Frontend/scripts/e2e`).
4. **Chữ** (CLAUDE.md, memory, skill): chỉ khi việc cần phán đoán, không kiểm bằng máy được. Sửa / gộp dòng có sẵn trước khi thêm dòng mới.

## Quy trình

1. Tìm nguyên nhân gốc trước khi sửa (tái hiện bằng dữ liệu thật: job, log, file, số liệu).
2. Viết test **đỏ với hành vi cũ** (tạm đảo bản sửa để chứng minh), rồi sửa cho xanh.
3. Thêm guardrail ở tầng cao nhất có thể (bảng dưới).
4. **Nhổ cỏ:** grep cùng mẫu lỗi trên cả codebase và sửa luôn (vd. guardrail `window.prompt` tìm ra thêm 3 chỗ hỏng ở trang khác).
5. Báo cáo: **Nguyên nhân** (1–2 câu) · **Guardrail đã thêm** (file test / kiểm tra) · **Chỗ tương tự đã dọn**.

## Nơi đặt guardrail trong dự án

| Loại | Nơi |
|---|---|
| Quy tắc renderer (cấm API, node chưa đăng ký…) | `Frontend/src/shared/__tests__/guardrails.test.ts` |
| Lỗi kiểu TS | `npm run typecheck` (chặn lỗi mới so với `typecheck-baseline.json`) |
| Hai nơi phải khớp nhau (backend ↔ extension, dev.js ↔ backend) | test đọc nguồn bên kia và so (vd. `tests/video_http_motion.test.cjs`, `Desktop/dev.test.js`) |
| Test backend đụng dữ liệu thật | fixture tự động trong `Backend/tests/conftest.py` |
| Bản phát hành thiếu / sai | bước "Verify release resources" trong `.github/workflows/release.yml` |
| Phụ thuộc vá mã bên thứ ba | khóa đúng phiên bản + script báo lỗi khi sai phiên bản (vd. `watermark-runtime/patch-gwr.mjs`) |

## Không được

- `setTimeout` / `sleep` / `requestAnimationFrame` để che lỗi thời điểm; `try/catch` nuốt lỗi; cờ tạm để né.
- Comment biện minh cho cách vá tạm. Comment **được giữ**: bằng chứng giao thức bên ngoài (HAR, vị trí trường, giá credit đo được, lỗi của thư viện kèm link) và bất biến không hiển nhiên.
- Tự gửi lại lệnh tốn tiền (Flow / Muse) khi lỗi — phải khôi phục / theo dõi tiếp theo mã đã gửi.
