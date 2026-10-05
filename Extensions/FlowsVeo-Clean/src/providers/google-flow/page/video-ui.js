// Serializable: chrome.scripting runs this function without module scope.
export function videoUiStep(action, request) {
  try {
    const fail = (message) => { throw new Error(message); };
    if (action === 'unlock') { document.documentElement.removeAttribute('data-flowsveo-video-until'); return true; }
    if (location.hostname !== 'flow.google.com'
        || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== request.project_id) {
      fail('Tab Flow đã chuyển project. Chọn lại project rồi thử lại.');
    }
    const visible = (el) => el && el.getBoundingClientRect().width > 0
      && el.getBoundingClientRect().height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
    if (action === 'lock') { document.documentElement.setAttribute('data-flowsveo-video-until', String(Date.now() + 180_000)); return true; }

    const text = (el) => {
      const copy = el.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"]').forEach((icon) => icon.remove());
      return copy.textContent.replace(/🍌/gu, '').replace(/\s+/g, ' ').trim();
    };
    const find = (selector, predicate) => [...document.querySelectorAll(selector)].find((el) => visible(el) && predicate(el));
    const point = (el) => {
      if (!el) fail('Không tìm thấy điều khiển tạo video trên Flow. Tải lại tab Flow rồi thử lại.');
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') fail('Điều khiển trên Flow chưa sẵn sàng.');
      el.scrollIntoView({ block: 'nearest' });
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2, y = r.top + r.height / 2;
      if (!el.contains(document.elementFromPoint(x, y))) fail('Có cửa sổ đang che điều khiển Flow. Đóng cửa sổ đó rồi thử lại.');
      return { x, y };
    };

    const settings = () => find('button.settings-trigger-button', () => true)
      || find('button', (el) => /^(Điều kiện kích hoạt cài đặt|Settings trigger)$/i.test(el.getAttribute('aria-label') || ''));

    const radio = (pattern) => find('[role="radio"]', (el) => {
      const t = text(el);
      if (pattern instanceof RegExp) return pattern.test(t);
      return t === pattern || t.includes(pattern);
    });

    const isDrawerOpen = () => Boolean(radio(/video/i) || radio('16:9') || radio('9:16') || radio(/giây|sec/i) || radio('x1') || radio('x2') || radio('x4'));

    const modelName = request.model_display_name || 'Omni 1.1 Flash';
    const aspect = request.aspect_ratio || '16:9';
    const dur = Number(request.duration_seconds) || 6;
    const res = request.resolution || '720p';
    const targetCount = Number(request.num_outputs || request.count || 1);
    const flowCount = targetCount === 3 ? 4 : (targetCount > 4 ? 4 : targetCount);

    if (action === 'closeAccount') {
      const close = find('button', (el) => /^(Đóng bảng điều khiển tài khoản|Close account panel)$/i.test(el.getAttribute('aria-label') || ''));
      return close ? point(close) : null;
    }

    if (action === 'checkConfig') {
      const targetConfig = `video_${modelName}_${aspect}_${dur}s_${res}_x${flowCount}`;
      const configured = document.documentElement.getAttribute('data-flowsveo-video-configured');
      const s = settings();
      const st = s ? text(s) : '';
      const open = isDrawerOpen();
      // Nếu drawer đang đóng và cấu hình trước đó đã khớp, bỏ qua mở drawer
      if (!open && configured === targetConfig && (st.includes(modelName) || st.includes(aspect))) {
        return { needsConfig: false };
      }
      return { needsConfig: true };
    }

    if (action === 'openSettings' || action === 'closeSettings') {
      const open = isDrawerOpen();
      return open === (action === 'openSettings') ? null : point(settings());
    }

    if (action === 'mode') {
      const el = radio(/^video$/i) || radio(/video/i);
      return el?.getAttribute('aria-checked') === 'true' ? null : point(el);
    }

    if (action === 'aspect') {
      const el = radio(aspect);
      if (!el) return null;
      return el.getAttribute('aria-checked') === 'true' ? null : point(el);
    }

    if (action === 'resolution') {
      const el = radio(new RegExp(`^${res}`, 'i'));
      if (!el) return null;
      return el.getAttribute('aria-checked') === 'true' ? null : point(el);
    }

    if (action === 'duration') {
      const el = radio(new RegExp(`^${dur}\\s*(giây|s|sec)`, 'i')) || radio(String(dur));
      if (!el) return null;
      return el.getAttribute('aria-checked') === 'true' ? null : point(el);
    }

    if (action === 'count') {
      const el = radio(new RegExp(`^(x?${flowCount})$`, 'i'))
        || radio(`x${flowCount}`)
        || radio(String(flowCount))
        || (flowCount !== 1 ? radio('x1') : null);
      if (!el) return null;
      return el.getAttribute('aria-checked') === 'true' ? null : point(el);
    }

    if (action === 'modelMenu') {
      const btn = find('button[aria-haspopup="menu"]', (el) =>
        /^(Chọn nhóm mô hình|Select model family|Select model)$/i.test(el.getAttribute('aria-label') || ''));
      if (!btn) return null;
      // Nếu nút model đã hiển thị tên model yêu cầu, không cần mở menu
      if (text(btn).includes(modelName)) return null;
      return point(btn);
    }

    if (action === 'model') {
      const item = find('[role="menuitem"]', (el) => text(el).includes(modelName));
      return item ? point(item) : null;
    }

    if (action === 'verify') {
      const modeRadio = radio(/video/i);
      const aspectRadio = radio(aspect);
      const durRadio = radio(new RegExp(`^${dur}\\s*(giây|s|sec)`, 'i')) || radio(String(dur));
      const countRadio = radio(new RegExp(`^(x?${flowCount})$`, 'i')) || radio(`x${flowCount}`) || radio(String(flowCount));

      if (modeRadio && modeRadio.getAttribute('aria-checked') !== 'true') {
        fail('Chưa chọn được chế độ Video trên Flow.');
      }
      if (aspectRadio && aspectRadio.getAttribute('aria-checked') !== 'true') {
        fail(`Chưa chọn được tỷ lệ khung hình ${aspect} trên Flow.`);
      }
      if (durRadio && durRadio.getAttribute('aria-checked') !== 'true') {
        fail(`Chưa chọn được thời lượng ${dur}s trên Flow.`);
      }
      if (countRadio && countRadio.getAttribute('aria-checked') !== 'true') {
        fail(`Chưa chọn được số lượng video x${flowCount} trên Flow.`);
      }

      const agent = find('button.agent-mode-chip', () => true);
      if (agent?.getAttribute('aria-pressed') === 'true') fail('Hãy tắt chế độ Tác nhân trên Flow trước khi tạo video từ app.');

      const targetConfig = `video_${modelName}_${aspect}_${dur}s_${res}_x${flowCount}`;
      document.documentElement.setAttribute('data-flowsveo-video-configured', targetConfig);
      return true;
    }

    const editor = () => {
      const editors = [...document.querySelectorAll('[contenteditable="true"]')].filter(visible);
      if (editors.length !== 1) fail('Không xác định được ô prompt Flow. Hãy mở màn hình dự án.');
      return editors[0];
    };

    const frameChips = () => [...document.querySelectorAll('button[aria-label*="Thành phần tạo hình ảnh"], button[aria-label*="image ingredient" i]')].filter(visible);
    const frameMediaIds = () => frameChips().map((chip) => {
      const sources = [...chip.querySelectorAll('img')].map((img) => img.currentSrc || img.src);
      for (const source of sources) {
        const match = source.match(/\/image\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})(?:[/?#]|$)/i);
        if (match) return match[1];
      }
      return null;
    });

    if (action === 'framePreflight') {
      const ids = frameMediaIds();
      if (ids.length) fail('Flow composer already contains image attachments. Remove them before starting this app job.');
      return { count: 0, ids };
    }

    if (action === 'openStartFrame' || action === 'openEndFrame') {
      const isStart = action === 'openStartFrame';
      const label = isStart ? /^(Bắt đầu|Start|Khung hình bắt đầu)(\b|$)/i
        : /^(Kết thúc|End|Khung hình kết thúc)(\b|$)/i;
      const el = find('button.empty-chip', (button) => label.test(text(button)) || label.test(button.getAttribute('aria-label') || ''))
        || find('button', (button) => label.test(text(button)) || label.test(button.getAttribute('aria-label') || ''));
      return point(el);
    }

    if (action === 'openImageUpload') {
      const el = find('button', (button) => /Tải nội dung nghe nhìn lên|Upload media|Upload files/i.test(text(button)));
      return point(el);
    }

    if (action === 'uploadedAsset') {
      const filename = String(request._upload_filename || '').trim();
      if (!filename) fail('Missing local image filename for Flow upload.');
      const asset = find('[role="option"],button,[role="button"]', (el) => text(el).includes(filename));
      return asset ? { ready: true, point: point(asset) } : { ready: false };
    }

    if (action === 'addImageToPrompt') {
      const el = find('button', (button) => /Thêm vào câu lệnh|Add to prompt/i.test(text(button)));
      return point(el);
    }

    if (action === 'frameStatus') {
      const ids = frameMediaIds();
      return { count: ids.length, ids };
    }

    if (action === 'fill') {
      const el = editor();
      if (el.querySelector('img,[contenteditable="false"]')) fail('Hãy bỏ ảnh/thành phần đính kèm khỏi ô prompt Flow trước.');
      el.focus();
      try {
        document.execCommand('selectAll', false, null);
        document.execCommand('delete', false, null);
      } catch { }
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
      if (editor().innerText.trim() !== request.prompt.trim()) fail('Prompt trên Flow không khớp yêu cầu. Chưa tạo video.');
      return point(find('button', (el) => /^(Bắt đầu tạo|Start generation|Generate|Start creating)$/i.test(el.getAttribute('aria-label') || '')));
    }

    fail('Unknown Flow video UI step');
  } catch (error) {
    return { error: error?.message || 'Không đọc được giao diện Flow.' };
  }
}
