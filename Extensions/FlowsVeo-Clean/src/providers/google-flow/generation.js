import { generateIngredientsThroughUi } from './ingredients-ui.js';
import { generateFramesThroughUi } from './frames-ui.js';
import { logActivity } from '../../background/runtime/log.js';
import { sleep } from '../../shared/time.js';
import { generateImageThroughUi } from './image-ui.js';
import { generateVideoThroughUi } from './video-ui.js';
import { generateMotionVideoThroughUi } from './motion-ui.js';
import { runImageGenerationInPage } from './page/image.js';
import { recoverCurrentSceneInPage } from './page/recovery.js';
import { runFlowGenerationInPage } from './page/video.js';
import { ensureProjectTab, findLabsTab, waitForTabComplete } from './tabs.js';
import { warmUpRecaptcha } from './recaptcha-probe.js';

export async function generateFlowVideo(flowRequest, captchaToken) {
  const hasDebugger = typeof chrome !== 'undefined' && Boolean(chrome?.debugger);
  if (flowRequest?.input_mode === 'frames' || flowRequest?.input_mode === 'ingredients') {
    if (!hasDebugger) return { ok: false, error: 'FLOW_UI: Reload FlowsVeo to enable native browser control for Frames/Ingredients.' };
    const tabId = await ensureProjectTab(flowRequest.project_id, { flowOnly: true });
    if (!tabId) return { ok: false, error: 'FLOW_UI: Không mở được project Flow.' };
    return flowRequest.input_mode === 'ingredients'
      ? generateIngredientsThroughUi(flowRequest, tabId)
      : generateFramesThroughUi(flowRequest, tabId);
  }
  if (flowRequest?.input_mode === 'video_edit') {
    if (!hasDebugger) return { ok: false, error: 'FLOW_UI: Reload FlowsVeo to enable native browser control for Motion Control.' };
    const tabId = await ensureProjectTab(flowRequest.project_id, { flowOnly: true });
    if (!tabId) return { ok: false, error: 'FLOW_UI: Không mở được project Flow cho Motion Control.' };
    return generateMotionVideoThroughUi(flowRequest, tabId);
  }

  // Pre-flight: Đảm bảo tab Chrome đang mở đúng project yêu cầu nếu flowRequest có project_id
  if (flowRequest?.project_id) {
    try {
      await ensureProjectTab(flowRequest.project_id);
    } catch (e) {
      logActivity('warn', `ensureProjectTab pre-flight error: ${e.message}`);
    }
  }
  const tabId = await findLabsTab(flowRequest?.project_id);
  if (!tabId) return { ok: false, error: 'Open a Flow project in Chrome' };

  // Focus tab Flow để tương tác UI mượt mà
  try {
    await chrome.tabs.update(tabId, { active: true });
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (t?.windowId) {
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    }
  } catch { }

  const isFrames = flowRequest?.input_mode === 'frames';
  const isIngredients = flowRequest?.input_mode === 'ingredients';
  const isVideoEdit = flowRequest?.input_mode === 'video_edit';

  if (!isFrames && !isIngredients && !isVideoEdit && hasDebugger) {
    logActivity('info', `Running Video UI Automation on tab=${tabId}`);
    return await generateVideoThroughUi(flowRequest, tabId);
  }

  logActivity('info', `Running In-Page RPC generation for ${flowRequest?.input_mode} on tab=${tabId}`);

  const recoverLostResult = async (originalError) => {
    // Khi executeScript bị ngắt (do Flow đổi router / DOM repaint / context reset),
    // video vẫn đang render trên Cloud. Kiên trì thăm dò tối đa 5 phút thay vì báo lỗi sớm.
    logActivity('info', `Lost direct result (${originalError}). Starting patient scene recovery...`);
    const recoveryDeadline = Date.now() + 300_000;
    let attempt = 0;
    let lastError = '';

    while (Date.now() < recoveryDeadline) {
      attempt++;
      await sleep(3_000);
      try {
        if (chrome.runtime?.getPlatformInfo) await chrome.runtime.getPlatformInfo();
      } catch { }

      const recovered = await recoverCurrentSceneVideo(
        flowRequest?.project_id || null,
        tabId,
        flowRequest?.provider_model_id || '',
      );

      if (recovered?.ok) {
        logActivity('info', `Scene recovery succeeded on attempt ${attempt}`);
        return {
          ...recovered,
          recovered_after_lost_result: true,
        };
      }

      if (recovered?.terminal_error) {
        logActivity('warn', `Scene recovery terminal error: ${recovered.error}`);
        return { ok: false, error: `${originalError}; scene recovery rejected: ${recovered.error}` };
      }

      lastError = recovered?.error || 'no video found';
      if (attempt % 5 === 0) {
        logActivity('info', `Scene recovery attempt ${attempt} (${Math.max(0, Math.round((recoveryDeadline - Date.now()) / 1000))}s remaining)...`);
      }
    }
    return { ok: false, error: `${originalError}; scene recovery timed out (sau 5 phút): ${lastError}` };
  };

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: runFlowGenerationInPage,
      args: [flowRequest, captchaToken],
    });
    const result = injected?.[0]?.result;

    // Khi session ID không hợp lệ (WIZ_global_data chưa sẵn sàng), reload tab và retry 1 lần
    if (result && !result.ok && result.error && /session ID không hợp lệ|session config is incomplete/i.test(result.error)) {
      logActivity('warn', `Session stale on tab ${tabId}, reloading and retrying: ${result.error}`);
      try {
        await chrome.tabs.reload(tabId, { bypassCache: false });
        await waitForTabComplete(tabId, 20000);
        await sleep(3000); // Chờ WIZ_global_data được nạp đầy đủ
        await warmUpRecaptcha(tabId, 6000);
      } catch (reloadErr) {
        logActivity('warn', `Tab reload failed: ${reloadErr.message}`);
      }
      // Retry lần 2 sau khi reload
      try {
        const retryInjected = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN', func: runFlowGenerationInPage,
          args: [flowRequest, captchaToken],
        });
        const retryResult = retryInjected?.[0]?.result;
        if (retryResult) {
          if (retryResult.ok || !/Flow page returned no result/i.test(retryResult.error || '')) return retryResult;
          return recoverLostResult(retryResult.error);
        }
        return recoverLostResult('Flow page returned no result after session reload');
      } catch (retryErr) {
        const retryMsg = retryErr?.message || String(retryErr);
        if (/context invalidated|frame was removed|execution context|no result/i.test(retryMsg)) {
          return recoverLostResult(`Cannot execute Flow adapter after reload: ${retryMsg}`);
        }
        return { ok: false, error: `Cannot execute Flow adapter after reload: ${retryMsg}` };
      }
    }

    if (result) {
      if (result.ok || !/Flow page returned no result/i.test(result.error || '')) return result;
      return recoverLostResult(result.error);
    }
    return recoverLostResult('Flow page returned no result');
  } catch (error) {
    const message = error?.message || String(error);
    if (/context invalidated|frame was removed|execution context|no result/i.test(message)) {
      return recoverLostResult(`Cannot execute Flow adapter: ${message}`);
    }
    return { ok: false, error: `Cannot execute Flow adapter: ${message}` };
  }
}

