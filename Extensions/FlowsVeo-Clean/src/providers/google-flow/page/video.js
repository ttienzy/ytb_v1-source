// Legacy page-global logActivity references in empty-reference fallback branches
// are intentionally preserved. Do not import worker code into an injected function.

export async function runFlowGenerationInPage(flowRequest, captchaToken) {
  const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    if (typeof flowRequest?.prompt !== 'string' || !flowRequest.prompt.trim()) {
      throw new Error('Flow prompt is empty');
    }
    if (typeof captchaToken !== 'string' || !captchaToken) {
      throw new Error('reCAPTCHA token is empty');
    }
    if (flowRequest?.aspect_ratio && !['16:9', '9:16'].includes(flowRequest.aspect_ratio)) {
      throw new Error('Unsupported Flow configuration: aspect_ratio');
    }

    const dur = [4, 5, 6, 8, 10].includes(Number(flowRequest?.duration_seconds)) ? Number(flowRequest.duration_seconds) : 6;

    // Dynamic model ID resolution
    function resolveModelId(req) {
      const isFrames = req.input_mode === 'frames';
      const isIngredients = req.input_mode === 'ingredients';
      const isVideoEdit = req.input_mode === 'video_edit';
      if (req.provider_model_id && (!isFrames || !req.provider_model_id.includes('_t2v_')) && (!isIngredients || !req.provider_model_id.includes('_t2v_'))) {
        if (req.provider_model_id.startsWith('abra_r2v_')) {
          const m = req.provider_model_id.match(/abra_r2v_(\d+)s/);
          if (m) {
            const pDur = Number(m[1]);
            // HAR 30/09: abra_r2v_ hỗ trợ [4,6,8,10]s - thêm 8s
            const valid = [4, 6, 8, 10].includes(pDur) ? pDur : (pDur >= 8 ? 8 : 6);
            return `abra_r2v_${valid}s`;
          }
        }
        return req.provider_model_id;
      }
      const modelName = (req.model_display_name || '').toLowerCase();
      const isPortrait = req.aspect_ratio === '9:16';

      if (isVideoEdit) {
        return req.resolution === '360p' ? 'abra_edit_360p' : 'abra_edit';
      }
      if (isIngredients) {
        // HAR 30/09: ingredients dùng nprQif với abra_r2v_, 8s là mặc định mới
        const validR2vDur = [4, 6, 8, 10].includes(dur) ? dur : (dur >= 8 ? 8 : 6);
        return `abra_r2v_${validR2vDur}s`;
      }
      if (isFrames) {
        if (req.image_base64 && req.end_image_base64) {
          const frameDur = dur >= 10 ? 10 : 8;
          return `omni_flash_i2v_${frameDur}s_first_last`;
        }
        return `abra_r2v_${[4, 6, 8, 10].includes(dur) ? dur : (dur >= 8 ? 8 : 6)}s`;
      }
      if (modelName.includes('omni') || modelName.includes('flash')) {
        return `abra_t2v_${dur}s`;
      }
      if (modelName.includes('quality')) {
        return isPortrait ? 'veo_3_1_t2v_quality_portrait' : 'veo_3_1_t2v_quality';
      }
      if (modelName.includes('fast')) {
        return isPortrait ? 'veo_3_1_t2v_fast_portrait' : 'veo_3_1_t2v_fast';
      }
      return 'veo_3_1_t2v_lite';
    }

    let modelId = resolveModelId(flowRequest);

    // HAR 30/09/2026: Flow đã bỏ /u/X/ prefix khỏi URL - hỗ trợ cả 2 format
    let route = location.pathname.match(/^\/(u\/\d+)\/project\/([^/?#]+)/);
    let accountPath = route ? `/${route[1]}` : '';
    let projectId = route ? route[2] : null;

    if (!projectId) {
      const match2 = location.pathname.match(/\/project\/([^/?#]+)/);
      if (match2) {
        projectId = match2[1];
        // HAR mới: URL dạng /project/... không có /u/X/ → accountPath = ''
        const uMatch = location.pathname.match(/\/(u\/\d+)/);
        accountPath = uMatch ? `/${uMatch[1]}` : '';
      }
    }

    if (!projectId) {
      const projLink = document.querySelector('a[href*="/project/"]');
      if (projLink && projLink.href) {
        const urlObj = new URL(projLink.href);
        const m = urlObj.pathname.match(/\/project\/([^/?#]+)/);
        if (m) {
          projectId = m[1];
          const uM = urlObj.pathname.match(/\/(u\/\d+)/);
          accountPath = uM ? `/${uM[1]}` : (location.pathname.match(/\/(u\/\d+)/)?.[0] || '');
        }
      }
    }

    if (location.hostname !== 'flow.google.com' || !projectId) {
      throw new Error('Vui lòng mở một Dự án (Project) trên tab Google Flow trước khi bấm Tạo video');
    }
    // HAR 30/09: source-path không có /u/X/ prefix nữa → sourcePath = /project/...
    const sourcePath = `${accountPath}/project/${projectId}`;
    const wiz = window.WIZ_global_data || {};
    const csrfToken = wiz.SNlM0e;
    const sessionId = wiz.FdrFJe;
    const buildLabel = wiz.cfb2h;
    if (!csrfToken || !sessionId || !buildLabel) {
      throw new Error('Flow page session config is incomplete; reload the project');
    }
    // Guard: sessionId phải là số nguyên lớn hợp lệ (HAR thật ~7.7e18).
    const sidNum = Number(sessionId);
    if (Number.isFinite(sidNum) && Math.abs(sidNum) < 1e6 && Math.abs(sidNum) > 0) {
      throw new Error(`Flow session ID không hợp lệ (sid=${sidNum}); trang chưa load xong WIZ_global_data — cần reload`);
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
      const preview = (typeof text === 'string' ? text.replace(/\s+/g, ' ').slice(0, 300) : '');
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
      const endpoint = `${base}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`;
      let text = null;
      try {
        const response = await fetch(endpoint, {
          method: 'POST', credentials: 'include', cache: 'no-store',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Same-Domain': '1',
          },
          body: body.toString(),
        });
        if (!response.ok) throw new Error(`Flow RPC ${rpcId} failed: HTTP ${response.status}`);
        text = await response.text();
      } catch (fetchErr) {
        // Fallback qua XMLHttpRequest trong MAIN world nếu fetch bị chặn hoặc lỗi
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
              xhr.onerror = () => reject(new Error(`XHR network error`));
              xhr.ontimeout = () => reject(new Error(`XHR timeout`));
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

    function findMediaAsset(node) {
      if (!Array.isArray(node)) return null;
      if (typeof node[0] === 'string' && (node[3] === 'CAE' || node[3] === 'CAM' || node[3] === 'CAI')) return node;
      for (const child of node) {
        const found = findMediaAsset(child);
        if (found) return found;
      }
      return null;
    }

    function findVideoUrl(node) {
      if (!node) return null;
      if (typeof node === 'string') {
        if (node.startsWith('https://flow-content.google/')) {
          const lower = node.toLowerCase();
          if (lower.includes('/image/') || lower.includes('/image?')) return null;
          if (/\.(?:jpg|jpeg|png|webp|gif|avif)(?:$|[?#])/.test(lower)) return null;
          if (lower.includes('/video/') || lower.includes('.mp4') || lower.includes('/media/') || lower.includes('download=1')) {
            return node;
          }
        }
        return null;
      }
      if (Array.isArray(node)) {
        for (const child of node) {
          const u = findVideoUrl(child);
          if (u) return u;
        }
      } else if (typeof node === 'object') {
        for (const v of Object.values(node)) {
          const u = findVideoUrl(v);
          if (u) return u;
        }
      }
      return null;
    }

    // Broader signed-URL fallback: accepts URLs containing the mediaId regardless of path format
    function findSignedVideoUrl(node, targetMid) {
      if (!node) return null;
      if (typeof node === 'string' && node.startsWith('https://')) {
        const lower = node.toLowerCase();
        if (/\.(?:jpg|jpeg|png|webp|gif|avif|svg|css|js|woff|ttf)(?:$|[?#])/.test(lower)) return null;
        if (/(?:preview|thumbnail|poster|sprite|favicon)/.test(lower)) return null;
        if (targetMid && node.includes(targetMid)) return node;
        try {
          const u = new URL(node);
          if (u.hostname === 'flow-content.google') {
            const pn = u.pathname.toLowerCase();
            if (!pn.startsWith('/image') && !pn.includes('/image/')) return node;
          }
        } catch { }
        return null;
      }
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = findSignedVideoUrl(child, targetMid);
          if (found) return found;
        }
      } else if (typeof node === 'object' && node !== null) {
        for (const v of Object.values(node)) {
          const found = findSignedVideoUrl(v, targetMid);
          if (found) return found;
        }
      }
      return null;
    }

    function checkDomAndPerformanceForVideo(targetMediaId) {
      if (!targetMediaId) return null;
      // 1. Quét các thẻ video trong trang — bắt buộc URL phải chứa mediaId của job này
      try {
        if (typeof document?.querySelectorAll === 'function') {
          for (const v of document.querySelectorAll('video')) {
            const src = v.currentSrc || v.src;
            if (src && src.startsWith('https://flow-content.google/') && src.includes(targetMediaId)) return src;
            if (typeof v.querySelectorAll === 'function') {
              for (const s of v.querySelectorAll('source')) {
                if (s.src && s.src.startsWith('https://flow-content.google/') && s.src.includes(targetMediaId)) return s.src;
              }
            }
          }
        }
      } catch { }
      // 2. Quét network resource entries — bắt buộc URL phải chứa mediaId của job này
      try {
        if (typeof performance?.getEntriesByType === 'function') {
          const entries = performance.getEntriesByType('resource').slice().reverse();
          for (const entry of entries) {
            const n = entry.name || '';
            if (n.startsWith('https://flow-content.google/') && n.includes(targetMediaId) && (n.includes('/video/') || n.includes('.mp4') || n.includes('Signature='))) {
              return n;
            }
          }
        }
      } catch { }
      return null;
    }

    const forceFresh = Boolean(flowRequest?.force_fresh_assets);
    const mediaCache = (typeof window !== 'undefined' ? window : globalThis).__FLOW_MEDIA_CACHE__ ||
      ((typeof window !== 'undefined' ? window : globalThis).__FLOW_MEDIA_CACHE__ = new Map());

    function computeFlowCropCoords(imgWidth, imgHeight, isPortrait) {
      const w = Number(imgWidth) || 0;
      const h = Number(imgHeight) || 0;
      if (!w || !h) {
        return isPortrait ? [null, 0.341796875, 1, 0.658203125] : [null, null, 1, 1];
      }
      const imgRatio = w / h;
      const targetRatio = isPortrait ? (9 / 16) : (16 / 9);

      // Chuẩn hóa ảnh 16:9 (ratio 1.7 ~ 1.85, như 1376x768, 1920x1080)
      if (imgRatio >= 1.7 && imgRatio <= 1.85) {
        if (isPortrait) {
          return [null, 0.341796875, 1, 0.658203125];
        }
        if (w === 1376 && h === 768) {
          return [null, 0.0038759689922481244, 1, 0.9961240310077519];
        }
        return [null, null, 1, 1];
      }
      // Chuẩn hóa ảnh 9:16 (ratio 0.54 ~ 0.58, như 768x1376, 1080x1920)
      if (imgRatio >= 0.54 && imgRatio <= 0.58) {
        if (isPortrait) {
          if (w === 768 && h === 1376) {
            return [0.0038759689922481244, null, 0.9961240310077519, 1];
          }
          return [null, null, 1, 1];
        }
        return [0.341796875, null, 0.658203125, 1];
      }
      // Chuẩn hóa ảnh vuông 1:1 (ratio 0.95 ~ 1.05)
      if (imgRatio >= 0.95 && imgRatio <= 1.05) {
        return isPortrait ? [null, 0.21875, 1, 0.78125] : [0.21875, null, 0.78125, 1];
      }
      // Nếu tỷ lệ ảnh đã khớp tỷ lệ video mục tiêu
      if (Math.abs(imgRatio - targetRatio) < 0.05) {
        return [null, null, 1, 1];
      }
      if (imgRatio > targetRatio) {
        const cropW = targetRatio / imgRatio;
        const left = (1 - cropW) / 2;
        return [null, left, 1, left + cropW];
      } else {
        const cropH = imgRatio / targetRatio;
        const top = (1 - cropH) / 2;
        return [top, null, top + cropH, 1];
      }
    }

    async function uploadImageToFlow(base64Data, mimeType, filename) {
      if (!base64Data) return null;
      const rawBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
      const cacheKey = `img:${projectId}:${rawBase64.slice(0, 64)}:${rawBase64.length}:${filename || ''}`;
      if (!forceFresh && mediaCache.has(cacheKey)) {
        return mediaCache.get(cacheKey);
      }
      try {
        const headerProto = [
          null, 22, null, null, null, projectId, null, null, null, null,
          null,
        ];
        const maseQPayload = [
          headerProto,
          rawBase64,
          mimeType || 'image/png',
          true,
          null,
          null,
          null,
          false,
          filename || 'frame.png',
        ];

        const resp = await callRpc('maseQ', maseQPayload);

        function findMediaIdInResponse(node) {
          if (!node) return null;
          if (typeof node === 'string' &&
              node !== projectId &&
              (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node) || node.includes('media') || node.includes('frame'))) {
            return node;
          }
          if (Array.isArray(node)) {
            for (const item of node) {
              const found = findMediaIdInResponse(item);
              if (found) return found;
            }
          }
          if (typeof node === 'object') {
            for (const val of Object.values(node)) {
              const found = findMediaIdInResponse(val);
              if (found) return found;
            }
          }
          return null;
        }

        const uploadedMediaId = findMediaIdInResponse(resp);
        if (!uploadedMediaId) {
          throw new Error('maseQ response did not contain a valid mediaId: ' + JSON.stringify(resp).slice(0, 200));
        }
        mediaCache.set(cacheKey, uploadedMediaId);
        return uploadedMediaId;
      } catch (err) {
        throw new Error(`Lỗi tải ảnh lên Google Flow (maseQ): ${err.message}`);
      }
    }

    let startFrameMediaId = flowRequest?.start_frame_media_id || null;
    let endFrameMediaId = flowRequest?.end_frame_media_id || null;
    const ingredientMediaIds = Array.isArray(flowRequest?.ingredient_media_ids)
      ? flowRequest.ingredient_media_ids
          .filter((id) => typeof id === 'string' && id.trim())
          .map((id) => id.trim())
      : [];
    const referenceVideoMediaId = typeof flowRequest?.reference_video_id === 'string'
      ? flowRequest.reference_video_id.trim()
      : '';

    let isFrames = flowRequest?.input_mode === 'frames';
    let isIngredients = flowRequest?.input_mode === 'ingredients';
    const isVideoEdit = flowRequest?.input_mode === 'video_edit';

    if (isVideoEdit && !referenceVideoMediaId) {
      throw new Error('Video edit mode requires an uploaded reference_video_id');
    }

    if (isFrames) {
      if (!startFrameMediaId && flowRequest.image_base64) {
        startFrameMediaId = await uploadImageToFlow(
          flowRequest.image_base64,
          flowRequest.image_mime,
          flowRequest.image_name || 'start_frame.png'
        );
      }
      if (!endFrameMediaId && flowRequest.end_image_base64) {
        endFrameMediaId = await uploadImageToFlow(
          flowRequest.end_image_base64,
          flowRequest.end_image_mime,
          flowRequest.end_image_name || 'end_frame.png'
        );
      }
      if (!startFrameMediaId) {
        if (endFrameMediaId) {
          throw new Error('Chế độ Khung hình yêu cầu phải có Khung hình bắt đầu (Start Frame) khi sử dụng Khung hình kết thúc (End Frame)');
        }
        console.warn('[FlowPage] Không có khung hình trong request frames, tự động tạo video từ prompt (text_to_video)');
        isFrames = false;
        modelId = modelId.replace('_i2v_', '_t2v_').replace('_first_last', '').replace('_first', '');
      }
    } else if (isIngredients || isVideoEdit) {
      const ingList = Array.isArray(flowRequest?.ingredient_images) ? flowRequest.ingredient_images.slice() : [];
      if (ingList.length === 0 && flowRequest?.image_base64) {
        ingList.push({
          base64: flowRequest.image_base64,
          mime: flowRequest.image_mime,
          filename: flowRequest.image_name || 'ingredient_1.png',
        });
      }
      for (let i = 0; i < ingList.length; i++) {
        const item = ingList[i];
        if (item?.base64) {
          const mid = await uploadImageToFlow(
            item.base64,
            item.mime || 'image/png',
            item.filename || `ingredient_${i + 1}.png`
          );
          if (mid) {
            ingredientMediaIds.push(mid);
          }
        }
      }
      if (isIngredients && ingredientMediaIds.length === 0) {
        console.warn('[FlowPage] Không có ảnh tham chiếu trong request ingredients, tự động tạo video từ prompt (text_to_video)');
        isIngredients = false;
        modelId = modelId.replace('_r2v_', '_t2v_');
      }
    }

    const isSingleFrame = isFrames && Boolean(startFrameMediaId) && !endFrameMediaId;
    // HAR 30/09/2026: MZZa6b đã bị xóa khỏi Flow.
    // Ingredients/SingleFrame giờ dùng nprQif (cùng RPC với frames) với ref slots thay cho MZZa6b.
    // YhhmEf = text-to-video | nprQif = frames + ingredients/singleFrame | jIps6 = video_edit
    const rpcId = isVideoEdit
      ? 'jIps6'
      : (isFrames || isIngredients || isSingleFrame ? 'nprQif' : 'YhhmEf');

    const requestUuidA = (crypto.randomUUID ? crypto.randomUUID() : 'AD722819-13F6-46E3-A074-9CA0266A4FE0').toUpperCase();
    const requestUuidB = (crypto.randomUUID ? crypto.randomUUID() : '4C8832DC-AD37-4C11-859E-DCFD4FB4903E').toUpperCase();
    const sceneUuid = (crypto.randomUUID ? crypto.randomUUID() : '154922EC-9CE9-4413-A9C0-B2664F7FFB7B').toUpperCase();
    const isPortrait = flowRequest?.aspect_ratio === '9:16';
    const numOutputs = Math.max(1, Math.min(2, Number(flowRequest?.num_outputs) || 1));
    let startSlot = null;
    let endSlot = null;

    let createPayload = null;
    if (isVideoEdit) {
      const startSeconds = Math.max(0, Number(flowRequest?.reference_video_start_seconds) || 0);
      const requestedEnd = Number(flowRequest?.reference_video_end_seconds);
      const endSeconds = Number.isFinite(requestedEnd) && requestedEnd > startSeconds
        ? Math.min(requestedEnd, startSeconds + 10)
        : startSeconds + 10;
      const startFrame = Math.round(startSeconds * 24);
      const endFrame = Math.max(startFrame + 1, Math.round(endSeconds * 24));
      const sourceVideo = [null, referenceVideoMediaId, startFrame, endFrame];
      const destination = [null, null, null, null, requestUuidA, requestUuidB];
      const editRequest = [
        sourceVideo,
        [null, null, [[[flowRequest.prompt.trim()]]]],
        modelId,
        numOutputs,
        destination,
      ];
      if (ingredientMediaIds.length > 0) {
        while (editRequest.length < 8) editRequest.push(null);
        editRequest.push(ingredientMediaIds.map((id) => [null, id]));
      }
      if (flowRequest?.resolution === '360p') {
        while (editRequest.length < 12) editRequest.push(null);
        editRequest.push([4]);
      }
      createPayload = [
        [editRequest],
        [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
        [sceneUuid, 2],
      ];
    } else if (isIngredients || isSingleFrame) {
      // HAR 30/09/2026: MZZa6b đã bị xóa. Ingredients/SingleFrame giờ dùng nprQif.
      const primaryMediaId = isSingleFrame ? startFrameMediaId : ingredientMediaIds[0];
      const cropCoordsIng = computeFlowCropCoords(flowRequest?.image_width, flowRequest?.image_height, isPortrait);
      const validR2vDur = [4, 6, 8, 10].includes(dur) ? dur : (dur >= 8 ? 8 : 6);
      const activeModelId = (isSingleFrame || isIngredients)
        ? (modelId.includes('_r2v_') ? modelId : `abra_r2v_${validR2vDur}s`)
        : modelId;
      const extraIngIds = isIngredients && ingredientMediaIds.length > 1 ? ingredientMediaIds.slice(1) : [];
      startSlot = primaryMediaId ? [null, primaryMediaId, null, null, null, cropCoordsIng] : null;
      endSlot = (extraIngIds.length > 0)
        ? [null, extraIngIds[0], null, null, null, cropCoordsIng]
        : null;
      createPayload = [
        [[
          [null, null, [[[flowRequest.prompt.trim()]]]],
          activeModelId,
          numOutputs,
          null,
          startSlot,
          endSlot,
          [null, null, null, null, requestUuidA, requestUuidB],
        ]],
        [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
        [sceneUuid, 2],
      ];
    } else if (isFrames) {
      // Tính crop coordinates chính xác theo kích thước ảnh thực tế và tỉ lệ video (16:9 / 9:16)
      const startCrop = computeFlowCropCoords(flowRequest?.image_width, flowRequest?.image_height, isPortrait);
      const endCrop = computeFlowCropCoords(flowRequest?.end_image_width, flowRequest?.end_image_height, isPortrait);

      startSlot = startFrameMediaId ? [null, startFrameMediaId, null, null, null, startCrop] : null;
      endSlot = endFrameMediaId ? [null, endFrameMediaId, null, null, null, endCrop] : null;
      createPayload = [
        [[
          [null, null, [[[flowRequest.prompt.trim()]]]],
          modelId,
          numOutputs,
          null,
          startSlot,
          endSlot,
          [null, null, null, null, requestUuidA, requestUuidB],
        ]],
        [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
        [sceneUuid, 2],
      ];
    } else {
      createPayload = [
        [[
          [null, null, [[[flowRequest.prompt.trim()]]]],
          modelId,
          numOutputs,
          null,
          [null, null, null, null, requestUuidA, requestUuidB],
        ]],
        [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
        [sceneUuid, 2],
      ];
    }

    async function getFreshCaptchaToken() {
      try {
        const grecap = (typeof window !== 'undefined' ? window.grecaptcha : globalThis.grecaptcha);
        if (grecap?.enterprise?.execute) {
          let siteKey = '';
          const el = typeof document !== 'undefined' ? document.querySelector('[data-sitekey]') : null;
          if (el) siteKey = el.getAttribute('data-sitekey') || '';
          if (!siteKey) {
            const script = typeof document !== 'undefined' ? document.querySelector('script[src*="enterprise.js"]') : null;
            const m = script?.src?.match(/[?&]render=([^&]+)/);
            if (m && m[1] !== 'explicit') siteKey = m[1];
          }
          if (!siteKey) {
            const cfg = typeof window !== 'undefined' ? window.___grecaptcha_cfg : globalThis.___grecaptcha_cfg;
            if (cfg?.clients) {
              for (const client of Object.values(cfg.clients)) {
                if (client?.sitekey) { siteKey = client.sitekey; break; }
                if (typeof client === 'object' && client !== null) {
                  for (const item of Object.values(client)) {
                    if (item?.sitekey) { siteKey = item.sitekey; break; }
                  }
                }
                if (siteKey) break;
              }
            }
          }
          if (!siteKey) {
            siteKey = '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
          }
          console.log('[FlowPage] Đang sinh reCAPTCHA token tươi với siteKey:', siteKey);
          return await grecap.enterprise.execute(siteKey, { action: 'VIDEO_GENERATION' });
        }
      } catch (e) {
        console.warn('[FlowPage] Error obtaining fresh reCAPTCHA token in page:', e);
      }
      return null;
    }

    if (ingredientMediaIds.length > 0 || startFrameMediaId) {
      // Giãn cách cadence an toàn 4.5s sau khi upload ảnh để tránh WAF kích hoạt PUBLIC_ERROR_UNUSUAL_ACTIVITY
      console.log('[FlowPage] Giữ cadence 4.5s sau khi xử lý nguyên liệu...');
      await sleepInPage(4500);
    }

    // Luôn ưu tiên reCAPTCHA token tươi nhất vừa sinh trực tiếp trong context trang cho RPC tạo video
    const freshTokenBeforeCreate = await getFreshCaptchaToken();
    if (freshTokenBeforeCreate && Array.isArray(createPayload?.[1])) {
      console.log('[FlowPage] Đã gắn fresh reCAPTCHA token vào payload tạo video');
      createPayload[1][10] = [freshTokenBeforeCreate, 1];
    }

    try {
      (typeof window !== 'undefined' ? window : globalThis).__LAST_FLOW_DEBUG__ = {
        rpcId,
        createPayload: JSON.parse(JSON.stringify(createPayload)),
        flowRequest: { ...flowRequest, image_base64: Boolean(flowRequest?.image_base64), end_image_base64: Boolean(flowRequest?.end_image_base64) },
        image_width: flowRequest?.image_width,
        image_height: flowRequest?.image_height,
      };
    } catch {}

    let created = null;
    try {
      created = findMediaAsset(await callRpc(rpcId, createPayload));
    } catch (rpcErr) {
      try {
        if ((typeof window !== 'undefined' ? window : globalThis).__LAST_FLOW_DEBUG__) {
          (typeof window !== 'undefined' ? window : globalThis).__LAST_FLOW_DEBUG__.firstError = rpcErr.message;
        }
      } catch {}
      if (rpcErr?.message && (rpcErr.message.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY') || rpcErr.message.includes('[7]'))) {
        console.log('[FlowPage] Gặp PUBLIC_ERROR_UNUSUAL_ACTIVITY, giãn cách cadence 4.5s và lấy reCAPTCHA token mới...');
        await sleepInPage(4500);
        const retryToken = await getFreshCaptchaToken();
        if (retryToken) {
          if (Array.isArray(createPayload?.[1])) {
            createPayload[1][10] = [retryToken, 1];
          }
          try {
            created = findMediaAsset(await callRpc(rpcId, createPayload));
          } catch (retryErr) {
            console.warn('[FlowPage] Thử lại sau UNUSUAL_ACTIVITY thất bại:', retryErr);
          }
        }
      }
      if (!created && (isSingleFrame || isIngredients)) {
        // HAR 30/09: ingredients/singleFrame dùng nprQif, fallback thử các durations khác nhau
        const fallbackDurations = [8, 10, 6, 4].filter((d) => `abra_r2v_${d}s` !== createPayload[0][0][1]);
        let lastErr = rpcErr;
        for (const fbDur of fallbackDurations) {
          try {
            console.log('[FlowPage] Fallback nprQif ingredients/singleFrame với duration:', fbDur);
            createPayload[0][0][1] = `abra_r2v_${fbDur}s`;
            const fbResp = await callRpc(rpcId, createPayload);
            created = findMediaAsset(fbResp);
            if (created) {
              console.log('[FlowPage] Fallback ingredients thành công với duration:', fbDur);
              modelId = `abra_r2v_${fbDur}s`;
              break;
            }
          } catch (fbErr) {
            lastErr = fbErr;
          }
        }
        if (!created) {
          const activeTok = freshTokenBeforeCreate || captchaToken;
          const diag = `[Diag: pid=${projectId}, tokLen=${activeTok?.length || 0}, isFresh=${Boolean(freshTokenBeforeCreate)}, at=${csrfToken ? csrfToken.slice(0,6) : 'none'}, sid=${sessionId ? String(sessionId).slice(0,6) : 'none'}, bl=${buildLabel ? String(buildLabel).slice(0,10) : 'none'}]`;
          throw new Error(`${lastErr?.message || lastErr} ${diag}`);
        }
      } else if (isFrames || isSingleFrame || isIngredients) {
        // HAR flow.google_1.har / flow.google_2.har.com: omni_flash_i2v_8s hoặc 10s tùy theo duration
        const fallbackCandidates = (isFrames && endSlot) ? [
          { model: dur >= 10 ? 'omni_flash_i2v_10s_first_last' : 'omni_flash_i2v_8s_first_last', end: endSlot },
          { model: dur >= 10 ? 'omni_flash_i2v_8s_first_last' : 'omni_flash_i2v_10s_first_last', end: endSlot },
        ] : [
          { model: 'abra_r2v_8s', end: endSlot },
          { model: 'abra_r2v_10s', end: endSlot },
          { model: 'abra_r2v_6s', end: endSlot },
          { model: 'abra_r2v_4s', end: endSlot },
        ];
        let lastErr = rpcErr;
        for (const cand of fallbackCandidates) {
          if (cand.model === modelId) continue;
          try {
            console.log('[FlowPage] Thử lại nprQif với candidate:', cand.model);
            createPayload[0][0][1] = cand.model;
            createPayload[0][0][5] = cand.end;
            const fallbackResp = await callRpc(rpcId, createPayload);
            created = findMediaAsset(fallbackResp);
            if (created) {
              console.log('[FlowPage] Fallback nprQif thành công với model:', cand.model);
              modelId = cand.model;
              break;
            }
          } catch (fbErr) {
            lastErr = fbErr;
            try {
              const dbg = (typeof window !== 'undefined' ? window : globalThis).__LAST_FLOW_DEBUG__;
              if (dbg) {
                if (!dbg.fallbackErrors) dbg.fallbackErrors = [];
                dbg.fallbackErrors.push({ model: cand.model, err: fbErr.message });
              }
            } catch {}
          }
        }
        if (!created) {
          const slot4Str = JSON.stringify(createPayload?.[0]?.[0]?.[4]);
          const slot5Str = JSON.stringify(createPayload?.[0]?.[0]?.[5]);
          throw new Error(`${lastErr?.message || lastErr} [Model: ${createPayload?.[0]?.[0]?.[1]}, slot4: ${slot4Str}, slot5: ${slot5Str}]`);
        }
      } else if (modelId.includes('_i2v_') && !isFrames && !isIngredients) {
        const fallbackModelId = modelId.replace('_i2v_', '_t2v_');
        createPayload[0][0][1] = fallbackModelId;
        created = findMediaAsset(await callRpc(rpcId, createPayload));
      } else {
        throw rpcErr;
      }
    }

    const mediaId = created?.[0];
    if (!mediaId) throw new Error('Flow create response did not contain a media id');

    // Lưu vết tiến trình sinh video vào tab để cơ chế recovery có thể tái sử dụng ngay cả khi executeScript bị ngắt
    try {
      (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = {
        mediaId,
        projectId,
        modelId,
        startTime: Date.now(),
        prompt: flowRequest?.prompt || '',
      };
    } catch { }

    let videoUrl = null;
    let imageUrl = null;
    const deadline = Date.now() + 600_000;
    let loopCount = 0;

    while (Date.now() < deadline) {
      await sleepInPage(3_000);
      loopCount++;

      // Kênh 1: Kiểm tra trực tiếp trên DOM & Network entries (phải đúng mediaId của job này)
      const domUrl = checkDomAndPerformanceForVideo(mediaId);
      if (domUrl) {
        videoUrl = domUrl;
        break;
      }

      // Kênh 2: Kiểm tra RPC jwpduf
      try {
        const pollResp = await callRpc('jwpduf', [null, null, [[mediaId]]]);
        const pollUrl = findVideoUrl(pollResp);
        if (pollUrl) {
          videoUrl = pollUrl;
          break;
        }
        const asset = findMediaAsset(pollResp);
        // Trong Google Flow HAR thực tế: asset[5][8][0] là status (6 = queued, 2 = generating, 3 = complete)
        // Fallback asset[5][0][8][0] cho mock test cũ
        const status = asset?.[5]?.[8]?.[0] ?? asset?.[5]?.[0]?.[8]?.[0];
        if (status === 3) {
          // Status 3 = Hoàn tất, gọi as29s lấy URL
          const finalAsset = await callRpc('as29s', [mediaId]);
          // Trong Google Flow HAR: finalAsset[7][0][8] chứa URL video có chữ ký
          videoUrl = finalAsset?.[7]?.[0]?.[8] || finalAsset?.[5]?.[2]?.[0]?.[8] || findVideoUrl(finalAsset) || findSignedVideoUrl(finalAsset, mediaId);
          imageUrl = finalAsset?.[5]?.[10] || finalAsset?.[5]?.[0]?.[10] || null;
          if (videoUrl) break;
        }
        // Các trạng thái đang xử lý hợp lệ: 6 (queued), 2 (rendering), 1 (started)
        const isProcessing = (status === 6 || status === 2 || status === 1 || status === undefined || status === null);
        if (!isProcessing && status !== 3) {
          let extraReason = '';
          try {
            const findStrings = (node) => {
              if (typeof node === 'string' && node.length > 4 && node.length < 250) {
                const l = node.toLowerCase();
                if (l.includes('policy') || l.includes('safety') || l.includes('filter') ||
                    l.includes('block') || l.includes('reject') || l.includes('fail') ||
                    l.includes('violate') || l.includes('quality') || l.includes('person') ||
                    l.includes('moderation') || l.includes('pose') || l.includes('unsupported')) {
                  return node;
                }
              }
              if (Array.isArray(node)) {
                for (const c of node) {
                  const s = findStrings(c);
                  if (s) return s;
                }
              }
              return '';
            };
            extraReason = findStrings(pollResp);
          } catch { }
          const reasonSuffix = extraReason ? ` (lý do: ${extraReason})` : '';
          throw new Error(`Flow render ended with status ${status}${reasonSuffix}`);
        }
      } catch (err) {
        if (err.message && err.message.includes('Flow render ended')) throw err;
      }

      // Kênh 3: Sau 20s (loopCount >= 7), thử gọi as29s mỗi 6s để lấy video sớm nhất
      if (loopCount >= 7 && loopCount % 2 === 0) {
        try {
          const checkFinal = await callRpc('as29s', [mediaId]);
          const asUrl = checkFinal?.[7]?.[0]?.[8] || checkFinal?.[5]?.[2]?.[0]?.[8] || findVideoUrl(checkFinal) || findSignedVideoUrl(checkFinal, mediaId);
          if (asUrl) {
            videoUrl = asUrl;
            imageUrl = checkFinal?.[5]?.[10] || checkFinal?.[5]?.[0]?.[10] || null;
            break;
          }
        } catch { }
      }
    }

    if (!videoUrl) throw new Error('Timed out waiting for Flow render');

    try {
      const active = (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__;
      if (active && active.mediaId === mediaId) {
        (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null;
      }
    } catch { }

    return {
      ok: true, video_url: videoUrl, image_url: imageUrl, media_id: mediaId,
      provider_model_id: modelId, project_id: projectId,
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
