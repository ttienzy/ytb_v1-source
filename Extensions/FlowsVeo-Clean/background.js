/**
 * background.js — FlowsVeo Clean Service Worker
 *
 * Nhiệm vụ:
 *  1. Poll bridge server mỗi 2.5s → nhận yêu cầu giải reCAPTCHA → trả token
 *  2. Thu thập cookie labs.google + access_token từ tab đang mở → push lên bridge
 *  3. Heartbeat + watchdog alarm để giữ service worker sống
 *  4. Auto reload tab + auto clear cache labs.google
 */

// ─────────────────────────────────────────────────────────────────────────────
// 1. CẤU HÌNH MẶC ĐỊNH
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_BRIDGE_PORT = 60526;
const POLL_INTERVAL_MS = 2500;   // ms giữa các lần poll captcha/request
const FAIL_THRESHOLD = 5;      // số lần thất bại captcha liên tiếp trước khi reload
const TOKENS_PER_SESSION = 8;      // sau N token → xóa tracking cookies + refresh
const HEARTBEAT_MS = 30_000; // ms giữa các heartbeat
const WATCHDOG_MINUTES = 0.4;    // 24s mỗi vòng watchdog alarm
const ACTIVITY_LOG_MAX = 50;     // số dòng log giữ trong bộ nhớ

const DEFAULT_HARVEST_CFG = {
  t: {
    p: ['https://labs.google/*', 'https://flow.google.com/*'],
    o: 'https://flow.google.com/',
  },
  h: {
    d: 'labs.google',
    cn: '__Secure-next-auth.session-token',
    u: 'https://labs.google/fx/api/auth/session',
    tf: ['access_token'],
    ti: 'https://oauth2.googleapis.com/tokeninfo',
    cu: 'https://aisandbox-pa.googleapis.com/v1/credits?key=AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY',
    co: 'https://labs.google',
    ap: [],  // cookie name prefixes giữ lại khi xóa tracking cookies
  },
  c: {
    m: 'grecaptcha',
    s: 'enterprise',
    da: 'submit',
    g: '___grecaptcha_cfg',
    k: 'clients',
    p: 'sitekey',
    q: 'script[src*="enterprise.js"]',
  },
};

