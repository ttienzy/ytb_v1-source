// Serializable: chrome.scripting runs this function without module scope.
export function imageUiStep(action, request) {
  try {
  const fail = (message) => { throw new Error(message); };
  if (action === 'unlock') { document.documentElement.removeAttribute('data-flowsveo-image-until'); return true; }
  if (location.hostname !== 'flow.google.com'
      || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== request.project_id) {
    fail('Tab Flow đã chuyển project. Chọn lại project rồi thử lại.');
  }
  const visible = (el) => el && el.getBoundingClientRect().width > 0
    && el.getBoundingClientRect().height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
  if (action === 'lock') { document.documentElement.setAttribute('data-flowsveo-image-until', String(Date.now() + 140_000)); return true; }
  const text = (el) => {
    const copy = el.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((icon) => icon.remove());
    return copy.textContent.replace(/🍌/gu, '').replace(/\s+/g, ' ').trim();
  };
  const find = (selector, predicate) => [...document.querySelectorAll(selector)].find((el) => visible(el) && predicate(el));
  const point = (el) => {
    if (!el) fail('Không tìm thấy điều khiển tạo ảnh trên Flow. Tải lại tab Flow rồi thử lại.');
    if (el.disabled || el.getAttribute('aria-disabled') === 'true') fail('Điều khiển trên Flow chưa sẵn sàng.');
    el.scrollIntoView({ block: 'nearest' });
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (!el.contains(document.elementFromPoint(x, y))) fail('Có cửa sổ đang che điều khiển Flow. Đóng cửa sổ đó rồi thử lại.');
    return { x, y };
  };
  const settings = () => find('button.settings-trigger-button', () => true)
    || find('button', (el) => /^(Điều kiện kích hoạt cài đặt|Settings trigger)$/i.test(el.getAttribute('aria-label') || ''));
  const radio = (name) => find('[role="radio"]', (el) => text(el) === name);
  const models = { GEM_PIX_2: 'Nano Banana Pro', NARWHAL: 'Nano Banana 2', HARBOR_SEAL: 'Nano Banana 2 Lite' };
  const modelName = models[request.model_key];
  const editor = () => {
    const editors = [...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
    if (editors.length !== 1) fail('Không xác định được ô prompt Flow. Hãy mở màn hình tạo ảnh của project.');
    return editors[0];
  };
  if (action === 'closeAccount') {
    const close = find('button', (el) => /^(Đóng bảng điều khiển tài khoản|Close account panel)$/i.test(el.getAttribute('aria-label') || ''));
    return close ? point(close) : null;
  }
  const isDrawerOpen = () => Boolean(radio('16:9') || radio('x1') || radio('x2') || radio('x4'));

  if (action === 'checkConfig') {
    const targetCount = request.count || 1;
    const flowCount = targetCount === 3 ? 4 : targetCount;
    const targetConfig = `${request.model_key}_${request.aspect_ratio}_x${flowCount}`;
    const configured = document.documentElement.getAttribute('data-flowsveo-image-configured');
    const s = settings();
    const st = s ? text(s) : '';
    const open = isDrawerOpen();
    if (!open && configured === targetConfig && st.includes(modelName)) {
      return { needsConfig: false };
    }
    return { needsConfig: true };
  }
  if (action === 'openSettings' || action === 'closeSettings') {
    const open = isDrawerOpen();
    return open === (action === 'openSettings') ? null : point(settings());
  }
  if (action === 'mode') {
    const el = radio('Hình ảnh') || radio('Image') || radio('Images');
    return el?.getAttribute('aria-checked') === 'true' ? null : point(el);
  }
  if (action === 'aspect') {
    const el = radio(request.aspect_ratio);
    return el?.getAttribute('aria-checked') === 'true' ? null : point(el);
  }
  if (action === 'count') {
    const targetCount = request.count || 1;
    const flowCount = targetCount === 3 ? 4 : targetCount;
    const el = radio(`x${flowCount}`) || radio(String(flowCount)) || radio('x1');
    return el?.getAttribute('aria-checked') === 'true' ? null : point(el);
  }
  if (action === 'modelMenu') return point(find('button[aria-haspopup="menu"]', (el) =>
    /^(Chọn nhóm mô hình|Select model family|Select model)$/i.test(el.getAttribute('aria-label') || '')));
  if (action === 'model') return point(find('[role="menuitem"]', (el) => text(el) === modelName));
  if (action === 'verify') {
    const targetCount = request.count || 1;
    const flowCount = targetCount === 3 ? 4 : targetCount;
    const countRadio = radio(`x${flowCount}`) || radio(String(flowCount)) || radio('x1');
    const countChecked = countRadio?.getAttribute('aria-checked') === 'true';

    if (!modelName || !settings() || !text(settings()).includes(modelName)
        || radio(request.aspect_ratio)?.getAttribute('aria-checked') !== 'true'
        || (!countChecked && flowCount === 1)) {
      fail('Không xác nhận được model, tỷ lệ hoặc số ảnh trên Flow. Chưa gửi yêu cầu tạo ảnh.');
    }
    const agent = find('button.agent-mode-chip', () => true);
    if (agent?.getAttribute('aria-pressed') === 'true') fail('Hãy tắt chế độ Tác nhân trên Flow trước khi tạo ảnh từ app.');
    document.documentElement.setAttribute('data-flowsveo-image-configured', `${request.model_key}_${request.aspect_ratio}_x${flowCount}`);
    return true;
  }
  if (action === 'fill') {
    const el = editor();
    if (el.querySelector('img,[contenteditable="false"]')) fail('Hãy bỏ ảnh/thành phần đính kèm khỏi ô prompt Flow trước.');
    el.focus();
    const range = document.createRange();
    range.selectNodeContents(el);
    const selection = window.getSelection();
    selection.removeAllRanges();
    selection.addRange(range);
    if (!document.execCommand('insertText', false, request.prompt.trim())) {
      el.innerText = request.prompt.trim();
    }
    try {
      el.dispatchEvent(new window.Event('input', { bubbles: true }));
      el.dispatchEvent(new window.Event('change', { bubbles: true }));
    } catch { }
    return true;
  }
  if (action === 'generateReady') {
    const btn = find('button', (el) => /^(Bắt đầu tạo|Start generation|Generate|Start creating)$/i.test(el.getAttribute('aria-label') || ''));
    if (!btn || btn.disabled || btn.getAttribute('aria-disabled') === 'true') {
      return { ready: false };
    }
    try {
      return { ready: true, point: point(btn) };
    } catch {
      return { ready: false };
    }
  }
  if (action === 'generate') {
    if (editor().innerText.trim() !== request.prompt.trim()) fail('Prompt trên Flow không khớp yêu cầu. Chưa tạo ảnh.');
    return point(find('button', (el) => /^(Bắt đầu tạo|Start generation|Generate|Start creating)$/i.test(el.getAttribute('aria-label') || '')));
  }
  fail('Unknown Flow image UI step');
  } catch (error) {
    return { error: error?.message || 'Không đọc được giao diện Flow.' };
  }
}
