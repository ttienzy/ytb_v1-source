# Kế hoạch: Workflow Audio v2 — "1 truyện → 1 video FULL đăng được"

Trạng thái: **đề xuất 2026-11-14, chưa code**. Thay thế Phase 2–3 của [PLAN_audio_story_studio.md](PLAN_audio_story_studio.md) (Phase 1 của plan đó vẫn là nền tảng: tùy chọn âm thanh, lớp phủ, nền ảnh bìa, xem thử).

## 0. Tóm tắt

| | Hiện tại | Đề xuất |
|---|---|---|
| Đơn vị sản phẩm | 1 chương → 1 video (~5 phút), mặc định dọc 9:16 | **1 truyện → 1 video FULL** (trung vị ~37 phút), ngang 16:9; truyện dài tự chia "Tập". Chế độ từng chương giữ lại cho Shorts/TikTok |
| Cấu hình | Rải ở 4 chỗ (cột phải, khối "Âm thanh & hiệu ứng", khối "Video nền", localStorage) | **Mẫu kênh**: lưu một lần (giọng, bố cục, phụ đề, nhạc, logo, thumbnail, tiêu đề/mô tả), chọn mẫu rồi bấm chạy |
| Điều kiện chạy | Bắt buộc tự upload thumbnail từng truyện: **1/2.325 truyện có** | Thumbnail **tự dựng** từ mẫu (ảnh bìa nguồn + chữ hook), sửa được |
| Hình | Video nền lặp + lớp phủ tùy chọn | **Bố cục** giống kênh thật: ảnh bìa giữa + phụ đề + nút CTA; 3 khung; video nền toàn màn |
| Phụ đề | Không có | **Có, khớp từng câu** (đã đo: không tốn thêm thời gian TTS) |
| Sau khi xong | File mp4 + đẩy Drive | Thêm **tiêu đề / mô tả / mốc chương / hashtag** → chuyển thẳng sang "Lên lịch Youtube" |
| Hàng đợi | Nằm trong RAM, backend khởi động lại là mất | Lưu DB, chạy tiếp từ chương đang dở; giọng đọc từng chương được cache |

**Đã chốt (2026-11-15):**
1. Khổ video **không có mặc định chung**: tùy nền tảng đăng → là thuộc tính của mẫu/lựa chọn mỗi lần chạy (16:9 cho video FULL YouTube, 9:16 cho Shorts/TikTok). Cả hai chế độ "cả truyện" và "từng chương" đều giữ.
2. Đọc **theo từng dòng** (bản `spike_B`) → phụ đề theo dòng.
3. Nhiều kênh (nhiều Mẫu kênh): **làm sau**.
4. Bố cục mặc định: **ảnh bìa + phụ đề** (`cover_center`).
5. **Dùng ảnh bìa nguồn làm thumbnail** (ảnh upload tay vẫn được ưu tiên nếu có).

### Tiến độ (2026-11-15)

**Đã làm** (P0 + phần lõi của P1/P2, chạy thật qua giao diện):

| Hạng mục | Ở đâu |
|---|---|
| Đơn vị "Cả truyện" (FULL, tự chia tập ≤ 120 phút ở ranh giới chương) / "Từng chương" | `story_video.plan_units`, `story_text.plan_parts`; nút "Kiểu video" |
| Ảnh bìa nguồn tự tải + cache (thử lại 1 lần, lỗi thì báo rõ và dùng ảnh thay thế); không còn bắt buộc upload thumbnail | `story_art.download_cover`, `GET /api/audio/stories/{slug}/cover` |
| Làm sạch văn bản (bỏ dòng số chương đầu, phân cách, ngoặc cong); đọc "Tên truyện." + "Chương N." ở video cả truyện | `story_text.clean_lines`, `story_video.chapter_lines` |
| TTS theo dòng + cache theo chương (khóa = dòng + giọng + nhiệt độ): đổi bố cục/nhạc rồi làm lại không đọc lại | `narration.narrate` (`.cache/voice/`) |
| Phụ đề khớp từng câu (ASS, font kèm app), nhãn "Chương N" đổi theo chương, lời nhắc đăng ký định kỳ, logo | `story_text.build_cues/to_ass`, `story_video.build_ass` |
| Bố cục `cover_center` (nền mờ + thẻ ảnh bìa + tên truyện) cho 16:9 và 9:16; bố cục cũ thành `classic` (vẫn có phụ đề) | `story_art.compose_frame`, `story_video.render_cover_center`, `overlays.build_filter_graph(ass_name=…)` |
| Thumbnail kiểu kênh (ảnh bìa + chữ to 2 màu + nhãn AUDIO/FULL/TẬP/CHƯƠNG) | `story_art.compose_thumbnail` |
| Tiêu đề, mô tả (mô tả nguồn + mốc chương + hashtag theo thể loại), chép từ kho video | `story_video.video_title/video_description`; `AudioOutputs` |
| Ước thời lượng (danh sách truyện, hàng đợi, nút Bắt đầu) | `GET /api/audio/stories/lengths` (cache RAM), `audioModel.planQueue` |
| Xem thử 6 giây theo đúng bố cục | `POST /api/audio/preview` |
| Help (F1) cập nhật | `recapAudioDoc.ts` |