const GOOGLE_VOICE_COOKIES = [
  'SAPISID', '__Secure-1PAPISID', 'SID', 'HSID', 'SSID',
  '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PSIDTS', '__Secure-3PSIDTS',
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. TRẠNG THÁI RUNTIME
// ─────────────────────────────────────────────────────────────────────────────

let bridgePort = DEFAULT_BRIDGE_PORT;
let bridgeUrl = `http://127.0.0.1:${bridgePort}`;
let bridgeSecret = null;    // X-Bridge-Key nhận từ bridge server
let extFp = null;    // Extension fingerprint UUID (persistent)
let harvestCfg = null;    // Cấu hình harvest (từ bridge hoặc mặc định)
let cfgVersion = null;
let cfgIsFallback = true;

let polling = false;
let connected = false;
let tokenCount = 0;
let sessionCount = 0;
let failStreak = 0;
let lastSuccess = null;
let harvestedCookie = null;
let harvestedToken = null;
let harvestedTokenExp = 0;
let harvestedAccounts = {}; // Map<email, AccountData>
let lastHarvestState = null;

let autoReloadEnabled = true;
let autoReloadMinutes = 5;
let autoReloadTimer = null;
let lastAutoReload = null;

let autoClearCacheEnabled = true;
let autoClearCacheSeconds = 1;
let autoClearCacheTimer = null;

let heartbeatTimer = null;

/** Ring-buffer log */
const activityLog = [];
function logActivity(level, msg) {
  const entry = {
    time: new Date().toLocaleTimeString('en-GB', { hour12: false }),
    level: level || 'info',
    msg: String(msg).slice(0, 500),
  };
  activityLog.push(entry);
  if (activityLog.length > ACTIVITY_LOG_MAX) activityLog.shift();
  console.log(`[FlowsVeo][${level}] ${msg}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. HELPERS
// ─────────────────────────────────────────────────────────────────────────────

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authHeaders(extra = {}) {
  return {
    'Content-Type': 'application/json',
    'X-Bridge-Key': bridgeSecret || '',
    'X-Ext-FP': extFp || '',
    ...extra,
  };
}

function setBridgePort(port) {
  const p = parseInt(port);
  if (!p || p < 1 || p > 65535) return false;
  bridgePort = p;
  bridgeUrl = `http://127.0.0.1:${bridgePort}`;
  return true;
}

/** Phân loại tier tài khoản từ dữ liệu credits */
function classifyTier(creditData) {
  const tier = String(creditData.userPaygateTier || '').toUpperCase();
  const sku = String(creditData.sku || '').toUpperCase();
  const service = String(creditData.serviceTier || '').toUpperCase();
  const credits = parseInt(creditData.credits || 0);
  const subCred = parseInt(creditData.subscriptionCredits || -1);

  if (tier.includes('TIER_TWO') || sku.includes('TIER2')) return 'ULTRA';
  if (tier.includes('TIER_ONE') || sku.includes('TIER1')) return 'PRO';
  if (tier.includes('NOT_PAID') || sku.includes('FREE')) return 'FREE';
  if (service.includes('ADVANCED')) return 'ULTRA';
  if (service.includes('INTERMEDIATE') || service.includes('PRO')) return 'PRO';
  if (service.includes('ENTRY') || service.includes('STANDARD')) return 'FREE';
  if (subCred > 0 || credits > 0) return 'PRO';
  return 'FREE';
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. EXTENSION FINGERPRINT & STORAGE
// ─────────────────────────────────────────────────────────────────────────────

async function getExtFp() {
  if (extFp) return extFp;
  try {
    const data = await chrome.storage.local.get(['_vf_extInstanceFp', '_vf_extFp']);
    if (data._vf_extInstanceFp || data._vf_extFp) {
      extFp = data._vf_extInstanceFp || data._vf_extFp;
      return extFp;
    }
    extFp = (crypto.randomUUID && crypto.randomUUID()) || `ext-${Date.now()}-${Math.random().toString(36).slice(-8)}`;
    await chrome.storage.local.set({ _vf_extInstanceFp: extFp, _vf_extFp: extFp });
  } catch {
    extFp = `ext-fallback-${Date.now()}`;
  }
  return extFp;
}

async function saveState() {
  try {
    await chrome.storage.local.set({
      _vf_tokenCount: tokenCount,
      _vf_sessionCount: sessionCount,
      _vf_lastSuccess: lastSuccess,
      _vf_connected: connected,
      _vf_failStreak: failStreak,
      _vf_harvestedCookie: harvestedCookie,
      _vf_harvestedToken: harvestedToken,
      _vf_harvestedTokenExp: harvestedTokenExp,
      _vf_autoReloadEnabled: autoReloadEnabled,
      _vf_autoReloadMinutes: autoReloadMinutes,
      _vf_lastAutoReload: lastAutoReload,
      _vf_autoClearCacheEnabled: autoClearCacheEnabled,
      _vf_autoClearCacheSeconds: autoClearCacheSeconds,
      _vf_bridgePort: bridgePort,
    });
  } catch { }
}

async function restoreState() {
  try {
    const d = await chrome.storage.local.get([
      '_vf_tokenCount', '_vf_sessionCount', '_vf_lastSuccess', '_vf_connected',
      '_vf_failStreak', '_vf_harvestedCookie', '_vf_harvestedToken',
      '_vf_harvestedTokenExp', '_vf_autoReloadEnabled', '_vf_autoReloadMinutes',
      '_vf_lastAutoReload', '_vf_autoClearCacheEnabled', '_vf_autoClearCacheSeconds', '_vf_bridgePort',
    ]);
    if (d._vf_bridgePort != null) setBridgePort(d._vf_bridgePort);
    if (d._vf_tokenCount != null) tokenCount = d._vf_tokenCount;
    if (d._vf_sessionCount != null) sessionCount = d._vf_sessionCount;
    if (d._vf_lastSuccess != null) lastSuccess = d._vf_lastSuccess;
    if (d._vf_connected != null) connected = d._vf_connected;
    if (d._vf_failStreak != null) failStreak = d._vf_failStreak;
    if (d._vf_harvestedCookie != null) harvestedCookie = d._vf_harvestedCookie;
    if (d._vf_harvestedToken != null) harvestedToken = d._vf_harvestedToken;
    if (d._vf_harvestedTokenExp != null) harvestedTokenExp = d._vf_harvestedTokenExp;
    if (d._vf_autoReloadEnabled != null) autoReloadEnabled = d._vf_autoReloadEnabled;
    if (d._vf_autoReloadMinutes != null) autoReloadMinutes = d._vf_autoReloadMinutes;
    if (d._vf_lastAutoReload != null) lastAutoReload = d._vf_lastAutoReload;
    if (d._vf_autoClearCacheEnabled != null) autoClearCacheEnabled = d._vf_autoClearCacheEnabled;
    // Nếu chưa từng lưu cache seconds → dùng mặc định 1s
    autoClearCacheSeconds = d._vf_autoClearCacheSeconds ?? 1;
    logActivity('info', `State restored — tokens:${tokenCount} connected:${connected}`);
  } catch (e) {
    logActivity('warn', `restoreState error: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. BRIDGE HANDSHAKE & CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const CANDIDATE_PORTS = [60526, 56526, 46526, 36526];

async function trySecretOnPort(p) {
  try {
    const resp = await fetch(`http://127.0.0.1:${p}/bridge/secret`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(2_000),
    });
    if (resp.ok) {
      const json = await resp.json();
      if (json.secret) {
        if (bridgePort !== p) {
          setBridgePort(p);
          await chrome.storage.local.set({ _vf_bridgePort: p });
        }
        bridgeSecret = json.secret;
        await chrome.storage.local.set({ _vf_bridgeSecret: bridgeSecret });
        logActivity('info', `Bridge secret synced on port ${p}: ${bridgeSecret.slice(0, 8)}...`);
        return true;
      }
    }
  } catch { }
  return false;
}

async function fetchBridgeSecret() {
  // First try currently configured port
  if (await trySecretOnPort(bridgePort)) return true;

  // Fallback: probe known candidate ports (e.g. if default port was blocked by OS)
  for (const p of CANDIDATE_PORTS) {
    if (p === bridgePort) continue;
    if (await trySecretOnPort(p)) return true;
  }

  // Fallback: cố đọc từ storage
  try {
    const d = await chrome.storage.local.get(['_vf_bridgeSecret']);
    if (d._vf_bridgeSecret) { bridgeSecret = d._vf_bridgeSecret; return true; }
  } catch { }
  return false;
}

async function syncRemoteConfig() {
  if (!bridgeSecret) return false;
  try {
    const resp = await fetch(`${bridgeUrl}/api/v1/config/init`, {
      method: 'POST',
      headers: { 'X-Bridge-Key': bridgeSecret },
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
      harvestCfg = decoded;
      ensureHarvestCfg();
      cfgVersion = json.v || '?';
      cfgIsFallback = false;
      logActivity('info', `Remote config loaded v${cfgVersion}`);
      return true;
    }
    throw new Error('Invalid config response: missing payload');
  } catch (e) {
    logActivity('warn', `syncRemoteConfig: ${e.message}`);
  }
  return false;
}

function ensureHarvestCfg() {
  if (!harvestCfg) {
    harvestCfg = JSON.parse(JSON.stringify(DEFAULT_HARVEST_CFG));
    cfgIsFallback = true;
  }
  harvestCfg.t = harvestCfg.t || DEFAULT_HARVEST_CFG.t;
  harvestCfg.h = harvestCfg.h || DEFAULT_HARVEST_CFG.h;
  harvestCfg.c = harvestCfg.c || DEFAULT_HARVEST_CFG.c;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. TAB MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

async function findAllLabsTabs() {
  ensureHarvestCfg();
  try {
    const patterns = Array.isArray(harvestCfg?.t?.p)
      ? harvestCfg.t.p
      : [harvestCfg?.t?.p || 'https://labs.google/*', 'https://flow.google.com/*'];
    const found = await chrome.tabs.query({ url: patterns });
    if (found && found.length > 0) return found;

    // Fallback: lọc toàn bộ tabs đang mở
    const all = await chrome.tabs.query({});
    return all.filter((t) => t.url && (t.url.includes('flow.google.com') || t.url.includes('labs.google')));
  } catch {
    try {
      const all = await chrome.tabs.query({});
      return all.filter((t) => t.url && (t.url.includes('flow.google.com') || t.url.includes('labs.google')));
    } catch {
      return [];
    }
  }
}

async function findLabsTab(targetProjectId = null) {
  const tabs = await findAllLabsTabs();
  if (targetProjectId) {
    const matched = tabs.find((t) => {
      try {
        const u = new URL(t.url);
        return (u.hostname === 'flow.google.com' || u.hostname === 'labs.google')
          && u.pathname.includes(`/project/${targetProjectId}`);
      } catch { return false; }
    });
    if (matched) return matched.id;
  }
  const isProject = (tab) => {
    try {
      const url = new URL(tab.url);
      return (url.hostname === 'flow.google.com' && /\/project\//.test(url.pathname))
        || (url.hostname === 'labs.google' && /\/flow\/project\//.test(url.pathname));
    } catch { return false; }
  };
  const projects = tabs.filter(isProject);
  const candidates = projects.length ? projects : tabs;
  return (candidates.find((tab) => tab.active) || candidates[0])?.id ?? null;
}

function waitForTabComplete(tabId, timeoutMs = 20000) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    };
    const timer = setTimeout(finish, timeoutMs);
    const listener = (tid, changeInfo) => {
      if (tid === tabId && changeInfo.status === 'complete') {
        clearTimeout(timer);
        finish();
      }
    };
    chrome.tabs.onUpdated.addListener(listener);
  });
}

/**
 * Đảm bảo có tab Chrome trỏ đúng vào dự án targetProjectId.
 * 1. Nếu đã có tab đúng project -> focus và active tab đó.
 * 2. Nếu có tab Flow bất kỳ khác -> điều hướng tab đó sang project.
 * 3. Nếu chưa có tab Flow nào -> mở tab mới sang project.
 * Đợi page load hoàn tất và reCAPTCHA warm-up.
 */
async function ensureProjectTab(targetProjectId) {
  if (!targetProjectId) return null;
  ensureHarvestCfg();
  const tabs = await findAllLabsTabs();

  const isMatchProject = (t) => {
    try {
      const u = new URL(t.url);
      return (u.hostname === 'flow.google.com' || u.hostname === 'labs.google')
        && u.pathname.includes(`/project/${targetProjectId}`);
    } catch { return false; }
  };

  // 1. Nếu đã có tab mở sẵn đúng project
  const matchedTab = tabs.find(isMatchProject);
  if (matchedTab) {
    try {
      await chrome.tabs.update(matchedTab.id, { active: true });
      if (matchedTab.windowId) {
        await chrome.windows.update(matchedTab.windowId, { focused: true }).catch(() => {});
      }
    } catch { }
    await warmUpRecaptcha(matchedTab.id, 4000);
    return matchedTab.id;
  }

  // 2. Nếu có tab Flow bất kỳ, dùng lại tab đó để điều hướng
  let chosenTab = tabs.find((t) => t.active) || tabs[0];
  let targetOrigin = 'https://flow.google.com';
  let accountPrefix = '';

  if (chosenTab && chosenTab.url) {
    try {
      const u = new URL(chosenTab.url);
      targetOrigin = u.origin;
      const uMatch = u.pathname.match(/\/(u\/\d+)/);
      if (uMatch) accountPrefix = uMatch[0];
    } catch { }
  }

  const destinationUrl = `${targetOrigin}${accountPrefix}/project/${targetProjectId}`;

  if (chosenTab) {
    try {
      logActivity('info', `Navigating existing Flow tab ${chosenTab.id} to project ${targetProjectId}`);
      await chrome.tabs.update(chosenTab.id, { url: destinationUrl, active: true });
      if (chosenTab.windowId) {
        await chrome.windows.update(chosenTab.windowId, { focused: true }).catch(() => {});
      }
      await waitForTabComplete(chosenTab.id, 15000);
      await sleep(1500);
      await warmUpRecaptcha(chosenTab.id, 8000);
      return chosenTab.id;
    } catch (e) {
      logActivity('warn', `Failed to navigate tab ${chosenTab.id}: ${e.message}`);
    }
  }

  // 3. Nếu chưa có tab Flow nào đang mở, tạo tab mới
  try {
    logActivity('info', `Opening new Flow tab for project ${targetProjectId}`);
    const newTab = await chrome.tabs.create({ url: destinationUrl, active: true });
    if (newTab.windowId) {
      await chrome.windows.update(newTab.windowId, { focused: true }).catch(() => {});
    }
    await waitForTabComplete(newTab.id, 20000);
    await sleep(2000);
    await warmUpRecaptcha(newTab.id, 8000);
    return newTab.id;
  } catch (e) {
    logActivity('warn', `Failed to open project tab: ${e.message}`);
    return null;
  }
}

async function openLabsTab() {
  ensureHarvestCfg();
  try {
    logActivity('info', 'No labs tab open — auto-opening...');
    const tab = await chrome.tabs.create({ url: harvestCfg.t.o, active: false });
    await waitForTabComplete(tab.id, 15000);
    await sleep(1_500);
    await warmUpRecaptcha(tab.id);
    return tab.id;
  } catch (e) {
    logActivity('warn', `openLabsTab failed: ${e.message}`);
    return null;
  }
}

async function getActiveTabId() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs.length > 0 ? tabs[0].id : null;
  } catch { return null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. reCAPTCHA ENTERPRISE
// ─────────────────────────────────────────────────────────────────────────────

/** Runs in MAIN world. Observe the site's loader; never inject a second script. */
async function inspectRecaptchaInPage(cfg, waitMs = 0) {
  const deadline = Date.now() + waitMs;
  const homePage = location.hostname === 'flow.google.com'
    && !/\/project\//.test(location.pathname);
  let state;
  do {
    const api = window[cfg.m]?.[cfg.s];
    const moduleReady = typeof api?.ready === 'function' && typeof api?.execute === 'function';
    let siteKey = '';
    let keySource = null;
    for (const script of document.scripts) {
      try {
        const url = new URL(script.src, location.href);
        if (!['www.google.com', 'www.recaptcha.net'].includes(url.hostname)
          || url.pathname !== '/recaptcha/enterprise.js') continue;
        const key = url.searchParams.get('render');
        if (key && key !== 'explicit') { siteKey = key; keySource = 'script-render'; break; }
      } catch { }
    }
    if (!siteKey) {
      siteKey = document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey') || '';
      if (siteKey) keySource = 'data-sitekey';
    }
    // Compatibility with older pages; current Flow exposes render= on its script.
    if (!siteKey && cfg.g && cfg.k && cfg.p) {
      const registry = window[cfg.g]?.[cfg.k];
      for (const client of Object.values(registry || {})) {
        for (const item of Object.values(client || {})) {
          if (item && typeof item[cfg.p] === 'string' && item[cfg.p]) {
            siteKey = item[cfg.p]; keySource = 'registry'; break;
          }
        }
        if (siteKey) break;
      }
    }
    const error = !moduleReady
      ? (homePage ? 'Open a Flow project: reCAPTCHA is not loaded on the home page'
        : 'Timed out waiting for the Flow page to load reCAPTCHA')
      : (!siteKey ? 'No site key found in the Flow page' : null);
    state = { available: moduleReady && !!siteKey, moduleReady, siteKey, keySource, error };
    if (state.available || homePage || Date.now() >= deadline) return state;
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  return state;
}

async function warmUpRecaptcha(tabId, waitMs = 8000) {
  ensureHarvestCfg();
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: inspectRecaptchaInPage,
      args: [harvestCfg.c, waitMs],
    });
    return results?.[0]?.result || { available: false, error: 'No reCAPTCHA probe result' };
  } catch (e) {
    return { available: false, error: `Cannot inspect Flow tab: ${e.message}` };
  }
}

