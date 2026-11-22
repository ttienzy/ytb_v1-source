// Môi trường thử TÁCH RIÊNG cho e2e Electron: backend riêng (bản chép code, dữ liệu riêng) + Vite riêng, KHÔNG đụng app thật
// (backend 8000 / bridge 60526 / dữ liệu Backend/Data). Chạy từ thư mục Frontend:
//
//   npm run e2e:up [-- --watermark]   dựng (backend :8010, bridge :61999, Vite :5199); --watermark: dùng gwr của repo
//   npm run e2e:status
//   npm run e2e:down                  dừng đúng các tiến trình đã dựng + xóa cấu hình Vite tạm
//
// Viết kịch bản bằng scripts/e2e/harness.mjs (mở Electron trỏ vào môi trường này). Không bao giờ gửi gì lên Flow thật:
// kịch bản cần Flow thì giả lập bằng page.route (xem harness.mockJson).
import { spawn, spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const FRONT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
export const REPO = join(FRONT, '..')
export const WS = process.env.E2E_DIR || join(tmpdir(), 'creatorflow-e2e')
export const PORTS = {
  backend: Number(process.env.E2E_BACKEND_PORT || 8010),
  bridge: Number(process.env.E2E_BRIDGE_PORT || 61999),
  vite: Number(process.env.E2E_VITE_PORT || 5199),
}
/** Cổng của app THẬT: không bao giờ dùng, không bao giờ dừng tiến trình giữ chúng. */
export const REAL_PORTS = [8000, 8001, 60526]
const STATE = join(WS, 'state.json')
const VITE_CONFIG = join(FRONT, 'vite.e2e.tmp.config.mjs')

/** PID đang LISTEN trên một cổng, cả IPv4 lẫn IPv6 (Vite nghe "localhost" = [::1] trên Windows). */
export function listeners(port) {
  const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8', windowsHide: true })
  const pids = new Set()
  for (const line of (r.stdout || '').split(/\r?\n/)) {
    const m = /^\s*TCP\s+\S+:(\d+)\s+\S+\s+LISTENING\s+(\d+)/i.exec(line)
    if (m && Number(m[1]) === port) pids.add(Number(m[2]))
  }
  return [...pids]
}

const realPids = () => new Set(REAL_PORTS.flatMap(listeners))

function killTree(pid) {
  if (realPids().has(pid)) throw new Error(`PID ${pid} đang giữ cổng của app thật — không dừng.`)
  spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
}

async function waitHttp(url, ms) {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (r.ok) return true
    } catch { /* chưa lên */ }
    await new Promise((r) => setTimeout(r, 700))
  }
  return false
}

export const readState = () => (existsSync(STATE) ? JSON.parse(readFileSync(STATE, 'utf8')) : null)

