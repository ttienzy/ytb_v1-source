import { imageUiStep } from './page/image-ui.js';
import { sleep } from '../../shared/time.js';

const aspectCodes = { '16:9': 3, '9:16': 2, '1:1': 1, '4:3': 4, '3:4': 5 };

// Inspect only the matching native request; never log its tokens or headers.
export function matchImageUiRequest(postData, expected) {
  try {
    const batches = JSON.parse(new URLSearchParams(postData).get('f.req'));
    for (const batch of batches) for (const rpc of batch) {
      if (rpc[0] !== 'ogiZ0b') continue;
      const payload = JSON.parse(rpc[1]);
      const items = payload?.[1];
      if (!Array.isArray(items) || items.length === 0) continue;
      const item = items[0];
      if (item?.[8]?.[0]?.[0]?.[0] !== expected.prompt.trim()
          || item?.[7]?.[5] !== expected.project_id) continue;
      if (item[5] !== expected.model_key || item[4] !== aspectCodes[expected.aspect_ratio]
          || item[2]?.length) throw new Error('Flow đã gửi cấu hình khác yêu cầu. Kiểm tra ảnh trên Flow trước khi thử lại.');
      return { seeds: items.map(it => it?.[3]).filter(Boolean), seed: item[3] };
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && !String(error.message).includes('iterable')) throw error;
  }
  return null;
}

export function parseImageUiResponse(body, request, nativeRequest) {
  if (body.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY')) throw new Error('PUBLIC_ERROR_UNUSUAL_ACTIVITY: Flow từ chối lượt tạo trên giao diện. Kiểm tra thông báo trong tab Flow.');
  const find = (node) => {
    if (!Array.isArray(node)) return null;
    if (node[0] === 'wrb.fr' && node[1] === 'ogiZ0b' && typeof node[2] === 'string') return JSON.parse(node[2]);
    for (const child of node) { const result = find(child); if (result) return result; }
    return null;
  };
  let payload;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim().startsWith('[')) continue;
    try { payload = find(JSON.parse(line)); } catch { continue; }
    if (payload) break;
  }

  const rawAssets = Array.isArray(payload?.[0]) ? payload[0] : [];
  const parsedImages = [];
  for (const asset of rawAssets) {
    const image = asset?.[6];
    const mediaId = asset?.[0];
    const url = image?.[0]?.[13];
    const seed = image?.[0]?.[1];
    let parsed;
    try { parsed = new URL(url); } catch { /* error below */ }
    if (mediaId && parsed?.origin === 'https://flow-content.google' && parsed.pathname === `/image/${mediaId}`) {
      parsedImages.push({
        media_id: mediaId,
        image_url: url,
        seed,
        dimensions: image?.[2] || null,
        model_key: request.model_key,
        aspect_ratio: request.aspect_ratio,
      });
    }
  }

  if (parsedImages.length === 0) {
    throw new Error('Flow chưa trả về ảnh hợp lệ cho lượt này. Kiểm tra tab Flow trước khi thử lại.');
  }

  return {
    ok: true,
    project_id: request.project_id,
    prompt: request.prompt,
    images: parsedImages,
    diagnostics: {
      adapter: 'flow-ui-v1',
      trigger_method: 'browser-input',
      rpc: 'ogiZ0b',
      count: parsedImages.length,
    },
  };
}

