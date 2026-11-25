// E2E: Chiến dịch AI 2.0 (3 Chặng Marketer UX, Commerce Angle Card + Technical Specs fold, Brief funnel_goal & Formats mới,
// Dual Image Engine ChatGPT | Muse + Direct Look Mode, Clip Ingredients | Motion Trend Clone 3-15s,
// Assemble audio_mode silent không cần voice + ending_mode cta_overlay, Safe-Zone TikTok Shop Preview, Hook Multiplier 0 credit ffmpeg thật).
// Chạy: npm run e2e:up  ->  node scripts/e2e/campaign-v2.e2e.mjs  ->  npm run e2e:down
import { spawnSync } from 'node:child_process'
import { existsSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { PORTS, REPO, WS } from './isolated.mjs'
import { launchApp, mockJson, report } from './harness.mjs'

const API = `http://127.0.0.1:${PORTS.backend}`
const t = report()

// 1) Tạo clip mẫu 3s thật bằng ffmpeg + PNG nhỏ
const sampleClip = join(WS, 'sample-campaign-3s.mp4')
if (!existsSync(sampleClip)) {
  const ff = spawnSync(
    'ffmpeg',
    [
      '-y', '-hide_banner', '-loglevel', 'error',
      '-f', 'lavfi', '-i', 'testsrc2=size=180x320:rate=24:duration=3',
      '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono',
      '-t', '3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', sampleClip,
    ],
    { encoding: 'utf8' },
  )
  if (ff.status !== 0) throw new Error(`ffmpeg sample failed: ${ff.stderr}`)
}
const samplePng = join(WS, 'sample-1x1.png')
writeFileSync(
  samplePng,
  Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'),
)

// 2) Seed chiến dịch E2E trực tiếp vào Data của backend cô lập (không tốn credit Flow / ChatGPT / Gemini)
const seedPy = `
import json, os, sys, time
from pathlib import Path

be = os.path.join(os.environ["E2E_WS"], "Backend")
sys.path.insert(0, be)
os.environ["APP_DATA_DIR"] = be

from app.campaign.service import get_service
from app.campaign.runner import ArtifactSpec, ExecResult
from app.campaign.executors import common, script as script_mod
from app.campaign import formats

svc = get_service()
png_bytes = Path(os.environ["SAMPLE_PNG"]).read_bytes()
mp4_bytes = Path(os.environ["SAMPLE_CLIP"]).read_bytes()

# Fake executors chỉ dùng để seed DB cô lập; bước assemble chạy ffmpeg THẬT qua HTTP :8010
def wait_idle(cid):
    for _ in range(120):
        if svc.runner.active_exec(cid) is None:
            return
        time.sleep(0.05)

def fake_fact(ctx):
    return ExecResult([ArtifactSpec("json", json={
        "category": "oversized t-shirt", "color": "white", "material": "cotton 250gsm", "fit": "oversized",
        "length": "hip-length", "neckline": "crew neck", "sleeves": "short sleeve", "pattern": "solid",
        "logo_present": True, "logo_text": "NY", "details": ["cổ bo dày"], "sizes": "M/L",
        "summary": "White oversized tee", "summary_vi": "Áo thun trắng form rộng đứng dáng",
        "do_not_say": ["100% cotton"],
        "selling_angles": ["Che bắp tay gọn hơn nhờ vai rớt", "Phối 1 áo được 3 dịp đi học/đi làm/cafe"],
        "buyer_objections": ["Vải trắng có bị mỏng lộ không? -> Cotton 250gsm dày dặn"],
        "vibe_tags": ["Clean Girl", "Minimalist"],
        "fit_benefits": ["Tôn chiều cao", "Không kén dáng"],
        "risk": {"level": "medium", "reasons": ["Có logo"], "motion_limit": "gentle", "logo_rule": "reference_only"},
    })])

def fake_sheet(ctx):
    return ExecResult([ArtifactSpec("image", ext="png", data=png_bytes, meta={"aspect": "16:9", "image_provider": "chatgpt"})])

def fake_anchor(ctx):
    return ExecResult([ArtifactSpec("image", ext="png", data=png_bytes, meta={"aspect": "9:16", "image_provider": "chatgpt"})])

def fake_script(ctx):
    fmt = formats.resolve(common.load_input(ctx.inputs, "format"))
    skel = script_mod.skeleton(fmt, script_mod.scenes_of(ctx.inputs), common.garment_of(ctx.inputs))
    items = [{
        "key": sk["key"], "beats": ["giơ tay chỉ form áo", "mỉm cười trước ống kính"],
        "expression": "tươi tắn", "voiceover": f"Lời thoại {sk['key']}", "on_screen_text": f"Điểm nhấn {sk['key']}",
    } for sk in skel]
    doc = script_mod.normalize_script({
        "items": items,
        "hook": {"type": "direct", "on_screen_text": "M55 mặc sao cho gọn?"},
        "angle_vi": "Góc che bắp tay", "caption": "Áo thun form chuẩn #ootd", "hashtags": ["#ootd"], "cta": "Bấm giỏ cam ngay",
    }, ctx.inputs, ctx.params)
    return ExecResult([ArtifactSpec("json", json=doc)])

def fake_clip(ctx):
    return ExecResult([ArtifactSpec("video", ext="mp4", data=mp4_bytes, meta={"resolution": "360p", "duration": 3})], credit_actual=0)

svc.runner.executors.update({
    "fact_sheet": fake_fact, "cast_sheet": fake_sheet, "scene_anchor": fake_anchor, "script": fake_script, "clip": fake_clip,
})

c = svc.create_campaign("Áo Thun V2 E2E", niche="fashion", platform="tiktok")
cid = c["id"]
g_art = svc.upload_image(cid, "front.png", png_bytes)
svc.set_input_files(cid, "garment_source", [{"artifact_id": g_art["id"], "role": "front"}])
p_art = svc.upload_image(cid, "model.png", png_bytes)
svc.set_input_files(cid, "cast", [{"artifact_id": p_art["id"], "role": "identity"}])
svc.set_params(cid, "cast_profile", {"presentation": "woman"})
svc.set_params(cid, "brief", {"audience": "Nữ 18-26", "occasion": "Đi học & cafe", "funnel_goal": "gmv_max"})
svc.set_params(cid, "format", {"format_id": "fit_check"})
svc.set_params(cid, "scene_set", {"items": [
    {"key": "scene:1", "name": "Phố chiều", "place": "a bright street sidewalk", "time": "late afternoon", "light": "soft daylight", "mood": "fresh", "action": "walking"},
    {"key": "scene:2", "name": "Quán cafe", "place": "a minimalist cafe", "time": "morning", "light": "window light", "mood": "cozy", "action": "standing by window"},
]})

for step in ("fact_sheet", "cast_sheet", "script"):
    svc.run(cid, step, "draft")
    wait_idle(cid)
svc.decide_gate(cid, "cast_sheet", "approved")
svc.run(cid, "scene_anchor", "draft")
wait_idle(cid)
for sc in ("scene:1", "scene:2"):
    svc.decide_gate(cid, "scene_anchor", "approved", element_key=sc)
svc.run(cid, "clip", "draft", confirm_credit=True)
wait_idle(cid)
for sh in ("shot:1", "shot:2", "shot:3", "shot:4"):
    svc.decide_gate(cid, "clip", "approved", element_key=sh)

# Không chạy voice — kiểm tra Chế độ Tắt tiếng & Chỉ nhạc nền trong UI
print(cid)
`

const pyRes = spawnSync(join(REPO, 'Backend', '.venv', 'Scripts', 'python.exe'), ['-c', seedPy], {
  env: { ...process.env, E2E_WS: WS, SAMPLE_PNG: samplePng, SAMPLE_CLIP: sampleClip },
  encoding: 'utf8',
})
if (pyRes.status !== 0) throw new Error(`Seed DB failed: ${pyRes.stderr}\n${pyRes.stdout}`)
const cid = pyRes.stdout.trim().split(/\r?\n/).pop()
if (!cid) throw new Error('Seed DB returned empty cid')

const { app, page, jsErrors, shot } = await launchApp({ name: 'campaign-v2' })

try {
  await page.waitForLoadState('domcontentloaded')
  await page.getByText('Chiến dịch AI', { exact: true }).first().click()
  await page.getByText('Áo Thun V2 E2E').first().click()

  // 1) 3-Stage Stepper
  for (const id of [1, 2, 3]) {
    await page.locator(`[data-testid="stage-tab-${id}"]`).waitFor({ timeout: 15000 })
  }
  const s1Text = await page.locator('[data-testid="stage-tab-1"]').innerText()
  const s2Text = await page.locator('[data-testid="stage-tab-2"]').innerText()
  const s3Text = await page.locator('[data-testid="stage-tab-3"]').innerText()
  t.ok(
    '3-Stage Marketer Stepper hiển thị đủ 3 chặng chuẩn',
    s1Text.includes('Sản phẩm & Chiến lược') && s2Text.includes('Dựng Look & Kịch bản') && s3Text.includes('Clip & Xưởng Biến Thể'),
    `${s1Text} | ${s2Text} | ${s3Text}`,
  )

  // 2) Chặng 1: Commerce Angle Card + Tech Specs gấp gọn + Brief funnel_goal + Format mới
  const commerce = page.locator('[data-testid="commerce-angle-card"]')
  await commerce.waitFor({ timeout: 10000 })
  const commerceText = await commerce.innerText()
  const techFoldOpen = await page.locator('[data-testid="fold-tech-specs"]').evaluate((el) => el.hasAttribute('open'))
  const formatText = await page.locator('[data-testid="format-panel"]').innerText()
  const briefText = await page.locator('[data-testid="step-brief"]').innerText()
  t.ok(
    'Chặng 1: Commerce Angle Card hiện selling_angles/objections/vibe, thông số ERP gấp gọn, Format có GMV Max & Motion Trend Clone',
    commerceText.includes('Che bắp tay gọn hơn') &&
      commerceText.includes('Clean Girl') &&
      !techFoldOpen &&
      briefText.includes('Mục tiêu phễu') &&
      formatText.includes('Ma trận GMV Max') &&
      formatText.includes('Motion Trend Clone'),
  )
  await shot('campaign-v2-stage1')

  // 3) Chặng 2: Dual Engine ChatGPT | Muse + Direct Look Mode
  await page.locator('[data-testid="stage-tab-2"]').click()
  await page.locator('[data-testid="scene-anchor-panel"]').waitFor({ timeout: 10000 })
  const directBadge = await page.locator('[data-testid="direct-look-badge"]').innerText()
  const museBtn = page.locator('[data-testid="anchor-provider-toggle"] button', { hasText: 'Muse' })
  await museBtn.click()
  await page.waitForFunction(
    () => document.querySelector('[data-testid="anchor-provider-toggle"] button:nth-child(2)')?.classList.contains('is-active'),
    null,
    { timeout: 10000 },
  )
  t.ok(
    'Chặng 2: Direct Look badge hiện khi chưa có ảnh nền & công tắc ChatGPT | Muse chuyển được sang Muse',
    directBadge.includes('Direct Look') && (await museBtn.evaluate((el) => el.classList.contains('is-active'))),
  )

  // 4) Chặng 3: Clip Motion Trend Clone toggle (3-15s) + Assemble Audio Mode silent + CTA Overlay + ffmpeg thật + Safe-Zone + Hook Multiplier
  await page.locator('[data-testid="stage-tab-3"]').click()
  await page.locator('[data-testid="clip-panel"]').waitFor({ timeout: 10000 })
  const motionModeBtn = page.locator('[data-testid="clip-mode-shot:1"] button', { hasText: 'Motion Trend Clone' })
  await motionModeBtn.click()
  await page.locator('[data-testid="motion-box-shot:1"]').waitFor({ timeout: 10000 })
  const motionBoxText = await page.locator('[data-testid="motion-box-shot:1"]').innerText()
  t.ok(
    'Chặng 3: ClipPanel bật chế độ Motion Trend Clone 3–15s với khung tải video mẫu',
    motionBoxText.includes('3–15s') && motionBoxText.includes('Tải video mẫu'),
  )

  // Chuyển Assemble sang audio_mode=silent (gỡ bắt buộc voice) và ending_mode=cta_overlay
  await page.locator('[data-testid="audio-mode-seg"] button', { hasText: 'Tắt tiếng' }).click()
  await page.locator('[data-testid="ending-mode-seg"] button', { hasText: 'CTA nổi góc giỏ hàng' }).click()
  await page.waitForFunction(
    () => {
      const btn = document.querySelector('[data-testid="run-assemble"]')
      return !!btn && !btn.hasAttribute('disabled')
    },
    null,
    { timeout: 10000 },
  )
  t.ok('AssemblePanel: mở khóa nút Ghép video khi chưa có voice ở chế độ Tắt tiếng', true)

  // Chạy ffmpeg thật ghép video hoàn chỉnh
  await page.locator('[data-testid="run-assemble"]').click()
  await page.locator('[data-testid="final-video"]').waitFor({ timeout: 45000 })
  t.ok('AssemblePanel: ghép video thật (ffmpeg 0 credit) hiện trình phát Safe-Zone', await page.locator('[data-testid="final-video"]').isVisible())

  // Kiểm tra Safe-Zone TikTok Shop overlay bật / tắt
  await page.locator('[data-testid="safe-zone-overlay"]').waitFor({ timeout: 5000 })
  const initialOverlay = await page.locator('[data-testid="safe-zone-overlay"]').isVisible()
  await page.locator('[data-testid="toggle-safe-zone"]').click()
  const hiddenAfterToggle = (await page.locator('[data-testid="safe-zone-overlay"]').count()) === 0
  await page.locator('[data-testid="toggle-safe-zone"]').click()
  const shownAgain = await page.locator('[data-testid="safe-zone-overlay"]').isVisible()
  t.ok('SafeZoneVideoPlayer: hiển thị và bật/tắt khung phủ TikTok Shop trơn tru', initialOverlay && hiddenAfterToggle && shownAgain)

  // Mock Gemini gợi ý Hook A/B, sau đó bấm Đẻ biến thể chạy ffmpeg thật trên backend :8010
  await page.route(`**/api/campaigns/${cid}/hook-variants/suggest`, (route) =>
    mockJson(route, {
      provider: 'gemini',
      variants: [
        { id: 'hook_fit', angle: 'Nỗi đau dáng người', opening_text: 'Vai rộng mặc sao gọn?', cta_text: 'Chốt ngay giỏ cam', ending_mode: 'cta_overlay' },
        { id: 'hook_fabric', angle: 'Cận chất cotton', opening_text: 'Cotton dày không nhăn cổ', cta_text: 'Xem bảng size dưới góc', ending_mode: 'cta_overlay' },
      ],
    }),
  )
  await page.locator('[data-testid="suggest-hook-variants"]').click()
  await page.locator('[data-testid="hook-card-hook_fit"]').waitFor({ timeout: 10000 })
  await page.locator('[data-testid="render-hook-variants"]').click()
  await page.locator('[data-testid="dl-hook-hook_fit"]').waitFor({ timeout: 60000 })
  await page.locator('[data-testid="dl-hook-hook_fabric"]').waitFor({ timeout: 60000 })
  const dlResp = await page.request.get(`${API}/api/campaigns/${cid}/hook-variants/hook_fit/file`)
  t.ok(
    'Hook Multiplier: gợi ý Gemini (mock) -> đẻ 2 biến thể MP4 thật qua ffmpeg (0 credit) và tải được HTTP 200',
    dlResp.status() === 200 && (await dlResp.body()).length > 1024,
    `status=${dlResp.status()}`,
  )
  await shot('campaign-v2-stage3')
} catch (e) {
  t.ok('kịch bản chạy hết', false, String(e).split('\n')[0])
  await shot('campaign-v2-error').catch(() => {})
}

t.ok('không có lỗi JS trên trang', jsErrors().length === 0, jsErrors().slice(0, 3).join(' | '))
await app.close()
t.done()
