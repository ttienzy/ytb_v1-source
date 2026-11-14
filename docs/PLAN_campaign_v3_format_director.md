# Kế hoạch Chiến dịch AI v3: thẩm định, nghiên cứu thị trường và tái cấu trúc quy trình

Ngày: 2026-11-14. Trạng thái: **đề xuất, chưa code**. Tài liệu hiện hành của engine vẫn là [campaign-engine.md](campaign-engine.md); bản này là cơ sở để quyết định v3.

Cách đọc: §0 là kết luận. §2 là thẩm định từng khối với bằng chứng từ code và từ ba chiến dịch đã chạy thật. §3 là kết quả khảo sát (có nguồn). §4–§6 là định hướng, quy trình mới và các thử nghiệm phải làm trước khi viết code. Những chỗ ghi *chưa kiểm chứng* là chưa có số liệu, không đoán.

---

## 0. Kết luận

**Pipeline đã chạy trọn từ ảnh áo tới video** (chiến dịch `5d27a03c3a42`: 4 clip 720p Ingredients, 90 credit đo được, ghép xong 17,8 giây). Phần làm tốt nhất, và phải giữ: **mặt, áo và logo NY giữ đúng qua cả 4 clip**, Omni không vẽ lưới dù nhận ảnh storyboard nhiều khung, engine không bao giờ gửi lại lệnh tốn credit.

**Video đầu ra chưa đạt vì nó là catalog, không phải quảng cáo.** Nhìn khung hình thật: cả 4 shot cùng một bức tường, cùng ánh sáng, cùng khung medium-full, cùng dáng "tay trong túi"; shot 4 (10 giây, 30 credit) gần như lặp lại shot 1; không có tình huống, không có hành động với sản phẩm, hook "Cơ bản nhưng KHÔNG mờ nhạt" không thể hiện được bằng hình; chữ trên màn hình tắt; bản ghép cắt kiểu micro chỉ dùng 17,8/30 giây đã trả tiền.

**Nguyên nhân gốc (5 điểm, chi tiết ở §2):**
1. Kế hoạch được lập theo *loại storyboard kỹ thuật* (`hero_walk`, `turn_reveal`…) chứ không theo *format quảng cáo* mà người xem quen (fit check, 1 món nhiều cách phối, GRWM, cận chi tiết trước…). LLM điền hình thức, không có câu chuyện.
2. **Một `master_scene` + một khung mẫu** khóa toàn bộ phim vào một bức ảnh; giá trị "liền mạch" đổi bằng giá "đơn điệu".
3. **Storyboard nhiều khung theo từng shot** là lớp trung gian tốn 1 lượt ChatGPT + 1 cổng duyệt mỗi shot nhưng thêm rất ít thông tin (các khung gần như lặp khung mẫu); prompt clip đã mang đủ mốc thời gian.
4. **Prompt clip là danh sách ràng buộc**, không phải chỉ đạo đạo diễn: thiếu ống kính, hướng sáng, nhịp, hành động bằng động từ, âm thanh; các dòng `[0-3s]` chép nguyên mô tả *khung ảnh tĩnh*.
5. **Khối kế hoạch không ổn định**: Gemini trả JSON hỏng 3/8 lần chạy `shot_plan` (không sửa, không thử lại), bỏ qua luật số khung, chọn góc kể trái luật; luật "3 từ/giây" sai với tiếng Việt nên 5/5 hook bị cảnh báo giả.

**Hướng v3:** chuyển từ "pipeline theo bước kỹ thuật" sang **"format quảng cáo + đạo diễn theo cảnh"**: người dùng chọn 1 trong 5 format thị trường đang chạy; engine suy ra shot-list, bối cảnh (2–3 cảnh thay vì 1), nhịp và chữ; ảnh tham chiếu tách sạch theo vai (nhân vật trên nền trơn / áo thật / ảnh bối cảnh không người); bỏ storyboard theo shot khỏi đường chính; prompt clip theo công thức của Google (camera, chủ thể, hành động, bối cảnh, phong cách, âm thanh). Giảm 8 khối còn 6, giảm 4 cổng duyệt còn 2. Trước khi code: **6 thử nghiệm có kiểm soát, ≈120 credit 360p** (§6).

---

## 1. Phạm vi và bằng chứng

| Nguồn | Nội dung |
|---|---|
| Code | `Backend/app/campaign/` (graph, engine, runner, executors, 11 mẫu prompt), `app/veo/service.py` (Ingredients), extension `ingredients-ui.js` |
| Dữ liệu thật | 3 chiến dịch, 233 artifact, 193 lần chạy (`Backend/Data/app.db`) |
| Chiến dịch soi kỹ | `5d27a03c3a42` "Bộ thun trắng NY" (2026-11-10): 4 shot Ingredients 720p, look sheet, khung mẫu, 4 storyboard, video ghép |
| Xem bằng mắt | Look sheet, khung mẫu, 4 storyboard, khung hình lấy mỗi giây của 4 clip, 16 khung của bản ghép |
| Khảo sát | Tài liệu Google (Flow Help, AI Studio Omni, Vertex prompt guide, blog Flow), hướng dẫn bên thứ ba về Ingredients/Seedance/Kling, tổng hợp format quảng cáo thời trang 2026 (§9) |

Tôi không chạy thêm lượt Flow/ChatGPT nào cho bản này.

---

## 2. Thẩm định

### 2.1 Giữ nguyên (làm đúng)

