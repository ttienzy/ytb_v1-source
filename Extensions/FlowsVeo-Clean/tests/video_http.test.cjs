// Test đường HTTP thuần tạo video Flow. Fixture = response thật trong HAR 2026-11-09 (id/chữ ký đã thay giả).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fx = require('./fixtures/flow-http-t2v.json');

const api = import('../src/providers/google-flow/page/video-http.js');
const MODEL = 'macaron_cookie_t2v_10s';
const baseReq = { prompt: 'dragon', provider_model_id: MODEL, input_mode: 'text_to_video', transport: 'http', resolution: '720p', num_outputs: 1, aspect_ratio: '9:16' };

const envelope = (rpc, payload) => ")]}'\n\n123\n" + JSON.stringify([['wrb.fr', rpc, JSON.stringify(payload), null, null, null, 'generic']]);

async function run(request, handlers, { pathname = `/u/1/project/${fx.project_id}`, grecaptcha } = {}) {
  const { runFlowHttpVideoInPage } = await api;
  const calls = [];
  const fn = vm.runInNewContext(`(${runFlowHttpVideoInPage.toString()})`, {
    location: { hostname: 'flow.google.com', pathname, origin: 'https://flow.google.com' },
    window: {
      WIZ_global_data: { SNlM0e: 'AT_TOKEN', FdrFJe: '7700000000000000000', cfb2h: 'boq_build' },
      grecaptcha: grecaptcha ?? { enterprise: { ready: (cb) => cb(), execute: async () => 'CAPTCHA_TOKEN' } },
    },
    document: { documentElement: { lang: 'en' }, scripts: [{ src: 'https://www.google.com/recaptcha/enterprise.js?render=SITEKEY' }], querySelectorAll: () => [] },
    performance: { getEntriesByType: () => [] },
    crypto: { randomUUID: () => '44444444-4444-4444-8444-444444444444' },
    URL, URLSearchParams, Date, setTimeout, JSON, Promise, Number, String, Array, Math,
    fetch: async (url, options) => {
      const u = new URL(url);
      const rpc = u.searchParams.get('rpcids');
      const form = new URLSearchParams(options.body);
      const frame = JSON.parse(form.get('f.req'))[0][0];
      const call = { rpc, path: u.pathname, source: u.searchParams.get('source-path'), at: form.get('at'), payload: JSON.parse(frame[1]), credentials: options.credentials };
      calls.push(call);
      const out = handlers[rpc](call, calls.filter((c) => c.rpc === rpc).length);
      if (out instanceof Error) throw out;
      if (out && out.status) return { ok: false, status: out.status, text: async () => '' };
      return { ok: true, status: 200, text: async () => out };
    },
  });
  const result = JSON.parse(JSON.stringify(await fn(request, 'unused-token', { pollMs: 1, timeoutMs: 2000 })));
  return { result, calls };
}

const happy = {
  YhhmEf: () => envelope('YhhmEf', fx.submit),
  jwpduf: (_c, n) => envelope('jwpduf', n < 2 ? fx.poll_rendering : fx.poll_done),
  as29s: () => envelope('as29s', fx.asset_done),
};

test('canUseHttpVideo: chỉ bật cho tổ hợp đã chứng minh và khi transport=http', async () => {
  const { canUseHttpVideo } = await api;
  assert.equal(canUseHttpVideo(baseReq), true);
  assert.equal(canUseHttpVideo({ ...baseReq, transport: 'ui' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, transport: undefined }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, input_mode: 'frames' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, input_mode: 'ingredients' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, provider_model_id: 'abra_t2v_6s' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, provider_model_id: 'macaron_cookie_t2v_8s' }), false);
  // 360p chỉ hợp lệ khi model id có hậu tố _360p và request.resolution = 360p (khớp nhau)
  assert.equal(canUseHttpVideo({ ...baseReq, resolution: '360p', provider_model_id: 'macaron_cookie_t2v_10s_360p' }), true);
  assert.equal(canUseHttpVideo({ ...baseReq, resolution: '360p' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, provider_model_id: 'macaron_cookie_t2v_10s_360p' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, resolution: '480p' }), false);
  // tỉ lệ bắt buộc phải rõ ràng (item[2] điều khiển tỉ lệ)
  assert.equal(canUseHttpVideo({ ...baseReq, aspect_ratio: '16:9' }), true);
  assert.equal(canUseHttpVideo({ ...baseReq, aspect_ratio: undefined }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, aspect_ratio: '1:1' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, num_outputs: 2 }), false);
});