Đo thật: truyện 3 chương (8:34) mất 4 phút 40 giây lần đầu (TTS ~3,5 phút, dựng hình ~45 giây, ghép ~30 giây); làm lại khi đã có cache giọng: **72 giây**. Âm lượng đầu ra −16,0 LUFS.

**Chưa làm:**
- Hàng đợi lưu DB / "Chạy tiếp" sau khi backend khởi động lại (P1). Hiện tại backend restart là mất job, nhưng chạy lại thì chương đã đọc không phải đọc lại.
- Mẫu kênh (nhiều kênh — đã chốt làm sau).
- Hook do Gemini viết (thumbnail đang dùng tên truyện).
- Gửi sang "Lên lịch YouTube".
- Intro/outro, teaser Shorts.
- Hiệu ứng chuyển động (hạt sáng, zoom nhẹ) cho bố cục ảnh bìa.

**Lưu ý dữ liệu:** ảnh bìa nguồn rất lẫn lộn (ảnh đồ ăn, ảnh người thật) — xem trước khi đăng, dùng "Đổi ảnh" khi cần.

## 1. Dữ liệu đã thu thập

### 1.1 Dữ liệu trong app (đo trực tiếp trên `Backend/Data/app.db`, 2026-11-14)

| Chỉ số | Giá trị | Hệ quả |
|---|---|---|
| Truyện đã crawl / chương | 2.325 / 14.379 | Kho đủ lớn, nút thắt là khâu sản xuất |
| Chương mỗi truyện | trung vị **5**, p90 9, max 39 | Phần lớn là truyện ngắn — làm gọn trong 1 video |
| Độ dài chương | trung vị 7.861 ký tự, p90 9.893 | |
| Độ dài cả truyện (quy ra giọng đọc ~18 ký tự/giây) | trung vị **≈ 37 phút**, p90 ≈ 58 phút | **Trùng khớp** độ dài video "[Truyện Audio Full]" trên YouTube (mục 1.2) |
| Truyện có thumbnail (bắt buộc để chạy) | **1** | Rào cản số 1: muốn làm truyện nào cũng phải tự tìm và upload ảnh |
| Truyện có ảnh bìa từ nguồn (`crawled_stories.image`) | **2.325** (tải được, 600–1080 px, dọc/vuông) | Có nguyên liệu dựng thumbnail tự động. Nhưng ảnh rất lẫn lộn: ảnh vẽ, ảnh đồ ăn không liên quan, **ảnh người thật** → chỉ dùng làm nền cho mẫu, cần cho người dùng duyệt |
| Truyện có mô tả nguồn (`description`) | có | Dùng làm mô tả video / gợi ý câu hook |
| Thể loại (`categories`) | HIỆN ĐẠI 1.243, VẢ MẶT 1.114, HE 624, CỔ ĐẠI 565, NỮ CƯỜNG 344, … | Chọn bố cục/nhạc/hashtag theo thể loại |
| Chương bắt đầu bằng dòng số chương (`"1\n…"`) | **395/2.000** mẫu | TTS đọc "Một" ở đầu video → cần làm sạch văn bản |
| Tên truyện có khoảng trắng đầu (`" TA LÀ TẠ UYỂN"`) | có | Chuẩn hóa khi dựng tên file/tiêu đề |
| Video đã làm | 2 (chương 1–2 của 1 truyện, ~5 phút/video, cách nhau ~2 phút) | |

### 1.2 Kênh truyện audio tiếng Việt trên YouTube

Lấy 10 video mới nhất của 5 kênh bằng yt-dlp (tiêu đề, thời lượng, lượt xem), tải thumbnail và storyboard (ảnh ghép khung hình) của 3 video. Mẫu nhỏ, chỉ để định hướng, không phải thống kê.

