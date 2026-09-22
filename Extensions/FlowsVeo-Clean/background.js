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
    heartbeatTimer: null,
    activityLog: [],
    captchaFreshLockUntil: 0,
    captchaFreshInProgress: null,
    lastCookieHeartbeat: 0
  };

  // src/background/runtime/log.js
  function logActivity2(level, msg) {
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
      logActivity2("info", "Keep-alive port connected");
      port.onMessage.addListener(() => {
      });
      port.onDisconnect.addListener(() => logActivity2("info", "Keep-alive port disconnected"));
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
        logActivity2("info", `Pushed ${payload.credentials.length} credential(s)`);
        return true;
      }
      logActivity2("warn", `Push batch failed: HTTP ${resp.status}`);
    } catch (e) {
      logActivity2("warn", `pushCredentialsBatch: ${e.message}`);
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
      logActivity2("warn", `postCaptchaResponse: ${e.message}`);
    }
  }
  async function postImageResponse(requestId, result) {
    try {
      await bridgeRequest("imageResult", {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify({
          request_id: requestId,
          result: result?.ok ? result : null,
          error: result?.ok ? null : result?.error || "Unknown Image error",
          logs: runtime.activityLog.slice(-10)
        }),
        signal: AbortSignal.timeout(1e4)
      });
    } catch (error) {
      logActivity2("warn", `postImageResponse: ${error.message}`);
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
      logActivity2("warn", `postVideoUploadResponse: ${err.message}`);
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
      logActivity2("warn", `postFlowResponse: ${error.message}`);
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
      logActivity2("warn", `postProjectCreatedResponse: ${err.message}`);
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
      logActivity2("warn", `postProjectSwitchedResponse: ${err.message}`);
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
      logActivity2("info", `State restored — tokens:${runtime.tokenCount} connected:${runtime.connected}`);
    } catch (e) {
      logActivity2("warn", `restoreState error: ${e.message}`);
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
          logActivity2("info", `Bridge secret synced on port ${p}: ${runtime.bridgeSecret.slice(0, 8)}...`);
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
        logActivity2("info", `Remote config loaded v${runtime.cfgVersion}`);
        return true;
      }
      throw new Error("Invalid config response: missing payload");
    } catch (e) {
      logActivity2("warn", `syncRemoteConfig: ${e.message}`);
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
  async function ensureProjectTab(targetProjectId) {
    if (!targetProjectId) return null;
    ensureHarvestCfg();
    const tabs = await findAllLabsTabs();
    const isMatchProject = (t) => {
      try {
        const u = new URL(t.url);
        return (u.hostname === "flow.google.com" || u.hostname === "labs.google") && u.pathname.includes(`/project/${targetProjectId}`);
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
    const destinationUrl = `${targetOrigin}/project/${targetProjectId}`;
    const isChosenTabInDifferentProject = chosenTab && chosenTab.url && /\/project\/[a-zA-Z0-9_-]+/.test(chosenTab.url);
    if (chosenTab && !isChosenTabInDifferentProject) {
      try {
        logActivity2("info", `Navigating existing idle Flow tab ${chosenTab.id} to project ${targetProjectId}`);
        await chrome.tabs.update(chosenTab.id, { url: destinationUrl, active: true });
        if (chosenTab.windowId) {
          await chrome.windows.update(chosenTab.windowId, { focused: true }).catch(() => {
          });
        }
        await waitForTabComplete(chosenTab.id, 15e3);
        await sleep(1500);
        await warmUpRecaptcha(chosenTab.id, 8e3);
        return chosenTab.id;
      } catch (e) {
        logActivity2("warn", `Failed to navigate tab ${chosenTab.id}: ${e.message}`);
      }
    }
    try {
      logActivity2("info", `Opening new Flow tab for project ${targetProjectId}`);
      const newTab = await chrome.tabs.create({ url: destinationUrl, active: true });
      if (newTab.windowId) {
        await chrome.windows.update(newTab.windowId, { focused: true }).catch(() => {
        });
      }
      await waitForTabComplete(newTab.id, 2e4);
      await sleep(2e3);
      await warmUpRecaptcha(newTab.id, 8e3);
      return newTab.id;
    } catch (e) {
      logActivity2("warn", `Failed to open project tab: ${e.message}`);
      return null;
    }
  }
  async function openLabsTab() {
    ensureHarvestCfg();
    try {
      logActivity2("info", "No labs tab open — auto-opening...");
      const tab = await chrome.tabs.create({ url: runtime.harvestCfg.t.o, active: false });
      await waitForTabComplete(tab.id, 15e3);
      await sleep(1500);
      await warmUpRecaptcha(tab.id);
      return tab.id;
    } catch (e) {
      logActivity2("warn", `openLabsTab failed: ${e.message}`);
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
  async function solveRecaptcha(request) {
    ensureHarvestCfg();
    if (!runtime.harvestCfg.c) return { token: null, error: "Captcha config not loaded" };
    const targetPid = request?.target_project_id || request?.image_request?.project_id || request?.flow_request?.project_id || request?.project_id || null;
    let tabId = await findLabsTab(targetPid);
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
    const siteKey = request.site_key || request.recaptcha_ent_key || page.siteKey || "";
    logActivity2("info", `Captcha preflight: tab=${tabId} module=${!!page.moduleReady} keySource=${page.keySource || "none"}`);
    if (!page.moduleReady) return { token: null, error: page.error };
    let action = "";
    if (request.captcha_action && typeof request.captcha_action === "string") {
      action = request.captcha_action.trim();
    } else if (request.action && typeof request.action === "string") {
      action = request.action.trim();
    } else if (runtime.harvestCfg.c?.da) {
      action = String(runtime.harvestCfg.c.da).trim();
    }
    logActivity2("info", `solveRecaptcha: tab=${tabId} siteKey=${siteKey ? siteKey.slice(0, 10) + "..." : "none"} action=${action ? `"${action}"` : "none"}`);
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
        logActivity2("info", `solveRecaptcha success: tokenLen=${res.token.length} prefix=${res.token.slice(0, 20)}...`);
      } else if (res?.error) {
        logActivity2("warn", `solveRecaptcha error: ${res.error}`);
      }
      if (res) return res;
      return { token: null, error: "No script result" };
    } catch (e) {
      return { token: null, error: e.message };
    }
  }

  // src/providers/google-flow/page/image.js
  async function runImageGenerationInPage(imageRequest, captchaToken) {
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
          rpcError = `[DEBUG_UNUSUAL_ACTIVITY] ${rpcError}`;
        }
        const preview = text.length > 250 ? text.slice(0, 250) + "..." : text;
        throw new Error(rpcError || `Flow RPC ${rpcId} returned no usable payload. Response: ${preview}`);
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
      if (typeof captchaToken !== "string" || !captchaToken) {
        throw new Error("reCAPTCHA token is empty");
      }
      const aspectMap = {
        "16:9": 3,
        "1:1": 2,
        "9:16": 1,
        "4:3": 4,
        "3:4": 5
      };
      const aspectEnum = aspectMap[imageRequest.aspect_ratio] || 3;
      const modelKey = resolveImageModel(imageRequest.model_key);
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
        projectId = imageRequest.project_id || null;
      }
      if (!projectId) {
        throw new Error("Không tìm thấy Project ID trên tab Google Flow");
      }
      const sourcePath = `${accountPath}/project/${projectId}`;
      const wiz = window.WIZ_global_data || {};
      const csrfToken = wiz.SNlM0e;
      const sessionId = wiz.FdrFJe;
      const buildLabel = wiz.cfb2h;
      if (!csrfToken || !sessionId || !buildLabel) {
        throw new Error("Flow page session config is incomplete; reload the project");
      }
      async function callRpc(rpcId, payload) {
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
        const endpoint = `${base}${accountPath}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`;
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
          if (!response.ok) throw new Error(`RPC ${rpcId} HTTP ${response.status}`);
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
                xhr.onerror = () => reject(new Error("XHR network error"));
                xhr.ontimeout = () => reject(new Error("XHR timeout"));
                xhr.timeout = 45e3;
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
      let refImagesPayload = null;
      if (Array.isArray(imageRequest.reference_image_ids) && imageRequest.reference_image_ids.length > 0) {
        refImagesPayload = imageRequest.reference_image_ids.map((id) => [id, null, null, null, 1]);
      }
      const sceneUuid = (imageRequest.scene_uuid || (crypto.randomUUID ? crypto.randomUUID() : "1B6623B2-B5E4-4899-AA64-0122F1A067F9")).toUpperCase();
      const seed = imageRequest.seed || Math.floor(Math.random() * 2e9);
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
        [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
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
        [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
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
        prompt: imageRequest.prompt
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  }

  // src/providers/google-flow/page/recovery.js
  async function recoverCurrentSceneInPage(providerModelId = "") {
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
      if (/\.(?:jpg|jpeg|png|webp|gif|avif)(?:$|[?#])/.test(pathname)) return false;
      if (/(?:preview|thumbnail|poster|sprite)/.test(pathname)) return false;
      return pathname.includes("/video") || pathname.includes("/media") || pathname.includes("/download") || /(?:\.mp4$|signature=|expires=|expire=|token=)/i.test(value) || pathname.split("/").filter(Boolean).length >= 2;
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
      const activeMediaId = activeGen?.mediaId || null;
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
          const sourcePath = `${accountPath}/project/${projectId}`;
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
          const endpoint = `${base}${accountPath}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`;
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
      if (activeMediaId) {
        try {
          const finalAsset = await callRpcInPage("as29s", [activeMediaId]);
          const asUrl = finalAsset?.[7]?.[0]?.[8] || finalAsset?.[5]?.[2]?.[0]?.[8] || findVideoUrl(finalAsset);
          if (asUrl) {
            try {
              (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null;
            } catch {
            }
            return {
              ok: true,
              video_url: asUrl,
              image_url: finalAsset?.[5]?.[10] || finalAsset?.[5]?.[0]?.[10] || null,
              media_id: activeMediaId,
              provider_model_id: activeModelId,
              project_id: projectId
            };
          }
        } catch {
        }
        try {
          const pollResp = await callRpcInPage("jwpduf", [null, null, [[activeMediaId]]]);
          const pollUrl = findVideoUrl(pollResp);
          if (pollUrl) {
            try {
              (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null;
            } catch {
            }
            return {
              ok: true,
              video_url: pollUrl,
              media_id: activeMediaId,
              provider_model_id: activeModelId,
              project_id: projectId
            };
          }
          const asset = findMediaAsset(pollResp);
          const status = asset?.[5]?.[8]?.[0] ?? asset?.[5]?.[0]?.[8]?.[0];
          if (status === 3) {
            const finalAsset = await callRpcInPage("as29s", [activeMediaId]);
            const asUrl = finalAsset?.[7]?.[0]?.[8] || finalAsset?.[5]?.[2]?.[0]?.[8] || findVideoUrl(finalAsset);
            if (asUrl) {
              try {
                (typeof window !== "undefined" ? window : globalThis).__FLOW_ACTIVE_GENERATION__ = null;
              } catch {
              }
              return {
                ok: true,
                video_url: asUrl,
                image_url: finalAsset?.[5]?.[10] || finalAsset?.[5]?.[0]?.[10] || null,
                media_id: activeMediaId,
                provider_model_id: activeModelId,
                project_id: projectId
              };
            }
          }
          if (status !== 1 && status !== 2 && status !== 3 && status !== void 0 && status !== null) {
            return {
              ok: false,
              terminal_error: true,
              error: `Flow render ended with status ${status} (media_id=${activeMediaId})`
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
      if (activeMediaId) {
        uniqueCandidates.sort((a, b) => {
          const aMatch = a.includes(activeMediaId) ? -1 : 0;
          const bMatch = b.includes(activeMediaId) ? -1 : 0;
          return aMatch - bMatch;
        });
      }
      for (const candidate of uniqueCandidates) {
        if (!isVideoCandidate(candidate)) continue;
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
              media_id: activeMediaId || null,
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
        document.querySelector('[role="progressbar"], [aria-label*="generating" i], [aria-label*="creating" i], .generating, [data-is-generating="true"]') || activeMediaId
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

  // src/providers/google-flow/page/video.js
  async function runFlowGenerationInPage(flowRequest, captchaToken) {
    const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
    try {
      let resolveModelId = function(req) {
        const isFrames2 = req.input_mode === "frames";
        const isIngredients2 = req.input_mode === "ingredients";
        const isVideoEdit2 = req.input_mode === "video_edit";
        if (req.provider_model_id && (!isFrames2 || !req.provider_model_id.includes("_t2v_")) && (!isIngredients2 || !req.provider_model_id.includes("_t2v_"))) {
          return req.provider_model_id;
        }
        const modelName = (req.model_display_name || "").toLowerCase();
        const isPortrait = req.aspect_ratio === "9:16";
        if (isVideoEdit2) {
          return req.resolution === "360p" ? "abra_edit_360p" : "abra_edit";
        }
        if (isIngredients2) {
          return `abra_r2v_${dur}s`;
        }
        if (isFrames2) {
          return req.image_base64 && req.end_image_base64 ? "omni_flash_i2v_10s_first_last" : `abra_r2v_${dur}s`;
        }
        if (modelName.includes("omni") || modelName.includes("flash")) {
          return `abra_t2v_${dur}s`;
        }
        if (modelName.includes("quality")) {
          return isPortrait ? "veo_3_1_t2v_quality_portrait" : "veo_3_1_t2v_quality";
        }
        if (modelName.includes("fast")) {
          return isPortrait ? "veo_3_1_t2v_fast_portrait" : "veo_3_1_t2v_fast";
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
        for (const line of text.split(/\r?\n/)) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("[")) continue;
          try {
            const parsed = JSON.parse(trimmed);
            const payload = findRpcEnvelope(parsed, rpcId2);
            if (payload !== null) return JSON.parse(payload);
          } catch {
          }
        }
        const preview = typeof text === "string" ? text.replace(/\s+/g, " ").slice(0, 300) : "";
        throw new Error(`Flow RPC ${rpcId2} returned no usable payload. Response: ${preview}`);
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
            if (lower.includes("/video") || lower.includes("/media") || lower.includes("/download") || lower.includes(".mp4") || lower.includes("signature=") || lower.includes("expires=") || lower.includes("expire=") || lower.includes("token=") || lower.includes("download=")) {
              return node;
            }
            try {
              const u = new URL(node);
              if (u.pathname.split("/").filter(Boolean).length >= 2) return node;
            } catch {
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
        const endpoint = `${base}${accountPath}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`;
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
            captchaToken ? [captchaToken, 1] : null
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
          let resp = null;
          try {
            resp = await callRpc("maseQ", maseQPayload);
          } catch (rpcErr) {
            if (headerProto[10]) {
              headerProto[10] = null;
              resp = await callRpc("maseQ", maseQPayload);
            } else {
              throw rpcErr;
            }
          }
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
      let startFrameMediaId = null;
      let endFrameMediaId = null;
      const ingredientMediaIds = Array.isArray(flowRequest?.ingredient_media_ids) ? flowRequest.ingredient_media_ids.filter((id) => typeof id === "string" && id.trim()).map((id) => id.trim()) : [];
      const referenceVideoMediaId = typeof flowRequest?.reference_video_id === "string" ? flowRequest.reference_video_id.trim() : "";
      let isFrames = flowRequest?.input_mode === "frames";
      let isIngredients = flowRequest?.input_mode === "ingredients";
      const isVideoEdit = flowRequest?.input_mode === "video_edit";
      if (isVideoEdit && !referenceVideoMediaId) {
        throw new Error("Video edit mode requires an uploaded reference_video_id");
      }
      if (isFrames) {
        if (flowRequest.image_base64) {
          startFrameMediaId = await uploadImageToFlow(
            flowRequest.image_base64,
            flowRequest.image_mime,
            flowRequest.image_name || "start_frame.png"
          );
        }
        if (flowRequest.end_image_base64) {
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
          logActivity("warn", "Không có khung hình trong request frames, tự động tạo video từ prompt (text_to_video)");
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
          logActivity("warn", "Không có ảnh tham chiếu trong request ingredients, tự động tạo video từ prompt (text_to_video)");
          isIngredients = false;
          modelId = modelId.replace("_r2v_", "_t2v_");
        }
      }
      const isSingleFrame = isFrames && Boolean(startFrameMediaId) && !endFrameMediaId;
      const rpcId = isVideoEdit ? "jIps6" : isIngredients || isSingleFrame ? "MZZa6b" : isFrames ? "nprQif" : "YhhmEf";
      const requestUuidA = (crypto.randomUUID ? crypto.randomUUID() : "AD722819-13F6-46E3-A074-9CA0266A4FE0").toUpperCase();
      const requestUuidB = (crypto.randomUUID ? crypto.randomUUID() : "4C8832DC-AD37-4C11-859E-DCFD4FB4903E").toUpperCase();
      const sceneUuid = (crypto.randomUUID ? crypto.randomUUID() : "154922EC-9CE9-4413-A9C0-B2664F7FFB7B").toUpperCase();
      const aspectEnum = flowRequest?.aspect_ratio === "16:9" ? 2 : 1;
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
          aspectEnum,
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
        const refSlots = isSingleFrame ? [[null, startFrameMediaId]] : ingredientMediaIds.map((id) => [null, id]);
        const activeModelId = isSingleFrame ? modelId.includes("_r2v_") ? modelId : `abra_r2v_${dur}s` : modelId;
        createPayload = [
          [[
            [null, null, [[[flowRequest.prompt.trim()]]]],
            refSlots,
            activeModelId,
            aspectEnum,
            null,
            [null, null, null, null, requestUuidA, requestUuidB]
          ]],
          [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
          [sceneUuid, 2]
        ];
      } else if (isFrames) {
        const cropCoords = aspectEnum === 1 ? [null, 0.341796875, 1, 0.658203125] : [null, 0, 1, 1];
        startSlot = startFrameMediaId ? [null, startFrameMediaId, null, null, null, cropCoords] : null;
        endSlot = endFrameMediaId ? [null, endFrameMediaId, null, null, null, cropCoords] : null;
        createPayload = [
          [[
            [null, null, [[[flowRequest.prompt.trim()]]]],
            modelId,
            aspectEnum,
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
            aspectEnum,
            null,
            [null, null, null, null, requestUuidA, requestUuidB]
          ]],
          [null, 22, null, null, null, projectId, null, null, null, null, [captchaToken, 1]],
          [sceneUuid, 2]
        ];
      }
      let created = null;
      try {
        created = findMediaAsset(await callRpc(rpcId, createPayload));
      } catch (rpcErr) {
        if (isSingleFrame) {
          const fallbackDurations = [10, 6, 4].filter((d) => `abra_r2v_${d}s` !== createPayload[0][0][2]);
          let lastErr = rpcErr;
          for (const fbDur of fallbackDurations) {
            try {
              console.log("[FlowPage] Thử lại MZZa6b cho 1 frame với duration:", fbDur);
              createPayload[0][0][2] = `abra_r2v_${fbDur}s`;
              const fbResp = await callRpc(rpcId, createPayload);
              created = findMediaAsset(fbResp);
              if (created) {
                console.log("[FlowPage] Fallback MZZa6b thành công với duration:", fbDur);
                modelId = `abra_r2v_${fbDur}s`;
                break;
              }
            } catch (fbErr) {
              lastErr = fbErr;
            }
          }
          if (!created) throw lastErr;
        } else if (isFrames) {
          const fallbackCandidates = [
            { model: "omni_flash_i2v_10s_first_last", end: endSlot, omitEnd: false },
            { model: "omni_flash_i2v_10s_first_last", end: null, omitEnd: true },
            { model: "omni_flash_i2v_10s_first", end: null, omitEnd: false },
            { model: "omni_flash_i2v_6s_first_last", end: endSlot, omitEnd: false },
            { model: "omni_flash_i2v_6s_first", end: null, omitEnd: false }
          ];
          let lastErr = rpcErr;
          for (const cand of fallbackCandidates) {
            if (cand.model === modelId && !cand.omitEnd) continue;
            try {
              console.log("[FlowPage] Thử lại nprQif với candidate:", cand);
              if (cand.omitEnd) {
                createPayload[0][0] = [
                  createPayload[0][0][0],
                  cand.model,
                  aspectEnum,
                  null,
                  startSlot,
                  [null, null, null, null, requestUuidA, requestUuidB]
                ];
              } else {
                createPayload[0][0] = [
                  createPayload[0][0][0],
                  cand.model,
                  aspectEnum,
                  null,
                  startSlot,
                  cand.end,
                  [null, null, null, null, requestUuidA, requestUuidB]
                ];
              }
              const fallbackResp = await callRpc(rpcId, createPayload);
              created = findMediaAsset(fallbackResp);
              if (created) {
                console.log("[FlowPage] Fallback nprQif thành công với model:", cand.model);
                modelId = cand.model;
                break;
              }
            } catch (fbErr) {
              lastErr = fbErr;
            }
          }
          if (!created) {
            throw lastErr;
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
          if (status !== 2 && status !== 1 && status !== 3 && status !== void 0 && status !== null) {
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
    if (flowRequest?.project_id) {
      try {
        await ensureProjectTab(flowRequest.project_id);
      } catch (e) {
        logActivity2("warn", `ensureProjectTab pre-flight error: ${e.message}`);
      }
    }
    const tabId = await findLabsTab(flowRequest?.project_id);
    if (!tabId) return { ok: false, error: "Open a Flow project in Chrome" };
    const recoverLostResult = async (originalError) => {
      logActivity2("info", `Lost direct result (${originalError}). Starting patient scene recovery...`);
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
          logActivity2("info", `Scene recovery succeeded on attempt ${attempt}`);
          return {
            ...recovered,
            recovered_after_lost_result: true
          };
        }
        if (recovered?.terminal_error) {
          logActivity2("warn", `Scene recovery terminal error: ${recovered.error}`);
          return { ok: false, error: `${originalError}; scene recovery rejected: ${recovered.error}` };
        }
        lastError = recovered?.error || "no video found";
        if (attempt % 5 === 0) {
          logActivity2("info", `Scene recovery attempt ${attempt} (${Math.max(0, Math.round((recoveryDeadline - Date.now()) / 1e3))}s remaining)...`);
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
  async function generateFlowImage(imageRequest, captchaToken) {
    const tabId = await findLabsTab(imageRequest?.project_id);
    if (!tabId) return { ok: false, error: "Open a Flow project in Chrome" };
    try {
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: runImageGenerationInPage,
        args: [imageRequest, captchaToken]
      });
      if (injected?.[0]?.result) {
        return injected[0].result;
      }
      await sleep(2e3);
      const retryInjected = await chrome.scripting.executeScript({
        target: { tabId },
        world: "MAIN",
        func: runImageGenerationInPage,
        args: [imageRequest, captchaToken]
      });
      if (retryInjected?.[0]?.result) {
        return retryInjected[0].result;
      }
      return { ok: false, error: "Flow page returned no image result (trang bị tải lại hoặc mất ngữ cảnh)" };
    } catch (error) {
      return { ok: false, error: `Cannot execute Flow Image adapter: ${error.message}` };
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
    ensureHarvestCfg();
    if (!tab?.id) return null;
    const hcfg = runtime.harvestCfg.h;
    logActivity2("info", `[harvest] tab=${tab.id} url=${tab.url || ""} incognito=${tab.incognito}`);
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
      logActivity2("warn", `[harvest] cookie error: ${e.message}`);
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
      logActivity2("warn", `[harvest] tab=${tab.id} executeScript error: ${e.message}`);
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
      logActivity2("warn", `[harvest] google.com cookies: ${e.message}`);
    }
    try {
      const flowCookies = await chrome.cookies.getAll({ domain: "flow.google.com", storeId });
      for (const c of flowCookies) {
        cookieStr += (cookieStr ? "; " : "") + `${c.name}=${c.value}`;
      }
    } catch {
    }
    if (!cookieStr) {
      logActivity2("warn", `[harvest] tab=${tab.id} — no cookies found`);
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
      if (tab?.id) {
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
    logActivity2("info", `[harvest] ${email} — tier:${tier} credits:${credit}`);
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
      logActivity2("info", "No labs tabs open — nothing to harvest");
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
          logActivity2("info", `Dedup email: ${data.email}`);
          continue;
        }
        seenMail.add(data.email);
        results.push(data);
      } catch (e) {
        logActivity2("warn", `harvest tab=${tab.id} error: ${e.message}`);
      }
    }
    logActivity2("info", `Harvest: ${results.length} account(s) from ${tabs.length} tab(s)`);
    return results;
  }
  async function harvestAndPushAll() {
    ensureHarvestCfg();
    const tabs = await findAllLabsTabs();
    const accounts = await harvestAllAccounts();
    if (!accounts.length) {
      if (!tabs.length) {
        if (runtime.lastHarvestState === "valid") {
          logActivity2("warn", "State: VALID → INVALID (no tabs). Pool cleared.");
        }
        runtime.lastHarvestState = "invalid";
        runtime.harvestedAccounts = {};
        runtime.harvestedCookie = null;
        runtime.harvestedToken = null;
        runtime.harvestedTokenExp = 0;
        await pushCredentialsBatch([]);
        await saveState();
      } else {
        logActivity2("warn", "Tabs open but no credentials. Retaining existing pool.");
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
      logActivity2("info", "Skipping clearLabsCache: generation is active");
      return false;
    }
    try {
      await chrome.browsingData.remove(
        { origins: ["https://labs.google"], since: 0 },
        { cacheStorage: true, indexedDB: true, localStorage: true, serviceWorkers: true, fileSystems: true }
      );
      logActivity2("info", "Labs cache cleared (origin-scoped)");
      return true;
    } catch (e) {
      logActivity2("warn", `clearLabsCache: ${e.message}`);
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
      if (tabId) await chrome.tabs.reload(tabId);
    } catch {
    }
  }
  async function refreshLabsTab() {
    if (runtime.activeGenerationCount > 0) return;
    if (!runtime.autoReloadEnabled) return;
    const tabId = await findLabsTab();
    if (!tabId) return;
    try {
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
      logActivity2("info", "Skipping autoReload: generation is active");
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
        logActivity2("info", "Captcha flow: cache cleared + tab reloaded");
        return true;
      } catch (e) {
        logActivity2("warn", `prepareCaptchaFresh fail: ${e.message}`);
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
    if (request.action === "CREATE_PROJECT") {
      logActivity2("info", `Create Project requested: ${request.project_name || "unnamed"}`);
      const projResult = await handleCreateProject(request);
      await postProjectCreatedResponse(request.request_id, projResult);
      logActivity2(projResult.ok ? "info" : "warn", projResult.ok ? `Project created successfully: ${projResult.flow_project_id}` : `Project creation failed: ${projResult.error}`);
      return;
    }
    if (request.action === "SWITCH_PROJECT") {
      logActivity2("info", `Switch Project requested: ${request.flow_project_id}`);
      const switchResult = await handleSwitchProject(request);
      await postProjectSwitchedResponse(request.request_id, switchResult);
      logActivity2(switchResult.ok ? "info" : "warn", switchResult.ok ? `Project switched successfully: ${switchResult.flow_project_id}` : `Project switch failed: ${switchResult.error}`);
      return;
    }
    if (request.action === "IMAGE_GENERATION") {
      logActivity2("info", `Flow Image generation requested: ${request.request_id?.slice(0, 8)}`);
      runtime.activeGenerationCount++;
      const targetPid = request.image_request?.project_id || request.project_id || null;
      if (targetPid) {
        try {
          await ensureProjectTab(targetPid);
        } catch (e) {
          logActivity2("warn", `ensureProjectTab pre-flight error: ${e.message}`);
        }
      }
      try {
        let result2 = await solveRecaptcha({ ...request, target_project_id: targetPid, captcha_action: "IMAGE_GENERATION" });
        if (!result2.token && result2.error?.includes("not ready")) {
          await sleep(3e3);
          result2 = await solveRecaptcha({ ...request, target_project_id: targetPid, captcha_action: "IMAGE_GENERATION" });
        }
        if (!result2.token) {
          onCaptchaFail();
          await postImageResponse(request.request_id, { ok: false, error: result2.error || "reCAPTCHA failed" });
          return;
        }
        onCaptchaSuccess();
        const imgResult = await generateFlowImage(request.image_request, result2.token);
        await postImageResponse(request.request_id, imgResult);
        logActivity2(imgResult.ok ? "info" : "warn", imgResult.ok ? `Image generation completed: ${imgResult.images?.length || 0} images` : `Image generation failed: ${imgResult.error}`);
      } catch (e) {
        await postImageResponse(request.request_id, { ok: false, error: e?.message || "Image generation error" });
      } finally {
        runtime.activeGenerationCount = Math.max(0, runtime.activeGenerationCount - 1);
      }
      return;
    }
    if (request.action === "RELOAD_TAB") {
      logActivity2("info", "Reload tab requested by bridge");
      const tid = await findLabsTab(request.target_project_id);
      if (tid) await prepareCaptchaFresh(tid);
      return;
    }
    if (request.action === "UPLOAD_VIDEO") {
      logActivity2("info", `Upload video requested: ${request.request_id?.slice(0, 8)} project=${request.project_id}`);
      try {
        const videoResult = await uploadVideoToFlow(request);
        await postVideoUploadResponse(request.request_id, videoResult);
        logActivity2(videoResult.ok ? "info" : "warn", videoResult.ok ? `Video upload OK: mediaId=${videoResult.media_id}` : `Video upload failed: ${videoResult.error}`);
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
    onCaptchaSuccess();
    if (request.flow_request) {
      logActivity2("info", `Flow generation dispatched: request=${request.request_id.slice(0, 8)}`);
      (async () => {
        runtime.activeGenerationCount++;
        try {
          const flowResult = await generateFlowVideo(request.flow_request, result.token);
          await postFlowResponse(request.request_id, flowResult);
          logActivity2(flowResult.ok ? "info" : "warn", flowResult.ok ? `Flow generation completed: request=${request.request_id.slice(0, 8)}` : `Flow generation failed: ${flowResult.error}`);
        } catch (e) {
          await postFlowResponse(request.request_id, { ok: false, error: e?.message || "Flow generation error" });
        } finally {
          runtime.activeGenerationCount = Math.max(0, runtime.activeGenerationCount - 1);
        }
      })();
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
      logActivity2("warn", `heartbeat: ${e.message}`);
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
    logActivity2("info", "Polling started");
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
          logActivity2("warn", "Secret rejected (403). Re-handshaking...");
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
            logActivity2("info", "Remote reload requested by bridge");
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
          logActivity2("info", `[Credits] content script detected: ${mail || "unknown"} -> ${cred}`);
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
          logActivity2("info", `Bridge port changed → ${runtime.bridgePort}`);
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
      logActivity2("info", "Extension installed — starting polling");
      startPolling();
    });
  }
  function registerStartupEvent() {
    chrome.runtime.onStartup.addListener(() => {
      logActivity2("info", "Browser started — starting polling");
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
      logActivity2("warn", `pushVoiceCookies: ${e.message}`);
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
                  logActivity2("info", `Bridge reports 403/429 → reload tab (${requests.length})`);
                  const tid = await findLabsTab();
                  if (tid) await prepareCaptchaFresh(tid);
                } else {
                  logActivity2("info", `Refresh request from bridge (${requests.length} slot)`);
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
