// Tạo video Flow bằng HTTP thuần (batchexecute) từ trong tab Flow, KHÔNG bấm giao diện.
//
// Giao thức xác minh live 2026-11-09 (xem docs/PLAN_flow_http_submit.md, Backend/poc/flow_http):
//   submit  YhhmEf  -> payload[3][0] là record media; record[0] = media id; record[5][8][0] = state
//   poll    jwpduf  -> payload[2][0]; state 6 = queued, 2 = rendering, 3 = done
//   url     as29s   -> payload [mediaId] (KHÔNG phải [mediaId,null,[1]] = thumbnail); URL mp4 ở [7][0][8]
//
// FRAMES (khung đầu + khung cuối, i2v_fl) — HAR flow.google_2_test_gd_7.com (6s) và flow.google_2_new_credit_check_11_09_v2.com (10s, 10s_360p):
//   upload  maseQ  -> mỗi ảnh một lần; payload[0][0] = media id, payload[0][1] = project id (giống parser của đường giao diện)
//   submit  nprQif -> item = [[null,null,[[[prompt]]]], model, aspect, null, slotĐầu, slotCuối, [null,null,null,null,idA,idB]]
//                     slot = [null, mediaId, null, null, null, [trên, trái, dưới, phải]] (0–1, null = 0) = cắt ảnh về tỉ lệ video
//   360p KHÔNG có cờ phụ (khác t2v): độ phân giải chỉ nằm ở hậu tố _360p của model id.
//
// Độ phân giải nằm trong model id (hậu tố _360p). Tỉ lệ khung hình nằm ở item[2] của request: 1 = 9:16 (dọc), 2 = 16:9 (ngang)
// (HAR UI 16:9: item[2]=2 + telemetry aspectRatio=2; mọi HAR/PoC trước đó gửi 1 và ra video dọc). Số lượng video = số item trong payload[0].
// Đường này chỉ được bật khi request.transport === 'http' (xem canUseHttpVideo).
//
// MOTION CONTROL (video_edit, Omni 1.2) — HAR flow.google_video_motion.com (2026-11-11):
//   submit  jIps6  -> item = [[null, idVideo, khungĐầu, khungCuối], [null,null,[[[prompt]]]], 'macaron_cookie_edit', sốVideo,
//                     [null,null,null,null,idA,idB], null, null, null, [[null,idẢnh]...]]; khung = giây × 30 (0–240 = 8 giây)
//                     response giống YhhmEf: payload[3][0] = record, record[0] = media id, record[5][8][0] = state. 720p, 30 credit.
//   Video mẫu vừa tải lên còn đang xử lý (jwpduf state 1) -> đợi state 3 rồi mới gửi, giống giao diện Flow
//   (HAR flow.google_image.har: khoảng 37 giây cho clip 10 giây).
//
// Hàm runFlowHttpVideoInPage được serialize vào tab qua chrome.scripting.executeScript:
// KHÔNG import/đóng (closure) bất cứ thứ gì bên ngoài hàm.

// 720p: macaron_cookie_t2v_10s | 360p: macaron_cookie_t2v_10s_360p (cả hai đã chứng minh live 2026-11-09)
const VERIFIED_HTTP_MODEL = /^macaron_cookie_t2v_10s(_360p)?$/;
// Frames: chỉ 6s và 10s có HAR (thời lượng khác chưa có dữ liệu). Request dựng lại khớp từng tham số với HAR.
const VERIFIED_FRAMES_MODEL = /^macaron_cookie_i2v_fl_(6|10)s(_360p)?$/;
// Ingredients / "Thành phần" (r2v, 1–3 ảnh tham chiếu, KHÔNG cắt ảnh): 3-15 giây theo Google. Model id: HAR máy này (10, 13, 15 giây) và request bị chặn của gflow-cli (3, 8 giây).
// 15s 720p chưa có HAR nhưng giao diện Flow báo 60 credit và đặt model id theo cùng mẫu; gửi sai id thì Flow từ chối TRƯỚC khi trừ tiền.
const VERIFIED_R2V_MODEL = /^macaron_cookie_r2v_([3-9]|1[0-5])s(_360p)?$/;
// Motion Control chỉ có một model, 720p (360p chưa có HAR).
const VERIFIED_EDIT_MODEL = /^macaron_cookie_edit$/;
const MEDIA_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Thứ tự ảnh tham chiếu Motion Control theo ingredient_inputs (nhân vật = Image 1, bối cảnh = Image 2): mỗi mục là
 * media id có sẵn trong project hoặc một ảnh cục bộ (lấy lần lượt trong ingredient_images, phải có base64).
 * Trả null nếu không hợp lệ. runFlowHttpVideoInPage lặp lại đúng logic này (hàm chạy trong trang phải tự chứa).
 */
