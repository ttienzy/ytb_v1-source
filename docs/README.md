# Mục lục tài liệu

Điểm vào để tìm tài liệu của dự án. Cài đặt/chạy/test/phát hành nằm ở [README gốc](../README.md); file này trả lời **"tài liệu về X nằm ở đâu và còn đúng không"**.

Cập nhật lần cuối: 2026-11-14. **Dev mới: bắt đầu ở [onboarding.md](onboarding.md).**

## Cách đọc trạng thái

| Nhãn | Nghĩa |
|---|---|
| **Hiện hành** | Mô tả đúng code hiện tại (đã đối chiếu), có thể dựa vào |
| **Tham chiếu** | Đúng ở phần cốt lõi nhưng có chỗ lỗi thời; đầu file có ghi chú chỉ rõ chỗ nào |
| **Backlog** | Kế hoạch cho việc chưa làm |
| **Lưu trữ** | Plan/ghi chú lịch sử trong [archive/](archive/): để hiểu *vì sao* code thành thế này, **không** dùng để biết code đang làm gì |

Khi tài liệu và code lệch nhau, **tin code** (và sửa tài liệu).

---

## Bắt đầu

| Đọc | Nội dung | Trạng thái |
|---|---|---|
| [onboarding.md](onboarding.md) | Mô hình tư duy, checklist ngày đầu, cách code tổ chức, công thức thêm endpoint/bảng/trang, test, tìm lỗi, **danh sách việc tồn đọng** | **Hiện hành** |
| [modules.md](modules.md) | Bản đồ từng trang: code ở đâu, API nào, lưu gì, lưu ý gì | **Hiện hành** (một số mục mới ở mức cấu trúc, có ghi rõ) |
| [data-and-paths.md](data-and-paths.md) | Dữ liệu nằm ở đâu ở dev và bản đóng gói; 5 cách tính đường dẫn; các nghi vấn lỗi bản cài | **Hiện hành** |
| [README gốc](../README.md) | Cài đặt, chạy dev, kết nối dịch vụ, test, release, bẫy đã biết | **Hiện hành** |
| [Desktop/README.md](../Desktop/README.md) | Launcher `npm start`, cờ, vì sao không dùng `uvicorn --reload` | **Hiện hành** |
| [CLAUDE.md](../CLAUDE.md) | Quy ước khi làm việc với Claude Code trong repo | **Hiện hành** |

## Theo chủ đề

### Tạo video qua Google Flow / Veo (Canvas AI, Veo Studio, Chiến dịch AI)
| Đọc | Trạng thái |
|---|---|
| [flow-integration.md](flow-integration.md): kiến trúc backend ⇄ bridge ⇄ extension, vòng đời job, cổng FIFO, HTTP vs UI, khôi phục, quy tắc không được phá | **Hiện hành** |
| [Extensions/FlowsVeo-Clean/docs/architecture.md](../Extensions/FlowsVeo-Clean/docs/architecture.md), [bridge-protocol.md](../Extensions/FlowsVeo-Clean/docs/bridge-protocol.md) | **Hiện hành** |
| [release-checklist.md](../Extensions/FlowsVeo-Clean/docs/release-checklist.md), [verification.md](../Extensions/FlowsVeo-Clean/docs/verification.md), [store-submission.md](../Extensions/FlowsVeo-Clean/docs/store-submission.md) | **Hiện hành** |
| [PLAN_flow_http_submit.md](PLAN_flow_http_submit.md): giao thức RPC quan sát từ HAR (payload, mã model, tỉ lệ khung hình, giá) | Tham chiếu |
| [PLAN_motion_long.md](PLAN_motion_long.md): Motion Control cho video mẫu dài | **Hiện hành** |
| [archive/FLOW_CAPTCHA_DIAGNOSIS.md](archive/FLOW_CAPTCHA_DIAGNOSIS.md), [archive/PLAN_veo-integration-audit.md](archive/PLAN_veo-integration-audit.md) | Lưu trữ |

### Chiến dịch AI (`Backend/app/campaign/`)
| Đọc | Trạng thái |
|---|---|
| [campaign-engine.md](campaign-engine.md): artifact/fingerprint/gate, 19 bước, luồng chạy, `unknown`, giá credit, API, UI, cách thêm bước | **Hiện hành** |
| [PLAN_campaign_v3_format_director.md](PLAN_campaign_v3_format_director.md): thẩm định v2.4 trên chiến dịch thật, khảo sát format/prompt 2026, quy trình 6 khối "format + đạo diễn theo cảnh", ma trận thử nghiệm GĐ0 | **Backlog** (đề xuất 2026-11-14, chưa code) |
| [PLAN_campaign_v24_storyboard_ingredients.md](PLAN_campaign_v24_storyboard_ingredients.md): lý do chuyển sang `anchor_frame` + `storyboard` + Ingredients | **Hiện hành** (quyết định) |
| [PLAN_ai_workflow_campaign.md](PLAN_ai_workflow_campaign.md), [AI_WORKFLOW_FASHION_DESIGN.md](AI_WORKFLOW_FASHION_DESIGN.md) | Tham chiếu (bỏ phần Keyframe) |
| [archive/PLAN_campaign_v22_visual_quality.md](archive/PLAN_campaign_v22_visual_quality.md), [archive/PLAN_campaign_v23_editing_continuity.md](archive/PLAN_campaign_v23_editing_continuity.md) | Lưu trữ |