- **Engine**: artifact bất biến, trạng thái tính từ fingerprint, cổng duyệt, làn tài nguyên, `SubmittedUnknown`, idempotency key theo vân tay + lần thử. Không có lỗi logic nào ở đây trong 193 lần chạy.
- **Chuỗi tham chiếu identity → look sheet → khung mẫu → clip** giữ đúng mặt, áo và logo. Đây là thứ các công cụ thương mại hay làm hỏng, và nó đang chạy được.
- **Omni 1.2 không hiện lưới** khi nhận ảnh storyboard 2–3 khung: 4/4 clip của chiến dịch cuối không có vết lưới. Câu hỏi mở của v2.4 đã có đáp án.
- **Lint rẻ** (lời chứng giả, `do_not_say`, lời hứa không thể hiện được bằng hình) đúng hướng; prompt xem trước = prompt gửi.
- Giá đo được 720p: 6 s = 18, 8 s = 24, 10 s = 30 credit (`credit_actual` của 4 clip) khớp công thức 3 credit/giây. Ba mốc này nên vào `FLOW_CREDIT_R2V` (hiện bảng chỉ có 13 s và 15 s 360p nên `credit_est` = `None`, trần ngân sách 300 không có tác dụng).

### 2.2 Video đầu ra: đối chiếu kế hoạch và clip thật

| Shot | Kế hoạch | Clip thật (khung mỗi giây) | Nhận xét |
|---|---|---|---|
| 1 `hero_walk` 6 s, push_in | đi về phía máy, nhìn máy | đi chậm, tay trong túi, cười nhẹ, máy đứng yên | Ổn về kỹ thuật, không có năng lượng mở đầu; "push in" không xảy ra |
| 2 `turn_reveal` 8 s, orbit | trước → nghiêng → sau | người tự xoay tại chỗ, máy đứng yên | Đúng beat; máy không orbit; mắt nhắm ở giây 3 |
| 3 `detail_macro` 6 s, pan | logo → cạp quần | cận logo rồi trượt xuống dây rút, tay vào túi | Tốt nhất phim: có hành động với sản phẩm |
| 4 `closer_cta` 10 s, pull_out | đứng tạo dáng, máy lùi | đứng gần y hệt shot 1, đổi tay | 30 credit cho cảnh lặp; 10 s đứng im |
| Ghép | 30 s kế hoạch | 17,8 s, micro-cut 2,2 s, tốc độ 1,2×, chữ tắt, fade, nhạc nền | Bỏ 40 % footage đã trả tiền; không có CTA hình, không nhãn AI |

Đọc như một người làm quảng cáo: không có *lý do để xem tiếp*. Không có tình huống (brief ghi "đi chơi, dạo phố, mặc nhà" nhưng hình chỉ có tường studio), không có chuyển cảnh, không có hành động cho thấy lợi ích (kéo dây rút, chạy, ngồi, phối đồ), ánh sáng và bố cục y hệt 4 shot. Lời thoại là mô tả chung ("thiết kế form rộng thoải mái"), không nói với một người cụ thể. Đây là hệ quả trực tiếp của `master_scene` duy nhất, khung mẫu duy nhất và 7 loại storyboard được định nghĩa bằng *tư thế* thay vì *ý đồ quảng cáo*.

### 2.3 Khối Kế hoạch (angle, hook, shot_plan, script)

| Vấn đề | Bằng chứng | Hệ quả |
|---|---|---|
| Góc kể chọn trái luật | `angle` của chiến dịch cuối: `chosen = angle:4` "style_transformation", `needs_motion: free`, chính Gemini ghi "xếp hạng thấp nhất"; luật mẫu bắt `chosen` = góc đầu. `normalize_angle` chỉ kiểm `chosen` có tồn tại, không kiểm thứ hạng hay `motion_limit` | Toàn bộ kế hoạch sau đó dựa trên góc kể cấm (biến hình) rồi bị lint chặn ở hook, thành ra hook và shot không ăn nhập với góc kể |
| Hook "contrast" tự mâu thuẫn | Mẫu hook cấm before/after nhưng kiểu 1 là "contrast"; kết quả "Cơ bản nhưng KHÔNG mờ nhạt" không thể nhìn thấy trong 1 khung | Hook mặc định luôn là thứ hình không thể hiện |
| Luật 3 từ/giây sai cho tiếng Việt | 5/5 hook bị `voiceover_too_long`; đo trên giọng VieNeu thật: 14 âm tiết = 3,68 s, 14 = 3,92 s, 13 = 3,60 s, 13 = 3,28 s → **≈3,6–4,0 âm tiết/giây** | Cảnh báo giả làm người dùng bỏ qua cảnh báo thật |
| Gemini trả JSON hỏng | 3/8 lần `shot_plan` lỗi `Expecting ',' delimiter` (cả bản nén lẫn bản thụt lề); 1/4 lần `script` | Mỗi lần lỗi = một lượt Gemini mất + người dùng bấm lại; không có bước sửa JSON (dấu phẩy thừa, chuỗi chưa đóng) hay thử lại có kiểm soát |
| LLM bỏ qua luật số khung | `panels_few` trên 3/4 shot của kế hoạch được duyệt | Luật nên do code quyết, không nhờ LLM đếm |
| Shot chi tiết nhắm 3 đích | `two_targets` shot 3 (logo, cạp, túi) nhưng clip ra vẫn ổn | Lint đúng nhưng không có đường sửa một chạm |
| `script` lặp `shot_plan` | 4/4 voiceover và on_screen_text trong `script` y hệt `shot_plan` | Một lượt LLM không thêm giá trị; hai nơi lưu cùng dữ liệu |
| Tổng thời lượng ảo | Kế hoạch 30 s, clip 30 s, ghép 17,8 s | Người dùng trả 90 credit cho 30 s nhưng không ai nói trước là micro sẽ bỏ 40 % |
| Bước cũ còn trong DB | `keyframe`, `motion_prompt`, `frame_pair_check` với `pair_check_override: true` trong `campaign_steps` của cả 3 chiến dịch | Rác dữ liệu, có thể hiện lên UI/kế hoạch |
| Bước chưa có executor | `look_check`, `clip_check`, `compliance`, `export_pack` khai báo nhưng `register_all` không đăng ký; `compliance` đã lỗi "Chưa có executor" 2 lần khi người dùng bấm chạy tất cả | UI hứa thứ engine không làm |

