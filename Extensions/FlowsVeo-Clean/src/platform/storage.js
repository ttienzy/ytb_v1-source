import { logActivity } from '../background/runtime/log.js';
import { runtime } from '../background/runtime/state.js';
import { setBridgePort } from '../bridge/client.js';

export async function getExtFp() {
  if (runtime.extFp) return runtime.extFp;
  try {
    const data = await chrome.storage.local.get(['_vf_extInstanceFp', '_vf_extFp']);
    if (data._vf_extInstanceFp || data._vf_extFp) {
      runtime.extFp = data._vf_extInstanceFp || data._vf_extFp;
      return runtime.extFp;
    }
    runtime.extFp = (crypto.randomUUID && crypto.randomUUID()) || `ext-${Date.now()}-${Math.random().toString(36).slice(-8)}`;
    await chrome.storage.local.set({ _vf_extInstanceFp: runtime.extFp, _vf_extFp: runtime.extFp });
  } catch {
    runtime.extFp = `ext-fallback-${Date.now()}`;
  }
  return runtime.extFp;
}

export async function saveState() {
  try {
    await chrome.storage.local.set({
      _vf_tokenCount: runtime.tokenCount,
      _vf_sessionCount: runtime.sessionCount,
      _vf_lastSuccess: runtime.lastSuccess,
      _vf_connected: runtime.connected,
      _vf_failStreak: runtime.failStreak,
      _vf_harvestedCookie: runtime.harvestedCookie,
      _vf_harvestedToken: runtime.harvestedToken,
      _vf_harvestedTokenExp: runtime.harvestedTokenExp,
      _vf_autoReloadEnabled: runtime.autoReloadEnabled,
      _vf_autoReloadMinutes: runtime.autoReloadMinutes,
      _vf_lastAutoReload: runtime.lastAutoReload,
      _vf_autoClearCacheEnabled: runtime.autoClearCacheEnabled,
      _vf_autoClearCacheSeconds: runtime.autoClearCacheSeconds,
      _vf_bridgePort: runtime.bridgePort,
    });
  } catch { }
}

export async function restoreState() {
  try {
    const d = await chrome.storage.local.get([
      '_vf_tokenCount', '_vf_sessionCount', '_vf_lastSuccess', '_vf_connected',
      '_vf_failStreak', '_vf_harvestedCookie', '_vf_harvestedToken',
      '_vf_harvestedTokenExp', '_vf_autoReloadEnabled', '_vf_autoReloadMinutes',
      '_vf_lastAutoReload', '_vf_autoClearCacheEnabled', '_vf_autoClearCacheSeconds', '_vf_bridgePort',
    ]);
    if (d._vf_bridgePort != null) setBridgePort(d._vf_bridgePort);
    if (d._vf_tokenCount != null) runtime.tokenCount = d._vf_tokenCount;
    if (d._vf_sessionCount != null) runtime.sessionCount = d._vf_sessionCount;
    if (d._vf_lastSuccess != null) runtime.lastSuccess = d._vf_lastSuccess;
    if (d._vf_connected != null) runtime.connected = d._vf_connected;
    if (d._vf_failStreak != null) runtime.failStreak = d._vf_failStreak;
    if (d._vf_harvestedCookie != null) runtime.harvestedCookie = d._vf_harvestedCookie;
    if (d._vf_harvestedToken != null) runtime.harvestedToken = d._vf_harvestedToken;
    if (d._vf_harvestedTokenExp != null) runtime.harvestedTokenExp = d._vf_harvestedTokenExp;
    if (d._vf_autoReloadEnabled != null) runtime.autoReloadEnabled = d._vf_autoReloadEnabled;
    if (d._vf_autoReloadMinutes != null) runtime.autoReloadMinutes = d._vf_autoReloadMinutes;
    if (d._vf_lastAutoReload != null) runtime.lastAutoReload = d._vf_lastAutoReload;
    if (d._vf_autoClearCacheEnabled != null) runtime.autoClearCacheEnabled = d._vf_autoClearCacheEnabled;
    // Nếu chưa từng lưu cache seconds → dùng mặc định 1s
    runtime.autoClearCacheSeconds = d._vf_autoClearCacheSeconds ?? 1;
    logActivity('info', `State restored — tokens:${runtime.tokenCount} connected:${runtime.connected}`);
  } catch (e) {
    logActivity('warn', `restoreState error: ${e.message}`);
  }
}
