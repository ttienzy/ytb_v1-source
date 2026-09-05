const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

// Load the actual config code without starting Chrome handlers/polling.
const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
const boundary = source.indexOf('async function findLabsTab(');
assert.ok(boundary > 0);
const configSource = source.slice(0, boundary);
const encode = (config) => Buffer.from(JSON.stringify(config)).toString('base64');

function harness(fetch) {
  const context = vm.createContext({ fetch, atob, AbortSignal,
    console: { log() {} }, setTimeout });
  vm.runInContext(configSource, context);
  vm.runInContext("bridgeSecret = 'test-only-secret';", context);
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
  assert.equal(h.run('cfgIsFallback'), false);
  assert.equal(h.run('cfgVersion'), 'test-v1');
  assert.equal(h.run('harvestCfg.c.m'), 'grecaptcha');
  assert.equal(h.run('Boolean(harvestCfg.t && harvestCfg.h)'), true);
});

test('HTTP 200 health response is rejected with an actionable log', async () => {
  const h = harness(async () => ({ ok: true,
    json: async () => ({ status: 'ok', service: 'veo-bridge' }) }));
  assert.equal(await h.sync(), false);
  assert.equal(h.run('cfgIsFallback'), true);
  assert.match(h.run('activityLog.at(-1).msg'), /missing payload/);
  h.run('ensureHarvestCfg()');
  assert.equal(h.run('harvestCfg.c.m'), 'grecaptcha');
});

test('invalid remote configs cannot replace a working config', async () => {
  for (const payload of [encode(null), encode([]), encode({}),
    encode({ c: {} }), encode({ c: { m: [], s: 'enterprise' } }), 'not-base64!']) {
    const h = harness(async () => ({ ok: true,
      json: async () => ({ payload, v: 'bad-version' }) }));
    h.run("ensureHarvestCfg(); cfgVersion = 'working'; cfgIsFallback = false;");
    assert.equal(await h.sync(), false);
    assert.equal(h.run('harvestCfg.c.m'), 'grecaptcha');
    assert.equal(h.run('cfgVersion'), 'working');
  }
});

test('authentication failure is reported without logging secret', async () => {
  const h = harness(async () => ({ ok: false, status: 403 }));
  assert.equal(await h.sync(), false);
  const message = h.run('activityLog.at(-1).msg');
  assert.match(message, /Config HTTP 403/);
  assert.ok(!message.includes('test-only-secret'));
});