### 2.4 Khối Ảnh mẫu và Storyboard (xuất tham chiếu)

**Look sheet** (`look_sheet.txt`): chạy ổn, 40–120 giây/ảnh. Hai điểm cần sửa: `her` gắn cứng giới tính; nền xám đậm và chân dung 45° là đẹp nhưng Google khuyên ảnh chủ thể cho Ingredients nên **nền trơn hoặc đã tách nền** (Flow Help, §9). Sheet hiện là 16:9 ghép chân dung + turnaround không đầu: Omni phải tự suy "người bên trái mặc áo bên phải". Clip thật cho thấy nó suy được, nhưng là điểm yếu khi đổi nhân vật/áo khó hơn.

**Khung mẫu** (`anchor_frame.txt`): ý tưởng đúng (một ảnh chốt mặt + áo + ánh sáng) nhưng nó *trộn chủ thể với bối cảnh* trong một ảnh, trái với hướng dẫn Flow "ảnh bối cảnh/phong cách không nên có chủ thể" và "mỗi ảnh một trách nhiệm". `master_scene` được ghép từ `background; lighting` khi người dùng không điền, nên ra chuỗi mơ hồ *"bright minimal studio **or** clean urban wall; soft natural daylight"*; ChatGPT chọn tường studio có bóng lá, và cả phim kế thừa.

**Storyboard theo shot** (`storyboard.txt`): nhìn 4 ảnh thật, các khung gần như lặp lại khung mẫu ở tư thế khác (shot 1: đi/đứng; shot 4: đứng/đứng). Chi phí: 28–50 giây ChatGPT và một cổng duyệt mỗi shot (4 cổng cho 4 shot), cộng rủi ro trôi nhân dạng thêm một lớp (ảnh sinh từ ảnh sinh). Ảnh 1:1 hoặc 3:2 đưa vào video 9:16, nguồn bên thứ ba cảnh báo mô hình có thể dựng lại bố cục (§9, Starrd); clip thật chưa thấy lỗi này nhưng cũng chưa thấy lợi ích đo được so với chỉ gửi mốc thời gian. Giữ storyboard như **tùy chọn cho shot có bố cục lạ** (tương tác với đạo cụ, góc máy đặc biệt), không phải bước bắt buộc.

**Vai trò ảnh trong prompt clip**: prompt nói "the first image… the second image… the third image". Extension chèn ảnh bằng chip của Flow và điền prompt dạng chữ thô (`ingredients-ui.js`: `fill` bằng `insertText`), không đặt tên `@asset`; Flow không cam kết thứ tự chip tương ứng "first/second". Google khuyên **gọi theo vai bằng ngôn ngữ tự nhiên** ("the person in the character reference", "the garment in the product photo", "the location in the scene photo"). Nên đổi cách gọi; đặt tên `@` là việc mở cho extension (chưa kiểm chứng Flow có cho đặt tên khi tải ảnh qua chip hay không).

**Giới hạn 3 ảnh**: giao diện Flow nhận tối đa 3 ingredient (blog Google; `veo/service.py` và extension chặn >3). API Omni 1.2 nhận tới 6 ảnh (3/nhân vật, 2 nhân vật) nhưng đó là API, không phải Flow. *Chưa kiểm chứng* Flow hiện nay có nhận >3 không.

### 2.5 Prompt clip (`clip_ingredients.txt`)

Đối chiếu với hướng dẫn prompt của Google cho Omni/Veo (§9: thành phần = chủ thể, hành động, bối cảnh, góc máy, chuyển động máy, ống kính, phong cách/ánh sáng, yếu tố thời gian, âm thanh):

- **Có**: thời lượng, tỉ lệ, "single continuous shot", mốc `[0-3s]` (Google xác nhận hỗ trợ), PACE "no slow motion, no floating" (đúng bệnh của clip AI).
- **Thiếu**: ống kính/khoảng cách máy cụ thể, hướng và chất sáng, góc máy, biểu cảm theo nhịp, **âm thanh** (Omni luôn sinh audio; không chỉ đạo thì có thể ra tiếng nói lạ; ta đang bỏ audio nhưng vẫn nên ghi "Sound: soft room tone, no dialogue" để model không "diễn thoại").
- **Sai cách viết**: các dòng mốc thời gian chép nguyên `panels[].action`, vốn viết cho *ảnh tĩnh* ("A close-up shot focusing entirely on…"); video cần động từ hành động và thay đổi theo thời gian. "CAMERA: a smooth orbit through the whole shot" không đủ để Omni orbit (clip thật: máy đứng yên 4/4).
- **Phủ định quá dài**: AVOID gộp 9 thứ; Omni không hỗ trợ negative prompt, chỉ hiểu "Do not…" trong thân prompt; Google khuyên "mô tả thứ không muốn thấy" ngắn, cụ thể. Danh sách dài làm loãng chỉ đạo chính.
- **Độ dài**: 1.670–1.770 ký tự, sát trần 2.000.

