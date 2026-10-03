const assert = require('node:assert/strict');
const { test } = require('node:test');
const vm = require('node:vm');
const { pageSource } = require('./helpers/modules.cjs');

// Sanitized fixture preserving the observed image RPC response structure:
const HAR_MOCK_IMAGE_RESPONSE = [
  [
    'wrb.fr',
    'ogiZ0b',
    JSON.stringify([
      [
        [
          '11111111-1111-4111-8111-111111111111',
          null,
          '22222222-2222-4222-8222-222222222222',
          null,
          null,
          null,
          [
            [
              null,
              1650433318,
              null,
              null,
              null,
              null,
              1,
              'cat',
              25,
              null,
              null,
              '22222222-2222-4222-8222-222222222222',
              null,
              'https://flow-content.google/image/11111111-1111-4111-8111-111111111111?Expires=1790812957&KeyName=labs-flow-prod-cdn-key&Signature=fixture-signature',
              2,
              [
                null,
                null,
                [
                  [
                    'cat',
                    null,
                    [[['cảt']]],
                  ],
                ],
                [],
              ],
              null,
              '11111111-1111-4111-8111-111111111111',
            ],
            null,
            [768, 1376],
          ],
        ],
      ],
      [
        [
          '22222222-2222-4222-8222-222222222222',
          null,
          null,
          ['cat', [1790791358, 962615000], null, null, '11111111-1111-4111-8111-111111111111'],
          '33333333-3333-4333-8333-333333333333',
        ],
      ],
    ]),
    null,
    null,
    null,
    'generic',
  ],
];

const HAR_MOCK_NZLXG_RESPONSE = [
  [
    'wrb.fr',
    'nzlxg',
    JSON.stringify([942, 1, 2, 2, null, 942, [1792341039, 461779000]]),
    null,
    null,
    null,
    'generic',
  ],
];

function createHarness() {
  const capturedCalls = [];
  const context = vm.createContext({
    window: {
      WIZ_global_data: {
        SNlM0e: 'fixture-csrf',
        FdrFJe: 'fixture-session',
        cfb2h: 'boq_labs-ai-sandbox-frontend_20260928.12_p0',
      },
      dispatchEvent: () => true,
    },
    location: {
      hostname: 'flow.google.com',
      origin: 'https://flow.google.com',
      pathname: '/project/33333333-3333-4333-8333-333333333333',
    },
    document: {
      documentElement: { lang: 'vi' },
      querySelectorAll: () => [],
    },
    URLSearchParams,
    AbortSignal,
    Event: class {},
    MouseEvent: class {},
    crypto: {
      randomUUID: (() => {
        let n = 0;
        return () => `TEST-UUID-${++n}`;
      })(),
    },
    console: {
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    fetch: async (url, options) => {
      const parsedUrl = new URL(url);
      const rpcId = parsedUrl.searchParams.get('rpcids');
      capturedCalls.push({
        url,
        rpcId,
        query: Object.fromEntries(parsedUrl.searchParams.entries()),
        headers: options.headers,
        body: options.body,
      });

      if (rpcId === 'nzlxg') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(HAR_MOCK_NZLXG_RESPONSE),
        };
      }

      if (rpcId === 'ogiZ0b') {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(HAR_MOCK_IMAGE_RESPONSE),
        };
      }

      return {
        ok: true,
        status: 200,
        text: async () => ')]}\'\n\n[[]]',
      };
    },
  });

  vm.runInContext(pageSource('src/providers/google-flow/page/image.js', 'runImageGenerationInPage'), context);
  return {
    calls: capturedCalls,
    run: (req, token) => context.runImageGenerationInPage(req, token),
  };
}

test('image generation successfully dispatches ogiZ0b matching HAR structure and parses result', async () => {
  const h = createHarness();
  const testToken = 'fixture-captcha';
  const result = await h.run({
    prompt: 'cảt',
    aspect_ratio: '9:16',
    model_key: 'GEM_PIX_2',
    project_id: '33333333-3333-4333-8333-333333333333',
    seed: 1650433318,
  }, testToken);

  assert.equal(result.ok, true, `Expected ok=true, got: ${result.error}`);
  assert.equal(result.images.length, 1);
  assert.equal(result.images[0].media_id, '11111111-1111-4111-8111-111111111111');
  assert.match(result.images[0].image_url, /https:\/\/flow-content\.google\/image\/11111111/);
  assert.equal(result.images[0].seed, 1650433318);
  assert.equal(result.images[0].dimensions[0], 768);
  assert.equal(result.images[0].dimensions[1], 1376);

  // Check RPC calls: should call preflight nzlxg then ogiZ0b
  assert.ok(h.calls.length >= 2, `Expected at least 2 calls (nzlxg and ogiZ0b), got ${h.calls.length}`);
  const ogiCall = h.calls.find((c) => c.rpcId === 'ogiZ0b');
  assert.ok(ogiCall, 'Expected ogiZ0b call');

  // Verify query params against HAR
  assert.equal(ogiCall.query['source-path'], '/project/33333333-3333-4333-8333-333333333333');
  assert.equal(ogiCall.query.bl, 'boq_labs-ai-sandbox-frontend_20260928.12_p0');
  assert.equal(ogiCall.query['f.sid'], 'fixture-session');
  assert.equal(ogiCall.query.rt, 'c');

  // Verify ogiZ0b payload structure matches HAR exactly
  const form = new URLSearchParams(ogiCall.body);
  assert.equal(form.get('at'), 'fixture-csrf');
  const outer = JSON.parse(form.get('f.req'));
  assert.equal(outer[0][0][0], 'ogiZ0b');
  assert.equal(outer[0][0][3], 'generic');

  const inner = JSON.parse(outer[0][0][1]);
  assert.equal(inner.length, 5);
  assert.equal(inner[0], null);
  assert.equal(inner[2], 1);

  // Check captcha slot in root payload
  const rootCaptchaSlot = inner[3];
  assert.equal(rootCaptchaSlot[1], 22);
  assert.equal(rootCaptchaSlot[5], '33333333-3333-4333-8333-333333333333');
  assert.deepEqual(rootCaptchaSlot[10], [testToken, 1]);

  // Check item payload
  const item = inner[1][0];
  assert.equal(item.length, 14);
  assert.equal(item[3], 1650433318); // seed
  assert.equal(item[4], 2); // aspect ratio enum for 9:16
  assert.equal(item[5], 'GEM_PIX_2'); // modelKey
  assert.deepEqual(item[7][10], [testToken, 1]); // item captcha slot
  assert.deepEqual(item[8], [[['cảt']]]); // prompt
});

test('image aspect ratio mapping covers all 5 ratios', async () => {
  const h = createHarness();
  const testToken = 'token-123';
  const ratios = [
    { name: '16:9', enumVal: 3 },
    { name: '1:1', enumVal: 1 },
    { name: '9:16', enumVal: 2 },
    { name: '4:3', enumVal: 4 },
    { name: '3:4', enumVal: 5 },
  ];

  for (const r of ratios) {
    const res = await h.run({
      prompt: 'test ratio',
      aspect_ratio: r.name,
      project_id: '33333333-3333-4333-8333-333333333333',
    }, testToken);
    assert.equal(res.ok, true);
    const ogiCall = h.calls.pop();
    const form = new URLSearchParams(ogiCall.body);
    const outer = JSON.parse(form.get('f.req'));
    const inner = JSON.parse(outer[0][0][1]);
    const item = inner[1][0];
    assert.equal(item[4], r.enumVal, `Expected enum ${r.enumVal} for ratio ${r.name}`);
  }
});
