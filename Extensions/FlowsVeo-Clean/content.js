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
            // Hiển thị ký tự reload
            badge.textContent = '↻';
            fab.className     = 'disconnected';
            fab.title         = 'Extension was reloaded — please refresh the page';
            return;
          }
        }
        if (cb) cb(resp);
      });
    } catch { portDead = true; }
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
})();
