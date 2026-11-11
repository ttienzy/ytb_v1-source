// Kiểm thử logic chọn tiến trình cần kill của dev.js (không kill gì thật). Chạy: npm test
const test = require('node:test')
const assert = require('node:assert/strict')
const { collectVictims, isManagedChild } = require('./dev.js')

const T0 = Date.parse('2026-11-09T14:00:00Z')
const p = (pid, ppid, name, cmd = '', createdOffsetMs = 0) => ({ pid, ppid, name, cmd, created: T0 + createdOffsetMs })

test('tìm được worker uvicorn mồ côi qua parent_pid, kể cả khi cha đã chết (PID ma)', () => {
  const procs = [
    p(500, 1, 'explorer.exe'),
    p(21608, 19732, 'python.exe', 'python.exe -c "from multiprocessing.spawn import spawn_main; spawn_main(parent_pid=19732, pipe_handle=9)"', 100),
  ]
  // 19732 là chủ socket nhưng đã chết (không có trong danh sách tiến trình)
  assert.deepEqual(collectVictims([19732], procs).sort(), [19732, 21608])
})

test('KHÔNG kill tiến trình hệ thống dù PID cha trùng PID đã được dùng lại', () => {
  // Tình huống thật đã gặp: backend vừa chết có PID 43908, trùng "PID cha cũ" của csrss/winlogon/dwm/fontdrvhost.
  const procs = [
    p(16332, 43908, 'csrss.exe', '', -1_000_000),
    p(40372, 43908, 'winlogon.exe', '', -1_000_000),
    p(6356, 43908, 'dwm.exe', '', -999_000),
    p(6916, 43908, 'fontdrvhost.exe', '', -999_000),
    p(20036, 43908, 'python.exe', 'python.exe -c "spawn_main(parent_pid=43908)"', 50),
  ]
  const victims = collectVictims([43908], procs)
  assert.deepEqual(victims.sort(), [20036, 43908])
  for (const sys of [16332, 40372, 6356, 6916]) assert.ok(!victims.includes(sys), `không được kill PID ${sys}`)
})

test('con sinh TRƯỚC cha (PID bị tái sử dụng) không được coi là con', () => {
  const parent = p(100, 1, 'python.exe', 'python.exe uvicorn', 1000)
  const staleChild = p(200, 100, 'python.exe', 'python.exe uvicorn', 0)          // sinh trước cha => ppid chỉ là số trùng
  const realChild = p(201, 100, 'python.exe', 'python.exe uvicorn', 2000)
  const byPid = new Map([parent, staleChild, realChild].map(x => [x.pid, x]))
  assert.equal(isManagedChild(staleChild, byPid), false)
  assert.equal(isManagedChild(realChild, byPid), true)
})

test('không kill tiến trình lạ không thuộc chuỗi service dù nó là con', () => {
  const procs = [p(100, 1, 'python.exe', 'uvicorn app.main:app', 0), p(300, 100, 'notepad.exe', 'notepad.exe', 10)]
  assert.deepEqual(collectVictims([100], procs), [100])
})

test('gom đủ cây nhiều tầng của voice (uv -> uvicorn -> python venv -> python thật)', () => {
  const procs = [
    p(10, 1, 'node.exe', 'node dev.js', 0),
    p(11, 10, 'uv.exe', 'uv.exe run uvicorn', 10),
    p(12, 11, 'uvicorn.exe', 'uvicorn.exe app.main:app', 20),
    p(13, 12, 'python.exe', 'python.exe uvicorn.exe', 30),
    p(14, 13, 'python.exe', 'python.exe uvicorn.exe', 40),
  ]
  assert.deepEqual(collectVictims([11], procs).sort((a, b) => a - b), [11, 12, 13, 14])
})

test('root là tiến trình lõi hệ điều hành thì bị loại khỏi danh sách kill', () => {
  const procs = [p(4, 0, 'System'), p(700, 4, 'svchost.exe')]
  assert.deepEqual(collectVictims([4, 700], procs), [])
})