### 2.6 Khối Ghép & Xuất

- `micro` là lựa chọn người dùng ở chiến dịch cuối, nhưng với clip đã trả tiền theo giây, mặc định `shots` đúng hơn; UI nên nói rõ micro bỏ bao nhiêu giây trước khi chạy.
- Chữ tắt (`caption_style: none`), không có thẻ kết (CTA + giá + nơi mua), không có nhãn "nội dung tạo bằng AI" dù luật Việt Nam từ 1/3/2026 bắt dán nhãn và TikTok yêu cầu bật nhãn AI (§9). `compliance`/`export_pack` chưa có executor nên không ai làm việc này.
- Hook chữ cần xuất hiện trong 0–1 giây đầu; hiện caption theo shot (nếu bật) hiện ở 83 % chiều cao, không có chữ mở màn riêng.

### 2.7 Vận hành

- 11 lỗi/75 lần chạy ở chiến dịch cuối. Ba lần `PROMINENT_PERSON` (Flow chặn khuôn mặt người thật) làm mất hai vòng look sheet + khung mẫu + keyframe (≈8 lượt ChatGPT) trước khi người dùng đổi sang nhân vật AI. **Phải cảnh báo ở bước Nhân vật**, trước khi tốn ảnh. Điều này cũng ảnh hưởng node "Tạo Ảnh Nhân Vật Mới" của Motion Control (ảnh sinh từ mặt thật có qua bộ lọc không: *chưa kiểm chứng*).
- 1 lần `FLOW_UI: Ingredients currently supports Omni 1.1 Flash` (extension đọc sai giao diện, đã qua ở lần sau); Flow sẽ gỡ Omni 1.1 và Veo 3.1 Fast ngày 5/12/2026 (Flow Help), extension không được rơi về các model này.
- Voice id không tồn tại (1 lần): chọn giọng từ danh sách thật thay vì lưu id cũ.

---

## 3. Khảo sát thị trường và prompt

### 3.1 Format video thời trang ngắn đang chạy (2026)

Nguồn chủ yếu là blog nhà cung cấp và agency (§9), không có benchmark độc lập; dùng như *mốc tham khảo*, không phải số liệu.

| Format | Cấu trúc | Vì sao hợp pipeline |
|---|---|---|
| **Fit check / OOTD** | 1–2 s hook (toàn thân, "outfit hôm nay"), xoay/đi, cận chi tiết, kết | Gần nhất với cái đang có; cần thêm *tình huống* (đi đâu) |
| **1 món, nhiều cách phối** ("one hero piece styled many ways", tracker tháng 11/2026 ghi là format nổi nhất tháng) | cùng áo, 2–3 bối cảnh/phụ kiện, cắt nhanh theo nhạc | Cần 2–3 cảnh, đúng điểm yếu hiện tại; không cần đổi áo |
| **GRWM rút gọn** (story-led, "chuyện trước, đồ sau") | hook là tình huống ("họp lớp sau 5 năm…"), mặc xong, ra đường | Kịch bản có lý do; Omni làm được cảnh "bước ra cửa" |
| **Cận chi tiết trước** (result-first / surprise visual) | 0–2 s cận logo/chất liệu đang chuyển động, rồi mới toàn thân | Shot 3 của chiến dịch thật là shot tốt nhất; đưa lên đầu |
| **Occasion / 3 dịp** (number signal) | "1 set, 3 dịp": 3 cảnh ngắn 3–4 s mỗi dịp + kết | Khớp brief "đi chơi, dạo phố, mặc nhà" |

Điểm chung các nguồn: hook trong 1–3 giây đầu, xem được khi tắt tiếng (chữ), POV ngôi thứ nhất chiếm 19/20 video TikTok Shop Việt Nam được theo dõi (octer.ai, một tuần, mẫu nhỏ), price hook và "proof" là góc bán phổ biến. Một nguồn ghi hook rate thời trang chỉ ~25 %, tức mở đầu là chỗ mất người xem nhiều nhất.

**Không hợp pipeline** (giữ cấm): biến hình/before-after (chỉ có một bộ đồ), lời chứng khách hàng giả.

### 3.2 Khả năng model và cách prompt (đã xác nhận từ Google)

| Điều | Nguồn |
|---|---|
| Omni Flash 1.2 Ingredients: 3–10 s không gói, 3–15 s có Google AI; 360p = 1/3 credit 720p; Omni 1.1 và Veo 3.1 Fast/Quality nghỉ 5/12/2026 | Flow Help 16352836 |
| Thêm ingredient bằng kéo thả hoặc `@tên tài sản`; prompt phải nói ingredient được dùng thế nào; **ảnh chủ thể/sản phẩm nên nền trơn hoặc tách nền; ảnh bối cảnh không có người; các ảnh cùng tông sáng để model trộn tốt** | Flow Help 16353334 |
| Tối đa 3 ingredient mỗi prompt trong Flow | blog.google (Flow tips) |
| API Omni 1.2: tới 6 ảnh tham chiếu; mô tả vai ảnh bằng ngôn ngữ tự nhiên (các chuỗi `<IMAGE_REF_N>` đã bỏ); mặc định model **có thể tự cắt cảnh**, muốn một cảnh phải ghi "In a single continuous shot" / "No scene cuts"; mốc thời gian `[0-5s]` mỗi dòng; **không hỗ trợ negative prompt**, viết "Do not X" trong thân; luôn có audio, mô tả "Sound design: …, no dialogue"; ảnh người thật/người nổi tiếng bị hạn chế | AI Studio docs/omni |
| Công thức prompt: chủ thể, hành động, bối cảnh, góc máy, chuyển động máy (dolly, truck, arc, handheld…), ống kính (shallow DOF, 85mm…), phong cách/ánh sáng, nhịp, âm thanh; mô tả thứ *không muốn thấy* thay vì "no/don't" | Vertex AI video prompt guide |

