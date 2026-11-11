// Test đường HTTP cho FRAMES (khung đầu + khung cuối, Omni 1.2 i2v_fl). Response submit = nprQif THẬT trong HAR gd_7 (id giả).
// Phần chưa có HAR: response của maseQ (upload ảnh) được dựng theo đúng parser mà đường giao diện đang dùng
// (data[0][0] = mediaId, data[0][1] = projectId, data[1][3][0] = tên file) -> cần xác nhận live lần đầu.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fx = require('./fixtures/flow-http-t2v.json');
const fr = require('./fixtures/flow-http-frames.json');

const api = import('../src/providers/google-flow/page/video-http.js');
const MODEL = 'macaron_cookie_i2v_fl_6s';
const B64 = Buffer.from('fake-image-bytes').toString('base64');
const baseReq = {
  prompt: 'bieens hinhf', provider_model_id: MODEL, input_mode: 'frames', transport: 'http', resolution: '720p',
  duration_seconds: 6, num_outputs: 1, aspect_ratio: '9:16',
  image_base64: B64, image_mime: 'image/png', image_name: 'start.png', image_width: 1920, image_height: 1080,
  end_image_base64: B64, end_image_mime: 'image/png', end_image_name: 'end.png', end_image_width: 1920, end_image_height: 1080,
};

const envelope = (rpc, payload) => ")]}'\n\n123\n" + JSON.stringify([['wrb.fr', rpc, JSON.stringify(payload), null, null, null, 'generic']]);
const uploadResponse = (id, name) => [[id, fx.project_id, null], [null, null, null, [name]]];

