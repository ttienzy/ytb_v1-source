// Hồi quy Gemini kiểu "tài khoản như ChatGPT" trên MÁY CÀI MỚI (dữ liệu trống) — Electron thật + backend thử.
//  - Máy mới: Phân tích Gemini báo "(+) Thêm account Gemini" (không còn "Chưa có inner_template"); chỉ lỗi 401 mới có nút
//    "Làm mới tài khoản Gemini"; lỗi khác (500) thì không.
//  - Cài đặt: thẻ danh sách tài khoản (trạng thái từng account), nút (+) Thêm account, làm mới / đăng nhập lại / xóa.
// Không mở Chrome, không gọi Google: tài khoản được cấy thẳng vào gemini_accounts.json của dữ liệu thử; các nút mở Chrome
// bị page.route chặn để chỉ xác nhận đúng endpoint được gọi. Lỗi 500 của Google được giả lập bằng page.route.
// Chạy: npm run e2e:up  ->  npm run e2e:gemini-fresh-install  ->  npm run e2e:down
import { spawnSync } from 'node:child_process'
import { existsSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { WS } from './isolated.mjs'
import { API, launchApp, mockJson, report } from './harness.mjs'

const t = report()
const ACCOUNTS_FILE = join(WS, 'Backend', 'Data', 'gemini_accounts.json')
const sample = join(WS, 'product-sample.png')
if (!existsSync(sample)) {
  spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x3366cc:s=320x320', '-frames:v', '1', sample],
    { stdio: 'inherit' })
}
const seed = (accounts) => writeFileSync(ACCOUNTS_FILE, JSON.stringify({ accounts }, null, 2), 'utf-8')
const account = (id, email, status, message = '') => ({
  id, email, cookies: `SID=${id}`, ua: 'e2e-ua', partition: `C:/e2e/profiles/${id}`, status, message,
  added_at: 1, last_used: 0, exhausted_at: 0,
})

// Máy mới: chưa có file tài khoản, template đi theo app.
rmSync(ACCOUNTS_FILE, { force: true })
const before = await (await fetch(`${API}/api/settings/gemini`)).json()
t.ok('máy mới: 0 tài khoản, dùng template đóng gói sẵn', before.total_accounts_count === 0 && before.template_source === 'bundled', JSON.stringify(before))