| Kênh | Thời lượng video | Mẫu tiêu đề | Hình trong video |
|---|---|---|---|
| Truyện Audio Full (Mèo) | 37 phút – 1 giờ 25 | `[Truyện Audio Full] <CÂU HOOK VIẾT HOA>` | **Ảnh bìa giữa khung**, hai bên trang trí (hoa, sticker), cột trái có nút **LIKE / COMMENT / SHARE / FOLLOW** nhấp nháy, nhãn "TRUYỆN AUDIO FULL", hạt lấp lánh bay, **phụ đề chạy theo lời đọc** ở dưới |
| HS Truyện Audio | 33 phút – 1 giờ 6 | `<Câu hook> \| Truyện Audio Full` | **3 khung**: trái = thumbnail + thương hiệu "H-S Audio Full"; giữa = video gameplay game mobile (giữ mắt người xem); phải = nhân vật 3D chớp mắt |
| Thiên Thanh Audio | **2 giờ 21 – 6 giờ 32** | `<Tên truyện> Tập 16 <hook>` (truyện dài chia tập) | **Slideshow** ảnh AI theo bối cảnh cổ trang, khung ảnh trượt/xếp chồng |
| Bạch Nguyệt Quang Audio | 15 – 31 phút | `FULL …` và `Phim AI \|\| …` | Chuyển dần sang "phim AI" (video hoạt hình AI) |
| Mê Truyện Audio | 13 phút – 1 giờ | `[Truyện …] … [Full] [Truyện Audio] #truyenaudio` | |

