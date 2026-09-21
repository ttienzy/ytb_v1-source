import { app, BrowserWindow, dialog, ipcMain, nativeImage, shell } from 'electron'
import type { AppUpdater } from 'electron-updater'
import { basename, delimiter, join } from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import http from 'node:http'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { autoUpdater } = require('electron-updater') as { autoUpdater: AppUpdater }

function getAppIcon() {
  const candidates = [
    join(__dirname, '../resources/icon.ico'),
    join(__dirname, '../../assets/forever.ico'),
    join(app.getAppPath(), 'resources/icon.ico'),
    'D:\\GOOGLE SEARCH\\tools\\assets\\forever.ico',
    join(__dirname, '../../assets/forever.png'),
    join(__dirname, '../resources/icon.png'),
    join(app.getAppPath(), '../assets/forever.png'),
    join(app.getAppPath(), 'resources/icon.png'),
    join(app.getAppPath(), 'public/forever.png'),
    join(process.cwd(), 'assets/forever.png'),
    join(process.cwd(), '../assets/forever.png'),
    'D:\\GOOGLE SEARCH\\tools\\assets\\forever.png',
  ]
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      try {
        const img = nativeImage.createFromPath(candidate)
        if (!img.isEmpty()) return img
      } catch {
        /* continue */
      }
    }
  }
  return undefined
}

let mainWindow: BrowserWindow | null = null
let routerDashboardWindow: BrowserWindow | null = null
let routerProcess: ChildProcess | null = null
const backendProcesses: ChildProcess[] = []
let voiceProcessStarted = false

const configuredBackendPort = Number.parseInt(process.env.BACKEND_PORT || process.env.PORT || '8000', 10)
const backendPort = Number.isFinite(configuredBackendPort) && configuredBackendPort > 0 ? configuredBackendPort : 8000
const backendHost = process.env.BACKEND_HOST?.trim() || '127.0.0.1'
const backendUrl = (process.env.BACKEND_URL?.trim() || `http://${backendHost}:${backendPort}`).replace(/\/+$/, '')
const backendReadyUrl = `${backendUrl}/api/workflow/config`

/** Diệt cả cây tiến trình trên Windows / Linux khi app thoát */
function killProcessTree(pid?: number) {
  if (!pid) return
  if (process.platform === 'win32') {
    try {
      spawn('taskkill', ['/T', '/F', '/PID', String(pid)], { stdio: 'ignore', shell: true })
    } catch {
      /* ignore */
    }
  } else {
    try {
      process.kill(-pid, 'SIGKILL')
    } catch {
      try {
        process.kill(pid, 'SIGKILL')
      } catch {
        /* ignore */
      }
    }
  }
}

/** Tự động khởi chạy Backend Server trong môi trường đóng gói (Production) */
function isBackendReady(timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(backendReadyUrl, (res) => {
      const ready = res.statusCode !== undefined && res.statusCode >= 200 && res.statusCode < 300
      res.resume()
      resolve(ready)
    })
    req.on('error', () => resolve(false))
    req.setTimeout(timeoutMs, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function waitForBackend(maxAttempts = 30, intervalMs = 300): Promise<boolean> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (await isBackendReady()) return true
    if (attempt < maxAttempts - 1) await new Promise((resolve) => setTimeout(resolve, intervalMs))
  }
  return false
}

function findDevBackendDir(): string | null {
  const candidates = [
    join(process.cwd(), '..', 'Backend'),
    join(app.getAppPath(), '..', 'Backend'),
    join(__dirname, '..', '..', '..', 'Backend'),
  ]
  return candidates.find((candidate) => existsSync(join(candidate, 'run_server.py'))) || null
}

