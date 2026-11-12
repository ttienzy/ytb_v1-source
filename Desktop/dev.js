/**
 * dev.js — khởi động BACKEND + VOICE + FRONTEND cùng lúc, và TẮT SẠCH tất cả khi thoát.
 *
 * Chạy:  npm start                  khởi động sạch (dọn tiến trình cũ còn giữ cổng rồi chạy mới)
 *        npm run stop               dọn sạch mọi tiến trình dev còn sót (không khởi động gì)
 *        npm run start:stable       như start nhưng backend KHÔNG tự restart khi sửa file .py
 *
 * Sửa file .py -> dev.js (không phải uvicorn --reload) restart RIÊNG backend; voice + Electron giữ nguyên. Lý do: trên
 * Windows `uvicorn --reload` restart worker bằng CTRL_C_EVENT, phát tới mọi tiến trình chung console => cả cụm tự tắt.
 *        npm run start:reuse        dùng lại service đang chạy sẵn nếu khỏe (hành vi cũ)
 *
 * Cờ (hoặc biến môi trường DEV_<TÊN>=1):
 *   --reuse          nếu cổng đang có service khỏe thì dùng lại thay vì dọn
 *   --keep-services  đóng cửa sổ Electron KHÔNG tắt backend/voice
 *   --no-reload      không tự restart backend khi sửa .py (tránh bị kill giữa chừng khi một job dài đang chạy)
 *   --force          được phép kill cả tiến trình lạ đang giữ cổng 8000/8001
 *   --only=a,b       chỉ chạy một phần: backend,voice,frontend
 *   --stop           chỉ dọn sạch rồi thoát
 *
 * Vì sao hay sót tiến trình trên Windows: mỗi lệnh Python là 2 process nối nhau (venv launcher -> python thật),
 * `uvicorn --reload` còn đẻ thêm worker. Nếu process cha chết trước, worker thành "mồ côi": taskkill /T không còn
 * lần theo được, nhưng nó vẫn giữ socket đang listen (cổng 8000 hiện chủ là một PID đã chết). Vì vậy ở đây:
 *   1) trước khi thoát: chụp cả cây (kể cả worker mồ côi `spawn_main(parent_pid=...)`) rồi kill một lượt;
 *   2) mọi lúc: kill theo CỔNG (người đang listen + con của nó) và đợi tới khi cổng thật sự trống;
 *   3) lúc khởi động: dọn cổng thay vì dùng lại service cũ (đó là nguyên nhân backend chạy code cũ).
 */
const { spawn, spawnSync } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const DESKTOP = __dirname
const IS_WIN = process.platform === 'win32'
const RESET = '\x1b[0m'

// ── tuỳ chọn ─────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2)
const flag = name => argv.includes(`--${name}`) || process.env[`DEV_${name.toUpperCase().replace(/-/g, '_')}`] === '1'
const OPT = {
  reuse: flag('reuse'), keepServices: flag('keep-services'), noReload: flag('no-reload'),
  force: flag('force'), stop: flag('stop'),
}
const onlyArg = argv.find(a => a.startsWith('--only='))
const ONLY = onlyArg ? new Set(onlyArg.slice(7).toLowerCase().split(',').map(s => s.trim()).filter(Boolean)) : null

