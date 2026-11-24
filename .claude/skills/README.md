# Skills của dự án

## Dùng theo thứ tự nào

Việc lớn hoặc ý tưởng mới:

```
restate-intent → feature-map → show-me (khi cần hình) → assess-idea → [người dùng chốt] → code → verify-change
```

Sửa lỗi: `fix-root-cause` (rồi `verify-change`).

| Skill | Việc | Trạng thái |
|---|---|---|
| `fix-root-cause` | Sửa tận gốc, chặn tái diễn bằng code | chuẩn |
| `verify-change` | Chạy đúng lệnh kiểm chứng và báo cáo trước khi báo "xong" | chuẩn |
| `restate-intent` | Nhắc lại ý định, chờ xác nhận | nháp (2026-11-25) |
| `feature-map` | Bản đồ 6 lớp của một khu tính năng, dựng từ code | nháp (2026-11-25) |
| `show-me` | Hình nhỏ gọn thay cho đoạn văn | nháp (2026-11-25) |
| `assess-idea` | Đánh giá ý tưởng bằng bằng chứng, đưa một đề xuất | nháp (2026-11-25) |

## Nguyên tắc "skill phải được kiếm, không được phát"

- Skill mới bắt đầu ở trạng thái **nháp**. Lên **chuẩn** sau ít nhất 2 lần dùng thật mà không phải sửa lớn. Lần dùng nào phải sửa tay kết quả thì sửa skill ngay lần đó.
- Bản nháp không ai dùng sau khoảng 1 tháng, hoặc trùng việc với skill khác: gộp hoặc xoá.
- Mỗi skill làm một việc. Không nhồi nhiều vai vào một skill.
- Quyết định lớn, tốn tiền hoặc khó hoàn tác: skill chỉ đề xuất, người dùng chốt.
- Quy trình đã lặp lại thành các lệnh cố định thì làm thành script / helper, không viết skill (xem CLAUDE.md).
