# Dữ liệu nằm ở đâu (dev và bản đóng gói)

> **Hiện hành**, đối chiếu code ngày 2026-11-12. Đọc trước khi thêm bất kỳ chỗ nào ghi/đọc file, hoặc khi gặp lỗi "chạy dev được, bản cài thì không".

## 1. Tóm tắt

Backend có **5 cách khác nhau** để tính đường dẫn dữ liệu. Ở **dev** chúng gần như trùng nhau (đều ra `Backend/Data/`) nên không ai thấy khác biệt. Ở **bản đóng gói** chúng tách ra các thư mục khác nhau. Đây là nguồn lỗi tiềm ẩn lớn nhất của bản phát hành, và là việc nên dọn khi có thời gian.

Hai mốc gốc, định nghĩa ở [`Backend/app/core/config.py`](../Backend/app/core/config.py):

| | `TOOLS_DIR` | `DATA_DIR` |
|---|---|---|
| **Dev** | gốc repo | `Backend/Data/` |
| **Electron bản cài** (`APP_DATA_DIR` = `userData`) | `userData` | `userData/Data` |
| exe PyInstaller chạy lẻ, không qua Electron | `%APPDATA%/GoogleSearchApp` | `%APPDATA%/GoogleSearchApp/Data` |

`userData` là `app.getPath('userData')` của Electron.

## 2. Năm cách tính đường dẫn

| # | Cách | Dev ra | Bản cài ra | Dùng ở |
|---|---|---|---|---|
| **A** | `DATA_DIR / ...` hoặc `settings.*` (đúng) | `Backend/Data/…` | `userData/Data/…` | DB, `config.json`, profile Chrome, `chatgpt-profiles/`, `campaigns/`, `workflow_*`, `media/videos`, `watermark/` |
| **B** | `TOOLS_DIR / "Backend" / "Data" / ...` | `Backend/Data/…` | `userData/Backend/Data/…` (**khác A**) | Recap `Downloads/`, kho nhạc `media/bgm`, các file JSON của Discover, `pippit_tasks.json`, `youtube_tasks.json`, `youtube_uploads/` |
| **C** | `TOOLS_DIR / "Data" / ...` | `Data/…` ở **gốc repo** | `userData/Data/…` (trùng A) | Thư mục audio `media/videos/Viaudio` (`media/audio_workflow.py`) |
| **D** | Tính từ `__file__` (`Backend/Data/…`) | `Backend/Data/…` | **bên trong thư mục giải nén tạm của PyInstaller** | Veo (`veo_outputs`, `veo_images`, `veo_uploads`, `veo_jobs.json`, `veo_media_registry.json`, `veo_references`, `motion_uploads`, `veo_images_clean`), `motion_long`, `muse_uploads` |
| **E** | Đường dẫn tương đối theo thư mục làm việc | `Backend/Data/…` (cwd = `Backend/`) | cwd của exe | `externals/gdrive`: `Path("Data")/"temp_gdrive"` |

Hai ngoại lệ nhỏ cũng nên biết: `raw.txt` và `response.txt` (kết quả Gemini ở Recap) được ghi vào `TOOLS_DIR` (gốc repo khi dev); `Backend/app/watermark` dùng `DATA_DIR/watermark` (đúng, nhóm A).

Dữ liệu **không** nằm ở các chỗ trên: voice service có nơi riêng (dev `services/data/{models,voices}`, bản cài `userData/voice_data/models`), và trạng thái job Recap chỉ ở bộ nhớ (xem [recap.md](recap.md)).

## 3. Chỗ nào đã xác nhận, chỗ nào chưa

**Đã xác nhận (đọc code + bản cài cũ trên máy dev):** nhóm B tồn tại thật. Thư mục `userData` của bản cài hiện có `Data/` (nhóm A: `app.db`, `config.json`, `watermark/`…) **và** `Backend/Data/` riêng (nhóm B: `media/bgm/`, `channels_cache.json`, `pippit_tasks.json`).

**Nghi vấn, chưa kiểm chứng bằng bản đóng gói hiện tại** (cần chạy bản cài mới để xác nhận trước khi sửa):

1. **Prompt của Recap/Discover/Workflow có thể không tìm thấy.** Chúng đọc từ `TOOLS_DIR/"Backend"/"prompts"/…` (ví dụ `recap/service.py:82`, `ai/gemini/recap.py:27`, `workflow/service.py:63`, `discover/scout.py:10`). Bản cài đặt `TOOLS_DIR = userData`, mà thư mục `userData/Backend/prompts` không có (bản cài cũ trên máy dev không có). `electron-builder` copy `Backend/prompts` vào `resources/prompts` và PyInstaller đóng gói `prompts/` vào bundle, nhưng không thấy mã nào đọc các vị trí đó cho các module này. Kỳ vọng nếu đúng: Recap báo `500 Không tìm thấy system prompt`. **Ngược lại**, Chiến dịch AI dùng `Path(__file__)/prompt_defaults` + `datas` của PyInstaller nên ổn, và `fonts.py`/`assemble.py`/`stories` có nhánh `sys._MEIPASS`.
2. **Dữ liệu Veo có thể ghi vào thư mục tạm.** Nhóm D tính từ `__file__`; trong exe PyInstaller `backend.spec` (chế độ **một file**, `runtime_tmpdir=None`) đó là thư mục giải nén tạm, bị xóa khi thoát. Nếu đúng: video Flow tải về và `veo_jobs.json` mất sau khi đóng app.
3. **Backend `workflow` và `veo` có thể nhìn hai thư mục khác nhau.** `workflow/service.py` đặt `VEO_DATA_DIR = DATA_DIR/"media"/"veo_outputs"` (nhóm A) trong khi `veo/service.py` ghi vào nhóm D. Dev trùng nhau, bản cài thì không.