### 3.3 Thiết kế ảnh tham chiếu (bên thứ ba, đo trên Seedance; Omni *chưa kiểm chứng*)

- Lưới storyboard làm model **cắt cảnh theo từng ô**; chữ/số trong ảnh lọt vào video; ảnh tham chiếu khác tỉ lệ với video gây cắt đầu; ảnh *sinh ra từ ảnh* làm trôi mặt, nên gửi kèm ảnh gốc (Starrd).
- "Ba ảnh chỉ có ích khi mỗi ảnh có một trách nhiệm rõ": chủ thể (thấy trang phục của shot), vật thể (một món, hình khối rõ), bối cảnh (nơi hành động xảy ra được); nền của từng ảnh có thể "lây" sang video (QuestStudio).
- Seedance 2.0 gán `@Image1…` và cho phép 4 khung storyboard theo thứ tự; Kling "elements" tới 4 ảnh + try-on riêng; Vidu Q2 tới 7 chủ thể. Không đổi nhà cung cấp lúc này (Flow là đường đã tích hợp và đo giá), nhưng v3 nên tách **"clip provider"** thành giao diện để sau này cắm Seedance/Kling cho shot cần cắt nhiều cảnh.

### 3.4 Quy định

Luật AI Việt Nam hiệu lực 1/3/2026 bắt **dán nhãn nội dung tạo bằng AI**; TikTok yêu cầu bật nhãn AI khi đăng; Shopee gắn nhãn (ghi ở thiết kế cũ, có nguồn BigSeller). Gói xuất phải kèm dòng khai báo và nhắc bật nhãn trên nền tảng. *Chưa có nguồn pháp lý trong nước về cách dán nhãn cụ thể trên video quảng cáo bán hàng.*

---

## 4. Định hướng v3: năm nguyên tắc

1. **Format trước, bước sau.** Người dùng chọn *format quảng cáo* (§3.1), không chọn số shot/giây/loại storyboard. Mỗi format là một bản thiết kế có sẵn: số cảnh, nhịp, vai từng shot, kiểu hook, kiểu chữ, chỗ đặt CTA. LLM điền nội dung vào khung, không tự vẽ khung.
2. **Đạo diễn theo cảnh (scene), không theo khung ảnh.** Một chiến dịch có 1–3 *cảnh* (nơi + ánh sáng + hành động chính). Mỗi cảnh có một ảnh bối cảnh không người và (tùy chọn) một khung chốt người-trong-cảnh. Shot thuộc cảnh. Liền mạch đến từ cùng nhân vật + cùng áo + cùng tông sáng, không từ cùng một bức tường.
3. **Tham chiếu sạch theo vai.** Ba ingredient = *nhân vật trên nền trơn* + *ảnh áo thật* + *ảnh bối cảnh* (hoặc khung chốt cảnh). Prompt gọi ảnh theo vai bằng ngôn ngữ tự nhiên. Storyboard nhiều khung chỉ còn là tùy chọn cho shot có bố cục lạ.
4. **Trả tiền giây nào, dùng giây đó.** Thời lượng shot do format quyết (3–6 s cho beat ngắn, 8–10 s cho cảnh hành động, không dùng 11–15 s trừ khi format yêu cầu một cú liên tục); ghép mặc định giữ trọn; micro-cut chỉ khi người dùng chọn và được báo trước số giây bị bỏ.
5. **Chuẩn hóa sau khi đo, không trước.** Mỗi thay đổi prompt/tham chiếu phải qua ma trận thử nghiệm nhỏ (§6) với rubric chấm, rồi mới thành mặc định hệ thống (tăng `version`).

---

## 5. Quy trình mới (6 khối)

```
1 Sản phẩm ──► 2 Nhân vật & Cảnh ──► 3 Format & Kịch bản ──► 4 Khung chốt cảnh ✋ ──► 5 Clip ✋💳 ──► 6 Ghép & Xuất
   gói áo        cast sheet ✋           1 lượt LLM (schema)      1 ảnh / cảnh (tùy chọn)   3 ingredient         shots, chữ, CTA, nhãn AI
   (3 ảnh có vai)  scene plates          format → shot-list                                   prompt công thức      gói xuất theo nền tảng
```

### 5.1 Khối 1 Sản phẩm (giữ, thêm "gói áo")
- Giữ `fact_sheet` (Gemini) và luật rủi ro.
- **Gói áo**: từ ảnh tải lên, gán vai `front / back / detail` (người dùng kéo thả hoặc Gemini gợi ý); tự cắt một **ảnh cận chi tiết** (logo/họa tiết) vì shot cận cần ảnh tham chiếu cận, không phải ảnh toàn thân. Ảnh áo vào clip theo đúng vai shot cần.

