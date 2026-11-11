// Motion Control (Omni 1.2, video_edit) qua HTTP jIps6. Hình dạng request/response lấy từ HAR flow.google_video_motion.com
// (2026-11-11) và trạng thái xử lý video mẫu từ flow.google_image.har; mọi id/chữ ký là giả.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const api = import('../src/providers/google-flow/page/video-http.js');
const PROJECT = '958030aa-aeec-4700-b1d2-0b8747961208';
const VIDEO = '6b600f7b-b779-4c7d-86c8-87e0187d93ec';
const CHAR = '0e462dd0-b83c-4414-b0ec-1f8fbb5d158d';
const SCENE = '11111111-2222-4333-8444-555555555555';
const OUT = '2dddb780-90ef-4009-9374-4a6a19eb3ec8';
const URL_OUT = `https://flow-content.google/video/${OUT}?Expires=1&Signature=x`;

const baseReq = {
  prompt: 'Apply the pose and motion from the input video to the person in the image.',
  provider_model_id: 'macaron_cookie_edit', input_mode: 'video_edit', transport: 'http', resolution: '720p',
  num_outputs: 1, aspect_ratio: '9:16', project_id: PROJECT, reference_video_id: VIDEO,
  reference_video_start_seconds: 0, reference_video_end_seconds: 8,
  ingredient_inputs: [{ media_id: CHAR }], ingredient_media_ids: [CHAR], ingredient_images: [],
};

const envelope = (rpc, payload) => ")]}'\n\n123\n" + JSON.stringify([['wrb.fr', rpc, JSON.stringify(payload), null, null, null, 'generic']]);
const record = (id, state) => [id, PROJECT, 'wf', 'CAE', null, [[1, 0], 'p', null, null, null, null, [null, null, null, null, 1], null, [state], 1]];
// Response jIps6 thật: [null, sốDư, [[workflow...]], [[record]]]
const created = [null, 464, [['wf-id', null, null, ['p', [1, 0]], PROJECT]], [[OUT, PROJECT, 'wf-id', null, null, [[1, 0], 'p', null, null, null, null, [], null, [6], 1]]]];

async function run(request, handlers, opts = {}) {
  const { runFlowHttpVideoInPage } = await api;
  const calls = [];
  const fn = vm.runInNewContext(`(${runFlowHttpVideoInPage.toString()})`, {
    location: { hostname: 'flow.google.com', pathname: `/project/${PROJECT}`, origin: 'https://flow.google.com' },
    window: {
      WIZ_global_data: { SNlM0e: 'AT', FdrFJe: '7700000000000000000', cfb2h: 'boq' },
      grecaptcha: { enterprise: { ready: (cb) => cb(), execute: async () => 'CAPTCHA_TOKEN' } },
    },
    document: { documentElement: { lang: 'en' }, scripts: [{ src: 'https://www.google.com/recaptcha/enterprise.js?render=KEY' }], querySelectorAll: () => [] },
    performance: { getEntriesByType: () => [] },
    crypto: { randomUUID: () => '44444444-4444-4444-8444-444444444444' },
    URL, URLSearchParams, Date, setTimeout, JSON, Promise, Number, String, Array, Math,
    fetch: async (url, options) => {
      const u = new URL(url);
      const rpc = u.searchParams.get('rpcids');
      const frame = JSON.parse(new URLSearchParams(options.body).get('f.req'))[0][0];
      const call = { rpc, payload: JSON.parse(frame[1]) };
      calls.push(call);
      const out = handlers[rpc](call, calls.filter((c) => c.rpc === rpc).length);
      return { ok: true, status: 200, text: async () => out };
    },
  });
  const result = JSON.parse(JSON.stringify(await fn(request, null, { pollMs: 1, timeoutMs: 2000, sourceReadyTimeoutMs: 200, ...opts })));
  return { result, calls };
}

// Video mẫu: 2 lần poll "đang xử lý" (1) rồi sẵn sàng (3); video kết quả: 6 -> 3.
const happy = {
  jwpduf: (call, n) => {
    const id = call.payload[2][0][0];
    if (id === VIDEO) return envelope('jwpduf', [null, null, [record(VIDEO, n < 3 ? 1 : 3)]]);
    return envelope('jwpduf', [null, null, [record(OUT, 3)]]);
  },
  jIps6: () => envelope('jIps6', created),
  // as29s: URL mp4 nằm ở [7][0][8]
  as29s: () => envelope('as29s', [OUT, PROJECT, null, null, null, [], null, [[null, null, null, null, null, null, null, null, URL_OUT]]]),
  maseQ: () => envelope('maseQ', [[SCENE, PROJECT]]),
};

