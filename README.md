# Google Search Studio - Video & Automation Tools (ytb_v1)

![Giao diện ứng dụng](./assets/ui.png)

Google Search Studio là ứng dụng desktop tích hợp toàn diện cho việc tự động hóa sáng tạo video, bao gồm AI Workflow (sản xuất video sản phẩm từ ảnh và kịch bản), Motion Control Studio (điều khiển chuyển động video AI theo video tham chiếu), Veo Studio, Pipeline Video Recap tự động từ YouTube (R1-R4), Lồng tiếng tiếng Việt VieNeu-TTS và Công cụ xóa Watermark AI (Google SynthID).

---

## 1. Yêu cầu hệ thống (Prerequisites)

Trước khi bắt đầu cài đặt, máy tính cần cài đặt sẵn các công cụ sau:

- Node.js: Phiên bản 20.x trở lên (khuyến nghị 22.x LTS).
- Python: Phiên bản 3.11 trở lên (bản 64-bit).
- FFmpeg: Đã cài đặt và thêm vào biến môi trường PATH của hệ thống (kiểm tra bằng lệnh `ffmpeg -version`).
- Trình duyệt Google Chrome: Dùng để đăng nhập Google Flow / Veo và nạp tiện ích mở rộng (Extension).
- Git: Dùng để tải và đồng bộ mã nguồn.

---

## 2. Hướng dẫn cài đặt dự án (Core Setup)

Dự án gồm 3 phần chính: Backend (FastAPI), Voice Service (VieNeu-TTS), và Frontend (Electron + React).

### Bước 2.1: Tải mã nguồn
```bash
git clone https://github.com/ttienzy/ytb_v1.git
cd ytb_v1
```

### Bước 2.2: Cài đặt Backend (Python)
```bash
cd Backend
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
cd ..
```

### Bước 2.3: Cài đặt Voice Service (VieNeu-TTS)
```bash
cd services/voice-service
pip install -r requirements.txt
cd ../..
```

### Bước 2.4: Cài đặt Frontend (Electron & React)
```bash
cd Frontend
npm install
cd ..
```

### Bước 2.5: Khởi chạy ứng dụng
Có 2 cách để khởi chạy ứng dụng:

- Cách 1 (Khuyên dùng - Chạy tất cả dịch vụ cùng lúc):
```bash
npm start --prefix Desktop
```
Lệnh trên sẽ tự động khởi động Backend (cổng 8000), Voice Service (cổng 8001) và giao diện Desktop Electron.

- Cách 2 (Khởi chạy thủ công trên từng cửa sổ dòng lệnh):
  - Cửa sổ 1 (Backend):
    ```bash
    cd Backend
    .\.venv\Scripts\activate
    python run_server.py
    ```
  - Cửa sổ 2 (Voice Service):
    ```bash
    cd services/voice-service
    python run_server.py
    ```
  - Cửa sổ 3 (Frontend Electron):
    ```bash
    cd Frontend
    npm run dev
    ```

---

## 3. Hướng dẫn thiết lập chi tiết theo từng mục Sidebar

Thanh điều hướng Sidebar tổ chức các tính năng theo từng module độc lập. Dưới đây là thứ tự các mục người dùng cần cấu hình để khai thác đầy đủ các tính năng:

### Mục 1: Cài đặt (Settings) - Thiết lập nền tảng bắt buộc
Trước khi bắt đầu sáng tạo video, truy cập mục Cài đặt để kết nối các tài nguyên:
- Tab Gemini & YouTube:
  - Nhập Cookie tài khoản Google Gemini Web hoặc bấm đăng nhập qua Chrome để tự động lưu cookie.
  - Phục vụ cho: Sinh kịch bản recap R1 và phân tích sản phẩm trong AI Workflow.
- Tab LLM Agent (9router):
  - Nhập API Key 9router hoặc OpenAI (tùy chọn thay thế cho Gemini Web).
  - Phục vụ cho: Phân tích thị giác hình ảnh sản phẩm và sinh kịch bản bán hàng góc độ tiếp thị.
- Tab Google Veo:
  - Cung cấp trạng thái kết nối và hướng dẫn cài đặt tiện ích mở rộng tạo video.
- Tab Google Drive (Tùy chọn):
  - Nhập thông tin OAuth để tự động sao lưu video sau khi hoàn thành hoặc sau khi xóa watermark lên Google Drive cá nhân.
- Tab Pippit & YouTube (Nếu sử dụng tính năng đăng bài tự động):
  - Cung cấp token kết nối Fanpage Facebook / TikTok qua Pippit hoặc Google API Key xuất bản YouTube.

