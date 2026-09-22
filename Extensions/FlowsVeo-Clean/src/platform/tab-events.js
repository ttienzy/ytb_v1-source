import { sendHeartbeat } from '../background/runtime/heartbeat.js';
import { runtime } from '../background/runtime/state.js';
import { harvestAndPushAll } from '../providers/google-flow/credentials.js';
import { sleep } from '../shared/time.js';

export function registerTabEvents() {
  chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
    const url = tab?.url || '';
    if (changeInfo.status === 'complete' && (url.includes('labs.google') || url.includes('flow.google.com'))) {
      await sleep(1_000);
      await harvestAndPushAll();
      try { await sendHeartbeat(); } catch { }
    }
  });
}

export function registerCookieEvents() {
  try {
    chrome.cookies.onChanged.addListener((change) => {
      const d = change?.cookie?.domain || '';
      if (!d.includes('labs.google') && !d.includes('flow.google.com') && !d.includes('google.com')) return;
      const now = Date.now();
      if (now - runtime.lastCookieHeartbeat < 10_000) return;
      runtime.lastCookieHeartbeat = now;
      sendHeartbeat();
    });
  } catch { }
}
