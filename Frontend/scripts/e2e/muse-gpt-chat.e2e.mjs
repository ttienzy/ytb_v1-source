// Muse Canvas: thanh chat ChatGPT nổi đáy giữa (ngữ cảnh tạm RAM, xoay vòng / báo lỗi bận, đẩy ra Ô prompt).
// Electron thật + backend thử. Không gửi thật lên ChatGPT: mock /api/workflow/muse/gpt-chat* qua page.route.
// Chạy: npm run e2e:up  ->  node scripts/e2e/muse-gpt-chat.e2e.mjs  ->  npm run e2e:down
import { launchApp, report } from './harness.mjs'

const t = report()
const { app, page, canvas, jsErrors, shot } = await launchApp({ name: 'muse-gpt-chat' })

const posted = []
let callCount = 0
let poolState = { total: 2, free: 2, busy: 0, cooldown: 0, retry_after_seconds: 0, accounts: [] }

try {
  await page.route('**/api/workflow/muse/gpt-chat/status', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(poolState) }),
  )
  await page.route('**/api/workflow/muse/gpt-chat', async (route) => {
    const reqBody = route.request().postDataJSON()
    posted.push(reqBody)
    callCount += 1
    if (callCount === 3) {
      poolState = { total: 1, free: 0, busy: 1, cooldown: 0, retry_after_seconds: 0, accounts: [] }
      return route.fulfill({
        status: 429,
        contentType: 'application/json',
        body: JSON.stringify({
          detail: {
            code: 'all_busy',
            message: 'Tất cả tài khoản ChatGPT (1/1) đang bận chạy ở node khác.',
            pool: poolState,
          },
        }),
      })
    }
    const reply = callCount === 1
      ? 'Hook 1: Váy lụa mềm mượt dưới nắng.'
      : 'Hook 2\nVáy lụa chuẩn studio, quay một lần là mê.'
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        provider: 'gpt',
        reply,
        account_label: callCount === 1 ? 'a@x' : 'b@x',
        duration_seconds: 1.2,
        pool: poolState,
      }),
    })
  })

  await canvas.open()
  await canvas.newProject('E2E GPT chat')

  const bar = page.locator('.mc-gptbar')
  await bar.waitFor()
  const barBox = await bar.boundingBox()
  const miniBox = await page.locator('.react-flow__minimap').boundingBox()
  const ctrlBox = await page.locator('.react-flow__controls').boundingBox()
  const noOverlap = (a, b) => !a || !b || a.x + a.width <= b.x + 2 || b.x + b.width <= a.x + 2 || a.y + a.height <= b.y + 2 || b.y + b.height <= a.y + 2
  t.ok('thanh chat nằm đáy giữa, không đè MiniMap & Controls',
    Boolean(barBox) && noOverlap(barBox, miniBox) && noOverlap(barBox, ctrlBox),
    JSON.stringify({ bar: barBox, mini: miniBox, ctrl: ctrlBox }))

  t.ok('hiện đúng trạng thái pool ban đầu (GPT · 2/2 rảnh)',
    /GPT · 2\/2 rảnh/.test(await bar.locator('.mc-gptbar-pool').innerText()))

  // Lượt 1
  const input = bar.locator('.mc-gptbar-input')
  await input.fill('Viết hook 3 giây về váy lụa')
  await input.press('Enter')
  const reply1 = bar.locator('.mc-gptbar-msg.is-assistant:not(.is-pending)').first()
  await reply1.waitFor()
  t.ok('lượt 1 mở khung hội thoại và hiện câu trả lời',
    (await reply1.innerText()).includes('Hook 1: Váy lụa'))

  // Lượt 2: phải gửi kèm history từ lượt 1 (xoay sang acc b@x)
  await input.fill('Làm gắt hơn nữa')
  await input.press('Enter')
  await page.waitForFunction(() => document.querySelectorAll('.mc-gptbar-msg.is-assistant:not(.is-pending)').length === 2)
  const h2 = posted[1]?.history || []
  t.ok('lượt 2 gửi kèm ngữ cảnh hội thoại tạm của lượt 1',
    h2.length === 2 && h2[0].content.includes('Viết hook 3 giây') && h2[1].content.includes('Hook 1'),
    JSON.stringify(h2))

  // Đẩy câu trả lời 2 thành node Ô prompt
  await bar.locator('.mc-gptbar-msg.is-assistant').nth(1).getByRole('button', { name: /Ra Ô prompt/ }).click()
  const pbox = page.locator('.react-flow__node-musePromptBox')
  await pbox.waitFor()
  t.ok('bấm Ra Ô prompt tạo node mới chứa đúng nội dung trả lời',
    (await pbox.count()) === 1 && (await pbox.locator('textarea').inputValue()).includes('Hook 2'))

  await shot('muse-gpt-chat')

  // Lượt 3: giả lập 429 all_busy -> báo lỗi rõ ràng, giữ nguyên nháp, cập nhật badge
  await input.fill('Thử khi máy bận')
  await input.press('Enter')
  await bar.locator('.mc-gptbar-err').waitFor()
  t.ok('khi tất cả acc bận: báo lỗi rõ ràng, cập nhật badge & giữ nguyên nháp',
    /đang bận/.test(await bar.locator('.mc-gptbar-err').innerText()) &&
    /0\/1 rảnh/.test(await bar.locator('.mc-gptbar-pool').innerText()) &&
    (await input.inputValue()) === 'Thử khi máy bận')

  // Tải lại trang -> ngữ cảnh tạm trong RAM phải tự reset sạch
  await page.reload()
  await canvas.open()
  await bar.waitFor()
  t.ok('tải lại trang: lịch sử chat tạm tự reset về 0', (await page.locator('.mc-gptbar-msg').count()) === 0)
} catch (e) {
  t.ok('kịch bản chạy hết', false, String(e).split('\n')[0])
  await shot('muse-gpt-chat-error').catch(() => {})
}
t.ok('không có lỗi JS trên trang', jsErrors().length === 0, jsErrors().slice(0, 3).join(' | '))
await app.close()
t.done()
