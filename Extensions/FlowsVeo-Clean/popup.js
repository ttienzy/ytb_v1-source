/**
 * popup.js — FlowsVeo Clean Popup Logic
 *
 * Giao tiếp với background.js qua chrome.runtime.sendMessage.
 * Code sạch, có chú thích đầy đủ, chuyển giao 100% flow gốc.
 */

'use strict';

// ─── Element helpers ──────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const tokenCountEl           = $('tokenCount');
const sessionCountEl         = $('sessionCount');
const lastTimeEl             = $('lastTime');
const accountsListEl         = $('accountsList');
const toggleAutoReload       = $('toggleAutoReload');
const toggleAutoClearCache   = $('toggleAutoClearCache');
const reloadTimeInput        = $('reloadTime');
const clearCacheSecondsInput = $('clearCacheSeconds');
const bridgePortInput        = $('bridgePort');
const logSection             = $('logSection');
const logContainer           = $('logContainer');
const logToggle              = $('logToggle');
const btnClearLog            = $('btnClearLog');
const btnRefresh             = $('btnRefresh');
const btnOpen                = $('btnOpen');
const btnReloadNow           = $('btnReloadNow');
const btnClearCacheNow       = $('btnClearCacheNow');
const btnSetPort             = $('btnSetPort');
const btnCheck               = $('btnCheck');
const btnPush                = $('btnPush');
const btnTest                = $('btnTest');
const btnTestCaptcha         = $('btnTestCaptcha');
const btnCookieVoice         = $('btnCookieVoice');
const extVersionDisplay      = $('extVersionDisplay');

// System status dots & values
const dotBridge  = $('dotBridge');
const valBridge  = $('valBridge');
const dotTab     = $('dotTab');
const valTab     = $('valTab');
const dotLogin   = $('dotLogin');
const valLogin   = $('valLogin');
const dotCaptcha = $('dotCaptcha');
const valCaptcha = $('valCaptcha');
const dotToken   = $('dotToken');
const valToken   = $('valToken');

// ─── Utilities ────────────────────────────────────────────────────────────────