export function motionImageOrder(req) {
  const images = Array.isArray(req?.ingredient_images) ? req.ingredient_images : [];
  const inputs = Array.isArray(req?.ingredient_inputs) && req.ingredient_inputs.length
    ? req.ingredient_inputs
    : [...(req?.ingredient_media_ids || []).map((media_id) => ({ media_id })), ...images.map(() => ({ local: true }))];
  if (inputs.length < 1 || inputs.length > 3) return null;
  let next = 0;
  const order = [];
  for (const input of inputs) {
    if (input?.media_id) {
      if (!MEDIA_ID_RE.test(String(input.media_id))) return null;
      order.push({ media_id: String(input.media_id) });
    } else {
      const image = images[next];
      next += 1;
      if (!image?.base64) return null;
      order.push({ image_index: next - 1 });
    }
  }
  return next === images.length ? order : null;
}

/** Chạy trong service worker (không serialize). Chỉ true cho tổ hợp đã chứng minh. */
export function canUseHttpVideo(req) {
  if (!req || req.transport !== 'http') return false;
  const mode = req.input_mode || 'text_to_video';
  const model = String(req.provider_model_id || '');
  if (mode === 'text_to_video') {
    if (!VERIFIED_HTTP_MODEL.test(model)) return false;
  } else if (mode === 'frames') {
    const m = VERIFIED_FRAMES_MODEL.exec(model);
    if (!m || Number(req.duration_seconds) !== Number(m[1])) return false;       // thời lượng khớp hậu tố model id
    if (!req.image_base64 || !req.end_image_base64) return false;                // i2v_fl cần CẢ khung đầu và khung cuối
    const dims = [req.image_width, req.image_height, req.end_image_width, req.end_image_height].map(Number);
    if (!dims.every((n) => Number.isFinite(n) && n > 0)) return false;           // cần kích thước ảnh để tính hình chữ nhật cắt
  } else if (mode === 'ingredients') {
    const m = VERIFIED_R2V_MODEL.exec(model);
    if (!m || Number(req.duration_seconds) !== Number(m[1])) return false;       // thời lượng khớp model id
    const images = Array.isArray(req.ingredient_images) ? req.ingredient_images : [];
    const ids = Array.isArray(req.ingredient_media_ids) ? req.ingredient_media_ids : [];
    const total = images.length + ids.length;                                                          // ảnh tải lên + ảnh có sẵn trong project
    if (total < 1 || total > 3 || !images.every((i) => i && i.base64)) return false;                   // tối đa 3 ảnh tham chiếu
    if (!ids.every((x) => typeof x === 'string' && MEDIA_ID_RE.test(x))) return false;
  } else if (mode === 'video_edit') {
    if (!VERIFIED_EDIT_MODEL.test(model) || (req.resolution || '720p') !== '720p') return false;
    if (!MEDIA_ID_RE.test(String(req.reference_video_id || ''))) return false;
    const start = Number(req.reference_video_start_seconds || 0);
    const end = Number(req.reference_video_end_seconds);
    if (!(start >= 0) || !(end > start) || end - start > 10) return false;   // Flow nhận tối đa 10 giây video mẫu
    if (!motionImageOrder(req)) return false;                                // 1–3 ảnh (HAR chỉ có trường hợp có ảnh)
  } else {
    return false;
  }
  // Độ phân giải nằm trong model id: hậu tố _360p <=> 360p; phải khớp với request.resolution
  if (model.endsWith('_360p') !== ((req.resolution || '720p') === '360p')) return false;
  if (!['720p', '360p'].includes(req.resolution || '720p')) return false;
  if (!['16:9', '9:16'].includes(req.aspect_ratio)) return false;
  if (Number(req.num_outputs || 1) !== 1) return false;
  return true;
}

