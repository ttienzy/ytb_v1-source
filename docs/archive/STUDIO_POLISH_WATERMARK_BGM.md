# Studio Polish — Nhạc nền (R5)

> **ĐÃ LƯU TRỮ (2026-11-12), chỉ để tham khảo lịch sử.** Phần nhạc nền (R5) đã triển khai; phần watermark đã gỡ khỏi code (bảng `watermarks` còn lại trong DB). Hiện hành: code `Backend/app/recap/` và `Backend/app/media/`. Đường dẫn file và số dòng trong tài liệu phản ánh thời điểm viết.


> Trạng thái: **ĐÃ TRIỂN KHAI (BGM only)**. Watermark **đã bỏ** — burn-in text `drawtext`
> buộc re-encode toàn frame video (chậm ~66s/221s 1080p vs BGM-only 3s `-c:v copy`);
> user quyết định không cần → gỡ sạch code (model/router/FE). Bảng `watermarks` (migration
> 0004) giữ dead trong DB. Thumbnail sau này (tài liệu riêng).
>
> **Cốt lõi**: polish chỉ động audio (BGM `amix` ducked) + `-c:v copy` → video KHÔNG
> re-encode → ~3s cho 1080p 221s. Xem memory [[recap-polish-encoder]].

## Mục tiêu

Sau khi R4 merge ra `final_recap.mp4`, thêm 1 bước hậu xử lý ("polish"):
1. **Watermark** — nhãn bản quyền dạng text (drawtext) hoặc logo PNG (overlay) góc video.
2. **Nhạc nền (BGM)** — user upload/chọn 1 track, mix dưới VO ở mức thấp (ducked).

Cả 2 gộp trong **1 lệnh ffmpeg re-encode đúng 1 lần** (cùng `-filter_complex`), KHÔNG rải per-segment.

## Vì sao gộp 1 pass re-encode

Pipeline hiện tại (xem [`Backend/app/recap/ffmpeg.py`](../../Backend/app/recap/ffmpeg.py)) **toàn `stream-copy`** — rất nhanh:
- `cut_segment`: `-c copy`
- `mux_segment`: `-c:v copy` + `a:a aac` (chỉ audio re-encode nhẹ)
- `concat_segments`: `-c copy`

`drawtext` (watermark) và `amix`/`volume` (BGM) đều **không tương thích `-c copy`** → bắt buộc re-encode video (`libx264`). Nếu chèn per-segment thì re-encode N lần + tạo seam nhạc ở biên đoạn. Nên chèn **sau concat, trên `final_recap.mp4`**, đúng 1 lần → ra `final_studio.mp4`. Tradeoff: 1 lần re-encode (~realtime cho video 4–7p, CRF 20) — chấp nhận được.

## Kiến trúc

```
R1 recap → R2 cut ‖ R3 voice → R4 merge → final_recap.mp4
                                              │
                                              ▼
                                    R5 polish (re-encode 1 lần)
                                    ├─ drawtext watermark
                                    └─ amix BGM (loop + ducked)
                                              │
                                              ▼
                                      final_studio.mp4
```

Thumbnail (sau này) = nhánh độc lập, song song với cut/voice, không phụ thuộc merge — chưa nằm trong docs này.

## Backend

### 5.1 State model — thêm phase `polish`

Theo pattern per-phase đã dựng ở [`state.py`](../../Backend/app/recap/state.py):

```python
# JobState — thêm:
polish_status: str = "idle"          # idle | running | done | error
progress_polish: dict = field(default_factory=lambda: {"done": 0, "total": 1, "step": "encode"})
# step ∈ "encode" (1 bước đơn — chỉ re-encode final; FE show spinner indeterminate)
polish_opts: dict | None = None      # snapshot opts lúc trigger: {watermark, bgm, levels...}
```

`create_job` init `polish_status="idle"`. `rehydrate` suy luận: `polish_status="done"` nếu `final_studio.mp4` tồn tại + size > 0, else `idle` (re-runnable).

### 5.2 Schemas — `JobOut`

Thêm `polish_status: str = "idle"` + đưa vào `progress` dict (`progress["polish"]`). Thêm field `final_studio: str | None = None` (tên file nếu đã polish).

### 5.3 `router.py`

- `_overall()` mở rộng: thêm `polish_status` vào mảng phases (error/running/done). `overall="polished"` khi `polish_status=="done"` ( precedence cao hơn `merged`).
- `_to_out()`: project `polish_status`, `progress["polish"]`, `final_studio`.
- **Endpoint mới**: `POST /api/recap/jobs/{id}/polish` (json: `{watermark_text?, watermark_logo_path?, bgm_path?, bgm_volume?}`) → trigger `service.polish(job_id, opts)`. Giữ manual như `/cut /voice /merge` (debug/re-run).
- **Mở rộng `/run`**: thêm 3 form field tùy chọn (`watermark_text`, `bgm_file`, `bgm_volume`) → truyền `polish_opts` vào `_run_pipeline`; nếu có bất kỳ field nào thì pipeline tự chạy R5 sau merge. Để trống cả 3 → bỏ qua R5 (giữ `final_recap.mp4` nguyên).
- **Serve**: `GET /api/recap/jobs/{id}/studio` → `final_studio.mp4` (range request, như `/final`).

