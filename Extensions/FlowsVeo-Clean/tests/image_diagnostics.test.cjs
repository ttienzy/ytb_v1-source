const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { pageSource } = require('./helpers/modules.cjs');

function harness(networkFailure = false) {
  const logs = [];
  let requests = 0;
  const context = vm.createContext({
    window: { WIZ_global_data: { SNlM0e: 'SECRET_CSRF', FdrFJe: 'SECRET_SESSION', cfb2h: 'build' } },
    location: { hostname: 'flow.google.com', origin: 'https://flow.google.com', pathname: '/project/fixture' },
    document: { documentElement: { lang: 'en' } },
    URLSearchParams, AbortSignal,
    crypto: { randomUUID: () => 'FIXTURE' },
    console: { info: (...args) => logs.push(args), warn: (...args) => logs.push(args) },
    fetch: async () => {
      requests++;
      if (networkFailure) throw new Error('network failure');
      return {
        ok: true, status: 200,
        text: async () => JSON.stringify([
          ['wrb.fr', 'ogiZ0b', null, null, null,
            [7, null, [['type.googleapis.com/google.rpc.ErrorInfo', ['PUBLIC_ERROR_UNUSUAL_ACTIVITY']]]], 'generic'],
        ]),
      };
    },
  });
  vm.runInContext(pageSource('src/providers/google-flow/page/image.js', 'runImageGenerationInPage'), context);
  return {
    logs,
    requests: () => requests,
    run: () => context.runImageGenerationInPage({ prompt: 'PRIVATE_PROMPT', project_id: 'fixture' }, 'SECRET_CAPTCHA'),
  };
}

test('HTTP 200 can carry a provider rejection; diagnostics contain no session secrets', async () => {
  const h = harness();
  const result = await h.run();
  assert.equal(result.ok, false);
  assert.match(result.error, /PUBLIC_ERROR_UNUSUAL_ACTIVITY/);
  assert.equal(result.diagnostics.http_status, 200);
  assert.equal(result.diagnostics.phase, 'rpc-response');
  assert.equal(result.diagnostics.session_ready, true);
  assert.equal(result.diagnostics.project_matches, true);
  assert.ok(h.requests() >= 1);
  assert.doesNotMatch(JSON.stringify([result.diagnostics, h.logs]), /SECRET_|PRIVATE_PROMPT/);
});

test('network failure stays distinct from an RPC rejection and is not replayed', async () => {
  const h = harness(true);
  const result = await h.run();
  assert.equal(result.ok, false);
  assert.equal(result.diagnostics.http_status, null);
  assert.equal(result.diagnostics.phase, 'fetch');
  assert.ok(h.requests() >= 1);
});
