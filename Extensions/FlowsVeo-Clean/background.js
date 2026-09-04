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
const POLL_INTERVAL_MS    = 2500;   // ms giữa các lần poll captcha/request
const FAIL_THRESHOLD      = 5;      // số lần thất bại captcha liên tiếp trước khi reload
const TOKENS_PER_SESSION  = 8;      // sau N token → xóa tracking cookies + refresh
const HEARTBEAT_MS        = 30_000; // ms giữa các heartbeat
const WATCHDOG_MINUTES    = 0.4;    // 24s mỗi vòng watchdog alarm
const ACTIVITY_LOG_MAX    = 50;     // số dòng log giữ trong bộ nhớ

const DEFAULT_HARVEST_CFG = {
  t: {
    p: 'https://labs.google/*',
    o: 'https://labs.google/fx/tools/flow',
  },
  h: {
    d:  'labs.google',
    cn: '__Secure-next-auth.session-token',
    u:  'https://labs.google/fx/api/auth/session',
    tf: ['access_token'],
    ti: 'https://oauth2.googleapis.com/tokeninfo',
    cu: 'https://aisandbox-pa.googleapis.com/v1/credits?key=AIzaSyBtrm0o5ab1c-Ec8ZuLcGt3oJAA5VWt3pY',
    co: 'https://labs.google',
    ap: [],  // cookie name prefixes giữ lại khi xóa tracking cookies
  },
  c: null, // captcha config, tải từ bridge
};

const GOOGLE_VOICE_COOKIES = [
  'SAPISID', '__Secure-1PAPISID', 'SID', 'HSID', 'SSID',
  '__Secure-1PSID', '__Secure-3PSID', '__Secure-1PSIDTS', '__Secure-3PSIDTS',
];

// ─────────────────────────────────────────────────────────────────────────────
// 2. TRẠNG THÁI RUNTIME
// ─────────────────────────────────────────────────────────────────────────────

let bridgePort    = DEFAULT_BRIDGE_PORT;
let bridgeUrl     = `http://127.0.0.1:${bridgePort}`;
let bridgeSecret  = null;    // X-Bridge-Key nhận từ bridge server
let extFp         = null;    // Extension fingerprint UUID (persistent)
let harvestCfg    = null;    // Cấu hình harvest (từ bridge hoặc mặc định)
let cfgVersion    = null;
let cfgIsFallback = true;

let polling   = false;
let connected = false;
let tokenCount    = 0;
let sessionCount  = 0;
let failStreak    = 0;
let lastSuccess   = null;
let harvestedCookie  = null;
let harvestedToken   = null;
let harvestedTokenExp = 0;
let harvestedAccounts = {}; // Map<email, AccountData>
let lastHarvestState  = null;

let autoReloadEnabled    = true;
let autoReloadMinutes    = 5;
let autoReloadTimer      = null;
let lastAutoReload       = null;

let autoClearCacheEnabled  = true;
let autoClearCacheSeconds  = 1;
let autoClearCacheTimer    = null;

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
  bridgeUrl  = `http://127.0.0.1:${bridgePort}`;
  return true;
}

