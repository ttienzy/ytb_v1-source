import type { HelpDoc } from '../model.ts'

export const recapAudioDoc: HelpDoc = {
  pageId: 'Recap & Audio',
  title: 'Recap & Audio',
  summary:
    'Hai xưởng làm video có giọng đọc AI. Workflow YouTube: link YouTube → Gemini viết kịch bản recap → cắt cảnh + lồng tiếng → ghép thành video. Workflow Audio: truyện đã crawl → đọc từng chương bằng giọng AI → ghép với video nền → mỗi chương một video.',
  verifiedAt: '2026-11-12',
  requires: [
    {
      label: 'Có ít nhất một giọng đọc',
      fixPage: 'Voices',
      fixHint: 'Ô chọn giọng báo “Chưa có giọng — tạo ở Voices trước” nếu chưa có. Voice-service phải đang chạy (mỗi lúc chỉ đọc một việc).',
    },
    {
      label: 'Workflow YouTube: Gemini đã đăng nhập (cookie)',
      fixPage: 'Cài đặt',
      fixHint: 'Kịch bản recap do Gemini viết qua cookie web. Hết hạn thì job dừng ở bước “Kiểm tra cookie Gemini”.',
    },
    {
      label: 'Workflow Audio: truyện đã crawl, có thumbnail',
      fixPage: 'Crawl truyện',
      fixHint: 'Truyện phải có chương với nội dung không rỗng và một ảnh thumbnail trước khi chạy.',
    },
    {
      label: 'Nhạc nền (tùy chọn): có bài trong Thư viện nhạc',
      fixPage: 'Thư viện nhạc',
      fixHint: 'Bật nhạc nền mà thư viện trống thì không chạy được.',
    },
    {
      label: 'Upload Google Drive (tùy chọn)',
      fixPage: 'Cài đặt',
      fixHint: 'Cần kết nối Drive và chọn thư mục Drive cho Audio.',
    },
  ],
  start: [
    {
      title: 'Chọn workflow ở hai tab trên cùng',
      do: '“Workflow YouTube” để recap từ video YouTube, “Workflow Audio” để biến chương truyện thành video có giọng đọc.',
    },
    {
      title: 'Nạp nguyên liệu',
      do: 'YouTube: dán link vào ô “Link YouTube” (hoặc chuyển từ Khám Phá Kênh). Audio: chọn một truyện ở danh sách bên trái, bấm chọn các chương.',
    },
    {
      title: 'Chọn giọng, nhạc nền và (với Audio) video nền',
      do: 'Chọn giọng đọc, bật/tắt nhạc nền. Workflow Audio cần thêm video nền (khối “Video”) hoặc chuyển sang nền “Ảnh bìa truyện”.',
    },
    {
      title: 'Bấm chạy và theo dõi',
      do: 'YouTube: “Bắt đầu tạo recap video”. Audio: “Bắt đầu” ở cột Hàng đợi. Tiến độ hiện theo từng bước; video xong nằm ở kết quả bên dưới và trong Lịch sử.',
      result: 'Video hoàn tất, có thể đăng lên kênh hoặc đẩy lên Drive.',
    },
  ],
  areas: [
    {
      id: 'workflow-youtube',
      name: 'Workflow YouTube — Đơn lẻ (1 video)',
      what: 'Làm một video recap từ một link YouTube. Cột trái là nguồn (Link YouTube, raw transcript), cột phải là Giọng đọc & Nhạc nền; lựa chọn giọng/nhạc được nhớ cho lần sau.',
      how: [
        'Dán link vào “Link YouTube”.',
        'Chọn giọng ở ô “Giọng đọc (Voice)”. Bật “Nhạc nền (BGM)”, bấm chọn một hay nhiều bài (số thứ tự là thứ tự phát), kéo “Âm lượng” (0–50%).',
        'Bấm “Bắt đầu tạo recap video”. Nút “Bắt đầu lại” xóa job hiện tại nhưng giữ giọng/nhạc đã chọn.',
      ],
      flow: [
        'Lấy transcript',
        'Kiểm tra cookie Gemini',
        'Gemini viết kịch bản',
        'Tải video gốc (song song)',
        'Tạo voice TTS (song song)',
        'Ghép video',
        'Polish nhạc nền',
        'Upload Drive',
      ],
      tip: 'Trạng thái ở cuối hàng nút: “Hoàn tất (có BGM)” là đã mix nhạc nền, “Hoàn tất” là chưa có nhạc, “Có lỗi” thì xem bước đỏ trong sơ đồ.',
    },
    {
      id: 'raw-transcript',
      name: 'Raw transcript (khi YouTube chặn tự lấy phụ đề)',
      what: 'Mở “Đính kèm raw transcript”: đính file .txt/.json hoặc dán văn bản, mỗi dòng dạng [MM:SS] caption. Bỏ trống cả hai thì app tự lấy từ YouTube. Nội dung được gửi nguyên văn cho Gemini, không chuẩn hóa; app lưu raw.txt để bạn kiểm tra lại.',
      tip: 'Có file đính kèm thì phần văn bản dán bị bỏ qua.',
    },
    {
      id: 'workflow-youtube-batch',
      name: 'Workflow YouTube — Hàng loạt (tối đa 10)',
      what: 'Mỗi dòng một link YouTube, dùng chung một giọng và một cấu hình nhạc nền. Link từ Khám Phá Kênh gửi sang sẽ tự mở chế độ này.',
      how: [
        'Báo lỗi “Một số link không phải YouTube URL” nếu có dòng không hợp lệ; phải chọn giọng, và bật nhạc nền thì chọn ít nhất 1 bài.',
        'Bảng trạng thái hiển thị từng video: Chưa bắt đầu / Đang xử lý / Hoàn tất / Đã dừng.',
      ],
    },
    {
      id: 'youtube-botwall',
      name: 'YouTube yêu cầu xác thực (Bot-Wall)',
      what: 'Khi YouTube chặn tải, hiện khung “YouTube yêu cầu xác thực tài khoản (Bot-Wall)”. Bấm “Đăng nhập YouTube qua Chrome”: app mở Chrome để bạn đăng nhập, lưu cookie rồi tự chạy tiếp job. Có thể mở Cài đặt để xử lý cookie.',
    },
    {
      id: 'youtube-ket-qua',
      name: 'Kết quả video recap',
      what: 'Mỗi video hiện kèm tiêu đề và caption để sao chép (“Sao chép tiêu đề”, “Sao chép toàn bộ Caption”) và các nút đăng: Đăng YouTube (Google OAuth), Đăng Facebook, Đăng TikTok (hai nút sau đi qua Pippit).',
    },
    {
      id: 'workflow-audio',
      name: 'Workflow Audio — quy trình tổng',
      what: 'Mỗi chương truyện thành một video: ảnh thumbnail → giọng đọc → đo thời lượng → ghép với video nền → (lớp phủ) → trộn tiếng → (nhạc nền) → xong. Mỗi lần chạy tối đa 10 truyện, không giới hạn số chương.',
      flow: [
        'Chọn truyện ở Kho truyện',
        'Chọn chương (Shift+click chọn dải)',
        'Cài giọng, khổ video, nền, nhạc',
        'Bấm “Bắt đầu”',
        'Xem “Video đã hoàn tất”',
      ],
      tip: 'Chạy thử trước bằng “Xem thử 6 giây” trong khối “Âm thanh & hiệu ứng” trước khi chạy cả lô.',
    },
    {
      id: 'kho-truyen',
      name: 'Kho truyện (cột trái)',
      what: 'Danh sách truyện đã crawl. Ô tìm kiếm không phân biệt dấu. Lọc nhanh: Chưa xong, Tất cả, Làm dở, Đã xong, Trong hàng đợi, và đánh dấu truyện đã có tóm tắt.',
      how: [
        'Chọn một truyện để hiện danh sách chương. “Chưa làm” chọn mọi chương chưa làm; Shift+click chọn dải, Ctrl+click chỉ để đọc.',
        'Truyện chưa có thumbnail thì phải “Thêm ảnh” (hoặc “Đổi thumbnail”) trước khi chạy.',
      ],
    },
    {
      id: 'doc-chuong-va-tom-tat',
      name: 'Đọc chương & Tóm tắt cốt truyện',
      what: 'Bấm một số chương để đọc nội dung ngay trong app (Chương trước/Chương sau). Tab “Tóm tắt cốt truyện”: “Tóm tắt bằng Gemini” đọc toàn bộ truyện (khoảng 1–3 phút), chỉ làm một lần và được lưu lại.',
      tip: 'Bản tóm tắt chỉ để bạn nắm cốt truyện; không được đưa vào video.',
    },
    {
      id: 'hang-doi',
      name: 'Hàng đợi (cột phải)',
      what: 'Những chương sẽ chạy, gom theo truyện (bấm tên để quay lại truyện, có nút xóa từng mục và “Xóa toàn bộ hàng đợi”). Bên dưới là cài đặt nhanh của lần chạy.',
      how: [
        'Giọng đọc: nhóm Preset VieNeu và Giọng đã clone.',
        'Khổ video: Dọc 9:16 hoặc Ngang 16:9 (chỉ cần chọn khổ; video nền tự khớp).',
        'Nền video: tóm tắt số video nền sẵn sàng. “Quản lý nền” mở khối Video. Chọn “Lấp đầy” (phóng và cắt giữa, không viền) hoặc “Nền mờ” (giữ trọn hình, phần thừa lấp bằng nền mờ).',
        'Nhạc nền: chọn ngẫu nhiên một bài trong Thư viện nhạc, mix nhỏ dưới giọng đọc.',
        '“Tự upload Drive rồi xóa file local”: sau khi xong sẽ đẩy lên Drive và xóa bản local.',
        'Dưới nút “Bắt đầu” có đường dẫn nơi video được lưu.',
      ],
    },
    {
      id: 'am-thanh-hieu-ung',
      name: 'Âm thanh & hiệu ứng (khối gập)',
      what: 'Ba tab: Âm thanh, Lớp phủ, Nền. Có “Xem thử 6 giây” và “Đặt lại mặc định”; đổi cấu hình thì phải xem thử lại để thấy kết quả mới.',
      how: [
        'Âm thanh: tốc độ đọc 0,7–1,5×; chọn bài nhạc nền; mức hạ nhạc khi có giọng (Tắt / Vừa / Mạnh); nhỏ dần cuối video; chuẩn hóa âm lượng (≈ −16 LUFS).',
        'Lớp phủ: thẻ tiêu đề chương (Tắt / Đầu video / Luôn hiện), waveform theo giọng đọc, logo kênh (chọn ảnh, góc, cỡ, độ mờ).',
        'Nền: nguồn hình nền là “Video trong thư viện” hoặc “Ảnh bìa truyện” (zoom chậm, không cần video nền), mức làm tối nền để chữ/waveform/logo dễ đọc.',
      ],
    },
    {
      id: 'video-nen',
      name: 'Video nền (khối “Video”)',
      what: 'Chính là trang Video thu gọn. Thêm video local hoặc link YouTube vào kho; app tự chuẩn hóa nên không phân biệt video dọc hay ngang. Mỗi chương ghép ngẫu nhiên các video trong thư viện.',
    },
    {
      id: 'video-hoan-tat',
      name: 'Video đã hoàn tất',
      what: 'Danh sách video Audio đã làm (lưu theo dạng Audio / Tên truyện / video.mp4). Chọn tất cả hoặc từng video, “Đẩy lên Drive”, “Xóa ở local”.',
    },
  ],
  concepts: [
    { term: 'Raw transcript', meaning: 'Phụ đề/transcript bạn tự đưa vào thay vì để app lấy từ YouTube.' },
    { term: 'Bot-Wall', meaning: 'YouTube bắt xác thực tài khoản để chống tải tự động; cần đăng nhập qua Chrome để lưu cookie.' },
    { term: 'Hạ nhạc (ducking)', meaning: 'Nhạc nền tự nhỏ xuống khi giọng đang đọc, to lại khi giọng nghỉ.' },
    { term: 'Lấp đầy / Nền mờ', meaning: 'Hai cách đặt video nền vào khung: cắt giữa cho đầy, hoặc giữ trọn hình và lấp phần thừa bằng nền mờ.' },
  ],
  problems: [
    {
      symptom: 'Bấm “Bắt đầu” báo chưa có video nền',
      cause: 'Thư viện video nền trống hoặc chưa video nào sẵn sàng.',
      fix: 'Mở khối “Video” để thêm ít nhất một video, hoặc đổi “Nguồn hình nền” sang “Ảnh bìa truyện” trong tab Nền.',
      link: 'Video',
    },
    {
      symptom: 'Báo “Truyện … chưa có thumbnail”',
      fix: 'Chọn truyện rồi bấm “Thêm ảnh” để tải ảnh PNG/JPG/WEBP lên, sau đó chạy lại.',
    },
    {
      symptom: 'Báo “Nội dung chương N đang rỗng”',
      cause: 'Chương crawl về không có chữ.',
      fix: 'Crawl lại chương đó ở trang Crawl truyện hoặc bỏ chương khỏi hàng đợi.',
      link: 'Crawl truyện',
    },
    {
      symptom: 'Lỗi “Queue Audio phải có từ 1 đến 10 truyện”',
      fix: 'Hàng đợi trống hoặc quá 10 truyện. Bỏ bớt hoặc chia làm nhiều lần chạy.',
    },
    {
      symptom: 'Workflow Audio dừng giữa chừng',
      cause: 'Chạy dừng sau 3 chương lỗi liên tiếp để khỏi tốn thời gian.',
      fix: 'Xem thông báo lỗi ở thanh tiến độ phía trên (thường là giọng đọc hoặc nền), sửa rồi chạy lại các chương chưa xong.',
    },
    {
      symptom: 'Lỗi voice-service bận hoặc quá lâu (timeout)',
      cause: 'Voice-service chỉ đọc một việc một lúc, hoặc đoạn văn quá dài/máy đang bận.',
      fix: 'Chờ việc đang chạy xong rồi thử lại; nếu văn bản rất dài thì chia nhỏ.',
      link: 'Voices',
    },
    {
      symptom: 'YouTube yêu cầu xác thực (Bot-Wall) hoặc tải thất bại',
      fix: 'Bấm “Đăng nhập YouTube qua Chrome” ở khung cảnh báo, đăng nhập xong job tự chạy tiếp. Video riêng tư hoặc giới hạn độ tuổi vẫn có thể không tải được.',
    },
    {
      symptom: 'Job dừng ở bước Gemini / kiểm tra cookie',
      fix: 'Cookie Gemini đã hết hạn. Đăng nhập lại Gemini trong Cài đặt rồi “Bắt đầu lại”.',
      link: 'Cài đặt',
    },
    {
      symptom: 'Hiện “Backend đã khởi động lại và không còn dữ liệu của job này”',
      fix: 'Job chạy trước khi backend restart nhưng chưa kịp lưu kịch bản. Bấm “Bắt đầu lại”. Nếu chỉ báo “Mất kết nối với backend — đang thử lại” thì job vẫn có thể đang chạy, chờ vài giây.',
    },
    {
      symptom: 'Không đẩy được lên Drive',
      fix: 'Kết nối Google Drive và chọn thư mục Drive cho Audio ở Cài đặt, rồi thử lại.',
      link: 'Cài đặt',
    },
  ],
  related: ['Khám Phá Kênh', 'Crawl truyện', 'Video', 'Voices', 'Thư viện nhạc', 'Lên lịch Youtube'],
  changes: [
    { date: '2026-11-12', text: 'Đổi tên từ “Workflow” thành “Recap & Audio”.' },
    { date: '2026-11-12', text: 'Workflow Audio thiết kế lại: kho truyện, đọc chương, tóm tắt Gemini, video nền gộp vào, tab Âm thanh/Lớp phủ/Nền.' },
  ],
}
