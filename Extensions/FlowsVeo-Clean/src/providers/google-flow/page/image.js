export async function runImageGenerationInPage(imageRequest, captchaToken) {
  // Only non-secret metadata may cross back into extension/backend logs.
  const diagnostics = {
    adapter: 'image-rpc-diagnostics-v1', rpc: 'ogiZ0b', phase: 'preflight',
    origin: location.origin, http_status: null, elapsed_ms: null,
    session_ready: false, project_matches: false,
    token_length: typeof captchaToken === 'string' ? captchaToken.length : 0,
    nzlxg_ok: false,
    token_source: 'background',
    trigger_method: 'rpc',
  };
  try {
    if (typeof imageRequest?.prompt !== 'string' || !imageRequest.prompt.trim()) {
      throw new Error('Image prompt is empty');
    }

    // 1. Resolve Project ID & Path
    let route = location.pathname.match(/^\/(u\/\d+)\/project\/([^/?#]+)/);
    let projectId = route ? route[2] : null;
    if (!projectId) {
      const match2 = location.pathname.match(/\/project\/([^/?#]+)/);
      if (match2) {
        projectId = match2[1];
      }
    }
    if (location.hostname !== 'flow.google.com' || !projectId) {
      throw new Error('Hãy mở project trên flow.google.com trước khi tạo ảnh');
    }
    if (imageRequest.project_id && imageRequest.project_id !== projectId) {
      throw new Error('Tab Flow đã chuyển sang project khác; hãy chọn lại project rồi tạo ảnh');
    }
    diagnostics.project_matches = true;

    // ── TELEMETRY WARMING ─────────────────────────────────────────────────────
    // Bơm vi tương tác tự nhiên trong trang để làm ấm bộ đệm reCAPTCHA Enterprise trước khi lấy token
    try {
      const warmupStart = Date.now();
      let x = 300, y = 300;
      while (Date.now() - warmupStart < 1200) {
        x += (Math.random() - 0.48) * 20;
        y += (Math.random() - 0.48) * 15;
        if (typeof window.PointerEvent === 'function') {
          document.dispatchEvent(new window.PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y, pointerType: 'mouse' }));
        }
        if (typeof window.MouseEvent === 'function') {
          document.dispatchEvent(new window.MouseEvent('mousemove', { bubbles: true, clientX: x, clientY: y }));
        }
        await new Promise(r => setTimeout(r, 45));
      }
      diagnostics.warmup_ms = Date.now() - warmupStart;
    } catch { }



    // 1. Resolve Aspect Ratio Code
    const aspectMap = {
      '16:9': 3,
      '1:1': 1,
      '9:16': 2,
      '4:3': 4,
      '3:4': 5,
    };
    const aspectEnum = aspectMap[imageRequest.aspect_ratio || '16:9'];
    if (!aspectEnum) throw new Error('Unsupported image aspect ratio');

    // 2. Resolve Model Key
    function resolveImageModel(m) {
      const raw = String(m || '').toLowerCase();
      if (raw.includes('lite') || raw.includes('harbor')) return 'HARBOR_SEAL';
      if (raw.includes('pro') || raw.includes('gem_pix_2')) return 'GEM_PIX_2';
      if (raw.includes('banana 2') || raw.includes('narwhal')) return 'NARWHAL';
      return 'GEM_PIX_2';
    }
    const modelKey = resolveImageModel(imageRequest.model_key);

    // HAR 2026-09-30: source-path luôn là /project/... (không có /u/X/ prefix)
    const sourcePath = `/project/${projectId}`;
    const wiz = window.WIZ_global_data || {};
    const csrfToken = wiz.SNlM0e;
    const sessionId = wiz.FdrFJe;
    const buildLabel = wiz.cfb2h;
    if (!csrfToken || !sessionId || !buildLabel) {
      throw new Error('Flow page session config is incomplete; reload the project');
    }
    diagnostics.session_ready = true;

    function findRpcEnvelope(node, rpcId) {
      if (!Array.isArray(node)) return null;
      if (node[0] === 'wrb.fr' && node[1] === rpcId && typeof node[2] === 'string') return node[2];
      for (const child of node) {
        const found = findRpcEnvelope(child, rpcId);
        if (found !== null) return found;
      }
      return null;
    }

    function parseRpcResponse(text, rpcId) {
      let rpcError = null;
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('[')) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const payload = findRpcEnvelope(parsed, rpcId);
          if (payload !== null) return JSON.parse(payload);

          // Trích xuất chi tiết lỗi từ envelope nếu có
          if (Array.isArray(parsed)) {
            for (const item of parsed) {
              if (Array.isArray(item) && item[0] === 'wrb.fr' && item[1] === rpcId) {
                rpcError = `Flow RPC envelope error: ${JSON.stringify(item.slice(2))}`;
              } else if (Array.isArray(item) && item[0] === 'er') {
                rpcError = `Flow server error (er): ${JSON.stringify(item)}`;
              }
            }
          }
        } catch { }
      }
      if (rpcError && rpcError.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY')) {
        rpcError = 'PUBLIC_ERROR_UNUSUAL_ACTIVITY: Google Flow từ chối yêu cầu tạo ảnh từ ứng dụng. Việc tạo thủ công vẫn có thể hoạt động; nguyên nhân từ chối chưa được xác định.';
      }
      throw new Error(rpcError || `Flow RPC ${rpcId} returned no usable payload`);
    }

    function nextReqId() {
      if (typeof window._flowsVeoReqId !== 'number' || window._flowsVeoReqId < 100000) {
        window._flowsVeoReqId = 4000000 + Math.floor(Math.random() * 500000);
      }
      window._flowsVeoReqId += 100000;
      return String(window._flowsVeoReqId);
    }

    async function callRpc(rpcId, payload) {
      const reqId = nextReqId();
      const query = new URLSearchParams({
        rpcids: rpcId,
        'source-path': sourcePath,
        bl: String(buildLabel),
        'f.sid': String(sessionId),
        hl: String(document.documentElement?.lang || 'en').split('-')[0],
        _reqid: reqId,
        rt: 'c',
      });
      const body = new URLSearchParams({
        'f.req': JSON.stringify([[[rpcId, JSON.stringify(payload), null, 'generic']]]),
        at: String(csrfToken),
      });
      const base = location.origin || 'https://flow.google.com';
      const endpoint = `${base}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`;

      console.info('[FlowsVeo:image]', { phase: 'submit', rpc: rpcId, _reqid: reqId });
      diagnostics.phase = 'fetch';
      const started = Date.now();
      const response = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
        cache: 'no-store',
        signal: AbortSignal.timeout(120000),
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
          'X-Same-Domain': '1',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache',
        },
        body: body.toString(),
      });
      diagnostics.http_status = response.status;
      diagnostics.elapsed_ms = Date.now() - started;
      diagnostics.phase = 'rpc-response';
      console.info('[FlowsVeo:image]', { phase: 'response', rpc: rpcId, http_status: response.status });
      if (!response.ok) throw new Error(`RPC ${rpcId} HTTP ${response.status}`);
      const text = await response.text();
      return parseRpcResponse(text, rpcId);
    }

    function findImageUrl(node) {
      if (typeof node === 'string') {
        if (node.startsWith('https://flow-content.google/image/') ||
            (node.startsWith('https://flow-content.google/') && (node.includes('/image/') || node.includes('.jpg') || node.includes('.png') || node.includes('Signature=')))) {
          return node;
        }
        return null;
      }
      if (Array.isArray(node)) {
        for (const child of node) {
          const u = findImageUrl(child);
          if (u) return u;
        }
      } else if (typeof node === 'object' && node !== null) {
        for (const v of Object.values(node)) {
          const u = findImageUrl(v);
          if (u) return u;
        }
      }
      return null;
    }

    // Step A: Pre-flight session/quota verification RPC (nzlxg) matching HAR
    try {
      console.info('[FlowsVeo:image] Pre-flight quota check via nzlxg...');
      await callRpc('nzlxg', []);
      diagnostics.nzlxg_ok = true;
    } catch (e) {
      console.warn('[FlowsVeo:image] nzlxg preflight warning:', e.message);
      diagnostics.nzlxg_error = e.message;
    }

    // Step B: Try acquiring fresh in-page reCAPTCHA token right before dispatch
    let finalToken = captchaToken;
    try {
      if (window.grecaptcha?.enterprise?.execute) {
        const siteKey = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
        console.info('[FlowsVeo:image] Requesting fresh in-page reCAPTCHA token...');
        const freshToken = await Promise.race([
          window.grecaptcha.enterprise.execute(siteKey, { action: 'IMAGE_GENERATION' }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
        ]);
        if (typeof freshToken === 'string' && freshToken.length > 100) {
          finalToken = freshToken;
          diagnostics.token_source = 'in-page-fresh';
          diagnostics.token_length = freshToken.length;
          console.info('[FlowsVeo:image] In-page reCAPTCHA token acquired, length:', freshToken.length);
        }
      }
    } catch (recaptchaErr) {
      console.warn('[FlowsVeo:image] In-page token fallback to background token:', recaptchaErr.message);
      diagnostics.token_source = 'background-fallback';
    }
    if (typeof finalToken !== 'string' || !finalToken) {
      throw new Error('reCAPTCHA token is empty');
    }

    // Format reference images if provided: [[media_id, null, null, null, 1], ...]
    let refImagesPayload = null;
    if (Array.isArray(imageRequest.reference_image_ids) && imageRequest.reference_image_ids.length > 0) {
      refImagesPayload = imageRequest.reference_image_ids.map((id) => [id, null, null, null, 1]);
    }

    // Scene UUID: dùng từ Backend nếu có (batch dùng chung), hoặc tự tạo
    const sceneUuid = (imageRequest.scene_uuid || (crypto.randomUUID ? crypto.randomUUID() : '1B6623B2-B5E4-4899-AA64-0122F1A067F9')).toUpperCase();

    // Luôn tạo đúng 1 ảnh — Backend điều phối N biến thể bằng N request riêng
    const seed = imageRequest.seed ?? Math.floor(Math.random() * 2000000000);
    const uuidA = (crypto.randomUUID ? crypto.randomUUID() : 'EBA3AD1B-C139-4F1B-88C0-290D5C5CD974').toUpperCase();
    const uuidB = (crypto.randomUUID ? crypto.randomUUID() : 'B88CA090-09EA-443D-A368-718E69A7F171').toUpperCase();

    const itemPayload = [
      null,
      null,
      refImagesPayload,
      seed,
      aspectEnum,
      modelKey,
      null,
      [null, 22, null, null, null, projectId, null, null, null, null, [finalToken, 1]],
      [[[imageRequest.prompt.trim()]]],
      null,
      null,
      null,
      uuidA,
      uuidB,
    ];

    const rpcPayload = [
      null,
      [itemPayload],
      1,
      [null, 22, null, null, null, projectId, null, null, null, null, [finalToken, 1]],
      [sceneUuid],
    ];

    const rpcResult = await callRpc('ogiZ0b', rpcPayload);
    const imgUrl = findImageUrl(rpcResult);
    if (!imgUrl) {
      throw new Error('Flow ogiZ0b response did not contain an image URL');
    }

    let mediaId = null;
    let dims = null;
    try {
      if (Array.isArray(rpcResult) && Array.isArray(rpcResult[0]) && Array.isArray(rpcResult[0][0])) {
        mediaId = rpcResult[0][0][0] || null;
        const sub = rpcResult[0][0][6];
        if (Array.isArray(sub) && sub.length > 2 && Array.isArray(sub[2])) {
          dims = sub[2];
        }
      }
    } catch { }

    if (!mediaId) {
      const mMatch = imgUrl.match(/\/image\/([^/?#]+)/);
      if (mMatch) mediaId = mMatch[1];
    }

    return {
      ok: true,
      images: [{
        media_id: mediaId,
        image_url: imgUrl,
        seed,
        aspect_ratio: imageRequest.aspect_ratio || '16:9',
        model_key: modelKey,
        dimensions: dims,
      }],
      project_id: projectId,
      prompt: imageRequest.prompt,
      diagnostics,
    };
  } catch (error) {
    console.warn('[FlowsVeo:image]', {
      phase: 'failed',
      code: String(error?.message || '').includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY')
        ? 'PUBLIC_ERROR_UNUSUAL_ACTIVITY' : 'IMAGE_REQUEST_FAILED',
    });
    return { ok: false, error: error?.message || String(error), diagnostics };
  }
}
