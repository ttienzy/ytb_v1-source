import { videoUiStep } from './page/video-ui.js';
import { sleep } from '../../shared/time.js';
import { recoverCurrentSceneInPage } from './page/recovery.js';

export function matchVideoUiRequest(postData, expected, attachedFrameIds = null) {
  try {
    const raw = new URLSearchParams(postData).get('f.req');
    if (!raw) return null;
    const batches = JSON.parse(raw);
    for (const batch of batches) for (const rpc of batch) {
      if (rpc[0] !== 'YhhmEf' && rpc[0] !== 'nprQif') continue;
      const payload = JSON.parse(rpc[1]);
      if (expected?.input_mode !== 'frames') return { rpcId: rpc[0], payload };
      if (rpc[0] !== 'nprQif') continue;

      const item = payload?.[0]?.[0];
      const actualPrompt = item?.[0]?.[2];
      const promptMatches = (() => {
        const values = [];
        const walk = (value) => {
          if (typeof value === 'string') values.push(value);
          else if (Array.isArray(value)) value.forEach(walk);
        };
        walk(actualPrompt);
        return values.includes(String(expected.prompt || '').trim());
      })();
      const startId = item?.[4]?.[1] || null;
      const endId = item?.[5]?.[1] || null;
      const expectedStart = attachedFrameIds?.[0] || null;
      const expectedEnd = attachedFrameIds?.[1] || null;
      const projectId = payload?.[1]?.[5] || null;
      const checks = [
        [promptMatches, 'Prompt in the Flow request does not match the submitted job.'],
        [projectId === expected.project_id, 'Flow request project does not match the selected project.'],
        [item?.[1] === expected.provider_model_id, 'Flow selected a different video model/duration than the app request.'],
        [Number(item?.[2]) === Number(expected.num_outputs || 1), 'Flow output count does not match the app request.'],
        [startId === expectedStart, 'Flow start frame ID does not match the attached Start Frame.'],
        [endId === expectedEnd, 'Flow end frame ID does not match the attached End Frame.'],
      ];
      const mismatch = checks.find(([ok]) => !ok);
      return mismatch
        ? { rpcId: rpc[0], payload, error: mismatch[1] }
        : { rpcId: rpc[0], payload, start_media_id: startId, end_media_id: endId };
    }
  } catch (error) {
    if (!(error instanceof SyntaxError) && !String(error.message).includes('iterable')) throw error;
  }
  return null;
}

export function parseVideoUiCreateResponse(body, expected = null) {
  if (body.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY')) {
    throw new Error('PUBLIC_ERROR_UNUSUAL_ACTIVITY: Flow rejected video creation. Check the message in the Flow tab.');
  }

  const findRpc = (node) => {
    if (!Array.isArray(node)) return null;
    if (node[0] === 'wrb.fr' && (node[1] === 'YhhmEf' || node[1] === 'nprQif') && typeof node[2] === 'string') {
      return { rpcId: node[1], payload: JSON.parse(node[2]) };
    }
    for (const child of node) {
      const res = findRpc(child);
      if (res) return res;
    }
    return null;
  };

  let response = null;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim().startsWith('[')) continue;
    try { response = findRpc(JSON.parse(line)); } catch { continue; }
    if (response) break;
  }
  if (!response) throw new Error('Flow did not return video creation data.');

  const isUuid = (value) => typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

  // Both nprQif and YhhmEf (and other video creation RPCs) contain CAE/CAM video asset records:
  // [mediaId, projectId, sceneId, 'CAE', ...]
  const records = [];
  const walk = (node) => {
    if (!Array.isArray(node)) return;
    if (node.length >= 4 && isUuid(node[0]) && (node[3] === 'CAE' || node[3] === 'CAM')) records.push(node);
    node.forEach(walk);
  };
  walk(response.payload);
  const record = records.find((item) => !expected?.project_id || item[1] === expected.project_id);
  if (record) {
    return { mediaId: record[0], sceneId: record[2] || null, projectId: record[1] || null };
  }

  if (response.rpcId === 'nprQif') {
    throw new Error('Flow response contains no video asset record for the selected project.');
  }

  // Keep the existing text-to-video response handling while avoiding the recursive UUID parser for nprQif.
  const findMediaId = (node) => {
    if (isUuid(node)) return node;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = findMediaId(child);
        if (found) return found;
      }
    }
    return null;
  };
  const mediaId = findMediaId(response.payload);
  if (!mediaId) throw new Error('Could not find the video media ID in the Flow response.');
  return { mediaId };
}

