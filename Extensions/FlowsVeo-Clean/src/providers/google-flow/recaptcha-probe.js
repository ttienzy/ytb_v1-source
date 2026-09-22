import { ensureHarvestCfg } from '../../bridge/config.js';
import { runtime } from '../../background/runtime/state.js';
import { inspectRecaptchaInPage } from './page/captcha.js';

export async function warmUpRecaptcha(tabId, waitMs = 8000) {
  ensureHarvestCfg();
  try {
    const results = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: inspectRecaptchaInPage,
      args: [runtime.harvestCfg.c, waitMs],
    });
    return results?.[0]?.result || { available: false, error: 'No reCAPTCHA probe result' };
  } catch (e) {
    return { available: false, error: `Cannot inspect Flow tab: ${e.message}` };
  }
}
