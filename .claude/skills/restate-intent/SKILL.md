---
name: restate-intent
description: Nhắc lại yêu cầu bằng lời của chính mình (mục tiêu, phạm vi, loại trừ, giả định, câu hỏi mở) và chờ người dùng xác nhận TRƯỚC khi phân tích sâu hay sửa code. Dùng khi người dùng "brain dump" một ý tưởng dài, mô tả tính năng mới / đổi luồng lớn, yêu cầu hiểu được theo nhiều cách, hoặc khi chính mình định làm khác lời người dùng nói. Không dùng cho việc nhỏ đã rõ (sửa một lỗi có log, đổi một nhãn, câu hỏi chỉ đọc code).
---

# Nhắc lại ý định trước khi làm

Hiểu sai ý tốn hơn mọi lỗi code. Sửa ở bước này chỉ mất một câu trả lời của người dùng.

## Khi nào dùng

- Một tin nhắn nhiều ý, chưa sắp xếp ("brain dump").
- Tính năng hoặc luồng mới, đổi kiến trúc, đụng nhiều phần (Frontend + Backend + Extension).
- Có từ cần chốt nghĩa: "tích hợp", "tự động", "giống X", "gọn hơn", "trong Canvas".
- Việc tốn tiền (Flow / Muse / ChatGPT) hoặc khó hoàn tác.

## Cách làm

1. Đọc vừa đủ để nhắc lại có căn cứ: tìm tên trang / node / nút thật trong code (Glob, Grep), không đoán. **Chưa** bàn giải pháp.
2. Trả lời theo khuôn sau, tổng cộng ≤ 15 dòng:

   - **Mình hiểu là:** 1–2 câu bằng lời của mình, không chép lời người dùng.
   - **Mục tiêu:** kết quả người dùng nhìn thấy / bấm được khi xong.
   - **Trong phạm vi:** những gì sẽ làm.
   - **Ngoài phạm vi:** những gì sẽ KHÔNG làm, gồm cả việc người dùng không nhắc nhưng mình dễ làm lố.
   - **Giả định:** mỗi dòng kèm căn cứ (`file:dòng`) hoặc ghi "chưa kiểm".
   - **Câu hỏi mở:** tối đa 3, mỗi câu có sẵn phương án đề xuất để người dùng chỉ cần trả lời "ừ".

3. Dừng và chờ xác nhận. Trong lượt này không viết code, không chạy lệnh tốn tiền.
4. Người dùng sửa thì cập nhật đúng phần bị sửa, rồi mới sang `feature-map` / `assess-idea` / code.

## Không được

- Nhắc lại bằng cách chép nguyên văn hoặc liệt kê lại từng câu của người dùng: như vậy không chứng minh đã hiểu.
- Hỏi điều tự tra được trong code hoặc `docs/`.
- Hỏi quá 3 câu, hoặc hỏi mà không kèm phương án đề xuất.
- Lặng lẽ mở rộng phạm vi ("tiện thể refactor…") mà không đưa vào mục "Trong phạm vi".