const PY = path.join(ROOT, 'Backend', '.venv', 'Scripts', 'python.exe')
const EV_BIN = path.join(ROOT, 'Frontend', 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

/** Tìm uv.exe: ưu tiên %USERPROFILE%\.local\bin\uv.exe, fallback PATH. */
function resolveUv() {
  const home = process.env.USERPROFILE || process.env.HOME || ''
  for (const c of [path.join(home, '.local', 'bin', 'uv.exe'), path.join(home, '.local', 'bin', 'uv')]) {
    try { if (fs.existsSync(c)) return c } catch { /* bỏ qua */ }
  }
  return IS_WIN ? 'uv.exe' : 'uv'
}
const UV = resolveUv()

/** Mô tả 1 service. `port` có thì được dọn/kiểm trước khi chạy và sau khi tắt. */
const ALL_TARGETS = [
  {
    key: 'backend', name: 'BACKEND', critical: true, port: 8000,
    healthUrl: 'http://127.0.0.1:8000/api/ping', color: '\x1b[34m',
    cmd: PY,
    // KHÔNG dùng `uvicorn --reload`: trên Windows nó restart worker bằng os.kill(pid, CTRL_C_EVENT), mà tín hiệu này
    // được phát tới MỌI tiến trình chung console (dev.js, voice, electron-vite…) → cả cụm tự tắt mỗi lần sửa file .py.
    // Thay vào đó dev.js tự theo dõi file (watchBackend) và chỉ restart riêng backend.
    args: ['-m', 'uvicorn', 'app.main:app',
           '--app-dir', path.join(ROOT, 'Backend'), '--host', '127.0.0.1', '--port', '8000'],
    opts: { cwd: path.join(ROOT, 'Backend') },
    watch: !OPT.noReload,
  },
  {
    key: 'voice', name: 'VOICE', critical: true, port: 8001,
    healthUrl: 'http://127.0.0.1:8001/health', color: '\x1b[35m',
    cmd: UV,
    args: ['run', '--directory', path.join(ROOT, 'services', 'voice-service'), 'uvicorn', 'app.main:app', '--port', '8001'],
    opts: { cwd: DESKTOP },
  },
  {
    key: 'frontend', name: 'FRONTEND', critical: false, port: 0, color: '\x1b[32m',
    cmd: process.execPath, // node (cùng binary đang chạy dev.js)
    args: [EV_BIN, 'dev'],
    opts: {
      cwd: path.join(ROOT, 'Frontend'),
      // Bỏ ELECTRON_RUN_AS_NODE để electron-vite chạy electron đúng (không node mode)
      env: (() => { const e = { ...process.env }; delete e.ELECTRON_RUN_AS_NODE; return e })(),
    },
  },
]
const TARGETS = ALL_TARGETS.filter(t => !ONLY || ONLY.has(t.key))

const say = (tag, color, msg) => process.stdout.write(`${color}[${tag}]${RESET} ${msg}\n`)
const dev = msg => say('dev', '\x1b[36m', msg)
const warn = msg => say('dev', '\x1b[33m', msg)
const sleepSync = ms => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms) } catch { /* bỏ qua */ } }

// ── tiện ích tiến trình (đồng bộ, vì chạy được cả trong lúc thoát) ───────────
/** [{pid, ppid, name, cmd}] của mọi tiến trình đang chạy. */
function snapshot() {
  if (IS_WIN) {
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      '[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-CimInstance Win32_Process | ' +
      'Select-Object ProcessId,ParentProcessId,Name,CommandLine,@{n="Created";e={$_.CreationDate.ToUniversalTime().ToString("o")}} | ConvertTo-Json -Compress'],
    { encoding: 'utf8', windowsHide: true, timeout: 25000 })
    try {
      const j = JSON.parse(r.stdout)
      return (Array.isArray(j) ? j : [j]).map(p => ({
        pid: p.ProcessId, ppid: p.ParentProcessId, name: p.Name || '', cmd: p.CommandLine || '',
        created: p.Created ? Date.parse(p.Created) : 0,
      }))
    } catch { return [] }
  }
  const r = spawnSync('ps', ['-eo', 'pid=,ppid=,comm=,args='], { encoding: 'utf8' })
  return (r.stdout || '').split('\n').map(l => l.trim().match(/^(\d+)\s+(\d+)\s+(\S+)\s*(.*)$/)).filter(Boolean)
    .map(m => ({ pid: +m[1], ppid: +m[2], name: m[3], cmd: m[4], created: 0 }))
}

/** PID đang LISTEN trên cổng (có thể là một PID đã chết nhưng socket còn do worker mồ côi giữ). */
function listeningPids(port) {
  const pids = new Set()
  if (IS_WIN) {
    const r = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], { encoding: 'utf8', windowsHide: true })
    for (const line of (r.stdout || '').split('\n')) {
      const m = line.match(/^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i)
      if (m && Number(m[1]) === port) pids.add(Number(m[2]))
    }
  } else {
    const r = spawnSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], { encoding: 'utf8' })
    for (const s of (r.stdout || '').split('\n')) if (s.trim()) pids.add(Number(s))
  }
  pids.delete(0)
  return [...pids]
}

/** Không bao giờ kill các tiến trình lõi của hệ điều hành, dù có chuyện gì xảy ra. */
const PROTECTED = /^(system|smss|csrss|wininit|winlogon|services|lsass|lsm|svchost|dwm|fontdrvhost|explorer|sihost|taskhostw|registry|idle|memory compression|conhost|ctfmon|runtimebroker|searchhost|startmenuexperiencehost|shellexperiencehost)(\.exe)?$/i
/** Loại tiến trình mà chuỗi service của dev.js thực sự sinh ra. */
const SPAWNED = /^(python|pythonw|uv|uvx|uvicorn|node|electron|esbuild)(\d|\.)*(\.exe)?$/i

