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
//   NHIỀU BIẾN THỂ + 360p — HAR flow.google_video_2311.com (2026-11-23, giao diện Flow chọn x3, 360p, video 13,6 giây):
//     MỘT request jIps6 chứa N item GIỐNG HỆT nhau, chỉ khác cặp uuid ở item[4]; item[3] (sốVideo) vẫn = 1.
//     Response payload[3] = N record (mỗi biến thể một media id). 360p: model 'macaron_cookie_edit_360p' + cờ [4] ở item[12]
//     (item dài 13: thêm null, null, null, [4]). jwpduf hỏi cả N id một lần; mỗi id có kết cục riêng (HAR: 2 xong, 1 bị
//     PUBLIC_ERROR_PROMINENT_PEOPLE_FILTER_FAILED). 5–16 giây đầu jwpduf trả state 4 "Media not found." cho id vừa tạo -> chưa
//     phải lỗi. Giá: 678 sau lệnh (trước đó 726) = 16 credit/video 13 giây 360p.
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
// Motion Control: 720p (HAR flow.google_video_motion.com) và 360p (HAR flow.google_video_2311.com, hậu tố _360p + cờ [4]).
const VERIFIED_EDIT_MODEL = /^macaron_cookie_edit(_360p)?$/;
/**
 * Số video tối đa trong MỘT lệnh Motion Control (giao diện Flow cho x1–x4; HAR x3). Extension báo số này trong heartbeat
 * (`capabilities.motion_max_outputs`) để backend không gửi nhiều video cho bản extension cũ. Backend: veo/service.MOTION_MAX_OUTPUTS.
 */
export const MOTION_MAX_OUTPUTS = 4;
/**
 * Ảnh tham chiếu tối đa của Motion Control / chỉnh video: 5 (người dùng xác nhận trên giao diện Flow 2026-11-23; HAR cũ có 1–3,
 * mỗi ảnh là một phần tử [null, mediaId] ở item[8]). Báo trong heartbeat (`capabilities.motion_max_images`). Backend:
 * veo/service.MOTION_MAX_IMAGES. runFlowHttpVideoInPage lặp lại số 5 dạng chữ (có test giữ khớp). Ingredients r2v vẫn 3.
 */
export const MOTION_MAX_IMAGES = 5;
/**
 * Đoạn video mẫu dài nhất (giây) extension nhận qua đường HTTP. Extension BÁO số này trong heartbeat
 * (`capabilities.motion_ref_max_seconds`) để backend chặn sớm khi extension trong Chrome còn là bản cũ — bản cũ không báo gì
 * và âm thầm rơi sang điều khiển giao diện Flow. Backend: veo/service.MOTION_REF_MAX_SECONDS (đổi thì đổi cả hai).
 * runFlowHttpVideoInPage bị serialize vào tab nên không dùng được hằng này: nó lặp lại số 15 (có test giữ hai nơi khớp).
 */
export const MOTION_REF_MAX_SECONDS = 15;
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
  if (inputs.length < 1 || inputs.length > MOTION_MAX_IMAGES) return null;
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
    if (!VERIFIED_EDIT_MODEL.test(model)) return false;                      // 720p hoặc 360p (hậu tố kiểm ở dưới)
    if (!MEDIA_ID_RE.test(String(req.reference_video_id || ''))) return false;
    const start = Number(req.reference_video_start_seconds || 0);
    const end = Number(req.reference_video_end_seconds);
    if (!(start >= 0) || !(end > start) || end - start > MOTION_REF_MAX_SECONDS) return false;   // Flow nhận tối đa 15 giây video mẫu
    if (!motionImageOrder(req)) return false;                                // 1–5 ảnh (không ảnh nào thì chưa có HAR)
  } else {
    return false;
  }
  // Độ phân giải nằm trong model id: hậu tố _360p <=> 360p; phải khớp với request.resolution
  if (model.endsWith('_360p') !== ((req.resolution || '720p') === '360p')) return false;
  if (!['720p', '360p'].includes(req.resolution || '720p')) return false;
  if (!['16:9', '9:16'].includes(req.aspect_ratio)) return false;
  // Nhiều video trong một lệnh: chỉ Motion Control có HAR (N item trong payload); các chế độ khác vẫn 1.
  const outputs = Number(req.num_outputs || 1);
  const maxOutputs = mode === 'video_edit' ? MOTION_MAX_OUTPUTS : 1;
  if (!Number.isInteger(outputs) || outputs < 1 || outputs > maxOutputs) return false;
  return true;
}

