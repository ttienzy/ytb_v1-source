# Recap Studio Redesign — 1-button parallel pipeline + History page

## Context

Studio hiện tại bắt user bấm **4 nút tuần tự** (Tạo recap → Cắt → Voice → Ghép), mỗi bước fire-and-forget (không có tiến trình live), và show recap/clips/voice ngay trong flow. Người dùng muốn:

1. **1 nút click** — input vẫn là link YouTube + file raw.txt (+ chọn voice) → chạy cả luồng.
2. **Cắt video (R2) + Tạo voice (R3) chạy song song** sau khi recap (R1) xong.
3. **Ghép (R4) chỉ bắt đầu khi cả cut + voice xong.**
4. **UI node compact, hiện tiến trình live** để tăng trải nghiệm.
5. **Bỏ recap/clips/voice khỏi flow** — chuyển vào trang **Lịch sử** với cấu trúc chi tiết/logic + dấu thời gian rõ ràng.

Khám phá xác nhận: gate `voice()` ở `service.py:233` (`status != "cut_done"`) là **ràng buộc nhân tạo** — `_do_voice` (L191-219) chỉ đọc `job.recap` + zip TTS, viết vào `voice/`, **không đụng clips**. Nên cut+voice hoàn toàn độc lập, chạy song song được. Cản trở thực sự: (a) `JobState.status` là **1 string** — không diễn tả được "cut xong, voice đang chạy"; (b) `_status_from_disk` suy luận tuần tự; (c) **không có cơ chế tiến trình** nào; (d) `JobOut` **thiếu timestamp**; (e) "Lịch sử" hiện là **placeholder**.

## Approach (recommended)

**Backend**: thay `status` string bằng 4 field per-phase (`recap_status/cut_status/voice_status/merge_status ∈ idle|running|done|error`) + 3 field tiến trình per-phase. Thêm endpoint `POST /api/recap/run` chạy cả pipeline như **background asyncio task** (`generate → asyncio.gather(cut, voice, return_exceptions=True) → merge`), trả `job_id` ngay (HTTP 202). Frontend poll `GET /jobs/{id}`.

**Frontend**: StudioPage → form 1 nút + UI node (Recap → [Cut‖Voice] → Merge) + poll; HistoryPage mới (master-detail) list tất cả job kèm timestamp + chi tiết per-job.

### Tại sao backend-orchestration thay vì frontend-driven parallel fetches

- 1 request = 1 trigger原子, map đúng yêu cầu "1 nút".
- Backend owns the gather → cut/voice giữ raise HTTPException (gather `return_exceptions=True` bắt thành value, không huỷ sibling); state error per-phase được set trước khi raise.
- Frontend chỉ 1 POST + poll — đơn giản, chịu network drop.
- Merge gate enforce in-process (đọc state field), không re-check qua HTTP.

---

## Critical files

- `Backend/app/recap/state.py` — JobState + update_job
- `Backend/app/recap/schemas.py` — JobOut
- `Backend/app/recap/router.py` — \_to_out + endpoints
- `Backend/app/recap/service.py` — gates, _do_\* loops, rehydrate, new run()/\_run_pipeline()
- `Frontend/src/main.tsx` — StudioPage rewrite + HistoryPage mới + routing
- `Frontend/src/styles.css` — node/pipeline/history classes

---

## Phase A — Backend state model + persistence (chưa đổi behavior)

1. **state.py** `JobState` (L13-28): thay `status: str` bằng `recap_status/cut_status/voice_status/merge_status: str = "idle"`. Thêm `progress_cut/progress_voice/progress_merge: dict = field(default_factory=lambda: {"done":0,"total":0})`. Giữ `error`, `created_at`, `updated_at` (đã có). **Bỏ hẳn `status`** (frontend rewrite luôn, không cần compat shim).
2. **state.py** `create_job` (L34-43): init 4 phase = `"idle"`, 3 progress dict = `{done:0,total:0}`.
3. **schemas.py** `JobOut` (L5-13): thêm `recap_status, cut_status, voice_status, merge_status, overall: str, voice_id: str|None, created_at: datetime, updated_at: datetime, progress: dict`. Bỏ `status`.
4. **router.py** `_to_out` (L23-33): project tất cả field mới. `overall` tính theo precedence: `error` nếu bất kỳ phase error → `"error"`; `merge_status=="done"` → `"merged"`; bất kỳ `*_status=="running"` → `"running"`; `recap_status=="done"` → `"recap_done"`; else `"idle"`. `progress = {"cut":progress_cut,"voice":progress_voice,"merge":progress_merge}`.
5. **service.py** `generate` (L67-75): ghi thêm `youtube_url` + `created_at.isoformat()` vào recap.json (`{**recap, "youtube_url":..., "created_at":...}`).
6. **service.py** `rehydrate` (L103-132): restore `created_at` (`datetime.fromisoformat`), set 4 phase field qua `_status_from_disk` mới.

## Phase B — Backend gates + per-phase progress

