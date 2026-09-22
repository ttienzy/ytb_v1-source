import { onCaptchaSuccess } from '../background/jobs/dispatch.js';
import { logActivity } from '../background/runtime/log.js';
import { clearLabsCache, clearTrackingCookiesAndRefresh, startAutoClearCacheTimer, startAutoReloadTimer, stopAutoClearCacheTimer, stopAutoReloadTimer } from '../background/runtime/maintenance.js';
import { startPolling } from '../background/runtime/polling.js';
import { runtime } from '../background/runtime/state.js';
import { bridgeRequest, setBridgePort } from '../bridge/client.js';
import { fetchBridgeSecret, syncRemoteConfig } from '../bridge/config.js';
import { pushCredentialsBatch } from '../bridge/responses.js';
import { GOOGLE_VOICE_COOKIES } from '../config/defaults.js';
import { checkRecaptchaReady, solveRecaptcha } from '../providers/google-flow/captcha.js';
import { harvestAndPushAll } from '../providers/google-flow/credentials.js';
import { findLabsTab, openLabsTab } from '../providers/google-flow/tabs.js';
import { sleep } from '../shared/time.js';
import { saveState } from './storage.js';

export function registerMessages() {
  chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
    if (!msg?.type) return false;

    // ── Credits Updated from Content Script ──
    if (msg.type === 'CREDITS_UPDATED') {
      const cred = parseInt(msg.credits ?? -1);
      const mail = msg.email;
      if (cred >= 0) {
        logActivity('info', `[Credits] content script detected: ${mail || 'unknown'} -> ${cred}`);
        chrome.storage.local.set({
          _vf_last_credits: cred,
          ...(mail ? { [`_vf_cred_${mail}`]: cred } : {}),
        });
        let updated = false;
        if (mail && runtime.harvestedAccounts[mail]) {
          runtime.harvestedAccounts[mail].credit = cred;
          updated = true;
        } else {
          for (const k of Object.keys(runtime.harvestedAccounts)) {
            runtime.harvestedAccounts[k].credit = cred;
            updated = true;
          }
        }
        if (updated) {
          pushCredentialsBatch(Object.values(runtime.harvestedAccounts));
        } else {
          harvestAndPushAll();
        }
      }
      reply({ ok: true });
      return true;
    }

    // ── Stats ──
    if (msg.type === 'GET_STATS') {
      if (!runtime.polling) startPolling();
      reply({
        tokenCount: runtime.tokenCount,
        sessionCount: runtime.sessionCount,
        lastSuccess: runtime.lastSuccess,
        connected: runtime.connected,
        polling: runtime.polling,
        autoReloadEnabled: runtime.autoReloadEnabled,
        autoReloadMinutes: runtime.autoReloadMinutes,
        lastAutoReload: runtime.lastAutoReload,
        autoClearCacheEnabled: runtime.autoClearCacheEnabled,
        autoClearCacheSeconds: runtime.autoClearCacheSeconds,
        hasCredentials: !!runtime.harvestedToken,
        coreLoaded: !!runtime.harvestCfg && !runtime.cfgIsFallback,
        tokenPreview: runtime.harvestedToken ? runtime.harvestedToken.slice(0, 8) + '...' : null,
        accountsCount: Object.keys(runtime.harvestedAccounts).length,
        bridgePort: runtime.bridgePort,
      });
      return true;
    }

    // ── Accounts ──
    if (msg.type === 'GET_ACCOUNTS') {
      const accounts = Object.values(runtime.harvestedAccounts).map((a) => ({
        email: a.email,
        tier: a.tier,
        credit: a.credit,
        tabId: a.tabId,
        incognito: a.incognito,
        expiry: a.expiry,
      }));
      reply({ accounts });
      return true;
    }

    // ── Health check ──
    if (msg.type === 'CHECK_STATUS') {
      if (!runtime.polling) startPolling();
      (async () => {
        // Bridge
        let bridge = { ok: false, text: 'Not running' };
        try {
          const r = await bridgeRequest('health', { signal: AbortSignal.timeout(3_000) });
          bridge = r.ok ? { ok: true, text: 'Connected' } : { ok: false, text: `Error (${r.status})` };
        } catch { }

        // Tab
        const tid = await findLabsTab();
        const tab = tid ? { ok: true, text: 'Active' } : { ok: false, text: 'No tab' };

        // Login (SID cookie)
        let login = { ok: false, text: 'Unknown' };
        try {
          const sids = await chrome.cookies.getAll({ domain: '.google.com', name: 'SID' });
          login = sids.length > 0 ? { ok: true, text: 'Logged in' } : { ok: false, text: 'Not logged in' };
        } catch { login = { ok: false, text: 'Failed' }; }

        // Captcha ready
        let captcha = { ok: false, text: 'Not ready' };
        if (tid) {
          const res = await checkRecaptchaReady(tid);
          captcha = res.available ? { ok: true, text: 'Ready' } : { ok: false, text: res.error };
        }

        const token = { ok: !!runtime.harvestedToken, text: runtime.harvestedToken ? 'Active' : 'Inactive' };
        const core = { ok: !!runtime.harvestCfg && !runtime.cfgIsFallback, text: runtime.harvestCfg ? (runtime.cfgIsFallback ? 'Fallback' : 'OK') : 'No' };

        reply({ bridge, tab, login, captcha, token, core });
      })();
      return true;
    }

    // ── Test captcha ──
    if (msg.type === 'TEST_CAPTCHA') {
      (async () => {
        const result = await solveRecaptcha({ site_key: msg.site_key || '', action: msg.action || '' });
        if (result.token) onCaptchaSuccess();
        reply(result);
      })();
      return true;
    }

    // ── Refresh tab ──
    if (msg.type === 'REFRESH_TAB') {
      (async () => { await clearTrackingCookiesAndRefresh(); reply({ ok: true }); })();
      return true;
    }

    // ── Open labs ──
    if (msg.type === 'OPEN_LABS') {
      (async () => {
        let tid = await findLabsTab();
        if (tid) await chrome.tabs.update(tid, { active: true });
        else tid = await openLabsTab();
        if (tid) { await sleep(1_500); await harvestAndPushAll(); }
        reply({ ok: !!tid });
      })();
      return true;
    }

    // ── Harvest now ──
    if (msg.type === 'HARVEST_NOW') {
      (async () => {
        await harvestAndPushAll();
        reply({ ok: !!runtime.harvestedToken, has_token: !!runtime.harvestedToken, expiry: runtime.harvestedTokenExp });
      })();
      return true;
    }

    // ── Force push ──
    if (msg.type === 'FORCE_PUSH') {
      (async () => {
        const ok = await harvestAndPushAll();
        reply({ ok, has_token: !!runtime.harvestedToken, token_preview: runtime.harvestedToken?.slice(0, 8) + '...' });
      })();
      return true;
    }

    // ── Get credentials ──
    if (msg.type === 'GET_CREDENTIALS') {
      reply({ cookie: runtime.harvestedCookie, access_token: runtime.harvestedToken, expiry: runtime.harvestedTokenExp, has_credentials: !!runtime.harvestedToken });
      return true;
    }

    // ── Auto reload settings ──
    if (msg.type === 'SET_AUTO_RELOAD') {
      runtime.autoReloadEnabled = !!msg.enabled;
      if (msg.minutes != null && msg.minutes > 0) runtime.autoReloadMinutes = msg.minutes;
      saveState();
      if (runtime.autoReloadEnabled) startAutoReloadTimer();
      else stopAutoReloadTimer();
      reply({ ok: true, enabled: runtime.autoReloadEnabled, minutes: runtime.autoReloadMinutes });
      return true;
    }

    // ── Auto clear cache settings ──
    if (msg.type === 'SET_AUTO_CLEAR_CACHE') {
      runtime.autoClearCacheEnabled = !!msg.enabled;
      if (msg.seconds != null && msg.seconds > 0) runtime.autoClearCacheSeconds = msg.seconds;
      saveState();
      if (runtime.autoClearCacheEnabled) startAutoClearCacheTimer();
      else stopAutoClearCacheTimer();
      reply({ ok: true, enabled: runtime.autoClearCacheEnabled, seconds: runtime.autoClearCacheSeconds });
      return true;
    }

    // ── Clear cache now ──
    if (msg.type === 'CLEAR_CACHE_NOW') {
      (async () => { const ok = await clearLabsCache(); reply({ ok }); })();
      return true;
    }

    // ── Bridge port ──
    if (msg.type === 'SET_BRIDGE_PORT') {
      const ok = setBridgePort(msg.port);
      if (!ok) { reply({ ok: false, port: runtime.bridgePort, error: 'Invalid port' }); return true; }
      runtime.bridgeSecret = null; runtime.harvestCfg = null; runtime.cfgIsFallback = true; runtime.cfgVersion = null; runtime.connected = false;
      (async () => {
        try { await chrome.storage.local.remove('_vf_bridgeSecret'); } catch { }
        await saveState();
        await fetchBridgeSecret();
        await syncRemoteConfig();
        logActivity('info', `Bridge port changed → ${runtime.bridgePort}`);
        reply({ ok: true, port: runtime.bridgePort });
      })();
      return true;
    }
    if (msg.type === 'GET_BRIDGE_PORT') {
      reply({ port: runtime.bridgePort });
      return true;
    }

    // ── Voice cookies ──
    if (msg.type === 'GET_COOKIE_VOICE' || msg.type === 'SYNC_COOKIE_VOICE') {
      (async () => {
        try {
          const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
          const storeId = activeTabs[0]?.cookieStoreId || (activeTabs[0]?.incognito ? '1' : '0');
          const all = await chrome.cookies.getAll({ domain: '.google.com', storeId });
          const cookieMap = {};
          for (const c of all) {
            if (GOOGLE_VOICE_COOKIES.includes(c.name)) cookieMap[c.name] = c.value;
          }
          if (!Object.keys(cookieMap).length) {
            reply({ ok: false, error: 'No voice cookies found' });
            return;
          }
          let email = 'Unknown';
          if (cookieMap.SAPISID) {
            for (const [mail, acc] of Object.entries(runtime.harvestedAccounts)) {
              if (acc.cookie?.includes(`SAPISID=${cookieMap.SAPISID}`)) { email = mail; break; }
            }
          }
          if (runtime.bridgeSecret) {
            await bridgeRequest('voiceCookies', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': runtime.bridgeSecret },
              body: JSON.stringify({ cookies: cookieMap, email, ext_fp: runtime.extFp }),
            });
          }
          const cookieStr = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join('; ');
          reply({ ok: true, cookie: cookieStr, count: Object.keys(cookieMap).length });
        } catch (e) {
          reply({ ok: false, error: e.message });
        }
      })();
      return true;
    }

    // ── Activity log ──
    if (msg.type === 'GET_ACTIVITY_LOG') {
      reply({ entries: runtime.activityLog.slice(-50) });
      return false;
    }

    return false;
  });
}