Kết luận rút ra:
1. **Định dạng chủ đạo là ngang 16:9, cả truyện trong một video** (truyện ngắn 30–80 phút); truyện dài chia "Tập" 2–6 giờ. Không kênh nào trong mẫu đăng từng chương 5 phút dạng dọc.
2. **Thumbnail**: ảnh nhân vật lớn + **chữ hook rất to, 2 màu, viền đậm** + nhãn nhỏ "Audio", "Full Trọn Bộ", "Tập N". 16:9.
3. **Tiêu đề là câu hook** (mâu thuẫn/drama), không phải tên truyện gốc. Mô tả = tóm tắt gây tò mò + câu hỏi tương tác + hashtag.
4. **Hình trong video rẻ nhưng "có chuyển động"**: ảnh bìa tĩnh + hiệu ứng hạt + nút CTA + phụ đề; hoặc 3 khung có video giữ mắt. Không cần dựng hình theo nội dung.
5. Bài tổng hợp kênh hay ([vymiu.com](https://vymiu.com/top-kenh-audio-truyen-ngon-tinh-co-nhieu-truyen-hay-va-giong-doc-giau-cam-xuc/)) chấm điểm chủ yếu ở **giọng đọc truyền cảm** và **nhạc/hiệu ứng hòa với giọng** — đúng hai thứ app làm bằng máy, nên bố cục/phụ đề/nhạc là chỗ để bù.

### 1.3 Công cụ tham khảo

- **ElevenLabs Studio (Audiobooks)**: dự án chia **chương** (thêm/đổi tên/kéo thả), timeline nhiều track (giọng, nhạc, hiệu ứng âm thanh, phụ đề với dự án video). → Học: mô hình "dự án = truyện, bên trong là chương", xem/sửa từng chương trước khi xuất.
- **Wondercraft**: TTS + nhạc + SFX + timeline; tự đặt nhạc/hiệu ứng nhưng phải chỉnh tay khi cần chính xác. → Học: mặc định tự động, có chỗ chỉnh tay khi cần.
- Nhận xét chung: các công cụ này làm **một sản phẩm thật kỹ**; người dùng app này làm **hàng loạt nhiều kênh**. → Thiết kế cho hàng loạt: **mẫu + hàng đợi**, chỉnh tay là ngoại lệ.

### 1.4 Thử nghiệm kỹ thuật (đo 2026-11-14)

| Thử | Kết quả | Kết luận |
|---|---|---|
| TTS 1.819 ký tự (29 dòng) giọng "Trúc Ly", CPU fp32: **cả đoạn 1 item** vs **mỗi dòng 1 item** | 34,0 s vs **33,6 s** xử lý; audio 101,5 s vs 88,6 s (từng dòng không có khoảng nghỉ giữa câu; thêm ~0,4 s/dòng là bằng nhau) | Đọc **theo dòng không tốn thêm thời gian**, và manifest trả **thời lượng từng dòng** → phụ đề khớp chính xác **không cần nhận dạng giọng nói** |
| Tốc độ TTS | RTF ≈ 0,33 (34 s cho 101 s audio) | Truyện trung vị 37 phút ≈ **12–13 phút TTS**; thêm dựng hình → ước ~4 truyện/giờ |
| Bộ lọc `subtitles` (libass) trên ffmpeg dev 8.1 **và** `ffmpeg-static` 6.1 (bản đóng gói) | Chạy được với `fontsdir=.` + font kèm app (Be Vietnam Pro), dấu tiếng Việt đúng, đúng mốc thời gian | Dùng **ASS** cho phụ đề (kiểu chữ, viền, vị trí, hiệu ứng) thay vì hàng trăm `drawtext`. Vẫn chạy với `cwd` = thư mục tạm + đường dẫn tương đối (bẫy dấu `:` ổ đĩa) |

File mẫu để **nghe so sánh ngữ điệu** (chưa ai nghe — xem mục 8):
`C:\Users\nguye\AppData\Local\Temp\claude\35057f09fdb40a1c\b483c52b-58b8-40b8-b0da-5107f1d5c7db\scratchpad\spike_A_nguyen_khoi.wav`,
`C:\Users\nguye\AppData\Local\Temp\claude\35057f09fdb40a1c\b483c52b-58b8-40b8-b0da-5107f1d5c7db\scratchpad\spike_B_tung_dong.wav` (+ `spike_B_tung_dong.srt`).

## 2. Đánh giá giao diện hiện tại

Code: `Frontend/src/features/studio/audio/` (`AudioWorkflowPanel`, `StoryBrowser`, `RunPanel`, `StyleStudio`, `VideoSection`, `AudioOutputs`, `JobBar`); backend `Backend/app/media/audio_*.py`, `overlays.py`, `backgrounds.py`.

| # | Vấn đề | Bằng chứng | Mức |
|---|---|---|---|
| U1 | **Không chạy được ngay**: truyện nào cũng phải tự upload thumbnail | `validateQueue` chặn khi thiếu; 1/2.325 truyện có | Cao |
| U2 | **Sai đơn vị sản phẩm**: mỗi chương một video ~5 phút dọc; người dùng phải tự gộp nếu muốn đăng FULL | `_run_one` theo chương; mặc định `9:16` | Cao |
| U3 | **Cấu hình rải rác**: "Nhạc nền" bật/tắt ở cột phải nhưng âm lượng/bài nhạc ở khối dưới; "Nền" chia hai nơi (kiểu nền ở tab "Nền", cách khớp ở cột phải); xem thử nằm trong khối gập | `RunPanel` + `StyleStudio` | Cao |
| U4 | Không thấy **video sẽ ra trông thế nào** trước khi chạy cả chục phút | Xem thử ẩn trong khối gập, không có thumbnail/tiêu đề xem trước | Trung bình |
| U5 | Thumbnail cứng `"Audio {tên} - phần N"`, chữ trắng hộp đen | `_process_thumbnail` | Trung bình |
| U6 | Không có phụ đề, CTA, bố cục kiểu kênh thật | `AudioOptions` | Trung bình |
| U7 | Văn bản không làm sạch: đọc cả số chương "1" ở đầu | 395/2.000 chương | Trung bình |
| U8 | Hàng đợi/tiến trình trong RAM; dev.js khởi động lại backend khi sửa `.py` là mất | `AUDIO_JOBS` dict | Trung bình |
| U9 | Đầu ra dừng ở file: không có tiêu đề/mô tả/mốc chương; không nối sang "Lên lịch Youtube" (đã có `POST /api/youtube/bulk-schedule`) | `AudioOutputs` | Trung bình |
| U10 | Không ước lượng thời lượng video / thời gian xử lý trước khi chạy | | Thấp |
| U11 | Một giọng cho cả truyện, không đổi giọng cho lời thoại | | Thấp (để sau) |

## 3. Mục tiêu và nguyên tắc

**Mục tiêu đo được**
- Từ lúc mở tab đến khi bấm "Sản xuất" một truyện mới: **≤ 3 thao tác** (chọn truyện → chọn mẫu kênh → Sản xuất), không phải upload gì.
- Video ra **đăng được ngay**: mp4 16:9 + thumbnail 1280×720 + tiêu đề + mô tả có mốc chương.
- Backend khởi động lại giữa chừng **không mất** tiến độ (chạy tiếp từ chương đang dở).
- Đổi mẫu rồi xuất lại một truyện đã đọc: **không đọc lại giọng** (dùng cache).

**Nguyên tắc thiết kế (gần người dùng hơn)**
1. **Ngôn ngữ của người làm kênh**: "Video", "Tập", "Mẫu kênh", "Hook", "Lên lịch" — không phải "mux", "overlay", "bg_fit".
2. **Mặc định thông minh, chỉnh là ngoại lệ**: mọi thứ có giá trị mặc định tốt; tùy chỉnh nằm trong mẫu, không nằm trên đường chạy.
3. **Thấy trước khi chạy**: thẻ "Video sẽ ra" (thumbnail, tiêu đề, thời lượng, số tập, ước tính thời gian) cập nhật ngay khi chọn.
4. **Một nơi cho một việc**: nhạc, nền, phụ đề, logo… đều ở trong Mẫu kênh; trang chính chỉ còn chọn truyện, hàng đợi, đầu ra.
5. Không màu mè: giữ icon đơn sắc (theo phản hồi trước của bạn).

## 4. Thiết kế mới

### 4.1 Mô hình sản phẩm

```
Truyện (crawl)                Mẫu kênh (lưu, nhiều mẫu)              Video (đơn vị đầu ra)
 ├─ chương 1..N  ──┐          ├─ giọng, tốc độ                        ├─ 1 truyện ngắn  → 1 video FULL
 ├─ ảnh bìa nguồn  │          ├─ bố cục + màu + font                  ├─ truyện dài     → Tập 1, Tập 2… (cắt ở ranh giới chương,
 ├─ mô tả, thể loại│  ──────► ├─ phụ đề (bật, kiểu)                   │                    mục tiêu ≤ 90 phút/tập, chỉnh được)
 └─ tóm tắt Gemini ┘          ├─ nhạc nền (bài/ngẫu nhiên/theo thể loại), mức hạ   └─ (tùy chọn) mỗi chương 1 video — Shorts/TikTok
                              ├─ logo, CTA, intro/outro
                              ├─ thumbnail (mẫu chữ hook, nhãn)
                              └─ khuôn tiêu đề/mô tả/hashtag
```

**Mẫu kênh** (`AudioPreset`): JSON lưu trong DB (bảng mới `audio_presets`), mặc định có sẵn 2 mẫu: "Ảnh bìa + phụ đề (16:9)" và "Từng chương dọc (9:16)". Cấu hình hiện có (`AudioOptions`, giọng, khổ, nhạc) chuyển thành một phần của mẫu; `localStorage` chỉ nhớ mẫu đang chọn.

**Bố cục** (layout) — mỗi bố cục là một hàm dựng `filter_complex`, dùng chung bước phụ đề/logo/waveform:

| Mã | Mô phỏng | Cần gì | Giai đoạn |
|---|---|---|---|
| `cover_center` | Ảnh bìa giữa khung (bo góc, đổ bóng) trên nền chính ảnh đó làm mờ + tối; phụ đề dưới; nhãn kênh góc trên; nút CTA LIKE/SUB nhấp nháy theo chu kỳ; hạt sáng bay nhẹ (tùy chọn) | Chỉ ảnh bìa | P2 (mặc định) |
| `three_panel` | Trái: thumbnail + tên truyện + logo; giữa: video thư viện nền (gameplay/satisfying); phải: ảnh/clip nhân vật lặp | Thư viện video nền (đã có) | P2 |
| `fullscreen` | Như hiện tại: video nền toàn màn + lớp phủ | Thư viện video nền | Đã có |
| `slideshow` | Ảnh AI theo đoạn truyện, Ken Burns | Tạo ảnh AI (tốn lượt ChatGPT, dễ bị chặn tạm — đã gặp ở Chiến dịch) | P4, chỉ khi cần |

### 4.2 Luồng người dùng

```
[Kho truyện] ──chọn truyện──► [Thẻ "Video sẽ ra"] ──Sản xuất──► [Hàng đợi] ──xong──► [Đầu ra] ──► Lên lịch Youtube / Drive
                                  ▲ đổi mẫu kênh / sửa hook / sửa thumbnail
```

### 4.3 Khung giao diện

Trang "Workflow Audio" còn 3 vùng + 1 trang con "Mẫu kênh":

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Mẫu kênh: [Kênh Ngôn tình 16:9 ▾]  [Sửa mẫu]            Hàng đợi: 3 video · còn ~41 phút   [Mở ▸] │
├───────────────────────────────┬──────────────────────────────────────────────────────────────────────┤
│ [Tìm truyện…]   [Chưa làm▾]   │  ┌──────────────────────────┐  TA LÀ TẠ UYỂN                         │
│ [Hiện đại][Cổ đại][Vả mặt]…   │  │                          │  Cổ đại · Trọng sinh · 9 chương         │
│ ───────────────────────────── │  │   THUMBNAIL XEM TRƯỚC    │  ≈ 52 phút audio → 1 video FULL         │
│ ▣ Ta Là Tạ Uyển    9 ch · 52' │  │  (ảnh bìa + chữ hook)    │  Xử lý ước ~17 phút                     │
│ ▢ Bạn Thân Ghép…   5 ch · 31' │  │                          │                                         │
│ ▢ Cứu Người Một…   4 ch · 26' │  └──────────────────────────┘  Tiêu đề  [Truyện Audio Full] Trọng   │
│ ▢ …                           │   [Đổi ảnh] [Viết lại hook]     sinh về 6 năm trước, ta cắt đứt…  ✎  │
│                               │                                                                      │
│ (ảnh bìa thật thay chữ viết   │  Chương: [✓1][✓2][3][4]…[9]   (mặc định: tất cả chương chưa làm)   │
│  tắt; thời lượng ước tính)    │  Tóm tắt │ Đọc chương │ Văn bản sẽ đọc (đã làm sạch)                 │
│                               │                                                                      │
│ ☐ chọn nhiều → [Sản xuất 5]   │                     [ Xem thử 10 giây ]   [ Sản xuất video ▸ ]      │
├───────────────────────────────┴──────────────────────────────────────────────────────────────────────┤
│ Đầu ra   [Tất cả▾]                                         [Lên lịch YouTube] [Đẩy Drive] [Xóa local] │
│ ┌────────┐ Ta Là Tạ Uyển · FULL · 52:10 · 14/11            ✓ tiêu đề ✓ mô tả ✓ mốc chương  [▶][⋯]   │
│ └────────┘                                                                                           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Hàng đợi là **ngăn kéo bên phải** (mở từ thanh trên), hiện từng video: đang ở chương nào, bước nào, ETA, nút Tạm dừng/Hủy/Chạy lại chương lỗi. Thay `JobBar` một hàng hiện nay.
- "Test nhanh bằng text" chuyển vào trang Mẫu kênh (là công cụ thử mẫu, không phải việc hằng ngày).

Trang **Mẫu kênh** (mở toàn trang, có xem trước trực tiếp):

```
┌ Mẫu: Kênh Ngôn tình 16:9  [Nhân bản] [Đặt mặc định] ─────────────────────────────────────────────┐
│ Giọng & đọc │ Bố cục & hình │ Phụ đề │ Nhạc & âm thanh │ Thumbnail │ Tiêu đề & mô tả │ Intro/Outro │
├─────────────────────────────────────────────┬─────────────────────────────────────────────────────┤
│ (các điều khiển của tab đang chọn)          │  XEM TRƯỚC KHUNG HÌNH (ảnh tĩnh, cập nhật ngay)    │
│                                             │  [ Xem thử 10 giây có giọng + phụ đề ]              │
└─────────────────────────────────────────────┴─────────────────────────────────────────────────────┘
```

Xem trước khung hình tĩnh = render 1 frame bằng cùng `filter_complex` (≤ 1 giây) → phản hồi gần như tức thì khi kéo thanh trượt; "Xem thử 10 giây" mới đọc giọng thật.

### 4.4 Thumbnail tự động

- Nguồn ảnh theo thứ tự: ảnh người dùng upload (nếu có) → ảnh bìa nguồn (tải về cache `Data/media/story_covers/`) → nền màu theo mẫu.
- Mẫu thumbnail 1280×720: ảnh (cắt theo khuôn mặt nếu sau này có, trước mắt cắt giữa) bên trái/giữa, **chữ hook 2–3 dòng, font đậm (Be Vietnam Pro ExtraBold đã kèm app), 2 màu, viền đen**, nhãn "AUDIO", "FULL" hoặc "TẬP N".
- **Câu hook**: Gemini (đã dùng cho tóm tắt truyện) viết 3 phương án ≤ 60 ký tự từ mô tả + tóm tắt; người dùng chọn/sửa; không có Gemini thì lấy tên truyện.
- Vì ảnh bìa nguồn lẫn lộn (ảnh đồ ăn, ảnh người thật), danh sách truyện hiện ảnh bìa để người dùng **thấy và đổi** trước khi sản xuất. Không tự đăng thumbnail chưa ai xem — xem mục 7.

### 4.5 Văn bản đọc và phụ đề

1. **Làm sạch** (hàm thuần, có test): bỏ dòng chỉ có số chương ở đầu; chuẩn hóa ngoặc kép/dấu ba chấm; bỏ dòng quảng cáo nguồn (danh sách mẫu cấu hình được); trim tên truyện. Tab "Văn bản sẽ đọc" hiện kết quả.
2. **Chia đoạn đọc**: mỗi dòng của truyện là một item TTS (dòng > 256 ký tự để voice-service tự chia như hiện nay); gom tối đa 200 item/batch (giới hạn `TTSBatchRequest`). Ghép wav + khoảng lặng 0,35–0,5 s giữa dòng (lời thoại có thể dài hơn).
3. **Phụ đề**: thời lượng từng item → file `.ass` (kiểu chữ theo mẫu); dòng dài tự xuống dòng ≤ 2 dòng; dựng bằng `subtitles=…:fontsdir=.` trong cùng lượt mã hóa với bố cục (không thêm lượt).
4. **Mốc chương** cho video FULL: cộng dồn thời lượng → `00:00 Chương 1`, `07:42 Chương 2`… đưa vào mô tả YouTube.
5. **Cache giọng đọc theo chương**: khóa = hash(văn bản đã làm sạch, giọng, tốc độ, phiên bản model). Đổi mẫu/bố cục/phụ đề → không đọc lại.

### 4.6 Pipeline backend mới

```
Video job (1 truyện hoặc 1 tập)
  1. prepare    làm sạch văn bản, ước thời lượng, tải ảnh bìa (rẻ, lỗi báo sớm)
  2. voice      từng chương: cache hit → bỏ qua; miss → TTS theo dòng → voice_ch{n}.wav + lines.json   (checkpoint mỗi chương)
  3. assemble   nối giọng các chương (+ lặng giữa chương), dựng .ass + mốc chương
  4. render     MỘT lượt ffmpeg: bố cục + phụ đề + logo/CTA → video câm đúng độ dài
  5. mix        giọng + nhạc nền (sidechain, loudnorm như hiện nay) → mp4
  6. package    thumbnail 1280×720, metadata.json (tiêu đề, mô tả, mốc chương, hashtag), ghi lịch sử từng chương = đã làm
  7. publish    (tùy chọn) Drive / gửi sang Lên lịch Youtube
```

- **Lưu bền**: bảng `audio_jobs` (job, truyện, mẫu, trạng thái, bước, chương đã xong, lỗi) + thư mục làm việc giữ lại tới khi xong; khi backend khởi động: job đang chạy → `interrupted`, nút "Chạy tiếp" (giống cách Recap rehydrate).
- **Không thử lại mù**: TTS bận thì chờ như hiện nay (`_tts_with_retry`); lỗi khác dừng chương và báo.
- Giữ `AudioOptions` hiện có (tương thích ngược) và thêm `layout`, `subtitles`, `cta`, `intro/outro` vào cấu trúc mẫu.
- API mới (dự kiến): `GET/POST/PUT /api/audio/presets`, `POST /api/audio/videos` (tạo job theo truyện/tập), `GET /api/audio/videos/{id}`, `POST /api/audio/videos/{id}/resume`, `POST /api/audio/frame-preview` (1 khung tĩnh), `POST /api/audio/stories/{slug}/hooks` (Gemini), `GET /api/audio/outputs/{id}/metadata`. Đường `/api/audio/run` cũ giữ trong thời gian chuyển đổi.

## 5. Lộ trình

Mỗi giai đoạn: chạy được bằng UI thật + test tự động (`node:test` cho logic thuần, `pytest` cho backend, Playwright cho luồng UI chính) + cập nhật help doc `recapAudioDoc.ts` (`verifiedAt`, `changes`).

### P0 — Gỡ rào cản (nhỏ, làm trước)
- Ảnh bìa nguồn làm thumbnail mặc định (tải + cache); bỏ chặn "chưa có thumbnail" khi có ảnh bìa nguồn; danh sách truyện hiện ảnh bìa thật.
- Làm sạch văn bản (bỏ dòng số chương, trim tên).
- Ước thời lượng (ký tự / tốc độ đo được) hiện trên từng truyện và trên nút chạy.
- Gom cấu hình rải rác: "Nhạc nền" bật/tắt + âm lượng + bài về một chỗ; "Nền" về một chỗ.
- **Nghiệm thu**: chọn một truyện chưa từng làm → bấm Bắt đầu chạy được không cần upload; chương có dòng số đầu không còn đọc "Một".

### P1 — Video FULL + bền vững
- Job theo truyện/tập: TTS theo chương có cache + checkpoint; nối nhiều chương thành một video; chia tập theo ngưỡng phút.
- Hàng đợi lưu DB + chạy tiếp sau khi backend khởi động lại; ngăn kéo hàng đợi có ETA.
- metadata.json: tiêu đề theo khuôn, mô tả (mô tả nguồn + mốc chương + hashtag theo thể loại).
- Lịch sử "đã làm" vẫn theo từng chương (tương thích với dữ liệu cũ).
- **Nghiệm thu**: một truyện 5 chương → 1 mp4 16:9 có mốc chương đúng (sai số < 1 s); tắt backend giữa chương 3 → bật lại → "Chạy tiếp" chỉ đọc chương 3–5.

### P2 — Trông như kênh thật
- Phụ đề theo dòng (ASS), bố cục `cover_center` (mặc định) và `three_panel`, CTA, nhãn kênh.
- Trang Mẫu kênh (nhiều mẫu, nhân bản, xem trước khung tĩnh + 10 giây).
- Thumbnail theo mẫu + hook Gemini (3 phương án, chọn/sửa).
- **Nghiệm thu**: so khung hình với 2 kênh tham chiếu ở mục 1.2; phụ đề lệch giọng < 0,3 s trên cả video 30+ phút; dựng 1 khung xem trước < 1,5 s.

### P3 — Đăng
- Nút "Lên lịch YouTube" ở Đầu ra: chuyển video + thumbnail + metadata sang `bulk-schedule` đã có.
- Intro/Outro theo mẫu; nhạc nền theo thể loại.
- (Tùy chọn) **Teaser Shorts**: cắt 45–60 giây đầu (hook) thành 9:16 có phụ đề, mô tả trỏ về video FULL.

### P4 — Để sau, chỉ khi cần
- Bố cục slideshow ảnh AI theo đoạn; đổi giọng cho lời thoại (nhận diện câu trong ngoặc kép); giọng nhân vật.

## 6. Ước tính tải

Đo ở mục 1.4: RTF TTS ≈ 0,33 trên CPU (fp32, giữ nguyên theo quyết định trước, không GPU). Truyện trung vị 37 phút ≈ 12–13 phút TTS + dựng một lượt mã hóa (libx264 veryfast; Phase 1 đo ~1 phút cho 9 phút video ⇒ ước ~4 phút cho 37 phút) ⇒ **~17 phút/truyện, ~3–4 truyện/giờ**. Voice-service chỉ đọc một việc một lúc ⇒ Recap/Chiến dịch chạy cùng lúc sẽ làm chậm hàng đợi; ngăn kéo hàng đợi phải hiện "đang chờ giọng đọc". Đổi mẫu và xuất lại thì chỉ tốn phần dựng (~4 phút) nhờ cache giọng.

## 7. Rủi ro và chính sách

| Rủi ro | Ghi chú | Giảm thiểu |
|---|---|---|
| **YouTube "inauthentic content"** (đổi tên từ "repetitious content" ngày 2025-07-15) | Chính sách nêu ví dụ slideshow ảnh, nội dung dựng từ khuôn chung "giống sản xuất hàng loạt"; ảnh hưởng **kiếm tiền**, không cấm đăng. Không có nguồn nói riêng về truyện audio — việc video đọc truyện trên ảnh tĩnh bị xếp vào đó là **suy luận** | Nhiều mẫu/bố cục khác nhau; intro giọng riêng của kênh; hook/tóm tắt viết riêng cho từng truyện; không hứa hẹn kiếm tiền trong app |
| Bản quyền nội dung truyện và ảnh bìa (nguồn daotruyen) | Ảnh bìa nhiều khi là ảnh người thật/ảnh lấy từ mạng | Người dùng tự chịu trách nhiệm; app hiện ảnh để duyệt, ưu tiên ảnh upload riêng; ghi rõ trong help |
| Ngữ điệu khi đọc từng dòng | Tách dòng có thể làm mất liền mạch giữa câu | Nghe so sánh 2 file mẫu ở mục 1.4 trước khi làm P2; nếu kém: gom 2–3 dòng/item, vẫn có mốc theo nhóm |
| Video dài 1–6 giờ | File lớn, mã hóa lâu, lỗi giữa chừng tốn công | Checkpoint theo chương; chia tập; dọn file tạm sau khi xong |
| Gemini cookie hết hạn | Hook/tóm tắt không tạo được | Hook không bắt buộc: rơi về tên truyện |

## 8. Cần bạn chốt

1. **Đơn vị mặc định** = 1 truyện → 1 video FULL 16:9 (đề xuất), còn từng chương 9:16 là tùy chọn? Hay ngược lại vì bạn đang nhắm TikTok/Shorts?
2. **Nghe 2 file mẫu** (mục 1.4): bản đọc từng dòng có ổn ngang bản nguyên khối không? Quyết định cách làm phụ đề.
3. Bạn có chạy **nhiều kênh** (cần nhiều Mẫu kênh, mỗi kênh logo/giọng riêng) không?
4. Bố cục ưu tiên: `cover_center` (ảnh bìa + phụ đề) hay `three_panel` (có video giữ mắt)?
5. Dùng ảnh bìa nguồn làm thumbnail mặc định có chấp nhận được về bản quyền với kênh của bạn không, hay luôn tự tạo/upload?

## 9. Nguồn

- Dữ liệu kênh: yt-dlp trên các kênh [Truyện Audio Full](https://www.youtube.com/@TruyenAudioFullMeo), [HS Truyện Audio](https://www.youtube.com/channel/UCshzIek8qpzuVlspANPSwPQ), [Thiên Thanh Audio](https://www.youtube.com/@thienthanhaudio68), [Bạch Nguyệt Quang Audio](https://www.youtube.com/@B%E1%BA%A1chNguy%E1%BB%87tQuang-Audio), [Mê Truyện Audio](https://www.youtube.com/channel/UCKENFLZkcdZa4CvoV5u3siQ) (2026-11-14).
- [Top kênh audio ngôn tình (vymiu.com)](https://vymiu.com/top-kenh-audio-truyen-ngon-tinh-co-nhieu-truyen-hay-va-giong-doc-giau-cam-xuc/).
- [ElevenLabs Studio — Audiobooks](https://elevenlabs.io/docs/eleven-creative/products/audiobooks), [ElevenLabs Studio](https://elevenlabs.io/docs/eleven-creative/products/studio), [Wondercraft vs ElevenLabs](https://support.wondercraft.ai/articles/366799-difference-from-elevenlabs).
- [YouTube channel monetization policies](https://support.google.com/youtube/answer/1311392), [Plagiarism Today — YouTube targets inauthentic content](https://www.plagiarismtoday.com/2025/07/08/youtube-targets-inauthentic-content/).
- [Scribecount — YouTube audiobooks for authors](https://scribecount.com/author-resource/audiobook-creation-guide/youtube-audiobooks-for-authors) (nguồn của nhà cung cấp, độ tin cậy thấp).
