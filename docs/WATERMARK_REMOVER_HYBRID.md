# Watermark Remover - Hybrid Mode (Path + Upload)

## 🎯 Vấn đề ban đầu

**Lỗi**: `"Không tìm thấy file MP4 hợp lệ tại các đường dẫn: ['Cooking_garlic_butter_shrimp_202608232323.mp4']"`

**Nguyên nhân**: Frontend đang gửi TÊN FILE thay vì ĐƯỜNG DẪN TUYỆT ĐỐI lên backend. Browser không có quyền truy cập filesystem để lấy `file.path`.

## ✅ Giải pháp: Hybrid Mode

Hệ thống giờ hỗ trợ **2 mode tự động**:

### 1️⃣ Path Mode (Electron / Desktop App)
- **Cách dùng**: Kéo thả file HOẶC click "Nhập đường dẫn file"
- **Backend**: `/api/watermark/process` với JSON `{paths: [...]}`
- **Flow**: 
  ```
  User chọn file → Electron API lấy native path 
  → Frontend gửi path → Backend gọi gwr trực tiếp trên file gốc
  → Output: folder_clean/
  ```

### 2️⃣ Upload Mode (Web Browser)
- **Cách dùng**: Kéo thả file hoặc click "duyệt chọn từ máy"
- **Backend**: `/api/watermark/upload` với multipart/form-data
- **Flow**:
  ```
  User chọn file → Frontend upload file
  → Backend lưu vào Data/watermark/uploads/{job_id}/
  → Chạy gwr trên file đã upload
  → Output: folder_clean/
  ```

## 🔄 Auto-detection Logic

```typescript
// Frontend tự động phát hiện mode
const hasFileObjects = queue.some(q => q.file)
const hasValidPaths = queue.some(q => q.path && q.path !== q.name)

if (hasFileObjects && !hasValidPaths) {
  // → UPLOAD MODE (gửi FormData)
  const formData = new FormData()
  formData.append('files', file)
  fetch('/api/watermark/upload', { body: formData })
} else {
  // → PATH MODE (gửi JSON)
  fetch('/api/watermark/process', { 
    body: JSON.stringify({ paths: [...] })
  })
}
```

## 📁 File Structure

```
Backend/app/watermark/
├── router.py          # Thêm endpoint POST /upload
├── service.py         # Thêm _generate_job_id()
├── state.py           # Không đổi
└── schemas.py         # Không đổi

Frontend/src/
└── main.tsx
    ├── type QueuedFile { file?: File }  # Thêm field file
    ├── handleAddFiles()   # Lưu File object
    └── handleStartProcess()  # Auto-detect mode

Data/watermark/
└── uploads/
    └── {job_id}/      # Upload files tạm thời
        └── video.mp4
```

## 🚀 Testing

### Test Upload Mode (Browser)
1. Mở app trong browser (không phải Electron)
2. Kéo thả file MP4 vào ô "Kéo & thả video"
3. Click "Bắt đầu xóa watermark"
4. ✅ File được upload → xử lý thành công

### Test Path Mode (Electron)
1. Chạy app trong Electron
2. Kéo thả file HOẶC click "Nhập đường dẫn file"
3. Nhập: `C:\Users\...\video.mp4`
4. ✅ Backend xử lý trực tiếp từ path gốc

### Test thư mục
1. Click "Nhập đường dẫn file"
2. Nhập đường dẫn thư mục: `C:\Users\...\Videos\fl1`
3. ✅ Backend scan tất cả file *.mp4 trong thư mục

## 📊 API Endpoints

### `POST /api/watermark/process` (Path mode)
**Request**:
```json
{
  "paths": [
    "C:/Users/nguye/Videos/fl1/video1.mp4",
    "C:/Users/nguye/Videos/fl1/"  // Hỗ trợ thư mục
  ]
}
```

**Response** (202):
```json
{
  "job_id": "a1b2c3d4e5f6",
  "total": 3,
  "files": ["video1.mp4", "video2.mp4", "video3.mp4"]
}
```

### `POST /api/watermark/upload` (Upload mode)
**Request**: `multipart/form-data`
- Field: `files` (multiple)

**Response** (202):
```json
{
  "job_id": "f6e5d4c3b2a1",
  "total": 2,
  "files": ["cooking.mp4", "recipe.mp4"]
}
```

## 🔒 Security

- Upload files lưu trong `Data/watermark/uploads/{job_id}/` (isolated per job)
- Path traversal protection: reject paths có `..` / `/` / `\` trong filename
- File validation: chỉ chấp nhận `.mp4` extension

## ⚡ Performance

| Mode | Upload Time | Processing | Total |
|------|-------------|------------|-------|
| Path | 0s (no upload) | ~1-3 min/video | Fast ⚡ |
| Upload | ~10-30s/GB | ~1-3 min/video | Slower 🐌 |

**Khuyến nghị**: Dùng Path mode nếu có thể (Electron app)

## 🐛 Troubleshooting

### Lỗi: "Không tìm thấy file MP4 hợp lệ"
- ✅ **Giải pháp**: App tự động chuyển sang Upload mode
- Hoặc click "Nhập đường dẫn file" và paste đường dẫn tuyệt đối

### Lỗi: "gwr CLI chưa được cài"
```bash
npm install -g @pilio/gemini-watermark-remover
```

### File upload quá lớn
- Giới hạn: Không có (nhưng nên < 2GB cho hiệu suất tốt)
- Nếu quá lớn → dùng Path mode thay vì upload

## 📝 Notes

- ✅ Upload files KHÔNG tự động xóa sau khi xử lý (để re-run nếu cần)
- ✅ Output files vẫn lưu trong `folder_clean/` cạnh file gốc
- ✅ Download endpoint không đổi: `GET /api/watermark/download/{job_id}/{filename}`