export async function runFlowHttpVideoInPage(flowRequest, _captchaToken, opts = {}) {
  const pollMs = opts.pollMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 600_000;
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const w = typeof window !== 'undefined' ? window : globalThis;
  let submitted = false;
  let mediaId = null;
  let credit = null;
  let startMediaId = null;
  let endMediaId = null;
  let ingredientMediaIds = null;

  try {
    const prompt = typeof flowRequest?.prompt === 'string' ? flowRequest.prompt.trim() : '';
    if (!prompt) throw new Error('Flow prompt is empty');
    const modelId = String(flowRequest?.provider_model_id || '');
    const isFrames = (flowRequest?.input_mode || 'text_to_video') === 'frames';
    const isIngredients = flowRequest?.input_mode === 'ingredients';
    const isEdit = flowRequest?.input_mode === 'video_edit';
    const modelOk = isFrames ? /^macaron_cookie_i2v_fl_(6|10)s(_360p)?$/.test(modelId)
      : isIngredients ? /^macaron_cookie_r2v_([3-9]|1[0-5])s(_360p)?$/.test(modelId)
        : isEdit ? modelId === 'macaron_cookie_edit'
          : /^macaron_cookie_t2v_10s(_360p)?$/.test(modelId);
    if (!modelOk) throw new Error(`HTTP path không hỗ trợ model ${modelId || '(trống)'}`);
    const aspectEnum = { '9:16': 1, '16:9': 2 }[flowRequest?.aspect_ratio];
    if (!aspectEnum) throw new Error(`HTTP path không hỗ trợ aspect_ratio ${flowRequest?.aspect_ratio || '(trống)'}`);

    // ── Session từ trang ──────────────────────────────────────────────────
    const route = location.pathname.match(/^(\/u\/\d+)?\/project\/([0-9a-f-]{36})/i);
    const accountPath = route?.[1] || '';
    const projectId = route?.[2] || null;
    if (location.hostname !== 'flow.google.com' || !projectId) {
      throw new Error('Vui lòng mở một Dự án (Project) trên tab Google Flow trước khi bấm Tạo video');
    }
    const wiz = w.WIZ_global_data || {};
    const at = wiz.SNlM0e; const sid = wiz.FdrFJe; const bl = wiz.cfb2h;
    if (!at || !sid || !bl) throw new Error('Flow page session config is incomplete; reload the project');
    const sidNum = Number(sid);
    if (Number.isFinite(sidNum) && sidNum !== 0 && Math.abs(sidNum) < 1e6) {
      throw new Error(`Flow session ID không hợp lệ (sid=${sidNum}); trang chưa load xong WIZ_global_data`);
    }
    const sourcePath = `${accountPath}/project/${projectId}`;
    const hl = String(document?.documentElement?.lang || 'en').split('-')[0];
    const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : '00000000-0000-4000-8000-000000000000').toUpperCase();

    async function rpc(rpcId, payload) {
      const query = new URLSearchParams({
        rpcids: rpcId, 'source-path': sourcePath, bl: String(bl), 'f.sid': String(sid), hl,
        _reqid: String(100000 + Math.floor(Math.random() * 900000)), rt: 'c',
      });
      const body = new URLSearchParams({
        'f.req': JSON.stringify([[[rpcId, JSON.stringify(payload), null, 'generic']]]),
        at: String(at),
      });
      const res = await fetch(`${location.origin}${accountPath}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`, {
        method: 'POST', credentials: 'include', cache: 'no-store',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
        body: body.toString(),
      });
      if (!res.ok) throw new Error(`Flow RPC ${rpcId} failed: HTTP ${res.status}`);
      const text = await res.text();
      let envelopeError = null;
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim().startsWith('[')) continue;
        let frames;
        try { frames = JSON.parse(line); } catch { continue; }
        if (!Array.isArray(frames)) continue;
        for (const item of frames) {
          if (!Array.isArray(item)) continue;
          if (item[0] === 'wrb.fr' && item[1] === rpcId) {
            if (typeof item[2] === 'string') return JSON.parse(item[2]);
            envelopeError = `Flow RPC ${rpcId} envelope error: ${JSON.stringify(item.slice(2, 6))}`;
          } else if (item[0] === 'er') {
            envelopeError = `Flow server error (er): ${JSON.stringify(item)}`;
          }
        }
      }
      throw new Error(envelopeError || `Flow RPC ${rpcId} returned no usable payload`);
    }

    async function freshCaptchaToken() {
      const g = w.grecaptcha?.enterprise;
      if (!g?.execute) throw new Error('reCAPTCHA chưa nạp trong trang Flow (mở project và đợi load xong)');
      let key = '';
      for (const s of (document.scripts || [])) {
        const m = /recaptcha\/enterprise\.js\?render=([^&]+)/.exec(s.src || '');
        if (m && m[1] !== 'explicit') { key = m[1]; break; }
      }
      if (!key && typeof performance?.getEntriesByType === 'function') {
        for (const e of performance.getEntriesByType('resource')) {
          const m = /google\.com\/recaptcha\/enterprise\/(?:anchor|reload|clr)\?(?:[^#]*&)?k=([^&]+)/.exec(e.name);
          if (m) { key = m[1]; break; }
        }
      }
      if (!key) {
        for (const f of (document.querySelectorAll?.('iframe[src*="recaptcha"]') || [])) {
          const m = /[?&]k=([^&]+)/.exec(f.src); if (m) { key = m[1]; break; }
        }
      }
      if (!key) throw new Error('Không tìm thấy site key reCAPTCHA trong trang Flow');
      if (typeof g.ready === 'function') await new Promise((resolve) => g.ready(resolve));
      const token = await g.execute(key, { action: 'VIDEO_GENERATION' });
      if (typeof token !== 'string' || !token) throw new Error('reCAPTCHA trả token rỗng');
      return token;
    }

    // Hình chữ nhật cắt ảnh về đúng tỉ lệ video: [trên, trái, dưới, phải] (0–1), null = 0 (khớp cách Flow gửi trong HAR).
    function centerCrop(width, height, targetAspect) {
      const ratio = width / height;
      if (Math.abs(ratio - targetAspect) < 1e-9) return [null, null, 1, 1];
      if (ratio > targetAspect) {                    // ảnh rộng hơn video -> cắt hai bên
        const frac = targetAspect / ratio;
        const left = (1 - frac) / 2;
        return [null, left, 1, left + frac];
      }
      const frac = ratio / targetAspect;             // ảnh cao hơn video -> cắt trên/dưới
      const top = (1 - frac) / 2;
      return [top, null, top + frac, 1];
    }

    // Upload một ảnh vào project (RPC maseQ, cùng RPC mà giao diện Flow dùng khi bạn tải ảnh lên). Thất bại = chưa gửi gì, không mất credit.
    const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    async function uploadImage(base64, mime, filename) {
      const raw = String(base64 || '').includes(',') ? String(base64).split(',')[1] : String(base64 || '');
      if (!raw) throw new Error('Ảnh khung hình trống');
      const data = await rpc('maseQ', [
        [null, 22, null, null, null, projectId, null, null, null, null, null],
        raw, mime || 'image/png', true, null, null, null, false, filename || 'frame.png',
      ]);
      let id = data?.[0]?.[0];
      if (!(typeof id === 'string' && UUID_RE.test(id) && data?.[0]?.[1] === projectId)) {
        id = null;
        const find = (node) => {
          if (typeof node === 'string') return node !== projectId && UUID_RE.test(node) ? node : null;
          if (Array.isArray(node)) { for (const x of node) { const f = find(x); if (f) return f; } }
          return null;
        };
        id = find(data);
      }
      if (!id) throw new Error(`Upload ảnh lên Flow không trả media id: ${JSON.stringify(data).slice(0, 160)}`);
      return id;
    }

    // ── Submit ────────────────────────────────────────────────────────────
    let rpcId = 'YhhmEf';
    let createPayload;
    if (isFrames) {
      const targetAspect = flowRequest.aspect_ratio === '9:16' ? 9 / 16 : 16 / 9;
      startMediaId = await uploadImage(flowRequest.image_base64, flowRequest.image_mime, flowRequest.image_name);
      endMediaId = await uploadImage(flowRequest.end_image_base64, flowRequest.end_image_mime, flowRequest.end_image_name);
      const slot = (id, w, h) => [null, id, null, null, null, centerCrop(Number(w), Number(h), targetAspect)];
      const token = await freshCaptchaToken();       // token tươi ngay trước khi gửi (sau khi upload xong)
      rpcId = 'nprQif';
      createPayload = [
        [[[null, null, [[[prompt]]]], modelId, aspectEnum, null,
          slot(startMediaId, flowRequest.image_width, flowRequest.image_height),
          slot(endMediaId, flowRequest.end_image_width, flowRequest.end_image_height),
          [null, null, null, null, uuid(), uuid()]]],
        [null, 22, null, null, null, projectId, null, null, null, null, [token, 1]],
        [uuid(), 2],
      ];
    } else if (isEdit) {
      // Motion Control: ảnh giữ đúng thứ tự (nhân vật trước, bối cảnh sau); video mẫu phải xử lý xong rồi mới gửi.
      const videoId = String(flowRequest.reference_video_id || '');
      if (!UUID_RE.test(videoId)) throw new Error('Motion Control cần mã video mẫu đã tải lên Flow');
      const startSec = Number(flowRequest.reference_video_start_seconds || 0);
      const endSec = Number(flowRequest.reference_video_end_seconds);
      if (!(startSec >= 0) || !(endSec > startSec) || endSec - startSec > 10) {
        throw new Error('Đoạn cắt video mẫu không hợp lệ (tối đa 10 giây)');
      }
      const images = Array.isArray(flowRequest.ingredient_images) ? flowRequest.ingredient_images : [];
      const inputs = Array.isArray(flowRequest.ingredient_inputs) && flowRequest.ingredient_inputs.length
        ? flowRequest.ingredient_inputs
        : [...(flowRequest.ingredient_media_ids || []).map((media_id) => ({ media_id })), ...images.map(() => ({ local: true }))];
      if (inputs.length < 1 || inputs.length > 3) throw new Error('Motion Control cần 1–3 ảnh tham chiếu');
      ingredientMediaIds = [];
      let nextImage = 0;
      for (const input of inputs) {
        if (input?.media_id) {
          if (!UUID_RE.test(String(input.media_id))) throw new Error('Mã media ảnh tham chiếu không hợp lệ');
          ingredientMediaIds.push(String(input.media_id));
        } else {
          const img = images[nextImage];
          nextImage += 1;
          if (!img?.base64) throw new Error('Thiếu dữ liệu ảnh tham chiếu Motion Control');
          ingredientMediaIds.push(await uploadImage(img.base64, img.mime, img.filename));
        }
      }
      // jwpduf: state 1 = video mẫu đang xử lý, 3 = sẵn sàng. Chưa gửi gì tốn credit trong lúc chờ.
      const readyDeadline = Date.now() + (opts.sourceReadyTimeoutMs ?? 240_000);
      for (;;) {
        const polled = await rpc('jwpduf', [null, null, [[videoId]]]);
        const rec = polled?.[2]?.find?.((r) => r?.[0] === videoId);
        if (!rec) throw new Error('Flow không tìm thấy video mẫu trong project này (hãy tải lại video mẫu)');
        const sourceState = rec?.[5]?.[8]?.[0];
        if (sourceState === 3) break;
        if (![1, 2, 6, undefined, null].includes(sourceState)) throw new Error(`Flow xử lý video mẫu bị lỗi (trạng thái ${sourceState})`);
        if (Date.now() > readyDeadline) throw new Error('Video mẫu chưa xử lý xong trên Flow; chưa gửi lệnh tạo video, hãy thử lại sau');
        await sleep(pollMs);
      }
      const token = await freshCaptchaToken();
      rpcId = 'jIps6';
      createPayload = [
        [[[null, videoId, Math.round(startSec * 30), Math.round(endSec * 30)], [null, null, [[[prompt]]]], modelId,
          Number(flowRequest.num_outputs || 1), [null, null, null, null, uuid(), uuid()], null, null, null,
          ingredientMediaIds.map((id) => [null, id])]],
        [null, 22, null, null, null, projectId, null, null, null, null, [token, 1]],
        [uuid(), 2],
      ];
    } else if (isIngredients) {
      const images = Array.isArray(flowRequest.ingredient_images) ? flowRequest.ingredient_images : [];
      const existing = Array.isArray(flowRequest.ingredient_media_ids) ? flowRequest.ingredient_media_ids.filter(Boolean) : [];
      if (images.length + existing.length < 1 || images.length + existing.length > 3) throw new Error('Ingredients cần 1–3 ảnh tham chiếu');
      if (!existing.every((x) => UUID_RE.test(String(x)))) throw new Error('Mã media ảnh tham chiếu không hợp lệ');
      ingredientMediaIds = [...existing];                        // ảnh đã có sẵn trong project: dùng thẳng, không upload lại
      for (const img of images) ingredientMediaIds.push(await uploadImage(img.base64, img.mime, img.filename));
      const token = await freshCaptchaToken();
      rpcId = 'MZZa6b';
      // item = [[null,null,[[[prompt]]]], [[null,idẢnh]...], model, aspect, null, [null,null,null,null,idA,idB]] (+ cờ [4] ở vị trí 11 khi 360p)
      const item = [[null, null, [[[prompt]]]], ingredientMediaIds.map((id) => [null, id]), modelId, aspectEnum, null,
        [null, null, null, null, uuid(), uuid()]];
      if (modelId.endsWith('_360p')) item.push(null, null, null, null, null, [4]);
      createPayload = [
        [item],
        [null, 22, null, null, null, projectId, null, null, null, null, [token, 1]],
        [uuid(), 2],
      ];
    } else {
      const token = await freshCaptchaToken();
      createPayload = [
        [[[null, null, [[[prompt]]]], modelId, aspectEnum, null, [null, null, null, null, uuid(), uuid()]]],
        [null, 22, null, null, null, projectId, null, null, null, null, [token, 1]],
        [uuid(), 2],
      ];
    }
    const created = await rpc(rpcId, createPayload);
    const record = created?.[3]?.[0];
    mediaId = typeof record?.[0] === 'string' ? record[0] : null;
    credit = Number.isFinite(Number(created?.[1])) ? Number(created[1]) : null;
    if (!mediaId) {
      // Bị từ chối trước khi tạo (không trừ credit) -> cho phép caller fallback sang đường giao diện
      throw new Error(`Flow create response did not contain a media id: ${JSON.stringify(created).slice(0, 200)}`);
    }
    submitted = true;
    try { w.__FLOW_ACTIVE_GENERATION__ = { mediaId, projectId, modelId, startTime: Date.now(), prompt }; } catch { /* ignore */ }

    // ── Poll ──────────────────────────────────────────────────────────────
    const stateOf = (r) => r?.[5]?.[8]?.[0];
    // Khi Flow báo lỗi, giữ lại bằng chứng để biết vì sao: chuỗi lý do + hình dạng bản ghi. URL/uuid/chuỗi dài bị che (không lộ URL ký).
    const describeFailure = (rec) => {
      try {
        const scrub = (node, depth) => {
          if (node === null || typeof node === 'number' || typeof node === 'boolean') return node;
          if (typeof node === 'string') {
            if (/^https?:\/\//i.test(node)) return '<url>';
            if (UUID_RE.test(node)) return '<id>';
            return node.length > 90 ? `${node.slice(0, 90)}…` : node;
          }
          if (Array.isArray(node)) return depth > 7 ? '[…]' : node.slice(0, 24).map((x) => scrub(x, depth + 1));
          return '<obj>';
        };
        const text = JSON.stringify(scrub(rec, 0));
        return ` [bản ghi poll: ${text.length > 700 ? `${text.slice(0, 700)}…` : text}]`;
      } catch { return ''; }
    };
    let state = stateOf(record);
    const deadline = Date.now() + timeoutMs;
    let consecutiveErrors = 0;
    while (state !== 3) {
      if (Date.now() > deadline) throw new Error('Timed out waiting for Flow render');
      await sleep(pollMs);
      try {
        const polled = await rpc('jwpduf', [null, null, [[mediaId]]]);
        const rec = polled?.[2]?.find?.((r) => r?.[0] === mediaId);
        if (!rec) throw new Error('poll response has no record for this media id');
        consecutiveErrors = 0;
        state = stateOf(rec);
        if (state === undefined || state === null) continue;
        if (![1, 2, 3, 6].includes(state)) throw new Error(`Flow render ended with status ${state}${describeFailure(rec)}`);
      } catch (err) {
        if (String(err?.message || '').startsWith('Flow render ended')) throw err;
        if (++consecutiveErrors >= 5) throw err;
      }
    }

    // ── URL mp4 đã ký ─────────────────────────────────────────────────────
    let asset = null;
    let videoUrl = null;
    for (let attempt = 0; attempt < 4 && !videoUrl; attempt++) {
      if (attempt) await sleep(Math.min(pollMs, 2000));
      asset = await rpc('as29s', [mediaId]);
      const candidate = asset?.[7]?.[0]?.[8];
      if (typeof candidate === 'string' && candidate.startsWith('https://flow-content.google/video/')) videoUrl = candidate;
    }
    if (!videoUrl) throw new Error('Flow render xong nhưng không lấy được URL video (as29s)');
    const imageUrl = typeof asset?.[5]?.[10] === 'string' ? asset[5][10] : null;
    try { if (w.__FLOW_ACTIVE_GENERATION__?.mediaId === mediaId) w.__FLOW_ACTIVE_GENERATION__ = null; } catch { /* ignore */ }

    return {
      ok: true, submitted: true, video_url: videoUrl, image_url: imageUrl, media_id: mediaId,
      provider_model_id: modelId, project_id: projectId, credit_balance: credit, transport: 'http',
      start_media_id: startMediaId, end_media_id: endMediaId, ingredient_media_ids: ingredientMediaIds,
      ...(isEdit ? {
        diagnostics: {
          adapter: 'motion-http-v1', rpc: 'jIps6', reference_video_id: flowRequest.reference_video_id,
          reference_start_seconds: flowRequest.reference_video_start_seconds,
          reference_end_seconds: flowRequest.reference_video_end_seconds,
          ingredient_media_ids: ingredientMediaIds, prompt_verified: true,
        },
      } : {}),
    };
  } catch (error) {
    // submitted=true: video có thể đang/đã render, KHÔNG được gửi lại (sẽ trừ credit lần nữa)
    return {
      ok: false, submitted, media_id: mediaId, credit_balance: credit, transport: 'http', error: error?.message || String(error),
      start_media_id: startMediaId, end_media_id: endMediaId, ingredient_media_ids: ingredientMediaIds,
    };
  }
}
