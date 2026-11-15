import type { HelpDoc } from '../model.ts'

export const pippitPageDoc: HelpDoc = {
  pageId: 'Lên lịch Pippit',
  title: 'Lên lịch Pippit (Facebook & TikTok)',
  summary:
    'Đặt lịch đăng hàng loạt video ngắn từ thư mục Google Drive lên Fanpage Facebook và kênh TikTok qua tài khoản Pippit: chọn video, chọn kênh, chọn khung giờ, xem trước rồi đặt lịch. Trang cảnh báo video đã đăng lên đúng kênh đó để tránh đăng trùng.',
  verifiedAt: '2026-11-15',
  requires: [
    {
      label: 'Tài khoản Pippit đã đăng nhập, có Fanpage / kênh TikTok liên kết',
      fixPage: 'Cài đặt',
      fixHint: 'Tab “Pippit AI & Fanpages”. Chưa liên kết thì trang báo “Chưa có kênh Facebook / TikTok nào”.',
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
      title: 'Chọn kênh và lịch',
      do: 'Ở “Kênh đăng” chọn một hoặc nhiều kênh (biểu tượng nhỏ trên avatar cho biết Facebook hay TikTok), rồi chọn tần suất, mốc giờ trong ngày hoặc giãn cách giữa các bài.',
    },
    {
      title: 'Xem trước và gửi lịch',
      do: 'Kiểm tra “Xem trước bài đăng” (caption, hashtag), tùy chỉnh riêng từng video nếu cần rồi bấm “Đặt lịch N video” ở thanh dưới cùng.',
      result: 'Video được upload và lên lịch lần lượt; bảng “Kết quả lượt đặt lịch” cho biết video nào thành công, video nào lỗi. Video đã lên lịch xong tự bỏ chọn. Các bài xuất hiện ở tab “Lịch đã đặt”.',
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
      what: 'Mỗi video có thể có lịch phát và kênh riêng (chỉ các kênh đang chọn). Video đã đăng hoặc đã lên lịch lên đúng kênh đích được đánh dấu “Đã đăng lên kênh này”.',
    },
    {
      id: 'thanh-dat-lich',
      name: 'Thanh đặt lịch (dưới cùng)',
      what: 'Luôn hiện ở đáy màn hình: số video → kênh, khoảng giờ đăng từ bài đầu tới bài cuối, số video trùng kênh kèm nút “Bỏ chọn”, và nút “Đặt lịch N video”.',
      how: [
        'Trong lúc chạy, thanh hiện video đang upload (vd. 2/4) và nút “Dừng”: video đang gửi vẫn chạy xong, các video sau không gửi.',
        'Video lỗi không tự gửi lại. Xem lý do trong bảng kết quả, kiểm tra tab “Lịch đã đặt” rồi mới đặt lại để tránh đăng trùng.',
      ],
    },
    {
      id: 'lich-da-dat',
      name: 'Tab “Lịch đã đặt”',
      what: 'Cùng danh sách với Lịch sử > “Đăng FB & TikTok (Pippit)”: nhóm theo ngày, lọc theo trạng thái (Đang hẹn giờ, Quá giờ, Đã đăng, Lỗi, Không thấy trên Pippit), theo nền tảng và kênh; nút “Đồng bộ” lấy trạng thái mới từ Pippit.',
    },
  ],
  concepts: [
    { term: 'Pippit', meaning: 'Dịch vụ trung gian đăng bài lên Fanpage Facebook và TikTok. App đăng nhập Pippit bằng tài khoản bạn thêm ở Cài đặt.' },
    { term: 'Workflow folder', meaning: 'Thư mục Drive con do bạn đặt tên để gom video của một dự án.' },
  ],
  problems: [
    {
      symptom: 'Không thấy kênh nào để chọn',
      fix: 'Liên kết Fanpage / kênh TikTok ở tài khoản Pippit rồi quét lại kênh liên kết trong Cài đặt.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Danh sách video Drive trống hoặc báo “Không thể tải danh sách video từ Google Drive”',
      fix: 'Kết nối lại Google Drive; chọn đúng thư mục có file MP4 trực tiếp (thư mục chỉ có folder con thì báo “Folder này chưa có video MP4 trực tiếp”).',
      link: 'Cài đặt',
    },
    {
      symptom: 'Bảng kết quả có video lỗi',
      fix: 'Đọc lý do ở dòng lỗi. Kênh hiện “Hết hạn ủy quyền” thì cấp quyền lại trong Cài đặt. Lỗi “Pippit không trả task id” hoặc lỗi mạng: bấm “Đồng bộ” ở tab “Lịch đã đặt” trước, vì Pippit có thể đã nhận bài.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Bài trong Lịch đã đặt báo lỗi',
      fix: 'Mở dòng lỗi để xem lý do, sửa kết nối rồi đặt lịch lại.',
    },
    {
      symptom: 'Video bị đánh dấu “Đã đăng lên kênh này”',
      fix: 'Video đó đã được đăng hoặc lên lịch lên đúng kênh đích. Bấm “Bỏ chọn” ở thanh dưới cùng để bỏ hết các video trùng, hoặc đổi kênh riêng cho video đó.',
    },
  ],
  related: ['Dashboard', 'Lên lịch Youtube', 'Video', 'Cài đặt', 'Lịch sử'],
  changes: [
    { date: '2026-11-15', text: 'Đặt lịch gửi lần lượt từng video: có tiến trình thật, nút “Dừng”, bảng kết quả từng video; video đã xong tự bỏ chọn. Cảnh báo video đã đăng lên đúng kênh đích. Thẻ kênh hiện rõ Facebook / TikTok và kênh hết hạn ủy quyền. Tab “Lịch đã đặt” dùng chung danh sách với Lịch sử. Sửa: nút “Đổi thư mục” không đổi được thư mục.' },
  ],
}
