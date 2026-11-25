// E2E: Motion Control 3–15s + Muse Canvas Pha 1 (Flow 3–15s chips & per-node, Tách khung hình 0 credit ffmpeg thật, Tạo ảnh tự do, Khung đầu–cuối).
// Chạy: npm run e2e:up  ->  node scripts/e2e/muse-phase1-flow315.e2e.mjs  ->  npm run e2e:down
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { WS } from './isolated.mjs'
import { launchApp, mockJson, report } from './harness.mjs'

const t = report()
const sample = join(WS, 'sample-frame-4s.mp4')
if (!existsSync(sample)) {
  spawnSync(
    'ffmpeg',
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=24:duration=4',
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sample,
    ],
    { stdio: 'inherit' },
  )
}

const { app, page, canvas, jsErrors, shot } = await launchApp({ name: 'muse-phase1-flow315' })

let lastExtractedPreviewUrl = ''

try {
  // 1) Tab Motion Control: mở khóa 3–15s, credit động và giới hạn trim 15s trong Inspector
  await page.waitForLoadState('domcontentloaded')
  await page.getByText('Canvas AI', { exact: true }).first().click()
  await page.getByText('Motion Control', { exact: true }).first().click()
  await page.locator('.mf-out-node button[title="Tùy chỉnh định dạng xuất"]').click()
  const insp = page.locator('.mf-inspector-drawer')
  await insp.waitFor()
  const btn15 = insp.getByRole('button', { name: '15s', exact: true })
  await btn15.waitFor()
  await btn15.click()
  const outText15 = await page.locator('.mf-out-node').innerText()
  const inspText15 = await insp.innerText()
  t.ok(
    'Motion Control: chọn 15s cập nhật node và Inspector sang 15s + 60 credits',
    outText15.includes('15s') && outText15.includes('60 credits') && inspText15.includes('60 credits'),
    `out="${outText15.replace(/\s+/g, ' ')}"`,
  )
  await shot('motion-3-15s')

  await insp.getByRole('button', { name: '6s', exact: true }).click()
  const outText6 = await page.locator('.mf-out-node').innerText()
  t.ok(
    'Motion Control: chọn 6s cập nhật sang 6s + 18 credits',
    outText6.includes('6s') && outText6.includes('18 credits'),
    `out="${outText6.replace(/\s+/g, ' ')}"`,
  )

  await btn15.click()
  // Kiểm tra mục Nguyên liệu -> Video Chuyển Động trong Inspector: trimEndSec = 15 & copy tối đa 15 giây
  await page.locator('.mf-hero-slot').click()
  const refInspText = await insp.innerText()
  const trimEndVal = await insp.locator('input[type="number"]').nth(1).inputValue()
  t.ok(
    'Motion Control: Inspector Video Chuyển Động hiển thị trimEnd=15 và hướng dẫn tối đa 15 giây',
    trimEndVal === '15' && refInspText.includes('3 đến tối đa 15 giây') && !refInspText.includes('tối đa 10 giây'),
    `trimEnd=${trimEndVal}`,
  )
  await insp.getByRole('button', { name: 'Đóng Inspector' }).click().catch(() => {})

  // 2) Tab Muse Canvas
  await canvas.open()
  await canvas.newProject('E2E Phase 1')

  // Panel Google Flow: chọn nhanh 3–15s + đồng bộ dropdown + bền vững sau reload
  const chips = page.locator('.mc-flow-sec-chips button')
  t.ok('panel Flow có 8 nút chọn nhanh 3–15s', (await chips.count()) === 8, `count=${await chips.count()}`)
  await page.locator('.mc-flow-sec-chips button', { hasText: '8s' }).click()
  const selVal = await page.locator('.mc-panel .mc-seconds-select').inputValue()
  t.ok('bấm chip 8s cập nhật dropdown thời lượng sang 8', selVal === '8', selVal)

  // Menu + Thêm node đã tinh giản
  await page.getByRole('button', { name: /Thêm node/ }).click()
  const menuText = await page.locator('.mc-addmenu').innerText()
  t.ok(
    'menu Thêm node có node mới và ẩn 2 nút Mẫu thừa',
    menuText.includes('Tạo ảnh tự do') &&
      menuText.includes('Tách khung hình') &&
      menuText.includes('Tạo video Flow') &&
      !/Mẫu:\s*(Trang phục|Nhân vật)/.test(menuText),
  )
  await shot('muse-add-menu')
  await page.getByRole('button', { name: /Thêm node/ }).click()

  // Video tham chiếu -> Tách khung hình (ffmpeg thật trên backend :8010)
  await canvas.addNode('Video tham chiếu')
  const vref = page.locator('.react-flow__node-museVideoRef')
  await vref.waitFor()
  await vref.locator('input[type=file]').setInputFiles(sample)
  await page.waitForFunction(() => /4\.0 s · /.test(document.querySelector('.react-flow__node-museVideoRef')?.textContent || ''), null, { timeout: 30000 })

  await canvas.addNode('Tách khung hình')
  const frameNode = page.locator('.react-flow__node-museFrameExtract')
  await frameNode.waitFor()
  await canvas.move(frameNode, 340, 0)
  await canvas.fit()
  t.ok(
    'nối Video tham chiếu -> Tách khung hình',
    await canvas.wire(vref.locator('.react-flow__handle.source'), frameNode.locator('.react-flow__handle.target')),
  )
  await frameNode.getByRole('button', { name: 'Khung cuối' }).click()
  const [frameRes] = await Promise.all([
    page.waitForResponse((r) => r.url().includes('/api/workflow/muse/extract-frame') && r.request().method() === 'POST'),
    frameNode.getByRole('button', { name: /Tách khung hình/ }).click(),
  ])
  const frameJson = await frameRes.json()
  lastExtractedPreviewUrl = frameJson.preview_url || ''
  await frameNode.locator('.mc-frame-out img').waitFor({ timeout: 20000 })
  const imgNaturalW = await frameNode.locator('.mc-frame-out img').evaluate((im) => im.complete && im.naturalWidth > 0)
  t.ok('Tách khung hình ffmpeg thật ra PNG hợp lệ (0 credit)', frameRes.status() === 200 && imgNaturalW, `${frameJson.width}x${frameJson.height}`)

  // Tạo video Flow (trước là Ingredients): chọn Khung đầu–cuối & thời lượng tại node, nối từ Tách khung hình
  await canvas.addNode('Tạo video Flow')
  const flowNode = page.locator('.react-flow__node-museVideoIngredients')
  await flowNode.waitFor()
  await canvas.move(flowNode, 720, -40)
  await canvas.fit()
  t.ok(
    'nối Tách khung hình -> Tạo video Flow',
    await canvas.wire(frameNode.locator('.react-flow__handle.source'), flowNode.locator('.react-flow__handle.target[data-handleid="boards"]')),
  )
  await flowNode.getByRole('button', { name: /Khung đầu–cuối/ }).click()
  await flowNode.getByRole('button', { name: '6s', exact: true }).click()
  t.ok(
    'chế độ Khung đầu–cuối yêu cầu đủ 2 ảnh và hiển thị slot #1 · Đầu',
    /đúng 2 ảnh/.test(await flowNode.innerText()) && /#1\s*·\s*Đầu/.test(await flowNode.innerText()),
  )
  await flowNode.getByRole('button', { name: /Thành phần \/ Tự do/ }).click()
  await flowNode.locator('select[aria-label="Thời lượng tạo video tại node"]').selectOption('13')
  t.ok('chọn thời lượng 13s tại node cập nhật header sang 13s', /13s/.test(await flowNode.locator('.mc-node-titles small').innerText()))

  // Tạo ảnh tự do (mock GPT image trả ảnh vừa tách để tránh tốn lượt GPT khi chạy E2E)
  await page.route('**/api/workflow/muse/gpt-image', (route) =>
    mockJson(route, {
      ok: true,
      provider: 'gpt',
      local_path: frameJson.file_path,
      preview_url: lastExtractedPreviewUrl,
      file_size: frameJson.file_size,
      duration_seconds: 0.2,
    }),
  )
  await canvas.addNode('Tạo ảnh tự do')
  const freeNode = page.locator('.react-flow__node-museFreeImage')
  await freeNode.waitFor()
  await canvas.move(freeNode, 340, 420)
  await canvas.fit()
  await freeNode.getByRole('radio', { name: 'GPT' }).click()
  await freeNode.getByRole('button', { name: '1:1' }).click()
  await freeNode.locator('textarea.mc-prompt').fill('Model posing with studio light')
  await freeNode.getByRole('button', { name: /Tạo ảnh · 1 lượt GPT/ }).click()
  await freeNode.locator('.mc-freeimg-out img').waitFor({ timeout: 15000 })
  t.ok('Tạo ảnh tự do (GPT) hiển thị ảnh kết quả', /Xong · GPT/.test(await freeNode.locator('.mc-freeimg-out').innerText()))

  await canvas.fit()
  await shot('muse-phase1-canvas')

  // Reload kiểm tra lưu bền vững flowSeconds=8 và node mới
  await canvas.saved()
  await page.reload()
  await canvas.open()
  const reloadedVal = await page.locator('.mc-panel .mc-seconds-select').inputValue()
  t.ok(
    'tải lại app giữ nguyên flowSeconds=8 và các node mới',
    reloadedVal === '8' &&
      (await page.locator('.react-flow__node-museFrameExtract').count()) === 1 &&
      (await page.locator('.react-flow__node-museFreeImage').count()) === 1,
    `flowSeconds=${reloadedVal}`,
  )
} catch (e) {
  t.ok('kịch bản chạy hết', false, String(e).split('\n')[0])
  await shot('muse-phase1-error').catch(() => {})
}

t.ok('không có lỗi JS trên trang', jsErrors().length === 0, jsErrors().slice(0, 3).join(' | '))
await app.close()
t.done()
