import { bridgeRequest } from '../../bridge/client.js';
import { ensureHarvestCfg, fetchBridgeSecret, syncRemoteConfig } from '../../bridge/config.js';
import { pushCredentialsBatch } from '../../bridge/responses.js';
import { POLL_INTERVAL_MS } from '../../config/defaults.js';
import { getExtFp, restoreState, saveState } from '../../platform/storage.js';
import { warmUpRecaptcha } from '../../providers/google-flow/recaptcha-probe.js';
import { harvestAndPushAll } from '../../providers/google-flow/credentials.js';
import { findLabsTab } from '../../providers/google-flow/tabs.js';
import { sleep } from '../../shared/time.js';
import { processCaptchaRequest } from '../jobs/dispatch.js';
import { startHeartbeatTimer } from './heartbeat.js';
import { logActivity } from './log.js';
import { runtime } from './state.js';

export async function startPolling() {
  if (runtime.polling) return;
  runtime.polling = true;
  logActivity('info', 'Polling started');

  await getExtFp();
  await restoreState();
  await fetchBridgeSecret();
  await syncRemoteConfig();
  ensureHarvestCfg();

  const tabId = await findLabsTab();
  if (tabId) {
    await warmUpRecaptcha(tabId);
    await harvestAndPushAll();
  }

  startHeartbeatTimer();
  if (runtime.harvestedCookie && runtime.harvestedToken) {
    await pushCredentialsBatch(Object.values(runtime.harvestedAccounts));
  }

  let tick = 0;
  while (runtime.polling) {
    if (runtime.imageUiBusy || runtime.videoUiBusy) { await sleep(POLL_INTERVAL_MS); continue; }
    // Re-sync remote config mỗi 5 ticks nếu chỉ có fallback
    if (runtime.cfgIsFallback && tick % 5 === 0) {
      if (!runtime.bridgeSecret) await fetchBridgeSecret();
      await syncRemoteConfig();
    }
    tick++;

    try {
      const resp = await bridgeRequest('nextJob', {
        headers: { 'X-Bridge-Key': runtime.bridgeSecret || '', 'X-Ext-FP': runtime.extFp || '' },
        signal: AbortSignal.timeout(6_000),
      });

      if (resp.status === 403) {
        // Secret bị từ chối → reset + re-handshake
        runtime.bridgeSecret = null;
        runtime.harvestCfg = null;
        runtime.cfgVersion = null;
        if (runtime.connected) { runtime.connected = false; saveState(); }
        await chrome.storage.local.remove('_vf_bridgeSecret');
        logActivity('warn', 'Secret rejected (403). Re-handshaking...');
        await fetchBridgeSecret();
        await syncRemoteConfig();
        const tid = await findLabsTab();
        if (tid) await harvestAndPushAll();
        else if (runtime.harvestedCookie && runtime.harvestedToken) {
          await pushCredentialsBatch(Object.values(runtime.harvestedAccounts));
        }

      } else if (resp.status === 200) {
        // Có yêu cầu captcha
        if (!runtime.connected) { runtime.connected = true; saveState(); }
        const request = await resp.json();
        if (request?.reload) {
          logActivity('info', 'Remote reload requested by bridge');
          chrome.runtime.reload();
          return;
        }
        if (request?.request_id) {
          await processCaptchaRequest(request);
          // Khoảng trễ an toàn 2s giữa các request captcha
          await sleep(2_000);
        }

      } else if (resp.status === 204) {
        // Không có yêu cầu (idle)
        if (!runtime.connected) { runtime.connected = true; saveState(); }

      } else {
        if (runtime.connected) { runtime.connected = false; saveState(); }
      }
    } catch {
      if (runtime.connected) { runtime.connected = false; saveState(); }
    }

    await sleep(POLL_INTERVAL_MS);
  }
}
