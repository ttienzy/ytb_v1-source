// Helper cho kịch bản e2e Electron chạy trên môi trường tách riêng (scripts/e2e/isolated.mjs phải "up" trước).
//
//   import { launchApp, report } from './harness.mjs'
//   const t = report()
//   const { app, page, canvas } = await launchApp()
//   await canvas.open(); await canvas.newProject('Thử X'); await canvas.addNode('Cắt video')
//   t.ok('mô tả', điều_kiện, 'chi tiết')
//   await app.close(); t.done()          // in PASS/FAIL, exit code 1 nếu có FAIL
import { createRequire } from 'node:module'
import { mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { FRONT, PORTS, WS, readState } from './isolated.mjs'

const require = createRequire(import.meta.url)
const { _electron: electron } = require(join(FRONT, 'watermark-runtime', 'node_modules', 'playwright'))

export const API = `http://127.0.0.1:${PORTS.backend}`
export const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }

/** Trả JSON cho page.route (giả lập API — vd. Flow — để không gửi gì thật). OPTIONS (preflight) được trả 204. */
export function mockJson(route, body, status = 200) {
  if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS })
  return route.fulfill({ status, headers: { ...CORS, 'content-type': 'application/json' }, body: JSON.stringify(body) })
}

/** Ghi kết quả từng bước; done() in bảng và đặt exit code. */
export function report() {
  const rows = []
  return {
    ok(name, cond, extra = '') {
      rows.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? ` — ${extra}` : ''}`)
      if (!cond) process.exitCode = 1
      return !!cond
    },
    done() {
      console.log(rows.join('\n'))
      const failed = rows.filter((r) => r.startsWith('FAIL')).length
      console.log(`\n${rows.length - failed}/${rows.length} PASS`)
    },
  }
}

/** Mở Electron thật trỏ vào Vite + backend thử; kiểm tra userData đúng thư mục riêng (không bao giờ dùng hồ sơ thật). */
export async function launchApp({ name = 'default', viewport = { width: 1500, height: 1000 } } = {}) {
  if (!readState()) throw new Error('Môi trường thử chưa dựng — chạy "npm run e2e:up" trước.')
  const userData = join(WS, `electron-userdata-${name}`)
  rmSync(userData, { recursive: true, force: true })
  mkdirSync(userData, { recursive: true })
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ELECTRON_RUN_AS_NODE'))
  const app = await electron.launch({
    executablePath: join(FRONT, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: ['.', `--user-data-dir=${userData}`],
    cwd: FRONT,
    env: { ...env, BACKEND_PORT: String(PORTS.backend), ELECTRON_RENDERER_URL: `http://localhost:${PORTS.vite}` },
  })
  const actual = await app.evaluate(({ app: a }) => a.getPath('userData'))
  if (resolve(actual).toLowerCase() !== resolve(userData).toLowerCase()) {
    await app.close()
    throw new Error(`DỪNG: Electron dùng userData ${actual}, không phải thư mục thử.`)
  }
  const page = await app.firstWindow()
  await page.setViewportSize(viewport).catch(() => {})
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()))
  return {
    app,
    page,
    canvas: museCanvas(page),
    /** Lỗi JS trên trang (bỏ lỗi mạng / cảnh báo bảo mật dev). */
    jsErrors: () => errors.filter((e) => !/favicon|ERR_CONNECTION_REFUSED|Failed to load resource|Electron Security Warning|net::ERR/i.test(e)),
    shot: (file) => page.screenshot({ path: join(WS, `${file}.png`) }),
  }
}

/** Thao tác Muse Canvas dùng chung. */
export function museCanvas(page) {
  const fit = async () => {
    await page.locator('.react-flow__controls-fitview').click()
    await page.waitForTimeout(600)
  }
  const handleOnTop = (b) =>
    page.evaluate(([x, y]) => !!document.elementFromPoint(x, y)?.classList.contains('react-flow__handle'), [b.x + b.width / 2, b.y + b.height / 2])
  return {
    fit,
    async open() {
      await page.waitForLoadState('domcontentloaded')
      await page.getByText('Canvas AI', { exact: true }).first().click()
      await page.getByText('Muse Canvas', { exact: true }).first().click()
      await page.waitForFunction(() => document.querySelector('.mc-project-bar'), null, { timeout: 20000 })
    },
    /** Project trống mới: chỉ có node của kịch bản -> fit view phóng đủ to để bấm chính xác. */
    async newProject(title) {
      await page.locator('.mc-project-bar button').first().click()
      await page.getByRole('menuitem', { name: /Project mới/ }).click()
      await page.getByRole('dialog').locator('input').fill(title)
      await page.getByRole('dialog').getByRole('button', { name: /^(OK|Tạo)/ }).click()
      await page.waitForFunction((t) => (document.querySelector('.mc-project-bar')?.textContent || '').includes(t), title, { timeout: 15000 })
    },
    async addNode(menuLabel) {
      await page.getByRole('button', { name: /Thêm node/ }).click()
      await page.locator('.mc-addmenu button', { hasText: menuLabel }).click()
    },
    /** Kéo node (theo tiêu đề) sang ngang dx, dọc dy px. */
    async move(node, dx, dy = 0) {
      const hb = await node.locator('.mc-node-titles').boundingBox()
      await page.mouse.move(hb.x + 20, hb.y + 8)
      await page.mouse.down()
      await page.mouse.move(hb.x + 20 + dx, hb.y + 8 + dy, { steps: 12 })
      await page.mouse.up()
    },
    /** Kéo dây từ cổng nguồn tới cổng đích; false nếu cổng nguồn bị node khác che. */
    async wire(src, dst) {
      const hb = await src.boundingBox()
      if (!hb || !(await handleOnTop(hb))) return false
      const port = await dst.boundingBox()
      await page.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2)
      await page.mouse.down()
      await page.mouse.move(port.x + port.width / 2, port.y + port.height / 2, { steps: 15 })
      await page.mouse.up()
      await page.waitForTimeout(500)
      return true
    },
    /** Đồ thị đã lưu của project đang mở (chờ qua nhịp lưu tự động). */
    async saved() {
      await page.waitForTimeout(1600)
      const idx = await (await fetch(`${API}/api/workflow/muse/projects`)).json()
      return (await fetch(`${API}/api/workflow/muse/projects/${idx.active_id}/canvas`)).json()
    },
  }
}
