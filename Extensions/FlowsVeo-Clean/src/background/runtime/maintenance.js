import { bridgeRequest, authHeaders } from '../../bridge/client.js';
import { ensureHarvestCfg } from '../../bridge/config.js';
import { saveState } from '../../platform/storage.js';
import { warmUpRecaptcha } from '../../providers/google-flow/recaptcha-probe.js';
import { harvestAndPushAll } from '../../providers/google-flow/credentials.js';
import { findLabsTab, openLabsTab } from '../../providers/google-flow/tabs.js';
import { sleep } from '../../shared/time.js';
import { logActivity } from './log.js';
import { runtime } from './state.js';

export async function clearLabsCache() {
  if (runtime.activeGenerationCount > 0) {
    logActivity('info', 'Skipping clearLabsCache: generation is active');
    return false;
  }
  try {
    await chrome.browsingData.remove(
      { origins: ['https://labs.google'], since: 0 },
      { cacheStorage: true, indexedDB: true, localStorage: true, serviceWorkers: true, fileSystems: true },
    );
    logActivity('info', 'Labs cache cleared (origin-scoped)');
    return true;
  } catch (e) {
    logActivity('warn', `clearLabsCache: ${e.message}`);
    return false;
  }
}

export async function clearTrackingCookiesAndRefresh() {
  if (runtime.activeGenerationCount > 0) return;
  if (!runtime.autoReloadEnabled) return;
  ensureHarvestCfg();
  if (runtime.autoClearCacheEnabled) await clearLabsCache();

  const keepPrefixes = runtime.harvestCfg.h?.ap || [];
  try {
    const cookies = await chrome.cookies.getAll({ domain: runtime.harvestCfg.h.d });
    for (const c of cookies) {
      if (keepPrefixes.some((p) => c.name.startsWith(p))) continue;
      const url = `https://${c.domain.replace(/^\./, '')}${c.path}`;
      await chrome.cookies.remove({ url, name: c.name });
    }
    const tabId = await findLabsTab();
    if (tabId) await chrome.tabs.reload(tabId);
  } catch { }
}

export async function refreshLabsTab() {
  if (runtime.activeGenerationCount > 0) return;
  if (!runtime.autoReloadEnabled) return;
  const tabId = await findLabsTab();
  if (!tabId) return;
  try {
    await chrome.tabs.reload(tabId);
    await sleep(3_000);
    await warmUpRecaptcha(tabId);
  } catch { }
}

export function startAutoClearCacheTimer() {
  stopAutoClearCacheTimer();
  if (!runtime.autoClearCacheEnabled || runtime.autoClearCacheSeconds <= 0) return;
  runtime.autoClearCacheTimer = setInterval(() => clearLabsCache(), runtime.autoClearCacheSeconds * 1_000);
}

export function stopAutoClearCacheTimer() {
  if (runtime.autoClearCacheTimer) { clearInterval(runtime.autoClearCacheTimer); runtime.autoClearCacheTimer = null; }
}

export async function doAutoReloadCycle() {
  if (runtime.activeGenerationCount > 0) {
    logActivity('info', 'Skipping autoReload: generation is active');
    return;
  }
  if (!runtime.autoReloadEnabled) return;
  runtime.lastAutoReload = Date.now();
  await saveState();
  let tabId = await findLabsTab();
  if (tabId) {
    try {
      await chrome.tabs.reload(tabId);
      await sleep(5_000);
      await warmUpRecaptcha(tabId);
      await harvestAndPushAll();
    } catch { }
  } else {
    tabId = await openLabsTab();
    if (tabId) await harvestAndPushAll();
  }
}

export function startAutoReloadTimer() {
  stopAutoReloadTimer();
  if (!runtime.autoReloadEnabled || runtime.autoReloadMinutes <= 0) return;
  runtime.autoReloadTimer = setInterval(doAutoReloadCycle, runtime.autoReloadMinutes * 60 * 1_000);
}

export function stopAutoReloadTimer() {
  if (runtime.autoReloadTimer) { clearInterval(runtime.autoReloadTimer); runtime.autoReloadTimer = null; }
}

export async function prepareCaptchaFresh(tabId) {
  if (runtime.captchaFreshInProgress) { try { await runtime.captchaFreshInProgress; } catch { } return false; }
  const now = Date.now();
  if (now < runtime.captchaFreshLockUntil) return false;
  runtime.captchaFreshLockUntil = now + 30_000;

  async function notifyBusy(busy, timeoutSec = 20) {
    if (!runtime.bridgeSecret) return;
    try {
      await bridgeRequest('busy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ busy: !!busy, timeout_sec: timeoutSec }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch { }
  }

  runtime.captchaFreshInProgress = (async () => {
    await notifyBusy(true, 20);
    try {
      await clearLabsCache();
      await chrome.tabs.reload(tabId, { bypassCache: true });
      await new Promise((resolve) => {
        const listener = (id, info) => {
          if (id === tabId && info.status === 'complete') {
            chrome.tabs.onUpdated.removeListener(listener);
            setTimeout(() => resolve(true), 1_000);
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
        setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(false); }, 10_000);
      });
      logActivity('info', 'Captcha flow: cache cleared + tab reloaded');
      return true;
    } catch (e) {
      logActivity('warn', `prepareCaptchaFresh fail: ${e.message}`);
      return false;
    } finally {
      await notifyBusy(false, 0);
    }
  })();

  try { return await runtime.captchaFreshInProgress; } finally { runtime.captchaFreshInProgress = null; }
}
