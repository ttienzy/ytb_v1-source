const assert = require('node:assert/strict');
const { test } = require('node:test');
const { harness, until } = require('../helpers/runtime.cjs');

function dispatcher(overrides = {}) {
  const h = harness([
    'src/background/jobs/dispatch.js','src/background/runtime/maintenance.js',
    'src/providers/google-flow/page/video.js','src/providers/google-flow/page/image.js',
    'src/providers/google-flow/page/captcha.js','src/providers/google-flow/page/upload.js',
    'src/providers/google-flow/page/recovery.js',
    'src/background/runtime/alarms.js','src/background/runtime/polling.js','src/bridge/config.js',
  ], overrides);
  const pending = new Map();
  h.chrome.scripting.executeScript = async ({ func, args = [], target }) => {
    if (func === h.api.inspectRecaptchaInPage) return [{ result: { available: true, moduleReady: true, siteKey: 'fixture-site-key' } }];
    if (func === h.api.runFlowGenerationInPage || func === h.api.runImageGenerationInPage) {
      return new Promise(resolve => pending.set(args[0].prompt, { target, resolve: result => resolve([{ result }]) }));
    }
    if (func === h.api.runVideoUploadInPage) return [{ result: { ok: true, media_id: 'upload-media', project_id: args[0].project_id } }];
    if (func === h.api.recoverCurrentSceneInPage) return [{ result: { ok: true, media_id: 'recovered-media', video_url: 'https://flow-content.google/fixture.mp4' } }];
    return [{ result: { token: 'fixture-captcha', error: null } }];
  };
  return { ...h, pending };
}

test('video jobs remain non-blocking and out-of-order results retain request IDs', async () => {
  const h = dispatcher();
  await h.api.processCaptchaRequest({ request_id: 'req-a', flow_request: { prompt: 'a', project_id: 'project-test' } });
  await h.api.processCaptchaRequest({ request_id: 'req-b', flow_request: { prompt: 'b', project_id: 'project-test' } });
  await until(() => h.pending.size === 2);
  assert.equal(h.api.runtime.activeGenerationCount, 2);
  assert.deepEqual(h.requests.filter(r => r.path === '/captcha/response').map(r => r.body.request_id), ['req-a','req-b']);
  assert.equal(h.requests.some(r => r.path === '/flow/response'), false);
  h.pending.get('b').resolve({ ok: true, media_id: 'media-b' });
  await until(() => h.api.runtime.activeGenerationCount === 1);
  h.pending.get('a').resolve({ ok: true, media_id: 'media-a' });
  await until(() => h.api.runtime.activeGenerationCount === 0);
  assert.deepEqual(h.requests.filter(r => r.path === '/flow/response').map(r => [r.body.request_id,r.body.result.media_id]), [['req-b','media-b'],['req-a','media-a']]);
});

test('active generation guards reload/cache and image still awaits its result', async () => {
  const h = dispatcher();
  h.api.runtime.autoReloadEnabled = true;
  let finished = false;
  const job = h.api.processCaptchaRequest({ action: 'IMAGE_GENERATION', request_id: 'image-a', image_request: { prompt: 'image', project_id: 'project-test' } }).then(() => { finished = true; });
  await until(() => h.pending.has('image'));
  assert.equal(finished, false);
  assert.equal(h.api.runtime.activeGenerationCount, 1);
  await h.api.doAutoReloadCycle();
  assert.equal(await h.api.clearLabsCache(), false);
  assert.equal(h.reloads.length, 0);
  assert.equal(h.removals.length, 0);
  h.pending.get('image').resolve({ ok: true, images: ['fixture-image'] });
  await job;
  assert.equal(h.api.runtime.activeGenerationCount, 0);
  assert.equal(h.requests.find(r => r.path === '/flow/image-response').body.request_id, 'image-a');
});

test('video failure releases the active counter and preserves error envelope', async () => {
  const h = dispatcher();
  await h.api.processCaptchaRequest({ request_id: 'failure', flow_request: { prompt: 'failure', project_id: 'project-test' } });
  await until(() => h.pending.has('failure'));
  h.pending.get('failure').resolve({ ok: false, error: 'fixture generation failure' });
  await until(() => h.api.runtime.activeGenerationCount === 0);
  assert.deepEqual(h.requests.find(r => r.path === '/flow/response').body, { request_id: 'failure', result: null, error: 'fixture generation failure' });
});