const { app, page, jsErrors, shot } = await launchApp({ name: 'gemini-fresh' })
page.on('dialog', (d) => d.accept().catch(() => {}))
try {
  // 1) Canvas AI: phân tích khi chưa có tài khoản → 401 + hướng dẫn thêm account
  await page.getByText('Canvas AI', { exact: true }).first().click()
  await page.getByText('Kịch Bản Liên Hoàn', { exact: true }).first().click()
  const products = page.locator('.react-flow__node-productAssets').first()
  await products.waitFor({ timeout: 20000 })
  await products.locator('input[type=file]').first().setInputFiles(sample)
  await page.waitForTimeout(1500)

  const gemini = page.locator('.react-flow__node-geminiAnalysis').first()
  const analyze = gemini.getByRole('button', { name: /Phân Tích Với Gemini|Bắt Đầu Phân Tích/ })
  const refreshBtn = gemini.getByRole('button', { name: /Làm mới tài khoản Gemini/ })

  await analyze.click()
  await gemini.getByText(/Chưa có tài khoản Gemini/).waitFor({ timeout: 30000 })
  const err1 = (await gemini.innerText()).replace(/\s+/g, ' ')
  t.ok('chưa có tài khoản: hướng dẫn "(+) Thêm account Gemini"', /\(\+\) Thêm account Gemini/.test(err1), err1.slice(0, 170))
  t.ok('không còn lỗi "Chưa có inner_template"', !/inner_template/.test(err1))
  t.ok('lỗi đăng nhập (401): có nút "Làm mới tài khoản Gemini"', await refreshBtn.isVisible())
  await shot('gemini-fresh-401')

  // 2) Lỗi không phải đăng nhập (Google 5xx, giả lập) → KHÔNG gợi ý làm mới tài khoản
  await page.route('**/api/workflow/gemini/analyze', (route) =>
    mockJson(route, { detail: 'Lỗi phân tích (gemini): Gemini Web API error: HTTP 500 (giả lập e2e)' }, 500))
  await gemini.getByRole('button', { name: /Thử lại ngay/ }).click()
  await gemini.getByText(/giả lập e2e/).waitFor({ timeout: 15000 })
  t.ok('lỗi 500: không có nút "Làm mới tài khoản Gemini"', (await refreshBtn.count()) === 0)
  t.ok('lỗi 500: vẫn có "Thử lại ngay" và "Dùng ChatGPT"',
    (await gemini.getByRole('button', { name: /Thử lại ngay/ }).isVisible()) && (await gemini.getByRole('button', { name: /Dùng ChatGPT/ }).isVisible()))
  await page.unroute('**/api/workflow/gemini/analyze')

  // 3) Cài đặt, chưa có tài khoản
  const openSettings = async () => {
    await page.getByText('Dashboard', { exact: true }).first().click()
    await page.getByText('Cài đặt', { exact: true }).first().click()
    await page.getByText('Gemini & YouTube', { exact: true }).first().click()
    await page.getByTestId('gemini-accounts-card').waitFor({ timeout: 15000 })
  }
  await openSettings()
  const card = page.getByTestId('gemini-accounts-card')
  const addBtn = card.getByRole('button', { name: /\(\+\) Thêm account Gemini/ })
  const tplBtn = card.getByRole('button', { name: /Cập nhật template Gemini/ })
  t.ok('Cài đặt, chưa có tài khoản: có "(+) Thêm account Gemini", ẩn nút template',
    (await addBtn.isVisible()) && (await tplBtn.count()) === 0 && /Chưa có tài khoản Gemini nào/.test(await card.innerText()))

  // 4) Nút (+) gọi đúng endpoint (chặn lại: không mở Chrome thật)
  const hits = []
  await page.route('**/api/settings/gemini/accounts/**', (route) => {
    hits.push(`${route.request().method()} ${new URL(route.request().url()).pathname}`)
    return mockJson(route, { ok: true, account: {} })
  })
  await addBtn.click()
  await page.waitForTimeout(500)
  t.ok('(+) Thêm account → POST /accounts/login', hits.includes('POST /api/settings/gemini/accounts/login'), hits.join(' | '))

  // 5) Có tài khoản: danh sách + trạng thái từng cái
  seed([account('a1', 'an@example.com', 'active'), account('b2', 'binh@example.com', 'error', 'Cookie hết hạn — đăng nhập lại')])
  await openSettings()
  const rows = card.getByTestId('gemini-account-row')
  await rows.first().waitFor({ timeout: 10000 })
  t.ok('2 tài khoản hiện trong danh sách', (await rows.count()) === 2)
  const text = (await card.innerText()).replace(/\s+/g, ' ')
  t.ok('hiện email + trạng thái từng account', /an@example\.com · Sẵn sàng/.test(text) && /binh@example\.com · Hết phiên/.test(text), text.slice(0, 200))
  t.ok('đếm "1/2 Sẵn sàng"', /1\/2 Sẵn sàng/.test(text))
  const title = (await card.getByRole('button', { name: /Cập nhật template Gemini/ }).getAttribute('title')) || ''
  t.ok('có nút template, ghi đang dùng bản đóng gói', /template đóng gói theo app/.test(title), title.slice(0, 80))
  t.ok('cookie không lộ ra trang', !/SID=/.test(await page.content()))
  await shot('gemini-fresh-settings')

  // 6) Làm mới / đăng nhập lại / xóa đúng endpoint theo từng account (làm mới + đăng nhập lại bị chặn: không mở Chrome)
  hits.length = 0
  const errRow = rows.filter({ hasText: 'binh@example.com' })
  await errRow.getByTitle(/Làm mới cookie bằng profile Chrome ấm/).click()
  await page.waitForTimeout(400)
  await errRow.getByTitle(/Đăng nhập lại/).click()
  await page.waitForTimeout(400)
  t.ok('Làm mới → POST /accounts/b2/refresh', hits.includes('POST /api/settings/gemini/accounts/b2/refresh'), hits.join(' | '))
  t.ok('Đăng nhập lại → POST /accounts/login', hits.includes('POST /api/settings/gemini/accounts/login'), hits.join(' | '))
  await page.unroute('**/api/settings/gemini/accounts/**')

  await errRow.getByTitle(/Xóa tài khoản này/).click()
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="gemini-account-row"]').length === 1, null, { timeout: 10000 })
  const left = await (await fetch(`${API}/api/settings/gemini`)).json()
  t.ok('Xóa → backend chỉ còn tài khoản an@example.com', left.total_accounts_count === 1 && left.accounts[0].email === 'an@example.com')
} catch (e) {
  t.ok('kịch bản chạy hết', false, String(e).split('\n')[0])
  await shot('gemini-fresh-error').catch(() => {})
} finally {
  rmSync(ACCOUNTS_FILE, { force: true })
}
t.ok('không có lỗi JS trên trang', jsErrors().length === 0, jsErrors().slice(0, 3).join(' | '))
await app.close()
t.done()