Nếu bạn xác nhận được bằng bản cài mới, hãy cập nhật mục này (đổi "nghi vấn" thành "đã xác nhận" hoặc xóa).

## 4. Quy tắc cho code mới

1. **Mọi dữ liệu ghi lúc chạy → `DATA_DIR`** (`from app.core.config import DATA_DIR`). Đừng dùng `TOOLS_DIR/"Backend"/…`, `Path(__file__)…/"Data"`, hay đường dẫn tương đối.
2. **File đi kèm ứng dụng, chỉ đọc** (prompt, font, resource) → tìm theo `Path(__file__)` **và** `sys._MEIPASS` như `media/fonts.py`, và nhớ khai báo trong `backend.spec` (`datas`).
3. Cấu hình người dùng → `read_config()`/`write_config()` (`app/core/storage.py`, file `config.json`), không tạo file JSON rời trừ khi có lý do.
4. Bảng SQLite → tạo bằng `ensure_*_table(s)` gọi trong `lifespan`, `Base.metadata.create_all` (không dùng Alembic cho bảng mới; Alembic chỉ có 0001–0006).
5. Test không được ghi vào `Backend/Data` thật. Mẫu hiện có: `tests/recap/conftest.py` (fixture autouse `monkeypatch` mọi hàm đường dẫn job sang `tmp_path`) và `tests/campaign/conftest.py` (SQLite tạm + executor giả). Hiện chưa có fixture dùng chung đặt `APP_DATA_DIR`; vì `DATA_DIR` được tính lúc import nên cách dễ nhất là patch hằng số đường dẫn của module đang test.
6. Khi sửa đường dẫn cũ, **di chuyển dữ liệu của người dùng đang có** (hoặc đọc cả hai chỗ) — người dùng bản cài đã có dữ liệu ở nhóm B/D.

## 5. Bản đồ thư mục `DATA_DIR` ở dev (`Backend/Data/`)

Ví dụ thực tế (một số mục có thể chưa có trên máy bạn):

| Mục | Nội dung | Nhóm |
|---|---|---|
| `app.db` (+ `-wal`, `-shm`) | SQLite: veo_projects, veo_images, voices, bgm, stories, campaign (6 bảng)… | A |
| `config.json` | Cookie Gemini, cấu hình Muse/Pippit/Drive/YouTube/Mail.tm — **nhạy cảm, đã ignore** | A |
| `ChromeProfile/`, `ChromeProfile_Muse/`, `YtProfile/`, `yt_cookies.txt` | Profile Chrome (Playwright), cookie YouTube dự phòng | A |
| `chatgpt-profiles/`, `chatgpt_accounts.json` | Tài khoản ChatGPT và profile | A |
| `campaigns/<id>/`, `exports/` | Artifact và gói xuất của Chiến dịch AI | A |
| `workflow_assets/`, `workflow_exports/`, `workflow_voiceovers/` | Canvas AI | A |
| `media/videos/`, `media/test_images/` | Video nhập (trang Video), ảnh thử | A |
| `watermark/` | Job và file upload của Xóa Watermark | A |
| `Downloads/<job_id>/` | Recap: `source/`, `clips/`, `voice/`, `merge/`, `final_recap.mp4`, `recap.json`, `timings.json` | B |
| `media/bgm/` | Kho nhạc nền | B |
| `channels_cache.json`, `discover_seen.json`, `processed_history.json`, `saved_channels.json` | Khám Phá Kênh | B |
| `pippit_tasks.json`, `youtube_tasks.json`, `youtube_uploads/` | Lịch đăng | B |
| `media/veo_outputs/`, `veo_images/`, `veo_uploads/`, `veo_jobs.json`, `veo_media_registry.json` | Video/ảnh Flow và sổ job | D |
| `motion_long/` | Job Motion dài | D |
| `Data/media/videos/Viaudio/` (ở **gốc repo**) | Audio Workflow: video `*.mp4`, `outputs.json` (manifest, có tiêu đề/mô tả/mốc chương), `audio_history.json` ("đã làm" theo chương), `thumbnails/`, `covers/` (ảnh bìa nguồn đã tải), `.cache/voice/` (giọng đọc từng chương: wav + thời lượng từng dòng; xóa được, chỉ mất cache), `logos/`, `previews/` | C |
| `temp_gdrive/` | File tạm khi đồng bộ Drive | E |
| `backups/`, `test_cdp_profile/`, `logs/` | Bản sao tay, thử nghiệm, log | (thủ công) |