function formatTimeAgo(ts) {
  if (!ts) return '-';
  const sec = Math.floor((Date.now() - ts) / 1_000);
  if (sec < 60)   return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function send(payload, cb) {
  try {
    chrome.runtime.sendMessage(payload, (resp) => {
      if (chrome.runtime.lastError) {
        if (cb) cb(null, chrome.runtime.lastError);
        return;
      }
      if (cb) cb(resp, null);
    });
  } catch (err) {
    if (cb) cb(null, err);
  }
}

function setStatus(dotEl, valEl, statusClass, text) {
  if (dotEl) dotEl.className = `dot ${statusClass || ''}`.trim();
  if (valEl) valEl.textContent = text || '-';
}

// ─── Activity Log ─────────────────────────────────────────────────────────────

const localLog = [];
let logVisible = false;

logToggle.addEventListener('click', () => {
  logVisible = !logVisible;
  logSection.style.display = logVisible ? 'block' : 'none';
  logToggle.innerHTML      = logVisible ? '&#9662; Activity Log' : '&#9656; Activity Log';
  if (logVisible) renderLog();
});

btnClearLog.addEventListener('click', () => {
  localLog.length = 0;
  renderLog();
});

function addLogEntry(level, msg) {
  const now = new Date();
  const timeStr = now.toLocaleTimeString('en-GB', { hour12: false });
  localLog.push({ time: timeStr, level, msg: String(msg).slice(0, 500) });
  if (localLog.length > 50) localLog.shift();
  if (logVisible) renderLog();
}

function renderLog() {
  if (!localLog.length) {
    logContainer.innerHTML = '<div class="log-empty">No activity yet</div>';
    return;
  }
  logContainer.innerHTML = [...localLog].reverse().map((entry) =>
    `<div class="log-entry ${entry.level}">
      <span class="time">${escapeHtml(entry.time)}</span>
      <span class="msg">${escapeHtml(entry.msg)}</span>
    </div>`
  ).join('');
}

function loadRemoteLogs() {
  send({ type: 'GET_ACTIVITY_LOG' }, (resp) => {
    if (!resp?.entries) return;
    for (const e of resp.entries) {
      if (!localLog.find((l) => l.time === e.time && l.msg === e.msg)) {
        localLog.push(e);
      }
    }
    localLog.sort((a, b) => a.time.localeCompare(b.time));
    if (localLog.length > 50) localLog.splice(0, localLog.length - 50);
    if (logVisible) renderLog();
  });
}

// ─── Status Check ─────────────────────────────────────────────────────────────

async function checkAll() {
  if (btnCheck) {
    btnCheck.disabled = true;
    btnCheck.innerHTML = '<span class="spinner"></span>';
  }
  setStatus(dotBridge,  valBridge,  '', 'Checking...');
  setStatus(dotTab,     valTab,     '', 'Checking...');
  setStatus(dotLogin,   valLogin,   '', 'Checking...');
  setStatus(dotCaptcha, valCaptcha, '', 'Checking...');
  setStatus(dotToken,   valToken,   '', 'Checking...');

  return new Promise((resolve) => {
    send({ type: 'CHECK_STATUS' }, (res) => {
      if (res) {
        // Bridge
        setStatus(dotBridge, valBridge, res.bridge?.ok ? 'ok' : 'err', res.bridge?.text);
        if (!res.bridge?.ok) addLogEntry('error', `Bridge: ${res.bridge?.text}`);

        // Tab
        setStatus(dotTab, valTab, res.tab?.ok ? 'ok' : 'err', res.tab?.text);
        if (!res.tab?.ok) addLogEntry('warn', `Labs tab: ${res.tab?.text}`);

        // Login
        setStatus(dotLogin, valLogin, res.login?.ok ? 'ok' : 'warn', res.login?.text);

        // Captcha
        setStatus(dotCaptcha, valCaptcha, res.captcha?.ok ? 'ok' : 'warn', res.captcha?.text);

        // Token
        if (res.token) {
          setStatus(dotToken, valToken, res.token.ok ? 'ok' : 'warn', res.token.text);
          if (res.token.ok) addLogEntry('success', `Token active: ${res.token.text}`);
        }
      } else {
        setStatus(dotBridge, valBridge, 'err', 'Offline');
      }

      if (btnCheck) {
        btnCheck.disabled = false;
        btnCheck.textContent = 'Check';
      }
      resolve();
    });
  });
}

// ─── Stats & Accounts ─────────────────────────────────────────────────────────

function loadStats() {
  send({ type: 'GET_STATS' }, (resp) => {
    if (!resp) {
      tokenCountEl.textContent   = '?';
      sessionCountEl.textContent = '?';
      lastTimeEl.textContent     = '-';
      return;
    }
    tokenCountEl.textContent   = resp.tokenCount   ?? '0';
    sessionCountEl.textContent = resp.sessionCount ?? '0';
    lastTimeEl.textContent     = formatTimeAgo(resp.lastSuccess);

    toggleAutoReload.checked     = resp.autoReloadEnabled    !== false;
    toggleAutoClearCache.checked = resp.autoClearCacheEnabled !== false;

    if (resp.autoReloadMinutes > 0)     reloadTimeInput.value   = resp.autoReloadMinutes;
    if (resp.autoClearCacheSeconds > 0) clearCacheSecondsInput.value = resp.autoClearCacheSeconds;
    if (resp.bridgePort && bridgePortInput && document.activeElement !== bridgePortInput) {
      bridgePortInput.value = resp.bridgePort;
    }
  });
  loadAccounts();
  loadRemoteLogs();
}

function loadAccounts() {
  send({ type: 'GET_ACCOUNTS' }, (resp) => {
    if (!resp?.accounts?.length) {
      accountsListEl.innerHTML = '<div class="acc-empty">No account harvested yet</div>';
      return;
    }
    accountsListEl.innerHTML = resp.accounts.map((a, i) => {
      const tier   = escapeHtml(String(a.tier || 'FREE').toUpperCase());
      const credit = (a.credit != null && a.credit !== 0) ? Number(a.credit).toLocaleString('vi-VN') : '0';
      const incog  = a.incognito ? ' &#128374;' : '';
      const tab    = a.tabId ? `${escapeHtml(String(a.tabId))}${incog}` : '';
      return `<div class="acc-row">
        <div class="acc-email">[${i}] ${escapeHtml(a.email)}</div>
        <div class="acc-meta">
          <span class="acc-tier ${tier}">${tier}</span>
          <span class="acc-credit">${credit}cr</span>
          <span class="acc-tab">${tab}</span>
        </div>
      </div>`;
    }).join('');
  });
}

function refreshAccountsOnOpen() {
  addLogEntry('info', 'Updating Veo accounts...');
  send({ type: 'HARVEST_NOW' }, (resp) => {
    if (resp?.ok) {
      loadAccounts();
      loadStats();
      addLogEntry('success', 'Veo accounts updated');
    }
  });
}

// ─── Actions ──────────────────────────────────────────────────────────────────

function refreshTab() {
  btnRefresh.disabled = true;
  addLogEntry('info', 'Refreshing Labs tab...');
  send({ type: 'REFRESH_TAB' }, () => {
    setTimeout(() => {
      btnRefresh.disabled = false;
      checkAll();
    }, 5_000);
  });
}

function openLabs() {
  addLogEntry('info', 'Opening labs.google...');
  send({ type: 'OPEN_LABS' }, (resp) => {
    if (resp?.ok) addLogEntry('success', 'Labs tab opened');
    setTimeout(checkAll, 3_000);
  });
}

function reloadNow() {
  btnReloadNow.disabled  = true;
  btnReloadNow.innerHTML = '<span class="spinner"></span>';
  addLogEntry('info', 'Manual reload cycle...');

  send({ type: 'REFRESH_TAB' }, () => {
    setTimeout(() => {
      send({ type: 'FORCE_PUSH' }, (resp) => {
        if (resp?.ok) {
          addLogEntry('success', 'Reload done — credentials pushed');
        } else {
          addLogEntry('warn', 'Reload done but push failed');
        }
        btnReloadNow.disabled = false;
        btnReloadNow.textContent = 'Reload Now';
        checkAll();
      });
    }, 10_000);
  });
}

async function copyCookieVoice() {
  if (!btnCookieVoice) return;
  btnCookieVoice.disabled  = true;
  const originalText       = btnCookieVoice.textContent;
  btnCookieVoice.innerHTML = '<span class="spinner"></span>';
  addLogEntry('info', 'Copying Cookie Voice (.google.com)...');

  send({ type: 'GET_COOKIE_VOICE' }, async (res) => {
    if (res && res.ok && res.cookie) {
      try {
        await navigator.clipboard.writeText(res.cookie);
        btnCookieVoice.textContent = '✓ Copied!';
        addLogEntry('success', `Cookie Voice copied to clipboard (${res.count} cookies)`);
      } catch {
        btnCookieVoice.textContent = '✓ Ready';
        addLogEntry('warn', 'Could not write to clipboard automatically');
      }
    } else {
      btnCookieVoice.textContent = '✗ Failed';
      addLogEntry('error', res?.error || 'No voice cookies found. Login to Google first.');
    }
    setTimeout(() => {
      btnCookieVoice.disabled    = false;
      btnCookieVoice.textContent = originalText;
    }, 3_000);
  });
}

async function testToken() {
  const targetBtn = btnTestCaptcha || btnTest;
  if (targetBtn) {
    targetBtn.disabled  = true;
    targetBtn.innerHTML = '<span class="spinner"></span>';
  }
  addLogEntry('info', 'Testing reCAPTCHA Enterprise execution...');

  send({ type: 'TEST_CAPTCHA', action: 'USER_GENERATION' }, (res) => {
    if (res && res.token) {
      addLogEntry('success', `Captcha solved! Token: ${res.token.slice(0, 16)}...`);
      if (targetBtn) targetBtn.textContent = '✓ Success';
    } else {
      addLogEntry('error', `Captcha test failed: ${res?.error || 'unknown'}`);
      if (targetBtn) targetBtn.textContent = '✗ Failed';
    }
    loadStats();
    setTimeout(() => {
      if (targetBtn) {
        targetBtn.disabled    = false;
        targetBtn.textContent = 'Test Captcha';
      }
    }, 3_000);
  });
}

async function pushToken() {
  if (btnPush) {
    btnPush.disabled  = true;
    btnPush.innerHTML = '<span class="spinner"></span>';
  }
  addLogEntry('info', 'Harvesting & pushing credentials to bridge...');

  send({ type: 'FORCE_PUSH' }, (res) => {
    if (res && res.ok) {
      addLogEntry('success', `Pushed to bridge: ${res.token_preview || 'OK'}`);
      if (btnPush) btnPush.textContent = '✓ Pushed!';
      setStatus(dotToken, valToken, 'ok', 'Active');
    } else {
      addLogEntry('warn', 'Push failed — ensure labs.google is open & logged in');
      if (btnPush) btnPush.textContent = '✗ Failed';
    }
    setTimeout(() => {
      if (btnPush) {
        btnPush.disabled    = false;
        btnPush.textContent = 'Push';
      }
    }, 3_000);
  });
}

function onBridgePortChanged() {
  if (!bridgePortInput) return;
  const port = parseInt(bridgePortInput.value);
  if (!port || port < 1 || port > 65535) {
    addLogEntry('warn', 'Invalid port (1–65535)');
    return;
  }
  addLogEntry('info', `Changing bridge port → ${port}...`);
  send({ type: 'SET_BRIDGE_PORT', port }, (resp) => {
    if (resp?.ok) {
      addLogEntry('success', `Bridge port → ${resp.port} (re-handshake done)`);
      checkAll();
    } else {
      addLogEntry('error', `Set port failed: ${resp?.error || 'unknown'}`);
    }
  });
}

// ─── Event Listeners ──────────────────────────────────────────────────────────

btnRefresh.addEventListener('click', refreshTab);
btnOpen.addEventListener('click', openLabs);
btnReloadNow.addEventListener('click', reloadNow);
if (btnCookieVoice) btnCookieVoice.addEventListener('click', copyCookieVoice);
if (btnTestCaptcha) btnTestCaptcha.addEventListener('click', testToken);
if (btnTest)        btnTest.addEventListener('click', testToken);
if (btnPush)        btnPush.addEventListener('click', pushToken);
if (btnCheck)       btnCheck.addEventListener('click', checkAll);

btnClearCacheNow.addEventListener('click', () => {
  btnClearCacheNow.disabled    = true;
  btnClearCacheNow.textContent = '...';
  addLogEntry('info', 'Clearing labs.google cache...');
  send({ type: 'CLEAR_CACHE_NOW' }, (resp) => {
    if (resp?.ok) addLogEntry('success', 'Labs cache cleared!');
    else          addLogEntry('error',   'Cache clear failed');
    btnClearCacheNow.disabled    = false;
    btnClearCacheNow.textContent = 'Now';
  });
});

if (btnSetPort) btnSetPort.addEventListener('click', onBridgePortChanged);
if (bridgePortInput) {
  bridgePortInput.addEventListener('change', onBridgePortChanged);
  bridgePortInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      onBridgePortChanged();
      bridgePortInput.blur();
    }
  });
}

