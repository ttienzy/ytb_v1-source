---
name: verify-change
description: Kiểm chứng một thay đổi trong CreatorFlow trước khi báo "xong" hoặc commit — chọn đúng lệnh test theo phần đã sửa, chạy e2e Electron trên môi trường tách riêng khi đổi giao diện, và báo cáo rõ phần nào chạy thật, phần nào giả lập. Dùng sau khi sửa code ở Frontend / Backend / Extension / Desktop. Không dùng cho câu hỏi chỉ đọc code hay sửa tài liệu thuần.
---

# Kiểm chứng thay đổi

"Typecheck qua" hay "đọc lại thấy đúng" chưa phải kiểm chứng. Chạy thật, rồi báo bằng kết quả lệnh.

## 1. Lệnh theo phần đã sửa

| Đã sửa | Lệnh (thư mục) |
|---|---|
| `Frontend/src`, `electron/` | `npm run typecheck` (chỉ fail khi có lỗi MỚI so với `typecheck-baseline.json`) · `npm run test:all` (Frontend) |
| Nhãn / nút / trang / luồng người dùng | thêm `npm run test:help` và cập nhật doc ở `src/features/help/data/<trang>Doc.ts` |
| `Backend/app/<khu>` | `.venv/Scripts/python -m pytest tests/<khu>` (Backend); watermark: thêm `python -m unittest tests.test_watermark_runtime` |
| `Extensions/FlowsVeo-Clean/src` | `npm run build && npm test && npm run test:minify` — người dùng phải **Reload** extension mới có hiệu lực; hành vi mới mà backend dựa vào thì báo qua `capabilities` của heartbeat |
| `Desktop/dev.js` | `npm test --prefix Desktop` |

Sửa xong mà sửa được bớt lỗi typecheck cũ: `npm run typecheck -- --update`. Không dùng `--update` để nuốt lỗi mới.

## 2. Đổi giao diện → chạy trên Electron thật (môi trường tách riêng)

```
npm run e2e:up            # backend :8010 + Vite :5199, dữ liệu riêng ở %TEMP%\creatorflow-e2e (Frontend)
node scripts/e2e/<kịch-bản>.e2e.mjs
npm run e2e:down          # luôn chạy, kể cả khi kịch bản lỗi
```

- Kịch bản mới viết theo mẫu `scripts/e2e/muse-cut.e2e.mjs`, dùng `scripts/e2e/harness.mjs` (`launchApp`, `canvas.*`, `report`, `mockJson`). Quy trình nào lặp lại từ 2 lần thì thêm helper vào harness, đừng chép tay.
- Trình duyệt Chromium thường KHÔNG thay được Electron (vd. `window.prompt` chạy trong Chromium nhưng hỏng trong Electron).
- Không thử trên app thật của người dùng (cổng 8000 / 60526, `Backend/Data`).

## 3. Flow / Muse / ChatGPT tốn tiền

- Mặc định giả lập bằng `page.route` + `mockJson`. Chỉ gửi lệnh thật khi người dùng đồng ý rõ ràng, nói trước số credit.
- Test với dịch vụ giả có thể xanh trong khi đường thật vẫn lỗi (đã xảy ra: backend gộp các biến thể giống nhau thành 1 job). Viết thêm test ở tầng HTTP/backend thật cho hợp đồng giữa các phần.
- Trước khi sửa `Backend/**/*.py` lúc app người dùng đang chạy: `dev.js` tự hoãn restart khi còn job Flow, nhưng job ghép / xóa watermark / cắt vẫn bị ngắt. Xem `GET /api/veo/jobs` và hỏi nếu đang có việc chạy.

## 4. Báo cáo

Kết thúc bằng:

- **Đã chạy:** từng lệnh + kết quả (vd. `npm run test:all` — 340/340).
- **Chạy thật trên app:** kịch bản e2e + số bước PASS; ảnh chụp ở `%TEMP%\creatorflow-e2e\*.png` nếu có.
- **Giả lập:** dịch vụ nào bị giả (Flow, Muse…) và vì sao.
- **Chưa kiểm chứng:** việc chưa chạy thật (vd. gửi lên Flow thật, bản đóng gói) — ghi "không có" nếu đủ.
