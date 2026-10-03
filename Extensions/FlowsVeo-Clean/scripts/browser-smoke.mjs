import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { root } from './build-lib.mjs';
import { startStandaloneBridge } from '../tests/helpers/standalone-bridge.mjs';

process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root, '.local/browsers');
const { chromium } = await import('playwright');
const fixture = await startStandaloneBridge();
const flowHtml = await readFile(path.join(root, 'tests/fixtures/flow-smoke.html'), 'utf8');
const videoMediaId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
await mkdir(path.join(root, '.local/browser-profiles'), { recursive: true });
const profile = await mkdtemp(path.join(root, '.local/browser-profiles/smoke-'));
const extension = path.join(root, 'dist/release');
const errors = [], rpcCalls = [];
const manifest = JSON.parse(await readFile(path.join(extension, 'manifest.json'), 'utf8'));
let context;
const report = { version: manifest.version, browser: null, fixtureOnly: true, checks: [], profile };

async function waitFor(predicate, label, timeout = 20000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  throw new Error('Timed out: ' + label);
}
function asset(status, videoUrl = null) {
  const item = [videoMediaId, null, null, 'CAE', null, []];
  const progress = []; progress[8] = [status]; progress[10] = 'https://flow-content.google/preview.jpg'; item[5][0] = progress;
  if (videoUrl) { const video = []; video[8] = videoUrl; item[5][2] = [video]; }
  return item;
}
try {
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      `--proxy-server=http://127.0.0.1:${fixture.port}`, '--proxy-bypass-list=<-loopback>'],
  });
  report.browser = context.browser()?.version() || 'persistent Chromium';
  context.on('weberror', error => errors.push(error.error().message));
  // Page requests are fulfilled locally; worker requests are confined by the proxy.
  await context.route('**/*', async route => {
    const url = new URL(route.request().url());
    if (url.hostname === '127.0.0.1' && url.port === String(fixture.port)) return route.continue();
    if (url.hostname === 'flow.google.com' && route.request().isNavigationRequest()) {
      return route.fulfill({ contentType: 'text/html', body: flowHtml });
    }
    if (url.hostname === 'www.google.com' && url.pathname === '/recaptcha/enterprise.js') {
      return route.fulfill({ contentType: 'application/javascript', body: "window.grecaptcha={enterprise:{ready:cb=>cb(),execute:async()=> 'fixture-captcha'}};" });
    }
    if (url.hostname === 'flow.google.com' && url.searchParams.has('rpcids')) {
      const rpc = url.searchParams.get('rpcids'); rpcCalls.push(rpc);
      const responses = { Zzl0ze: [], YhhmEf: [asset(2)], nprQif: [asset(2)], MZZa6b: [asset(2)], jIps6: [asset(2)],
        jwpduf: [asset(3)], as29s: [asset(3, 'https://flow-content.google/fixture-result.mp4?Signature=fixture')],
        ogiZ0b: [[['fixture-image', null, null, null, null, null, [[null, 123, null, null, null, null, null, null, null, null, null, null, null, 'https://flow-content.google/image/fixture-image'], null, [1280, 720]]]]],
        maseQ: [['fixture-reference', 'project-test']] };
      if (!(rpc in responses)) throw new Error('Unexpected fixture RPC: ' + rpc);
      return route.fulfill({ contentType: 'application/json', body: ")]}'\n\n" + JSON.stringify(['wrb.fr', rpc, JSON.stringify(responses[rpc])]) + '\n' });
    }
    if (url.hostname === 'flow.google.com' && url.pathname.startsWith('/upload/')) {
      if (route.request().headers()['x-goog-upload-command'] === 'start') return route.fulfill({
        headers: { 'x-goog-upload-url': 'https://flow.google.com/upload/fixture-session' }, body: '',
      });
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ mediaId: 'fixture-upload-media', media: { name: 'fixture-upload-media', projectId: 'project-test' } }) });
    }
    return route.abort();
  });
  let worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const extensionId = new URL(worker.url()).hostname;
  const popup = await context.newPage();
  await popup.goto(`chrome-extension://${extensionId}/popup.html`);
  const send = message => popup.evaluate(message => new Promise(resolve => chrome.runtime.sendMessage(message, resolve)), message);
  assert.equal((await send({ type: 'SET_BRIDGE_PORT', port: fixture.port })).ok, true);
  await send({ type: 'SET_AUTO_RELOAD', enabled: false, minutes: 5 });
  await send({ type: 'SET_AUTO_CLEAR_CACHE', enabled: false, seconds: 300 });
  await waitFor(() => fixture.received.some(r => r.path === '/api/v1/config/init'), 'config handshake');
  report.checks.push('release popup, custom port, config and settings');

  const flow = await context.newPage();
  await flow.goto('https://flow.google.com/u/1/project/project-test');
  await flow.locator('#veoflow-fab').waitFor();
  assert.equal((await send({ type: 'CHECK_STATUS' })).captcha.ok, true);
  report.checks.push('content script and real MAIN-world injection');

  fixture.jobs.push({ request_id: 'browser-video', flow_request: {
    prompt: 'fixture video', project_id: 'project-test', input_mode: 'text_to_video', aspect_ratio: '9:16',
    resolution: '720p', num_outputs: 1, provider_model_id: 'abra_t2v_6s', duration_seconds: 6,
  } });
  await waitFor(() => fixture.received.some(r => r.path === '/flow/response' && r.body.request_id === 'browser-video'), 'video result', 30000);
  const video = fixture.received.find(r => r.path === '/flow/response' && r.body.request_id === 'browser-video').body;
  assert.equal(video.error, null, JSON.stringify(video));
  assert.equal(video.result.media_id, videoMediaId);
  assert.deepEqual(await flow.evaluate(() => window.fixtureSubmissions), [{ rpc: 'YhhmEf', prompt: 'fixture video', trusted: true }]);
  assert.ok(rpcCalls.includes('YhhmEf') && rpcCalls.includes('as29s'));
  report.checks.push('native video controls, trusted submit and result correlation on minified release');

  fixture.jobs.push({ action: 'IMAGE_GENERATION', request_id: 'browser-image', image_request: { prompt: 'fixture image', project_id: 'project-test', aspect_ratio: '16:9', model_key: 'GEM_PIX_2' } });
  await waitFor(() => fixture.received.some(r => r.path === '/flow/image-response'), 'image result');
  const img = fixture.received.find(r => r.path === '/flow/image-response').body;
  assert.equal(img.error, null, JSON.stringify(img));
  assert.equal(img.result.images.length, 1);
  assert.deepEqual(await flow.evaluate(() => window.fixtureSubmissions.at(-1)), { rpc: 'ogiZ0b', prompt: 'fixture image', trusted: true });
  report.checks.push('native image controls, trusted submit and response');

  fixture.jobs.push({ action: 'UPLOAD_VIDEO', request_id: 'browser-upload', project_id: 'project-test', video_base64: Buffer.from('fixture-video').toString('base64'), mime_type: 'video/mp4', filename: 'fixture.mp4' });
  await waitFor(() => fixture.received.some(r => r.path === '/flow/video-upload-response'), 'upload result');
  assert.equal(fixture.received.find(r => r.path === '/flow/video-upload-response').body.ok, true);
  report.checks.push('resumable video upload');

  fixture.jobs.push({ action: 'CREATE_PROJECT', request_id: 'browser-create', project_name: 'Fixture project' });
  await waitFor(() => fixture.received.some(r => r.path === '/flow/project-created'), 'create project result', 30000);
  assert.equal(fixture.received.find(r => r.path === '/flow/project-created').body.flow_project_id, 'created-project');
  fixture.jobs.push({ action: 'SWITCH_PROJECT', request_id: 'browser-switch', flow_project_id: 'project-test' });
  await waitFor(() => fixture.received.some(r => r.path === '/flow/project-switched'), 'switch project result');
  assert.equal(fixture.received.find(r => r.path === '/flow/project-switched').body.ok, true);
  report.checks.push('project creation uses another tab; switching preserves the original project');

  // Shut down only this isolated profile, then verify persisted settings on cold start.
  await context.close(); context = null;
  context = await chromium.launchPersistentContext(profile, {
    channel: 'chromium', headless: true,
    args: [`--disable-extensions-except=${extension}`, `--load-extension=${extension}`,
      `--proxy-server=http://127.0.0.1:${fixture.port}`, '--proxy-bypass-list=<-loopback>'],
  });
  worker = context.serviceWorkers()[0] || await context.waitForEvent('serviceworker');
  const restored = await worker.evaluate(async () => chrome.storage.local.get(['_vf_bridgePort','_vf_autoReloadEnabled','_vf_extInstanceFp']));
  assert.equal(restored._vf_bridgePort, fixture.port);
  assert.equal(restored._vf_autoReloadEnabled, false);
  assert.ok(restored._vf_extInstanceFp);
  report.checks.push('persistent settings survive browser/service-worker cold start');
  assert.deepEqual(errors, []);
  report.passed = true;
} catch (error) {
  report.passed = false; report.error = error.message;
  throw error;
} finally {
  if (context) await context.close();
  await fixture.close();
  report.blockedOutsideFixture = fixture.blocked.length;
  report.rpcCalls = rpcCalls;
  await mkdir(path.join(root, 'test-results'), { recursive: true });
  await writeFile(path.join(root, 'test-results/browser-smoke.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
}
