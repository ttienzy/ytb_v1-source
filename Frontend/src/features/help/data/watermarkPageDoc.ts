import type { HelpDoc } from '../model.ts'

export const watermarkPageDoc: HelpDoc = {
  pageId: 'Xóa Watermark',
  title: 'Xóa Watermark (Gemini / Veo)',
  summary:
    'Tự động loại bỏ watermark hiển thị của Gemini/Veo trên ảnh (PNG, JPG, JPEG, WEBP) và video (MP4, MOV, WEBM). Chỉ xóa được watermark ở đúng vị trí chuẩn của clip gốc: video đã crop, phóng to hoặc ghép lại thường bị từ chối.',
  verifiedAt: '2026-11-12',
  requires: [
    {
      label: 'Watermark runtime đã cài',
      fixHint: 'Bản đóng gói đã kèm sẵn. Khi chạy dev cần cài một lần: vào Frontend/watermark-runtime, chạy npm install rồi npx playwright install chromium. Thiếu thì báo “Công cụ xử lý watermark chưa sẵn sàng”.',
    },
    {
      label: 'Google Drive (tùy chọn)',
      fixPage: 'Cài đặt',
      fixHint: 'Chỉ cần nếu bạn muốn đồng bộ kết quả sạch lên Drive.',
    },
  ],
  start: [
    {
      title: 'Chọn tab Hình ảnh hoặc Video',
      do: 'Hai tab ở đầu trang. Ảnh hỗ trợ mọi tỷ lệ (9:16, 1:1, 16:9, 3:4); video hỗ trợ MP4, MOV, WEBM.',
    },
    {
      title: 'Nạp file',
      do: 'Nhập đường dẫn file hoặc cả thư mục chứa ảnh/video (bản Electron), hoặc tải file lên (bản web).',
    },
    {
      title: 'Bắt đầu xử lý',
      do: 'Bấm chạy, theo dõi tiến độ “Đang xử lý…”. Video hiển thị tiến độ theo số khung hình.',
      result: 'Trạng thái “Hoàn thành” cho từng file; xem trước và tải về từng file hoặc tải tất cả.',
    },
  ],
  areas: [
    {
      id: 'anh',
      name: 'Tab Hình ảnh',
      what: 'Xóa watermark trên ảnh do Gemini/Flow tạo. Nhận một file hoặc thư mục ảnh. Veo Studio cũng có nút xóa watermark ảnh ngay khi xem ảnh vừa tạo.',
    },
    {
      id: 'video',
      name: 'Tab Video',
      what: 'Xóa watermark trên clip. Có thể hủy giữa chừng (“Đã hủy xóa watermark”). Tiến độ hiển thị theo khung hình.',
      tip: 'Dùng trên clip gốc tải từ Flow. Nếu clip đã ghép thành video dài thì nên xóa watermark từng clip trước khi ghép.',
    },
    {
      id: 'ket-qua',
      name: 'Kết quả và Drive',
      what: 'Mỗi file có xem trước và nút “Tải về”; “Tải tất cả” gom các tệp đã xong thành một file ZIP. Đầu trang hiển thị thư mục Google Drive đang dùng để đồng bộ kết quả (mặc định AI_Clean_Media).',
    },
  ],
  concepts: [
    { term: 'Vị trí chuẩn', meaning: 'Watermark của Gemini/Veo nằm ở một vị trí cố định; công cụ chỉ nhận ra khi video chưa bị crop hoặc phóng.' },
  ],
  problems: [
    {
      symptom: 'Báo “không nhận ra watermark Gemini/Veo ở vị trí chuẩn”',
      cause: 'Video đã bị crop, phóng to, hoặc vốn không có watermark.',
      fix: 'Dùng clip gốc chưa chỉnh sửa. Với video đã ghép, xóa watermark trên từng clip gốc rồi mới ghép lại.',
    },
    {
      symptom: 'Báo “Watermark runtime tích hợp bị thiếu” hoặc “Công cụ xử lý watermark chưa sẵn sàng”',
      fix: 'Bản đóng gói: cài lại ứng dụng. Bản dev: cd Frontend/watermark-runtime, chạy npm install và npx playwright install chromium.',
    },
    {
      symptom: 'Báo “Không tìm thấy file video/ảnh hợp lệ”',
      fix: 'Kiểm tra đường dẫn và đuôi file (.mp4, .mov, .png, .jpg, .webp).',
    },
    {
      symptom: 'Báo lỗi đồng bộ Google Drive',
      fix: 'Kết nối lại Google Drive trong Cài đặt rồi thử lại.',
      link: 'Cài đặt',
    },
  ],
  related: ['Veo Studio', 'Chiến dịch AI', 'Canvas AI', 'Khám Phá Kênh'],
  changes: [],
}
