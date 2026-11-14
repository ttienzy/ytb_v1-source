# Kế hoạch: Audio Story Studio (Workflow Audio + Video nền)

Mục tiêu: biến Workflow Audio thành công cụ làm **video truyện audio** hoàn chỉnh cho người làm kênh (YouTube / TikTok / Reels):
giọng đọc + hình nền + nhạc + hiệu ứng, chạy hàng loạt hàng trăm chương mà vẫn nhìn "có đầu tư".

## 1. Nghiên cứu (và độ tin cậy)

Đã tìm 4 nhóm thông tin. **Phần lớn nguồn là blog của chính các công cụ nên số liệu chỉ nên coi là gợi ý, chưa kiểm chứng.**

| Chủ đề | Điều tìm được | Độ tin cậy |
|---|---|---|
| Âm lượng | YouTube lấy mức tham chiếu quanh **−14 LUFS**; giọng đọc nên −14…−16 LUFS, true-peak ≤ −1…−3 dBTP. Nhạc nền nên thấp hơn giọng khoảng **15–20 dB**; ducking điển hình −6…−12 dB, attack 50–100 ms, release 300–500 ms. Các nguồn lệch nhau vài dB → cần **đo bằng đồng hồ**, không chỉ tin con số gain. | Trung bình (nhiều nguồn khớp nhau về hướng, lệch về số) |
| Phụ đề | Nhiều blog khẳng định phụ đề tăng retention/thời gian xem (một nguồn nêu 10–20% cho phụ đề động so với tĩnh, **không kiểm chứng**); YouTube lập chỉ mục văn bản phụ đề cho tìm kiếm; nhiều người xem ở chế độ tắt tiếng. | Thấp–trung bình |
| Waveform / visualizer | Video sách nói trên YouTube thường dùng waveform + ảnh bìa; có công cụ chuyên làm việc này (Headliner, v.v.). Không tìm thấy nguồn đo hiệu quả của nền lặp hay thẻ tiêu đề. | Thấp (chỉ cho thấy là thông lệ) |
| Quy trình kênh tiếng Việt "không lộ mặt" | Kịch bản → giọng AI → dựng (CapCut) → thumbnail (Canva). **Nhạc nền: tránh nhạc không rõ bản quyền, dùng thư viện có giấy phép.** YouTube không cho đăng lại nguyên video của người khác mà không biến đổi → nội dung/giọng/hình phải có đóng góp riêng. | Thấp (nguồn quảng cáo) |
| ffmpeg Ken Burns | `zoompan` hay bị cảnh báo chậm/rung; cách thường dùng là phóng ảnh trước khi zoompan. **Đã đo thực tế**: ở 1080×1920, 20 giây (600 khung) mất ~1,8 s (không phóng trước) / ~2,7 s (phóng ×1,5) → rất nhanh; chọn ×1,5 để hết rung. | Cao (đo trực tiếp) |

## 2. Hiện trạng và khoảng trống

Trước đợt này pipeline Audio có: giọng đọc (TTS nguyên chương) → nền → ghép nhạc nền (âm lượng cố định) → thumbnail chỉ làm poster.

Khoảng trống đã xác định, xếp theo giá trị với người làm truyện audio:

