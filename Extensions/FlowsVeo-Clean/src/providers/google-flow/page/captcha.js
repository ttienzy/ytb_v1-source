export async function inspectRecaptchaInPage(cfg, waitMs = 0) {
  const deadline = Date.now() + waitMs;
  const homePage = location.hostname === 'flow.google.com'
    && !/\/project\//.test(location.pathname);
  let state;
  do {
    const api = window[cfg.m]?.[cfg.s];
    const moduleReady = typeof api?.ready === 'function' && typeof api?.execute === 'function';
    let siteKey = '';
    let keySource = null;
    for (const script of document.scripts) {
      try {
        const url = new URL(script.src, location.href);
        if (!['www.google.com', 'www.recaptcha.net'].includes(url.hostname)
          || url.pathname !== '/recaptcha/enterprise.js') continue;
        const key = url.searchParams.get('render');
        if (key && key !== 'explicit') { siteKey = key; keySource = 'script-render'; break; }
      } catch { }
    }
    if (!siteKey) {
      siteKey = document.querySelector('[data-sitekey]')?.getAttribute('data-sitekey') || '';
      if (siteKey) keySource = 'data-sitekey';
    }
    // Compatibility with older pages; current Flow exposes render= on its script.
    if (!siteKey && cfg.g && cfg.k && cfg.p) {
      const registry = window[cfg.g]?.[cfg.k];
      for (const client of Object.values(registry || {})) {
        for (const item of Object.values(client || {})) {
          if (item && typeof item[cfg.p] === 'string' && item[cfg.p]) {
            siteKey = item[cfg.p]; keySource = 'registry'; break;
          }
        }
        if (siteKey) break;
      }
    }
    const error = !moduleReady
      ? (homePage ? 'Open a Flow project: reCAPTCHA is not loaded on the home page'
        : 'Timed out waiting for the Flow page to load reCAPTCHA')
      : (!siteKey ? 'No site key found in the Flow page' : null);
    state = { available: moduleReady && !!siteKey, moduleReady, siteKey, keySource, error };
    if (state.available || homePage || Date.now() >= deadline) return state;
    await new Promise((resolve) => setTimeout(resolve, 200));
  } while (Date.now() < deadline);
  return state;
}