7. **service.py** `_status_from_disk` (L88-100): suy luận **độc lập từng phase** (bỏ logic tuần tự):
   - `recap_status = "done" if recap.json exists else "idle"`
   - `cut_status = "done" if clip_0.mp4 exists else "idle"`
   - `voice_status = "done" if voice_0.wav exists else "idle"`
   - `merge_status = "done" if final_recap.mp4 exists+size else "idle"`
   - restart không phân biệt running vs interrupted → missing output = `idle` (re-runnable được).
8. **service.py** `cut` (L169-188): gate L176 → `if job.recap_status != "done"`; set `cut_status="running"`; done → `cut_status="done"`; except → `cut_status="error"`, `error=f"cut: {msg}"`.
9. **service.py** `_do_cut` (L158-163): sau mỗi `cut_segment`, `state.update_job(job_id, progress_cut={"done":i+1,"total":len(segs)})`.
10. **service.py** `voice` (L222-270): gate L233 → `if job.recap_status != "done"` (**xoá clause `not job.clips`** — phụ thuộc nhân tạo); set `voice_status="running"` + `progress_voice={"phase":"tts","done":0,"total":len(segs)}` trước `tts_batch`; sau zip set `phase="unpack"`; trong `_do_voice` loop (L206-218) bump `progress_voice.done`. except → `voice_status="error"`.
11. **service.py** `merge` (L320-348): gate L331 → `if job.cut_status != "done" or job.voice_status != "done"`; set `merge_status="running"` + `progress_merge={"done":0,"total":len(segs)}`; trong `_do_merge` loop (L292-313) bump `done` sau mỗi `mux_segment`; done → `merge_status="done"`. except → `merge_status="error"`.
12. Mỗi phase except **chỉ set field của mình** + `error="phase: msg"` — không clobber phase khác (giữ nguyên trạng thái phase kia).

## Phase C — Backend orchestration endpoint

13. **service.py**: `async def run(youtube_url, raw_bytes, raw_name, voice_id) -> str` — gọi `generate(...)`, rồi `asyncio.create_task(_run_pipeline(job_id, voice_id))`, return `job_id` ngay.
14. **service.py**: `async def _run_pipeline(job_id, voice_id)`:
    - `results = await asyncio.gather(cut(job_id), voice(job_id, voice_id), return_exceptions=True)`
    - Nếu cut exception → phase đã set `cut_status="error"`; skip merge.
    - Nếu cả 2 ok → `await merge(job_id)`.
    - Wrap top-level try/except → set generic `error` nếu có thứ bất thường thoát ra.
    - cut/voice/merge raise HTTPException (L186/261/346) — trong `gather(return_exceptions=True)` thành value, **không propagate**, không huỷ sibling. OK.
15. **router.py**: `POST /run` (multipart: `youtube_url` + `raw_file` + `voice_id`) → `job_id = await service.run(...)`; return `JSONResponse({"job_id":job_id}, status_code=202)`.
16. **Giữ** `/generate /cut /voice /merge` cũ (History có thể re-run 1 phase thủ công; giúp verify).

## Phase D — Frontend Studio redesign

17. **main.tsx**: thêm type `RunJob` = JobOut mới (4 status + overall + progress + created_at/updated_at). Helper `nodeState(phase)` → `pending|running|done|error` + text tiến trình (`i/N` hoặc spinner cho voice TTS).
18. **StudioPage** (L160-439) rewrite:
    - Form card: input `youtube_url` + picker raw.txt + `<select>` voice (giữ) + **1 nút** "Tạo recap" → `POST /api/recap/run` (FormData 3 field). 202 → set `jobId`, bắt đầu poll.
    - **Xoá**: `cut/voice/merge` (L244-294), `stepState` (L214-224), `steps` array (L319-324), recap table inline (L377-388), clip chips, voice chips/toggleVo (L296-316), 4 error string (L168-171), recent-jobs list (L353-373).
    - Poll: `useEffect` trên `jobId` → `setInterval(1500)` `GET /jobs/{id}` → `setJob`. Clear khi `overall ∈ {merged,error}` hoặc unmount.
    - Node UI trong `.pipeline`: Recap → nhánh song song `[Cut ‖ Voice]` → Merge. Mỗi node: pending/running (i/N hoặc indeterminate spinner cho voice TTS phase)/done/error. Voice node: nếu `progress_voice.phase==="tts"` → spinner "Đang tổng hợp giọng (TTS)…"; `"unpack"` → `done/total`.
    - `merge_status==="done"` → `<video src=/jobs/{id}/final}>` + download + "Bắt đầu lại" (adapt L427-435).
    - Thay recent-jobs list bằng link "Xem Lịch sử" → `setActivePage('Lịch sử')`.
    - Disable nút trigger khi đang có `jobId`+polling; reset chỉ qua "Bắt đầu lại".

## Phase E — Frontend History page

