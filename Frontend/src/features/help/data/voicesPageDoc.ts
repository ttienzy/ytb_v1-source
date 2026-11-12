import type { HelpDoc } from '../model.ts'

export const voicesPageDoc: HelpDoc = {
  pageId: 'Voices',
  title: 'Voices (Giọng đọc AI)',
  summary:
    'Danh sách giọng đọc tiếng Việt (VieNeu-TTS): giọng preset có sẵn và giọng clone bạn tạo từ một đoạn audio mẫu. Nghe thử ở đây; các trang Recap & Audio, Chiến dịch AI dùng chính danh sách này.',
  verifiedAt: '2026-11-12',
  requires: [
    {
      label: 'Voice-service đang chạy và đã nạp model',
      fixHint: 'Chạy cùng npm start. Lần đầu có thể mất vài phút để tải model; trang báo “Đang kết nối Voice Service và nạp model VieNeu-TTS…”. Quá 6 phút sẽ báo chưa sẵn sàng.',
    },
  ],
  start: [
    {
      title: 'Chờ Voice Service sẵn sàng',
      do: 'Mở trang Voices. Khi model nạp xong, số giọng và “Mô hình: VieNeu v3 ONNX” hiện ở đầu trang.',
    },
    {
      title: 'Nghe thử một giọng',
      do: 'Chọn một mẫu câu (Hài hước, Kể chuyện, Review phim, Triết lý) hoặc tự nhập câu rồi bấm “Nghe thử giọng này” ở giọng bạn muốn.',
      result: 'Phát giọng đọc; “Dừng phát” để ngắt.',
    },
    {
      title: 'Tạo giọng clone (tùy chọn)',
      do: 'Bấm “Tạo giọng mới”: nhập tên giọng, kéo thả file mẫu .wav hoặc .mp3 dài khoảng 3–8 giây, tích xác nhận quyền sử dụng giọng mẫu, bấm “Tạo Giọng Clone”.',
      result: 'Giọng mới xuất hiện trong danh sách và trong ô chọn giọng của các trang khác.',
    },
  ],
  areas: [
    {
      id: 'thong-ke',
      name: 'Thông số đầu trang',
      what: 'Tổng số giọng, số giọng clone, số preset (kèm Nam/Nữ) và mô hình đang dùng. Voice-service chạy theo một profile (Turbo chất lượng cao, Nano tiết kiệm tài nguyên, Turbo tăng tốc GPU) đặt khi khởi động.',
    },
    {
      id: 'danh-sach-giong',
      name: 'Danh sách giọng',
      what: 'Bảng giọng với cột Tên Giọng, Phong Cách / Mô Tả, Phân Loại (preset hoặc clone), Thao Tác. Bộ lọc: Tất cả, Giọng clone, Giọng Nam, Giọng Nữ; ô tìm kiếm lọc theo tên hoặc phong cách. Chỉ giọng clone có nút xóa, preset thì không.',
    },
    {
      id: 'nghe-thu',
      name: 'Nghe thử',
      what: 'Chọn mẫu câu có sẵn hoặc nhập câu của bạn (để trống thì dùng câu mặc định) rồi nghe thử từng giọng. Một số biểu cảm là thử nghiệm: kết quả tùy giọng.',
    },
    {
      id: 'tao-giong-clone',
      name: 'Tạo giọng clone',
      what: 'Cần tên giọng và audio mẫu khoảng 3–8 giây (.wav, .mp3), rõ tiếng, ít nhiễu. Bắt buộc tích xác nhận bạn có quyền dùng giọng mẫu.',
      tip: 'Audio mẫu càng sạch và một người nói thì giọng clone càng giống.',
    },
  ],
  concepts: [
    { term: 'Preset', meaning: 'Giọng dựng sẵn đi kèm VieNeu-TTS.' },
    { term: 'Giọng clone', meaning: 'Giọng tạo từ audio mẫu của bạn; lưu trong dữ liệu của voice-service.' },
  ],
  problems: [
    {
      symptom: 'Báo “Voice API chưa sẵn sàng” hoặc “Voice Service chưa sẵn sàng sau 6 phút”',
      fix: 'Voice-service chưa chạy hoặc đang tải model. Kiểm tra cửa sổ terminal của voice-service và chạy lại npm start nếu cần.',
    },
    {
      symptom: 'Báo “Vui lòng nhập tên giọng và chọn audio mẫu (3-8 giây)”',
      fix: 'Điền tên giọng và chọn file mẫu .wav/.mp3 độ dài khuyên dùng 3–8 giây.',
    },
    {
      symptom: 'Báo “Vui lòng xác nhận quyền sử dụng giọng mẫu”',
      fix: 'Tích ô xác nhận trước khi tạo giọng clone.',
    },
    {
      symptom: 'Báo “Tổng hợp giọng đọc thất bại” khi nghe thử',
      cause: 'Voice-service đang bận (mỗi lúc chỉ đọc một việc) hoặc câu quá dài.',
      fix: 'Chờ việc đang chạy xong (ví dụ một job Recap & Audio) rồi thử lại với câu ngắn hơn.',
      link: 'Recap & Audio',
    },
    {
      symptom: 'Ô chọn giọng ở trang khác báo “Chưa có giọng”',
      fix: 'Chờ Voice Service sẵn sàng hoặc tạo một giọng clone ở đây.',
    },
  ],
  related: ['Recap & Audio', 'Chiến dịch AI', 'Thư viện nhạc'],
  changes: [],
}
