import { normalizeFlowPrompt } from './prompt-text.js';
import { motionUiStep, readMotionAssetCatalog } from './page/motion-ui.js';
import { pollFramesVideo } from './page/frames-ui.js';
import { frameRpcPayload } from './frames-ui.js';
import { sleep } from '../../shared/time.js';
import { logActivity } from '../../background/runtime/log.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isMotionReferenceAttached(type, ids, mediaId, previousImageIds = []) {
  const expected = type === 'video' ? [mediaId] : [...previousImageIds, mediaId];
  return Array.isArray(ids) && ids.length === expected.length && ids.every((id, index) => id === expected[index]);
}

function parseBatches(postData) {
  try {
    const raw = new URLSearchParams(postData).get('f.req');
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function matchMotionRequest(postData, req, expectedImageIds = []) {
  const batches = parseBatches(postData);
  if (!Array.isArray(batches)) return null;
  for (const batch of batches) {
    if (!Array.isArray(batch)) continue;
    for (const rpc of batch) {
      if (!Array.isArray(rpc) || rpc[0] !== 'jIps6') continue;
      let payload;
      try { payload = JSON.parse(rpc[1]); } catch { continue; }
      if (payload?.[1]?.[5] !== req.project_id) continue;
      const edit = payload?.[0]?.[0];
      if (!Array.isArray(edit) || payload[0].length !== 1) throw new Error('Flow returned an unexpected Motion Control request shape.');
      const source = edit[0];
      const promptValues = [];
      const collectStrings = (value) => {
        if (typeof value === 'string') promptValues.push(value);
        else if (Array.isArray(value)) value.forEach(collectStrings);
      };
      collectStrings(edit[1]);
      const promptMatches = promptValues.some((value) => normalizeFlowPrompt(value) === normalizeFlowPrompt(req.prompt));
      const expectedStartFrame = Math.round(Number(req.reference_video_start_seconds || 0) * 30);
      const expectedEndFrame = Math.round(Number(req.reference_video_end_seconds) * 30);
      const actualImageIds = Array.isArray(edit[8]) ? edit[8].map((item) => item?.[1]).filter(Boolean) : [];
      const checks = [
        [source?.[1] === req.reference_video_id, 'The Flow request uses a different reference video.'],
        [Number(source?.[2]) === expectedStartFrame && Number(source?.[3]) === expectedEndFrame, 'Flow video trim does not match the selected source range.'],
        [promptMatches, 'The Flow request prompt differs from the submitted Motion Control prompt.'],
        [edit[2] === req.provider_model_id, 'Flow selected a different Motion Control model.'],
        [Number(edit[3]) === Number(req.num_outputs || 1), 'Flow output count differs from the Motion Control job.'],
        [actualImageIds.length === expectedImageIds.length && actualImageIds.every((id, index) => id === expectedImageIds[index]), 'Flow reference images differ from the Motion Control job.'],
      ];
      const mismatch = checks.find(([ok]) => !ok);
      if (mismatch) throw new Error(mismatch[1]);
      return {
        rpc: rpc[0],
        reference_video_id: source[1],
        start_frame: Number(source[2]),
        end_frame: Number(source[3]),
        image_ids: actualImageIds,
      };
    }
  }
  return null;
}

export function parseMotionCreation(body, expectedProjectId, expectedReq = null) {
  if (body.includes('PUBLIC_ERROR_UNUSUAL_ACTIVITY')) {
    throw new Error('Flow rejected Motion Control. Check the Flow tab before retrying.');
  }
  const findEnvelope = (value) => {
    if (!Array.isArray(value)) return null;
    if (value[0] === 'wrb.fr' && value[1] === 'jIps6' && typeof value[2] === 'string') return JSON.parse(value[2]);
    for (const child of value) {
      const found = findEnvelope(child);
      if (found) return found;
    }
    return null;
  };
  let response = null;
  for (const line of String(body || '').split(/\r?\n/)) {
    if (!line.trim().startsWith('[')) continue;
    try { response = findEnvelope(JSON.parse(line)); } catch { /* Try the next batchexecute response line. */ }
    if (response) break;
  }
  if (!response) throw new Error('Flow returned no Motion Control creation result.');
  const records = [];
  const walk = (node) => {
    if (!Array.isArray(node)) return;
    const model = node?.[5]?.[6]?.[1]?.[0]?.[0];
    const nativeEdit = node[3] == null && model === 'abra_edit' && Array.isArray(node[7]);
    if (node.length >= 4 && UUID.test(String(node[0])) && node[1] === expectedProjectId && (node[3] === 'CAE' || nativeEdit)) {
      if (expectedReq && nativeEdit && (model !== expectedReq.provider_model_id
          || normalizeFlowPrompt(node?.[5]?.[1]) !== normalizeFlowPrompt(expectedReq.prompt))) {
        throw new Error('Flow returned a Motion Control asset with a different prompt or model.');
      }
      records.push(node);
    }
    node.forEach(walk);
  };
  walk(response);
  if (records.length !== 1) throw new Error('Flow response did not contain one video asset for this project. Check Flow before retrying.');
  return { mediaId: records[0][0], sceneId: records[0][2] || null };
}

function uploadImageResponse(body, projectId) {
  const data = frameRpcPayload(body, 'maseQ');
  const mediaId = data?.[0]?.[0];
  if (!UUID.test(String(mediaId || '')) || data?.[0]?.[1] !== projectId) {
    throw new Error('Flow image upload returned a different project or no media ID.');
  }
  return mediaId;
}

export async function generateMotionVideoThroughUi(req, tabId) {
  const failResult = (message) => ({ ok: false, error: `FLOW_UI: ${message}` });
  const inputs = Array.isArray(req.ingredient_inputs) && req.ingredient_inputs.length > 0
    ? req.ingredient_inputs
    : [
      ...(req.ingredient_media_ids || []).map((media_id) => ({ media_id })),
      ...(req.ingredient_images || []).map((image) => ({ local_path: image.local_path, filename: image.filename })),
    ];
  if (!req.prompt?.trim() || !UUID.test(String(req.reference_video_id || '')) || inputs.length > 3) {
    return failResult('Motion Control requires a prompt, one uploaded reference video, and no more than three reference images.');
  }
  if (Number(req.num_outputs || 1) !== 1 || !['360p', '720p'].includes(req.resolution)) {
    return failResult('Motion Control currently supports one output at 360p or 720p.');
  }
  if (inputs.some((item) => (!item.media_id && (!item.local_path || !item.filename)))) {
    return failResult('A Motion Control reference image has no Flow media ID or readable local file.');
  }
  if (!chrome.debugger) return failResult('Reload FlowsVeo to enable native Motion Control.');

  const target = { tabId };
  const requestTypes = new Map();
  const expectedImageIds = [];
  const command = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);
  let attached = false;
  let closed = false;
  let armed = false;
  let chooser = null;
  let upload = null;
  let created = null;
  let failure = null;
  let submissionRpc = null;
  const mergeCatalog = (assets) => {
    const merged = new Map((req.asset_catalog || []).map(asset => [asset.id, asset]));
    for (const asset of assets) {
      const previous = merged.get(asset.id);
      merged.set(asset.id, { id: asset.id, thumbnails: [...new Set([...(previous?.thumbnails || []), ...asset.thumbnails])] });
    }
    req = { ...req, asset_catalog: [...merged.values()] };
  };
  const refreshAssetCatalog = async () => {
    const result = await chrome.scripting.executeScript({ target, world: 'MAIN', func: readMotionAssetCatalog, args: [req.project_id] });
    const value = result?.[0]?.result;
    if (!value?.assets) throw new Error(value?.error || 'Could not read the Flow asset catalog.');
    mergeCatalog(value.assets);
  };

  const fail = (message) => {
    if (!failure) failure = message;
  };
  const step = async (action, extra = {}) => {
    if (closed || failure) throw new Error(failure || 'Flow Motion Control has stopped.');
    if (action === 'closeSettings') {
      await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
      await sleep(350);
      return null;
    }
    let injected;
    for (let attempt = 0; attempt < 8; attempt++) {
      if (closed || failure) throw new Error(failure || 'Flow Motion Control has stopped.');
      injected = await chrome.scripting.executeScript({
        target,
        world: 'MAIN',
        func: motionUiStep,
        args: [action, { ...req, expected_image_ids: expectedImageIds, ...extra }],
      });
      const err = injected?.[0]?.result?.error || '';
      if (action === 'seekAsset' && err) break;
      if (!/^(Flow control was not found:|Flow control not found:|Flow control is covered:|A window is covering)/.test(err)) {
        break;
      }
      if (err.startsWith('Flow control is covered:')) {
        const dismiss = await chrome.scripting.executeScript({
          target, world: 'MAIN', func: motionUiStep, args: ['dismissBackdrop', req],
        });
        const point = dismiss?.[0]?.result;
        if (point && !point.error) await click(point);
      }
      if (attempt >= 2) {
        await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
        await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 }).catch(() => {});
      }
      await sleep(300);
    }
    if (!injected?.length || !Object.hasOwn(injected[0], 'result')) throw new Error(`Flow page did not respond to ${action}.`);
    if (injected[0].result?.error) throw new Error(injected[0].result.error);
    return injected[0].result;
  };
  const click = async (point) => {
    if (!point) return;
    if (failure) throw new Error(failure);
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(350);
  };
  const drag = async (from, to) => {
    if (Math.abs(from.x - to.x) < 0.1 && Math.abs(from.y - to.y) < 0.1) return;
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...from });
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...from, button: 'left', buttons: 1, clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...to, button: 'left', buttons: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...to, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(500);
  };
  const waitFor = async (fn, timeoutMs, message) => {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (failure) throw new Error(failure);
      const value = await fn();
      if (value) return value;
      await sleep(350);
    }
    throw new Error(message);
  };
  const closeSettings = async () => {
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(300);
  };

  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId || source.sessionId || closed) return;
    if (method === 'Page.fileChooserOpened' && chooser) {
      const pending = chooser;
      clearTimeout(pending.timer);
      command('DOM.setFileInputFiles', { backendNodeId: params.backendNodeId, files: [pending.path] })
        .then(() => { pending.done = true; })
        .catch(() => fail('Chrome could not read a Motion Control reference image.'));
      return;
    }
    if (method === 'Fetch.requestPaused') {
      const url = params.request?.url || '';
      if (!armed || !url.includes('/data/batchexecute')) {
        command('Fetch.continueRequest', { requestId: params.requestId }).catch((error) => fail(`Flow request could not continue: ${error.message}`));
        return;
      }
      const rpcId = (() => { try { return new URL(url).searchParams.get('rpcids'); } catch { return null; } })();
      if (rpcId !== 'jIps6') {
        command('Fetch.continueRequest', { requestId: params.requestId }).catch((error) => fail(`Flow request could not continue: ${error.message}`));
        return;
      }
      try {
        const matched = matchMotionRequest(params.request?.postData || '', req, expectedImageIds);
        if (!matched) throw new Error('Flow created a Motion Control request that does not match this job. No request was sent.');
        submissionRpc = matched.rpc;
        if (params.networkId) requestTypes.set(params.networkId, { generation: true });
        command('Fetch.continueRequest', { requestId: params.requestId }).catch((error) => fail(`Flow could not submit the verified request: ${error.message}`));
      } catch (error) {
        command('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }).catch(() => {});
        fail(error.message || 'Flow request validation failed. No video was submitted.');
      }
      return;
    }
    if (method === 'Network.requestWillBeSent') {
      const request = params.request;
      if (!request?.url?.startsWith('https://flow.google.com/') || !request.url.includes('/data/batchexecute')) return;
      let rpcId = '';
      try { rpcId = new URL(request.url).searchParams.get('rpcids') || ''; } catch { /* Ignore malformed URLs. */ }
      if (upload && rpcId === 'maseQ') requestTypes.set(params.requestId, { imageUpload: upload });
      if (rpcId.split(',').includes('Zzl0ze')) requestTypes.set(params.requestId, { catalog: true, rpcId });
      return;
    }
    const info = requestTypes.get(params.requestId);
    if (!info) return;
    if (method === 'Network.loadingFailed') {
      requestTypes.delete(params.requestId);
      if (info.generation) fail('Flow stopped the Motion Control request. Check Flow before retrying.');
      return;
    }
    if (method === 'Network.responseReceived' && info.generation && params.response?.status >= 400) {
      fail(`Flow returned HTTP ${params.response.status} for Motion Control.`);
      return;
    }
    if (method !== 'Network.loadingFinished') return;
    requestTypes.delete(params.requestId);
    command('Network.getResponseBody', { requestId: params.requestId }).then((response) => {
      if (closed) return;
      const body = response.base64Encoded
        ? new TextDecoder().decode(Uint8Array.from(atob(response.body), (char) => char.charCodeAt(0)))
        : response.body;
      if (info.catalog) {
        const assets = [];
        const walk = (node) => {
          if (!Array.isArray(node)) return;
          if (UUID.test(String(node[0])) && node[1] === req.project_id) {
            const thumbnails = [node?.[5]?.[5], node?.[5]?.[10]].filter(url => typeof url === 'string' && url.startsWith('https://'));
            if (thumbnails.length) assets.push({ id: node[0], thumbnails });
          }
          node.forEach(walk);
        };
        for (const rpcId of info.rpcId.split(',')) {
          try { walk(frameRpcPayload(body, rpcId)); } catch { /* Other native RPCs are not asset lists. */ }
        }
        if (assets.length) mergeCatalog(assets);
      } else if (info.generation) {
        created = parseMotionCreation(body, req.project_id, req);
        logActivity('info', `Motion Control accepted by Flow: media=${created.mediaId}, video=${req.reference_video_id}, trim=${req.reference_video_start_seconds}-${req.reference_video_end_seconds}s`);
      } else if (info.imageUpload) {
        info.imageUpload.mediaId = uploadImageResponse(body, req.project_id);
      }
    }).catch((error) => fail(error.message || 'Could not read a Flow Motion Control response.'));
  };
  const onDetach = (source) => {
    if (source.tabId === tabId && !closed) fail('Chrome detached from Flow. Check Flow before retrying.');
  };
  const applyVideoTrim = async () => {
    if (!(await step('setTrim'))) {
      for (let attempt = 0; attempt < 5; attempt++) {
        const plan = await step('trimPlan');
        await drag(plan.startFrom, plan.startTo);
        const updated = await step('trimPlan');
        await drag(updated.endFrom, updated.endTo);
        const actual = await step('trimValues');
        if (Math.round(actual.start * 30) === Math.round(Number(req.reference_video_start_seconds || 0) * 30)
            && Math.round(actual.end * 30) === Math.round(Number(req.reference_video_end_seconds) * 30)) break;
      }
    }
    await sleep(500);
    const values = await step('trimValues');
    if (Math.round(values.start * 30) !== Math.round(Number(req.reference_video_start_seconds || 0) * 30)
        || Math.round(values.end * 30) !== Math.round(Number(req.reference_video_end_seconds) * 30)) {
      throw new Error('Flow reference-video trim differs from the selected range. No video was submitted.');
    }
  };
  const attachMedia = async (mediaId, type) => {
    await click(await step('openPicker'));
    await waitFor(async () => (await step('assetKeys')).length > 0, 20000, 'Flow media picker did not load.');
    await step('resetPicker');
    await sleep(500);
    await waitFor(() => step('seekAsset', { media_id: mediaId }), 30000, 'The requested reference asset did not appear in Flow.');
    const selectAction = type === 'video' ? 'selectVideo' : 'selectImage';
    for (let attempt = 0; attempt < 3; attempt++) {
      // Scrolling the virtual asset list can replace the element. Re-read the
      // target's position after it settles, then let Chrome perform the click.
      await step(selectAction, { media_id: mediaId });
      await sleep(300);
      await click(await step(selectAction, { media_id: mediaId }));
      await sleep(500);
      if (type === 'video') {
        const ids = await step('videoChipIds');
        if (isMotionReferenceAttached('video', ids, mediaId)) {
          // Uploaded videos may attach directly without exposing trim controls.
          // The native RPC is still checked against the exact requested frames
          // before it can be transmitted.
          await closeSettings();
          return;
        }
      }
      // Flow can attach an image immediately and close the picker, especially
      // when a video reference is already present. That is a completed selection.
      if (type === 'image') {
        const ids = await step('imageChipIds');
        if (isMotionReferenceAttached('image', ids, mediaId, expectedImageIds)) {
          expectedImageIds.push(mediaId);
          await closeSettings();
          return;
        }
      }
      if ((await step('activeAssetIds')).includes(mediaId)) break;
    }
    await waitFor(async () => (await step('activeAssetIds')).includes(mediaId), 15000, `Flow did not open the selected ${type} reference asset (${mediaId}).`);
    await sleep(600);
    if (type === 'video') await applyVideoTrim();
    await click(await step('addSelected'));
    await sleep(600);
    if (type === 'video') {
      await waitFor(async () => {
        const ids = await step('videoChipIds', { media_id: mediaId });
        return isMotionReferenceAttached('video', ids, mediaId) ? ids : null;
      }, 15000, 'Flow did not attach the selected reference video.');
    } else {
      await waitFor(async () => {
        const ids = await step('imageChipIds', { media_id: mediaId });
        return isMotionReferenceAttached('image', ids, mediaId, expectedImageIds) ? ids : null;
      }, 15000, 'Flow did not attach the selected reference image.');
      expectedImageIds.push(mediaId);
    }
    await closeSettings();
  };
  const uploadAndAttachImage = async (image) => {
    if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(image.local_path || '')) throw new Error('Motion Control image path must be absolute.');
    await click(await step('openPicker'));
    upload = { filename: image.filename, mediaId: null };
    chooser = {
      path: image.local_path,
      done: false,
      timer: setTimeout(() => { if (chooser) chooser = null; }, 15000),
    };
    await click(await step('uploadImage'));
    await waitFor(() => chooser?.done, 16000, 'Flow did not accept the reference-image file.');
    clearTimeout(chooser?.timer);
    chooser = null;
    const uploaded = await waitFor(() => upload?.mediaId, 90000, 'Flow image upload timed out. No video was submitted.');
    upload = null;
    // Newly uploaded images can already be attached, with an opaque thumbnail
    // whose media ID becomes resolvable only after refreshing the catalog.
    await refreshAssetCatalog();
    const uploadedChipIds = await step('imageChipIds');
    if (isMotionReferenceAttached('image', uploadedChipIds, uploaded, expectedImageIds)) {
      expectedImageIds.push(uploaded);
      await closeSettings();
      return;
    }
    await click(await step('ensurePicker'));
    const asset = await waitFor(() => step('assetAvailable', { media_id: uploaded }), 60000, 'The uploaded reference image did not appear in Flow.');
    await click(asset.point);
    await sleep(400);
    const attachedIds = await step('imageChipIds');
    if (!isMotionReferenceAttached('image', attachedIds, uploaded, expectedImageIds)) {
      await click(await step('addSelected'));
      await sleep(600);
    }
    await waitFor(async () => {
      const ids = await step('imageChipIds', { media_id: uploaded, expected_image_ids: expectedImageIds });
      return isMotionReferenceAttached('image', ids, uploaded, expectedImageIds) ? ids : null;
    }, 15000, 'Flow did not attach the uploaded reference image.');
    expectedImageIds.push(uploaded);
    await closeSettings();
  };

  try {
    await chrome.tabs.update(tabId, { active: true });
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (tab?.windowId) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.onDetach.addListener(onDetach);
    await command('Network.enable', { maxPostDataSize: 1024 * 1024, maxResourceBufferSize: 5 * 1024 * 1024, maxTotalBufferSize: 12 * 1024 * 1024 });
    await command('Page.enable');
    await command('DOM.enable');
    await command('Page.setInterceptFileChooserDialog', { enabled: true, cancel: false });
    await step('lock');
    await click(await step('closeAccount'));
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(450);
    await step('preflight');
    // Flow's clear-prompt button leaves the reference bar intact. Remove each
    // previous reference before opening the picker for this job.
    for (let attempt = 0; attempt < 8; attempt++) {
      const point = await step('removeIngredient');
      if (!point) break;
      await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
      await sleep(250);
      await click(await step('removeIngredient'));
    }
    if (await step('removeIngredient')) throw new Error('Flow did not clear the previous reference ingredients.');
    await refreshAssetCatalog();

    const openSettings = async () => {
      for (let attempt = 0; attempt < 4; attempt++) {
        const point = await step('openSettings');
        if (!point) return;
        await click(point);
      }
      if (await step('openSettings')) throw new Error('Flow settings did not open.');
    };
    await openSettings();
    // Apply settings with retry: some radio buttons need multiple clicks in Angular
    // Note: Motion Control (video_edit) does not expose a duration selector in its settings panel
    const settingsActions = ['mode', 'ingredients', 'modelMenu', 'model', 'aspect', 'resolution', 'count'];
    for (let attempt = 0; attempt < 5; attempt++) {
      for (const action of settingsActions) {
        const pt = await step(action);
        if (pt) await click(pt);
      }
      const verified = await chrome.scripting.executeScript({
        target, world: 'MAIN', func: motionUiStep,
        args: ['verifySettings', { ...req, expected_image_ids: expectedImageIds }],
      }).catch(() => null);
      if (verified?.[0]?.result === true) break;
      if (attempt === 4) await step('verifySettings'); // throws with the actual diff message
      await sleep(500);
    }
    await closeSettings();
    await step('fill');

    await attachMedia(req.reference_video_id, 'video');
    for (const image of inputs) {
      if (image.media_id) await attachMedia(image.media_id, 'image');
      else await uploadAndAttachImage(image);
    }

    await openSettings();
    // Re-apply and verify settings after media attachment (Flow may reset some settings when chips are added)
    // Note: Motion Control (video_edit) does not expose a duration selector in its settings panel
    for (let attempt = 0; attempt < 5; attempt++) {
      for (const action of ['mode', 'ingredients', 'aspect', 'resolution', 'count']) {
        const pt = await step(action);
        if (pt) await click(pt);
      }
      const verified = await chrome.scripting.executeScript({
        target, world: 'MAIN', func: motionUiStep,
        args: ['verifySettings', { ...req, expected_image_ids: expectedImageIds }],
      }).catch(() => null);
      if (verified?.[0]?.result === true) break;
      if (attempt === 4) await step('verifySettings'); // throws with the actual diff message
      await sleep(500);
    }
    await closeSettings();
    const currentPrompt = await step('promptText');
    const normCurrent = normalizeFlowPrompt(currentPrompt);
    const normExpected = normalizeFlowPrompt(req.prompt);
    if (normCurrent !== normExpected) {
      throw new Error(`Flow prompt changed before submit. Got "${normCurrent.slice(0, 80)}" expected "${normExpected.slice(0, 80)}"`);
    }
    await command('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await command('Input.dispatchKeyEvent', { type: 'keyUp', key: 'Escape', code: 'Escape', windowsVirtualKeyCode: 27 });
    await sleep(350);
    const submitPoint = await step('generate', { expected_image_ids: expectedImageIds });
    await command('Fetch.enable', { patterns: [{ urlPattern: '*AiSandboxAngularFrontend/data/batchexecute*', requestStage: 'Request' }] });
    armed = true;
    await click(submitPoint);

    await waitFor(() => created, 90000, 'Flow did not return a Motion Control video asset. Check Flow before retrying; no automatic resubmission.');
    closed = true;
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);
    await command('Fetch.disable').catch(() => {});
    await command('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
    await chrome.debugger.detach(target).catch(() => {});
    attached = false;

    const deadline = Date.now() + 420000;
    while (Date.now() < deadline) {
      const injected = await chrome.scripting.executeScript({
        target: { tabId }, world: 'MAIN', func: pollFramesVideo,
        args: [req.project_id, created.mediaId, req.provider_model_id],
      }).catch(() => null);
      const value = injected?.[0]?.result;
      if (value?.ok) {
        return {
          ...value,
          diagnostics: {
            adapter: 'motion-ui-v1', rpc: submissionRpc,
            reference_video_id: req.reference_video_id,
            reference_start_seconds: req.reference_video_start_seconds,
            reference_end_seconds: req.reference_video_end_seconds,
            ingredient_media_ids: expectedImageIds,
            scene_id: created.sceneId,
            prompt_verified: true,
          },
        };
      }
      if (value?.terminal) throw new Error(value.error || 'Flow reported a terminal video error.');
      await sleep(3500);
    }
    throw new Error('Motion Control video rendering timed out after seven minutes. Check Flow before retrying.');
  } catch (error) {
    return failResult(error?.message || 'Could not control the Flow Motion Control interface.');
  } finally {
    closed = true;
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);
    if (attached) {
      await command('Fetch.disable').catch(() => {});
      await command('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
      await chrome.debugger.detach(target).catch(() => {});
    }
    await chrome.scripting.executeScript({ target, world: 'MAIN', func: motionUiStep, args: ['unlock', req] }).catch(() => {});
  }
}
