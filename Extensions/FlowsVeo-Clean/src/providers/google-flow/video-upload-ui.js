import { videoUploadUiStep } from './page/video-upload-ui.js';
import { sleep } from '../../shared/time.js';

export function parseUploadResult(body, expectedProjectId) {
  let value;
  try {
    value = JSON.parse(String(body || '').replace(/^\)\]\}'\s*/, '').trim());
  } catch {
    return null;
  }
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const walk = (node, inheritedProjectId = null) => {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (const child of node) {
        const found = walk(child, inheritedProjectId);
        if (found) return found;
      }
      return null;
    }
    const projectId = node.projectId || node.project_id || node.media?.projectId || inheritedProjectId;
    const mediaId = node.mediaId || node.media_id || node.media?.mediaId || node.media?.media_id;
    if (typeof mediaId === 'string' && uuid.test(mediaId) && projectId === expectedProjectId) {
      return { media_id: mediaId, project_id: projectId };
    }
    for (const child of Object.values(node)) {
      const found = walk(child, projectId);
      if (found) return found;
    }
    return null;
  };
  return walk(value);
}

export async function uploadVideoToFlowThroughUi(request, tabId) {
  if (!request?.project_id || !request.video_local_path || !request.video_filename) {
    return { ok: false, error: 'FLOW_UI: Project, local video path and filename are required.' };
  }
  if (!/^(?:[A-Za-z]:[\\/]|\/|\\\\)/.test(request.video_local_path)) {
    return { ok: false, error: 'FLOW_UI: The local video path must be absolute.' };
  }
  if (!chrome.debugger) return { ok: false, error: 'FLOW_UI: Reload FlowsVeo to enable native file upload.' };

  const target = { tabId };
  const command = (method, params = {}) => chrome.debugger.sendCommand(target, method, params);
  let attached = false;
  let pendingChooser = null;
  let settled = false;
  let timeout = null;
  let resolveResult;
  const completion = new Promise((resolve) => { resolveResult = resolve; });
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    resolveResult(value);
  };

  const step = async (action) => {
    const injected = await chrome.scripting.executeScript({
      target, world: 'MAIN', func: videoUploadUiStep, args: [action, request],
    });
    if (!injected?.length || !Object.hasOwn(injected[0], 'result')) {
      throw new Error('Flow page did not respond to the native upload step.');
    }
    if (injected[0].result?.error) throw new Error(injected[0].result.error);
    return injected[0].result;
  };
  const click = async (point) => {
    await command('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point });
    await command('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await command('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    await sleep(250);
  };

  const onEvent = (source, method, params) => {
    if (source.tabId !== tabId || source.sessionId || settled) return;
    if (method === 'Page.fileChooserOpened' && pendingChooser) {
      const chooser = pendingChooser;
      pendingChooser = null;
      clearTimeout(chooser.timer);
      command('DOM.setFileInputFiles', { backendNodeId: params.backendNodeId, files: [request.video_local_path] })
        .then(() => chooser.resolve())
        .catch((error) => chooser.reject(new Error(`Chrome could not select the video file: ${error.message}`)));
      return;
    }
    if (method === 'Network.requestWillBeSent') {
      const url = params.request?.url || '';
      if (params.request?.method === 'POST'
          && url.includes(`/upload/v1/flow/upload/video/${request.project_id}`)) {
        params.requestId && uploadRequests.add(params.requestId);
      }
      return;
    }
    if (!uploadRequests.has(params.requestId)) return;
    if (method === 'Network.loadingFailed') {
      uploadRequests.delete(params.requestId);
      finish({ ok: false, error: 'FLOW_UI: Flow interrupted the native video upload. No video generation was submitted.' });
      return;
    }
    if (method === 'Network.loadingFinished') {
      const requestId = params.requestId;
      uploadRequests.delete(requestId);
      command('Network.getResponseBody', { requestId }).then((response) => {
        if (settled) return;
        const body = response.base64Encoded
          ? new TextDecoder().decode(Uint8Array.from(atob(response.body), (char) => char.charCodeAt(0)))
          : response.body;
        const asset = parseUploadResult(body, request.project_id);
        if (asset) finish({ ok: true, ...asset });
      }).catch(() => {});
    }
  };
  const onDetach = (source) => {
    if (source.tabId === tabId && !settled) {
      finish({ ok: false, error: 'FLOW_UI: Chrome detached during the native video upload. Check Flow before retrying.' });
    }
  };
  const uploadRequests = new Set();

  try {
    await chrome.debugger.attach(target, '1.3');
    attached = true;
    chrome.debugger.onEvent.addListener(onEvent);
    chrome.debugger.onDetach.addListener(onDetach);
    await command('Network.enable', { maxResourceBufferSize: 5 * 1024 * 1024, maxTotalBufferSize: 12 * 1024 * 1024 });
    await command('Page.enable');
    await command('DOM.enable');
    await command('Page.setInterceptFileChooserDialog', { enabled: true, cancel: false });
    await chrome.scripting.executeScript({ target, world: 'MAIN', func: videoUploadUiStep, args: ['lock', request] });

    const chooserPromise = new Promise((resolve, reject) => {
      pendingChooser = {
        resolve,
        reject,
        timer: setTimeout(() => {
          if (pendingChooser) pendingChooser = null;
          reject(new Error('Flow did not open the video file chooser.'));
        }, 15000),
      };
    });
    await click(await step('openPicker'));
    await click(await step('upload'));
    await chooserPromise;

    timeout = setTimeout(() => finish({
      ok: false,
      error: 'FLOW_UI: Timed out waiting for Flow to finish uploading the reference video. No video generation was submitted.',
    }), 210000);
    const result = await completion;
    if (result.ok) await sleep(500);
    return result;
  } catch (error) {
    return { ok: false, error: `FLOW_UI: ${error?.message || 'Could not upload the reference video through Flow.'}` };
  } finally {
    settled = true;
    clearTimeout(timeout);
    if (pendingChooser) clearTimeout(pendingChooser.timer);
    chrome.debugger.onEvent.removeListener(onEvent);
    chrome.debugger.onDetach.removeListener(onDetach);
    if (attached) {
      await command('Page.setInterceptFileChooserDialog', { enabled: false }).catch(() => {});
      await chrome.debugger.detach(target).catch(() => {});
      attached = false;
    }
    await chrome.scripting.executeScript({ target, world: 'MAIN', func: videoUploadUiStep, args: ['unlock', request] }).catch(() => {});
  }
}