### 5.4 `service.py`

```python
async def polish(job_id: str, opts: dict) -> JobState:
    # gate: merge_status == "done"
    state.update_job(job_id, polish_status="running", polish_opts=opts)
    try:
        await run_in_threadpool(_do_polish, job, opts)
    except RuntimeError as e:
        state.update_job(job_id, polish_status="error", error=f"polish: {e}")
        raise HTTPException(502, str(e))
    state.update_job(job_id, polish_status="done")
    return state.get_job(job_id)
```

`_run_pipeline`: sau `await merge(job_id)`, nếu `polish_opts` (từ `/run`) → `await polish(job_id, opts)`. Nếu chạy qua manual `/polish` thì user tự trigger (History re-run).

### 5.5 `ffmpeg.py` — helper mới `polish_final`

```python
def polish_final(
    src: Path,              # final_recap.mp4
    out: Path,              # final_studio.mp4
    watermark_text: str | None = None,
    watermark_logo: Path | None = None,
    bgm: Path | None = None,
    bgm_volume: float = 0.15,        # 0.0–1.0; 0.15 ≈ -16dB dưới VO
    font_file: Path | None = None,    # TTF có dấu Việt — bắt buộc nếu có watermark_text
) -> Path:
    ...
```

Filtergraph (1 pass, kết hợp video + audio):

```
-input  final_recap.mp4 (0:v + 0:a)
[-stream_loop -1 -i bgm] (1:a)        # chỉ khi có BGM

-filter_complex "
  [0:v]drawtext=fontfile=<F>:text='<W>':x=w-tw-20:y=h-th-20:
       fontcolor=white@0.65:fontsize=22:box=1:boxcolor=black@0.4:boxborderw=8[v];
  [1:a]volume=<V>[bg];
  [0:a][bg]amix=inputs=2:duration=first:dropout_transition=0[a]
"
-map "[v]" -map "[a]" -c:v libx264 -crf 20 -preset medium -c:a aac -b:a 192k -shortest
```

Quyết định nhánh (build động theo opts, KHÔNG hard-code):
- Chỉ watermark (text): filter `[0:v]drawtext=...[v]`, `-map "[v]" -map 0:a -c:a copy`.
- Chỉ BGM: bỏ drawtext, thêm nhánh amix.
- Cả 2: filtergraph đầy đủ như trên.
- Không cả 2 → không gọi `polish_final` (pipeline skip R5).

Logo watermark (overlay) — v2: `overlay=W-w-20:H-h-20` thay drawtext. v1 làm text trước (đơn giản, không cần asset PNG).

**Font Vietnamese**: `drawtext` cần `fontfile=` trỏ tới TTF/OTF có đủ dấu tiếng Việt. Ship 1 font vào `Backend/assets/fonts/BeVietnamPro-SemiBold.ttf` (Nuvofont open-source), hoặc fallback `C:\Windows\Fonts\arial.ttf`. V1 ship font để deterministic.

**Idempotent**: `polish_final` skip nếu `out` đã tồn tại + size > 0 (như `mux_segment`/`concat_segments`).

## Frontend

### 6.1 Sidebar — thêm nav item

[`navigation`](../../Frontend/src/main.tsx) (line 7) hiện: Dashboard / Studio / Voices / Lịch sử / Cài đặt. Thêm:

```tsx
{ label: 'Thư viện', icon: Image },      // hoặc 'Tài sản' / 'Media'
```

Page "Thư viện" quản lý asset dùng lại (mirror VoicesPage):
- **Watermark** — input text (lưu config) + upload logo PNG (tùy chọn).
- **BGM library** — upload track (mp3/wav), preview play, đặt default volume. List + xoá (như voices).
- Asset lưu trong `Data/media/` (watermark text = config field; logo + bgm = file). Voice đã dùng `voice-service/data/`, media polish dùng `Data/media/` (xem convention [[data-dirs-convention]]).

### 6.2 Studio form — thêm 3 toggle/input

Trong [`StudioPage`](../../Frontend/src/main.tsx) (form card, ~line 323) — Studio chỉ **toggle + chọn**, KHÔNG nhập asset trực tiếp (asset quản lý ở trang Thư viện, đã chốt ở 6.1):
- `☑ Watermark` (checkbox) — bật/tắt; text/logo lấy default từ trang Thư viện. (v2: cho phép override per-video — v1 dùng default.)
- `☑ Nhạc nền` (checkbox) + `<select>` track (lấy từ Thư viện) + slider volume (default 15%).
- 3 field này append vào `FormData` của `POST /run` (chỉ append khi bật; gửi **asset id/path** của item đã chọn, KHÔNG gửi blob file).

