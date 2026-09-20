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

function harness(options = {}) {
  const calls = [];
  const replies = {
    maseQ: [['uploaded-frame-media-id', 'project-test']],
    YhhmEf: [asset(2)],
    nprQif: [asset(2)],
    MZZa6b: [asset(2)],
    jIps6: [asset(2)],
    jwpduf: [asset(3)],
    as29s: [asset(3, options.finalUrl || 'https://flow-content.google/result.mp4?Signature=test')],
  };
  const context = vm.createContext({
    window: { WIZ_global_data: { SNlM0e: 'csrf-test', FdrFJe: 'session-test', cfb2h: 'build-test' } },
    location: {
      hostname: 'flow.google.com', origin: 'https://flow.google.com',
      pathname: '/u/1/project/project-test',
    },
    document: { documentElement: { lang: 'en-US' } },
    URL, URLSearchParams, AbortSignal, Blob, atob, Uint8Array,
    crypto: { randomUUID: (() => { let n = 0; return () => `uuid-${++n}`; })() },
    setTimeout: (callback) => { callback(); return 1; }, clearTimeout() {},
    fetch: async (url, options) => {
      if (url.includes('/upload/')) {
        const cmd = options?.headers?.['x-goog-upload-command'];
        if (cmd === 'start') {
          return {
            ok: true, status: 200,
            headers: {
              get: (h) => (h.toLowerCase() === 'x-goog-upload-url' ? 'https://flow.google.com/upload/session-mock' : null),
            },
          };
        }
        return {
          ok: true, status: 200,
          json: async () => ({ mediaId: 'uploaded-frame-media-id' }),
        };
      }
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

const verifiedProfiles = [
  {
    model_display_name: 'Omni 1.1 Flash', provider_model_id: 'abra_t2v_6s',
    duration_seconds: 6, credit_cost: 10,
  },
  {
    model_display_name: 'Veo 3.1 - Lite', provider_model_id: 'veo_3_1_t2v_lite',
    duration_seconds: 8, credit_cost: 10,
  },
  {
    model_display_name: 'Veo 3.1 - Fast', provider_model_id: 'veo_3_1_t2v_fast_portrait',
    duration_seconds: 8, credit_cost: 20,
  },
];

function verifiedRequest(profile = verifiedProfiles[0]) {
  return {
    prompt: 'Cat', input_mode: 'text_to_video', aspect_ratio: '9:16',
    resolution: '720p', num_outputs: 1, ...profile,
  };
}

for (const profile of verifiedProfiles) {
  test(`adapter dispatches verified profile ${profile.provider_model_id}`, async () => {
    const h = harness();
    const result = await h.run(verifiedRequest(profile));
    assert.equal(result.ok, true);
    assert.equal(result.video_url, 'https://flow-content.google/result.mp4?Signature=test');
    assert.equal(result.media_id, 'media-test');
    assert.equal(result.provider_model_id, profile.provider_model_id);
    assert.deepEqual(h.calls.map((call) => call.rpcId), ['YhhmEf', 'jwpduf', 'as29s']);

    const createCall = h.calls[0];
    assert.equal(createCall.at, 'csrf-test');
    assert.equal(new URL(createCall.url).searchParams.get('source-path'), '/u/1/project/project-test');
    const createPayload = JSON.parse(createCall.outer[0][0][1]);
    assert.equal(createPayload[0][0][0][2][0][0][0], 'Cat');
    assert.equal(createPayload[0][0][1], profile.provider_model_id);
    assert.equal(createPayload[0][0][2], 1);
    assert.equal(createPayload[1][5], 'project-test');
    assert.ok(typeof createPayload[2][0] === 'string' && createPayload[2][0].length > 0);
    assert.equal(createPayload[2][1], 2);

    const pollPayload = JSON.parse(h.calls[1].outer[0][0][1]);
    assert.equal(pollPayload[2][0][0], 'media-test');
    const finalPayload = JSON.parse(h.calls[2].outer[0][0][1]);
    assert.equal(finalPayload[0], 'media-test');
  });
}

test('adapter rejects invalid aspect ratio before making a Flow request', async () => {
  const h = harness();
  const result = await h.run({ ...verifiedRequest(), aspect_ratio: '4:3' });
  assert.equal(result.ok, false);
  assert.match(result.error, /aspect_ratio/);
  assert.equal(h.calls.length, 0);
});

test('adapter dispatches 16:9 aspect ratio successfully', async () => {
  const h = harness();
  const result = await h.run({ ...verifiedRequest(), aspect_ratio: '16:9' });
  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 3);
  const createPayload = JSON.parse(h.calls[0].outer[0][0][1]);
  assert.equal(createPayload[0][0][2], 2);
  assert.equal(createPayload[2][1], 2);
});

test('adapter requires a logged-in Flow project session', async () => {
  const h = harness();
  h.calls.length = 0;
  const result = await h.run({ ...verifiedRequest(), prompt: '' });
  assert.equal(result.ok, false);
  assert.match(result.error, /prompt is empty/);
  assert.equal(h.calls.length, 0);
});

test('adapter uploads frames and dispatches nprQif with frame media asset slots', async () => {
  const h = harness();
  const framesReq = {
    ...verifiedRequest(),
    input_mode: 'frames',
    prompt: 'cá chép hóa rồng',
    image_base64: Buffer.from('FAKE_CARP_IMAGE').toString('base64'),
    image_mime: 'image/png',
    image_name: 'carp.png',
    end_image_base64: Buffer.from('FAKE_DRAGON_IMAGE').toString('base64'),
    end_image_mime: 'image/png',
    end_image_name: 'dragon.png',
  };
  const result = await h.run(framesReq);
  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 5);
  assert.equal(h.calls[0].rpcId, 'maseQ');
  assert.equal(h.calls[1].rpcId, 'maseQ');
  assert.equal(h.calls[2].rpcId, 'nprQif');
  const createPayload = JSON.parse(h.calls[2].outer[0][0][1]);
  assert.equal(createPayload[0][0][1], 'omni_flash_i2v_10s_first_last');
  const startSlot = createPayload[0][0][4];
  const endSlot = createPayload[0][0][5];
  assert.deepEqual(startSlot, [null, 'uploaded-frame-media-id', null, null, null, [null, 0.341796875, 1, 0.658203125]]);
  assert.deepEqual(endSlot, [null, 'uploaded-frame-media-id', null, null, null, [null, 0.341796875, 1, 0.658203125]]);
  assert.equal(createPayload[0][0][0][2][0][0][0], 'cá chép hóa rồng');
});

test('adapter uploads only start frame and dispatches MZZa6b with abra_r2v_6s', async () => {
  const h = harness();
  const singleFrameReq = {
    ...verifiedRequest(),
    input_mode: 'frames',
    prompt: 'cá chép bơi lội',
    duration_seconds: 6,
    image_base64: Buffer.from('FAKE_CARP_IMAGE').toString('base64'),
    image_mime: 'image/png',
    image_name: 'carp.png',
    end_image_base64: null,
  };
  const result = await h.run(singleFrameReq);
  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 4); // 1 maseQ upload + 1 MZZa6b + 2 polling
  assert.equal(h.calls[0].rpcId, 'maseQ');
  assert.equal(h.calls[1].rpcId, 'MZZa6b');
  const createPayload = JSON.parse(h.calls[1].outer[0][0][1]);
  assert.equal(createPayload[0][0][2], 'abra_r2v_6s');
  const refSlots = createPayload[0][0][1];
  assert.deepEqual(refSlots, [[null, 'uploaded-frame-media-id']]);
  assert.equal(createPayload[0][0][0][2][0][0][0], 'cá chép bơi lội');
});

test('adapter rejects frames request if only end frame is provided without start frame', async () => {
  const h = harness();
  const invalidReq = {
    ...verifiedRequest(),
    input_mode: 'frames',
    prompt: 'cá chép bơi lội',
    image_base64: null,
    end_image_base64: Buffer.from('FAKE_DRAGON_IMAGE').toString('base64'),
    end_image_mime: 'image/png',
    end_image_name: 'dragon.png',
  };
  const result = await h.run(invalidReq);
  assert.equal(result.ok, false);
  assert.match(result.error, /Start Frame/);
});

test('adapter uploads ingredient images and dispatches MZZa6b with reference asset slots', async () => {
  const h = harness();
  const ingrReq = {
    ...verifiedRequest(),
    input_mode: 'ingredients',
    prompt: 'cá chép hóa rồng',
    ingredient_images: [
      { base64: Buffer.from('FAKE_IMG_1').toString('base64'), mime: 'image/png', filename: 'subject.png' },
      { base64: Buffer.from('FAKE_IMG_2').toString('base64'), mime: 'image/png', filename: 'scene.png' },
    ],
  };
  const result = await h.run(ingrReq);
  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 5);
  assert.equal(h.calls[0].rpcId, 'maseQ');
  assert.equal(h.calls[1].rpcId, 'maseQ');
  assert.equal(h.calls[2].rpcId, 'MZZa6b');
  const createPayload = JSON.parse(h.calls[2].outer[0][0][1]);
  assert.equal(createPayload[0][0][2], 'abra_r2v_6s');
  const refSlots = createPayload[0][0][1];
  assert.deepEqual(refSlots, [
    [null, 'uploaded-frame-media-id'],
    [null, 'uploaded-frame-media-id'],
  ]);
  assert.equal(createPayload[0][0][0][2][0][0][0], 'cá chép hóa rồng');
});