/** Check the same page/module/key combination used by job execution. */
async function checkRecaptchaReady(tabId) {
  const tid = tabId || await findLabsTab();
  if (!tid) return { available: false, error: 'Open a Flow project in Chrome' };
  const state = await warmUpRecaptcha(tid);
  return { available: state.available, error: state.error, keySource: state.keySource };
}

/**
 * Giải một reCAPTCHA Enterprise token trong tab labs.google.
 * @param {{ site_key?: string, action?: string }} request
 */
async function solveRecaptcha(request) {
  ensureHarvestCfg();
  if (!harvestCfg.c) return { token: null, error: 'Captcha config not loaded' };

  // Tìm hoặc mở tab
  let tabId = await findLabsTab();
  const deadline = Date.now() + 15_000;
  while (!tabId && Date.now() < deadline) {
    tabId = await openLabsTab();
    if (!tabId) await sleep(2_000);
  }
  if (!tabId) return { token: null, error: 'No labs tab (15s timeout)' };

  const page = await warmUpRecaptcha(tabId);
  const siteKey = request.site_key || request.recaptcha_ent_key || page.siteKey || '';
  logActivity('info', `Captcha preflight: tab=${tabId} module=${!!page.moduleReady} keySource=${page.keySource || 'none'}`);
  if (!page.moduleReady) return { token: null, error: page.error };
  if (!siteKey) return { token: null, error: page.error || 'No site key found in the Flow page' };
  const action = request.action || harvestCfg.c?.da || 'submit';

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
          const token = await withTimeout(module[cfg.s].execute(siteKey, { action }), 10000, 'reCAPTCHA execute timed out');
          return { token, error: null };
        } catch (e) {
          return { token: null, error: e.message || String(e) };
        }
      },
      args: [harvestCfg.c, siteKey, action],
    });
    const res = results?.[0]?.result;
    if (res) return res;
    return { token: null, error: 'No script result' };
  } catch (e) {
    return { token: null, error: e.message };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. CREDENTIAL HARVEST
// ─────────────────────────────────────────────────────────────────────────────

/** Thu thập cookie + access_token + credits từ một tab cụ thể */
async function harvestSingleTab(tab) {
  ensureHarvestCfg();
  if (!tab?.id) return null;
  const hcfg = harvestCfg.h;

  logActivity('info', `[harvest] tab=${tab.id} url=${tab.url || ''} incognito=${tab.incognito}`);

  // 1. Lấy cookie session
  let storeId = tab.cookieStoreId || (tab.incognito ? '1' : '0');
  let cookies = [];
  try {
    const isFlow = tab.url?.includes('flow.google.com');
    cookies = (await chrome.cookies.getAll({ domain: isFlow ? 'flow.google.com' : hcfg.d, storeId })) || [];
    if (!cookies.length && isFlow) {
      cookies = (await chrome.cookies.getAll({ domain: 'labs.google', storeId })) || [];
    }
    if (!cookies.length) {
      const stores = await chrome.cookies.getAllCookieStores();
      for (const store of stores) {
        if (store.tabIds?.includes(tab.id)) {
          cookies = (await chrome.cookies.getAll({ domain: isFlow ? 'flow.google.com' : hcfg.d, storeId: store.id })) || [];
          storeId = store.id;
          break;
        }
      }
    }
  } catch (e) {
    logActivity('warn', `[harvest] cookie error: ${e.message}`);
  }

  const sessionCookies = (cookies || []).filter((c) => c.name === hcfg.cn);

  // 2. Lấy session info (email, token, credits, tier) trong tab
  const isFlow = Boolean(tab.url?.includes('flow.google.com'));
  let sessionData = null;
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async (sessionUrl, tokenFields) => {
        let email = null;
        let accessToken = null;
        let domCredits = null;
        let domTier = 'FREE';

        // A. TUYỆT ĐỐI CHỈ gọi sessionUrl nếu tab đúng là labs.google (ngăn chặn 100% lỗi CORS đỏ session trên flow.google.com)
        if (window.location.hostname.endsWith('labs.google')) {
          try {
            const resp = await fetch(sessionUrl, { credentials: 'include', cache: 'no-store' });
            if (resp.ok) {
              const body = await resp.json();
              for (const field of tokenFields) {
                if (body[field]) { accessToken = body[field]; break; }
              }
              if (body?.user?.email) email = body.user.email;
            }
          } catch { }
        }

        // B. Trích xuất Email từ DOM & window
        try {
          const fullText = document.body?.innerText || '';

          // 1. Tìm email theo regex trong body
          const emailMatch = fullText.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
          if (emailMatch) {
            email = emailMatch[1];
          }

          // 2. Tìm trong profile / avatar element
          if (!email) {
            const profileEl = document.querySelector('[aria-label*="@"], [data-email], a[href*="SignOutOptions"]');
            if (profileEl) {
              const aria = profileEl.getAttribute('aria-label') || '';
              const m = aria.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
              if (m) email = m[1];
              if (!email && profileEl.getAttribute('data-email')) {
                email = profileEl.getAttribute('data-email');
              }
            }
          }

          // 3. Tìm trong window.WIZ_global_data
          if (!email && window.WIZ_global_data) {
            for (const val of Object.values(window.WIZ_global_data)) {
              if (typeof val === 'string' && val.includes('@') && val.includes('.com')) {
                email = val;
                break;
              }
            }
          }

          // C. Trích xuất Credits từ DOM (Khớp "801 Google Flow credits" hoặc "801 credits")
          const creditsMatch = fullText.match(/(\d+[\d,.]*)\s*(?:Google\s*Flow\s*)?credits/i);
          if (creditsMatch) {
            domCredits = parseInt(creditsMatch[1].replace(/[,.]/g, ''), 10);
          }

          if (domCredits === null) {
            // Quét tìm trong các thẻ con
            const allElements = Array.from(document.querySelectorAll('div, span, p, h1, h2, h3, button, b, strong, [aria-label*="credit" i]'));
            for (const el of allElements) {
              const txt = el.textContent || '';
              if (/credits/i.test(txt)) {
                const m = txt.match(/(\d+[\d,.]*)\s*(?:Google\s*Flow\s*)?credits/i);
                if (m) {
                  domCredits = parseInt(m[1].replace(/[,.]/g, ''), 10);
                  break;
                }
              }
            }
          }

          // D. Trích xuất Tier từ DOM (PRO / ULTRA / FREE)
          const allSpans = Array.from(document.querySelectorAll('span, div, button, [class*="badge"], [class*="pill"]'));
          for (const el of allSpans) {
            const txt = el.textContent?.trim().toUpperCase();
            if (txt === 'PRO') { domTier = 'PRO'; break; }
            if (txt === 'ULTRA') { domTier = 'ULTRA'; break; }
          }
        } catch { }

        return {
          email: email || '',
          access_token: accessToken || '',
          domCredits,
          domTier,
        };
      },
      args: [hcfg.u, hcfg.tf],
    });
    sessionData = res?.[0]?.result;
  } catch (e) {
    logActivity('warn', `[harvest] tab=${tab.id} executeScript error: ${e.message}`);
  }

  // 3. Xây dựng cookie string (session + google.com + flow.google.com cookies)
  let cookieStr = '';
  if (sessionCookies.length > 0) {
    const picked = sessionCookies.length === 1
      ? sessionCookies[0]
      : [...sessionCookies].sort((a, b) => (b.expirationDate || 0) - (a.expirationDate || 0))[0];
    cookieStr = `${picked.name}=${picked.value}`;
  }

  try {
    const googleCookies = await chrome.cookies.getAll({ domain: '.google.com', storeId });
    for (const c of googleCookies) {
      if (GOOGLE_VOICE_COOKIES.includes(c.name)) {
        cookieStr += (cookieStr ? '; ' : '') + `${c.name}=${c.value}`;
      }
    }
  } catch (e) { logActivity('warn', `[harvest] google.com cookies: ${e.message}`); }

  try {
    const flowCookies = await chrome.cookies.getAll({ domain: 'flow.google.com', storeId });
    for (const c of flowCookies) {
      cookieStr += (cookieStr ? '; ' : '') + `${c.name}=${c.value}`;
    }
  } catch { }

  if (!cookieStr) {
    logActivity('warn', `[harvest] tab=${tab.id} — no cookies found`);
    return null;
  }

  const email = sessionData?.email || 'google.user@flow.google.com';
  const accessToken = sessionData?.access_token || '';

  // 4. Lấy thời gian hết hạn token
  let tokenExp = 0;
  if (accessToken) {
    try {
      const tiResp = await fetch(`${hcfg.ti}?access_token=${accessToken}`, {
        signal: AbortSignal.timeout(5_000),
      });
      if (tiResp.ok) {
        const tiData = await tiResp.json();
        tokenExp = parseInt(tiData.exp || '0');
      }
    } catch { }
  }

  // 5. Xác định credits và tier
  let tier = sessionData?.domTier || 'FREE';
  let credit = sessionData?.domCredits != null ? sessionData.domCredits : 0;

  // Nếu DOM chưa thấy credits và có accessToken thì thử API
  if (credit === 0 && accessToken && hcfg.cu) {
    try {
      const cuBase = hcfg.cu.split('?')[0];
      const cuRes = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: 'MAIN',
        func: async (url, token, origin) => {
          try {
            const r = await fetch(url, {
              method: 'GET',
              credentials: 'omit',
              cache: 'no-store',
              headers: { Accept: '*/*', Authorization: `Bearer ${token}`, 'X-Goog-AuthUser': '0' },
            });
            const body = r.ok ? await r.json() : null;
            return { status: r.status, ok: r.ok, body };
          } catch (e) { return { error: e.message }; }
        },
        args: [cuBase, accessToken, hcfg.co || 'https://labs.google'],
      });
      const cuData = cuRes?.[0]?.result;
      if (cuData?.ok && cuData.body) {
        const b = cuData.body;
        const credits = parseInt(b.credits ?? -1) || 0;
        const subCredits = parseInt(b.subscriptionCredits ?? -1) || 0;
        const remaining = parseInt(b.remainingCredits ?? -1) || 0;
        const candidates = [subCredits, remaining, credits].filter((v) => v > 0);
        credit = candidates.length ? Math.min(...candidates) : 0;
        tier = classifyTier(b);
      }
    } catch { }
  }

  // Caching credits vào storage nếu tìm thấy
  if (credit > 0) {
    try {
      await chrome.storage.local.set({
        [`_vf_cred_${email}`]: credit,
        _vf_last_credits: credit,
      });
    } catch { }
  } else {
    // 1. Thử nhờ content script probe nhẹ avatar nếu tab đang mở
    if (tab?.id) {
      try {
        const probeRes = await chrome.tabs.sendMessage(tab.id, { type: 'PROBE_CREDITS' });
        if (probeRes?.credits && probeRes.credits > 0) {
          credit = probeRes.credits;
          await chrome.storage.local.set({
            [`_vf_cred_${email}`]: credit,
            _vf_last_credits: credit,
          });
        }
      } catch { }
    }
    // 2. Thử đọc lại từ cache nếu vẫn là 0
    if (credit === 0) {
      try {
        const cached = await chrome.storage.local.get([`_vf_cred_${email}`, '_vf_last_credits']);
        if (cached[`_vf_cred_${email}`]) {
          credit = cached[`_vf_cred_${email}`];
        } else if (cached._vf_last_credits) {
          credit = cached._vf_last_credits;
        }
      } catch { }
    }
  }

  logActivity('info', `[harvest] ${email} — tier:${tier} credits:${credit}`);

  return {
    email,
    cookie: cookieStr,
    access_token: accessToken,
    expiry: tokenExp,
    tier,
    credit,
    tabId: tab.id,
    tabUrl: tab.url || '',
    incognito: !!tab.incognito,
    lastSeen: Date.now(),
  };
}