export async function runFlowHttpVideoInPage(flowRequest, _captchaToken, opts = {}) {
  const pollMs = opts.pollMs ?? 5000;
  const timeoutMs = opts.timeoutMs ?? 600_000;
  // Gửi xong, các media id được ghi vào sessionStorage của tab (còn nguyên khi trang Flow tải lại / chuyển trang). Nếu lệnh
  // executeScript đang chờ bị mất (trang đổi), service worker gọi lại hàm này với opts.resume = true cùng opts.nonce: hàm
  // KHÔNG gửi lại gì, chỉ đọc đúng các media id đã ghi rồi hỏi trạng thái / lấy URL tiếp — không đoán "video đang mở".
  const nonce = typeof opts.nonce === 'string' ? opts.nonce : '';
  const resume = opts.resume === true && Boolean(nonce);
  const storeKey = nonce ? `_vf_http_gen:${nonce}` : '';
  const store = {
    read() {
      try { return storeKey ? JSON.parse(globalThis.sessionStorage?.getItem(storeKey) || 'null') : null; } catch { return null; }
    },
    write(value) {
      try {
        if (!storeKey || !globalThis.sessionStorage) return;
        const ss = globalThis.sessionStorage;
        for (let i = ss.length - 1; i >= 0; i--) {                 // dọn bản ghi cũ hơn 1 ngày
          const k = ss.key(i);
          if (k && k.startsWith('_vf_http_gen:')) {
            try { if (Date.now() - (JSON.parse(ss.getItem(k) || '{}').at || 0) > 86_400_000) ss.removeItem(k); } catch { ss.removeItem(k); }
          }
        }
        ss.setItem(storeKey, JSON.stringify({ ...value, at: Date.now() }));
      } catch { /* sessionStorage bị chặn: vẫn chạy, chỉ mất khả năng chạy tiếp */ }
    },
    forget() {
      try { if (storeKey) globalThis.sessionStorage?.removeItem(storeKey); } catch { /* ignore */ }
    },
  };
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const w = typeof window !== 'undefined' ? window : globalThis;
  let submitted = false;
  let mediaId = null;
  let mediaIds = [];
  let createdRecords = [];
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
        : isEdit ? /^macaron_cookie_edit(_360p)?$/.test(modelId)
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
    if (resume) {
      const saved = store.read();
      if (!saved || !Array.isArray(saved.mediaIds) || !saved.mediaIds.length) {
        // Không có dấu vết lượt gửi trong tab: có thể chưa gửi được, hoặc tab đã đổi hẳn. Không đoán, để bên gọi quyết định.
        return { ok: false, resume_missing: true, transport: 'http', error: 'Không còn thông tin lượt tạo video trong tab Flow' };
      }
      if (saved.projectId && saved.projectId !== projectId) {
        return { ok: false, resume_missing: true, transport: 'http', error: 'Tab Flow đã sang project khác' };
      }
      mediaIds = saved.mediaIds.filter((x) => typeof x === 'string');
      mediaId = mediaIds[0] || null;
      credit = Number.isFinite(Number(saved.credit)) ? Number(saved.credit) : null;
      ingredientMediaIds = Array.isArray(saved.ingredientMediaIds) ? saved.ingredientMediaIds : null;
      startMediaId = saved.startMediaId || null;
      endMediaId = saved.endMediaId || null;
      submitted = true;
    } else {
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
        if (!(startSec >= 0) || !(endSec > startSec) || endSec - startSec > 15) {
          throw new Error('Đoạn cắt video mẫu không hợp lệ (tối đa 15 giây)');
        }
        const images = Array.isArray(flowRequest.ingredient_images) ? flowRequest.ingredient_images : [];
        const inputs = Array.isArray(flowRequest.ingredient_inputs) && flowRequest.ingredient_inputs.length
          ? flowRequest.ingredient_inputs
          : [...(flowRequest.ingredient_media_ids || []).map((media_id) => ({ media_id })), ...images.map(() => ({ local: true }))];
        if (inputs.length < 1 || inputs.length > 5) throw new Error('Motion Control cần 1–5 ảnh tham chiếu');
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
        // N biến thể = N item giống hệt nhau, mỗi item một cặp uuid mới; item[3] luôn 1 (HAR x3). 360p: thêm cờ [4] ở item[12].
        const count = Math.min(4, Math.max(1, Math.floor(Number(flowRequest.num_outputs || 1)) || 1));
        const editItem = () => {
          const item = [[null, videoId, Math.round(startSec * 30), Math.round(endSec * 30)], [null, null, [[[prompt]]]], modelId,
            1, [null, null, null, null, uuid(), uuid()], null, null, null,
            ingredientMediaIds.map((id) => [null, id])];
          if (modelId.endsWith('_360p')) item.push(null, null, null, [4]);
          return item;
        };
        createPayload = [
          Array.from({ length: count }, editItem),
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
      createdRecords = Array.isArray(created?.[3]) ? created[3] : [];
      mediaIds = createdRecords.map((r) => (typeof r?.[0] === 'string' ? r[0] : null)).filter(Boolean);
      mediaId = mediaIds[0] || null;
      credit = Number.isFinite(Number(created?.[1])) ? Number(created[1]) : null;
      if (!mediaId) {
        // Bị từ chối trước khi tạo (không trừ credit) -> cho phép caller fallback sang đường giao diện
        throw new Error(`Flow create response did not contain a media id: ${JSON.stringify(created).slice(0, 200)}`);
      }
      submitted = true;
      store.write({ mediaIds, credit, projectId, modelId, ingredientMediaIds, startMediaId, endMediaId });
      try { w.__FLOW_ACTIVE_GENERATION__ = { mediaId, projectId, modelId, startTime: Date.now(), prompt }; } catch { /* ignore */ }
    }

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
    // Mỗi media id (mỗi biến thể) có kết cục riêng: 3 = xong; lỗi của một biến thể KHÔNG làm hỏng các biến thể khác.
    const states = {};
    const failures = {};
    for (const id of mediaIds) states[id] = stateOf(createdRecords.find((r) => r?.[0] === id));
    const isDone = (id) => states[id] === 3 || Boolean(failures[id]);
    const submittedAt = Date.now();
    const deadline = submittedAt + timeoutMs;
    // HAR 2026-11-23: 5–16 giây đầu jwpduf trả state 4 "Media not found." cho id vừa tạo — Flow chưa ghi xong, không phải lỗi.
    const NOT_FOUND_GRACE_MS = 120_000;
    let consecutiveErrors = 0;
    while (!mediaIds.every(isDone)) {
      if (Date.now() > deadline) {
        for (const id of mediaIds) if (!isDone(id)) failures[id] = 'Timed out waiting for Flow render';
        break;
      }
      await sleep(pollMs);
      const pending = mediaIds.filter((id) => !isDone(id));
      try {
        const polled = await rpc('jwpduf', [null, null, pending.map((id) => [id])]);
        const recs = Array.isArray(polled?.[2]) ? polled[2] : [];
        if (!pending.some((id) => recs.some((r) => r?.[0] === id))) throw new Error('poll response has no record for these media ids');
        consecutiveErrors = 0;
        for (const id of pending) {
          const rec = recs.find((r) => r?.[0] === id);
          const st = stateOf(rec);
          if (!rec || st === undefined || st === null) continue;
          if ([1, 2, 3, 6].includes(st)) { states[id] = st; continue; }
          const notYet = st === 4 && /Media not found/i.test(JSON.stringify(rec?.[5]?.[8] ?? ''))
            && Date.now() - submittedAt < NOT_FOUND_GRACE_MS;
          if (!notYet) failures[id] = `Flow render ended with status ${st}${describeFailure(rec)}`;
        }
      } catch (err) {
        if (++consecutiveErrors >= 5) throw err;
      }
    }

    // ── URL mp4 đã ký (mỗi biến thể xong) ─────────────────────────────────
    const outputs = [];
    for (const [index, id] of mediaIds.entries()) {
      if (failures[id]) { outputs.push({ index, ok: false, media_id: id, error: failures[id] }); continue; }
      let asset = null;
      let url = null;
      for (let attempt = 0; attempt < 4 && !url; attempt++) {
        if (attempt) await sleep(Math.min(pollMs, 2000));
        asset = await rpc('as29s', [id]);
        const candidate = asset?.[7]?.[0]?.[8];
        if (typeof candidate === 'string' && candidate.startsWith('https://flow-content.google/video/')) url = candidate;
      }
      outputs.push(url
        ? { index, ok: true, media_id: id, video_url: url, image_url: typeof asset?.[5]?.[10] === 'string' ? asset[5][10] : null }
        : { index, ok: false, media_id: id, error: 'Flow render xong nhưng không lấy được URL video (as29s)' });
    }
    const firstOk = outputs.find((o) => o.ok);
    store.forget(); // đã có kết cục cuối cho mọi video
    // Không biến thể nào ra video: báo lỗi (submitted=true — Flow đã nhận lệnh, KHÔNG gửi lại).
    if (!firstOk) throw new Error(outputs.map((o) => o.error).join(' | '));
    mediaId = firstOk.media_id;
    const videoUrl = firstOk.video_url;
    const imageUrl = firstOk.image_url;
    try { if (mediaIds.includes(w.__FLOW_ACTIVE_GENERATION__?.mediaId)) w.__FLOW_ACTIVE_GENERATION__ = null; } catch { /* ignore */ }

    return {
      ok: true, submitted: true, video_url: videoUrl, image_url: imageUrl, media_id: mediaId,
      // Nhiều biến thể trong một lệnh: kết quả từng biến thể theo thứ tự item (ok + video_url, hoặc error).
      ...(mediaIds.length > 1 ? { outputs } : {}),
      ...(resume ? { resumed_after_lost_result: true } : {}),
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
      ok: false, submitted, media_id: mediaId, media_ids: mediaIds, credit_balance: credit, transport: 'http', error: error?.message || String(error),
      start_media_id: startMediaId, end_media_id: endMediaId, ingredient_media_ids: ingredientMediaIds,
    };
  }
}
