export async function runImageGenerationInPage(imageRequest, captchaToken) {
  try {
    if (typeof imageRequest?.prompt !== 'string' || !imageRequest.prompt.trim()) {
      throw new Error('Image prompt is empty');
    }
    if (typeof captchaToken !== 'string' || !captchaToken) {
      throw new Error('reCAPTCHA token is empty');
    }

    // 1. Resolve Aspect Ratio Code
    // In Google Flow Image: 16:9 = 3, 1:1 = 2, 9:16 = 1, 4:3 = 4, 3:4 = 5
    const aspectMap = {
      '16:9': 3,
      '1:1': 2,
      '9:16': 1,
      '4:3': 4,
      '3:4': 5,
    };
    const aspectEnum = aspectMap[imageRequest.aspect_ratio] || 3;

    // 2. Resolve Model Key
    function resolveImageModel(m) {
      const raw = String(m || '').toLowerCase();
      if (raw.includes('lite') || raw.includes('harbor')) return 'HARBOR_SEAL';
      if (raw.includes('pro') || raw.includes('gem_pix_2')) return 'GEM_PIX_2';
      if (raw.includes('banana 2') || raw.includes('narwhal')) return 'NARWHAL';
      return 'GEM_PIX_2';
    }
    const modelKey = resolveImageModel(imageRequest.model_key);

    // 3. Resolve Project ID & Path
    let route = location.pathname.match(/^\/(u\/\d+)\/project\/([^/?#]+)/);
    let accountPath = route ? `/${route[1]}` : '';
    let projectId = route ? route[2] : null;
    if (!projectId) {
      const match2 = location.pathname.match(/\/project\/([^/?#]+)/);
      if (match2) {
        projectId = match2[1];
        const uMatch = location.pathname.match(/\/(u\/\d+)/);
        accountPath = uMatch ? `/${uMatch[1]}` : '';
      }
    }
    if (!projectId) {
      projectId = imageRequest.project_id || null;
    }
    if (!projectId) {
      throw new Error('Không tìm thấy Project ID trên tab Google Flow');
    }

    const sourcePath = `${accountPath}/project/${projectId}`;
    const wiz = window.WIZ_global_data || {};
    const csrfToken = wiz.SNlM0e;
    const sessionId = wiz.FdrFJe;
    const buildLabel = wiz.cfb2h;
    if (!csrfToken || !sessionId || !buildLabel) {
      throw new Error('Flow page session config is incomplete; reload the project');
    }

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
        rpcError = `[DEBUG_UNUSUAL_ACTIVITY] ${rpcError}`;
      }
      const preview = text.length > 250 ? text.slice(0, 250) + '...' : text;
      throw new Error(rpcError || `Flow RPC ${rpcId} returned no usable payload. Response: ${preview}`);
    }

    async function callRpc(rpcId, payload) {
      const query = new URLSearchParams({
        rpcids: rpcId,
        'source-path': sourcePath,
        bl: String(buildLabel),
        'f.sid': String(sessionId),
        hl: String(document.documentElement?.lang || 'en').split('-')[0],
        _reqid: String(Math.floor(100000 + Math.random() * 900000)),
        rt: 'c',
      });
      const body = new URLSearchParams({
        'f.req': JSON.stringify([[[rpcId, JSON.stringify(payload), null, 'generic']]]),
        at: String(csrfToken),
      });
      const base = location.origin || 'https://flow.google.com';
      const endpoint = `${base}${accountPath}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`;

      let text = null;
      try {
        const response = await fetch(endpoint, {
          method: 'POST',
          credentials: 'include',
          cache: 'no-store',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Same-Domain': '1',
          },
          body: body.toString(),
        });
        if (!response.ok) throw new Error(`RPC ${rpcId} HTTP ${response.status}`);
        text = await response.text();
      } catch (fetchErr) {
        // Fallback qua XMLHttpRequest trong MAIN world nếu fetch gặp sự cố
        if (typeof XMLHttpRequest !== 'undefined') {
          try {
            text = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('POST', endpoint, true);
              xhr.withCredentials = true;
              xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
              xhr.setRequestHeader('X-Same-Domain', '1');
              xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
                else reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
              };
              xhr.onerror = () => reject(new Error('XHR network error'));
              xhr.ontimeout = () => reject(new Error('XHR timeout'));
              xhr.timeout = 45000;
              xhr.send(body.toString());
            });
          } catch (xhrErr) {
            throw new Error(`Flow RPC ${rpcId} error: fetch (${fetchErr.message}), xhr (${xhrErr.message})`);
          }
        } else {
          throw fetchErr;
        }
      }

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

    // Format reference images if provided: [[media_id, null, null, null, 1], ...]
    let refImagesPayload = null;
    if (Array.isArray(imageRequest.reference_image_ids) && imageRequest.reference_image_ids.length > 0) {
      refImagesPayload = imageRequest.reference_image_ids.map((id) => [id, null, null, null, 1]);
    }

    // Scene UUID: dùng từ Backend nếu có (batch dùng chung), hoặc tự tạo
    const sceneUuid = (imageRequest.scene_uuid || (crypto.randomUUID ? crypto.randomUUID() : '1B6623B2-B5E4-4899-AA64-0122F1A067F9')).toUpperCase();

    // Luôn tạo đúng 1 ảnh — Backend điều phối N biến thể bằng N request riêng
    const seed = imageRequest.seed || Math.floor(Math.random() * 2000000000);
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
      [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
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
      [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
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
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
