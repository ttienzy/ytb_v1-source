import { logActivity } from '../../background/runtime/log.js';
import { runtime } from '../../background/runtime/state.js';
import { ensureHarvestCfg } from '../../bridge/config.js';
import { pushCredentialsBatch } from '../../bridge/responses.js';
import { GOOGLE_VOICE_COOKIES } from '../../config/defaults.js';
import { saveState } from '../../platform/storage.js';
import { findAllLabsTabs, getActiveTabId } from './tabs.js';

export function classifyTier(creditData) {
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

export async function harvestSingleTab(tab) {
  if (runtime.imageUiBusy || runtime.videoUiBusy) return null;
  ensureHarvestCfg();
  if (!tab?.id) return null;
  const hcfg = runtime.harvestCfg.h;

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
          const creditsMatch = fullText.match(/(\d+[\d,.]*)\s*(?:(?:Google\s*Flow\s*)?credits|tín\s*dụng\s*Google\s*Flow)/i);
          if (creditsMatch) {
            domCredits = parseInt(creditsMatch[1].replace(/[,.]/g, ''), 10);
          }

          if (domCredits === null) {
            // Quét tìm trong các thẻ con
            const allElements = Array.from(document.querySelectorAll('div, span, p, h1, h2, h3, button, b, strong, [aria-label*="credit" i]'));
            for (const el of allElements) {
              const txt = el.textContent || '';
              if (/credits|tín\s*dụng\s*Google\s*Flow/i.test(txt)) {
                const m = txt.match(/(\d+[\d,.]*)\s*(?:(?:Google\s*Flow\s*)?credits|tín\s*dụng\s*Google\s*Flow)/i);
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
    if (tab?.id && !runtime.imageUiBusy && !runtime.videoUiBusy) {
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

export async function harvestAllAccounts() {
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

export async function harvestAndPushAll() {
  ensureHarvestCfg();
  const tabs = await findAllLabsTabs();
  const accounts = await harvestAllAccounts();

  if (!accounts.length) {
    if (!tabs.length) {
      if (runtime.lastHarvestState === 'valid') {
        logActivity('warn', 'State: VALID → INVALID (no tabs). Pool cleared.');
      }
      runtime.lastHarvestState = 'invalid';
      runtime.harvestedAccounts = {};
      runtime.harvestedCookie = null;
      runtime.harvestedToken = null;
      runtime.harvestedTokenExp = 0;
      await pushCredentialsBatch([]);
      await saveState();
    } else {
      logActivity('warn', 'Tabs open but no credentials. Retaining existing pool.');
    }
    return false;
  }

  runtime.lastHarvestState = 'valid';
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