### 5.2 Khối 2 Nhân vật & Cảnh (gộp cast + style + look + anchor)
- **Cast sheet** ✋ (thay look sheet): giữ prompt look sheet nhưng (a) nền trơn sáng, (b) bỏ `her`, (c) bố cục 3×2: hàng trên mặt trước / ¾ / nghiêng, hàng dưới 3 tư thế toàn thân mặc đúng áo (theo khuyến nghị bên thứ ba, *chưa đo trên Omni*). Giữ bản 16:9 chân dung + turnaround hiện tại làm biến thể để so trong §6.
- **Kiểm tra mặt thật** trước khi tốn ảnh: nếu ảnh nhân vật là ảnh người thật (người dùng khai hoặc Gemini nhận diện ảnh chụp), cảnh báo rủi ro `PROMINENT_PERSON` và đề nghị tạo nhân vật AI (dùng lại node "Tạo Ảnh Nhân Vật Mới" của Motion Control ở đây). *Chưa kiểm chứng* ảnh AI sinh từ mặt thật có qua bộ lọc không, nằm trong §6.
- **Scene set** thay `master_scene`: 1–3 cảnh, mỗi cảnh = tên, mô tả nơi, thời điểm, hướng sáng, hành động đặc trưng; `style_suggest` sinh từ format + brief (ví dụ format "3 dịp" → 3 cảnh). Mỗi cảnh có **scene plate**: một ảnh ChatGPT *không người*, 9:16, cùng tông sáng với cast sheet (Flow Help: ảnh bối cảnh không có chủ thể, các ảnh cùng tông).
- Lint cảnh: cấm "A or B" trong mô tả nơi; bắt buộc có hướng sáng.

### 5.3 Khối 3 Format & Kịch bản (gộp angle + hook + shot_plan + script thành một bước)
- Người dùng chọn **format** (5 mẫu §3.1, có thể thêm). Mỗi format là dữ liệu (`campaign/formats/*.json`): danh sách shot với `scene_role`, `duration`, `beat_role` (hook/proof/detail/cta), `camera` (góc + chuyển động theo từ vựng Google), `needs_face`, `text_slot`, `voice_words_max` tính từ 3,7 âm tiết/giây.
- **Một lượt LLM** điền nội dung: cho mỗi shot 2–3 *beat* viết bằng động từ (ai làm gì với áo/đạo cụ, nhìn đâu, cảm xúc), lời thoại, chữ, caption, hashtag. Schema JSON chặt, mô tả ngắn; **sửa JSON tự động** (dấu phẩy thừa, dấu ngoặc thiếu) rồi mới báo lỗi; cho phép một lần thử lại có kiểm soát vì bước này 0 credit.
- Code chốt: số shot, thời lượng, số beat (không nhờ LLM đếm), góc kể hợp `motion_limit`, chọn hook theo format (bỏ kiểu "contrast"), lời thoại theo **âm tiết/giây = 3,7 ± 15 %** đo từ giọng đã chọn (lưu trong cấu hình, cập nhật khi đo thêm).
- `angle`, `hook`, `script` vẫn xem/sửa được như *các phần* của một artifact kịch bản, không phải ba bước riêng. Reroll từng phần qua `changes`.

### 5.4 Khối 4 Khung chốt cảnh ✋ (thay khung mẫu + storyboard)
- Mỗi **cảnh** một ảnh "người trong cảnh" (cast sheet + ảnh áo + scene plate → 1 ảnh 9:16), duyệt một lần. 1 cảnh = 1 cổng, không phải 1 shot = 1 cổng.
- **Pose frame** (tùy chọn, theo shot): chỉ cho shot mà beat không mô tả nổi bằng lời (tư thế lạ, tương tác đạo cụ). Đây là chỗ giữ lại executor storyboard hiện có, mặc định tắt.
- Gate `clip` giữ như cũ.

### 5.5 Khối 5 Clip (Ingredients, prompt công thức)
- Ingredient theo vai, chọn tự động theo shot: `[cast sheet, ảnh áo (front hoặc detail theo shot), scene plate hoặc khung chốt cảnh]`. Prompt gọi theo vai: "the person shown in the character reference", "the exact garment in the product photo", "the place in the location photo".
- **Khung prompt mới** (thay `clip_ingredients.txt`, tăng `version`):
  ```
  {duration}-second vertical 9:16 video, single continuous shot, no scene cuts.
  SUBJECT: the person in the character reference, wearing the exact garment in the product photo (keep its color, cut and logo as photographed).
  LOCATION & LIGHT: the place in the location photo; {light_direction}, {time_of_day}.
  CAMERA: {angle}, {lens}, {movement} (từ vựng Google: eye-level / low-angle, 35mm / 85mm, slow dolly in / arc / handheld tracking).
  [0-3s] {beat 1: động từ, hướng nhìn, tay làm gì với áo}
  [3-6s] {beat 2}
  PERFORMANCE: {expression theo beat}; real-time pace, natural weight in steps, hair and fabric.
  SOUND: {room tone / street ambience}, no dialogue.
  Do not show: text, watermark, another person, a changed logo.
  ```
  Beat là câu hành động viết cho video, không chép mô tả khung ảnh. AVOID rút còn một dòng.
- Thời lượng: theo format; mặc định 4–8 s; 10 s chỉ cho cảnh hành động liên tục.
- Thêm ba mốc giá đo được vào `FLOW_CREDIT_R2V`; `credit_est` không được `None` cho các mốc 3–10 s 720p/360p (công thức đã khớp 4 điểm đo).
- Tách `ClipProvider` (submit/poll/cost) để sau cắm nhà cung cấp khác; không đổi hành vi Flow.

### 5.6 Khối 6 Ghép & Xuất
- Mặc định `shots`; micro hiện số giây bị bỏ trước khi chạy.
- **Chữ mở màn** 0–1,2 s (hook text, cỡ lớn, giữa màn), chữ theo shot ở vùng an toàn, **thẻ kết** 1,5–2 s (CTA + giá/khuyến mãi nếu brief có).
- **Nhãn AI**: dòng "Hình ảnh tạo bằng AI" nhỏ ở góc trong suốt video (tùy chọn tắt) + gói xuất kèm caption có dòng khai báo + nhắc bật nhãn AI trên TikTok/Shopee. Đây là executor `export_pack` thật; `compliance` thành lint 0 credit trên kịch bản (đang có sẵn trong `lint_text`), bỏ khỏi danh sách bước chạy.
- Bỏ `look_check`, `clip_check` khỏi đồ thị cho tới khi có executor (hiện chỉ làm UI báo lỗi).

