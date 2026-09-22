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
        return req.provider_model_id;
      }
      const modelName = (req.model_display_name || '').toLowerCase();
      const isPortrait = req.aspect_ratio === '9:16';

      if (isVideoEdit) {
        return req.resolution === '360p' ? 'abra_edit_360p' : 'abra_edit';
      }
      if (isIngredients) {
        return `abra_r2v_${dur}s`;
      }
      if (isFrames) {
        return (req.image_base64 && req.end_image_base64)
          ? 'omni_flash_i2v_10s_first_last'
          : `abra_r2v_${dur}s`;
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
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('[')) continue;
        try {
          const parsed = JSON.parse(trimmed);
          const payload = findRpcEnvelope(parsed, rpcId);
          if (payload !== null) return JSON.parse(payload);
        } catch { }
      }
      const preview = (typeof text === 'string' ? text.replace(/\s+/g, ' ').slice(0, 300) : '');
      throw new Error(`Flow RPC ${rpcId} returned no usable payload. Response: ${preview}`);
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
          if (
            lower.includes('/video') ||
            lower.includes('/media') ||
            lower.includes('/download') ||
            lower.includes('.mp4') ||
            lower.includes('signature=') ||
            lower.includes('expires=') ||
            lower.includes('expire=') ||
            lower.includes('token=') ||
            lower.includes('download=')
          ) {
            return node;
          }
          try {
            const u = new URL(node);
            if (u.pathname.split('/').filter(Boolean).length >= 2) return node;
          } catch { }
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
          captchaToken ? [captchaToken, 1] : null,
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

        let resp = null;
        try {
          resp = await callRpc('maseQ', maseQPayload);
        } catch (rpcErr) {
          // Retry without captcha slot if rejected
          if (headerProto[10]) {
            headerProto[10] = null;
            resp = await callRpc('maseQ', maseQPayload);
          } else {
            throw rpcErr;
          }
        }

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

    let startFrameMediaId = null;
    let endFrameMediaId = null;
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
      if (flowRequest.image_base64) {
        startFrameMediaId = await uploadImageToFlow(
          flowRequest.image_base64,
          flowRequest.image_mime,
          flowRequest.image_name || 'start_frame.png'
        );
      }
      if (flowRequest.end_image_base64) {
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
        logActivity('warn', 'Không có khung hình trong request frames, tự động tạo video từ prompt (text_to_video)');
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
        logActivity('warn', 'Không có ảnh tham chiếu trong request ingredients, tự động tạo video từ prompt (text_to_video)');
        isIngredients = false;
        modelId = modelId.replace('_r2v_', '_t2v_');
      }
    }

    const isSingleFrame = isFrames && Boolean(startFrameMediaId) && !endFrameMediaId;
    const rpcId = isVideoEdit
      ? 'jIps6'
      : (isIngredients || isSingleFrame ? 'MZZa6b' : (isFrames ? 'nprQif' : 'YhhmEf'));

    const requestUuidA = (crypto.randomUUID ? crypto.randomUUID() : 'AD722819-13F6-46E3-A074-9CA0266A4FE0').toUpperCase();
    const requestUuidB = (crypto.randomUUID ? crypto.randomUUID() : '4C8832DC-AD37-4C11-859E-DCFD4FB4903E').toUpperCase();
    const sceneUuid = (crypto.randomUUID ? crypto.randomUUID() : '154922EC-9CE9-4413-A9C0-B2664F7FFB7B').toUpperCase();
    // Google Flow Aspect Ratio Enum: 2 = 16:9 (Landscape), 1 = 9:16 (Portrait)
    const aspectEnum = flowRequest?.aspect_ratio === '16:9' ? 2 : 1;
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
        aspectEnum,
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
      // Chuẩn Google Flow HAR flow.google_2.har: MZZa6b nhận mảng reference slots [[null, id1], [null, id2]] ở index 1
      const refSlots = isSingleFrame
        ? [[null, startFrameMediaId]]
        : ingredientMediaIds.map((id) => [null, id]);
      const activeModelId = isSingleFrame ? (modelId.includes('_r2v_') ? modelId : `abra_r2v_${dur}s`) : modelId;
      createPayload = [
        [[
          [null, null, [[[flowRequest.prompt.trim()]]]],
          refSlots,
          activeModelId,
          aspectEnum,
          null,
          [null, null, null, null, requestUuidA, requestUuidB],
        ]],
        [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
        [sceneUuid, 2],
      ];
    } else if (isFrames) {
      // Chuẩn Google Flow HAR flow.google_1.har: nprQif nhận slot start/end ở index 4 và index 5 (dành cho chế độ 2 khung hình First & Last)
      // 9:16 portrait dùng crop box [null, 0.341796875, 1, 0.658203125], 16:9 dùng [null, 0, 1, 1]
      const cropCoords = aspectEnum === 1 ? [null, 0.341796875, 1, 0.658203125] : [null, 0, 1, 1];
      startSlot = startFrameMediaId ? [null, startFrameMediaId, null, null, null, cropCoords] : null;
      endSlot = endFrameMediaId ? [null, endFrameMediaId, null, null, null, cropCoords] : null;
      createPayload = [
        [[
          [null, null, [[[flowRequest.prompt.trim()]]]],
          modelId,
          aspectEnum,
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
          aspectEnum,
          null,
          [null, null, null, null, requestUuidA, requestUuidB],
        ]],
        [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
        [sceneUuid, 2],
      ];
    }

    let created = null;
    try {
      created = findMediaAsset(await callRpc(rpcId, createPayload));
    } catch (rpcErr) {
      if (isSingleFrame) {
        // Fallback thông minh cho MZZa6b nếu duration ban đầu gặp lỗi
        const fallbackDurations = [10, 6, 4].filter((d) => `abra_r2v_${d}s` !== createPayload[0][0][2]);
        let lastErr = rpcErr;
        for (const fbDur of fallbackDurations) {
          try {
            console.log('[FlowPage] Thử lại MZZa6b cho 1 frame với duration:', fbDur);
            createPayload[0][0][2] = `abra_r2v_${fbDur}s`;
            const fbResp = await callRpc(rpcId, createPayload);
            created = findMediaAsset(fbResp);
            if (created) {
              console.log('[FlowPage] Fallback MZZa6b thành công với duration:', fbDur);
              modelId = `abra_r2v_${fbDur}s`;
              break;
            }
          } catch (fbErr) {
            lastErr = fbErr;
          }
        }
        if (!created) throw lastErr;
      } else if (isFrames) {
        // Fallback thông minh cho nprQif (chế độ 2 khung hình: First & Last Frame)
        const fallbackCandidates = [
          { model: 'omni_flash_i2v_10s_first_last', end: endSlot, omitEnd: false },
          { model: 'omni_flash_i2v_10s_first_last', end: null, omitEnd: true },
          { model: 'omni_flash_i2v_10s_first', end: null, omitEnd: false },
          { model: 'omni_flash_i2v_6s_first_last', end: endSlot, omitEnd: false },
          { model: 'omni_flash_i2v_6s_first', end: null, omitEnd: false },
        ];
        let lastErr = rpcErr;
        for (const cand of fallbackCandidates) {
          if (cand.model === modelId && !cand.omitEnd) continue;
          try {
            console.log('[FlowPage] Thử lại nprQif với candidate:', cand);
            if (cand.omitEnd) {
              createPayload[0][0] = [
                createPayload[0][0][0],
                cand.model,
                aspectEnum,
                null,
                startSlot,
                [null, null, null, null, requestUuidA, requestUuidB],
              ];
            } else {
              createPayload[0][0] = [
                createPayload[0][0][0],
                cand.model,
                aspectEnum,
                null,
                startSlot,
                cand.end,
                [null, null, null, null, requestUuidA, requestUuidB],
              ];
            }
            const fallbackResp = await callRpc(rpcId, createPayload);
            created = findMediaAsset(fallbackResp);
            if (created) {
              console.log('[FlowPage] Fallback nprQif thành công với model:', cand.model);
              modelId = cand.model;
              break;
            }
          } catch (fbErr) {
            lastErr = fbErr;
          }
        }
        if (!created) {
          throw lastErr;
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
        // Trong Google Flow HAR thực tế: asset[5][8][0] là status (2 = generating, 3 = complete)
        // Fallback asset[5][0][8][0] cho mock test cũ
        const status = asset?.[5]?.[8]?.[0] ?? asset?.[5]?.[0]?.[8]?.[0];
        if (status === 3) {
          // Status 3 = Hoàn tất, gọi as29s lấy URL
          const finalAsset = await callRpc('as29s', [mediaId]);
          // Trong Google Flow HAR: finalAsset[7][0][8] chứa URL video có chữ ký
          videoUrl = finalAsset?.[7]?.[0]?.[8] || finalAsset?.[5]?.[2]?.[0]?.[8] || findVideoUrl(finalAsset);
          imageUrl = finalAsset?.[5]?.[10] || finalAsset?.[5]?.[0]?.[10] || null;
          if (videoUrl) break;
        }
        if (status !== 2 && status !== 1 && status !== 3 && status !== undefined && status !== null) {
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
          const asUrl = checkFinal?.[7]?.[0]?.[8] || checkFinal?.[5]?.[2]?.[0]?.[8] || findVideoUrl(checkFinal);
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
