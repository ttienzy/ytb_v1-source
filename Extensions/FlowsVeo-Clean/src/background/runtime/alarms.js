import { bridgeRequest } from '../../bridge/client.js';
import { fetchBridgeSecret, syncRemoteConfig } from '../../bridge/config.js';
import { pushCredentialsBatch } from '../../bridge/responses.js';
import { WATCHDOG_MINUTES } from '../../config/defaults.js';
import { getExtFp, saveState } from '../../platform/storage.js';
import { harvestAndPushAll } from '../../providers/google-flow/credentials.js';
import { findLabsTab } from '../../providers/google-flow/tabs.js';
import { pushVoiceCookies } from '../../providers/google-flow/voice.js';
import { processCaptchaRequest } from '../jobs/dispatch.js';
import { sendHeartbeat } from './heartbeat.js';
import { logActivity } from './log.js';
import { prepareCaptchaFresh } from './maintenance.js';
import { startPolling } from './polling.js';
import { runtime } from './state.js';

export function createWatchdogAlarm() {
  chrome.alarms.create('watchdog', { periodInMinutes: WATCHDOG_MINUTES });
}

export function registerAlarmEvents() {
  chrome.alarms.onAlarm.addListener(async (alarm) => {
    if (alarm.name === 'heartbeat') {
      try { await sendHeartbeat(); } catch { }
      return;
    }

    if (alarm.name === 'watchdog') {
      if (runtime.imageUiBusy || runtime.videoUiBusy) return;
      if (!runtime.polling) startPolling();
      if (!runtime.bridgeSecret) await fetchBridgeSecret();
      if (!runtime.harvestCfg || runtime.cfgIsFallback) await syncRemoteConfig();

      if (runtime.bridgeSecret && runtime.harvestCfg) {
        if (!runtime.extFp) await getExtFp();

        // Poll captcha backup
        try {
          const r = await bridgeRequest('nextJob', {
            headers: { 'X-Bridge-Key': runtime.bridgeSecret, 'X-Ext-FP': runtime.extFp || '' },
            signal: AbortSignal.timeout(5_000),
          });
          if (r.status === 200) {
            const req = await r.json();
            if (req?.request_id) {
              await processCaptchaRequest(req);
            }
          }
        } catch { }

        // Push voice cookies
        await pushVoiceCookies();

        // Kiểm tra refresh pending (bridge báo 403/429)
        try {
          const r = await bridgeRequest('pendingRefresh', {
            headers: { 'X-Bridge-Key': runtime.bridgeSecret },
            signal: AbortSignal.timeout(4_000),
          });
          if (r.status === 200) {
            const data = await r.json();
            const requests = data?.requests || [];
            if (requests.length > 0) {
              const needReload = requests.some((req) => req?.reason === 'need_reload');
              if (needReload) {
                logActivity('info', `Bridge reports 403/429 → reload tab (${requests.length})`);
                const tid = await findLabsTab();
                if (tid) await prepareCaptchaFresh(tid);
              } else {
                logActivity('info', `Refresh request from bridge (${requests.length} slot)`);
                await harvestAndPushAll();
              }
            }
          }
        } catch { }

        // Kiểm tra bridge có token chưa
        if (runtime.harvestedCookie && runtime.harvestedToken) {
          try {
            const health = await bridgeRequest('health', { signal: AbortSignal.timeout(3_000) });
            if (health.ok) {
              const tr = await bridgeRequest('token', {
                headers: { 'X-Bridge-Key': runtime.bridgeSecret || '' },
                signal: AbortSignal.timeout(3_000),
              });
              if (tr.status === 403) {
                runtime.bridgeSecret = null; runtime.harvestCfg = null;
                await chrome.storage.local.remove('_vf_bridgeSecret');
                if (runtime.connected) { runtime.connected = false; saveState(); }
              } else if (tr.ok) {
                const data = await tr.json();
                if (!data.access_token) await pushCredentialsBatch(Object.values(runtime.harvestedAccounts));
              }
            }
          } catch { }
        }
      }
    }
  });
}