test('canUseHttpVideo: Motion Control 1.2 đi HTTP khi đủ điều kiện đã có HAR', async () => {
  const { canUseHttpVideo } = await api;
  assert.equal(canUseHttpVideo(baseReq), true);
  assert.equal(canUseHttpVideo({ ...baseReq, aspect_ratio: '16:9' }), true);
  assert.equal(canUseHttpVideo({ ...baseReq, transport: 'ui' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, provider_model_id: 'abra_edit' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, resolution: '360p' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, reference_video_id: 'not-a-uuid' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, reference_video_end_seconds: 11 }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, reference_video_start_seconds: 5, reference_video_end_seconds: 5 }), false);
  // Chưa có HAR cho trường hợp không ảnh -> vẫn đi giao diện
  assert.equal(canUseHttpVideo({ ...baseReq, ingredient_inputs: [], ingredient_media_ids: [] }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, num_outputs: 2 }), false);
  // Ảnh cục bộ phải có base64
  assert.equal(canUseHttpVideo({ ...baseReq, ingredient_inputs: [{ local_path: 'C:/a.png', filename: 'a.png' }], ingredient_media_ids: [], ingredient_images: [{ filename: 'a.png' }] }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, ingredient_inputs: [{ local_path: 'C:/a.png', filename: 'a.png' }], ingredient_media_ids: [], ingredient_images: [{ filename: 'a.png', base64: 'AAAA' }] }), true);
});

test('motionImageOrder giữ thứ tự nhân vật rồi bối cảnh, trộn media id có sẵn và ảnh cục bộ', async () => {
  const { motionImageOrder } = await api;
  assert.deepEqual(motionImageOrder({ ingredient_inputs: [{ local_path: 'a' }, { media_id: SCENE }], ingredient_images: [{ base64: 'x' }] }),
    [{ image_index: 0 }, { media_id: SCENE }]);
  assert.equal(motionImageOrder({ ingredient_inputs: [{ local_path: 'a' }], ingredient_images: [{ base64: 'x' }, { base64: 'y' }] }), null);
  assert.equal(motionImageOrder({ ingredient_inputs: [1, 2, 3, 4].map(() => ({ media_id: CHAR })) }), null);
});

test('jIps6 dựng đúng như HAR, đợi video mẫu xử lý xong rồi mới gửi, rồi poll và lấy URL', async () => {
  const { result, calls } = await run(baseReq, happy);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.media_id, OUT);
  assert.equal(result.video_url, URL_OUT);
  assert.equal(result.credit_balance, 464);
  assert.equal(result.diagnostics.adapter, 'motion-http-v1');
  // 3 lần hỏi trạng thái video mẫu (1, 1, 3) TRƯỚC khi gửi jIps6
  assert.deepEqual(calls.map((c) => c.rpc), ['jwpduf', 'jwpduf', 'jwpduf', 'jIps6', 'jwpduf', 'as29s']);
  const [item] = calls.find((c) => c.rpc === 'jIps6').payload[0];
  assert.deepEqual(item[0], [null, VIDEO, 0, 240]);                      // 8 giây × 30 khung hình, như HAR
  assert.deepEqual(item[1], [null, null, [[[baseReq.prompt]]]]);
  assert.equal(item[2], 'macaron_cookie_edit');
  assert.equal(item[3], 1);
  assert.deepEqual(item[4].slice(0, 4), [null, null, null, null]);
  assert.deepEqual(item.slice(5, 8), [null, null, null]);
  assert.deepEqual(item[8], [[null, CHAR]]);
  const ctx = calls.find((c) => c.rpc === 'jIps6').payload[1];
  assert.equal(ctx[5], PROJECT);
  assert.deepEqual(ctx[10], ['CAPTCHA_TOKEN', 1]);
});

test('ảnh cục bộ được tải lên trước và giữ đúng vị trí Image 1 / Image 2', async () => {
  const req = { ...baseReq, reference_video_start_seconds: 1.5, reference_video_end_seconds: 4.5,
    ingredient_inputs: [{ local_path: 'C:/char.png', filename: 'char.png' }, { media_id: CHAR }],
    ingredient_media_ids: [CHAR], ingredient_images: [{ base64: 'AAAA', mime: 'image/png', filename: 'char.png' }] };
  const { result, calls } = await run(req, happy);
  assert.equal(result.ok, true, result.error);
  assert.equal(calls[0].rpc, 'maseQ');
  const [item] = calls.find((c) => c.rpc === 'jIps6').payload[0];
  assert.deepEqual(item[0], [null, VIDEO, 45, 135]);
  assert.deepEqual(item[8], [[null, SCENE], [null, CHAR]]);             // ảnh vừa tải (SCENE id giả) đứng đầu
});

test('video mẫu không còn trong project hoặc xử lý quá lâu: báo lỗi, KHÔNG gửi jIps6', async () => {
  const missing = { ...happy, jwpduf: () => envelope('jwpduf', [null, null, []]) };
  let out = await run(baseReq, missing);
  assert.equal(out.result.ok, false);
  assert.equal(out.result.submitted, false);
  assert.match(out.result.error, /không tìm thấy video mẫu/);
  assert.equal(out.calls.some((c) => c.rpc === 'jIps6'), false);

  const slow = { ...happy, jwpduf: () => envelope('jwpduf', [null, null, [record(VIDEO, 1)]]) };
  out = await run(baseReq, slow, { sourceReadyTimeoutMs: 5 });
  assert.equal(out.result.submitted, false);
  assert.match(out.result.error, /chưa xử lý xong/);
  assert.equal(out.calls.some((c) => c.rpc === 'jIps6'), false);

  const broken = { ...happy, jwpduf: () => envelope('jwpduf', [null, null, [record(VIDEO, 7)]]) };
  out = await run(baseReq, broken);
  assert.equal(out.result.submitted, false);
  assert.match(out.result.error, /trạng thái 7/);
});