test('happy path: submit -> poll 2 -> 3 -> as29s, trả đúng URL/media id và số dư credit', async () => {
  const { result, calls } = await run(baseReq, happy);
  assert.equal(result.ok, true);
  assert.equal(result.submitted, true);
  assert.equal(result.media_id, fx.media_id);
  assert.equal(result.video_url, fx.video_url);
  assert.equal(result.provider_model_id, MODEL);
  assert.equal(result.project_id, fx.project_id);
  assert.equal(result.credit_balance, 980);
  assert.equal(result.transport, 'http');
  assert.deepEqual(calls.map((c) => c.rpc), ['YhhmEf', 'jwpduf', 'jwpduf', 'as29s']);
});

test('request submit đúng cấu trúc HAR: model, prompt, project, token captcha, at, source-path', async () => {
  const { calls } = await run(baseReq, happy);
  const sub = calls[0];
  assert.equal(sub.at, 'AT_TOKEN');
  assert.equal(sub.credentials, 'include');
  assert.equal(sub.path, '/u/1/_/AiSandboxAngularFrontend/data/batchexecute');
  assert.equal(sub.source, `/u/1/project/${fx.project_id}`);
  const item = sub.payload[0][0];
  assert.deepEqual(item[0], [null, null, [[['dragon']]]]);
  assert.equal(item[1], MODEL);
  assert.equal(item[2], 1, '9:16 => item[2] = 1');
  assert.deepEqual(sub.payload[1], [null, 22, null, null, null, fx.project_id, null, null, null, null, ['CAPTCHA_TOKEN', 1]]);
  assert.equal(sub.payload[2][1], 2);
  assert.deepEqual(calls[1].payload, [null, null, [[fx.media_id]]]);
});

test('as29s lấy video dùng payload [mediaId] (biến thể [id,null,[1]] chỉ trả thumbnail)', async () => {
  const { calls } = await run(baseReq, happy);
  assert.deepEqual(calls.at(-1).payload, [fx.media_id]);
});

test('tỉ lệ 16:9 => item[2] = 2, 9:16 => item[2] = 1; số lượng video vẫn là 1 item', async () => {
  let r = await run({ ...baseReq, aspect_ratio: '16:9' }, happy);
  assert.equal(r.calls[0].payload[0][0][2], 2);
  assert.equal(r.calls[0].payload[0].length, 1);
  r = await run({ ...baseReq, aspect_ratio: '9:16' }, happy);
  assert.equal(r.calls[0].payload[0][0][2], 1);
});

test('aspect_ratio không hỗ trợ: không gọi mạng', async () => {
  const { result, calls } = await run({ ...baseReq, aspect_ratio: '1:1' }, happy);
  assert.equal(result.submitted, false);
  assert.match(result.error, /aspect_ratio/);
  assert.equal(calls.length, 0);
});

test('360p: gửi đúng model id _360p', async () => {
  const { result, calls } = await run({ ...baseReq, resolution: '360p', provider_model_id: 'macaron_cookie_t2v_10s_360p' }, happy);
  assert.equal(result.ok, true);
  assert.equal(calls[0].payload[0][0][1], 'macaron_cookie_t2v_10s_360p');
  assert.equal(result.provider_model_id, 'macaron_cookie_t2v_10s_360p');
});

test('model không hỗ trợ: không gọi mạng, submitted=false để caller fallback giao diện', async () => {
  const { result, calls } = await run({ ...baseReq, provider_model_id: 'abra_t2v_6s' }, happy);
  assert.equal(result.ok, false);
  assert.equal(result.submitted, false);
  assert.match(result.error, /không hỗ trợ model/);
  assert.equal(calls.length, 0);
});

