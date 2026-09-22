import { solveRecaptcha } from './captcha.js';
import { runVideoUploadInPage } from './page/upload.js';
import { findLabsTab } from './tabs.js';

export async function uploadVideoToFlow(request) {
  const targetPid = request.project_id || null;
  let tabId = await findLabsTab(targetPid);
  if (!tabId) return { ok: false, error: 'Open a Flow project in Chrome' };

  // Giải CAPTCHA (VIDEO_GENERATION action là đúng cho Omni Flash)
  const captchaResult = await solveRecaptcha({ ...request, captcha_action: 'VIDEO_GENERATION' });
  if (!captchaResult.token) {
    return { ok: false, error: captchaResult.error || 'reCAPTCHA failed for video upload' };
  }

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: runVideoUploadInPage,
      args: [request, captchaResult.token],
    });
    return injected?.[0]?.result || { ok: false, error: 'Flow page returned no result for video upload' };
  } catch (error) {
    return { ok: false, error: `Cannot execute video upload: ${error.message}` };
  }
}
