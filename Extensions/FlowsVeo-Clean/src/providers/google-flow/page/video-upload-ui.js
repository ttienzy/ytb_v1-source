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
      .replace(/[\u0300-\u036f]/g, '').replace(/Ä‘/gi, 'd').replace(/\s+/g, ' ').trim().toLowerCase();
    const label = (el) => norm(el.getAttribute('aria-label')) || norm(el.innerText || el.textContent);
    const find = (selector, predicate) => [...document.querySelectorAll(selector)].find((el) => visible(el) && predicate(el));
    const point = (el) => {
      if (!el) fail('Flow upload control was not found. Open the project prompt and try again.');
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') fail('Flow upload control is not ready.');
      el.scrollIntoView({ block: 'nearest' });
      const rect = el.getBoundingClientRect();
      const x = rect.left + rect.width / 2;
      const y = rect.top + rect.height / 2;
      if (!el.contains(document.elementFromPoint(x, y))) fail('A window is covering the Flow upload control.');
      return { x, y };
    };

    if (action === 'unlock') {
      document.documentElement.removeAttribute('data-flowsveo-upload-until');
      return true;
    }
    if (action === 'lock') {
      document.documentElement.setAttribute('data-flowsveo-upload-until', String(Date.now() + 300000));
      return true;
    }
    if (action === 'openPicker') {
      const add = find('.base-prompt-box button.add-menu-trigger', () => true);
      return point(add);
    }
    if (action === 'upload') {
      const button = find('button,[role="button"]', (el) =>
        /tai noi dung nghe nhin len|upload media|upload files/.test(label(el)));
      return point(button);
    }
    return fail('Unknown Flow video upload step.');
  } catch (error) {
    return { error: error?.message || 'Could not prepare the Flow video upload.' };
  }
}
