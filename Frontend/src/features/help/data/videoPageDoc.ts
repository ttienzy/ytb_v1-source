import type { HelpDoc } from '../model.ts'

export const videoPageDoc: HelpDoc = {
  pageId: 'Video',
  title: 'Video (Video Workspace)',
  summary:
    'Kho video của bạn: nhập video (từ máy hoặc link YouTube), chỉnh khung hình/nền/nhãn/làm mờ, xuất video đã chuẩn hóa, gộp nhiều video thành một, và lưu cấu hình để dùng lại. Cùng kho này làm “video nền” cho Workflow Audio.',
  verifiedAt: '2026-11-12',
  requires: [
    {
      label: 'Chọn thư mục lưu thêm chỉ hoạt động trong bản Electron',
      fixHint: 'Nút “Thêm nơi lưu…” báo “Chức năng chọn thư mục chỉ hoạt động trong Electron” nếu bạn mở app bằng trình duyệt.',
    },
  ],
  start: [
    {
      title: 'Thêm video vào kho',
      do: 'Ở “Nguồn video”: thả file (MP4, MOV, WEBM, MKV — chọn được nhiều file) hoặc dán link YouTube rồi bấm “Tải về”.',
      result: 'Video xuất hiện trong “Kho video”.',
    },
    {
      title: 'Chọn video để xem trước',
      do: 'Bấm một video ở kho. Bản xem trước hiển thị kết quả của cấu hình hiện tại (khung, nền, nhãn, vùng làm mờ).',
    },
    {
      title: 'Chỉnh cấu hình ở “Chỉnh sửa”',
      do: 'Chọn khổ đầu ra, cách cắt khung, nền, nhãn, làm mờ. Muốn bỏ tiếng gốc thì bật “Xóa âm thanh khỏi video”.',
    },
    {
      title: 'Bấm “Xử lý” và lấy kết quả',
      do: 'Tiến trình hiện ở “Tiến trình xử lý”. Xong, video nằm ở thẻ Kết quả → tab “Hoàn tất”.',
      result: 'File đã chuẩn hóa, mở xem ngay hoặc dùng cho workflow.',
    },
  ],
  areas: [
    {
      id: 'kho-video',
      name: 'Nguồn video & Kho video',
      what: 'Thêm video từ máy (kéo thả hoặc bấm để chọn) hoặc từ link YouTube. “Xóa khỏi kho” bỏ video khỏi danh sách; “Tải lại video” làm mới kho nếu bạn vừa thêm file ngoài app.',
    },
    {
      id: 'khung',
      name: 'Tab Khung',
      what: 'Chọn “Khổ đầu ra”: 9:16 cho Reels/TikTok/Facebook hoặc 16:9 cho YouTube. “Cắt khung hình” có ba kiểu: Giữ nguyên, Vuông giữa, Tự chỉnh (kéo khung trên bản xem trước).',
    },
    {
      id: 'nen',
      name: 'Tab Nền',
      what: 'Phần thừa quanh video khi khung không khớp. “Kiểu nền”: Màu nền hoặc Ảnh nền (PNG, JPG, WEBP; “Chọn ảnh nền” / “Bỏ ảnh”).',
    },
    {
      id: 'nhan',
      name: 'Tab Nhãn',
      what: 'Chèn dòng chữ lên video: nội dung nhãn, màu nền nhãn, vị trí (Trên, Giữa, Dưới hoặc Tùy chỉnh bằng cách kéo trên bản xem trước).',
    },
    {
      id: 'lam-mo',
      name: 'Tab Làm mờ',
      what: 'Làm mờ một vùng để che logo hoặc chữ. Bật công tắc rồi kéo khung trên bản xem trước, chỉnh “Độ mờ”.',
    },
    {
      id: 'xoa-am-thanh',
      name: 'Xóa âm thanh khỏi video',
      what: 'Công tắc xuất video không có tiếng gốc. Dùng khi video dùng làm nền cho giọng đọc/nhạc nền.',
    },
    {
      id: 'state',
      name: 'Lưu và áp dụng cấu hình (state)',
      what: 'Đặt “Tên state mới” rồi lưu để dùng lại. “Áp dụng state đã lưu” nạp lại toàn bộ cấu hình khung/nền/nhãn/làm mờ.',
    },
    {
      id: 'ket-qua',
      name: 'Kết quả: Hoàn tất · Gộp video · Đã gộp',
      what: 'Ba tab trong một thẻ. Hoàn tất: video đã xử lý (“Mở xem video”). Gộp video: chọn video (Tự chọn hoặc Ngẫu nhiên), đặt thời lượng (Giây/Phút) và khổ xuất rồi gộp thành một file. Đã gộp: các file gộp, có “Tải video gộp”.',
      tip: 'Giao diện hiển thị đường dẫn lưu ngay trong thẻ (Data/media/videos/processed cho video đã xử lý, Data/media/videos/MergeVideo cho video gộp). “Thêm nơi lưu…” để lưu thêm một bản vào thư mục khác.',
    },
    {
      id: 'trong-audio',
      name: 'Dùng làm video nền cho Workflow Audio',
      what: 'Khối “Video” trong Recap & Audio là chính trang này thu gọn. Video thêm ở đây hoặc ở đó đều vào cùng một thư viện nền. Video nền được tự chuẩn hóa nên không cần chọn 9:16 hay 16:9 cho video local.',
    },
  ],
  concepts: [
    { term: 'State', meaning: 'Một bộ cấu hình chỉnh sửa (khung, nền, nhãn, làm mờ…) được lưu tên để dùng lại.' },
    { term: 'Khổ đầu ra', meaning: 'Tỷ lệ khung video xuất ra: 9:16 (dọc) hoặc 16:9 (ngang).' },
  ],
  problems: [
    {
      symptom: 'Báo “Không kết nối được Backend”',
      fix: 'Backend chưa chạy hoặc đang khởi động lại. Chờ vài giây rồi bấm “Tải lại video”.',
    },
    {
      symptom: 'Xử lý báo “FFmpeg xử lý thất bại” hoặc “Xử lý quá lâu (hơn 30 phút)”',
      cause: 'Video lỗi/định dạng lạ, hoặc quá nặng. Hơn 30 phút app tự dừng để khỏi treo.',
      fix: 'Thử video khác hoặc cắt ngắn bớt; kiểm tra lại cấu hình nền/ảnh nền hợp lệ.',
    },
    {
      symptom: 'Báo “Hãy chọn ít nhất một video để gộp”',
      fix: 'Ở tab “Gộp video” chọn “Tự chọn” và đánh dấu video, hoặc dùng “Ngẫu nhiên” và nhập thời lượng muốn gộp.',
    },
    {
      symptom: 'Nút “Thêm nơi lưu…” báo chỉ hoạt động trong Electron',
      fix: 'Mở app bằng bản Electron (npm start) thay vì trình duyệt.',
    },
    {
      symptom: 'Tải link YouTube không được',
      fix: 'YouTube có thể chặn. Xem phần Bot-Wall ở trang Recap & Audio để đăng nhập qua Chrome rồi thử lại.',
      link: 'Recap & Audio',
    },
  ],
  related: ['Recap & Audio', 'Lên lịch Youtube', 'Lên lịch Pippit', 'Dashboard'],
  changes: [
    { date: '2026-11-12', text: 'Thiết kế lại gọn một màn hình; có thể dùng thu gọn bên trong Recap & Audio làm kho video nền.' },
  ],
}