export async function up({ watermark = false } = {}) {
  if (Object.values(PORTS).some((p) => REAL_PORTS.includes(p))) throw new Error(`Cổng thử trùng cổng app thật ${REAL_PORTS.join('/')}.`)
  const busy = Object.entries(PORTS).filter(([, p]) => listeners(p).length)
  if (busy.length) {
    throw new Error(`Cổng đang bận: ${busy.map(([k, p]) => `${k} :${p} (PID ${listeners(p).join(',')})`).join('; ')}. `
      + (readState() ? 'Chạy "npm run e2e:down" trước.' : 'Dừng tiến trình đó trước (không phải do e2e:up dựng).'))
  }
  // backend: bản chép code (sửa .py trong repo không làm backend thử restart) + dữ liệu trống riêng
  const be = join(WS, 'Backend')
  rmSync(WS, { recursive: true, force: true })
  mkdirSync(join(be, 'Data'), { recursive: true })
  for (const part of ['app', 'prompts', 'resources', 'run_server.py']) {
    const src = join(REPO, 'Backend', part)
    if (existsSync(src)) cpSync(src, join(be, part), { recursive: true, filter: (p) => !p.includes('__pycache__') })
  }
  const env = {
    ...process.env, APP_DATA_DIR: be, PORT: String(PORTS.backend), VEO_BRIDGE_PORT: String(PORTS.bridge),
    BACKEND_RELOAD: '0', PYTHONIOENCODING: 'utf-8',
  }
  if (watermark) {
    const rt = join(FRONT, 'watermark-runtime', 'node_modules')
    Object.assign(env, {
      WATERMARK_NODE_PATH: process.execPath,
      WATERMARK_GWR_SCRIPT: join(rt, '@pilio', 'gemini-watermark-remover', 'bin', 'gwr.mjs'),
      WATERMARK_PLAYWRIGHT_BROWSERS_PATH: join(rt, 'playwright-core', '.local-browsers'),
    })
  }
  const py = join(REPO, 'Backend', '.venv', 'Scripts', 'python.exe')
  const beLog = openSync(join(WS, 'backend.log'), 'a')
  const backend = spawn(py, ['run_server.py'], { cwd: be, env, detached: true, stdio: ['ignore', beLog, beLog], windowsHide: true })
  backend.unref()

  // Vite: renderer trỏ vào backend thử (cấu hình tạm nằm trong Frontend để plugin resolve được; đã .gitignore)
  writeFileSync(VITE_CONFIG, `// TẠM — do scripts/e2e/isolated.mjs tạo; "npm run e2e:down" xóa.
import { resolve } from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
export default defineConfig({
  root: resolve('.'),
  resolve: { alias: { '@': resolve('src') } },
  define: { __APP_VERSION__: JSON.stringify('v0-e2e'), __GITHUB_REPO__: JSON.stringify({ owner: 'x', repo: 'y' }) },
  plugins: [react(), tailwindcss()],
  server: { port: ${PORTS.vite}, strictPort: true },
})
`)
  const viteLog = openSync(join(WS, 'vite.log'), 'a')
  const vite = spawn(process.execPath, [join(FRONT, 'node_modules', 'vite', 'bin', 'vite.js'), '--config', VITE_CONFIG], {
    cwd: FRONT, env: { ...process.env, VITE_API_URL: `http://127.0.0.1:${PORTS.backend}` },
    detached: true, stdio: ['ignore', viteLog, viteLog], windowsHide: true,
  })
  vite.unref()
  const state = { pids: { backend: backend.pid, vite: vite.pid }, ports: PORTS, ws: WS, watermark, startedAt: new Date().toISOString() }
  writeFileSync(STATE, JSON.stringify(state, null, 2))

  const okBe = await waitHttp(`http://127.0.0.1:${PORTS.backend}/api/workflow/muse/projects`, 90000)
  const okVite = await waitHttp(`http://localhost:${PORTS.vite}/`, 60000)
  if (!okBe || !okVite) {
    await down()
    throw new Error(`Không lên được: backend ${okBe ? 'ok' : 'LỖI'} · vite ${okVite ? 'ok' : 'LỖI'} — xem ${WS}\\backend.log, vite.log`)
  }
  return state
}

export async function down() {
  const state = readState()
  const stopped = []
  if (state) {
    for (const [name, pid] of Object.entries(state.pids || {})) {
      try { killTree(pid); stopped.push(`${name} (PID ${pid})`) } catch (e) { stopped.push(`${name}: ${e.message}`) }
    }
  }
  // còn sót tiến trình con giữ cổng thử (vd. worker): chỉ dừng nếu không phải app thật
  for (const port of Object.values(state?.ports || PORTS)) {
    for (const pid of listeners(port)) {
      try { killTree(pid); stopped.push(`cổng ${port} (PID ${pid})`) } catch (e) { stopped.push(`cổng ${port}: ${e.message}`) }
    }
  }
  rmSync(VITE_CONFIG, { force: true })
  if (existsSync(STATE)) rmSync(STATE, { force: true })
  return stopped
}

export function status() {
  const state = readState()
  return {
    state,
    listening: Object.fromEntries(Object.entries(state?.ports || PORTS).map(([k, p]) => [k, listeners(p)])),
    viteConfig: existsSync(VITE_CONFIG),
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const cmd = process.argv[2]
  try {
    if (cmd === 'up') {
      const s = await up({ watermark: process.argv.includes('--watermark') })
      console.log(`[e2e] sẵn sàng: backend :${s.ports.backend} · Vite :${s.ports.vite} · dữ liệu ${s.ws}${s.watermark ? ' · gwr của repo' : ''}`)
    } else if (cmd === 'down') {
      const stopped = await down()
      console.log(stopped.length ? `[e2e] đã dừng: ${stopped.join(', ')}` : '[e2e] không có gì đang chạy.')
    } else if (cmd === 'status') {
      console.log(JSON.stringify(status(), null, 2))
    } else {
      console.log('Dùng: node scripts/e2e/isolated.mjs up [--watermark] | down | status')
      process.exitCode = 2
    }
  } catch (e) {
    console.error(`[e2e] LỖI: ${e.message}`)
    process.exitCode = 1
  }
}
