export async function recoverCurrentSceneInPage(providerModelId = '', targetMediaId = null) {
  const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isVideoCandidate(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    let url;
    try { url = new URL(value, location.href); } catch { return false; }
    if (url.protocol !== 'https:' || url.hostname !== 'flow-content.google') return false;
    const pathname = url.pathname.toLowerCase();
    if (pathname.startsWith('/image') || pathname.includes('/image/')) return false;
    if (/\.(?:jpg|jpeg|png|webp|gif|avif)(?:$|[?#])/.test(pathname)) return false;
    if (/(?:preview|thumbnail|poster|sprite)/.test(pathname)) return false;
    return true;
  }

  function isLikelyFlowVideoUrl(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    let parsed;
    try { parsed = new URL(value, location.href); } catch { return false; }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'flow-content.google') return false;
    const pathname = parsed.pathname.toLowerCase();
    if (pathname.startsWith('/image') || pathname.includes('/image/')) return false;
    if (/\.(?:jpg|jpeg|png|webp|gif|avif)(?:$|[?#])/.test(pathname)) return false;
    if (/(?:preview|thumbnail|poster|sprite)/.test(pathname)) return false;
    return pathname.includes('/video') || /\.mp4(?:$|[?#])/i.test(pathname);
  }

  function findVideoUrl(node) {
    if (!node) return null;
    if (typeof node === 'string') {
      return isLikelyFlowVideoUrl(node) ? node : null;
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

  function findImageUrl(node) {
    if (!node) return null;
    if (typeof node === 'string') {
      try {
        const parsed = new URL(node, location.href);
        if (parsed.protocol === 'https:' && parsed.hostname === 'flow-content.google') {
          const pathname = parsed.pathname.toLowerCase();
          if (pathname.includes('/image/') || pathname.startsWith('/image')) return node;
        }
      } catch { }
      return null;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const u = findImageUrl(child);
        if (u) return u;
      }
    } else if (typeof node === 'object') {
      for (const v of Object.values(node)) {
        const u = findImageUrl(v);
        if (u) return u;
      }
    }
    return null;
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

  try {
    const activeGen = (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__;
    const activeModelId = activeGen?.modelId || providerModelId || 'abra_t2v_6s';

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

    const wiz = window.WIZ_global_data || {};
    const csrfToken = wiz.SNlM0e;
    const sessionId = wiz.FdrFJe;
    const buildLabel = wiz.cfb2h;

    async function callRpcInPage(rpcId, payload) {
      if (!csrfToken || !sessionId || !buildLabel || !projectId) return null;
      try {
        const sourcePath = `/project/${projectId}`;
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
        const response = await fetch(endpoint, {
          method: 'POST', credentials: 'include', cache: 'no-store',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Same-Domain': '1',
          },
          body: body.toString(),
        });
        if (!response.ok) return null;
        const text = await response.text();
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith('[')) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const findEnv = (node) => {
              if (!Array.isArray(node)) return null;
              if (node[0] === 'wrb.fr' && node[1] === rpcId && typeof node[2] === 'string') return node[2];
              for (const c of node) {
                const f = findEnv(c);
                if (f !== null) return f;
              }
              return null;
            };
            const p = findEnv(parsed);
            if (p !== null) return JSON.parse(p);
          } catch { }
        }
      } catch { }
      return null;
    }

    // 1. Xác định mediaId cần thăm dò: từ targetMediaId, window active generation, hoặc tìm node mới nhất qua Zzl0ze
    let mediaIdToQuery = targetMediaId || activeGen?.mediaId || null;

    if (projectId) {
      try {
        const sceneData = await callRpcInPage('Zzl0ze', [`projects/${projectId}`, null, null, null, [1]]);
        const rawNodes = sceneData?.[1] || [];
        let newestMediaId = null;
        let newestTime = 0;
        let newestNode = null;
        for (const node of rawNodes) {
          try {
            const info = node?.[3];
            const timeSec = info?.[1]?.[0] || 0;
            const mid = info?.[4];
            if (mid && timeSec > newestTime) {
              newestTime = timeSec;
              newestMediaId = mid;
              newestNode = node;
            }
          } catch { }
        }

        // Kênh ưu tiên: Kiểm tra nếu sceneData chứa URL video thành phẩm.
        // Chỉ chấp nhận khi không có mediaIdToQuery (lấy clip mới nhất) hoặc
        // mediaIdToQuery khớp với node mới nhất vừa tạo trong scene.
        const isTargetNewest = Boolean(newestMediaId && (!mediaIdToQuery || mediaIdToQuery === newestMediaId));
        if (isTargetNewest || !mediaIdToQuery) {
          const nodeVideoUrl = newestNode ? findVideoUrl(newestNode) : null;
          const sceneVideoUrl = nodeVideoUrl || findVideoUrl(sceneData);
          if (sceneVideoUrl) {
            try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
            return {
              ok: true,
              video_url: sceneVideoUrl,
              image_url: findImageUrl(sceneData),
              media_id: mediaIdToQuery || newestMediaId,
              provider_model_id: activeModelId,
              project_id: projectId,
            };
          }
        }

        // Duyệt danh sách assets (sceneData[2]) tìm video asset (CAE/CAM)
        const rawAssets = Array.isArray(sceneData?.[2]) ? sceneData[2] : [];
        for (const ast of rawAssets) {
          if (Array.isArray(ast) && (ast[3] === 'CAE' || ast[3] === 'CAM')
              && (!mediaIdToQuery || ast[0] === mediaIdToQuery)) {
            const vUrl = findVideoUrl(ast);
            if (vUrl) {
              try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
              return {
                ok: true,
                video_url: vUrl,
                image_url: findImageUrl(ast),
                media_id: ast[0] || mediaIdToQuery,
                provider_model_id: activeModelId,
                project_id: projectId,
              };
            }
          }
        }

        if (!mediaIdToQuery && newestMediaId) {
          mediaIdToQuery = newestMediaId;
        }
      } catch { }
    }

    // 2. Thăm dò trực tiếp qua RPC as29s / jwpduf của Google Flow
    if (mediaIdToQuery) {
      try {
        const finalAsset = await callRpcInPage('as29s', [mediaIdToQuery]);
        const asUrl = findVideoUrl(finalAsset);
        if (asUrl) {
          try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
          return {
            ok: true,
            video_url: asUrl,
            image_url: findImageUrl(finalAsset),
            media_id: mediaIdToQuery,
            provider_model_id: activeModelId,
            project_id: projectId,
          };
        }
      } catch { }

      try {
        const pollResp = await callRpcInPage('jwpduf', [null, null, [[mediaIdToQuery]]]);
        const pollUrl = findVideoUrl(pollResp);
        if (pollUrl) {
          try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
          return {
            ok: true,
            video_url: pollUrl,
            image_url: findImageUrl(pollResp),
            media_id: mediaIdToQuery,
            provider_model_id: activeModelId,
            project_id: projectId,
          };
        }
        const asset = findMediaAsset(pollResp);
        const status = asset?.[5]?.[8]?.[0] ?? asset?.[5]?.[0]?.[8]?.[0];
        if (status === 3) {
          const finalAsset = await callRpcInPage('as29s', [mediaIdToQuery]);
          const asUrl = findVideoUrl(finalAsset);
          if (asUrl) {
            try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
            return {
              ok: true,
              video_url: asUrl,
              image_url: findImageUrl(finalAsset),
              media_id: mediaIdToQuery,
              provider_model_id: activeModelId,
              project_id: projectId,
            };
          }
        }
        if (status !== 1 && status !== 2 && status !== 3 && status !== undefined && status !== null) {
          return {
            ok: false,
            terminal_error: true,
            error: `Flow render ended with status ${status} (media_id=${mediaIdToQuery})`,
          };
        }
      } catch { }
    }

    // 3. Fallback quét các thẻ video và resource entries trên DOM
    const candidates = [];
    const videos = Array.from(document.querySelectorAll('video')).reverse();
    for (const video of videos) {
      if (video.currentSrc) candidates.push(video.currentSrc);
      if (video.src) candidates.push(video.src);
      for (const source of video.querySelectorAll('source')) {
        if (source.src) candidates.push(source.src);
      }
    }

    for (const element of document.querySelectorAll('a[href], [src], [data-src], [data-video-url], [data-url]')) {
      for (const attr of ['href', 'src', 'data-src', 'data-video-url', 'data-url']) {
        const value = element.getAttribute?.(attr);
        if (value) candidates.push(value);
      }
    }

    try {
      const resources = performance.getEntriesByType('resource').slice().reverse();
      for (const entry of resources) if (entry.name) candidates.push(entry.name);
    } catch { }

    const uniqueCandidates = [...new Set(candidates)];
    const exactMatch = mediaIdToQuery
      ? uniqueCandidates.find((c) => isVideoCandidate(c) && c.includes(mediaIdToQuery))
      : null;
    const candidatesToProbe = mediaIdToQuery
      ? (exactMatch ? [exactMatch] : [])
      : uniqueCandidates.filter(isVideoCandidate);

    for (const candidate of candidatesToProbe) {
      let url;
      try { url = new URL(candidate, location.href); } catch { continue; }
      try {
        const probe = await fetch(url.href, {
          method: 'GET', credentials: 'omit', cache: 'no-store',
          headers: { Range: 'bytes=0-1023' },
          signal: AbortSignal.timeout(6_000),
        });
        const contentType = (probe.headers.get('Content-Type') || '').toLowerCase();
        if (probe.ok && (contentType.startsWith('video/') || contentType === 'application/octet-stream')) {
          try { await probe.body?.cancel(); } catch { }
          try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
          return {
            ok: true,
            video_url: url.href,
            media_id: mediaIdToQuery || null,
            provider_model_id: activeModelId,
            project_id: projectId,
          };
        }
        try { await probe.body?.cancel(); } catch { }
      } catch { }
    }

    const isGenerating = Boolean(
      document.querySelector('[role="progressbar"], [aria-label*="generating" i], [aria-label*="creating" i], .generating, [data-is-generating="true"]')
    );
    return {
      ok: false,
      is_generating: isGenerating,
      error: isGenerating ? 'Flow is still rendering video in scene' : 'No completed Flow video URL found in the open scene',
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