test('adapter accepts Flow result CDN URLs without the legacy signature/path shape', async () => {
  const h = harness({ finalUrl: 'https://flow-content.google/media/generated-result?download=1' });
  const result = await h.run(verifiedRequest());
  assert.equal(result.ok, true);
  assert.equal(result.video_url, 'https://flow-content.google/media/generated-result?download=1');
});

test('adapter dispatches uploaded video references through jIps6 video edit', async () => {
  const h = harness();
  const result = await h.run({
    ...verifiedRequest(),
    input_mode: 'video_edit',
    prompt: 'Keep the same subject and motion in a sunny garden.',
    duration_seconds: 10,
    resolution: '360p',
    provider_model_id: 'abra_edit_360p',
    reference_video_id: 'uploaded-video-media-id',
    reference_video_start_seconds: 0,
    reference_video_end_seconds: 10,
  });

  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 3);
  assert.equal(h.calls[0].rpcId, 'jIps6');
  const createPayload = JSON.parse(h.calls[0].outer[0][0][1]);
  const editRequest = createPayload[0][0];
  assert.deepEqual(editRequest[0], [null, 'uploaded-video-media-id', 0, 240]);
  assert.equal(editRequest[1][2][0][0][0], 'Keep the same subject and motion in a sunny garden.');
  assert.equal(editRequest[2], 'abra_edit_360p');
  assert.equal(editRequest[3], 1);
  assert.deepEqual(editRequest[12], [4]);
});

