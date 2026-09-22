export async function runCreateProjectInPage() {
  const sleepInPage = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  try {
    let accountPath = location.pathname.match(/\/(u\/\d+)/)?.[0] || '';
    const initialProjectId = location.pathname.match(/\/project\/([^/?#]+)/)?.[1] || null;

    // 1. Thử bấm vào nút / thẻ '+ New project' hoặc 'Start Creating' trên DOM
    let clicked = false;
    const allEls = Array.from(document.querySelectorAll('button, [role="button"], a, div, span'));
    for (const el of allEls) {
      const txt = (el.textContent || '').trim().toLowerCase();
      const aria = (el.getAttribute('aria-label') || '').trim().toLowerCase();
      if ((txt.includes('new project') || aria.includes('new project') || txt.includes('start creating') || txt.includes('dự án mới'))
          && !txt.includes('terms') && !txt.includes('policy')) {
        const target = el.closest('button, [role="button"], a') || el;
        target.click();
        clicked = true;
        break;
      }
    }

    if (!clicked) {
      return { ok: false, error: 'Không tìm thấy nút tạo Project mới trên Google Flow' };
    }

    // 2. Chỉ chấp nhận khi Flow thật sự chuyển sang một project ID mới.
    const deadline = Date.now() + 10000;
    while (Date.now() < deadline) {
      await sleepInPage(400);
      const match = location.pathname.match(/\/project\/([^/?#]+)/);
      if (match && match[1] && match[1] !== initialProjectId) {
        let email = '';
        try {
          const profileEl = document.querySelector('[aria-label*="@"], [data-email]');
          if (profileEl) {
            const aria = profileEl.getAttribute('aria-label') || '';
            const m = aria.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
            if (m) email = m[1];
          }
        } catch {}
        return { ok: true, flow_project_id: match[1], account_email: email };
      }
    }

    return {
      ok: false,
      error: initialProjectId
        ? `Google Flow không chuyển khỏi project hiện tại (${initialProjectId}) sau khi bấm tạo mới`
        : 'Google Flow không mở được project mới sau khi bấm tạo',
    };
  } catch (err) {
    return { ok: false, error: err.message || String(err) };
  }
}