/** Phân loại tier tài khoản từ dữ liệu credits */
function classifyTier(creditData) {
  const tier    = String(creditData.userPaygateTier || '').toUpperCase();
  const sku     = String(creditData.sku || '').toUpperCase();
  const service = String(creditData.serviceTier || '').toUpperCase();
  const credits = parseInt(creditData.credits || 0);
  const subCred = parseInt(creditData.subscriptionCredits || -1);

  if (tier.includes('TIER_TWO')  || sku.includes('TIER2'))           return 'ULTRA';
  if (tier.includes('TIER_ONE')  || sku.includes('TIER1'))           return 'PRO';
  if (tier.includes('NOT_PAID')  || sku.includes('FREE'))            return 'FREE';
  if (service.includes('ADVANCED'))                                   return 'ULTRA';
  if (service.includes('INTERMEDIATE') || service.includes('PRO'))   return 'PRO';
  if (service.includes('ENTRY')  || service.includes('STANDARD'))    return 'FREE';
  if (subCred > 0 || credits > 0)                                    return 'PRO';
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
      _vf_tokenCount:           tokenCount,
      _vf_sessionCount:         sessionCount,
      _vf_lastSuccess:          lastSuccess,
      _vf_connected:            connected,
      _vf_failStreak:           failStreak,
      _vf_harvestedCookie:      harvestedCookie,
      _vf_harvestedToken:       harvestedToken,
      _vf_harvestedTokenExp:    harvestedTokenExp,
      _vf_autoReloadEnabled:    autoReloadEnabled,
      _vf_autoReloadMinutes:    autoReloadMinutes,
      _vf_lastAutoReload:       lastAutoReload,
      _vf_autoClearCacheEnabled: autoClearCacheEnabled,
      _vf_autoClearCacheSeconds: autoClearCacheSeconds,
      _vf_bridgePort:           bridgePort,
    });
  } catch {}
}

