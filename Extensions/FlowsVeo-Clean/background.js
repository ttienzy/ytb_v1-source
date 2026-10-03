(() => {
  // src/config/defaults.js
  var DEFAULT_BRIDGE_PORT = 60526;
  var POLL_INTERVAL_MS = 2500;
  var FAIL_THRESHOLD = 5;
  var TOKENS_PER_SESSION = 8;
  var HEARTBEAT_MS = 3e4;
  var WATCHDOG_MINUTES = 0.4;
  var ACTIVITY_LOG_MAX = 50;
  var DEFAULT_HARVEST_CFG = {
    t: {
      p: ["https://labs.google/*", "https://flow.google.com/*"],
      o: "https://flow.google.com/"
    },
    h: {
      d: "labs.google",
      cn: "__Secure-next-auth.session-token",
      u: "https://labs.google/fx/api/auth/session",
      tf: ["access_token"],
      ti: "https://oauth2.googleapis.com/tokeninfo",
      cu: "https://aisandbox-pa.googleapis.com/v1/credits",
      co: "https://labs.google",
      ap: []
      // cookie name prefixes giữ lại khi xóa tracking cookies
    },
    c: {
      m: "grecaptcha",
      s: "enterprise",
      da: "submit",
      g: "___grecaptcha_cfg",
      k: "clients",
      p: "sitekey",
      q: 'script[src*="enterprise.js"]'
    }
  };
  var GOOGLE_VOICE_COOKIES = [
    "SAPISID",
    "__Secure-1PAPISID",
    "SID",
    "HSID",
    "SSID",
    "__Secure-1PSID",
    "__Secure-3PSID",
    "__Secure-1PSIDTS",
    "__Secure-3PSIDTS"
  ];
  var CANDIDATE_PORTS = [60526, 56526, 46526, 36526];

  // src/background/runtime/state.js
  var runtime = {
    bridgePort: DEFAULT_BRIDGE_PORT,
    bridgeUrl: `http://127.0.0.1:${DEFAULT_BRIDGE_PORT}`,
    bridgeSecret: null,
    extFp: null,
    harvestCfg: null,
    cfgVersion: null,
    cfgIsFallback: true,
    polling: false,
    connected: false,
    tokenCount: 0,
    sessionCount: 0,
    failStreak: 0,
    lastSuccess: null,
    harvestedCookie: null,
    harvestedToken: null,
    harvestedTokenExp: 0,
    harvestedAccounts: {},
    lastHarvestState: null,
    autoReloadEnabled: true,
    autoReloadMinutes: 5,
    autoReloadTimer: null,
    lastAutoReload: null,
    autoClearCacheEnabled: false,
    autoClearCacheSeconds: 300,
    autoClearCacheTimer: null,
    activeGenerationCount: 0,
    imageUiBusy: false,
    videoUiBusy: false,
    heartbeatTimer: null,
    activityLog: [],
    captchaFreshLockUntil: 0,
    captchaFreshInProgress: null,
    lastCookieHeartbeat: 0
  };

  // src/background/runtime/log.js
  function logActivity(level, msg) {
    const entry = {
      time: (/* @__PURE__ */ new Date()).toLocaleTimeString("en-GB", { hour12: false }),
      level: level || "info",
      msg: String(msg).slice(0, 500)
    };
    runtime.activityLog.push(entry);
    if (runtime.activityLog.length > ACTIVITY_LOG_MAX) runtime.activityLog.shift();
    console.log(`[FlowsVeo][${level}] ${msg}`);
  }

  // src/platform/keepalive.js
  function registerKeepalive() {
    chrome.runtime.onConnect.addListener((port) => {
      if (port.name !== "veoflow-keepalive") return;
      logActivity("info", "Keep-alive port connected");
      port.onMessage.addListener(() => {
      });
      port.onDisconnect.addListener(() => logActivity("info", "Keep-alive port disconnected"));
    });
  }

  // src/contracts/bridge.js
  var BRIDGE_PROTOCOL = "flowsveo-legacy-http/1";
  var BRIDGE_ROUTES = Object.freeze({
    secret: "/bridge/secret",
    config: "/api/v1/config/init",
    nextJob: "/captcha/request",
    captchaResult: "/captcha/response",
    health: "/captcha/health",
    busy: "/captcha/busy",
    credentials: "/credentials/push",
    flowResult: "/flow/response",
    imageResult: "/flow/image-response",
    uploadResult: "/flow/video-upload-response",
    projectCreated: "/flow/project-created",
    projectSwitched: "/flow/project-switched",
    heartbeat: "/ext/heartbeat",
    voiceCookies: "/voice/cookies",
    pendingRefresh: "/refresh/pending",
    token: "/token"
  });

  // src/bridge/legacy-http.js
  var legacyHttp = {
    request(operation, options, port) {
      const route = BRIDGE_ROUTES[operation];
      if (!route) throw new Error(`Unknown bridge operation: ${operation}`);
      return fetch(`http://127.0.0.1:${port}${route}`, options);
    }
  };

  // src/bridge/client.js
  function bridgeRequest(operation, options, port = runtime.bridgePort) {
    return legacyHttp.request(operation, options, port);
  }
  function authHeaders(extra = {}) {
    return {
      "Content-Type": "application/json",
      "X-Bridge-Key": runtime.bridgeSecret || "",
      "X-Ext-FP": runtime.extFp || "",
      ...extra
    };
  }
  function setBridgePort(port) {
    const p = parseInt(port);
    if (!p || p < 1 || p > 65535) return false;
    runtime.bridgePort = p;
    runtime.bridgeUrl = `http://127.0.0.1:${runtime.bridgePort}`;
    return true;
  }

  // src/bridge/responses.js
  async function pushCredentialsBatch(accounts) {
    try {
      const uaData = navigator.userAgentData;
      const secChUa = uaData?.brands ? uaData.brands.map((b) => `"${b.brand}";v="${b.version}"`).join(", ") : "";
      const platform = uaData?.platform ? `"${uaData.platform}"` : '"Windows"';
      const mobile = uaData?.mobile ? "?1" : "?0";
      const payload = {
        ext_fp: runtime.extFp,
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
          sec_ch_ua_mobile: mobile
        }))
      };
      const resp = await bridgeRequest("credentials", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8e3)
      });
      if (resp.ok) {
        logActivity("info", `Pushed ${payload.credentials.length} credential(s)`);
        return true;
      }
      logActivity("warn", `Push batch failed: HTTP ${resp.status}`);
    } catch (e) {
      logActivity("warn", `pushCredentialsBatch: ${e.message}`);
    }
    return false;
  }
  async function postCaptchaResponse(requestId, token, error) {
    try {
      await bridgeRequest("captchaResult", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          request_id: requestId,
          token,
          error: error || null,
          user_agent: navigator.userAgent
        }),
        signal: AbortSignal.timeout(8e3)
      });
    } catch (e) {
      logActivity("warn", `postCaptchaResponse: ${e.message}`);
    }
  }
  async function postImageResponse(requestId, result) {
    try {
      await bridgeRequest("imageResult", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          request_id: requestId,
          result: result || null,
          error: result?.ok ? null : result?.error || "Unknown Image error",
          logs: runtime.activityLog.slice(-10)
        }),
        signal: AbortSignal.timeout(1e4)
      });
    } catch (error) {
      logActivity("warn", `postImageResponse: ${error.message}`);
    }
  }
  async function postVideoUploadResponse(requestId, result) {
    try {
      await bridgeRequest("uploadResult", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          request_id: requestId,
          ok: result?.ok || false,
          media_id: result?.media_id || null,
          project_id: result?.project_id || null,
          error: result?.ok ? null : result?.error || "Unknown video upload error",
          logs: runtime.activityLog.slice(-5)
        }),
        signal: AbortSignal.timeout(1e4)
      });
    } catch (err) {
      logActivity("warn", `postVideoUploadResponse: ${err.message}`);
    }
  }
  async function postFlowResponse(requestId, result) {
    try {
      await bridgeRequest("flowResult", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          request_id: requestId,
          result: result?.ok ? result : null,
          error: result?.ok ? null : result?.error || "Unknown Flow error"
        }),
        signal: AbortSignal.timeout(8e3)
      });
    } catch (error) {
      logActivity("warn", `postFlowResponse: ${error.message}`);
    }
  }
  async function postProjectCreatedResponse(requestId, result) {
    try {
      await bridgeRequest("projectCreated", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          request_id: requestId,
          ok: result?.ok || false,
          flow_project_id: result?.flow_project_id || "",
          account_email: result?.account_email || "",
          error: result?.ok ? null : result?.error || "Lỗi không xác định"
        }),
        signal: AbortSignal.timeout(8e3)
      });
    } catch (err) {
      logActivity("warn", `postProjectCreatedResponse: ${err.message}`);
    }
  }
  async function postProjectSwitchedResponse(requestId, result) {
    try {
      await bridgeRequest("projectSwitched", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          request_id: requestId,
          ok: result?.ok || false,
          flow_project_id: result?.flow_project_id || "",
          tab_id: result?.tab_id || null,
          error: result?.ok ? null : result?.error || "Lỗi không xác định"
        }),
        signal: AbortSignal.timeout(8e3)
      });
    } catch (err) {
      logActivity("warn", `postProjectSwitchedResponse: ${err.message}`);
    }
  }

  // src/platform/storage.js
  async function getExtFp() {
    if (runtime.extFp) return runtime.extFp;
    try {
      const data = await chrome.storage.local.get(["_vf_extInstanceFp", "_vf_extFp"]);
      if (data._vf_extInstanceFp || data._vf_extFp) {
        runtime.extFp = data._vf_extInstanceFp || data._vf_extFp;
        return runtime.extFp;
      }
      runtime.extFp = crypto.randomUUID && crypto.randomUUID() || `ext-${Date.now()}-${Math.random().toString(36).slice(-8)}`;
      await chrome.storage.local.set({ _vf_extInstanceFp: runtime.extFp, _vf_extFp: runtime.extFp });
    } catch {
      runtime.extFp = `ext-fallback-${Date.now()}`;
    }
    return runtime.extFp;
  }
  async function saveState() {
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
        _vf_bridgePort: runtime.bridgePort
      });
    } catch {
    }
  }
  async function restoreState() {
    try {
      const d = await chrome.storage.local.get([
        "_vf_tokenCount",
        "_vf_sessionCount",
        "_vf_lastSuccess",
        "_vf_connected",
        "_vf_failStreak",
        "_vf_harvestedCookie",
        "_vf_harvestedToken",
        "_vf_harvestedTokenExp",
        "_vf_autoReloadEnabled",
        "_vf_autoReloadMinutes",
        "_vf_lastAutoReload",
        "_vf_autoClearCacheEnabled",
        "_vf_autoClearCacheSeconds",
        "_vf_bridgePort"
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
      runtime.autoClearCacheSeconds = d._vf_autoClearCacheSeconds ?? 1;
      logActivity("info", `State restored — tokens:${runtime.tokenCount} connected:${runtime.connected}`);
    } catch (e) {
      logActivity("warn", `restoreState error: ${e.message}`);
    }
  }

  // src/bridge/config.js
  async function trySecretOnPort(p) {
    try {
      const resp = await bridgeRequest("secret", {
        cache: "no-store",
        signal: AbortSignal.timeout(2e3)
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
          logActivity("info", `Bridge secret synced on port ${p}: ${runtime.bridgeSecret.slice(0, 8)}...`);
          return true;
        }
      }
    } catch {
    }
    return false;
  }
  async function fetchBridgeSecret() {
    if (await trySecretOnPort(runtime.bridgePort)) return true;
    for (const p of CANDIDATE_PORTS) {
      if (p === runtime.bridgePort) continue;
      if (await trySecretOnPort(p)) return true;
    }
    try {
      const d = await chrome.storage.local.get(["_vf_bridgeSecret"]);
      if (d._vf_bridgeSecret) {
        runtime.bridgeSecret = d._vf_bridgeSecret;
        return true;
      }
    } catch {
    }
    return false;
  }
  async function syncRemoteConfig() {
    if (!runtime.bridgeSecret) return false;
    try {
      const resp = await bridgeRequest("config", {
        method: "POST",
        headers: { "X-Bridge-Key": runtime.bridgeSecret },
        signal: AbortSignal.timeout(5e3)
      });
      if (!resp.ok) throw new Error(`Config HTTP ${resp.status}`);
      const json = await resp.json();
      if (typeof json.payload === "string" && json.payload) {
        const decoded = JSON.parse(atob(json.payload));
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded) || !decoded.c || typeof decoded.c !== "object" || Array.isArray(decoded.c) || typeof decoded.c.m !== "string" || !decoded.c.m.trim() || typeof decoded.c.s !== "string" || !decoded.c.s.trim()) {
          throw new Error("Invalid config: missing CAPTCHA module configuration");
        }
        runtime.harvestCfg = decoded;
        ensureHarvestCfg();
        runtime.cfgVersion = json.v || "?";
        runtime.cfgIsFallback = false;
        logActivity("info", `Remote config loaded v${runtime.cfgVersion}`);
        return true;
      }
      throw new Error("Invalid config response: missing payload");
    } catch (e) {
      logActivity("warn", `syncRemoteConfig: ${e.message}`);
    }
    return false;
  }
  function ensureHarvestCfg() {
    if (!runtime.harvestCfg) {
      runtime.harvestCfg = JSON.parse(JSON.stringify(DEFAULT_HARVEST_CFG));
      runtime.cfgIsFallback = true;
    }
    runtime.harvestCfg.t = runtime.harvestCfg.t || DEFAULT_HARVEST_CFG.t;
    runtime.harvestCfg.h = runtime.harvestCfg.h || DEFAULT_HARVEST_CFG.h;
    runtime.harvestCfg.c = runtime.harvestCfg.c || DEFAULT_HARVEST_CFG.c;
  }

  // src/providers/google-flow/page/captcha.js
  async function inspectRecaptchaInPage(cfg, waitMs = 0) {
    const deadline = Date.now() + waitMs;
    const homePage = location.hostname === "flow.google.com" && !/\/project\//.test(location.pathname);
    let state;
    do {
      const api = window[cfg.m]?.[cfg.s];
      const moduleReady = typeof api?.ready === "function" && typeof api?.execute === "function";
      let siteKey = "";
      let keySource = null;
      for (const script of document.scripts) {
        try {
          const url = new URL(script.src, location.href);
          if (!["www.google.com", "www.recaptcha.net"].includes(url.hostname) || url.pathname !== "/recaptcha/enterprise.js") continue;
          const key = url.searchParams.get("render");
          if (key && key !== "explicit") {
            siteKey = key;
            keySource = "script-render";
            break;
          }
        } catch {
        }
      }
      if (!siteKey) {
        siteKey = document.querySelector("[data-sitekey]")?.getAttribute("data-sitekey") || "";
        if (siteKey) keySource = "data-sitekey";
      }
      if (!siteKey && cfg.g && cfg.k && cfg.p) {
        const registry = window[cfg.g]?.[cfg.k];
        for (const client of Object.values(registry || {})) {
          for (const item of Object.values(client || {})) {
            if (item && typeof item[cfg.p] === "string" && item[cfg.p]) {
              siteKey = item[cfg.p];
              keySource = "registry";
              break;
            }
          }
          if (siteKey) break;
        }
      }
      const error = !moduleReady ? homePage ? "Open a Flow project: reCAPTCHA is not loaded on the home page" : "Timed out waiting for the Flow page to load reCAPTCHA" : !siteKey ? "No site key found in the Flow page" : null;
      state = { available: moduleReady && !!siteKey, moduleReady, siteKey, keySource, error };
      if (state.available || homePage || Date.now() >= deadline) return state;
      await new Promise((resolve) => setTimeout(resolve, 200));
    } while (Date.now() < deadline);
    return state;
  }

  // src/providers/google-flow/recaptcha-probe.js
  async function warmUpRecaptcha(tabId, waitMs = 8e3) {
    ensureHarvestCfg();
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: inspectRecaptchaInPage,
        args: [runtime.harvestCfg.c, waitMs]
      });
      return results?.[0]?.result || { available: false, error: "No reCAPTCHA probe result" };
    } catch (e) {
      return { available: false, error: `Cannot inspect Flow tab: ${e.message}` };
    }
  }

  // src/shared/time.js
  var sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // src/providers/google-flow/tabs.js
  async function findAllLabsTabs() {
    ensureHarvestCfg();
    const isGoodTab = (t) => t.url && !t.url.includes("/404");
    try {
      const patterns = Array.isArray(runtime.harvestCfg?.t?.p) ? runtime.harvestCfg.t.p : [runtime.harvestCfg?.t?.p || "https://labs.google/*", "https://flow.google.com/*"];
      const found = await chrome.tabs.query({ url: patterns });
      if (found && found.length > 0) return found.filter(isGoodTab);
      const all = await chrome.tabs.query({});
      return all.filter((t) => t.url && (t.url.includes("flow.google.com") || t.url.includes("labs.google")) && isGoodTab(t));
    } catch {
      try {
        const all = await chrome.tabs.query({});
        return all.filter((t) => t.url && (t.url.includes("flow.google.com") || t.url.includes("labs.google")) && isGoodTab(t));
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
          return (u.hostname === "flow.google.com" || u.hostname === "labs.google") && u.pathname.includes(`/project/${targetProjectId}`);
        } catch {
          return false;
        }
      });
      if (matched) return matched.id;
    }
    const isProject = (tab) => {
      try {
        const url = new URL(tab.url);
        return url.hostname === "flow.google.com" && /\/project\//.test(url.pathname) || url.hostname === "labs.google" && /\/flow\/project\//.test(url.pathname);
      } catch {
        return false;
      }
    };
    const projects = tabs.filter(isProject);
    const candidates = projects.length ? projects : tabs;
    return (candidates.find((tab) => tab.active) || candidates[0])?.id ?? null;
  }
  function waitForTabComplete(tabId, timeoutMs = 2e4) {
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
        if (tid === tabId && changeInfo.status === "complete") {
          clearTimeout(timer);
          finish();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
    });
  }
  async function ensureProjectTab(targetProjectId, { flowOnly = false } = {}) {
    if (!targetProjectId) return null;
    ensureHarvestCfg();
    const tabs = await findAllLabsTabs();
    const isMatchProject = (t) => {
      try {
        const u = new URL(t.url);
        return (u.hostname === "flow.google.com" || !flowOnly && u.hostname === "labs.google") && u.pathname.match(/\/project\/([^/]+)/)?.[1] === targetProjectId;
      } catch {
        return false;
      }
    };
    const matchedTab = tabs.find(isMatchProject);
    if (matchedTab) {
      try {
        await chrome.tabs.update(matchedTab.id, { active: true });
        if (matchedTab.windowId) {
          await chrome.windows.update(matchedTab.windowId, { focused: true }).catch(() => {
          });
        }
      } catch {
      }
      await warmUpRecaptcha(matchedTab.id, 4e3);
      return matchedTab.id;
    }
    let chosenTab = tabs.find((t) => t.active) || tabs[0];
    let targetOrigin = "https://flow.google.com";
    let accountPrefix = "";
    if (chosenTab && chosenTab.url) {
      try {
        const u = new URL(chosenTab.url);
        targetOrigin = u.origin;
        const uMatch = u.pathname.match(/\/(u\/\d+)/);
        if (uMatch) accountPrefix = uMatch[0];
      } catch {
      }
    }
    const destinationUrl = flowOnly ? `https://flow.google.com${accountPrefix}/project/${encodeURIComponent(targetProjectId)}` : `${targetOrigin}/project/${targetProjectId}`;
    const isChosenTabInDifferentProject = chosenTab && chosenTab.url && /\/project\/[a-zA-Z0-9_-]+/.test(chosenTab.url);
    if (chosenTab && !isChosenTabInDifferentProject) {
      try {
        logActivity("info", `Navigating existing idle Flow tab ${chosenTab.id} to project ${targetProjectId}`);
        await chrome.tabs.update(chosenTab.id, { url: destinationUrl, active: true });
        if (chosenTab.windowId) {
          await chrome.windows.update(chosenTab.windowId, { focused: true }).catch(() => {
          });
        }
        await waitForTabComplete(chosenTab.id, 15e3);
        await sleep(3500);
        await warmUpRecaptcha(chosenTab.id, 8e3);
        return chosenTab.id;
      } catch (e) {
        logActivity("warn", `Failed to navigate tab ${chosenTab.id}: ${e.message}`);
      }
    }
    try {
      logActivity("info", `Opening new Flow tab for project ${targetProjectId}`);
      const newTab = await chrome.tabs.create({ url: destinationUrl, active: true });
      if (newTab.windowId) {
        await chrome.windows.update(newTab.windowId, { focused: true }).catch(() => {
        });
      }
      await waitForTabComplete(newTab.id, 2e4);
      await sleep(3500);
      await warmUpRecaptcha(newTab.id, 8e3);
      return newTab.id;
    } catch (e) {
      logActivity("warn", `Failed to open project tab: ${e.message}`);
      return null;
    }
  }
  async function openLabsTab() {
    ensureHarvestCfg();
    try {
      logActivity("info", "No labs tab open — auto-opening...");
      const tab = await chrome.tabs.create({ url: runtime.harvestCfg.t.o, active: false });
      await waitForTabComplete(tab.id, 15e3);
      await sleep(1500);
      await warmUpRecaptcha(tab.id);
      return tab.id;
    } catch (e) {
      logActivity("warn", `openLabsTab failed: ${e.message}`);
      return null;
    }
  }
  async function getActiveTabId() {
    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tabs.length > 0 ? tabs[0].id : null;
    } catch {
      return null;
    }
  }

  // src/providers/google-flow/captcha.js
  async function checkRecaptchaReady(tabId) {
    const tid = tabId || await findLabsTab();
    if (!tid) return { available: false, error: "Open a Flow project in Chrome" };
    const state = await warmUpRecaptcha(tid);
    return { available: state.available, error: state.error, keySource: state.keySource };
  }
  async function solveRecaptcha(request, pinnedTabId = null) {
    ensureHarvestCfg();
    if (!runtime.harvestCfg.c) return { token: null, error: "Captcha config not loaded" };
    const targetPid = request?.target_project_id || request?.image_request?.project_id || request?.flow_request?.project_id || request?.project_id || null;
    let tabId = pinnedTabId ?? await findLabsTab(targetPid);
    const deadline = Date.now() + 15e3;
    while (!tabId && Date.now() < deadline) {
      tabId = await openLabsTab();
      if (!tabId) await sleep(2e3);
    }
    if (!tabId) return { token: null, error: "No labs tab (15s timeout)" };
    try {
      await chrome.tabs.update(tabId, { active: true });
      const t = await chrome.tabs.get(tabId).catch(() => null);
      if (t?.windowId) {
        await chrome.windows.update(t.windowId, { focused: true }).catch(() => {
        });
      }
    } catch {
    }
    const page = await warmUpRecaptcha(tabId);
    const siteKey = request.site_key || request.recaptcha_ent_key || page.siteKey || "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";
    logActivity("info", `Captcha preflight: tab=${tabId} module=${!!page.moduleReady} keySource=${page.keySource || "none"}`);
    if (!page.moduleReady) return { token: null, error: page.error };
    let action = "";
    if (request.captcha_action && typeof request.captcha_action === "string") {
      action = request.captcha_action.trim();
    } else if (request.action && typeof request.action === "string") {
      action = request.action.trim();
    } else if (runtime.harvestCfg.c?.da) {
      action = String(runtime.harvestCfg.c.da).trim();
    }
    logActivity("info", `solveRecaptcha: tab=${tabId} siteKey=${siteKey ? siteKey.slice(0, 10) + "..." : "none"} action=${action ? `"${action}"` : "none"}`);
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: async (cfg, siteKey2, action2) => {
          try {
            const module = window[cfg.m];
            if (!module || !module[cfg.s]) return { token: null, error: "Module not ready" };
            const withTimeout = (promise, ms, message) => new Promise((resolve, reject) => {
              const timer = setTimeout(() => reject(new Error(message)), ms);
              Promise.resolve(promise).then(
                (value) => {
                  clearTimeout(timer);
                  resolve(value);
                },
                (error) => {
                  clearTimeout(timer);
                  reject(error);
                }
              );
            });
            await withTimeout(new Promise((r) => module[cfg.s].ready(r)), 5e3, "reCAPTCHA ready callback timed out");
            const executePromise = action2 && action2.trim() ? module[cfg.s].execute(siteKey2, { action: action2 }) : module[cfg.s].execute(siteKey2);
            const token = await withTimeout(executePromise, 1e4, "reCAPTCHA execute timed out");
            return { token, error: null };
          } catch (e) {
            return { token: null, error: e.message || String(e) };
          }
        },
        args: [runtime.harvestCfg.c, siteKey, action]
      });
      const res = results?.[0]?.result;
      if (res?.token) {
        logActivity("info", `solveRecaptcha success: tokenLen=${res.token.length}`);
      } else if (res?.error) {
        logActivity("warn", `solveRecaptcha error: ${res.error}`);
      }
      if (res) return res;
      return { token: null, error: "No script result" };
    } catch (e) {
      return { token: null, error: e.message };
    }
  }

  // src/providers/google-flow/prompt-text.js
  function normalizeFlowPrompt(value) {
    return typeof value === "string" ? value.replace(/\s+/gu, " ").trim() : "";
  }

  // src/providers/google-flow/page/ingredients-ui.js
  function ingredientsUiStep(action, req) {
    try {
      const fail = (s) => {
        throw new Error(s);
      };
      if (action === "unlock") {
        document.documentElement.removeAttribute("data-flowsveo-video-until");
        return true;
      }
      if (location.hostname !== "flow.google.com" || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== req.project_id) fail("Flow tab changed project.");
      if (action === "lock") {
        document.documentElement.setAttribute("data-flowsveo-video-until", String(Date.now() + 108e4));
        return true;
      }
      const visible = (e) => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
      const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/🍌/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
      const text = (e) => {
        const c = e.cloneNode(true);
        c.querySelectorAll('[aria-hidden="true"]').forEach((x) => x.remove());
        return norm(c.textContent);
      };
      const label = (e) => norm(e.getAttribute("aria-label")) || text(e);
      const find = (selector, test) => [...document.querySelectorAll(selector)].find((e) => visible(e) && test(e));
      const point = (e) => {
        if (!e) fail("Flow control not found: " + action);
        if (e.disabled || e.getAttribute("aria-disabled") === "true") fail("Flow control is disabled: " + action);
        e.scrollIntoView({ block: "nearest" });
        const r = e.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (!e.contains(document.elementFromPoint(x, y))) fail("Flow control is covered: " + action);
        return { x, y };
      };
      const radio = (s) => find('[role="radio"]', (e) => text(e) === norm(s));
      const editor = () => {
        const all = [...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
        if (all.length !== 1) fail("Open the project prompt editor in Flow.");
        return all[0];
      };
      const triggers = () => [...document.querySelectorAll(".base-prompt-box flow-image-ingredient-chip")].filter(visible);
      const imageKey = (e) => {
        if (!e) return null;
        const emptyBtn = e.querySelector("button.empty-chip");
        if (emptyBtn && visible(emptyBtn)) return null;
        const img = e.querySelector("img");
        if (!img || !visible(img)) return null;
        const s = img.currentSrc || img.src;
        if (!s || s.includes("gstatic.com") || s.includes("google.com/images") || s.includes("google.com/static") || s.startsWith("data:image/svg")) return null;
        try {
          const u = new URL(s);
          return u.origin + u.pathname.replace(/=s\d+.*$/, "");
        } catch {
          return null;
        }
      };
      const options = () => [...document.querySelectorAll('[role="option"]')].filter(visible);
      if (action === "closeAccount") {
        const e = find("button", (b) => /^(dong bang dieu khien tai khoan|close account panel)$/.test(label(b)));
        return e ? point(e) : null;
      }
      if (action === "preflight") {
        if (editor().innerText.trim() || triggers().length) fail("Save or clear the existing Flow draft before starting Ingredients.");
        return true;
      }
      if (action === "openSettings" || action === "closeSettings") {
        const open = !!radio("x1");
        return open === (action === "openSettings") ? null : point(find("button.settings-trigger-button", () => true));
      }
      if (["mode", "frames", "aspect", "resolution", "duration", "count"].includes(action)) {
        const e = action === "mode" ? radio("Video") : action === "frames" ? radio("Thành phần") || radio("Ingredients") : action === "aspect" ? radio(req.aspect_ratio) : action === "resolution" ? radio(req.resolution) : action === "duration" ? radio(req.duration_seconds + " giây") || radio(req.duration_seconds + " seconds") || radio(req.duration_seconds + "s") : radio("x1");
        return e?.getAttribute("aria-checked") === "true" ? null : point(e);
      }
      const modelButton = () => find('button[aria-haspopup="menu"]', (e) => /^(chon nhom mo hinh|select model family|select model)$/.test(label(e)));
      if (action === "modelMenu") {
        const e = modelButton();
        return e && text(e).includes(norm(req.model_display_name)) ? null : point(e);
      }
      if (action === "model") {
        const e = find('[role="menuitem"]', (e2) => text(e2) === norm(req.model_display_name));
        return e ? point(e) : null;
      }
      if (action === "verify") {
        const choices = [radio("Video"), radio("Thành phần") || radio("Ingredients"), radio(req.aspect_ratio), radio(req.resolution), radio(req.duration_seconds + " giây") || radio(req.duration_seconds + " seconds") || radio(req.duration_seconds + "s"), radio("x1")];
        if (choices.some((e) => e?.getAttribute("aria-checked") !== "true") || !modelButton() || !text(modelButton()).includes(norm(req.model_display_name))) fail("Flow model, Ingredients mode, aspect, duration, resolution or output count does not match the job.");
        if (document.querySelector('.agent-mode-chip[aria-pressed="true"]')) fail("Turn off Agent mode in Flow.");
        return true;
      }
      if (action === "fill") {
        const e = editor();
        e.focus();
        const range = document.createRange();
        range.selectNodeContents(e);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        if (!document.execCommand("insertText", false, req.prompt.trim())) fail("Could not fill the Flow prompt.");
        return true;
      }
      if (action === "openIngredient") return point(find(".base-prompt-box button.add-menu-trigger", () => true));
      if (action === "ensurePicker") return options().length ? null : point(find(".base-prompt-box button.add-menu-trigger", () => true));
      if (action === "assetKeys") return options().map(imageKey).filter(Boolean);
      if (action === "upload") return point(find("button", (e) => /tai noi dung nghe nhin len|upload media|upload files/.test(label(e))));
      if (action === "uploadedAsset") {
        const e = options().find((e2) => imageKey(e2)?.endsWith("/image/" + req.mid) && e2.getAttribute("aria-busy") !== "true");
        return e ? { point: point(e), key: imageKey(e) } : null;
      }
      if (action === "add") return point(find("button", (e) => /^(them vao cau lenh|add to prompt)$/.test(label(e))));
      if (action === "attachments") return triggers().map((e) => ({ key: imageKey(e), busy: e.querySelector("button")?.getAttribute("aria-busy") === "true" }));
      if (action === "generate") {
        if (editor().innerText.replace(/\s+/gu, " ").trim() !== req.prompt.replace(/\s+/gu, " ").trim()) fail("Flow prompt changed before submit.");
        const a = triggers().map(imageKey);
        if (a.length !== req.expectedKeys?.length || a.some((key, i) => !key || key !== req.expectedKeys[i])) fail("Ingredient images changed before submit.");
        return point(find("button", (e) => /^(bat dau tao|start generation|generate|start creating)$/.test(label(e))));
      }
      fail("Unknown frames action: " + action);
    } catch (e) {
      return { error: e.message };
    }
  }

  // src/providers/google-flow/page/frames-ui.js
  function framesUiStep(action, req) {
    try {
      const fail = (s) => {
        throw new Error(s);
      };
      if (action === "unlock") {
        document.documentElement.removeAttribute("data-flowsveo-video-until");
        return true;
      }
      if (location.hostname !== "flow.google.com" || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== req.project_id) fail("Flow tab changed project.");
      if (action === "lock") {
        document.documentElement.setAttribute("data-flowsveo-video-until", String(Date.now() + 6e5));
        return true;
      }
      const visible = (e) => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
      const norm = (s) => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").replace(/🍌/gu, "").replace(/\s+/g, " ").trim().toLowerCase();
      const text = (e) => {
        const c = e.cloneNode(true);
        c.querySelectorAll('[aria-hidden="true"]').forEach((x) => x.remove());
        return norm(c.textContent);
      };
      const label = (e) => norm(e.getAttribute("aria-label")) || text(e);
      const find = (selector, test) => [...document.querySelectorAll(selector)].find((e) => visible(e) && test(e));
      const point = (e) => {
        if (!e) fail("Flow control not found: " + action);
        if (e.disabled || e.getAttribute("aria-disabled") === "true") fail("Flow control is disabled: " + action);
        e.scrollIntoView({ block: "nearest" });
        const r = e.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (!e.contains(document.elementFromPoint(x, y))) fail("Flow control is covered: " + action);
        return { x, y };
      };
      const radio = (s) => find('[role="radio"]', (e) => text(e) === norm(s));
      const editor = () => {
        const all = [...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
        if (all.length !== 1) fail("Open the project prompt editor in Flow.");
        return all[0];
      };
      const triggers = () => [...document.querySelectorAll(".base-prompt-box .frame-trigger")].filter(visible);
      const imageKey = (e) => {
        if (!e) return null;
        const emptyBtn = e.querySelector("button.empty-chip");
        if (emptyBtn && visible(emptyBtn)) return null;
        const img = e.querySelector("img");
        if (!img || !visible(img)) return null;
        const s = img.currentSrc || img.src;
        if (!s || s.includes("gstatic.com") || s.includes("google.com/images") || s.includes("google.com/static") || s.startsWith("data:image/svg")) return null;
        try {
          const u = new URL(s);
          return u.origin + u.pathname.replace(/=s\d+.*$/, "");
        } catch {
          return null;
        }
      };
      const options = () => [...document.querySelectorAll('[role="option"]')].filter(visible);
      if (action === "closeAccount") {
        const e = find("button", (b) => /^(dong bang dieu khien tai khoan|close account panel)$/.test(label(b)));
        return e ? point(e) : null;
      }
      if (action === "preflight") {
        const ed = editor();
        if (ed && ed.innerText.trim()) {
          ed.focus();
          document.execCommand("selectAll", false, null);
          document.execCommand("delete", false, null);
        }
        document.querySelectorAll('.base-prompt-box flow-image-ingredient-chip button, .base-prompt-box button[aria-label*="xóa" i], .base-prompt-box button[aria-label*="remove" i]').forEach((b) => {
          try {
            b.click();
          } catch {
          }
        });
        return true;
      }
      if (action === "openSettings" || action === "closeSettings") {
        const open = !!radio("x1");
        return open === (action === "openSettings") ? null : point(find("button.settings-trigger-button", () => true));
      }
      if (["mode", "frames", "aspect", "resolution", "duration", "count"].includes(action)) {
        const e = action === "mode" ? radio("Video") : action === "frames" ? radio("Khung hình") || radio("Frames") : action === "aspect" ? radio(req.aspect_ratio) : action === "resolution" ? radio(req.resolution) : action === "duration" ? radio(req.duration_seconds + " giây") || radio(req.duration_seconds + " seconds") || radio(req.duration_seconds + "s") : radio("x1");
        return e?.getAttribute("aria-checked") === "true" ? null : point(e);
      }
      const modelButton = () => find('button[aria-haspopup="menu"]', (e) => /^(chon nhom mo hinh|select model family|select model)$/.test(label(e)));
      if (action === "modelMenu") {
        const e = modelButton();
        return e && text(e).includes(norm(req.model_display_name)) ? null : point(e);
      }
      if (action === "model") {
        const e = find('[role="menuitem"]', (e2) => text(e2) === norm(req.model_display_name));
        return e ? point(e) : null;
      }
      if (action === "verify") {
        const choices = [radio("Video"), radio("Khung hình") || radio("Frames"), radio(req.aspect_ratio), radio(req.resolution), radio(req.duration_seconds + " giây") || radio(req.duration_seconds + " seconds") || radio(req.duration_seconds + "s"), radio("x1")];
        if (choices.some((e) => e?.getAttribute("aria-checked") !== "true") || !modelButton() || !text(modelButton()).includes(norm(req.model_display_name))) fail("Flow model, Frames mode, aspect, duration, resolution or output count does not match the job.");
        if (document.querySelector('.agent-mode-chip[aria-pressed="true"]')) fail("Turn off Agent mode in Flow.");
        return true;
      }
      if (action === "fill") {
        const e = editor();
        e.focus();
        const range = document.createRange();
        range.selectNodeContents(e);
        window.getSelection().removeAllRanges();
        window.getSelection().addRange(range);
        if (!document.execCommand("insertText", false, req.prompt.trim())) fail("Could not fill the Flow prompt.");
        return true;
      }
      if (action === "openStart" || action === "openEnd") return point(triggers()[action === "openStart" ? 0 : 1]?.querySelector("button.empty-chip"));
      if (action === "ensurePicker") return options().length ? null : point(triggers()[req.frameIndex]?.querySelector("button.empty-chip"));
      if (action === "assetKeys") return options().map(imageKey).filter(Boolean);
      if (action === "upload") return point(find("button", (e) => /tai noi dung nghe nhin len|upload media|upload files/.test(label(e))));
      if (action === "uploadedAsset") {
        const e = options().find((e2) => imageKey(e2)?.endsWith("/image/" + req.mid) && e2.getAttribute("aria-busy") !== "true");
        return e ? { point: point(e), key: imageKey(e) } : null;
      }
      if (action === "add") return point(find("button", (e) => /^(them vao cau lenh|add to prompt)$/.test(label(e))));
      if (action === "attachments") return triggers().map((e) => ({ key: imageKey(e), busy: e.querySelector("button")?.getAttribute("aria-busy") === "true" }));
      if (action === "generate") {
        if (editor().innerText.replace(/\s+/gu, " ").trim() !== req.prompt.replace(/\s+/gu, " ").trim()) fail("Flow prompt changed before submit.");
        const a = triggers().map(imageKey);
        if (!a[0] || (req.end_image_local_path ? !a[1] : !!a[1])) fail("Start/end frames do not match the job.");
        return point(find("button", (e) => /^(bat dau tao|start generation|generate|start creating)$/.test(label(e))));
      }
      fail("Unknown frames action: " + action);
    } catch (e) {
      return { error: e.message };
    }
  }
  async function pollFramesVideo(projectId, mediaId, modelId) {
    try {
      if (location.hostname !== "flow.google.com" || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== projectId) return { error: "Flow tab changed project.", terminal: true };
      const wiz = window.WIZ_global_data || {};
      if (!wiz.SNlM0e || !wiz.FdrFJe || !wiz.cfb2h) return { pending: true };
      const unwrap = (v, rpc) => {
        if (!Array.isArray(v)) return null;
        if (v[0] === "wrb.fr" && v[1] === rpc && typeof v[2] === "string") return JSON.parse(v[2]);
        for (const c of v) {
          const x = unwrap(c, rpc);
          if (x) return x;
        }
        return null;
      };
      const callRpc = async (rpc, payload) => {
        const q = new URLSearchParams({ rpcids: rpc, "source-path": "/project/" + projectId, bl: String(wiz.cfb2h), "f.sid": String(wiz.FdrFJe), rt: "c", _reqid: String(Date.now() % 1e7) });
        const body = new URLSearchParams({ "f.req": JSON.stringify([[[rpc, JSON.stringify(payload), null, "generic"]]]), at: wiz.SNlM0e });
        const res = await fetch(location.origin + "/_/AiSandboxAngularFrontend/data/batchexecute?" + q, { method: "POST", credentials: "include", headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "X-Same-Domain": "1" }, body, signal: AbortSignal.timeout(12e3) });
        if (!res.ok) return null;
        for (const line of (await res.text()).split(/\r?\n/)) {
          if (!line.trim().startsWith("[")) continue;
          try {
            const value = unwrap(JSON.parse(line), rpc);
            if (value) return value;
          } catch {
          }
        }
        return null;
      };
      const findAsset = (v) => {
        if (!Array.isArray(v)) return null;
        if (v[0] === mediaId && v[1] === projectId) return v;
        for (const c of v) {
          const a = findAsset(c);
          if (a) return a;
        }
        return null;
      };
      const terminalResult = (v) => {
        const asset2 = findAsset(v), status = asset2?.[5]?.[8]?.[0];
        if (typeof status === "number" && ![1, 2, 3, 6].includes(status)) return { terminal: true, error: `Flow render ended with status ${status}` };
        return null;
      };
      const findUrl = (v) => {
        if (typeof v === "string") {
          try {
            const u = new URL(v);
            if (u.origin === "https://flow-content.google" && u.pathname === "/video/" + mediaId) return v;
          } catch {
          }
        }
        if (Array.isArray(v)) for (const c of v) {
          const x = findUrl(c);
          if (x) return x;
        }
        return null;
      };
      const progress = await callRpc("jwpduf", [null, null, [[mediaId]]]);
      const failed = terminalResult(progress);
      if (failed) return failed;
      const final = await callRpc("as29s", [mediaId]);
      const finalFailure = terminalResult(final);
      if (finalFailure) return finalFailure;
      const asset = findAsset(final), url = asset && findUrl(asset);
      if (url) return { ok: true, video_url: url, media_id: mediaId, provider_model_id: modelId, project_id: projectId };
      return { pending: true };
    } catch {
      return { pending: true };
    }
  }

  // src/providers/google-flow/frames-ui.js
  function frameRpcPayload(body, rpcId) {
    if (body.includes("PUBLIC_ERROR_UNUSUAL_ACTIVITY")) throw new Error("PUBLIC_ERROR_UNUSUAL_ACTIVITY: Flow rejected this generation. Check the Flow tab.");
    const find = (v) => {
      if (!Array.isArray(v)) return null;
      if (v[0] === "wrb.fr" && v[1] === rpcId && typeof v[2] === "string") return JSON.parse(v[2]);
      for (const c of v) {
        const x = find(c);
        if (x) return x;
      }
      return null;
    };
    for (const line of body.split(/\r?\n/)) {
      if (!line.trim().startsWith("[")) continue;
      let v;
      try {
        v = JSON.parse(line);
      } catch {
        continue;
      }
      const x = find(v);
      if (x) return x;
    }
    throw new Error("Flow returned no usable " + rpcId + " result. Check Flow before retrying.");
  }
  function matchFrameRequest(body, req, ids) {
    let batches;
    try {
      batches = JSON.parse(new URLSearchParams(body).get("f.req"));
    } catch {
      return null;
    }
    if (!Array.isArray(batches)) return null;
    for (const batch of batches) {
      if (!Array.isArray(batch)) continue;
      for (const rpc of batch) {
        if (!Array.isArray(rpc)) continue;
        if (!["nprQif", "eb1hJf"].includes(rpc[0])) continue;
        let p;
        try {
          p = JSON.parse(rpc[1]);
        } catch {
          continue;
        }
        const item = p?.[0]?.[0];
        if (normalizeFlowPrompt(item?.[0]?.[2]?.[0]?.[0]?.[0]) !== normalizeFlowPrompt(req.prompt) || p?.[1]?.[5] !== req.project_id) continue;
        const modelMatches = item[1] === req.provider_model_id;
        if (p[0].length !== 1 || !modelMatches || item[2] !== { "16:9": 2, "9:16": 1 }[req.aspect_ratio] || item[4]?.[1] !== ids[0] || (req.end_image_local_path ? item[5]?.[1] !== ids[1] : rpc[0] !== "eb1hJf") || req.end_image_local_path && rpc[0] !== "nprQif") throw new Error("Flow submitted different frames/model/aspect/count. Check Flow before retrying.");
        return { rpc: rpc[0], start: ids[0], end: ids[1] || null };
      }
    }
    return null;
  }
  function parseFrameCreation(body, rpc, req) {
    const p = frameRpcPayload(body, rpc);
    const assets = (Array.isArray(p?.[3]) ? p[3] : []).filter((a) => a?.[3] === "CAE" && a[1] === req.project_id && normalizeFlowPrompt(a?.[5]?.[1]) === normalizeFlowPrompt(req.prompt));
    if (assets.length !== 1 || !/^[0-9a-f-]{36}$/i.test(assets[0][0])) throw new Error("Flow response has no unique video asset for this prompt/project.");
    return { mediaId: assets[0][0], sceneId: assets[0][2] };
  }
  async function generateFramesThroughUi(req, tabId) {
    const failResult = (message) => ({ ok: false, error: "FLOW_UI: " + message });
    if (!req.image_local_path || !req.prompt?.trim()) return failResult("Start Frame and prompt are required.");
    if (req.model_display_name !== "Omni 1.1 Flash" || req.resolution !== "720p" || Number(req.num_outputs || 1) !== 1) return failResult("Frames currently supports Omni 1.1 Flash, 720p, one output per job.");
    if (!chrome.debugger) return failResult("Reload the FlowsVeo extension to enable browser control.");
    const target = { tabId }, ids = [], requestTypes = /* @__PURE__ */ new Map();
    const { image_base64, end_image_base64, ingredient_images, ...pageReq } = req;
    let attached = false, closed = false, armed = false, created = null, failure = null, upload = null, chooser = null, submissionRpc = null;
    const command = (name, params = {}) => chrome.debugger.sendCommand(target, name, params);
    const step = async (action, extra = {}) => {
      if (closed || failure) throw new Error(failure || "Flow control has stopped.");
      if (action === "closeSettings") {
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await sleep(350);
        return null;
      }
      let r;
      for (let attempt = 0; attempt < 8; attempt++) {
        r = await chrome.scripting.executeScript({ target, world: "MAIN", func: framesUiStep, args: [action, { ...pageReq, ...extra }] });
        if (!/^(Flow control is covered:|Flow control not found:)/.test(r?.[0]?.result?.error || "")) break;
        await sleep(300);
      }
      if (!r?.length || !Object.hasOwn(r[0], "result")) throw new Error("Flow page did not respond: " + action);
      if (r[0].result?.error) throw new Error(r[0].result.error);
      return r[0].result;
    };
    const click = async (p) => {
      if (!p) return;
      if (failure) throw new Error(failure);
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", buttons: 1, clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", buttons: 0, clickCount: 1 });
      await sleep(350);
    };
    const waitFor = async (fn, ms, message) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (failure) throw new Error(failure);
        const v = await fn();
        if (v) return v;
        await sleep(400);
      }
      throw new Error(message);
    };
    const onDetach = (source) => {
      if (source.tabId === tabId && !closed) failure = "Chrome detached from Flow. Check the result in Flow before retrying.";
    };
    const onEvent = (source, method, p) => {
      if (source.tabId !== tabId || source.sessionId || closed) return;
      if (method === "Page.fileChooserOpened" && chooser) {
        const current = chooser;
        command("DOM.setFileInputFiles", { backendNodeId: p.backendNodeId, files: [current.path] }).then(() => {
          current.done = true;
        }).catch(() => {
          failure = "Chrome could not read the selected frame file.";
        });
        return;
      }
      if (method === "Network.requestWillBeSent") {
        const r = p.request;
        if (!r?.url?.startsWith("https://flow.google.com/") || !r.url.includes("/data/batchexecute")) return;
        const rpc = new URL(r.url).searchParams.get("rpcids");
        if (upload && rpc === "maseQ") requestTypes.set(p.requestId, { rpc, upload });
        if (armed && !created && r.postData) {
          try {
            const m = matchFrameRequest(r.postData, req, ids);
            if (m) {
              requestTypes.set(p.requestId, { rpc: m.rpc, generation: true, actualModelId: m.actualModelId });
              submissionRpc = m.rpc;
            }
          } catch (e) {
            failure = e.message;
          }
        }
      }
      const info = requestTypes.get(p.requestId);
      if (!info) return;
      if (method === "Network.loadingFailed") {
        failure = "Flow network request failed; check Flow before retrying.";
        requestTypes.delete(p.requestId);
      }
      if (method === "Network.loadingFinished") {
        requestTypes.delete(p.requestId);
        command("Network.getResponseBody", { requestId: p.requestId }).then((r) => {
          if (closed) return;
          const body = r.base64Encoded ? new TextDecoder().decode(Uint8Array.from(atob(r.body), (c) => c.charCodeAt(0))) : r.body;
          if (info.generation) {
            created = parseFrameCreation(body, info.rpc, req);
            created.actualModelId = info.actualModelId;
            logActivity("info", `Frames accepted: rpc=${info.rpc} media=${created.mediaId} start=${ids[0]} end=${ids[1] || "none"}`);
          } else {
            const data = frameRpcPayload(body, "maseQ");
            if (data?.[0]?.[1] === req.project_id && data?.[1]?.[3]?.[0] === info.upload.name) {
              info.upload.mediaId = data[0][0];
            }
          }
        }).catch((e) => {
          failure = String(e.message || "Could not read the Flow result.");
        });
      }
    };
    const openSettings = async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const p = await step("openSettings");
        if (!p) return;
        await click(p);
        await sleep(500);
      }
      if (await step("openSettings")) throw new Error("The Flow settings panel did not open.");
    };
    const uploadFrame = async (index, path, name) => {
      if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path || "")) throw new Error("The frame file path must be absolute.");
      await click(await step(index === 0 ? "openStart" : "openEnd"));
      const previousKeys = await step("assetKeys");
      upload = { name, mediaId: null };
      chooser = { path, done: false };
      await click(await step("upload"));
      await waitFor(() => chooser.done, 12e3, "Image file chooser did not open.");
      chooser = null;
      const mid = await waitFor(() => upload.mediaId, 6e4, "Frame upload timed out. No video was submitted.");
      await click(await step("ensurePicker", { frameIndex: index }));
      const asset = await waitFor(() => step("uploadedAsset", { filename: name, previousKeys, mid }), 6e4, "The newly uploaded image did not appear in Flow.");
      await click(asset.point);
      await click(await step("add"));
      await waitFor(async () => {
        const a = await step("attachments");
        return a[index]?.key === asset.key && !a[index]?.busy;
      }, 15e3, "The uploaded image was not attached to the requested frame slot.");
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(400);
      ids.push(mid);
      upload = null;
      logActivity("info", `Frames attached: slot=${index === 0 ? "start" : "end"} media=${mid}`);
    };
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      chrome.debugger.onEvent.addListener(onEvent);
      chrome.debugger.onDetach.addListener(onDetach);
      await command("Network.enable", { maxPostDataSize: 1048576, maxResourceBufferSize: 5242880, maxTotalBufferSize: 10485760 });
      await command("Page.enable");
      await command("DOM.enable");
      await command("Page.setInterceptFileChooserDialog", { enabled: true });
      await step("lock");
      await click(await step("closeAccount"));
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(450);
      await step("preflight");
      await openSettings();
      for (const action of ["mode", "frames", "modelMenu", "model", "aspect", "resolution", "duration", "count"]) await click(await step(action));
      await step("verify");
      await click(await step("closeSettings"));
      await step("fill");
      await uploadFrame(0, req.image_local_path, req.image_name);
      if (req.end_image_local_path) await uploadFrame(1, req.end_image_local_path, req.end_image_name);
      if (req.end_image_local_path) {
        await openSettings();
        for (const action of ["aspect", "resolution", "duration", "count"]) await click(await step(action));
        await step("verify");
        await click(await step("closeSettings"));
      }
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(350);
      const submit = await step("generate");
      armed = true;
      await click(submit);
      await waitFor(() => created, 6e4, "No matching generation result. Check Flow before retrying; no automatic resubmit.");
      closed = true;
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      await command("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {
      });
      await chrome.debugger.detach(target);
      attached = false;
      const end = Date.now() + 42e4;
      while (Date.now() < end) {
        const pollModelId = created.actualModelId || req.provider_model_id;
        const r = await chrome.scripting.executeScript({ target, world: "MAIN", func: pollFramesVideo, args: [req.project_id, created.mediaId, pollModelId] });
        const value = r?.[0]?.result;
        if (value?.ok) return { ...value, diagnostics: { adapter: "frames-ui-v1", rpc: submissionRpc, start_media_id: ids[0], end_media_id: ids[1] || null, scene_id: created.sceneId, prompt_verified: true } };
        if (value?.terminal) throw new Error(value.error);
        await sleep(3500);
      }
      throw new Error("Video render timed out. Check Flow before retrying; no automatic resubmit.");
    } catch (e) {
      return failResult(e.message || "Could not control the Flow tab.");
    } finally {
      closed = true;
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      if (attached) {
        await command("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {
        });
        await chrome.debugger.detach(target).catch(() => {
        });
      }
      await chrome.scripting.executeScript({ target, world: "MAIN", func: framesUiStep, args: ["unlock", pageReq] }).catch(() => {
      });
    }
  }

  // src/providers/google-flow/ingredients-ui.js
  function matchIngredientRequest(body, req, ids) {
    let batches;
    try {
      batches = JSON.parse(new URLSearchParams(body).get("f.req"));
    } catch {
      return null;
    }
    if (!Array.isArray(batches)) return null;
    for (const batch of batches) {
      if (!Array.isArray(batch)) continue;
      for (const rpc of batch) {
        if (!Array.isArray(rpc) || rpc[0] !== "MZZa6b") continue;
        let p;
        try {
          p = JSON.parse(rpc[1]);
        } catch {
          continue;
        }
        const item = p?.[0]?.[0];
        if (normalizeFlowPrompt(item?.[0]?.[2]?.[0]?.[0]?.[0]) !== normalizeFlowPrompt(req.prompt) || p?.[1]?.[5] !== req.project_id) continue;
        const refs = item[1];
        if (p[0].length !== 1 || item[2] !== req.provider_model_id || item[3] !== { "16:9": 2, "9:16": 1 }[req.aspect_ratio] || !Array.isArray(refs) || refs.length !== ids.length || ids.length < 1 || ids.length > 3 || refs.some((r, i) => r?.[1] !== ids[i]))
          throw new Error("Flow submitted different ingredient images/model/aspect/count. Check Flow before retrying.");
        return { rpc: rpc[0], actualModelId: item[2] };
      }
    }
    return null;
  }
  async function generateIngredientsThroughUi(req, tabId) {
    const failResult = (message) => ({ ok: false, error: "FLOW_UI: " + message });
    const ingredients = req.ingredient_images;
    if (!Array.isArray(ingredients) || ingredients.length < 1 || ingredients.length > 3 || ingredients.some((i) => !i.local_path || !i.filename) || !req.prompt?.trim()) return failResult("Ingredients requires 1–3 local image files and a prompt.");
    if (req.model_display_name !== "Omni 1.1 Flash" || req.resolution !== "720p" || Number(req.num_outputs || 1) !== 1) return failResult("Ingredients currently supports Omni 1.1 Flash, 720p, one output per job.");
    if (!chrome.debugger) return failResult("Reload the FlowsVeo extension to enable browser control.");
    const target = { tabId }, ids = [], keys = [], requestTypes = /* @__PURE__ */ new Map();
    const { image_base64, end_image_base64, ingredient_images, ...pageReq } = req;
    let attached = false, closed = false, armed = false, created = null, failure = null, upload = null, chooser = null, submissionRpc = null;
    const command = (name, params = {}) => chrome.debugger.sendCommand(target, name, params);
    const step = async (action, extra = {}) => {
      if (closed || failure) throw new Error(failure || "Flow control has stopped.");
      if (action === "closeSettings") {
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await sleep(350);
        return null;
      }
      let r;
      for (let attempt = 0; attempt < 8; attempt++) {
        r = await chrome.scripting.executeScript({ target, world: "MAIN", func: ingredientsUiStep, args: [action, { ...pageReq, ...extra }] });
        if (!/^(Flow control is covered:|Flow control not found:)/.test(r?.[0]?.result?.error || "")) break;
        await sleep(300);
      }
      if (!r?.length || !Object.hasOwn(r[0], "result")) throw new Error("Flow page did not respond: " + action);
      if (r[0].result?.error) throw new Error(r[0].result.error);
      return r[0].result;
    };
    const click = async (p) => {
      if (!p) return;
      if (failure) throw new Error(failure);
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...p });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", ...p, button: "left", buttons: 1, clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...p, button: "left", buttons: 0, clickCount: 1 });
      await sleep(350);
    };
    const waitFor = async (fn, ms, message) => {
      const end = Date.now() + ms;
      while (Date.now() < end) {
        if (failure) throw new Error(failure);
        const v = await fn();
        if (v) return v;
        await sleep(400);
      }
      throw new Error(message);
    };
    const onDetach = (source) => {
      if (source.tabId === tabId && !closed) failure = "Chrome detached from Flow. Check the result in Flow before retrying.";
    };
    const onEvent = (source, method, p) => {
      if (source.tabId !== tabId || source.sessionId || closed) return;
      if (method === "Page.fileChooserOpened" && chooser) {
        const current = chooser;
        command("DOM.setFileInputFiles", { backendNodeId: p.backendNodeId, files: [current.path] }).then(() => {
          current.done = true;
        }).catch(() => {
          failure = "Chrome could not read the selected frame file.";
        });
        return;
      }
      if (method === "Network.requestWillBeSent") {
        const r = p.request;
        if (!r?.url?.startsWith("https://flow.google.com/") || !r.url.includes("/data/batchexecute")) return;
        const rpc = new URL(r.url).searchParams.get("rpcids");
        if (upload && rpc === "maseQ") requestTypes.set(p.requestId, { rpc, upload });
        if (armed && !created && r.postData) {
          try {
            const m = matchIngredientRequest(r.postData, req, ids);
            if (m) {
              requestTypes.set(p.requestId, { rpc: m.rpc, generation: true, actualModelId: m.actualModelId });
              submissionRpc = m.rpc;
            }
          } catch (e) {
            failure = e.message;
          }
        }
      }
      const info = requestTypes.get(p.requestId);
      if (!info) return;
      if (method === "Network.loadingFailed") {
        failure = "Flow network request failed; check Flow before retrying.";
        requestTypes.delete(p.requestId);
      }
      if (method === "Network.loadingFinished") {
        requestTypes.delete(p.requestId);
        command("Network.getResponseBody", { requestId: p.requestId }).then((r) => {
          if (closed) return;
          const body = r.base64Encoded ? new TextDecoder().decode(Uint8Array.from(atob(r.body), (c) => c.charCodeAt(0))) : r.body;
          if (info.generation) {
            created = parseFrameCreation(body, info.rpc, req);
            created.actualModelId = info.actualModelId;
            logActivity("info", `Ingredients accepted: rpc=${info.rpc} media=${created.mediaId} start=${ids[0]} end=${ids[1] || "none"}`);
          } else {
            const data = frameRpcPayload(body, "maseQ");
            if (data?.[0]?.[1] === req.project_id && data?.[1]?.[3]?.[0] === info.upload.name) {
              info.upload.mediaId = data[0][0];
            }
          }
        }).catch((e) => {
          failure = String(e.message || "Could not read the Flow result.");
        });
      }
    };
    const openSettings = async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const p = await step("openSettings");
        if (!p) return;
        await click(p);
        await sleep(500);
      }
      if (await step("openSettings")) throw new Error("The Flow settings panel did not open.");
    };
    const uploadFrame = async (index, path, name) => {
      if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(path || "")) throw new Error("The frame file path must be absolute.");
      await click(await step("openIngredient"));
      const previousKeys = await step("assetKeys");
      upload = { name, mediaId: null };
      chooser = { path, done: false };
      await click(await step("upload"));
      await waitFor(() => chooser.done, 12e3, "Image file chooser did not open.");
      chooser = null;
      const mid = await waitFor(() => upload.mediaId, 6e4, "Frame upload timed out. No video was submitted.");
      await click(await step("ensurePicker", { frameIndex: index }));
      const asset = await waitFor(() => step("uploadedAsset", { filename: name, previousKeys, mid }), 6e4, "The newly uploaded image did not appear in Flow.");
      await click(asset.point);
      await click(await step("add"));
      await waitFor(async () => {
        const a = await step("attachments");
        return a[index]?.key === asset.key && !a[index]?.busy;
      }, 15e3, "The uploaded image was not attached to the requested frame slot.");
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(400);
      ids.push(mid);
      keys.push(asset.key);
      upload = null;
      logActivity("info", `Ingredients attached: slot=${index + 1} media=${mid}`);
    };
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      chrome.debugger.onEvent.addListener(onEvent);
      chrome.debugger.onDetach.addListener(onDetach);
      await command("Network.enable", { maxPostDataSize: 1048576, maxResourceBufferSize: 5242880, maxTotalBufferSize: 10485760 });
      await command("Page.enable");
      await command("DOM.enable");
      await command("Page.setInterceptFileChooserDialog", { enabled: true });
      await step("lock");
      await click(await step("closeAccount"));
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(450);
      await step("preflight");
      await openSettings();
      for (const action of ["mode", "frames", "modelMenu", "model", "aspect", "resolution", "duration", "count"]) await click(await step(action));
      await step("verify");
      await click(await step("closeSettings"));
      await step("fill");
      for (let i = 0; i < ingredients.length; i++) await uploadFrame(i, ingredients[i].local_path, ingredients[i].filename);
      await openSettings();
      await step("verify");
      await step("closeSettings");
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(350);
      const submit = await step("generate", { expectedKeys: keys });
      armed = true;
      await click(submit);
      await waitFor(() => created, 6e4, "No matching generation result. Check Flow before retrying; no automatic resubmit.");
      closed = true;
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      await command("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {
      });
      await chrome.debugger.detach(target);
      attached = false;
      const end = Date.now() + 42e4;
      while (Date.now() < end) {
        const pollModelId = created.actualModelId || req.provider_model_id;
        const r = await chrome.scripting.executeScript({ target, world: "MAIN", func: pollFramesVideo, args: [req.project_id, created.mediaId, pollModelId] });
        const value = r?.[0]?.result;
        if (value?.ok) return { ...value, diagnostics: { adapter: "ingredients-ui-v1", rpc: submissionRpc, ingredient_media_ids: ids, scene_id: created.sceneId, prompt_verified: true } };
        if (value?.terminal) throw new Error(value.error);
        await sleep(3500);
      }
      throw new Error("Video render timed out. Check Flow before retrying; no automatic resubmit.");
    } catch (e) {
      return failResult(e.message || "Could not control the Flow tab.");
    } finally {
      closed = true;
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      if (attached) {
        await command("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {
        });
        await chrome.debugger.detach(target).catch(() => {
        });
      }
      await chrome.scripting.executeScript({ target, world: "MAIN", func: ingredientsUiStep, args: ["unlock", pageReq] }).catch(() => {
      });
    }
  }

  // src/providers/google-flow/page/image-ui.js
  function imageUiStep(action, request) {
    try {
      const fail = (message) => {
        throw new Error(message);
      };
      if (action === "unlock") {
        document.documentElement.removeAttribute("data-flowsveo-image-until");
        return true;
      }
      if (location.hostname !== "flow.google.com" || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== request.project_id) {
        fail("Tab Flow đã chuyển project. Chọn lại project rồi thử lại.");
      }
      const visible = (el) => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && window.getComputedStyle(el).visibility !== "hidden";
      if (action === "lock") {
        document.documentElement.setAttribute("data-flowsveo-image-until", String(Date.now() + 14e4));
        return true;
      }
      const text = (el) => {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('[aria-hidden="true"]').forEach((icon) => icon.remove());
        return copy.textContent.replace(/🍌/gu, "").replace(/\s+/g, " ").trim();
      };
      const find = (selector, predicate) => [...document.querySelectorAll(selector)].find((el) => visible(el) && predicate(el));
      const point = (el) => {
        if (!el) fail("Không tìm thấy điều khiển tạo ảnh trên Flow. Tải lại tab Flow rồi thử lại.");
        if (el.disabled || el.getAttribute("aria-disabled") === "true") fail("Điều khiển trên Flow chưa sẵn sàng.");
        el.scrollIntoView({ block: "nearest" });
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (!el.contains(document.elementFromPoint(x, y))) fail("Có cửa sổ đang che điều khiển Flow. Đóng cửa sổ đó rồi thử lại.");
        return { x, y };
      };
      const settings = () => find("button.settings-trigger-button", () => true) || find("button", (el) => /^(Điều kiện kích hoạt cài đặt|Settings trigger)$/i.test(el.getAttribute("aria-label") || ""));
      const radio = (name) => find('[role="radio"]', (el) => text(el) === name);
      const models = { GEM_PIX_2: "Nano Banana Pro", NARWHAL: "Nano Banana 2", HARBOR_SEAL: "Nano Banana 2 Lite" };
      const modelName = models[request.model_key];
      const editor = () => {
        const editors = [...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
        if (editors.length !== 1) fail("Không xác định được ô prompt Flow. Hãy mở màn hình tạo ảnh của project.");
        return editors[0];
      };
      if (action === "closeAccount") {
        const close = find("button", (el) => /^(Đóng bảng điều khiển tài khoản|Close account panel)$/i.test(el.getAttribute("aria-label") || ""));
        return close ? point(close) : null;
      }
      const isDrawerOpen = () => Boolean(radio("16:9") || radio("x1") || radio("x2") || radio("x4"));
      if (action === "checkConfig") {
        const targetCount = request.count || 1;
        const flowCount = targetCount === 3 ? 4 : targetCount;
        const targetConfig = `${request.model_key}_${request.aspect_ratio}_x${flowCount}`;
        const configured = document.documentElement.getAttribute("data-flowsveo-image-configured");
        const s = settings();
        const st = s ? text(s) : "";
        const open = isDrawerOpen();
        if (!open && configured === targetConfig && st.includes(modelName)) {
          return { needsConfig: false };
        }
        return { needsConfig: true };
      }
      if (action === "openSettings" || action === "closeSettings") {
        const open = isDrawerOpen();
        return open === (action === "openSettings") ? null : point(settings());
      }
      if (action === "mode") {
        const el = radio("Hình ảnh") || radio("Image") || radio("Images");
        return el?.getAttribute("aria-checked") === "true" ? null : point(el);
      }
      if (action === "aspect") {
        const el = radio(request.aspect_ratio);
        return el?.getAttribute("aria-checked") === "true" ? null : point(el);
      }
      if (action === "count") {
        const targetCount = request.count || 1;
        const flowCount = targetCount === 3 ? 4 : targetCount;
        const el = radio(`x${flowCount}`) || radio(String(flowCount)) || radio("x1");
        return el?.getAttribute("aria-checked") === "true" ? null : point(el);
      }
      if (action === "modelMenu") return point(find('button[aria-haspopup="menu"]', (el) => /^(Chọn nhóm mô hình|Select model family|Select model)$/i.test(el.getAttribute("aria-label") || "")));
      if (action === "model") return point(find('[role="menuitem"]', (el) => text(el) === modelName));
      if (action === "verify") {
        const targetCount = request.count || 1;
        const flowCount = targetCount === 3 ? 4 : targetCount;
        const countRadio = radio(`x${flowCount}`) || radio(String(flowCount)) || radio("x1");
        const countChecked = countRadio?.getAttribute("aria-checked") === "true";
        if (!modelName || !settings() || !text(settings()).includes(modelName) || radio(request.aspect_ratio)?.getAttribute("aria-checked") !== "true" || !countChecked && flowCount === 1) {
          fail("Không xác nhận được model, tỷ lệ hoặc số ảnh trên Flow. Chưa gửi yêu cầu tạo ảnh.");
        }
        const agent = find("button.agent-mode-chip", () => true);
        if (agent?.getAttribute("aria-pressed") === "true") fail("Hãy tắt chế độ Tác nhân trên Flow trước khi tạo ảnh từ app.");
        document.documentElement.setAttribute("data-flowsveo-image-configured", `${request.model_key}_${request.aspect_ratio}_x${flowCount}`);
        return true;
      }
      if (action === "fill") {
        const el = editor();
        if (el.querySelector('img,[contenteditable="false"]')) fail("Hãy bỏ ảnh/thành phần đính kèm khỏi ô prompt Flow trước.");
        el.focus();
        const range = document.createRange();
        range.selectNodeContents(el);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        if (!document.execCommand("insertText", false, request.prompt.trim())) {
          el.innerText = request.prompt.trim();
        }
        try {
          el.dispatchEvent(new window.Event("input", { bubbles: true }));
          el.dispatchEvent(new window.Event("change", { bubbles: true }));
        } catch {
        }
        return true;
      }
      if (action === "generateReady") {
        const btn = find("button", (el) => /^(Bắt đầu tạo|Start generation|Generate|Start creating)$/i.test(el.getAttribute("aria-label") || ""));
        if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") {
          return { ready: false };
        }
        try {
          return { ready: true, point: point(btn) };
        } catch {
          return { ready: false };
        }
      }
      if (action === "generate") {
        if (editor().innerText.trim() !== request.prompt.trim()) fail("Prompt trên Flow không khớp yêu cầu. Chưa tạo ảnh.");
        return point(find("button", (el) => /^(Bắt đầu tạo|Start generation|Generate|Start creating)$/i.test(el.getAttribute("aria-label") || "")));
      }
      fail("Unknown Flow image UI step");
    } catch (error) {
      return { error: error?.message || "Không đọc được giao diện Flow." };
    }
  }

  // src/providers/google-flow/image-ui.js
  var aspectCodes = { "16:9": 3, "9:16": 2, "1:1": 1, "4:3": 4, "3:4": 5 };
  function matchImageUiRequest(postData, expected) {
    try {
      const batches = JSON.parse(new URLSearchParams(postData).get("f.req"));
      for (const batch of batches) for (const rpc of batch) {
        if (rpc[0] !== "ogiZ0b") continue;
        const payload = JSON.parse(rpc[1]);
        const items = payload?.[1];
        if (!Array.isArray(items) || items.length === 0) continue;
        const item = items[0];
        if (item?.[8]?.[0]?.[0]?.[0] !== expected.prompt.trim() || item?.[7]?.[5] !== expected.project_id) continue;
        if (item[5] !== expected.model_key || item[4] !== aspectCodes[expected.aspect_ratio] || item[2]?.length) throw new Error("Flow đã gửi cấu hình khác yêu cầu. Kiểm tra ảnh trên Flow trước khi thử lại.");
        return { seeds: items.map((it) => it?.[3]).filter(Boolean), seed: item[3] };
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && !String(error.message).includes("iterable")) throw error;
    }
    return null;
  }
  function parseImageUiResponse(body, request, nativeRequest) {
    if (body.includes("PUBLIC_ERROR_UNUSUAL_ACTIVITY")) throw new Error("PUBLIC_ERROR_UNUSUAL_ACTIVITY: Flow từ chối lượt tạo trên giao diện. Kiểm tra thông báo trong tab Flow.");
    const find = (node) => {
      if (!Array.isArray(node)) return null;
      if (node[0] === "wrb.fr" && node[1] === "ogiZ0b" && typeof node[2] === "string") return JSON.parse(node[2]);
      for (const child of node) {
        const result = find(child);
        if (result) return result;
      }
      return null;
    };
    let payload;
    for (const line of body.split(/\r?\n/)) {
      if (!line.trim().startsWith("[")) continue;
      try {
        payload = find(JSON.parse(line));
      } catch {
        continue;
      }
      if (payload) break;
    }
    const rawAssets = Array.isArray(payload?.[0]) ? payload[0] : [];
    const parsedImages = [];
    for (const asset of rawAssets) {
      const image = asset?.[6];
      const mediaId = asset?.[0];
      const url = image?.[0]?.[13];
      const seed = image?.[0]?.[1];
      let parsed;
      try {
        parsed = new URL(url);
      } catch {
      }
      if (mediaId && parsed?.origin === "https://flow-content.google" && parsed.pathname === `/image/${mediaId}`) {
        parsedImages.push({
          media_id: mediaId,
          image_url: url,
          seed,
          dimensions: image?.[2] || null,
          model_key: request.model_key,
          aspect_ratio: request.aspect_ratio
        });
      }
    }
    if (parsedImages.length === 0) {
      throw new Error("Flow chưa trả về ảnh hợp lệ cho lượt này. Kiểm tra tab Flow trước khi thử lại.");
    }
    return {
      ok: true,
      project_id: request.project_id,
      prompt: request.prompt,
      images: parsedImages,
      diagnostics: {
        adapter: "flow-ui-v1",
        trigger_method: "browser-input",
        rpc: "ogiZ0b",
        count: parsedImages.length
      }
    };
  }
  async function generateImageThroughUi(request, tabId) {
    if (!request?.prompt?.trim() || !aspectCodes[request.aspect_ratio] || !["GEM_PIX_2", "NARWHAL", "HARBOR_SEAL"].includes(request.model_key)) {
      return { ok: false, error: "FLOW_UI: Prompt, model hoặc tỷ lệ không hợp lệ." };
    }
    if (request.reference_image_ids?.length) return { ok: false, error: "FLOW_UI: Luồng tạo ảnh qua giao diện hiện chưa hỗ trợ ảnh tham chiếu." };
    if (!chrome.debugger) return { ok: false, error: "FLOW_UI: Hãy tải lại extension FlowsVeo Clean để cấp quyền điều khiển tab Flow." };
    const target = { tabId };
    let attached = false, armed = false, settled = false, requestId = null, nativeRequest = null;
    let timeout, resolveResult;
    const result = new Promise((resolve) => {
      resolveResult = resolve;
    });
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolveResult(value);
      }
    };
    const fail = (message) => finish({ ok: false, error: `FLOW_UI: ${message}` });
    const command = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);
    const onEvent = (source, method, params) => {
      if (source.tabId !== tabId || source.sessionId || settled || !armed) return;
      if (method === "Network.requestWillBeSent" && !requestId) {
        const req = params.request;
        if (!req?.url?.startsWith("https://flow.google.com/") || !req.url.includes("/data/batchexecute") || !req.postData) return;
        try {
          const match = matchImageUiRequest(req.postData, request);
          if (match) {
            requestId = params.requestId;
            nativeRequest = match;
          }
        } catch (error) {
          fail(error.message);
        }
      } else if (params.requestId === requestId && requestId) {
        if (method === "Network.loadingFailed") fail("Kết nối tạo ảnh bị ngắt. Kiểm tra ảnh trong Flow trước khi thử lại.");
        if (method === "Network.responseReceived" && params.response.status !== 200) fail(`Flow trả HTTP ${params.response.status}. Kiểm tra tab Flow.`);
        if (method === "Network.loadingFinished") {
          command("Network.getResponseBody", { requestId }).then((response) => {
            const body = response.base64Encoded ? new TextDecoder().decode(Uint8Array.from(atob(response.body), (c) => c.charCodeAt(0))) : response.body;
            try {
              finish(parseImageUiResponse(body, request, nativeRequest));
            } catch (error) {
              fail(error.message);
            }
          }).catch(() => fail("Không đọc được kết quả tạo ảnh. Kiểm tra ảnh trong Flow trước khi thử lại."));
        }
      }
    };
    const onDetach = (source) => {
      if (source.tabId === tabId) fail("Chrome ngắt điều khiển tab. Kiểm tra ảnh trong Flow trước khi thử lại.");
    };
    const step = async (action) => {
      if (settled) throw new Error("Lượt điều khiển Flow đã dừng.");
      const injected = await chrome.scripting.executeScript({ target, world: "MAIN", func: imageUiStep, args: [action, request] });
      if (!injected?.length || !Object.hasOwn(injected[0], "result")) throw new Error("Không đọc được điều khiển trong tab Flow. Tải lại tab rồi thử lại.");
      if (injected[0].result?.error) throw new Error(injected[0].result.error);
      return injected[0].result;
    };
    const click = async (point) => {
      if (!point) return;
      if (settled) throw new Error("Lượt điều khiển Flow đã dừng.");
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
      await sleep(250);
    };
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      chrome.debugger.onEvent.addListener(onEvent);
      chrome.debugger.onDetach.addListener(onDetach);
      timeout = setTimeout(() => fail("Hết thời gian chờ. Ảnh có thể vẫn đang tạo; kiểm tra Flow trước khi thử lại."), 13e4);
      await command("Network.enable", { maxPostDataSize: 1024 * 1024, maxResourceBufferSize: 5 * 1024 * 1024, maxTotalBufferSize: 10 * 1024 * 1024 });
      await step("lock");
      await click(await step("closeAccount"));
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      const config = await step("checkConfig");
      if (config?.needsConfig) {
        for (const action of ["openSettings", "mode", "aspect", "count", "modelMenu", "model"]) {
          const pt = await step(action);
          if (pt) await click(pt);
        }
        await step("verify");
        const closePt = await step("closeSettings");
        if (closePt) await click(closePt);
      } else {
        const closePt = await step("closeSettings");
        if (closePt) await click(closePt);
      }
      await step("fill");
      await sleep(350);
      let submitPoint = null;
      const readyDeadline = Date.now() + 15e3;
      while (Date.now() < readyDeadline) {
        const readyRes = await step("generateReady");
        if (readyRes?.ready && readyRes?.point) {
          submitPoint = readyRes.point;
          break;
        }
        await sleep(400);
      }
      if (!submitPoint) {
        submitPoint = await step("generate");
      }
      armed = true;
      await click(submitPoint);
      return await result;
    } catch (error) {
      if (settled) return await result;
      return { ok: false, error: `FLOW_UI: ${attached ? error.message : "Không thể điều khiển tab Flow. Đóng DevTools của tab và tải lại extension rồi thử lại."}` };
    } finally {
      settled = true;
      clearTimeout(timeout);
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      await chrome.scripting.executeScript({ target, world: "MAIN", func: imageUiStep, args: ["unlock", request] }).catch(() => {
      });
      if (attached) await chrome.debugger.detach(target).catch(() => {
      });
    }
  }

  // src/providers/google-flow/page/video-ui.js
  function videoUiStep(action, request) {
    try {
      const fail = (message) => {
        throw new Error(message);
      };
      if (action === "unlock") {
        document.documentElement.removeAttribute("data-flowsveo-video-until");
        return true;
      }
      if (location.hostname !== "flow.google.com" || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== request.project_id) {
        fail("Tab Flow đã chuyển project. Chọn lại project rồi thử lại.");
      }
      const visible = (el) => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && window.getComputedStyle(el).visibility !== "hidden";
      if (action === "lock") {
        document.documentElement.setAttribute("data-flowsveo-video-until", String(Date.now() + 18e4));
        return true;
      }
      const text = (el) => {
        const copy = el.cloneNode(true);
        copy.querySelectorAll('[aria-hidden="true"]').forEach((icon) => icon.remove());
        return copy.textContent.replace(/🍌/gu, "").replace(/\s+/g, " ").trim();
      };
      const find = (selector, predicate) => [...document.querySelectorAll(selector)].find((el) => visible(el) && predicate(el));
      const point = (el) => {
        if (!el) fail("Không tìm thấy điều khiển tạo video trên Flow. Tải lại tab Flow rồi thử lại.");
        if (el.disabled || el.getAttribute("aria-disabled") === "true") fail("Điều khiển trên Flow chưa sẵn sàng.");
        el.scrollIntoView({ block: "nearest" });
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + r.height / 2;
        if (!el.contains(document.elementFromPoint(x, y))) fail("Có cửa sổ đang che điều khiển Flow. Đóng cửa sổ đó rồi thử lại.");
        return { x, y };
      };
      const settings = () => find("button.settings-trigger-button", () => true) || find("button", (el) => /^(Điều kiện kích hoạt cài đặt|Settings trigger)$/i.test(el.getAttribute("aria-label") || ""));
      const radio = (pattern) => find('[role="radio"]', (el) => {
        const t = text(el);
        if (pattern instanceof RegExp) return pattern.test(t);
        return t === pattern || t.includes(pattern);
      });
      const isDrawerOpen = () => Boolean(radio(/video/i) || radio("16:9") || radio("9:16") || radio(/giây|sec/i));
      const modelName = request.model_display_name || "Omni 1.1 Flash";
      const aspect = request.aspect_ratio || "16:9";
      const dur = Number(request.duration_seconds) || 6;
      const res = request.resolution || "720p";
      if (action === "closeAccount") {
        const close = find("button", (el) => /^(Đóng bảng điều khiển tài khoản|Close account panel)$/i.test(el.getAttribute("aria-label") || ""));
        return close ? point(close) : null;
      }
      if (action === "checkConfig") {
        const targetConfig = `video_${modelName}_${aspect}_${dur}s_${res}`;
        const configured = document.documentElement.getAttribute("data-flowsveo-video-configured");
        const s = settings();
        const st = s ? text(s) : "";
        const open = isDrawerOpen();
        if (!open && configured === targetConfig && (st.includes(modelName) || st.includes(aspect))) {
          return { needsConfig: false };
        }
        return { needsConfig: true };
      }
      if (action === "openSettings" || action === "closeSettings") {
        const open = isDrawerOpen();
        return open === (action === "openSettings") ? null : point(settings());
      }
      if (action === "mode") {
        const el = radio(/^video$/i) || radio(/video/i);
        return el?.getAttribute("aria-checked") === "true" ? null : point(el);
      }
      if (action === "aspect") {
        const el = radio(aspect);
        return el?.getAttribute("aria-checked") === "true" ? null : point(el);
      }
      if (action === "resolution") {
        const el = radio(new RegExp(`^${res}`, "i"));
        return el?.getAttribute("aria-checked") === "true" ? null : point(el);
      }
      if (action === "duration") {
        const el = radio(new RegExp(`^${dur}\\s*(giây|s|sec)`, "i")) || radio(String(dur));
        return el?.getAttribute("aria-checked") === "true" ? null : point(el);
      }
      if (action === "modelMenu") {
        const btn = find('button[aria-haspopup="menu"]', (el) => /^(Chọn nhóm mô hình|Select model family|Select model)$/i.test(el.getAttribute("aria-label") || ""));
        if (!btn) return null;
        if (text(btn).includes(modelName)) return null;
        return point(btn);
      }
      if (action === "model") {
        const item = find('[role="menuitem"]', (el) => text(el).includes(modelName));
        return item ? point(item) : null;
      }
      if (action === "verify") {
        const modeRadio = radio(/video/i);
        const aspectRadio = radio(aspect);
        const durRadio = radio(new RegExp(`^${dur}\\s*(giây|s|sec)`, "i")) || radio(String(dur));
        if (modeRadio?.getAttribute("aria-checked") !== "true") {
          fail("Chưa chọn được chế độ Video trên Flow.");
        }
        if (aspectRadio && aspectRadio.getAttribute("aria-checked") !== "true") {
          fail(`Chưa chọn được tỷ lệ khung hình ${aspect} trên Flow.`);
        }
        if (durRadio && durRadio.getAttribute("aria-checked") !== "true") {
          fail(`Chưa chọn được thời lượng ${dur}s trên Flow.`);
        }
        const agent = find("button.agent-mode-chip", () => true);
        if (agent?.getAttribute("aria-pressed") === "true") fail("Hãy tắt chế độ Tác nhân trên Flow trước khi tạo video từ app.");
        const targetConfig = `video_${modelName}_${aspect}_${dur}s_${res}`;
        document.documentElement.setAttribute("data-flowsveo-video-configured", targetConfig);
        return true;
      }
      const editor = () => {
        const editors = [...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
        if (editors.length !== 1) fail("Không xác định được ô prompt Flow. Hãy mở màn hình dự án.");
        return editors[0];
      };
      const frameChips = () => [...document.querySelectorAll('button[aria-label*="Thành phần tạo hình ảnh"], button[aria-label*="image ingredient" i]')].filter(visible);
      const frameMediaIds = () => frameChips().map((chip) => {
        const sources = [...chip.querySelectorAll("img")].map((img) => img.currentSrc || img.src);
        for (const source of sources) {
          const match = source.match(/\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i);
          if (match) return match[1];
        }
        return null;
      });
      if (action === "framePreflight") {
        const ids = frameMediaIds();
        if (ids.length) fail("Flow composer already contains image attachments. Remove them before starting this app job.");
        return { count: 0, ids };
      }
      if (action === "openStartFrame" || action === "openEndFrame") {
        const isStart = action === "openStartFrame";
        const label = isStart ? /^(Bắt đầu|Start|Khung hình bắt đầu)(\b|$)/i : /^(Kết thúc|End|Khung hình kết thúc)(\b|$)/i;
        const el = find("button.empty-chip", (button) => label.test(text(button)) || label.test(button.getAttribute("aria-label") || "")) || find("button", (button) => label.test(text(button)) || label.test(button.getAttribute("aria-label") || ""));
        return point(el);
      }
      if (action === "openImageUpload") {
        const el = find("button", (button) => /Tải nội dung nghe nhìn lên|Upload media|Upload files/i.test(text(button)));
        return point(el);
      }
      if (action === "uploadedAsset") {
        const filename = String(request._upload_filename || "").trim();
        if (!filename) fail("Missing local image filename for Flow upload.");
        const asset = find('[role="option"],button,[role="button"]', (el) => text(el).includes(filename));
        return asset ? { ready: true, point: point(asset) } : { ready: false };
      }
      if (action === "addImageToPrompt") {
        const el = find("button", (button) => /Thêm vào câu lệnh|Add to prompt/i.test(text(button)));
        return point(el);
      }
      if (action === "frameStatus") {
        const ids = frameMediaIds();
        return { count: ids.length, ids };
      }
      if (action === "fill") {
        const el = editor();
        if (el.querySelector('img,[contenteditable="false"]')) fail("Hãy bỏ ảnh/thành phần đính kèm khỏi ô prompt Flow trước.");
        el.focus();
        try {
          document.execCommand("selectAll", false, null);
          document.execCommand("delete", false, null);
        } catch {
        }
        if (!document.execCommand("insertText", false, request.prompt.trim())) {
          el.innerText = request.prompt.trim();
        }
        try {
          el.dispatchEvent(new window.Event("input", { bubbles: true }));
          el.dispatchEvent(new window.Event("change", { bubbles: true }));
        } catch {
        }
        return true;
      }
      if (action === "generateReady") {
        const btn = find("button", (el) => /^(Bắt đầu tạo|Start generation|Generate|Start creating)$/i.test(el.getAttribute("aria-label") || ""));
        if (!btn || btn.disabled || btn.getAttribute("aria-disabled") === "true") {
          return { ready: false };
        }
        try {
          return { ready: true, point: point(btn) };
        } catch {
          return { ready: false };
        }
      }
      if (action === "generate") {
        if (editor().innerText.trim() !== request.prompt.trim()) fail("Prompt trên Flow không khớp yêu cầu. Chưa tạo video.");
        return point(find("button", (el) => /^(Bắt đầu tạo|Start generation|Generate|Start creating)$/i.test(el.getAttribute("aria-label") || "")));
      }
      fail("Unknown Flow video UI step");
    } catch (error) {
      return { error: error?.message || "Không đọc được giao diện Flow." };
    }
  }

  // src/providers/google-flow/page/recovery.js
  async function recoverCurrentSceneInPage(providerModelId = "", targetMediaId = null) {
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    function isVideoCandidate(value) {
      if (typeof value !== "string" || !value.trim()) return false;
      let url;
      try {
        url = new URL(value, location.href);
      } catch {
        return false;
      }
      if (url.protocol !== "https:" || url.hostname !== "flow-content.google") return false;
      const pathname = url.pathname.toLowerCase();
      if (pathname.startsWith("/image") || pathname.includes("/image/")) return false;
      if (/\.(?:jpg|jpeg|png|webp|gif|avif)(?:$|[?#])/.test(pathname)) return false;
      if (/(?:preview|thumbnail|poster|sprite)/.test(pathname)) return false;
      return true;
    }
    function isLikelyFlowVideoUrl(value) {
      if (typeof value !== "string" || !value.trim()) return false;
      let parsed;
      try {
        parsed = new URL(value, location.href);
      } catch {
        return false;
      }
      if (parsed.protocol !== "https:" || parsed.hostname !== "flow-content.google") return false;
      const pathname = parsed.pathname.toLowerCase();
      if (pathname.startsWith("/image") || pathname.includes("/image/")) return false;
      if (/\.(?:jpg|jpeg|png|webp|gif|avif)(?:$|[?#])/.test(pathname)) return false;
      if (/(?:preview|thumbnail|poster|sprite)/.test(pathname)) return false;
      return pathname.includes("/video") || /\.mp4(?:$|[?#])/i.test(pathname);
    }
    function findVideoUrl(node) {
      if (!node) return null;
      if (typeof node === "string") {
        return isLikelyFlowVideoUrl(node) ? node : null;
      }
      if (Array.isArray(node)) {
        for (const child of node) {
          const u = findVideoUrl(child);
          if (u) return u;
        }
      } else if (typeof node === "object") {
        for (const v of Object.values(node)) {
          const u = findVideoUrl(v);
          if (u) return u;
        }
      }
      return null;
    }
    function findImageUrl(node) {
      if (!node) return null;
      if (typeof node === "string") {
        try {
          const parsed = new URL(node, location.href);
          if (parsed.protocol === "https:" && parsed.hostname === "flow-content.google") {
            const pathname = parsed.pathname.toLowerCase();
            if (pathname.includes("/image/") || pathname.startsWith("/image")) return node;
          }
        } catch {
        }
        return null;
      }
      if (Array.isArray(node)) {
        for (const child of node) {
          const u = findImageUrl(child);
          if (u) return u;
        }
      } else if (typeof node === "object") {
        for (const v of Object.values(node)) {
          const u = findImageUrl(v);
          if (u) return u;
        }
      }
      return null;
    }
    function findMediaAsset(node) {
      if (!Array.isArray(node)) return null;
      if (typeof node[0] === "string" && (node[3] === "CAE" || node[3] === "CAM" || node[3] === "CAI")) return node;
      for (const child of node) {
        const found = findMediaAsset(child);
        if (found) return found;
      }
      return null;
    }
    try {
      const activeGen = (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__;
      const activeModelId = activeGen?.modelId || providerModelId || "abra_t2v_6s";
      let route = location.pathname.match(/^\/(u\/\d+)\/project\/([^/?#]+)/);
      let accountPath = route ? `/${route[1]}` : "";
      let projectId = route ? route[2] : null;
      if (!projectId) {
        const match2 = location.pathname.match(/\/project\/([^/?#]+)/);
        if (match2) {
          projectId = match2[1];
          const uMatch = location.pathname.match(/\/(u\/\d+)/);
          accountPath = uMatch ? `/${uMatch[1]}` : "";
        }
      }
      const wiz = window.WIZ_global_data || {};
      const csrfToken = wiz.SNlM0e;
      const sessionId = wiz.FdrFJe;
      const buildLabel = wiz.cfb2h;
      async function callRpcInPage(rpcId, payload) {
        if (!csrfToken || !sessionId || !buildLabel || !projectId) return null;
        try {
          const sourcePath = `/project/${projectId}`;
          const query = new URLSearchParams({
            rpcids: rpcId,
            "source-path": sourcePath,
            bl: String(buildLabel),
            "f.sid": String(sessionId),
            hl: String(document.documentElement?.lang || "en").split("-")[0],
            _reqid: String(Math.floor(1e5 + Math.random() * 9e5)),
            rt: "c"
          });
          const body = new URLSearchParams({
            "f.req": JSON.stringify([[[rpcId, JSON.stringify(payload), null, "generic"]]]),
            at: String(csrfToken)
          });
          const base = location.origin || "https://flow.google.com";
          const endpoint = `${base}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`;
          const response = await fetch(endpoint, {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
              "X-Same-Domain": "1"
            },
            body: body.toString()
          });
          if (!response.ok) return null;
          const text = await response.text();
          for (const line of text.split(/\r?\n/)) {
            const trimmed = line.trim();
            if (!trimmed.startsWith("[")) continue;
            try {
              const parsed = JSON.parse(trimmed);
              const findEnv = (node) => {
                if (!Array.isArray(node)) return null;
                if (node[0] === "wrb.fr" && node[1] === rpcId && typeof node[2] === "string") return node[2];
                for (const c of node) {
                  const f = findEnv(c);
                  if (f !== null) return f;
                }
                return null;
              };
              const p = findEnv(parsed);
              if (p !== null) return JSON.parse(p);
            } catch {
            }
          }
        } catch {
        }
        return null;
      }
      let mediaIdToQuery = targetMediaId || activeGen?.mediaId || null;
      if (projectId) {
        try {
          const sceneData = await callRpcInPage("Zzl0ze", [`projects/${projectId}`, null, null, null, [1]]);
          const sceneVideoUrl = mediaIdToQuery ? null : findVideoUrl(sceneData);
          if (sceneVideoUrl) {
            try {
              (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null;
            } catch {
            }
            return {
              ok: true,
              video_url: sceneVideoUrl,
              image_url: findImageUrl(sceneData),
              media_id: mediaIdToQuery || null,
              provider_model_id: activeModelId,
              project_id: projectId
            };
          }
          const rawAssets = Array.isArray(sceneData?.[2]) ? sceneData[2] : [];
          for (const ast of rawAssets) {
            if (Array.isArray(ast) && (ast[3] === "CAE" || ast[3] === "CAM") && (!mediaIdToQuery || ast[0] === mediaIdToQuery)) {
              const vUrl = findVideoUrl(ast);
              if (vUrl) {
                try {
                  (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null;
                } catch {
                }
                return {
                  ok: true,
                  video_url: vUrl,
                  image_url: findImageUrl(ast),
                  media_id: ast[0] || mediaIdToQuery,
                  provider_model_id: activeModelId,
                  project_id: projectId
                };
              }
            }
          }
          if (!mediaIdToQuery) {
            const rawNodes = sceneData?.[1] || [];
            let newestMediaId = null;
            let newestTime = 0;
            for (const node of rawNodes) {
              try {
                const info = node?.[3];
                const timeSec = info?.[1]?.[0] || 0;
                const mid = info?.[4];
                if (mid && timeSec > newestTime) {
                  newestTime = timeSec;
                  newestMediaId = mid;
                }
              } catch {
              }
            }
            if (newestMediaId) mediaIdToQuery = newestMediaId;
          }
        } catch {
        }
      }
      if (mediaIdToQuery) {
        try {
          const finalAsset = await callRpcInPage("as29s", [mediaIdToQuery]);
          const asUrl = findVideoUrl(finalAsset);
          if (asUrl) {
            try {
              (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null;
            } catch {
            }
            return {
              ok: true,
              video_url: asUrl,
              image_url: findImageUrl(finalAsset),
              media_id: mediaIdToQuery,
              provider_model_id: activeModelId,
              project_id: projectId
            };
          }
        } catch {
        }
        try {
          const pollResp = await callRpcInPage("jwpduf", [null, null, [[mediaIdToQuery]]]);
          const pollUrl = findVideoUrl(pollResp);
          if (pollUrl) {
            try {
              (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null;
            } catch {
            }
            return {
              ok: true,
              video_url: pollUrl,
              image_url: findImageUrl(pollResp),
              media_id: mediaIdToQuery,
              provider_model_id: activeModelId,
              project_id: projectId
            };
          }
          const asset = findMediaAsset(pollResp);
          const status = asset?.[5]?.[8]?.[0] ?? asset?.[5]?.[0]?.[8]?.[0];
          if (status === 3) {
            const finalAsset = await callRpcInPage("as29s", [mediaIdToQuery]);
            const asUrl = findVideoUrl(finalAsset);
            if (asUrl) {
              try {
                (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null;
              } catch {
              }
              return {
                ok: true,
                video_url: asUrl,
                image_url: findImageUrl(finalAsset),
                media_id: mediaIdToQuery,
                provider_model_id: activeModelId,
                project_id: projectId
              };
            }
          }
          if (status !== 1 && status !== 2 && status !== 3 && status !== void 0 && status !== null) {
            return {
              ok: false,
              terminal_error: true,
              error: `Flow render ended with status ${status} (media_id=${mediaIdToQuery})`
            };
          }
        } catch {
        }
      }
      const candidates = [];
      const videos = Array.from(document.querySelectorAll("video")).reverse();
      for (const video of videos) {
        if (video.currentSrc) candidates.push(video.currentSrc);
        if (video.src) candidates.push(video.src);
        for (const source of video.querySelectorAll("source")) {
          if (source.src) candidates.push(source.src);
        }
      }
      for (const element of document.querySelectorAll("a[href], [src], [data-src], [data-video-url], [data-url]")) {
        for (const attr of ["href", "src", "data-src", "data-video-url", "data-url"]) {
          const value = element.getAttribute?.(attr);
          if (value) candidates.push(value);
        }
      }
      try {
        const resources = performance.getEntriesByType("resource").slice().reverse();
        for (const entry of resources) if (entry.name) candidates.push(entry.name);
      } catch {
      }
      const uniqueCandidates = [...new Set(candidates)];
      const exactMatch = mediaIdToQuery ? uniqueCandidates.find((c) => isVideoCandidate(c) && c.includes(mediaIdToQuery)) : null;
      const candidatesToProbe = mediaIdToQuery ? exactMatch ? [exactMatch] : [] : uniqueCandidates.filter(isVideoCandidate);
      for (const candidate of candidatesToProbe) {
        let url;
        try {
          url = new URL(candidate, location.href);
        } catch {
          continue;
        }
        try {
          const probe = await fetch(url.href, {
            method: "GET",
            credentials: "omit",
            cache: "no-store",
            headers: { Range: "bytes=0-1023" },
            signal: AbortSignal.timeout(6e3)
          });
          const contentType = (probe.headers.get("Content-Type") || "").toLowerCase();
          if (probe.ok && (contentType.startsWith("video/") || contentType === "application/octet-stream")) {
            try {
              await probe.body?.cancel();
            } catch {
            }
            try {
              (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null;
            } catch {
            }
            return {
              ok: true,
              video_url: url.href,
              media_id: mediaIdToQuery || null,
              provider_model_id: activeModelId,
              project_id: projectId
            };
          }
          try {
            await probe.body?.cancel();
          } catch {
          }
        } catch {
        }
      }
      const isGenerating = Boolean(
        document.querySelector('[role="progressbar"], [aria-label*="generating" i], [aria-label*="creating" i], .generating, [data-is-generating="true"]')
      );
      return {
        ok: false,
        is_generating: isGenerating,
        error: isGenerating ? "Flow is still rendering video in scene" : "No completed Flow video URL found in the open scene"
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  // src/providers/google-flow/video-ui.js
  function matchVideoUiRequest(postData, expected, attachedFrameIds = null) {
    try {
      const raw = new URLSearchParams(postData).get("f.req");
      if (!raw) return null;
      const batches = JSON.parse(raw);
      for (const batch of batches) for (const rpc of batch) {
        if (rpc[0] !== "YhhmEf" && rpc[0] !== "nprQif") continue;
        const payload = JSON.parse(rpc[1]);
        if (expected?.input_mode !== "frames") return { rpcId: rpc[0], payload };
        if (rpc[0] !== "nprQif") continue;
        const item = payload?.[0]?.[0];
        const actualPrompt = item?.[0]?.[2];
        const promptMatches = (() => {
          const values = [];
          const walk = (value) => {
            if (typeof value === "string") values.push(value);
            else if (Array.isArray(value)) value.forEach(walk);
          };
          walk(actualPrompt);
          return values.includes(String(expected.prompt || "").trim());
        })();
        const startId = item?.[4]?.[1] || null;
        const endId = item?.[5]?.[1] || null;
        const expectedStart = attachedFrameIds?.[0] || null;
        const expectedEnd = attachedFrameIds?.[1] || null;
        const projectId = payload?.[1]?.[5] || null;
        const checks = [
          [promptMatches, "Prompt in the Flow request does not match the submitted job."],
          [projectId === expected.project_id, "Flow request project does not match the selected project."],
          [item?.[1] === expected.provider_model_id, "Flow selected a different video model/duration than the app request."],
          [Number(item?.[2]) === Number(expected.num_outputs || 1), "Flow output count does not match the app request."],
          [startId === expectedStart, "Flow start frame ID does not match the attached Start Frame."],
          [endId === expectedEnd, "Flow end frame ID does not match the attached End Frame."]
        ];
        const mismatch = checks.find(([ok]) => !ok);
        return mismatch ? { rpcId: rpc[0], payload, error: mismatch[1] } : { rpcId: rpc[0], payload, start_media_id: startId, end_media_id: endId };
      }
    } catch (error) {
      if (!(error instanceof SyntaxError) && !String(error.message).includes("iterable")) throw error;
    }
    return null;
  }
  function parseVideoUiCreateResponse(body, expected = null) {
    if (body.includes("PUBLIC_ERROR_UNUSUAL_ACTIVITY")) {
      throw new Error("PUBLIC_ERROR_UNUSUAL_ACTIVITY: Flow rejected video creation. Check the message in the Flow tab.");
    }
    const findRpc = (node) => {
      if (!Array.isArray(node)) return null;
      if (node[0] === "wrb.fr" && (node[1] === "YhhmEf" || node[1] === "nprQif") && typeof node[2] === "string") {
        return { rpcId: node[1], payload: JSON.parse(node[2]) };
      }
      for (const child of node) {
        const res = findRpc(child);
        if (res) return res;
      }
      return null;
    };
    let response = null;
    for (const line of body.split(/\r?\n/)) {
      if (!line.trim().startsWith("[")) continue;
      try {
        response = findRpc(JSON.parse(line));
      } catch {
        continue;
      }
      if (response) break;
    }
    if (!response) throw new Error("Flow did not return video creation data.");
    const isUuid = (value) => typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    const records = [];
    const walk = (node) => {
      if (!Array.isArray(node)) return;
      if (node.length >= 4 && isUuid(node[0]) && (node[3] === "CAE" || node[3] === "CAM")) records.push(node);
      node.forEach(walk);
    };
    walk(response.payload);
    const record = records.find((item) => !expected?.project_id || item[1] === expected.project_id);
    if (record) {
      return { mediaId: record[0], sceneId: record[2] || null, projectId: record[1] || null };
    }
    if (response.rpcId === "nprQif") {
      throw new Error("Flow response contains no video asset record for the selected project.");
    }
    const findMediaId = (node) => {
      if (isUuid(node)) return node;
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = findMediaId(child);
          if (found) return found;
        }
      }
      return null;
    };
    const mediaId = findMediaId(response.payload);
    if (!mediaId) throw new Error("Could not find the video media ID in the Flow response.");
    return { mediaId };
  }
  var AsyncMutex = class {
    constructor() {
      this._queue = [];
      this._locked = false;
    }
    async acquire(timeoutMs = 12e4) {
      if (!this._locked) {
        this._locked = true;
        let released = false;
        return () => {
          if (!released) {
            released = true;
            this.release();
          }
        };
      }
      return new Promise((resolve, reject) => {
        let timer = null;
        const entry = {
          resolve: (releaseFn) => {
            if (timer) clearTimeout(timer);
            resolve(releaseFn);
          },
          reject: (err) => {
            if (timer) clearTimeout(timer);
            reject(err);
          }
        };
        if (timeoutMs > 0) {
          timer = setTimeout(() => {
            const idx = this._queue.indexOf(entry);
            if (idx !== -1) {
              this._queue.splice(idx, 1);
              reject(new Error("FLOW_UI: Hết thời gian chờ lượt tương tác giao diện (120s)."));
            }
          }, timeoutMs);
        }
        this._queue.push(entry);
      });
    }
    release() {
      if (this._queue.length > 0) {
        const next = this._queue.shift();
        let released = false;
        this._locked = true;
        next.resolve(() => {
          if (!released) {
            released = true;
            this.release();
          }
        });
      } else {
        this._locked = false;
      }
    }
  };
  var videoUiMutex = new AsyncMutex();
  async function generateVideoThroughUi(flowRequest, tabId) {
    if (!flowRequest?.prompt?.trim()) {
      return { ok: false, error: "FLOW_UI: Prompt video không được để trống." };
    }
    if (!chrome.debugger) {
      return { ok: false, error: "FLOW_UI: Hãy tải lại extension FlowsVeo Clean để cấp quyền điều khiển tab Flow." };
    }
    let releaseUiLock;
    try {
      releaseUiLock = await videoUiMutex.acquire(12e4);
    } catch (lockErr) {
      return { ok: false, error: lockErr.message };
    }
    const target = { tabId };
    const isFrames = flowRequest.input_mode === "frames";
    let attached = false, armed = false, settled = false, requestId = null;
    let pendingChooser = null;
    let attachedFrameIds = null;
    let timeout, resolveResult;
    const result = new Promise((resolve) => {
      resolveResult = resolve;
    });
    const finish = (value) => {
      if (!settled) {
        settled = true;
        resolveResult(value);
      }
    };
    const fail = (message) => finish({ ok: false, error: `FLOW_UI: ${message}` });
    const command = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);
    let capturedMediaId = null;
    const onEvent = (source, method, params) => {
      if (source.tabId !== tabId || source.sessionId) return;
      if (method === "Page.fileChooserOpened" && pendingChooser) {
        const chooser = pendingChooser;
        pendingChooser = null;
        clearTimeout(chooser.timer);
        command("DOM.setFileInputFiles", { backendNodeId: params.backendNodeId, files: [chooser.path] }).then(() => chooser.resolve()).catch((error) => chooser.reject(new Error(`Could not select image file in Chrome: ${error.message}`)));
        return;
      }
      if (settled || !armed) return;
      if (method === "Network.requestWillBeSent" && !requestId) {
        const req = params.request;
        if (!req?.url?.startsWith("https://flow.google.com/") || !req.url.includes("/data/batchexecute") || !req.postData) return;
        try {
          const match = matchVideoUiRequest(req.postData, flowRequest, attachedFrameIds);
          if (match?.error) fail(match.error);
          else if (match) requestId = params.requestId;
        } catch (error) {
          fail(error.message);
        }
      } else if (params.requestId === requestId && requestId) {
        if (method === "Network.loadingFailed") fail("Kết nối tạo video bị ngắt.");
        if (method === "Network.responseReceived" && params.response.status !== 200) fail(`Flow trả HTTP ${params.response.status}.`);
        if (method === "Network.loadingFinished") {
          command("Network.getResponseBody", { requestId }).then((response) => {
            const body = response.base64Encoded ? new TextDecoder().decode(Uint8Array.from(atob(response.body), (c) => c.charCodeAt(0))) : response.body;
            try {
              const parsed = parseVideoUiCreateResponse(body, flowRequest);
              capturedMediaId = parsed.mediaId;
              finish({ ok: true, media_id: capturedMediaId });
            } catch (error) {
              fail(error.message);
            }
          }).catch(() => fail("Không đọc được phản hồi tạo video từ Flow."));
        }
      }
    };
    const onDetach = (source) => {
      if (source.tabId === tabId) fail("Chrome ngắt điều khiển tab Flow.");
    };
    const step = async (action, request = flowRequest) => {
      if (settled) throw new Error("Lượt điều khiển Flow đã dừng.");
      const injected = await chrome.scripting.executeScript({ target, world: "MAIN", func: videoUiStep, args: [action, request] });
      if (!injected?.length || !Object.hasOwn(injected[0], "result")) throw new Error("Không đọc được điều khiển trong tab Flow. Tải lại tab rồi thử lại.");
      if (injected[0].result?.error) throw new Error(injected[0].result.error);
      return injected[0].result;
    };
    const click = async (point) => {
      if (!point) return;
      if (settled) throw new Error("Lượt điều khiển Flow đã dừng.");
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
      await sleep(250);
    };
    const uploadFrame = async (slot, filePath, filename) => {
      if (!filePath || !filename) throw new Error(`The ${slot} frame has no readable local file path.`);
      const isAbsolute = /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith("\\\\") || filePath.startsWith("/");
      if (!isAbsolute) throw new Error(`The ${slot} frame path is not absolute.`);
      await click(await step(slot === "start" ? "openStartFrame" : "openEndFrame"));
      let chooserResolve, chooserReject;
      const chooserReady = new Promise((resolve, reject) => {
        chooserResolve = resolve;
        chooserReject = reject;
      });
      pendingChooser = {
        path: filePath,
        resolve: chooserResolve,
        reject: chooserReject,
        timer: setTimeout(() => {
          if (pendingChooser) pendingChooser = null;
          chooserReject(new Error("Chrome did not open the image file chooser."));
        }, 15e3)
      };
      try {
        await click(await step("openImageUpload"));
        await chooserReady;
      } catch (error) {
        if (pendingChooser) {
          clearTimeout(pendingChooser.timer);
          pendingChooser = null;
        }
        throw error;
      }
      const uploadRequest = { ...flowRequest, _upload_filename: filename };
      const uploadDeadline = Date.now() + 9e4;
      let assetPoint = null;
      while (Date.now() < uploadDeadline) {
        const asset = await step("uploadedAsset", uploadRequest);
        if (asset?.ready && asset.point) {
          assetPoint = asset.point;
          break;
        }
        await sleep(500);
      }
      if (!assetPoint) throw new Error(`Flow did not finish uploading frame file: ${filename}`);
      await click(assetPoint);
      await click(await step("addImageToPrompt"));
      const wantedCount = slot === "end" ? 2 : 1;
      const attachDeadline = Date.now() + 15e3;
      while (Date.now() < attachDeadline) {
        const status = await step("frameStatus");
        if (status?.count === wantedCount && status.ids?.every(Boolean)) return status.ids;
        await sleep(300);
      }
      throw new Error(`Flow did not attach the ${slot} frame to the prompt.`);
    };
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      chrome.debugger.onEvent.addListener(onEvent);
      chrome.debugger.onDetach.addListener(onDetach);
      timeout = setTimeout(() => fail("Timed out waiting for the Flow video request."), isFrames ? 18e4 : 6e4);
      await command("Network.enable", { maxPostDataSize: 1024 * 1024, maxResourceBufferSize: 5 * 1024 * 1024, maxTotalBufferSize: 10 * 1024 * 1024 });
      if (isFrames) {
        await command("Page.enable");
        await command("DOM.enable");
        await command("Page.setInterceptFileChooserDialog", { enabled: true, cancel: false });
      }
      await step("lock");
      await click(await step("closeAccount"));
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(200);
      const config = await step("checkConfig");
      if (config?.needsConfig) {
        for (const action of ["openSettings", "mode", "aspect", "resolution", "duration", "modelMenu", "model"]) {
          const pt = await step(action);
          if (pt) await click(pt);
        }
        await step("verify");
        const closePt = await step("closeSettings");
        if (closePt) await click(closePt);
      } else {
        const closePt = await step("closeSettings");
        if (closePt) await click(closePt);
      }
      if (isFrames) await step("framePreflight");
      await step("fill");
      await sleep(350);
      if (isFrames) {
        await uploadFrame("start", flowRequest.image_local_path, flowRequest.image_name);
        attachedFrameIds = await step("frameStatus").then((status) => status.ids);
        if (flowRequest.end_image_local_path) {
          await uploadFrame("end", flowRequest.end_image_local_path, flowRequest.end_image_name);
          attachedFrameIds = await step("frameStatus").then((status) => status.ids);
        }
        const expectedCount = flowRequest.end_image_local_path ? 2 : 1;
        if (!Array.isArray(attachedFrameIds) || attachedFrameIds.length !== expectedCount || attachedFrameIds.some((id) => !id)) {
          throw new Error("Could not verify the attached Flow frame IDs.");
        }
      }
      let submitPoint = null;
      const readyDeadline = Date.now() + 15e3;
      while (Date.now() < readyDeadline) {
        const readyRes = await step("generateReady");
        if (readyRes?.ready && readyRes?.point) {
          submitPoint = readyRes.point;
          break;
        }
        await sleep(400);
      }
      if (!submitPoint) {
        submitPoint = await step("generate");
      }
      armed = true;
      await click(submitPoint);
      const createResult = await result;
      if (!createResult.ok) return createResult;
      const mediaId = createResult.media_id;
      clearTimeout(timeout);
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      await chrome.scripting.executeScript({ target, world: "MAIN", func: videoUiStep, args: ["unlock", flowRequest] }).catch(() => {
      });
      if (attached) {
        await chrome.debugger.detach(target).catch(() => {
        });
        attached = false;
      }
      await sleep(1500);
      if (releaseUiLock) {
        releaseUiLock();
        releaseUiLock = null;
      }
      const pollStart = Date.now();
      const renderDeadline = Date.now() + 54e4;
      while (Date.now() < renderDeadline) {
        await sleep(3500);
        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: recoverCurrentSceneInPage,
          args: [flowRequest.provider_model_id || "abra_t2v_6s", mediaId]
        }).catch(() => null);
        const pollResult = injected?.[0]?.result;
        if (pollResult && pollResult.ok && pollResult.video_url) {
          return {
            ok: true,
            video_url: pollResult.video_url,
            image_url: pollResult.image_url || null,
            media_id: mediaId,
            provider_model_id: flowRequest.provider_model_id || "abra_t2v_6s",
            project_id: flowRequest.project_id
          };
        }
        if (Date.now() - pollStart > 15e3) {
          const fallbackInjected = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: recoverCurrentSceneInPage,
            args: [flowRequest.provider_model_id || "abra_t2v_6s", null]
          }).catch(() => null);
          const fallbackResult = fallbackInjected?.[0]?.result;
          if (fallbackResult && fallbackResult.ok && fallbackResult.video_url) {
            return {
              ok: true,
              video_url: fallbackResult.video_url,
              image_url: fallbackResult.image_url || null,
              media_id: fallbackResult.media_id || mediaId,
              provider_model_id: flowRequest.provider_model_id || "abra_t2v_6s",
              project_id: flowRequest.project_id
            };
          }
        }
        if (pollResult?.terminal_error) {
          return { ok: false, error: `Google Flow từ chối render: ${pollResult.error}` };
        }
      }
      return { ok: false, error: "Hết thời gian chờ video render xong trên Google Flow (9 phút)." };
    } catch (error) {
      if (settled) return await result;
      return { ok: false, error: `FLOW_UI: ${attached ? error.message : "Không thể điều khiển tab Flow."}` };
    } finally {
      settled = true;
      clearTimeout(timeout);
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      await chrome.scripting.executeScript({ target, world: "MAIN", func: videoUiStep, args: ["unlock", flowRequest] }).catch(() => {
      });
      if (attached) await chrome.debugger.detach(target).catch(() => {
      });
      if (releaseUiLock) {
        releaseUiLock();
        releaseUiLock = null;
      }
    }
  }

  // src/providers/google-flow/page/motion-ui.js
  async function readMotionAssetCatalog(projectId) {
    try {
      if (location.hostname !== "flow.google.com" || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== projectId) {
        throw new Error("Flow tab changed project.");
      }
      const wiz = window.WIZ_global_data || {};
      if (!wiz.SNlM0e || !wiz.FdrFJe || !wiz.cfb2h) throw new Error("Flow session metadata is unavailable.");
      const rpc = "Zzl0ze";
      const query = new URLSearchParams({
        rpcids: rpc,
        "source-path": location.pathname,
        bl: wiz.cfb2h,
        "f.sid": wiz.FdrFJe,
        hl: document.documentElement.lang || "vi",
        _reqid: String(Math.floor(1e5 + Math.random() * 9e5)),
        rt: "c"
      });
      const body = new URLSearchParams({
        at: wiz.SNlM0e,
        "f.req": JSON.stringify([[[rpc, JSON.stringify([`projects/${projectId}`, null, null, null, [1]]), null, "generic"]]])
      });
      const response = await fetch(`${location.origin}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: { "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8", "X-Same-Domain": "1" },
        body: body.toString()
      });
      if (!response.ok) throw new Error(`Flow asset catalog returned HTTP ${response.status}.`);
      const raw = await response.text();
      const envelope = (node) => {
        if (!Array.isArray(node)) return null;
        if (node[0] === "wrb.fr" && node[1] === rpc && typeof node[2] === "string") return JSON.parse(node[2]);
        for (const child of node) {
          const result = envelope(child);
          if (result) return result;
        }
        return null;
      };
      let data = null;
      for (const line of raw.split(/\r?\n/)) {
        if (!line.trim().startsWith("[")) continue;
        try {
          data = envelope(JSON.parse(line));
        } catch {
          continue;
        }
        if (data) break;
      }
      if (!Array.isArray(data?.[2])) throw new Error("Flow returned no asset catalog.");
      return { assets: data[2].filter((asset) => asset?.[1] === projectId).map((asset) => ({
        id: asset[0],
        thumbnails: [asset?.[5]?.[5], asset?.[5]?.[10]].filter((url) => typeof url === "string" && url.startsWith("https://"))
      })) };
    } catch (error) {
      return { error: error.message || "Could not read the Flow asset catalog." };
    }
  }
  function motionUiStep(action, req) {
    try {
      const fail = (message) => {
        throw new Error(message);
      };
      if (location.hostname !== "flow.google.com" || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== req.project_id) {
        fail("Flow tab changed project.");
      }
      const visible = (el) => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && window.getComputedStyle(el).visibility !== "hidden";
      const norm = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\u0111/gi, "d").replace(/\s+/gu, " ").trim().toLowerCase();
      const text = (el) => {
        const clone = el.cloneNode(true);
        clone.querySelectorAll('[aria-hidden="true"]').forEach((item) => item.remove());
        return norm(clone.innerText || clone.textContent);
      };
      const label = (el) => norm(el?.getAttribute("aria-label")) || text(el);
      const find = (selector, predicate) => [...document.querySelectorAll(selector)].find((el) => visible(el) && predicate(el));
      const point = (el) => {
        if (!el) fail(`Flow control not found: ${action}`);
        if (el.disabled || el.getAttribute("aria-disabled") === "true") fail(`Flow control is disabled: ${action}`);
        el.scrollIntoView({ block: "nearest" });
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        const topEl = document.elementFromPoint(x, y);
        if (topEl && !el.contains(topEl) && !topEl.contains(el)) {
          fail(`Flow control is covered: ${action} by ${topEl.tagName}.${String(topEl.className || "").slice(0, 140)}`);
        }
        return { x, y };
      };
      const radio = (pattern) => find('[role="radio"]', (el) => {
        const actual = text(el);
        return pattern instanceof RegExp ? pattern.test(actual) : actual === norm(pattern) || actual.includes(norm(pattern));
      });
      const modelButton = () => find('button[aria-haspopup="menu"]', (el) => /^(chon nhom mo hinh|select model family|select model)$/.test(label(el)));
      const editor = () => {
        const editors = [...document.querySelectorAll('.base-prompt-box [contenteditable="true"]')].filter(visible);
        if (editors.length !== 1) fail("Open the Flow project prompt editor before using Motion Control.");
        return editors[0];
      };
      const videoChips = () => [
        ...document.querySelectorAll(
          '.base-prompt-box flow-video-ingredient-chip, .base-prompt-box [class*="video-ingredient"]'
        )
      ].filter((el, index, all) => visible(el) && !all.some((other) => other !== el && other.contains(el)));
      const imageChips = () => [
        ...document.querySelectorAll(
          '.base-prompt-box flow-image-ingredient-chip, .base-prompt-box [class*="image-ingredient"]'
        )
      ].filter((el, index, all) => visible(el) && !all.some((other) => other !== el && other.contains(el)));
      const mediaId = (el) => {
        const thumbnailKey = (url) => {
          try {
            const parsed = new URL(url);
            const path = parsed.pathname.replace(/=s\d+[^/]*$/, "");
            if (path.startsWith("/asb/") && ["flow.google.com", "lh3.googleusercontent.com"].includes(parsed.hostname)) return path;
            return parsed.origin + path;
          } catch {
            return null;
          }
        };
        for (const img of el?.querySelectorAll("img, video") || []) {
          for (const src of [img.src, img.currentSrc]) {
            try {
              const match = new URL(src).pathname.match(/\/(?:image|video)\/([0-9a-f-]{36})(?:\/|$)/i);
              if (match) return match[1];
              const key = thumbnailKey(src);
              const matches = (req.asset_catalog || []).filter((asset) => asset.thumbnails.some((url) => thumbnailKey(url) === key));
              if (matches.length === 1) return matches[0].id;
            } catch {
            }
          }
        }
        return null;
      };
      const assetOptions = () => [...document.querySelectorAll('[role="option"].asset-item')].filter(visible);
      const addButton = () => find("button.detail-add-to-prompt-btn", () => true) || find("button:not(.add-menu-trigger)", (el) => /^(them vao cau lenh|add to prompt)$/.test(label(el)));
      if (action === "unlock") {
        document.documentElement.removeAttribute("data-flowsveo-motion-until");
        return true;
      }
      if (action === "dismissBackdrop") {
        const backdrop = find(".cdk-overlay-backdrop.cdk-overlay-transparent-backdrop", () => true);
        if (!backdrop) return null;
        const rect = backdrop.getBoundingClientRect();
        for (const [x, y] of [[rect.left + 8, rect.top + 8], [rect.right - 8, rect.top + 8], [rect.left + 8, rect.bottom - 8]]) {
          if (document.elementFromPoint(x, y) === backdrop) return { x, y };
        }
        return null;
      }
      if (action === "lock") {
        document.documentElement.setAttribute("data-flowsveo-motion-until", String(Date.now() + 108e4));
        return true;
      }
      if (action === "closeAccount") {
        const close = find("button", (el) => /^(dong bang dieu khien tai khoan|close account panel)$/.test(label(el)));
        return close ? point(close) : null;
      }
      if (action === "preflight") {
        const clearBtn = find(".base-prompt-box button.clear-button", () => true);
        if (clearBtn) {
          clearBtn.click();
        }
        try {
          const ed = editor();
          if (ed && ed.innerText.trim()) {
            ed.focus();
            document.execCommand("selectAll", false, null);
            document.execCommand("delete", false, null);
          }
        } catch {
        }
        return true;
      }
      if (action === "removeIngredient") {
        const chip = [...videoChips(), ...imageChips()][0];
        if (!chip) return null;
        return point(chip.querySelector(".hover-icon-overlay") || chip.querySelector('button[aria-label*="remove" i]'));
      }
      if (action === "openSettings" || action === "closeSettings") {
        const isOpen = Boolean(radio("x1"));
        return isOpen === (action === "openSettings") ? null : point(find("button.settings-trigger-button", () => true));
      }
      if (action === "mode" || action === "ingredients" || action === "aspect" || action === "resolution" || action === "duration" || action === "count") {
        const selected = action === "mode" ? radio("Video") : action === "ingredients" ? radio("Thành phần") || radio("Ingredients") : action === "aspect" ? radio(req.aspect_ratio) : action === "resolution" ? radio(req.resolution) : action === "duration" ? radio(new RegExp(`^${Number(req.duration_seconds)}\\s*(giay|s|sec|seconds?)`, "i")) || radio(String(req.duration_seconds)) : radio("x1");
        return selected?.getAttribute("aria-checked") === "true" ? null : point(selected);
      }
      if (action === "modelMenu") {
        const button = modelButton();
        return button && text(button).includes(norm(req.model_display_name)) ? null : point(button);
      }
      if (action === "model") {
        const button = modelButton();
        if (button && text(button).includes(norm(req.model_display_name))) return null;
        const option = find('[role="menuitem"]', (el) => text(el) === norm(req.model_display_name) || text(el).includes(norm(req.model_display_name)));
        return option ? point(option) : null;
      }
      if (action === "verifySettings") {
        const videoRadio = radio("Video");
        const ingredientsRadio = radio("Thành phần") || radio("Ingredients");
        const aspectRadio = radio(req.aspect_ratio);
        const resolutionRadio = radio(req.resolution);
        const durationRadio = radio(new RegExp(`^${Number(req.duration_seconds)}\\s*(giay|s|sec|seconds?)`, "i")) || radio(String(req.duration_seconds));
        const countRadio = radio("x1");
        const choices = [videoRadio, ingredientsRadio, aspectRadio, resolutionRadio, countRadio];
        const labels = ["Video mode", "Ingredients sub-mode", `Aspect ${req.aspect_ratio}`, `Resolution ${req.resolution}`, "Count x1"];
        if (durationRadio) {
          choices.push(durationRadio);
          labels.push(`Duration ${req.duration_seconds}s`);
        }
        const mismatches = labels.filter((_, i) => choices[i]?.getAttribute("aria-checked") !== "true");
        const modelOk = modelButton() && text(modelButton()).includes(norm(req.model_display_name));
        if (mismatches.length > 0 || !modelOk) {
          const diagParts = [];
          if (!modelOk) diagParts.push(`Model button not showing "${req.model_display_name}"`);
          diagParts.push(...mismatches.map((l) => `${l} not selected`));
          fail(`Flow settings mismatch: ${diagParts.join("; ")}`);
        }
        if (find('button.agent-mode-chip[aria-pressed="true"]', () => true)) fail("Turn off Agent mode in Flow before creating this video.");
        return true;
      }
      if (action === "fill") {
        const target = editor();
        target.focus();
        document.execCommand("selectAll", false, null);
        document.execCommand("delete", false, null);
        if (!document.execCommand("insertText", false, req.prompt.trim())) fail("Could not fill the Flow prompt.");
        return true;
      }
      if (action === "promptText") {
        const clone = editor().cloneNode(true);
        clone.querySelectorAll("flow-video-ingredient-chip,flow-image-ingredient-chip").forEach((chip) => chip.remove());
        return String(clone.innerText || clone.textContent || "").replace(/\s+/gu, " ").trim();
      }
      if (action === "openPicker" || action === "ensurePicker") {
        if (action === "ensurePicker" && assetOptions().length) return null;
        return point(find(".base-prompt-box button.add-menu-trigger", () => true));
      }
      if (action === "uploadImage") {
        const button = find('button,[role="button"]', (el) => /tai noi dung nghe nhin len|upload media|upload files/.test(label(el)));
        return point(button);
      }
      if (action === "assetKeys") {
        return assetOptions().map((el) => mediaId(el) || norm(el.querySelector(".asset-title")?.innerText || el.innerText)).filter(Boolean);
      }
      if (action === "activeAssetIds") return assetOptions().filter((el) => el.classList.contains("asset-item-active")).map(mediaId);
      if (action === "resetPicker" || action === "seekAsset") {
        const options = assetOptions();
        if (action === "seekAsset" && options.some((el) => mediaId(el) === req.media_id)) return true;
        let scroller = options[0]?.parentElement;
        while (scroller && scroller !== document.body && !(scroller.scrollHeight > scroller.clientHeight + 2 && /auto|scroll/.test(window.getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
        if (!scroller || scroller === document.body) {
          if (action === "resetPicker") return true;
          fail("Flow control not found: requested asset in picker");
        }
        if (action === "resetPicker") {
          scroller.scrollTop = 0;
          return true;
        }
        if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) fail("Flow control not found: requested asset in picker");
        scroller.scrollTop += Math.max(100, scroller.clientHeight * 0.7);
        return false;
      }
      if (action === "selectVideo") {
        const isVideo = (el) => /(^|\s)(video|vid(e)o)(\s|$)/i.test(norm(el.querySelector(".type-subtitle")?.innerText || el.innerText));
        const targetId = req.media_id;
        const targetName = norm(req.reference_video_filename || "").replace(/\.[a-z0-9]+$/i, "");
        const option = assetOptions().find((el) => {
          if (!isVideo(el)) return false;
          const mid = mediaId(el);
          if (mid && targetId && mid === targetId) return true;
          const title = norm(el.querySelector(".asset-title")?.innerText || el.innerText);
          if (targetName && (title === targetName || title.includes(targetName) || targetName.includes(title))) return true;
          return false;
        });
        if (!option) fail("Flow control not found: the requested reference video in picker");
        option.scrollIntoView({ block: "nearest" });
        return point(option);
      }
      if (action === "selectImage") {
        const isImage = (el) => !/(^|\s)(video|vid(e)o)(\s|$)/i.test(norm(el.querySelector(".type-subtitle")?.innerText || ""));
        const targetId = req.media_id;
        const targetName = norm(req.image_filename || req.filename || "").replace(/\.[a-z0-9]+$/i, "");
        const option = assetOptions().find((el) => {
          if (!isImage(el)) return false;
          const mid = mediaId(el);
          if (mid && targetId && mid === targetId) return true;
          const title = norm(el.querySelector(".asset-title")?.innerText || el.innerText);
          if (targetName && (title === targetName || title.includes(targetName) || targetName.includes(title))) return true;
          return false;
        });
        if (!option) fail("Flow control not found: image option in picker");
        option.scrollIntoView({ block: "nearest" });
        return point(option);
      }
      if (action === "assetAvailable") {
        const option = assetOptions().find((el) => {
          const mid = mediaId(el);
          if (mid && req.media_id && mid === req.media_id) return true;
          const targetName = norm(req.filename || "").replace(/\.[a-z0-9]+$/i, "");
          const title = norm(el.querySelector(".asset-title")?.innerText || el.innerText);
          if (targetName && (title === targetName || title.includes(targetName))) return true;
          return false;
        });
        if (option) {
          option.scrollIntoView({ block: "center" });
          option.focus();
        }
        return option ? { point: point(option), id: mediaId(option) || req.media_id } : null;
      }
      if (action === "addSelected") {
        const addBtn = addButton();
        if (!addBtn) fail("Flow control not found: addSelected button");
        addBtn.scrollIntoView({ block: "nearest" });
        return point(addBtn);
      }
      if (action === "videoChipIds") {
        const chips = videoChips();
        return chips.map(mediaId);
      }
      if (action === "imageChipIds") return imageChips().map(mediaId);
      if (action === "trimPlan" || action === "trimValues" || action === "setTrim") {
        let start = find('[role="slider"]', (el) => /^(cat bo diem bat dau|trim start point)$/.test(label(el)));
        let end = find('[role="slider"]', (el) => /^(cat bo diem ket thuc|trim end point)$/.test(label(el)));
        if (!start || !end) {
          start = find('[role="slider"]', (el) => /(bat dau|start|from|dau)/i.test(label(el)));
          end = find('[role="slider"]', (el) => /(ket thuc|end|to|cuoi)/i.test(label(el)));
        }
        if (!start || !end) {
          const sliders = [...document.querySelectorAll('[role="slider"], input[type="range"]')].filter(visible);
          if (sliders.length >= 2) {
            sliders.sort((a, b) => {
              const na = Number(a.getAttribute("aria-valuenow") || a.getBoundingClientRect().left);
              const nb = Number(b.getAttribute("aria-valuenow") || b.getBoundingClientRect().left);
              return na - nb;
            });
            start = sliders[0];
            end = sliders[1];
          }
        }
        if (!start || !end) {
          fail(`Flow control not found: video trim controls for ${action}`);
        }
        const values = {
          start: Number(start.getAttribute("aria-valuenow")),
          end: Number(end.getAttribute("aria-valuenow")),
          min: Number(start.getAttribute("aria-valuemin") || 0),
          max: Number(end.getAttribute("aria-valuemax"))
        };
        if (action === "trimValues") return values;
        const requestedStart = Number(req.reference_video_start_seconds || 0);
        const requestedEnd = Number(req.reference_video_end_seconds);
        if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd) || requestedEnd <= requestedStart) {
          fail("Motion Control has an invalid reference-video trim range.");
        }
        if (requestedStart < values.min - 0.03 || requestedEnd > values.max + 0.03) {
          fail(`Selected video is ${values.max.toFixed(2)}s long but the requested trim ends at ${requestedEnd.toFixed(2)}s.`);
        }
        if (requestedEnd - requestedStart > 10.03) fail("Flow video reference clips are limited to 10 seconds.");
        if (action === "setTrim") {
          if (!(start instanceof window.HTMLInputElement) || !(end instanceof window.HTMLInputElement)) return false;
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
          for (const [input, value] of [[start, requestedStart], [end, requestedEnd]]) {
            setter.call(input, String(value));
            input.dispatchEvent(new window.Event("input", { bubbles: true }));
            input.dispatchEvent(new window.Event("change", { bubbles: true }));
          }
          return true;
        }
        const trackEl = start.closest('.mdc-slider__track, mat-slider, [class*="slider"], [class*="track"]') || start.parentElement?.parentElement;
        const track = trackEl?.getBoundingClientRect();
        const startRect = start.getBoundingClientRect();
        const endRect = end.getBoundingClientRect();
        const secondsSpan = values.end - values.start;
        const handleScale = secondsSpan > 0 ? (endRect.left - startRect.left) / secondsSpan : 0;
        if (!track?.width || !startRect.width || !endRect.width) fail(`Flow control not found: video trim track for ${action}`);
        const pointFor = (slider, value) => {
          const min = Number(slider.getAttribute("aria-valuemin") || 0);
          const max = Number(slider.getAttribute("aria-valuemax"));
          const rect = slider.getBoundingClientRect();
          if (Number.isFinite(handleScale) && handleScale > 0) {
            const current = Number(slider.getAttribute("aria-valuenow"));
            return { x: rect.left + rect.width / 2 + (value - current) * handleScale, y: rect.top + rect.height / 2 };
          }
          const left = track.left;
          const right = track.right - rect.width;
          const ratio = max > min ? (value - min) / (max - min) : 0;
          return { x: left + Math.max(0, Math.min(1, ratio)) * (right - left) + rect.width / 2, y: rect.top + rect.height / 2 };
        };
        return {
          ...values,
          requestedStart,
          requestedEnd,
          startFrom: { x: startRect.left + startRect.width / 2, y: startRect.top + startRect.height / 2 },
          startTo: pointFor(start, requestedStart),
          endFrom: { x: endRect.left + endRect.width / 2, y: endRect.top + endRect.height / 2 },
          endTo: pointFor(end, requestedEnd)
        };
      }
      if (action === "generate") {
        const actualPrompt = motionUiStep("promptText", req);
        const expectedPrompt = String(req.prompt || "").replace(/\s+/gu, " ").trim();
        if (actualPrompt !== expectedPrompt) fail("Flow prompt changed before submit; no video was submitted.");
        const videos = videoChips().map(mediaId);
        const images = imageChips().map(mediaId);
        if (videos.length !== 1 || videos[0] !== req.reference_video_id) {
          fail("The reference video in Flow does not match this Motion Control job.");
        }
        if (images.length !== req.expected_image_ids.length || images.some((id, index) => id !== req.expected_image_ids[index])) {
          fail("The reference images in Flow do not match this Motion Control job.");
        }
        const button = find("button", (el) => /^(bat dau tao|start generation|generate|start creating)$/.test(label(el)));
        return point(button);
      }
      return fail(`Unknown Flow Motion Control step: ${action}`);
    } catch (error) {
      return { error: error?.message || "Could not read the Flow Motion Control interface." };
    }
  }

  // src/providers/google-flow/motion-ui.js
  var UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  function isMotionReferenceAttached(type, ids, mediaId, previousImageIds = []) {
    const expected = type === "video" ? [mediaId] : [...previousImageIds, mediaId];
    return Array.isArray(ids) && ids.length === expected.length && ids.every((id, index) => id === expected[index]);
  }
  function parseBatches(postData) {
    try {
      const raw = new URLSearchParams(postData).get("f.req");
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function matchMotionRequest(postData, req, expectedImageIds = []) {
    const batches = parseBatches(postData);
    if (!Array.isArray(batches)) return null;
    for (const batch of batches) {
      if (!Array.isArray(batch)) continue;
      for (const rpc of batch) {
        if (!Array.isArray(rpc) || rpc[0] !== "jIps6") continue;
        let payload;
        try {
          payload = JSON.parse(rpc[1]);
        } catch {
          continue;
        }
        if (payload?.[1]?.[5] !== req.project_id) continue;
        const edit = payload?.[0]?.[0];
        if (!Array.isArray(edit) || payload[0].length !== 1) throw new Error("Flow returned an unexpected Motion Control request shape.");
        const source = edit[0];
        const promptValues = [];
        const collectStrings = (value) => {
          if (typeof value === "string") promptValues.push(value);
          else if (Array.isArray(value)) value.forEach(collectStrings);
        };
        collectStrings(edit[1]);
        const promptMatches = promptValues.some((value) => normalizeFlowPrompt(value) === normalizeFlowPrompt(req.prompt));
        const expectedStartFrame = Math.round(Number(req.reference_video_start_seconds || 0) * 30);
        const expectedEndFrame = Math.round(Number(req.reference_video_end_seconds) * 30);
        const actualImageIds = Array.isArray(edit[8]) ? edit[8].map((item) => item?.[1]).filter(Boolean) : [];
        const checks = [
          [source?.[1] === req.reference_video_id, "The Flow request uses a different reference video."],
          [Number(source?.[2]) === expectedStartFrame && Number(source?.[3]) === expectedEndFrame, "Flow video trim does not match the selected source range."],
          [promptMatches, "The Flow request prompt differs from the submitted Motion Control prompt."],
          [edit[2] === req.provider_model_id, "Flow selected a different Motion Control model."],
          [Number(edit[3]) === Number(req.num_outputs || 1), "Flow output count differs from the Motion Control job."],
          [actualImageIds.length === expectedImageIds.length && actualImageIds.every((id, index) => id === expectedImageIds[index]), "Flow reference images differ from the Motion Control job."]
        ];
        const mismatch = checks.find(([ok]) => !ok);
        if (mismatch) throw new Error(mismatch[1]);
        return {
          rpc: rpc[0],
          reference_video_id: source[1],
          start_frame: Number(source[2]),
          end_frame: Number(source[3]),
          image_ids: actualImageIds
        };
      }
    }
    return null;
  }
  function parseMotionCreation(body, expectedProjectId, expectedReq = null) {
    if (body.includes("PUBLIC_ERROR_UNUSUAL_ACTIVITY")) {
      throw new Error("Flow rejected Motion Control. Check the Flow tab before retrying.");
    }
    const findEnvelope = (value) => {
      if (!Array.isArray(value)) return null;
      if (value[0] === "wrb.fr" && value[1] === "jIps6" && typeof value[2] === "string") return JSON.parse(value[2]);
      for (const child of value) {
        const found = findEnvelope(child);
        if (found) return found;
      }
      return null;
    };
    let response = null;
    for (const line of String(body || "").split(/\r?\n/)) {
      if (!line.trim().startsWith("[")) continue;
      try {
        response = findEnvelope(JSON.parse(line));
      } catch {
      }
      if (response) break;
    }
    if (!response) throw new Error("Flow returned no Motion Control creation result.");
    const records = [];
    const walk = (node) => {
      if (!Array.isArray(node)) return;
      const model = node?.[5]?.[6]?.[1]?.[0]?.[0];
      const nativeEdit = node[3] == null && model === "abra_edit" && Array.isArray(node[7]);
      if (node.length >= 4 && UUID.test(String(node[0])) && node[1] === expectedProjectId && (node[3] === "CAE" || nativeEdit)) {
        if (expectedReq && nativeEdit && (model !== expectedReq.provider_model_id || normalizeFlowPrompt(node?.[5]?.[1]) !== normalizeFlowPrompt(expectedReq.prompt))) {
          throw new Error("Flow returned a Motion Control asset with a different prompt or model.");
        }
        records.push(node);
      }
      node.forEach(walk);
    };
    walk(response);
    if (records.length !== 1) throw new Error("Flow response did not contain one video asset for this project. Check Flow before retrying.");
    return { mediaId: records[0][0], sceneId: records[0][2] || null };
  }
  function uploadImageResponse(body, projectId) {
    const data = frameRpcPayload(body, "maseQ");
    const mediaId = data?.[0]?.[0];
    if (!UUID.test(String(mediaId || "")) || data?.[0]?.[1] !== projectId) {
      throw new Error("Flow image upload returned a different project or no media ID.");
    }
    return mediaId;
  }
  async function generateMotionVideoThroughUi(req, tabId) {
    const failResult = (message) => ({ ok: false, error: `FLOW_UI: ${message}` });
    const inputs = Array.isArray(req.ingredient_inputs) && req.ingredient_inputs.length > 0 ? req.ingredient_inputs : [
      ...(req.ingredient_media_ids || []).map((media_id) => ({ media_id })),
      ...(req.ingredient_images || []).map((image) => ({ local_path: image.local_path, filename: image.filename }))
    ];
    if (!req.prompt?.trim() || !UUID.test(String(req.reference_video_id || "")) || inputs.length > 3) {
      return failResult("Motion Control requires a prompt, one uploaded reference video, and no more than three reference images.");
    }
    if (Number(req.num_outputs || 1) !== 1 || !["360p", "720p"].includes(req.resolution)) {
      return failResult("Motion Control currently supports one output at 360p or 720p.");
    }
    if (inputs.some((item) => !item.media_id && (!item.local_path || !item.filename))) {
      return failResult("A Motion Control reference image has no Flow media ID or readable local file.");
    }
    if (!chrome.debugger) return failResult("Reload FlowsVeo to enable native Motion Control.");
    const target = { tabId };
    const requestTypes = /* @__PURE__ */ new Map();
    const expectedImageIds = [];
    const command = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);
    let attached = false;
    let closed = false;
    let armed = false;
    let chooser = null;
    let upload = null;
    let created = null;
    let failure = null;
    let submissionRpc = null;
    const mergeCatalog = (assets) => {
      const merged = new Map((req.asset_catalog || []).map((asset) => [asset.id, asset]));
      for (const asset of assets) {
        const previous = merged.get(asset.id);
        merged.set(asset.id, { id: asset.id, thumbnails: [.../* @__PURE__ */ new Set([...previous?.thumbnails || [], ...asset.thumbnails])] });
      }
      req = { ...req, asset_catalog: [...merged.values()] };
    };
    const refreshAssetCatalog = async () => {
      const result = await chrome.scripting.executeScript({ target, world: "MAIN", func: readMotionAssetCatalog, args: [req.project_id] });
      const value = result?.[0]?.result;
      if (!value?.assets) throw new Error(value?.error || "Could not read the Flow asset catalog.");
      mergeCatalog(value.assets);
    };
    const fail = (message) => {
      if (!failure) failure = message;
    };
    const step = async (action, extra = {}) => {
      if (closed || failure) throw new Error(failure || "Flow Motion Control has stopped.");
      if (action === "closeSettings") {
        await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
        await sleep(350);
        return null;
      }
      let injected;
      for (let attempt = 0; attempt < 8; attempt++) {
        if (closed || failure) throw new Error(failure || "Flow Motion Control has stopped.");
        injected = await chrome.scripting.executeScript({
          target,
          world: "MAIN",
          func: motionUiStep,
          args: [action, { ...req, expected_image_ids: expectedImageIds, ...extra }]
        });
        const err = injected?.[0]?.result?.error || "";
        if (action === "seekAsset" && err) break;
        if (!/^(Flow control was not found:|Flow control not found:|Flow control is covered:|A window is covering)/.test(err)) {
          break;
        }
        if (err.startsWith("Flow control is covered:")) {
          const dismiss = await chrome.scripting.executeScript({
            target,
            world: "MAIN",
            func: motionUiStep,
            args: ["dismissBackdrop", req]
          });
          const point = dismiss?.[0]?.result;
          if (point && !point.error) await click(point);
        }
        if (attempt >= 2) {
          await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {
          });
          await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 }).catch(() => {
          });
        }
        await sleep(300);
      }
      if (!injected?.length || !Object.hasOwn(injected[0], "result")) throw new Error(`Flow page did not respond to ${action}.`);
      if (injected[0].result?.error) throw new Error(injected[0].result.error);
      return injected[0].result;
    };
    const click = async (point) => {
      if (!point) return;
      if (failure) throw new Error(failure);
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
      await sleep(350);
    };
    const drag = async (from, to) => {
      if (Math.abs(from.x - to.x) < 0.1 && Math.abs(from.y - to.y) < 0.1) return;
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...from });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", ...from, button: "left", buttons: 1, clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...to, button: "left", buttons: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...to, button: "left", buttons: 0, clickCount: 1 });
      await sleep(500);
    };
    const waitFor = async (fn, timeoutMs, message) => {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        if (failure) throw new Error(failure);
        const value = await fn();
        if (value) return value;
        await sleep(350);
      }
      throw new Error(message);
    };
    const closeSettings = async () => {
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(300);
    };
    const onEvent = (source, method, params) => {
      if (source.tabId !== tabId || source.sessionId || closed) return;
      if (method === "Page.fileChooserOpened" && chooser) {
        const pending = chooser;
        clearTimeout(pending.timer);
        command("DOM.setFileInputFiles", { backendNodeId: params.backendNodeId, files: [pending.path] }).then(() => {
          pending.done = true;
        }).catch(() => fail("Chrome could not read a Motion Control reference image."));
        return;
      }
      if (method === "Fetch.requestPaused") {
        const url = params.request?.url || "";
        if (!armed || !url.includes("/data/batchexecute")) {
          command("Fetch.continueRequest", { requestId: params.requestId }).catch((error) => fail(`Flow request could not continue: ${error.message}`));
          return;
        }
        const rpcId = (() => {
          try {
            return new URL(url).searchParams.get("rpcids");
          } catch {
            return null;
          }
        })();
        if (rpcId !== "jIps6") {
          command("Fetch.continueRequest", { requestId: params.requestId }).catch((error) => fail(`Flow request could not continue: ${error.message}`));
          return;
        }
        try {
          const matched = matchMotionRequest(params.request?.postData || "", req, expectedImageIds);
          if (!matched) throw new Error("Flow created a Motion Control request that does not match this job. No request was sent.");
          submissionRpc = matched.rpc;
          if (params.networkId) requestTypes.set(params.networkId, { generation: true });
          command("Fetch.continueRequest", { requestId: params.requestId }).catch((error) => fail(`Flow could not submit the verified request: ${error.message}`));
        } catch (error) {
          command("Fetch.failRequest", { requestId: params.requestId, errorReason: "BlockedByClient" }).catch(() => {
          });
          fail(error.message || "Flow request validation failed. No video was submitted.");
        }
        return;
      }
      if (method === "Network.requestWillBeSent") {
        const request = params.request;
        if (!request?.url?.startsWith("https://flow.google.com/") || !request.url.includes("/data/batchexecute")) return;
        let rpcId = "";
        try {
          rpcId = new URL(request.url).searchParams.get("rpcids") || "";
        } catch {
        }
        if (upload && rpcId === "maseQ") requestTypes.set(params.requestId, { imageUpload: upload });
        if (rpcId.split(",").includes("Zzl0ze")) requestTypes.set(params.requestId, { catalog: true, rpcId });
        return;
      }
      const info = requestTypes.get(params.requestId);
      if (!info) return;
      if (method === "Network.loadingFailed") {
        requestTypes.delete(params.requestId);
        if (info.generation) fail("Flow stopped the Motion Control request. Check Flow before retrying.");
        return;
      }
      if (method === "Network.responseReceived" && info.generation && params.response?.status >= 400) {
        fail(`Flow returned HTTP ${params.response.status} for Motion Control.`);
        return;
      }
      if (method !== "Network.loadingFinished") return;
      requestTypes.delete(params.requestId);
      command("Network.getResponseBody", { requestId: params.requestId }).then((response) => {
        if (closed) return;
        const body = response.base64Encoded ? new TextDecoder().decode(Uint8Array.from(atob(response.body), (char) => char.charCodeAt(0))) : response.body;
        if (info.catalog) {
          const assets = [];
          const walk = (node) => {
            if (!Array.isArray(node)) return;
            if (UUID.test(String(node[0])) && node[1] === req.project_id) {
              const thumbnails = [node?.[5]?.[5], node?.[5]?.[10]].filter((url) => typeof url === "string" && url.startsWith("https://"));
              if (thumbnails.length) assets.push({ id: node[0], thumbnails });
            }
            node.forEach(walk);
          };
          for (const rpcId of info.rpcId.split(",")) {
            try {
              walk(frameRpcPayload(body, rpcId));
            } catch {
            }
          }
          if (assets.length) mergeCatalog(assets);
        } else if (info.generation) {
          created = parseMotionCreation(body, req.project_id, req);
          logActivity("info", `Motion Control accepted by Flow: media=${created.mediaId}, video=${req.reference_video_id}, trim=${req.reference_video_start_seconds}-${req.reference_video_end_seconds}s`);
        } else if (info.imageUpload) {
          info.imageUpload.mediaId = uploadImageResponse(body, req.project_id);
        }
      }).catch((error) => fail(error.message || "Could not read a Flow Motion Control response."));
    };
    const onDetach = (source) => {
      if (source.tabId === tabId && !closed) fail("Chrome detached from Flow. Check Flow before retrying.");
    };
    const applyVideoTrim = async () => {
      if (!await step("setTrim")) {
        for (let attempt = 0; attempt < 5; attempt++) {
          const plan = await step("trimPlan");
          await drag(plan.startFrom, plan.startTo);
          const updated = await step("trimPlan");
          await drag(updated.endFrom, updated.endTo);
          const actual = await step("trimValues");
          if (Math.round(actual.start * 30) === Math.round(Number(req.reference_video_start_seconds || 0) * 30) && Math.round(actual.end * 30) === Math.round(Number(req.reference_video_end_seconds) * 30)) break;
        }
      }
      await sleep(500);
      const values = await step("trimValues");
      if (Math.round(values.start * 30) !== Math.round(Number(req.reference_video_start_seconds || 0) * 30) || Math.round(values.end * 30) !== Math.round(Number(req.reference_video_end_seconds) * 30)) {
        throw new Error("Flow reference-video trim differs from the selected range. No video was submitted.");
      }
    };
    const attachMedia = async (mediaId, type) => {
      await click(await step("openPicker"));
      await waitFor(async () => (await step("assetKeys")).length > 0, 2e4, "Flow media picker did not load.");
      await step("resetPicker");
      await sleep(500);
      await waitFor(() => step("seekAsset", { media_id: mediaId }), 3e4, "The requested reference asset did not appear in Flow.");
      const selectAction = type === "video" ? "selectVideo" : "selectImage";
      for (let attempt = 0; attempt < 3; attempt++) {
        await step(selectAction, { media_id: mediaId });
        await sleep(300);
        await click(await step(selectAction, { media_id: mediaId }));
        await sleep(500);
        if (type === "video") {
          const ids = await step("videoChipIds");
          if (isMotionReferenceAttached("video", ids, mediaId)) {
            await closeSettings();
            return;
          }
        }
        if (type === "image") {
          const ids = await step("imageChipIds");
          if (isMotionReferenceAttached("image", ids, mediaId, expectedImageIds)) {
            expectedImageIds.push(mediaId);
            await closeSettings();
            return;
          }
        }
        if ((await step("activeAssetIds")).includes(mediaId)) break;
      }
      await waitFor(async () => (await step("activeAssetIds")).includes(mediaId), 15e3, `Flow did not open the selected ${type} reference asset (${mediaId}).`);
      await sleep(600);
      if (type === "video") await applyVideoTrim();
      await click(await step("addSelected"));
      await sleep(600);
      if (type === "video") {
        await waitFor(async () => {
          const ids = await step("videoChipIds", { media_id: mediaId });
          return isMotionReferenceAttached("video", ids, mediaId) ? ids : null;
        }, 15e3, "Flow did not attach the selected reference video.");
      } else {
        await waitFor(async () => {
          const ids = await step("imageChipIds", { media_id: mediaId });
          return isMotionReferenceAttached("image", ids, mediaId, expectedImageIds) ? ids : null;
        }, 15e3, "Flow did not attach the selected reference image.");
        expectedImageIds.push(mediaId);
      }
      await closeSettings();
    };
    const uploadAndAttachImage = async (image) => {
      if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(image.local_path || "")) throw new Error("Motion Control image path must be absolute.");
      await click(await step("openPicker"));
      upload = { filename: image.filename, mediaId: null };
      chooser = {
        path: image.local_path,
        done: false,
        timer: setTimeout(() => {
          if (chooser) chooser = null;
        }, 15e3)
      };
      await click(await step("uploadImage"));
      await waitFor(() => chooser?.done, 16e3, "Flow did not accept the reference-image file.");
      clearTimeout(chooser?.timer);
      chooser = null;
      const uploaded = await waitFor(() => upload?.mediaId, 9e4, "Flow image upload timed out. No video was submitted.");
      upload = null;
      await refreshAssetCatalog();
      const uploadedChipIds = await step("imageChipIds");
      if (isMotionReferenceAttached("image", uploadedChipIds, uploaded, expectedImageIds)) {
        expectedImageIds.push(uploaded);
        await closeSettings();
        return;
      }
      await click(await step("ensurePicker"));
      const asset = await waitFor(() => step("assetAvailable", { media_id: uploaded }), 6e4, "The uploaded reference image did not appear in Flow.");
      await click(asset.point);
      await sleep(400);
      const attachedIds = await step("imageChipIds");
      if (!isMotionReferenceAttached("image", attachedIds, uploaded, expectedImageIds)) {
        await click(await step("addSelected"));
        await sleep(600);
      }
      await waitFor(async () => {
        const ids = await step("imageChipIds", { media_id: uploaded, expected_image_ids: expectedImageIds });
        return isMotionReferenceAttached("image", ids, uploaded, expectedImageIds) ? ids : null;
      }, 15e3, "Flow did not attach the uploaded reference image.");
      expectedImageIds.push(uploaded);
      await closeSettings();
    };
    try {
      await chrome.tabs.update(tabId, { active: true });
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {
      });
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      chrome.debugger.onEvent.addListener(onEvent);
      chrome.debugger.onDetach.addListener(onDetach);
      await command("Network.enable", { maxPostDataSize: 1024 * 1024, maxResourceBufferSize: 5 * 1024 * 1024, maxTotalBufferSize: 12 * 1024 * 1024 });
      await command("Page.enable");
      await command("DOM.enable");
      await command("Page.setInterceptFileChooserDialog", { enabled: true, cancel: false });
      await step("lock");
      await click(await step("closeAccount"));
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(450);
      await step("preflight");
      for (let attempt = 0; attempt < 8; attempt++) {
        const point = await step("removeIngredient");
        if (!point) break;
        await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
        await sleep(250);
        await click(await step("removeIngredient"));
      }
      if (await step("removeIngredient")) throw new Error("Flow did not clear the previous reference ingredients.");
      await refreshAssetCatalog();
      const openSettings = async () => {
        for (let attempt = 0; attempt < 4; attempt++) {
          const point = await step("openSettings");
          if (!point) return;
          await click(point);
        }
        if (await step("openSettings")) throw new Error("Flow settings did not open.");
      };
      await openSettings();
      const settingsActions = ["mode", "ingredients", "modelMenu", "model", "aspect", "resolution", "count"];
      for (let attempt = 0; attempt < 5; attempt++) {
        for (const action of settingsActions) {
          const pt = await step(action);
          if (pt) await click(pt);
        }
        const verified = await chrome.scripting.executeScript({
          target,
          world: "MAIN",
          func: motionUiStep,
          args: ["verifySettings", { ...req, expected_image_ids: expectedImageIds }]
        }).catch(() => null);
        if (verified?.[0]?.result === true) break;
        if (attempt === 4) await step("verifySettings");
        await sleep(500);
      }
      await closeSettings();
      await step("fill");
      await attachMedia(req.reference_video_id, "video");
      for (const image of inputs) {
        if (image.media_id) await attachMedia(image.media_id, "image");
        else await uploadAndAttachImage(image);
      }
      await openSettings();
      for (let attempt = 0; attempt < 5; attempt++) {
        for (const action of ["mode", "ingredients", "aspect", "resolution", "count"]) {
          const pt = await step(action);
          if (pt) await click(pt);
        }
        const verified = await chrome.scripting.executeScript({
          target,
          world: "MAIN",
          func: motionUiStep,
          args: ["verifySettings", { ...req, expected_image_ids: expectedImageIds }]
        }).catch(() => null);
        if (verified?.[0]?.result === true) break;
        if (attempt === 4) await step("verifySettings");
        await sleep(500);
      }
      await closeSettings();
      const currentPrompt = await step("promptText");
      const normCurrent = normalizeFlowPrompt(currentPrompt);
      const normExpected = normalizeFlowPrompt(req.prompt);
      if (normCurrent !== normExpected) {
        throw new Error(`Flow prompt changed before submit. Got "${normCurrent.slice(0, 80)}" expected "${normExpected.slice(0, 80)}"`);
      }
      await command("Input.dispatchKeyEvent", { type: "keyDown", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await command("Input.dispatchKeyEvent", { type: "keyUp", key: "Escape", code: "Escape", windowsVirtualKeyCode: 27 });
      await sleep(350);
      const submitPoint = await step("generate", { expected_image_ids: expectedImageIds });
      await command("Fetch.enable", { patterns: [{ urlPattern: "*AiSandboxAngularFrontend/data/batchexecute*", requestStage: "Request" }] });
      armed = true;
      await click(submitPoint);
      await waitFor(() => created, 9e4, "Flow did not return a Motion Control video asset. Check Flow before retrying; no automatic resubmission.");
      closed = true;
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      await command("Fetch.disable").catch(() => {
      });
      await command("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {
      });
      await chrome.debugger.detach(target).catch(() => {
      });
      attached = false;
      const deadline = Date.now() + 42e4;
      while (Date.now() < deadline) {
        const injected = await chrome.scripting.executeScript({
          target: { tabId },
          world: "MAIN",
          func: pollFramesVideo,
          args: [req.project_id, created.mediaId, req.provider_model_id]
        }).catch(() => null);
        const value = injected?.[0]?.result;
        if (value?.ok) {
          return {
            ...value,
            diagnostics: {
              adapter: "motion-ui-v1",
              rpc: submissionRpc,
              reference_video_id: req.reference_video_id,
              reference_start_seconds: req.reference_video_start_seconds,
              reference_end_seconds: req.reference_video_end_seconds,
              ingredient_media_ids: expectedImageIds,
              scene_id: created.sceneId,
              prompt_verified: true
            }
          };
        }
        if (value?.terminal) throw new Error(value.error || "Flow reported a terminal video error.");
        await sleep(3500);
      }
      throw new Error("Motion Control video rendering timed out after seven minutes. Check Flow before retrying.");
    } catch (error) {
      return failResult(error?.message || "Could not control the Flow Motion Control interface.");
    } finally {
      closed = true;
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      if (attached) {
        await command("Fetch.disable").catch(() => {
        });
        await command("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {
        });
        await chrome.debugger.detach(target).catch(() => {
        });
      }
      await chrome.scripting.executeScript({ target, world: "MAIN", func: motionUiStep, args: ["unlock", req] }).catch(() => {
      });
    }
  }

  // src/providers/google-flow/page/image.js
  async function runImageGenerationInPage(imageRequest, captchaToken) {
    const diagnostics = {
      adapter: "image-rpc-diagnostics-v1",
      rpc: "ogiZ0b",
      phase: "preflight",
      origin: location.origin,
      http_status: null,
      elapsed_ms: null,
      session_ready: false,
      project_matches: false,
      token_length: typeof captchaToken === "string" ? captchaToken.length : 0,
      nzlxg_ok: false,
      token_source: "background",
      trigger_method: "rpc"
    };
    try {
      let resolveImageModel = function(m) {
        const raw = String(m || "").toLowerCase();
        if (raw.includes("lite") || raw.includes("harbor")) return "HARBOR_SEAL";
        if (raw.includes("pro") || raw.includes("gem_pix_2")) return "GEM_PIX_2";
        if (raw.includes("banana 2") || raw.includes("narwhal")) return "NARWHAL";
        return "GEM_PIX_2";
      }, findRpcEnvelope = function(node, rpcId) {
        if (!Array.isArray(node)) return null;
        if (node[0] === "wrb.fr" && node[1] === rpcId && typeof node[2] === "string") return node[2];
        for (const child of node) {
          const found = findRpcEnvelope(child, rpcId);
          if (found !== null) return found;
        }
        return null;
      }, parseRpcResponse = function(text, rpcId) {
        let rpcError = null;
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("[")) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const payload = findRpcEnvelope(parsed, rpcId);
            if (payload !== null) return JSON.parse(payload);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                if (Array.isArray(item) && item[0] === "wrb.fr" && item[1] === rpcId) {
                  rpcError = `Flow RPC envelope error: ${JSON.stringify(item.slice(2))}`;
                } else if (Array.isArray(item) && item[0] === "er") {
                  rpcError = `Flow server error (er): ${JSON.stringify(item)}`;
                }
              }
            }
          } catch {
          }
        }
        if (rpcError && rpcError.includes("PUBLIC_ERROR_UNUSUAL_ACTIVITY")) {
          rpcError = "PUBLIC_ERROR_UNUSUAL_ACTIVITY: Google Flow từ chối yêu cầu tạo ảnh từ ứng dụng. Việc tạo thủ công vẫn có thể hoạt động; nguyên nhân từ chối chưa được xác định.";
        }
        throw new Error(rpcError || `Flow RPC ${rpcId} returned no usable payload`);
      }, nextReqId = function() {
        if (typeof window._flowsVeoReqId !== "number" || window._flowsVeoReqId < 1e5) {
          window._flowsVeoReqId = 4e6 + Math.floor(Math.random() * 5e5);
        }
        window._flowsVeoReqId += 1e5;
        return String(window._flowsVeoReqId);
      }, findImageUrl = function(node) {
        if (typeof node === "string") {
          if (node.startsWith("https://flow-content.google/image/") || node.startsWith("https://flow-content.google/") && (node.includes("/image/") || node.includes(".jpg") || node.includes(".png") || node.includes("Signature="))) {
            return node;
          }
          return null;
        }
        if (Array.isArray(node)) {
          for (const child of node) {
            const u = findImageUrl(child);
            if (u) return u;
          }
        } else if (typeof node === "object" && node !== null) {
          for (const v of Object.values(node)) {
            const u = findImageUrl(v);
            if (u) return u;
          }
        }
        return null;
      };
      if (typeof imageRequest?.prompt !== "string" || !imageRequest.prompt.trim()) {
        throw new Error("Image prompt is empty");
      }
      let route = location.pathname.match(/^\/(u\/\d+)\/project\/([^/?#]+)/);
      let projectId = route ? route[2] : null;
      if (!projectId) {
        const match2 = location.pathname.match(/\/project\/([^/?#]+)/);
        if (match2) {
          projectId = match2[1];
        }
      }
      if (location.hostname !== "flow.google.com" || !projectId) {
        throw new Error("Hãy mở project trên flow.google.com trước khi tạo ảnh");
      }
      if (imageRequest.project_id && imageRequest.project_id !== projectId) {
        throw new Error("Tab Flow đã chuyển sang project khác; hãy chọn lại project rồi tạo ảnh");
      }
      diagnostics.project_matches = true;
      try {
        const warmupStart = Date.now();
        let x = 300, y = 300;
        while (Date.now() - warmupStart < 1200) {
          x += (Math.random() - 0.48) * 20;
          y += (Math.random() - 0.48) * 15;
          if (typeof window.PointerEvent === "function") {
            document.dispatchEvent(new window.PointerEvent("pointermove", { bubbles: true, clientX: x, clientY: y, pointerType: "mouse" }));
          }
          if (typeof window.MouseEvent === "function") {
            document.dispatchEvent(new window.MouseEvent("mousemove", { bubbles: true, clientX: x, clientY: y }));
          }
          await new Promise((r) => setTimeout(r, 45));
        }
        diagnostics.warmup_ms = Date.now() - warmupStart;
      } catch {
      }
      const aspectMap = {
        "16:9": 3,
        "1:1": 1,
        "9:16": 2,
        "4:3": 4,
        "3:4": 5
      };
      const aspectEnum = aspectMap[imageRequest.aspect_ratio || "16:9"];
      if (!aspectEnum) throw new Error("Unsupported image aspect ratio");
      const modelKey = resolveImageModel(imageRequest.model_key);
      const sourcePath = `/project/${projectId}`;
      const wiz = window.WIZ_global_data || {};
      const csrfToken = wiz.SNlM0e;
      const sessionId = wiz.FdrFJe;
      const buildLabel = wiz.cfb2h;
      if (!csrfToken || !sessionId || !buildLabel) {
        throw new Error("Flow page session config is incomplete; reload the project");
      }
      diagnostics.session_ready = true;
      async function callRpc(rpcId, payload) {
        const reqId = nextReqId();
        const query = new URLSearchParams({
          rpcids: rpcId,
          "source-path": sourcePath,
          bl: String(buildLabel),
          "f.sid": String(sessionId),
          hl: String(document.documentElement?.lang || "en").split("-")[0],
          _reqid: reqId,
          rt: "c"
        });
        const body = new URLSearchParams({
          "f.req": JSON.stringify([[[rpcId, JSON.stringify(payload), null, "generic"]]]),
          at: String(csrfToken)
        });
        const base = location.origin || "https://flow.google.com";
        const endpoint = `${base}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`;
        console.info("[FlowsVeo:image]", { phase: "submit", rpc: rpcId, _reqid: reqId });
        diagnostics.phase = "fetch";
        const started = Date.now();
        const response = await fetch(endpoint, {
          method: "POST",
          credentials: "include",
          cache: "no-store",
          signal: AbortSignal.timeout(12e4),
          headers: {
            "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
            "X-Same-Domain": "1",
            "Cache-Control": "no-cache",
            "Pragma": "no-cache"
          },
          body: body.toString()
        });
        diagnostics.http_status = response.status;
        diagnostics.elapsed_ms = Date.now() - started;
        diagnostics.phase = "rpc-response";
        console.info("[FlowsVeo:image]", { phase: "response", rpc: rpcId, http_status: response.status });
        if (!response.ok) throw new Error(`RPC ${rpcId} HTTP ${response.status}`);
        const text = await response.text();
        return parseRpcResponse(text, rpcId);
      }
      try {
        console.info("[FlowsVeo:image] Pre-flight quota check via nzlxg...");
        await callRpc("nzlxg", []);
        diagnostics.nzlxg_ok = true;
      } catch (e) {
        console.warn("[FlowsVeo:image] nzlxg preflight warning:", e.message);
        diagnostics.nzlxg_error = e.message;
      }
      let finalToken = captchaToken;
      try {
        if (window.grecaptcha?.enterprise?.execute) {
          const siteKey = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";
          console.info("[FlowsVeo:image] Requesting fresh in-page reCAPTCHA token...");
          const freshToken = await Promise.race([
            window.grecaptcha.enterprise.execute(siteKey, { action: "IMAGE_GENERATION" }),
            new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), 5e3))
          ]);
          if (typeof freshToken === "string" && freshToken.length > 100) {
            finalToken = freshToken;
            diagnostics.token_source = "in-page-fresh";
            diagnostics.token_length = freshToken.length;
            console.info("[FlowsVeo:image] In-page reCAPTCHA token acquired, length:", freshToken.length);
          }
        }
      } catch (recaptchaErr) {
        console.warn("[FlowsVeo:image] In-page token fallback to background token:", recaptchaErr.message);
        diagnostics.token_source = "background-fallback";
      }
      if (typeof finalToken !== "string" || !finalToken) {
        throw new Error("reCAPTCHA token is empty");
      }
      let refImagesPayload = null;
      if (Array.isArray(imageRequest.reference_image_ids) && imageRequest.reference_image_ids.length > 0) {
        refImagesPayload = imageRequest.reference_image_ids.map((id) => [id, null, null, null, 1]);
      }
      const sceneUuid = (imageRequest.scene_uuid || (crypto.randomUUID ? crypto.randomUUID() : "1B6623B2-B5E4-4899-AA64-0122F1A067F9")).toUpperCase();
      const seed = imageRequest.seed ?? Math.floor(Math.random() * 2e9);
      const uuidA = (crypto.randomUUID ? crypto.randomUUID() : "EBA3AD1B-C139-4F1B-88C0-290D5C5CD974").toUpperCase();
      const uuidB = (crypto.randomUUID ? crypto.randomUUID() : "B88CA090-09EA-443D-A368-718E69A7F171").toUpperCase();
      const itemPayload = [
        null,
        null,
        refImagesPayload,
        seed,
        aspectEnum,
        modelKey,
        null,
        [null, 22, null, null, null, projectId, null, null, null, null, [finalToken, 1]],
        [[[imageRequest.prompt.trim()]]],
        null,
        null,
        null,
        uuidA,
        uuidB
      ];
      const rpcPayload = [
        null,
        [itemPayload],
        1,
        [null, 22, null, null, null, projectId, null, null, null, null, [finalToken, 1]],
        [sceneUuid]
      ];
      const rpcResult = await callRpc("ogiZ0b", rpcPayload);
      const imgUrl = findImageUrl(rpcResult);
      if (!imgUrl) {
        throw new Error("Flow ogiZ0b response did not contain an image URL");
      }
      let mediaId = null;
      let dims = null;
      try {
        if (Array.isArray(rpcResult) && Array.isArray(rpcResult[0]) && Array.isArray(rpcResult[0][0])) {
          mediaId = rpcResult[0][0][0] || null;
          const sub = rpcResult[0][0][6];
          if (Array.isArray(sub) && sub.length > 2 && Array.isArray(sub[2])) {
            dims = sub[2];
          }
        }
      } catch {
      }
      if (!mediaId) {
        const mMatch = imgUrl.match(/\/image\/([^/?#]+)/);
        if (mMatch) mediaId = mMatch[1];
      }
      return {
        ok: true,
        images: [{
          media_id: mediaId,
          image_url: imgUrl,
          seed,
          aspect_ratio: imageRequest.aspect_ratio || "16:9",
          model_key: modelKey,
          dimensions: dims
        }],
        project_id: projectId,
        prompt: imageRequest.prompt,
        diagnostics
      };
    } catch (error) {
      console.warn("[FlowsVeo:image]", {
        phase: "failed",
        code: String(error?.message || "").includes("PUBLIC_ERROR_UNUSUAL_ACTIVITY") ? "PUBLIC_ERROR_UNUSUAL_ACTIVITY" : "IMAGE_REQUEST_FAILED"
      });
      return { ok: false, error: error?.message || String(error), diagnostics };
    }
  }

  // src/providers/google-flow/page/video.js
  async function runFlowGenerationInPage(flowRequest, captchaToken) {
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      let resolveModelId = function(req) {
        const isFrames2 = req.input_mode === "frames";
        const isIngredients2 = req.input_mode === "ingredients";
        const isVideoEdit2 = req.input_mode === "video_edit";
        if (req.provider_model_id && (!isFrames2 || !req.provider_model_id.includes("_t2v_")) && (!isIngredients2 || !req.provider_model_id.includes("_t2v_"))) {
          if (req.provider_model_id.startsWith("abra_r2v_")) {
            const m = req.provider_model_id.match(/abra_r2v_(\d+)s/);
            if (m) {
              const pDur = Number(m[1]);
              const valid = [4, 6, 8, 10].includes(pDur) ? pDur : pDur >= 8 ? 8 : 6;
              return `abra_r2v_${valid}s`;
            }
          }
          return req.provider_model_id;
        }
        const modelName = (req.model_display_name || "").toLowerCase();
        const isPortrait2 = req.aspect_ratio === "9:16";
        if (isVideoEdit2) {
          return req.resolution === "360p" ? "abra_edit_360p" : "abra_edit";
        }
        if (isIngredients2) {
          const validR2vDur = [4, 6, 8, 10].includes(dur) ? dur : dur >= 8 ? 8 : 6;
          return `abra_r2v_${validR2vDur}s`;
        }
        if (isFrames2) {
          if (req.image_base64 && req.end_image_base64) {
            const frameDur = dur >= 10 ? 10 : 8;
            return `omni_flash_i2v_${frameDur}s_first_last`;
          }
          return `abra_r2v_${[4, 6, 8, 10].includes(dur) ? dur : dur >= 8 ? 8 : 6}s`;
        }
        if (modelName.includes("omni") || modelName.includes("flash")) {
          return `abra_t2v_${dur}s`;
        }
        if (modelName.includes("quality")) {
          return isPortrait2 ? "veo_3_1_t2v_quality_portrait" : "veo_3_1_t2v_quality";
        }
        if (modelName.includes("fast")) {
          return isPortrait2 ? "veo_3_1_t2v_fast_portrait" : "veo_3_1_t2v_fast";
        }
        return "veo_3_1_t2v_lite";
      }, findRpcEnvelope = function(node, rpcId2) {
        if (!Array.isArray(node)) return null;
        if (node[0] === "wrb.fr" && node[1] === rpcId2 && typeof node[2] === "string") return node[2];
        for (const child of node) {
          const found = findRpcEnvelope(child, rpcId2);
          if (found !== null) return found;
        }
        return null;
      }, parseRpcResponse = function(text, rpcId2) {
        let rpcError = null;
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("[")) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const payload = findRpcEnvelope(parsed, rpcId2);
            if (payload !== null) return JSON.parse(payload);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                if (Array.isArray(item) && item[0] === "wrb.fr" && item[1] === rpcId2) {
                  rpcError = `Flow RPC envelope error: ${JSON.stringify(item.slice(2))}`;
                } else if (Array.isArray(item) && item[0] === "er") {
                  rpcError = `Flow server error (er): ${JSON.stringify(item)}`;
                }
              }
            }
          } catch {
          }
        }
        const preview = typeof text === "string" ? text.replace(/\s+/g, " ").slice(0, 300) : "";
        throw new Error(rpcError || `Flow RPC ${rpcId2} returned no usable payload. Response: ${preview}`);
      }, findMediaAsset = function(node) {
        if (!Array.isArray(node)) return null;
        if (typeof node[0] === "string" && (node[3] === "CAE" || node[3] === "CAM" || node[3] === "CAI")) return node;
        for (const child of node) {
          const found = findMediaAsset(child);
          if (found) return found;
        }
        return null;
      }, findVideoUrl = function(node) {
        if (!node) return null;
        if (typeof node === "string") {
          if (node.startsWith("https://flow-content.google/")) {
            const lower = node.toLowerCase();
            if (lower.includes("/image/") || lower.includes("/image?")) return null;
            if (/\.(?:jpg|jpeg|png|webp|gif|avif)(?:$|[?#])/.test(lower)) return null;
            if (lower.includes("/video/") || lower.includes(".mp4") || lower.includes("/media/") || lower.includes("download=1")) {
              return node;
            }
          }
          return null;
        }
        if (Array.isArray(node)) {
          for (const child of node) {
            const u = findVideoUrl(child);
            if (u) return u;
          }
        } else if (typeof node === "object") {
          for (const v of Object.values(node)) {
            const u = findVideoUrl(v);
            if (u) return u;
          }
        }
        return null;
      }, checkDomAndPerformanceForVideo = function(targetMediaId) {
        if (!targetMediaId) return null;
        try {
          if (typeof document?.querySelectorAll === "function") {
            for (const v of document.querySelectorAll("video")) {
              const src = v.currentSrc || v.src;
              if (src && src.startsWith("https://flow-content.google/") && src.includes(targetMediaId)) return src;
              if (typeof v.querySelectorAll === "function") {
                for (const s of v.querySelectorAll("source")) {
                  if (s.src && s.src.startsWith("https://flow-content.google/") && s.src.includes(targetMediaId)) return s.src;
                }
              }
            }
          }
        } catch {
        }
        try {
          if (typeof performance?.getEntriesByType === "function") {
            const entries = performance.getEntriesByType("resource").slice().reverse();
            for (const entry of entries) {
              const n = entry.name || "";
              if (n.startsWith("https://flow-content.google/") && n.includes(targetMediaId) && (n.includes("/video/") || n.includes(".mp4") || n.includes("Signature="))) {
                return n;
              }
            }
          }
        } catch {
        }
        return null;
      }, computeFlowCropCoords = function(imgWidth, imgHeight, isPortrait2) {
        const w = Number(imgWidth) || 0;
        const h = Number(imgHeight) || 0;
        if (!w || !h) {
          return isPortrait2 ? [null, 0.341796875, 1, 0.658203125] : [null, null, 1, 1];
        }
        const imgRatio = w / h;
        const targetRatio = isPortrait2 ? 9 / 16 : 16 / 9;
        if (imgRatio >= 1.7 && imgRatio <= 1.85) {
          if (isPortrait2) {
            return [null, 0.341796875, 1, 0.658203125];
          }
          if (w === 1376 && h === 768) {
            return [null, 0.0038759689922481244, 1, 0.9961240310077519];
          }
          return [null, null, 1, 1];
        }
        if (imgRatio >= 0.54 && imgRatio <= 0.58) {
          if (isPortrait2) {
            if (w === 768 && h === 1376) {
              return [0.0038759689922481244, null, 0.9961240310077519, 1];
            }
            return [null, null, 1, 1];
          }
          return [0.341796875, null, 0.658203125, 1];
        }
        if (imgRatio >= 0.95 && imgRatio <= 1.05) {
          return isPortrait2 ? [null, 0.21875, 1, 0.78125] : [0.21875, null, 0.78125, 1];
        }
        if (Math.abs(imgRatio - targetRatio) < 0.05) {
          return [null, null, 1, 1];
        }
        if (imgRatio > targetRatio) {
          const cropW = targetRatio / imgRatio;
          const left = (1 - cropW) / 2;
          return [null, left, 1, left + cropW];
        } else {
          const cropH = imgRatio / targetRatio;
          const top = (1 - cropH) / 2;
          return [top, null, top + cropH, 1];
        }
      };
      if (typeof flowRequest?.prompt !== "string" || !flowRequest.prompt.trim()) {
        throw new Error("Flow prompt is empty");
      }
      if (typeof captchaToken !== "string" || !captchaToken) {
        throw new Error("reCAPTCHA token is empty");
      }
      if (flowRequest?.aspect_ratio && !["16:9", "9:16"].includes(flowRequest.aspect_ratio)) {
        throw new Error("Unsupported Flow configuration: aspect_ratio");
      }
      const dur = [4, 5, 6, 8, 10].includes(Number(flowRequest?.duration_seconds)) ? Number(flowRequest.duration_seconds) : 6;
      let modelId = resolveModelId(flowRequest);
      let route = location.pathname.match(/^\/(u\/\d+)\/project\/([^/?#]+)/);
      let accountPath = route ? `/${route[1]}` : "";
      let projectId = route ? route[2] : null;
      if (!projectId) {
        const match2 = location.pathname.match(/\/project\/([^/?#]+)/);
        if (match2) {
          projectId = match2[1];
          const uMatch = location.pathname.match(/\/(u\/\d+)/);
          accountPath = uMatch ? `/${uMatch[1]}` : "";
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
            accountPath = uM ? `/${uM[1]}` : location.pathname.match(/\/(u\/\d+)/)?.[0] || "";
          }
        }
      }
      if (location.hostname !== "flow.google.com" || !projectId) {
        throw new Error("Vui lòng mở một Dự án (Project) trên tab Google Flow trước khi bấm Tạo video");
      }
      const sourcePath = `${accountPath}/project/${projectId}`;
      const wiz = window.WIZ_global_data || {};
      const csrfToken = wiz.SNlM0e;
      const sessionId = wiz.FdrFJe;
      const buildLabel = wiz.cfb2h;
      if (!csrfToken || !sessionId || !buildLabel) {
        throw new Error("Flow page session config is incomplete; reload the project");
      }
      const sidNum = Number(sessionId);
      if (Number.isFinite(sidNum) && Math.abs(sidNum) < 1e6 && Math.abs(sidNum) > 0) {
        throw new Error(`Flow session ID không hợp lệ (sid=${sidNum}); trang chưa load xong WIZ_global_data — cần reload`);
      }
      async function callRpc(rpcId2, payload) {
        const query = new URLSearchParams({
          rpcids: rpcId2,
          "source-path": sourcePath,
          bl: String(buildLabel),
          "f.sid": String(sessionId),
          hl: String(document.documentElement?.lang || "en").split("-")[0],
          _reqid: String(Math.floor(1e5 + Math.random() * 9e5)),
          rt: "c"
        });
        const body = new URLSearchParams({
          "f.req": JSON.stringify([[[rpcId2, JSON.stringify(payload), null, "generic"]]]),
          at: String(csrfToken)
        });
        const base = location.origin || "https://flow.google.com";
        const endpoint = `${base}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`;
        let text = null;
        try {
          const response = await fetch(endpoint, {
            method: "POST",
            credentials: "include",
            cache: "no-store",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
              "X-Same-Domain": "1"
            },
            body: body.toString()
          });
          if (!response.ok) throw new Error(`Flow RPC ${rpcId2} failed: HTTP ${response.status}`);
          text = await response.text();
        } catch (fetchErr) {
          if (typeof XMLHttpRequest !== "undefined") {
            try {
              text = await new Promise((resolve, reject) => {
                const xhr = new XMLHttpRequest();
                xhr.open("POST", endpoint, true);
                xhr.withCredentials = true;
                xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded;charset=UTF-8");
                xhr.setRequestHeader("X-Same-Domain", "1");
                xhr.onload = () => {
                  if (xhr.status >= 200 && xhr.status < 300) resolve(xhr.responseText);
                  else reject(new Error(`HTTP ${xhr.status}: ${xhr.statusText}`));
                };
                xhr.onerror = () => reject(new Error(`XHR network error`));
                xhr.ontimeout = () => reject(new Error(`XHR timeout`));
                xhr.timeout = 45e3;
                xhr.send(body.toString());
              });
            } catch (xhrErr) {
              throw new Error(`Flow RPC ${rpcId2} error: fetch (${fetchErr.message}), xhr (${xhrErr.message})`);
            }
          } else {
            throw fetchErr;
          }
        }
        return parseRpcResponse(text, rpcId2);
      }
      const forceFresh = Boolean(flowRequest?.force_fresh_assets);
      const mediaCache = (typeof window !== "undefined" ? window : globalThis).__FLOW_MEDIA_CACHE__ || ((typeof window !== "undefined" ? window : globalThis).__FLOW_MEDIA_CACHE__ = /* @__PURE__ */ new Map());
      async function uploadImageToFlow(base64Data, mimeType, filename) {
        if (!base64Data) return null;
        const rawBase64 = base64Data.includes(",") ? base64Data.split(",")[1] : base64Data;
        const cacheKey = `img:${projectId}:${rawBase64.slice(0, 64)}:${rawBase64.length}:${filename || ""}`;
        if (!forceFresh && mediaCache.has(cacheKey)) {
          return mediaCache.get(cacheKey);
        }
        try {
          let findMediaIdInResponse = function(node) {
            if (!node) return null;
            if (typeof node === "string" && node !== projectId && (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(node) || node.includes("media") || node.includes("frame"))) {
              return node;
            }
            if (Array.isArray(node)) {
              for (const item of node) {
                const found = findMediaIdInResponse(item);
                if (found) return found;
              }
            }
            if (typeof node === "object") {
              for (const val of Object.values(node)) {
                const found = findMediaIdInResponse(val);
                if (found) return found;
              }
            }
            return null;
          };
          const headerProto = [
            null,
            22,
            null,
            null,
            null,
            projectId,
            null,
            null,
            null,
            null,
            null
          ];
          const maseQPayload = [
            headerProto,
            rawBase64,
            mimeType || "image/png",
            true,
            null,
            null,
            null,
            false,
            filename || "frame.png"
          ];
          const resp = await callRpc("maseQ", maseQPayload);
          const uploadedMediaId = findMediaIdInResponse(resp);
          if (!uploadedMediaId) {
            throw new Error("maseQ response did not contain a valid mediaId: " + JSON.stringify(resp).slice(0, 200));
          }
          mediaCache.set(cacheKey, uploadedMediaId);
          return uploadedMediaId;
        } catch (err) {
          throw new Error(`Lỗi tải ảnh lên Google Flow (maseQ): ${err.message}`);
        }
      }
      let startFrameMediaId = flowRequest?.start_frame_media_id || null;
      let endFrameMediaId = flowRequest?.end_frame_media_id || null;
      const ingredientMediaIds = Array.isArray(flowRequest?.ingredient_media_ids) ? flowRequest.ingredient_media_ids.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()) : [];
      const referenceVideoMediaId = typeof flowRequest?.reference_video_id === "string" ? flowRequest.reference_video_id.trim() : "";
      let isFrames = flowRequest?.input_mode === "frames";
      let isIngredients = flowRequest?.input_mode === "ingredients";
      const isVideoEdit = flowRequest?.input_mode === "video_edit";
      if (isVideoEdit && !referenceVideoMediaId) {
        throw new Error("Video edit mode requires an uploaded reference_video_id");
      }
      if (isFrames) {
        if (!startFrameMediaId && flowRequest.image_base64) {
          startFrameMediaId = await uploadImageToFlow(
            flowRequest.image_base64,
            flowRequest.image_mime,
            flowRequest.image_name || "start_frame.png"
          );
        }
        if (!endFrameMediaId && flowRequest.end_image_base64) {
          endFrameMediaId = await uploadImageToFlow(
            flowRequest.end_image_base64,
            flowRequest.end_image_mime,
            flowRequest.end_image_name || "end_frame.png"
          );
        }
        if (!startFrameMediaId) {
          if (endFrameMediaId) {
            throw new Error("Chế độ Khung hình yêu cầu phải có Khung hình bắt đầu (Start Frame) khi sử dụng Khung hình kết thúc (End Frame)");
          }
          console.warn("[FlowPage] Không có khung hình trong request frames, tự động tạo video từ prompt (text_to_video)");
          isFrames = false;
          modelId = modelId.replace("_i2v_", "_t2v_").replace("_first_last", "").replace("_first", "");
        }
      } else if (isIngredients || isVideoEdit) {
        const ingList = Array.isArray(flowRequest?.ingredient_images) ? flowRequest.ingredient_images.slice() : [];
        if (ingList.length === 0 && flowRequest?.image_base64) {
          ingList.push({
            base64: flowRequest.image_base64,
            mime: flowRequest.image_mime,
            filename: flowRequest.image_name || "ingredient_1.png"
          });
        }
        for (let i = 0; i < ingList.length; i++) {
          const item = ingList[i];
          if (item?.base64) {
            const mid = await uploadImageToFlow(
              item.base64,
              item.mime || "image/png",
              item.filename || `ingredient_${i + 1}.png`
            );
            if (mid) {
              ingredientMediaIds.push(mid);
            }
          }
        }
        if (isIngredients && ingredientMediaIds.length === 0) {
          console.warn("[FlowPage] Không có ảnh tham chiếu trong request ingredients, tự động tạo video từ prompt (text_to_video)");
          isIngredients = false;
          modelId = modelId.replace("_r2v_", "_t2v_");
        }
      }
      const isSingleFrame = isFrames && Boolean(startFrameMediaId) && !endFrameMediaId;
      const rpcId = isVideoEdit ? "jIps6" : isFrames || isIngredients || isSingleFrame ? "nprQif" : "YhhmEf";
      const requestUuidA = (crypto.randomUUID ? crypto.randomUUID() : "AD722819-13F6-46E3-A074-9CA0266A4FE0").toUpperCase();
      const requestUuidB = (crypto.randomUUID ? crypto.randomUUID() : "4C8832DC-AD37-4C11-859E-DCFD4FB4903E").toUpperCase();
      const sceneUuid = (crypto.randomUUID ? crypto.randomUUID() : "154922EC-9CE9-4413-A9C0-B2664F7FFB7B").toUpperCase();
      const isPortrait = flowRequest?.aspect_ratio === "9:16";
      const numOutputs = Math.max(1, Math.min(2, Number(flowRequest?.num_outputs) || 1));
      let startSlot = null;
      let endSlot = null;
      let createPayload = null;
      if (isVideoEdit) {
        const startSeconds = Math.max(0, Number(flowRequest?.reference_video_start_seconds) || 0);
        const requestedEnd = Number(flowRequest?.reference_video_end_seconds);
        const endSeconds = Number.isFinite(requestedEnd) && requestedEnd > startSeconds ? Math.min(requestedEnd, startSeconds + 10) : startSeconds + 10;
        const startFrame = Math.round(startSeconds * 24);
        const endFrame = Math.max(startFrame + 1, Math.round(endSeconds * 24));
        const sourceVideo = [null, referenceVideoMediaId, startFrame, endFrame];
        const destination = [null, null, null, null, requestUuidA, requestUuidB];
        const editRequest = [
          sourceVideo,
          [null, null, [[[flowRequest.prompt.trim()]]]],
          modelId,
          numOutputs,
          destination
        ];
        if (ingredientMediaIds.length > 0) {
          while (editRequest.length < 8) editRequest.push(null);
          editRequest.push(ingredientMediaIds.map((id) => [null, id]));
        }
        if (flowRequest?.resolution === "360p") {
          while (editRequest.length < 12) editRequest.push(null);
          editRequest.push([4]);
        }
        createPayload = [
          [editRequest],
          [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
          [sceneUuid, 2]
        ];
      } else if (isIngredients || isSingleFrame) {
        const primaryMediaId = isSingleFrame ? startFrameMediaId : ingredientMediaIds[0];
        const cropCoordsIng = computeFlowCropCoords(flowRequest?.image_width, flowRequest?.image_height, isPortrait);
        const validR2vDur = [4, 6, 8, 10].includes(dur) ? dur : dur >= 8 ? 8 : 6;
        const activeModelId = isSingleFrame || isIngredients ? modelId.includes("_r2v_") ? modelId : `abra_r2v_${validR2vDur}s` : modelId;
        const extraIngIds = isIngredients && ingredientMediaIds.length > 1 ? ingredientMediaIds.slice(1) : [];
        startSlot = primaryMediaId ? [null, primaryMediaId, null, null, null, cropCoordsIng] : null;
        endSlot = extraIngIds.length > 0 ? [null, extraIngIds[0], null, null, null, cropCoordsIng] : null;
        createPayload = [
          [[
            [null, null, [[[flowRequest.prompt.trim()]]]],
            activeModelId,
            numOutputs,
            null,
            startSlot,
            endSlot,
            [null, null, null, null, requestUuidA, requestUuidB]
          ]],
          [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
          [sceneUuid, 2]
        ];
      } else if (isFrames) {
        const startCrop = computeFlowCropCoords(flowRequest?.image_width, flowRequest?.image_height, isPortrait);
        const endCrop = computeFlowCropCoords(flowRequest?.end_image_width, flowRequest?.end_image_height, isPortrait);
        startSlot = startFrameMediaId ? [null, startFrameMediaId, null, null, null, startCrop] : null;
        endSlot = endFrameMediaId ? [null, endFrameMediaId, null, null, null, endCrop] : null;
        createPayload = [
          [[
            [null, null, [[[flowRequest.prompt.trim()]]]],
            modelId,
            numOutputs,
            null,
            startSlot,
            endSlot,
            [null, null, null, null, requestUuidA, requestUuidB]
          ]],
          [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
          [sceneUuid, 2]
        ];
      } else {
        createPayload = [
          [[
            [null, null, [[[flowRequest.prompt.trim()]]]],
            modelId,
            numOutputs,
            null,
            [null, null, null, null, requestUuidA, requestUuidB]
          ]],
          [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
          [sceneUuid, 2]
        ];
      }
      async function getFreshCaptchaToken() {
        try {
          const grecap = typeof window !== "undefined" ? window.grecaptcha : globalThis.grecaptcha;
          if (grecap?.enterprise?.execute) {
            let siteKey = "";
            const el = typeof document !== "undefined" ? document.querySelector("[data-sitekey]") : null;
            if (el) siteKey = el.getAttribute("data-sitekey") || "";
            if (!siteKey) {
              const script = typeof document !== "undefined" ? document.querySelector('script[src*="enterprise.js"]') : null;
              const m = script?.src?.match(/[?&]render=([^&]+)/);
              if (m && m[1] !== "explicit") siteKey = m[1];
            }
            if (!siteKey) {
              const cfg = typeof window !== "undefined" ? window.___grecaptcha_cfg : globalThis.___grecaptcha_cfg;
              if (cfg?.clients) {
                for (const client of Object.values(cfg.clients)) {
                  if (client?.sitekey) {
                    siteKey = client.sitekey;
                    break;
                  }
                  if (typeof client === "object" && client !== null) {
                    for (const item of Object.values(client)) {
                      if (item?.sitekey) {
                        siteKey = item.sitekey;
                        break;
                      }
                    }
                  }
                  if (siteKey) break;
                }
              }
            }
            if (!siteKey) {
              siteKey = "6LdsFiUsAAAAAIjVDZcuLhaHiDn5nnHVXVRQGeMV";
            }
            console.log("[FlowPage] Đang sinh reCAPTCHA token tươi với siteKey:", siteKey);
            return await grecap.enterprise.execute(siteKey, { action: "VIDEO_GENERATION" });
          }
        } catch (e) {
          console.warn("[FlowPage] Error obtaining fresh reCAPTCHA token in page:", e);
        }
        return null;
      }
      if (ingredientMediaIds.length > 0 || startFrameMediaId) {
        console.log("[FlowPage] Giữ cadence 4.5s sau khi xử lý nguyên liệu...");
        await sleepInPage(4500);
      }
      const freshTokenBeforeCreate = await getFreshCaptchaToken();
      if (freshTokenBeforeCreate && Array.isArray(createPayload?.[1])) {
        console.log("[FlowPage] Đã gắn fresh reCAPTCHA token vào payload tạo video");
        createPayload[1][10] = [freshTokenBeforeCreate, 1];
      }
      try {
        (typeof window !== "undefined" ? window : globalThis).__LAST_FLOW_DEBUG__ = {
          rpcId,
          createPayload: JSON.parse(JSON.stringify(createPayload)),
          flowRequest: { ...flowRequest, image_base64: Boolean(flowRequest?.image_base64), end_image_base64: Boolean(flowRequest?.end_image_base64) },
          image_width: flowRequest?.image_width,
          image_height: flowRequest?.image_height
        };
      } catch {
      }
      let created = null;
      try {
        created = findMediaAsset(await callRpc(rpcId, createPayload));
      } catch (rpcErr) {
        try {
          if ((typeof window !== "undefined" ? window : globalThis).__LAST_FLOW_DEBUG__) {
            (typeof window !== "undefined" ? window : globalThis).__LAST_FLOW_DEBUG__.firstError = rpcErr.message;
          }
        } catch {
        }
        if (rpcErr?.message && (rpcErr.message.includes("PUBLIC_ERROR_UNUSUAL_ACTIVITY") || rpcErr.message.includes("[7]"))) {
          console.log("[FlowPage] Gặp PUBLIC_ERROR_UNUSUAL_ACTIVITY, giãn cách cadence 4.5s và lấy reCAPTCHA token mới...");
          await sleepInPage(4500);
          const retryToken = await getFreshCaptchaToken();
          if (retryToken) {
            if (Array.isArray(createPayload?.[1])) {
              createPayload[1][10] = [retryToken, 1];
            }
            try {
              created = findMediaAsset(await callRpc(rpcId, createPayload));
            } catch (retryErr) {
              console.warn("[FlowPage] Thử lại sau UNUSUAL_ACTIVITY thất bại:", retryErr);
            }
          }
        }
        if (!created && (isSingleFrame || isIngredients)) {
          const fallbackDurations = [8, 10, 6, 4].filter((d) => `abra_r2v_${d}s` !== createPayload[0][0][1]);
          let lastErr = rpcErr;
          for (const fbDur of fallbackDurations) {
            try {
              console.log("[FlowPage] Fallback nprQif ingredients/singleFrame với duration:", fbDur);
              createPayload[0][0][1] = `abra_r2v_${fbDur}s`;
              const fbResp = await callRpc(rpcId, createPayload);
              created = findMediaAsset(fbResp);
              if (created) {
                console.log("[FlowPage] Fallback ingredients thành công với duration:", fbDur);
                modelId = `abra_r2v_${fbDur}s`;
                break;
              }
            } catch (fbErr) {
              lastErr = fbErr;
            }
          }
          if (!created) {
            const activeTok = freshTokenBeforeCreate || captchaToken;
            const diag = `[Diag: pid=${projectId}, tokLen=${activeTok?.length || 0}, isFresh=${Boolean(freshTokenBeforeCreate)}, at=${csrfToken ? csrfToken.slice(0, 6) : "none"}, sid=${sessionId ? String(sessionId).slice(0, 6) : "none"}, bl=${buildLabel ? String(buildLabel).slice(0, 10) : "none"}]`;
            throw new Error(`${lastErr?.message || lastErr} ${diag}`);
          }
        } else if (isFrames || isSingleFrame || isIngredients) {
          const fallbackCandidates = isFrames && endSlot ? [
            { model: dur >= 10 ? "omni_flash_i2v_10s_first_last" : "omni_flash_i2v_8s_first_last", end: endSlot },
            { model: dur >= 10 ? "omni_flash_i2v_8s_first_last" : "omni_flash_i2v_10s_first_last", end: endSlot }
          ] : [
            { model: "abra_r2v_8s", end: endSlot },
            { model: "abra_r2v_10s", end: endSlot },
            { model: "abra_r2v_6s", end: endSlot },
            { model: "abra_r2v_4s", end: endSlot }
          ];
          let lastErr = rpcErr;
          for (const cand of fallbackCandidates) {
            if (cand.model === modelId) continue;
            try {
              console.log("[FlowPage] Thử lại nprQif với candidate:", cand.model);
              createPayload[0][0][1] = cand.model;
              createPayload[0][0][5] = cand.end;
              const fallbackResp = await callRpc(rpcId, createPayload);
              created = findMediaAsset(fallbackResp);
              if (created) {
                console.log("[FlowPage] Fallback nprQif thành công với model:", cand.model);
                modelId = cand.model;
                break;
              }
            } catch (fbErr) {
              lastErr = fbErr;
              try {
                const dbg = (typeof window !== "undefined" ? window : globalThis).__LAST_FLOW_DEBUG__;
                if (dbg) {
                  if (!dbg.fallbackErrors) dbg.fallbackErrors = [];
                  dbg.fallbackErrors.push({ model: cand.model, err: fbErr.message });
                }
              } catch {
              }
            }
          }
          if (!created) {
            const slot4Str = JSON.stringify(createPayload?.[0]?.[0]?.[4]);
            const slot5Str = JSON.stringify(createPayload?.[0]?.[0]?.[5]);
            throw new Error(`${lastErr?.message || lastErr} [Model: ${createPayload?.[0]?.[0]?.[1]}, slot4: ${slot4Str}, slot5: ${slot5Str}]`);
          }
        } else if (modelId.includes("_i2v_") && !isFrames && !isIngredients) {
          const fallbackModelId = modelId.replace("_i2v_", "_t2v_");
          createPayload[0][0][1] = fallbackModelId;
          created = findMediaAsset(await callRpc(rpcId, createPayload));
        } else {
          throw rpcErr;
        }
      }
      const mediaId = created?.[0];
      if (!mediaId) throw new Error("Flow create response did not contain a media id");
      try {
        (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = {
          mediaId,
          projectId,
          modelId,
          startTime: Date.now(),
          prompt: flowRequest?.prompt || ""
        };
      } catch {
      }
      let videoUrl = null;
      let imageUrl = null;
      const deadline = Date.now() + 6e5;
      let loopCount = 0;
      while (Date.now() < deadline) {
        await sleepInPage(3e3);
        loopCount++;
        const domUrl = checkDomAndPerformanceForVideo(mediaId);
        if (domUrl) {
          videoUrl = domUrl;
          break;
        }
        try {
          const pollResp = await callRpc("jwpduf", [null, null, [[mediaId]]]);
          const pollUrl = findVideoUrl(pollResp);
          if (pollUrl) {
            videoUrl = pollUrl;
            break;
          }
          const asset = findMediaAsset(pollResp);
          const status = asset?.[5]?.[8]?.[0] ?? asset?.[5]?.[0]?.[8]?.[0];
          if (status === 3) {
            const finalAsset = await callRpc("as29s", [mediaId]);
            videoUrl = finalAsset?.[7]?.[0]?.[8] || finalAsset?.[5]?.[2]?.[0]?.[8] || findVideoUrl(finalAsset);
            imageUrl = finalAsset?.[5]?.[10] || finalAsset?.[5]?.[0]?.[10] || null;
            if (videoUrl) break;
          }
          const isProcessing = status === 6 || status === 2 || status === 1 || status === void 0 || status === null;
          if (!isProcessing && status !== 3) {
            let extraReason = "";
            try {
              const findStrings = (node) => {
                if (typeof node === "string" && node.length > 4 && node.length < 250) {
                  const l = node.toLowerCase();
                  if (l.includes("policy") || l.includes("safety") || l.includes("filter") || l.includes("block") || l.includes("reject") || l.includes("fail") || l.includes("violate") || l.includes("quality") || l.includes("person") || l.includes("moderation") || l.includes("pose") || l.includes("unsupported")) {
                    return node;
                  }
                }
                if (Array.isArray(node)) {
                  for (const c of node) {
                    const s = findStrings(c);
                    if (s) return s;
                  }
                }
                return "";
              };
              extraReason = findStrings(pollResp);
            } catch {
            }
            const reasonSuffix = extraReason ? ` (lý do: ${extraReason})` : "";
            throw new Error(`Flow render ended with status ${status}${reasonSuffix}`);
          }
        } catch (err) {
          if (err.message && err.message.includes("Flow render ended")) throw err;
        }
        if (loopCount >= 7 && loopCount % 2 === 0) {
          try {
            const checkFinal = await callRpc("as29s", [mediaId]);
            const asUrl = checkFinal?.[7]?.[0]?.[8] || checkFinal?.[5]?.[2]?.[0]?.[8] || findVideoUrl(checkFinal);
            if (asUrl) {
              videoUrl = asUrl;
              imageUrl = checkFinal?.[5]?.[10] || checkFinal?.[5]?.[0]?.[10] || null;
              break;
            }
          } catch {
          }
        }
      }
      if (!videoUrl) throw new Error("Timed out waiting for Flow render");
      try {
        const active = (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__;
        if (active && active.mediaId === mediaId) {
          (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null;
        }
      } catch {
      }
      return {
        ok: true,
        video_url: videoUrl,
        image_url: imageUrl,
        media_id: mediaId,
        provider_model_id: modelId,
        project_id: projectId
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  // src/providers/google-flow/generation.js
  async function generateFlowVideo(flowRequest, captchaToken) {
    const hasDebugger = typeof chrome !== "undefined" && Boolean(chrome?.debugger);
    if (flowRequest?.input_mode === "frames" || flowRequest?.input_mode === "ingredients") {
      if (!hasDebugger) return { ok: false, error: "FLOW_UI: Reload FlowsVeo to enable native browser control for Frames/Ingredients." };
      const tabId2 = await ensureProjectTab(flowRequest.project_id, { flowOnly: true });
      if (!tabId2) return { ok: false, error: "FLOW_UI: Không mở được project Flow." };
      return flowRequest.input_mode === "ingredients" ? generateIngredientsThroughUi(flowRequest, tabId2) : generateFramesThroughUi(flowRequest, tabId2);
    }
    if (flowRequest?.input_mode === "video_edit") {
      if (!hasDebugger) return { ok: false, error: "FLOW_UI: Reload FlowsVeo to enable native browser control for Motion Control." };
      const tabId2 = await ensureProjectTab(flowRequest.project_id, { flowOnly: true });
      if (!tabId2) return { ok: false, error: "FLOW_UI: Không mở được project Flow cho Motion Control." };
      return generateMotionVideoThroughUi(flowRequest, tabId2);
    }
    if (flowRequest?.project_id) {
      try {
        await ensureProjectTab(flowRequest.project_id);
      } catch (e) {
        logActivity("warn", `ensureProjectTab pre-flight error: ${e.message}`);
      }
    }
    const tabId = await findLabsTab(flowRequest?.project_id);
    if (!tabId) return { ok: false, error: "Open a Flow project in Chrome" };
    try {
      await chrome.tabs.update(tabId, { active: true });
      const t = await chrome.tabs.get(tabId).catch(() => null);
      if (t?.windowId) {
        await chrome.windows.update(t.windowId, { focused: true }).catch(() => {
        });
      }
    } catch {
    }
    const isFrames = flowRequest?.input_mode === "frames";
    const isIngredients = flowRequest?.input_mode === "ingredients";
    const isVideoEdit = flowRequest?.input_mode === "video_edit";
    if (!isFrames && !isIngredients && !isVideoEdit && hasDebugger) {
      logActivity("info", `Running Video UI Automation on tab=${tabId}`);
      return await generateVideoThroughUi(flowRequest, tabId);
    }
    logActivity("info", `Running In-Page RPC generation for ${flowRequest?.input_mode} on tab=${tabId}`);
    const recoverLostResult = async (originalError) => {
      logActivity("info", `Lost direct result (${originalError}). Starting patient scene recovery...`);
      const recoveryDeadline = Date.now() + 3e5;
      let attempt = 0;
      let lastError = "";
      while (Date.now() < recoveryDeadline) {
        attempt++;
        await sleep(3e3);
        try {
          if (chrome.runtime?.getPlatformInfo) await chrome.runtime.getPlatformInfo();
        } catch {
        }
        const recovered = await recoverCurrentSceneVideo(
          flowRequest?.project_id || null,
          tabId,
          flowRequest?.provider_model_id || ""
        );
        if (recovered?.ok) {
          logActivity("info", `Scene recovery succeeded on attempt ${attempt}`);
          return {
            ...recovered,
            recovered_after_lost_result: true
          };
        }
        if (recovered?.terminal_error) {
          logActivity("warn", `Scene recovery terminal error: ${recovered.error}`);
          return { ok: false, error: `${originalError}; scene recovery rejected: ${recovered.error}` };
        }
        lastError = recovered?.error || "no video found";
        if (attempt % 5 === 0) {
          logActivity("info", `Scene recovery attempt ${attempt} (${Math.max(0, Math.round((recoveryDeadline - Date.now()) / 1e3))}s remaining)...`);
        }
      }
      return { ok: false, error: `${originalError}; scene recovery timed out (sau 5 phút): ${lastError}` };
    };
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: runFlowGenerationInPage,
        args: [flowRequest, captchaToken]
      });
      const result = injected?.[0]?.result;
      if (result && !result.ok && result.error && /session ID không hợp lệ|session config is incomplete/i.test(result.error)) {
        logActivity("warn", `Session stale on tab ${tabId}, reloading and retrying: ${result.error}`);
        try {
          await chrome.tabs.reload(tabId, { bypassCache: false });
          await waitForTabComplete(tabId, 2e4);
          await sleep(3e3);
          await warmUpRecaptcha(tabId, 6e3);
        } catch (reloadErr) {
          logActivity("warn", `Tab reload failed: ${reloadErr.message}`);
        }
        try {
          const retryInjected = await chrome.scripting.executeScript({
            target: { tabId },
            world: "MAIN",
            func: runFlowGenerationInPage,
            args: [flowRequest, captchaToken]
          });
          const retryResult = retryInjected?.[0]?.result;
          if (retryResult) {
            if (retryResult.ok || !/Flow page returned no result/i.test(retryResult.error || "")) return retryResult;
            return recoverLostResult(retryResult.error);
          }
          return recoverLostResult("Flow page returned no result after session reload");
        } catch (retryErr) {
          const retryMsg = retryErr?.message || String(retryErr);
          if (/context invalidated|frame was removed|execution context|no result/i.test(retryMsg)) {
            return recoverLostResult(`Cannot execute Flow adapter after reload: ${retryMsg}`);
          }
          return { ok: false, error: `Cannot execute Flow adapter after reload: ${retryMsg}` };
        }
      }
      if (result) {
        if (result.ok || !/Flow page returned no result/i.test(result.error || "")) return result;
        return recoverLostResult(result.error);
      }
      return recoverLostResult("Flow page returned no result");
    } catch (error) {
      const message = error?.message || String(error);
      if (/context invalidated|frame was removed|execution context|no result/i.test(message)) {
        return recoverLostResult(`Cannot execute Flow adapter: ${message}`);
      }
      return { ok: false, error: `Cannot execute Flow adapter: ${message}` };
    }
  }
  async function generateFlowImage(imageRequest, captchaToken, pinnedTabId = null) {
    const tabId = pinnedTabId ?? await findLabsTab(imageRequest?.project_id);
    if (!tabId) return { ok: false, error: "Open a Flow project in Chrome" };
    try {
      await chrome.tabs.update(tabId, { active: true });
      const t = await chrome.tabs.get(tabId).catch(() => null);
      if (t?.windowId) {
        await chrome.windows.update(t.windowId, { focused: true }).catch(() => {
        });
      }
    } catch {
    }
    const hasDebugger = typeof chrome !== "undefined" && Boolean(chrome?.debugger);
    if (hasDebugger) {
      logActivity("info", `Running Image UI Automation on tab=${tabId}`);
      return await generateImageThroughUi(imageRequest, tabId);
    }
    logActivity("info", `Running In-Page Image generation on tab=${tabId}`);
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: runImageGenerationInPage,
        args: [imageRequest, captchaToken]
      });
      return injected?.[0]?.result || { ok: false, error: "Image generation returned no result" };
    } catch (error) {
      return { ok: false, error: `Cannot generate image: ${error.message}` };
    }
  }
  async function recoverCurrentSceneVideo(projectId = null, fallbackTabId = null, providerModelId = "") {
    const tabId = fallbackTabId || await findLabsTab(projectId);
    if (!tabId) return { ok: false, error: "Open the completed Flow scene in Chrome" };
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: recoverCurrentSceneInPage,
        args: [providerModelId]
      });
      return injected?.[0]?.result || { ok: false, error: "Flow scene returned no result" };
    } catch (error) {
      return { ok: false, error: `Cannot inspect Flow scene: ${error.message}` };
    }
  }

  // src/providers/google-flow/page/projects.js
  async function runCreateProjectInPage() {
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      let accountPath = location.pathname.match(/\/(u\/\d+)/)?.[0] || "";
      const initialProjectId = location.pathname.match(/\/project\/([^/?#]+)/)?.[1] || null;
      let clicked = false;
      const allEls = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'));
      for (const el of allEls) {
        const txt = (el.textContent || "").trim().toLowerCase();
        const aria = (el.getAttribute("aria-label") || "").trim().toLowerCase();
        if ((txt.includes("new project") || aria.includes("new project") || txt.includes("start creating") || txt.includes("dự án mới")) && !txt.includes("terms") && !txt.includes("policy")) {
          const target = el.closest('button, [role="button"], a') || el;
          target.click();
          clicked = true;
          break;
        }
      }
      if (!clicked) {
        return { ok: false, error: "Không tìm thấy nút tạo Project mới trên Google Flow" };
      }
      const deadline = Date.now() + 1e4;
      while (Date.now() < deadline) {
        await sleepInPage(400);
        const match = location.pathname.match(/\/project\/([^/?#]+)/);
        if (match && match[1] && match[1] !== initialProjectId) {
          let email = "";
          try {
            const profileEl = document.querySelector('[aria-label*="@"], [data-email]');
            if (profileEl) {
              const aria = profileEl.getAttribute("aria-label") || "";
              const m = aria.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
              if (m) email = m[1];
            }
          } catch {
          }
          return { ok: true, flow_project_id: match[1], account_email: email };
        }
      }
      return {
        ok: false,
        error: initialProjectId ? `Google Flow không chuyển khỏi project hiện tại (${initialProjectId}) sau khi bấm tạo mới` : "Google Flow không mở được project mới sau khi bấm tạo"
      };
    } catch (err) {
      return { ok: false, error: err.message || String(err) };
    }
  }

  // src/providers/google-flow/projects.js
  async function handleCreateProject(request) {
    let tabId = await findLabsTab();
    if (!tabId) {
      tabId = await openLabsTab();
    }
    if (!tabId) {
      return { ok: false, error: "Không tìm thấy hoặc không thể mở tab Google Flow" };
    }
    try {
      const currentTab = await chrome.tabs.get(tabId);
      if (currentTab?.url && /\/project\//.test(currentTab.url)) {
        const currentUrl = new URL(currentTab.url);
        const accountPath = currentUrl.pathname.match(/\/(u\/\d+)/)?.[0] || "";
        const homeUrl = `${currentUrl.origin}${accountPath}/`;
        const homeTab = await chrome.tabs.create({ url: homeUrl, active: true });
        tabId = homeTab.id;
        await waitForTabComplete(tabId, 2e4);
        await sleep(1500);
      }
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: runCreateProjectInPage
      });
      const res = injected?.[0]?.result;
      if (!res || !res.ok) {
        return { ok: false, error: res?.error || "Lỗi khi kích hoạt tạo Project trên tab Flow" };
      }
      await sleep(2500);
      await warmUpRecaptcha(tabId, 8e3);
      let email = res.account_email;
      if (!email) {
        const accounts = Object.keys(runtime.harvestedAccounts);
        if (accounts.length > 0) email = accounts[0];
      }
      return {
        ok: true,
        flow_project_id: res.flow_project_id,
        account_email: email
      };
    } catch (err) {
      return { ok: false, error: `Lỗi thực thi tạo Project: ${err.message}` };
    }
  }
  async function handleSwitchProject(request) {
    const targetPid = request.flow_project_id;
    if (!targetPid) {
      return { ok: false, error: "Thiếu flow_project_id" };
    }
    const tabId = await ensureProjectTab(targetPid);
    if (!tabId) {
      return { ok: false, error: `Không thể chuyển sang tab project ${targetPid}` };
    }
    return { ok: true, flow_project_id: targetPid, tab_id: tabId };
  }

  // src/providers/google-flow/page/upload.js
  async function runVideoUploadInPage(uploadRequest) {
    try {
      const { video_base64, video_mime, video_filename, project_id, force_fresh } = uploadRequest;
      if (!video_base64) throw new Error("video_base64 is required");
      const projectId = location.pathname.match(/\/project\/([^/?#]+)/)?.[1] || null;
      if (!projectId) throw new Error("Vui lòng mở một Project trên tab Google Flow");
      const accountPath = location.pathname.match(/\/(u\/\d+)/)?.[0] || "";
      const authUser = accountPath.match(/\d+/)?.[0] || "";
      const targetPid = project_id || projectId;
      if (targetPid !== projectId) {
        throw new Error(`Tab Flow đang mở project ${projectId}, không phải project ${targetPid}`);
      }
      const rawBase64 = video_base64.includes(",") ? video_base64.split(",")[1] : video_base64;
      const mimeType = video_mime || "video/mp4";
      const filename = video_filename || "reference_video.mp4";
      const cache = (typeof window !== "undefined" ? window : globalThis).__FLOW_MEDIA_CACHE__ || ((typeof window !== "undefined" ? window : globalThis).__FLOW_MEDIA_CACHE__ = /* @__PURE__ */ new Map());
      const cacheKey = `vid:${targetPid}:${rawBase64.slice(0, 64)}:${rawBase64.length}:${filename}`;
      if (!force_fresh && cache.has(cacheKey)) {
        const cached = cache.get(cacheKey);
        return {
          ...cached,
          ok: true,
          cached: true
        };
      }
      const binary = atob(rawBase64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      const base = location.origin || "https://flow.google.com";
      const startUrl = `${base}/upload/v1/flow/upload/video/${encodeURIComponent(targetPid)}${authUser ? `?authuser=${authUser}` : ""}`;
      const startResponse = await fetch(startUrl, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
          "Slug": filename,
          "X-Goog-Upload-Command": "start",
          "X-Goog-Upload-Header-Content-Length": String(bytes.byteLength),
          "X-Goog-Upload-Protocol": "resumable",
          ...authUser ? { "X-Goog-AuthUser": authUser } : {}
        }
      });
      if (!startResponse.ok) {
        const preview = await startResponse.text().catch(() => "");
        throw new Error(`Flow video upload start failed HTTP ${startResponse.status}: ${preview.slice(0, 200)}`);
      }
      const uploadUrl = startResponse.headers.get("x-goog-upload-url");
      if (!uploadUrl) throw new Error("Flow video upload start response is missing x-goog-upload-url");
      const finalizeResponse = await fetch(uploadUrl, {
        method: "POST",
        credentials: "include",
        cache: "no-store",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded;charset=utf-8",
          "Slug": filename,
          "X-Goog-Upload-Command": "upload, finalize",
          "X-Goog-Upload-Offset": "0",
          ...authUser ? { "X-Goog-AuthUser": authUser } : {}
        },
        body: bytes
      });
      const responseText = await finalizeResponse.text();
      if (!finalizeResponse.ok) {
        throw new Error(`Flow video upload finalize failed HTTP ${finalizeResponse.status}: ${responseText.slice(0, 300)}`);
      }
      let uploaded;
      try {
        uploaded = JSON.parse(responseText);
      } catch {
        throw new Error(`Flow video upload returned invalid JSON: ${responseText.slice(0, 300)}`);
      }
      const mediaId = uploaded?.mediaId || uploaded?.media?.name || null;
      if (!mediaId) throw new Error(`Flow video upload response has no mediaId: ${responseText.slice(0, 300)}`);
      const result = {
        ok: true,
        media_id: mediaId,
        project_id: uploaded?.media?.projectId || targetPid,
        workflow_id: uploaded?.workflow?.name || uploaded?.media?.workflowId || null,
        filename,
        mime_type: mimeType
      };
      cache.set(cacheKey, {
        media_id: mediaId,
        project_id: result.project_id,
        workflow_id: result.workflow_id,
        filename,
        mime_type: mimeType
      });
      return result;
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  }

  // src/providers/google-flow/upload.js
  async function uploadVideoToFlow(request) {
    const targetPid = request.project_id || null;
    let tabId = await findLabsTab(targetPid);
    if (!tabId) return { ok: false, error: "Open a Flow project in Chrome" };
    const captchaResult = await solveRecaptcha({ ...request, captcha_action: "VIDEO_GENERATION" });
    if (!captchaResult.token) {
      return { ok: false, error: captchaResult.error || "reCAPTCHA failed for video upload" };
    }
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: runVideoUploadInPage,
        args: [request, captchaResult.token]
      });
      return injected?.[0]?.result || { ok: false, error: "Flow page returned no result for video upload" };
    } catch (error) {
      return { ok: false, error: `Cannot execute video upload: ${error.message}` };
    }
  }

  // src/providers/google-flow/page/video-upload-ui.js
  function videoUploadUiStep(action, request) {
    try {
      const fail = (message) => {
        throw new Error(message);
      };
      if (location.hostname !== "flow.google.com" || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== request.project_id) {
        fail("Flow tab changed project before video upload.");
      }
      const visible = (el) => el && el.getBoundingClientRect().width > 0 && el.getBoundingClientRect().height > 0 && window.getComputedStyle(el).visibility !== "hidden";
      const norm = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/Ä‘/gi, "d").replace(/\s+/g, " ").trim().toLowerCase();
      const label = (el) => norm(el.getAttribute("aria-label")) || norm(el.innerText || el.textContent);
      const find = (selector, predicate) => [...document.querySelectorAll(selector)].find((el) => visible(el) && predicate(el));
      const point = (el) => {
        if (!el) fail("Flow upload control was not found. Open the project prompt and try again.");
        if (el.disabled || el.getAttribute("aria-disabled") === "true") fail("Flow upload control is not ready.");
        el.scrollIntoView({ block: "nearest" });
        const rect = el.getBoundingClientRect();
        const x = rect.left + rect.width / 2;
        const y = rect.top + rect.height / 2;
        if (!el.contains(document.elementFromPoint(x, y))) fail("A window is covering the Flow upload control.");
        return { x, y };
      };
      if (action === "unlock") {
        document.documentElement.removeAttribute("data-flowsveo-upload-until");
        return true;
      }
      if (action === "lock") {
        document.documentElement.setAttribute("data-flowsveo-upload-until", String(Date.now() + 3e5));
        return true;
      }
      if (action === "openPicker") {
        const add = find(".base-prompt-box button.add-menu-trigger", () => true);
        return point(add);
      }
      if (action === "upload") {
        const button = find('button,[role="button"]', (el) => /tai noi dung nghe nhin len|upload media|upload files/.test(label(el)));
        return point(button);
      }
      return fail("Unknown Flow video upload step.");
    } catch (error) {
      return { error: error?.message || "Could not prepare the Flow video upload." };
    }
  }

  // src/providers/google-flow/video-upload-ui.js
  function parseUploadResult(body, expectedProjectId) {
    let value;
    try {
      value = JSON.parse(String(body || "").replace(/^\)\]\}'\s*/, "").trim());
    } catch {
      return null;
    }
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const walk = (node, inheritedProjectId = null) => {
      if (!node || typeof node !== "object") return null;
      if (Array.isArray(node)) {
        for (const child of node) {
          const found = walk(child, inheritedProjectId);
          if (found) return found;
        }
        return null;
      }
      const projectId = node.projectId || node.project_id || node.media?.projectId || inheritedProjectId;
      const mediaId = node.mediaId || node.media_id || node.media?.mediaId || node.media?.media_id;
      if (typeof mediaId === "string" && uuid.test(mediaId) && projectId === expectedProjectId) {
        return { media_id: mediaId, project_id: projectId };
      }
      for (const child of Object.values(node)) {
        const found = walk(child, projectId);
        if (found) return found;
      }
      return null;
    };
    return walk(value);
  }
  async function uploadVideoToFlowThroughUi(request, tabId) {
    if (!request?.project_id || !request.video_local_path || !request.video_filename) {
      return { ok: false, error: "FLOW_UI: Project, local video path and filename are required." };
    }
    if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(request.video_local_path)) {
      return { ok: false, error: "FLOW_UI: The local video path must be absolute." };
    }
    if (!chrome.debugger) return { ok: false, error: "FLOW_UI: Reload FlowsVeo to enable native file upload." };
    const target = { tabId };
    const command = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);
    let attached = false;
    let pendingChooser = null;
    let settled = false;
    let timeout = null;
    let resolveResult;
    const completion = new Promise((resolve) => {
      resolveResult = resolve;
    });
    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolveResult(value);
    };
    const step = async (action) => {
      const injected = await chrome.scripting.executeScript({
        target,
        world: "MAIN",
        func: videoUploadUiStep,
        args: [action, request]
      });
      if (!injected?.length || !Object.hasOwn(injected[0], "result")) {
        throw new Error("Flow page did not respond to the native upload step.");
      }
      if (injected[0].result?.error) throw new Error(injected[0].result.error);
      return injected[0].result;
    };
    const click = async (point) => {
      await command("Input.dispatchMouseEvent", { type: "mouseMoved", ...point });
      await command("Input.dispatchMouseEvent", { type: "mousePressed", ...point, button: "left", buttons: 1, clickCount: 1 });
      await command("Input.dispatchMouseEvent", { type: "mouseReleased", ...point, button: "left", buttons: 0, clickCount: 1 });
      await sleep(250);
    };
    const onEvent = (source, method, params) => {
      if (source.tabId !== tabId || source.sessionId || settled) return;
      if (method === "Page.fileChooserOpened" && pendingChooser) {
        const chooser = pendingChooser;
        pendingChooser = null;
        clearTimeout(chooser.timer);
        command("DOM.setFileInputFiles", { backendNodeId: params.backendNodeId, files: [request.video_local_path] }).then(() => chooser.resolve()).catch((error) => chooser.reject(new Error(`Chrome could not select the video file: ${error.message}`)));
        return;
      }
      if (method === "Network.requestWillBeSent") {
        const url = params.request?.url || "";
        if (params.request?.method === "POST" && url.includes(`/upload/v1/flow/upload/video/${request.project_id}`)) {
          params.requestId && uploadRequests.add(params.requestId);
        }
        return;
      }
      if (!uploadRequests.has(params.requestId)) return;
      if (method === "Network.loadingFailed") {
        uploadRequests.delete(params.requestId);
        finish({ ok: false, error: "FLOW_UI: Flow interrupted the native video upload. No video generation was submitted." });
        return;
      }
      if (method === "Network.loadingFinished") {
        const requestId = params.requestId;
        uploadRequests.delete(requestId);
        command("Network.getResponseBody", { requestId }).then((response) => {
          if (settled) return;
          const body = response.base64Encoded ? new TextDecoder().decode(Uint8Array.from(atob(response.body), (char) => char.charCodeAt(0))) : response.body;
          const asset = parseUploadResult(body, request.project_id);
          if (asset) finish({ ok: true, ...asset });
        }).catch(() => {
        });
      }
    };
    const onDetach = (source) => {
      if (source.tabId === tabId && !settled) {
        finish({ ok: false, error: "FLOW_UI: Chrome detached during the native video upload. Check Flow before retrying." });
      }
    };
    const uploadRequests = /* @__PURE__ */ new Set();
    try {
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      chrome.debugger.onEvent.addListener(onEvent);
      chrome.debugger.onDetach.addListener(onDetach);
      await command("Network.enable", { maxResourceBufferSize: 5 * 1024 * 1024, maxTotalBufferSize: 12 * 1024 * 1024 });
      await command("Page.enable");
      await command("DOM.enable");
      await command("Page.setInterceptFileChooserDialog", { enabled: true, cancel: false });
      await chrome.scripting.executeScript({ target, world: "MAIN", func: videoUploadUiStep, args: ["lock", request] });
      const chooserPromise = new Promise((resolve, reject) => {
        pendingChooser = {
          resolve,
          reject,
          timer: setTimeout(() => {
            if (pendingChooser) pendingChooser = null;
            reject(new Error("Flow did not open the video file chooser."));
          }, 15e3)
        };
      });
      await click(await step("openPicker"));
      await click(await step("upload"));
      await chooserPromise;
      timeout = setTimeout(() => finish({
        ok: false,
        error: "FLOW_UI: Timed out waiting for Flow to finish uploading the reference video. No video generation was submitted."
      }), 21e4);
      const result = await completion;
      if (result.ok) await sleep(500);
      return result;
    } catch (error) {
      return { ok: false, error: `FLOW_UI: ${error?.message || "Could not upload the reference video through Flow."}` };
    } finally {
      settled = true;
      clearTimeout(timeout);
      if (pendingChooser) clearTimeout(pendingChooser.timer);
      chrome.debugger.onEvent.removeListener(onEvent);
      chrome.debugger.onDetach.removeListener(onDetach);
      if (attached) {
        await command("Page.setInterceptFileChooserDialog", { enabled: false }).catch(() => {
        });
        await chrome.debugger.detach(target).catch(() => {
        });
        attached = false;
      }
      await chrome.scripting.executeScript({ target, world: "MAIN", func: videoUploadUiStep, args: ["unlock", request] }).catch(() => {
      });
    }
  }

  // src/providers/google-flow/credentials.js
  function classifyTier(creditData) {
    const tier = String(creditData.userPaygateTier || "").toUpperCase();
    const sku = String(creditData.sku || "").toUpperCase();
    const service = String(creditData.serviceTier || "").toUpperCase();
    const credits = parseInt(creditData.credits || 0);
    const subCred = parseInt(creditData.subscriptionCredits || -1);
    if (tier.includes("TIER_TWO") || sku.includes("TIER2")) return "ULTRA";
    if (tier.includes("TIER_ONE") || sku.includes("TIER1")) return "PRO";
    if (tier.includes("NOT_PAID") || sku.includes("FREE")) return "FREE";
    if (service.includes("ADVANCED")) return "ULTRA";
    if (service.includes("INTERMEDIATE") || service.includes("PRO")) return "PRO";
    if (service.includes("ENTRY") || service.includes("STANDARD")) return "FREE";
    if (subCred > 0 || credits > 0) return "PRO";
    return "FREE";
  }
  async function harvestSingleTab(tab) {
    if (runtime.imageUiBusy || runtime.videoUiBusy) return null;
    ensureHarvestCfg();
    if (!tab?.id) return null;
    const hcfg = runtime.harvestCfg.h;
    logActivity("info", `[harvest] tab=${tab.id} url=${tab.url || ""} incognito=${tab.incognito}`);
    let storeId = tab.cookieStoreId || (tab.incognito ? "1" : "0");
    let cookies = [];
    try {
      const isFlow2 = tab.url?.includes("flow.google.com");
      cookies = await chrome.cookies.getAll({ domain: isFlow2 ? "flow.google.com" : hcfg.d, storeId }) || [];
      if (!cookies.length && isFlow2) {
        cookies = await chrome.cookies.getAll({ domain: "labs.google", storeId }) || [];
      }
      if (!cookies.length) {
        const stores = await chrome.cookies.getAllCookieStores();
        for (const store of stores) {
          if (store.tabIds?.includes(tab.id)) {
            cookies = await chrome.cookies.getAll({ domain: isFlow2 ? "flow.google.com" : hcfg.d, storeId: store.id }) || [];
            storeId = store.id;
            break;
          }
        }
      }
    } catch (e) {
      logActivity("warn", `[harvest] cookie error: ${e.message}`);
    }
    const sessionCookies = (cookies || []).filter((c) => c.name === hcfg.cn);
    const isFlow = Boolean(tab.url?.includes("flow.google.com"));
    let sessionData = null;
    try {
      const res = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        world: "MAIN",
        func: async (sessionUrl, tokenFields) => {
          let email2 = null;
          let accessToken2 = null;
          let domCredits = null;
          let domTier = "FREE";
          if (window.location.hostname.endsWith("labs.google")) {
            try {
              const resp = await fetch(sessionUrl, { credentials: "include", cache: "no-store" });
              if (resp.ok) {
                const body = await resp.json();
                for (const field of tokenFields) {
                  if (body[field]) {
                    accessToken2 = body[field];
                    break;
                  }
                }
                if (body?.user?.email) email2 = body.user.email;
              }
            } catch {
            }
          }
          try {
            const fullText = document.body?.innerText || "";
            const emailMatch = fullText.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
            if (emailMatch) {
              email2 = emailMatch[1];
            }
            if (!email2) {
              const profileEl = document.querySelector('[aria-label*="@"], [data-email], a[href*="SignOutOptions"]');
              if (profileEl) {
                const aria = profileEl.getAttribute("aria-label") || "";
                const m = aria.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
                if (m) email2 = m[1];
                if (!email2 && profileEl.getAttribute("data-email")) {
                  email2 = profileEl.getAttribute("data-email");
                }
              }
            }
            if (!email2 && window.WIZ_global_data) {
              for (const val of Object.values(window.WIZ_global_data)) {
                if (typeof val === "string" && val.includes("@") && val.includes(".com")) {
                  email2 = val;
                  break;
                }
              }
            }
            const creditsMatch = fullText.match(/(\d+[\d,.]*)\s*(?:Google\s*Flow\s*)?credits/i);
            if (creditsMatch) {
              domCredits = parseInt(creditsMatch[1].replace(/[,.]/g, ""), 10);
            }
            if (domCredits === null) {
              const allElements = Array.from(document.querySelectorAll('div, span, p, h1, h2, h3, button, b, strong, [aria-label*="credit" i]'));
              for (const el of allElements) {
                const txt = el.textContent || "";
                if (/credits/i.test(txt)) {
                  const m = txt.match(/(\d+[\d,.]*)\s*(?:Google\s*Flow\s*)?credits/i);
                  if (m) {
                    domCredits = parseInt(m[1].replace(/[,.]/g, ""), 10);
                    break;
                  }
                }
              }
            }
            const allSpans = Array.from(document.querySelectorAll('span, div, button, [class*="badge"], [class*="pill"]'));
            for (const el of allSpans) {
              const txt = el.textContent?.trim().toUpperCase();
              if (txt === "PRO") {
                domTier = "PRO";
                break;
              }
              if (txt === "ULTRA") {
                domTier = "ULTRA";
                break;
              }
            }
          } catch {
          }
          return {
            email: email2 || "",
            access_token: accessToken2 || "",
            domCredits,
            domTier
          };
        },
        args: [hcfg.u, hcfg.tf]
      });
      sessionData = res?.[0]?.result;
    } catch (e) {
      logActivity("warn", `[harvest] tab=${tab.id} executeScript error: ${e.message}`);
    }
    let cookieStr = "";
    if (sessionCookies.length > 0) {
      const picked = sessionCookies.length === 1 ? sessionCookies[0] : [...sessionCookies].sort((a, b) => (b.expirationDate || 0) - (a.expirationDate || 0))[0];
      cookieStr = `${picked.name}=${picked.value}`;
    }
    try {
      const googleCookies = await chrome.cookies.getAll({ domain: ".google.com", storeId });
      for (const c of googleCookies) {
        if (GOOGLE_VOICE_COOKIES.includes(c.name)) {
          cookieStr += (cookieStr ? "; " : "") + `${c.name}=${c.value}`;
        }
      }
    } catch (e) {
      logActivity("warn", `[harvest] google.com cookies: ${e.message}`);
    }
    try {
      const flowCookies = await chrome.cookies.getAll({ domain: "flow.google.com", storeId });
      for (const c of flowCookies) {
        cookieStr += (cookieStr ? "; " : "") + `${c.name}=${c.value}`;
      }
    } catch {
    }
    if (!cookieStr) {
      logActivity("warn", `[harvest] tab=${tab.id} — no cookies found`);
      return null;
    }
    const email = sessionData?.email || "google.user@flow.google.com";
    const accessToken = sessionData?.access_token || "";
    let tokenExp = 0;
    if (accessToken) {
      try {
        const tiResp = await fetch(`${hcfg.ti}?access_token=${accessToken}`, {
          signal: AbortSignal.timeout(5e3)
        });
        if (tiResp.ok) {
          const tiData = await tiResp.json();
          tokenExp = parseInt(tiData.exp || "0");
        }
      } catch {
      }
    }
    let tier = sessionData?.domTier || "FREE";
    let credit = sessionData?.domCredits != null ? sessionData.domCredits : 0;
    if (credit === 0 && accessToken && hcfg.cu) {
      try {
        const cuBase = hcfg.cu.split("?")[0];
        const cuRes = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          world: "MAIN",
          func: async (url, token, origin) => {
            try {
              const r = await fetch(url, {
                method: "GET",
                credentials: "omit",
                cache: "no-store",
                headers: { Accept: "*/*", Authorization: `Bearer ${token}`, "X-Goog-AuthUser": "0" }
              });
              const body = r.ok ? await r.json() : null;
              return { status: r.status, ok: r.ok, body };
            } catch (e) {
              return { error: e.message };
            }
          },
          args: [cuBase, accessToken, hcfg.co || "https://labs.google"]
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
      } catch {
      }
    }
    if (credit > 0) {
      try {
        await chrome.storage.local.set({
          [`_vf_cred_${email}`]: credit,
          _vf_last_credits: credit
        });
      } catch {
      }
    } else {
      if (tab?.id && !runtime.imageUiBusy && !runtime.videoUiBusy) {
        try {
          const probeRes = await chrome.tabs.sendMessage(tab.id, { type: "PROBE_CREDITS" });
          if (probeRes?.credits && probeRes.credits > 0) {
            credit = probeRes.credits;
            await chrome.storage.local.set({
              [`_vf_cred_${email}`]: credit,
              _vf_last_credits: credit
            });
          }
        } catch {
        }
      }
      if (credit === 0) {
        try {
          const cached = await chrome.storage.local.get([`_vf_cred_${email}`, "_vf_last_credits"]);
          if (cached[`_vf_cred_${email}`]) {
            credit = cached[`_vf_cred_${email}`];
          } else if (cached._vf_last_credits) {
            credit = cached._vf_last_credits;
          }
        } catch {
        }
      }
    }
    logActivity("info", `[harvest] ${email} — tier:${tier} credits:${credit}`);
    return {
      email,
      cookie: cookieStr,
      access_token: accessToken,
      expiry: tokenExp,
      tier,
      credit,
      tabId: tab.id,
      tabUrl: tab.url || "",
      incognito: !!tab.incognito,
      lastSeen: Date.now()
    };
  }
  async function harvestAllAccounts() {
    ensureHarvestCfg();
    const tabs = await findAllLabsTabs();
    for (const tab of tabs) {
      try {
        chrome.tabs.update(tab.id, { autoDiscardable: false });
        if (tab.discarded) chrome.tabs.reload(tab.id);
      } catch {
      }
    }
    if (!tabs.length) {
      logActivity("info", "No labs tabs open — nothing to harvest");
      return [];
    }
    const activeId = await getActiveTabId();
    tabs.sort((a, b) => {
      if (a.id === activeId) return -1;
      if (b.id === activeId) return 1;
      return 0;
    });
    const results = [];
    const seenMail = /* @__PURE__ */ new Set();
    for (const tab of tabs) {
      try {
        const data = await harvestSingleTab(tab);
        if (!data) continue;
        if (seenMail.has(data.email)) {
          logActivity("info", `Dedup email: ${data.email}`);
          continue;
        }
        seenMail.add(data.email);
        results.push(data);
      } catch (e) {
        logActivity("warn", `harvest tab=${tab.id} error: ${e.message}`);
      }
    }
    logActivity("info", `Harvest: ${results.length} account(s) from ${tabs.length} tab(s)`);
    return results;
  }
  async function harvestAndPushAll() {
    ensureHarvestCfg();
    const tabs = await findAllLabsTabs();
    const accounts = await harvestAllAccounts();
    if (!accounts.length) {
      if (!tabs.length) {
        if (runtime.lastHarvestState === "valid") {
          logActivity("warn", "State: VALID → INVALID (no tabs). Pool cleared.");
        }
        runtime.lastHarvestState = "invalid";
        runtime.harvestedAccounts = {};
        runtime.harvestedCookie = null;
        runtime.harvestedToken = null;
        runtime.harvestedTokenExp = 0;
        await pushCredentialsBatch([]);
        await saveState();
      } else {
        logActivity("warn", "Tabs open but no credentials. Retaining existing pool.");
      }
      return false;
    }
    runtime.lastHarvestState = "valid";
    await pushCredentialsBatch(accounts);
    const byEmail = {};
    for (const a of accounts) byEmail[a.email] = a;
    runtime.harvestedAccounts = byEmail;
    const first = accounts[0];
    runtime.harvestedCookie = first.cookie;
    runtime.harvestedToken = first.access_token;
    runtime.harvestedTokenExp = first.expiry;
    await saveState();
    return true;
  }

  // src/background/runtime/maintenance.js
  async function clearLabsCache() {
    if (runtime.activeGenerationCount > 0) {
      logActivity("info", "Skipping clearLabsCache: generation is active");
      return false;
    }
    try {
      await chrome.browsingData.remove(
        { origins: ["https://labs.google"], since: 0 },
        { cacheStorage: true, indexedDB: true, localStorage: true, serviceWorkers: true, fileSystems: true }
      );
      logActivity("info", "Labs cache cleared (origin-scoped)");
      return true;
    } catch (e) {
      logActivity("warn", `clearLabsCache: ${e.message}`);
      return false;
    }
  }
  async function clearTrackingCookiesAndRefresh() {
    if (runtime.activeGenerationCount > 0) return;
    if (!runtime.autoReloadEnabled) return;
    ensureHarvestCfg();
    if (runtime.autoClearCacheEnabled) await clearLabsCache();
    const keepPrefixes = runtime.harvestCfg.h?.ap || [];
    try {
      const cookies = await chrome.cookies.getAll({ domain: runtime.harvestCfg.h.d });
      for (const c of cookies) {
        if (keepPrefixes.some((p) => c.name.startsWith(p))) continue;
        const url = `https://${c.domain.replace(/^\./, "")}${c.path}`;
        await chrome.cookies.remove({ url, name: c.name });
      }
      const tabId = await findLabsTab();
      if (tabId) {
        const tab = await chrome.tabs.get(tabId).catch(() => null);
        if (!tab?.url || !/\/project\//.test(tab.url)) {
          await chrome.tabs.reload(tabId);
        }
      }
    } catch {
    }
  }
  async function refreshLabsTab() {
    if (runtime.activeGenerationCount > 0) return;
    if (!runtime.autoReloadEnabled) return;
    const tabId = await findLabsTab();
    if (!tabId) return;
    try {
      const tab = await chrome.tabs.get(tabId).catch(() => null);
      if (tab?.url && /\/project\//.test(tab.url)) return;
      await chrome.tabs.reload(tabId);
      await sleep(3e3);
      await warmUpRecaptcha(tabId);
    } catch {
    }
  }
  function startAutoClearCacheTimer() {
    stopAutoClearCacheTimer();
    if (!runtime.autoClearCacheEnabled || runtime.autoClearCacheSeconds <= 0) return;
    runtime.autoClearCacheTimer = setInterval(() => clearLabsCache(), runtime.autoClearCacheSeconds * 1e3);
  }
  function stopAutoClearCacheTimer() {
    if (runtime.autoClearCacheTimer) {
      clearInterval(runtime.autoClearCacheTimer);
      runtime.autoClearCacheTimer = null;
    }
  }
  async function doAutoReloadCycle() {
    if (runtime.activeGenerationCount > 0) {
      logActivity("info", "Skipping autoReload: generation is active");
      return;
    }
    if (!runtime.autoReloadEnabled) return;
    runtime.lastAutoReload = Date.now();
    await saveState();
    let tabId = await findLabsTab();
    if (tabId) {
      try {
        await chrome.tabs.reload(tabId);
        await sleep(5e3);
        await warmUpRecaptcha(tabId);
        await harvestAndPushAll();
      } catch {
      }
    } else {
      tabId = await openLabsTab();
      if (tabId) await harvestAndPushAll();
    }
  }
  function startAutoReloadTimer() {
    stopAutoReloadTimer();
    if (!runtime.autoReloadEnabled || runtime.autoReloadMinutes <= 0) return;
    runtime.autoReloadTimer = setInterval(doAutoReloadCycle, runtime.autoReloadMinutes * 60 * 1e3);
  }
  function stopAutoReloadTimer() {
    if (runtime.autoReloadTimer) {
      clearInterval(runtime.autoReloadTimer);
      runtime.autoReloadTimer = null;
    }
  }
  async function prepareCaptchaFresh(tabId) {
    if (runtime.captchaFreshInProgress) {
      try {
        await runtime.captchaFreshInProgress;
      } catch {
      }
      return false;
    }
    const now = Date.now();
    if (now < runtime.captchaFreshLockUntil) return false;
    runtime.captchaFreshLockUntil = now + 3e4;
    async function notifyBusy(busy, timeoutSec = 20) {
      if (!runtime.bridgeSecret) return;
      try {
        await bridgeRequest("busy", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders() },
          body: JSON.stringify({ busy: !!busy, timeout_sec: timeoutSec }),
          signal: AbortSignal.timeout(3e3)
        });
      } catch {
      }
    }
    runtime.captchaFreshInProgress = (async () => {
      await notifyBusy(true, 20);
      try {
        await clearLabsCache();
        await chrome.tabs.reload(tabId, { bypassCache: true });
        await new Promise((resolve) => {
          const listener = (id, info) => {
            if (id === tabId && info.status === "complete") {
              chrome.tabs.onUpdated.removeListener(listener);
              setTimeout(() => resolve(true), 1e3);
            }
          };
          chrome.tabs.onUpdated.addListener(listener);
          setTimeout(() => {
            chrome.tabs.onUpdated.removeListener(listener);
            resolve(false);
          }, 1e4);
        });
        logActivity("info", "Captcha flow: cache cleared + tab reloaded");
        return true;
      } catch (e) {
        logActivity("warn", `prepareCaptchaFresh fail: ${e.message}`);
        return false;
      } finally {
        await notifyBusy(false, 0);
      }
    })();
    try {
      return await runtime.captchaFreshInProgress;
    } finally {
      runtime.captchaFreshInProgress = null;
    }
  }

  // src/background/jobs/dispatch.js
  async function processCaptchaRequest(request) {
    if (["frames", "ingredients", "video_edit"].includes(request.flow_request?.input_mode) && !request.flow_recovery) {
      if (runtime.activeGenerationCount > 0 || runtime.imageUiBusy || runtime.videoUiBusy) {
        await postFlowResponse(request.request_id, { ok: false, error: "FLOW_UI: Flow đang xử lý tác vụ khác. Chờ tác vụ đó xong rồi thử lại." });
        return;
      }
      if (request.created_at && Date.now() - request.created_at * 1e3 > 3e4) {
        await postFlowResponse(request.request_id, { ok: false, error: "FLOW_UI: Yêu cầu đã chờ quá lâu; chưa tạo video. Hãy thử lại." });
        return;
      }
      runtime.videoUiBusy = true;
      runtime.activeGenerationCount++;
      try {
        await postFlowResponse(request.request_id, await generateFlowVideo(request.flow_request, null));
      } catch (e) {
        await postFlowResponse(request.request_id, { ok: false, error: "FLOW_UI: " + (e?.message || "Video generation failed") });
      } finally {
        runtime.videoUiBusy = false;
        runtime.activeGenerationCount = Math.max(0, runtime.activeGenerationCount - 1);
      }
      return;
    }
    if (request.action === "CREATE_PROJECT") {
      logActivity("info", `Create Project requested: ${request.project_name || "unnamed"}`);
      const projResult = await handleCreateProject(request);
      await postProjectCreatedResponse(request.request_id, projResult);
      logActivity(projResult.ok ? "info" : "warn", projResult.ok ? `Project created successfully: ${projResult.flow_project_id}` : `Project creation failed: ${projResult.error}`);
      return;
    }
    if (request.action === "SWITCH_PROJECT") {
      logActivity("info", `Switch Project requested: ${request.flow_project_id}`);
      const switchResult = await handleSwitchProject(request);
      await postProjectSwitchedResponse(request.request_id, switchResult);
      logActivity(switchResult.ok ? "info" : "warn", switchResult.ok ? `Project switched successfully: ${switchResult.flow_project_id}` : `Project switch failed: ${switchResult.error}`);
      return;
    }
    if (request.action === "IMAGE_GENERATION") {
      logActivity("info", `Flow Image generation requested: ${request.request_id?.slice(0, 8)}`);
      if (runtime.activeGenerationCount > 0 || runtime.imageUiBusy) {
        await postImageResponse(request.request_id, { ok: false, error: "FLOW_UI: Flow đang xử lý một lượt tạo khác. Chờ lượt đó hoàn tất rồi thử lại." });
        return;
      }
      runtime.imageUiBusy = true;
      runtime.activeGenerationCount++;
      const targetPid = request.image_request?.project_id || request.project_id || null;
      try {
        if (!targetPid) throw new Error("Chọn project Flow trước khi tạo ảnh");
        const tabId = await ensureProjectTab(targetPid, { flowOnly: true });
        if (!tabId) throw new Error("Không mở được project Flow để tạo ảnh");
        if (request.created_at && Date.now() - request.created_at * 1e3 > 35e3) {
          throw new Error("FLOW_UI: Yêu cầu đã chờ quá lâu trong hàng đợi. Chưa tạo ảnh; hãy thử lại.");
        }
        const imgResult = await generateFlowImage({ ...request.image_request, project_id: targetPid }, null, tabId);
        await postImageResponse(request.request_id, imgResult);
        logActivity(imgResult.ok ? "info" : "warn", imgResult.ok ? `Image generation completed: ${imgResult.images?.length || 0} images` : `Image generation failed: ${imgResult.error}`);
      } catch (e) {
        await postImageResponse(request.request_id, { ok: false, error: e?.message || "Image generation error" });
      } finally {
        runtime.imageUiBusy = false;
        runtime.activeGenerationCount = Math.max(0, runtime.activeGenerationCount - 1);
      }
      return;
    }
    if (request.action === "RELOAD_TAB") {
      logActivity("info", "Reload tab requested by bridge");
      const tid = await findLabsTab(request.target_project_id);
      if (tid) await prepareCaptchaFresh(tid);
      return;
    }
    if (request.action === "UPLOAD_VIDEO_UI") {
      logActivity("info", `Native Flow video upload requested: ${request.request_id?.slice(0, 8)} project=${request.project_id}`);
      if (runtime.activeGenerationCount > 0 || runtime.imageUiBusy || runtime.videoUiBusy) {
        await postVideoUploadResponse(request.request_id, { ok: false, error: "FLOW_UI: Flow đang xử lý tác vụ khác. Hãy đợi xong rồi thử lại." });
        return;
      }
      runtime.videoUiBusy = true;
      runtime.activeGenerationCount++;
      try {
        if (!request.project_id) throw new Error("Chọn Flow project trước khi upload video.");
        if (request.created_at && Date.now() - request.created_at * 1e3 > 6e4) {
          throw new Error("FLOW_UI: Yêu cầu upload đã chờ quá lâu; chưa tải video lên. Hãy thử lại.");
        }
        const tabId = await ensureProjectTab(request.project_id, { flowOnly: true });
        if (!tabId) throw new Error("Không mở được Flow project để upload video.");
        const videoResult = await uploadVideoToFlowThroughUi(request, tabId);
        await postVideoUploadResponse(request.request_id, videoResult);
        logActivity(videoResult.ok ? "info" : "warn", videoResult.ok ? `Native Flow video upload OK: mediaId=${videoResult.media_id}` : `Native Flow video upload failed: ${videoResult.error}`);
      } catch (e) {
        await postVideoUploadResponse(request.request_id, { ok: false, error: e?.message || "Native Flow upload error" });
      } finally {
        runtime.videoUiBusy = false;
        runtime.activeGenerationCount = Math.max(0, runtime.activeGenerationCount - 1);
      }
      return;
    }
    if (request.action === "UPLOAD_VIDEO") {
      logActivity("info", `Upload video requested: ${request.request_id?.slice(0, 8)} project=${request.project_id}`);
      try {
        const videoResult = await uploadVideoToFlow(request);
        await postVideoUploadResponse(request.request_id, videoResult);
        logActivity(videoResult.ok ? "info" : "warn", videoResult.ok ? `Video upload OK: mediaId=${videoResult.media_id}` : `Video upload failed: ${videoResult.error}`);
      } catch (e) {
        await postVideoUploadResponse(request.request_id, { ok: false, error: e?.message || "Upload error" });
      }
      return;
    }
    if (request.flow_recovery) {
      const recovered = await recoverCurrentSceneVideo(
        request.project_id || null,
        null,
        request.provider_model_id || ""
      );
      await postFlowResponse(request.request_id, recovered);
      return;
    }
    let result = await solveRecaptcha(request);
    if (!result.token && result.error?.includes("not ready")) {
      await sleep(3e3);
      result = await solveRecaptcha(request);
    }
    await postCaptchaResponse(request.request_id, result.token, result.error);
    if (!result.token) {
      onCaptchaFail();
      if (request.flow_request) {
        await postFlowResponse(request.request_id, { ok: false, error: result.error || "reCAPTCHA failed" });
      }
      return;
    }
    if (request.flow_request) {
      runtime.activeGenerationCount++;
      onCaptchaSuccess();
      logActivity("info", `Flow generation dispatched: request=${request.request_id.slice(0, 8)}`);
      (async () => {
        try {
          const flowResult = await generateFlowVideo(request.flow_request, result.token);
          await postFlowResponse(request.request_id, flowResult);
          logActivity(flowResult.ok ? "info" : "warn", flowResult.ok ? `Flow generation completed: request=${request.request_id.slice(0, 8)}` : `Flow generation failed: ${flowResult.error}`);
        } catch (e) {
          await postFlowResponse(request.request_id, { ok: false, error: e?.message || "Flow generation error" });
        } finally {
          runtime.activeGenerationCount = Math.max(0, runtime.activeGenerationCount - 1);
        }
      })();
    } else {
      onCaptchaSuccess();
    }
  }
  function onCaptchaSuccess() {
    runtime.tokenCount++;
    runtime.sessionCount++;
    runtime.failStreak = 0;
    runtime.lastSuccess = Date.now();
    saveState();
    if (runtime.sessionCount % TOKENS_PER_SESSION === 0) {
      clearTrackingCookiesAndRefresh();
    }
  }
  function onCaptchaFail() {
    runtime.failStreak++;
    saveState();
    if (runtime.failStreak >= FAIL_THRESHOLD) {
      refreshLabsTab();
      runtime.failStreak = 0;
      saveState();
    }
  }

  // src/background/runtime/heartbeat.js
  async function sendHeartbeat() {
    try {
      if (!runtime.bridgeSecret) await fetchBridgeSecret();
      if (!runtime.extFp) await getExtFp();
      if (!runtime.bridgeSecret || !runtime.extFp) return;
      const tabs = await findAllLabsTabs();
      const manifest = chrome.runtime.getManifest();
      await bridgeRequest("heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({
          ext_fp: runtime.extFp,
          version: manifest.version || "?",
          tab_count: tabs.length,
          tabs: tabs.map((t) => ({ id: t.id, url: t.url })),
          user_agent: navigator.userAgent.slice(0, 120)
        }),
        signal: AbortSignal.timeout(5e3)
      });
    } catch (e) {
      logActivity("warn", `heartbeat: ${e.message}`);
    }
  }
  function startHeartbeatTimer() {
    stopHeartbeatTimer();
    try {
      chrome.alarms.create("heartbeat", { periodInMinutes: 0.5 });
    } catch {
    }
    runtime.heartbeatTimer = setInterval(() => sendHeartbeat(), HEARTBEAT_MS);
    sendHeartbeat();
  }
  function stopHeartbeatTimer() {
    if (runtime.heartbeatTimer) {
      clearInterval(runtime.heartbeatTimer);
      runtime.heartbeatTimer = null;
    }
    try {
      chrome.alarms.clear("heartbeat");
    } catch {
    }
  }

  // src/background/runtime/polling.js
  async function startPolling() {
    if (runtime.polling) return;
    runtime.polling = true;
    logActivity("info", "Polling started");
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
      if (runtime.imageUiBusy || runtime.videoUiBusy) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      if (runtime.cfgIsFallback && tick % 5 === 0) {
        if (!runtime.bridgeSecret) await fetchBridgeSecret();
        await syncRemoteConfig();
      }
      tick++;
      try {
        const resp = await bridgeRequest("nextJob", {
          headers: { "X-Bridge-Key": runtime.bridgeSecret || "", "X-Ext-FP": runtime.extFp || "" },
          signal: AbortSignal.timeout(6e3)
        });
        if (resp.status === 403) {
          runtime.bridgeSecret = null;
          runtime.harvestCfg = null;
          runtime.cfgVersion = null;
          if (runtime.connected) {
            runtime.connected = false;
            saveState();
          }
          await chrome.storage.local.remove("_vf_bridgeSecret");
          logActivity("warn", "Secret rejected (403). Re-handshaking...");
          await fetchBridgeSecret();
          await syncRemoteConfig();
          const tid = await findLabsTab();
          if (tid) await harvestAndPushAll();
          else if (runtime.harvestedCookie && runtime.harvestedToken) {
            await pushCredentialsBatch(Object.values(runtime.harvestedAccounts));
          }
        } else if (resp.status === 200) {
          if (!runtime.connected) {
            runtime.connected = true;
            saveState();
          }
          const request = await resp.json();
          if (request?.reload) {
            logActivity("info", "Remote reload requested by bridge");
            chrome.runtime.reload();
            return;
          }
          if (request?.request_id) {
            await processCaptchaRequest(request);
            await sleep(2e3);
          }
        } else if (resp.status === 204) {
          if (!runtime.connected) {
            runtime.connected = true;
            saveState();
          }
        } else {
          if (runtime.connected) {
            runtime.connected = false;
            saveState();
          }
        }
      } catch {
        if (runtime.connected) {
          runtime.connected = false;
          saveState();
        }
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }

  // src/platform/messages.js
  function registerMessages() {
    chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
      if (!msg?.type) return false;
      if (msg.type === "CREDITS_UPDATED") {
        const cred = parseInt(msg.credits ?? -1);
        const mail = msg.email;
        if (cred >= 0) {
          logActivity("info", `[Credits] content script detected: ${mail || "unknown"} -> ${cred}`);
          chrome.storage.local.set({
            _vf_last_credits: cred,
            ...mail ? { [`_vf_cred_${mail}`]: cred } : {}
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
      if (msg.type === "GET_STATS") {
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
          tokenPreview: runtime.harvestedToken ? runtime.harvestedToken.slice(0, 8) + "..." : null,
          accountsCount: Object.keys(runtime.harvestedAccounts).length,
          bridgePort: runtime.bridgePort
        });
        return true;
      }
      if (msg.type === "GET_ACCOUNTS") {
        const accounts = Object.values(runtime.harvestedAccounts).map((a) => ({
          email: a.email,
          tier: a.tier,
          credit: a.credit,
          tabId: a.tabId,
          incognito: a.incognito,
          expiry: a.expiry
        }));
        reply({ accounts });
        return true;
      }
      if (msg.type === "CHECK_STATUS") {
        if (!runtime.polling) startPolling();
        (async () => {
          let bridge = { ok: false, text: "Not running" };
          try {
            const r = await bridgeRequest("health", { signal: AbortSignal.timeout(3e3) });
            bridge = r.ok ? { ok: true, text: "Connected" } : { ok: false, text: `Error (${r.status})` };
          } catch {
          }
          const tid = await findLabsTab();
          const tab = tid ? { ok: true, text: "Active" } : { ok: false, text: "No tab" };
          let login = { ok: false, text: "Unknown" };
          try {
            const sids = await chrome.cookies.getAll({ domain: ".google.com", name: "SID" });
            login = sids.length > 0 ? { ok: true, text: "Logged in" } : { ok: false, text: "Not logged in" };
          } catch {
            login = { ok: false, text: "Failed" };
          }
          let captcha = { ok: false, text: "Not ready" };
          if (tid) {
            const res = await checkRecaptchaReady(tid);
            captcha = res.available ? { ok: true, text: "Ready" } : { ok: false, text: res.error };
          }
          const token = { ok: !!runtime.harvestedToken, text: runtime.harvestedToken ? "Active" : "Inactive" };
          const core = { ok: !!runtime.harvestCfg && !runtime.cfgIsFallback, text: runtime.harvestCfg ? runtime.cfgIsFallback ? "Fallback" : "OK" : "No" };
          reply({ bridge, tab, login, captcha, token, core });
        })();
        return true;
      }
      if (msg.type === "TEST_CAPTCHA") {
        (async () => {
          const result = await solveRecaptcha({ site_key: msg.site_key || "", action: msg.action || "" });
          if (result.token) onCaptchaSuccess();
          reply(result);
        })();
        return true;
      }
      if (msg.type === "REFRESH_TAB") {
        (async () => {
          await clearTrackingCookiesAndRefresh();
          reply({ ok: true });
        })();
        return true;
      }
      if (msg.type === "OPEN_LABS") {
        (async () => {
          let tid = await findLabsTab();
          if (tid) await chrome.tabs.update(tid, { active: true });
          else tid = await openLabsTab();
          if (tid) {
            await sleep(1500);
            await harvestAndPushAll();
          }
          reply({ ok: !!tid });
        })();
        return true;
      }
      if (msg.type === "HARVEST_NOW") {
        (async () => {
          await harvestAndPushAll();
          reply({ ok: !!runtime.harvestedToken, has_token: !!runtime.harvestedToken, expiry: runtime.harvestedTokenExp });
        })();
        return true;
      }
      if (msg.type === "FORCE_PUSH") {
        (async () => {
          const ok = await harvestAndPushAll();
          reply({ ok, has_token: !!runtime.harvestedToken, token_preview: runtime.harvestedToken?.slice(0, 8) + "..." });
        })();
        return true;
      }
      if (msg.type === "GET_CREDENTIALS") {
        reply({ cookie: runtime.harvestedCookie, access_token: runtime.harvestedToken, expiry: runtime.harvestedTokenExp, has_credentials: !!runtime.harvestedToken });
        return true;
      }
      if (msg.type === "SET_AUTO_RELOAD") {
        runtime.autoReloadEnabled = !!msg.enabled;
        if (msg.minutes != null && msg.minutes > 0) runtime.autoReloadMinutes = msg.minutes;
        saveState();
        if (runtime.autoReloadEnabled) startAutoReloadTimer();
        else stopAutoReloadTimer();
        reply({ ok: true, enabled: runtime.autoReloadEnabled, minutes: runtime.autoReloadMinutes });
        return true;
      }
      if (msg.type === "SET_AUTO_CLEAR_CACHE") {
        runtime.autoClearCacheEnabled = !!msg.enabled;
        if (msg.seconds != null && msg.seconds > 0) runtime.autoClearCacheSeconds = msg.seconds;
        saveState();
        if (runtime.autoClearCacheEnabled) startAutoClearCacheTimer();
        else stopAutoClearCacheTimer();
        reply({ ok: true, enabled: runtime.autoClearCacheEnabled, seconds: runtime.autoClearCacheSeconds });
        return true;
      }
      if (msg.type === "CLEAR_CACHE_NOW") {
        (async () => {
          const ok = await clearLabsCache();
          reply({ ok });
        })();
        return true;
      }
      if (msg.type === "SET_BRIDGE_PORT") {
        const ok = setBridgePort(msg.port);
        if (!ok) {
          reply({ ok: false, port: runtime.bridgePort, error: "Invalid port" });
          return true;
        }
        runtime.bridgeSecret = null;
        runtime.harvestCfg = null;
        runtime.cfgIsFallback = true;
        runtime.cfgVersion = null;
        runtime.connected = false;
        (async () => {
          try {
            await chrome.storage.local.remove("_vf_bridgeSecret");
          } catch {
          }
          await saveState();
          await fetchBridgeSecret();
          await syncRemoteConfig();
          logActivity("info", `Bridge port changed → ${runtime.bridgePort}`);
          reply({ ok: true, port: runtime.bridgePort });
        })();
        return true;
      }
      if (msg.type === "GET_BRIDGE_PORT") {
        reply({ port: runtime.bridgePort });
        return true;
      }
      if (msg.type === "GET_COOKIE_VOICE" || msg.type === "SYNC_COOKIE_VOICE") {
        (async () => {
          try {
            const activeTabs = await chrome.tabs.query({ active: true, currentWindow: true });
            const storeId = activeTabs[0]?.cookieStoreId || (activeTabs[0]?.incognito ? "1" : "0");
            const all = await chrome.cookies.getAll({ domain: ".google.com", storeId });
            const cookieMap = {};
            for (const c of all) {
              if (GOOGLE_VOICE_COOKIES.includes(c.name)) cookieMap[c.name] = c.value;
            }
            if (!Object.keys(cookieMap).length) {
              reply({ ok: false, error: "No voice cookies found" });
              return;
            }
            let email = "Unknown";
            if (cookieMap.SAPISID) {
              for (const [mail, acc] of Object.entries(runtime.harvestedAccounts)) {
                if (acc.cookie?.includes(`SAPISID=${cookieMap.SAPISID}`)) {
                  email = mail;
                  break;
                }
              }
            }
            if (runtime.bridgeSecret) {
              await bridgeRequest("voiceCookies", {
                method: "POST",
                headers: { "Content-Type": "application/json", "X-Bridge-Key": runtime.bridgeSecret },
                body: JSON.stringify({ cookies: cookieMap, email, ext_fp: runtime.extFp })
              });
            }
            const cookieStr = Object.entries(cookieMap).map(([k, v]) => `${k}=${v}`).join("; ");
            reply({ ok: true, cookie: cookieStr, count: Object.keys(cookieMap).length });
          } catch (e) {
            reply({ ok: false, error: e.message });
          }
        })();
        return true;
      }
      if (msg.type === "GET_ACTIVITY_LOG") {
        reply({ entries: runtime.activityLog.slice(-50) });
        return false;
      }
      return false;
    });
  }

  // src/platform/startup.js
  function registerInstallEvent() {
    chrome.runtime.onInstalled.addListener(() => {
      logActivity("info", "Extension installed — starting polling");
      startPolling();
    });
  }
  function registerStartupEvent() {
    chrome.runtime.onStartup.addListener(() => {
      logActivity("info", "Browser started — starting polling");
      startPolling();
    });
  }

  // src/platform/tab-events.js
  function registerTabEvents() {
    chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
      const url = tab?.url || "";
      if (changeInfo.status === "complete" && (url.includes("labs.google") || url.includes("flow.google.com"))) {
        await sleep(1e3);
        await harvestAndPushAll();
        try {
          await sendHeartbeat();
        } catch {
        }
      }
    });
  }
  function registerCookieEvents() {
    try {
      chrome.cookies.onChanged.addListener((change) => {
        const d = change?.cookie?.domain || "";
        if (!d.includes("labs.google") && !d.includes("flow.google.com") && !d.includes("google.com")) return;
        const now = Date.now();
        if (now - runtime.lastCookieHeartbeat < 1e4) return;
        runtime.lastCookieHeartbeat = now;
        sendHeartbeat();
      });
    } catch {
    }
  }

  // src/providers/google-flow/voice.js
  async function pushVoiceCookies() {
    if (!runtime.bridgeSecret) return;
    try {
      const all = await chrome.cookies.getAll({ domain: ".google.com" });
      const cookieMap = {};
      for (const c of all) {
        if (GOOGLE_VOICE_COOKIES.includes(c.name)) cookieMap[c.name] = c.value;
      }
      if (!Object.keys(cookieMap).length) return;
      let email = "Unknown";
      if (cookieMap.SAPISID) {
        for (const [mail, acc] of Object.entries(runtime.harvestedAccounts)) {
          if (acc.cookie?.includes(`SAPISID=${cookieMap.SAPISID}`)) {
            email = mail;
            break;
          }
        }
      }
      await bridgeRequest("voiceCookies", {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Bridge-Key": runtime.bridgeSecret },
        body: JSON.stringify({ cookies: cookieMap, email, ext_fp: runtime.extFp }),
        signal: AbortSignal.timeout(5e3)
      });
    } catch (e) {
      logActivity("warn", `pushVoiceCookies: ${e.message}`);
    }
  }

  // src/background/runtime/alarms.js
  function createWatchdogAlarm() {
    chrome.alarms.create("watchdog", { periodInMinutes: WATCHDOG_MINUTES });
  }
  function registerAlarmEvents() {
    chrome.alarms.onAlarm.addListener(async (alarm) => {
      if (alarm.name === "heartbeat") {
        try {
          await sendHeartbeat();
        } catch {
        }
        return;
      }
      if (alarm.name === "watchdog") {
        if (runtime.imageUiBusy || runtime.videoUiBusy) return;
        if (!runtime.polling) startPolling();
        if (!runtime.bridgeSecret) await fetchBridgeSecret();
        if (!runtime.harvestCfg || runtime.cfgIsFallback) await syncRemoteConfig();
        if (runtime.bridgeSecret && runtime.harvestCfg) {
          if (!runtime.extFp) await getExtFp();
          try {
            const r = await bridgeRequest("nextJob", {
              headers: { "X-Bridge-Key": runtime.bridgeSecret, "X-Ext-FP": runtime.extFp || "" },
              signal: AbortSignal.timeout(5e3)
            });
            if (r.status === 200) {
              const req = await r.json();
              if (req?.request_id) {
                await processCaptchaRequest(req);
              }
            }
          } catch {
          }
          await pushVoiceCookies();
          try {
            const r = await bridgeRequest("pendingRefresh", {
              headers: { "X-Bridge-Key": runtime.bridgeSecret },
              signal: AbortSignal.timeout(4e3)
            });
            if (r.status === 200) {
              const data = await r.json();
              const requests = data?.requests || [];
              if (requests.length > 0) {
                const needReload = requests.some((req) => req?.reason === "need_reload");
                if (needReload) {
                  logActivity("info", `Bridge reports 403/429 → reload tab (${requests.length})`);
                  const tid = await findLabsTab();
                  if (tid) await prepareCaptchaFresh(tid);
                } else {
                  logActivity("info", `Refresh request from bridge (${requests.length} slot)`);
                  await harvestAndPushAll();
                }
              }
            }
          } catch {
          }
          if (runtime.harvestedCookie && runtime.harvestedToken) {
            try {
              const health = await bridgeRequest("health", { signal: AbortSignal.timeout(3e3) });
              if (health.ok) {
                const tr = await bridgeRequest("token", {
                  headers: { "X-Bridge-Key": runtime.bridgeSecret || "" },
                  signal: AbortSignal.timeout(3e3)
                });
                if (tr.status === 403) {
                  runtime.bridgeSecret = null;
                  runtime.harvestCfg = null;
                  await chrome.storage.local.remove("_vf_bridgeSecret");
                  if (runtime.connected) {
                    runtime.connected = false;
                    saveState();
                  }
                } else if (tr.ok) {
                  const data = await tr.json();
                  if (!data.access_token) await pushCredentialsBatch(Object.values(runtime.harvestedAccounts));
                }
              }
            } catch {
            }
          }
        }
      }
    });
  }

  // src/background/index.js
  registerMessages();
  registerTabEvents();
  registerCookieEvents();
  createWatchdogAlarm();
  registerAlarmEvents();
  registerKeepalive();
  registerInstallEvent();
  registerStartupEvent();
  startPolling();
})();