function onAutoReloadChanged() {
  const enabled = toggleAutoReload.checked;
  const minutes = parseInt(reloadTimeInput.value) || 5;
  send({ type: 'SET_AUTO_RELOAD', enabled, minutes }, (resp) => {
    if (resp?.ok) addLogEntry('info', enabled ? `Auto Reload ON: every ${minutes}min` : 'Auto Reload OFF');
  });
}

toggleAutoReload.addEventListener('change', onAutoReloadChanged);

let reloadDebounce = null;
reloadTimeInput.addEventListener('input', () => {
  clearTimeout(reloadDebounce);
  reloadDebounce = setTimeout(onAutoReloadChanged, 800);
});

function onAutoClearCacheChanged() {
  const enabled = toggleAutoClearCache.checked;
  const seconds = parseInt(clearCacheSecondsInput.value) || 1;
  send({ type: 'SET_AUTO_CLEAR_CACHE', enabled, seconds }, (resp) => {
    if (resp?.ok) addLogEntry('info', enabled ? `Auto Clear Cache ON: every ${seconds}s` : 'Auto Clear Cache OFF');
  });
}

toggleAutoClearCache.addEventListener('change', onAutoClearCacheChanged);

let cacheDebounce = null;
clearCacheSecondsInput.addEventListener('input', () => {
  clearTimeout(cacheDebounce);
  cacheDebounce = setTimeout(onAutoClearCacheChanged, 800);
});

// ─── Initialization ───────────────────────────────────────────────────────────

const manifest = chrome.runtime.getManifest();
const extVersion = manifest?.version || '1.0.0';
if (extVersionDisplay) extVersionDisplay.textContent = extVersion;

addLogEntry('info', `Extension popup opened — v${extVersion}`);
loadStats();
checkAll().then(() => addLogEntry('success', 'Initial check done'));
refreshAccountsOnOpen();
setInterval(loadStats, 5_000);