| # | Khoảng trống | Vì sao cần | Trạng thái |
|---|---|---|---|
| A | Âm lượng không đồng đều giữa các video; nhạc nền không chỉnh được | Video quá nhỏ/to là lý do người nghe bỏ đi; làm hàng loạt cần đồng đều | **Đã làm (Phase 1)** |
| B | Tốc độ đọc cố định | Truyện dài thường nghe 1.1–1.25× | **Đã làm** |
| C | Không có thẻ tiêu đề chương / logo kênh / waveform / làm tối nền | Nhận diện kênh, người xem biết đang nghe chương nào, chữ dễ đọc trên nền sáng | **Đã làm** |
| D | Bắt buộc có video nền; ảnh bìa (đã bắt buộc có) chỉ làm poster | Nhiều kênh chỉ dùng ảnh bìa zoom chậm; không cần thư viện video | **Đã làm** |
| E | Không xem thử, chỉnh phải chạy cả chương | Tinh chỉnh hiệu ứng bằng thử-sai rất tốn | **Đã làm (xem thử 6 giây)** |
| F | **Không có phụ đề** | Retention, người xem tắt tiếng, SEO | Phase 2 |
| G | Không có intro/outro kênh | Nhận diện + lời kêu gọi đăng ký | Phase 2 |
| H | Nền không theo thể loại truyện | Cổ trang ≠ hiện đại ≠ kinh dị; DB đã có `crawled_stories.categories` | Phase 2 |
| I | Mỗi chương một video | YouTube thường hợp với video dài 30–60 phút (gộp nhiều chương) | Phase 3 |
| J | Chưa sinh metadata đăng (tiêu đề, mô tả, tag, mốc chương) | Nối với Lên lịch YouTube/Pippit đã có | Phase 3 |
| K | Trang Video: không cắt đoạn (in/out), không gắn thẻ, không áp dụng hàng loạt | Nguồn có đoạn đen/credits; cần nhóm clip theo chủ đề | Phase 2 |

## 3. Phase 1 — đã triển khai

Backend (`Backend/app/media/`):
- `audio_options.py` — `AudioOptions` (pydantic, có khoảng giá trị hợp lệ) gửi kèm mỗi lần chạy: tốc độ đọc, nhạc nền (âm lượng, mức hạ theo giọng, chọn bài), nhỏ dần cuối, chuẩn hóa âm lượng, kiểu nền, làm tối, thẻ tiêu đề, waveform, logo.
- `audio_workflow.py` — bộ lọc âm thanh mới (`build_audio_filter`): `amix normalize=0`, sidechain 3 mức, `loudnorm` (~−16 LUFS) + `afade` cuối + `alimiter`; `apply_voice_speed` (atempo, giữ cao độ); logo lưu `Data/media/videos/Viaudio/logos/`.
- `overlays.py` — một lượt ffmpeg: làm tối (`lutyuv`), waveform (`showwaves scale=sqrt`), thẻ tiêu đề (`drawtext` có `fontfile`, mờ dần), logo 4 góc. Không bật lớp phủ nào thì video vẫn **nối stream copy** (nhanh).
- `backgrounds.py` — `build_cover_background`: ảnh bìa → clip zoom 40 giây (cache theo ảnh + khổ) rồi lặp bằng nối copy.
- `audio_router.py` — `options` trong `/run` và `/test-run`; kiểm tra điều kiện sớm (400) theo chế độ nền; `POST /logo`, `GET /logo/{id}`; `POST /preview` (6 giây, giữ 6 file mới nhất), `GET /preview/{file}`.
- Pipeline: thêm bước **Lớp phủ** (chỉ khi bật), thứ tự `image → voice → duration → merge → overlay → mux → bgm → done`.

Frontend (`Frontend/src/features/studio/audio/`): khối gập **Âm thanh & hiệu ứng** (3 tab + xem thử), cấu hình được nhớ giữa các lần mở, thanh tiến trình có bước "Lớp phủ", dòng "Nền video" hiểu chế độ ảnh bìa.

Dọn CSS: xóa 501 rule chết (≈60 KB) của trang Video/Audio cũ; so sánh ảnh chụp 17 trang trước/sau: 16 trang giống hệt từng điểm ảnh, 1 trang (Khám Phá Kênh) lệch trong mức nhiễu dữ liệu mạng. Còn ~190 class chết thuộc trang khác (Watermark, Veo, Pippit…), chưa động tới.

> **Phase 2–3 bên dưới đã được thay bằng [PLAN_audio_story_v2.md](PLAN_audio_story_v2.md)** (2026-11-14): khảo sát kênh thật cho thấy đơn vị nên là cả truyện / video FULL 16:9, và đã đo được phụ đề theo dòng không tốn thêm thời gian TTS. Giữ phần dưới để tham khảo.

