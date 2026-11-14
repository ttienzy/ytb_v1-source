import type { HelpDoc } from '../model.ts'

export const campaignDoc: HelpDoc = {
  pageId: 'Chiến dịch AI',
  title: 'Chiến dịch AI (video quảng cáo thời trang)',
  summary:
    'Biến ảnh áo thật + ảnh người mẫu thành video quảng cáo hoàn chỉnh qua 6 khối: Sản phẩm → Nhân vật & Cảnh → Format & Kịch bản → Khung chốt cảnh → Clip → Ghép & Xuất. Bạn chọn một format quảng cáo, app dựng sẵn khung shot; bạn duyệt cast sheet, khung chốt từng cảnh và từng clip. Chỉ khối Clip mới tốn credit.',
  verifiedAt: '2026-11-14',
  requires: [
    {
      label: 'Tài khoản ChatGPT (tạo ảnh)',
      fixPage: 'Cài đặt',
      fixHint: 'Cast sheet, ảnh bối cảnh và khung chốt cảnh được vẽ qua tài khoản ChatGPT web.',
    },
    {
      label: 'Gemini đã đăng nhập (đọc ảnh áo, viết kịch bản)',
      fixPage: 'Cài đặt',
      fixHint: '“Hồ sơ áo” do Gemini đọc từ ảnh thật; kịch bản cũng do Gemini viết.',
    },
    {
      label: 'Khối Clip: extension Flow đang chạy và đã đăng nhập Google Flow',
      fixPage: 'Veo Studio',
      fixHint: 'Clip được tạo bằng Omni 1.2 (Ingredients) trong Google Flow, tốn credit thật.',
    },
    {
      label: 'Khối Ghép & Xuất: giọng đọc (bắt buộc), Thư viện nhạc (tùy chọn)',
      fixPage: 'Voices',
      fixHint: 'Video luôn kèm tiếng đọc nên phải chọn một giọng. Thư viện nhạc trống thì không dùng được nhạc nền.',
    },
  ],
  start: [
    {
      title: 'Tạo chiến dịch',
      do: 'Cột trái “Chiến dịch”: bấm “+”, nhập tên (ví dụ “Áo Haim”) rồi bấm “Tạo”. Mỗi chiến dịch là một video quảng cáo cho một mẫu áo.',
    },
    {
      title: 'Khối 1: nạp ảnh áo',
      do: 'Tải ảnh áo thật (mặt trước, mặt sau, chi tiết/logo, nhãn), bấm “Lưu ảnh” rồi “Phân tích bằng Gemini”.',
      result: 'Hồ sơ áo được Gemini đọc ra, bạn có thể sửa.',
    },
    {
      title: 'Khối 3 trước: chọn format',
      do: 'Điền Brief và chọn một “Format quảng cáo” (ví dụ Fit check / OOTD). Format quyết định số cảnh, số shot, thời lượng và máy quay.',
    },
    {
      title: 'Khối 2: nhân vật và cảnh',
      do: 'Tải một ảnh nhân vật, bấm “Tạo cast sheet” và “Duyệt ảnh này”. Thêm đủ số cảnh mà format cần (mẫu nhanh hoặc “Gợi ý bằng Gemini”), “Lưu”, rồi tạo ảnh bối cảnh.',
    },
    {
      title: 'Khối 3: viết kịch bản',
      do: 'Bấm “Viết kịch bản”. Sửa beat, lời thoại, chữ của từng shot nếu cần rồi “Lưu chỉnh sửa”.',
    },
    {
      title: 'Khối 4: duyệt khung chốt từng cảnh',
      do: 'Bấm “Tạo khung chốt”, xem từng cảnh rồi “Duyệt”, hoặc từ chối kèm lý do để tạo lại.',
    },
    {
      title: 'Khối 5: tạo clip (tốn credit)',
      do: 'Chọn 360p (rẻ) hoặc 720p (nét), kiểm tra giá, rồi tạo clip cho từng shot. Nên thử một shot 360p trước.',
      result: 'Mỗi shot có một clip để duyệt.',
    },
    {
      title: 'Khối 6: ghép và xuất',
      do: 'Chọn giọng đọc, “Đọc lời thoại”, rồi “Ghép video hoàn chỉnh”. Bấm “Tạo gói đăng” để lấy caption, hashtag và checklist.',
      result: 'Video hoàn chỉnh có chữ mở màn, thẻ kết và nhãn AI.',
    },
  ],
  areas: [
    {
      id: 'danh-sach-chien-dich',
      name: 'Danh sách chiến dịch và đầu trang',
      what: 'Bên trái: tìm, tạo, chọn chiến dịch. Đầu trang: “Đổi tên”, “Trần credit Flow” và sơ đồ 6 khối cho biết khối nào đang ở trạng thái nào.',
      how: [
        'Trần credit: nhập số nguyên không âm; lần chạy vượt trần sẽ bị chặn. Để trống = không giới hạn.',
        'Đổi ảnh/đầu vào đã lưu sẽ làm các bước sau thành “Cũ”. Kết quả cũ không bị xóa; chỉ cần tạo lại bước nào bạn muốn.',
      ],
    },
    {
      id: 'khoi-1-san-pham',
      name: 'Khối 1 — Sản phẩm',
      what: 'Ảnh sản phẩm: mặt trước, mặt sau, chi tiết/logo, nhãn. Ảnh “Mặt trước” dùng cho cast sheet và khung chốt; ảnh “Chi tiết / logo” dùng cho shot cận; Gemini xem tất cả. Sau đó là “Hồ sơ áo” (loại sản phẩm, chất liệu nhìn thấy, họa tiết, cổ áo, có logo/chữ in…).',
      how: [
        'Sửa hồ sơ rồi “Lưu chỉnh sửa”; điểm rủi ro tính lại sau khi lưu và giới hạn mức chuyển động của các shot.',
      ],
    },
    {
      id: 'khoi-2-nhan-vat-canh',
      name: 'Khối 2 — Nhân vật & Cảnh',
      what: 'Một ảnh nhân vật rõ mặt và tóc; Thư viện nhân vật dùng lại giữa các chiến dịch. “Cast sheet” là ảnh tham chiếu nhân dạng + trang phục trên nền trơn (mặt 3 góc, trang phục 3 góc), phải duyệt. “Các cảnh” là 1–3 nơi quay, mỗi cảnh có tên, nơi quay, thời điểm, ánh sáng, không khí và việc người mẫu làm; mỗi cảnh có một ảnh bối cảnh không người.',
      how: [
        'Chọn “Gọi nhân vật là” (Nữ / Nam / Không ghi giới tính) để prompt gọi đúng.',
        'Tick “Ảnh nhân vật là người thật” nếu đúng: app cảnh báo vì Flow có bộ lọc người nổi tiếng, clip có thể bị chặn.',
        'Thêm cảnh bằng mẫu nhanh, “Cảnh trống” hoặc “Gợi ý bằng Gemini” (gợi ý đúng số cảnh của format), rồi “Lưu”.',
        'Sửa một cảnh chỉ làm “Cũ” ảnh bối cảnh, khung chốt và clip của cảnh đó.',
      ],
      tip: 'Mỗi cảnh chỉ ghi một nơi; áo trắng nên chọn nền có chiều sâu và tương phản, không phải tường trắng phẳng.',
    },
    {
      id: 'khoi-3-format-kich-ban',
      name: 'Khối 3 — Format & Kịch bản',
      what: 'Brief (đối tượng, dịp mặc, giá, khuyến mãi, ngôn ngữ, nền tảng đăng). “Format quảng cáo” là bản thiết kế có sẵn: Fit check / OOTD, Cận chi tiết trước, 1 món nhiều cách phối, 1 set 3 dịp, GRWM rút gọn; mỗi format ghi số cảnh, số shot và tổng giây. “Kịch bản” do Gemini viết một lượt theo khung format: ý tưởng, kiểu hook, chữ mở màn, và với từng shot là các beat (hành động theo thời gian), biểu cảm, lời thoại, chữ trên màn hình; cuối cùng là caption, hashtag và kêu gọi hành động.',
      how: [
        'Đổi format hoặc brief làm kịch bản thành “Cũ”; bấm “Viết lại” khi muốn.',
        'Từng shot sửa được: cảnh, thời lượng, chuyển động, ảnh áo dùng cho clip, góc máy, ống kính, chuyển động máy, beat.',
        'Bộ đếm lời thoại tính theo âm tiết (khoảng 3,7 âm tiết mỗi giây); vượt mức sẽ có cảnh báo.',
        'Sửa lời thoại và chữ không làm “Cũ” clip; sửa cảnh, thời lượng, máy quay, beat, chuyển động hay ảnh áo thì có.',
      ],
    },
    {
      id: 'khoi-4-khung-chot',
      name: 'Khối 4 — Khung chốt cảnh',
      what: 'Mỗi cảnh một ảnh người mẫu mặc đúng áo đứng trong bối cảnh, ghép từ cast sheet, ảnh áo thật và ảnh bối cảnh. Duyệt một lần mỗi cảnh; bản duyệt là ảnh tham chiếu bối cảnh của mọi clip trong cảnh đó. “Tỉ lệ video” ở đây dùng chung cho ảnh bối cảnh, khung chốt và clip.',
      how: [
        'Từ chối thì nhập lý do (ví dụ “mặt khác cast sheet”); ghi chú được gắn vào prompt lần tạo lại.',
        '“Prompt và ảnh tham chiếu sẽ gửi” cho xem đúng thứ sẽ gửi cho ChatGPT.',
      ],
    },
    {
      id: 'khoi-5-clip',
      name: 'Khối 5 — Clip (tốn credit Flow)',
      what: 'Omni 1.2 nhận 3 ảnh theo vai: cast sheet, ảnh áo thật, khung chốt của cảnh mà shot dùng; các beat thành mốc thời gian [0–2s]… trong prompt cùng máy quay, diễn xuất và âm thanh. Chọn thời lượng 3–15 giây và độ phân giải. Giá: 360p khoảng 1 credit/giây tới 10 giây rồi 2 credit/giây; 720p khoảng 3 credit/giây tới 10 giây rồi 6 credit/giây.',
      how: [
        '“Tạo lại (tốn credit)” và “Tạo clip … shot này” là các lệnh gửi lên Flow. App không bao giờ tự gửi lại.',
        'Nếu Flow hủy request nhưng video vẫn có thể đã được tạo, clip báo “Chưa rõ kết quả — KHÔNG gửi lại”. Hãy kiểm tra trong Flow thay vì tạo lại.',
        '“Xác nhận chưa gửi”: xác nhận một lần chạy chưa hề gửi lên Flow thì mới chạy lại được.',
        'Duyệt lại khung chốt của một cảnh chỉ làm “Cũ” clip của cảnh đó.',
      ],
      tip: 'Dùng 360p (rẻ) để thử chuyển động, hài lòng rồi mới tạo 720p. 720p có thể tạo thẳng, không bắt buộc qua 360p.',
    },
    {
      id: 'khoi-6-ghep-xuat',
      name: 'Khối 6 — Ghép & Xuất',
      what: 'Giọng đọc (bắt buộc), Phụ đề (chữ viền + đổ bóng, hộp đen hoặc không phụ đề), Kiểu dựng (“Giữ trọn từng shot” là mặc định; “Cắt nhanh theo nhịp nhạc” cho video ngắn hơn tổng thời lượng clip), Chuyển cảnh, Nhạc nền. Ba tùy chọn bật sẵn: “Chữ hook mở màn”, “Thẻ kết với CTA” và “Nhãn “Hình ảnh tạo bằng AI””.',
      how: [
        '“Ghép video hoàn chỉnh” tạo video; “Ghép lại video” khi bạn đổi tùy chọn.',
        'Menu tải có bản chính và các bản phụ (bản xóa watermark, bản tách nhạc nền). Bản phụ tạo một lần (0 credit), lần sau tải ngay.',
        '“Tạo gói đăng” cho caption + hashtag + dòng khai báo AI để dán khi đăng, kèm checklist theo nền tảng đăng chọn ở Brief.',
      ],
    },
  ],
  concepts: [
    { term: 'Format', meaning: 'Bản thiết kế của một kiểu video quảng cáo: số cảnh, danh sách shot với vai, thời lượng và máy quay. Kịch bản chỉ điền nội dung vào khung này.' },
    { term: 'Cast sheet', meaning: 'Một ảnh nền trơn có mặt nhân vật 3 góc và trang phục 3 góc. Là chuẩn nhận dạng cho mọi khối sau.' },
    { term: 'Cảnh / Khung chốt cảnh', meaning: 'Cảnh là một nơi quay; khung chốt là ảnh người mẫu đứng trong cảnh đó, khóa mặt, áo, nơi quay và ánh sáng cho mọi clip của cảnh.' },
    { term: 'Shot / Beat', meaning: 'Shot là một clip 3–15 giây; beat là từng nhịp hành động bên trong shot, thành mốc thời gian trong prompt clip.' },
    { term: 'Duyệt (cổng)', meaning: 'Bước bạn xác nhận ảnh/clip đạt thì khối sau mới dùng; từ chối kèm lý do để tạo lại.' },
    { term: 'Cũ (stale)', meaning: 'Kết quả được tạo từ đầu vào cũ. Không bị xóa, chỉ được đánh dấu để bạn quyết định có tạo lại không.' },
    { term: 'Trần credit', meaning: 'Hạn mức credit Flow tối đa cho một chiến dịch; lần chạy vượt hạn mức bị chặn.' },
  ],
  problems: [
    {
      symptom: '“Chưa đủ đầu vào” ở một khối',
      fix: 'Khối đó cần kết quả của khối trước (ví dụ khung chốt cần cast sheet đã duyệt, hồ sơ áo và ảnh bối cảnh). Hoàn thành và duyệt khối trước.',
    },
    {
      symptom: 'Clip báo “Chưa rõ kết quả — KHÔNG gửi lại”',
      cause: 'Flow có thể hủy request nhưng vẫn tạo video.',
      fix: 'Mở Google Flow kiểm tra xem video đã có chưa. Chỉ tạo lại khi chắc chắn chưa có để khỏi mất credit hai lần.',
      link: 'Veo Studio',
    },
    {
      symptom: 'Clip lỗi vì bộ lọc người nổi tiếng',
      cause: 'Flow nhận diện khuôn mặt người thật trong ảnh tham chiếu.',
      fix: 'Đừng chạy lại y nguyên. Dùng nhân vật AI (ảnh tạo mới, không phải ảnh người thật), tạo lại cast sheet và khung chốt.',
    },
    {
      symptom: 'Lần chạy bị chặn vì vượt trần credit',
      fix: 'Bấm ô “Credit Flow đã dùng” ở đầu trang để tăng hạn mức hoặc để trống không giới hạn.',
    },
    {
      symptom: 'Ảnh tạo ra bị méo logo hoặc sai mặt',
      fix: 'Từ chối ảnh kèm lý do cụ thể để ghi chú đi vào prompt lần tạo lại; kiểm tra ảnh chi tiết/logo ở khối 1 đã rõ chưa.',
    },
    {
      symptom: 'Kịch bản lỗi “JSON của Gemini không hợp lệ”',
      fix: 'App đã tự sửa và thử lại một lần; nếu vẫn lỗi, bấm “Viết kịch bản” lần nữa.',
    },
    {
      symptom: 'Không ghép được vì thiếu giọng đọc hoặc nhạc',
      fix: 'Chọn một giọng ở khối Ghép & Xuất. Nếu danh sách nhạc trống, thêm nhạc ở Thư viện nhạc.',
      link: 'Thư viện nhạc',
    },
    {
      symptom: 'Báo “Backend chưa cập nhật”',
      fix: 'Khởi động lại bằng npm start để backend nạp bản mới.',
    },
    {
      symptom: 'Ảnh bối cảnh báo “ChatGPT không tạo ảnh cho yêu cầu này mà trả lời bằng chữ”',
      cause: 'ChatGPT hiểu nhầm yêu cầu (ví dụ thành sửa ảnh) nên trả lời bằng chữ thay vì vẽ. Tài khoản vẫn dùng được.',
      fix: 'Bấm “Tạo ảnh” lại. Nếu vẫn lỗi, viết “Nơi quay” ngắn gọn, chỉ tả nơi (không nhắc áo hay người mẫu).',
    },
    {
      symptom: 'Tạo ảnh báo ChatGPT “tạm chặn vì hoạt động bất thường”',
      cause: 'ChatGPT chặn ngắn hạn khi tài khoản gửi nhiều yêu cầu tạo ảnh liên tục.',
      fix: 'Chờ vài phút rồi bấm tạo lại. Không cần thêm tài khoản.',
    },
    {
      symptom: 'Khối “Format & Kịch bản” báo kịch bản tạo ở phiên bản cũ',
      cause: 'Chiến dịch tạo trước khi có Format giữ kịch bản dạng cũ, không sửa được trong khung shot mới.',
      fix: 'Chọn một format rồi bấm “Viết lại”. Bản cũ vẫn được giữ.',
    },
    {
      symptom: 'Bản xóa watermark không dùng được',
      fix: 'Công cụ xóa watermark chưa sẵn sàng trên máy; xem hướng dẫn ở trang Xóa Watermark.',
      link: 'Xóa Watermark',
    },
  ],
  related: ['Veo Studio', 'Canvas AI', 'Voices', 'Thư viện nhạc', 'Cài đặt', 'Lên lịch Youtube'],
  changes: [
    { date: '2026-11-14', text: 'Sửa: mở khối Format & Kịch bản của chiến dịch cũ không còn làm trắng màn hình; ảnh bối cảnh không còn bị ChatGPT từ chối; thông báo lỗi tạo ảnh nói đúng lý do.' },
    { date: '2026-11-14', text: 'Quy trình mới 6 khối: chọn format quảng cáo, nhiều cảnh, cast sheet nền trơn, khung chốt theo cảnh, kịch bản một lượt, clip theo beat; video có chữ mở màn, thẻ kết, nhãn AI và gói đăng. Bỏ bước vẽ bảng phân cảnh từng shot.' },
    { date: '2026-11-12', text: 'Chiến dịch AI có tài liệu hướng dẫn lần đầu.' },
  ],
}
