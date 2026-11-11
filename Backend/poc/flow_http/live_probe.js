/* PoC live: gọi Flow bằng HTTP thuần (batchexecute), KHÔNG bấm giao diện.
 *
 * Cách chạy: mở một PROJECT trên https://flow.google.com (đã đăng nhập) -> F12 -> Console -> dán toàn bộ file này -> Enter.
 *
 * Mặc định chỉ ĐỌC (0 credit): kiểm tra session/at/sid/bl + gọi RPC đọc `yBhWQ` (danh sách model) và `UpteDb`.
 * Muốn tạo 1 video thật (TỐN CREDIT) thì chạy thêm, ví dụ:
 *     await flowPoc({ submit: true, prompt: 'a red fox running in snow', model: 'macaron_cookie_t2v_10s', aspect: '16:9' })
 * Script không đọc/ghi DOM, không in cookie/token.
 */
(() => {
  const BATCH = '/_/AiSandboxAngularFrontend/data/batchexecute';
  const wiz = window.WIZ_global_data || {};
  const at = wiz.SNlM0e, sid = wiz.FdrFJe, bl = wiz.cfb2h;
  const m = location.pathname.match(/^(\/u\/\d+)?\/project\/([0-9a-f-]{36})/);
  const acct = (m && m[1]) || '/u/1';
  const projectId = m && m[2];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const uid = () => crypto.randomUUID().toUpperCase();

  async function rpc(id, payload) {
    const q = new URLSearchParams({
      rpcids: id, 'source-path': `${acct}/project/${projectId}`, bl: String(bl), 'f.sid': String(sid),
      hl: 'en', _reqid: String(100000 + Math.floor(Math.random() * 900000)), rt: 'c',
    });
    const body = new URLSearchParams({ 'f.req': JSON.stringify([[[id, JSON.stringify(payload), null, 'generic']]]), at });
    const res = await fetch(`${acct}${BATCH}?${q}`, {
      method: 'POST', credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
      body,
    });
    const text = await res.text();
    if (!res.ok) throw new Error(`${id}: HTTP ${res.status}`);
    for (const line of text.split(/\r?\n/)) {
      if (!line.startsWith('[')) continue;
      try {
        for (const it of JSON.parse(line)) {
          if (it[0] === 'wrb.fr' && it[1] === id) { if (it[2]) return JSON.parse(it[2]); throw new Error(`${id}: rpc error ${JSON.stringify(it.slice(2, 6))}`); }
        }
      } catch (e) { if (String(e.message).startsWith(id)) throw e; }
    }
    throw new Error(`${id}: không có payload`);
  }

  async function captcha() {
    const g = window.grecaptcha && window.grecaptcha.enterprise;
    if (!g || !g.execute) throw new Error('grecaptcha.enterprise chưa nạp (mở một project, đợi trang load xong)');
    let key = '', src = '';
    // 1) script enterprise.js?render=<key>
    for (const s of document.scripts) {
      const mm = /recaptcha\/enterprise\.js\?render=([^&]+)/.exec(s.src || '');
      if (mm && mm[1] !== 'explicit') { key = mm[1]; src = 'script'; break; }
    }
    // 2) request recaptcha thực tế trang đã gọi (anchor/reload?k=<key>)
    if (!key) {
      for (const e of performance.getEntriesByType('resource')) {
        const mm = /google\.com\/recaptcha\/enterprise\/(?:anchor|reload|clr)\?(?:[^#]*&)?k=([^&]+)/.exec(e.name);
        if (mm) { key = mm[1]; src = 'resource'; break; }
      }
    }
    // 3) iframe anchor
    if (!key) {
      for (const f of document.querySelectorAll('iframe[src*="recaptcha"]')) {
        const mm = /[?&]k=([^&]+)/.exec(f.src); if (mm) { key = mm[1]; src = 'iframe'; break; }
      }
    }
    // 4) registry nội bộ của reCAPTCHA
    if (!key) {
      const cl = window.___grecaptcha_cfg && window.___grecaptcha_cfg.clients;
      const walk = (o, d = 0) => { if (!o || typeof o !== 'object' || d > 4 || key) return;
        for (const v of Object.values(o)) { if (typeof v === 'string' && /^6L[\w-]{38}$/.test(v)) { key = v; src = 'registry'; return; } walk(v, d + 1); } };
      walk(cl);
    }
    // 5) key quan sát trong HAR 2026-11-09 (công khai, nằm trong URL reload?k=)
    if (!key) { key = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV'; src = 'har-fallback'; }
    console.log('%c[flowPoc]', 'color:#7c3aed', 'site key nguồn:', src, key.slice(0, 8) + '…');
    await new Promise((r) => g.ready(r));
    return g.execute(key, { action: 'VIDEO_GENERATION' });
  }

  window.flowPoc = async function flowPoc(opt = {}) {
    const log = (...a) => console.log('%c[flowPoc]', 'color:#7c3aed', ...a);
    if (!at || !sid || !bl || !projectId) throw new Error(`Thiếu session: at=${!!at} sid=${!!sid} bl=${!!bl} project=${!!projectId}. Mở một PROJECT Flow rồi chạy lại.`);
    log('session OK', { account: acct, project: projectId.slice(0, 8), atLen: at.length, bl });

    // 1) Đọc, không tốn credit
    const models = await rpc('yBhWQ', []);
    log('model khả dụng:', JSON.stringify(models));
    // 1b) Chỉ lấy link/tải của video ĐÃ có (không tạo mới, 0 credit): flowPoc({ mediaId: '<id>' })
    if (opt.mediaId) return fetchAsset(opt.mediaId, performance.now(), opt);
    if (!opt.submit) { log('Chế độ chỉ đọc xong. Thêm { submit: true } để tạo 1 video thật (tốn credit).'); return { models }; }

    // 1c) Burst: N video liên tiếp để thử giới hạn tốc độ (TỐN N lần credit)
    if (opt.burst > 1) return burst(opt);

    // 2) Submit text-to-video qua HTTP
    const t0 = performance.now();
    const { mediaId, state: st0, credit, echoModel, resCode } = await submitOne(opt.prompt || 'a red fox running in snow', opt.model, opt.aspect);
    log('submit OK', { mediaId, state: st0, creditField: credit, echoModel, resCode });

    // 3) Poll tới khi state = 3
    await pollDone(mediaId, (i, s) => log(`poll #${i} state=${s}`));

    return fetchAsset(mediaId, t0, opt);
  };

  // aspect: '9:16' -> item[2] = 1 (dọc), '16:9' -> item[2] = 2 (ngang). Xác nhận qua HAR UI 16:9: item[2]=2 và telemetry aspectRatio=2.
  async function submitOne(prompt, model, aspect = '9:16') {
    const token = await captcha();
    const payload = [
      [[[null, null, [[[prompt]]]], model || 'macaron_cookie_t2v_10s', aspect === '16:9' ? 2 : 1, null, [null, null, null, null, uid(), uid()]]],
      [null, 22, null, null, null, projectId, null, null, null, null, [token, 1]],
      [uid(), 2],
    ];
    const sub = await rpc('YhhmEf', payload);
    const rec = sub[3][0];
    // echo của server: record[5][6][1][0] = [modelId, kind, ..., resCode]; resCode 1 = 720p, 4 = 360p (HAR 2026-11-09 v2)
    return { mediaId: rec[0], state: rec[5][8][0], credit: sub[1], echoModel: rec?.[5]?.[6]?.[1]?.[0]?.[0], resCode: rec?.[5]?.[6]?.[1]?.[0]?.[5] };
  }

  async function pollDone(mediaId, onTick) {
    let state = 6;
    for (let i = 1; i <= 90 && state !== 3; i++) {
      await sleep(5000);
      const p = await rpc('jwpduf', [null, null, [[mediaId]]]);
      state = p[2][0][5][8][0];
      onTick && onTick(i, state);
      if (![2, 6, 3].includes(state)) throw new Error(`state lạ: ${state}`);
    }
    if (state !== 3) throw new Error('quá thời gian chờ render');
  }

  // Burst: submit N video cách nhau gapMs, dừng ngay khi Google từ chối; rồi poll song song tất cả.
  async function burst(opt) {
    const log = (...a) => console.log('%c[flowPoc:burst]', 'color:#dc2626', ...a);
    const n = Math.min(opt.burst, 6), gap = opt.gapMs ?? 4000;
    const base = opt.prompt || 'a red fox running in snow';
    const t0 = performance.now(), jobs = [];
    for (let i = 1; i <= n; i++) {
      const t = Math.round(performance.now() - t0);
      try {
        const r = await submitOne(`${base} (${i})`, opt.model, opt.aspect);
        jobs.push(r);
        log(`#${i} submit OK +${t}ms`, { mediaId: r.mediaId.slice(0, 8), credit: r.credit });
      } catch (e) {
        log(`#${i} BỊ TỪ CHỐI +${t}ms:`, String(e.message).slice(0, 300));
        break;
      }
      if (i < n) await sleep(gap);
    }
    log(`đã submit ${jobs.length}/${n}. Poll song song...`);
    const outcomes = await Promise.all(jobs.map(async (j) => {
      try { await pollDone(j.mediaId); return { id: j.mediaId.slice(0, 8), ok: true }; }
      catch (e) { return { id: j.mediaId.slice(0, 8), ok: false, err: String(e.message) }; }
    }));
    const secs = Math.round((performance.now() - t0) / 1000);
    log('KẾT QUẢ', { submitted: jobs.length, requested: n, gapMs: gap, totalSeconds: secs, outcomes, mediaIds: jobs.map((j) => j.mediaId) });
    return { submitted: jobs.length, requested: n, outcomes, mediaIds: jobs.map((j) => j.mediaId) };
  }

  // 4) Lấy URL mp4 đã ký. HAR: as29s với payload [mediaId] (KHÔNG có [null,[1]] - biến thể đó chỉ trả thumbnail lh3).
  async function fetchAsset(mediaId, t0, opt = {}) {
    const log = (...a) => console.log('%c[flowPoc]', 'color:#7c3aed', ...a);
    const asset = await rpc('as29s', [mediaId]);
    const flat = JSON.stringify(asset).replace(/\\u0026/g, '&').replace(/\\u003d/g, '=');
    const url = (flat.match(/https:\/\/flow-content\.google\/video\/[0-9a-f-]{36}\?[^"\\\s]+/) || [])[0];
    const secs = Math.round((performance.now() - t0) / 1000);
    log('XONG', { mediaId, seconds: secs, state: asset?.[5]?.[8]?.[0], hasSignedUrl: !!url, urlPath: asset && url ? (asset[7]?.[0]?.[8] ? '[7][0][8]' : 'khác') : null });
    let download = null;
    if (url) {
      // Thử tải KHÔNG cookie để biết URL ký có dùng được từ backend hay không (có thể bị CORS chặn -> không kết luận)
      try {
        const r = await fetch(url, { credentials: 'omit' });
        download = { status: r.status, type: r.headers.get('content-type'), bytes: r.headers.get('content-length') };
        r.body && r.body.cancel();
      } catch (e) { download = { error: String(e.message), note: 'CORS có thể chặn; sẽ test lại từ Python' }; }
      log('tải mp4 không cookie:', JSON.stringify(download));
    }
    // Đo kích thước video thật bằng thẻ <video> (chỉ đọc metadata, không cần CORS)
    let dims = null;
    if (url) {
      try {
        dims = await new Promise((resolve, reject) => {
          const v = document.createElement('video');
          v.preload = 'metadata'; v.muted = true;
          v.onloadedmetadata = () => resolve({ width: v.videoWidth, height: v.videoHeight, seconds: Math.round(v.duration), orientation: v.videoWidth > v.videoHeight ? 'ngang 16:9' : 'dọc 9:16' });
          v.onerror = () => reject(new Error('không đọc được metadata'));
          setTimeout(() => reject(new Error('timeout')), 15000);
          v.src = url;
        });
      } catch (e) { dims = { error: String(e.message) }; }
      log('kích thước video:', JSON.stringify(dims));
    }
    // copyUrl: chép URL ký vào clipboard (hàm copy() của DevTools) để đưa cho test Python mà không in ra Console
    // copy() là API riêng của DevTools, không gọi được từ trong hàm -> lưu biến toàn cục, bạn chạy: copy(__flowUrl)
    if (url && opt.copyUrl) { window.__flowUrl = url; log('Đã lưu URL ký vào biến __flowUrl. Chạy:  copy(__flowUrl)  rồi chạy Python.'); }
    return { mediaId, seconds: secs, url: url ? '(đã ký, ẩn)' : null, download, dims };
  }
  console.log('flowPoc sẵn sàng. Chạy: await flowPoc()   (chỉ đọc)   |   await flowPoc({ submit: true })   (tạo 1 video, tốn credit)');
})();