test('upload and switch dispatch keep their distinct response endpoints', async () => {
  const h = dispatcher();
  await h.api.processCaptchaRequest({ action: 'UPLOAD_VIDEO', request_id: 'upload', project_id: 'project-test', video_base64: 'AA==' });
  await h.api.processCaptchaRequest({ action: 'SWITCH_PROJECT', request_id: 'switch', flow_project_id: 'project-test' });
  assert.equal(h.requests[0].path, '/flow/video-upload-response');
  assert.equal(h.requests[0].body.request_id, 'upload');
  assert.equal(h.requests[1].path, '/flow/project-switched');
  assert.equal(h.requests[1].body.flow_project_id, 'project-test');
  assert.equal(h.requests.some(r => r.path === '/captcha/response'), false);
});

test('watchdog still consumes another job while polling has a video in flight', async () => {
  const queue = [
    { request_id: 'poll-job', flow_request: { prompt: 'poll', project_id: 'project-test' } },
    { request_id: 'alarm-job', flow_request: { prompt: 'alarm', project_id: 'project-test' } },
  ];
  const h = dispatcher({ fetch: async url => {
    const endpoint = new URL(url).pathname;
    if (endpoint === '/captcha/request') {
      const job = queue.shift(); return { ok: true, status: job ? 200 : 204, json: async () => job };
    }
    if (endpoint === '/bridge/secret') return { ok: true, json: async () => ({ secret: 'fixture-key' }) };
    if (endpoint === '/api/v1/config/init') return { ok: true, json: async () => ({ payload: Buffer.from(JSON.stringify({ c: { m: 'grecaptcha', s: 'enterprise' } })).toString('base64'), v: 'fixture' }) };
    return { ok: true, status: 200, json: async () => ({ requests: [] }) };
  } });
  h.api.registerAlarmEvents();
  let stopped = false;
  const polling = h.api.startPolling().then(() => { stopped = true; });
  await until(() => h.pending.has('poll'));
  await h.chrome.alarms.onAlarm.listeners[0]({ name: 'watchdog' });
  await until(() => h.pending.has('alarm'));
  assert.equal(h.api.runtime.activeGenerationCount, 2);
  assert.equal(queue.length, 0);
  h.pending.get('alarm').resolve({ ok: true, media_id: 'alarm-media' });
  h.pending.get('poll').resolve({ ok: true, media_id: 'poll-media' });
  await until(() => h.api.runtime.activeGenerationCount === 0);
  h.api.runtime.polling = false;
  await until(() => {
    for (const timer of h.timers.splice(0)) if (!timer.interval) timer.fn();
    return stopped;
  });
  await polling;
  assert.deepEqual(h.requests.filter(r => r.path === '/flow/response').map(r => r.body.request_id).sort(), ['alarm-job','poll-job']);
});

test('lost page execution result recovers the existing scene instead of dispatching again', async () => {
  const h = dispatcher();
  const original = h.chrome.scripting.executeScript;
  let generationCalls=0, recoveryCalls=0;
  h.chrome.scripting.executeScript=async options=>{
    if(options.func===h.api.runFlowGenerationInPage) { generationCalls++; throw new Error('frame was removed'); }
    if(options.func===h.api.recoverCurrentSceneInPage) recoveryCalls++;
    return original(options);
  };
  await h.api.processCaptchaRequest({ request_id:'recover-after-loss', flow_request:{prompt:'lost',project_id:'project-test'} });
  await until(()=>h.timers.some(t=>t.ms===3000));
  h.timers.find(t=>t.ms===3000).fn();
  await until(()=>h.requests.some(r=>r.path==='/flow/response') && h.api.runtime.activeGenerationCount===0);
  const response=h.requests.find(r=>r.path==='/flow/response').body;
  assert.equal(response.request_id,'recover-after-loss');
  assert.equal(response.error,null);
  assert.equal(response.result.media_id,'recovered-media');
  assert.equal(response.result.recovered_after_lost_result,true);
  assert.equal(generationCalls,1);
  assert.equal(recoveryCalls,1);
});

test('explicit recovery reports through flow response without a new CAPTCHA job', async () => {
  const h = dispatcher();
  await h.api.processCaptchaRequest({request_id:'recover-only',flow_recovery:true,project_id:'project-test'});
  assert.equal(h.requests.length,1);
  assert.equal(h.requests[0].path,'/flow/response');
  assert.equal(h.requests[0].body.request_id,'recover-only');
  assert.equal(h.requests[0].body.result.media_id,'recovered-media');
});
