/**
 * dev.js — khởi động BE + voice-service + FE cùng lúc.
 *
 * Mục tiêu: Ctrl+C (hoặc đóng terminal) → tắt ĐỒNG LỘAT cả 3 (kèm grandchild:
 * uvicorn worker, electron, vite). Thay vì chạy qua nhiều lớp `npm run` / `cmd`
 * (concurrently không tree-kill xuyên được), spawn trực tiếp binary thật
 * (python.exe, uv.exe, node) rồi taskkill /T /F toàn cây khi thoát.
 *
 * Chạy:  npm start   (= node dev.js)
 */
const { spawn } = require('node:child_process')
const path = require('node:path')
const { setTimeout: sleep } = require('node:timers/promises')

const ROOT = path.resolve(__dirname, '..')
const DESKTOP = __dirname
const IS_WIN = process.platform === 'win32'

const PY = path.join(ROOT, 'Backend', '.venv', 'Scripts', 'python.exe')
const EV_BIN = path.join(ROOT, 'Frontend', 'node_modules', 'electron-vite', 'bin', 'electron-vite.js')

/** Tìm uv.exe: ưu tiên %USERPROFILE%\.local\bin\uv.exe, fallback PATH. */
function resolveUv() {
  const fs = require('node:fs')
  const home = process.env.USERPROFILE || process.env.HOME || ''
  const candidates = [
    path.join(home, '.local', 'bin', 'uv.exe'),
    path.join(home, '.local', 'bin', 'uv'), // non-Windows
  ]
  for (const c of candidates) { try { if (fs.existsSync(c)) return c } catch {} }
  return IS_WIN ? 'uv.exe' : 'uv' // để CreateProcess / execvp tự search PATH
}
const UV = resolveUv()

/** Mô tả 1 process. */
const TARGETS = [
  {
    name: 'BACKEND',
    color: '\x1b[34m', // blue
    cmd: PY,
    args: ['-m', 'uvicorn', 'app.main:app', '--reload', '--reload-dir', path.join(ROOT, 'Backend'), '--app-dir',
           path.join(ROOT, 'Backend'), '--host', '127.0.0.1', '--port', '8000'],
    opts: { cwd: path.join(ROOT, 'Backend') },
  },
  {
    name: 'VOICE',
    color: '\x1b[35m', // magenta
    cmd: UV,
    args: ['run', '--directory', path.join(ROOT, 'services', 'voice-service'),
           'uvicorn', 'app.main:app', '--port', '8001'],
    opts: { cwd: DESKTOP },
  },
  {
    name: 'FRONTEND',
    color: '\x1b[32m', // green
    cmd: process.execPath, // node (cùng binary đang chạy dev.js)
    args: [EV_BIN, 'dev'],
    opts: {
      cwd: path.join(ROOT, 'Frontend'),
      // Bỏ ELECTRON_RUN_AS_NODE để electron-vite chạy electron đúng (không node mode)
      env: (() => { const e = { ...process.env }; delete e.ELECTRON_RUN_AS_NODE; return e })(),
    },
  },
]

const RESET = '\x1b[0m'
const children = []
let shuttingDown = false

/** taskkill /T /F /PID (Windows) → giết cả cây process. */
function treeKill(pid) {
  if (!pid) return
  if (IS_WIN) {
    try {
      spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', shell: true })
    } catch { /* ignore */ }
  } else {
    try { process.kill(-pid, 'SIGKILL') } catch { try { process.kill(pid, 'SIGKILL') } catch {} }
  }
}

function prefixPipe(child, name, color) {
  const tag = `${color}[${name}]${RESET} `
  const handle = (stream) => {
    let buf = ''
    stream.on('data', (chunk) => {
      buf += chunk.toString()
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).replace(/\r$/, '')
        buf = buf.slice(i + 1)
        process.stdout.write(tag + line + '\n')
      }
    })
  }
  handle(child.stdout)
  handle(child.stderr)
}

function launch(target) {
  const child = spawn(target.cmd, target.args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    windowsHide: false,
    ...target.opts,
  })
  prefixPipe(child, target.name, target.color)
  children.push(child)
  child.on('exit', (code, signal) => {
    process.stdout.write(`${target.color}[${target.name}]${RESET} thoát (code=${code} sig=${signal})\n`)
    // Nếu 1 process chết khi KHÔNG đang shutdown → tắt luôn cả 3 (đồng loạt).
    if (!shuttingDown) shutdown('child-exit')
  })
  return child
}

let shutdownStarted = false
async function shutdown(reason) {
  if (shutdownStarted) return
  shutdownStarted = true
  shuttingDown = true
  process.stdout.write(`\n\x1b[33m[dev]${RESET} đang tắt tất cả (${reason})…\n`)
  for (const c of children) treeKill(c.pid)
  // đợi taskkill kịp chạy rồi thoát
  await sleep(400)
  process.exit(0)
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
// Windows: đóng cửa sổ console → SIGHUP-ish (không có, nhưng 'uncaughtException' thì vẫn thoát)
process.on('SIGHUP', () => shutdown('SIGHUP'))

// Launch all
for (const t of TARGETS) launch(t)

process.stdout.write('\x1b[36m[dev]\x1b[0m BACKEND :8000 · VOICE :8001 · FRONTEND (electron-vite)\n')
process.stdout.write('\x1b[36m[dev]\x1b[0m Ctrl+C để tắt đồng loạt cả 3.\n\n')
