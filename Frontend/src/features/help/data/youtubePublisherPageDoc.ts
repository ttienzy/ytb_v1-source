import type { HelpDoc } from '../model.ts'

export const youtubePublisherPageDoc: HelpDoc = {
  pageId: 'Lên lịch Youtube',
  title: 'Lên lịch YouTube (Shorts & video)',
  summary:
    'Đăng hoặc hẹn giờ hàng loạt video lên kênh YouTube của bạn từ thư mục Google Drive: đặt tiêu đề, tag, chế độ riêng tư và khung giờ (cách đều hoặc giờ vàng), rồi theo dõi từng tác vụ ở Lịch sử tác vụ.',
  verifiedAt: '2026-11-12',
  requires: [
    {
      label: 'Kênh YouTube đã kết nối (Google OAuth)',
      fixPage: 'Cài đặt',
      fixHint: 'Tab YouTube trong Cài đặt. Chưa kết nối thì trang báo “Vui lòng kết nối tài khoản YouTube trong Cài đặt”. Token hết hạn thì kết nối lại.',
    },
    {
      label: 'Google Drive đã kết nối (nguồn video)',
      fixPage: 'Cài đặt',
      fixHint: 'Video để đăng được chọn từ thư mục Drive.',
    },
  ],
  start: [
    {
      title: 'Chọn video cần đăng',
      do: 'Ở “Chọn nguồn Video cần đăng tải”, duyệt thư mục Drive (có ô tìm kiếm) và chọn video. Danh sách chọn hiện ở tab “Lên lịch đăng video (N)”.',
    },
    {
      title: 'Đặt metadata hàng loạt',
      do: 'Trong “Cấu hình Lên lịch & Metadata Hàng loạt”: tiền tố tiêu đề (ví dụ [Review Phim]), tags (phân cách bằng dấu phẩy), chế độ riêng tư (Công khai / Không công khai / Riêng tư / Hẹn giờ).',
    },
    {
      title: 'Chọn cách xếp giờ',
      do: '“Khoảng cách đều (Interval)” (cách nhau N phút/giờ) hoặc “Khung giờ vàng (Golden Hours)” (1, 2 hoặc 3 bài mỗi ngày). Bấm áp dụng để app tự phân bổ thời gian cho mọi video.',
    },
    {
      title: 'Gửi',
      do: 'Bấm “Tiến hành Đăng / Lên lịch N Video”, hoặc “Đăng ngay” cho từng video.',
      result: 'Tác vụ sang tab “Lịch sử tác vụ” với trạng thái Đã lên lịch / Đã xuất bản / Thất bại.',
    },
  ],
  areas: [
    {
      id: 'khung-gio-vang',
      name: 'Khung giờ vàng (Golden Hours)',
      what: 'Ba mẫu: 1 bài/ngày (tối 19:45), 2 bài/ngày (trưa 11:45 + tối 19:45), 3 bài/ngày (sáng 07:15 + trưa 11:45 + tối 19:45, khuyên dùng).',
    },
    {
      id: 'khoang-cach-deu',
      name: 'Khoảng cách đều (Interval)',
      what: 'Đặt khoảng cách cố định giữa các video (mặc định 60 phút; có các mức như 3 giờ). App tính sẵn thời điểm cho từng video và hiện “Đã tự động tính toán và phân bổ thời gian cho tất cả video”.',
    },
    {
      id: 'chinh-tung-video',
      name: 'Chỉnh từng video',
      what: 'Mỗi dòng có tiêu đề, tag, chế độ riêng tư và giờ hẹn riêng. Nút “Đăng ngay” đăng video đó lập tức; có thể xóa video khỏi danh sách.',
    },
    {
      id: 'lich-su-tac-vu',
      name: 'Lịch sử tác vụ',
      what: 'Bảng Video / Tiêu đề, Trạng thái, Thời gian đăng/hẹn, Thao tác. Bấm dòng để xem chi tiết hoặc lỗi; có “Mở xem trên YouTube”, “Sao chép link YouTube”, “Thử đăng lại ngay”, xóa bản ghi và “Xóa các bản ghi tác vụ lỗi cũ”. Có thể nạp video thất bại trở lại hàng chờ.',
    },
    {
      id: 'quota',
      name: 'Hạn mức YouTube API',
      what: 'Dự án Google Cloud có 10.000 điểm quota mỗi ngày và mỗi video tốn 1.600 điểm, nên đăng được khoảng 6 video mỗi ngày bằng API. Hết quota thì app báo và hạn mức được làm mới lại theo lịch của Google. Ngoài ra YouTube còn giới hạn số video/Shorts một kênh được đăng trong 24 giờ.',
      tip: 'Lên lịch dàn đều nhiều ngày thay vì đăng dồn một ngày.',
    },
  ],
  concepts: [
    { term: 'Quota (units)', meaning: 'Điểm hạn mức YouTube Data API của dự án Google Cloud bạn dùng. Tải một video lên tốn 1.600 điểm trong tổng 10.000 điểm/ngày.' },
    { term: 'Giờ vàng', meaning: 'Các khung giờ nhiều người xem (sáng 07:15, trưa 11:45, tối 19:45) dùng để hẹn giờ đăng.' },
  ],
  problems: [
    {
      symptom: 'Báo “Phiên xác thực YouTube hết hạn” / “Token… đã hết hạn hoặc bị thu hồi”',
      fix: 'Kết nối lại kênh ở Cài đặt → YouTube, rồi dùng “Thử đăng lại ngay” cho tác vụ lỗi.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Báo “Hết hạn mức Quota API của Google Cloud (10.000 units)”',
      fix: 'Đã đăng đủ số video trong ngày. Chờ hạn mức làm mới (app báo mốc giờ) rồi thử lại, hoặc dàn lịch sang nhiều ngày.',
    },
    {
      symptom: 'Báo “Vượt quá giới hạn tải lên hàng ngày của Kênh (24h Limit)”',
      fix: 'YouTube giới hạn số video/Shorts đăng trong 24 giờ đối với kênh của bạn. Thử lại sau vài phút hoặc đặt giờ đăng cách nhau hơn.',
    },
    {
      symptom: 'Không tải được danh sách Drive',
      fix: 'Kết nối lại Google Drive trong Cài đặt (“Lỗi tải dữ liệu Google Drive”).',
      link: 'Cài đặt',
    },
    {
      symptom: 'Báo “Lỗi từ YouTube API” hoặc “Đăng video thất bại”',
      fix: 'Bấm dòng tác vụ để xem chi tiết lỗi, kiểm tra định dạng file và kết nối tài khoản, rồi “Thử đăng lại ngay”.',
    },
  ],
  related: ['Dashboard', 'Lên lịch Pippit', 'Video', 'Cài đặt', 'Lịch sử'],
  changes: [],
}