/** Có được coi là "con cháu hợp lệ" của một tiến trình trong tập không. Windows TÁI SỬ DỤNG số PID, nên chỉ nhìn
 *  ParentProcessId là không đủ: tiến trình hệ thống (csrss, winlogon, dwm…) có thể mang một PID cha cũ trùng ngẫu nhiên
 *  với PID của backend vừa chết. Phải thêm 3 điều kiện: không phải tiến trình lõi, đúng loại do dev.js sinh ra, và
 *  sinh SAU cha (nếu cha còn sống). */
function isManagedChild(p, byPid) {
  if (PROTECTED.test(p.name)) return false
  if (!(SPAWNED.test(p.name) || looksOurs(p))) return false
  const parent = byPid.get(p.ppid)
  if (parent && p.created && parent.created && p.created < parent.created) return false
  return true
}

/** Gom `roots` + con cháu hợp lệ + worker mồ côi `spawn_main(parent_pid=<pid trong tập>)` (lặp tới khi ổn định). */
function collectVictims(roots, procs) {
  const byPid = new Map(procs.map(p => [p.pid, p]))
  const set = new Set(roots.filter(pid => pid && !(byPid.get(pid) && PROTECTED.test(byPid.get(pid).name))))
  let grew = true
  while (grew) {
    grew = false
    for (const p of procs) {
      if (set.has(p.pid)) continue
      const m = p.cmd.match(/parent_pid=(\d+)/)
      const orphanOfSet = m && set.has(Number(m[1])) && !PROTECTED.test(p.name) && /^python/i.test(p.name)
      if (orphanOfSet || (set.has(p.ppid) && isManagedChild(p, byPid))) { set.add(p.pid); grew = true }
    }
  }
  return [...set]
}

function killPids(pids) {
  const list = pids.filter(Boolean)
  if (!list.length) return
  if (IS_WIN) {
    spawnSync('taskkill.exe', ['/F', '/T', ...list.flatMap(p => ['/PID', String(p)])], { stdio: 'ignore', windowsHide: true })
  } else {
    for (const p of list) { try { process.kill(p, 'SIGKILL') } catch { /* đã chết */ } }
  }
}

/** Tiến trình trông như của dự án này (để không kill nhầm chương trình lạ đang dùng cổng). */
function looksOurs(p) {
  const cmd = p.cmd.toLowerCase()
  return cmd.includes(ROOT.toLowerCase()) || /uvicorn|multiprocessing\.spawn|electron-vite|voice-service|app\.main/.test(cmd)
}

/** Dọn cổng: kill người đang listen + con cháu + worker mồ côi, lặp tới khi cổng trống. Trả {freed, foreign, killed}. */
function freePort(port, { allowForeign = false } = {}) {
  const killed = []
  for (let round = 0; round < 4; round++) {
    const owners = listeningPids(port)
    if (!owners.length) return { freed: true, foreign: null, killed }
    const procs = snapshot()
    const byPid = new Map(procs.map(p => [p.pid, p]))
    const foreign = owners.map(pid => byPid.get(pid)).find(p => p && !looksOurs(p))
    if (foreign && !allowForeign) return { freed: false, foreign, killed }
    const victims = collectVictims(owners, procs)
    for (const pid of victims) { const p = byPid.get(pid); killed.push(p ? `${p.name}#${pid}` : `#${pid}(đã chết, socket mồ côi)`) }
    killPids(victims)
    for (let i = 0; i < 15 && listeningPids(port).length; i++) sleepSync(200) // đợi hệ điều hành nhả socket
  }
  return { freed: listeningPids(port).length === 0, foreign: null, killed }
}

async function isHealthy(target) {
  if (!target.healthUrl || typeof fetch !== 'function') return false
  try { return (await fetch(target.healthUrl, { signal: AbortSignal.timeout(1500) })).ok } catch { return false }
}

// ── chạy & tắt ───────────────────────────────────────────────────────────────
const children = []          // [{pid, target, child}]
const launched = []          // các target do dev.js này khởi động (không tính cái dùng lại)
const retired = new WeakSet() // child cố ý bị dừng để restart: việc nó thoát KHÔNG được kéo sập cả cụm
let shuttingDown = false
let cleaned = false

function prefixPipe(child, target) {
  const tag = `${target.color}[${target.name}]${RESET} `
  const handle = stream => {
    let buf = ''
    stream.on('data', chunk => {
      buf += chunk.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        process.stdout.write(tag + buf.slice(0, i).replace(/\r$/, '') + '\n')
        buf = buf.slice(i + 1)
      }
    })
  }
  handle(child.stdout)
  handle(child.stderr)
}

