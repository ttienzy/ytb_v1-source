/**
 * content.js — FlowsVeo Clean Content Script
 *
 * Inject vào https://labs.google/*:
 *  1. Floating Action Button (FAB) hiển thị trạng thái & token count
 *  2. Keep-alive port → giữ Service Worker luôn active
 *  3. Drag để di chuyển FAB
 */

(function () {
  'use strict';

  // Chỉ chạy ở frame cao nhất (top window), tuyệt đối không inject vào iframe
  if (typeof window !== 'undefined' && window !== window.top) return;

  // Ngăn inject nhiều lần
  if (document.getElementById('veoflow-fab')) return;

  // ─── Keep-alive port ───────────────────────────────────────────────────────
  let keepAlivePort = null;
  let portDead      = false;

  function connectKeepAlive() {
    if (portDead) return;
    try {
      keepAlivePort = chrome.runtime.connect({ name: 'veoflow-keepalive' });
      keepAlivePort.onDisconnect.addListener(() => {
        keepAlivePort = null;
        // Reconnect sau 5s
        setTimeout(connectKeepAlive, 5_000);
      });
    } catch {
      portDead = true;
    }
  }
  connectKeepAlive();

  // Gửi PING mỗi 25s qua port để giữ service worker
  setInterval(() => {
    if (!keepAlivePort || portDead) return;
    try { keepAlivePort.postMessage({ type: 'PING' }); } catch { keepAlivePort = null; }
  }, 25_000);

  // ─── Inject CSS ────────────────────────────────────────────────────────────
  const style = document.createElement('style');
  style.textContent = `
    @keyframes vf-float {
      0%   { transform: translateY(0);    box-shadow: 0 4px 20px rgba(0,0,0,0.25); }
      50%  { transform: translateY(-4px); box-shadow: 0 8px 28px rgba(0,0,0,0.30); }
      100% { transform: translateY(0);    box-shadow: 0 4px 20px rgba(0,0,0,0.25); }
    }
    @keyframes vf-pulse {
      0%, 100% { opacity: 1; }
      50%       { opacity: 0.6; }
    }

    #veoflow-fab {
      --vf-color: #ef7420;
      --vf-glow:  rgba(239,116,32,0.30);

      position: fixed;
      bottom: 50px;
      right:  50px;
      width:  50px;
      height: 50px;
      border-radius: 50%;
      background: var(--vf-color);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      z-index: 2147483647;
      user-select: none;
      transition: background 0.3s, box-shadow 0.3s;
      animation: vf-float 3s ease-in-out infinite;
    }
    #veoflow-fab.connected    { --vf-color: #16a34a; --vf-glow: rgba(22,163,74,0.30); }
    #veoflow-fab.disconnected { --vf-color: #ef4444; --vf-glow: rgba(239,68,68,0.30); }
    #veoflow-fab.stale        { --vf-color: #d97706; }

    #veoflow-fab img {
      width: 30px;
      height: 30px;
      border-radius: 50%;
      pointer-events: none;
    }

    #veoflow-fab .vf-badge {
      position: absolute;
      top:    -5px;
      right:  -5px;
      min-width: 18px;
      height:    18px;
      padding: 0 4px;
      border-radius: 9px;
      background: var(--vf-color);
      border: 2px solid #fff;
      color: #fff;
      font-size: 10px;
      font-weight: 800;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
    }
  `;
  document.head.appendChild(style);

  // ─── Create FAB ────────────────────────────────────────────────────────────
  const fab = document.createElement('div');
  fab.id        = 'veoflow-fab';
  fab.className = 'disconnected';
  fab.title     = 'FlowsVeo Clean';

  // Icon (dùng icon 48px từ extension nếu có, fallback text)
  const iconSrc = (() => {
    try { return chrome.runtime.getURL('icons/48.png'); } catch { return ''; }
  })();

  if (iconSrc) {
    const img = document.createElement('img');
    img.src = iconSrc;
    fab.appendChild(img);
  } else {
    fab.textContent = 'VF';
    fab.style.fontSize = '12px';
    fab.style.fontWeight = '800';
    fab.style.color = '#fff';
  }

  // Badge counter
  const badge = document.createElement('span');
  badge.className = 'vf-badge';
  badge.textContent = '0';
  fab.appendChild(badge);

  document.body.appendChild(fab);

  // ─── Drag to move ──────────────────────────────────────────────────────────
  let dragging    = false;
  let startMouseX = 0, startMouseY = 0;
  let startLeft   = 0, startTop   = 0;
  let didDrag     = false;

  fab.addEventListener('mousedown', (e) => {
    dragging    = true;
    didDrag     = false;
    startMouseX = e.clientX;
    startMouseY = e.clientY;
    const rect  = fab.getBoundingClientRect();
    startLeft   = rect.left;
    startTop    = rect.top;

    const onMove = (e2) => {
      const dx = e2.clientX - startMouseX;
      const dy = e2.clientY - startMouseY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) didDrag = true;
      fab.style.left   = `${startLeft + dx}px`;
      fab.style.top    = `${startTop  + dy}px`;
      fab.style.right  = 'auto';
      fab.style.bottom = 'auto';
      fab.style.cursor = 'grabbing';
    };
    const onUp = () => {
      dragging = false;
      fab.style.cursor = 'grab';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup',   onUp);
  });

  // ─── Poll stats from background ───────────────────────────────────────────
  function sendToBackground(payload, cb) {
    if (portDead) return;
    try {
      chrome.runtime.sendMessage(payload, (resp) => {
        if (chrome.runtime.lastError) {
          const err = chrome.runtime.lastError.message || '';
          if (err.includes('Extension context') || err.includes('Receiving end')) {
            portDead = true;
            badge.textContent = '↻';
            fab.className     = 'disconnected';
            fab.title         = 'Extension was reloaded — please refresh the page';
            // Cho phép tự động thử kết nối lại sau 4s
            setTimeout(() => { portDead = false; }, 4000);
            return;
          }
        }
        if (cb) cb(resp);
      });
    } catch {
      portDead = true;
      setTimeout(() => { portDead = false; }, 4000);
    }
  }

  function refreshFab() {
    sendToBackground({ type: 'GET_STATS' }, (resp) => {
      if (!resp) {
        badge.textContent = '!';
        fab.className     = 'disconnected';
        return;
      }
      badge.textContent = String(resp.tokenCount || 0);
      fab.className     = resp.connected ? 'connected' : 'disconnected';
    });
  }

  refreshFab();
  setInterval(refreshFab, 5_000);

  // ─── Auto Credits Scanner & Synchronizer ───────────────────────────────────
  let lastKnownCredits = null;
  let lastKnownEmail   = null;
  let isProbing        = false;

  function extractDeepText(node) {
    if (!node) return '';
    let txt = '';
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || '';
    if (node.shadowRoot) {
      for (const c of node.shadowRoot.childNodes || []) {
        txt += ' ' + extractDeepText(c);
      }
    }
    for (const c of node.childNodes || []) {
      txt += ' ' + extractDeepText(c);
    }
    return txt;
  }

  function scanCreditsAndAccount() {
    try {
      let foundCredits = null;
      let foundEmail   = null;

      // 1. Quét document.body innerText
      const bodyText = (document.body && document.body.innerText) || '';
      const flowMatch = bodyText.match(/(\d+[\d,.]*)\s+Google\s+Flow\s+credits/i);
      if (flowMatch) {
        foundCredits = parseInt(flowMatch[1].replace(/[,.]/g, ''), 10);
      } else {
        const matches = [...bodyText.matchAll(/(\d+[\d,.]*)\s*(?:Google\s*Flow\s*)?credits/gi)]
          .map(m => parseInt(m[1].replace(/[,.]/g, ''), 10))
          .filter(n => !isNaN(n) && n > 0 && ![4, 5, 6, 7, 10, 12, 15, 20, 40, 100].includes(n));
        if (matches.length > 0) foundCredits = Math.max(...matches);
      }

      // 2. Quét sâu TreeWalker nếu chưa thấy
      if (foundCredits === null) {
        const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          const t = node.textContent || '';
          if (/credits/i.test(t)) {
            const m = t.match(/(\d+[\d,.]*)\s*(?:Google\s*Flow\s*)?credits/i);
            if (m) {
              foundCredits = parseInt(m[1].replace(/[,.]/g, ''), 10);
              break;
            }
            const pt = node.parentElement?.textContent || '';
            const pm = pt.match(/(\d+[\d,.]*)\s*(?:Google\s*Flow\s*)?credits/i);
            if (pm) {
              foundCredits = parseInt(pm[1].replace(/[,.]/g, ''), 10);
              break;
            }
          }
        }
      }

      // 3. Quét Shadow DOM
      if (foundCredits === null) {
        const fullDeep = extractDeepText(document.body);
        const dm = fullDeep.match(/(\d+[\d,.]*)\s*(?:Google\s*Flow\s*)?credits/i);
        if (dm) foundCredits = parseInt(dm[1].replace(/[,.]/g, ''), 10);
      }

      // 4. Tìm Email
      const emailMatch = bodyText.match(/\b([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})\b/);
      if (emailMatch) foundEmail = emailMatch[1];
      if (!foundEmail) {
        const profEl = document.querySelector('[aria-label*="@"], [data-email]');
        if (profEl) {
          const em = (profEl.getAttribute('aria-label') || '').match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
          if (em) foundEmail = em[1];
          else if (profEl.getAttribute('data-email')) foundEmail = profEl.getAttribute('data-email');
        }
      }

      // 5. Nếu phát hiện credits > 0 và có sự thay đổi hoặc chưa gửi
      if (foundCredits !== null && foundCredits >= 0) {
        if (foundCredits !== lastKnownCredits || (foundEmail && foundEmail !== lastKnownEmail)) {
          lastKnownCredits = foundCredits;
          if (foundEmail) lastKnownEmail = foundEmail;
          sendToBackground({
            type: 'CREDITS_UPDATED',
            credits: foundCredits,
            email: foundEmail || '',
          });
        }
      }
      return { credits: foundCredits, email: foundEmail };
    } catch {
      return { credits: null, email: null };
    }
  }

  // Tự động mở nhẹ menu avatar để lấy credits nếu trang chưa render
  async function probeAvatarCredits(force = false) {
    if (isProbing || (!force && lastKnownCredits !== null && lastKnownCredits > 20)) return;
    isProbing = true;
    try {
      const avatarBtn = document.querySelector(
        'button[aria-label*="Google Account" i], button[aria-label*="Tài khoản Google" i], ' +
        'a[aria-label*="Google Account" i], a[aria-label*="Tài khoản Google" i], ' +
        'button[aria-label*="@gmail.com" i], a[aria-label*="@gmail.com" i], ' +
        '[data-ogsr-up], [data-g-id="account-button"], [aria-haspopup="dialog"], ' +
        'header button:has(img), nav button:has(img), [role="banner"] button:has(img), ' +
        'header [role="button"]:has(img), nav [role="button"]:has(img)'
      ) || Array.from(document.querySelectorAll('button, a, [role="button"]')).find(el => {
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const rect = el.getBoundingClientRect();
        return (aria.includes('account') || aria.includes('tài khoản') || aria.includes('@') || el.querySelector('img')) &&
               rect.top < 100 && rect.right > (window.innerWidth - 200);
      });

      if (avatarBtn) {
        avatarBtn.click();
        await new Promise((r) => setTimeout(r, 450));
        scanCreditsAndAccount();
        const closeBtn = document.querySelector(
          'button[aria-label="Close" i], button[aria-label="Đóng" i], button[aria-label*="close" i], [aria-label*="Close dialog" i]'
        );
        if (closeBtn) {
          closeBtn.click();
        } else {
          avatarBtn.click();
        }
        document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
      }
    } catch {}
    finally {
      isProbing = false;
    }
  }

  // Lắng nghe MutationObserver: khi user click avatar mở popup → bắt ngay lập tức!
  let debounceTimer = null;
  const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(scanCreditsAndAccount, 150);
  });

  if (document.body) {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  } else {
    document.addEventListener('DOMContentLoaded', () => {
      observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }

  // Lắng nghe click (user bấm avatar)
  document.addEventListener('click', () => {
    setTimeout(scanCreditsAndAccount, 250);
  }, { passive: true });

  // Nhận lệnh từ background / popup
  chrome.runtime.onMessage.addListener((req, _sender, sendResp) => {
    if (req?.type === 'PROBE_CREDITS') {
      const res = scanCreditsAndAccount();
      if (res.credits === null || req.force) {
        probeAvatarCredits(true).then(() => {
          sendResp(scanCreditsAndAccount());
        }).catch(() => {
          try { sendResp({ credits: null, email: null }); } catch { }
        });
        return true;
      }
      sendResp(res);
      return true;
    }
  });

  // Quét lúc mới load
  setTimeout(scanCreditsAndAccount, 1_000);
  setTimeout(scanCreditsAndAccount, 3_000);
  setTimeout(() => {
    if (lastKnownCredits === null) probeAvatarCredits();
  }, 4_500);
})();