## 4. Phase 2 — đề xuất tiếp (ưu tiên theo giá trị / công sức)

1. **Phụ đề cứng (F)** — giá trị cao nhất còn thiếu.
   - TTS theo **nhóm câu/đoạn** thay vì cả chương: `tts_batch` đã trả thời lượng từng item trong manifest → timeline chính xác; ghép wav + khoảng lặng giữa đoạn; đồng thời có tiến độ và có thể chạy lại từng đoạn.
   - Dựng phụ đề bằng `drawtext` (có `fontfile`) hoặc ASS. **Cảnh báo:** bộ lọc `subtitles`/`ass` đi qua libass + Fontconfig; bản ffmpeg Windows ở đây **crash khi thiếu cấu hình Fontconfig** (đã gặp với `drawtext` không `fontfile`) → phải thử trước, nếu hỏng thì dùng `drawtext` với file `.txt` từng dòng (như `campaign/executors/assemble.py`).
   - Gộp vào lượt "Lớp phủ" sẵn có (không thêm lần mã hóa).
   - Rủi ro: chưa đo được tốc độ/độ ổn định TTS theo đoạn trên voice-service thật.
2. **Intro/Outro (G)** — gắn vai trò cho video nguồn ("intro"/"outro"); ghép đầu/cuối bằng nối copy (đã chuẩn hóa cùng thông số); nhạc nền bắt đầu sau intro.
3. **Nhóm nền theo thể loại (H)** — thẻ (tag) cho video nguồn; ánh xạ `categories` của truyện → nhóm nền; mặc định "tất cả" nếu không khớp.
4. **Trang Video (K)** — cắt đoạn in/out cho nguồn (bỏ đoạn đen/credits), thẻ, áp dụng cấu hình cho nhiều video, cảnh báo độ phân giải thấp / nguồn không có hình.
5. **Cải tiến nền** — chuyển cảnh mờ (crossfade) giữa các clip nền (cần mã hóa lại → để tùy chọn), đệm lặp liền mạch.

## 5. Phase 3

- **Gộp N chương/video (I):** TTS từng chương → nối voice → một video; lịch sử/"đã làm" theo từng chương vẫn giữ; thẻ tiêu đề đổi theo mốc chương; xuất mốc thời gian chương cho mô tả YouTube.
- **Metadata đăng (J):** tiêu đề/mô tả/thẻ/mốc chương sinh tự động (có thể dùng Gemini như phần tóm tắt cốt truyện), nối sang Lên lịch YouTube/Pippit.
- **Bản quyền:** cảnh báo nhạc nền không rõ giấy phép trong Thư viện nhạc; nhắc kiểm tra quyền sử dụng truyện và giọng đọc AI (điều khoản thương mại).

## 6. Kiểm thử đã có

- Backend: đo LUFS thật (giọng nhỏ → ≈ −16 LUFS), nhỏ dần cuối (đuôi nhỏ hơn thân ≥ 8 dB), âm lượng nhạc nền có tác dụng, tốc độ đọc (×1,25 → 8 giây từ 10 giây), làm tối đúng tỉ lệ, tiêu đề hiện rồi mờ, waveform chỉ ở phần dưới, logo đúng góc, thiếu font vẫn chạy các hiệu ứng khác, nền ảnh bìa có zoom thật + cache, preview + dọn file tạm; pipeline đầy đủ với TTS giả (tốc độ + lớp phủ + ảnh bìa).
- Frontend: mô hình tùy chọn (kẹp giá trị hỏng về khoảng hợp lệ), thứ tự bước, payload `/run`; giao diện kiểm bằng Playwright (chỉnh, xem thử, lưu/khôi phục, payload gửi đi).
- **Chưa kiểm:** TTS thật qua voice-service (đang không bật), footage nền thật, chạy cả chương thật.
