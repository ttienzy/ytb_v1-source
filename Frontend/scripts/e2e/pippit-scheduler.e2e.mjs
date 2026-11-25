// Real Electron + isolated backend (:8010) for Lên lịch Pippit 2.0.
// Local video upload & preview hit the real isolated backend; Pippit & Gemini HTTP calls are mocked via mockJson.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { launchApp, report, mockJson } from './harness.mjs'

const t = report()
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pippit-e2e-'))
const sample1 = path.join(tmpDir, 'ao_thun_ny_hook1.mp4')
const sample2 = path.join(tmpDir, 'ao_thun_ny_hook2.mp4')
fs.writeFileSync(sample1, Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex'))
fs.writeFileSync(sample2, Buffer.from('00000018667479706d703432000000016d70343269736f6d', 'hex'))

const { app, page, shot, jsErrors } = await launchApp({ name: 'pippit-scheduler' })
try {
  // Mock channels (1 TikTok + 1 Facebook) & disconnected Drive so we prove AI/Local works without Drive.
  await page.route('**/api/gdrive/status', route =>
    mockJson(route, { connected: false, message: 'Chưa kết nối Google Drive' }),
  )
  await page.route('**/api/pippit/active-pages', route =>
    mockJson(route, [
      {
        page_id: 'fb_101',
        page_name: 'Thời Trang Nhà Mây',
        avatar_url: '',
        status: 'connected',
        platform: 'facebook',
        account_id: 'pip_e2e',
        account_email: 'e2e@example.com',
        un_expired: true,
      },
    ]),
  )
  await page.route('**/api/pippit/active-tiktok-channels', route =>
    mockJson(route, [
      {
        channel_id: 'tt_202',
        nickname: 'mayfashion',
        handle: 'mayfashion.vn',
        avatar_url: '',
        status: 'connected',
        platform: 'tiktok',
        account_id: 'pip_e2e',
        account_email: 'e2e@example.com',
        un_expired: true,
      },
    ]),
  )

  let captionReq = null
  await page.route('**/api/pippit/generate-captions', route => {
    captionReq = route.request().postDataJSON()
    return mockJson(route, {
      items: captionReq.items.map((it, idx) => ({
        uid: it.uid,
        title: `Tiêu đề AI #${idx + 1}`,
        caption: `Góc nội dung AI riêng #${idx + 1} cho áo thun NY`,
        hashtags: ['#thoitrangnu', `#goc${idx + 1}`],
        full_text: `Góc nội dung AI riêng #${idx + 1} cho áo thun NY\n\n#thoitrangnu #goc${idx + 1}`,
      })),
      missing: [],
    })
  })

  const bulkPayloads = []
  await page.route('**/api/pippit/bulk-schedule', route => {
    const body = route.request().postDataJSON()
    bulkPayloads.push(body)
    const item = body.items[0]
    return mockJson(route, {
      ok: true,
      total: 1,
      success_count: 1,
      failed_count: 0,
      results: [
        {
          file_name: item.file_name,
          page_id: item.page_id,
          page_name: 'mayfashion',
          platform: item.platform || 'tiktok',
          task_id: `task_${bulkPayloads.length}`,
          asset_id: `asset_${bulkPayloads.length}`,
          schedule_time_ms: item.schedule_time_ms,
          ok: true,
          error: '',
        },
      ],
      message: 'Đã lên lịch thành công 1/1 video!',
    })
  })

  await page.waitForLoadState('domcontentloaded')
  await page.getByText('Lên lịch Pippit', { exact: true }).first().click()
  await page.getByRole('heading', { name: 'Lên lịch Pippit Hàng Loạt' }).waitFor()

  // 1. Verify all 5 source tabs render
  for (const label of ['Chiến dịch AI', 'Thư viện AI', 'Recap & Audio', 'Từ máy', 'Google Drive']) {
    await page.getByRole('tab', { name: new RegExp(`^${label}`) }).waitFor()
  }
  t.ok('hiển thị đủ 5 tab nguồn video (không khóa vào Drive)', true)

  // 2. Upload 2 local MP4 files through real isolated backend
  await page.getByRole('tab', { name: /^Từ máy/ }).click()
  const uploadDone = page.waitForResponse(
    r => r.url().includes('/api/pippit/sources/upload-local') && r.request().method() === 'POST',
  )
  await page.getByTestId('pippit-local-input').setInputFiles([sample1, sample2])
  assert.equal((await uploadDone).status(), 200)
  await page.locator('[data-slot-uid]').nth(1).waitFor()
  t.ok('tải 2 video cục bộ lên backend thật và tự chọn vào dòng thời gian', true)

  // 3. Switch to Drive tab (disconnected) -> friendly message, selections preserved
  await page.getByRole('tab', { name: /^Google Drive/ }).click()
  await page.getByText(/Google Drive chưa kết nối/).waitFor()
  assert.equal(await page.locator('[data-slot-uid]').count(), 2)
  t.ok('Drive chưa kết nối không chặn 4 nguồn khác và không làm mất video đang chọn', true)

  // Switch target channel to TikTok so we test TikTok preview & TikTok options too
  await page.getByText('mayfashion', { exact: true }).click()
  await page.getByText('Thời Trang Nhà Mây', { exact: true }).click()

  // 4. Generate captions with Gemini (mocked)
  await page.getByPlaceholder(/Gợi ý thêm/).fill('Set thun NY form rộng')
  await page.getByRole('button', { name: /AI viết \(2 bài\)/ }).click()
  await page.getByText(/Góc nội dung AI riêng #1/).waitFor()
  await page.getByText(/Góc nội dung AI riêng #2/).waitFor()
  assert.equal(captionReq?.items?.length, 2)
  assert.equal(captionReq?.extra_brief, 'Set thun NY form rộng')
  t.ok('AI viết caption hàng loạt điền caption khác nhau cho từng bài', true)

  // 5. Edit card #1 caption inline + verify TikTok preview with real <video>
  const firstCard = page.locator('[data-slot-uid]').first()
  await firstCard.getByRole('button', { name: 'Sửa caption' }).click()
  await firstCard.locator('textarea').fill('Caption sửa tay E2E #thoitrang')
  await shot('pippit-v2-main')

  await firstCard.getByRole('button', { name: 'Xem trước' }).click()
  await page.getByRole('heading', { name: 'Xem trước bài đăng TikTok' }).waitFor()
  await page.locator('.pub-preview-modal').getByText(/Caption sửa tay E2E/).waitFor()
  const videoSrc = await page.locator('.pub-preview-modal video').getAttribute('src')
  assert.ok(videoSrc && videoSrc.includes('/api/pippit/sources/preview?path='), `unexpected src: ${videoSrc}`)
  await shot('pippit-v2-preview')
  await page.getByRole('button', { name: 'Đóng xem trước' }).click()
  t.ok('xem trước hiển thị khung TikTok, đúng caption vừa sửa và phát <video> thật', true)

  // 6. Submit bulk schedule (mocked Pippit) & assert exact payloads
  await page.getByRole('button', { name: 'Đặt lịch 2 video' }).click()
  await page.getByText('Kết quả lượt đặt lịch: Đã lên lịch 2/2 video qua Pippit.').waitFor()
  assert.equal(bulkPayloads.length, 2)
  const firstSent = bulkPayloads[0].items[0]
  assert.equal(firstSent.source_type, 'local')
  assert.ok(firstSent.file_path && firstSent.file_path.endsWith('.mp4'))
  assert.equal(firstSent.file_id, null)
  assert.equal(firstSent.prepend_title, false)
  assert.equal(firstSent.caption, 'Caption sửa tay E2E #thoitrang')
  assert.equal(firstSent.platform, 'tiktok')
  assert.equal(firstSent.privacy_level, 1)
  t.ok('đặt lịch gửi thẳng file_path cục bộ, đúng caption sửa tay, không nhồi tên file', true)

  assert.deepEqual(jsErrors(), [])
  t.ok('không có lỗi JavaScript', true)
} catch (error) {
  t.ok('kịch bản hoàn tất', false, String(error))
  await shot('pippit-v2-error').catch(() => {})
  throw error
} finally {
  fs.rmSync(tmpDir, { recursive: true, force: true })
  await app.close()
  t.done()
}