### Recap YouTube (R1–R5) và Audio Story Studio
| Đọc | Trạng thái |
|---|---|
| [recap.md](recap.md): pipeline, chạy chồng, lưu trữ và rehydrate, frontend, bẫy | **Hiện hành** |
| [PLAN_audio_story_v2.md](PLAN_audio_story_v2.md): khảo sát kênh truyện audio + dữ liệu kho truyện, thiết kế lại "1 truyện → 1 video FULL", phụ đề theo dòng, bố cục ảnh bìa, lộ trình P0–P4 | **Hiện hành** (đã làm P0 + lõi P1/P2, xem mục Tiến độ) + Backlog |
| [PLAN_audio_story_studio.md](PLAN_audio_story_studio.md): Phase 1 (tùy chọn âm thanh, lớp phủ, nền ảnh bìa, xem thử) | Hiện hành (Phase 2–3 thay bằng v2) |
| [archive/RECAP_PIPELINE_PLAN.md](archive/RECAP_PIPELINE_PLAN.md), [RECAP_IMPLEMENTATION_PLAN](archive/RECAP_IMPLEMENTATION_PLAN.md), [RECAP_STUDIO_REDESIGN](archive/RECAP_STUDIO_REDESIGN.md), [RECAP_VIDEO_SYNC_AND_CUT_ISSUES](archive/RECAP_VIDEO_SYNC_AND_CUT_ISSUES.md), [STUDIO_POLISH_WATERMARK_BGM](archive/STUDIO_POLISH_WATERMARK_BGM.md) | Lưu trữ |

### Giọng đọc (Voice service)
| Đọc | Trạng thái |
|---|---|
| [services/voice-service/README.md](../services/voice-service/README.md): chạy, profile, GPU, voice clone, API, test | **Hiện hành** |
| [services/voice-service/docs/VIENEU_UPGRADE_VERIFICATION.md](../services/voice-service/docs/VIENEU_UPGRADE_VERIFICATION.md) | **Hiện hành** (bản ghi kiểm chứng) |
| [archive/VOICE_SERVICE_PLAN.md](archive/VOICE_SERVICE_PLAN.md) | Lưu trữ |

### Xóa Watermark
| Đọc | Trạng thái |
|---|---|
| [WATERMARK_REMOVER_HYBRID.md](WATERMARK_REMOVER_HYBRID.md): hai chế độ đường dẫn/upload, endpoint | Tham chiếu |
| [Frontend/watermark-runtime/README.md](../Frontend/watermark-runtime/README.md) và mục 4 của [README gốc](../README.md): cài runtime | **Hiện hành** |

### Các trang khác (Khám Phá Kênh, Crawl truyện, Video, Thư viện nhạc, Muse, Pippit/YouTube/Drive, Dashboard, Lịch sử, Cài đặt)
Mô tả ngắn, API, nơi lưu và lưu ý: [modules.md](modules.md). Chưa có tài liệu sâu riêng; muốn hiểu kỹ hãy đọc code `Backend/app/<package>/` và `Frontend/src/features/<trang>/`.

### Cẩm nang người dùng trong app (nút **?** / F1)
Nội dung là code, không phải trong `docs/`: `Frontend/src/features/help/` (mỗi trang một doc, có `verifiedAt`). Thiết kế và tiến độ: [PLAN_help_redesign.md](PLAN_help_redesign.md).

---

## Quy ước để tài liệu khỏi lỗi thời

1. Tài liệu mới đặt tên theo **chủ đề** (`campaign-engine.md`), không theo ngày hay số phiên bản; ghi ngày đối chiếu ở đầu file.
2. Mở đầu mỗi file bằng một dòng trạng thái đúng nhãn ở trên. Chỗ chưa kiểm chứng ghi rõ **"nghi vấn / chưa kiểm chứng"**, đừng khẳng định.
3. Làm xong một plan → thêm banner "ĐÃ LƯU TRỮ" và chuyển vào [archive/](archive/), cập nhật bảng trên. Không xóa lịch sử trừ file rác.
4. Đường dẫn file dùng liên kết tương đối để kiểm tra được; đừng chép số dòng code vào văn bản dài hạn.
5. Thêm/đổi tên/gỡ một trang hay tính năng → sửa tài liệu tương ứng ở đây **và** cẩm nang trong app (`features/help`).
6. Sửa code ảnh hưởng một tài liệu hiện hành (ví dụ thêm bước campaign, thêm model Flow) → sửa tài liệu trong **cùng PR**.
7. Mỗi phiên bản phát hành cần `docs/releases/<version>.md` (CI kiểm tra).