class AsyncMutex {
  constructor() {
    this._queue = [];
    this._locked = false;
  }

  async acquire(timeoutMs = 120_000) {
    if (!this._locked) {
      this._locked = true;
      let released = false;
      return () => {
        if (!released) {
          released = true;
          this.release();
        }
      };
    }
    return new Promise((resolve, reject) => {
      let timer = null;
      const entry = {
        resolve: (releaseFn) => {
          if (timer) clearTimeout(timer);
          resolve(releaseFn);
        },
        reject: (err) => {
          if (timer) clearTimeout(timer);
          reject(err);
        },
      };
      if (timeoutMs > 0) {
        timer = setTimeout(() => {
          const idx = this._queue.indexOf(entry);
          if (idx !== -1) {
            this._queue.splice(idx, 1);
            reject(new Error('FLOW_UI: Hết thời gian chờ lượt tương tác giao diện (120s).'));
          }
        }, timeoutMs);
      }
      this._queue.push(entry);
    });
  }

  release() {
    if (this._queue.length > 0) {
      const next = this._queue.shift();
      let released = false;
      this._locked = true;
      next.resolve(() => {
        if (!released) {
          released = true;
          this.release();
        }
      });
    } else {
      this._locked = false;
    }
  }
}

export const videoUiMutex = new AsyncMutex();

