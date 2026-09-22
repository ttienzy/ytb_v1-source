const assert = require('node:assert/strict');
const { test } = require('node:test');
const { harness, until } = require('../helpers/runtime.cjs');

test('legacy transport preserves explicit port, request options and raw responses', async () => {
  const response = { status: 204 };
  const h = harness(['src/bridge/client.js'], { fetch: async () => response });
  const options = { headers: { 'X-Bridge-Key': 'fixture-key' }, signal: AbortSignal.timeout(1000) };
  assert.equal(await h.api.bridgeRequest('nextJob', options, 45678), response);
  assert.equal(h.requests[0].url, 'http://127.0.0.1:45678/captcha/request');
  assert.equal(h.requests[0].options, options);
  assert.equal(options.method, undefined); // Legacy GET stays implicit.
  assert.throws(() => h.api.bridgeRequest('unknown', {}), /Unknown bridge operation/);
});

test('port discovery uses the probed port and persists the successful fallback', async () => {
  const h = harness(['src/bridge/config.js'], { fetch: async url => ({
    ok: new URL(url).port === '56526', json: async () => ({ secret: 'fixture-new-key' }),
  }) });
  assert.equal(await h.api.fetchBridgeSecret(), true);
  assert.deepEqual(h.requests.map(r => new URL(r.url).port), ['60526', '56526']);
  assert.equal(h.api.runtime.bridgePort, 56526);
  assert.equal(h.storage._vf_bridgePort, 56526);
  assert.equal(h.api.runtime.bridgeSecret, 'fixture-new-key');
});

test('response envelopes keep exact legacy fields, auth and failure semantics', async () => {
  const h = harness(['src/bridge/responses.js']);
  await h.api.postCaptchaResponse('captcha-1', 'fixture-token', null);
  await h.api.postFlowResponse('video-1', { ok: true, media_id: 'media-1' });
  await h.api.postFlowResponse('video-2', { ok: false, error: 'fixture failure' });
  await h.api.postImageResponse('image-1', { ok: true, images: ['fixture-image'] });
  await h.api.postVideoUploadResponse('upload-1', { ok: true, media_id: 'media-2', project_id: 'project-test' });
  await h.api.postProjectCreatedResponse('create-1', { ok: true, flow_project_id: 'new-project', account_email: 'fixture@example.invalid' });
  await h.api.postProjectSwitchedResponse('switch-1', { ok: true, flow_project_id: 'other-project', tab_id: 12 });
  assert.deepEqual(h.requests.map(r => r.path), ['/captcha/response','/flow/response','/flow/response','/flow/image-response','/flow/video-upload-response','/flow/project-created','/flow/project-switched']);
  for (const { options } of h.requests) {
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Bridge-Key'], 'fixture-key');
    assert.equal(options.headers['X-Ext-FP'], 'fixture-instance');
    assert.equal(options.headers['Content-Type'], 'application/json');
  }
  assert.deepEqual(h.requests[0].body, { request_id: 'captcha-1', token: 'fixture-token', error: null, user_agent: 'test-browser' });
  assert.deepEqual(h.requests[1].body, { request_id: 'video-1', result: { ok: true, media_id: 'media-1' }, error: null });
  assert.deepEqual(h.requests[2].body, { request_id: 'video-2', result: null, error: 'fixture failure' });
  assert.deepEqual(h.requests[4].body, { request_id: 'upload-1', ok: true, media_id: 'media-2', project_id: 'project-test', error: null, logs: [] });
  assert.deepEqual(h.requests[5].body, { request_id: 'create-1', ok: true, flow_project_id: 'new-project', account_email: 'fixture@example.invalid', error: null });
  assert.deepEqual(h.requests[6].body, { request_id: 'switch-1', ok: true, flow_project_id: 'other-project', tab_id: 12, error: null });
});

