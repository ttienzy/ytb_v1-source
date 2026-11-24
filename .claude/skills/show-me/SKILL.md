---
name: show-me
description: Trình bày cấu trúc, luồng dữ liệu, trạng thái hoặc lựa chọn bằng hình nhỏ gọn nhất (cây, sơ đồ tuần tự, state chart, bảng đánh đổi, phác thảo giao diện) thay vì đoạn văn dài. Dùng khi giải thích một luồng nhiều bước / nhiều tiến trình, đề xuất thiết kế, so sánh phương án, hoặc khi người dùng nói "vẽ", "cho xem", "sơ đồ", "luồng chạy thế nào". Không dùng cho câu trả lời chỉ có một ý.
---

# Cho xem thay vì kể

## Chọn hình theo câu hỏi

| Câu hỏi | Hình |
|---|---|
| Có những gì, nằm ở đâu | Cây (thư mục, thành phần, node) |
| Dữ liệu đi qua đâu (UI → Backend → extension → Flow) | Sơ đồ tuần tự; mỗi mũi tên ghi endpoint / giao thức |
| Một thứ có những trạng thái nào, chuyển khi nào | State chart: trạng thái + sự kiện chuyển, có cả trạng thái lỗi / huỷ |
| Chọn A hay B | Bảng đánh đổi: hàng = phương án, cột = tiêu chí, có dòng đề xuất |
| Giao diện sẽ trông ra sao | Phác thảo ASCII |

## Quy tắc

- Mỗi hộp / mũi tên mang tên thật trong code (component, endpoint, hàm). Dưới hình ghi `file:dòng` cho những mục quan trọng.
- Tách **hiện có** và **đề xuất**: phần mới đánh dấu `[MỚI]`.
- Luồng nào cũng phải có đường lỗi: hết phiên tài khoản, timeout, người dùng huỷ, backend restart giữa chừng.
- Cỡ hình: ≤ 25 dòng và ≤ 9 hộp. Lớn hơn thì tách thành một hình tổng quan và một hình phóng to.
- Định dạng: trong chat (VSCode / terminal) dùng ASCII trong khối ``` vì Mermaid có thể không hiển thị; trong `docs/*.md` dùng Mermaid. Hình lớn hoặc cần gửi người khác thì làm trang Artifact (nạp skill `artifact-diagramming`).
- Sau hình chỉ thêm tối đa 3 dòng chữ, cho những điều hình không nói được.

## Ví dụ: sơ đồ tuần tự, hiện có + đề xuất

```
Người dùng   GptClipScriptNode     Backend :8000                    ChatGPT web
    │ bấm "Viết"   │                    │                                │
    │─────────────>│ POST /api/workflow/muse/gpt-script                  │
    │              │───────────────────>│ write_script (1 lượt)          │
    │              │                    │───────────────────────────────>│
    │              │                    │<──────── chữ / GptImageError ──│
    │              │<── 200 {text} | 502 ┘                               │
    │              │ ghi node.data → saveMuseProjectGraph                │
    │ [MỚI] sửa chữ ngay trong node, bấm "Viết lại đoạn này" → cùng endpoint, 1 lượt
Lỗi: 502 → node hiện câu lỗi của backend, KHÔNG tự gửi lại.
```

## Không được

- Vẽ hộp mang tên chung chung ("Service", "AI") không tìm thấy trong code.
- Vẽ chỉ đường thành công.
- Viết lại bằng chữ dài những gì hình đã thể hiện.
