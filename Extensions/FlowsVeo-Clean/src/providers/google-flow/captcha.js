import { warmUpRecaptcha } from './recaptcha-probe.js';
import { logActivity } from '../../background/runtime/log.js';
import { runtime } from '../../background/runtime/state.js';
import { ensureHarvestCfg } from '../../bridge/config.js';
import { sleep } from '../../shared/time.js';
import { findLabsTab, openLabsTab } from './tabs.js';



export async function checkRecaptchaReady(tabId) {
  const tid = tabId || await findLabsTab();
  if (!tid) return { available: false, error: 'Open a Flow project in Chrome' };
  const state = await warmUpRecaptcha(tid);
  return { available: state.available, error: state.error, keySource: state.keySource };
}

export async function solveRecaptcha(request, pinnedTabId = null) {
  ensureHarvestCfg();
  if (!runtime.harvestCfg.c) return { token: null, error: 'Captcha config not loaded' };

  // Tìm hoặc mở tab (ưu tiên đúng project của request)
  const targetPid = request?.target_project_id || request?.image_request?.project_id || request?.flow_request?.project_id || request?.project_id || null;
  let tabId = pinnedTabId ?? await findLabsTab(targetPid);
  const deadline = Date.now() + 15_000;
  while (!tabId && Date.now() < deadline) {
    tabId = await openLabsTab();
    if (!tabId) await sleep(2_000);
  }
  if (!tabId) return { token: null, error: 'No labs tab (15s timeout)' };

  // Kích hoạt active tab và window để trang có context người dùng hợp lệ
  try {
    await chrome.tabs.update(tabId, { active: true });
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (t?.windowId) {
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    }
  } catch { }

  const page = await warmUpRecaptcha(tabId);
  const siteKey = request.site_key || request.recaptcha_ent_key || page.siteKey || '6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV';
  logActivity('info', `Captcha preflight: tab=${tabId} module=${!!page.moduleReady} keySource=${page.keySource || 'none'}`);
  if (!page.moduleReady) return { token: null, error: page.error };

  // Trích xuất action chính xác cho Google Flow reCAPTCHA Enterprise:
  // - Image generation yêu cầu: "IMAGE_GENERATION"
  // - Video generation yêu cầu: "VIDEO_GENERATION"
  // Tuyệt đối không tự gán "submit" bừa bãi khi Flow yêu cầu action cụ thể.
  let action = '';
  if (request.captcha_action && typeof request.captcha_action === 'string') {
    action = request.captcha_action.trim();
  } else if (request.action && typeof request.action === 'string') {
    action = request.action.trim();
  } else if (runtime.harvestCfg.c?.da) {
    action = String(runtime.harvestCfg.c.da).trim();
  }

  logActivity('info', `solveRecaptcha: tab=${tabId} siteKey=${siteKey ? siteKey.slice(0, 10) + '...' : 'none'} action=${action ? `"${action}"` : 'none'}`);

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (cfg, siteKey, action) => {
        try {
          const module = window[cfg.m];
          if (!module || !module[cfg.s]) return { token: null, error: 'Module not ready' };

          const withTimeout = (promise, ms, message) => new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(message)), ms);
            Promise.resolve(promise).then(
              (value) => { clearTimeout(timer); resolve(value); },
              (error) => { clearTimeout(timer); reject(error); },
            );
          });
          await withTimeout(new Promise((r) => module[cfg.s].ready(r)), 5000, 'reCAPTCHA ready callback timed out');
          const executePromise = (action && action.trim())
            ? module[cfg.s].execute(siteKey, { action })
            : module[cfg.s].execute(siteKey);
          const token = await withTimeout(executePromise, 10000, 'reCAPTCHA execute timed out');
          return { token, error: null };
        } catch (e) {
          return { token: null, error: e.message || String(e) };
        }
      },
      args: [runtime.harvestCfg.c, siteKey, action],
    });
    const res = results?.[0]?.result;
    if (res?.token) {
      logActivity('info', `solveRecaptcha success: tokenLen=${res.token.length}`);
    } else if (res?.error) {
      logActivity('warn', `solveRecaptcha error: ${res.error}`);
    }
    if (res) return res;
    return { token: null, error: 'No script result' };
  } catch (e) {
    return { token: null, error: e.message };
  }
}