/** Tắt sạch mọi thứ dev.js đã bật: cây con + worker mồ côi + người còn giữ cổng. Đồng bộ, chạy nhiều lần cũng được. */
function cleanupAll(fast = false) {
  if (cleaned && !fast) return
  cleaned = true
  const roots = children.map(c => c.pid)
  if (fast) { killPids(roots); return }
  killPids(collectVictims(roots, snapshot()))              // 1) cả cây của các tiến trình con (kể cả mồ côi)
  for (const t of launched) {                              // 2) cổng vẫn bị giữ -> kill theo cổng
    if (t.port) freePort(t.port, { allowForeign: false })
  }
}

function shutdown(reason, code = 0) {
  if (shuttingDown) {                                      // Ctrl+C lần 2: thoát ngay, kill nhanh
    cleanupAll(true)
    process.exit(code || 1)
  }
  shuttingDown = true
  process.stdout.write(`\n\x1b[33m[dev]${RESET} đang tắt tất cả (${reason})…\n`)
  cleanupAll()
  const stillBusy = launched.filter(t => t.port && listeningPids(t.port).length)
  if (stillBusy.length) warn(`cổng ${stillBusy.map(t => t.port).join(', ')} vẫn còn bị giữ; chạy "npm run stop" để dọn.`)
  else dev('đã tắt sạch.')
  process.exit(code)
}

async function launch(target) {
  const child = spawn(target.cmd, target.args, {
    stdio: ['ignore', 'pipe', 'pipe'], shell: false, windowsHide: false, ...target.opts,
  })
  prefixPipe(child, target)
  children.push({ pid: child.pid, target, child })
  if (!launched.includes(target)) launched.push(target)
  child.on('error', error => {
    say(target.name, target.color, `không khởi động được: ${error.message}`)
    if (target.critical && !shuttingDown) shutdown(`${target.name}-spawn-error`, 1)
  })
  child.on('exit', (code, signal) => {
    say(target.name, target.color, `thoát (code=${code} sig=${signal})`)
    if (shuttingDown || retired.has(child)) return
    if (target.critical) {
      // Backend/voice là core: một service chết thì dừng cả cụm để tránh UI gửi request vào hệ thống nửa sống nửa chết.
      shutdown(`${target.name.toLowerCase()}-exit-${code ?? signal ?? 'unknown'}`, 1)
    } else if (OPT.keepServices) {
      say(target.name, target.color, 'frontend đã dừng; backend và voice vẫn giữ nguyên (--keep-services).')
    } else {
      shutdown('frontend-closed')                          // đóng cửa sổ app = tắt hết
    }
  })
  return child
}

async function waitHealthy(target, timeoutMs) {
  const end = Date.now() + timeoutMs
  while (Date.now() < end) {
    if (await isHealthy(target)) return true
    await new Promise(r => setTimeout(r, 500))
  }
  return false
}

/** Thư mục/tệp không được kích hoạt restart (không phải mã nguồn backend, hoặc backend tự ghi vào lúc chạy). */
const WATCH_IGNORE = /(^|[\\/])(\.venv|venv|__pycache__|Data|node_modules|dist|build|tests|poc|\.git)([\\/]|$)/i
const isBackendSource = rel => !!rel && /\.py$/i.test(rel) && !WATCH_IGNORE.test(rel)

/** Dừng backend cũ (cả cây + giữ cổng) rồi chạy lại. Voice/Frontend giữ nguyên. */
async function restartService(target, why) {
  dev(`${why} → khởi động lại ${target.name} (voice/frontend giữ nguyên)…`)
  const old = children.find(c => c.target === target)
  if (old) {
    retired.add(old.child)
    children.splice(children.indexOf(old), 1)
    killPids(collectVictims([old.pid], snapshot()))
  }
  if (target.port) freePort(target.port, { allowForeign: false })
  if (shuttingDown) return
  const child = await launch(target)
  const ok = await waitHealthy(target, 60000)
  say(target.name, target.color, ok ? `đã chạy lại (pid ${child.pid}) và sẵn sàng.` : 'đã chạy lại nhưng chưa phản hồi sau 60 giây — kiểm tra log phía trên (có thể lỗi cú pháp).')
}

