---
name: feature-map
description: Lập "bản đồ" một khu tính năng từ code trước khi đề xuất hay sửa — đi qua các lớp giao diện → trạng thái → lưu trữ → API → service backend → dịch vụ ngoài, mỗi mục có file:dòng và nhãn đã đọc / suy đoán. Dùng khi người dùng gửi ảnh chụp màn hình, khi ý tưởng gắn vào một trang có sẵn (vd. thêm khung chat GPT vào Muse Canvas), hoặc khi chưa chắc một nút / node / luồng nằm ở đâu và chạy ra sao. Không dùng khi cuộc trò chuyện này đã có bản đồ cho đúng khu đó.
---

# Bản đồ tính năng từ code

Không đề xuất gì cho một khu mình chưa lập bản đồ. Bản đồ dựng từ code đọc được, không dựng từ trí nhớ, README hay tên file.

## Cách làm

1. **Tìm điểm vào** từ chữ người dùng nói: grep nhãn tiếng Việt của nút / trang trong `Frontend/src` để ra component. Tên trang nằm ở `src/shared/navModel.ts`.
2. **Đi qua 6 lớp.** Mỗi lớp ghi: cái gì, `file:dòng`, và nhãn `[đã đọc]` hoặc `[suy đoán]`.

   | Lớp | Câu hỏi | Chỗ tìm |
   |---|---|---|
   | Giao diện | Component nào render, có những node type nào | `src/features/<trang>/`, bảng đăng ký node (vd. `MUSE_NODE_TYPES`) |
   | Trạng thái | State nằm ở đâu, ai được ghi | `useState`, `useNodesState`, hook `use*`, `node.data` |
   | Lưu trữ | Lưu ở đâu, khi nào, tải lại trang thì mất gì | localStorage, hàm `save*`, SQLite, `Backend/Data/` (xem `docs/data-and-paths.md`) |
   | API | Endpoint, schema, lỗi trả về | `services/*Api.ts` ↔ `Backend/app/<khu>/router.py` |
   | Service backend | Chạy ở đâu, đồng bộ hay nền, có hàng đợi / job không | `service.py`, runner, registry job |
   | Dịch vụ ngoài | Flow / Muse / ChatGPT web / Gemini cookie / voice-service; có tốn tiền không, có được gửi lại không | `app/ai/*`, `veo/bridge.py`, extension |

3. **Ghi ranh giới:** sự kiện chuột / phím đi đến lớp nào (canvas hay ô nhập trong node; ReactFlow cần class `nodrag` / `nowheel`), dữ liệu thuộc về ai, hai phần nào phải khớp nhau.
4. **Ghi mục "Chưa rõ":** những gì chưa đọc tới. Không lấp chỗ trống bằng phỏng đoán.
5. **Trình bày** bằng một cây hoặc bảng ≤ 20 dòng (xem `show-me`).

## Ví dụ (đã đọc ngày 2026-11-25, đọc lại trước khi dựa vào)

```
Muse Canvas — Frontend/src/features/workflow
├─ Giao diện: components/MuseCanvasWorkspace.tsx — ReactFlow, nodeTypes=MUSE_NODE_TYPES (:1231)   [đã đọc]
│   └─ node GPT: nodes/muse/GptClipScriptNode, GptClipPromptNode, GptClipMergeNode                [đã đọc]
├─ Trạng thái: useNodesState / useEdgesState (:936–937); kết quả GPT lưu trong node.data          [suy đoán]
├─ Lưu trữ: loadLocalProjectGraph (:935) + saveMuseProjectGraph → backend (services/museCanvasApi.ts:209) [đã đọc]
├─ API: generateGptClipScript → POST /api/workflow/muse/gpt-script (museCanvasApi.ts:319)          [đã đọc]
├─ Backend: app/workflow/router.py:517 → muse_gpt_image.write_script ("1 lượt, không tự gửi lại")   [đã đọc]
└─ Dịch vụ ngoài: ChatGPT qua adapter gptimage (tài khoản web); lỗi → GptImageError → HTTP 502       [đã đọc]
Chưa rõ: hai tab cùng mở một project thì bản nào thắng khi lưu.
```

## Không được

- Ghi `[đã đọc]` cho thứ chỉ thấy qua tên file hoặc kết quả grep một dòng.
- Đề xuất vị trí đặt tính năng mới trước khi xong lớp "Lưu trữ": phần lớn lỗi mất dữ liệu nằm ở lớp này.
- Chép bản đồ vào CLAUDE.md hay memory: code đổi thì bản đồ thành sai. Cần lưu lâu thì đưa vào `docs/` và kèm ngày kiểm.
