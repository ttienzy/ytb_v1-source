import { logActivity } from '../../background/runtime/log.js';

// Chạy trong trang Flow (serializable, không dùng biến ngoài).
// Flow có thể tự hủy request tạo video (net::ERR_ABORTED) trong khi server vẫn tạo video đó.
// Zzl0ze là RPC Flow dùng để liệt kê media của project; mỗi bản ghi có mediaId, thời điểm tạo và prompt.
export async function findCreatedVideoInPage(projectId, prompt, submittedAtMs) {
  try {
    if (location.hostname !== 'flow.google.com' || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== projectId) {
      return { terminal: true, error: 'Flow tab changed project.' };
    }
    const wiz = window.WIZ_global_data || {};
    if (!wiz.SNlM0e || !wiz.FdrFJe || !wiz.cfb2h) return { pending: true };
    const rpc = 'Zzl0ze';
    const query = new URLSearchParams({ rpcids: rpc, 'source-path': `/project/${projectId}`, bl: String(wiz.cfb2h), 'f.sid': String(wiz.FdrFJe), rt: 'c', _reqid: String(Date.now() % 10000000) });
    const form = new URLSearchParams({ 'f.req': JSON.stringify([[[rpc, JSON.stringify([`projects/${projectId}`, null, null, null, [1]]), null, 'generic']]]), at: wiz.SNlM0e });
    const res = await fetch(`${location.origin}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' },
      body: form,
      signal: AbortSignal.timeout(12000),
    });
    if (!res.ok) return { pending: true };

    // Bản ghi dùng giờ server: quy đổi mốc bấm tạo theo đồng hồ server để không phụ thuộc giờ máy.
    const serverMs = Date.parse(res.headers.get('date') || '');
    const skewMs = Number.isFinite(serverMs) ? serverMs - Date.now() : 0;
    const cutoffSec = (submittedAtMs + skewMs) / 1000 - 10;

    const unwrap = (node) => {
      if (!Array.isArray(node)) return null;
      if (node[0] === 'wrb.fr' && node[1] === rpc && typeof node[2] === 'string') return JSON.parse(node[2]);
      for (const child of node) {
        const found = unwrap(child);
        if (found) return found;
      }
      return null;
    };
    let payload = null;
    for (const line of (await res.text()).split(/\r?\n/)) {
      if (!line.trim().startsWith('[')) continue;
      try { payload = unwrap(JSON.parse(line)); } catch { continue; }
      if (payload) break;
    }
    if (!payload) return { pending: true };

    const clean = (value) => (typeof value === 'string' ? value.replace(/\s+/gu, ' ').trim() : '');
    const target = clean(prompt);
    const deepSome = (node, test) => (Array.isArray(node) ? node.some((child) => deepSome(child, test)) : test(node));
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const matches = new Map();
    const walk = (node) => {
      if (!Array.isArray(node)) return;
      const created = node[5]?.[0]?.[0];
      if (uuid.test(String(node[0])) && node[1] === projectId && typeof created === 'number'
          && created >= cutoffSec
          && deepSome(node[5], (value) => clean(value) === target)
          && deepSome(node[5], (value) => typeof value === 'string' && /^(abra_|veo_|omni_flash|macaron_cookie_)/.test(value))) {
        matches.set(node[0], { mediaId: node[0], sceneId: node[2] });
        return;
      }
      node.forEach(walk);
    };
    walk(payload);
    if (matches.size > 1) {
      return { terminal: true, error: `Flow có ${matches.size} video mới cùng prompt; không đoán. Kiểm tra Flow trước khi thử lại.` };
    }
    return matches.size === 1 ? { found: [...matches.values()][0] } : { pending: true };
  } catch {
    return { pending: true };
  }
}

const FIRST_LOOKUP_DELAY_MS = 4_000;
const LOOKUP_INTERVAL_MS = 6_000;
const MAX_LOOKUPS = 8; // Giới hạn số RPC gửi thêm: không gửi dồn dập lên Flow.

// Trả về hàm gọi lặp được: null khi chưa thấy, {mediaId, sceneId} khi thấy, throw khi phải dừng.
export function createLostGenerationFinder(tabId, request, submittedAtMs) {
  let nextAt = 0;
  let lookups = 0;
  let busy = false;
  return async () => {
    if (!nextAt) nextAt = Date.now() + FIRST_LOOKUP_DELAY_MS; // tính từ lúc phát hiện mất response
    if (busy || Date.now() < nextAt || lookups >= MAX_LOOKUPS) return null;
    busy = true;
    try {
      lookups += 1;
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: findCreatedVideoInPage,
        args: [request.project_id, request.prompt, submittedAtMs],
      });
      const value = injected?.[0]?.result;
      if (value?.terminal) throw new Error(value.error);
      if (value?.found) {
        logActivity('info', `Tìm lại được video sau khi Flow hủy request: media=${value.found.mediaId} (lần tra ${lookups})`);
        return value.found;
      }
      return null;
    } finally {
      nextAt = Date.now() + LOOKUP_INTERVAL_MS;
      busy = false;
    }
  };
}
