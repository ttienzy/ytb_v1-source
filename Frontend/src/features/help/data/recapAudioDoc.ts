import type { HelpDoc } from '../model.ts'

export const recapAudioDoc: HelpDoc = {
  pageId: 'Recap & Audio',
  title: 'Recap & Audio',
  summary:
    'Hai xưởng làm video có giọng đọc AI. Workflow YouTube: link YouTube → Gemini viết kịch bản recap → cắt cảnh + lồng tiếng → ghép thành video. Workflow Audio: truyện đã crawl → đọc từng câu bằng giọng AI → video có ảnh bìa + phụ đề → mỗi truyện một video FULL (hoặc mỗi chương một video).',
  verifiedAt: '2026-11-15',
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
      label: 'Workflow Audio: truyện đã crawl',
      fixPage: 'Crawl truyện',
      fixHint: 'Truyện phải có chương với nội dung không rỗng. Ảnh bìa nguồn được dùng tự động; không có thì video dùng ảnh thay thế.',
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
      title: 'Chọn giọng, nhạc nền và (với Audio) kiểu video, bố cục',
      do: 'Chọn giọng đọc, bật/tắt nhạc nền. Workflow Audio: chọn “Cả truyện” hoặc “Từng chương”, khổ video và bố cục (“Ảnh bìa + phụ đề” không cần video nền; “Nền video” cần thư viện video nền).',
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
      what: 'Mỗi truyện thành một video FULL có mốc chương (“Cả truyện”; truyện dài hơn 120 phút tự chia tập ở ranh giới chương) hoặc mỗi chương một video (“Từng chương”). Các bước của một video: Chuẩn bị → Giọng đọc → Dựng hình → Ghép âm thanh → Thumbnail & mô tả → (Upload Drive). Mỗi lần chạy tối đa 10 truyện, không giới hạn số chương.',
      flow: [
        'Chọn truyện ở Kho truyện',
        'Chọn chương (Shift+click chọn dải)',
        'Chọn kiểu video, giọng, khổ, bố cục',
        'Bấm “Bắt đầu”',
        'Xem “Video đã hoàn tất”, chép tiêu đề/mô tả',
      ],
      tip: 'Giọng đọc của từng chương được lưu lại: đổi bố cục, phụ đề hay nhạc rồi chạy lại thì không phải đọc lại (chỉ mất phần dựng hình, khoảng 1–2 phút). Xem thử 6 giây ở khối “Âm thanh & hiệu ứng” trước khi chạy cả lô.',
    },
    {
      id: 'kho-truyen',
      name: 'Kho truyện (cột trái)',
      what: 'Danh sách truyện đã crawl. Ô tìm kiếm không phân biệt dấu. Lọc nhanh: Chưa xong, Tất cả, Làm dở, Đã xong, Trong hàng đợi, và đánh dấu truyện đã có tóm tắt.',
      how: [
        'Chọn một truyện để hiện danh sách chương. “Chưa làm” chọn mọi chương chưa làm; Shift+click chọn dải, Ctrl+click chỉ để đọc.',
        'Mỗi truyện hiện ảnh bìa nguồn và thời lượng ước tính. Ảnh bìa nguồn được dùng làm hình video và thumbnail; muốn thay thì bấm “Đổi ảnh” ở đầu khung chương. Ảnh bìa nguồn nhiều khi không liên quan tới truyện — nên xem trước khi đăng.',
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
      what: 'Những chương sẽ chạy, gom theo truyện; mỗi dòng cho biết sẽ ra bao nhiêu video và dài khoảng bao lâu (bấm tên để quay lại truyện, có nút xóa từng mục và “Xóa toàn bộ hàng đợi”). Bên dưới là cài đặt của lần chạy; nút “Bắt đầu” ghi tổng số video và thời lượng ước tính.',
      how: [
        'Kiểu video: “Cả truyện” (mỗi truyện một video FULL, có mốc chương trong mô tả) hoặc “Từng chương” (mỗi chương một video — hợp Shorts/TikTok).',
        'Giọng đọc: nhóm Preset VieNeu và Giọng đã clone.',
        'Khổ video: Ngang 16:9 (YouTube) hoặc Dọc 9:16 (Shorts/TikTok/Reels).',
        'Bố cục: “Ảnh bìa + phụ đề” (nền mờ, ảnh bìa ở giữa, tên truyện, nhãn chương, phụ đề, lời nhắc đăng ký — không cần video nền) hoặc “Nền video” (video thư viện phủ kín khung; “Quản lý nền” mở khối Video; “Lấp đầy” cắt giữa, “Nền mờ” giữ trọn hình).',
        'Nhạc nền: một bài trong Thư viện nhạc (ngẫu nhiên hoặc bài đã chọn), tự hạ khi giọng đang đọc.',
        '“Tự upload Drive rồi xóa file local”: sau khi xong sẽ đẩy lên Drive và xóa bản local.',
        'Dưới nút “Bắt đầu” có đường dẫn nơi video được lưu.',
      ],
    },
    {
      id: 'am-thanh-hieu-ung',
      name: 'Âm thanh & hiệu ứng (khối gập)',
      what: 'Ba tab: Âm thanh, Chữ & logo, Bố cục Nền video. Có “Xem thử 6 giây” (đúng bố cục đang chọn, dùng ảnh bìa của truyện đang xem) và “Đặt lại mặc định”; đổi cấu hình thì phải xem thử lại để thấy kết quả mới.',
      how: [
        'Âm thanh: tốc độ đọc 0,7–1,5×; chọn bài nhạc nền; mức hạ nhạc khi có giọng (Tắt / Vừa / Mạnh); nhỏ dần cuối video; chuẩn hóa âm lượng (≈ −16 LUFS).',
        'Chữ & logo (cả hai bố cục): “Phụ đề theo lời đọc”, nhãn “Chương N”, “Lời nhắc đăng ký” (sửa được nội dung, hiện vài giây mỗi 2,5 phút), logo kênh (chọn ảnh, góc, cỡ, độ đậm).',
        'Bố cục Nền video (chỉ có tác dụng khi chọn bố cục đó): nguồn hình nền “Video trong thư viện” hoặc “Ảnh bìa zoom chậm”, làm tối nền, thẻ tiêu đề chương, waveform.',
      ],
    },
    {
      id: 'video-nen',
      name: 'Video nền (khối “Video”)',
      what: 'Chính là trang Video thu gọn, chỉ cần khi dùng bố cục “Nền video”. Thêm video local hoặc link YouTube vào kho; app tự chuẩn hóa nên không phân biệt video dọc hay ngang. Mỗi video ghép ngẫu nhiên các clip trong thư viện.',
    },
    {
      id: 'video-hoan-tat',
      name: 'Video đã hoàn tất',
      what: 'Danh sách video Audio đã làm, gom theo truyện. Mở một truyện để xem video kèm tiêu đề và mô tả gợi ý (mô tả có mốc chương và hashtag theo thể loại) — “Chép tiêu đề”, “Chép mô tả” để dán khi đăng. “Đẩy lên Drive” (lưu dạng Audio / Tên truyện / video.mp4), “Xóa ở local”.',
    },
  ],
  concepts: [
    { term: 'Raw transcript', meaning: 'Phụ đề/transcript bạn tự đưa vào thay vì để app lấy từ YouTube.' },
    { term: 'Bot-Wall', meaning: 'YouTube bắt xác thực tài khoản để chống tải tự động; cần đăng nhập qua Chrome để lưu cookie.' },
    { term: 'Hạ nhạc (ducking)', meaning: 'Nhạc nền tự nhỏ xuống khi giọng đang đọc, to lại khi giọng nghỉ.' },
    { term: 'Lấp đầy / Nền mờ', meaning: 'Hai cách đặt video nền vào khung: cắt giữa cho đầy, hoặc giữ trọn hình và lấp phần thừa bằng nền mờ.' },
    { term: 'Video FULL / Tập', meaning: 'Cả truyện trong một video; truyện dài hơn 120 phút được chia thành nhiều tập, mỗi tập gồm trọn vẹn các chương.' },
    { term: 'Mốc chương', meaning: 'Dòng “00:00 Chương 1”, “03:45 Chương 2”… trong mô tả — YouTube dùng để chia chương trên thanh thời gian.' },
  ],
  problems: [
    {
      symptom: 'Bấm “Bắt đầu” báo chưa có video nền',
      cause: 'Thư viện video nền trống hoặc chưa video nào sẵn sàng.',
      fix: 'Chỉ xảy ra với bố cục “Nền video”. Mở khối “Video” để thêm ít nhất một video, hoặc chọn bố cục “Ảnh bìa + phụ đề” ở cột Hàng đợi.',
      link: 'Video',
    },
    {
      symptom: 'Video dùng ảnh “AUDIO” thay vì ảnh bìa, hoặc tiến trình báo “Không dùng được ảnh bìa”',
      cause: 'Truyện không có ảnh bìa nguồn, hoặc không tải được ảnh từ trang nguồn lúc chạy (mạng chập chờn).',
      fix: 'Chạy lại (ảnh bìa tải được một lần là được lưu lại), hoặc chọn truyện rồi bấm “Đổi ảnh”/“Thêm ảnh” để dùng ảnh của bạn.',
    },
    {
      symptom: 'Báo “Nội dung chương N đang rỗng”',
      cause: 'Chương crawl về không có chữ.',
      fix: 'Crawl lại chương đó ở trang Crawl truyện hoặc bỏ chương khỏi hàng đợi.',
      link: 'Crawl truyện',
    },
    {
      symptom: 'Lỗi “Hàng đợi phải có từ 1 đến 10 truyện”',
      fix: 'Hàng đợi trống hoặc quá 10 truyện. Bỏ bớt hoặc chia làm nhiều lần chạy.',
    },
    {
      symptom: 'Workflow Audio dừng giữa chừng',
      cause: 'Chạy dừng sau 3 video lỗi liên tiếp để khỏi tốn thời gian.',
      fix: 'Xem thông báo lỗi ở thanh tiến độ phía trên (thường là giọng đọc hoặc nền), sửa rồi bấm “Bắt đầu”: chương chưa xong vẫn nằm trong hàng đợi, chương đã đọc giọng xong được dùng lại.',
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
    { date: '2026-11-15', text: 'Workflow Audio v2: video cả truyện (FULL, tự chia tập) hoặc từng chương; bố cục “Ảnh bìa + phụ đề”; phụ đề khớp từng câu; ảnh bìa nguồn tự dùng làm hình + thumbnail (không còn bắt buộc tải thumbnail); tiêu đề/mô tả có mốc chương; giọng đọc được lưu để làm lại nhanh.' },
  ],
}