### Mục 2: Cài đặt Extension Chrome (FlowsVeo-Clean)
Tiện ích mở rộng đóng vai trò cầu nối trung gian giữa ứng dụng Desktop và giao diện web Google Flow / Veo (tự động điền prompt, upload media tham chiếu, lấy link video kết quả):
1. Mở trình duyệt Google Chrome, truy cập: `chrome://extensions/`
2. Bật công tắc "Developer mode" (Chế độ dành cho nhà phát triển) ở góc trên bên phải.
3. Bấm nút "Load unpacked" (Tải tiện ích đã giải nén) và chọn thư mục:
   `Extensions/FlowsVeo-Clean`
4. Mở tab Google Flow trên trình duyệt Chrome và đăng nhập sẵn tài khoản Google có quyền sử dụng Veo / Flow.

### Mục 3: AI Workflow
Quy trình canvas trực quan tạo video quảng cáo, review sản phẩm từ ảnh và kịch bản:
- Thiết lập cần có:
  - Đã có Cookie Gemini hoặc 9router API Key (cấu hình trong mục Cài đặt).
  - Đã nạp tiện ích Chrome FlowsVeo-Clean (nếu chọn render video qua Veo).
  - Voice Service đang chạy trên cổng 8001 (nếu sử dụng lồng tiếng Brand Voice).
- Cách sử dụng:
  - Kéo thả ảnh sản phẩm, nhân vật, bối cảnh vào node Product Assets.
  - Bấm phân tích sản phẩm bằng AI -> Sinh danh sách kịch bản -> Gửi render phân cảnh Veo -> Lồng tiếng VieNeu-TTS -> Trộn nhạc nền BGM -> Xuất video hoàn chỉnh vào Thư viện.

### Mục 4: Workflow (Motion Control Studio)
Không gian làm việc chuyên sâu về điều khiển chuyển động video AI theo video tham chiếu:
- Thiết lập cần có:
  - Đã nạp tiện ích Chrome FlowsVeo-Clean và mở sẵn trang Google Flow.
- Tính năng:
  - Tải lên video mẫu chuyển động và ảnh nhân vật / bối cảnh.
  - Trích xuất khung hình đầu và khung hình cuối làm điểm neo.
  - Tự động đồng bộ mô tả chuyển động với các preset phong cách (Camera, Lighting, Motion).
  - Hỗ trợ tạo từ 1 đến 4 biến thể song song với cơ chế cô lập lỗi độc lập theo từng slot và tính năng Thử lại riêng từng biến thể (Retry Single Variant) mà không phải upload lại file mẫu.

### Mục 5: Veo Studio
Không gian sáng tạo video Veo AI độc lập:
- Thiết lập cần có:
  - Đã nạp tiện ích Chrome FlowsVeo-Clean trên trình duyệt.
- Tính năng:
  - Hỗ trợ tạo video từ văn bản (Text-to-Video) và tạo video từ ảnh (Image-to-Video).
  - Xem và quản lý thư viện clip Veo đã kết xuất.

### Mục 6: Video (Recap Studio R1-R4)
Quy trình tự động hóa 4 bước tạo video recap đánh giá phim, truyện từ URL YouTube:
- Thiết lập cần có:
  - FFmpeg đã có trong PATH hệ thống.
  - Cookie Gemini đã nhập trong Cài đặt hoặc file `Backend/Data/config.json`.
  - Voice Service đang chạy ở cổng 8001.
- Quy trình:
  - R1: Lấy phụ đề transcript YouTube và sinh kịch bản tóm tắt hấp dẫn.
  - R2: Tải video và cắt clip chính xác từng phân đoạn bằng yt-dlp và FFmpeg.
  - R3: Lồng tiếng tiếng Việt VieNeu-TTS tự động co giãn nhịp điệu (atempo) khớp từng phân cảnh.
  - R4: Muxing âm thanh, chuẩn hóa âm lượng và ghép thành video hoàn chỉnh.

### Mục 7: Xóa Watermark (AI Inpainting)
Công cụ loại bỏ logo watermark và SynthID mờ trên video và ảnh bằng AI:
- Yêu cầu cài đặt môi trường runtime (thực hiện một lần duy nhất):
  ```bash
  cd Frontend/watermark-runtime
  npm install
  npx playwright install chromium
  cd ../..
  ```
