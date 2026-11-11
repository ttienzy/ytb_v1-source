// Serializable helpers executed in Flow's main page.
export async function readMotionAssetCatalog(projectId) {
  try {
    if (location.hostname !== 'flow.google.com' || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== projectId) {
      throw new Error('Flow tab changed project.');
    }
    const wiz = window.WIZ_global_data || {};
    if (!wiz.SNlM0e || !wiz.FdrFJe || !wiz.cfb2h) throw new Error('Flow session metadata is unavailable.');
    const rpc = 'Zzl0ze';
    const query = new URLSearchParams({ rpcids: rpc, 'source-path': location.pathname,
      bl: wiz.cfb2h, 'f.sid': wiz.FdrFJe, hl: document.documentElement.lang || 'vi',
      _reqid: String(Math.floor(100000 + Math.random() * 900000)), rt: 'c' });
    const body = new URLSearchParams({ at: wiz.SNlM0e,
      'f.req': JSON.stringify([[[rpc, JSON.stringify([`projects/${projectId}`, null, null, null, [1]]), null, 'generic']]]) });
    const response = await fetch(`${location.origin}/_/AiSandboxAngularFrontend/data/batchexecute?${query}`, {
      method: 'POST', credentials: 'include', cache: 'no-store',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8', 'X-Same-Domain': '1' }, body: body.toString(),
    });
    if (!response.ok) throw new Error(`Flow asset catalog returned HTTP ${response.status}.`);
    const raw = await response.text();
    const envelope = (node) => {
      if (!Array.isArray(node)) return null;
      if (node[0] === 'wrb.fr' && node[1] === rpc && typeof node[2] === 'string') return JSON.parse(node[2]);
      for (const child of node) { const result = envelope(child); if (result) return result; }
      return null;
    };
    let data = null;
    for (const line of raw.split(/\r?\n/)) {
      if (!line.trim().startsWith('[')) continue;
      try { data = envelope(JSON.parse(line)); } catch { continue; }
      if (data) break;
    }
    if (!Array.isArray(data?.[2])) throw new Error('Flow returned no asset catalog.');
    // Only map each asset's own thumbnails, not URLs/IDs of its source ingredients.
    return { assets: data[2].filter((asset) => asset?.[1] === projectId).map((asset) => ({
      id: asset[0], thumbnails: [asset?.[5]?.[5], asset?.[5]?.[10]].filter((url) => typeof url === 'string' && url.startsWith('https://')),
    })) };
  } catch (error) { return { error: error.message || 'Could not read the Flow asset catalog.' }; }
}

