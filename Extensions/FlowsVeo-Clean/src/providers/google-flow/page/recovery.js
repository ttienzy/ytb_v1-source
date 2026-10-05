export async function recoverCurrentSceneInPage(providerModelId = '', targetMediaId = null, explicitProjectId = null) {
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
    return true;
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

  // Broader URL detector: handles signed CDN URLs from non-flow-content.google hosts
  function findAnyGoogleVideoUrl(node, targetMid) {
    if (!node) return null;
    if (typeof node === 'string' && node.startsWith('https://')) {
      try {
        const lower = node.toLowerCase();
        if (/\.(?:jpg|jpeg|png|webp|gif|avif|svg|css|js|woff|ttf)(?:$|[?#])/.test(lower)) return null;
        if (/(?:preview|thumbnail|poster|sprite|favicon)/.test(lower)) return null;
        // Accept if URL contains the target mediaId (signed CDN URLs include asset ID)
        if (targetMid && node.includes(targetMid)) return node;
        // Accept if it's from flow-content.google and not an image
        const u = new URL(node);
        if (u.hostname === 'flow-content.google') {
          const pathname = u.pathname.toLowerCase();
          if (!pathname.startsWith('/image') && !pathname.includes('/image/')) return node;
        }
      } catch { }
      return null;
    }
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findAnyGoogleVideoUrl(child, targetMid);
        if (found) return found;
      }
    } else if (typeof node === 'object' && node !== null) {
      for (const v of Object.values(node)) {
        const found = findAnyGoogleVideoUrl(v, targetMid);
        if (found) return found;
      }
    }
    return null;
  }

  try {
    const activeGen = (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__;
    const activeModelId = activeGen?.modelId || providerModelId || 'abra_t2v_6s';

    let route = location.pathname.match(/^\/(u\/\d+)\/project\/([^/?#]+)/);
    let accountPath = route ? `/${route[1]}` : '';
    let projectId = explicitProjectId || (route ? route[2] : null);
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
        try {
          const urlObj = new URL(projLink.href);
          const m = urlObj.pathname.match(/\/project\/([^/?#]+)/);
          if (m) {
            projectId = m[1];
            const uM = urlObj.pathname.match(/\/(u\/\d+)/);
            accountPath = uM ? `/${uM[1]}` : (location.pathname.match(/\/(u\/\d+)/)?.[0] || '');
          }
        } catch { }
      }
    }

    const wiz = window.WIZ_global_data || {};
    const csrfToken = wiz.SNlM0e;
    const sessionId = wiz.FdrFJe;
    const buildLabel = wiz.cfb2h;

    // Diagnostic tracking — piggybacked on the { ok: false } return so video-ui.js can log why polls fail
    const _debug = {
      rpcReady: Boolean(csrfToken && sessionId && buildLabel && projectId),
      projectId: projectId || null,
      mediaId: null, // set later
      zzl0ze: null,  // 'ok' | 'empty' | 'null' | 'error'
      as29s: null,
      jwpduf: null,
      jwpdufStatus: null,
      domVideos: 0,
    };

    async function callRpcInPage(rpcId, payload) {
      if (!csrfToken || !sessionId || !buildLabel || !projectId) return null;
      try {
        const sourcePath = accountPath ? `${accountPath}/project/${projectId}` : `/project/${projectId}`;
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
    _debug.mediaId = mediaIdToQuery;

    if (projectId) {
      try {
        const sceneData = await callRpcInPage('Zzl0ze', [`projects/${projectId}`, null, null, null, [1]]);
        _debug.zzl0ze = sceneData ? (Array.isArray(sceneData?.[1]) && sceneData[1].length > 0 ? 'ok' : 'empty') : 'null';
        const rawNodes = sceneData?.[1] || [];
        let targetNode = null;
        let newestMediaId = null;
        let newestTime = 0;
        let newestNode = null;
        for (const node of rawNodes) {
          try {
            const info = node?.[3];
            const timeSec = info?.[1]?.[0] || 0;
            const mid = info?.[4];
            if (mediaIdToQuery && mid === mediaIdToQuery) {
              targetNode = node;
            }
            if (mid && timeSec > newestTime) {
              newestTime = timeSec;
              newestMediaId = mid;
              newestNode = node;
            }
          } catch { }
        }

        // Kênh ưu tiên 1: Nếu thăm dò theo mediaId cụ thể và tìm thấy node tương ứng trong sceneData
        if (mediaIdToQuery && targetNode) {
          const targetVideoUrl = findVideoUrl(targetNode);
          if (targetVideoUrl) {
            try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
            return {
              ok: true,
              video_url: targetVideoUrl,
              image_url: findImageUrl(targetNode),
              media_id: mediaIdToQuery,
              provider_model_id: activeModelId,
              project_id: projectId,
            };
          }
        }

        // Kênh ưu tiên 2: Nếu không có mediaIdToQuery (chế độ phục hồi clip mới nhất)
        if (!mediaIdToQuery && newestNode) {
          const nodeVideoUrl = findVideoUrl(newestNode);
          const sceneVideoUrl = nodeVideoUrl || findVideoUrl(sceneData);
          if (sceneVideoUrl) {
            try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
            return {
              ok: true,
              video_url: sceneVideoUrl,
              image_url: (newestNode ? findImageUrl(newestNode) : null) || findImageUrl(sceneData),
              media_id: newestMediaId,
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
            const vUrl = ast?.[7]?.[0]?.[8] || ast?.[5]?.[2]?.[0]?.[8] || findVideoUrl(ast);
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
        _debug.as29s = finalAsset ? 'data' : 'null';
        const asUrl = finalAsset?.[7]?.[0]?.[8] || finalAsset?.[5]?.[2]?.[0]?.[8] || findVideoUrl(finalAsset) || findAnyGoogleVideoUrl(finalAsset, mediaIdToQuery);
        if (asUrl) {
          try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
          return {
            ok: true,
            video_url: asUrl,
            image_url: finalAsset?.[5]?.[10] || findImageUrl(finalAsset),
            media_id: mediaIdToQuery,
            provider_model_id: activeModelId,
            project_id: projectId,
          };
        }
      } catch { }

      try {
        const pollResp = await callRpcInPage('jwpduf', [null, null, [[mediaIdToQuery]]]);
        _debug.jwpduf = pollResp ? 'data' : 'null';
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
        _debug.jwpdufStatus = status ?? null;
        if (status === 3) {
          const finalAsset = await callRpcInPage('as29s', [mediaIdToQuery]);
          const asUrl = finalAsset?.[7]?.[0]?.[8] || finalAsset?.[5]?.[2]?.[0]?.[8] || findVideoUrl(finalAsset) || findAnyGoogleVideoUrl(finalAsset, mediaIdToQuery);
          if (asUrl) {
            try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
            return {
              ok: true,
              video_url: asUrl,
              image_url: finalAsset?.[5]?.[10] || findImageUrl(finalAsset),
              media_id: mediaIdToQuery,
              provider_model_id: activeModelId,
              project_id: projectId,
            };
          }
        }
        if (status !== 1 && status !== 2 && status !== 3 && status !== 6 && status !== undefined && status !== null) {
          return {
            ok: false,
            terminal_error: true,
            error: `Flow render ended with status ${status} (media_id=${mediaIdToQuery})`,
          };
        }
      } catch { }
    }

    // 3. Fallback quét các thẻ video và resource entries trên DOM & Network
    if (mediaIdToQuery) {
      // 3a. Quét thẻ video và container chứa mediaId
      for (const video of document.querySelectorAll('video')) {
        const src = video.currentSrc || video.src;
        if (src && isLikelyFlowVideoUrl(src)) {
          if (src.includes(mediaIdToQuery)) {
            try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
            return {
              ok: true,
              video_url: src,
              media_id: mediaIdToQuery,
              provider_model_id: activeModelId,
              project_id: projectId,
            };
          }
          const card = video.closest('[data-id], [id], [data-node-id], .card, .node');
          if (card && (card.id?.includes(mediaIdToQuery) || JSON.stringify(card.dataset || {}).includes(mediaIdToQuery))) {
            try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
            return {
              ok: true,
              video_url: src,
              media_id: mediaIdToQuery,
              provider_model_id: activeModelId,
              project_id: projectId,
            };
          }
        }
        for (const source of video.querySelectorAll('source')) {
          if (source.src && isLikelyFlowVideoUrl(source.src) && source.src.includes(mediaIdToQuery)) {
            try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
            return {
              ok: true,
              video_url: source.src,
              media_id: mediaIdToQuery,
              provider_model_id: activeModelId,
              project_id: projectId,
            };
          }
        }
      }

      // 3b. Quét performance network entries có mediaId
      try {
        if (typeof performance?.getEntriesByType === 'function') {
          const entries = performance.getEntriesByType('resource').slice().reverse();
          for (const entry of entries) {
            const n = entry.name || '';
            if (isLikelyFlowVideoUrl(n) && n.includes(mediaIdToQuery)) {
              try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
              return {
                ok: true,
                video_url: n,
                media_id: mediaIdToQuery,
                provider_model_id: activeModelId,
                project_id: projectId,
              };
            }
          }
        }
      } catch { }
    }

    // 3c. Fallback probe cho trường hợp phục hồi không có mediaId cụ thể
    if (!mediaIdToQuery) {
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

      const uniqueCandidates = [...new Set(candidates)].filter(isVideoCandidate);
      for (const candidate of uniqueCandidates) {
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
              media_id: null,
              provider_model_id: activeModelId,
              project_id: projectId,
            };
          }
          try { await probe.body?.cancel(); } catch { }
        } catch { }
      }
    }

    // Last resort: khi tất cả RPC channels đều fail, quét TẤT CẢ <video> đang phát trên trang
    // (chỉ dùng khi có mediaIdToQuery — tránh trả nhầm video)
    if (mediaIdToQuery) {
      try {
        const allVideos = Array.from(document.querySelectorAll('video')).filter(v => {
          const src = v.currentSrc || v.src;
          return src && src.startsWith('https://') && !v.paused && v.readyState >= 2;
        });
        _debug.domVideos = allVideos.length;
        // Nếu CHỈ có đúng 1 video đang phát trên trang, có thể chấp nhận nó
        if (allVideos.length === 1) {
          const src = allVideos[0].currentSrc || allVideos[0].src;
          if (isLikelyFlowVideoUrl(src) || isVideoCandidate(src)) {
            try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
            return {
              ok: true,
              video_url: src,
              media_id: mediaIdToQuery,
              provider_model_id: activeModelId,
              project_id: projectId,
              _fallback: 'single_playing_video',
            };
          }
        }
      } catch { }
    }

    const isGenerating = Boolean(
      document.querySelector('[role="progressbar"], [aria-label*="generating" i], [aria-label*="creating" i], .generating, [data-is-generating="true"]')
    );
    return {
      ok: false,
      is_generating: isGenerating,
      error: isGenerating ? 'Flow is still rendering video in scene' : 'No completed Flow video URL found in the open scene',
      _debug,
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}