export async function generateImageThroughUi(request, tabId) {
  if (!request?.prompt?.trim() || !aspectCodes[request.aspect_ratio]
      || !['GEM_PIX_2', 'NARWHAL', 'HARBOR_SEAL'].includes(request.model_key)) {
    return { ok: false, error: 'FLOW_UI: Prompt, model hoặc tỷ lệ không hợp lệ.' };
  }
  if (request.reference_image_ids?.length) return { ok: false, error: 'FLOW_UI: Luồng tạo ảnh qua giao diện hiện chưa hỗ trợ ảnh tham chiếu.' };
  if (!chrome.debugger) return { ok: false, error: 'FLOW_UI: Hãy tải lại extension FlowsVeo Clean để cấp quyền điều khiển tab Flow.' };
  const target = { tabId };
  let attached = false, armed = false, settled = false, requestId = null, nativeRequest = null;
  let timeout, resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const finish = (value) => { if (!settled) { settled = true; resolveResult(value); } };
  const fail = (message) => finish({ ok: false, error: `FLOW_UI: ${message}` });
  const command = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);
  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId || source.sessionId || settled || !armed) return;
    if (method === 'Network.requestWillBeSent' && !requestId) {
      const req = params.request;
      if (!req?.url?.startsWith('https://flow.google.com/') || !req.url.includes('/data/batchexecute') || !req.postData) return;
      try {
        const match = matchImageUiRequest(req.postData, request);
        if (match) { requestId = params.requestId; nativeRequest = match; }
      } catch (error) { fail(error.message); }
    } else if (params.requestId === requestId && requestId) {
      if (method === 'Network.loadingFailed') fail('Kết nối tạo ảnh bị ngắt. Kiểm tra ảnh trong Flow trước khi thử lại.');
      if (method === 'Network.responseReceived' && params.response.status !== 200) fail(`Flow trả HTTP ${params.response.status}. Kiểm tra tab Flow.`);
      if (method === 'Network.loadingFinished') {
        command('Network.getResponseBody', { requestId }).then((response) => {
          const body = response.base64Encoded ? new TextDecoder().decode(Uint8Array.from(atob(response.body), (c) => c.charCodeAt(0))) : response.body;
          try { finish(parseImageUiResponse(body, request, nativeRequest)); }
          catch (error) { fail(error.message); }
        }).catch(() => fail('Không đọc được kết quả tạo ảnh. Kiểm tra ảnh trong Flow trước khi thử lại.'));
      }
    }
  };
  const onDetach = (source) => { if (source.tabId === tabId) fail('Chrome ngắt điều khiển tab. Kiểm tra ảnh trong Flow trước khi thử lại.'); };
  const step = async (action) => {
    if (settled) throw new Error('Lượt điều khiển Flow đã dừng.');
    const injected = await chrome.scripting.executeScript({ target, world: 'MAIN', func: imageUiStep, args: [action, request] });
    if (!injected?.length || !Object.hasOwn(injected[0], 'result')) throw new Error('Không đọc được điều khiển trong tab Flow. Tải lại tab rồi thử lại.');
    if (injected[0].result?.error) throw new Error(injected[0].result.error);
    return injected[0].result;
  };
  const click = async (point) => {
    if (!point) return;
    if (settled) throw new Error('Lượt điều khiển Flow đã dừng.');
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(250);
  };
  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.onDetach.addListener(onDetach);
    timeout = setTimeout(() => fail('Hết thời gian chờ. Ảnh có thể vẫn đang tạo; kiểm tra Flow trước khi thử lại.'), 130_000);
    await command('Network.enable', { maxPostDataSize: 1024 * 1024, maxResourceBufferSize: 5 * 1024 * 1024, maxTotalBufferSize: 10 * 1024 * 1024 });
    await step('lock');
    await click(await step('closeAccount'));
    // Close stale menus left by a previous user interaction.
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    const config = await step('checkConfig');
    if (config?.needsConfig) {
      for (const action of ['openSettings', 'mode', 'aspect', 'count', 'modelMenu', 'model']) {
        const pt = await step(action);
        if (pt) {
          await click(pt);
          if (action === 'openSettings' || action === 'modelMenu') {
            await sleep(350);
          }
        }
      }
      await step('verify');
      const closePt = await step('closeSettings');
      if (closePt) await click(closePt);
    } else {
      const closePt = await step('closeSettings');
      if (closePt) await click(closePt);
    }
    await step('fill');
    await sleep(350);

    let submitPoint = null;
    const readyDeadline = Date.now() + 15_000;
    while (Date.now() < readyDeadline) {
      const readyRes = await step('generateReady');
      if (readyRes?.ready && readyRes?.point) {
        submitPoint = readyRes.point;
        break;
      }
      await sleep(400);
    }
    if (!submitPoint) {
      submitPoint = await step('generate');
    }
    armed = true;
    await click(submitPoint); // Exactly one submit. Never replay a failed/unknown generation.
    return await result;
  } catch (error) {
    if (settled) return await result;
    return { ok: false, error: `FLOW_UI: ${attached ? error.message : 'Không thể điều khiển tab Flow. Đóng DevTools của tab và tải lại extension rồi thử lại.'}` };
  } finally {
    settled = true;
    clearTimeout(timeout);
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);
    await chrome.scripting.executeScript({ target, world: 'MAIN', func: imageUiStep, args: ['unlock', request] }).catch(() => {});
    if (attached) await chrome.debugger.detach(target).catch(() => {});
  }
}
