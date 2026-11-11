# Desktop launcher

Chạy backend FastAPI + voice-service + frontend Electron cùng lúc, và **tắt sạch tất cả** khi thoát.

```powershell
npm start            # khởi động sạch (dọn tiến trình cũ còn giữ cổng 8000/8001 rồi chạy mới)
npm run stop         # chỉ dọn sạch mọi tiến trình dev còn sót, không khởi động gì
npm run start:stable # như start nhưng backend KHÔNG tự reload khi sửa .py (tránh job dài bị kill giữa chừng)
npm run start:reuse  # dùng lại service đang chạy sẵn nếu khỏe (hành vi cũ, dễ chạy nhầm code cũ)
npm test             # kiểm thử logic chọn tiến trình cần kill
```

- Backend: `http://127.0.0.1:8000` (ping: `/api/ping`) · Voice: `:8001` · Frontend: Electron + React/Vite.
- **Ctrl+C, đóng terminal, hoặc đóng cửa sổ app → tắt HẾT** (backend, voice, electron, mọi tiến trình con kể cả worker `--reload` mồ côi). Muốn đóng app mà giữ backend/voice: `node dev.js --keep-services`.
- **Mỗi lần `npm start` đều khởi động backend MỚI.** Nếu cổng đang bị giữ bởi service cũ (phiên trước tắt không sạch), nó được dọn trước; chỉ khi là chương trình lạ không phải của dự án thì dừng và báo (thêm `--force` để ép kill).
- Frontend chỉ bật sau khi backend trả lời `/api/ping` (tối đa 60 giây).

## Vì sao trước đây hay chạy nhầm backend cũ

Trên Windows mỗi lệnh Python là 2 tiến trình nối nhau (venv launcher → python thật) và `uvicorn --reload` đẻ thêm worker. Khi tiến trình cha chết trước, worker thành mồ côi: vẫn giữ socket cổng 8000 (chủ cổng hiển thị là một PID đã chết) nên `taskkill /T` không tìm thấy, và `dev.js` cũ thấy backend "khỏe" nên dùng lại → chạy code cũ. `dev.js` mới kill theo cây **và** theo cổng, nhận ra worker mồ côi qua `spawn_main(parent_pid=…)`, và có 3 lớp bảo vệ để không bao giờ kill tiến trình hệ thống (Windows tái sử dụng PID nên chỉ nhìn PID cha là không đủ).

## Cờ

| Cờ | Ý nghĩa |
|---|---|
| `--reuse` | cổng có service khỏe thì dùng lại |
| `--keep-services` | đóng Electron không tắt backend/voice |
| `--no-reload` | uvicorn không `--reload` |
| `--force` | được kill cả tiến trình lạ đang giữ cổng |
| `--only=backend,voice,frontend` | chỉ chạy một phần |
| `--stop` | chỉ dọn rồi thoát |

Biến môi trường tương ứng: `DEV_REUSE=1`, `DEV_KEEP_SERVICES=1`, `DEV_NO_RELOAD=1`, `DEV_FORCE=1`.
