const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
const boundary = source.indexOf('async function harvestSingleTab(');
assert.ok(boundary > 0);

function pageHarness({ path = '/u/1/project/test-project', ready = true,
  scripts = ['https://www.google.com/recaptcha/enterprise.js?render=test-site-key'],
  tabs = [{ id: 12, url: 'https://flow.google.com/u/1/project/test-project', active: true }],
} = {}) {
  const calls = [];
  const api = { ready: (cb) => cb(), execute: async (key, options) => {
    calls.push({ key, action: options.action }); return 'test-token';
  } };
  const window = ready ? { grecaptcha: { enterprise: api } } : {};
  const document = { scripts: scripts.map((src) => ({ src })), querySelector: () => null,
    createElement() { throw new Error('Script injection is forbidden'); } };
  const context = vm.createContext({ window, document, URL, setTimeout, clearTimeout,
    location: { hostname: 'flow.google.com', pathname: path, href: 'https://flow.google.com' + path },
    console: { log() {} }, chrome: {
      tabs: { query: async () => tabs },
      scripting: { executeScript: async ({ func, args }) => [{ result: await func(...args) }] },
    },
  });
  vm.runInContext(source.slice(0, boundary), context);
  return { window, api, calls, run: (code) => vm.runInContext(code, context),
    inspect: (wait = 0) => vm.runInContext(`inspectRecaptchaInPage(DEFAULT_HARVEST_CFG.c, ${wait})`, context) };
}

test('home page reports project requirement without injecting scripts', async () => {
  const h = pageHarness({ path: '/u/1/', ready: false, scripts: [] });
  const state = await h.inspect(8000);
  assert.equal(state.available, false);
  assert.match(state.error, /Open a Flow project/);
  assert.equal(h.calls.length, 0);
});

test('modern Flow resolves site key from the existing enterprise script', async () => {
  const state = await pageHarness().inspect();
  assert.equal(state.available, true);
  assert.equal(state.siteKey, 'test-site-key');
  assert.equal(state.keySource, 'script-render');
});

test('probe waits for the site to finish loading its module', async () => {
  const h = pageHarness({ ready: false });
  const timer = setTimeout(() => { h.window.grecaptcha = { enterprise: h.api }; }, 20);
  try {
    assert.equal((await h.inspect(1000)).available, true);
  } finally { clearTimeout(timer); }
});

test('unknown script hosts and render=explicit are not accepted as site keys', async () => {
  for (const url of ['https://attacker.invalid/recaptcha/enterprise.js?render=bad',
    'https://www.google.com/recaptcha/enterprise.js?render=explicit']) {
    const state = await pageHarness({ scripts: [url] }).inspect();
    assert.equal(state.moduleReady, true);
    assert.equal(state.available, false);
    assert.equal(state.siteKey, '');
    assert.match(state.error, /No site key/);
  }
});

test('tab selection prefers the active project over home or Labs tabs', async () => {
  const h = pageHarness({ tabs: [
    { id: 1, url: 'https://labs.google/fx/tools/flow', active: false },
    { id: 2, url: 'https://flow.google.com/u/1/', active: true },
    { id: 3, url: 'https://flow.google.com/u/1/project/first', active: false },
    { id: 4, url: 'https://flow.google.com/u/1/project/second', active: true },
  ] });
  assert.equal(await h.run('findLabsTab()'), 4);
});

test('job uses the detected site key and requested action', async () => {
  const h = pageHarness();
  const result = await h.run("solveRecaptcha({ action: 'TEST_ACTION' })");
  assert.equal(result.token, 'test-token');
  assert.deepEqual(h.calls, [{ key: 'test-site-key', action: 'TEST_ACTION' }]);
});

test('execute failures remain failures instead of reporting ready as success', async () => {
  const h = pageHarness();
  h.api.execute = async () => { throw new Error('test execution failure'); };
  const result = await h.run("solveRecaptcha({ action: 'TEST_ACTION' })");
  assert.equal(result.token, null);
  assert.equal(result.error, 'test execution failure');
});