test('credentials and heartbeat preserve account/tab identity and fields', async () => {
  const h = harness(['src/bridge/responses.js','src/background/runtime/heartbeat.js']);
  await h.api.pushCredentialsBatch([{ email: 'fixture@example.invalid', cookie: 'fixture-cookie', access_token: 'fixture-token', expiry: 123, tier: 'PRO', credit: 10, tabId: 12, incognito: true }]);
  await h.api.sendHeartbeat();
  assert.deepEqual(h.requests[0].body, { ext_fp: 'fixture-instance', credentials: [{
    email: 'fixture@example.invalid', cookie: 'fixture-cookie', access_token: 'fixture-token', expiry: 123,
    tier: 'PRO', credit: 10, tab_id: 12, incognito: true, user_agent: 'test-browser',
    sec_ch_ua: '', sec_ch_ua_platform: '"Windows"', sec_ch_ua_mobile: '?0',
  }] });
  const heartbeat = h.requests.find(r => r.path === '/ext/heartbeat');
  assert.equal(heartbeat.body.ext_fp, 'fixture-instance');
  assert.equal(heartbeat.body.tab_count, 1);
  assert.equal(heartbeat.body.tabs[0].id, 12);
});

test('storage restore/save retains legacy keys, settings and fingerprint across worker restart', async () => {
  const initial = { _vf_bridgePort: 45678, _vf_tokenCount: 7, _vf_autoReloadEnabled: false,
    _vf_autoReloadMinutes: 9, _vf_autoClearCacheSeconds: 42, _vf_extFp: 'legacy-instance', _vf_unrelated: 'keep' };
  const h = harness(['src/platform/storage.js'], { storage: initial });
  h.api.runtime.extFp = null;
  assert.equal(await h.api.getExtFp(), 'legacy-instance');
  await h.api.restoreState(); await h.api.saveState();
  assert.equal(h.api.runtime.bridgeUrl, 'http://127.0.0.1:45678');
  assert.equal(h.api.runtime.tokenCount, 7);
  assert.equal(h.api.runtime.autoReloadEnabled, false);
  assert.equal(h.api.runtime.autoClearCacheSeconds, 42);
  assert.equal(h.storage._vf_unrelated, 'keep');
  const restarted = harness(['src/platform/storage.js'], { storage: h.storage });
  await restarted.api.restoreState();
  assert.equal(restarted.api.runtime.bridgePort, 45678);
  assert.equal(restarted.api.runtime.tokenCount, 7);
  assert.equal(restarted.api.runtime.autoReloadMinutes, 9);
});

test('polling 403 re-handshakes and replaces the stale secret without changing endpoints', async () => {
  let secretRequests=0;
  const h = harness(['src/background/runtime/polling.js'], { tabs: [], fetch: async url => {
    const route=new URL(url).pathname;
    if(route==='/bridge/secret') return { ok:true, json:async()=>({secret:++secretRequests===1?'stale-fixture-key':'fresh-fixture-key'}) };
    if(route==='/api/v1/config/init') return { ok:true, json:async()=>({payload:Buffer.from(JSON.stringify({c:{m:'grecaptcha',s:'enterprise'}})).toString('base64'),v:'fixture'}) };
    if(route==='/captcha/request') return { ok:false,status:403 };
    return {ok:true,status:200,json:async()=>({})};
  } });
  let finished=false;
  const polling=h.api.startPolling().then(()=>{finished=true;});
  await until(()=>h.api.runtime.bridgeSecret==='fresh-fixture-key' && h.timers.some(t=>t.ms===2500));
  assert.equal(h.storage._vf_bridgeSecret,'fresh-fixture-key');
  assert.equal(h.api.runtime.cfgVersion,'fixture');
  assert.equal(h.api.runtime.connected,false);
  assert.deepEqual(h.requests.filter(r=>r.path==='/api/v1/config/init').map(r=>r.options.headers['X-Bridge-Key']),['stale-fixture-key','fresh-fixture-key']);
  h.api.runtime.polling=false;
  await until(()=>{ for(const t of h.timers.splice(0)) if(!t.interval)t.fn(); return finished; });
  await polling;
});