export function motionUiStep(action, req) {
  try {
    const fail = (message) => { throw new Error(message); };
    if (location.hostname !== 'flow.google.com'
        || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== req.project_id) {
      fail('Flow tab changed project.');
    }
    const visible = (el) => el && el.getBoundingClientRect().width > 0
      && el.getBoundingClientRect().height > 0 && window.getComputedStyle(el).visibility !== 'hidden';
    const norm = (value) => String(value || '').normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '').replace(/\u0111/gi, 'd').replace(/\s+/gu, ' ').trim().toLowerCase();
    // Tên model khớp theo TỪNG TỪ: Flow ghi "Omni Flash 1.2" còn app gọi "Omni 1.2 Flash"; "1.2" vẫn phân biệt với "1.1".
    const sameModel = (value) => {
      const words = norm(req.model_display_name).split(' ').filter(Boolean);
      const have = new Set(String(value || '').split(/\s+/));
      return words.length > 0 && words.every((w) => have.has(w));
    };
    const text = (el) => {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('[aria-hidden="true"]').forEach((item) => item.remove());
      return norm(clone.innerText || clone.textContent);
    };
    const label = (el) => norm(el?.getAttribute('aria-label')) || text(el);
    const find = (selector, predicate) => [...document.querySelectorAll(selector)].find((el) => visible(el) && predicate(el));
    const point = (el) => {
      if (!el) fail(`Flow control not found: ${action}`);
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') fail(`Flow control is disabled: ${action}`);
      el.scrollIntoView({ block: 'nearest' });
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      const topEl = document.elementFromPoint(x, y);
      if (topEl && !el.contains(topEl) && !topEl.contains(el)) {
        fail(`Flow control is covered: ${action} by ${topEl.tagName}.${String(topEl.className || '').slice(0, 140)}`);
      }
      return { x, y };
    };
    const radio = (pattern) => find('[role="radio"]', (el) => {
      const actual = text(el);
      return pattern instanceof RegExp ? pattern.test(actual) : actual === norm(pattern) || actual.includes(norm(pattern));
    });
    const modelButton = () => find('button[aria-haspopup="menu"]', (el) =>
      /^(chon nhom mo hinh|select model family|select model)$/.test(label(el)));
    const editor = () => {
      const editors = [...document.querySelectorAll('.base-prompt-box [contenteditable="true"]')].filter(visible);
      if (editors.length !== 1) fail('Open the Flow project prompt editor before using Motion Control.');
      return editors[0];
    };
    const videoChips = () => [
      ...document.querySelectorAll(
        '.base-prompt-box flow-video-ingredient-chip, .base-prompt-box [class*="video-ingredient"]'
      ),
    ].filter((el, index, all) => visible(el) && !all.some((other) => other !== el && other.contains(el)));
    const imageChips = () => [
      ...document.querySelectorAll(
        '.base-prompt-box flow-image-ingredient-chip, .base-prompt-box [class*="image-ingredient"]'
      ),
    ].filter((el, index, all) => visible(el) && !all.some((other) => other !== el && other.contains(el)));
    const mediaId = (el) => {
      const thumbnailKey = (url) => {
        try {
          const parsed = new URL(url);
          const path = parsed.pathname.replace(/=s\d+[^/]*$/, '');
          // Flow proxies the same opaque Google thumbnail under its own origin.
          if (path.startsWith('/asb/') && ['flow.google.com', 'lh3.googleusercontent.com'].includes(parsed.hostname)) return path;
          return parsed.origin + path;
        } catch { return null; }
      };
      for (const img of el?.querySelectorAll('img, video') || []) {
        for (const src of [img.src, img.currentSrc]) {
        try {
          const match = new URL(src).pathname.match(/\/(?:image|video)\/([0-9a-f-]{36})(?:\/|$)/i);
          if (match) return match[1];
          const key = thumbnailKey(src);
          const matches = (req.asset_catalog || []).filter((asset) => asset.thumbnails.some((url) => thumbnailKey(url) === key));
          if (matches.length === 1) return matches[0].id;
        } catch { /* Ignore non-URL thumbnail placeholders. */ }
        }
      }
      return null;
    };
    const assetOptions = () => [...document.querySelectorAll('[role="option"].asset-item')].filter(visible);
    const addButton = () => find('button.detail-add-to-prompt-btn', () => true)
      || find('button:not(.add-menu-trigger)', (el) => /^(them vao cau lenh|add to prompt)$/.test(label(el)));

    if (action === 'unlock') {
      document.documentElement.removeAttribute('data-flowsveo-motion-until');
      return true;
    }
    if (action === 'dismissBackdrop') {
      const backdrop = find('.cdk-overlay-backdrop.cdk-overlay-transparent-backdrop', () => true);
      if (!backdrop) return null;
      const rect = backdrop.getBoundingClientRect();
      for (const [x, y] of [[rect.left + 8, rect.top + 8], [rect.right - 8, rect.top + 8], [rect.left + 8, rect.bottom - 8]]) {
        if (document.elementFromPoint(x, y) === backdrop) return { x, y };
      }
      return null;
    }
    if (action === 'lock') {
      document.documentElement.setAttribute('data-flowsveo-motion-until', String(Date.now() + 1080000));
      return true;
    }
    if (action === 'closeAccount') {
      const close = find('button', (el) => /^(dong bang dieu khien tai khoan|close account panel)$/.test(label(el)));
      return close ? point(close) : null;
    }
    if (action === 'preflight') {
      const clearBtn = find('.base-prompt-box button.clear-button', () => true);
      if (clearBtn) {
        clearBtn.click();
      }
      try {
        const ed = editor();
        if (ed && ed.innerText.trim()) {
          ed.focus();
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
        }
      } catch { }
      return true;
    }
    if (action === 'removeIngredient') {
      const chip = [...videoChips(), ...imageChips()][0];
      if (!chip) return null;
      return point(chip.querySelector('.hover-icon-overlay') || chip.querySelector('button[aria-label*="remove" i]'));
    }
    if (action === 'openSettings' || action === 'closeSettings') {
      const isOpen = Boolean(radio('x1'));
      return isOpen === (action === 'openSettings') ? null : point(find('button.settings-trigger-button', () => true));
    }
    if (action === 'mode' || action === 'ingredients' || action === 'aspect'
        || action === 'resolution' || action === 'duration' || action === 'count') {
      const selected = action === 'mode' ? radio('Video')
        : action === 'ingredients' ? (radio('Thành phần') || radio('Ingredients'))
          : action === 'aspect' ? radio(req.aspect_ratio)
            : action === 'resolution' ? radio(req.resolution)
              : action === 'duration'
                ? radio(new RegExp(`^${Number(req.duration_seconds)}\\s*(giay|s|sec|seconds?)`, 'i')) || radio(String(req.duration_seconds))
                : radio('x1');
      return selected?.getAttribute('aria-checked') === 'true' ? null : point(selected);
    }
    if (action === 'modelMenu') {
      const button = modelButton();
      return button && sameModel(text(button)) ? null : point(button);
    }
    if (action === 'model') {
      const button = modelButton();
      if (button && sameModel(text(button))) return null;
      const option = find('[role="menuitem"]', (el) => sameModel(text(el)));
      return option ? point(option) : null;
    }
    if (action === 'verifySettings') {
      const videoRadio = radio('Video');
      const ingredientsRadio = radio('Thành phần') || radio('Ingredients');
      const aspectRadio = radio(req.aspect_ratio);
      const resolutionRadio = radio(req.resolution);
      // Motion Control (video_edit) does not have a duration selector; skip if not present
      const durationRadio = radio(new RegExp(`^${Number(req.duration_seconds)}\\s*(giay|s|sec|seconds?)`, 'i')) || radio(String(req.duration_seconds));
      const countRadio = radio('x1');
      const choices = [videoRadio, ingredientsRadio, aspectRadio, resolutionRadio, countRadio];
      const labels = ['Video mode', 'Ingredients sub-mode', `Aspect ${req.aspect_ratio}`, `Resolution ${req.resolution}`, 'Count x1'];
      // Only include duration check if a duration radio actually exists on screen
      if (durationRadio) {
        choices.push(durationRadio);
        labels.push(`Duration ${req.duration_seconds}s`);
      }
      const mismatches = labels.filter((_, i) => choices[i]?.getAttribute('aria-checked') !== 'true');
      const modelOk = modelButton() && sameModel(text(modelButton()));
      if (mismatches.length > 0 || !modelOk) {
        const diagParts = [];
        if (!modelOk) diagParts.push(`Model button not showing "${req.model_display_name}"`);
        diagParts.push(...mismatches.map(l => `${l} not selected`));
        fail(`Flow settings mismatch: ${diagParts.join('; ')}`);
      }
      if (find('button.agent-mode-chip[aria-pressed="true"]', () => true)) fail('Turn off Agent mode in Flow before creating this video.');
      return true;
    }
    if (action === 'fill') {
      const target = editor();
      target.focus();
      document.execCommand('selectAll', false, null);
      document.execCommand('delete', false, null);
      if (!document.execCommand('insertText', false, req.prompt.trim())) fail('Could not fill the Flow prompt.');
      return true;
    }
    if (action === 'promptText') {
      const clone = editor().cloneNode(true);
      clone.querySelectorAll('flow-video-ingredient-chip,flow-image-ingredient-chip').forEach((chip) => chip.remove());
      // Preserve wording, case and accents; normalize only editor whitespace.
      return String(clone.innerText || clone.textContent || '').replace(/\s+/gu, ' ').trim();
    }
    if (action === 'openPicker' || action === 'ensurePicker') {
      if (action === 'ensurePicker' && assetOptions().length) return null;
      return point(find('.base-prompt-box button.add-menu-trigger', () => true));
    }
    if (action === 'uploadImage') {
      const button = find('button,[role="button"]', (el) =>
        /tai noi dung nghe nhin len|upload media|upload files/.test(label(el)));
      return point(button);
    }
    if (action === 'assetKeys') {
      return assetOptions().map((el) => mediaId(el) || norm(el.querySelector('.asset-title')?.innerText || el.innerText)).filter(Boolean);
    }
    if (action === 'activeAssetIds') return assetOptions().filter(el => el.classList.contains('asset-item-active')).map(mediaId);
    if (action === 'resetPicker' || action === 'seekAsset') {
      const options = assetOptions();
      if (action === 'seekAsset' && options.some(el => mediaId(el) === req.media_id)) return true;
      let scroller = options[0]?.parentElement;
      while (scroller && scroller !== document.body && !(scroller.scrollHeight > scroller.clientHeight + 2
          && /auto|scroll/.test(window.getComputedStyle(scroller).overflowY))) scroller = scroller.parentElement;
      if (!scroller || scroller === document.body) {
        if (action === 'resetPicker') return true;
        fail('Flow control not found: requested asset in picker');
      }
      if (action === 'resetPicker') { scroller.scrollTop = 0; return true; }
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) fail('Flow control not found: requested asset in picker');
      scroller.scrollTop += Math.max(100, scroller.clientHeight * 0.7);
      return false;
    }
    if (action === 'selectVideo') {
      const isVideo = (el) => /(^|\s)(video|vid(e)o)(\s|$)/i.test(norm(el.querySelector('.type-subtitle')?.innerText || el.innerText));
      const targetId = req.media_id;
      const targetName = norm(req.reference_video_filename || '').replace(/\.[a-z0-9]+$/i, '');
      const option = assetOptions().find((el) => {
        if (!isVideo(el)) return false;
        const mid = mediaId(el);
        if (mid && targetId && mid === targetId) return true;
        const title = norm(el.querySelector('.asset-title')?.innerText || el.innerText);
        if (targetName && (title === targetName || title.includes(targetName) || targetName.includes(title))) return true;
        return false;
      });
      if (!option) fail('Flow control not found: the requested reference video in picker');
      option.scrollIntoView({ block: 'nearest' });
      return point(option);
    }
    if (action === 'selectImage') {
      const isImage = (el) => !/(^|\s)(video|vid(e)o)(\s|$)/i.test(norm(el.querySelector('.type-subtitle')?.innerText || ''));
      const targetId = req.media_id;
      const targetName = norm(req.image_filename || req.filename || '').replace(/\.[a-z0-9]+$/i, '');
      const option = assetOptions().find((el) => {
        if (!isImage(el)) return false;
        const mid = mediaId(el);
        if (mid && targetId && mid === targetId) return true;
        const title = norm(el.querySelector('.asset-title')?.innerText || el.innerText);
        if (targetName && (title === targetName || title.includes(targetName) || targetName.includes(title))) return true;
        return false;
      });
      if (!option) fail('Flow control not found: image option in picker');
      option.scrollIntoView({ block: 'nearest' });
      return point(option);
    }
    if (action === 'assetAvailable') {
      const option = assetOptions().find((el) => {
        const mid = mediaId(el);
        if (mid && req.media_id && mid === req.media_id) return true;
        const targetName = norm(req.filename || '').replace(/\.[a-z0-9]+$/i, '');
        const title = norm(el.querySelector('.asset-title')?.innerText || el.innerText);
        if (targetName && (title === targetName || title.includes(targetName))) return true;
        return false;
      });
      if (option) {
        option.scrollIntoView({ block: 'center' });
        option.focus();
      }
      return option ? { point: point(option), id: mediaId(option) || req.media_id } : null;
    }
    if (action === 'addSelected') {
      const addBtn = addButton();
      if (!addBtn) fail('Flow control not found: addSelected button');
      addBtn.scrollIntoView({ block: 'nearest' });
      return point(addBtn);
    }
    if (action === 'videoChipIds') {
      const chips = videoChips();
      return chips.map(mediaId);
    }
    if (action === 'imageChipIds') return imageChips().map(mediaId);
    if (action === 'trimPlan' || action === 'trimValues' || action === 'setTrim') {
      let start = find('[role="slider"]', (el) => /^(cat bo diem bat dau|trim start point)$/.test(label(el)));
      let end = find('[role="slider"]', (el) => /^(cat bo diem ket thuc|trim end point)$/.test(label(el)));
      if (!start || !end) {
        start = find('[role="slider"]', (el) => /(bat dau|start|from|dau)/i.test(label(el)));
        end = find('[role="slider"]', (el) => /(ket thuc|end|to|cuoi)/i.test(label(el)));
      }
      if (!start || !end) {
        const sliders = [...document.querySelectorAll('[role="slider"], input[type="range"]')].filter(visible);
        if (sliders.length >= 2) {
          sliders.sort((a, b) => {
            const na = Number(a.getAttribute('aria-valuenow') || a.getBoundingClientRect().left);
            const nb = Number(b.getAttribute('aria-valuenow') || b.getBoundingClientRect().left);
            return na - nb;
          });
          start = sliders[0];
          end = sliders[1];
        }
      }
      if (!start || !end) {
        fail(`Flow control not found: video trim controls for ${action}`);
      }
      const values = {
        start: Number(start.getAttribute('aria-valuenow')),
        end: Number(end.getAttribute('aria-valuenow')),
        min: Number(start.getAttribute('aria-valuemin') || 0),
        max: Number(end.getAttribute('aria-valuemax')),
      };
      if (action === 'trimValues') return values;
      const requestedStart = Number(req.reference_video_start_seconds || 0);
      const requestedEnd = Number(req.reference_video_end_seconds);
      if (!Number.isFinite(requestedStart) || !Number.isFinite(requestedEnd) || requestedEnd <= requestedStart) {
        fail('Motion Control has an invalid reference-video trim range.');
      }
      if (requestedStart < values.min - 0.03 || requestedEnd > values.max + 0.03) {
        fail(`Selected video is ${values.max.toFixed(2)}s long but the requested trim ends at ${requestedEnd.toFixed(2)}s.`);
      }
      if (requestedEnd - requestedStart > 10.03) fail('Flow video reference clips are limited to 10 seconds.');
      if (action === 'setTrim') {
        if (!(start instanceof window.HTMLInputElement) || !(end instanceof window.HTMLInputElement)) return false;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
        for (const [input, value] of [[start, requestedStart], [end, requestedEnd]]) {
          setter.call(input, String(value));
          input.dispatchEvent(new window.Event('input', { bubbles: true }));
          input.dispatchEvent(new window.Event('change', { bubbles: true }));
        }
        return true;
      }
      const trackEl = start.closest('.mdc-slider__track, mat-slider, [class*="slider"], [class*="track"]') || start.parentElement?.parentElement;
      const track = trackEl?.getBoundingClientRect();
      const startRect = start.getBoundingClientRect();
      const endRect = end.getBoundingClientRect();
      const secondsSpan = values.end - values.start;
      const handleScale = secondsSpan > 0 ? (endRect.left - startRect.left) / secondsSpan : 0;
      if (!track?.width || !startRect.width || !endRect.width) fail(`Flow control not found: video trim track for ${action}`);
      const pointFor = (slider, value) => {
        const min = Number(slider.getAttribute('aria-valuemin') || 0);
        const max = Number(slider.getAttribute('aria-valuemax'));
        const rect = slider.getBoundingClientRect();
        if (Number.isFinite(handleScale) && handleScale > 0) {
          const current = Number(slider.getAttribute('aria-valuenow'));
          return { x: rect.left + rect.width / 2 + (value - current) * handleScale, y: rect.top + rect.height / 2 };
        }
        const left = track.left;
        const right = track.right - rect.width;
        const ratio = max > min ? (value - min) / (max - min) : 0;
        return { x: left + Math.max(0, Math.min(1, ratio)) * (right - left) + rect.width / 2, y: rect.top + rect.height / 2 };
      };
      return {
        ...values,
        requestedStart,
        requestedEnd,
        startFrom: { x: startRect.left + startRect.width / 2, y: startRect.top + startRect.height / 2 },
        startTo: pointFor(start, requestedStart),
        endFrom: { x: endRect.left + endRect.width / 2, y: endRect.top + endRect.height / 2 },
        endTo: pointFor(end, requestedEnd),
      };
    }
    if (action === 'generate') {
      const actualPrompt = motionUiStep('promptText', req);
      const expectedPrompt = String(req.prompt || '').replace(/\s+/gu, ' ').trim();
      if (actualPrompt !== expectedPrompt) fail('Flow prompt changed before submit; no video was submitted.');
      const videos = videoChips().map(mediaId);
      const images = imageChips().map(mediaId);
      if (videos.length !== 1 || videos[0] !== req.reference_video_id) {
        fail('The reference video in Flow does not match this Motion Control job.');
      }
      if (images.length !== req.expected_image_ids.length || images.some((id, index) => id !== req.expected_image_ids[index])) {
        fail('The reference images in Flow do not match this Motion Control job.');
      }
      const button = find('button', (el) => /^(bat dau tao|start generation|generate|start creating)$/.test(label(el)));
      return point(button);
    }
    return fail(`Unknown Flow Motion Control step: ${action}`);
  } catch (error) {
    return { error: error?.message || 'Could not read the Flow Motion Control interface.' };
  }
}
