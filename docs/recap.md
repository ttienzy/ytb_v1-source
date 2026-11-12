# Recap YouTube (R1–R5): pipeline phía backend

> **Hiện hành**, đối chiếu code ngày 2026-11-12 (`Backend/app/recap/`, `Backend/app/ai/gemini/recap.py`, `Frontend/src/features/studio/`). Lịch sử thiết kế: [archive/RECAP_*.md](archive/). Phần *Audio Story Studio* (truyện → video audio) là một luồng khác, xem [PLAN_audio_story_studio.md](PLAN_audio_story_studio.md).

## 1. Recap làm gì

Đầu vào: **link YouTube** (+ tùy chọn transcript dán tay) + một giọng đọc (+ tùy chọn nhạc nền). Đầu ra: video recap lồng tiếng Việt.

> Prompt hiện tại là **recap video ẩm thực** (`Backend/prompts/recap/food_review_chunk.prompt.txt`, và lời kết "cảm ơn các bạn đã theo dõi hành trình ẩm thực" được tự chèn ở `_ensure_intro_and_outro`). Dùng cho thể loại khác thì phải đổi prompt và hàm đó.

| Pha | Tên | Làm gì | Công cụ |
|---|---|---|---|
| R1 | recap | Lấy transcript → chia chunk → Gemini viết kịch bản (`recap.json`: scenes → segments với `start_time_sec`, `end_time_sec`, `vietnamese_vo`) | Playwright/yt-dlp, Gemini web |
| R2 | cut | Tải video nguồn 1080p (video-only) và cắt từng đoạn | yt-dlp, ffmpeg |
| R3 | voice | Đọc `vietnamese_vo` từng đoạn thành WAV | voice-service (VieNeu-TTS) |
| R4 | merge | Ghép clip + giọng từng đoạn, nối thành `final_recap.mp4` | ffmpeg |
| R5 | polish | (tùy chọn) trộn nhạc nền dưới giọng → `final_studio.mp4` | ffmpeg |

Điều kiện cần: ffmpeg trên PATH, **cookie Gemini** (Cài đặt → Gemini & YouTube), voice-service chạy (8001), `node` trên PATH cho yt-dlp.

## 2. Chạy như thế nào

- **Một nút**: `POST /api/recap/run` (form: `youtube_url`, `voice_id`, tùy chọn `raw_file`/`raw_text`, `bgm_ids`, `bgm_volume`) → trả `202 {job_id}`; frontend poll `GET /api/recap/jobs/{job_id}`.
- **Hàng đợi**: `POST /api/recap/batch` (1–10 URL, chạy **tuần tự**, cùng giọng/nhạc), poll `GET /batch/{id}`. Mỗi job thử tối đa 2 lần; job lỗi lần hai thì **dừng cả hàng đợi**. `DELETE /batch/{id}` là hủy mềm (dừng sau job hiện tại).
- **Từng pha tay** (để debug/chạy lại): `/generate`, `/cut`, `/voice`, `/merge`, `/jobs/{id}/polish`.
- **Thử lại**: `POST /jobs/{id}/resume` chạy tiếp từ pha chưa `done`.
- **Xuất**: `/jobs/{id}/final` (file), `/jobs/{id}/studio`, đăng `publish-facebook` / `publish-youtube`; `DELETE /jobs/{id}` xóa dữ liệu job.

### Luồng nội bộ (`service._run_pipeline_stages`)

```
[transcript] → cookie_check → Gemini (chunk) ──► recap.json
                                   │
        ┌──────────────────────────┴─────────────────────────┐
        ▼ cut (tải + cắt)          ▼ voice (TTS theo lô 8)   ▼ _merge_stream (ghép đoạn nào đã có giọng)
        └──────── chạy CHỒNG nhau, asyncio.gather(return_exceptions=True) ────────┘
                                   ▼
                  merge (nếu chưa xong) → polish (nếu có BGM) → upload Drive (lỗi không làm hỏng job) → ghi History
```

