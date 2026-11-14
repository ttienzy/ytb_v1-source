import type { HelpDoc } from '../model.ts'

export const canvasAiDoc: HelpDoc = {
  pageId: 'Canvas AI',
  title: 'Canvas AI (sơ đồ node & Motion Control)',
  summary:
    'Không gian node-graph để tự động hóa video từ ảnh sản phẩm (ảnh → Gemini phân tích → kịch bản → clip Flow → xuất video), và tab Motion Control để chuyển động tác từ một video mẫu sang nhân vật/bối cảnh của bạn. Chỉ dùng Omni 1.2 Flash qua Google Flow; mỗi clip tốn credit thật.',
  verifiedAt: '2026-11-13',
  requires: [
    {
      label: 'Extension Flow đã nạp, tab Google Flow đã đăng nhập',
      fixPage: 'Cài đặt',
      fixHint: 'Thiếu thì app báo “Extension Flow chưa kết nối với Backend. Hãy mở Flow và kiểm tra extension.” Xem tab Google Veo trong Cài đặt.',
    },
    {
      label: 'Gemini đã đăng nhập và tài khoản ChatGPT (cho bước phân tích ảnh và viết kịch bản)',
      fixPage: 'Cài đặt',
      fixHint: 'Phân tích ảnh dùng Gemini; viết chữ đi qua tài khoản ChatGPT web.',
    },
  ],
  start: [
    {
      title: 'Chọn chế độ làm việc',
      do: 'Hai tab trên cùng: “Kịch Bản Liên Hoàn” (chuỗi node từ ảnh sản phẩm ra video) hoặc “Motion Control” (chuyển động tác từ video mẫu).',
    },
    {
      title: 'Cấu hình Flow',
      do: 'Mở cấu hình Veo/Flow và chọn Omni 1.2 Flash; chọn hoặc tạo Flow project. Chạy khi chưa có project hoặc model sẽ báo lỗi cụ thể.',
    },
    {
      title: 'Nạp nguyên liệu và chạy',
      do: 'Kịch Bản Liên Hoàn: tải ảnh sản phẩm, người mẫu và bối cảnh vào các node đầu rồi bấm chạy từ node chính. Motion Control: nạp video chuyển động mẫu (bắt buộc), ảnh nhân vật/bối cảnh, viết Creative Brief rồi “Tạo Video Flow”.',
      result: 'Clip xuất hiện trong thư viện video; Kịch Bản Liên Hoàn còn ghép và xuất ở node cuối.',
    },
  ],
  areas: [
    {
      id: 'kich-ban-lien-hoan',
      name: 'Tab Kịch Bản Liên Hoàn (node graph)',
      what: 'Dây chuyền node: Ảnh sản phẩm → Người mẫu/KOL và Bối cảnh → Gemini phân tích (điểm nổi bật/USP) → GPT kịch bản (lời thoại tiếng Việt, prompt Veo tiếng Anh, chữ trên màn hình) → Veo Flow Studio (node chính, clip khởi đầu) → các node cảnh → xuất timeline (ghép nhạc nền, khổ 9:16). Kịch bản có hai kiểu: “Clip độc lập” hoặc “Phim liên hoàn” (clip sau nối tiếp clip trước).',
      how: [
        'Nối các node đúng thứ tự luồng xử lý; nối sai sẽ báo “Kết nối không hợp lệ”.',
        'Node chính là điểm bắt đầu khi bấm chạy toàn bộ quy trình.',
        'Đổi cấu hình sau khi sinh kịch bản thì node báo “Kết quả hiện tại được sinh bằng cấu hình cũ”: sinh lại trước khi sang Flow.',
      ],
    },
    {
      id: 'thanh-cong-cu',
      name: 'Thanh công cụ',
      what: 'Chọn Node chính và Studio, “Mặc định (Sketch)” khôi phục bố cục chuẩn của sơ đồ, “Thư Viện Video” mở kho video đã xuất.',
    },
    {
      id: 'motion-control',
      name: 'Tab Motion Control',
      what: 'Chuyển giao chuyển động từ video mẫu sang nhân vật và góc máy mới theo mô hình “Ingredient” của Google Flow. Thành phần: video chuyển động mẫu (bắt buộc; MP4, MOV, AVI hoặc WMV), ảnh nhân vật và bối cảnh (PNG, JPG, WebP), Creative Brief (đạo diễn, camera, phong cách), cấu hình khung hình và xuất. Mở “Inspector” để chỉnh chi tiết và xem “Kiểm Tra Prompt Cấu Trúc (Preview)” trước khi chạy.',
      how: [
        'Chọn Flow project: “Project đã chọn” hoặc “Project mới / lượt”.',
        'Mỗi lượt tạo nhiều biến thể; biến thể lỗi bấm “Thử Lại” riêng, không cần tạo lại cả lượt.',
      ],
    },
    {
      id: 'motion-anh-nhan-vat-moi',
      name: 'Tạo Ảnh Nhân Vật Mới (node tùy chọn của Motion Control)',
      what: 'Muốn giữ khuôn mặt của bạn nhưng đổi trang phục: đưa ảnh nhân vật và ảnh trang phục, ChatGPT vẽ một ảnh tham chiếu mới (chân dung bên trái, trang phục xoay mặt trước, nghiêng, sau bên phải). Không gọi Google Flow, không tốn credit Flow; dùng tài khoản ChatGPT trong Cài đặt, mỗi ảnh thường 40–70 giây.',
      how: [
        'Node hiện sẵn bên trái ô Nhân Vật; nút X để ẩn, mở lại bằng mục “Tạo Ảnh Nhân Vật Mới” ở thanh bên trái.',
        'Tải “Ảnh nhân vật” và “Ảnh trang phục” (PNG, JPG, WebP, tối đa 10 MB). Ô Nhân Vật đã có ảnh thì có thể bấm “Lấy ảnh đang có ở ô Nhân Vật làm ảnh khuôn mặt”.',
        'Ghi “Thay đổi thêm” nếu cần (ví dụ kiểu tóc, giày), bấm “Tạo ảnh nhân vật”. Không ưng thì “Tạo ảnh khác”.',
        'Bấm “Dùng làm Ảnh Nhân Vật” để đưa ảnh vào ô Nhân Vật. Chưa bấm thì luồng tạo video không thay đổi gì.',
      ],
      tip: 'Khi ô Nhân Vật đang dùng ảnh này, prompt Motion tự đổi câu mở đầu: nói rõ ảnh là sheet của MỘT người (mặt lấy từ chân dung, áo lấy từ các góc) để video không ra nhiều người. Nên thử trước một lượt ngắn trước khi chạy nhiều biến thể.',
    },
    {
      id: 'motion-video-dai',
      name: 'Motion video dài',
      what: 'Flow chỉ nhận tối đa 10 giây mỗi lượt, nên video mẫu dài được cắt thành nhiều đoạn, tạo lần lượt rồi ghép lại. Đoạn sau có thể gối một phần cuối của đoạn trước để mối nối mượt. Mỗi đoạn là một lượt tính phí; đoạn lỗi thì hàng đợi dừng và không tự gửi lại. Có thể “Chỉ tạo đoạn này”, “Tạo lại đoạn này (tốn credit)”, “Ghép video”, và xóa watermark một lần trên video đã ghép (“Xóa watermark rồi tải”, không tốn credit).',
      how: [
        'Chia đoạn chưa tốn credit; bấm “Chạy lần lượt” khi sẵn sàng.',
        'Âm thanh: “Nhạc gốc của video mẫu”, “Nhạc nền từ thư viện” hoặc “Không âm thanh” (nên chọn nếu đăng TikTok để gắn sound trên TikTok). Tiếng do Flow tạo trong từng đoạn luôn bị bỏ.',
        '“Làm lại từ đầu” xóa kế hoạch hiện tại và chia lại.',
      ],
      tip: 'Video ghép mang watermark của Flow. Nếu bước xóa watermark trên video đã ghép bị từ chối (độ tin cậy thấp), xem trang Xóa Watermark: công cụ chắc chắn nhất trên clip Flow gốc chưa chỉnh sửa.',
    },
  ],
  concepts: [
    { term: 'Node chính', meaning: 'Node bắt đầu của luồng; bấm chạy sẽ chạy toàn bộ từ đây.' },
    { term: 'Omni 1.2 Flash', meaning: 'Model Google Flow duy nhất Canvas AI dùng; nhận ảnh tham chiếu và clip 3–15 giây.' },
    { term: 'Biến thể', meaning: 'Số phiên bản tạo ra cho cùng một yêu cầu; mỗi biến thể tốn credit.' },
  ],
  problems: [
    {
      symptom: 'Báo “Extension Flow chưa kết nối với Backend”',
      fix: 'Mở tab Google Flow đã đăng nhập, kiểm tra extension ở trang Veo Studio → Hệ Thống & Bridge hoặc Cài đặt → Google Veo.',
      link: 'Veo Studio',
    },
    {
      symptom: 'Báo “Thiếu Video chuyển động mẫu” hoặc “Thiếu ý tưởng chính (Creative Brief)”',
      fix: 'Motion Control bắt buộc có video mẫu (MP4, MOV, AVI, WMV) và Creative Brief.',
    },
    {
      symptom: 'Lượt báo ALL_VARIANTS_FAILED hoặc FLOW_TIMEOUT',
      cause: 'Flow lỗi hoặc quá thời gian chờ; Flow đôi khi hủy request nhưng vẫn tạo video.',
      fix: 'Xem chi tiết từng biến thể trên tab, kiểm tra tab Google Flow rồi bấm “Thử Lại” cho biến thể cần. Đừng chạy lại cả lượt khi chưa kiểm tra Flow vì có thể mất credit hai lần.',
    },
    {
      symptom: 'Báo “Chưa có Flow project”',
      fix: 'Chọn một Flow project hoặc chuyển sang chế độ “Project mới / lượt”.',
    },
    {
      symptom: 'Báo model không được hỗ trợ khi bấm chạy',
      fix: 'Canvas AI chỉ dùng Omni 1.2 Flash. Mở cấu hình Veo và chọn Omni 1.2 Flash.',
    },
    {
      symptom: 'Tạo Ảnh Nhân Vật Mới báo “ChatGPT không tạo được ảnh nhân vật”',
      cause: 'Chưa có tài khoản ChatGPT dùng được (hết phiên đăng nhập hoặc đụng giới hạn tạo ảnh).',
      fix: 'Vào Cài đặt, làm mới hoặc thêm tài khoản ChatGPT Plus rồi bấm tạo lại. App không tự thử lại.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Báo “Đang tạo một ảnh nhân vật khác”',
      fix: 'Mỗi lúc chỉ tạo một ảnh nhân vật; đợi lượt đang chạy xong (40–70 giây) rồi bấm lại.',
    },
    {
      symptom: 'Xóa watermark video dài báo không nhận ra watermark',
      fix: 'Công cụ chỉ nhận watermark ở vị trí chuẩn của clip Flow gốc; video đã cắt ghép có thể bị từ chối. Xem trang Xóa Watermark.',
      link: 'Xóa Watermark',
    },
  ],
  related: ['Veo Studio', 'Chiến dịch AI', 'Xóa Watermark', 'Voices', 'Thư viện nhạc', 'Cài đặt'],
  changes: [
    { date: '2026-11-13', text: 'Motion Control có node tùy chọn “Tạo Ảnh Nhân Vật Mới”: ảnh của bạn + trang phục → ảnh nhân vật mới (ChatGPT) cho ô Nhân Vật.' },
    { date: '2026-11-12', text: 'Đổi tên từ “AI Workflow” thành “Canvas AI”; chỉ dùng Omni 1.2 Flash.' },
  ],
}