export async function generateVideoThroughUi(flowRequest, tabId) {
  if (!flowRequest?.prompt?.trim()) {
    return { ok: false, error: 'FLOW_UI: Prompt video không được để trống.' };
  }
  if (!chrome.debugger) {
    return { ok: false, error: 'FLOW_UI: Hãy tải lại extension FlowsVeo Clean để cấp quyền điều khiển tab Flow.' };
  }

  // Chờ đến lượt tương tác giao diện (tránh va chạm debugger khi chạy nhiều biến thể song song)
  let releaseUiLock;
  try {
    releaseUiLock = await videoUiMutex.acquire(120_000);
  } catch (lockErr) {
    return { ok: false, error: lockErr.message };
  }

  const target = { tabId };
  const isFrames = flowRequest.input_mode === 'frames';
  let attached = false, armed = false, settled = false, requestId = null;
  let pendingChooser = null;
  let attachedFrameIds = null;
  let timeout, resolveResult;
  const result = new Promise((resolve) => { resolveResult = resolve; });
  const finish = (value) => { if (!settled) { settled = true; resolveResult(value); } };
  const fail = (message) => finish({ ok: false, error: `FLOW_UI: ${message}` });
  const command = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);

  let capturedMediaId = null;

  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId || source.sessionId) return;
    if (method === 'Page.fileChooserOpened' && pendingChooser) {
      const chooser = pendingChooser;
      pendingChooser = null;
      clearTimeout(chooser.timer);
      command('DOM.setFileInputFiles', { backendNodeId: params.backendNodeId, files: [chooser.path] })
        .then(() => chooser.resolve())
        .catch((error) => chooser.reject(new Error(`Could not select image file in Chrome: ${error.message}`)));
      return;
    }
    if (settled || !armed) return;
    if (method === 'Network.requestWillBeSent' && !requestId) {
      const req = params.request;
      if (!req?.url?.startsWith('https://flow.google.com/') || !req.url.includes('/data/batchexecute') || !req.postData) return;
      try {
        const match = matchVideoUiRequest(req.postData, flowRequest, attachedFrameIds);
        if (match?.error) fail(match.error);
        else if (match) requestId = params.requestId;
      } catch (error) { fail(error.message); }
    } else if (params.requestId === requestId && requestId) {
      if (method === 'Network.loadingFailed') fail('Kết nối tạo video bị ngắt.');
      if (method === 'Network.responseReceived' && params.response.status !== 200) fail(`Flow trả HTTP ${params.response.status}.`);
      if (method === 'Network.loadingFinished') {
        command('Network.getResponseBody', { requestId }).then((response) => {
          const body = response.base64Encoded ? new TextDecoder().decode(Uint8Array.from(atob(response.body), (c) => c.charCodeAt(0))) : response.body;
          try {
            const parsed = parseVideoUiCreateResponse(body, flowRequest);
            capturedMediaId = parsed.mediaId;
            finish({ ok: true, media_id: capturedMediaId });
          } catch (error) { fail(error.message); }
        }).catch(() => fail('Không đọc được phản hồi tạo video từ Flow.'));
      }
    }
  };

  const onDetach = (source) => { if (source.tabId === tabId) fail('Chrome ngắt điều khiển tab Flow.'); };

  const step = async (action, request = flowRequest) => {
    if (settled) throw new Error('Lượt điều khiển Flow đã dừng.');
    const injected = await chrome.scripting.executeScript({ target, world: 'MAIN', func: videoUiStep, args: [action, request] });
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

  const uploadFrame = async (slot, filePath, filename) => {
    if (!filePath || !filename) throw new Error(`The ${slot} frame has no readable local file path.`);
    const isAbsolute = /^[A-Za-z]:[\\/]/.test(filePath) || filePath.startsWith('\\\\') || filePath.startsWith('/');
    if (!isAbsolute) throw new Error(`The ${slot} frame path is not absolute.`);

    await click(await step(slot === 'start' ? 'openStartFrame' : 'openEndFrame'));
    let chooserResolve, chooserReject;
    const chooserReady = new Promise((resolve, reject) => { chooserResolve = resolve; chooserReject = reject; });
    pendingChooser = {
      path: filePath,
      resolve: chooserResolve,
      reject: chooserReject,
      timer: setTimeout(() => {
        if (pendingChooser) pendingChooser = null;
        chooserReject(new Error('Chrome did not open the image file chooser.'));
      }, 15_000),
    };
    try {
      await click(await step('openImageUpload'));
      await chooserReady;
    } catch (error) {
      if (pendingChooser) {
        clearTimeout(pendingChooser.timer);
        pendingChooser = null;
      }
      throw error;
    }

    const uploadRequest = { ...flowRequest, _upload_filename: filename };
    const uploadDeadline = Date.now() + 90_000;
    let assetPoint = null;
    while (Date.now() < uploadDeadline) {
      const asset = await step('uploadedAsset', uploadRequest);
      if (asset?.ready && asset.point) { assetPoint = asset.point; break; }
      await sleep(500);
    }
    if (!assetPoint) throw new Error(`Flow did not finish uploading frame file: ${filename}`);
    await click(assetPoint);
    await click(await step('addImageToPrompt'));

    const wantedCount = slot === 'end' ? 2 : 1;
    const attachDeadline = Date.now() + 15_000;
    while (Date.now() < attachDeadline) {
      const status = await step('frameStatus');
      if (status?.count === wantedCount && status.ids?.every(Boolean)) return status.ids;
      await sleep(300);
    }
    throw new Error(`Flow did not attach the ${slot} frame to the prompt.`);
  };


  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.onDetach.addListener(onDetach);
    timeout = setTimeout(() => fail('Timed out waiting for the Flow video request.'), isFrames ? 180_000 : 60_000);

    await command('Network.enable', { maxPostDataSize: 1024 * 1024, maxResourceBufferSize: 5 * 1024 * 1024, maxTotalBufferSize: 10 * 1024 * 1024 });
    if (isFrames) {
      await command('Page.enable');
      await command('DOM.enable');
      await command('Page.setInterceptFileChooserDialog', { enabled: true, cancel: false });
    }
    await step('lock');
    await click(await step('closeAccount'));

    // Đóng các popup/menu dở dang
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(200);

    // Kiểm tra cấu hình có cần mở drawer không
    const config = await step('checkConfig');
    if (config?.needsConfig) {
      for (const action of ['openSettings', 'mode', 'aspect', 'resolution', 'duration', 'modelMenu', 'model']) {
        const pt = await step(action);
        if (pt) await click(pt);
      }
      await step('verify');
      const closePt = await step('closeSettings');
      if (closePt) await click(closePt);
    } else {
      const closePt = await step('closeSettings');
      if (closePt) await click(closePt);
    }

    // Điền prompt
    // Fill prompt before attaching frames so text selection cannot remove Flow image chips.
    if (isFrames) await step('framePreflight');
    await step('fill');
    await sleep(350);
    if (isFrames) {
      await uploadFrame('start', flowRequest.image_local_path, flowRequest.image_name);
      attachedFrameIds = await step('frameStatus').then((status) => status.ids);
      if (flowRequest.end_image_local_path) {
        await uploadFrame('end', flowRequest.end_image_local_path, flowRequest.end_image_name);
        attachedFrameIds = await step('frameStatus').then((status) => status.ids);
      }
      const expectedCount = flowRequest.end_image_local_path ? 2 : 1;
      if (!Array.isArray(attachedFrameIds) || attachedFrameIds.length !== expectedCount || attachedFrameIds.some((id) => !id)) {
        throw new Error('Could not verify the attached Flow frame IDs.');
      }
    }


    // Chờ nút "Bắt đầu tạo" sẵn sàng
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
    // Click nút tạo video bằng hardware mouse event
    await click(submitPoint);

    // Chờ bắt RPC tạo video từ Flow
    const createResult = await result;
    if (!createResult.ok) return createResult;

    // Lúc này mediaId đã được Flow cấp phép và đang render trên Cloud
    const mediaId = createResult.media_id;

    // Giải phóng debugger sớm để tab tự do render
    clearTimeout(timeout);
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);
    await chrome.scripting.executeScript({ target, world: 'MAIN', func: videoUiStep, args: ['unlock', flowRequest] }).catch(() => {});
    if (attached) {
      await chrome.debugger.detach(target).catch(() => {});
      attached = false;
    }
    // Cho Flow 1.5s để cập nhật canvas rồi nhả UI lock cho biến thể tiếp theo
    await sleep(1500);
    if (releaseUiLock) {
      releaseUiLock();
      releaseUiLock = null;
    }

    // Bước 2: Theo dõi quá trình render video trên Flow đến khi hoàn tất
    const pollStart = Date.now();
    const renderDeadline = Date.now() + 540_000; // 9 phút timeout
    while (Date.now() < renderDeadline) {
      await sleep(3_500);

      // Thăm dò trạng thái qua executeScript (jwpduf / as29s / DOM) với mediaId cụ thể
      const injected = await chrome.scripting.executeScript({
        target: { tabId },
        world: 'MAIN',
        func: recoverCurrentSceneInPage,
        args: [flowRequest.provider_model_id || 'abra_t2v_6s', mediaId],
      }).catch(() => null);
      const pollResult = injected?.[0]?.result;
      if (pollResult && pollResult.ok && pollResult.video_url) {
        return {
          ok: true,
          video_url: pollResult.video_url,
          image_url: pollResult.image_url || null,
          media_id: mediaId,
          provider_model_id: flowRequest.provider_model_id || 'abra_t2v_6s',
          project_id: flowRequest.project_id,
        };
      }

      // Fallback: sau 7s nếu thăm dò theo mediaId chưa có kết quả,
      // thử thăm dò toàn cảnh scene hiện tại (targetMediaId = null).
      if (Date.now() - pollStart > 7_000) {
        const fallbackInjected = await chrome.scripting.executeScript({
          target: { tabId },
          world: 'MAIN',
          func: recoverCurrentSceneInPage,
          args: [flowRequest.provider_model_id || 'abra_t2v_6s', null],
        }).catch(() => null);
        const fallbackResult = fallbackInjected?.[0]?.result;
        if (fallbackResult && fallbackResult.ok && fallbackResult.video_url) {
          return {
            ok: true,
            video_url: fallbackResult.video_url,
            image_url: fallbackResult.image_url || null,
            media_id: fallbackResult.media_id || mediaId,
            provider_model_id: flowRequest.provider_model_id || 'abra_t2v_6s',
            project_id: flowRequest.project_id,
          };
        }
      }

      if (pollResult?.terminal_error) {
        return { ok: false, error: `Google Flow từ chối render: ${pollResult.error}` };
      }
    }

    return { ok: false, error: 'Hết thời gian chờ video render xong trên Google Flow (9 phút).' };

  } catch (error) {
    if (settled) return await result;
    return { ok: false, error: `FLOW_UI: ${attached ? error.message : 'Không thể điều khiển tab Flow.'}` };
  } finally {
    settled = true;
    clearTimeout(timeout);
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);
    await chrome.scripting.executeScript({ target, world: 'MAIN', func: videoUiStep, args: ['unlock', flowRequest] }).catch(() => {});
    if (attached) await chrome.debugger.detach(target).catch(() => {});
    if (releaseUiLock) {
      releaseUiLock();
      releaseUiLock = null;
    }
  }
}