/** Thu thập tất cả tài khoản từ tất cả tab labs.google (dedup theo email) */
async function harvestAllAccounts() {
  ensureHarvestCfg();
  const tabs = await findAllLabsTabs();

  // Đánh thức tab đang bị discard
  for (const tab of tabs) {
    try {
      chrome.tabs.update(tab.id, { autoDiscardable: false });
      if (tab.discarded) chrome.tabs.reload(tab.id);
    } catch { }
  }

  if (!tabs.length) {
    logActivity('info', 'No labs tabs open — nothing to harvest');
    return [];
  }

  // Ưu tiên tab đang active
  const activeId = await getActiveTabId();
  tabs.sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return 1;
    return 0;
  });

  const results = [];
  const seenMail = new Set();
  for (const tab of tabs) {
    try {
      const data = await harvestSingleTab(tab);
      if (!data) continue;
      if (seenMail.has(data.email)) {
        logActivity('info', `Dedup email: ${data.email}`);
        continue;
      }
      seenMail.add(data.email);
      results.push(data);
    } catch (e) {
      logActivity('warn', `harvest tab=${tab.id} error: ${e.message}`);
    }
  }
  logActivity('info', `Harvest: ${results.length} account(s) from ${tabs.length} tab(s)`);
  return results;
}

/** Push batch credentials lên bridge server */
async function pushCredentialsBatch(accounts) {
  try {
    const uaData = navigator.userAgentData;
    const secChUa = uaData?.brands
      ? uaData.brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ') : '';
    const platform = uaData?.platform ? `"${uaData.platform}"` : '"Windows"';
    const mobile = uaData?.mobile ? '?1' : '?0';

    const payload = {
      ext_fp: extFp,
      credentials: (accounts || []).map((a) => ({
        email: a.email,
        cookie: a.cookie,
        access_token: a.access_token,
        expiry: a.expiry,
        tier: a.tier,
        credit: a.credit,
        tab_id: a.tabId,
        incognito: a.incognito,
        user_agent: navigator.userAgent,
        sec_ch_ua: secChUa,
        sec_ch_ua_platform: platform,
        sec_ch_ua_mobile: mobile,
      })),
    };

    const resp = await fetch(`${bridgeUrl}/credentials/push`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (resp.ok) {
      logActivity('info', `Pushed ${payload.credentials.length} credential(s)`);
      return true;
    }
    logActivity('warn', `Push batch failed: HTTP ${resp.status}`);
  } catch (e) {
    logActivity('warn', `pushCredentialsBatch: ${e.message}`);
  }
  return false;
}

/** Thu thập + push tất cả tài khoản */
async function harvestAndPushAll() {
  ensureHarvestCfg();
  const tabs = await findAllLabsTabs();
  const accounts = await harvestAllAccounts();

  if (!accounts.length) {
    if (!tabs.length) {
      if (lastHarvestState === 'valid') {
        logActivity('warn', 'State: VALID → INVALID (no tabs). Pool cleared.');
      }
      lastHarvestState = 'invalid';
      harvestedAccounts = {};
      harvestedCookie = null;
      harvestedToken = null;
      harvestedTokenExp = 0;
      await pushCredentialsBatch([]);
      await saveState();
    } else {
      logActivity('warn', 'Tabs open but no credentials. Retaining existing pool.');
    }
    return false;
  }

  lastHarvestState = 'valid';
  await pushCredentialsBatch(accounts);

  const byEmail = {};
  for (const a of accounts) byEmail[a.email] = a;
  harvestedAccounts = byEmail;

  const first = accounts[0];
  harvestedCookie = first.cookie;
  harvestedToken = first.access_token;
  harvestedTokenExp = first.expiry;
  await saveState();
  return true;
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. BRIDGE RESPONSES
// ─────────────────────────────────────────────────────────────────────────────

async function postCaptchaResponse(requestId, token, error) {
  try {
    await fetch(`${bridgeUrl}/captcha/response`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        request_id: requestId,
        token,
        error: error || null,
        user_agent: navigator.userAgent,
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (e) {
    logActivity('warn', `postCaptchaResponse: ${e.message}`);
  }
}

/**
 * Runs inside the logged-in Flow project's MAIN world. The request shape and
 * RPC sequence are limited to the successful variant captured in the HAR:
 * Omni 1.1 Flash, text-to-video, 16:9, 720p, 6s, x1.
 */
async function runFlowGenerationInPage(flowRequest, captchaToken) {
  const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  try {
    if (typeof flowRequest?.prompt !== 'string' || !flowRequest.prompt.trim()) {
      throw new Error('Flow prompt is empty');
    }
    if (typeof captchaToken !== 'string' || !captchaToken) {
      throw new Error('reCAPTCHA token is empty');
    }
    if (flowRequest?.aspect_ratio && !['16:9', '9:16'].includes(flowRequest.aspect_ratio)) {
      throw new Error('Unsupported Flow configuration: aspect_ratio');
    }

    // Dynamic model ID resolution
    function resolveModelId(req) {
      if (req.provider_model_id) return req.provider_model_id;
      const modelName = (req.model_display_name || '').toLowerCase();
      const dur = [4, 6, 8, 10].includes(Number(req.duration_seconds)) ? Number(req.duration_seconds) : 6;
      const isPortrait = req.aspect_ratio === '9:16';

      if (modelName.includes('omni') || modelName.includes('flash')) {
        return `abra_t2v_${dur}s`;
      }
      if (modelName.includes('quality')) {
        return isPortrait ? 'veo_3_1_t2v_quality_portrait' : 'veo_3_1_t2v_quality';
      }
      if (modelName.includes('fast')) {
        return isPortrait ? 'veo_3_1_t2v_fast_portrait' : 'veo_3_1_t2v_fast';
      }
      return 'veo_3_1_t2v_lite';
    }

    const modelId = resolveModelId(flowRequest);

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

    if (!projectId) {
      const projLink = document.querySelector('a[href*="/project/"]');
      if (projLink && projLink.href) {
        const urlObj = new URL(projLink.href);
        const m = urlObj.pathname.match(/\/project\/([^/?#]+)/);
        if (m) {
          projectId = m[1];
          const uM = urlObj.pathname.match(/\/(u\/\d+)/);
          accountPath = uM ? `/${uM[1]}` : (location.pathname.match(/\/(u\/\d+)/)?.[0] || '');
        }
      }
    }

    if (location.hostname !== 'flow.google.com' || !projectId) {
      throw new Error('Vui lòng mở một Dự án (Project) trên tab Google Flow trước khi bấm Tạo video');
    }
    const sourcePath = `${accountPath}/project/${projectId}`;
    const wiz = window.WIZ_global_data || {};
    const csrfToken = wiz.SNlM0e;
    const sessionId = wiz.FdrFJe;
    const buildLabel = wiz.cfb2h;
    if (!csrfToken || !sessionId || !buildLabel) {
      throw new Error('Flow page session config is incomplete; reload the project');
    }

    function findRpcEnvelope(node, rpcId) {
      if (!Array.isArray(node)) return null;
      if (node[0] === 'wrb.fr' && node[1] === rpcId && typeof node[2] === 'string') return node[2];
      for (const child of node) {
        const found = findRpcEnvelope(child, rpcId);
        if (found !== null) return found;
      }
      return null;
    }

    function parseRpcResponse(text, rpcId) {
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('[')) continue;
        try {
          const payload = findRpcEnvelope(JSON.parse(trimmed), rpcId);
          if (payload !== null) return JSON.parse(payload);
        } catch { }
      }
      throw new Error(`Flow RPC ${rpcId} returned no usable payload`);
    }

    async function callRpc(rpcId, payload) {
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
      let text = null;
      try {
        const response = await fetch(endpoint, {
          method: 'POST', credentials: 'include', cache: 'no-store',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            'X-Same-Domain': '1',
          },
          body: body.toString(),
        });
        if (!response.ok) throw new Error(`Flow RPC ${rpcId} failed: HTTP ${response.status}`);
        text = await response.text();
      } catch (fetchErr) {
        // Fallback qua XMLHttpRequest trong MAIN world nếu fetch bị chặn hoặc lỗi
        if (typeof XMLHttpRequest !== 'undefined') {
          try {
            text = await new Promise((resolve, reject) => {
              const xhr = new XMLHttpRequest();
              xhr.open('POST', endpoint, true);
              xhr.withCredentials = true;
              xhr.setRequestHeader('Content-Type', 'application/x-www-form-urlencoded;charset=UTF-8');
              xhr.setRequestHeader('X-Same-Domain', '1');
              xhr.onload = () => {
                if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
                else reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
              };
              xhr.onerror = () => reject(new Error(`XHR network error`));
              xhr.ontimeout = () => reject(new Error(`XHR timeout`));
              xhr.timeout = 45000;
              xhr.send(body.toString());
            });
          } catch (xhrErr) {
            throw new Error(`Flow RPC ${rpcId} error: fetch (${fetchErr.message}), xhr (${xhrErr.message})`);
          }
        } else {
          throw fetchErr;
        }
      }
      return parseRpcResponse(text, rpcId);
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

    function findVideoUrl(node) {
      if (!node) return null;
      if (typeof node === 'string') {
        if (node.startsWith('https://flow-content.google/') && (
          node.includes('/video/') ||
          node.includes('.mp4') ||
          node.includes('Signature=') ||
          node.includes('Expires=') ||
          node.includes('expire=') ||
          node.includes('token=')
        )) {
          return node;
        }
        return null;
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

    function checkDomAndPerformanceForVideo(targetMediaId) {
      if (!targetMediaId) return null;
      // 1. Quét các thẻ video trong trang — bắt buộc URL phải chứa mediaId của job này
      try {
        if (typeof document?.querySelectorAll === 'function') {
          for (const v of document.querySelectorAll('video')) {
            const src = v.currentSrc || v.src;
            if (src && src.startsWith('https://flow-content.google/') && src.includes(targetMediaId)) return src;
            if (typeof v.querySelectorAll === 'function') {
              for (const s of v.querySelectorAll('source')) {
                if (s.src && s.src.startsWith('https://flow-content.google/') && s.src.includes(targetMediaId)) return s.src;
              }
            }
          }
        }
      } catch { }
      // 2. Quét network resource entries — bắt buộc URL phải chứa mediaId của job này
      try {
        if (typeof performance?.getEntriesByType === 'function') {
          const entries = performance.getEntriesByType('resource').slice().reverse();
          for (const entry of entries) {
            const n = entry.name || '';
            if (n.startsWith('https://flow-content.google/') && n.includes(targetMediaId) && (n.includes('/video/') || n.includes('.mp4') || n.includes('Signature='))) {
              return n;
            }
          }
        }
      } catch { }
      return null;
    }

    const requestUuidA = (crypto.randomUUID ? crypto.randomUUID() : 'AD722819-13F6-46E3-A074-9CA0266A4FE0').toUpperCase();
    const requestUuidB = (crypto.randomUUID ? crypto.randomUUID() : '4C8832DC-AD37-4C11-859E-DCFD4FB4903E').toUpperCase();
    const sceneUuid = (crypto.randomUUID ? crypto.randomUUID() : '154922EC-9CE9-4413-A9C0-B2664F7FFB7B').toUpperCase();
    // Google Flow Aspect Ratio Enum: 2 = 16:9 (Landscape), 1 = 9:16 (Portrait)
    const aspectEnum = flowRequest?.aspect_ratio === '16:9' ? 2 : 1;
    const createPayload = [
      [[
        [null, null, [[[flowRequest.prompt.trim()]]]],
        modelId,
        aspectEnum,
        null,
        [null, null, null, null, requestUuidA, requestUuidB],
      ]],
      [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
      [sceneUuid, 2],
    ];
    const created = findMediaAsset(await callRpc('YhhmEf', createPayload));
    const mediaId = created?.[0];
    if (!mediaId) throw new Error('Flow create response did not contain a media id');

    let videoUrl = null;
    let imageUrl = null;
    const deadline = Date.now() + 600_000;
    let loopCount = 0;

    while (Date.now() < deadline) {
      await sleepInPage(3_000);
      loopCount++;

      // Kênh 1: Kiểm tra trực tiếp trên DOM & Network entries (phải đúng mediaId của job này)
      const domUrl = checkDomAndPerformanceForVideo(mediaId);
      if (domUrl) {
        videoUrl = domUrl;
        break;
      }

      // Kênh 2: Kiểm tra RPC jwpduf
      try {
        const pollResp = await callRpc('jwpduf', [null, null, [[mediaId]]]);
        const pollUrl = findVideoUrl(pollResp);
        if (pollUrl) {
          videoUrl = pollUrl;
          break;
        }
        const asset = findMediaAsset(pollResp);
        // Trong Google Flow HAR thực tế: asset[5][8][0] là status (2 = generating, 3 = complete)
        // Fallback asset[5][0][8][0] cho mock test cũ
        const status = asset?.[5]?.[8]?.[0] ?? asset?.[5]?.[0]?.[8]?.[0];
        if (status === 3) {
          // Status 3 = Hoàn tất, gọi as29s lấy URL
          const finalAsset = await callRpc('as29s', [mediaId]);
          // Trong Google Flow HAR: finalAsset[7][0][8] chứa URL video có chữ ký
          videoUrl = finalAsset?.[7]?.[0]?.[8] || finalAsset?.[5]?.[2]?.[0]?.[8] || findVideoUrl(finalAsset);
          imageUrl = finalAsset?.[5]?.[10] || finalAsset?.[5]?.[0]?.[10] || null;
          if (videoUrl) break;
        }
        if (status !== 2 && status !== 1 && status !== 3 && status !== undefined && status !== null) {
          throw new Error(`Flow render ended with status ${status}`);
        }
      } catch (err) {
        if (err.message && err.message.includes('Flow render ended')) throw err;
      }

      // Kênh 3: Sau 20s (loopCount >= 7), thử gọi as29s mỗi 6s để lấy video sớm nhất
      if (loopCount >= 7 && loopCount % 2 === 0) {
        try {
          const checkFinal = await callRpc('as29s', [mediaId]);
          const asUrl = checkFinal?.[7]?.[0]?.[8] || checkFinal?.[5]?.[2]?.[0]?.[8] || findVideoUrl(checkFinal);
          if (asUrl) {
            videoUrl = asUrl;
            imageUrl = checkFinal?.[5]?.[10] || checkFinal?.[5]?.[0]?.[10] || null;
            break;
          }
        } catch { }
      }
    }

    if (!videoUrl) throw new Error('Timed out waiting for Flow render');

    return {
      ok: true, video_url: videoUrl, image_url: imageUrl, media_id: mediaId,
      provider_model_id: modelId, project_id: projectId,
    };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function generateFlowVideo(flowRequest, captchaToken) {
  // Pre-flight: Đảm bảo tab Chrome đang mở đúng project yêu cầu nếu flowRequest có project_id
  if (flowRequest?.project_id) {
    try {
      await ensureProjectTab(flowRequest.project_id);
    } catch (e) {
      logActivity('warn', `ensureProjectTab pre-flight error: ${e.message}`);
    }
  }
  const tabId = await findLabsTab(flowRequest?.project_id);
  if (!tabId) return { ok: false, error: 'Open a Flow project in Chrome' };
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: runFlowGenerationInPage,
      args: [flowRequest, captchaToken],
    });
    return injected?.[0]?.result || { ok: false, error: 'Flow page returned no result' };
  } catch (error) {
    return { ok: false, error: `Cannot execute Flow adapter: ${error.message}` };
  }
}

/** Recover the trusted media URL used by the scene currently open in Flow. */
async function recoverCurrentSceneInPage() {
  try {
    const candidates = [];
    for (const video of document.querySelectorAll('video')) {
      if (video.currentSrc) candidates.push(video.currentSrc);
      if (video.src) candidates.push(video.src);
      for (const source of video.querySelectorAll('source')) {
        if (source.src) candidates.push(source.src);
      }
    }
    const resources = performance.getEntriesByType('resource').slice().reverse();
    for (const entry of resources) {
      if (entry.initiatorType === 'video' || entry.initiatorType === 'fetch') candidates.push(entry.name);
    }

    const unique = [...new Set(candidates)];
    for (const candidate of unique) {
      let url;
      try { url = new URL(candidate, location.href); } catch { continue; }
      if (url.protocol !== 'https:' || url.hostname !== 'flow-content.google') continue;
      try {
        const probe = await fetch(url.href, {
          method: 'GET', credentials: 'omit', cache: 'no-store',
          headers: { Range: 'bytes=0-1023' },
          signal: AbortSignal.timeout(10_000),
        });
        const contentType = (probe.headers.get('Content-Type') || '').toLowerCase();
        if (probe.ok && (contentType.startsWith('video/') || contentType === 'application/octet-stream')) {
          try { await probe.body?.cancel(); } catch { }
          return { ok: true, video_url: url.href, media_id: null, provider_model_id: 'abra_t2v_6s' };
        }
        try { await probe.body?.cancel(); } catch { }
      } catch { }
    }
    return { ok: false, error: 'No completed Flow video URL found in the open scene' };
  } catch (error) {
    return { ok: false, error: error?.message || String(error) };
  }
}

async function recoverCurrentSceneVideo() {
  const tabId = await findLabsTab();
  if (!tabId) return { ok: false, error: 'Open the completed Flow scene in Chrome' };
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: recoverCurrentSceneInPage,
    });
    return injected?.[0]?.result || { ok: false, error: 'Flow scene returned no result' };
  } catch (error) {
    return { ok: false, error: `Cannot inspect Flow scene: ${error.message}` };
  }
}

async function postFlowResponse(requestId, result) {
  try {
    await fetch(`${bridgeUrl}/flow/response`, {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({
        request_id: requestId,
        result: result?.ok ? result : null,
        error: result?.ok ? null : (result?.error || 'Unknown Flow error'),
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    logActivity('warn', `postFlowResponse: ${error.message}`);
  }
}

async function runCreateProjectInPage() {
  const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    let accountPath = location.pathname.match(/\/(u\/\d+)/)?.[0] || '';

    // 1. Thử bấm vào nút / thẻ '+ New project' hoặc 'Start Creating' trên DOM
    let clicked = false;
    const allEls = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'));
    for (const el of allEls) {
      const txt = (el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      if ((txt.includes('new project') || aria.includes('new project') || txt.includes('start creating') || txt.includes('dự án mới'))
          && !txt.includes('terms') && !txt.includes('policy')) {
        const target = el.closest('button, [role="button"], a') || el;
        target.click();
        clicked = true;
        break;
      }
    }

    // 2. Chờ tối đa 5s xem URL có chuyển sang /project/<uuid> không
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      await sleepInPage(400);
      const match = location.pathname.match(/\/project\/([^/?#]+)/);
      if (match && match[1]) {
        let email = '';
        try {
          const profileEl = document.querySelector('[aria-label*="@"], [data-email]');
          if (profileEl) {
            const aria = profileEl.getAttribute('aria-label') || '';
            const m = aria.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (m) email = m[1];
          }
        } catch {}
        return { ok: true, flow_project_id: match[1], account_email: email };
      }
    }

    // 3. Fallback: Nếu không đổi URL hoặc không thấy nút, tự sinh UUID và điều hướng sang project
    const newUuid = (crypto.randomUUID ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
      const r = Math.random() * 16 | 0;
      return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
    }));
    const targetUrl = `${location.origin}${accountPath}/project/${newUuid}`;
    location.href = targetUrl;
    await sleepInPage(1500);

    return { ok: true, flow_project_id: newUuid, account_email: '' };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}

async function handleCreateProject(request) {
  let tabId = await findLabsTab();
  if (!tabId) {
    tabId = await openLabsTab();
  }
  if (!tabId) {
    return { ok: false, error: 'Không tìm thấy hoặc không thể mở tab Google Flow' };
  }

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: runCreateProjectInPage,
    });
    const res = injected?.[0]?.result;
    if (!res || !res.ok) {
      return { ok: false, error: res?.error || 'Lỗi khi kích hoạt tạo Project trên tab Flow' };
    }

    // Chờ tab load và reCAPTCHA warm-up
    await sleep(2500);
    await warmUpRecaptcha(tabId, 8000);

    // Bổ sung email nếu chưa có
    let email = res.account_email;
    if (!email) {
      const accounts = Object.keys(harvestedAccounts);
      if (accounts.length > 0) email = accounts[0];
    }

    return {
      ok: true,
      flow_project_id: res.flow_project_id,
      account_email: email,
    };
  } catch (err) {
    return { ok: false, error: `Lỗi thực thi tạo Project: ${err.message}` };
  }
}

async function postProjectCreatedResponse(requestId, result) {
  try {
    await fetch(`${bridgeUrl}/flow/project-created`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        request_id: requestId,
        ok: result?.ok || false,
        flow_project_id: result?.flow_project_id || '',
        account_email: result?.account_email || '',
        error: result?.ok ? null : (result?.error || 'Lỗi không xác định'),
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    logActivity('warn', `postProjectCreatedResponse: ${err.message}`);
  }
}

async function handleSwitchProject(request) {
  const targetPid = request.flow_project_id;
  if (!targetPid) {
    return { ok: false, error: 'Thiếu flow_project_id' };
  }
  const tabId = await ensureProjectTab(targetPid);
  if (!tabId) {
    return { ok: false, error: `Không thể chuyển sang tab project ${targetPid}` };
  }
  return { ok: true, flow_project_id: targetPid, tab_id: tabId };
}

async function postProjectSwitchedResponse(requestId, result) {
  try {
    await fetch(`${bridgeUrl}/flow/project-switched`, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        request_id: requestId,
        ok: result?.ok || false,
        flow_project_id: result?.flow_project_id || '',
        tab_id: result?.tab_id || null,
        error: result?.ok ? null : (result?.error || 'Lỗi không xác định'),
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    logActivity('warn', `postProjectSwitchedResponse: ${err.message}`);
  }
}

async function processCaptchaRequest(request) {
  if (request.action === 'CREATE_PROJECT') {
    logActivity('info', `Create Project requested: ${request.project_name || 'unnamed'}`);
    const projResult = await handleCreateProject(request);
    await postProjectCreatedResponse(request.request_id, projResult);
    logActivity(projResult.ok ? 'info' : 'warn', projResult.ok
      ? `Project created successfully: ${projResult.flow_project_id}`
      : `Project creation failed: ${projResult.error}`);
    return;
  }
  if (request.action === 'SWITCH_PROJECT') {
    logActivity('info', `Switch Project requested: ${request.flow_project_id}`);
    const switchResult = await handleSwitchProject(request);
    await postProjectSwitchedResponse(request.request_id, switchResult);
    logActivity(switchResult.ok ? 'info' : 'warn', switchResult.ok
      ? `Project switched successfully: ${switchResult.flow_project_id}`
      : `Project switch failed: ${switchResult.error}`);
    return;
  }
  if (request.flow_recovery) {
    const recovered = await recoverCurrentSceneVideo();
    await postFlowResponse(request.request_id, recovered);
    return;
  }
  let result = await solveRecaptcha(request);
  if (!result.token && result.error?.includes('not ready')) {
    await sleep(3_000);
    result = await solveRecaptcha(request);
  }
  await postCaptchaResponse(request.request_id, result.token, result.error);
  if (!result.token) {
    onCaptchaFail();
    if (request.flow_request) {
      await postFlowResponse(request.request_id, { ok: false, error: result.error || 'reCAPTCHA failed' });
    }
    return;
  }
  onCaptchaSuccess();
  if (request.flow_request) {
    logActivity('info', `Flow generation dispatched: request=${request.request_id.slice(0, 8)}`);
    // Non-blocking promise: cho phép extension xử lý song song nhiều luồng video cùng lúc
    (async () => {
      try {
        const flowResult = await generateFlowVideo(request.flow_request, result.token);
        await postFlowResponse(request.request_id, flowResult);
        logActivity(flowResult.ok ? 'info' : 'warn', flowResult.ok
          ? `Flow generation completed: request=${request.request_id.slice(0, 8)}`
          : `Flow generation failed: ${flowResult.error}`);
      } catch (e) {
        await postFlowResponse(request.request_id, { ok: false, error: e?.message || 'Flow generation error' });
      }
    })();
  }
}

async function pushVoiceCookies() {
  if (!bridgeSecret) return;
  try {
    const all = await chrome.cookies.getAll({ domain: '.google.com' });
    const cookieMap = {};
    for (const c of all) {
      if (GOOGLE_VOICE_COOKIES.includes(c.name)) cookieMap[c.name] = c.value;
    }
    if (!Object.keys(cookieMap).length) return;

    let email = 'Unknown';
    if (cookieMap.SAPISID) {
      for (const [mail, acc] of Object.entries(harvestedAccounts)) {
        if (acc.cookie?.includes(`SAPISID=${cookieMap.SAPISID}`)) { email = mail; break; }
      }
    }
    await fetch(`${bridgeUrl}/voice/cookies`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': bridgeSecret },
      body: JSON.stringify({ cookies: cookieMap, email, ext_fp: extFp }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    logActivity('warn', `pushVoiceCookies: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. AUTO RELOAD / CACHE / HEARTBEAT
// ─────────────────────────────────────────────────────────────────────────────

async function clearLabsCache() {
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

async function clearTrackingCookiesAndRefresh() {
  if (!autoReloadEnabled) return;
  ensureHarvestCfg();
  if (autoClearCacheEnabled) await clearLabsCache();

  const keepPrefixes = harvestCfg.h?.ap || [];
  try {
    const cookies = await chrome.cookies.getAll({ domain: harvestCfg.h.d });
    for (const c of cookies) {
      if (keepPrefixes.some((p) => c.name.startsWith(p))) continue;
      const url = `https://${c.domain.replace(/^\./, '')}${c.path}`;
      await chrome.cookies.remove({ url, name: c.name });
    }
    const tabId = await findLabsTab();
    if (tabId) await chrome.tabs.reload(tabId);
  } catch { }
}

async function refreshLabsTab() {
  if (!autoReloadEnabled) return;
  const tabId = await findLabsTab();
  if (!tabId) return;
  try {
    await chrome.tabs.reload(tabId);
    await sleep(3_000);
    await warmUpRecaptcha(tabId);
  } catch { }
}

function startAutoClearCacheTimer() {
  stopAutoClearCacheTimer();
  if (!autoClearCacheEnabled || autoClearCacheSeconds <= 0) return;
  autoClearCacheTimer = setInterval(() => clearLabsCache(), autoClearCacheSeconds * 1_000);
}
function stopAutoClearCacheTimer() {
  if (autoClearCacheTimer) { clearInterval(autoClearCacheTimer); autoClearCacheTimer = null; }
}

async function doAutoReloadCycle() {
  if (!autoReloadEnabled) return;
  lastAutoReload = Date.now();
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
function startAutoReloadTimer() {
  stopAutoReloadTimer();
  if (!autoReloadEnabled || autoReloadMinutes <= 0) return;
  autoReloadTimer = setInterval(doAutoReloadCycle, autoReloadMinutes * 60 * 1_000);
}
function stopAutoReloadTimer() {
  if (autoReloadTimer) { clearInterval(autoReloadTimer); autoReloadTimer = null; }
}

async function sendHeartbeat() {
  try {
    if (!bridgeSecret) await fetchBridgeSecret();
    if (!extFp) await getExtFp();
    if (!bridgeSecret || !extFp) return;
    const tabs = await findAllLabsTabs();
    const manifest = chrome.runtime.getManifest();
    await fetch(`${bridgeUrl}/ext/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        ext_fp: extFp,
        version: manifest.version || '?',
        tab_count: tabs.length,
        user_agent: navigator.userAgent.slice(0, 120),
      }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    logActivity('warn', `heartbeat: ${e.message}`);
  }
}
function startHeartbeatTimer() {
  stopHeartbeatTimer();
  try { chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 }); } catch { }
  heartbeatTimer = setInterval(() => sendHeartbeat(), HEARTBEAT_MS);
  sendHeartbeat();
}
function stopHeartbeatTimer() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  try { chrome.alarms.clear('heartbeat'); } catch { }
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. CAPTCHA FRESH (reload + notify busy)
// ─────────────────────────────────────────────────────────────────────────────

let captchaFreshLockUntil = 0;
let captchaFreshInProgress = null;

async function prepareCaptchaFresh(tabId) {
  if (captchaFreshInProgress) { try { await captchaFreshInProgress; } catch { } return false; }
  const now = Date.now();
  if (now < captchaFreshLockUntil) return false;
  captchaFreshLockUntil = now + 30_000;

  async function notifyBusy(busy, timeoutSec = 20) {
    if (!bridgeSecret) return;
    try {
      await fetch(`${bridgeUrl}/captcha/busy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ busy: !!busy, timeout_sec: timeoutSec }),
        signal: AbortSignal.timeout(3_000),
      });
    } catch { }
  }

  captchaFreshInProgress = (async () => {
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

  try { return await captchaFreshInProgress; } finally { captchaFreshInProgress = null; }
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. EVENT CALLBACKS
// ─────────────────────────────────────────────────────────────────────────────

function onCaptchaSuccess() {
  tokenCount++;
  sessionCount++;
  failStreak = 0;
  lastSuccess = Date.now();
  saveState();
  if (sessionCount % TOKENS_PER_SESSION === 0) {
    clearTrackingCookiesAndRefresh();
  }
}

function onCaptchaFail() {
  failStreak++;
  saveState();
  if (failStreak >= FAIL_THRESHOLD) {
    refreshLabsTab();
    failStreak = 0;
    saveState();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 13. MAIN POLLING LOOP
// ─────────────────────────────────────────────────────────────────────────────

async function startPolling() {
  if (polling) return;
  polling = true;
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
  if (harvestedCookie && harvestedToken) {
    await pushCredentialsBatch(Object.values(harvestedAccounts));
  }

  let tick = 0;
  while (polling) {
    // Re-sync remote config mỗi 5 ticks nếu chỉ có fallback
    if (cfgIsFallback && tick % 5 === 0) {
      if (!bridgeSecret) await fetchBridgeSecret();
      await syncRemoteConfig();
    }
    tick++;

    try {
      const resp = await fetch(`${bridgeUrl}/captcha/request`, {
        headers: { 'X-Bridge-Key': bridgeSecret || '', 'X-Ext-FP': extFp || '' },
        signal: AbortSignal.timeout(6_000),
      });

      if (resp.status === 403) {
        // Secret bị từ chối → reset + re-handshake
        bridgeSecret = null;
        harvestCfg = null;
        cfgVersion = null;
        if (connected) { connected = false; saveState(); }
        await chrome.storage.local.remove('_vf_bridgeSecret');
        logActivity('warn', 'Secret rejected (403). Re-handshaking...');
        await fetchBridgeSecret();
        await syncRemoteConfig();
        const tid = await findLabsTab();
        if (tid) await harvestAndPushAll();
        else if (harvestedCookie && harvestedToken) {
          await pushCredentialsBatch(Object.values(harvestedAccounts));
        }

      } else if (resp.status === 200) {
        // Có yêu cầu captcha
        if (!connected) { connected = true; saveState(); }
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
        if (!connected) { connected = true; saveState(); }

      } else {
        if (connected) { connected = false; saveState(); }
      }
    } catch {
      if (connected) { connected = false; saveState(); }
    }

    await sleep(POLL_INTERVAL_MS);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 14. MESSAGE HANDLER (Popup & Content Script)
// ─────────────────────────────────────────────────────────────────────────────

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
      if (mail && harvestedAccounts[mail]) {
        harvestedAccounts[mail].credit = cred;
        updated = true;
      } else {
        for (const k of Object.keys(harvestedAccounts)) {
          harvestedAccounts[k].credit = cred;
          updated = true;
        }
      }
      if (updated) {
        pushCredentialsBatch(Object.values(harvestedAccounts));
      } else {
        harvestAndPushAll();
      }
    }
    reply({ ok: true });
    return true;
  }

  // ── Stats ──
  if (msg.type === 'GET_STATS') {
    if (!polling) startPolling();
    reply({
      tokenCount,
      sessionCount,
      lastSuccess,
      connected,
      polling,
      autoReloadEnabled,
      autoReloadMinutes,
      lastAutoReload,
      autoClearCacheEnabled,
      autoClearCacheSeconds,
      hasCredentials: !!harvestedToken,
      coreLoaded: !!harvestCfg && !cfgIsFallback,
      tokenPreview: harvestedToken ? harvestedToken.slice(0, 8) + '...' : null,
      accountsCount: Object.keys(harvestedAccounts).length,
      bridgePort,
    });
    return true;
  }

  // ── Accounts ──
  if (msg.type === 'GET_ACCOUNTS') {
    const accounts = Object.values(harvestedAccounts).map((a) => ({
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
    if (!polling) startPolling();
    (async () => {
      // Bridge
      let bridge = { ok: false, text: 'Not running' };
      try {
        const r = await fetch(`${bridgeUrl}/captcha/health`, { signal: AbortSignal.timeout(3_000) });
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

      const token = { ok: !!harvestedToken, text: harvestedToken ? 'Active' : 'Inactive' };
      const core = { ok: !!harvestCfg && !cfgIsFallback, text: harvestCfg ? (cfgIsFallback ? 'Fallback' : 'OK') : 'No' };

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
      reply({ ok: !!harvestedToken, has_token: !!harvestedToken, expiry: harvestedTokenExp });
    })();
    return true;
  }

  // ── Force push ──
  if (msg.type === 'FORCE_PUSH') {
    (async () => {
      const ok = await harvestAndPushAll();
      reply({ ok, has_token: !!harvestedToken, token_preview: harvestedToken?.slice(0, 8) + '...' });
    })();
    return true;
  }

  // ── Get credentials ──
  if (msg.type === 'GET_CREDENTIALS') {
    reply({ cookie: harvestedCookie, access_token: harvestedToken, expiry: harvestedTokenExp, has_credentials: !!harvestedToken });
    return true;
  }

  // ── Auto reload settings ──
  if (msg.type === 'SET_AUTO_RELOAD') {
    autoReloadEnabled = !!msg.enabled;
    if (msg.minutes != null && msg.minutes > 0) autoReloadMinutes = msg.minutes;
    saveState();
    if (autoReloadEnabled) startAutoReloadTimer();
    else stopAutoReloadTimer();
    reply({ ok: true, enabled: autoReloadEnabled, minutes: autoReloadMinutes });
    return true;
  }

  // ── Auto clear cache settings ──
  if (msg.type === 'SET_AUTO_CLEAR_CACHE') {
    autoClearCacheEnabled = !!msg.enabled;
    if (msg.seconds != null && msg.seconds > 0) autoClearCacheSeconds = msg.seconds;
    saveState();
    if (autoClearCacheEnabled) startAutoClearCacheTimer();
    else stopAutoClearCacheTimer();
    reply({ ok: true, enabled: autoClearCacheEnabled, seconds: autoClearCacheSeconds });
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
    if (!ok) { reply({ ok: false, port: bridgePort, error: 'Invalid port' }); return true; }
    bridgeSecret = null; harvestCfg = null; cfgIsFallback = true; cfgVersion = null; connected = false;
    (async () => {
      try { await chrome.storage.local.remove('_vf_bridgeSecret'); } catch { }
      await saveState();
      await fetchBridgeSecret();
      await syncRemoteConfig();
      logActivity('info', `Bridge port changed → ${bridgePort}`);
      reply({ ok: true, port: bridgePort });
    })();
    return true;
  }
  if (msg.type === 'GET_BRIDGE_PORT') {
    reply({ port: bridgePort });
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
          for (const [mail, acc] of Object.entries(harvestedAccounts)) {
            if (acc.cookie?.includes(`SAPISID=${cookieMap.SAPISID}`)) { email = mail; break; }
          }
        }
        if (bridgeSecret) {
          await fetch(`${bridgeUrl}/voice/cookies`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': bridgeSecret },
            body: JSON.stringify({ cookies: cookieMap, email, ext_fp: extFp }),
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
    reply({ entries: activityLog.slice(-50) });
    return false;
  }

  return false;
});

// ─────────────────────────────────────────────────────────────────────────────
// 15. TAB & COOKIE EVENT LISTENERS
// ─────────────────────────────────────────────────────────────────────────────

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  const url = tab?.url || '';
  if (changeInfo.status === 'complete' && (url.includes('labs.google') || url.includes('flow.google.com'))) {
    await sleep(1_000);
    await harvestAndPushAll();
    try { await sendHeartbeat(); } catch { }
  }
});

let lastCookieHeartbeat = 0;
try {
  chrome.cookies.onChanged.addListener((change) => {
    const d = change?.cookie?.domain || '';
    if (!d.includes('labs.google') && !d.includes('flow.google.com') && !d.includes('google.com')) return;
    const now = Date.now();
    if (now - lastCookieHeartbeat < 10_000) return;
    lastCookieHeartbeat = now;
    sendHeartbeat();
  });
} catch { }

// ─────────────────────────────────────────────────────────────────────────────
// 16. ALARMS — WATCHDOG
// ─────────────────────────────────────────────────────────────────────────────

chrome.alarms.create('watchdog', { periodInMinutes: WATCHDOG_MINUTES });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'heartbeat') {
    try { await sendHeartbeat(); } catch { }
    return;
  }

  if (alarm.name === 'watchdog') {
    if (!polling) startPolling();
    if (!bridgeSecret) await fetchBridgeSecret();
    if (!harvestCfg || cfgIsFallback) await syncRemoteConfig();

    if (bridgeSecret && harvestCfg) {
      if (!extFp) await getExtFp();

      // Poll captcha backup
      try {
        const r = await fetch(`${bridgeUrl}/captcha/request`, {
          headers: { 'X-Bridge-Key': bridgeSecret, 'X-Ext-FP': extFp || '' },
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
        const r = await fetch(`${bridgeUrl}/refresh/pending`, {
          headers: { 'X-Bridge-Key': bridgeSecret },
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
      if (harvestedCookie && harvestedToken) {
        try {
          const health = await fetch(`${bridgeUrl}/captcha/health`, { signal: AbortSignal.timeout(3_000) });
          if (health.ok) {
            const tr = await fetch(`${bridgeUrl}/token`, {
              headers: { 'X-Bridge-Key': bridgeSecret || '' },
              signal: AbortSignal.timeout(3_000),
            });
            if (tr.status === 403) {
              bridgeSecret = null; harvestCfg = null;
              await chrome.storage.local.remove('_vf_bridgeSecret');
              if (connected) { connected = false; saveState(); }
            } else if (tr.ok) {
              const data = await tr.json();
              if (!data.access_token) await pushCredentialsBatch(Object.values(harvestedAccounts));
            }
          }
        } catch { }
      }
    }
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// 17. KEEP-ALIVE PORT (từ content.js)
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'veoflow-keepalive') return;
  logActivity('info', 'Keep-alive port connected');
  port.onMessage.addListener(() => { });
  port.onDisconnect.addListener(() => logActivity('info', 'Keep-alive port disconnected'));
});

// ─────────────────────────────────────────────────────────────────────────────
// 18. STARTUP
// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  logActivity('info', 'Extension installed — starting polling');
  startPolling();
});

chrome.runtime.onStartup.addListener(() => {
  logActivity('info', 'Browser started — starting polling');
  startPolling();
});

// Cold start (service worker bị terminate rồi resume)
startPolling();
