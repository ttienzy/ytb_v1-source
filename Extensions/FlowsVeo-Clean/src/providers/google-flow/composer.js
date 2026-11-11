import { logActivity } from '../../background/runtime/log.js';
import { sleep } from '../../shared/time.js';
import { warmUpRecaptcha } from './recaptcha-probe.js';
import { waitForTabComplete } from './tabs.js';

// Chạy trong trang Flow (serializable). Một lượt lỗi giữa chừng để lại ảnh đính kèm / prompt trong ô soạn;
// lượt sau gặp ô soạn bẩn sẽ bị chặn ("Save or clear the existing Flow draft", "bỏ ảnh đính kèm"...).
export function inspectComposerInPage(clearPrompt) {
  const visible = (e) => e && e.getBoundingClientRect().width > 0 && e.getBoundingClientRect().height > 0;
  const chips = [...document.querySelectorAll(
    '.base-prompt-box flow-image-ingredient-chip, button[aria-label*="Thành phần tạo hình ảnh"], button[aria-label*="image ingredient" i]',
  )].filter(visible);
  // Ô trống (khe Start/End frame) không phải nháp; chỉ tính chip có ảnh thật.
  const attachments = chips.filter((chip) => {
    if (chip.querySelector('button.empty-chip')) return false;
    const img = chip.querySelector('img');
    const src = img ? (img.currentSrc || img.src || '') : '';
    return Boolean(img && visible(img) && src && !src.includes('gstatic.com') && !src.includes('google.com/static') && !src.startsWith('data:image/svg'));
  }).length;
  const editors = [...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
  const editor = editors.length === 1 ? editors[0] : null;
  const hadPrompt = Boolean(editor && editor.innerText.trim());
  if (clearPrompt && hadPrompt) {
    editor.focus();
    try {
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
    } catch { }
  }
  return { attachments, hadPrompt };
}

export async function ensureCleanComposer(tabId) {
  try {
    const run = (clearPrompt) => chrome.scripting.executeScript({ target: { tabId }, world: 'MAIN', func: inspectComposerInPage, args: [clearPrompt] })
      .then((r) => r?.[0]?.result);
    const state = await run(false);
    if (!state) return;
    if (state.attachments > 0) {
      logActivity('info', `Ô soạn Flow còn ${state.attachments} ảnh đính kèm từ lượt trước — tải lại tab để xóa nháp`);
      await chrome.tabs.reload(tabId);
      await waitForTabComplete(tabId, 20000);
      await sleep(3000);
      await warmUpRecaptcha(tabId, 6000);
      return;
    }
    if (state.hadPrompt) {
      logActivity('info', 'Ô soạn Flow còn prompt từ lượt trước — đã xóa');
      await run(true);
    }
  } catch (error) {
    logActivity('warn', `ensureCleanComposer: ${error?.message || error}`);
  }
}