### 5.7 Giữ / đổi / bỏ

| Hiện tại | v3 |
|---|---|
| `garment_source`, `fact_sheet` | Giữ, thêm vai ảnh + cắt cận |
| `cast`, `style`, `look`, `anchor_frame` | `cast` + `cast_sheet` ✋ + `scene_set` + `scene_plate` (map theo cảnh) |
| `angle`, `hook`, `shot_plan`, `script` (4 bước LLM) | `format` (input) + `script` (1 bước LLM, map-from cho shot) |
| `storyboard` ✋ (map theo shot) | `scene_anchor` ✋ (map theo cảnh) + `pose_frame` tùy chọn theo shot |
| `clip` ✋💳 | Giữ, ingredient theo vai, prompt mới, `ClipProvider` |
| `clip_check`, `look_check`, `compliance`, `export_pack` (không executor) | `compliance` → lint; `export_pack` → executor thật; hai bước check bỏ |
| `voice`, `assemble` | Giữ `isolated`; thêm chữ mở màn, thẻ kết, nhãn AI |
| Cổng duyệt: look, anchor, storyboard×n, clip×n | cast_sheet, scene_anchor×cảnh, clip×n |
| `master_scene` | `scene_set` (1–3 cảnh) |
| Luật 3 từ/giây | 3,7 âm tiết/giây ± 15 %, đo từ giọng |

Engine (`store`, `fingerprint`, `runner`, cổng, làn) **không đổi**; v3 là đổi đồ thị, executor và prompt. Chiến dịch cũ giữ nguyên artifact; đường chuyển đổi: chiến dịch tạo trước v3 mở ở chế độ chỉ đọc hoặc "nhân bản sang v3" (copy ảnh áo + nhân vật + brief).

---

## 6. Thử nghiệm bắt buộc trước khi code (GĐ0 của v3)

Mục tiêu: trả lời bằng clip thật các giả định ở §4–§5, dùng 360p (1 credit/giây) và cùng một áo + nhân vật AI đã có trong thư viện. Chấm bằng rubric 1–5 cho 5 tiêu chí: *nhân dạng*, *áo & logo*, *chuyển động tự nhiên*, *theo đúng beat*, *cảm giác quảng cáo*; hai người chấm độc lập (người dùng + tôi xem khung hình).

| # | Câu hỏi | Cách thử | Credit |
|---|---|---|---|
| T1 | Storyboard có đáng không | Cùng shot 6 s: (a) khung mẫu + storyboard + áo như hiện nay; (b) khung mẫu + áo + prompt beat mới, không storyboard | 12 |
| T2 | Tách vai ảnh có tốt hơn | (a) khung mẫu người-trong-cảnh; (b) cast sheet nền trơn + scene plate không người; cùng prompt | 12 |
| T3 | Prompt công thức vs prompt hiện tại | Cùng tham chiếu, cùng shot 2 (turn + orbit): prompt cũ vs khung §5.5 với "slow arc around the subject, 35mm, eye-level" | 12 |
| T4 | Omni có orbit/dolly thật không | 3 biến thể chuyển động máy trong khung mới (arc, dolly-in, handheld tracking) 5 s | 15 |
| T5 | 1 shot dài nhiều beat vs nhiều shot ngắn | 10 s có 3 beat vs 2×5 s cùng nội dung | 20 |
| T6 | Mặt AI sinh từ ảnh thật qua `PROMINENT_PERSON` không | Dùng node "Tạo Ảnh Nhân Vật Mới" với ảnh người thật → cast sheet → 1 clip 4 s | 4 (+ảnh ChatGPT) |
| T7 | Chỉ đạo âm thanh | Cùng shot với và không có dòng SOUND; nghe audio gốc trước khi bỏ | 10 |
| T8 | Giá các mốc chưa đo | 3 s, 4 s, 5 s 720p (ghi `credit_actual` vào bảng) | 36 |

Tổng ≈ 120 credit, ≈ 15 ảnh ChatGPT, 1 buổi. Kết quả ghi vào tài liệu này (mục "Kết quả GĐ0") trước khi quyết định cuối về storyboard và cast sheet.

---

## 7. Lộ trình (sau GĐ0, chưa cam kết thời gian)

| GĐ | Việc | Credit | Giao diện bấm thử |
|---|---|---|---|
| 1 | Khối 3: format (dữ liệu) + script 1 bước + sửa JSON + luật âm tiết + bỏ `contrast`; dọn bước cũ khỏi `campaign_steps`; thêm giá đo vào bảng | 0 | Panel Format, panel Kịch bản (xem 3 phần, reroll từng phần) |
| 2 | Khối 2: cast sheet mới, cảnh báo mặt thật, scene set + scene plate | ảnh ChatGPT | Panel Nhân vật & Cảnh, chọn số cảnh |
| 3 | Khối 4–5: khung chốt cảnh, ingredient theo vai, prompt mới, `ClipProvider` | 1 chiến dịch 360p | Panel Clip hiện 3 ảnh theo vai + prompt |
| 4 | Khối 6: chữ mở màn, thẻ kết, nhãn AI, `export_pack`; help doc + `docs/campaign-engine.md` | 0 | Panel Ghép & Xuất |
| 5 | Chiến dịch thật 720p theo 2 format khác nhau; so với video v2.4 bằng rubric | ≈150 | — |

