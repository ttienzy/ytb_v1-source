---
name: assess-idea
description: Đánh giá một ý tưởng hoặc đề xuất thiết kế bằng bằng chứng — giá trị đo được, rủi ro kỹ thuật & UX gắn với code thật, chi phí, phương án rẻ hơn, và điều kiện "xong" kiểm được bằng lệnh — rồi đưa MỘT đề xuất để người dùng chốt trước khi làm. Dùng khi người dùng hỏi "ý tưởng này thế nào", "nên làm A hay B", "có rủi ro gì", hoặc trước một thay đổi lớn / tốn tiền / khó hoàn tác. Không dùng để review diff (dùng code-review) hay kiểm chứng thay đổi đã làm xong (dùng verify-change).
---

# Đánh giá ý tưởng bằng bằng chứng

Mỗi nhận định mang một nhãn: `[code]` (kèm `file:dòng`), `[log]`, `[đo]`, hoặc `[giả thuyết]`. Nhận định không có nhãn thì bỏ.

## Cách làm

0. **Điều kiện vào:** đã có bản nhắc lại ý định (`restate-intent`) được người dùng xác nhận, và bản đồ (`feature-map`) cho khu bị đụng. Thiếu thì làm trước.
1. **Giá trị:** ai được gì, đo bằng gì (số thao tác bớt đi, số lần chuyển tab / mở trình duyệt, thời gian, credit tiết kiệm). Không viết "tăng trải nghiệm".
2. **Rủi ro:** lập bảng `Rủi ro | Bằng chứng | Khả năng / Ảnh hưởng | Cách kiểm hoặc chặn`. Chỉ giữ rủi ro gắn với khu này. Rủi ro hay gặp trong dự án:

   | Nhóm | Câu hỏi phải trả lời |
   |---|---|
   | Chi phí | Có gọi Flow / Muse / ChatGPT không? Mỗi lần tốn bao nhiêu? Lỗi giữa chừng thì khôi phục thế nào (không được tự gửi lại)? |
   | Phiên tài khoản | ChatGPT web, cookie Gemini, tài khoản Muse hết phiên thì giao diện báo gì? |
   | Canvas | Phím / chuột trong ô nhập có lọt ra ReactFlow không (Backspace xoá node, bôi chữ thành kéo node)? Có cần `nodrag` / `nowheel` không? |
   | Ngữ cảnh dài | Kịch bản / lịch sử chat dài thì cắt ở đâu, ai quyết định cắt? |
   | Dữ liệu | Tải lại trang, backend restart, hai tab cùng ghi một project → mất hay ghi đè? |
   | Job đang chạy | Sửa `.py` có làm restart backend giữa job ghép / watermark / cắt không? |
   | Hai phía phải khớp | Backend ↔ extension (báo qua `capabilities`), dev.js ↔ backend |
   | Đồng bộ phụ | Help doc + `verifiedAt`, guardrails, typecheck baseline, `docs/` hiện hành |

3. **Phương án thay thế:** ít nhất một cách rẻ hơn, kể cả "mở rộng node đang có" và "không làm". So sánh bằng bảng đánh đổi (`show-me`).
4. **Điều kiện xong:** mỗi dòng là một kiểm tra chạy được: file test sẽ viết, kịch bản `scripts/e2e/*.e2e.mjs`, lệnh cụ thể (theo `verify-change`). Ghi rõ phần nào giả lập bằng `mockJson`, phần nào cần chạy thật tốn credit (nói trước số credit).
5. **Đề xuất:** một câu chốt, kèm **bước đầu nhỏ nhất** kiểm chứng giả định rủi ro nhất (spike / thử một lượt). Dừng, chờ người dùng chốt.

## Khuôn trả lời

```
Đề xuất: <một câu>
Giá trị: … [đo]/[giả thuyết]
Rủi ro:  bảng ≤ 6 dòng
Thay thế: bảng đánh đổi ≤ 3 phương án
Xong khi: danh sách kiểm tra chạy được
Bước đầu: <spike nhỏ nhất> — chờ bạn chốt
```

## Không được

- Liệt kê rủi ro chung chung ("bảo mật", "hiệu năng") không gắn vào `file:dòng` hay luồng cụ thể.
- Đưa nhiều phương án mà không chọn.
- Bắt tay viết code hoặc gửi lệnh tốn tiền trước khi người dùng chốt.