async function restoreState() {
  try {
    const d = await chrome.storage.local.get([
      '_vf_tokenCount', '_vf_sessionCount', '_vf_lastSuccess', '_vf_connected',
      '_vf_failStreak', '_vf_harvestedCookie', '_vf_harvestedToken',
      '_vf_harvestedTokenExp', '_vf_autoReloadEnabled', '_vf_autoReloadMinutes',
      '_vf_lastAutoReload', '_vf_autoClearCacheEnabled', '_vf_autoClearCacheSeconds', '_vf_bridgePort',
    ]);
    if (d._vf_bridgePort          != null) setBridgePort(d._vf_bridgePort);
    if (d._vf_tokenCount          != null) tokenCount           = d._vf_tokenCount;
    if (d._vf_sessionCount        != null) sessionCount         = d._vf_sessionCount;
    if (d._vf_lastSuccess         != null) lastSuccess          = d._vf_lastSuccess;
    if (d._vf_connected           != null) connected            = d._vf_connected;
    if (d._vf_failStreak          != null) failStreak           = d._vf_failStreak;
    if (d._vf_harvestedCookie     != null) harvestedCookie      = d._vf_harvestedCookie;
    if (d._vf_harvestedToken      != null) harvestedToken       = d._vf_harvestedToken;
    if (d._vf_harvestedTokenExp   != null) harvestedTokenExp    = d._vf_harvestedTokenExp;
    if (d._vf_autoReloadEnabled   != null) autoReloadEnabled    = d._vf_autoReloadEnabled;
    if (d._vf_autoReloadMinutes   != null) autoReloadMinutes    = d._vf_autoReloadMinutes;
    if (d._vf_lastAutoReload      != null) lastAutoReload       = d._vf_lastAutoReload;
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

async function fetchBridgeSecret() {
  try {
    const resp = await fetch(`${bridgeUrl}/bridge/secret`, {
      cache: 'no-store',
      signal: AbortSignal.timeout(5_000),
    });
    if (resp.ok) {
      const json = await resp.json();
      if (json.secret) {
        bridgeSecret = json.secret;
        await chrome.storage.local.set({ _vf_bridgeSecret: bridgeSecret });
        logActivity('info', `Bridge secret synced: ${bridgeSecret.slice(0, 8)}...`);
        return true;
      }
    }
  } catch {}
  // Fallback: cố đọc từ storage
  try {
    const d = await chrome.storage.local.get(['_vf_bridgeSecret']);
    if (d._vf_bridgeSecret) { bridgeSecret = d._vf_bridgeSecret; return true; }
  } catch {}
  return false;
}

async function syncRemoteConfig() {
  if (!bridgeSecret) return false;
  try {
    const resp = await fetch(`${bridgeUrl}/api/v1/config/init`, {
      headers: { 'X-Bridge-Key': bridgeSecret },
      signal: AbortSignal.timeout(5_000),
    });
    if (!resp.ok) return false;
    const json = await resp.json();
    if (json.payload) {
      const decoded = JSON.parse(atob(json.payload));
      harvestCfg    = decoded;
      cfgVersion    = json.v || '?';
      cfgIsFallback = false;
      logActivity('info', `Remote config loaded v${cfgVersion}`);
      return true;
    }
  } catch (e) {
    logActivity('warn', `syncRemoteConfig: ${e.message}`);
  }
  return false;
}

function ensureHarvestCfg() {
  if (!harvestCfg) {
    harvestCfg    = JSON.parse(JSON.stringify(DEFAULT_HARVEST_CFG));
    cfgIsFallback = true;
  }
  harvestCfg.t = harvestCfg.t || DEFAULT_HARVEST_CFG.t;
  harvestCfg.h = harvestCfg.h || DEFAULT_HARVEST_CFG.h;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. TAB MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

async function findAllLabsTabs() {
  ensureHarvestCfg();
  try {
    return (await chrome.tabs.query({ url: harvestCfg.t.p })) || [];
  } catch {
    return [];
  }
}

async function findLabsTab() {
  const tabs = await findAllLabsTabs();
  return tabs.length > 0 ? tabs[0].id : null;
}

async function openLabsTab() {
  ensureHarvestCfg();
  try {
    logActivity('info', 'No labs tab open — auto-opening...');
    const tab = await chrome.tabs.create({ url: harvestCfg.t.o, active: false });
    await new Promise((resolve) => {
      const listener = (tabId, info) => {
        if (tabId === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      setTimeout(() => { chrome.tabs.onUpdated.removeListener(listener); resolve(); }, 15_000);
    });
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

/** Khởi động (warm-up) grecaptcha trong tab */
async function warmUpRecaptcha(tabId) {
  ensureHarvestCfg();
  if (!harvestCfg.c) return;
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: (cfg) => {
        try {
          const module = window[cfg.m];
          if (module && module[cfg.s] && typeof module[cfg.s].ready === 'function') {
            module[cfg.s].ready(() => {});
            return true;
          }
          // Nếu chưa load → inject enterprise.js
          if (cfg.q && !document.querySelectorAll(cfg.q).length) {
            const s = document.createElement('script');
            s.src   = 'https://www.google.com/recaptcha/enterprise.js';
            s.async = true;
            document.head.appendChild(s);
          }
          return false;
        } catch { return false; }
      },
      args: [harvestCfg.c],
    });
  } catch {}
}

/** Kiểm tra grecaptcha đã sẵn sàng trong tab chưa */
async function checkRecaptchaReady(tabId) {
  if (!harvestCfg?.c) return { available: false, error: 'Config not loaded' };
  const tid = tabId || await findLabsTab();
  if (!tid)   return { available: false, error: 'No labs tab' };
  await warmUpRecaptcha(tid);

  for (let i = 0; i < 10; i++) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId: tid },
        world: 'MAIN',
        func: (cfg) => {
          const ok =
            typeof window[cfg.m] !== 'undefined' &&
            !!window[cfg.m]?.[cfg.s] &&
            typeof window[cfg.m][cfg.s].execute === 'function';
          return { available: ok, error: ok ? null : 'Module not found' };
        },
        args: [harvestCfg.c],
      });
      const res = results?.[0]?.result;
      if (res?.available) return res;
    } catch {}
    if (i < 5) await sleep(800);
  }
  return { available: false, error: 'Timeout waiting for recaptcha' };
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

  await warmUpRecaptcha(tabId);
  const siteKey = request.site_key || request.recaptcha_ent_key || '';
  const action  = request.action  || harvestCfg.c?.da || 'submit';

  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: async (cfg, siteKey, action) => {
        try {
          const module = window[cfg.m];
          if (!module || !module[cfg.s]) return { token: null, error: 'Module not ready' };

          // Resolve site key nếu không truyền
          let resolvedKey = siteKey;
          if (!resolvedKey && cfg.g && cfg.k) {
            try {
              const registry = window[cfg.g]?.[cfg.k];
              if (registry) {
                outer: for (const k1 of Object.keys(registry)) {
                  for (const k2 of Object.keys(registry[k1] || {})) {
                    const item = registry[k1][k2];
                    if (item && typeof item === 'object' && item[cfg.p]) {
                      resolvedKey = item[cfg.p]; break outer;
                    }
                  }
                }
              }
            } catch {}
          }
          if (!resolvedKey) return { token: null, error: 'No site key found' };

          await new Promise((r) => module[cfg.s].ready(r));
          const token = await module[cfg.s].execute(resolvedKey, { action });
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

  logActivity('info', `[harvest] tab=${tab.id} incognito=${tab.incognito}`);

  // 1. Lấy cookie session
  let storeId = tab.cookieStoreId || (tab.incognito ? '1' : '0');
  let cookies;
  try {
    cookies = await chrome.cookies.getAll({ domain: hcfg.d, storeId });
    if (!cookies?.length) {
      // Thử tìm đúng store qua tab id
      const stores = await chrome.cookies.getAllCookieStores();
      for (const store of stores) {
        if (store.tabIds?.includes(tab.id)) {
          cookies = await chrome.cookies.getAll({ domain: hcfg.d, storeId: store.id });
          storeId = store.id;
          break;
        }
      }
    }
  } catch (e) { return null; }

  if (!cookies?.length) {
    logActivity('warn', `[harvest] tab=${tab.id} — no cookies`);
    return null;
  }

  const sessionCookies = cookies.filter((c) => c.name === hcfg.cn);
  if (!sessionCookies.length) return null;

  // 2. Lấy access_token + email qua fetch session API trong tab
  let sessionData = null;
  try {
    const res = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      func: async (sessionUrl, tokenFields) => {
        try {
          const resp = await fetch(sessionUrl, { credentials: 'include', cache: 'no-store' });
          if (!resp.ok) return null;
          const body = await resp.json();
          let accessToken = null;
          for (const field of tokenFields) {
            if (body[field]) { accessToken = body[field]; break; }
          }
          return { email: body?.user?.email || null, access_token: accessToken };
        } catch { return null; }
      },
      args: [hcfg.u, hcfg.tf],
    });
    sessionData = res?.[0]?.result;
  } catch {}

  if (!sessionData?.email || !sessionData?.access_token) {
    logActivity('warn', `[harvest] tab=${tab.id} — session fetch failed`);
    return null;
  }

  const email       = sessionData.email;
  const accessToken = sessionData.access_token;

  // 3. Chọn cookie session tươi nhất
  const picked = sessionCookies.length === 1
    ? sessionCookies[0]
    : [...sessionCookies].sort((a, b) => (b.expirationDate || 0) - (a.expirationDate || 0))[0];

  // 4. Build cookie string (session + google.com cookies)
  let cookieStr = `${picked.name}=${picked.value}`;
  try {
    const googleCookies = await chrome.cookies.getAll({ domain: '.google.com', storeId });
    for (const c of googleCookies) {
      if (GOOGLE_VOICE_COOKIES.includes(c.name)) {
        cookieStr += `; ${c.name}=${c.value}`;
      }
    }
  } catch (e) { logActivity('warn', `[harvest] google.com cookies: ${e.message}`); }

  // 5. Lấy thời gian hết hạn token
  let tokenExp = 0;
  try {
    const tiResp = await fetch(`${hcfg.ti}?access_token=${accessToken}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (tiResp.ok) {
      const tiData = await tiResp.json();
      tokenExp = parseInt(tiData.exp || '0');
    }
  } catch {}

  // 6. Lấy credits
  let tier   = 'FREE';
  let credit = 0;
  try {
    if (hcfg.cu) {
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
        const b           = cuData.body;
        const credits     = parseInt(b.credits ?? -1) || 0;
        const subCredits  = parseInt(b.subscriptionCredits ?? -1) || 0;
        const remaining   = parseInt(b.remainingCredits ?? -1)    || 0;
        const candidates  = [subCredits, remaining, credits].filter((v) => v > 0);
        credit = candidates.length ? Math.min(...candidates) : 0;
        tier   = classifyTier(b);
      }
    }
  } catch {}

  logActivity('info', `[harvest] ${email} — tier:${tier} credits:${credit}`);

  return {
    email,
    cookie:       cookieStr,
    access_token: accessToken,
    expiry:       tokenExp,
    tier,
    credit,
    tabId:        tab.id,
    tabUrl:       tab.url || '',
    incognito:    !!tab.incognito,
    lastSeen:     Date.now(),
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
    } catch {}
  }

  if (!tabs.length) {
    logActivity('info', 'No labs tabs open — nothing to harvest');
    return [];
  }

  // Ưu tiên tab đang active
  const activeId = await getActiveTabId();
  tabs.sort((a, b) => {
    if (a.id === activeId) return -1;
    if (b.id === activeId) return  1;
    return 0;
  });

  const results  = [];
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
    const mobile   = uaData?.mobile ? '?1' : '?0';

    const payload = {
      ext_fp: extFp,
      credentials: (accounts || []).map((a) => ({
        email:          a.email,
        cookie:         a.cookie,
        access_token:   a.access_token,
        expiry:         a.expiry,
        tier:           a.tier,
        credit:         a.credit,
        tab_id:         a.tabId,
        incognito:      a.incognito,
        user_agent:     navigator.userAgent,
        sec_ch_ua:      secChUa,
        sec_ch_ua_platform: platform,
        sec_ch_ua_mobile:   mobile,
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
  const tabs     = await findAllLabsTabs();
  const accounts = await harvestAllAccounts();

  if (!accounts.length) {
    if (!tabs.length) {
      if (lastHarvestState === 'valid') {
        logActivity('warn', 'State: VALID → INVALID (no tabs). Pool cleared.');
      }
      lastHarvestState  = 'invalid';
      harvestedAccounts = {};
      harvestedCookie   = null;
      harvestedToken    = null;
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

  const first       = accounts[0];
  harvestedCookie   = first.cookie;
  harvestedToken    = first.access_token;
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
  } catch {}
}

async function refreshLabsTab() {
  if (!autoReloadEnabled) return;
  const tabId = await findLabsTab();
  if (!tabId) return;
  try {
    await chrome.tabs.reload(tabId);
    await sleep(3_000);
    await warmUpRecaptcha(tabId);
  } catch {}
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
    } catch {}
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
    if (!extFp)        await getExtFp();
    if (!bridgeSecret || !extFp) return;
    const tabs    = await findAllLabsTabs();
    const manifest = chrome.runtime.getManifest();
    await fetch(`${bridgeUrl}/ext/heartbeat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({
        ext_fp:    extFp,
        version:   manifest.version || '?',
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
  try { chrome.alarms.create('heartbeat', { periodInMinutes: 0.5 }); } catch {}
  heartbeatTimer = setInterval(() => sendHeartbeat(), HEARTBEAT_MS);
  sendHeartbeat();
}
function stopHeartbeatTimer() {
  if (heartbeatTimer) { clearInterval(heartbeatTimer); heartbeatTimer = null; }
  try { chrome.alarms.clear('heartbeat'); } catch {}
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. CAPTCHA FRESH (reload + notify busy)
// ─────────────────────────────────────────────────────────────────────────────

let captchaFreshLockUntil   = 0;
let captchaFreshInProgress  = null;

async function prepareCaptchaFresh(tabId) {
  if (captchaFreshInProgress) { try { await captchaFreshInProgress; } catch {} return false; }
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
    } catch {}
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
        bridgeSecret  = null;
        harvestCfg    = null;
        cfgVersion    = null;
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
        if (request?.request_id) {
          let result = await solveRecaptcha(request);
          if (!result.token && result.error?.includes('not ready')) {
            await sleep(3_000);
            result = await solveRecaptcha(request);
          }
          await postCaptchaResponse(request.request_id, result.token, result.error);
          if (result.token) onCaptchaSuccess();
          else              onCaptchaFail();
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
      coreLoaded:     !!harvestCfg && !cfgIsFallback,
      tokenPreview:   harvestedToken ? harvestedToken.slice(0, 8) + '...' : null,
      accountsCount:  Object.keys(harvestedAccounts).length,
      bridgePort,
    });
    return true;
  }

  // ── Accounts ──
  if (msg.type === 'GET_ACCOUNTS') {
    const accounts = Object.values(harvestedAccounts).map((a) => ({
      email:    a.email,
      tier:     a.tier,
      credit:   a.credit,
      tabId:    a.tabId,
      incognito: a.incognito,
      expiry:   a.expiry,
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
      } catch {}

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
      const core  = { ok: !!harvestCfg && !cfgIsFallback, text: harvestCfg ? (cfgIsFallback ? 'Fallback' : 'OK') : 'No' };

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
      else     tid = await openLabsTab();
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
    else                   stopAutoReloadTimer();
    reply({ ok: true, enabled: autoReloadEnabled, minutes: autoReloadMinutes });
    return true;
  }

  // ── Auto clear cache settings ──
  if (msg.type === 'SET_AUTO_CLEAR_CACHE') {
    autoClearCacheEnabled = !!msg.enabled;
    if (msg.seconds != null && msg.seconds > 0) autoClearCacheSeconds = msg.seconds;
    saveState();
    if (autoClearCacheEnabled) startAutoClearCacheTimer();
    else                       stopAutoClearCacheTimer();
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
      try { await chrome.storage.local.remove('_vf_bridgeSecret'); } catch {}
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
        const storeId    = activeTabs[0]?.cookieStoreId || (activeTabs[0]?.incognito ? '1' : '0');
        const all        = await chrome.cookies.getAll({ domain: '.google.com', storeId });
        const cookieMap  = {};
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
  if (!harvestCfg?.t) return;
  const targetOrigin = harvestCfg.t.p.replace('/*', '/');
  if (changeInfo.status === 'complete' && tab.url?.startsWith(targetOrigin)) {
    await sleep(1_000);
    await harvestAndPushAll();
    try { await sendHeartbeat(); } catch {}
  }
});

let lastCookieHeartbeat = 0;
try {
  chrome.cookies.onChanged.addListener((change) => {
    if (!change?.cookie?.domain?.includes('labs.google')) return;
    const now = Date.now();
    if (now - lastCookieHeartbeat < 10_000) return;
    lastCookieHeartbeat = now;
    sendHeartbeat();
  });
} catch {}

// ─────────────────────────────────────────────────────────────────────────────
// 16. ALARMS — WATCHDOG
// ─────────────────────────────────────────────────────────────────────────────

chrome.alarms.create('watchdog', { periodInMinutes: WATCHDOG_MINUTES });

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'heartbeat') {
    try { await sendHeartbeat(); } catch {}
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
            const result = await solveRecaptcha(req);
            await postCaptchaResponse(req.request_id, result.token, result.error);
            if (result.token) onCaptchaSuccess();
            else              onCaptchaFail();
          }
        }
      } catch {}

      // Push voice cookies
      await pushVoiceCookies();

      // Kiểm tra refresh pending (bridge báo 403/429)
      try {
        const r = await fetch(`${bridgeUrl}/refresh/pending`, {
          headers: { 'X-Bridge-Key': bridgeSecret },
          signal: AbortSignal.timeout(4_000),
        });
        if (r.status === 200) {
          const data     = await r.json();
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
      } catch {}

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
        } catch {}
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
  port.onMessage.addListener(() => {});
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
