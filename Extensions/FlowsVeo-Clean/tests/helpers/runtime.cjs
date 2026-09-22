const vm = require('node:vm');
const { loadModules } = require('./modules.cjs');

function event() {
  const listeners = [];
  return { listeners, addListener: fn => listeners.push(fn), removeListener: fn => {
    const index = listeners.indexOf(fn); if (index >= 0) listeners.splice(index, 1);
  } };
}

function harness(files, overrides = {}) {
  const requests = [], reloads = [], removals = [], timers = [];
  const storage = { ...(overrides.storage || {}) };
  const tabs = overrides.tabs || [{ id: 12, windowId: 1, active: true, status: 'complete', url: 'https://flow.google.com/u/1/project/project-test' }];
  const chrome = {
    runtime: { onMessage: event(), onInstalled: event(), onStartup: event(), onConnect: event(),
      getManifest: () => ({ version: '1.0.10' }), getPlatformInfo: async () => ({}), reload() {} },
    tabs: { onUpdated: event(), query: async () => tabs, get: async id => tabs.find(t => t.id === id),
      update: async (id, values) => Object.assign(tabs.find(t => t.id === id) || {}, values),
      reload: async id => reloads.push(id), create: async values => ({ id: 13, ...values }), sendMessage: async () => ({}) },
    windows: { update: async () => ({}) },
    cookies: { onChanged: event(), getAll: async () => [], getAllCookieStores: async () => [], remove: async () => {} },
    alarms: { onAlarm: event(), create() {}, clear() {} },
    browsingData: { remove: async (...args) => removals.push(args) },
    storage: { local: {
      get: async keys => Object.fromEntries(keys.filter(k => k in storage).map(k => [k, storage[k]])),
      set: async values => Object.assign(storage, values),
      remove: async keys => { for (const key of Array.isArray(keys) ? keys : [keys]) delete storage[key]; },
    } },
    scripting: { executeScript: async () => [] },
  };
  const context = vm.createContext({
    chrome, URL, URLSearchParams, AbortSignal, Blob, atob, btoa, Uint8Array, TextEncoder,
    navigator: { userAgent: 'test-browser' }, crypto: { randomUUID: () => 'test-extension-instance' },
    console: { log() {} },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); return timers.length; }, clearTimeout() {},
    setInterval: (fn, ms) => { timers.push({ fn, ms, interval: true }); return timers.length; }, clearInterval() {},
    fetch: async (url, options = {}) => {
      requests.push({ url, path: new URL(url).pathname, options, body: options.body ? JSON.parse(options.body) : null });
      return overrides.fetch ? overrides.fetch(url, options) : { ok: true, status: 200, json: async () => ({}) };
    },
  });
  const api = loadModules(['src/background/runtime/state.js', ...files], context);
  Object.assign(api.runtime, { bridgeSecret: 'fixture-key', extFp: 'fixture-instance', autoReloadEnabled: false });
  return { api, context, chrome, storage, requests, reloads, removals, timers };
}

async function until(predicate) {
  for (let i = 0; i < 100; i++) { if (predicate()) return; await new Promise(resolve => setImmediate(resolve)); }
  throw new Error('Condition did not settle');
}

module.exports = { event, harness, until };
