const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');

// Load the actual config code without starting Chrome handlers/polling.
const { loadModules } = require('./helpers/modules.cjs');
const encode = (config) => Buffer.from(JSON.stringify(config)).toString('base64');

function harness(fetch) {
  const context = vm.createContext({ fetch, atob, AbortSignal,
    console: { log() {} }, setTimeout });
  loadModules(["src/bridge/config.js","src/config/defaults.js","src/background/runtime/state.js"], context);
  vm.runInContext("runtime.bridgeSecret = 'test-only-secret';", context);
  return {
    run: (code) => vm.runInContext(code, context),
    sync: () => vm.runInContext('syncRemoteConfig()', context),
  };
}

test('config handshake uses POST and validates CAPTCHA config', async () => {
  const h = harness(async (url, options) => {
    assert.ok(url.endsWith('/api/v1/config/init'));
    assert.equal(options.method, 'POST');
    assert.equal(options.headers['X-Bridge-Key'], 'test-only-secret');
    return { ok: true, json: async () => ({ payload: encode({
      c: { m: 'grecaptcha', s: 'enterprise' },
    }), v: 'test-v1' }) };
  });
  assert.equal(await h.sync(), true);
  assert.equal(h.run('runtime.cfgIsFallback'), false);
  assert.equal(h.run('runtime.cfgVersion'), 'test-v1');
  assert.equal(h.run('runtime.harvestCfg.c.m'), 'grecaptcha');
  assert.equal(h.run('Boolean(runtime.harvestCfg.t && runtime.harvestCfg.h)'), true);
});

test('HTTP 200 health response is rejected with an actionable log', async () => {
  const h = harness(async () => ({ ok: true,
    json: async () => ({ status: 'ok', service: 'veo-bridge' }) }));
  assert.equal(await h.sync(), false);
  assert.equal(h.run('runtime.cfgIsFallback'), true);
  assert.match(h.run('runtime.activityLog.at(-1).msg'), /missing payload/);
  h.run('ensureHarvestCfg()');
  assert.equal(h.run('runtime.harvestCfg.c.m'), 'grecaptcha');
});

test('invalid remote configs cannot replace a working config', async () => {
  for (const payload of [encode(null), encode([]), encode({}),
    encode({ c: {} }), encode({ c: { m: [], s: 'enterprise' } }), 'not-base64!']) {
    const h = harness(async () => ({ ok: true,
      json: async () => ({ payload, v: 'bad-version' }) }));
    h.run("ensureHarvestCfg(); runtime.cfgVersion = 'working'; runtime.cfgIsFallback = false;");
    assert.equal(await h.sync(), false);
    assert.equal(h.run('runtime.harvestCfg.c.m'), 'grecaptcha');
    assert.equal(h.run('runtime.cfgVersion'), 'working');
  }
});

test('authentication failure is reported without logging secret', async () => {
  const h = harness(async () => ({ ok: false, status: 403 }));
  assert.equal(await h.sync(), false);
  const message = h.run('runtime.activityLog.at(-1).msg');
  assert.match(message, /Config HTTP 403/);
  assert.ok(!message.includes('test-only-secret'));
});
