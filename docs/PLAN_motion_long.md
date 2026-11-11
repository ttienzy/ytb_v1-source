# Motion Control cho video mẫu dài (2026-11-11)

Flow chỉ nhận 3–10 giây video mẫu mỗi lượt Motion Control (Omni 1.2, `macaron_cookie_edit`). Video mẫu dài hơn được **chia đoạn,
tạo lần lượt, rồi ghép** thành một video. Backend: `Backend/app/motion_long/`. Giao diện: nút "Mở rộng video dài" ở Motion Control
(chỉ hiện khi video mẫu > 10 giây), `Frontend/src/features/workflow/components/LongMotionPanel.tsx`.

## Đã đo trên video thật (`test_motion.mp4`, 21,5 giây, TikTok trend, camera đứng yên)
- Kết quả Flow **bám đúng thời gian** của đoạn mẫu: tư thế khớp từng giây; đoạn 7,83 giây cho video 7,87 giây (24 fps, 720×1280), không bị kéo dãn.
- Giữ nguyên nền của video gốc, đổi người và trang phục theo ảnh tham chiếu. Flow kèm tiếng riêng (bị bỏ khi ghép).
- Hai đoạn gối nhau 1 giây: sai khác trung bình mỗi điểm ảnh tại điểm cắt chỉ ~3/255, khung quanh mối nối cùng người, cùng áo, không nhảy hình.

## Quy tắc
1. **Chia đoạn** (`plan.py`): số đoạn tối thiểu để mỗi đoạn ≤ 10 giây, chia đều, đoạn cuối ≥ 3 giây, mốc theo khung 30 fps.
   Mặc định gối 1 giây giữa hai đoạn (tuỳ chọn tắt). 21,5 giây → 3 đoạn × 7,83 giây; 55 giây → 6 đoạn × 10 giây.
2. **Cắt từ video gốc trên máy** rồi mới tải từng đoạn lên Flow (mã hóa lại đúng từng khung, 30 fps, bỏ âm thanh). Không tải video dài một lần.
3. **Hàng đợi tuần tự, dừng khi lỗi, không bao giờ tự gửi lại.** Mỗi lượt có khóa chống trùng `motionlong-<job>-s<đoạn>-a<lần thử>`.
   Chạy lại đoạn là hành động của người dùng (nút "Thử lại đoạn này"/"Tạo lại"). Giao diện xin xác nhận số credit trước khi chạy tất cả.
4. **Lưu bền** ở `Backend/Data/motion_long/<id>/job.json`. Backend khởi động lại: đoạn đã gửi sang Flow thì chỉ theo dõi tiếp job cũ,
   đoạn đang cắt/tải dở (chưa gửi) về "Chưa chạy".
5. **Ghép** (`merge.py`): trong phần gối, so từng cặp khung (xám 48×86) và cắt ở chỗ giống nhau nhất, trộn mờ 0,25 giây quanh điểm cắt;
   không gối thì cắt thẳng. Âm thanh: nhạc gốc (từ video gốc) / nhạc nền thư viện / không âm thanh.
6. **Xóa watermark một lần sau khi ghép**: thử gwr trên video đã ghép; nếu gwr từ chối thì xóa từng đoạn rồi ghép lại (kết quả vẫn một file).
   Lưu `final_clean.mp4`, mỗi lần ghép lại thì bản sạch cũ bị xoá.

## API (`/api/motion-long`)
`POST /plan` (xem trước, 0 credit) · `POST /jobs` (multipart: video, prompt, image_paths, options; chưa gọi Flow) · `GET /jobs[/{id}]` ·
`POST /jobs/{id}/run` (body `{indices}` tuỳ chọn) · `POST /jobs/{id}/stop` · `POST /jobs/{id}/merge` · `POST /jobs/{id}/exports/clean` ·
`GET /jobs/{id}/file/{final|clean|segment|source}` · `DELETE /jobs/{id}`.

## Giá
Khoảng 30 credit mỗi đoạn (720p). 21,5 giây = 3 đoạn ≈ 90 credit; 55 giây = 6 đoạn ≈ 180 credit.

## Lưu ý đã gặp khi chạy thật
- `PUBLIC_ERROR_UNUSUAL_ACTIVITY` ở lệnh `jIps6` của đoạn thứ ba liên tiếp: Flow từ chối ngay lúc gửi (chưa tạo video). Hàng đợi dừng đúng thiết kế.
- `FINISH_REASON_VIDEO_RECITATION` (đã gặp ở Motion thường): kết quả quá giống nội dung có sẵn; không phải lúc nào cũng lặp lại, cho thử lại.
