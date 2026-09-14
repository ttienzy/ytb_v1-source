# Watermark runtime

This isolated npm project is copied into the packaged desktop app. It contains:

- the pinned `gwr` CLI used by the Python backend;
- `sharp` and its Windows native image codec;
- Playwright plus a hermetic Chromium install for video processing.

Install it from PowerShell with:

```powershell
$env:PLAYWRIGHT_BROWSERS_PATH = '0'
npm ci
npx playwright install --only-shell chromium
```

The Electron executable is reused as the Node.js host in production, so end users do not need Node.js or a global npm package.