export async function generateFlowImage(imageRequest, captchaToken, pinnedTabId = null) {
  const tabId = pinnedTabId ?? await findLabsTab(imageRequest?.project_id);
  if (!tabId) return { ok: false, error: 'Open a Flow project in Chrome' };

  // 1. Kích hoạt và focus tab Flow để visibilityState = 'visible'
  try {
    await chrome.tabs.update(tabId, { active: true });
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (t?.windowId) {
      await chrome.windows.update(t.windowId, { focused: true }).catch(() => {});
    }
  } catch { }

  const hasDebugger = typeof chrome !== 'undefined' && Boolean(chrome?.debugger);
  if (hasDebugger) {
    logActivity('info', `Running Image UI Automation on tab=${tabId}`);
    return await generateImageThroughUi(imageRequest, tabId);
  }

  logActivity('info', `Running In-Page Image generation on tab=${tabId}`);
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: runImageGenerationInPage,
      args: [imageRequest, captchaToken],
    });
    return injected?.[0]?.result || { ok: false, error: 'Image generation returned no result' };
  } catch (error) {
    return { ok: false, error: `Cannot generate image: ${error.message}` };
  }
}

export async function recoverCurrentSceneVideo(projectId = null, fallbackTabId = null, providerModelId = '') {
  const tabId = fallbackTabId || await findLabsTab(projectId);
  if (!tabId) return { ok: false, error: 'Open the completed Flow scene in Chrome' };
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: recoverCurrentSceneInPage,
      args: [providerModelId, null, projectId],
    });
    return injected?.[0]?.result || { ok: false, error: 'Flow scene returned no result' };
  } catch (error) {
    return { ok: false, error: `Cannot inspect Flow scene: ${error.message}` };
  }
}