test('adapter combines a video motion source with an uploaded image reference', async () => {
  const h = harness();
  const result = await h.run({
    ...verifiedRequest(),
    input_mode: 'video_edit',
    prompt: 'Use the woman from the image and preserve the dance motion from the video.',
    resolution: '360p',
    provider_model_id: 'abra_edit_360p',
    reference_video_id: 'uploaded-video-media-id',
    reference_video_start_seconds: 0,
    reference_video_end_seconds: 10,
    ingredient_images: [{
      base64: Buffer.from('FAKE_REFERENCE_IMAGE').toString('base64'),
      mime: 'image/jpeg',
      filename: 'subject.jpg',
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(h.calls.length, 4);
  assert.equal(h.calls[0].rpcId, 'maseQ');
  assert.equal(h.calls[1].rpcId, 'jIps6');
  const createPayload = JSON.parse(h.calls[1].outer[0][0][1]);
  const editRequest = createPayload[0][0];
  assert.deepEqual(editRequest[0], [null, 'uploaded-video-media-id', 0, 240]);
  assert.deepEqual(editRequest[8], [[null, 'uploaded-frame-media-id']]);
  assert.deepEqual(editRequest[12], [4]);
});

test('force_fresh_assets uploads the same image again for a repeated video edit', async () => {
  const h = harness();
  const request = {
    ...verifiedRequest(),
    input_mode: 'video_edit',
    prompt: 'Transfer motion to the referenced subject.',
    resolution: '360p',
    provider_model_id: 'abra_edit_360p',
    reference_video_id: 'uploaded-video-media-id',
    ingredient_images: [{
      base64: Buffer.from('SAME_REFERENCE_IMAGE').toString('base64'),
      mime: 'image/jpeg',
      filename: 'subject.jpg',
    }],
  };

  await h.run(request);
  h.calls.length = 0;
  await h.run(request);
  assert.equal(h.calls[0].rpcId, 'jIps6');

  h.calls.length = 0;
  await h.run({ ...request, force_fresh_assets: true });
  assert.equal(h.calls[0].rpcId, 'maseQ');
  assert.equal(h.calls[1].rpcId, 'jIps6');
});


