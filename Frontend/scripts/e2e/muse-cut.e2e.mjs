// Kịch bản e2e mẫu (và hồi quy cho node Cắt video): Video tham chiếu -> Cắt video -> tách / xóa khúc -> Cắt & lưu (ffmpeg thật).
// Cần môi trường thử: npm run e2e:up  ->  npm run e2e:muse-cut  ->  npm run e2e:down
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WS } from './isolated.mjs'
import { launchApp, report } from './harness.mjs'

const t = report()
const sample = join(WS, 'sample-6s.mp4')
if (!existsSync(sample)) {
  spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sample], { stdio: 'inherit' })
}

const { app, page, canvas, jsErrors, shot } = await launchApp({ name: 'muse-cut' })
try {
  await canvas.open()
  await canvas.newProject('E2E cắt video')
  await canvas.addNode('Video tham chiếu')
  const vref = page.locator('.react-flow__node-museVideoRef')
  await vref.waitFor()
  await vref.locator('input[type=file]').setInputFiles(sample)
  await page.waitForFunction(() => /6\.0 s · /.test(document.querySelector('.react-flow__node-museVideoRef')?.textContent || ''), null, { timeout: 30000 })

  await canvas.addNode('Cắt video')
  const vcut = page.locator('.react-flow__node-museVideoCut')
  await vcut.waitFor()
  await canvas.move(vcut, 420)
  await canvas.fit()
  t.ok('nối Video tham chiếu -> Cắt video', await canvas.wire(vref.locator('.react-flow__handle.source'), vcut.locator('.react-flow__handle.target')))
  await page.waitForFunction(() => /giữ 1 đoạn/.test(document.querySelector('.mc-vcut-summary')?.textContent || ''), null, { timeout: 15000 })
  await canvas.fit()

  const track = vcut.locator('.mc-vcut-track')
  const clickAt = async (f) => {
    const b = await track.boundingBox()
    await page.mouse.click(b.x + b.width * f, b.y + b.height / 2)
    await page.waitForTimeout(150)
  }
  await clickAt(0.3)
  await page.keyboard.press('s')
  await clickAt(0.6)
  await page.keyboard.press('s')
  await clickAt(0.45)
  await page.keyboard.press('Delete')
  const summary = (await vcut.locator('.mc-vcut-summary').innerText()).replace(/\s+/g, ' ')
  t.ok('tách 2 lần + xóa khúc giữa: giữ 2 đoạn', /giữ 2 đoạn/.test(summary), summary)
  t.ok('Delete chỉ xóa đoạn, không xóa node', (await vcut.count()) === 1)

  await vcut.locator('button.mc-clipvideo-run').click()
  await vcut.locator('.mc-vcut-out video').waitFor({ timeout: 90000 })
  const dur = await vcut.locator('.mc-vcut-out video').evaluate((v) =>
    new Promise((res) => (v.readyState >= 1 ? res(v.duration) : v.addEventListener('loadedmetadata', () => res(v.duration), { once: true }))))
  t.ok('video đã cắt dài khoảng 6 × 0,7 giây', Math.abs(dur - 4.2) < 0.5, `${dur.toFixed(2)}s`)
  t.ok('node đánh dấu Hoàn chỉnh', /Hoàn chỉnh/.test(await vcut.locator('.mc-node-head').innerText()))
  const g = await canvas.saved()
  const data = g.nodes.find((n) => n.type === 'museVideoCut')?.data
  t.ok('lưu vào project: video đã cắt + vết cắt', /cut_[0-9a-f]{12}\.mp4$/.test(data?.video?.path || '') && data?.pieces?.length === 3, data?.video?.path?.split(/[\\/]/).pop())
  await shot('muse-cut')
} catch (e) {
  t.ok('kịch bản chạy hết', false, String(e).split('\n')[0])
  await shot('muse-cut-error').catch(() => {})
}
t.ok('không có lỗi JS trên trang', jsErrors().length === 0, jsErrors().slice(0, 3).join(' | '))
await app.close()
t.done()
