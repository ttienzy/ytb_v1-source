import type { HelpDoc } from '../model.ts'

export const museStudioDoc: HelpDoc = {
  pageId: 'Muse Studio',
  title: 'Muse Studio (Meta Muse Spark)',
  summary:
    'Tạo video điện ảnh bằng Meta Muse: bạn viết prompt (kèm ảnh/video tham chiếu nếu muốn), app điều khiển một cửa sổ Chrome đã đăng nhập Muse để sinh video, rồi tự lấy file MP4 về xem ngay và lưu vào thư mục tải về.',
  verifiedAt: '2026-11-12',
  requires: [
    {
      label: 'Chrome Muse đã mở và đăng nhập Muse',
      fixPage: 'Cài đặt',
      fixHint: 'Bấm “Mở Muse Chrome” ở đầu trang, đăng nhập Meta Muse một lần. Huy hiệu trạng thái chuyển sang “Sẵn sàng” khi kết nối được.',
    },
    {
      label: 'Cấu hình kỹ thuật Muse (URL, cổng CDP, thư mục tải)',
      fixPage: 'Cài đặt',
      fixHint: 'Tab “Muse AI (Meta)” trong Cài đặt. Mặc định dùng profile Chrome riêng của Muse trong Backend/Data.',
    },
  ],
  start: [
    {
      title: 'Kiểm tra kết nối',
      do: 'Nhìn huy hiệu trạng thái ở đầu trang. “Chưa kết nối” thì bấm “Mở Muse Chrome” và đăng nhập, rồi bấm huy hiệu để kiểm tra lại.',
      result: 'Trạng thái “Sẵn sàng”.',
    },
    {
      title: 'Viết prompt',
      do: 'Nhập mô tả cảnh quay ở “Mô tả cảnh quay (Video Prompt)” bằng tiếng Anh hoặc tiếng Việt. Có thể bấm một “gợi ý phong cách nhanh” để thêm mô tả có sẵn vào prompt.',
    },
    {
      title: 'Thêm media tham chiếu (tùy chọn)',
      do: 'Kéo thả hoặc bấm chọn ảnh (PNG, JPG, WEBP) và video (MP4, WEBM), hoặc nhập đường dẫn file trên máy.',
    },
    {
      title: 'Bấm “Khởi tạo video với Muse Spark”',
      do: 'Chờ render. Video xong sẽ hiện ở màn hình xem trước và được lưu vào thư mục tải về.',
      result: 'Video MP4 xuất hiện trong khung xem và trong danh sách lịch sử.',
    },
  ],
  areas: [
    {
      id: 'trang-thai-ket-noi',
      name: 'Đầu trang: trạng thái và lối tắt',
      what: 'Huy hiệu kết nối (Đang kiểm tra… / Sẵn sàng / Chưa kết nối; bấm để kiểm tra lại), “Mở Muse Chrome”, “Thư mục video” (mở thư mục chứa video đã tải) và “Cài đặt” (nhảy tới cấu hình Muse).',
    },
    {
      id: 'prompt',
      name: 'Mô tả cảnh quay (Video Prompt)',
      what: 'Ô nhập prompt, có nút xóa nội dung. Gợi ý phong cách nhanh (bấm để thêm mô tả có sẵn vào prompt): Cinematic 4K, Cyberpunk City, Thiên nhiên Macro, Chân dung Điện ảnh, Drone Bay Lượn, 3D Hoạt hình. Trong Cài đặt có thể đặt phần hậu tố prompt dùng chung (ví dụ “cinematic, 8k resolution, highly detailed”).',
    },
    {
      id: 'tuy-chon-tao-sinh',
      name: 'Tùy chọn tạo sinh',
      what: 'Hai công tắc: “Phân luồng New Chat riêng biệt” (tự bấm “+ New chat” để video mới không dính vào dự án cũ) và “Tiếp nối video trước (Continuation)” (giữ ngữ cảnh để render phân cảnh kế tiếp trong cùng đoạn phim).',
      tip: 'Muốn nối nhiều cảnh liền mạch thì bật “Tiếp nối video trước”. Muốn một video độc lập thì giữ “New Chat riêng biệt”.',
    },
    {
      id: 'media-tham-chieu',
      name: 'Media tham chiếu (Ảnh & Video)',
      what: 'Ảnh: tối đa khoảng 10–15 ảnh (ngân sách 8MB, app tự tối ưu). Video: tối đa 100MB mỗi video (kế thừa chuyển động, ghép nối phân cảnh). Có thể nhập đường dẫn file thủ công; xóa từng media bằng nút “Xóa media này”.',
    },
    {
      id: 'xem-truoc-va-lich-su',
      name: 'Xem trước và lịch sử',
      what: 'Video vừa render hiện ở màn hình xem trước (kèm thời gian render). Danh sách bên dưới là các clip trong thư mục tải về: chọn để xem lại, “Sao chép đường dẫn” file, hoặc mở “Thư mục video”.',
    },
  ],
  concepts: [
    { term: 'Chrome CDP', meaning: 'App điều khiển cửa sổ Chrome Muse qua giao thức gỡ lỗi của Chrome (cổng cấu hình trong Cài đặt), giống như bạn thao tác tay trên trang Muse.' },
    { term: 'Continuation', meaning: 'Chế độ nối tiếp: Muse nhớ video trước để cảnh sau liền mạch với cảnh trước.' },
  ],
  problems: [
    {
      symptom: 'Huy hiệu báo “Chưa kết nối”',
      cause: 'Chrome Muse chưa mở, hoặc chưa đăng nhập Muse.',
      fix: 'Bấm “Mở Muse Chrome”, đăng nhập Meta Muse trong cửa sổ vừa mở, rồi bấm huy hiệu để kiểm tra lại. Trong Cài đặt → Muse AI có phần kiểm tra “Chrome đang chạy với CDP” và “phiên đăng nhập Muse”.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Báo “Không thể mở trình duyệt Muse”',
      fix: 'Kiểm tra cổng CDP ở Cài đặt → Muse AI (Meta), đóng cửa sổ Chrome Muse cũ nếu đang treo rồi thử lại.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Báo “Muse không thể tạo video. Vui lòng thử lại.”',
      fix: 'Prompt bị từ chối hoặc Muse đang lỗi/hết hạn mức. Mở cửa sổ Chrome Muse xem thông báo trên trang, chỉnh prompt rồi thử lại.',
    },
    {
      symptom: 'Báo “Lỗi khi tải file media lên”',
      fix: 'File vượt giới hạn (video quá 100MB, quá nhiều ảnh) hoặc sai định dạng. Dùng PNG/JPG/WEBP cho ảnh, MP4/WEBM cho video.',
    },
    {
      symptom: 'Báo “Lỗi khi kết nối với Muse Service”',
      fix: 'Backend không phản hồi. Kiểm tra backend đang chạy rồi thử lại.',
    },
  ],
  related: ['Cài đặt', 'Veo Studio', 'Chiến dịch AI'],
  changes: [
    { date: '2026-11-12', text: 'Muse Studio có tài liệu hướng dẫn lần đầu.' },
  ],
}