Mỗi GĐ kèm UI bấm thử thật và e2e Playwright theo quy ước dự án; mỗi mẫu prompt đổi nội dung thì tăng `version`.

---

## 8. Rủi ro và điều chưa biết

- Omni có theo chuyển động máy (arc/dolly) không: clip thật 4/4 máy đứng yên; T4 quyết định có nên hứa "orbit" trong UI.
- Cast sheet 3×2 nền trơn chỉ có bằng chứng từ Seedance; Omni có thể thích bản chân dung + turnaround hiện tại hơn (T2).
- Flow có nhận >3 ingredient và có đặt tên `@` khi thêm bằng chip không: chưa kiểm chứng; nếu có, ảnh áo cận và ảnh áo toàn bộ có thể đi cùng lúc.
- Bộ lọc người nổi tiếng với mặt AI sinh từ ảnh thật (T6): nếu chặn, giá trị "giữ mặt của bạn" của cả Campaign lẫn node Motion Control chỉ còn với nhân vật hư cấu.
- Chất lượng tiếng Việt do Omni nói (nếu muốn bỏ TTS): chưa thử, không nằm trong v3.
- Format thị trường thay đổi theo tháng; dữ liệu format là file, không phải code, để cập nhật không cần phát hành.

---

## 9. Nguồn

Google (chính thức):
- Flow Help, Ingredients/References to Video: https://support.google.com/flow/answer/16352836?hl=en
- Flow Help, Create videos in Google Flow (thêm ingredient, `@`, mẹo): https://support.google.com/flow/answer/16353334?hl=en&co=GENIE.Platform%3DDesktop
- 5 tips for using Flow: https://blog.google/innovation-and-ai/products/flow-video-tips/
- Gemini Omni Flash video docs (tham chiếu, "single continuous shot", mốc thời gian, không negative prompt, audio): https://aistudio.google.com/docs/omni
- Vertex AI video prompt guide (thành phần prompt, từ vựng máy quay): https://docs.cloud.google.com/vertex-ai/generative-ai/docs/video/video-gen-prompt-guide
- Generate videos from references (Veo ≤3 ảnh, Omni 3–15 s): https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/video/generate-videos-from-references

Thiết kế tham chiếu và prompt (bên thứ ba, chưa kiểm chứng trên Omni):
- Character sheet vs storyboard grid (Seedance): https://www.getstarrd.app/blog/seedance-character-sheet-vs-storyboard-grid
- Veo 3.1 Ingredients reference planning: https://queststudio.io/blog/veo-3-1-ingredients-to-video
- Flow Ingredients & Scenebuilder consistency: https://www.dreamdrive.ai/learn/google-labs/flow-ingredients-and-scenebuilder-consistency/
- Veo 3.1 prompting guides: https://www.atlabs.ai/blog/veo-3.1-prompting-guide-every-feature-explained-with-copy-paste-prompts , https://www.dreamhost.com/blog/veo-3-1-prompt-guide/ , https://prompt-architects.com/blog/21-veo3-prompt-structure
- JSON prompting (chỉ là thói quen điền đủ ô, không phải cú pháp): https://artlist.io/blog/veo-3-json-prompts/
- Seedance 2.0 prompt/reference: https://lumalabs.ai/learning-center/articles/how-to-prompt-seedance-2.0 , https://www.atlascloud.ai/blog/generative-ai-model-seedance-2-0-a-guide-to-all-round-reference
- Storyboard bleed/grid: https://invideo.io/faq/why-does-a-storyboard-sketch-style-bleed-into-ai/ , https://www.fxi.studio/tutorials/how-to-split-storyboards-for-ai-generation

Thị trường / format:
- TikTok ad trends (beauty, fashion): https://billo.app/blog/tiktok-ad-trends/ , https://billo.app/blog/ugc-for-fashion-brands/
- TikTok clothing ads 2026: https://www.gethookd.ai/learn/4-tiktok-clothing-ads-examples-tips-for-2026/ , https://benly.ai/learn/tiktok-ads/tiktok-ads-fashion-brands , https://www.stackmatix.com/blog/tiktok-advertising-fashion-brands-2026
- Hook thời trang 2026: https://draper.chat/blog/tiktok-fashion-hooks-2026 ; tracker tháng 11/2026: https://tryvolume.app/working/fashion
- TikTok Shop Việt Nam (POV 19/20): https://octer.ai/tiktok-shop-video-generator/ranking/vn ; case study: https://www.mobidea.com/academy/tiktok-shop-vietnam-case-study-propellerads-2026/
- TikTok Shop AI Fashion Video Maker (1/2026): https://www.mediapost.com/publications/article/412106/tiktok-shop-offers-merchants-more-ai-powered-tools.html
- So sánh model cho quảng cáo thời trang (nhà cung cấp): https://www.kreadoai.com/article/best-ai-video-generators-ad-creative , https://opencreator.io/blog/ai-video-models-comparison-2026 , https://morphed.app/blog/ai-video-generator-for-fashion , https://invideo.io/faq/invideo-agent-one-vs-runway-vs-kling-ai-for-fashion-ad/
- Kling/Runway/Vidu reference features: https://ocdevel.com/mlg/mla-26 , https://apostle.io/tools/kling-2-6/ , https://aicomparison.ai/kling-ai-vs-runway/
- Google Doppl (đã đóng 30/4/2026, try-on chuyển vào Search): https://www.photta.app/pricing-and-reviews/doppl
