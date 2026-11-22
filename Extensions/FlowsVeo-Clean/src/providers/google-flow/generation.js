import { ensureCleanComposer } from './composer.js';
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
import { canUseHttpVideo, runFlowHttpVideoInPage } from './page/video-http.js';
import { ensureProjectTab, findLabsTab, waitForTabComplete } from './tabs.js';
import { warmUpRecaptcha } from './recaptcha-probe.js';

export async function generateFlowVideo(flowRequest, captchaToken) {
  const hasDebugger = typeof chrome !== 'undefined' && Boolean(chrome?.debugger);
  // Frames (i2v_fl) và Ingredients (r2v) của Omni 1.2 đi đường HTTP; giao diện chỉ hỗ trợ Omni 1.1.
  const httpFrames = (flowRequest?.input_mode === 'frames' || flowRequest?.input_mode === 'ingredients') && canUseHttpVideo(flowRequest);
  if ((flowRequest?.input_mode === 'frames' || flowRequest?.input_mode === 'ingredients') && !httpFrames) {
    if (!hasDebugger) return { ok: false, error: 'FLOW_UI: Reload FlowsVeo to enable native browser control for Frames/Ingredients.' };
    const tabId = await ensureProjectTab(flowRequest.project_id, { flowOnly: true });
    if (!tabId) return { ok: false, error: 'FLOW_UI: Không mở được project Flow.' };
    await ensureCleanComposer(tabId);
    return flowRequest.input_mode === 'ingredients'
      ? generateIngredientsThroughUi(flowRequest, tabId)
      : generateFramesThroughUi(flowRequest, tabId);
  }
  // Motion Control (Omni 1.2 macaron_cookie_edit) đi HTTP jIps6 như các chế độ khác; giao diện chỉ còn cho tổ hợp chưa có HAR
  // (vd. không có ảnh tham chiếu nào) hoặc khi backend ép transport='ui'.
  if (flowRequest?.input_mode === 'video_edit' && !canUseHttpVideo(flowRequest)) {
    if (!hasDebugger) return { ok: false, error: 'FLOW_UI: Reload FlowsVeo to enable native browser control for Motion Control.' };
    const tabId = await ensureProjectTab(flowRequest.project_id, { flowOnly: true });
    if (!tabId) return { ok: false, error: 'FLOW_UI: Không mở được project Flow cho Motion Control.' };
    await ensureCleanComposer(tabId);
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

  // Đường HTTP thuần (không bấm UI): chỉ khi request yêu cầu transport='http' và đúng tổ hợp đã chứng minh.
  const useHttp = canUseHttpVideo(flowRequest);
  const generationFn = useHttp ? runFlowHttpVideoInPage : runFlowGenerationInPage;
  // Luồng cũ có solveRecaptcha() chờ module reCAPTCHA sẵn sàng trước khi gửi; đường HTTP không giải token trước nên tự chờ ở đây.
  // Nếu module chưa nạp, hàm in-page báo lỗi TRƯỚC khi gửi (submitted=false) và job rơi về đường giao diện.
  if (useHttp) await warmUpRecaptcha(tabId, 8000).catch(() => null);

  if (!isFrames && !isIngredients && !isVideoEdit && hasDebugger && !useHttp) {
    await ensureCleanComposer(tabId);
    logActivity('info', `Running Video UI Automation on tab=${tabId}`);
    return await generateVideoThroughUi(flowRequest, tabId);
  }

  // Chỉ fallback sang UI khi HTTP thất bại TRƯỚC khi Flow nhận job (submitted=false): tránh tạo trùng và trừ credit hai lần.
  const fallbackToUiIfNotSubmitted = async (result, isRetry = false) => {
    if (!useHttp || !result || result.ok || result.submitted !== false || !hasDebugger) return null;
    // Giao diện không tạo được frames/ingredients của Omni 1.2 (generateVideoThroughUi là tạo video từ chữ, sẽ tốn credit mà mất ảnh tham chiếu): báo thẳng lỗi.
    if (['frames', 'ingredients', 'video_edit'].includes(flowRequest?.input_mode)) return null;
    // Session cũ: để nhánh reload tab + thử lại bên dưới xử lý trước
    if (!isRetry && /session ID không hợp lệ|session config is incomplete/i.test(result.error || '')) return null;
    logActivity('warn', `HTTP video path failed before submit (${result.error}); falling back to UI automation`);
    await ensureCleanComposer(tabId);
    return generateVideoThroughUi(flowRequest, tabId);
  };

  logActivity('info', `Running ${useHttp ? 'HTTP (no-UI)' : 'In-Page RPC'} generation for ${flowRequest?.input_mode} on tab=${tabId}`);
  // Mã riêng của lượt này: hàm trong trang ghi các media id đã gửi vào sessionStorage dưới mã đó để chạy tiếp được.
  const nonce = useHttp ? (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`) : '';
  const pageArgs = useHttp ? [flowRequest, captchaToken, { nonce }] : [flowRequest, captchaToken];
  const multiOutput = Number(flowRequest?.num_outputs || 1) > 1;

  /**
   * Lệnh executeScript đang chờ bị mất (trang Flow tải lại / chuyển trang giữa lúc render): chạy lại hàm trong trang ở chế độ
   * resume — đọc ĐÚNG các media id đã gửi rồi theo dõi tiếp. Trả null nếu tab không còn dấu vết lượt gửi (để bên gọi quyết định).
   */
  const resumeHttp = async (originalError) => {
    logActivity('info', `Lost direct result (${originalError}). Resuming the same HTTP generation by its media ids...`);
    const deadline = Date.now() + 15 * 60_000;
    let attempt = 0;
    while (Date.now() < deadline) {
      attempt++;
      await sleep(attempt === 1 ? 2_000 : 4_000);
      try {
        await waitForTabComplete(tabId, 20_000).catch(() => {});
        const injected = await chrome.scripting.executeScript({
          target: { tabId }, world: 'MAIN', func: runFlowHttpVideoInPage,
          args: [flowRequest, null, { nonce, resume: true }],
        });
        const r = injected?.[0]?.result;
        if (!r) continue;                                                     // trang lại đổi giữa chừng: thử tiếp
        if (r.resume_missing) {
          // vừa tải lại có thể chưa đọc được sessionStorage / session: thử thêm vài lần rồi mới bỏ
          if (attempt < 4) continue;
          return null;
        }
        if (!r.ok && /session config is incomplete|session ID không hợp lệ|mở một Dự án/i.test(r.error || '')) continue;
        logActivity(r.ok ? 'info' : 'warn', `Resumed HTTP generation (attempt ${attempt}): ${r.ok ? 'ok' : r.error}`);
        return r;
      } catch (err) {
        const msg = err?.message || String(err);
        if (!/context invalidated|frame was removed|execution context|no result|No tab with id|Cannot access/i.test(msg)) {
          return { ok: false, submitted: true, error: `${originalError}; resume failed: ${msg}` };
        }
      }
    }
    return { ok: false, submitted: true, error: `${originalError}; resume timed out (Flow đã nhận lệnh — xem trong project Flow)` };
  };

  /** Mất kết quả trực tiếp: HTTP thì chạy tiếp bằng media id; chỉ khi không còn dấu vết VÀ là 1 video mới khôi phục scene đang mở. */
  const handleLost = async (originalError) => {
    if (useHttp) {
      const resumed = await resumeHttp(originalError);
      if (resumed) return resumed;
      if (multiOutput) {
        // khôi phục scene chỉ lấy được MỘT video bất kỳ đang mở (có khi là ảnh) -> không dùng cho lệnh nhiều video
        return { ok: false, error: `${originalError}; không còn dấu vết lượt gửi trong tab Flow — xem các video trong project Flow, KHÔNG gửi lại` };
      }
    }
    return recoverLostResult(originalError);
  };

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
      target: { tabId }, world: 'MAIN', func: generationFn,
      args: pageArgs,
    });
    const result = injected?.[0]?.result;
    const uiFallback = await fallbackToUiIfNotSubmitted(result);
    if (uiFallback) return uiFallback;

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
          target: { tabId }, world: 'MAIN', func: generationFn,
          args: pageArgs,
        });
        const retryResult = retryInjected?.[0]?.result;
        const retryUiFallback = await fallbackToUiIfNotSubmitted(retryResult, true);
        if (retryUiFallback) return retryUiFallback;
        if (retryResult) {
          if (retryResult.ok || !/Flow page returned no result/i.test(retryResult.error || '')) return retryResult;
          return handleLost(retryResult.error);
        }
        return handleLost('Flow page returned no result after session reload');
      } catch (retryErr) {
        const retryMsg = retryErr?.message || String(retryErr);
        if (/context invalidated|frame was removed|execution context|no result/i.test(retryMsg)) {
          return handleLost(`Cannot execute Flow adapter after reload: ${retryMsg}`);
        }
        return { ok: false, error: `Cannot execute Flow adapter after reload: ${retryMsg}` };
      }
    }

    if (result) {
      if (result.ok || !/Flow page returned no result/i.test(result.error || '')) return result;
      return handleLost(result.error);
    }
    return handleLost('Flow page returned no result');
  } catch (error) {
    const message = error?.message || String(error);
    if (/context invalidated|frame was removed|execution context|no result/i.test(message)) {
      return handleLost(`Cannot execute Flow adapter: ${message}`);
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
    await ensureCleanComposer(tabId);
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