function spawnDevelopmentBackend() {
  const backendDir = findDevBackendDir()
  if (!backendDir) {
    console.error('[Electron] Backend source directory not found; set BACKEND_URL or start Backend manually.')
    return
  }

  const venvPython = join(backendDir, '.venv', 'Scripts', 'python.exe')
  const python = process.env.WORKFLOW_PYTHON?.trim() || (existsSync(venvPython) ? venvPython : 'python')
  try {
    const backendProc = spawn(python, ['run_server.py'], {
      cwd: backendDir,
      windowsHide: true,
      stdio: 'pipe',
      env: {
        ...process.env,
        PORT: String(backendPort),
        HOST: backendHost,
      },
    })
    backendProc.stdout?.on('data', (data) => console.log(`[Backend] ${String(data).trimEnd()}`))
    backendProc.stderr?.on('data', (data) => console.error(`[Backend] ${String(data).trimEnd()}`))
    backendProc.on('error', (err) => console.error('[Electron] Failed to start development backend:', err))
    backendProcesses.push(backendProc)
    console.log(`[Electron] Started development backend (PID: ${backendProc.pid})`)
  } catch (err) {
    console.error('[Electron] Failed to start development backend:', err)
  }
}

async function startProductionBackend() {
  if (!app.isPackaged) {
    if (!await isBackendReady()) spawnDevelopmentBackend()
    if (!await waitForBackend()) console.error(`[Electron] Backend did not become ready at ${backendReadyUrl}`)
    return
  }

  const userDataDir = app.getPath('userData')
  const resourcesDir = process.resourcesPath
  const binDir = join(resourcesDir, 'bin')
  const watermarkModulesDir = join(resourcesDir, 'watermark-runtime', 'node_modules')
  const watermarkGwrScript = join(watermarkModulesDir, '@pilio', 'gemini-watermark-remover', 'bin', 'gwr.mjs')
  const watermarkBrowsersDir = join(watermarkModulesDir, 'playwright-core', '.local-browsers')

  const backendExe = join(binDir, 'backend_server.exe')
  if (existsSync(backendExe)) {
    try {
      const backendProc = spawn(backendExe, [], {
        cwd: binDir,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          APP_DATA_DIR: userDataDir,
          PORT: String(backendPort),
          HOST: backendHost,
          WATERMARK_NODE_PATH: process.execPath,
          WATERMARK_NODE_IS_ELECTRON: '1',
          WATERMARK_GWR_SCRIPT: watermarkGwrScript,
          WATERMARK_PLAYWRIGHT_BROWSERS_PATH: watermarkBrowsersDir,
        },
      })
      backendProcesses.push(backendProc)
      console.log(`[Electron] Started backend process (PID: ${backendProc.pid})`)
    } catch (err) {
      console.error('[Electron] Failed to start backend_server.exe:', err)
    }
  }

  if (!await waitForBackend()) console.error(`[Electron] Backend did not become ready at ${backendReadyUrl}`)

}

function startPackagedVoiceService() {
  if (!app.isPackaged || voiceProcessStarted) return
  const userDataDir = app.getPath('userData')
  const binDir = join(process.resourcesPath, 'bin')
  const voiceExe = join(binDir, 'voice_server.exe')
  if (existsSync(voiceExe)) {
    voiceProcessStarted = true
    try {
      const ffmpegExe = join(binDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
      const voicePath = [binDir, process.env.PATH].filter(Boolean).join(delimiter)
      const voiceProc = spawn(voiceExe, [], {
        cwd: binDir,
        windowsHide: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          APP_DATA_DIR: userDataDir,
          HF_HOME: join(userDataDir, 'voice_data', 'models'),
          PATH: voicePath,
          PORT: '8001',
          HOST: '127.0.0.1',
          ...(existsSync(ffmpegExe) ? { FFMPEG_PATH: ffmpegExe } : {}),
        },
      })
      backendProcesses.push(voiceProc)
      console.log(`[Electron] Started voice process (PID: ${voiceProc.pid})`)
    } catch (err) {
      voiceProcessStarted = false
      console.error('[Electron] Failed to start voice_server.exe:', err)
    }
  }
}