### 6.3 Node UI — thêm node "Polish"

Trong `.pipeline` (node flow), sau node Merge:

```
[Recap] → ⫷ [Cut ‖ Voice] ⫸ → [Merge] → [Polish] → final_studio.mp4
```

- Node "Polish" state mapping như node khác (`pending|running|done|error`).
- `progress_polish.step==="encode"` → spinner indeterminate (1 bước, không i/N).
- Nếu `/run` không bật cả watermark lẫn BGM → node Polish ở trạng thái `skipped` (gray, label "bỏ qua") —KHÔNG block terminal. `overall` vẫn `merged` (không `polished`).
- Terminal `overall==="polished"` → `<video src=/jobs/{id}/studio>` + download. Nếu chỉ `merged` (skip polish) → giữ `<video src=/jobs/{id}/final>` như hiện.

### 6.4 HistoryPage

Detail thêm section "Video cuối (studio)" nếu `final_studio` tồn tại — song song với section final hiện tại. Badge overall: `polished` → "Hoàn thiện" (xanh).

## Risks & mitigations

| Risk | Giảm thiểu |
|------|-----------|
| Re-encode cost (~realtime, video 4–7p) | 1 pass duy nhất; CRF 20 + `preset medium`; skip nếu không bật. Document trong UI "bước này re-encode, có thể mất ~30–60s". |
| Font Vietnamese thiếu dấu | Ship `BeVietauPro` TTF vào `Backend/assets/fonts/`; fallback system font. Test drawtext với "âưỏiệ" trước. |
| BGM quá to lấn VO | Default `bgm_volume=0.15` (-16dB); `amix dropout_transition=0`. v2: `sidechaincompress` auto-duck khi VO nói. |
| BGM ngắn hơn final | `stream_loop -1` + `-shortest` → loop rồi cắt theo final. |
| BGM dài hơn final | `amix duration=first` + `-shortest` → cắt theo final. |
| Seam nhạc | Mix ở final (sau concat), KHÔNG per-segment → nhạc xuyên suốt, không đứt biên. |
| Bản quyền nhạc | User-provided → note trong trang Thư viện: "tự chịu trách nhiệm bản quyền track upload". |
| Idempotency sau restart | `final_studio.mp4` tồn tại → `polish_status="done"`; missing → `idle` (re-runnable). |
| Filtergraph phức tạp gãy | Build filter string động + test từng combo (chỉ WM, chỉ BGM, cả 2) bằng script nhỏ trước khi tích hợp. Nếu 1 pass gãy → fallback 2 pass (drawtext trước, amix sau) — re-encode 2 lần nhưng đơn giản hơn. |
| `/run` form field lớn | BGM file upload qua multipart → backend lưu vào `Data/media/jobs/{job_id}/bgm.mp3` rồi truyền path vào `polish_final` (KHÔNG giữ blob trong state). |

## Thứ tự triển khai

1. **Phase 1 — Watermark (drawtext) chỉ**: thêm `polish_status` + `polish_final` (chỉ nhánh drawtext) + endpoint `/polish` manual + node UI + font ship. Verify `final_studio.mp4` có watermark đúng vị trí, dấu Việt đủ.
2. **Phase 2 — BGM (amix) gộp chung filtergraph**: thêm nhánh audio vào `polish_final` + trang Thư viện (sidebar) + select BGM trong Studio form + serve `/studio`. Verify nhạc loop, mức thấp hơn VO, không seam.
3. (Sau) Thumbnail — tài liệu riêng khi làm.

## Verification (e2e)

1. Studio: 1 job nhỏ, bật chỉ Watermark → node Polish `running`→`done`, `final_studio.mp4` có text góc, dấu Việt đầy. `overall=polished`.
2. Job khác, bật chỉ BGM → nhạc loop hết video, VO vẫn rõ, mức ~-16dB. So tai nghe thử.
3. Bật cả 2 → cùng 1 pass, cả watermark + BGM, không seam, duration đúng final.
4. Không bật cả 2 → node Polish `skipped`, output vẫn `final_recap.mp4`, `overall=merged`.
5. Restart giữa polish → rehydrate `polish_status=idle` (chưa xong) → re-run `/polish` an toàn (idempotent skip nếu đã có).
6. Trang Thư viện: upload BGM + đặt watermark text default → Studio form pull default từ đó.
7. Confirm KHÔNG auto-commit (memory: [[no-auto-commit]]); chỉ push khi user ra lệnh.
