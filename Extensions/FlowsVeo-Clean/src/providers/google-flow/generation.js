import { logActivity } from '../../background/runtime/log.js';
import { sleep } from '../../shared/time.js';
import { runImageGenerationInPage } from './page/image.js';
import { recoverCurrentSceneInPage } from './page/recovery.js';
import { runFlowGenerationInPage } from './page/video.js';
import { ensureProjectTab, findLabsTab } from './tabs.js';

export async function generateFlowVideo(flowRequest, captchaToken) {
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

export async function generateFlowImage(imageRequest, captchaToken) {
  const tabId = await findLabsTab(imageRequest?.project_id);
  if (!tabId) return { ok: false, error: 'Open a Flow project in Chrome' };
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: runImageGenerationInPage,
      args: [imageRequest, captchaToken],
    });
    if (injected?.[0]?.result) {
      return injected[0].result;
    }
    // Fallback retry sau 2s nếu tab vừa điều hướng hoặc context chưa sẵn sàng
    await sleep(2000);
    const retryInjected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: runImageGenerationInPage,
      args: [imageRequest, captchaToken],
    });
    if (retryInjected?.[0]?.result) {
      return retryInjected[0].result;
    }
    return { ok: false, error: 'Flow page returned no image result (trang bị tải lại hoặc mất ngữ cảnh)' };
  } catch (error) {
    return { ok: false, error: `Cannot execute Flow Image adapter: ${error.message}` };
  }
}

export async function recoverCurrentSceneVideo(projectId = null, fallbackTabId = null, providerModelId = '') {
  const tabId = fallbackTabId || await findLabsTab(projectId);
  if (!tabId) return { ok: false, error: 'Open the completed Flow scene in Chrome' };
  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: recoverCurrentSceneInPage,
      args: [providerModelId],
    });
    return injected?.[0]?.result || { ok: false, error: 'Flow scene returned no result' };
  } catch (error) {
    return { ok: false, error: `Cannot inspect Flow scene: ${error.message}` };
  }
}
