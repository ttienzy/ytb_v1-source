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

/** sessionStorage giả của tab Flow (còn nguyên qua lần trang tải lại). */
function memoryStorage() {
  const m = new Map();
  return {
    get length() { return m.size; },
    key: (i) => [...m.keys()][i] ?? null,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: (k) => { m.delete(k); },
    _map: m,
  };
}

async function run(request, handlers, opts = {}, sessionStorage = memoryStorage()) {
  const { runFlowHttpVideoInPage } = await api;
  const calls = [];
  const fn = vm.runInNewContext(`(${runFlowHttpVideoInPage.toString()})`, {
    sessionStorage,
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
  // 360p: HAR flow.google_video_2311.com — model phải có hậu tố _360p khớp với resolution
  assert.equal(canUseHttpVideo({ ...baseReq, resolution: '360p' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, resolution: '360p', provider_model_id: 'macaron_cookie_edit_360p' }), true);
  assert.equal(canUseHttpVideo({ ...baseReq, provider_model_id: 'macaron_cookie_edit_360p' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, reference_video_id: 'not-a-uuid' }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, reference_video_end_seconds: 15 }), true);   // Flow nhận tới 15 giây video mẫu
  assert.equal(canUseHttpVideo({ ...baseReq, reference_video_end_seconds: 15.5 }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, reference_video_start_seconds: 5, reference_video_end_seconds: 5 }), false);
  // Chưa có HAR cho trường hợp không ảnh -> vẫn đi giao diện
  assert.equal(canUseHttpVideo({ ...baseReq, ingredient_inputs: [], ingredient_media_ids: [] }), false);
  // Nhiều video trong một lệnh (HAR x3): 1–4; các chế độ khác vẫn chỉ 1
  assert.deepEqual([1, 2, 3, 4].map((n) => canUseHttpVideo({ ...baseReq, num_outputs: n })), [true, true, true, true]);
  assert.deepEqual([5, 2.5, -1].map((n) => canUseHttpVideo({ ...baseReq, num_outputs: n })), [false, false, false]);
  // Ảnh cục bộ phải có base64
  assert.equal(canUseHttpVideo({ ...baseReq, ingredient_inputs: [{ local_path: 'C:/a.png', filename: 'a.png' }], ingredient_media_ids: [], ingredient_images: [{ filename: 'a.png' }] }), false);
  assert.equal(canUseHttpVideo({ ...baseReq, ingredient_inputs: [{ local_path: 'C:/a.png', filename: 'a.png' }], ingredient_media_ids: [], ingredient_images: [{ filename: 'a.png', base64: 'AAAA' }] }), true);
});