19. **main.tsx**: thêm `HistoryPage()` component. Routing ternary (L444): thêm `activePage === 'Lịch sử' ? <HistoryPage />` trước fallback empty-state.
20. **HistoryPage**:
    - Mount: `GET /jobs` → list sort theo `created_at` desc.
    - List rows (reuse `.voice-item`): title = `youtube_url`/`job_id`; subtitle = `job_id · {overall badge} · {n} đoạn · {created_at format} · {final?'có final':''}`. Click → set `selected` → detail.
    - Master-detail (`.history-layout`): list trái + detail phải (stack trên narrow). Detail = cấu trúc logic per-job:
      - recap scene/segment table (reuse `mapRecap` + segment-table markup lift từ L381-388).
      - clips list (chip per `clip_i.mp4`).
      - voice list: chip playable qua `GET /jobs/{id}/voice/{idx}` (reuse logic toggleVo L296-316).
      - final video `GET /jobs/{id}/final` (markup L427-435).
      - timestamps: `created_at` + `updated_at` hiện rõ.
    - Reuse `statusLabel` (mở rộng map `overall`: idle/running/merged/recap_done/error).
    - Job đang `running`: detail show node progress read-only (poll option hoặc refresh khi reopen).

## Phase F — CSS

21. **styles.css** sau `.studio-stepper` (~L23): `.pipeline` (flex column), `.pipeline-branch` (flex row 2 node song song), `.node` (circle 26px + label reuse `.step` sizing), `.node-running` (indigo spinner), `.node-done` (green `#16a34a`), `.node-error` (red `#dc2626`), `.node-pending` (gray `#9aa5b5`), `.node-progress` (text `i/N` nhỏ), `.pipeline-connector` (đường nối mảnh). `.history-layout/.history-list/.history-detail` (reuse `.settings-card`/`.voice-item`). Palette indigo `#4f46e5`. Reuse `.chip/.chip-warn/.final-video/.empty-state`.

---

## Polling contract (FE ↔ BE)

- Trigger: `POST /api/recap/run` (multipart: `youtube_url, raw_file, voice_id`) → `202 {job_id}`.
- Poll: `GET /api/recap/jobs/{id}` → JobOut {4 phase status, overall, progress, error, final, created_at, updated_at, voice_id, clips, overspeed, recap}.
- Terminal: `overall==="merged"` (show video) hoặc `overall==="error"` (show lỗi + phase nào).
- Interval 1500ms; clear khi terminal/unmount. Không SSE/WS (overkill cho dev; poll đơn giản + chịu reconnect).

## Risks & mitigations

- **Background task mất khi restart**: in-flight task gone; `_status_from_disk` không phân biệt running→interrupted → missing output = `idle` (re-runnable). Idempotent skip trong `_do_cut`/`_do_voice`/`_do_merge` xử lý re-run. Document: "restart mất run đang chạy; re-trigger từ History."
- **gather + threadpool subprocess**: `return_exceptions=True` không huỷ sibling — cut fail thì voice vẫn chạy xong (wasted ~1-2min TTS, không corrupt, disjoint dirs). OK cho v1.
- **Progress race**: mỗi phase viết **chỉ field mình** (`progress_cut/voice/merge`) qua `update_job`; GIL + single-writer-per-field → an toàn, không cần lock.
- **HTTPException trong gather**: `return_exceptions=True` bắt thành value, không propagate; state error đã set trước khi raise → consistent.
- **Double-submit FE**: disable nút khi `jobId`+polling; reset chỉ qua "Bắt đầu lại".
- **Voice select rỗng**: guard giữ — không có cloned voice → message + disable nút.
- **yt-dlp flags**: không đổi `ytdlp.download_video` (giữ `--no-progress`, nightly+node+ejs:github, **không cookies**). R4 merge giữ `-shortest` + concat demuxer copy, **KHÔNG make_zero** (VO drives duration, không atempo).
- **Voice TTS batch atomic**: giữ batch (1 HTTP call) cho v1 — voice node show spinner indeterminate trong phase TTS, `i/N` trong phase unpack. Per-segment TTS split = future enhancement (chỉ nếu user thấy TTS "đứng hình" — khi đó thêm SSE/stream từ voice-service).

## Verification (e2e)

1. Start voice-service (:8001) + backend (:8000). Confirm `GET /api/voices`.
2. Studio: dán link YouTube ngắn + raw.txt + chọn voice + **1 nút**. Expect 202 + job_id; node UI: Recap running→done → Cut+Voice song song running → Merge running→done → final video hiện.
3. **Parallelism check**: log 1 dòng đầu `_do_cut` + `voice` (timestamp) → thấy overlap. Hoặc check `updated_at` delta: voice TTS ~60-120s phải overlap cut's yt-dlp download.
4. **Progress check**: chạy `GET /jobs/{id}` lúc cut → `progress_cut.done` tăng 1→N; voice TTS → `progress_voice.phase=="tts"` (done=0); unpack → done tăng; merge → `progress_merge.done` tăng.
5. **Restart-mid-run**: kill backend giữa voice TTS; restart; `GET /jobs/{id}` rehydrate (recap=done, voice=idle, cut=done-or-idle); History show job re-runnable.
6. **History page**: vào "Lịch sử"; list show job kèm `created_at` + badge; click → detail show recap table + clips + voice playable + final + timestamps.
7. **Error path**: bad voice_id hoặc transcript lỗi → `overall=error`, `error="voice: ..."`; node UI đỏ node fail; History badge error.
8. Confirm **không auto-commit** (memory: chỉ commit/push khi user ra lệnh).
