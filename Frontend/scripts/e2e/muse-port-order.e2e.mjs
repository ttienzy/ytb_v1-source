// Muse Canvas: cổng vào dồn cạnh trái xếp Text → Image → Video, cổng + dây có icon màu theo loại nội dung.
// Electron thật + backend thử. Không gửi gì lên Flow / Muse / ChatGPT.
// Chạy: npm run e2e:up  ->  node scripts/e2e/muse-port-order.e2e.mjs  ->  npm run e2e:down
import { launchApp, report } from './harness.mjs'

const t = report()
const { app, page, canvas, jsErrors, shot } = await launchApp({ name: 'muse-port-order' })
try {
  await canvas.open()
  await canvas.newProject('E2E thứ tự cổng')

  const prompt = page.locator('.react-flow__node-musePromptBox')
  const character = page.locator('.react-flow__node-museCharacterImage')
  const vref = page.locator('.react-flow__node-museVideoRef')
  const ingr = page.locator('.react-flow__node-museVideoIngredients')
  // mỗi node thêm xong được kéo ra chỗ riêng, để không node nào che cổng của node khác
  await canvas.addNode('Ô prompt')
  await prompt.waitFor()
  await canvas.move(prompt, -420, -160)
  await canvas.addNode('Nhân vật tham chiếu')
  await character.waitFor()
  await canvas.move(character, -420, 330)
  await canvas.addNode('Video tham chiếu')
  await vref.waitFor()
  await canvas.move(vref, -420, 700)
  await canvas.addNode('Tạo video Flow')
  await ingr.waitFor()
  await canvas.move(ingr, 700)
  await canvas.fit()

  const handle = (id) => ingr.locator(`.react-flow__handle[data-handleid="${id}"]`)
  t.ok('nối Ô prompt -> cổng Prompt', await canvas.wire(prompt.locator('.react-flow__handle[data-handleid="prompt"]'), handle('prompt-in')))
  t.ok('nối Nhân vật -> cổng Tham chiếu', await canvas.wire(character.locator('.react-flow__handle.source'), handle('boards')))
  t.ok('nối Video tham chiếu -> cổng Video mẫu', await canvas.wire(vref.locator('.react-flow__handle.source'), handle('refvideo')))
  await page.waitForTimeout(600)

  const box = async (loc) => loc.boundingBox()
  const node = await box(ingr)
  const text = await box(handle('prompt-in'))
  const image = await box(handle('boards'))
  const video = await box(handle('refvideo'))
  const centerX = (b) => b.x + b.width / 2
  t.ok('mọi cổng vào ở cạnh trái node',
    [text, image, video].every((b) => Math.abs(centerX(b) - node.x) < 4), JSON.stringify({ node: node.x, text: centerX(text), image: centerX(image), video: centerX(video) }))
  t.ok('thứ tự từ trên xuống: Text → Image → Video', text.y < image.y && image.y < video.y, JSON.stringify({ text: text.y, image: image.y, video: video.y }))
  t.ok('mỗi cổng vào có đúng 1 loại (Text / Image / Video)',
    (await handle('prompt-in').getAttribute('data-media')) === 'Text' && (await handle('boards').getAttribute('data-media')) === 'Image' && (await handle('refvideo').getAttribute('data-media')) === 'Video')

  const kinds = (await page.locator('.mc-edge-kind').evaluateAll((els) => els.map((e) => e.getAttribute('data-media')))).sort()
  t.ok('mỗi dây có icon loại nội dung: Image, Text, Video', kinds.join(',') === 'Image,Text,Video', kinds.join(','))
  const colors = await page.locator('.mc-edge-kind').evaluateAll((els) => els.map((e) => getComputedStyle(e).color))
  t.ok('icon trên dây có 3 màu khác nhau', new Set(colors).size === 3, colors.join(' | '))
  const portColor = await handle('refvideo').evaluate((e) => getComputedStyle(e).color)
  t.ok('cổng vào Video có màu video, không còn xám', portColor !== 'rgb(69, 69, 69)', portColor)
  await shot('muse-port-order')
  // phóng to quanh node nhận để xem rõ icon / cổng
  for (let i = 0; i < 3; i++) await page.locator('.react-flow__controls-zoomin').click()
  const bb = await box(ingr)
  await page.mouse.move(700, 250)
  await page.mouse.down()
  await page.mouse.move(700 + (620 - bb.x), 250 + (230 - bb.y), { steps: 10 })
  await page.mouse.up()
  await page.waitForTimeout(500)
  await shot('muse-port-order-zoom')
} catch (e) {
  t.ok('kịch bản chạy hết', false, String(e).split('\n')[0])
  await shot('muse-port-order-error').catch(() => {})
}
t.ok('không có lỗi JS trên trang', jsErrors().length === 0, jsErrors().slice(0, 3).join(' | '))
await app.close()
t.done()
