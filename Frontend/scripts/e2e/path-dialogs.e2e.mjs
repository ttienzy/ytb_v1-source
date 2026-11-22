// Hồi quy: các nút nhập đường dẫn ở trang "Thư viện nhạc" và "Xóa Watermark" mở hộp nhập TRONG APP (trước đây dùng
// window.prompt — Electron không hỗ trợ nên nút bấm như không làm gì). Cần: npm run e2e:up
import { launchApp, report } from './harness.mjs'

const t = report()
const { app, page, jsErrors, shot } = await launchApp({ name: 'path-dialogs' })
const dialog = page.getByRole('dialog')
try {
  await page.waitForLoadState('domcontentloaded')

  // ---- Thư viện nhạc: "Nhập Thư Mục"
  await page.getByText('Thư viện nhạc', { exact: true }).first().click()
  await page.getByRole('button', { name: /Nhập Thư Mục/ }).click()
  await dialog.waitFor({ timeout: 5000 }).catch(() => {})
  t.ok('Thư viện nhạc: bấm "Nhập Thư Mục" mở hộp nhập trong app', await dialog.isVisible())
  t.ok('hộp nhập có tiêu đề + đường dẫn mặc định', /Nhập nhạc từ thư mục/.test(await dialog.innerText()) && /music_no_copyright/.test(await dialog.locator('input').inputValue()))
  await shot('dialog-bgm')
  await dialog.getByRole('button', { name: 'Hủy' }).click()
  t.ok('Hủy đóng hộp, không gửi gì', !(await dialog.isVisible()))

  // ---- Xóa Watermark: "Nhập đường dẫn thư mục..." (tab video) -> thêm vào hàng chờ
  await page.getByText('Xóa Watermark', { exact: true }).first().click()
  await page.getByRole('button', { name: /Nhập đường dẫn thư mục/ }).first().click()
  await dialog.waitFor({ timeout: 5000 }).catch(() => {})
  t.ok('Xóa Watermark: nút nhập đường dẫn mở hộp nhập trong app', await dialog.isVisible())
  const title = await dialog.locator('h3').innerText()
  t.ok('tiêu đề đúng tab đang mở', /Thêm (ảnh|video) theo đường dẫn/.test(title), title)
  await dialog.locator('input').fill('D:\\E2E\\khong-ton-tai\\clip_e2e.mp4')
  await dialog.getByRole('button', { name: 'Thêm' }).click()
  await page.waitForTimeout(400)
  t.ok('xác nhận: đóng hộp và thêm đúng mục vào hàng chờ', !(await dialog.isVisible()) && (await page.getByText('clip_e2e.mp4').count()) > 0)
  await shot('dialog-watermark')
} catch (e) {
  t.ok('kịch bản chạy hết', false, String(e).split('\n')[0])
  await shot('path-dialogs-error').catch(() => {})
}
t.ok('không có lỗi JS trên trang (không còn "prompt() is not supported")', jsErrors().length === 0, jsErrors().slice(0, 3).join(' | '))
await app.close()
t.done()
