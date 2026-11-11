import { logActivity } from '../../background/runtime/log.js';
import { sleep } from '../../shared/time.js';

// chrome.tabs.update / windows.update không đủ khi cửa sổ Chrome bị cửa sổ khác che hoặc thu nhỏ:
// tab vẫn ở trạng thái 'hidden', Chrome ngừng vẽ và UI Flow không cập nhật nên click chọn sai
// (vd "không chọn được thời lượng 4s") hoặc mất response. Page.bringToFront qua debugger kéo tab lên thật.
// Gọi SAU khi chrome.debugger.attach cho tab. Sau đó một "người giữ" nền kéo tab lên lại nếu bị che
// giữa chừng (vd người dùng bấm sang cửa sổ app) cho tới khi debugger tách ra.
const keepers = new Map();
const KEEP_INTERVAL_MS = 3000;

function stopKeeper(tabId) {
  const timer = keepers.get(tabId);
  if (timer) { clearInterval(timer); keepers.delete(tabId); }
}

function startKeeper(tabId) {
  if (keepers.has(tabId)) return;
  const target = { tabId };
  const timer = setInterval(async () => {
    try {
      const r = await chrome.debugger.sendCommand(target, 'Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true });
      if (r?.result?.value !== 'visible') {
        await chrome.debugger.sendCommand(target, 'Page.bringToFront');
        logActivity('info', `Tab Flow ${tabId} bị che giữa lúc tạo — đã kéo lên lại`);
      }
    } catch {
      stopKeeper(tabId); // debugger đã tách / tab đã đóng
    }
  }, KEEP_INTERVAL_MS);
  keepers.set(tabId, timer);
}

if (typeof chrome !== 'undefined' && chrome.debugger?.onDetach?.addListener) {
  chrome.debugger.onDetach.addListener((source) => stopKeeper(source.tabId));
}

export async function ensureTabVisible(tabId, timeoutMs = 8000) {
  const target = { tabId };
  const send = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab?.windowId) {
      const win = await chrome.windows.get(tab.windowId).catch(() => null);
      if (win?.state === 'minimized') await chrome.windows.update(tab.windowId, { state: 'normal' }).catch(() => {});
    }
    await chrome.tabs.update(tabId, { active: true }).catch(() => {});
  } catch { }

  const deadline = Date.now() + timeoutMs;
  let state = 'unknown';
  for (;;) {
    try { await send('Page.bringToFront'); } catch { }
    try { await send('Emulation.setFocusEmulationEnabled', { enabled: true }); } catch { }
    try {
      const r = await send('Runtime.evaluate', { expression: 'document.visibilityState', returnByValue: true });
      state = r?.result?.value || 'unknown';
    } catch { }
    if (state === 'visible') { startKeeper(tabId); return true; }
    if (Date.now() >= deadline) break;
    await sleep(400);
  }
  startKeeper(tabId);
  logActivity('warn', `Tab Flow ${tabId} vẫn ở trạng thái ${state} sau ${timeoutMs}ms — thao tác UI có thể lỗi`);
  return false;
}
