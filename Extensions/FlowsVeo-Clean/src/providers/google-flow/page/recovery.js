export async function recoverCurrentSceneInPage(providerModelId = '') {
  const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function isVideoCandidate(value) {
    if (typeof value !== 'string' || !value.trim()) return false;
    let url;
    try { url = new URL(value, location.href); } catch { return false; }
    if (url.protocol !== 'https:' || url.hostname !== 'flow-content.google') return false;
    const pathname = url.pathname.toLowerCase();
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
    if (/\.(?:jpg|jpeg|png|webp|gif|avif)(?:$|[?#])/.test(pathname)) return false;
    if (/(?:preview|thumbnail|poster|sprite)/.test(pathname)) return false;
    return pathname.includes('/video') ||
      pathname.includes('/media') ||
      pathname.includes('/download') ||
      /(?:\.mp4$|signature=|expires=|expire=|token=)/i.test(value) ||
      pathname.split('/').filter(Boolean).length >= 2;
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
    const activeMediaId = activeGen?.mediaId || null;
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
        const sourcePath = `${accountPath}/project/${projectId}`;
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

    // 1. Nếu có activeMediaId, hỏi trực tiếp RPC as29s / jwpduf xem video đã tạo xong chưa
    if (activeMediaId) {
      try {
        const finalAsset = await callRpcInPage('as29s', [activeMediaId]);
        const asUrl = finalAsset?.[7]?.[0]?.[8] || finalAsset?.[5]?.[2]?.[0]?.[8] || findVideoUrl(finalAsset);
        if (asUrl) {
          try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
          return {
            ok: true,
            video_url: asUrl,
            image_url: finalAsset?.[5]?.[10] || finalAsset?.[5]?.[0]?.[10] || null,
            media_id: activeMediaId,
            provider_model_id: activeModelId,
            project_id: projectId,
          };
        }
      } catch { }

      try {
        const pollResp = await callRpcInPage('jwpduf', [null, null, [[activeMediaId]]]);
        const pollUrl = findVideoUrl(pollResp);
        if (pollUrl) {
          try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
          return {
            ok: true,
            video_url: pollUrl,
            media_id: activeMediaId,
            provider_model_id: activeModelId,
            project_id: projectId,
          };
        }
        const asset = findMediaAsset(pollResp);
        const status = asset?.[5]?.[8]?.[0] ?? asset?.[5]?.[0]?.[8]?.[0];
        if (status === 3) {
          const finalAsset = await callRpcInPage('as29s', [activeMediaId]);
          const asUrl = finalAsset?.[7]?.[0]?.[8] || finalAsset?.[5]?.[2]?.[0]?.[8] || findVideoUrl(finalAsset);
          if (asUrl) {
            try { (typeof window !== 'undefined' ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null; } catch { }
            return {
              ok: true,
              video_url: asUrl,
              image_url: finalAsset?.[5]?.[10] || finalAsset?.[5]?.[0]?.[10] || null,
              media_id: activeMediaId,
              provider_model_id: activeModelId,
              project_id: projectId,
            };
          }
        }
        if (status !== 1 && status !== 2 && status !== 3 && status !== undefined && status !== null) {
          return {
            ok: false,
            terminal_error: true,
            error: `Flow render ended with status ${status} (media_id=${activeMediaId})`,
          };
        }
      } catch { }
    }

    // 2. Quét các thẻ video và resource entries trên DOM
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
    if (activeMediaId) {
      uniqueCandidates.sort((a, b) => {
        const aMatch = a.includes(activeMediaId) ? -1 : 0;
        const bMatch = b.includes(activeMediaId) ? -1 : 0;
        return aMatch - bMatch;
      });
    }

    for (const candidate of uniqueCandidates) {
      if (!isVideoCandidate(candidate)) continue;
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
            media_id: activeMediaId || null,
            provider_model_id: activeModelId,
            project_id: projectId,
          };
        }
        try { await probe.body?.cancel(); } catch { }
      } catch { }
    }

    const isGenerating = Boolean(
      document.querySelector('[role="progressbar"], [aria-label*="generating" i], [aria-label*="creating" i], .generating, [data-is-generating="true"]') ||
      activeMediaId
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
