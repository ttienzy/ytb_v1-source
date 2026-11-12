import type { HelpDoc } from '../model.ts'

export const veoStudioPageDoc: HelpDoc = {
  pageId: 'Veo Studio',
  title: 'Veo Studio (Google Flow)',
  summary:
    'Xưởng tạo video và ảnh AI trực tiếp qua Google Flow: viết kịch bản nhiều cảnh để tạo video (Văn bản sang Video), tạo ảnh bằng Nano Banana, biến ảnh thành video, và theo dõi tình trạng cầu nối Flow. Mỗi lần tạo video tốn credit Flow thật.',
  verifiedAt: '2026-11-12',
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
      do: 'Tab “Tạo Video”: chọn Model Video, dán kịch bản (mỗi video bắt đầu bằng số thứ tự 1., 2., …) hoặc “Tải mẫu kịch bản”, chọn số biến thể rồi chạy. Tab “Tạo Ảnh (Studio)”: nhập prompt, chọn model Nano Banana và khổ ảnh.',
      result: 'Video/ảnh xuất hiện trong thư viện; tải MP4/ảnh hoặc dùng tiếp.',
    },
  ],
  areas: [
    {
      id: 'tao-video',
      name: 'Tab Tạo Video (Văn bản sang Video)',
      what: 'Dán kịch bản nhiều cảnh vào trình soạn kịch bản. Chọn “Chế độ phân tách”: mỗi mục thành một video hoàn chỉnh, hoặc tách từng mốc thời gian (0:00-0:02, 0:02-0:08) thành cảnh riêng. Có tùy chọn gắn tên món/chủ đề vào đầu prompt, lọc bỏ các dòng Text:/Music:, và tự khớp thời lượng 4/6/8/10 giây theo mốc thời gian. Mỗi cảnh có nút xem video, tải về, nhân bản, thử lại, xóa.',
      how: [
        'Chọn Model Video (cấu hình T2V do Backend cung cấp); chưa có thì chạy sẽ báo “Vui lòng chọn cấu hình Model trước khi chạy kịch bản!”.',
        'Chọn số biến thể (1–4) cho mỗi cảnh và mức chạy song song.',
        'Trạng thái gửi: “Đang gửi yêu cầu (giải CAPTCHA)…” → “Flow đã nhận token; đang tạo video…” → “Đã hoàn tất video!”.',
      ],
    },
    {
      id: 'tao-anh',
      name: 'Tab Tạo Ảnh (Studio)',
      what: 'Tạo ảnh qua Google Flow bằng các model Nano Banana, Nano Banana 2, Nano Banana 2 Lite và Nano Banana Pro (nhanh/rẻ đến chất lượng cao nhất). Chọn khổ: Ngang 1376×768, Dọc Shorts/TikTok 768×1376, Vuông 1024×1024, Dọc chân dung, Màn ảnh truyền thống. Nhập danh sách kịch bản ảnh, mỗi cảnh một dòng hoặc đánh số 1., 2. Từ ảnh đã tạo có thể “Tạo Video Từ Ảnh Này”, tải ảnh về hoặc xóa watermark.',
    },
    {
      id: 'anh-sang-video',
      name: 'Tab Ảnh sang Video',
      what: 'Biến ảnh thành video: chọn Frame 1 (khung hình bắt đầu) và có thể thêm khung hình kết thúc (Start → End), nhập prompt chuyển động và gửi. Cần Frame 1 trước khi chạy.',
      tip: 'Có thể “Lưu frame cuối vào Thư viện” từ một video để làm khung bắt đầu của đoạn tiếp theo.',
    },
    {
      id: 'he-thong-bridge',
      name: 'Tab Hệ Thống & Bridge',
      what: 'Tình trạng cầu nối với Google Flow: Bridge Server (cổng, secret, uptime), Chrome Extension (phiên bản, heartbeat lần cuối), Tab Google, Session/Token, Queue và số lần giải reCAPTCHA.',
    },
    {
      id: 'ket-qua',
      name: 'Xem và dùng video đã tạo',
      what: 'Xem trong trình phát, “Tải video MP4”, “Chuyển sang Video Editor” (mở trang Video để chỉnh), hoặc “Lên lịch Youtube” để đăng.',
    },
  ],
  concepts: [
    { term: 'Project (Flow)', meaning: 'Không gian làm việc trong Google Flow chứa video/ảnh bạn tạo; mọi tác vụ phải thuộc một project.' },
    { term: 'Biến thể', meaning: 'Số phiên bản tạo ra cho cùng một prompt; mỗi biến thể tốn credit riêng.' },
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
      symptom: 'Báo “Kịch bản chưa có phân cảnh nào để chạy”',
      fix: 'Dán kịch bản (đánh số 1., 2., …) hoặc bấm “Tải mẫu kịch bản”.',
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
