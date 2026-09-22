import { runtime } from '../../background/runtime/state.js';
import { sleep } from '../../shared/time.js';
import { warmUpRecaptcha } from './recaptcha-probe.js';
import { runCreateProjectInPage } from './page/projects.js';
import { ensureProjectTab, findLabsTab, openLabsTab, waitForTabComplete } from './tabs.js';

export async function handleCreateProject(request) {
  let tabId = await findLabsTab();
  if (!tabId) {
    tabId = await openLabsTab();
  }
  if (!tabId) {
    return { ok: false, error: 'Không tìm thấy hoặc không thể mở tab Google Flow' };
  }

  try {
    // Project pages do not expose the "New project" control. Open the
    // account home in a separate tab so an active render tab is never reused.
    const currentTab = await chrome.tabs.get(tabId);
    if (currentTab?.url && /\/project\//.test(currentTab.url)) {
      const currentUrl = new URL(currentTab.url);
      const accountPath = currentUrl.pathname.match(/\/(u\/\d+)/)?.[0] || '';
      const homeUrl = `${currentUrl.origin}${accountPath}/`;
      const homeTab = await chrome.tabs.create({ url: homeUrl, active: true });
      tabId = homeTab.id;
      await waitForTabComplete(tabId, 20000);
      await sleep(1500);
    }

    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: runCreateProjectInPage,
    });
    const res = injected?.[0]?.result;
    if (!res || !res.ok) {
      return { ok: false, error: res?.error || 'Lỗi khi kích hoạt tạo Project trên tab Flow' };
    }

    // Chờ tab load và reCAPTCHA warm-up
    await sleep(2500);
    await warmUpRecaptcha(tabId, 8000);

    // Bổ sung email nếu chưa có
    let email = res.account_email;
    if (!email) {
      const accounts = Object.keys(runtime.harvestedAccounts);
      if (accounts.length > 0) email = accounts[0];
    }

    return {
      ok: true,
      flow_project_id: res.flow_project_id,
      account_email: email,
    };
  } catch (err) {
    return { ok: false, error: `Lỗi thực thi tạo Project: ${err.message}` };
  }
}

export async function handleSwitchProject(request) {
  const targetPid = request.flow_project_id;
  if (!targetPid) {
    return { ok: false, error: 'Thiếu flow_project_id' };
  }
  const tabId = await ensureProjectTab(targetPid);
  if (!tabId) {
    return { ok: false, error: `Không thể chuyển sang tab project ${targetPid}` };
  }
  return { ok: true, flow_project_id: targetPid, tab_id: tabId };
}
