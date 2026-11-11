// Serializable UI helpers executed in Flow's page context.
export function videoUploadUiStep(action, request) {
  try {
    const fail = (message) => { throw new Error(message); };
    if (location.hostname !== 'flow.google.com'
        || location.pathname.match(/\/project\/([^/]+)/)?.[1] !== request.project_id) {
      fail('Flow tab changed project before video upload.');
    }
    const visible = (el) => el && el.getBoundingClientRect().width > 0
      && el.getBoundingClientRect().height > 0
      && window.getComputedStyle(el).visibility !== 'hidden';
    const norm = (value) => String(value || '').normalize('NFD')
      .replace(/[̀-ͯ]/g, '').replace(/đ/gi, 'd').replace(/\s+/g, ' ').trim().toLowerCase();
    const label = (el) => norm(el.getAttribute('aria-label')) || norm(el.innerText || el.textContent);
    const find = (selector, predicate) => [...document.querySelectorAll(selector)].find((el) => visible(el) && predicate(el));
    const center = (el) => {
      const rect = el.getBoundingClientRect();
      return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
    };
    // Same rule as Motion Control: the element hit at the centre must be the control or inside it.
    const reachable = (el) => {
      const { x, y } = center(el);
      const topEl = document.elementFromPoint(x, y);
      return Boolean(topEl && (el.contains(topEl) || topEl.contains(el)));
    };
    const describe = (el) => {
      if (!el) return 'nothing (control is off-screen)';
      const cls = String(el.className?.baseVal ?? el.className ?? '').trim().replace(/\s+/g, '.').slice(0, 100);
      const text = norm(el.getAttribute?.('aria-label') || el.innerText || el.textContent).slice(0, 60);
      return `${el.tagName}${cls ? `.${cls}` : ''}${text ? ` "${text}"` : ''}`;
    };
    const point = (el) => {
      if (!el) fail('Flow upload control was not found. Open the project prompt and try again.');
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') fail('Flow upload control is not ready.');
      el.scrollIntoView({ block: 'nearest' });
      if (!reachable(el)) {
        const { x, y } = center(el);
        fail(`A window is covering the Flow upload control: ${describe(document.elementFromPoint(x, y))}.`);
      }
      return center(el);
    };

    if (action === 'unlock') {
      document.documentElement.removeAttribute('data-flowsveo-upload-until');
      return true;
    }
    if (action === 'lock') {
      document.documentElement.setAttribute('data-flowsveo-upload-until', String(Date.now() + 300000));
      return true;
    }
    if (action === 'dismissBackdrop') {
      // A transparent overlay backdrop left by an open Flow menu swallows clicks; clicking its corner closes it.
      const backdrop = find('.cdk-overlay-backdrop', () => true);
      if (!backdrop) return null;
      const rect = backdrop.getBoundingClientRect();
      for (const [x, y] of [[rect.left + 8, rect.top + 8], [rect.right - 8, rect.top + 8], [rect.left + 8, rect.bottom - 8]]) {
        if (document.elementFromPoint(x, y) === backdrop) return { x, y };
      }
      return null;
    }
    if (action === 'openPicker') {
      const add = find('.base-prompt-box button.add-menu-trigger', () => true);
      return point(add);
    }
    if (action === 'upload') {
      const isUpload = (el) => /tai noi dung nghe nhin len|upload media|upload files/.test(label(el));
      const candidates = [...document.querySelectorAll('button,[role="button"],[role="menuitem"]')]
        .filter((el) => visible(el) && isUpload(el));
      // Flow can show more than one upload button (empty-project area + the menu just opened).
      // Prefer the one in the open menu, then any that is actually clickable.
      const inMenu = (el) => Boolean(el.closest('[role="menu"], .cdk-overlay-pane'));
      const button = candidates.find((el) => inMenu(el) && reachable(el))
        || candidates.find(reachable)
        || candidates.find(inMenu)
        || candidates[0];
      return point(button);
    }
    return fail('Unknown Flow video upload step.');
  } catch (error) {
    return { error: error?.message || 'Could not prepare the Flow video upload.' };
  }
}
