# Báo Cáo Phân Tích & Giải Pháp: Lỗi Tua Nhanh và Cắt Cụt Hình Video Recap (Video Sync & Cut Issues)

> **ĐÃ LƯU TRỮ (2026-11-12), chỉ để tham khảo lịch sử.** Phân tích lỗi tua nhanh/cắt cụt; giải pháp 1 (cắt frame-accurate bằng libx264 veryfast) đã áp dụng ở `cut_segment`. Các mục còn lại trong checklist chưa được đối chiếu lại với code. Hiện hành: code `Backend/app/recap/ffmpeg.py`, `Backend/app/recap/timing.py`. Đường dẫn file và số dòng trong tài liệu phản ánh thời điểm viết.


Tài liệu này ghi nhận nguyên nhân gốc rễ (Root Cause Analysis), số liệu thực tế đo đạc từ quá trình render video thử nghiệm ([Mark Wiens Mexico City](https://www.youtube.com/watch?v=OO9kSxcT9Rg)), và đề xuất giải pháp kỹ thuật toàn diện để fix triệt để trong các giai đoạn tiếp theo.

---

## 1. Hiện Tượng Thực Tế (Observed Problems)

Khi xem video recap thành phẩm (`final_recap.mp4`), xuất hiện 2 vấn đề lớn gây khó chịu cho người xem:
1. **Hiện tượng "Tua nhanh" (Fast-forward / Giật khung hình)**:
   - Trong 1–2 giây đầu của nhiều phân đoạn, hình ảnh bị phóng nhanh bất thường hoặc khựng lại rồi giật nhảy frame để bắt kịp âm thanh.
2. **Hiện tượng "Cắt cụt hình giữa chừng" (Abrupt Scene Cutting)**:
   - Nhiều cảnh quay nấu nướng/hành động của nhân vật đang diễn ra hấp dẫn (mới chỉ vừa nhấc dao, chuẩn bị ăn...) thì video đột ngột bị cắt phụt và nhảy sang cảnh khác, làm mất đi 50%–80% thời lượng diễn biến thị giác.

---

## 2. Phân Tích Nguyên Nhân Gốc Rễ (Root Cause Analysis)

### 🚨 Nguyên Nhân 1: Cắt video theo độ dài Voice TTS ("VO drives duration") làm vứt bỏ tới 60% cảnh quay

Trong quy trình hiện tại (`Backend/app/recap/service.py` & `ffmpeg.py`):
```python
# Code hiện tại:
voice_dur = ffprobe_duration(vo)          # TTS đọc 25 từ chỉ mất ~7.5s
end = min(start + voice_dur, source_dur)  # Video bị cắt ngay tại start + 7.5s
cut_segment(source, start, end, clip)
```

#### Số liệu đo đạc thực tế trên video test 60 segments:
| Segment | Khung hình LLM chọn (`start -> end`) | Target Duration | Voice TTS thực tế | Thời lượng video BỊ CẮT MẤT |
| :---: | :---: | :---: | :---: | :---: |
| **#06** | `95.0s` $\rightarrow$ `112.0s` | **17.0s** | **7.5s** | 🔻 **Mất 9.5s** |
| **#07** | `150.0s` $\rightarrow$ `168.0s` | **18.0s** | **8.0s** | 🔻 **Mất 10.0s** |
| **#12** | `383.0s` $\rightarrow$ `403.0s` | **20.0s** | **7.4s** | 🔻 **Mất 12.6s** |
| **#18** | `555.0s` $\rightarrow$ `576.0s` | **21.0s** | **7.8s** | 🔻 **Mất 13.2s** |
| **#28** | `739.0s` $\rightarrow$ `794.0s` | **55.0s** | **6.7s** | 🔻 **Mất 48.3s** *(Cắt mất 88% cảnh)* |
| **#36** | `1000.0s` $\rightarrow$ `1043.0s`| **43.0s** | **8.2s** | 🔻 **Mất 34.8s** |
| **#40** | `1139.0s` $\rightarrow$ `1183.0s`| **44.0s** | **7.8s** | 🔻 **Mất 36.2s** |

**Hậu quả**:
- Tổng thời lượng cảnh quay hình ảnh mà LLM đã dày công chọn lọc là **1266 giây (21.1 phút)**.
- Nhưng vì mỗi câu voice tiếng Việt chỉ dài 20–25 từ (đọc trong 6–8s), thuật toán cắt đã **chém cụt** toàn bộ các đoạn đuôi, khiến video chỉ còn **451 giây (7.5 phút)**.
- Người xem có cảm giác video bị "hối hả", cảnh quay nào cũng bị đứt gãy lưng chừng.

---

### ⚡ Nguyên Nhân 2: Lỗi tua nhanh do Stream-Copy (`-c copy`) và lệch Keyframe (I-Frame)

Trong `Backend/app/recap/ffmpeg.py`:
```python
cmd = [
    "ffmpeg", "-y",
    "-ss", f"{start_sec:.3f}",
    "-i", str(video),
    "-t", f"{dur:.3f}",
    "-c", "copy",   # <--- Stream copy không giải mã/mã hóa lại video
    str(out),
]
```

#### Cơ chế gây lỗi kỹ thuật:
1. **Keyframe Snapping**:
   - Video nén H.264 của YouTube chỉ có I-frame (Keyframe) mỗi **2–5 giây**.
   - Với `-c copy`, FFmpeg không thể cắt tại giây lẻ (ví dụ `383.4s`). Nó buộc phải lùi về Keyframe gần nhất trước đó (ví dụ `380.0s`).
2. **Lệch pha PTS/DTS Container**:
   - Timestamp bắt đầu của video không đồng nhất giữa các clip.
   - Khi ghép 60 clips lại bằng `concat demuxer`, trình phát video nhận thấy video stream bị lệch so với audio stream $\rightarrow$ nó kích hoạt cơ chế **drop frames / tua nhanh tốc độ cao** ở đầu mỗi phân đoạn để hình đuổi kịp tiếng.

---

### 📝 Nguyên Nhân 3: LLM chọn cửa sổ quá dài ở Chunk 2 & 3 (Vượt quá 18s)

- Ở Chunk 0 & 1, quy tắc Elastic Pacing được tuân thủ khá tốt (mỗi segment dài 10–20s).
- Nhưng ở Chunk 2 & 3, LLM bắt đầu chọn các khoảng timestamp quá rộng (từ 30s đến 55s cho 1 segment, ví dụ Seg #28 dài 55s), trong khi voice chỉ viết 1 câu ngắn.
- Khi khoảng cách giữa thời lượng hình ảnh (55s) và thời lượng tiếng (6.7s) quá lớn, việc cắt video theo tiếng trở thành thảm họa thị giác.

---

## 3. Đề Xuất Giải Pháp Kỹ Thuật (Action Plan)

### 🛠️ Giải pháp 1: Chuyển sang Cắt Frame-Accurate với Re-encode nhẹ (`libx264 veryfast`)

Thay vì dùng `-c copy` (dễ lỗi timestamp), chuyển sang cắt chính xác từng khung hình:

```python
def cut_segment_accurate(video: Path, start_sec: float, end_sec: float, out: Path) -> Path:
    dur = max(0.0, end_sec - start_sec)
    cmd = [
        "ffmpeg", "-y",
        "-ss", f"{start_sec:.3f}",
        "-i", str(video),
        "-t", f"{dur:.3f}",
        "-vf", "setpts=PTS-STARTPTS",           # Reset timestamp về chuẩn 0
        "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
        "-an",                                  # Tách sạch audio cũ
        str(out),
    ]
    ...
```
- **Ưu điểm**:
  - Triệt tiêu $100\%$ hiện tượng tua nhanh, giật hình, khựng frame ở đầu clip.
  - Cắt chính xác đến từng mili-giây (`0.001s`).
  - Tốc độ `-preset veryfast` vẫn cực nhanh (~10–15s cho cả 60 clip).

---

### 🛠️ Giải pháp 2: Đồng bộ hóa Thời lượng Hình ảnh & Tiếng nói (Smart Duration Sync)

Có 2 chiến lược kết hợp để hình ảnh không bị cắt cụt:

#### Cách tiếp cận A: Giữ trọn vẹn cảnh quay + Đệm âm thanh môi trường (Ambient Sound / BGM)
- Nếu cảnh quay dài **15 giây** và Voice TTS chỉ đọc hết **8 giây**:
  - **Không cắt video xuống 8 giây**!
  - Cho video chạy trọn vẹn **15 giây**.
  - 8 giây đầu: Voice TTS đọc trên nền âm thanh gốc (hoặc BGM) đã hạ âm lượng.
  - 7 giây sau: Voice dừng lại, để người xem thưởng thức trọn vẹn hình ảnh hành động cùng tiếng xèo xèo/ASMR của video gốc (hoặc nhạc nền BGM).

#### Cách tiếp cận B: Siết chặt Quota độ dài từ LLM Prompt (Word-to-Duration Density)
- Nhắc LLM trong Prompt: Số lượng từ của `vietnamese_vo` phải tương xứng với `duration_sec`:
  $$\text{Số lượng từ mong muốn} \approx \text{duration\_sec} \times 2.8\text{ đến }3.0\text{ từ/giây}$$
- Với cảnh nấu ăn dài 15s: Viết kịch bản khoảng **40–45 từ** thay vì 20 từ.
- Bắt buộc LLM chia nhỏ các đoạn > 18s thành các segment liên tiếp thay vì gom thành 1 đoạn 55s.

---

## 4. Bảng Kế Hoạch Triển Khai (Checklist)

- [ ] **Prompt Template**: Thêm ràng buộc cứng: Cấm LLM chọn `duration_sec > 20s`; tự động tách thành các segment nhỏ nối tiếp.
- [ ] **Prompt Template**: Nâng mật độ từ vựng tiếng Việt tương ứng với thời lượng cảnh để TTS đọc phủ kín thời lượng clip.
- [ ] **FFmpeg Module (`ffmpeg.py`)**: Nâng cấp `cut_segment` từ `-c copy` sang `-c:v libx264 -preset veryfast -vf setpts=PTS-STARTPTS`.
- [ ] **Merge Module (`service.py`)**: Hỗ trợ chế độ giữ nguyên thời lượng clip gốc (`target_dur`) và tự động chèn audio gốc / BGM vào phần đuôi khi voice đọc xong sớm.
- [ ] **Testing**: Chạy lại render trên video test `OO9kSxcT9Rg` để kiểm tra độ mượt mà của video sau fix.

---
*Tài liệu được tạo tự động để lưu trữ context cho việc tối ưu hóa pipeline recap.*
