import type { HelpDoc } from '../model.ts'

export const historyPageDoc: HelpDoc = {
  pageId: 'Lịch sử',
  title: 'Lịch sử',
  summary:
    'Nơi tra cứu mọi thứ đã làm và đã đăng: lịch phát sóng theo tháng, các video Studio đã tạo (kèm kịch bản lồng tiếng), bài đã đăng qua Pippit (Facebook/TikTok) và các video đã đăng lên YouTube.',
  verifiedAt: '2026-11-15',
  requires: [],
  start: [
    {
      title: 'Chọn tab cần xem',
      do: 'Bốn tab ở đầu trang: “Lịch phát sóng”, “Video Studio”, “Đăng FB & TikTok (Pippit)”, “Đăng YouTube”.',
    },
    {
      title: 'Tìm bản ghi',
      do: 'Dùng ô tìm kiếm (tiêu đề, link, ID, tên kênh/Page tùy tab) và bộ lọc kênh/trạng thái.',
    },
    {
      title: 'Xem chi tiết hoặc xử lý',
      do: 'Bấm một bản ghi để xem chi tiết. Từ đó mở link YouTube/Facebook, sao chép link hoặc xóa bản ghi/giải phóng dung lượng.',
    },
  ],
  areas: [
    {
      id: 'lich-phat-song',
      name: 'Lịch phát sóng',
      what: 'Lịch theo tháng gom bài hẹn giờ và bài đã đăng của YouTube và Pippit. Lọc theo kênh và trạng thái (Đang hẹn giờ / Đã đăng), tìm video, chuyển tháng trước/sau, “Xem bài” để mở bài. Nút đồng bộ lấy dữ liệu mới từ máy chủ Pippit và YouTube.',
    },
    {
      id: 'video-studio',
      name: 'Video Studio',
      what: 'Danh sách các video đã tạo bằng Workflow YouTube của Recap & Audio. Chọn một video bên trái để xem job ID, tiêu đề, kịch bản recap và kịch bản lồng tiếng (VO). Có chuyển giữa video recap và media, tìm theo tiêu đề/link/ID và “Làm mới”.',
      tip: '“Xóa vĩnh viễn (Giải phóng dung lượng)” xóa file video của job khỏi ổ đĩa. Không hoàn tác được.',
    },
    {
      id: 'pippit',
      name: 'Đăng FB & TikTok (Pippit)',
      what: 'Lịch sử bài đăng qua Pippit, nhóm theo ngày đăng. Mở tab là hiện ngay dữ liệu đã lưu rồi tự đồng bộ với Pippit; nút “Đồng bộ” lấy lại trạng thái mới nhất.',
      how: [
        'Lọc theo trạng thái: Đang hẹn giờ, Quá giờ, chưa xác nhận, Đã đăng, Lỗi, Không thấy trên Pippit.',
        'Lọc theo nền tảng (Facebook / TikTok) và theo Page / kênh; ô tìm kiếm không phân biệt dấu (tiêu đề, caption, kênh, Task ID).',
        'Bấm một bài để xem caption, hashtag, lý do lỗi, Task ID, tài khoản; mở bài trên Facebook/TikTok, “Copy caption”, hoặc “Mở video gốc” (bài đăng từ Video Studio).',
        '“Tải thêm” để xem tiếp khi danh sách dài.',
      ],
      tip: 'Nếu tài khoản Pippit hết phiên, app tự đăng nhập lại bằng mật khẩu đã lưu. Không được thì hiện cảnh báo vàng kèm nút “Mở Cài đặt”.',
    },
    {
      id: 'youtube',
      name: 'Đăng YouTube',
      what: 'Lịch sử video đã đăng lên YouTube: tìm theo tiêu đề, tên kênh hoặc video ID; mở xem trên YouTube, sao chép link, xóa bản ghi khỏi lịch sử (video trên YouTube không bị xóa).',
    },
  ],
  concepts: [
    { term: 'Job', meaning: 'Một lượt chạy Recap (từ link YouTube ra video) với một mã ID riêng.' },
  ],
  problems: [
    {
      symptom: 'Báo “Không thể tải danh sách jobs” hoặc “Không thể tải lịch sử …”',
      fix: 'Backend chưa chạy hoặc đang khởi động lại. Chờ vài giây rồi bấm “Làm mới”.',
    },
    {
      symptom: 'Video Studio trống',
      fix: 'Chưa có video làm bằng Workflow YouTube. Video của Workflow Audio nằm ở khối “Video đã hoàn tất” trong Recap & Audio.',
      link: 'Recap & Audio',
    },
    {
      symptom: 'Lịch phát sóng thiếu bài vừa đăng',
      fix: 'Bấm nút đồng bộ để lấy dữ liệu mới từ Pippit và YouTube.',
    },
    {
      symptom: 'Bài Pippit hiện “Quá giờ, chưa xác nhận”',
      fix: 'Đã qua giờ hẹn hơn 30 phút mà chưa có kết quả từ Pippit. Bấm “Đồng bộ”; nếu có cảnh báo tài khoản chưa đồng bộ được, đăng nhập lại tài khoản Pippit trong Cài đặt.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Bài Pippit hiện “Không thấy trên Pippit”',
      fix: 'Tài khoản đồng bộ được nhưng Pippit không có bài này: bài đã bị xóa trên Pippit hoặc lúc lên lịch Pippit không tạo được task (không có Task ID). Kiểm tra trên trang Pippit, lên lịch lại nếu cần.',
    },
    {
      symptom: 'Xóa video báo “Xóa video thất bại”',
      fix: 'File có thể đang được dùng bởi tiến trình khác. Đóng trình phát/job đang chạy rồi thử lại.',
    },
  ],
  related: ['Recap & Audio', 'Lên lịch Youtube', 'Lên lịch Pippit', 'Dashboard', 'Cài đặt'],
  changes: [
    { date: '2026-11-15', text: 'Tab “Đăng FB & TikTok (Pippit)” làm lại: danh sách gọn nhóm theo ngày, lọc theo nền tảng/kênh, trạng thái mới “Quá giờ, chưa xác nhận” và “Không thấy trên Pippit”, cảnh báo tài khoản không đồng bộ được. Sửa: bài TikTok trước đây kẹt ở “Đang lên lịch” vì không bao giờ được đồng bộ; bài TikTok hiện đúng biểu tượng và link.' },
  ],
}
