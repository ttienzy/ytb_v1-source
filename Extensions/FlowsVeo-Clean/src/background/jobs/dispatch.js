import { postCaptchaResponse, postFlowResponse, postImageResponse, postProjectCreatedResponse, postProjectSwitchedResponse, postVideoUploadResponse } from '../../bridge/responses.js';
import { FAIL_THRESHOLD, TOKENS_PER_SESSION } from '../../config/defaults.js';
import { saveState } from '../../platform/storage.js';
import { solveRecaptcha } from '../../providers/google-flow/captcha.js';
import { generateFlowImage, generateFlowVideo, recoverCurrentSceneVideo } from '../../providers/google-flow/generation.js';
import { handleCreateProject, handleSwitchProject } from '../../providers/google-flow/projects.js';
import { ensureProjectTab, findLabsTab } from '../../providers/google-flow/tabs.js';
import { uploadVideoToFlow } from '../../providers/google-flow/upload.js';
import { sleep } from '../../shared/time.js';
import { logActivity } from '../runtime/log.js';
import { clearTrackingCookiesAndRefresh, prepareCaptchaFresh, refreshLabsTab } from '../runtime/maintenance.js';
import { runtime } from '../runtime/state.js';

export async function processCaptchaRequest(request) {
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
    runtime.activeGenerationCount++;
    const targetPid = request.image_request?.project_id || request.project_id || null;
    if (targetPid) {
      try {
        await ensureProjectTab(targetPid);
      } catch (e) {
        logActivity('warn', `ensureProjectTab pre-flight error: ${e.message}`);
      }
    }
    try {
      let result = await solveRecaptcha({ ...request, target_project_id: targetPid, captcha_action: 'IMAGE_GENERATION' });
      if (!result.token && result.error?.includes('not ready')) {
        await sleep(3_000);
        result = await solveRecaptcha({ ...request, target_project_id: targetPid, captcha_action: 'IMAGE_GENERATION' });
      }
      if (!result.token) {
        onCaptchaFail();
        await postImageResponse(request.request_id, { ok: false, error: result.error || 'reCAPTCHA failed' });
        return;
      }
      onCaptchaSuccess();
      const imgResult = await generateFlowImage(request.image_request, result.token);
      await postImageResponse(request.request_id, imgResult);
      logActivity(imgResult.ok ? 'info' : 'warn', imgResult.ok
        ? `Image generation completed: ${imgResult.images?.length || 0} images`
        : `Image generation failed: ${imgResult.error}`);
    } catch (e) {
      await postImageResponse(request.request_id, { ok: false, error: e?.message || 'Image generation error' });
    } finally {
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
  onCaptchaSuccess();
  if (request.flow_request) {
    logActivity('info', `Flow generation dispatched: request=${request.request_id.slice(0, 8)}`);
    // Non-blocking promise: cho phép extension xử lý song song nhiều luồng video cùng lúc
    (async () => {
      runtime.activeGenerationCount++;
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