Mỗi pha chỉ chạy nếu chưa `done`, nên **cùng hàm phục vụ cả chạy mới lẫn resume**. Merge chạy chồng lên TTS chỉ khi máy đủ luồng CPU (`_overlap_enabled`); ép bằng `RECAP_OVERLAP_MERGE=1|0`.

## 3. Chi tiết từng pha

**R1: transcript và Gemini**
- Có `raw_bytes` (người dùng dán/đính kèm) thì dùng **nguyên văn, không chuẩn hóa**; `raw.txt` được lưu để kiểm tra. Không có thì `fetch_transcript_raw` (`transcript.py`) lấy tự động qua 3 mức: Playwright headless + cookie → (nếu YouTube đòi attestation) → Chrome thật qua CDP. Lỗi dùng `TranscriptFetchError(kind=attestation|no_transcript|generic)`; UI gợi ý dán transcript tay.
- `chunker.py` biến transcript thành các dòng `[giây] lời` và chia **N chunk động** theo độ dài video, mỗi chunk có hạn mức số segment. `generate_recap` xử lý lần lượt từng chunk, **nối ngữ cảnh** bằng bản tóm tắt chunk trước, rồi `merger.py` hợp nhất và kiểm tra tính liên tục timestamp, cuối cùng sinh caption/hashtag.
- Gemini được gọi qua **web client bằng cookie** (`ai/gemini`), không phải API công khai: có xử lý rate-limit (đợi rồi thử lại), tự **làm mới cookie** qua Chrome profile khi hết hạn (`recap_status` = `refreshing_cookie`), và vòng thử lại theo chunk (`OUTER_RETRY_DELAYS = 2/5/10 s`).
- Trạng thái đặc biệt của `recap_status`: `rate_limited`, `refreshing_cookie` (ngoài `idle/running/done/error`).

**R2: tải và cắt**
- `ytdlp.py` tải **video-only 1080p avc1** (không audio, vì giọng gốc bị thay hoàn toàn). Cờ đang chạy tốt: `--js-runtimes node --remote-components ejs:github`, **không cookie** (cookie đăng nhập có thể kích hoạt SABR-only làm mất DASH). Chỉ khi IP bị bot-wall mới retry với `yt_cookies.txt` + `player_client=mweb`. Cần yt-dlp mới (`>= 2026.8.19`).
- `ffmpeg.cut_segment`: cắt **frame-accurate**, `libx264 -preset veryfast -crf 20`, reset timestamp `setpts=PTS-STARTPTS`, bỏ audio. (Bản `-c copy` cũ gây tua nhanh/cắt cụt: xem [archive/RECAP_VIDEO_SYNC_AND_CUT_ISSUES.md](archive/RECAP_VIDEO_SYNC_AND_CUT_ISSUES.md).)

**R3: giọng đọc**
- `voice_client.tts_batch` gửi **lô 8 đoạn** (`VOICE_BATCH_SIZE`) tới `POST /tts/batch` của voice-service, nhận ZIP WAV + `manifest.json`. Mỗi lô xong ghi file ngay (`voice_<i>.wav`, ghi nguyên tử) nên merge chạy chồng được, và chạy lại **bỏ qua lô đã có file**.
- **Không `atempo`** ở đây (giọng giữ tự nhiên); đoạn nào giọng ngắn hơn 70% thời lượng đích được ghi vào `JobState.overspeed` (danh sách chỉ số "low coverage").
- Chỉ **một phiên suy luận một lúc** ở voice-service; quá `INFERENCE_WAIT_SECONDS` nhận 429.

**R4: merge**
- `mux_segment`/`cut_and_mux_segment`: ghép clip (video-only) + giọng thành `seg_<i>.mp4`, audio AAC 192k, **`apad`** nếu clip dài hơn giọng để giữ trọn cảnh quay.
- `concat_segments`: nối bằng **concat demuxer, stream copy** (nhanh). Mux dùng `-c:v copy` nên video không bị mã hóa lại ở bước này; lần mã hóa video duy nhất của Recap là lúc cắt ở R2 (`libx264 veryfast`).

