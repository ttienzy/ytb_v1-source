const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');

const source = readFileSync(join(__dirname, '..', 'background.js'), 'utf8');
const start = source.indexOf('async function runFlowGenerationInPage(');
const end = source.indexOf('async function generateFlowVideo(', start);
assert.ok(start > 0 && end > start);
const adapterSource = source.slice(start, end);

function asset(status, videoUrl = null) {
  const item = ['media-test', null, null, 'CAE', null, []];
  const progress = [];
  progress[8] = [status];
  progress[10] = 'https://flow-content.google/preview.jpg';
  item[5][0] = progress;
  if (videoUrl) {
    const video = [];
    video[8] = videoUrl;
    item[5][2] = [video];
  }
  return item;
}

function harness() {
  const calls = [];
  const replies = {
    YhhmEf: [asset(2)],
    jwpduf: [asset(3)],
    as29s: [asset(3, 'https://flow-content.google/result.mp4?Signature=test')],
  };
  const context = vm.createContext({
    window: { WIZ_global_data: { SNlM0e: 'csrf-test', FdrFJe: 'session-test', cfb2h: 'build-test' } },
    location: {
      hostname: 'flow.google.com', origin: 'https://flow.google.com',
      pathname: '/u/1/project/project-test',
    },
    document: { documentElement: { lang: 'en-US' } },
    URL, URLSearchParams, AbortSignal,
    crypto: { randomUUID: (() => { let n = 0; return () => `uuid-${++n}`; })() },
    setTimeout: (callback) => { callback(); return 1; }, clearTimeout() {},
    fetch: async (url, options) => {
      const rpcId = new URL(url).searchParams.get('rpcids');
      const form = new URLSearchParams(options.body);
      calls.push({ rpcId, url, options, outer: JSON.parse(form.get('f.req')), at: form.get('at') });
      const frame = ['wrb.fr', rpcId, JSON.stringify(replies[rpcId])];
      return { ok: true, status: 200, text: async () => `)]}'\n\n${JSON.stringify(frame)}\n` };
    },
  });
  vm.runInContext(adapterSource, context);
  return {
    calls,
    run: (request, token = 'captcha-test') => context.runFlowGenerationInPage(request, token),
  };
}

const verifiedRequest = {
  prompt: 'Cat', input_mode: 'text_to_video', model_display_name: 'Omni 1.1 Flash',
  duration_seconds: 6, resolution: '720p', aspect_ratio: '16:9', num_outputs: 1,
};

test('adapter reproduces the verified create, poll, and final RPC sequence', async () => {
  const h = harness();
  const result = await h.run(verifiedRequest);
  assert.equal(result.ok, true);
  assert.equal(result.video_url, 'https://flow-content.google/result.mp4?Signature=test');
  assert.equal(result.media_id, 'media-test');
  assert.deepEqual(h.calls.map((call) => call.rpcId), ['YhhmEf', 'jwpduf', 'as29s']);

  const createCall = h.calls[0];
  assert.equal(createCall.at, 'csrf-test');
  assert.equal(new URL(createCall.url).searchParams.get('source-path'), '/u/1/project/project-test');
  const createPayload = JSON.parse(createCall.outer[0][0][1]);
  assert.equal(createPayload[0][0][0][2][0][0][0], 'Cat');
  assert.equal(createPayload[0][0][1], 'abra_t2v_6s');
  assert.equal(createPayload[1][5], 'project-test');
  assert.ok(typeof createPayload[2][0] === 'string' && createPayload[2][0].length > 0);
  assert.equal(createPayload[2][1], 2);

  const pollPayload = JSON.parse(h.calls[1].outer[0][0][1]);
  assert.equal(pollPayload[2][0][0], 'media-test');
  const finalPayload = JSON.parse(h.calls[2].outer[0][0][1]);
  assert.equal(finalPayload[0], 'media-test');
});

test('adapter rejects unverified variants before making a Flow request', async () => {
  const h = harness();
  const result = await h.run({ ...verifiedRequest, duration_seconds: 8 });
  assert.equal(result.ok, false);
  assert.match(result.error, /duration_seconds/);
  assert.equal(h.calls.length, 0);
});

test('adapter requires a logged-in Flow project session', async () => {
  const h = harness();
  h.calls.length = 0;
  const result = await h.run({ ...verifiedRequest, prompt: '' });
  assert.equal(result.ok, false);
  assert.match(result.error, /prompt is empty/);
  assert.equal(h.calls.length, 0);
});
