import type { HelpDoc } from '../model.ts'

export const veoStudioPageDoc: HelpDoc = {
  pageId: 'Veo Studio',
  title: 'Veo Studio (Google Flow)',
  summary:
    'Tạo video hàng loạt từ các cặp ảnh và prompt bằng Omni 1.2 Flash, tạo ảnh bằng Nano Banana và theo dõi cầu nối Google Flow. Mỗi video tạo ra sử dụng credit Flow.',
  verifiedAt: '2026-11-24',
  requires: [
    {
      label: 'Extension Flow đã nạp và tab Google Flow đang đăng nhập',
      fixPage: 'Cài đặt',
      fixHint: 'Tab “Google Veo” trong Cài đặt có hướng dẫn nạp extension (Developer mode → Load unpacked). Ở trang này, tab “Hệ Thống & Bridge” phải báo Bridge Online.',
    },
    {
      label: 'Một Project làm việc',
      fixHint: 'Google Flow yêu cầu video thuộc một Project. Chưa chọn thì trang báo “Chưa chọn Project làm việc”; bấm “Tạo Project” ở góc trên bên phải.',
    },
  ],
  start: [
    {
      title: 'Kiểm tra cầu nối',
      do: 'Mở tab “Hệ Thống & Bridge”: Bridge Server, Chrome Extension, Tab Google, Heartbeat phải ở trạng thái kết nối. Huy hiệu “Bridge Online/Offline” cũng hiện ở đầu trang.',
      result: 'Bridge Online.',
    },
    {
      title: 'Tạo hoặc chọn Project',
      do: 'Bấm “Tạo Project”, đặt “Tên hiển thị Project” rồi “Tạo Project”. Các lần sau chỉ cần chọn lại.',
    },
    {
      title: 'Tạo video hoặc ảnh',
      do: 'Tab “Tạo video hàng loạt”: thêm ảnh chính, dùng “Dán nhiều prompt” rồi bấm “Đưa vào hàng đợi”. Tab “Tạo Ảnh (Studio)”: nhập prompt, chọn model Nano Banana và khổ ảnh.',
      result: 'Video/ảnh xuất hiện trong thư viện; tải MP4/ảnh hoặc dùng tiếp.',
    },
  ],
  areas: [
    {
      id: 'tao-video',
      name: 'Tab Tạo video hàng loạt',
      what: 'Mỗi mục dùng một ảnh chính, một prompt và tối đa hai ảnh tham chiếu thêm để tạo một video bằng Omni 1.2 Flash. Ảnh chính được gửi đầu tiên trong danh sách Ingredients.',
      how: [
        'Đặt tỷ lệ, độ phân giải và độ dài 3–15 giây ở “Cấu hình chung”. Khi gửi lô, hệ thống lưu cấu hình vào từng mục.',
        'Có thể chọn nhiều ảnh chính cùng lúc, rồi đổi thứ tự bằng mũi tên ↑ ↓. Đầu vào mỗi mục cần đủ ảnh chính và prompt.',
        '“Dán nhiều prompt” ghép lần lượt theo thứ tự mục. Chọn mỗi dòng một prompt, mỗi đoạn một prompt (cách nhau bằng dòng trống), hoặc “Danh sách đánh số” (1. …, 2. …). Điền đủ số mục cần điền. Nếu muốn thay prompt đã có, chọn “Thay cả prompt đã có”.',
        'Backend xử lý từng mục theo thứ tự. “Tạm dừng mục chờ” để mục đang chạy hoàn tất rồi dừng. Khi có mục lỗi hoặc backend khởi động lại, bấm “Tiếp tục mục chờ” để chạy các mục còn lại.',
      ],
    },
    {
      id: 'tao-anh',
      name: 'Tab Tạo Ảnh (Studio)',
      what: 'Tạo ảnh qua Google Flow bằng các model Nano Banana. Thư viện ảnh đã tạo hiển thị tối đa 50 ảnh mỗi trang. Có thể “Thêm vào lô video” từ ảnh đã tạo để đưa ảnh và prompt sang mục mới trong danh sách video.',
    },
    {
      id: 'he-thong-bridge',
      name: 'Tab Hệ Thống & Bridge',
      what: 'Tình trạng cầu nối với Google Flow: Bridge Server (cổng, secret, uptime), Chrome Extension (phiên bản, heartbeat lần cuối), Tab Google, Session/Token, Queue và số lần giải reCAPTCHA.',
    },
    {
      id: 'ket-qua',
      name: 'Xem và dùng video đã tạo',
      what: 'Khu “Video đã tạo” hiển thị tối đa 50 video mỗi trang. Dùng mũi tên để đổi trang và bấm vào ảnh xem trước để phát. Trên mỗi thẻ có nút tải video, lưu khung hình cuối, chuyển sang Video Editor, lên lịch đăng và xóa video.',
    },
  ],
  concepts: [
    { term: 'Project (Flow)', meaning: 'Không gian làm việc trong Google Flow chứa video/ảnh bạn tạo; mọi tác vụ phải thuộc một project.' },
    { term: 'Lô video', meaning: 'Danh sách các mục tạo video được gửi cùng lúc và xử lý theo thứ tự.' },
    { term: 'Bridge', meaning: 'Cầu nối cục bộ giữa app và extension Chrome đang điều khiển tab Google Flow.' },
  ],
  problems: [
    {
      symptom: 'Huy hiệu “Bridge Offline” hoặc báo “Flow bridge không phản hồi”',
      fix: 'Kiểm tra extension đã nạp, tab Google Flow đang mở và đã đăng nhập, rồi xem lại tab “Hệ Thống & Bridge”. Đừng nạp lại extension khi đang có job chạy.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Báo “Google Flow từ chối tạo video”',
      fix: 'Prompt hoặc ảnh tham chiếu bị từ chối, hoặc hết credit. Xem thông báo trong tab Flow, chỉnh prompt rồi thử lại.',
    },
    {
      symptom: 'Báo “Không nhận được job_id…; kiểm tra tác vụ trước khi tạo lại”',
      cause: 'Flow đôi khi hủy request nhưng vẫn tạo video.',
      fix: 'Đừng bấm tạo lại ngay: mở Flow hoặc thư viện video xem video đã có chưa để tránh mất credit hai lần.',
    },
    {
      symptom: 'Báo “Chưa chọn Project làm việc”',
      fix: 'Bấm “Tạo Project” (góc trên bên phải) hoặc chọn một project có sẵn.',
    },
    {
      symptom: 'Nút “Đưa vào hàng đợi” bị khóa',
      fix: 'Chờ tải ảnh xong và điền đủ ảnh chính, prompt cho từng mục.',
    },
    {
      symptom: 'Ảnh còn watermark',
      fix: 'Dùng nút xóa watermark ngay trên ảnh vừa tạo, hoặc trang Xóa Watermark.',
      link: 'Xóa Watermark',
    },
  ],
  related: ['Canvas AI', 'Chiến dịch AI', 'Xóa Watermark', 'Cài đặt', 'Lên lịch Youtube'],
  changes: [],
}
