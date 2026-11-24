// Node Ingredients (Muse Canvas): đối chiếu video kết quả với đoạn video mẫu + ô "Bản cũ" không bị làm mờ.
// Electron thật + backend thử. KHÔNG gửi gì lên Flow: hai video kết quả được CẤY thẳng vào dữ liệu node (một "Xong" với dấu
// vân tay khớp hiện tại, một "Bản cũ"); file video do page.route phục vụ từ một mp4 mẫu (ffmpeg) thay cho /api/veo/history.
// Chạy: npm run e2e:up  ->  node scripts/e2e/muse-video-compare.e2e.mjs  ->  npm run e2e:down
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { WS } from './isolated.mjs'
import { API, launchApp, report } from './harness.mjs'

const t = report()
const sample = join(WS, 'sample-6s.mp4')
if (!existsSync(sample)) {
  spawnSync('ffmpeg', ['-y', '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=360x640:rate=24:duration=6',
    '-f', 'lavfi', '-i', 'sine=frequency=440:duration=6', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sample], { stdio: 'inherit' })
}
const mp4 = readFileSync(sample)

/** Phục vụ mp4 mẫu kèm Range (video cần để tua). */
const serveVideo = (route) => {
  const range = /bytes=(\d+)-(\d*)/.exec(route.request().headers().range || '')
  const common = { 'access-control-allow-origin': '*', 'accept-ranges': 'bytes', 'content-type': 'video/mp4' }
  if (!range) return route.fulfill({ status: 200, headers: { ...common, 'content-length': String(mp4.length) }, body: mp4 })
  const start = Number(range[1])
  const end = range[2] ? Math.min(Number(range[2]), mp4.length - 1) : mp4.length - 1
  return route.fulfill({
    status: 206,
    headers: { ...common, 'content-range': `bytes ${start}-${end}/${mp4.length}`, 'content-length': String(end - start + 1) },
    body: mp4.subarray(start, end + 1),
  })
}

