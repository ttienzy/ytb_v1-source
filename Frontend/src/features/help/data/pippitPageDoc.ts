import type { HelpDoc } from '../model.ts'

export const pippitPageDoc: HelpDoc = {
  pageId: 'Lên lịch Pippit',
  title: 'Lên lịch Pippit (Facebook & TikTok)',
  summary:
    'Đặt lịch đăng hàng loạt video ngắn từ thư mục Google Drive lên Fanpage Facebook (Reels & Video) qua tài khoản Pippit: chọn video, chọn Fanpage, chọn khung giờ và giãn cách, xem trước bài đăng rồi gửi lịch.',
  verifiedAt: '2026-11-12',
  requires: [
    {
      label: 'Tài khoản Pippit đã đăng nhập, có Fanpage liên kết',
      fixPage: 'Cài đặt',
      fixHint: 'Tab “Pippit AI & Fanpages”. Chưa liên kết thì trang báo “Vui lòng liên kết Fanpage trên Pippit để bắt đầu đăng bài”.',
    },
    {
      label: 'Google Drive đã kết nối và có thư mục chứa video',
      fixPage: 'Cài đặt',
      fixHint: 'Video nguồn lấy từ thư mục Drive (ví dụ AI_Clean_Videos hoặc thư mục workflow bạn tạo).',
    },
  ],
  start: [
    {
      title: 'Chọn thư mục Drive và video',
      do: 'Ở “Chọn thư mục lưu trữ Video” chọn thư mục Drive (hoặc chọn nhanh folder mặc định / folder workflow). Tích các video ngắn cần đăng ở cột trái (“Chọn video chưa đăng”).',
    },
    {
      title: 'Chọn Fanpage và lịch',
      do: 'Chọn Fanpage đích, tần suất đăng và mốc giờ trong ngày, giãn cách giữa các bài.',
    },
    {
      title: 'Xem trước và gửi lịch',
      do: 'Kiểm tra “Xem Trước Bài Đăng Facebook” (caption, hashtag), tùy chỉnh riêng từng video nếu cần rồi bấm “BẮT ĐẦU ĐẶT LỊCH HÀNG LOẠT (N VIDEO)”.',
      result: 'Các bài xuất hiện ở tab “Lịch đã đặt”. Hai tab của trang là “Đặt lịch hàng loạt” và “Lịch đã đặt”.',
    },
  ],
  areas: [
    {
      id: 'nguon-drive',
      name: 'Thư mục Drive và danh sách video',
      what: 'Duyệt thư mục Drive (bảng thư mục có Tên, Chủ sở hữu, Ngày sửa đổi; “Folder con · Bấm để xổ video”) và lọc video MP4. Có thể tạo “thư mục workflow” riêng để gom video theo từng dự án.',
    },
    {
      id: 'chien-luoc-lich',
      name: 'Chiến lược lên lịch',
      what: '“Tần suất đăng bài” có các mẫu: 1 bài/ngày (tối 19:45), 2 bài/ngày (trưa 11:45 + tối 19:45), 3 bài/ngày (sáng 07:15 + trưa 11:45 + tối 19:45). “Giãn cách tự động” dàn đều thời gian giữa các bài. Bạn cũng chọn ngày bắt đầu (Hôm nay, Ngày mai hoặc “Chọn ngày cụ thể…”).',
    },
    {
      id: 'chong-spam',
      name: 'Chống spam Meta',
      what: 'Công tắc “Lệch ngẫu nhiên ±5-10p” làm lệch giờ đăng vài phút để các bài không đăng đúng cùng một phút, tránh bị Meta coi là bot tự động.',
    },
    {
      id: 'caption',
      name: 'Caption, hashtag và state',
      what: 'Mẫu caption dùng được biến {filename}; có thể thêm hashtag (“#tag_moi”). “Lưu state” lưu mẫu caption riêng cho workflow, “+ Tạo state” tạo mẫu mới, “Áp dụng state đã lưu” nạp lại.',
    },
    {
      id: 'tuy-chinh-tung-video',
      name: 'Tùy chỉnh từng video',
      what: 'Mỗi video có thể có lịch phát và Fanpage riêng. Hãy tích chọn video ở cột trái để xem và chỉnh tại đây.',
    },
    {
      id: 'lich-da-dat',
      name: 'Tab “Lịch đã đặt”',
      what: 'Theo dõi tiến độ phát sóng: lọc theo ngày hoặc trạng thái (có “Lỗi / Thất bại”), xem link bài Facebook khi đã đăng, sắp xếp theo giờ phát hoặc mới tạo. Hiển thị tổng bài đã lên lịch.',
    },
  ],
  concepts: [
    { term: 'Pippit', meaning: 'Dịch vụ trung gian đăng bài lên Fanpage Facebook (và TikTok). App đăng nhập Pippit bằng tài khoản bạn thêm ở Cài đặt.' },
    { term: 'Workflow folder', meaning: 'Thư mục Drive con do bạn đặt tên để gom video của một dự án.' },
  ],
  problems: [
    {
      symptom: 'Không thấy Fanpage nào để chọn',
      fix: 'Liên kết Fanpage ở tài khoản Pippit rồi quét lại kênh liên kết trong Cài đặt.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Danh sách video Drive trống hoặc báo “Không thể tải danh sách video từ Google Drive”',
      fix: 'Kết nối lại Google Drive; chọn đúng thư mục có file MP4 trực tiếp (thư mục chỉ có folder con thì báo “Folder này chưa có video MP4 trực tiếp”).',
      link: 'Cài đặt',
    },
    {
      symptom: 'Báo “Lên lịch thất bại”',
      fix: 'Kiểm tra token Pippit còn hạn (“Hết hạn ủy quyền” / “Cần cấp quyền” trong Cài đặt) và đã chọn Fanpage và video.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Bài trong Lịch đã đặt báo lỗi',
      fix: 'Mở dòng lỗi để xem lý do, sửa kết nối rồi đặt lịch lại.',
    },
  ],
  related: ['Dashboard', 'Lên lịch Youtube', 'Video', 'Cài đặt', 'Lịch sử'],
  changes: [],
}
