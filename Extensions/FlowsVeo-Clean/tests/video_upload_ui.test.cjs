const { test } = require('node:test');
const assert = require('node:assert/strict');
const api = import('../src/providers/google-flow/video-upload-ui.js');
const project = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const media = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('native video upload result must include a media ID and matching Flow project', async () => {
  const { parseUploadResult } = await api;
  assert.deepEqual(parseUploadResult(JSON.stringify({ mediaId: media, media: { projectId: project } }), project), {
    media_id: media, project_id: project,
  });
  assert.equal(parseUploadResult(JSON.stringify({ mediaId: media, media: { projectId: 'other-project' } }), project), null);
  assert.equal(parseUploadResult('not json', project), null);
});

test('upload menu retries after a covering window and closes it first', async () => {
  const { openUploadChooser } = await api;
  const calls = [];
  let covered = 2;
  const step = async (action) => {
    calls.push(action);
    if (action === 'dismissBackdrop') return { x: 1, y: 1 };
    if (action === 'openPicker' && covered > 0) {
      covered -= 1;
      throw new Error('A window is covering the Flow upload control: DIV.cdk-overlay-backdrop.');
    }
    return { x: 10, y: 10 };
  };
  const clicks = [];
  let escapes = 0;
  await openUploadChooser({ step, click: async (p) => clicks.push(p), pressEscape: async () => { escapes += 1; }, wait: async () => {} });
  assert.deepEqual(calls, ['openPicker', 'dismissBackdrop', 'openPicker', 'dismissBackdrop', 'openPicker', 'upload']);
  assert.equal(escapes, 2);
  assert.equal(clicks.length, 4);
});

test('upload menu gives up after the attempt limit and does not retry other errors', async () => {
  const { openUploadChooser } = await api;
  const noop = async () => {};
  let opens = 0;
  const alwaysCovered = async (action) => {
    if (action === 'openPicker') { opens += 1; throw new Error('A window is covering the Flow upload control: DIALOG.'); }
    return null;
  };
  await assert.rejects(openUploadChooser({ step: alwaysCovered, click: noop, pressEscape: noop, wait: noop }), /covering/);
  assert.equal(opens, 3);
  let other = 0;
  const missing = async () => { other += 1; throw new Error('Flow upload control was not found.'); };
  await assert.rejects(openUploadChooser({ step: missing, click: noop, pressEscape: noop, wait: noop }), /not found/);
  assert.equal(other, 1);
});

test('upload step picks the menu item over a covered page button and names the blocker', async () => {
  process.env.PLAYWRIGHT_BROWSERS_PATH ||= require('node:path').resolve(__dirname, '../.local/browsers');
  const { chromium } = require('playwright');
  const { videoUploadUiStep } = await import('../src/providers/google-flow/page/video-upload-ui.js');
  const browser = await chromium.launch({ channel: 'chromium', headless: true });
  try {
    const page = await browser.newPage();
    await page.route('**/*', (route) => route.fulfill({ contentType: 'text/html;charset=utf-8', body: `<body style="margin:0">
      <div class="base-prompt-box"><button class="add-menu-trigger" style="width:40px;height:40px">+</button></div>
      <button id="page-upload" style="position:absolute;top:200px;left:20px;width:200px;height:40px">Tải nội dung nghe nhìn lên</button>
      <div class="cdk-overlay-backdrop" style="position:fixed;inset:0;z-index:5"></div>
      <div class="cdk-overlay-pane" style="position:fixed;top:60px;left:20px;z-index:6"><div role="menu">
        <button id="menu-upload" style="width:200px;height:40px">Upload media</button></div></div></body>` }));
    await page.goto(`https://flow.google.com/project/${project}`);
    const step = (action) => page.evaluate(([source, action, req]) => (0, eval)('(' + source + ')')(action, req),
      [videoUploadUiStep.toString(), action, { project_id: project }]);
    const upload = await step('upload');
    assert.equal(await page.evaluate((p) => document.elementFromPoint(p.x, p.y).id, upload), 'menu-upload');
    const picker = await step('openPicker');
    assert.match(picker.error, /^A window is covering the Flow upload control: DIV\.cdk-overlay-backdrop/);
    const corner = await step('dismissBackdrop');
    assert.equal(await page.evaluate((p) => document.elementFromPoint(p.x, p.y).className, corner), 'cdk-overlay-backdrop');
    await page.evaluate(() => { document.querySelector('.cdk-overlay-backdrop').remove(); document.querySelector('.cdk-overlay-pane').remove(); });
    assert.equal((await step('openPicker')).error, undefined);
    assert.equal(await step('dismissBackdrop'), null);
  } finally { await browser.close(); }
});
