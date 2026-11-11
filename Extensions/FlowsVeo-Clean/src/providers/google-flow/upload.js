import { runVideoUploadInPage } from './page/upload.js';
import { ensureProjectTab } from './tabs.js';

/**
 * Tải video mẫu lên Flow bằng HTTP (resumable upload: start rồi "upload, finalize"), chạy trong tab project.
 * Không bấm giao diện và không cần token reCAPTCHA (HAR flow.google_image.har: request upload không mang token).
 * Tải lên không tốn credit. Video còn ở trạng thái "đang xử lý" sau khi tải; bước tạo video tự đợi nó sẵn sàng.
 */
export async function uploadVideoToFlow(request) {
  const targetPid = request.project_id || null;
  if (!targetPid) return { ok: false, error: 'Chọn Flow project trước khi tải video mẫu lên.' };
  const tabId = await ensureProjectTab(targetPid, { flowOnly: true });
  if (!tabId) return { ok: false, error: 'Không mở được Flow project để tải video mẫu lên.' };

  try {
    const injected = await chrome.scripting.executeScript({
      target: { tabId }, world: 'MAIN', func: runVideoUploadInPage,
      args: [request],
    });
    return injected?.[0]?.result || { ok: false, error: 'Flow page returned no result for video upload' };
  } catch (error) {
    return { ok: false, error: `Cannot execute video upload: ${error.message}` };
  }
}
