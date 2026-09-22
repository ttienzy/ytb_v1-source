import { logActivity } from '../../background/runtime/log.js';
import { runtime } from '../../background/runtime/state.js';
import { ensureHarvestCfg } from '../../bridge/config.js';
import { sleep } from '../../shared/time.js';
import { warmUpRecaptcha } from './recaptcha-probe.js';

export async function findAllLabsTabs() {
  ensureHarvestCfg();
  const isGoodTab = (t) => t.url && !t.url.includes('/404');
  try {
    const patterns = Array.isArray(runtime.harvestCfg?.t?.p)
      ? runtime.harvestCfg.t.p
      : [runtime.harvestCfg?.t?.p || 'https://labs.google/*', 'https://flow.google.com/*'];
    const found = await chrome.tabs.query({ url: patterns });
    if (found && found.length > 0) return found.filter(isGoodTab);

    // Fallback: lọc toàn bộ tabs đang mở
    const all = await chrome.tabs.query({});
    return all.filter((t) => t.url && (t.url.includes('flow.google.com') || t.url.includes('labs.google')) && isGoodTab(t));
  } catch {
    try {
      const all = await chrome.tabs.query({});
      return all.filter((t) => t.url && (t.url.includes('flow.google.com') || t.url.includes('labs.google')) && isGoodTab(t));
    } catch {
      return [];
    }
  }
}

export async function findLabsTab(targetProjectId = null) {
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

export function waitForTabComplete(tabId, timeoutMs = 20000) {
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

export async function ensureProjectTab(targetProjectId) {
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

  const destinationUrl = `${targetOrigin}/project/${targetProjectId}`;

  // ĐẶC BIỆT: Để TRÁNH XUNG ĐỘT với video đang chạy trên tab khác:
  // Nếu chosenTab đang mở một project khác (/project/...), KHÔNG ghi đè URL của tab đó
  // vì tab đó có thể đang sinh video hoặc ảnh. Thay vào đó, mở tab mới!
  const isChosenTabInDifferentProject = chosenTab && chosenTab.url && /\/project\/[a-zA-Z0-9_-]+/.test(chosenTab.url);
  if (chosenTab && !isChosenTabInDifferentProject) {
    try {
      logActivity('info', `Navigating existing idle Flow tab ${chosenTab.id} to project ${targetProjectId}`);
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

export async function openLabsTab() {
  ensureHarvestCfg();
  try {
    logActivity('info', 'No labs tab open — auto-opening...');
    const tab = await chrome.tabs.create({ url: runtime.harvestCfg.t.o, active: false });
    await waitForTabComplete(tab.id, 15000);
    await sleep(1_500);
    await warmUpRecaptcha(tab.id);
    return tab.id;
  } catch (e) {
    logActivity('warn', `openLabsTab failed: ${e.message}`);
    return null;
  }
}

export async function getActiveTabId() {
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs.length > 0 ? tabs[0].id : null;
  } catch { return null; }
}
