export async function runVideoUploadInPage(uploadRequest) {
  try {
    const { video_base64, video_mime, video_filename, project_id, force_fresh } = uploadRequest;
    if (!video_base64) throw new Error('video_base64 is required');

    const projectId = location.pathname.match(/\/project\/([^/?#]+)/)?.[1] || null;
    if (!projectId) throw new Error('Vui lòng mở một Project trên tab Google Flow');

    const accountPath = location.pathname.match(/\/(u\/\d+)/)?.[0] || '';
    const authUser = accountPath.match(/\d+/)?.[0] || '';
    const targetPid = project_id || projectId;
    if (targetPid !== projectId) {
      throw new Error(`Tab Flow đang mở project ${projectId}, không phải project ${targetPid}`);
    }

    const rawBase64 = video_base64.includes(',') ? video_base64.split(',')[1] : video_base64;
    const mimeType = video_mime || 'video/mp4';
    const filename = video_filename || 'reference_video.mp4';

    const cache = (typeof window !== 'undefined' ? window : globalThis).__FLOW_MEDIA_CACHE__ ||
      ((typeof window !== 'undefined' ? window : globalThis).__FLOW_MEDIA_CACHE__ = new Map());
    const cacheKey = `vid:${targetPid}:${rawBase64.slice(0, 64)}:${rawBase64.length}:${filename}`;

    if (!force_fresh && cache.has(cacheKey)) {
      const cached = cache.get(cacheKey);
      return {
        ...cached,
        ok: true,
        cached: true,
      };
    }

    const binary = atob(rawBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

    const base = location.origin || 'https://flow.google.com';
    const startUrl = `${base}/upload/v1/flow/upload/video/${encodeURIComponent(targetPid)}${authUser ? `?authuser=${authUser}` : ''}`;
    const startResponse = await fetch(startUrl, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
        'Slug': filename,
        'X-Goog-Upload-Command': 'start',
        'X-Goog-Upload-Header-Content-Length': String(bytes.byteLength),
        'X-Goog-Upload-Protocol': 'resumable',
        ...(authUser ? { 'X-Goog-AuthUser': authUser } : {}),
      },
    });
    if (!startResponse.ok) {
      const preview = await startResponse.text().catch(() => '');
      throw new Error(`Flow video upload start failed HTTP ${startResponse.status}: ${preview.slice(0, 200)}`);
    }

    const uploadUrl = startResponse.headers.get('x-goog-upload-url');
    if (!uploadUrl) throw new Error('Flow video upload start response is missing x-goog-upload-url');

    const finalizeResponse = await fetch(uploadUrl, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded;charset=utf-8',
        'Slug': filename,
        'X-Goog-Upload-Command': 'upload, finalize',
        'X-Goog-Upload-Offset': '0',
        ...(authUser ? { 'X-Goog-AuthUser': authUser } : {}),
      },
      body: bytes,
    });
    const responseText = await finalizeResponse.text();
    if (!finalizeResponse.ok) {
      throw new Error(`Flow video upload finalize failed HTTP ${finalizeResponse.status}: ${responseText.slice(0, 300)}`);
    }

    let uploaded;
    try {
      uploaded = JSON.parse(responseText);
    } catch {
      throw new Error(`Flow video upload returned invalid JSON: ${responseText.slice(0, 300)}`);
    }
    const mediaId = uploaded?.mediaId || uploaded?.media?.name || null;
    if (!mediaId) throw new Error(`Flow video upload response has no mediaId: ${responseText.slice(0, 300)}`);

    const result = {
      ok: true,
      media_id: mediaId,
      project_id: uploaded?.media?.projectId || targetPid,
      workflow_id: uploaded?.workflow?.name || uploaded?.media?.workflowId || null,
      filename,
      mime_type: mimeType,
    };

    cache.set(cacheKey, {
      media_id: mediaId,
      project_id: result.project_id,
      workflow_id: result.workflow_id,
      filename,
      mime_type: mimeType,
    });

    return result;
  } catch (err) {
    return { ok: false, error: err?.message || String(err) };
  }
}
