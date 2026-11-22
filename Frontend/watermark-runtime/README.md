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

## Patch for Flow portrait / 360p videos

`npm ci` runs `patch-gwr.mjs` (postinstall). It edits the **minified** `dist/video-app.js` of
`@pilio/gemini-watermark-remover`:

- the logo scale is computed against 1080x1920 for portrait videos (was always 1920x1080);
- extra logo positions for 360x640 (Flow 360p portrait) and 576x1024.

Because it patches minified code, the package is pinned to an exact version (`1.0.46`). The script refuses to run on
any other version (exit code 1) instead of silently skipping the patch, is idempotent, keeps the original as
`video-app.js.backup` and preserves the file's line endings. The release workflow fails if the packaged `video-app.js`
is not patched. To upgrade gwr: bump the version, check the anchors in `patch-gwr.mjs` against the new build, re-test
a 360p and a 720p Flow video.

The backend calls `gwr remove … --video-bitrate-mbps 16 --allow-low-confidence` (`WATERMARK_VIDEO_BITRATE_MBPS`
overrides the bitrate). `--allow-low-confidence` is accepted by the 1.0.46 CLI although it is not in its usage text; it
lets re-encoded Flow videos (e.g. cut in Muse Canvas) through. On a video **without** a Flow logo it still processes the
frame, so only run it on Flow videos (Muse Canvas "Ghép video" has a per-clip "xóa logo" switch for that).