const { app, page, canvas, jsErrors, shot } = await launchApp({ name: 'muse-compare' })
try {
  await page.route('**/api/veo/history/*/file', serveVideo)
  await canvas.open()
  await canvas.newProject('E2E đối chiếu')

  // Video tham chiếu -> Ingredients
  await canvas.addNode('Video tham chiếu')
  const vref = page.locator('.react-flow__node-museVideoRef')
  await vref.waitFor()
  await vref.locator('input[type=file]').setInputFiles(sample)
  await page.waitForFunction(() => /6\.0 s · /.test(document.querySelector('.react-flow__node-museVideoRef')?.textContent || ''), null, { timeout: 30000 })
  await canvas.addNode('Ingredients')
  const ingr = page.locator('.react-flow__node-museVideoIngredients')
  await ingr.waitFor()
  await canvas.move(ingr, 460)
  await canvas.fit()
  t.ok('nối Video tham chiếu -> Ingredients',
    await canvas.wire(vref.locator('.react-flow__handle.source'), ingr.locator('.react-flow__handle[data-handleid="refvideo"]')))
  await page.waitForTimeout(800)

  // Cấy 2 video: "Xong" (dấu vân tay = hiện tại, tính bằng chính hàm của app) và "Bản cũ". Đoạn cắt 1–5 s để kiểm tra độ lệch.
  const graph = await canvas.saved()
  const node = graph.nodes.find((n) => n.type === 'museVideoIngredients')
  const refNode = graph.nodes.find((n) => n.type === 'museVideoRef')
  t.ok('đồ thị có node Ingredients + Video tham chiếu đã nối', !!node && !!refNode && graph.edges.length >= 1)
  const data = { ...node.data, trimStart: 1, trimEnd: 5 }
  const fingerprint = await page.evaluate(async ({ d, v }) => {
    const m = await import('/src/features/workflow/services/museCanvasNodes.ts')
    return m.videoIngrFingerprint(m.normalizeVideoIngrData(d), v, [], null)
  }, { d: data, v: refNode.data.video })
  const now = Date.now()
  const done = (stem, fp, index) => ({ status: 'done', jobId: 'job-e2e', fingerprint: fp, attempt: 1, files: [`C:/e2e/${stem}.mp4`], outputIndex: index, startedAt: now, updatedAt: now })
  data.videos = [done('vid-new', fingerprint, 0), done('vid-old', `${fingerprint}|doi`, 1)]
  const idx = await (await fetch(`${API}/api/workflow/muse/projects`)).json()
  const put = await fetch(`${API}/api/workflow/muse/projects/${idx.active_id}/canvas`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...graph, nodes: graph.nodes.map((n) => (n.id === node.id ? { ...n, data } : n)) }),
  })
  t.ok('cấy 2 video vào node', put.ok, String(put.status))
  await page.reload()
  await canvas.open()
  await ingr.waitFor()
  await canvas.fit()

  const tiles = ingr.locator('.mc-vingr-var')
  await tiles.first().waitFor({ timeout: 20000 })
  t.ok('2 ô biến thể', (await tiles.count()) === 2)
  const chips = (await ingr.locator('.mc-vingr-var-chip').allInnerTexts()).map((s) => s.trim())
  t.ok('ô 1 "Xong", ô 2 "Bản cũ"', chips[0] === 'Xong' && chips[1] === 'Bản cũ', chips.join(' | '))

  // 1) Bản cũ KHÔNG bị làm mờ, chỉ có nhãn
  const stale = tiles.nth(1)
  const staleVideo = stale.locator('video')
  await staleVideo.waitFor()
  const opacity = await staleVideo.evaluate((v) => getComputedStyle(v).opacity)
  t.ok('video "Bản cũ" không mờ (opacity 1, không class dim)', opacity === '1' && !(await staleVideo.evaluate((v) => v.classList.contains('dim'))), `opacity=${opacity}`)
  t.ok('ô "Bản cũ" không còn dòng cảnh báo dài', (await stale.locator('.mc-clip-warn').count()) === 0)
  t.ok('chỉ giải thích "Bản cũ" ở tooltip nhãn', /đã đổi so với lúc tạo/.test((await stale.locator('.mc-vingr-var-chip').getAttribute('title')) || ''))
  await shot('muse-compare-before')

  // 2) Đối chiếu
  const toggle = ingr.getByRole('button', { name: /Đối chiếu video mẫu/ })
  t.ok('có nút "Đối chiếu video mẫu"', await toggle.isVisible())
  t.ok('chưa bật: ô "Xong" là một video thường', (await tiles.first().locator('.mc-vcompare').count()) === 0)
  await toggle.click()
  const cmp = tiles.first().locator('.mc-vcompare')
  await cmp.waitFor({ timeout: 10000 })
  t.ok('bật: ô "Xong" hiện 2 video (mẫu + kết quả)', (await cmp.locator('video').count()) === 2)
  const cap = (await cmp.locator('figcaption').allInnerTexts()).map((s) => s.replace(/\s+/g, ' ').trim())
  t.ok('nhãn video mẫu ghi đúng đoạn 1.0–5.0 s', /Video mẫu · 0:01\.0–0:05\.0/.test(cap[0] || ''), cap.join(' | '))
  t.ok('ô "Bản cũ" không đối chiếu (mẫu / đoạn cắt đã đổi): vẫn video thường', (await stale.locator('.mc-vcompare').count()) === 0 && (await stale.locator('video').count()) === 1)
  await shot('muse-compare-on')

  // 3) Phát cùng lúc: video mẫu chạy theo start + t của kết quả
  const times = () => cmp.evaluate((el) => { const [a, b] = el.querySelectorAll('video'); return { ref: a.currentTime, res: b.currentTime, refPaused: a.paused, resPaused: b.paused } })
  await cmp.getByRole('button', { name: /Phát cùng lúc/ }).click()
  await page.waitForTimeout(1500)
  const playing = await times()
  t.ok('phát: cả hai video đang chạy', !playing.refPaused && !playing.resPaused, JSON.stringify(playing))
  t.ok('đồng bộ: giây mẫu ≈ 1 + giây kết quả (lệch < 0,6 s)', Math.abs(playing.ref - (1 + playing.res)) < 0.6 && playing.res > 0.5, JSON.stringify(playing))
  await cmp.getByRole('button', { name: /Dừng/ }).click()
  await page.waitForTimeout(300)
  const paused = await times()
  t.ok('dừng: cả hai cùng dừng', paused.refPaused && paused.resPaused)

  // 4) Tua một lần cho cả hai
  await cmp.locator('.mc-vcompare-seek').evaluate((el) => {
    const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set
    set.call(el, '2'); el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true }))
  })
  await page.waitForTimeout(500)
  const sought = await times()
  t.ok('tua tới giây 2: mẫu = 3 s, kết quả = 2 s', Math.abs(sought.res - 2) < 0.3 && Math.abs(sought.ref - 3) < 0.3, JSON.stringify(sought))

  // 5) Hết đoạn (4 s) thì tự dừng cả hai và tua về đầu
  await cmp.getByRole('button', { name: /Phát cùng lúc/ }).click()
  await page.waitForFunction(() => {
    const el = document.querySelector('.mc-vcompare')
    const [a, b] = el.querySelectorAll('video')
    return a.paused && b.paused && b.currentTime < 0.3
  }, null, { timeout: 15000 })
  t.ok('hết đoạn: tự dừng cả hai và về đầu', true)

  // 6) Tắt đối chiếu: về video thường
  await toggle.click()
  await page.waitForTimeout(400)
  t.ok('tắt: ô "Xong" lại là video thường', (await tiles.first().locator('.mc-vcompare').count()) === 0)
  await shot('muse-compare-off')
} catch (e) {
  t.ok('kịch bản chạy hết', false, String(e).split('\n')[0])
  await shot('muse-compare-error').catch(() => {})
}
t.ok('không có lỗi JS trên trang', jsErrors().length === 0, jsErrors().slice(0, 3).join(' | '))
await app.close()
t.done()