/** Theo dõi Backend/**.py; gom các lần lưu liên tiếp (debounce) rồi restart đúng một lần. */
function watchBackend(target) {
  const dir = path.join(ROOT, 'Backend')
  const changed = new Set()
  let timer = null
  let busy = false
  async function flush() {
    if (busy || shuttingDown) return
    busy = true
    try {
      while (changed.size && !shuttingDown) {
        const files = [...changed].slice(0, 3).join(', ') + (changed.size > 3 ? `… (+${changed.size - 3})` : '')
        changed.clear()
        await restartService(target, `phát hiện sửa ${files}`)
      }
    } catch (error) {
      warn(`restart backend lỗi: ${error?.message || error}`)
    } finally { busy = false }
  }
  try {
    const watcher = fs.watch(dir, { recursive: true }, (_ev, rel) => {
      if (!isBackendSource(rel && String(rel))) return
      changed.add(String(rel).replace(/\\/g, '/'))
      clearTimeout(timer)
      timer = setTimeout(flush, 800)
    })
    watcher.on('error', error => warn(`không theo dõi được file backend: ${error.message}`))
    dev('theo dõi Backend/**/*.py: sửa file sẽ chỉ restart backend, KHÔNG tắt voice/frontend.')
  } catch (error) {
    warn(`không bật được theo dõi file backend (${error.message}); chạy lại thủ công khi sửa .py.`)
  }
}

if (require.main !== module) {
  module.exports = { collectVictims, isManagedChild, looksOurs, isBackendSource, PROTECTED, SPAWNED }
} else {
process.on('SIGINT', () => shutdown('Ctrl+C'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('SIGBREAK', () => shutdown('Ctrl+Break'))
process.on('SIGHUP', () => shutdown('đóng cửa sổ terminal'))
process.on('exit', () => { if (!cleaned) cleanupAll(true) })   // phòng hờ: thoát bất thường vẫn kill con

;(async () => {
  const ports = TARGETS.filter(t => t.port)

  if (OPT.stop) {
    for (const t of ports) {
      const r = freePort(t.port, { allowForeign: OPT.force })
      if (r.foreign) say(t.name, t.color, `cổng ${t.port} đang bị chương trình khác giữ (${r.foreign.name}: ${r.foreign.cmd.slice(0, 90)}). Thêm --force nếu muốn kill.`)
      else say(t.name, t.color, r.killed.length ? `đã dọn: ${r.killed.join(', ')}` : `cổng ${t.port} đã trống.`)
    }
    process.exit(0)
  }

  // 1) Dọn cổng thay vì dùng lại service cũ (trừ khi --reuse)
  const toLaunch = []
  for (const t of TARGETS) {
    if (!t.port) { toLaunch.push(t); continue }
    if (OPT.reuse && await isHealthy(t)) { say(t.name, t.color, 'đã chạy sẵn, dùng lại service hiện tại (--reuse).'); continue }
    const busy = listeningPids(t.port)
    if (busy.length) {
      say(t.name, t.color, `cổng ${t.port} đang bị giữ (PID ${busy.join(', ')}), có thể là service cũ từ phiên trước → dọn…`)
      const r = freePort(t.port, { allowForeign: OPT.force })
      if (!r.freed) {
        const who = r.foreign ? `${r.foreign.name} — ${r.foreign.cmd.slice(0, 100)}` : 'không rõ tiến trình'
        say(t.name, t.color, `KHÔNG dọn được cổng ${t.port}: ${who}. Đóng chương trình đó hoặc chạy lại với --force.`)
        process.exit(1)
      }
      say(t.name, t.color, `đã dọn: ${r.killed.join(', ')}`)
    }
    toLaunch.push(t)
  }

  // 2) Khởi động. Backend phải khỏe rồi mới bật frontend để UI không gọi vào backend chưa sẵn sàng.
  for (const t of toLaunch) {
    const child = await launch(t)
    say(t.name, t.color, `đã bật (pid ${child.pid})${t.watch ? ' · tự restart backend khi sửa file .py (dev.js theo dõi)' : ''}`)
    if (t.key === 'backend' && toLaunch.some(x => x.key === 'frontend')) {
      const ok = await waitHealthy(t, 60000)
      say(t.name, t.color, ok ? 'sẵn sàng.' : 'chưa phản hồi sau 60 giây (vẫn tiếp tục bật frontend).')
    }
    if (t.watch) watchBackend(t)
  }
  dev(`${TARGETS.map(t => t.name + (t.port ? ' :' + t.port : '')).join(' · ')}`)
  dev(`Ctrl+C hoặc đóng cửa sổ app → tắt HẾT${OPT.keepServices ? ' (trừ backend/voice vì --keep-services)' : ''}.`)

  // Chỉ dùng khi kiểm thử dev.js: tự tắt sau N ms để kiểm tra cơ chế dọn sạch.
  if (process.env.DEV_TEST_SHUTDOWN_AFTER_MS) setTimeout(() => shutdown('test'), Number(process.env.DEV_TEST_SHUTDOWN_AFTER_MS))
})().catch(error => {
  process.stderr.write(`[dev] startup error: ${error?.stack || error}\n`)
  shutdown('startup-error', 1)
})
}
