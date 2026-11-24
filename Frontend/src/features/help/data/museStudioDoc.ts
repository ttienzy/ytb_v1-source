import type { HelpDoc } from '../model.ts'

export const museStudioDoc: HelpDoc = {
  pageId: 'Muse Studio',
  title: 'Muse Studio (Meta Muse Spark)',
  summary:
    'Tạo video điện ảnh bằng Meta Muse: bạn viết prompt (kèm ảnh/video tham chiếu nếu muốn), app gửi thẳng tới máy ảo Muse của tài khoản bằng phiên đăng nhập đã lưu (không cần mở Chrome), chờ Muse render rồi tự tải file MP4 về xem ngay và lưu vào thư mục tải về.',
  verifiedAt: '2026-11-24',
  requires: [
    {
      label: 'Ít nhất một tài khoản Muse đã đăng nhập',
      fixPage: 'Cài đặt',
      fixHint: 'Cài đặt → tab “Muse AI (Meta)” → “(+) Thêm tài khoản Muse”, đăng nhập Meta/Muse trong cửa sổ Chrome vừa mở.',
    },
    {
      label: 'Cấu hình Muse (thư mục tải, thời gian chờ, hậu tố prompt)',
      fixPage: 'Cài đặt',
      fixHint: 'Tab “Muse AI (Meta)” trong Cài đặt. Thời gian chờ video tối thiểu 600 giây.',
    },
  ],
  start: [
    {
      title: 'Chọn tài khoản và kiểm tra kết nối',
      do: 'Khi đã thêm tài khoản Muse, chọn tài khoản ở ô đầu trang hoặc để “Tự động” (app luân phiên các tài khoản sẵn sàng). Nhìn huy hiệu trạng thái: “Chưa kết nối” thì bấm “Mở Muse Chrome” và đăng nhập, rồi bấm huy hiệu để kiểm tra lại.',
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
      do: 'Chờ render (video thường mất vài phút). Video xong sẽ hiện ở màn hình xem trước và được lưu vào thư mục tải về. Đã gửi rồi thì đừng bấm lại khi đang chờ: mỗi lần gửi tốn một lượt của Muse.',
      result: 'Video MP4 xuất hiện trong khung xem và trong danh sách lịch sử.',
    },
  ],
  areas: [
    {
      id: 'day-chuyen-ba-muse',
      name: 'Dây chuyền 3 Muse',
      what: 'Chọn Tập mới, nhập chủ đề, nguồn tin và giọng văn. Scout tìm bài gốc và đề xuất ba góc. Showrunner phản biện nguồn, viết lời đọc từng cảnh và chờ bạn duyệt kịch bản. Producer tạo ảnh và clip, rồi app ghép giọng đọc thành bản nháp để phản biện và duyệt.',
      tip: 'Mở Đội Muse và cấu hình sản xuất để gán tài khoản, chọn giọng đọc, bật duyệt cảnh mẫu hoặc lưu lịch chạy theo giờ trên máy. Nhật ký bàn giao cho xem lại từng phiên bản. Khi một lượt đã gửi bị gián đoạn, chọn Đọc lại kết quả để tiếp nối đúng hội thoại.',
    },
    {
      id: 'trang-thai-ket-noi',
      name: 'Đầu trang: trạng thái và lối tắt',
      what: 'Ô chọn tài khoản Muse (chỉ hiện khi đã thêm tài khoản): “Tự động (xoay vòng …)” hoặc một tài khoản cụ thể; tài khoản hết phiên ghi “— hết phiên”, đang tạo video ghi “(đang chạy)”. Huy hiệu kết nối (Đang kiểm tra… / Sẵn sàng / Chưa kết nối; bấm để kiểm tra lại) của tài khoản đang chọn, “Mở Muse Chrome” (mở Chrome của tài khoản đó), “Thư mục video” (mở thư mục chứa video đã tải) và “Cài đặt” (nhảy tới cấu hình Muse).',
      tip: 'Mỗi tài khoản có cửa sổ Chrome riêng nên có thể tạo nhiều video song song trên các tài khoản khác nhau.',
    },
    {
      id: 'prompt',
      name: 'Mô tả cảnh quay (Video Prompt)',
      what: 'Ô nhập prompt, có nút xóa nội dung. Gợi ý phong cách nhanh (bấm để thêm mô tả có sẵn vào prompt): Cinematic 4K, Cyberpunk City, Thiên nhiên Macro, Chân dung Điện ảnh, Drone Bay Lượn, 3D Hoạt hình. Trong Cài đặt có thể đặt phần hậu tố prompt dùng chung (ví dụ “cinematic, 8k resolution, highly detailed”).',
    },
    {
      id: 'tuy-chon-tao-sinh',
      name: 'Tùy chọn tạo sinh',
      what: 'Hai công tắc: “Phân luồng New Chat riêng biệt” (mỗi lần tạo mở một chat mới trên Muse để video mới không dính vào dự án cũ) và “Tiếp nối video trước (Continuation)” (gửi vào đúng chat của lần tạo trước với tài khoản đó, để Muse giữ ngữ cảnh cho phân cảnh kế tiếp).',
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
    { term: 'Kết nối trực tiếp', meaning: 'App nói chuyện thẳng với máy ảo Muse của tài khoản (như trang muse.ai làm), dùng phiên đăng nhập đã lưu. Không cần mở Chrome; Chrome chỉ dùng khi thêm hoặc đăng nhập lại tài khoản.' },
    { term: 'Continuation', meaning: 'Chế độ nối tiếp: Muse nhớ video trước để cảnh sau liền mạch với cảnh trước.' },
    { term: 'Tự động (xoay vòng)', meaning: 'Không chọn tài khoản cụ thể: app dùng tài khoản “Sẵn sàng” đang rảnh và lâu chưa dùng nhất; tài khoản hết phiên bị bỏ qua.' },
  ],
  problems: [
    {
      symptom: 'Huy hiệu báo “Chưa kết nối”',
      cause: 'Chưa thêm tài khoản Muse, hoặc phiên đăng nhập của tài khoản đang chọn đã hết hạn (Chrome mở hay tắt không ảnh hưởng).',
      fix: 'Vào Cài đặt → Muse AI (Meta): chưa có tài khoản thì bấm “(+) Thêm tài khoản Muse”; tài khoản báo “Hết phiên” thì bấm “Đăng nhập lại”. Xong bấm huy hiệu để kiểm tra lại.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Báo “Không có tài khoản Muse nào sẵn sàng”',
      cause: 'Mọi tài khoản trong danh sách đều hết phiên đăng nhập.',
      fix: 'Vào Cài đặt → Muse AI (Meta), bấm “Đăng nhập lại” trên một tài khoản.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Báo “Không thể mở trình duyệt Muse”',
      fix: 'Đóng cửa sổ Chrome của tài khoản đó nếu đang treo rồi thử lại. Nút này chỉ để xem chat trên muse.ai; tạo video không cần Chrome.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Báo “Muse trả lời nhưng không có video: …”',
      cause: 'Muse hỏi lại, từ chối prompt hoặc hết hạn mức; câu trả lời của Muse được hiện nguyên văn.',
      fix: 'Đọc câu trả lời, chỉnh prompt cho rõ (ví dụ ghi “Create a 5-second video: …”) rồi tạo lại.',
    },
    {
      symptom: 'Báo “Muse chưa trả video sau … giây. Prompt ĐÃ được gửi”',
      fix: 'Muse vẫn có thể đang render. Bấm “Mở Muse Chrome” để xem chat trên muse.ai; đừng gửi lại để khỏi tốn thêm lượt. Có thể tăng thời gian chờ trong Cài đặt.',
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
    { date: '2026-11-24', text: 'Thêm dây chuyền ba vai Muse, duyệt theo tập, dựng theo cảnh và tải bộ asset.' },
    { date: '2026-11-15', text: 'Tạo video kết nối thẳng tới Muse, không còn điều khiển cửa sổ Chrome; ảnh/video tham chiếu được gửi kèm prompt.' },
    { date: '2026-11-15', text: 'Chọn được tài khoản Muse để tạo video, hoặc để “Tự động” luân phiên nhiều tài khoản.' },
    { date: '2026-11-12', text: 'Muse Studio có tài liệu hướng dẫn lần đầu.' },
  ],
}