test('motionImageOrder giữ thứ tự nhân vật rồi bối cảnh, trộn media id có sẵn và ảnh cục bộ', async () => {
  const { motionImageOrder } = await api;
  assert.deepEqual(motionImageOrder({ ingredient_inputs: [{ local_path: 'a' }, { media_id: SCENE }], ingredient_images: [{ base64: 'x' }] }),
    [{ image_index: 0 }, { media_id: SCENE }]);
  assert.equal(motionImageOrder({ ingredient_inputs: [{ local_path: 'a' }], ingredient_images: [{ base64: 'x' }, { base64: 'y' }] }), null);
  assert.equal(motionImageOrder({ ingredient_inputs: [1, 2, 3, 4, 5, 6].map(() => ({ media_id: CHAR })) }), null); // tối đa 5 ảnh
  assert.equal(motionImageOrder({ ingredient_inputs: [1, 2, 3, 4, 5].map(() => ({ media_id: CHAR })) }).length, 5);
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

test('giới hạn đoạn video mẫu: hằng số, canUseHttpVideo và số 15 trong hàm chạy trong trang luôn khớp', async () => {
  const mod = await import('../src/providers/google-flow/page/video-http.js');
  const limit = mod.MOTION_REF_MAX_SECONDS;
  assert.equal(limit, 15);
  assert.equal(mod.canUseHttpVideo({ ...baseReq, reference_video_start_seconds: 0, reference_video_end_seconds: limit }), true);
  assert.equal(mod.canUseHttpVideo({ ...baseReq, reference_video_start_seconds: 0, reference_video_end_seconds: limit + 0.5 }), false);
  // runFlowHttpVideoInPage bị serialize nên giữ số 15 dạng chữ: phải khớp hằng số (đổi một nơi mà quên nơi kia -> test đỏ)
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/providers/google-flow/page/video-http.js'), 'utf8');
  assert.ok(src.includes(`endSec - startSec > ${limit}`), 'giới hạn trong runFlowHttpVideoInPage lệch hằng số MOTION_REF_MAX_SECONDS');
  // heartbeat phải báo đúng hằng số này
  const hb = require('node:fs').readFileSync(require('node:path').join(__dirname, '../src/background/runtime/heartbeat.js'), 'utf8');
  assert.match(hb, /capabilities:\s*\{\s*motion_ref_max_seconds:\s*MOTION_REF_MAX_SECONDS,\s*motion_max_outputs:\s*MOTION_MAX_OUTPUTS,\s*motion_360p:\s*true,\s*motion_max_images:\s*MOTION_MAX_IMAGES\s*\}/);
  // giới hạn ảnh: hằng số, canUseHttpVideo và số 5 trong hàm chạy trong trang khớp nhau
  assert.equal(mod.MOTION_MAX_IMAGES, 5);
  assert.ok(src.includes(`inputs.length > ${mod.MOTION_MAX_IMAGES}) throw new Error('Motion Control cần 1–${mod.MOTION_MAX_IMAGES} ảnh`), 'giới hạn ảnh trong runFlowHttpVideoInPage lệch MOTION_MAX_IMAGES');
  const ids = (n) => Array.from({ length: n }, (_, i) => `0e462dd0-b83c-4414-b0ec-1f8fbb5d15${String(i).padStart(2, '0')}`);
  const withImgs = (n) => ({ ...baseReq, ingredient_inputs: ids(n).map((media_id) => ({ media_id })), ingredient_media_ids: ids(n) });
  assert.deepEqual([1, 3, 4, 5, 6].map((n) => mod.canUseHttpVideo(withImgs(n))), [true, true, true, true, false]);
  assert.equal(mod.MOTION_MAX_OUTPUTS, 4);
  assert.ok(src.includes('Math.min(4, Math.max(1,'), 'số video tối đa trong runFlowHttpVideoInPage lệch MOTION_MAX_OUTPUTS');
});

// ── Nhiều biến thể trong MỘT lệnh + 360p — HAR flow.google_video_2311.com (2026-11-23, giao diện Flow x3, 360p) ──────
const OUTS = ['44e15f44-9294-48ac-92ed-43da5de5f058', '02938faf-9dfb-4541-be42-0dca18a9df46', '7f911d52-208a-4e0a-9883-99853d17b41c'];
const urlOf = (id) => `https://flow-content.google/video/${id}?Expires=1&Signature=x`;
const createdN = (ids) => [null, 678, ids.map((id) => [`wf-${id}`, null, null, ['p', [1, 0]], PROJECT]),
  ids.map((id) => [id, PROJECT, `wf-${id}`, null, null, [[1, 0], 'p', null, null, null, null, [], null, [6], 1]])];
const notFound = (id) => [id, PROJECT, 'wf', 'CAE', null, [[1, 0], 'p', null, null, null, null, [], null, [4, [null, 'Media not found.'], ['Media not found.']], 1]];
const prominent = (id) => [id, PROJECT, 'wf', 'CAE', null, [[1, 0], 'p', null, null, null, null, [], null, [4, [3, 'PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED'], ['PROMINENT_PERSON']], 1]];

// Đúng diễn biến trong HAR: lần hỏi 1 cả 3 "Media not found", lần 2 còn 2 cái, lần 3 đang render, lần 4: 1 bị chặn + 2 xong.
const harTimeline = {
  ...happy,
  jIps6: () => envelope('jIps6', createdN(OUTS)),
  jwpduf: (call, n) => {
    const ids = call.payload[2].map((x) => x[0]);
    if (ids[0] === VIDEO) return envelope('jwpduf', [null, null, [record(VIDEO, 3)]]);
    const poll = n - 1;   // lần hỏi thứ mấy SAU khi gửi (lần 1 là kiểm tra video mẫu)
    const rec = (id, i) => {
      if (poll === 1) return notFound(id);
      if (poll === 2) return i === 0 ? record(id, 6) : notFound(id);
      if (poll === 3) return record(id, 2);
      return i === 0 ? prominent(id) : record(id, 3);
    };
    return envelope('jwpduf', [null, null, ids.map((id) => rec(id, OUTS.indexOf(id)))]);
  },
  as29s: (call) => envelope('as29s', [call.payload[0], PROJECT, null, null, null, [], null, [[null, null, null, null, null, null, null, null, urlOf(call.payload[0])]]]),
};

test('x3 = MỘT jIps6 với 3 item giống hệt nhau (chỉ khác uuid), 360p có cờ [4] ở item[12] — như HAR', async () => {
  const req = { ...baseReq, num_outputs: 3, resolution: '360p', provider_model_id: 'macaron_cookie_edit_360p',
    reference_video_start_seconds: 0, reference_video_end_seconds: 13.63 };
  const { calls } = await run(req, harTimeline);
  const creates = calls.filter((c) => c.rpc === 'jIps6');
  assert.equal(creates.length, 1, 'chỉ MỘT lệnh tạo (một token reCAPTCHA, một lần trừ credit)');
  const items = creates[0].payload[0];
  assert.equal(items.length, 3);
  for (const item of items) {
    assert.equal(item.length, 13);
    assert.deepEqual(item[0], [null, VIDEO, 0, 409]);                     // 13,63 giây × 30 = 409 khung, như HAR
    assert.equal(item[2], 'macaron_cookie_edit_360p');
    assert.equal(item[3], 1);                                            // HAR: vẫn 1 dù chọn x3
    assert.deepEqual(item.slice(9), [null, null, null, [4]]);
    assert.deepEqual(item[8], [[null, CHAR]]);
  }
  // 720p: item vẫn dài 9 như HAR cũ (không cờ 360p)
  const { calls: c720 } = await run({ ...baseReq, num_outputs: 2 }, { ...harTimeline, jIps6: () => envelope('jIps6', createdN(OUTS.slice(1))) });
  const items720 = c720.find((c) => c.rpc === 'jIps6').payload[0];
  assert.deepEqual(items720.map((i) => i.length), [9, 9]);
});

test('x3: "Media not found" lúc đầu KHÔNG phải lỗi; mỗi biến thể có kết cục riêng (1 bị chặn, 2 xong)', async () => {
  const req = { ...baseReq, num_outputs: 3, resolution: '360p', provider_model_id: 'macaron_cookie_edit_360p' };
  const { result, calls } = await run(req, harTimeline);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.submitted, true);
  assert.equal(result.credit_balance, 678);
  assert.equal(result.media_id, OUTS[1]);                                // video đầu tiên THÀNH CÔNG
  assert.equal(result.video_url, urlOf(OUTS[1]));
  assert.equal(result.outputs.length, 3);
  assert.deepEqual(result.outputs.map((o) => [o.index, o.ok, o.media_id]), [[0, false, OUTS[0]], [1, true, OUTS[1]], [2, true, OUTS[2]]]);
  assert.match(result.outputs[0].error, /PROMINENT_PEOPLE/);
  assert.deepEqual(result.outputs.slice(1).map((o) => o.video_url), [urlOf(OUTS[1]), urlOf(OUTS[2])]);
  // hỏi trạng thái cả 3 id trong MỘT lần gọi; id đã xong/lỗi không hỏi lại
  const polls = calls.filter((c) => c.rpc === 'jwpduf').slice(1).map((c) => c.payload[2].length);
  assert.deepEqual(polls, [3, 3, 3, 3]);
  assert.equal(calls.filter((c) => c.rpc === 'as29s').length, 2);       // chỉ lấy URL cho 2 video xong
});

test('x3 tất cả bị chặn: báo lỗi nhưng submitted=true (đã gửi, KHÔNG gửi lại) kèm đủ media id', async () => {
  const req = { ...baseReq, num_outputs: 3 };
  const allBlocked = { ...harTimeline, jwpduf: (call) => {
    const ids = call.payload[2].map((x) => x[0]);
    if (ids[0] === VIDEO) return envelope('jwpduf', [null, null, [record(VIDEO, 3)]]);
    return envelope('jwpduf', [null, null, ids.map(prominent)]);
  } };
  const { result } = await run(req, allBlocked);
  assert.equal(result.ok, false);
  assert.equal(result.submitted, true);
  assert.deepEqual(result.media_ids, OUTS);
  assert.match(result.error, /PROMINENT_PEOPLE/);
});

test('"Media not found" kéo dài quá thời gian chờ thì mới thành lỗi (không treo mãi)', async () => {
  const stuck = { ...happy, jwpduf: (call) => {
    const id = call.payload[2][0][0];
    return envelope('jwpduf', [null, null, [id === VIDEO ? record(VIDEO, 3) : notFound(id)]]);
  } };
  const { result } = await run(baseReq, stuck, { timeoutMs: 30 });
  assert.equal(result.ok, false);
  assert.equal(result.submitted, true);
  assert.match(result.error, /Timed out waiting for Flow render/);
});


// ── Trang Flow tải lại giữa lúc render: chạy tiếp bằng media id đã ghi trong sessionStorage, KHÔNG gửi lại ───────────
test('mất kết quả giữa chừng: chạy tiếp (resume) đọc đúng media id đã gửi, không gửi jIps6 lần nữa', async () => {
  const req = { ...baseReq, num_outputs: 3, resolution: '360p', provider_model_id: 'macaron_cookie_edit_360p' };
  const storage = memoryStorage();
  // lượt đầu: gửi xong thì mọi lần hỏi trạng thái đều lỗi mạng (giống trang đang tải lại) -> hàm dừng, dấu vết vẫn còn
  const broken = { ...harTimeline, jwpduf: (call) => {
    if (call.payload[2][0][0] === VIDEO) return envelope('jwpduf', [null, null, [record(VIDEO, 3)]]);
    return 'not json';
  } };
  const first = await run(req, broken, { nonce: 'N1' }, storage);
  assert.equal(first.result.ok, false);
  assert.equal(first.result.submitted, true);
  assert.deepEqual(first.result.media_ids, OUTS);
  const saved = JSON.parse(storage.getItem('_vf_http_gen:N1'));
  assert.deepEqual(saved.mediaIds, OUTS);
  assert.equal(saved.credit, 678);
  // chạy tiếp: KHÔNG upload, KHÔNG gửi jIps6; hỏi đúng 3 id, ra đúng kết cục từng video
  const again = await run(req, harTimeline, { nonce: 'N1', resume: true }, storage);
  assert.equal(again.result.ok, true, again.result.error);
  assert.equal(again.result.resumed_after_lost_result, true);
  assert.equal(again.calls.some((c) => c.rpc === 'jIps6' || c.rpc === 'maseQ'), false);
  assert.deepEqual(again.result.outputs.map((o) => [o.ok, o.media_id]), [[false, OUTS[0]], [true, OUTS[1]], [true, OUTS[2]]]);
  assert.equal(again.result.credit_balance, 678);
  assert.equal(storage.getItem('_vf_http_gen:N1'), null, 'xong thì xóa dấu vết');
});

test('chạy tiếp mà tab không còn dấu vết / đã sang project khác: báo resume_missing, không gọi Flow gì', async () => {
  const req = { ...baseReq, num_outputs: 2 };
  const empty = await run(req, harTimeline, { nonce: 'NONE', resume: true });
  assert.equal(empty.result.resume_missing, true);
  assert.equal(empty.result.submitted, undefined);                 // không khẳng định đã gửi hay chưa
  assert.equal(empty.calls.length, 0);
  const storage = memoryStorage();
  storage.setItem('_vf_http_gen:N2', JSON.stringify({ mediaIds: OUTS, projectId: '99999999-9999-4999-8999-999999999999', at: Date.now() }));
  const other = await run(req, harTimeline, { nonce: 'N2', resume: true }, storage);
  assert.equal(other.result.resume_missing, true);
  assert.equal(other.calls.length, 0);
});

test('lượt thành công xóa dấu vết; dấu vết cũ hơn 1 ngày tự dọn; không có nonce thì không ghi gì', async () => {
  const storage = memoryStorage();
  storage.setItem('_vf_http_gen:OLD', JSON.stringify({ mediaIds: ['x'], at: Date.now() - 2 * 86_400_000 }));
  const ok = await run({ ...baseReq, num_outputs: 3 }, harTimeline, { nonce: 'N3' }, storage);
  assert.equal(ok.result.ok, true, ok.result.error);
  assert.equal(storage.getItem('_vf_http_gen:N3'), null);
  assert.equal(storage.getItem('_vf_http_gen:OLD'), null);
  const plain = memoryStorage();
  await run(baseReq, happy, {}, plain);
  assert.equal(plain.length, 0);
});


test('Motion Control 5 ảnh tham chiếu: đủ 5 media id theo đúng thứ tự trong item[8] (người dùng xác nhận trên Flow)', async () => {
  const ids = Array.from({ length: 5 }, (_, i) => `0e462dd0-b83c-4414-b0ec-1f8fbb5d15${String(i).padStart(2, '0')}`);
  const req = { ...baseReq, ingredient_inputs: ids.map((media_id) => ({ media_id })), ingredient_media_ids: ids };
  const { result, calls } = await run(req, happy);
  assert.equal(result.ok, true, result.error);
  const [item] = calls.find((c) => c.rpc === 'jIps6').payload[0];
  assert.deepEqual(item[8], ids.map((id) => [null, id]));
  const six = await run({ ...req, ingredient_inputs: [...req.ingredient_inputs, { media_id: ids[0] }], ingredient_media_ids: [...ids, ids[0]] }, happy);
  assert.equal(six.result.ok, false);
  assert.equal(six.result.submitted, false);                       // chặn trước khi gửi, không mất credit
  assert.match(six.result.error, /1–5 ảnh/);
});