- Kiểm tra: Mở mục Xóa Watermark trên thanh Sidebar, kiểm tra thông báo "Công cụ watermark tích hợp đã sẵn sàng cho ảnh và video".
- Tính năng:
  - Xóa watermark hàng loạt cho danh sách file video và ảnh.
  - Hỗ trợ tùy chọn tải video sạch trực tiếp trong modal Thư Viện Video Đã Xuất (kèm thanh tiến trình đếm số khung hình real-time, hỗ trợ cả bản có tiếng và bản tắt tiếng Mute).

### Mục 8: Voices (Quản lý giọng đọc)
- Thiết lập cần có: Voice Service đang chạy trên cổng 8001.
- Sử dụng: Nghe thử hơn 20 giọng đọc tiếng Việt VieNeu-TTS (Nam/Nữ, Bắc/Trung/Nam), tùy chỉnh tốc độ và cao độ. Không cần cấu hình gì thêm.

### Mục 9: Thư viện nhạc (BGM Library)
- Sử dụng: Tải trực tiếp các bản nhạc nền (.mp3, .wav) lên thư viện để dùng cho AI Workflow và Video Recap. Không yêu cầu cấu hình thêm.

### Mục 10: Khám Phá Kênh (Channel Discovery)
- Sử dụng: Tìm kiếm kênh, theo dõi số liệu và phân tích danh sách video YouTube qua yt-dlp. Chạy trực tiếp, không cần cấu hình thêm.

### Mục 11: Crawl truyện (Stories Crawler)
- Sử dụng: Thu thập nội dung truyện chữ từ các nguồn web để chuyển thể thành kịch bản video. Chạy trực tiếp, không cần cấu hình thêm.

### Mục 12: Lên lịch Pippit & Lên lịch Youtube
- Thiết lập cần có: Đăng nhập tài khoản và cấu hình token/kênh trong mục Cài đặt (tab Pippit hoặc tab YouTube).
- Sử dụng: Quản lý hàng đợi và lên lịch phát hành video tự động lên TikTok, Facebook và YouTube.

### Mục 13: Dashboard & Lịch sử
- Sử dụng: Theo dõi tổng quan tiến độ đăng video trong ngày, tình trạng sức khỏe các kênh, tra cứu lịch sử render video. Tự động cập nhật theo dữ liệu thực tế, không cần cấu hình thêm.

---

## 4. Kiểm thử hệ thống (Testing & Verification)

Để đảm bảo toàn bộ hệ thống hoạt động ổn định và không phát sinh lỗi, chạy các lệnh kiểm thử sau:

```bash
# Kiểm thử Frontend build và unit tests
cd Frontend
npm run build
npm test -- --run

# Kiểm thử Backend unit tests
cd ../Backend
python -m unittest tests/test_watermark_runtime.py tests/workflow/test_motion_config.py tests/workflow/test_workflow_clean.py
```

---

## 5. Cấu trúc thư mục mã nguồn

```
.
├── Backend/                   # Máy chủ FastAPI (Python 3.11+)
│   ├── app/
│   │   ├── ai/                # Gemini Web client, 9router vision
│   │   ├── recap/             # Engine Video Recap R1-R4, yt-dlp, FFmpeg
│   │   ├── veo/               # API Veo AI, Media Registry, Bridge kết nối Extension
│   │   ├── watermark/         # Engine inpainting xóa watermark (GWR)
│   │   └── workflow/          # API & Service cho AI Workflow Canvas & Motion Control
│   ├── prompts/               # Prompt mẫu sản phẩm, kịch bản, chuyển động
│   └── run_server.py          # Điểm khởi chạy máy chủ Backend độc lập
├── Frontend/                  # Giao diện ứng dụng Desktop (Electron + React + Vite)
│   ├── src/
│   │   ├── features/          # Các màn hình theo Sidebar (workflow, veo-studio, settings...)
│   │   └── components/        # Layout, Sidebar, Modal chung
│   └── watermark-runtime/     # Runtime cài đặt Playwright & gemini-watermark-remover
├── services/voice-service/    # Máy chủ TTS tiếng Việt độc lập (VieNeu-TTS ONNX, cổng 8001)
├── Extensions/FlowsVeo-Clean/ # Tiện ích Chrome mở rộng kết nối Google Flow / Veo
├── Desktop/                   # Trình khởi chạy đa tiến trình cho toàn bộ ứng dụng (npm start)
└── assets/                    # Thư mục chứa hình ảnh tài nguyên (ui.png)
```

---

## 6. Giấy phép (License)

Dự án được phát hành theo giấy phép MIT License. Xem file [LICENSE](LICENSE) để biết thêm chi tiết.
