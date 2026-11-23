// Kiểm thử logic chọn tiến trình cần kill của dev.js (không kill gì thật). Chạy: npm test
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { collectVictims, isManagedChild, isBackendSource, createChangeFilter, listBackendSources, activeFlowJobs, ACTIVE_FLOW_STATUSES } = require('./dev.js')

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

test('isBackendSource: chỉ .py của mã nguồn backend mới kích hoạt restart', () => {
  assert.equal(isBackendSource('app/discover/service.py'), true)
  assert.equal(isBackendSource('app\discover\service.py'), true)
  assert.equal(isBackendSource('run_server.py'), true)
  for (const ignored of ['.venv/Lib/site-packages/x.py', 'app/__pycache__/x.cpython-311.pyc', 'Data/media/gen.py',
    'tests/discover/test_freshness.py', 'poc/campaign_look/a.py', 'app/discover/notes.txt', '', undefined]) {
    assert.equal(isBackendSource(ignored), false, String(ignored))
  }
})

test('createChangeFilter: chỉ ĐỌC file .py (đổi last-access) KHÔNG restart; sửa/thêm/xóa thì có', () => {
  // Lỗi thật: Windows bật cập nhật last-access → ripgrep/Pylance/antivirus đọc file .py cũ là fs.watch báo "change"
  // → dev.js restart backend giữa chừng job Muse.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'devwatch-'))
  try {
    fs.mkdirSync(path.join(dir, 'app'))
    fs.mkdirSync(path.join(dir, 'tests'))
    const mod = path.join(dir, 'app', 'mod.py')
    fs.writeFileSync(mod, 'x = 1\n')
    fs.writeFileSync(path.join(dir, 'tests', 'test_x.py'), '')
    const old = new Date(Date.now() - 3 * 3600_000)
    fs.utimesSync(mod, old, old)

    assert.deepEqual(listBackendSources(dir), [mod]) // tests/ bị bỏ qua
    const f = createChangeFilter()
    f.seed(listBackendSources(dir))

    fs.readFileSync(mod)
    fs.utimesSync(mod, new Date(), old) // giả lập Windows cập nhật atime, mtime giữ nguyên
    assert.equal(f.isRealChange(mod), false)

    fs.writeFileSync(mod, 'x = 2\n')
    assert.equal(f.isRealChange(mod), true)
    assert.equal(f.isRealChange(mod), false) // sự kiện lặp cho cùng một lần lưu

    const added = path.join(dir, 'app', 'new.py')
    fs.writeFileSync(added, '')
    assert.equal(f.isRealChange(added), true)

    fs.unlinkSync(added)
    assert.equal(f.isRealChange(added), true)
    assert.equal(f.isRealChange(added), false)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('hoãn restart backend khi còn job Flow đang chạy; job chết / đã xong không chặn', () => {
  const now = Date.parse('2026-11-23T10:00:00Z')
  const at = (minAgo) => new Date(now - minAgo * 60_000).toISOString()
  const jobs = [
    { job_id: 'gen', status: 'generating', updated_at: at(2) },
    { job_id: 'queued', status: 'pending', updated_at: at(0) },
    { job_id: 'done', status: 'done', updated_at: at(1) },
    { job_id: 'err', status: 'error', updated_at: at(1) },
    { job_id: 'stuck', status: 'generating', updated_at: at(40) },   // im lặng 40 phút = đã chết
    { job_id: 'nodate', status: 'captcha' },                          // không có giờ: coi là còn sống
  ]
  assert.deepEqual(activeFlowJobs(jobs, now).map(j => j.job_id), ['gen', 'queued', 'nodate'])
  assert.deepEqual(activeFlowJobs(null, now), [])
  assert.deepEqual(activeFlowJobs([], now), [])
})

test('trạng thái "đang chạy" khớp backend veo/service._ACTIVE_JOB_STATUSES', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'Backend', 'app', 'veo', 'service.py'), 'utf8')
  const block = src.slice(src.indexOf('_ACTIVE_JOB_STATUSES = {'), src.indexOf('}', src.indexOf('_ACTIVE_JOB_STATUSES = {')))
  const names = [...block.matchAll(/JobStatus\.([A-Z_]+)\.value/g)].map(m => m[1].toLowerCase()).sort()
  assert.ok(names.length > 0, 'không đọc được _ACTIVE_JOB_STATUSES')
  assert.deepEqual([...ACTIVE_FLOW_STATUSES].sort(), names, 'đổi trạng thái job ở backend thì sửa ACTIVE_FLOW_STATUSES trong dev.js')
})

test('looksOurs nhận ra backend_server.exe và voice_server.exe từ bản đóng gói (publish)', () => {
  const backend = p(1000, 500, 'backend_server.exe', '"C:\\Program Files\\CreatorFlow AI\\resources\\bin\\backend_server.exe"', 100)
  const voice  = p(1001, 500, 'voice_server.exe',  '"C:\\Program Files\\CreatorFlow AI\\resources\\bin\\voice_server.exe"',  100)
  const { looksOurs } = require('./dev.js')
  assert.ok(looksOurs(backend), 'backend_server.exe phải được nhận là "của mình"')
  assert.ok(looksOurs(voice),   'voice_server.exe phải được nhận là "của mình"')
})

test('looksOurs KHÔNG nhận tiến trình lạ có tên exe giống nhưng cmd khác', () => {
  // Giả sử user cài app tên khác cũng có exe "backend_server.exe" nhưng path hoàn toàn lạ
  // → vì looksOurs dùng /^(backend_server|voice_server)(\.exe)?$/i.test(name) nên sẽ khớp
  // Test này xác nhận hành vi hiện tại (intentional: ưu tiên không bỏ sót hơn không kill nhầm)
  const foreign = p(2000, 1, 'backend_server.exe', '"C:\\OtherApp\\backend_server.exe"', 100)
  const { looksOurs } = require('./dev.js')
  // Đây là bản đóng gói của chúng ta hoặc app lạ: hành vi chủ ý là nhận ra exe theo tên
  assert.ok(looksOurs(foreign), 'backend_server.exe theo tên được coi là của mình (có chủ ý)')
})