function createWindow() {
  const appIcon = getAppIcon()

  mainWindow = new BrowserWindow({
    title: 'CreatorFlow AI',
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/preload.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (appIcon) {
    try {
      mainWindow.setIcon(appIcon)
    } catch {
      /* ignore */
    }
  }

  // Avoid exposing Chromium's first incomplete paint. The renderer can prepare
  // the stable Dashboard shell/skeleton before the window becomes visible.
  mainWindow.once('ready-to-show', () => {
    // Open the main app maximized on startup while preserving the normal
    // Windows title bar controls (minimize, restore/maximize, close).
    mainWindow?.maximize()
    mainWindow?.show()
    // Loading the ONNX voice model is disk/CPU intensive. Give Chromium's
    // first Dashboard paint a short uncontested window, then start TTS.
    setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) startPackagedVoiceService()
    }, 750)
  })

  // Mở các liên kết ngoài (Telegram, GitHub, Google Drive...) bằng trình duyệt mặc định
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

ipcMain.handle('video:choose-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow ?? undefined, { properties: ['openDirectory', 'createDirectory'] })
  return result.canceled ? null : result.filePaths[0]
})
ipcMain.handle('video:get-default-folder', () => app.getPath('downloads'))

ipcMain.handle('video:save-file', async (_event, payload: { folder: string; name: string; data: ArrayBuffer }) => {
  const safeName = basename(payload.name).replace(/[<>:"/\\|?*]+/g, '_')
  const target = join(payload.folder, safeName)
  await writeFile(target, Buffer.from(payload.data))
  return target
})

function is9RouterRunning(port = 20128): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}`, (res) => {
      resolve(true)
      res.resume()
    })
    req.on('error', () => resolve(false))
    req.setTimeout(1200, () => {
      req.destroy()
      resolve(false)
    })
  })
}

async function start9Router(port = 20128): Promise<boolean> {
  if (await is9RouterRunning(port)) return true

  try {
    const proc = spawn('9router', ['-p', String(port), '-t', '-n'], {
      windowsHide: true,
      stdio: 'ignore',
      shell: true,
    })
    proc.on('error', (err) => console.error('[9router] Spawn error:', err))
    backendProcesses.push(proc)
    routerProcess = proc

    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 400))
      if (await is9RouterRunning(port)) {
        console.log(`[9router] Ready on port ${port}`)
        return true
      }
    }
  } catch (err) {
    console.error('[9router] Failed to start:', err)
  }
  return false
}

ipcMain.handle('open-9router-dashboard', async () => {
  // 1. Khởi động 9router nếu chưa chạy
  await start9Router(20128)

  // 2. Nếu cửa sổ đã mở, đưa lên trước
  if (routerDashboardWindow && !routerDashboardWindow.isDestroyed()) {
    routerDashboardWindow.show()
    routerDashboardWindow.focus()
    return { ok: true }
  }

  // 3. Mở cửa sổ Electron chuyên biệt cho 9Router
  const appIcon = getAppIcon()
  routerDashboardWindow = new BrowserWindow({
    width: 1040,
    height: 720,
    minWidth: 800,
    minHeight: 550,
    title: '9Router - AI Infrastructure Management',
    autoHideMenuBar: true,
    ...(appIcon ? { icon: appIcon } : {}),
    webPreferences: {
      partition: 'persist:9router',
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  if (appIcon) {
    try {
      routerDashboardWindow.setIcon(appIcon)
    } catch {
      /* ignore */
    }
  }

  // Các popup OAuth mở bằng trình duyệt hệ thống
  routerDashboardWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url)
    return { action: 'deny' }
  })

  routerDashboardWindow.webContents.on('dom-ready', () => {
    routerDashboardWindow?.webContents.executeJavaScript(`
      try {
        const input = document.querySelector('input[type="password"]');
        if (input && !input.value) {
          input.placeholder = '123456 (Mật khẩu mặc định)';
        }
      } catch (e) {}
    `).catch(() => {})
  })

  routerDashboardWindow.on('closed', () => {
    routerDashboardWindow = null
    mainWindow?.webContents.send('9router:updated')
  })

  await routerDashboardWindow.loadURL('http://localhost:20128/')
  return { ok: true }
})

ipcMain.handle('check-9router-status', async () => {
  const running = await is9RouterRunning(20128)
  return { running }
})

function setupAutoUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false

  autoUpdater.on('checking-for-update', () => {
    mainWindow?.webContents.send('updater:status', { status: 'checking' })
  })

  autoUpdater.on('update-available', (info) => {
    mainWindow?.webContents.send('updater:status', {
      status: 'available',
      version: info.version,
      releaseDate: info.releaseDate,
      releaseNotes: info.releaseNotes,
    })
  })

  autoUpdater.on('update-not-available', (info) => {
    mainWindow?.webContents.send('updater:status', {
      status: 'up_to_date',
      version: info.version,
    })
  })

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('updater:status', {
      status: 'downloading',
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    mainWindow?.webContents.send('updater:status', {
      status: 'downloaded',
      version: info.version,
      releaseNotes: info.releaseNotes,
    })
  })

  autoUpdater.on('error', (err) => {
    console.error('[AutoUpdater] Error:', err)
    mainWindow?.webContents.send('updater:status', {
      status: 'error',
      message: err?.message || 'Có lỗi xảy ra khi kiểm tra/tải bản cập nhật',
    })
  })
}

ipcMain.handle('updater:get-app-version', () => {
  return app.getVersion()
})

ipcMain.handle('updater:check', async () => {
  if (!app.isPackaged) {
    try {
      const res = await fetch('https://api.github.com/repos/ttienzy/ytb_v1/releases/latest', {
        headers: { 'User-Agent': 'CreatorFlow-App' },
      })
      if (!res.ok) {
        if (res.status === 404) {
          const payload = { status: 'up_to_date', currentVersion: app.getVersion() }
          mainWindow?.webContents.send('updater:status', payload)
          return payload
        }
        throw new Error(`HTTP ${res.status}`)
      }
      const data = (await res.json()) as { tag_name?: string; name?: string; body?: string; published_at?: string }
      const latestTag = data.tag_name?.replace(/^v/, '') || ''
      const currentVer = app.getVersion().replace(/^v/, '')
      if (latestTag && latestTag !== currentVer) {
        const payload = {
          status: 'available',
          isDev: true,
          currentVersion: app.getVersion(),
          version: data.tag_name,
          releaseDate: data.published_at,
          releaseNotes: data.body,
        }
        mainWindow?.webContents.send('updater:status', payload)
        return payload
      }
      const payload = { status: 'up_to_date', currentVersion: app.getVersion() }
      mainWindow?.webContents.send('updater:status', payload)
      return payload
    } catch (err: any) {
      const payload = { status: 'error', message: err?.message || 'Không thể kiểm tra cập nhật' }
      mainWindow?.webContents.send('updater:status', payload)
      return payload
    }
  }

  try {
    const result = await autoUpdater.checkForUpdates()
    return {
      status: result?.updateInfo?.version ? 'checked' : 'idle',
      updateInfo: result?.updateInfo,
      currentVersion: app.getVersion(),
    }
  } catch (err: any) {
    console.error('[AutoUpdater] Check error:', err)
    return { status: 'error', message: err?.message || 'Không thể kiểm tra cập nhật' }
  }
})

ipcMain.handle('updater:download', async () => {
  if (!app.isPackaged) {
    return { error: 'Tính năng tự động tải cập nhật hoạt động trên bản phát hành chính thức (.exe).' }
  }
  try {
    await autoUpdater.downloadUpdate()
    return { ok: true }
  } catch (err: any) {
    console.error('[AutoUpdater] Download error:', err)
    return { error: err?.message || 'Tải bản cập nhật thất bại' }
  }
})

ipcMain.handle('updater:quit-and-install', () => {
  cleanUpBackends()
  setImmediate(() => {
    autoUpdater.quitAndInstall(false, true)
  })
})

app.whenReady().then(async () => {
  await startProductionBackend()
  setupAutoUpdater()
  createWindow()
  if (mainWindow) {
    mainWindow.on('focus', () => {
      mainWindow?.webContents.send('9router:updated')
    })
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

function cleanUpBackends() {
  for (const proc of backendProcesses) {
    killProcessTree(proc.pid)
  }
  backendProcesses.length = 0
}

app.on('before-quit', () => {
  cleanUpBackends()
})

app.on('window-all-closed', () => {
  cleanUpBackends()
  if (process.platform !== 'darwin') app.quit()
})