async function run(request, handlers) {
  const { runFlowHttpVideoInPage } = await api;
  const calls = [];
  const fn = vm.runInNewContext(`(${runFlowHttpVideoInPage.toString()})`, {
    location: { hostname: 'flow.google.com', pathname: `/u/1/project/${fx.project_id}`, origin: 'https://flow.google.com' },
    window: {
      WIZ_global_data: { SNlM0e: 'AT_TOKEN', FdrFJe: '7700000000000000000', cfb2h: 'boq_build' },
      grecaptcha: { enterprise: { ready: (cb) => cb(), execute: async () => 'CAPTCHA_TOKEN' } },
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
      const call = { rpc, payload: JSON.parse(frame[1]), at: form.get('at') };
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
  maseQ: (_c, n) => envelope('maseQ', uploadResponse(n === 1 ? fr.start_media_id : fr.end_media_id, n === 1 ? 'start.png' : 'end.png')),
  nprQif: () => envelope('nprQif', fr.submit),
  jwpduf: (_c, n) => envelope('jwpduf', n < 2 ? fx.poll_rendering : fx.poll_done),
  as29s: () => envelope('as29s', fx.asset_done),
};

test('render lỗi (status 4): báo kèm bản ghi poll đã che URL/id để biết lý do, vẫn submitted=true', async () => {
  const failed = JSON.parse(JSON.stringify(fx.poll_done));
  failed[2][0][5][8] = [4, 'PUBLIC_ERROR_EXAMPLE_REASON'];
  failed[2][0][7] = ['https://flow-content.google/video/secret?sig=ABC', '55555555-5555-4555-8555-555555555555'];
  const { result } = await run(baseReq, { ...happy, jwpduf: () => envelope('jwpduf', failed) });
  assert.equal(result.ok, false);
  assert.equal(result.submitted, true);
  assert.match(result.error, /^Flow render ended with status 4 \[bản ghi poll: /);
  assert.match(result.error, /PUBLIC_ERROR_EXAMPLE_REASON/);
  assert.doesNotMatch(result.error, /secret|sig=ABC|55555555/);
  assert.match(result.error, /<url>/);
  assert.ok(result.error.length < 900);
});

test('canUseHttpVideo(frames): chỉ bật khi đủ HAR (i2v_fl 6s/10s), có CẢ hai ảnh + kích thước, thời lượng khớp model id', async () => {
  const { canUseHttpVideo } = await api;
  assert.equal(canUseHttpVideo(baseReq), true);
  assert.equal(canUseHttpVideo({ ...baseReq, provider_model_id: 'macaron_cookie_i2v_fl_10s', duration_seconds: 10 }), true);
  assert.equal(canUseHttpVideo({ ...baseReq, provider_model_id: 'macaron_cookie_i2v_fl_10s_360p', duration_seconds: 10, resolution: '360p' }), true);
  assert.equal(canUseHttpVideo({ ...baseReq, transport: 'ui' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, end_image_base64: '' }), false, 'thiếu khung cuối');
  assert.equal(canUseHttpVideo({ ...baseReq, image_base64: undefined }), false, 'thiếu khung đầu');
  assert.equal(canUseHttpVideo({ ...baseReq, image_width: 0 }), false, 'thiếu kích thước ảnh');
  assert.equal(canUseHttpVideo({ ...baseReq, duration_seconds: 10 }), false, 'thời lượng không khớp hậu tố model');
  assert.equal(canUseHttpVideo({ ...baseReq, provider_model_id: 'macaron_cookie_i2v_fl_8s', duration_seconds: 8 }), false, '8s chưa có HAR');
  assert.equal(canUseHttpVideo({ ...baseReq, provider_model_id: 'macaron_cookie_i2v_fl_6s_360p' }), false, '360p phải khớp resolution');
  assert.equal(canUseHttpVideo({ ...baseReq, provider_model_id: 'omni_flash_i2v_10s_first_last', duration_seconds: 10 }), false, 'Omni 1.1 vẫn đi giao diện');
  assert.equal(canUseHttpVideo({ ...baseReq, input_mode: 'ingredients' }), false);
});

test('happy path: upload 2 ảnh (maseQ) -> nprQif -> poll -> as29s; trả media id của hai khung', async () => {
  const { result, calls } = await run(baseReq, happy);
  assert.equal(result.ok, true);
  assert.equal(result.submitted, true);
  assert.equal(result.media_id, fx.media_id);
  assert.equal(result.video_url, fx.video_url);
  assert.equal(result.start_media_id, fr.start_media_id);
  assert.equal(result.end_media_id, fr.end_media_id);
  assert.equal(result.credit_balance, 866, 'số dư credit lấy từ response nprQif thật trong HAR');
  assert.deepEqual(calls.map((c) => c.rpc), ['maseQ', 'maseQ', 'nprQif', 'jwpduf', 'jwpduf', 'as29s']);
});

test('request nprQif đúng cấu trúc HAR: model, tỉ lệ, 2 slot media với hình chữ nhật cắt [trên,trái,dưới,phải]', async () => {
  const { calls } = await run(baseReq, happy);
  const sub = calls.find((c) => c.rpc === 'nprQif');
  const item = sub.payload[0][0];
  assert.deepEqual(item[0], [null, null, [[['bieens hinhf']]]]);
  assert.equal(item[1], MODEL);
  assert.equal(item[2], 1, '9:16 => item[2] = 1');
  assert.equal(item[3], null);
  // ảnh 1920x1080 -> 9:16: đúng giá trị Flow gửi trong HAR gd_7
  assert.deepEqual(item[4], [null, fr.start_media_id, null, null, null, [null, 0.341796875, 1, 0.658203125]]);
  assert.deepEqual(item[5], [null, fr.end_media_id, null, null, null, [null, 0.341796875, 1, 0.658203125]]);
  assert.equal(item.length, 7, 'không có cờ phụ nào khác (kể cả 360p)');
  assert.deepEqual(sub.payload[1], [null, 22, null, null, null, fx.project_id, null, null, null, null, ['CAPTCHA_TOKEN', 1]]);
  assert.equal(sub.payload[2][1], 2);
});

test('cắt ảnh theo tỉ lệ: ảnh đúng 9:16 không cắt, ảnh vuông cắt giữa theo chiều ngang, 16:9 cắt giữa theo chiều dọc', async () => {
  const dims = (w1, h1, w2, h2, aspect = '9:16') => ({ ...baseReq, aspect_ratio: aspect, image_width: w1, image_height: h1, end_image_width: w2, end_image_height: h2 });
  let r = await run(dims(720, 1280, 1024, 1024), happy);
  let item = r.calls.find((c) => c.rpc === 'nprQif').payload[0][0];
  assert.deepEqual(item[4][5], [null, null, 1, 1]);
  assert.deepEqual(item[5][5], [null, 0.21875, 1, 0.78125]);
  r = await run(dims(1280, 720, 1024, 1024, '16:9'), happy);
  item = r.calls.find((c) => c.rpc === 'nprQif').payload[0][0];
  assert.equal(item[2], 2, '16:9 => item[2] = 2');
  assert.deepEqual(item[4][5], [null, null, 1, 1]);
  assert.deepEqual(item[5][5], [0.21875, null, 0.78125, 1]);
  // ảnh gần 9:16 nhưng cao hơn một chút: cắt rất ít theo chiều dọc (như HAR v2: [0.0012, null, 0.9988, 1])
  r = await run(dims(1000, 1780, 1000, 1780), happy);
  const crop = r.calls.find((c) => c.rpc === 'nprQif').payload[0][0][4][5];
  assert.equal(crop[1], null);
  assert.ok(crop[0] > 0 && crop[0] < 0.01 && crop[2] < 1 && crop[2] > 0.99 && crop[3] === 1);
});

test('payload upload maseQ: [header project, base64 THUẦN, mime, true, null, null, null, false, tên file]', async () => {
  const { calls } = await run({ ...baseReq, image_base64: `data:image/png;base64,${B64}` }, happy);
  const up = calls.filter((c) => c.rpc === 'maseQ');
  assert.equal(up.length, 2);
  assert.deepEqual(up[0].payload[0], [null, 22, null, null, null, fx.project_id, null, null, null, null, null]);
  assert.equal(up[0].payload[1], B64, 'bỏ tiền tố data URL');
  assert.deepEqual(up[0].payload.slice(2), ['image/png', true, null, null, null, false, 'start.png']);
  assert.equal(up[1].payload[8], 'end.png');
});

test('360p frames: chỉ khác ở hậu tố model id, KHÔNG có cờ phụ ở item (khác t2v)', async () => {
  const { result, calls } = await run({ ...baseReq, resolution: '360p', provider_model_id: 'macaron_cookie_i2v_fl_6s_360p' }, happy);
  assert.equal(result.ok, true);
  const item = calls.find((c) => c.rpc === 'nprQif').payload[0][0];
  assert.equal(item[1], 'macaron_cookie_i2v_fl_6s_360p');
  assert.equal(item.length, 7);
});

test('upload thất bại: KHÔNG gửi nprQif (không mất credit), submitted=false và báo lý do', async () => {
  const { result, calls } = await run(baseReq, { ...happy, maseQ: () => ({ status: 500 }) });
  assert.equal(result.ok, false);
  assert.equal(result.submitted, false);
  assert.match(result.error, /maseQ failed: HTTP 500/);
  assert.deepEqual(calls.map((c) => c.rpc), ['maseQ']);
});

test('upload không trả media id: không gửi nprQif', async () => {
  const { result, calls } = await run(baseReq, { ...happy, maseQ: () => envelope('maseQ', [[null, fx.project_id]]) });
  assert.equal(result.submitted, false);
  assert.match(result.error, /không trả media id/);
  assert.equal(calls.filter((c) => c.rpc === 'nprQif').length, 0);
});

test('khung đầu upload xong nhưng khung cuối lỗi: vẫn chưa gửi gì và trả media id khung đầu để chẩn đoán', async () => {
  const { result, calls } = await run(baseReq, { ...happy, maseQ: (_c, n) => (n === 1 ? happy.maseQ(_c, 1) : { status: 503 }) });
  assert.equal(result.submitted, false);
  assert.equal(result.start_media_id, fr.start_media_id);
  assert.equal(result.end_media_id, null);
  assert.equal(calls.filter((c) => c.rpc === 'nprQif').length, 0);
});

test('đã gửi nprQif rồi mới lỗi (render fail): submitted=true, KHÔNG được gửi lại', async () => {
  const failed = JSON.parse(JSON.stringify(fx.poll_done));
  failed[2][0][5][8] = [4];
  const { result, calls } = await run(baseReq, { ...happy, jwpduf: () => envelope('jwpduf', failed) });
  assert.equal(result.ok, false);
  assert.equal(result.submitted, true);
  assert.equal(calls.filter((c) => c.rpc === 'nprQif').length, 1);
  assert.equal(result.start_media_id, fr.start_media_id);
});

test('t2v vẫn như cũ (không upload, YhhmEf): hồi quy', async () => {
  const t2v = { prompt: 'dragon', provider_model_id: 'macaron_cookie_t2v_10s', input_mode: 'text_to_video', transport: 'http', resolution: '720p', num_outputs: 1, aspect_ratio: '9:16' };
  const { result, calls } = await run(t2v, { ...happy, YhhmEf: () => envelope('YhhmEf', fx.submit) });
  assert.equal(result.ok, true);
  assert.deepEqual(calls.map((c) => c.rpc), ['YhhmEf', 'jwpduf', 'jwpduf', 'as29s']);
  assert.equal(result.start_media_id, null);
});

// ── Ingredients / Thành phần (r2v) — HAR gd_7 (13s 720p) và credit_check v2 (15s 360p, cờ [4] ở vị trí 11) ──
const ingReq = (over = {}) => ({
  ...baseReq, input_mode: 'ingredients', provider_model_id: 'macaron_cookie_r2v_15s', duration_seconds: 15,
  ingredient_images: [{ base64: B64, mime: 'image/png', filename: 'sheet.png' }], ...over,
});
const ingHandlers = {
  maseQ: (_c, n) => envelope('maseQ', uploadResponse(n === 1 ? fr.start_media_id : fr.end_media_id, 'sheet.png')),
  MZZa6b: () => envelope('MZZa6b', fr.submit),
  jwpduf: (_c, n) => envelope('jwpduf', n < 2 ? fx.poll_rendering : fx.poll_done),
  as29s: () => envelope('as29s', fx.asset_done),
};

test('canUseHttpVideo(ingredients): 1–3 ảnh có base64, model r2v 3-15s khớp thời lượng và độ phân giải', async () => {
  const { canUseHttpVideo } = await api;
  const img = { base64: B64, mime: 'image/png', filename: 'a.png' };
  assert.equal(canUseHttpVideo(ingReq()), true);
  assert.equal(canUseHttpVideo(ingReq({ ingredient_images: [img, img, img] })), true);
  assert.equal(canUseHttpVideo(ingReq({ ingredient_images: [img, img, img, img] })), false, 'tối đa 3 ảnh');
  assert.equal(canUseHttpVideo(ingReq({ ingredient_images: [] })), false);
  assert.equal(canUseHttpVideo(ingReq({ ingredient_images: [{ filename: 'a.png' }] })), false, 'thiếu base64');
  assert.equal(canUseHttpVideo(ingReq({ provider_model_id: 'macaron_cookie_r2v_13s', duration_seconds: 13 })), true);
  assert.equal(canUseHttpVideo(ingReq({ provider_model_id: 'macaron_cookie_r2v_15s_360p', resolution: '360p' })), true);
  assert.equal(canUseHttpVideo(ingReq({ provider_model_id: 'macaron_cookie_r2v_15s_360p' })), false, '360p phải khớp resolution');
  assert.equal(canUseHttpVideo(ingReq({ duration_seconds: 10 })), false, 'thời lượng không khớp model');
  assert.equal(canUseHttpVideo(ingReq({ provider_model_id: 'macaron_cookie_r2v_16s', duration_seconds: 16 })), false, 'ngoài 3-15 giây');
  assert.equal(canUseHttpVideo(ingReq({ provider_model_id: 'abra_r2v_8s', duration_seconds: 8 })), false, 'Omni 1.1 vẫn đi giao diện');
});

test('ingredients 720p: upload ảnh (maseQ) -> MZZa6b đúng cấu trúc HAR (không cờ phụ) -> poll -> as29s', async () => {
  const { result, calls } = await run(ingReq({ aspect_ratio: '9:16' }), ingHandlers);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.submitted, true);
  assert.deepEqual(result.ingredient_media_ids, [fr.start_media_id]);
  assert.deepEqual(calls.map((c) => c.rpc).slice(0, 2), ['maseQ', 'MZZa6b']);
  const submit = calls.find((c) => c.rpc === 'MZZa6b').payload;
  const item = submit[0][0];
  assert.deepEqual(item.slice(0, 5), [[null, null, [[['bieens hinhf']]]], [[null, fr.start_media_id]], 'macaron_cookie_r2v_15s', 1, null]);
  assert.equal(item.length, 6, '720p: không có cờ phụ (HAR gd_7)');
  assert.equal(item[5].length, 6);
  assert.equal(item[5][0], null);
  assert.equal(calls.filter((c) => c.rpc === 'MZZa6b').length, 1);
});

test('ingredients 360p: thêm cờ [4] ở vị trí 11 (HAR credit_check v2); nhiều ảnh giữ đúng thứ tự', async () => {
  const req = ingReq({
    provider_model_id: 'macaron_cookie_r2v_15s_360p', resolution: '360p',
    ingredient_images: [{ base64: B64, mime: 'image/png', filename: 'a.png' }, { base64: B64, mime: 'image/png', filename: 'b.png' }],
  });
  const { result, calls } = await run(req, ingHandlers);
  assert.equal(result.ok, true, result.error);
  const item = calls.find((c) => c.rpc === 'MZZa6b').payload[0][0];
  assert.deepEqual(item[1], [[null, fr.start_media_id], [null, fr.end_media_id]]);
  assert.equal(item.length, 12);
  assert.deepEqual(item.slice(6, 11), [null, null, null, null, null]);
  assert.deepEqual(item[11], [4]);
});

test('ingredients: upload lỗi thì chưa gửi gì (submitted=false, không mất credit)', async () => {
  const { result, calls } = await run(ingReq(), { ...ingHandlers, maseQ: () => ({ status: 500 }) });
  assert.equal(result.ok, false);
  assert.equal(result.submitted, false);
  assert.equal(calls.filter((c) => c.rpc === 'MZZa6b').length, 0);
});

test('ingredients: model không hỗ trợ bị từ chối trước khi làm gì', async () => {
  const { result, calls } = await run(ingReq({ provider_model_id: 'macaron_cookie_r2v_16s', duration_seconds: 16 }), ingHandlers);
  assert.equal(result.ok, false);
  assert.equal(result.submitted, false);
  assert.equal(calls.length, 0);
});

test('ingredients với ảnh CÓ SẴN trong project (như HAR gd_7): dùng thẳng mã media, không upload (maseQ)', async () => {
  const existing = 'fc102da0-ae54-4e5c-a482-a0fe916911a7';
  const req = ingReq({ ingredient_images: [], ingredient_media_ids: [existing], aspect_ratio: '9:16', prompt: 'introdution myself' });
  const { canUseHttpVideo } = await api;
  assert.equal(canUseHttpVideo(req), true);
  assert.equal(canUseHttpVideo(ingReq({ ingredient_images: [], ingredient_media_ids: ['not-a-uuid'] })), false);
  assert.equal(canUseHttpVideo(ingReq({ ingredient_images: [], ingredient_media_ids: [] })), false);
  const { result, calls } = await run(req, ingHandlers);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(result.ingredient_media_ids, [existing]);
  assert.equal(calls.filter((c) => c.rpc === 'maseQ').length, 0, 'không upload lại ảnh đã có');
  const item = calls.find((c) => c.rpc === 'MZZa6b').payload[0][0];
  assert.deepEqual(item.slice(0, 5), [[null, null, [[['introdution myself']]]], [[null, existing]], 'macaron_cookie_r2v_15s', 1, null]);
  assert.equal(item.length, 6);
});

test('ingredients: mã có sẵn đứng trước, ảnh upload nối sau, tối đa 3', async () => {
  const existing = 'fc102da0-ae54-4e5c-a482-a0fe916911a7';
  const { result, calls } = await run(ingReq({ ingredient_media_ids: [existing] }), ingHandlers);
  assert.equal(result.ok, true, result.error);
  assert.deepEqual(calls.find((c) => c.rpc === 'MZZa6b').payload[0][0][1], [[null, existing], [null, fr.start_media_id]]);
  const { canUseHttpVideo } = await api;
  const img = { base64: B64, mime: 'image/png', filename: 'a.png' };
  assert.equal(canUseHttpVideo(ingReq({ ingredient_images: [img, img], ingredient_media_ids: [existing, existing] })), false);
});
