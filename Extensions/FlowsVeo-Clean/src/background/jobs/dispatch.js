import { postCaptchaResponse, postFlowResponse, postImageResponse, postProjectCreatedResponse, postProjectSwitchedResponse, postVideoUploadResponse } from '../../bridge/responses.js';
import { FAIL_THRESHOLD, TOKENS_PER_SESSION } from '../../config/defaults.js';
import { saveState } from '../../platform/storage.js';
import { solveRecaptcha } from '../../providers/google-flow/captcha.js';
import { generateFlowImage, generateFlowVideo, recoverCurrentSceneVideo } from '../../providers/google-flow/generation.js';
import { handleCreateProject, handleSwitchProject } from '../../providers/google-flow/projects.js';
import { ensureProjectTab, findLabsTab } from '../../providers/google-flow/tabs.js';
import { uploadVideoToFlow } from '../../providers/google-flow/upload.js';
import { uploadVideoToFlowThroughUi } from '../../providers/google-flow/video-upload-ui.js';
import { sleep } from '../../shared/time.js';
import { logActivity } from '../runtime/log.js';
import { clearTrackingCookiesAndRefresh, prepareCaptchaFresh, refreshLabsTab } from '../runtime/maintenance.js';
import { runtime } from '../runtime/state.js';

export async function processCaptchaRequest(request) {
  // Native UI modes obtain session/CAPTCHA from Flow when Generate is clicked.
  if (['frames', 'ingredients', 'video_edit'].includes(request.flow_request?.input_mode) && !request.flow_recovery) {
    if (runtime.activeGenerationCount > 0 || runtime.imageUiBusy || runtime.videoUiBusy) {
      await postFlowResponse(request.request_id, { ok: false, error: 'FLOW_UI: Flow đang xử lý tác vụ khác. Chờ tác vụ đó xong rồi thử lại.' });
      return;
    }
    if (request.created_at && Date.now() - request.created_at * 1000 > 30000) {
      await postFlowResponse(request.request_id, { ok: false, error: 'FLOW_UI: Yêu cầu đã chờ quá lâu; chưa tạo video. Hãy thử lại.' });
      return;
    }
    runtime.videoUiBusy = true;
    runtime.activeGenerationCount++;
    try {
      await postFlowResponse(request.request_id, await generateFlowVideo(request.flow_request, null));
    } catch (e) {
      await postFlowResponse(request.request_id, { ok: false, error: 'FLOW_UI: ' + (e?.message || 'Video generation failed') });
    } finally {
      runtime.videoUiBusy = false;
      runtime.activeGenerationCount = Math.max(0, runtime.activeGenerationCount - 1);
    }
    return;
  }

  if (request.action === 'CREATE_PROJECT') {
    logActivity('info', `Create Project requested: ${request.project_name || 'unnamed'}`);
    const projResult = await handleCreateProject(request);
    await postProjectCreatedResponse(request.request_id, projResult);
    logActivity(projResult.ok ? 'info' : 'warn', projResult.ok
      ? `Project created successfully: ${projResult.flow_project_id}`
      : `Project creation failed: ${projResult.error}`);
    return;
  }
  if (request.action === 'SWITCH_PROJECT') {
    logActivity('info', `Switch Project requested: ${request.flow_project_id}`);
    const switchResult = await handleSwitchProject(request);
    await postProjectSwitchedResponse(request.request_id, switchResult);
    logActivity(switchResult.ok ? 'info' : 'warn', switchResult.ok
      ? `Project switched successfully: ${switchResult.flow_project_id}`
      : `Project switch failed: ${switchResult.error}`);
    return;
  }
  if (request.action === 'IMAGE_GENERATION') {
    logActivity('info', `Flow Image generation requested: ${request.request_id?.slice(0, 8)}`);
    if (runtime.activeGenerationCount > 0 || runtime.imageUiBusy) {
      await postImageResponse(request.request_id, { ok: false, error: 'FLOW_UI: Flow đang xử lý một lượt tạo khác. Chờ lượt đó hoàn tất rồi thử lại.' });
      return;
    }
    runtime.imageUiBusy = true;
    runtime.activeGenerationCount++;
    const targetPid = request.image_request?.project_id || request.project_id || null;
    try {
      if (!targetPid) throw new Error('Chọn project Flow trước khi tạo ảnh');
      const tabId = await ensureProjectTab(targetPid, { flowOnly: true });
      if (!tabId) throw new Error('Không mở được project Flow để tạo ảnh');
      if (request.created_at && Date.now() - request.created_at * 1000 > 35_000) {
        throw new Error('FLOW_UI: Yêu cầu đã chờ quá lâu trong hàng đợi. Chưa tạo ảnh; hãy thử lại.');
      }
      const imgResult = await generateFlowImage({ ...request.image_request, project_id: targetPid }, null, tabId);
      await postImageResponse(request.request_id, imgResult);
      logActivity(imgResult.ok ? 'info' : 'warn', imgResult.ok
        ? `Image generation completed: ${imgResult.images?.length || 0} images`
        : `Image generation failed: ${imgResult.error}`);
    } catch (e) {
      await postImageResponse(request.request_id, { ok: false, error: e?.message || 'Image generation error' });
    } finally {
      runtime.imageUiBusy = false;
      runtime.activeGenerationCount = Math.max(0, runtime.activeGenerationCount - 1);
    }
    return;
  }
  if (request.action === 'RELOAD_TAB') {
    logActivity('info', 'Reload tab requested by bridge');
    const tid = await findLabsTab(request.target_project_id);
    if (tid) await prepareCaptchaFresh(tid);
    return;
  }
  if (request.action === 'UPLOAD_VIDEO_UI') {
    logActivity('info', `Native Flow video upload requested: ${request.request_id?.slice(0, 8)} project=${request.project_id}`);
    if (runtime.activeGenerationCount > 0 || runtime.imageUiBusy || runtime.videoUiBusy) {
      await postVideoUploadResponse(request.request_id, { ok: false, error: 'FLOW_UI: Flow đang xử lý tác vụ khác. Hãy đợi xong rồi thử lại.' });
      return;
    }
    runtime.videoUiBusy = true;
    runtime.activeGenerationCount++;
    try {
      if (!request.project_id) throw new Error('Chọn Flow project trước khi upload video.');
      if (request.created_at && Date.now() - request.created_at * 1000 > 60000) {
        throw new Error('FLOW_UI: Yêu cầu upload đã chờ quá lâu; chưa tải video lên. Hãy thử lại.');
      }
      const tabId = await ensureProjectTab(request.project_id, { flowOnly: true });
      if (!tabId) throw new Error('Không mở được Flow project để upload video.');
      const videoResult = await uploadVideoToFlowThroughUi(request, tabId);
      await postVideoUploadResponse(request.request_id, videoResult);
      logActivity(videoResult.ok ? 'info' : 'warn', videoResult.ok
        ? `Native Flow video upload OK: mediaId=${videoResult.media_id}`
        : `Native Flow video upload failed: ${videoResult.error}`);
    } catch (e) {
      await postVideoUploadResponse(request.request_id, { ok: false, error: e?.message || 'Native Flow upload error' });
    } finally {
      runtime.videoUiBusy = false;
      runtime.activeGenerationCount = Math.max(0, runtime.activeGenerationCount - 1);
    }
    return;
  }
  if (request.action === 'UPLOAD_VIDEO') {
    logActivity('info', `Upload video requested: ${request.request_id?.slice(0, 8)} project=${request.project_id}`);
    try {
      const videoResult = await uploadVideoToFlow(request);
      await postVideoUploadResponse(request.request_id, videoResult);
      logActivity(videoResult.ok ? 'info' : 'warn', videoResult.ok
        ? `Video upload OK: mediaId=${videoResult.media_id}`
        : `Video upload failed: ${videoResult.error}`);
    } catch (e) {
      await postVideoUploadResponse(request.request_id, { ok: false, error: e?.message || 'Upload error' });
    }
    return;
  }
  if (request.flow_recovery) {
    const recovered = await recoverCurrentSceneVideo(
      request.project_id || null,
      null,
      request.provider_model_id || '',
    );
    await postFlowResponse(request.request_id, recovered);
    return;
  }
  let result = await solveRecaptcha(request);
  if (!result.token && result.error?.includes('not ready')) {
    await sleep(3_000);
    result = await solveRecaptcha(request);
  }
  await postCaptchaResponse(request.request_id, result.token, result.error);
  if (!result.token) {
    onCaptchaFail();
    if (request.flow_request) {
      await postFlowResponse(request.request_id, { ok: false, error: result.error || 'reCAPTCHA failed' });
    }
    return;
  }
  if (request.flow_request) {
    runtime.activeGenerationCount++;
    onCaptchaSuccess();
    logActivity('info', `Flow generation dispatched: request=${request.request_id.slice(0, 8)}`);
    // Non-blocking promise: cho phép extension xử lý song song nhiều luồng video cùng lúc
    (async () => {
      try {
        const flowResult = await generateFlowVideo(request.flow_request, result.token);
        await postFlowResponse(request.request_id, flowResult);
        logActivity(flowResult.ok ? 'info' : 'warn', flowResult.ok
          ? `Flow generation completed: request=${request.request_id.slice(0, 8)}`
          : `Flow generation failed: ${flowResult.error}`);
      } catch (e) {
        await postFlowResponse(request.request_id, { ok: false, error: e?.message || 'Flow generation error' });
      } finally {
        runtime.activeGenerationCount = Math.max(0, runtime.activeGenerationCount - 1);
      }
    })();
  } else {
    onCaptchaSuccess();
  }
}

export function onCaptchaSuccess() {
  runtime.tokenCount++;
  runtime.sessionCount++;
  runtime.failStreak = 0;
  runtime.lastSuccess = Date.now();
  saveState();
  if (runtime.sessionCount % TOKENS_PER_SESSION === 0) {
    clearTrackingCookiesAndRefresh();
  }
}

export function onCaptchaFail() {
  runtime.failStreak++;
  saveState();
  if (runtime.failStreak >= FAIL_THRESHOLD) {
    refreshLabsTab();
    runtime.failStreak = 0;
    saveState();
  }
}