test('thiếu captcha / chưa mở project: submitted=false, không gửi gì', async () => {
  let r = await run(baseReq, happy, { grecaptcha: {} });
  assert.equal(r.result.submitted, false);
  assert.match(r.result.error, /reCAPTCHA/);
  assert.equal(r.calls.length, 0);
  r = await run(baseReq, happy, { pathname: '/' });
  assert.equal(r.result.submitted, false);
  assert.match(r.result.error, /Project/);
});

test('submit bị từ chối (envelope lỗi): submitted=false để fallback, không poll', async () => {
  const { result, calls } = await run(baseReq, { ...happy, YhhmEf: () => ")]}'\n\n9\n" + JSON.stringify([['wrb.fr', 'YhhmEf', null, null, null, [7], 'generic']]) });
  assert.equal(result.ok, false);
  assert.equal(result.submitted, false);
  assert.match(result.error, /envelope error/);
  assert.deepEqual(calls.map((c) => c.rpc), ['YhhmEf']);
});

test('HTTP 429 khi submit: submitted=false', async () => {
  const { result } = await run(baseReq, { ...happy, YhhmEf: () => ({ status: 429 }) });
  assert.equal(result.submitted, false);
  assert.match(result.error, /HTTP 429/);
});

test('render kết thúc lỗi sau khi đã submit: submitted=true (KHÔNG được gửi lại, sẽ trừ credit lần nữa)', async () => {
  const failed = JSON.parse(JSON.stringify(fx.poll_done));
  failed[2][0][5][8] = [4];
  const { result, calls } = await run(baseReq, { ...happy, jwpduf: () => envelope('jwpduf', failed) });
  assert.equal(result.ok, false);
  assert.equal(result.submitted, true);
  assert.equal(result.media_id, fx.media_id);
  assert.match(result.error, /Flow render ended with status 4/);
  assert.equal(calls.filter((c) => c.rpc === 'YhhmEf').length, 1);
});

test('lỗi mạng thoáng qua khi poll được bỏ qua; quá 5 lỗi liên tiếp mới thất bại', async () => {
  let r = await run(baseReq, { ...happy, jwpduf: (_c, n) => (n <= 2 ? new Error('network') : envelope('jwpduf', fx.poll_done)) });
  assert.equal(r.result.ok, true);
  r = await run(baseReq, { ...happy, jwpduf: () => new Error('network') });
  assert.equal(r.result.ok, false);
  assert.equal(r.result.submitted, true);
});

test('poll bỏ qua record của media khác', async () => {
  const other = JSON.parse(JSON.stringify(fx.poll_done));
  other[2][0][0] = '99999999-9999-4999-8999-999999999999';
  const { result } = await run(baseReq, { ...happy, jwpduf: (_c, n) => envelope('jwpduf', n < 2 ? other : fx.poll_done) });
  assert.equal(result.ok, true);
});

test('render xong nhưng as29s không có URL video: submitted=true, báo lỗi rõ', async () => {
  const noUrl = JSON.parse(JSON.stringify(fx.asset_done));
  noUrl[7] = null;
  const { result } = await run(baseReq, { ...happy, as29s: () => envelope('as29s', noUrl) });
  assert.equal(result.ok, false);
  assert.equal(result.submitted, true);
  assert.match(result.error, /không lấy được URL video/);
});

// ── Parser của đường giao diện phải hiểu format mới (không còn cờ CAE) ──────────
test('parseVideoUiCreateResponse (format 2026-11): lấy media id ở payload[3][0], không lấy scene id', async () => {
  const { parseVideoUiCreateResponse } = await import('../src/providers/google-flow/video-ui.js');
  const body = envelope('YhhmEf', fx.submit);
  const parsed = parseVideoUiCreateResponse(body, { project_id: fx.project_id });
  assert.equal(parsed.mediaId, fx.media_id);
  assert.equal(parsed.projectId, fx.project_id);
  assert.notEqual(parsed.mediaId, fx.submit[2][0][0], 'không được nhầm sang id scene/workflow');
});

test('parseVideoUiCreateResponse (format 2026-11): project khác thì không nhận record', async () => {
  const { parseVideoUiCreateResponse } = await import('../src/providers/google-flow/video-ui.js');
  assert.throws(() => parseVideoUiCreateResponse(envelope('nprQif', fx.submit), { project_id: '55555555-5555-4555-8555-555555555555' }), /no video asset record/);
});
