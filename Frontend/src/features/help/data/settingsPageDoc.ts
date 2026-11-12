import type { HelpDoc } from '../model.ts'

export const settingsPageDoc: HelpDoc = {
  pageId: 'Cài đặt',
  title: 'Cài đặt (tài khoản & kết nối)',
  summary:
    'Nơi kết nối mọi dịch vụ ngoài mà các trang khác dựa vào: Gemini, ChatGPT, Google Veo/Flow, Muse, Google Drive, YouTube, Pippit, Mail.tm. Hầu hết lỗi “không chạy được” ở các trang khác đều bắt nguồn từ một kết nối ở đây đã hết hạn.',
  verifiedAt: '2026-11-12',
  requires: [],
  start: [
    {
      title: 'Bắt đầu với Gemini',
      do: 'Tab “Gemini & YouTube” → “Đăng nhập Gemini (Chrome)” (Cách 1, khuyên dùng). Đăng nhập Google một lần trong cửa sổ Chrome vừa mở, cookie được tự lưu.',
      result: 'Huy hiệu “Đã có Cookie”. Recap, Khám Phá Kênh và Chiến dịch AI dùng được Gemini.',
    },
    {
      title: 'Thêm tài khoản ChatGPT Plus',
      do: 'Tab “Tài khoản ChatGPT” → thêm tài khoản, đăng nhập ChatGPT Plus trong Chrome và mở một cuộc chat để app tóm phiên đăng nhập.',
      result: 'Chiến dịch AI vẽ ảnh và viết kế hoạch được.',
    },
    {
      title: 'Kết nối Google Flow (nếu làm video AI)',
      do: 'Tab “Google Veo”: cài extension Chrome (Developer mode → Load unpacked), mở tab Google Flow đã đăng nhập, kiểm tra Bridge Server báo kết nối.',
    },
    {
      title: 'Các kết nối còn lại khi cần',
      do: 'Google Drive (upload tự động), YouTube (đăng video), Pippit (đăng Facebook/TikTok), Muse (video Meta Muse).',
    },
  ],
  areas: [
    {
      id: 'gemini-youtube',
      name: 'Tab Gemini & YouTube',
      what: 'Cookie Gemini cho viết kịch bản recap và quét kênh. “Cách 1 (Khuyên dùng)”: đăng nhập qua Chrome, cookie tự lưu. “Cách 2 (Thủ công)”: dán chuỗi cookie của gemini.google.com. “Reset cookie” xóa cookie đã lưu (profile Chrome vẫn giữ). Phần “YouTube (Tải video Recap dự phòng)” đăng nhập YouTube qua Chrome để yt-dlp có cookie dự phòng khi gặp Bot-Wall. Tab còn có phần “Cập nhật Ứng dụng” (“Kiểm tra cập nhật ngay”, “Khởi động lại để cập nhật”).',
    },
    {
      id: 'chatgpt',
      name: 'Tab Tài khoản ChatGPT',
      what: 'Nhóm tài khoản ChatGPT Plus dùng chung để tạo ảnh (Chiến dịch AI) và viết kịch bản. Hỗ trợ nhiều tài khoản: đăng nhập, làm mới cookie, tạo ảnh thử nghiệm. Tài khoản chạm giới hạn ảnh sẽ vào trạng thái “Đụng giới hạn ảnh (cooldown)” và app chuyển sang tài khoản khác.',
      tip: 'Cookie hết hạn thì bấm làm mới hoặc đăng nhập lại (“Cookie hết hạn — đăng nhập lại”).',
    },
    {
      id: 'mailtm',
      name: 'Tab Mail.tm',
      what: 'Tạo email tạm thời và tự nhận mã xác nhận (OTP). Có thể tạo hàng loạt 1–20 tài khoản với tiền tố, domain và mật khẩu chung; xem danh sách đã lưu và mã xác nhận phát hiện được. Dùng cho đăng ký tài khoản Pippit.',
    },
    {
      id: 'pippit',
      name: 'Tab Pippit AI & Fanpages',
      what: 'Quản lý tài khoản Pippit (email, mật khẩu, proxy dạng user:pass@host:port tùy chọn) và Fanpage Facebook liên kết. Hiển thị trạng thái như “Sẵn sàng đăng bài”, “Cần cấp quyền”, “Hết hạn ủy quyền”; có thể quét lại các kênh liên kết và xem lịch bài đăng đang hẹn giờ.',
    },
    {
      id: 'gdrive',
      name: 'Tab Google Drive',
      what: 'Kết nối Drive bằng OAuth: nhập Client ID và Client Secret của Google Cloud (hoặc dán credentials.json), đăng nhập rồi dán Authorization Code/đường link chuyển hướng. Sau đó đặt thư mục gốc và thư mục con cho từng workflow (ví dụ Audio_Videos). Chưa cấu hình thì dùng thư mục mặc định.',
    },
    {
      id: 'youtube',
      name: 'Tab YouTube',
      what: 'Kết nối kênh YouTube để đăng video: nhập Client ID/Client Secret (tạo ở Google Cloud → Create Credentials), đăng nhập và cấp quyền, hoặc dán Authorization Code. Có thể ngắt kết nối kênh.',
    },
    {
      id: 'veo',
      name: 'Tab Google Veo (Flow)',
      what: 'Kết nối Google Flow để tạo video AI: trạng thái Bridge Server, Chrome Extension (cài bằng Developer mode → Load unpacked, bản và heartbeat lần cuối), Tab Google (tab Flow đã đăng nhập) và số dư credits. Có thể yêu cầu làm mới credits, nhập tay số dư, hoặc dán cookie/access token thủ công (tùy chọn).',
      tip: 'Đừng nạp lại extension trong lúc đang có job chạy.',
    },
    {
      id: 'muse',
      name: 'Tab Muse AI (Meta)',
      what: 'Cấu hình Chrome CDP cho Muse Studio: Muse App URL, cổng CDP, thời gian chờ render, thư mục lưu video, hậu tố prompt dùng chung, profile Chrome riêng. Hiển thị “Chrome đang chạy với CDP” / “Chưa phát hiện phiên đăng nhập Muse” và nút “Mở Chrome Muse”.',
    },
    {
      id: 'lien-he',
      name: 'Tab Liên hệ tác giả',
      what: 'Mã QR Telegram để báo lỗi, góp ý tính năng và hỗ trợ kỹ thuật.',
    },
  ],
  concepts: [
    { term: 'Cookie', meaning: 'Phiên đăng nhập của tài khoản web (Gemini, ChatGPT…). Hết hạn thì phải đăng nhập lại; app không dùng API chính thức cho các dịch vụ này.' },
    { term: 'Bridge Server', meaning: 'Máy chủ cục bộ nối app với extension Chrome để điều khiển Google Flow.' },
    { term: 'OAuth Client ID/Secret', meaning: 'Khóa tạo trong Google Cloud để app được phép dùng Drive/YouTube thay bạn. Bạn tự tạo và dán vào.' },
  ],
  problems: [
    {
      symptom: 'Recap hoặc Khám Phá Kênh báo lỗi Gemini / cookie hết hạn',
      fix: 'Vào tab “Gemini & YouTube”, đăng nhập lại bằng “Đăng nhập Gemini (Chrome)”.',
    },
    {
      symptom: 'Tải YouTube bị chặn (Bot-Wall)',
      fix: 'Ở phần “YouTube (Tải video Recap dự phòng)” đăng nhập YouTube qua Chrome để lưu cookie dự phòng cho yt-dlp. Có thể xóa cookie này nếu không cần.',
    },
    {
      symptom: 'Chiến dịch AI không vẽ được ảnh',
      cause: 'Tài khoản ChatGPT hết cookie hoặc chạm giới hạn ảnh.',
      fix: 'Tab “Tài khoản ChatGPT”: làm mới cookie, thêm tài khoản khác hoặc chờ hết thời gian cooldown.',
      link: 'Chiến dịch AI',
    },
    {
      symptom: 'Veo Studio / clip không chạy, Bridge không kết nối',
      fix: 'Kiểm tra extension đã nạp, tab Google Flow đang mở và đã đăng nhập; xem Bridge Server và heartbeat ở tab “Google Veo”.',
      link: 'Veo Studio',
    },
    {
      symptom: 'Không đẩy được lên Drive hoặc đăng YouTube',
      fix: 'Kết nối lại bằng OAuth. Báo thiếu Client ID/Secret nghĩa là chưa nhập khóa Google Cloud; hết hạn thì đăng nhập lại và dán Authorization Code mới.',
    },
    {
      symptom: 'Cần restart backend sau khi cập nhật',
      fix: 'Một số tab báo “Backend chưa được khởi động lại để nhận API mới”. Dừng và chạy lại npm start rồi mở lại trang Cài đặt.',
    },
  ],
  related: ['Recap & Audio', 'Chiến dịch AI', 'Veo Studio', 'Muse Studio', 'Lên lịch Youtube', 'Lên lịch Pippit'],
  changes: [
    { date: '2026-11-12', text: 'Viết lại tài liệu cho đủ 9 tab; Chiến dịch AI và viết kịch bản dùng tài khoản ChatGPT web.' },
  ],
}
