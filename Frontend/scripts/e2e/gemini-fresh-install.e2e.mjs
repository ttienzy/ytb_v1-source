// Hồi quy "máy cài mới" cho Gemini (2026-11-24): môi trường thử bắt đầu với dữ liệu TRỐNG giống máy vừa cài app.
//  - Trước: Phân tích Gemini báo "Chưa có inner_template — chạy app.ai.gemini.capture trước" và node gợi ý "Làm mới Cookie"
//    cho mọi lỗi (làm mãi không hết). Nay: app mang sẵn template; chưa đăng nhập → 401 + hướng dẫn; chỉ lỗi 401 mới có nút
//    làm mới cookie. Cài đặt có nút "Cập nhật template Gemini" khi đã có cookie.
// Không mở Chrome, không gọi Google: chưa có cookie thì backend dừng trước mọi request; lỗi 500 được giả lập bằng page.route.
// Chạy: npm run e2e:up  ->  npm run e2e:gemini-fresh-install  ->  npm run e2e:down
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WS } from './isolated.mjs'
import { API, launchApp, mockJson, report } from './harness.mjs'

const t = report()
const sample = join(WS, 'product-sample.png')
if (!existsSync(sample)) {
  spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'color=c=0x3366cc:s=320x320', '-frames:v', '1', sample],
    { stdio: 'inherit' })
}

// Dữ liệu trống: chưa có cookie Gemini, template đi theo app.
await fetch(`${API}/api/settings/gemini`, { method: 'DELETE' })
const before = await (await fetch(`${API}/api/settings/gemini`)).json()
t.ok('máy mới: dùng template đóng gói sẵn', before.template_source === 'bundled' && !before.has_cookie, JSON.stringify(before))

const { app, page, jsErrors, shot } = await launchApp({ name: 'gemini-fresh' })
try {
  await page.getByText('Canvas AI', { exact: true }).first().click()
  await page.getByText('Kịch Bản Liên Hoàn', { exact: true }).first().click()
  const products = page.locator('.react-flow__node-productAssets').first()
  await products.waitFor({ timeout: 20000 })
  await products.locator('input[type=file]').first().setInputFiles(sample)
  await page.waitForTimeout(1500)

  const gemini = page.locator('.react-flow__node-geminiAnalysis').first()
  const analyze = gemini.getByRole('button', { name: /Phân Tích Với Gemini|Bắt Đầu Phân Tích/ })
  const cookieBtn = gemini.getByRole('button', { name: /Làm mới Cookie/ })

  // 1) Backend thật, chưa đăng nhập → 401 + hướng dẫn, có nút làm mới cookie, KHÔNG còn lỗi template.
  await analyze.click()
  await gemini.getByText(/Chưa đăng nhập Gemini/).waitFor({ timeout: 30000 })
  const err1 = (await gemini.innerText()).replace(/\s+/g, ' ')
  t.ok('chưa đăng nhập: báo hướng dẫn vào Cài đặt', /Cài đặt → Gemini & YouTube/.test(err1), err1.slice(0, 160))
  t.ok('không còn lỗi "Chưa có inner_template"', !/inner_template/.test(err1))
  t.ok('lỗi đăng nhập (401): có nút "Làm mới Cookie"', await cookieBtn.isVisible())
  await shot('gemini-fresh-401')

  // 2) Lỗi không phải đăng nhập (Google 5xx, giả lập) → KHÔNG gợi ý làm mới cookie.
  await page.route('**/api/workflow/gemini/analyze', (route) =>
    mockJson(route, { detail: 'Lỗi phân tích (gemini): Gemini Web API error: HTTP 500 (giả lập e2e)' }, 500))
  await gemini.getByRole('button', { name: /Thử lại ngay/ }).click()
  await gemini.getByText(/giả lập e2e/).waitFor({ timeout: 15000 })
  t.ok('lỗi 500: không có nút "Làm mới Cookie"', (await cookieBtn.count()) === 0)
  t.ok('lỗi 500: vẫn có "Thử lại ngay" và "Dùng ChatGPT"',
    (await gemini.getByRole('button', { name: /Thử lại ngay/ }).isVisible()) && (await gemini.getByRole('button', { name: /Dùng ChatGPT/ }).isVisible()))
  await page.unroute('**/api/workflow/gemini/analyze')
  await shot('gemini-fresh-500')

  // 3) Cài đặt: chưa có cookie → không có nút template; có cookie → hiện "Cập nhật template Gemini" (không bấm: mở Chrome).
  await page.getByText('Cài đặt', { exact: true }).first().click()
  await page.getByText('Gemini & YouTube', { exact: true }).first().click()
  await page.getByRole('button', { name: /Đăng nhập Gemini \(Chrome\)/ }).waitFor({ timeout: 15000 })
  const tplBtn = page.getByRole('button', { name: /Cập nhật template Gemini/ })
  t.ok('Cài đặt, chưa có cookie: ẩn nút template', (await tplBtn.count()) === 0)

  await fetch(`${API}/api/settings/gemini`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cookies: 'SID=e2e-fake; __Secure-1PSID=e2e-fake', client_context_token: '', app_url: 'https://gemini.google.com/app' }),
  })
  await page.getByText('Canvas AI', { exact: true }).first().click()
  await page.getByText('Cài đặt', { exact: true }).first().click()
  await page.getByText('Gemini & YouTube', { exact: true }).first().click()
  await tplBtn.waitFor({ timeout: 15000 })
  const title = (await tplBtn.getAttribute('title')) || ''
  t.ok('Cài đặt, có cookie: hiện "Cập nhật template Gemini", ghi đang dùng bản đóng gói', /template đóng gói theo app/.test(title), title.slice(0, 90))
  await shot('gemini-fresh-settings')
} catch (e) {
  t.ok('kịch bản chạy hết', false, String(e).split('\n')[0])
  await shot('gemini-fresh-error').catch(() => {})
} finally {
  await fetch(`${API}/api/settings/gemini`, { method: 'DELETE' }).catch(() => {})
}
t.ok('không có lỗi JS trên trang', jsErrors().length === 0, jsErrors().slice(0, 3).join(' | '))
await app.close()
t.done()
