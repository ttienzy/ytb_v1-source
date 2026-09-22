import { bridgeRequest, authHeaders } from '../../bridge/client.js';
import { fetchBridgeSecret } from '../../bridge/config.js';
import { HEARTBEAT_MS } from '../../config/defaults.js';
import { getExtFp } from '../../platform/storage.js';
import { findAllLabsTabs } from '../../providers/google-flow/tabs.js';
import { logActivity } from './log.js';
import { runtime } from './state.js';

export async function sendHeartbeat() {
  try {
    if (!runtime.bridgeSecret) await fetchBridgeSecret();
    if (!runtime.extFp) await getExtFp();
    if (!runtime.bridgeSecret || !runtime.extFp) return;
    const tabs = await findAllLabsTabs();
    const manifest = chrome.runtime.getManifest();
    await bridgeRequest('heartbeat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        ext_fp: runtime.extFp,
        version: manifest.version || '?',
        tab_count: tabs.length,
        tabs: tabs.map((t) => ({ id: t.id, url: t.url })),
        user_agent: navigator.userAgent.slice(0, 120),
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    logActivity('warn', `heartbeat: ${e.message}`);
  }
}

export function startHeartbeatTimer() {
  stopHeartbeatTimer();
  try { chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 }); } catch { }
  runtime.heartbeatTimer = setInterval(() => sendHeartbeat(), HEARTBEAT_MS);
  sendHeartbeat();
}

export function stopHeartbeatTimer() {
  if (runtime.heartbeatTimer) { clearInterval(runtime.heartbeatTimer); runtime.heartbeatTimer = null; }
  try { chrome.alarms.clear('heartbeat'); } catch { }
}