**R5: polish (nhạc nền)**
- `polish_final`: chỉ động vào **audio** (BGM `amix` + ducking dưới giọng) và `-c:v copy` nên vài giây thay vì phút. Đã **bỏ watermark chữ** vì `drawtext` buộc mã hóa lại toàn bộ video.

## 4. Trạng thái, lưu trữ, sống sót qua restart

- **Job nằm trong bộ nhớ** (`state._JOBS`, `JobState` có 5 cặp `*_status` + `progress_*`). Mất khi restart, nhưng dựng lại được từ đĩa:
  - `Downloads/<job_id>/job.json` (URL, giọng, BGM, giờ tạo) ghi **ngay khi tạo job**, `recap.json`, `raw.txt`, `timings.json`, và file kết quả từng pha.
  - `service.rehydrate(job_id)` suy luận từng pha từ file trên đĩa; job chưa có video thành phẩm bị `_mark_interrupted` (pha dở → `error` kèm thông báo) để UI hiện nút *Thử lại*.
- `timing.py`: đo thời gian từng pha (transcript, cookie_check, gemini + chi tiết từng chunk, cut, voice, merge, polish, drive, total), ghi `timings.json`.
- Thư mục job (xem `paths.py`): `source/video.mp4`, `clips/clip_<i>.mp4`, `voice/voice_<i>.wav`, `merge/seg_<i>.mp4`, `final_recap.mp4`, `final_studio.mp4`.
- Cookie YouTube dự phòng: `yt_cookies.txt` (Netscape) + profile `YtProfile` (nhóm dữ liệu trong [data-and-paths.md](data-and-paths.md)).

> **Chú ý bản đóng gói**: `DOWNLOADS_DIR` và đường dẫn prompt của Recap tính từ `TOOLS_DIR/"Backend"/…`, không dùng `DATA_DIR`. Ở bản cài đặt chúng ra chỗ khác dev, và prompt có thể không được tìm thấy. Chi tiết và mức độ đã kiểm chứng: [data-and-paths.md §3](data-and-paths.md).

## 5. Frontend (`Frontend/src/features/studio/`)

| Thành phần | Vai trò |
|---|---|
| `StudioPage.tsx` | Trang *Recap & Audio*: form một nút, tiến trình các pha, hàng đợi, kết quả |
| `components/PipelineDiagram.tsx`, `BatchQueuePanel.tsx`, `VideoResultCard.tsx` | Sơ đồ pha, hàng đợi, kết quả + đăng Facebook/YouTube |
| `pollState.ts`, `timing.ts` (+ test) | Hàm thuần: quyết định khi nào dừng poll, định dạng thời gian |
| `audio/` | Khối Audio Story Studio (kho truyện, đọc chương, âm thanh & hiệu ứng, nền video) |

Test: `npm run test:audio` chỉ chạy `studio/audio/*.test.ts`. `studio/pollState.test.ts` và `studio/timing.test.ts` **chưa có script npm nào chạy**; chạy tay bằng `node --experimental-strip-types --test src/features/studio/*.test.ts` (nên thêm script `test:studio`). Backend: `python -m pytest tests/recap` (không gọi dịch vụ thật; `conftest.py` đưa mọi đường dẫn job vào thư mục tạm). Các file `manual_test_*.py` là chạy tay, **không** nằm trong bộ test tự động.

## 6. Bẫy đã gặp

- Gemini cookie hết hạn giữa chừng: có tự refresh qua Chrome profile; nếu thất bại thì `recap_status=error` ("Gemini cookie auth fail").
- `drawtext` trong ffmpeg Windows: luôn truyền `fontfile=` và dùng đường dẫn tương đối (mục 10 [README gốc](../README.md)).
- YouTube chặn thường xuyên: cập nhật yt-dlp trước khi nghi ngờ code.
- Restart backend (`npm start` tự restart khi sửa `.py`) giữa lúc Recap chạy: job thành "bị gián đoạn"; dùng *Thử lại*, hoặc `npm run start:stable` khi chạy dài.
- Sửa `service.py`: các pha chạy trong cùng event loop (`asyncio.gather`) nên **đừng chặn** (dùng `run_in_threadpool` cho việc nặng).
