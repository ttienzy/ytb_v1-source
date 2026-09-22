import { logActivity } from '../background/runtime/log.js';
import { runtime } from '../background/runtime/state.js';
import { CANDIDATE_PORTS, DEFAULT_HARVEST_CFG } from '../config/defaults.js';
import { bridgeRequest, setBridgePort } from './client.js';

export async function trySecretOnPort(p) {
  try {
    const resp = await bridgeRequest('secret', {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    }, p);
    if (resp.ok) {
      const json = await resp.json();
      if (json.secret) {
        if (runtime.bridgePort !== p) {
          setBridgePort(p);
          await chrome.storage.local.set({ _vf_bridgePort: p });
        }
        runtime.bridgeSecret = json.secret;
        await chrome.storage.local.set({ _vf_bridgeSecret: runtime.bridgeSecret });
        logActivity('info', `Bridge secret synced on port ${p}: ${runtime.bridgeSecret.slice(0, 8)}...`);
        return true;
      }
    }
  } catch { }
  return false;
}

export async function fetchBridgeSecret() {
  // First try currently configured port
  if (await trySecretOnPort(runtime.bridgePort)) return true;

  // Fallback: probe known candidate ports (e.g. if default port was blocked by OS)
  for (const p of CANDIDATE_PORTS) {
    if (p === runtime.bridgePort) continue;
    if (await trySecretOnPort(p)) return true;
  }

  // Fallback: cố đọc từ storage
  try {
    const d = await chrome.storage.local.get(['_vf_bridgeSecret']);
    if (d._vf_bridgeSecret) { runtime.bridgeSecret = d._vf_bridgeSecret; return true; }
  } catch { }
  return false;
}

export async function syncRemoteConfig() {
  if (!runtime.bridgeSecret) return false;
  try {
    const resp = await bridgeRequest('config', {
      method: 'POST',
      headers: { 'X-Bridge-Key': runtime.bridgeSecret },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) throw new Error(`Config HTTP ${resp.status}`);
    const json = await resp.json();
    if (typeof json.payload === 'string' && json.payload) {
      const decoded = JSON.parse(atob(json.payload));
      if (!decoded || typeof decoded !== 'object' || Array.isArray(decoded)
        || !decoded.c || typeof decoded.c !== 'object' || Array.isArray(decoded.c)
        || typeof decoded.c.m !== 'string' || !decoded.c.m.trim()
        || typeof decoded.c.s !== 'string' || !decoded.c.s.trim()) {
        throw new Error('Invalid config: missing CAPTCHA module configuration');
      }
      runtime.harvestCfg = decoded;
      ensureHarvestCfg();
      runtime.cfgVersion = json.v || '?';
      runtime.cfgIsFallback = false;
      logActivity('info', `Remote config loaded v${runtime.cfgVersion}`);
      return true;
    }
    throw new Error('Invalid config response: missing payload');
  } catch (e) {
    logActivity('warn', `syncRemoteConfig: ${e.message}`);
  }
  return false;
}

export function ensureHarvestCfg() {
  if (!runtime.harvestCfg) {
    runtime.harvestCfg = JSON.parse(JSON.stringify(DEFAULT_HARVEST_CFG));
    runtime.cfgIsFallback = true;
  }
  runtime.harvestCfg.t = runtime.harvestCfg.t || DEFAULT_HARVEST_CFG.t;
  runtime.harvestCfg.h = runtime.harvestCfg.h || DEFAULT_HARVEST_CFG.h;
  runtime.harvestCfg.c = runtime.harvestCfg.c || DEFAULT_HARVEST_CFG.c;
}
